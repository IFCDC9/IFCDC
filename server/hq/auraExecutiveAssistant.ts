import { getWarehouseOverview } from "./analyticsWarehouse";
import { buildOrganizationHealthScore } from "./analyticsReporting";
import { buildApprovalQueue } from "./enterpriseApprovals";
import { trackComplianceDeadlines, detectOperationalAnomalies, predictFinancialRisk } from "./auraExecutiveOps";
import { buildEnterpriseDataContext, answerEnterpriseQuestion, generateEnterpriseBoardReport } from "./auraEnterpriseIntelligence";
import { getThreatMonitor } from "./hqSecuritySessions";
import { getBackupHealth } from "./hqBackupService";
import { buildFunderCrmDashboard } from "./grantFunderCrm";
import { auraExecutiveChat } from "../lib/ifcdc";

export async function buildExecutiveHealthSummary() {
  const [warehouse, health, compliance, anomalies, risk, threats, backup, approvals, funders] = await Promise.all([
    getWarehouseOverview(),
    buildOrganizationHealthScore().catch(() => null),
    trackComplianceDeadlines().catch(() => ({ overdue: 0, dueNext14Days: 0, deadlines: [] })),
    detectOperationalAnomalies().catch(() => ({ anomalies: [] })),
    predictFinancialRisk().catch(() => ({ riskLevel: "unknown", riskScore: 0, recommendations: [] })),
    getThreatMonitor().catch(() => ({ threats: [], failedLogins24h: 0 })),
    getBackupHealth().catch(() => ({ status: "unknown" })),
    buildApprovalQueue(10).catch(() => ({ tasks: [], counts: { total: 0 } })),
    buildFunderCrmDashboard().catch(() => ({ totalFunders: 0, activePartners: 0 })),
  ]);

  const risks: { level: "high" | "medium" | "low"; area: string; detail: string }[] = [];

  if ((compliance as { overdue?: number }).overdue) {
    risks.push({ level: "high", area: "Compliance", detail: `${(compliance as { overdue: number }).overdue} overdue deadlines` });
  }
  if ((risk as { riskLevel?: string }).riskLevel === "high") {
    risks.push({ level: "high", area: "Finance", detail: "Financial risk elevated — review cash flow and reserves" });
  }
  if (((threats as { failedLogins24h?: number }).failedLogins24h ?? 0) > 5) {
    risks.push({ level: "medium", area: "Security", detail: `${(threats as { failedLogins24h: number }).failedLogins24h} failed logins in 24h` });
  }
  if ((backup as { status?: string }).status !== "healthy") {
    risks.push({ level: "medium", area: "Operations", detail: "Database backup needs attention" });
  }
  if ((approvals as { counts?: { total?: number } }).counts?.total) {
    risks.push({ level: "low", area: "Workflows", detail: `${(approvals as { counts: { total: number } }).counts.total} items awaiting approval` });
  }

  const recommendations = [
    ...(warehouse.grants?.complianceDue ? [`Complete ${warehouse.grants.complianceDue} grant compliance reports`] : []),
    ...((risk as { recommendations?: string[] }).recommendations ?? []).slice(0, 3),
    "Review Executive Intelligence Center KPI trends weekly",
    "Schedule board report generation before next governance meeting",
  ].slice(0, 6);

  return {
    organizationHealth: health?.overall ?? warehouse.organizationHealth,
    grade: health?.grade ?? warehouse.grade,
    modules: {
      finance: warehouse.finance,
      grants: warehouse.grants,
      programs: warehouse.programs,
      people: warehouse.people,
      donations: warehouse.donations,
    },
    risks,
    riskScore: (risk as { riskScore?: number }).riskScore ?? 0,
    anomalies: (anomalies as { anomalies?: unknown[] }).anomalies?.length ?? 0,
    funderPartners: (funders as { activePartners?: number }).activePartners ?? 0,
    pendingApprovals: (approvals as { counts?: { total?: number } }).counts?.total ?? 0,
    recommendations,
    timestamp: new Date().toISOString(),
  };
}

export async function generateExecutiveActionPlan() {
  const summary = await buildExecutiveHealthSummary();
  const context = await buildEnterpriseDataContext();

  const prompt = [
    "You are AURA, IFCDC's executive AI. Based on the data below, produce a prioritized action plan for leadership.",
    "Format: numbered priorities with owner (Executive/Grants/Finance/HR) and deadline suggestion.",
    "",
    context,
    "",
    `Current risks: ${JSON.stringify(summary.risks)}`,
    `Recommendations seed: ${summary.recommendations.join("; ")}`,
  ].join("\n");

  try {
    const plan = await auraExecutiveChat(prompt);
    return { plan, summary, generatedAt: new Date().toISOString() };
  } catch {
    return {
      plan: summary.recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n"),
      summary,
      generatedAt: new Date().toISOString(),
    };
  }
}

export { answerEnterpriseQuestion, generateEnterpriseBoardReport, buildEnterpriseDataContext };
