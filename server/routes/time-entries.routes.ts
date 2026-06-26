import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { stringify } from "csv-stringify/sync";

const router = Router();

router.post(
  "/",
  requireAuth(["admin", "barber", "radio_host", "program_staff"]),
  async (req: AuthedRequest, res) => {
    try {
      const { date, hours, notes, fundingSourceId } = req.body;

      if (!req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      if (!date || !hours) {
        return res.status(400).json({ error: "Date and hours are required" });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { employee: true },
      });

      if (!user || !user.employee) {
        return res
          .status(400)
          .json({ error: "User is not linked to an employee record" });
      }

      let resolvedFundingSourceId: string | null = null;

      if (fundingSourceId) {
        const fs = await prisma.fundingSource.findUnique({
          where: { id: fundingSourceId },
        });
        if (!fs) {
          return res.status(400).json({ error: "Invalid fundingSourceId" });
        }
        resolvedFundingSourceId = fs.id;
      }

      const entry = await prisma.timeEntry.create({
        data: {
          employeeId: user.employee.id,
          fundingSourceId: resolvedFundingSourceId,
          date: new Date(date),
          hours: parseFloat(hours),
          notes: notes || null,
        },
        include: {
          fundingSource: true,
        },
      });

      return res.status(201).json(entry);
    } catch (err) {
      console.error("Error creating time entry", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get(
  "/my",
  requireAuth(["admin", "barber", "radio_host", "program_staff"]),
  async (req: AuthedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { employee: true },
      });

      if (!user || !user.employee) {
        return res
          .status(400)
          .json({ error: "User is not linked to an employee record" });
      }

      const entries = await prisma.timeEntry.findMany({
        where: { employeeId: user.employee.id },
        include: { fundingSource: true },
        orderBy: { date: "desc" },
      });

      return res.json(entries);
    } catch (err) {
      console.error("Error fetching my time entries", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get("/", requireAuth(["admin"]), async (_req, res) => {
  try {
    const entries = await prisma.timeEntry.findMany({
      include: {
        employee: true,
        fundingSource: true,
      },
      orderBy: { date: "desc" },
    });

    return res.json(entries);
  } catch (err) {
    console.error("Error fetching all time entries", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get(
  "/export",
  requireAuth(["admin"]),
  async (req: AuthedRequest, res) => {
    try {
      const { from, to, fundingSourceId } = req.query as {
        from?: string;
        to?: string;
        fundingSourceId?: string;
      };

      const where: any = {};

      if (from) {
        where.date = { ...(where.date || {}), gte: new Date(from) };
      }
      if (to) {
        where.date = { ...(where.date || {}), lte: new Date(to) };
      }
      if (fundingSourceId) {
        where.fundingSourceId = fundingSourceId;
      }

      const entries = await prisma.timeEntry.findMany({
        where,
        include: {
          employee: true,
          fundingSource: true,
        },
        orderBy: { date: "asc" },
      });

      const records = entries.map(e => ({
        Date: e.date.toISOString(),
        "Employee Name": `${e.employee.firstName} ${e.employee.lastName}`,
        "Employee Role": e.employee.role,
        Hours: e.hours,
        "Pay Rate": e.employee.payRate ?? "",
        "Pay Currency": e.employee.payCurrency ?? "USD",
        Cost: e.employee.payRate ? e.hours * e.employee.payRate : "",
        "Funding Source": e.fundingSource?.name ?? "",
        "Funding Code": e.fundingSource?.code ?? "",
        Notes: e.notes ?? "",
      }));

      const csv = stringify(records, {
        header: true,
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ifcdc_time_entries_${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );

      return res.send(csv);
    } catch (err) {
      console.error("Error exporting time entries CSV", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
