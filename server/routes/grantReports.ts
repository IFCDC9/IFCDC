import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { stringify } from "csv-stringify/sync";

const router = Router();

/**
 * GET /api/reports/funding/:fundingSourceId
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD)
 */
router.get(
  "/funding/:fundingSourceId",
  requireAuth(["admin"]),
  async (req: AuthedRequest, res) => {
    try {
      const { fundingSourceId } = req.params;
      const { from, to } = req.query as { from?: string; to?: string };

      const fundingSource = await prisma.fundingSource.findUnique({
        where: { id: fundingSourceId },
      });

      if (!fundingSource) {
        return res.status(404).json({ error: "Funding source not found" });
      }

      const where: any = { fundingSourceId };

      if (from) {
        where.date = { ...(where.date || {}), gte: new Date(from) };
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.date = { ...(where.date || {}), lte: toDate };
      }

      const entries = await prisma.timeEntry.findMany({
        where,
        include: {
          employee: true,
        },
        orderBy: { date: "asc" },
      });

      let totalHours = 0;
      let totalCost = 0;

      type EmployeeAgg = {
        employeeId: string;
        name: string;
        role: string;
        payRate: number | null;
        currency: string;
        hours: number;
        cost: number;
      };

      const byEmployeeMap = new Map<string, EmployeeAgg>();

      for (const e of entries) {
        const hours = e.hours;
        const emp = e.employee;
        const payRate = emp.payRate ?? null;
        const currency = emp.payCurrency ?? "USD";

        totalHours += hours;
        if (typeof payRate === "number") {
          totalCost += hours * payRate;
        }

        if (!byEmployeeMap.has(emp.id)) {
          byEmployeeMap.set(emp.id, {
            employeeId: emp.id,
            name: `${emp.firstName} ${emp.lastName}`,
            role: emp.role,
            payRate,
            currency,
            hours: 0,
            cost: 0,
          });
        }
        const empAgg = byEmployeeMap.get(emp.id)!;
        empAgg.hours += hours;
        if (typeof payRate === "number") {
          empAgg.cost += hours * payRate;
        }
      }

      const byEmployee = Array.from(byEmployeeMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      );

      return res.json({
        fundingSource: {
          id: fundingSource.id,
          name: fundingSource.name,
          code: fundingSource.code,
          type: fundingSource.type,
          agency: fundingSource.agency,
        },
        period: {
          from: from || null,
          to: to || null,
        },
        totals: {
          hours: totalHours,
          cost: totalCost,
          currency: "USD",
        },
        byEmployee,
        entries: entries.map(e => ({
          id: e.id,
          date: e.date,
          hours: e.hours,
          notes: e.notes,
          employee: {
            id: e.employee.id,
            name: `${e.employee.firstName} ${e.employee.lastName}`,
            role: e.employee.role,
          },
        })),
      });
    } catch (err) {
      console.error("Error building funding source report", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * GET /api/reports/funding/:fundingSourceId/export
 * Query params: from, to
 */
router.get(
  "/funding/:fundingSourceId/export",
  requireAuth(["admin"]),
  async (req: AuthedRequest, res) => {
    try {
      const { fundingSourceId } = req.params;
      const { from, to } = req.query as { from?: string; to?: string };

      const fundingSource = await prisma.fundingSource.findUnique({
        where: { id: fundingSourceId },
      });
      if (!fundingSource) {
        return res.status(404).json({ error: "Funding source not found" });
      }

      const where: any = { fundingSourceId };

      if (from) {
        where.date = { ...(where.date || {}), gte: new Date(from) };
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.date = { ...(where.date || {}), lte: toDate };
      }

      const entries = await prisma.timeEntry.findMany({
        where,
        include: {
          employee: true,
        },
        orderBy: { date: "asc" },
      });

      const records = entries.map(e => ({
        FundingSource: fundingSource.name,
        FundingCode: fundingSource.code ?? "",
        Date: e.date.toISOString(),
        "Employee Name": `${e.employee.firstName} ${e.employee.lastName}`,
        "Employee Role": e.employee.role,
        Hours: e.hours,
        "Pay Rate": e.employee.payRate ?? "",
        "Pay Currency": e.employee.payCurrency ?? "USD",
        Cost:
          typeof e.employee.payRate === "number"
            ? e.hours * e.employee.payRate
            : "",
        Notes: e.notes ?? "",
      }));

      const csv = stringify(records, { header: true });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ifcdc_grant_report_${fundingSource.code || fundingSource.id}_${
          from || "start"
        }_${to || "end"}.csv"`
      );

      return res.send(csv);
    } catch (err) {
      console.error("Error exporting funding source report CSV", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
