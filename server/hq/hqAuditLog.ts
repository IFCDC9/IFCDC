import { getDb } from "../db";
import crypto from "crypto";

export function auditId() {
  return crypto.randomUUID();
}

export async function ensureHqAuditTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      detail TEXT,
      actor_id TEXT,
      actor_email TEXT,
      ip_address TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_audit_created ON hq_audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hq_audit_entity ON hq_audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_hq_audit_actor ON hq_audit_log(actor_email);
  `);
}

export async function logHqAudit(opts: {
  action: string;
  entityType: string;
  entityId?: string;
  detail?: string;
  actorId?: string;
  actorEmail?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await ensureHqAuditTables();
    const db = await getDb();
    await db.run(
      `INSERT INTO hq_audit_log (id, action, entity_type, entity_id, detail, actor_id, actor_email, ip_address, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      auditId(),
      opts.action,
      opts.entityType,
      opts.entityId ?? null,
      opts.detail ?? "",
      opts.actorId ?? null,
      opts.actorEmail ?? null,
      opts.ipAddress ?? null,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error("HQ audit log error:", err);
  }
}

export async function queryHqAudit(opts: {
  limit?: number;
  action?: string;
  entityType?: string;
  actorEmail?: string;
  since?: string;
}) {
  await ensureHqAuditTables();
  const db = await getDb();
  let sql = "SELECT * FROM hq_audit_log WHERE 1=1";
  const params: unknown[] = [];
  if (opts.action) { sql += " AND action LIKE ?"; params.push(`%${opts.action}%`); }
  if (opts.entityType) { sql += " AND entity_type = ?"; params.push(opts.entityType); }
  if (opts.actorEmail) { sql += " AND actor_email = ?"; params.push(opts.actorEmail); }
  if (opts.since) { sql += " AND created_at >= ?"; params.push(opts.since); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(opts.limit ?? 100);
  return db.all(sql, ...params);
}

export async function buildAuditSummary() {
  await ensureHqAuditTables();
  const db = await getDb();
  const total = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_audit_log"))?.c ?? 0;
  const last24h = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM hq_audit_log WHERE created_at >= datetime('now', '-1 day')`
  ))?.c ?? 0;
  const byEntity = await db.all(
    `SELECT entity_type, COUNT(*) as count FROM hq_audit_log GROUP BY entity_type ORDER BY count DESC LIMIT 10`
  );
  const recent = await queryHqAudit({ limit: 15 });
  return { total, last24h, byEntity, recent };
}
