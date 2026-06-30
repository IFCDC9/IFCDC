import { getDb } from "../db";
import {
  buildAnalyticsOverview,
  buildOrganizationHealthScore,
  buildPredictiveTrends,
  buildPayrollAnalytics,
  buildProgramAnalytics,
} from "./analyticsReporting";
import { buildOperationsOverview } from "./operationsSchema";
import { getOrganizationMetrics } from "./metrics";
import { pollAllApps } from "./appRegistry";
import { listLeadershipAlerts } from "./criticalAlerts";
import { buildWorkforceExecutiveIntelligence } from "./peopleOperationsEngine";
import { buildClientCaseOverview } from "./clientCaseEngine";

let contextCache: { text: string; expires: number } | null = null;
const CONTEXT_CACHE_TTL_MS = 2 * 60 * 1000;

export async function buildAuraExecutiveContext(extra?: string): Promise<string> {
  const now = Date.now();
  if (!extra && contextCache && contextCache.expires > now) {
    return contextCache.text;
  }
  const [overview, ops, health, trends, metrics, apps, payroll, programs, alerts, workforce, clients] = await Promise.all([
    buildAnalyticsOverview().catch(() => null),
    buildOperationsOverview().catch(() => null),
    buildOrganizationHealthScore().catch(() => null),
    buildPredictiveTrends().catch(() => null),
    getOrganizationMetrics(),
    pollAllApps(),
    buildPayrollAnalytics().catch(() => null),
    buildProgramAnalytics().catch(() => null),
    listLeadershipAlerts(8).catch(() => []),
    buildWorkforceExecutiveIntelligence().catch(() => null),
    buildClientCaseOverview().catch(() => null),
  ]);

  const db = await getDb();
  let budgets: { name: string; allocated: number; spent: number; category: string }[] = [];
  let documents: { title: string; category: string }[] = [];
  try {
    budgets = (await db.all(
      "SELECT name, allocated, spent, category FROM finance_budgets ORDER BY allocated DESC LIMIT 12"
    )) as typeof budgets;
    documents = (await db.all(
      "SELECT title, category FROM hq_documents ORDER BY updated_at DESC LIMIT 10"
    )) as typeof documents;
  } catch { /* tables */ }

  const lines = [
    extra,
    "=== IFCDC HEADQUARTERS EXECUTIVE CONTEXT ===",
    `Organization Health: ${health?.overall ?? "N/A"}% (${health?.grade ?? "unknown"})`,
    health?.factors?.map((f) => `- ${f.label}: ${f.score}%`).join("\n"),
    "",
    "People & HR:",
    `- Total people: ${overview?.people.totalPeople ?? metrics.totalEmployees}`,
    `- Employees: ${overview?.people.employees ?? metrics.activeEmployees}`,
    `- Volunteers: ${overview?.people.volunteers ?? metrics.activeVolunteers}`,
    `- Payroll active: ${overview?.people.activePayroll ?? 0}`,
    `- Hours this month: ${overview?.people.hoursThisMonth ?? 0}`,
    workforce ? `- HR compliance score: ${(workforce as { hrComplianceScore?: { score: number; grade: string } }).hrComplianceScore?.score ?? "N/A"} (${(workforce as { hrComplianceScore?: { grade: string } }).hrComplianceScore?.grade ?? "—"})` : "",
    workforce ? `- Open applicants: ${(workforce as { hiringPipeline?: { open: number } }).hiringPipeline?.open ?? 0}` : "",
    workforce ? `- Monthly labor forecast: $${((workforce as { payrollForecast?: { monthlyLabor: number } }).payrollForecast?.monthlyLabor ?? 0).toLocaleString()}` : "",
    workforce ? `- 6-month staffing forecast: ${(workforce as { staffingForecast?: { forecast?: { projectedHeadcount: number }[] } }).staffingForecast?.forecast?.[5]?.projectedHeadcount ?? (workforce as { staffingForecast?: { currentHeadcount: number } }).staffingForecast?.currentHeadcount ?? "N/A"} staff` : "",
    "",
    "Client & Case Management:",
    clients ? `- Total clients: ${clients.totalClients}` : "",
    clients ? `- Active caseload assignments: ${clients.activeAssignments}` : "",
    clients ? `- Open goals: ${clients.openGoals}` : "",
    clients ? `- Encounters (30d): ${clients.encounters30d}` : "",
    clients ? `- Upcoming appointments (14d): ${clients.upcomingAppointments}` : "",
    clients ? `- High-risk clients: ${clients.highRiskClients}` : "",
    "",
    "Finance:",
    `- Total revenue: $${(overview?.finance.totalRevenue ?? 0).toLocaleString()}`,
    `- Cash flow: $${(overview?.finance.cashFlow ?? 0).toLocaleString()}`,
    `- Net position: $${(overview?.finance.netPosition ?? 0).toLocaleString()}`,
    `- Monthly expenses: $${(overview?.finance.monthlyExpenses ?? 0).toLocaleString()}`,
    `- Donations: $${(overview?.donations.total ?? metrics.donationRevenue).toLocaleString()}`,
    budgets.length ? "\nBudget Lines:\n" + budgets.map((b) =>
      `- ${b.name} (${b.category}): $${b.spent.toLocaleString()} / $${b.allocated.toLocaleString()}`
    ).join("\n") : "",
    "",
    "Payroll:",
    payroll ? `- Recent runs: ${payroll.totalRuns}` : "",
    payroll?.monthlyPayroll?.[0] ? `- Latest period net: $${payroll.monthlyPayroll[0].net.toLocaleString()}` : "",
    payroll ? `- Grant labor allocated: $${payroll.totalLaborGrant.toLocaleString()}` : "",
    "",
    "Grants:",
    `- Active awards: ${overview?.grants.activeAwards ?? metrics.activeGrants}`,
    `- Total awarded: $${(overview?.grants.totalAwarded ?? 0).toLocaleString()}`,
    `- Win rate: ${overview?.grants.winRate ?? 0}%`,
    `- Compliance due (14 days): ${overview?.grants.complianceDue ?? 0}`,
    `- Pipeline value: $${(overview?.grants.pipelineValue ?? 0).toLocaleString()}`,
    "",
    "Programs:",
    programs ? `- Active programs: ${programs.hqPrograms?.active ?? overview?.programs.programsRunning ?? 0}` : "",
    programs ? `- Program participants: ${programs.hqPrograms?.participants ?? overview?.programs.participants ?? 0}` : "",
    programs?.programModules?.length ? programs.programModules.map((p) =>
      `- ${p.name}: ${p.participants} participants, budget ${p.budgetAllocated > 0 ? Math.round((p.budgetSpent / p.budgetAllocated) * 100) : 0}% used`
    ).join("\n") : "",
    programs ? `- Community impact hours: ${programs.communityImpact?.volunteerHours ?? 0}` : "",
    "",
    "Operations:",
    ops ? `- Housing: ${ops.housing.units} units, ${ops.housing.placements} placements, ${ops.housing.applications} applications` : "",
    ops ? `- Scholarships: ${ops.scholarships.programs} programs, ${ops.scholarships.applications} applications` : "",
    ops ? `- Open compliance risks: ${ops.compliance.openRisks} (${ops.compliance.highRisks} high)` : "",
    ops ? `- Upcoming events: ${ops.calendar.upcomingEvents}, board meetings: ${ops.board.upcomingMeetings}` : "",
    "",
    "Leadership Alerts:",
    alerts.length ? alerts.map((a) => `- [${a.priority}] ${a.title}: ${a.message}`).join("\n") : "- No critical alerts",
    "",
    "Document Vault (recent):",
    documents.length ? documents.map((d) => `- ${d.title} (${d.category})`).join("\n") : "- No documents indexed",
    "",
    "Predictive Outlook:",
    trends ? `- Trend: ${trends.trend}` : "",
    trends ? `- Projected cash flow: $${trends.projectedCashFlow.toLocaleString()}` : "",
    trends ? `- Donation growth: ${trends.donationGrowth}%` : "",
    "",
    "Software Division:",
    `- Apps online: ${apps.filter((a) => a.healthy).length}/${apps.length}`,
    apps.filter((a) => !a.healthy).map((a) => `- OFFLINE: ${a.id}`).join("\n"),
    "=== END CONTEXT ===",
  ].filter(Boolean);

  const text = lines.join("\n");
  if (!extra) {
    contextCache = { text, expires: Date.now() + CONTEXT_CACHE_TTL_MS };
  }
  return text;
}
