import { getDb } from "../db";
import { buildAuditSummary, queryHqAudit } from "./hqAuditLog";
import { HQ_MODULE_PERMISSIONS } from "./enterpriseRoles";
import { listRegisteredApps } from "./softwareDivisionSchema";
import { getIntegrationsHub } from "./integrationConnectors";
import { listWorkflowInstances } from "./workflowEngine";
import { getBackupHealth } from "./hqBackupService";
import {
  getMfaStatusSummary,
  getLoginHistory,
  getActiveSessions,
  getKnownDevices,
  getThreatMonitor,
} from "./hqSecuritySessions";
import { getQuickBooksConnection } from "./quickbooksOAuth";

export async function buildSecurityDashboard() {
  const [audit, apps, integrations, pendingWorkflows, backup, mfa, threats, qb] = await Promise.all([
    buildAuditSummary(),
    listRegisteredApps().catch(() => []),
    getIntegrationsHub().catch(() => ({ connectedCount: 0, catalog: [] })),
    listWorkflowInstances({ status: "pending", limit: 5 }).catch(() => []),
    getBackupHealth(),
    getMfaStatusSummary(),
    getThreatMonitor(),
    getQuickBooksConnection().catch(() => ({ connected: false })),
  ]);

  const db = await getDb();
  const activeUsers = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM users WHERE role IS NOT NULL"
  ))?.c ?? 0;

  const sessions = await getActiveSessions(20).catch(() => []);

  const mfaReadiness = {
    enabled: mfa.mfaEnabledCount > 0,
    status: mfa.compliancePct >= 100 ? "compliant" : mfa.compliancePct >= 50 ? "partial" : "action_required",
    message: mfa.compliancePct >= 100
      ? "All privileged accounts have MFA enabled"
      : `${mfa.mfaEnabledCount}/${mfa.privilegedAccountCount} privileged accounts have MFA — enable in Security Center`,
    supportedMethods: ["totp"],
    compliancePct: mfa.compliancePct,
    privilegedAccountCount: mfa.privilegedAccountCount,
    mfaEnabledCount: mfa.mfaEnabledCount,
  };

  const rbacSummary = Object.entries(HQ_MODULE_PERMISSIONS).map(([module, roles]) => ({
    module,
    roleCount: roles.length,
    roles,
  }));

  const securityScore = calculateSecurityScore({
    auditLast24h: audit.last24h,
    registeredApps: apps.length,
    connectedIntegrations: integrations.connectedCount,
    activeUsers,
    mfaCompliancePct: mfa.compliancePct,
    backupStatus: backup.status,
    failedLogins24h: threats.failedLogins24h,
  });

  return {
    securityScore,
    mfa: mfaReadiness,
    mfaAccounts: mfa.accounts,
    sessions: {
      activeUsers,
      activeSessionCount: sessions.length,
      ssoEnabled: true,
      cookieAuth: true,
      apiKeyApps: apps.filter((a) => a.status === "active").length,
    },
    audit,
    rbac: { modules: rbacSummary.length, summary: rbacSummary.slice(0, 8) },
    registeredApps: apps.map((a) => ({ id: a.id, name: a.name, status: a.status })),
    integrations: {
      connected: integrations.connectedCount,
      total: integrations.catalog?.length ?? 0,
      quickBooks: qb,
    },
    threats,
    pendingSecurityReviews: pendingWorkflows.length,
    recommendations: buildSecurityRecommendations(securityScore, audit.last24h, mfa.compliancePct, backup.status),
    backup,
    timestamp: new Date().toISOString(),
  };
}

function calculateSecurityScore(opts: {
  auditLast24h: number;
  registeredApps: number;
  connectedIntegrations: number;
  activeUsers: number;
  mfaCompliancePct: number;
  backupStatus: string;
  failedLogins24h: number;
}): number {
  let score = 65;
  if (opts.auditLast24h > 0) score += 8;
  if (opts.registeredApps > 0) score += 4;
  if (opts.connectedIntegrations > 0) score += 3;
  if (opts.mfaCompliancePct >= 100) score += 10;
  else if (opts.mfaCompliancePct >= 50) score += 5;
  if (opts.backupStatus === "healthy") score += 7;
  else if (opts.backupStatus === "warning") score += 3;
  if (opts.failedLogins24h > 10) score -= 5;
  return Math.max(50, Math.min(98, score));
}

function buildSecurityRecommendations(
  score: number,
  auditActivity: number,
  mfaPct: number,
  backupStatus: string
): string[] {
  const recs: string[] = [];
  if (mfaPct < 100) recs.push("Enable MFA for all Founder, Executive, and Administrator accounts");
  if (backupStatus !== "healthy") recs.push("Run database backup — scheduled job or manual snapshot in Security Center");
  if (score < 80) recs.push("Review threat monitor for suspicious login activity");
  if (auditActivity === 0) recs.push("Audit logging is quiet — verify mutation hooks are active");
  recs.push("Rotate registered app API keys quarterly");
  recs.push("Connect QuickBooks OAuth for automated financial sync");
  return recs;
}

export async function getActivityMonitor(limit = 50) {
  return queryHqAudit({ limit, since: new Date(Date.now() - 7 * 86400000).toISOString() });
}

export { getLoginHistory, getActiveSessions, getKnownDevices, getThreatMonitor };
