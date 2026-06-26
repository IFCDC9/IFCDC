import { getDb } from "../db";
import crypto from "crypto";
import {
  buildSafeAnalyticsOverview,
  buildOrganizationHealthScore,
  buildPredictiveTrends,
  buildKpiMonitoring,
} from "./analyticsReporting";
import { buildExecutiveDashboard } from "./financeReporting";
import { buildGrantExecutiveDashboard } from "./grantReporting";
import { buildOperationsOverview } from "./operationsSchema";
import { buildHeadquartersActivityFeed, generateAuraInsight } from "./analyticsReporting";
import { buildEnterpriseNotifications } from "./enterpriseHub";
import { notifyHqDataChange } from "./hqRealtimeEvents";

function briefingId() {
  return crypto.randomUUID();
}

export async function ensureExecutiveBriefingsTable(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_executive_briefings (
      id TEXT PRIMARY KEY,
      briefing_type TEXT NOT NULL,
      briefing_date TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      highlights TEXT,
      generated_at TEXT NOT NULL,
      UNIQUE(briefing_type, briefing_date)
    );
  `);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function buildDailyExecutiveBriefingContent(): Promise<{
  title: string;
  content: string;
  highlights: string[];
}> {
  const [overview, finance, grants, health, trends, kpis, ops, activity, notifs] = await Promise.all([
    buildSafeAnalyticsOverview(),
    buildExecutiveDashboard(),
    buildGrantExecutiveDashboard(),
    buildOrganizationHealthScore(),
    buildPredictiveTrends(),
    buildKpiMonitoring(),
    buildOperationsOverview().catch(() => null),
    buildHeadquartersActivityFeed(8),
    buildEnterpriseNotifications(),
  ]);

  const criticalKpis = kpis.kpis.filter((k) => k.status === "critical" || k.status === "watch");
  const highlights = [
    `Organization Health: ${health.overall}% (${health.grade})`,
    `Financial Health: ${finance.financialHealthScore}%`,
    `Cash Flow: $${overview.finance.cashFlow.toLocaleString()}`,
    `Grant Pipeline: $${grants.pipelineValue.toLocaleString()} · ${grants.activeAwards} active awards`,
    `${overview.people.employees} employees · ${overview.people.volunteers} volunteers · ${overview.people.hoursThisMonth} hrs this month`,
    `${notifs.unreadCount} leadership alerts unread`,
  ];

  const lines = [
    `# IFCDC Executive Daily Briefing — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`,
    "",
    "## Organization Snapshot",
    `- Health Score: **${health.overall}%** (${health.grade})`,
    `- Financial Health: **${finance.financialHealthScore}%** · Net position $${finance.netPosition.toLocaleString()}`,
    `- Cash flow trend: **${trends.trend}** · Projected $${trends.projectedCashFlow.toLocaleString()}/mo`,
    "",
    "## Financial Intelligence",
    `- Revenue YTD: $${finance.totalRevenue.toLocaleString()} · Donations $${finance.donationsReceived.toLocaleString()}`,
    `- Monthly expenses: $${finance.monthlyExpenses.toLocaleString()} · Payroll $${finance.monthlyPayroll.toLocaleString()}`,
    `- Budget remaining: $${finance.budgetRemaining.toLocaleString()}`,
    "",
    "## Grant Pipeline",
    `- Active awards: ${grants.activeAwards} · Total awarded $${grants.totalAwarded.toLocaleString()}`,
    `- Win rate: ${grants.winRate}% · Compliance due (14d): ${grants.complianceDue}`,
    `- Pipeline value: $${grants.pipelineValue.toLocaleString()}`,
    "",
    "## People & Programs",
    `- ${overview.people.totalPeople} people · ${overview.people.activePayroll} on payroll`,
    `- ${overview.programs.programsRunning} programs · ${overview.programs.participants} participants`,
    `- Volunteer hours this month: ${overview.people.hoursThisMonth}`,
    "",
    "## Operations",
    ops ? `- Fleet: ${ops.fleet.vehicles} vehicles (${ops.fleet.maintenanceDue} service due)` : "",
    ops ? `- Facilities: ${ops.facilities.properties} properties · ${ops.facilities.openWorkOrders} open work orders` : "",
    ops ? `- Compliance risks: ${ops.compliance.openRisks} open (${ops.compliance.highRisks} high)` : "",
    "",
    "## Priority Actions",
    ...criticalKpis.slice(0, 5).map((k) => `- [${k.status.toUpperCase()}] ${k.label}: ${k.value}${k.unit}`),
    grants.complianceDue > 0 ? `- Review ${grants.complianceDue} grant compliance items due within 14 days` : "- Grant compliance current",
    finance.cashFlow < 0 ? "- Cash flow negative — review expenses and grant pipeline" : "- Cash flow stable",
    "",
    "## Recent Activity",
    ...activity.slice(0, 5).map((a) => `- ${a.title}: ${a.detail}`),
    "",
    "## AURA Insight",
    generateAuraInsight(overview),
  ].filter(Boolean);

  return {
    title: `Daily Executive Briefing — ${todayKey()}`,
    content: lines.join("\n"),
    highlights,
  };
}

export async function getOrGenerateDailyBriefing(force = false) {
  await ensureExecutiveBriefingsTable();
  const db = await getDb();
  const date = todayKey();

  if (!force) {
    const existing = await db.get<{ id: string; title: string; content: string; highlights: string; generated_at: string }>(
      "SELECT * FROM hq_executive_briefings WHERE briefing_type = 'daily' AND briefing_date = ?", date
    );
    if (existing) {
      return {
        id: existing.id,
        type: "daily",
        date,
        title: existing.title,
        content: existing.content,
        highlights: JSON.parse(existing.highlights || "[]") as string[],
        generatedAt: existing.generated_at,
        cached: true,
      };
    }
  }

  const briefing = await buildDailyExecutiveBriefingContent();
  const id = briefingId();
  const now = new Date().toISOString();

  await db.run(
    `INSERT OR REPLACE INTO hq_executive_briefings (id, briefing_type, briefing_date, title, content, highlights, generated_at)
     VALUES (?, 'daily', ?, ?, ?, ?, ?)`,
    id, date, briefing.title, briefing.content, JSON.stringify(briefing.highlights), now
  );
  notifyHqDataChange("analytics");

  return {
    id,
    type: "daily",
    date,
    title: briefing.title,
    content: briefing.content,
    highlights: briefing.highlights,
    generatedAt: now,
    cached: false,
  };
}

export async function buildExecutiveCommandCenter() {
  const [overview, finance, grants, health, trends, briefing, kpis, ops, notifs] = await Promise.all([
    buildSafeAnalyticsOverview(),
    buildExecutiveDashboard(),
    buildGrantExecutiveDashboard(),
    buildOrganizationHealthScore(),
    buildPredictiveTrends(),
    getOrGenerateDailyBriefing(),
    buildKpiMonitoring(),
    buildOperationsOverview().catch(() => null),
    buildEnterpriseNotifications(),
  ]);

  return {
    timestamp: new Date().toISOString(),
    organizationHealth: health,
    financialHealth: {
      score: finance.financialHealthScore,
      factors: finance.healthFactors,
      cashFlow: finance.cashFlow,
      netPosition: finance.netPosition,
      budgetRemaining: finance.budgetRemaining,
    },
    grantPipeline: {
      activeAwards: grants.activeAwards,
      totalAwarded: grants.totalAwarded,
      pipelineValue: grants.pipelineValue,
      winRate: grants.winRate,
      complianceDue: grants.complianceDue,
    },
    people: overview.people,
    programs: overview.programs,
    trends: {
      trend: trends.trend,
      projectedCashFlow: trends.projectedCashFlow,
      forecast: trends.forecast,
    },
    kpis: kpis.kpis,
    operations: ops,
    notifications: { unreadCount: notifs.unreadCount },
    dailyBriefing: briefing,
    auraInsight: generateAuraInsight(overview),
  };
}
