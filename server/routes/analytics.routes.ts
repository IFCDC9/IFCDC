import { Router } from "express";
import type { Request, Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  buildAnalyticsOverview,
  buildSafeAnalyticsOverview,
  buildOrganizationHealthScore,
  buildFinanceAnalytics,
  buildPeopleAnalytics,
  buildPayrollAnalytics,
  buildDonationAnalytics,
  buildProgramAnalytics,
  buildSoftwareAnalytics,
  buildHeadquartersActivityFeed,
  buildExecutiveReport,
  buildBoardDashboard,
  buildPredictiveTrends,
  buildKpiMonitoring,
} from "../hq/analyticsReporting";
import { buildGrantAnalytics } from "../hq/grantReporting";
import { auraExecutiveChat } from "../lib/ifcdc";
import { buildAuraExecutiveContext } from "../hq/auraExecutiveContext";
import { buildExecutiveCommandCenter, getOrGenerateDailyBriefing } from "../hq/executiveBriefings";
import { buildExecutiveTrendAnalysis, buildPredictiveKpiDashboard } from "../hq/executiveTrends";

const router = Router();

router.use(hqAuthRequired, requireHQModule("analytics"));

router.get("/overview", async (_req, res) => {
  res.json(await buildSafeAnalyticsOverview());
});

router.get("/health-score", async (_req, res) => {
  res.json(await buildOrganizationHealthScore());
});

router.get("/finance", async (_req, res) => {
  res.json(await buildFinanceAnalytics());
});

router.get("/grants", async (_req, res) => {
  res.json(await buildGrantAnalytics());
});

router.get("/people", async (_req, res) => {
  res.json(await buildPeopleAnalytics());
});

router.get("/payroll", async (_req, res) => {
  res.json(await buildPayrollAnalytics());
});

router.get("/donations", async (_req, res) => {
  res.json(await buildDonationAnalytics());
});

router.get("/programs", async (_req, res) => {
  res.json(await buildProgramAnalytics());
});

router.get("/software", async (_req, res) => {
  res.json(await buildSoftwareAnalytics());
});

router.get("/activity", async (req, res) => {
  const limit = Number(req.query.limit ?? 30);
  res.json({ activity: await buildHeadquartersActivityFeed(limit) });
});

router.get("/kpi-monitoring", async (_req, res) => {
  res.json(await buildKpiMonitoring());
});

router.get("/command-center", async (_req, res) => {
  res.json(await buildExecutiveCommandCenter());
});

router.get("/daily-briefing", async (req, res) => {
  const force = req.query.refresh === "true";
  res.json(await getOrGenerateDailyBriefing(force));
});

router.get("/trends/analysis", async (_req, res) => {
  res.json(await buildExecutiveTrendAnalysis());
});

router.get("/predictive-kpi", async (_req, res) => {
  res.json(await buildPredictiveKpiDashboard());
});

router.get("/trends", async (_req, res) => {
  res.json(await buildPredictiveTrends());
});

router.get("/board", async (_req, res) => {
  res.json(await buildBoardDashboard());
});

router.get("/founder", async (_req, res) => {
  const [overview, activity, trends, finance] = await Promise.all([
    buildAnalyticsOverview(),
    buildHeadquartersActivityFeed(20),
    buildPredictiveTrends(),
    buildFinanceAnalytics(),
  ]);
  res.json({ overview, activity, trends, finance, role: "founder" });
});

router.get("/reports/:period", async (req, res) => {
  const period = req.params.period as "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  const valid = ["daily", "weekly", "monthly", "quarterly", "annual"];
  if (!valid.includes(period)) return res.status(400).json({ error: "Invalid period" });
  res.json(await buildExecutiveReport(period));
});

router.get("/export/csv", async (req, res) => {
  const period = (req.query.period as string) || "monthly";
  const report = await buildExecutiveReport(period as "monthly");
  const rows = [
    ["IFCDC Headquarters Executive Report"],
    [`Period: ${period}`, `Generated: ${report.generatedAt}`],
    [],
    ["Organization Health", report.overview.organizationHealth.overall],
    ["Total Revenue", report.overview.finance.totalRevenue],
    ["Cash Flow", report.overview.finance.cashFlow],
    ["Total Awarded Grants", report.overview.grants.totalAwarded],
    ["Active People", report.overview.people.totalPeople],
    ["Donations Total", report.overview.donations.total],
    [],
    ["Monthly Trend"],
    ["Month", "Donations", "Expenses", "Cash Flow"],
    ...report.finance.monthlyTrend.map((m: { month: string; donations: number; expenses: number; cashFlow: number }) =>
      [m.month, m.donations, m.expenses, m.cashFlow]
    ),
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="ifcdc-report-${period}.csv"`);
  res.send(csv);
});

router.post("/aura-insights", async (req: Request, res: Response) => {
  const overview = await buildAnalyticsOverview();
  const context = await buildAuraExecutiveContext();
  const message = req.body.message ?? "Provide executive insights on current organization health and priorities.";
  try {
    const response = await auraExecutiveChat(message, context);
    res.json({ insight: response, overview: overview.organizationHealth });
  } catch {
    res.json({
      insight: `Organization Health: ${overview.organizationHealth.overall}/100 (${overview.organizationHealth.grade}). Review KPI dashboards for detailed metrics.`,
      overview: overview.organizationHealth,
      offline: true,
    });
  }
});

export default router;
