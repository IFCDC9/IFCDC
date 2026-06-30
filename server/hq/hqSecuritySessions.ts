import crypto from "crypto";
import { getDb } from "../db";

const MFA_ROLES = new Set([
  "owner",
  "founder",
  "admin",
  "administrator",
  "exec",
  "executive",
  "executive_director",
  "finance",
  "grant_manager",
]);

export function roleRequiresMfa(role: string): boolean {
  return MFA_ROLES.has(role.toLowerCase());
}

function parseDeviceLabel(userAgent?: string): string {
  if (!userAgent) return "Unknown device";
  const ua = userAgent.toLowerCase();
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("android")) return "Android";
  if (ua.includes("mac")) return "Mac";
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("linux")) return "Linux";
  if (ua.includes("curl")) return "API Client";
  return "Web Browser";
}

export async function ensureSecuritySessionTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_login_history (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      email TEXT NOT NULL,
      success INTEGER NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      device_label TEXT,
      failure_reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_login_history_created ON hq_login_history(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hq_login_history_email ON hq_login_history(email);

    CREATE TABLE IF NOT EXISTS hq_active_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      device_label TEXT,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_hq_sessions_user ON hq_active_sessions(user_id);
  `);
}

export async function recordLoginAttempt(opts: {
  userId?: string;
  email: string;
  success: boolean;
  ipAddress?: string;
  userAgent?: string;
  failureReason?: string;
}): Promise<void> {
  try {
    await ensureSecuritySessionTables();
    const db = await getDb();
    await db.run(
      `INSERT INTO hq_login_history (id, user_id, email, success, ip_address, user_agent, device_label, failure_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      opts.userId ?? null,
      opts.email,
      opts.success ? 1 : 0,
      opts.ipAddress ?? null,
      opts.userAgent ?? null,
      parseDeviceLabel(opts.userAgent),
      opts.failureReason ?? null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error("Login history error:", err);
  }
}

export async function recordActiveSession(opts: {
  userId: string;
  email: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<string> {
  await ensureSecuritySessionTables();
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO hq_active_sessions (id, user_id, email, ip_address, user_agent, device_label, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, opts.userId, opts.email, opts.ipAddress ?? null, opts.userAgent ?? null,
    parseDeviceLabel(opts.userAgent), now, now
  );
  return id;
}

export async function touchSession(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE hq_active_sessions SET last_seen_at = ? WHERE id = ? AND revoked = 0",
    new Date().toISOString(), sessionId
  );
}

export async function revokeSession(sessionId: string, actorEmail?: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.run(
    "UPDATE hq_active_sessions SET revoked = 1 WHERE id = ?", sessionId
  );
  if ((result.changes ?? 0) > 0) {
    const { logHqAudit } = await import("./hqAuditLog");
    await logHqAudit({
      action: "session_revoked",
      entityType: "session",
      entityId: sessionId,
      actorEmail,
    });
    return true;
  }
  return false;
}

export async function getLoginHistory(limit = 50) {
  await ensureSecuritySessionTables();
  const db = await getDb();
  return db.all(
    `SELECT id, user_id, email, success, ip_address, device_label, failure_reason, created_at
     FROM hq_login_history ORDER BY created_at DESC LIMIT ?`, limit
  );
}

export async function getActiveSessions(limit = 50) {
  await ensureSecuritySessionTables();
  const db = await getDb();
  return db.all(
    `SELECT id, user_id, email, ip_address, device_label, last_seen_at, created_at
     FROM hq_active_sessions WHERE revoked = 0 ORDER BY last_seen_at DESC LIMIT ?`, limit
  );
}

export async function getKnownDevices(limit = 30) {
  await ensureSecuritySessionTables();
  const db = await getDb();
  return db.all(
    `SELECT device_label, email, ip_address, MAX(last_seen_at) as last_seen, COUNT(*) as session_count
     FROM hq_active_sessions WHERE revoked = 0
     GROUP BY device_label, email, ip_address
     ORDER BY last_seen DESC LIMIT ?`, limit
  );
}

export async function getMfaStatusSummary() {
  const db = await getDb();
  const privileged = (await db.all(
    `SELECT email, role, twofa_enabled FROM users WHERE role IN ('owner','admin','exec','EXEC','executive','executive_director','administrator','founder','finance','grant_manager')`
  ) as unknown) as { email: string; role: string; twofa_enabled: number }[];
  const requiring = privileged.filter((u) => roleRequiresMfa(u.role));
  const enabled = requiring.filter((u) => u.twofa_enabled === 1);
  return {
    requiredRoles: Array.from(MFA_ROLES),
    privilegedAccountCount: requiring.length,
    mfaEnabledCount: enabled.length,
    compliancePct: requiring.length ? Math.round((enabled.length / requiring.length) * 100) : 100,
    accounts: requiring.map((u) => ({
      email: u.email,
      role: u.role,
      mfaEnabled: u.twofa_enabled === 1,
    })),
  };
}

export async function getThreatMonitor() {
  await ensureSecuritySessionTables();
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 3600000).toISOString();

  const failedLogins = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM hq_login_history WHERE success = 0 AND created_at >= ?", since
  ))?.c ?? 0;

  const failedByIp = (await db.all(
    `SELECT ip_address, COUNT(*) as count FROM hq_login_history
     WHERE success = 0 AND created_at >= ? AND ip_address IS NOT NULL
     GROUP BY ip_address HAVING count >= 3 ORDER BY count DESC LIMIT 10`, since
  ) as unknown) as { ip_address: string; count: number }[];

  const suspiciousEmails = (await db.all(
    `SELECT email, COUNT(*) as count FROM hq_login_history
     WHERE success = 0 AND created_at >= ?
     GROUP BY email HAVING count >= 3 ORDER BY count DESC LIMIT 10`, since
  ) as unknown) as { email: string; count: number }[];

  const threats: { level: "high" | "medium" | "low"; title: string; detail: string }[] = [];
  for (const row of failedByIp) {
    threats.push({
      level: row.count >= 10 ? "high" : "medium",
      title: `Repeated failed logins from ${row.ip_address}`,
      detail: `${row.count} failed attempts in 24h`,
    });
  }
  for (const row of suspiciousEmails) {
    threats.push({
      level: row.count >= 5 ? "high" : "medium",
      title: `Account targeting: ${row.email}`,
      detail: `${row.count} failed login attempts in 24h`,
    });
  }
  if (failedLogins === 0) {
    threats.push({ level: "low", title: "No failed logins", detail: "No authentication threats detected in 24h" });
  }

  return {
    failedLogins24h: failedLogins,
    suspiciousIps: failedByIp,
    targetedAccounts: suspiciousEmails,
    threats,
    scannedAt: new Date().toISOString(),
  };
}
