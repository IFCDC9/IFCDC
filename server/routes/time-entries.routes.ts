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
      const { date, hours, programId, notes } = req.body;

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

      const entry = await prisma.timeEntry.create({
        data: {
          employeeId: user.employee.id,
          programId: programId || null,
          date: new Date(date),
          hours: parseFloat(hours),
          notes: notes || null,
        },
        include: {
          program: true,
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
        include: { program: true },
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
        program: true,
      },
      orderBy: { date: "desc" },
    });

    return res.json(entries);
  } catch (err) {
    console.error("Error fetching all time entries", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/export", requireAuth(["admin"]), async (req, res) => {
  try {
    const { from, to, programId } = req.query;

    const where: Record<string, unknown> = {};

    if (from || to) {
      where.date = {};
      if (from) (where.date as Record<string, Date>).gte = new Date(from as string);
      if (to) (where.date as Record<string, Date>).lte = new Date(to as string);
    }

    if (programId) {
      where.programId = programId as string;
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      include: {
        employee: true,
        program: true,
      },
      orderBy: { date: "desc" },
    });

    const rows = entries.map((e) => ({
      Date: e.date.toISOString().split("T")[0],
      Employee: `${e.employee.firstName} ${e.employee.lastName}`,
      Role: e.employee.role,
      Hours: e.hours,
      Program: e.program?.name || "",
      Notes: e.notes || "",
    }));

    const csv = stringify(rows, { header: true });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="time-entries-${new Date().toISOString().split("T")[0]}.csv"`
    );
    return res.send(csv);
  } catch (err) {
    console.error("Error exporting time entries", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
