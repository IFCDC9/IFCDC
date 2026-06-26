import { getWarehouseOverview } from "./analyticsWarehouse";
import { buildApprovalQueue } from "./enterpriseApprovals";
import { buildEnterpriseNotifications } from "./enterpriseHub";
import { trackComplianceDeadlines } from "./auraExecutiveOps";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import { auraExecutiveChat } from "../lib/ifcdc";
import { getQuickBooksSyncSummary } from "./quickbooksOAuth";
import { getBackupHealth } from "./hqBackupService";
import { getThreatMonitor } from "./hqSecuritySessions";

export async function buildOperationsCopilotContext(): Promise<string> {
  const [warehouse, compliance, approvals, notifications, qb, backup, threats] = await Promise.all([
    getWarehouseOverview().catch(() => null),
    trackComplianceDeadlines().catch(() => null),
    buildApprovalQueue(10).catch(() => ({ tasks: [], counts: {} })),
    buildEnterpriseNotifications().catch(() => ({ notifications: [], unreadCount: 0 })),
    getQuickBooksSyncSummary().catch(() => null),
    getBackupHealth().catch(() => null),
    getThreatMonitor().catch(() => null),
  ]);

  const lines = [
    "# IFCDC Operations Copilot Context",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Organization",
    warehouse ? `Health: ${warehouse.organizationHealth}% | Cash flow: $${warehouse.finance?.cashFlow?.toLocaleString() ?? 0}` : "",
    warehouse ? `Grants: ${warehouse.grants?.activeAwards ?? 0} active | Pipeline: $${warehouse.grants?.pipelineValue?.toLocaleString() ?? 0}` : "",
    "",
    "## Pending Work",
    `Approvals: ${(approvals as { counts?: { total?: number } }).counts?.total ?? 0}`,
    `Notifications: ${(notifications as { unreadCount?: number }).unreadCount ?? 0} unread`,
    "",
    "## Compliance",
    compliance ? `Deadlines tracked: ${((compliance as { deadlines?: unknown[] }).deadlines?.length ?? 0)}` : "",
    "",
    "## Integrations",
    qb ? `QuickBooks: ${(qb as { connection?: { connected?: boolean } }).connection?.connected ? "connected" : "not connected"}` : "",
    backup ? `Backup health: ${(backup as { status?: string }).status}` : "",
    threats ? `Failed logins (24h): ${(threats as { failedLogins24h?: number }).failedLogins24h ?? 0}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export async function askOperationsCopilot(question: string, moduleHint?: string) {
  const [opsContext, moduleContext] = await Promise.all([
    buildOperationsCopilotContext(),
    buildAuraExecutiveContext().catch(() => ""),
  ]);

  const prompt = [
    "You are AURA, IFCDC Headquarters operations copilot. Assist across finance, grants, HR, programs, security, and workflows.",
    "Be actionable. Reference real numbers. Suggest next steps by priority.",
    moduleHint ? `Focus module: ${moduleHint}` : "",
    "",
    opsContext,
    moduleContext ? `\n## Module Context\n${moduleContext.slice(0, 2500)}` : "",
    "",
    `Question: ${question}`,
  ].join("\n");

  try {
    const answer = await auraExecutiveChat(prompt);
    return {
      answer,
      modules: ["finance", "grants", "people", "security", "workflows", "integrations"],
      generatedAt: new Date().toISOString(),
    };
  } catch {
    const warehouse = await getWarehouseOverview();
    return {
      answer: `Operations snapshot: Organization health ${warehouse.organizationHealth}%. ` +
        `Cash flow $${warehouse.finance?.cashFlow?.toLocaleString() ?? 0}. ` +
        `${warehouse.grants?.activeAwards ?? 0} active grants, ${warehouse.grants?.complianceDue ?? 0} compliance items due. ` +
        `Review pending approvals in Workflow Automation and Security Center for login activity.`,
      modules: ["fallback"],
      generatedAt: new Date().toISOString(),
    };
  }
}

export async function getOperationsCopilotBriefing() {
  const [warehouse, compliance, threats, backup] = await Promise.all([
    getWarehouseOverview(),
    trackComplianceDeadlines().catch(() => ({ overdue: 0, dueNext14Days: 0, deadlines: [] })),
    getThreatMonitor(),
    getBackupHealth(),
  ]);

  return {
    title: "AURA Operations Briefing",
    priorities: [
      ...(warehouse.grants?.complianceDue ? [`${warehouse.grants.complianceDue} grant compliance reports due`] : []),
      ...((compliance as { overdue?: number }).overdue ? [`${(compliance as { overdue: number }).overdue} overdue compliance deadlines`] : []),
      ...(threats.failedLogins24h > 5 ? [`${threats.failedLogins24h} failed logins in 24h — review Security Center`] : []),
      ...(backup.status !== "healthy" ? ["Database backup needs attention"] : []),
      "Review Executive Dashboard KPIs and grant pipeline",
    ].slice(0, 6),
    metrics: {
      organizationHealth: warehouse.organizationHealth,
      cashFlow: warehouse.finance?.cashFlow,
      activeGrants: warehouse.grants?.activeAwards,
      backupStatus: backup.status,
      securityThreats: threats.threats.length,
    },
    generatedAt: new Date().toISOString(),
  };
}
