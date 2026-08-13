/**
 * AURA Unified Action Audit — Phase 2.
 * Single stream that mirrors execute/prepare paths (+ Brain v1).
 * Additive; never throws into callers; Twilio config untouched.
 */
import crypto from "crypto";
import { getDb } from "../db";

export type AuraUnifiedAuditSource =
  | "brain_v1"
  | "command_layer"
  | "executive_ops"
  | "receptionist"
  | "diagnostics"
  | "other";

export type AuraUnifiedAuditKind = "read" | "prepare" | "execute" | "deny" | "system";

function redact(text: string): string {
  return text
    .replace(/(sk-|re_|whsec_|Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[REDACTED]")
    .replace(/(api[_-]?key|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 2000);
}

export async function ensureAuraUnifiedAuditTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_unified_action_log (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source TEXT NOT NULL,
      channel TEXT,
      kind TEXT NOT NULL,
      action_id TEXT,
      command TEXT NOT NULL,
      result TEXT NOT NULL,
      ok INTEGER NOT NULL DEFAULT 1,
      user_id TEXT,
      user_email TEXT,
      metadata_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aura_unified_created
      ON aura_unified_action_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aura_unified_source
      ON aura_unified_action_log(source, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aura_unified_kind
      ON aura_unified_action_log(kind, created_at DESC);
  `);
}

export async function mirrorAuraUnifiedAction(opts: {
  source: AuraUnifiedAuditSource;
  channel?: string | null;
  kind: AuraUnifiedAuditKind;
  actionId?: string | null;
  command: string;
  result: string;
  ok?: boolean;
  userId?: string | null;
  userEmail?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  try {
    await ensureAuraUnifiedAuditTables();
    const db = await getDb();
    const id = crypto.randomUUID();
    const safeMeta = opts.metadata
      ? JSON.stringify(opts.metadata).replace(/(sk-|re_|whsec_)[A-Za-z0-9._-]{8,}/gi, "$1[REDACTED]")
      : null;
    await db.run(
      `INSERT INTO aura_unified_action_log
        (id, created_at, source, channel, kind, action_id, command, result, ok, user_id, user_email, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      new Date().toISOString(),
      opts.source,
      opts.channel ?? null,
      opts.kind,
      opts.actionId ?? null,
      opts.command.slice(0, 500),
      redact(opts.result),
      opts.ok === false ? 0 : 1,
      opts.userId ?? null,
      opts.userEmail ?? null,
      safeMeta
    );
    return id;
  } catch (err) {
    console.error("[aura-unified-audit] mirror failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Fire-and-forget helper for hot paths. */
export function mirrorAuraUnifiedActionAsync(
  opts: Parameters<typeof mirrorAuraUnifiedAction>[0]
): void {
  void mirrorAuraUnifiedAction(opts);
}

export type AuraUnifiedAuditEntry = {
  id: string;
  createdAt: string;
  source: string;
  channel: string | null;
  kind: string;
  actionId: string | null;
  command: string;
  result: string;
  ok: boolean;
  userId: string | null;
  userEmail: string | null;
};

export async function listAuraUnifiedActions(opts?: {
  limit?: number;
  source?: string;
  kind?: string;
}): Promise<AuraUnifiedAuditEntry[]> {
  await ensureAuraUnifiedAuditTables();
  const db = await getDb();
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts?.source) {
    clauses.push("source = ?");
    params.push(opts.source);
  }
  if (opts?.kind) {
    clauses.push("kind = ?");
    params.push(opts.kind);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  const rows = (await db.all(
    `SELECT id, created_at, source, channel, kind, action_id, command, result, ok, user_id, user_email
     FROM aura_unified_action_log
     ${where}
     ORDER BY created_at DESC LIMIT ?`,
    ...params
  )) as Array<{
    id: string;
    created_at: string;
    source: string;
    channel: string | null;
    kind: string;
    action_id: string | null;
    command: string;
    result: string;
    ok: number;
    user_id: string | null;
    user_email: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    source: r.source,
    channel: r.channel,
    kind: r.kind,
    actionId: r.action_id,
    command: r.command,
    result: r.result,
    ok: r.ok === 1,
    userId: r.user_id,
    userEmail: r.user_email,
  }));
}

export async function buildAuraUnifiedAuditReport(limit = 50): Promise<{
  module: "unified-audit";
  version: "v1";
  generatedAt: string;
  mode: "read_only";
  entries: AuraUnifiedAuditEntry[];
  summary: {
    totalReturned: number;
    bySource: Record<string, number>;
    byKind: Record<string, number>;
    failed: number;
  };
  note: string;
}> {
  const entries = await listAuraUnifiedActions({ limit });
  const bySource: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let failed = 0;
  for (const e of entries) {
    bySource[e.source] = (bySource[e.source] || 0) + 1;
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    if (!e.ok) failed += 1;
  }
  return {
    module: "unified-audit",
    version: "v1",
    generatedAt: new Date().toISOString(),
    mode: "read_only",
    entries,
    summary: { totalReturned: entries.length, bySource, byKind, failed },
    note: "Phase 2 unified stream mirrors Brain v1, command-layer prepare/execute, executive ops, and receptionist exec paths. Secrets redacted.",
  };
}
