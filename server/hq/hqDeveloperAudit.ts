import { getDb } from "../db";

export type AuditEventType =
  | "app.registered"
  | "app.quick_registered"
  | "app.key_rotated"
  | "env.validated"
  | "env.validation_failed"
  | "diagnostics.run"
  | "auth.verify_success"
  | "auth.verify_failed"
  | "security.alert";

export interface AuditLogEntry {
  id: string;
  app_id: string | null;
  event_type: AuditEventType;
  actor_id: string | null;
  actor_email: string | null;
  detail: string;
  metadata: string;
  ip_address: string | null;
  severity: "info" | "warning" | "critical";
  created_at: string;
}

export async function ensureDeveloperAuditTables() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_developer_audit_log (
      id TEXT PRIMARY KEY,
      app_id TEXT,
      event_type TEXT NOT NULL,
      actor_id TEXT,
      actor_email TEXT,
      detail TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT,
      severity TEXT NOT NULL DEFAULT 'info',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_hq_dev_audit_app ON hq_developer_audit_log(app_id);
    CREATE INDEX IF NOT EXISTS idx_hq_dev_audit_type ON hq_developer_audit_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_hq_dev_audit_created ON hq_developer_audit_log(created_at DESC);
  `);
}

function auditId() {
  return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function logDeveloperAudit(entry: {
  appId?: string | null;
  eventType: AuditEventType;
  actorId?: string | null;
  actorEmail?: string | null;
  detail: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  severity?: "info" | "warning" | "critical";
}) {
  const db = await getDb();
  await db.run(
    `INSERT INTO hq_developer_audit_log
     (id, app_id, event_type, actor_id, actor_email, detail, metadata, ip_address, severity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    auditId(),
    entry.appId ?? null,
    entry.eventType,
    entry.actorId ?? null,
    entry.actorEmail ?? null,
    entry.detail,
    JSON.stringify(entry.metadata ?? {}),
    entry.ipAddress ?? null,
    entry.severity ?? "info"
  );
}

export async function listDeveloperAuditLog(limit = 50, appId?: string) {
  const db = await getDb();
  if (appId) {
    return (await db.all(
      `SELECT * FROM hq_developer_audit_log WHERE app_id = ? ORDER BY created_at DESC LIMIT ?`,
      appId,
      limit
    )) as AuditLogEntry[];
  }
  return (await db.all(
    `SELECT * FROM hq_developer_audit_log ORDER BY created_at DESC LIMIT ?`,
    limit
  )) as AuditLogEntry[];
}

export async function getSecurityMonitorSummary() {
  const db = await getDb();
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [totalEvents, failedAuth, warnings, critical, recent] = await Promise.all([
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_developer_audit_log WHERE created_at >= ?", last24h),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_developer_audit_log WHERE event_type = 'auth.verify_failed' AND created_at >= ?", last24h),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_developer_audit_log WHERE severity = 'warning' AND created_at >= ?", last24h),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_developer_audit_log WHERE severity = 'critical' AND created_at >= ?", last24h),
    db.all(`SELECT * FROM hq_developer_audit_log ORDER BY created_at DESC LIMIT 20`) as Promise<AuditLogEntry[]>,
  ]);

  return {
    period: "24h",
    totalEvents: totalEvents?.c ?? 0,
    failedAuthAttempts: failedAuth?.c ?? 0,
    warnings: warnings?.c ?? 0,
    criticalAlerts: critical?.c ?? 0,
    status: (critical?.c ?? 0) > 0 ? "critical" : (failedAuth?.c ?? 0) > 5 ? "warning" : "healthy",
    recentEvents: recent.map(formatAuditEntry),
  };
}

export function formatAuditEntry(row: AuditLogEntry) {
  return {
    id: row.id,
    appId: row.app_id,
    eventType: row.event_type,
    actorEmail: row.actor_email,
    detail: row.detail,
    metadata: JSON.parse(row.metadata || "{}"),
    severity: row.severity,
    createdAt: row.created_at,
  };
}
