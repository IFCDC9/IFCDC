import { Response } from "express";
import prisma from "../db/client";
import { AuthRequest } from "../middleware/auth";

export const overview = async (_req: AuthRequest, res: Response) => {
  try {
    const [totalSubmissions, openSubmissions, flaggedSubmissions, highRiskSubmissions] = await Promise.all([
      prisma.formSubmission.count(),
      prisma.formSubmission.count({ where: { status: "open" } }),
      prisma.formSubmission.count({ where: { flagged: true } }),
      prisma.formSubmission.count({ where: { riskLevel: "high" } }),
    ]);

    const byStatus = await prisma.formSubmission.groupBy({
      by: ["status"],
      _count: { id: true },
    });

    const byRiskLevel = await prisma.formSubmission.groupBy({
      by: ["riskLevel"],
      _count: { id: true },
    });

    const recentSubmissions = await prisma.formSubmission.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: {
        form: { select: { slug: true, title: true } },
        submittedBy: { select: { id: true, name: true } },
      },
    });

    res.json({
      summary: {
        total: totalSubmissions,
        open: openSubmissions,
        flagged: flaggedSubmissions,
        highRisk: highRiskSubmissions,
      },
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count.id })),
      byRiskLevel: byRiskLevel.map((r) => ({ riskLevel: r.riskLevel, count: r._count.id })),
      recentSubmissions,
    });
  } catch (err) {
    console.error("Error fetching overview:", err);
    res.status(500).json({ message: "Error fetching overview" });
  }
};

export const incidentsByProgram = async (_req: AuthRequest, res: Response) => {
  try {
    const byForm = await prisma.formSubmission.groupBy({
      by: ["formId"],
      _count: { id: true },
    });

    const forms = await prisma.form.findMany({
      select: { id: true, slug: true, title: true },
    });

    const formMap = new Map(forms.map((f) => [f.id, f]));

    const result = byForm.map((item) => ({
      form: formMap.get(item.formId) || { id: item.formId, slug: "unknown", title: "Unknown" },
      count: item._count.id,
    }));

    res.json(result);
  } catch (err) {
    console.error("Error fetching incidents by program:", err);
    res.status(500).json({ message: "Error fetching incidents by program" });
  }
};

export const incidentsTimeSeries = async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const submissions = await prisma.formSubmission.findMany({
      where: {
        createdAt: { gte: startDate },
      },
      select: {
        id: true,
        createdAt: true,
        formId: true,
        status: true,
        riskLevel: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const dailyCounts: Record<string, number> = {};
    submissions.forEach((sub) => {
      const dateKey = sub.createdAt.toISOString().split("T")[0];
      dailyCounts[dateKey] = (dailyCounts[dateKey] || 0) + 1;
    });

    const timeSeries = Object.entries(dailyCounts).map(([date, count]) => ({
      date,
      count,
    }));

    res.json({
      period: { days, startDate: startDate.toISOString() },
      total: submissions.length,
      timeSeries,
    });
  } catch (err) {
    console.error("Error fetching time series:", err);
    res.status(500).json({ message: "Error fetching time series" });
  }
};
