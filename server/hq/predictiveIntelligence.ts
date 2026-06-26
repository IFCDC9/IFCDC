import { getDb } from "../db";
import { ensureWarehouseTables } from "./analyticsWarehouseSchema";
import { buildSafeAnalyticsOverview } from "./analyticsReporting";
import { buildExecutiveDashboard } from "./financeReporting";
import { buildGrantExecutiveDashboard } from "./grantReporting";
import { predictFinancialRisk } from "./auraExecutiveOps";

export interface PredictiveModel {
  id: string;
  label: string;
  current: number;
  projected30d: number;
  projected90d: number;
  confidence: "high" | "medium" | "low";
  trend: "up" | "down" | "stable";
  unit: string;
  insight: string;
}

function linearProject(values: number[], horizon: number): { projected: number; trend: "up" | "down" | "stable"; confidence: "high" | "medium" | "low" } {
  if (values.length < 2) {
    const current = values[values.length - 1] ?? 0;
    return { projected: current, trend: "stable", confidence: "low" };
  }
  const avgDelta = (values[values.length - 1] - values[0]) / Math.max(values.length - 1, 1);
  const projected = Math.round(values[values.length - 1] + avgDelta * horizon);
  const trend = avgDelta > 0.5 ? "up" : avgDelta < -0.5 ? "down" : "stable";
  const confidence = values.length >= 7 ? "high" : values.length >= 3 ? "medium" : "low";
  return { projected, trend, confidence };
}

async function metricHistory(key: string, limit = 14): Promise<number[]> {
  await ensureWarehouseTables();
  const db = await getDb();
  const rows = (await db.all(
    `SELECT metric_value FROM hq_warehouse_metrics WHERE metric_key = ? ORDER BY created_at DESC LIMIT ?`,
    key, limit
  ).catch(() => [])) as { metric_value: number }[];
  return rows.reverse().map((r) => r.metric_value);
}

export async function buildPredictiveIntelligence() {
  const [overview, finance, grants, risk] = await Promise.all([
    buildSafeAnalyticsOverview(),
    buildExecutiveDashboard(),
    buildGrantExecutiveDashboard(),
    predictFinancialRisk().catch(() => ({ riskScore: 30, riskLevel: "low", riskFactors: [] })),
  ]);

  const [healthHist, cashHist, grantHist, peopleHist, donationHist] = await Promise.all([
    metricHistory("organization_health"),
    metricHistory("cash_flow"),
    metricHistory("active_grants"),
    metricHistory("total_people"),
    metricHistory("donations_total"),
  ]);

  const healthProj = linearProject(healthHist.length ? healthHist : [overview.organizationHealth.overall], 30);
  const cashProj = linearProject(cashHist.length ? cashHist : [finance.cashFlow], 30);
  const grantProj = linearProject(grantHist.length ? grantHist : [grants.activeAwards], 30);
  const peopleProj = linearProject(peopleHist.length ? peopleHist : [overview.people.totalPeople], 30);
  const donationProj = linearProject(donationHist.length ? donationHist : [overview.donations.total], 30);

  const winRate = grants.winRate ?? 50;
  const pipelineApps = grants.pipelineValue > 0 ? Math.round(grants.pipelineValue / 50000) : 0;
  const grantSuccessProb = Math.min(95, Math.max(15, Math.round(winRate * 0.85 + (pipelineApps > 3 ? 10 : 0))));

  const staffingGap = Math.max(0, Math.round((overview.programs.participants / 25) - overview.people.employees));
  const volunteerTarget = Math.round(overview.people.volunteers * (donationProj.trend === "up" ? 1.12 : 1.02));
  const programGrowth = Math.round(overview.programs.participants * (healthProj.trend === "up" ? 1.08 : 0.98));

  const models: PredictiveModel[] = [
    {
      id: "grant_success",
      label: "Grant Success Probability",
      current: grantSuccessProb,
      projected30d: Math.min(95, grantSuccessProb + (grantProj.trend === "up" ? 5 : -2)),
      projected90d: Math.min(95, grantSuccessProb + (grantProj.trend === "up" ? 12 : -5)),
      confidence: pipelineApps > 0 ? "medium" : "low",
      trend: grantProj.trend,
      unit: "%",
      insight: `${pipelineApps} opportunities in pipeline · win rate ${winRate}%`,
    },
    {
      id: "cash_flow",
      label: "Cash Flow Projection",
      current: finance.cashFlow,
      projected30d: linearProject(cashHist.length ? cashHist : [finance.cashFlow], 30).projected,
      projected90d: linearProject(cashHist.length ? cashHist : [finance.cashFlow], 90).projected,
      confidence: cashProj.confidence,
      trend: cashProj.trend,
      unit: "$",
      insight: finance.cashFlow >= 0 ? "Positive operating cash position" : "Monitor expenses and grant disbursements",
    },
    {
      id: "staffing",
      label: "Staffing Needs",
      current: overview.people.employees,
      projected30d: overview.people.employees + staffingGap,
      projected90d: overview.people.employees + Math.round(staffingGap * 1.5),
      confidence: staffingGap > 0 ? "medium" : "high",
      trend: staffingGap > 0 ? "up" : "stable",
      unit: "FTE",
      insight: staffingGap > 0 ? `${staffingGap} additional staff recommended for program load` : "Current staffing aligned with program capacity",
    },
    {
      id: "volunteers",
      label: "Volunteer Participation",
      current: overview.people.volunteers,
      projected30d: volunteerTarget,
      projected90d: Math.round(volunteerTarget * 1.05),
      confidence: "medium",
      trend: donationProj.trend,
      unit: "volunteers",
      insight: `${overview.people.hoursThisMonth} volunteer hours logged this month`,
    },
    {
      id: "program_growth",
      label: "Program Growth",
      current: overview.programs.participants,
      projected30d: programGrowth,
      projected90d: Math.round(programGrowth * 1.1),
      confidence: healthProj.confidence,
      trend: healthProj.trend,
      unit: "participants",
      insight: `${overview.programs.programsRunning} active programs`,
    },
    {
      id: "donations",
      label: "Donation Trends",
      current: overview.donations.monthly,
      projected30d: donationProj.projected,
      projected90d: linearProject(donationHist.length ? donationHist : [overview.donations.total], 90).projected,
      confidence: donationProj.confidence,
      trend: donationProj.trend,
      unit: "$",
      insight: `${overview.donations.count} donations recorded`,
    },
    {
      id: "org_risk",
      label: "Organizational Risk Index",
      current: (risk as { riskScore?: number }).riskScore ?? 30,
      projected30d: Math.min(100, ((risk as { riskScore?: number }).riskScore ?? 30) + (cashProj.trend === "down" ? 8 : -3)),
      projected90d: Math.min(100, ((risk as { riskScore?: number }).riskScore ?? 30) + (cashProj.trend === "down" ? 15 : -5)),
      confidence: "medium",
      trend: cashProj.trend === "down" ? "up" : "down",
      unit: "score",
      insight: `Risk level: ${(risk as { riskLevel?: string }).riskLevel ?? "low"}`,
    },
  ];

  return {
    models,
    organizationHealth: {
      current: overview.organizationHealth.overall,
      projected30d: healthProj.projected,
      projected90d: linearProject(healthHist.length ? healthHist : [overview.organizationHealth.overall], 90).projected,
      grade: overview.organizationHealth.grade,
    },
    generatedAt: new Date().toISOString(),
  };
}
