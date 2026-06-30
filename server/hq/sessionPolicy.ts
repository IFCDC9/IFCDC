import { getDb } from "../db";
import { revokeSession } from "./hqSecuritySessions";

export const SESSION_POLICY = {
  maxAgeDays: Number(process.env.IFCDC_SESSION_MAX_DAYS || "30"),
  maxConcurrentSessions: Number(process.env.IFCDC_MAX_CONCURRENT_SESSIONS || "5"),
  rotateOnLogin: process.env.IFCDC_SESSION_ROTATE_ON_LOGIN !== "false",
} as const;

export function getSessionPolicyReport() {
  return {
    ...SESSION_POLICY,
    cookieName: "ifcdc_token",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
    description: "Enterprise session policy for IFCDC Headquarters",
    timestamp: new Date().toISOString(),
  };
}

/** Enforce concurrent session limits and rotation after successful authentication. */
export async function enforceSessionPolicyOnLogin(userId: string, currentSessionId?: string): Promise<void> {
  const db = await getDb();
  const sessions = (await db.all(
    `SELECT id FROM hq_active_sessions WHERE user_id = ? AND revoked = 0 ORDER BY last_seen_at DESC`,
    userId,
  )) as { id: string }[];

  if (!SESSION_POLICY.rotateOnLogin) return;

  const overflow = sessions.length - SESSION_POLICY.maxConcurrentSessions + 1;
  if (overflow <= 0) return;

  const toRevoke = sessions
    .filter((s) => s.id !== currentSessionId)
    .slice(Math.max(0, sessions.length - overflow));

  for (const session of toRevoke) {
    await revokeSession(session.id, "session_policy_rotation");
  }
}

export async function validateAuditLoggingHealth(): Promise<{
  healthy: boolean;
  auditLogCount: number;
  hqAuditCount: number;
  lastAuditAt: string | null;
  lastHqAuditAt: string | null;
  issues: string[];
}> {
  const db = await getDb();
  const issues: string[] = [];

  const auditCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM audit_logs"))?.c ?? 0;
  const hqAuditCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_audit_log"))?.c ?? 0;
  const lastAudit = (await db.get<{ ts: string }>("SELECT timestamp as ts FROM audit_logs ORDER BY timestamp DESC LIMIT 1"))?.ts ?? null;
  const lastHq = (await db.get<{ ts: string }>("SELECT created_at as ts FROM hq_audit_log ORDER BY created_at DESC LIMIT 1"))?.ts ?? null;

  if (auditCount === 0 && hqAuditCount === 0) {
    issues.push("No audit records found — verify audit tables are writable");
  }

  return {
    healthy: issues.length === 0,
    auditLogCount: auditCount,
    hqAuditCount,
    lastAuditAt: lastAudit,
    lastHqAuditAt: lastHq,
    issues,
  };
}

export async function buildMfaComplianceReport() {
  const db = await getDb();
  const accounts = (await db.all(
    `SELECT email, role, twofa_enabled, status FROM users WHERE role IN (
      'owner','founder','admin','administrator','exec','EXEC','executive','executive_director','finance','grant_manager'
    ) ORDER BY role, email`,
  )) as { email: string; role: string; twofa_enabled: number; status: string }[];

  const requiring = accounts.filter((a) => a.status === "active");
  const compliant = requiring.filter((a) => a.twofa_enabled === 1);
  const nonCompliant = requiring.filter((a) => !a.twofa_enabled);

  return {
    compliancePct: requiring.length ? Math.round((compliant.length / requiring.length) * 100) : 100,
    totalPrivileged: requiring.length,
    compliantCount: compliant.length,
    nonCompliantAccounts: nonCompliant.map((a) => ({ email: a.email, role: a.role })),
    policy: "MFA required for Founder, Executive, Finance, Grant Manager, and Administrator roles",
    generatedAt: new Date().toISOString(),
  };
}
