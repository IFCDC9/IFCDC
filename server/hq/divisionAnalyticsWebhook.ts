import { getDb } from "../db";
import crypto from "crypto";
import type { DivisionId } from "./divisionIntegrationLayer";

const VALID_DIVISIONS: DivisionId[] = [
  "barbers", "housing", "scholarships", "community_programs",
  "media", "radio", "music", "tapis", "inclusive",
];

const DIVISION_ALIASES: Record<string, DivisionId> = {
  music: "music",
  tapis: "tapis",
  tapis_init: "tapis",
  tapisinit: "tapis",
  housing: "housing",
  scholarships: "scholarships",
  scholarship: "scholarships",
  community_programs: "community_programs",
  programs: "community_programs",
  radio: "radio",
  media: "media",
  barbers: "barbers",
  barbershop: "barbers",
  inclusive: "inclusive",
};

export async function ensureDivisionAnalyticsTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_division_analytics_snapshots (
      id TEXT PRIMARY KEY,
      division_id TEXT NOT NULL,
      source_app TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      metrics_json TEXT,
      received_at TEXT NOT NULL,
      api_key_prefix TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_division_analytics_div ON hq_division_analytics_snapshots(division_id, received_at DESC);
  `);
}

export function resolveDivisionId(raw: string): DivisionId | null {
  const key = raw.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return DIVISION_ALIASES[key] ?? (VALID_DIVISIONS.includes(key as DivisionId) ? (key as DivisionId) : null);
}

export async function ingestDivisionAnalytics(
  divisionId: DivisionId,
  payload: Record<string, unknown>,
  meta?: { sourceApp?: string; apiKeyPrefix?: string }
) {
  await ensureDivisionAnalyticsTables();
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const metrics = extractMetrics(payload);

  await db.run(
    `INSERT INTO hq_division_analytics_snapshots (id, division_id, source_app, payload_json, metrics_json, received_at, api_key_prefix)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, divisionId, meta?.sourceApp ?? divisionId,
    JSON.stringify(payload), JSON.stringify(metrics), now, meta?.apiKeyPrefix ?? null
  );

  // Prune old snapshots (keep last 100 per division)
  const old = await db.all(
    `SELECT id FROM hq_division_analytics_snapshots WHERE division_id = ? ORDER BY received_at DESC LIMIT -1 OFFSET 100`,
    divisionId
  ) as { id: string }[];
  for (const row of old) {
    await db.run("DELETE FROM hq_division_analytics_snapshots WHERE id = ?", row.id);
  }

  return { id, divisionId, metrics, receivedAt: now };
}

function extractMetrics(payload: Record<string, unknown>): Record<string, number | string> {
  const metrics: Record<string, number | string> = {};
  const keys = ["activeUsers", "sessions", "revenue", "participants", "applications", "placements", "status", "health"];
  for (const k of keys) {
    if (payload[k] != null) metrics[k] = payload[k] as number | string;
  }
  if (payload.metrics && typeof payload.metrics === "object") {
    Object.assign(metrics, payload.metrics as Record<string, number | string>);
  }
  if (payload.overview && typeof payload.overview === "object") {
    Object.assign(metrics, payload.overview as Record<string, number | string>);
  }
  return metrics;
}

export async function getLatestDivisionAnalytics(divisionId: DivisionId) {
  await ensureDivisionAnalyticsTables();
  const db = await getDb();
  const row = await db.get(
    `SELECT * FROM hq_division_analytics_snapshots WHERE division_id = ? ORDER BY received_at DESC LIMIT 1`,
    divisionId
  ) as { payload_json: string; metrics_json: string; received_at: string; source_app: string } | undefined;

  if (!row) return null;
  return {
    divisionId,
    sourceApp: row.source_app,
    payload: JSON.parse(row.payload_json),
    metrics: JSON.parse(row.metrics_json),
    receivedAt: row.received_at,
  };
}

export async function validateWebhookApiKey(apiKey: string): Promise<{ valid: boolean; appId?: string; prefix?: string }> {
  if (!apiKey || apiKey.length < 8) return { valid: false };
  if (apiKey.startsWith("hq_division_")) {
    return { valid: true, appId: apiKey.replace("hq_division_", ""), prefix: apiKey.slice(0, 16) };
  }
  try {
    const { listRegisteredApps } = await import("./softwareDivisionSchema");
    const apps = await listRegisteredApps();
    const match = apps.find((a) => a.api_key_hash && apiKey.startsWith(a.id));
    if (match) return { valid: true, appId: match.id, prefix: apiKey.slice(0, 12) };
    return { valid: process.env.NODE_ENV === "development", prefix: apiKey.slice(0, 8) };
  } catch {
    return { valid: process.env.NODE_ENV === "development", prefix: apiKey.slice(0, 8) };
  }
}
