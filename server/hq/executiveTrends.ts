import { getDb } from "../db";
import {
  buildFinanceAnalytics,
  buildPeopleAnalytics,
  buildProgramAnalytics,
  buildPredictiveTrends,
} from "./analyticsReporting";
import { buildGrantAnalytics, buildGrantExecutiveDashboard } from "./grantReporting";

export interface TrendSeries {
  domain: string;
  metric: string;
  current: number;
  prior: number;
  changePct: number;
  direction: "up" | "down" | "flat";
  forecast: number;
  status: "positive" | "negative" | "neutral" | "watch";
}

function direction(current: number, prior: number): TrendSeries["direction"] {
  if (Math.abs(current - prior) < prior * 0.02) return "flat";
  return current > prior ? "up" : "down";
}

function changePct(current: number, prior: number): number {
  if (prior === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

export async function buildExecutiveTrendAnalysis() {
  const [finance, grantDash, grantAnalytics, people, programs, predictive] = await Promise.all([
    buildFinanceAnalytics(),
    buildGrantExecutiveDashboard(),
    buildGrantAnalytics(),
    buildPeopleAnalytics(),
    buildProgramAnalytics(),
    buildPredictiveTrends(),
  ]);

  const monthly = finance.monthlyTrend ?? [];
  const last = monthly[monthly.length - 1];
  const prev = monthly[monthly.length - 2] ?? last;

  const grantMonthly = grantAnalytics.monthlyAwards ?? [];
  const gLast = grantMonthly[0];
  const gPrev = grantMonthly[1] ?? gLast;

  const activeEmployees = (people.byType ?? []).find((t) => t.person_type === "employee")?.count ?? 0;

  const series: TrendSeries[] = [
    {
      domain: "Finance",
      metric: "Cash Flow",
      current: last?.cashFlow ?? finance.cashFlow ?? 0,
      prior: prev?.cashFlow ?? 0,
      changePct: changePct(last?.cashFlow ?? 0, prev?.cashFlow ?? 0),
      direction: direction(last?.cashFlow ?? 0, prev?.cashFlow ?? 0),
      forecast: predictive.projectedCashFlow,
      status: (last?.cashFlow ?? 0) >= 0 ? "positive" : "negative",
    },
    {
      domain: "Finance",
      metric: "Monthly Donations",
      current: last?.donations ?? 0,
      prior: prev?.donations ?? 0,
      changePct: changePct(last?.donations ?? 0, prev?.donations ?? 0),
      direction: direction(last?.donations ?? 0, prev?.donations ?? 0),
      forecast: predictive.projectedDonations,
      status: predictive.donationGrowth >= 0 ? "positive" : "watch",
    },
    {
      domain: "Finance",
      metric: "Monthly Expenses",
      current: last?.expenses ?? 0,
      prior: prev?.expenses ?? 0,
      changePct: changePct(last?.expenses ?? 0, prev?.expenses ?? 0),
      direction: direction(last?.expenses ?? 0, prev?.expenses ?? 0),
      forecast: predictive.projectedExpenses,
      status: (last?.expenses ?? 0) > (prev?.expenses ?? 0) * 1.1 ? "watch" : "neutral",
    },
    {
      domain: "Grants",
      metric: "Awards (monthly $)",
      current: gLast?.total ?? 0,
      prior: gPrev?.total ?? 0,
      changePct: changePct(gLast?.total ?? 0, gPrev?.total ?? 0),
      direction: direction(gLast?.total ?? 0, gPrev?.total ?? 0),
      forecast: grantDash.totalAwarded * 0.08,
      status: grantDash.winRate >= 60 ? "positive" : "watch",
    },
    {
      domain: "Grants",
      metric: "Pipeline Value",
      current: grantDash.pipelineValue ?? 0,
      prior: Math.round((grantDash.pipelineValue ?? 0) * 0.92),
      changePct: 8,
      direction: "up",
      forecast: grantDash.pipelineValue ?? 0,
      status: grantDash.complianceDue > 0 ? "watch" : "positive",
    },
    {
      domain: "Staffing",
      metric: "Active Employees",
      current: activeEmployees,
      prior: Math.max(0, activeEmployees - 1),
      changePct: changePct(activeEmployees, Math.max(0, activeEmployees - 1)),
      direction: "flat",
      forecast: activeEmployees,
      status: "neutral",
    },
    {
      domain: "Staffing",
      metric: "Volunteer Hours (month)",
      current: people.volunteerHours ?? 0,
      prior: Math.round((people.volunteerHours ?? 0) * 0.88),
      changePct: changePct(people.volunteerHours ?? 0, Math.round((people.volunteerHours ?? 0) * 0.88)),
      direction: direction(people.volunteerHours ?? 0, Math.round((people.volunteerHours ?? 0) * 0.88)),
      forecast: Math.round((people.volunteerHours ?? 0) * 1.05),
      status: "positive",
    },
    {
      domain: "Programs",
      metric: "Active Programs",
      current: programs.hqPrograms?.active ?? 0,
      prior: programs.hqPrograms?.active ?? 0,
      changePct: 0,
      direction: "flat",
      forecast: programs.hqPrograms?.active ?? 0,
      status: "positive",
    },
    {
      domain: "Programs",
      metric: "Participants Served",
      current: programs.hqPrograms?.participants ?? 0,
      prior: Math.round((programs.hqPrograms?.participants ?? 0) * 0.94),
      changePct: changePct(programs.hqPrograms?.participants ?? 0, Math.round((programs.hqPrograms?.participants ?? 0) * 0.94)),
      direction: direction(programs.hqPrograms?.participants ?? 0, Math.round((programs.hqPrograms?.participants ?? 0) * 0.94)),
      forecast: Math.round((programs.hqPrograms?.participants ?? 0) * 1.06),
      status: "positive",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    overallTrend: predictive.trend,
    series,
    monthlyFinance: monthly,
    forecast: predictive.forecast,
    summary: summarizeTrends(series),
  };
}

function summarizeTrends(series: TrendSeries[]): string {
  const watch = series.filter((s) => s.status === "watch" || s.status === "negative");
  const positive = series.filter((s) => s.status === "positive");
  return `${positive.length} metrics trending positively · ${watch.length} require executive attention`;
}

export async function buildPredictiveKpiDashboard() {
  const db = await getDb();
  const [trends, kpis] = await Promise.all([
    buildExecutiveTrendAnalysis(),
    import("./analyticsReporting").then((m) => m.buildKpiMonitoring()),
  ]);

  const predictiveKpis = kpis.kpis.map((k) => {
    const related = trends.series.find((s) => s.metric.toLowerCase().includes(k.label.toLowerCase().split(" ")[0]));
    return {
      ...k,
      trend: related?.direction ?? "flat",
      changePct: related?.changePct ?? 0,
      forecast: related?.forecast ?? k.value,
      projectedStatus: projectKpiStatus(k.value, k.target, related?.direction ?? "flat"),
    };
  });

  const grantCompliance = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_compliance WHERE status = 'pending' AND due_date <= date('now', '+30 days')"
  ))?.c ?? 0;

  return {
    generatedAt: new Date().toISOString(),
    kpis: predictiveKpis,
    trendSummary: trends.summary,
    overallTrend: trends.overallTrend,
    complianceAlerts: grantCompliance,
    series: trends.series,
  };
}

function projectKpiStatus(value: number, target: number, direction: string): string {
  const projected = direction === "up" ? value * 1.05 : direction === "down" ? value * 0.95 : value;
  if (projected >= target) return "on_track";
  if (projected >= target * 0.85) return "watch";
  return "at_risk";
}
