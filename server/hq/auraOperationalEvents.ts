/**
 * AURA Operational Event Bus — Phase 5.
 * Emits booking / payment / SMS-fail signals into HQ realtime + AURA-readable log.
 * Does NOT change Twilio credentials or webhook URLs.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { notifyHqDataChange, type HqRealtimeDomain } from "./hqRealtimeEvents";

export type AuraOperationalEventType =
  | "booking_created"
  | "booking_failed"
  | "payment_completed"
  | "sms_send_failed"
  | "sms_delivery_failed"
  | "system";

export type AuraOperationalEvent = {
  id: string;
  createdAt: string;
  type: AuraOperationalEventType;
  domain: HqRealtimeDomain;
  title: string;
  detail: string;
  entityType: string | null;
  entityId: string | null;
  severity: "info" | "watch" | "high";
  metadata: Record<string, unknown> | null;
};

const MEMORY_CAP = 200;
const recentMemory: AuraOperationalEvent[] = [];

export async function ensureAuraOperationalEventTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_operational_events (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      event_type TEXT NOT NULL,
      domain TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      severity TEXT NOT NULL DEFAULT 'info',
      metadata_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aura_ops_events_created
      ON aura_operational_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aura_ops_events_type
      ON aura_operational_events(event_type, created_at DESC);
  `);
}

function mapDomain(type: AuraOperationalEventType): HqRealtimeDomain {
  switch (type) {
    case "booking_created":
    case "booking_failed":
      return "bookings";
    case "payment_completed":
      return "donations";
    case "sms_send_failed":
    case "sms_delivery_failed":
      return "communications";
    default:
      return "notifications";
  }
}

export async function emitAuraOperationalEvent(opts: {
  type: AuraOperationalEventType;
  title: string;
  detail: string;
  entityType?: string | null;
  entityId?: string | null;
  severity?: "info" | "watch" | "high";
  metadata?: Record<string, unknown>;
  /** When true, also create a leadership alert (SMS failures). */
  alertFounder?: boolean;
}): Promise<string | null> {
  try {
    await ensureAuraOperationalEventTables();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const domain = mapDomain(opts.type);
    const severity = opts.severity || (opts.type.includes("fail") ? "high" : "info");
    const safeMeta = opts.metadata
      ? JSON.stringify(opts.metadata).replace(/(sk-|re_|whsec_)[A-Za-z0-9._-]{8,}/gi, "$1[REDACTED]")
      : null;

    const event: AuraOperationalEvent = {
      id,
      createdAt,
      type: opts.type,
      domain,
      title: opts.title.slice(0, 240),
      detail: opts.detail.slice(0, 1000),
      entityType: opts.entityType ?? null,
      entityId: opts.entityId ?? null,
      severity,
      metadata: opts.metadata ?? null,
    };

    recentMemory.unshift(event);
    if (recentMemory.length > MEMORY_CAP) recentMemory.length = MEMORY_CAP;

    const db = await getDb();
    await db.run(
      `INSERT INTO aura_operational_events
        (id, created_at, event_type, domain, title, detail, entity_type, entity_id, severity, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      createdAt,
      opts.type,
      domain,
      event.title,
      event.detail,
      event.entityType,
      event.entityId,
      severity,
      safeMeta
    );

    notifyHqDataChange(domain);
    notifyHqDataChange("notifications");

    void import("./auraUnifiedAudit").then(({ mirrorAuraUnifiedActionAsync }) =>
      mirrorAuraUnifiedActionAsync({
        source: "other",
        channel: "event_bus",
        kind: "system",
        actionId: opts.type,
        command: `event:${opts.type}`,
        result: event.title,
        ok: !opts.type.includes("fail"),
        metadata: { eventId: id, domain, entityId: event.entityId },
      })
    );

    if (opts.alertFounder || severity === "high") {
      void import("./criticalAlerts")
        .then(({ createLeadershipAlert }) =>
          createLeadershipAlert({
            alertType: opts.type,
            title: event.title,
            message: event.detail,
            priority: severity === "high" ? "high" : "normal",
            sourceModule: "aura-events",
            sourceId: id,
            path:
              domain === "bookings"
                ? "/hq/clients"
                : domain === "donations"
                  ? "/hq/donations"
                  : "/hq/communications",
          })
        )
        .catch(() => undefined);
    }

    return id;
  } catch (err) {
    console.error("[aura-events] emit failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export function emitAuraOperationalEventAsync(
  opts: Parameters<typeof emitAuraOperationalEvent>[0]
): void {
  void emitAuraOperationalEvent(opts);
}

export async function listAuraOperationalEvents(opts?: {
  limit?: number;
  type?: string;
}): Promise<AuraOperationalEvent[]> {
  await ensureAuraOperationalEventTables();
  const db = await getDb();
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const params: unknown[] = [];
  let where = "";
  if (opts?.type) {
    where = "WHERE event_type = ?";
    params.push(opts.type);
  }
  params.push(limit);
  const rows = (await db.all(
    `SELECT id, created_at, event_type, domain, title, detail, entity_type, entity_id, severity, metadata_json
     FROM aura_operational_events
     ${where}
     ORDER BY created_at DESC LIMIT ?`,
    ...params
  )) as Array<{
    id: string;
    created_at: string;
    event_type: string;
    domain: string;
    title: string;
    detail: string;
    entity_type: string | null;
    entity_id: string | null;
    severity: string;
    metadata_json: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    type: r.event_type as AuraOperationalEventType,
    domain: r.domain as HqRealtimeDomain,
    title: r.title,
    detail: r.detail,
    entityType: r.entity_type,
    entityId: r.entity_id,
    severity: (r.severity as AuraOperationalEvent["severity"]) || "info",
    metadata: r.metadata_json ? (JSON.parse(r.metadata_json) as Record<string, unknown>) : null,
  }));
}

export async function buildAuraOperationalEventsReport(limit = 50) {
  const entries = await listAuraOperationalEvents({ limit });
  const byType: Record<string, number> = {};
  for (const e of entries) byType[e.type] = (byType[e.type] || 0) + 1;
  return {
    module: "operational-events",
    version: "v1",
    generatedAt: new Date().toISOString(),
    mode: "read_only" as const,
    entries,
    summary: {
      totalReturned: entries.length,
      byType,
      highSeverity: entries.filter((e) => e.severity === "high").length,
    },
    note: "Phase 5 AURA event bus — bookings, payments, SMS fail. Twilio config untouched.",
  };
}

/** In-memory peek for hot diagnostics (no DB). */
export function peekRecentAuraOperationalEvents(limit = 20): AuraOperationalEvent[] {
  return recentMemory.slice(0, limit);
}
