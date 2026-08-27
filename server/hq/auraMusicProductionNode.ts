/**
 * AURA MUSIC Production Node — secure Mac↔HQ bridge (outbound HTTPS only).
 *
 * Mac agent POSTs heartbeats and polls for allowlisted commands.
 * HQ never opens or probes ports 4177/4178.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getDb } from "../db";

export const AURA_MUSIC_HEARTBEAT_TIMEOUT_MS = 45_000;

export const AURA_MUSIC_COMMAND_ALLOWLIST = [
  "read_session",
  "read_tracks",
  "read_status",
  "transport_play",
  "transport_stop",
  "mix_run_job",
  "mix_get_job",
  "mix_submit_feedback",
  "mix_revise_job",
  "ensure_aura_racks",
] as const;

export type AuraMusicRemoteCommand = (typeof AURA_MUSIC_COMMAND_ALLOWLIST)[number];

export interface AuraMusicNodeHeartbeatPayload {
  nodeId?: string;
  hostname?: string;
  services?: Record<string, string>;
  summary?: Record<string, string>;
  lastHeartbeatAt?: string | null;
  lastHeartbeatAgeMs?: number | null;
  currentJob?: Record<string, unknown> | null;
  jobQueue?: unknown[];
  recentExports?: unknown[];
  errors?: string[];
  workerAvailable?: boolean;
  auraMusicReady?: boolean;
  statusGeneratedAt?: string | null;
  rawStatus?: Record<string, unknown>;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function ensureAuraMusicNodeTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_music_production_nodes (
      node_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      hostname TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      rotated_at TEXT,
      last_seen_at TEXT,
      last_heartbeat_json TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS aura_music_node_commands (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      command TEXT NOT NULL,
      args_json TEXT,
      status TEXT NOT NULL,
      requested_by TEXT,
      created_at TEXT NOT NULL,
      claimed_at TEXT,
      completed_at TEXT,
      result_json TEXT,
      error TEXT,
      replay_key TEXT NOT NULL UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_aura_music_cmds_node_status
      ON aura_music_node_commands(node_id, status, created_at);
  `);
}

function extractBearer(req: { headers: Record<string, unknown> }): string | null {
  const auth = String(req.headers.authorization || req.headers.Authorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const key = String(
    req.headers["x-aura-music-node-token"] ||
      req.headers["x-api-key"] ||
      req.headers["x-hq-api-key"] ||
      ""
  ).trim();
  return key || null;
}

function extractClaimedNodeId(req: {
  headers: Record<string, unknown>;
  body?: { nodeId?: string };
}): string {
  return String(
    req.body?.nodeId || req.headers["x-aura-music-node-id"] || ""
  ).trim();
}

export async function enrollAuraMusicProductionNode(opts: {
  label?: string;
  hostname?: string;
  enrolledBy?: string;
  nodeId?: string;
  token?: string;
}): Promise<{ nodeId: string; token: string; tokenPrefix: string; label: string }> {
  await ensureAuraMusicNodeTables();
  const db = await getDb();
  const nodeId = opts.nodeId?.trim() || `amn_${crypto.randomBytes(8).toString("hex")}`;
  const token = opts.token?.trim() || `amnt_${crypto.randomBytes(24).toString("base64url")}`;
  const tokenHash = await bcrypt.hash(token, 10);
  const tokenPrefix = token.slice(0, 12);
  const now = new Date().toISOString();
  const label = (opts.label || "Founder Mac Production Node").slice(0, 120);

  await db.run(
    `INSERT INTO aura_music_production_nodes
      (node_id, label, token_hash, token_prefix, hostname, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    nodeId,
    label,
    tokenHash,
    tokenPrefix,
    opts.hostname ?? null,
    now
  );

  return { nodeId, token, tokenPrefix, label };
}

/** First Mac may self-claim when HQ has zero active nodes (Founder workstation bootstrap). */
export async function claimFirstAuraMusicNode(opts: {
  nodeId: string;
  token: string;
  label?: string;
  hostname?: string;
}): Promise<{ ok: true; nodeId: string } | { ok: false; error: string }> {
  const allowFlag = String(process.env.AURA_MUSIC_ALLOW_FIRST_NODE_CLAIM || "1").trim();
  const allow = allowFlag !== "0" && allowFlag.toLowerCase() !== "false";
  if (!allow) return { ok: false, error: "First-node claim disabled" };
  const nodeId = String(opts.nodeId || "").trim();
  const token = String(opts.token || "").trim();
  if (!nodeId || !token || token.length < 24) return { ok: false, error: "Invalid node credentials" };

  await ensureAuraMusicNodeTables();
  const db = await getDb();
  const countRow = (await db.get(
    `SELECT COUNT(*) AS c FROM aura_music_production_nodes WHERE active = 1`
  )) as { c: number };
  if (Number(countRow?.c || 0) > 0) return { ok: false, error: "A production node is already enrolled" };

  await enrollAuraMusicProductionNode({
    nodeId,
    token,
    label: opts.label || "Founder Mac Production Node",
    hostname: opts.hostname,
    enrolledBy: "first-node-claim",
  });
  return { ok: true, nodeId };
}

/** Optional bootstrap: single shared token from env (Render + Mac) for first node. */
async function ensureEnvBootstrapNode(): Promise<void> {
  const envToken = String(process.env.AURA_MUSIC_NODE_TOKEN || "").trim();
  const envNodeId = String(process.env.AURA_MUSIC_NODE_ID || "amn_env_bootstrap").trim();
  if (!envToken) return;

  await ensureAuraMusicNodeTables();
  const db = await getDb();
  const existing = await db.get(
    `SELECT node_id FROM aura_music_production_nodes WHERE node_id = ?`,
    envNodeId
  );
  if (existing) return;

  const tokenHash = await bcrypt.hash(envToken, 10);
  await db.run(
    `INSERT INTO aura_music_production_nodes
      (node_id, label, token_hash, token_prefix, hostname, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    envNodeId,
    "Env Bootstrap Production Node",
    tokenHash,
    envToken.slice(0, 12),
    null,
    new Date().toISOString()
  );
}

export async function authenticateAuraMusicNode(req: {
  headers: Record<string, unknown>;
  body?: { nodeId?: string };
}): Promise<{ nodeId: string; label: string } | null> {
  await ensureEnvBootstrapNode();
  await ensureAuraMusicNodeTables();

  const token = extractBearer(req);
  if (!token) return null;

  // Fast path: env bootstrap token
  const envToken = String(process.env.AURA_MUSIC_NODE_TOKEN || "").trim();
  const envNodeId = String(process.env.AURA_MUSIC_NODE_ID || "amn_env_bootstrap").trim();
  if (envToken && timingSafeEqualString(token, envToken)) {
    return { nodeId: envNodeId, label: "Env Bootstrap Production Node" };
  }

  const db = await getDb();
  const claimedNodeId = extractClaimedNodeId(req);
  const rows = (await db.all(
    `SELECT node_id, label, token_hash, active FROM aura_music_production_nodes
     WHERE active = 1 ${claimedNodeId ? "AND node_id = ?" : ""}`,
    ...(claimedNodeId ? [claimedNodeId] : [])
  )) as { node_id: string; label: string; token_hash: string; active: number }[];

  for (const row of rows) {
    if (await bcrypt.compare(token, row.token_hash)) {
      return { nodeId: row.node_id, label: row.label };
    }
  }
  return null;
}

export async function recordAuraMusicNodeHeartbeat(
  nodeId: string,
  payload: AuraMusicNodeHeartbeatPayload
): Promise<void> {
  await ensureAuraMusicNodeTables();
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `UPDATE aura_music_production_nodes
     SET last_seen_at = ?, last_heartbeat_json = ?, last_error = ?, hostname = COALESCE(?, hostname)
     WHERE node_id = ?`,
    now,
    JSON.stringify({ ...payload, receivedAt: now }),
    Array.isArray(payload.errors) && payload.errors.length
      ? payload.errors.slice(0, 5).join("; ").slice(0, 500)
      : null,
    payload.hostname ?? null,
    nodeId
  );
}

export async function getPrimaryAuraMusicNodeSnapshot(): Promise<{
  online: boolean;
  nodeId: string | null;
  label: string | null;
  lastSeenAt: string | null;
  ageMs: number | null;
  heartbeat: AuraMusicNodeHeartbeatPayload | null;
  timedOut: boolean;
} | null> {
  await ensureAuraMusicNodeTables();
  const db = await getDb();
  const row = (await db.get(
    `SELECT node_id, label, last_seen_at, last_heartbeat_json
     FROM aura_music_production_nodes
     WHERE active = 1
     ORDER BY COALESCE(last_seen_at, created_at) DESC
     LIMIT 1`
  )) as
    | {
        node_id: string;
        label: string;
        last_seen_at: string | null;
        last_heartbeat_json: string | null;
      }
    | undefined;

  if (!row) return null;

  const ageMs = row.last_seen_at ? Date.now() - Date.parse(row.last_seen_at) : null;
  const timedOut = ageMs == null || !Number.isFinite(ageMs) || ageMs > AURA_MUSIC_HEARTBEAT_TIMEOUT_MS;
  let heartbeat: AuraMusicNodeHeartbeatPayload | null = null;
  if (row.last_heartbeat_json) {
    try {
      heartbeat = JSON.parse(row.last_heartbeat_json) as AuraMusicNodeHeartbeatPayload;
    } catch {
      heartbeat = null;
    }
  }

  return {
    online: !timedOut,
    nodeId: row.node_id,
    label: row.label,
    lastSeenAt: row.last_seen_at,
    ageMs,
    heartbeat,
    timedOut,
  };
}

export function isAllowlistedCommand(command: string): command is AuraMusicRemoteCommand {
  return (AURA_MUSIC_COMMAND_ALLOWLIST as readonly string[]).includes(command);
}

export async function enqueueAuraMusicCommand(opts: {
  nodeId?: string | null;
  command: string;
  args?: Record<string, unknown>;
  requestedBy?: string;
  replayKey?: string;
}): Promise<{ id: string; replayKey: string; status: string }> {
  if (!isAllowlistedCommand(opts.command)) {
    throw new Error(`Command not allowlisted: ${opts.command}`);
  }
  await ensureAuraMusicNodeTables();
  const db = await getDb();

  let nodeId = opts.nodeId;
  if (!nodeId) {
    const snap = await getPrimaryAuraMusicNodeSnapshot();
    nodeId = snap?.nodeId ?? null;
  }
  if (!nodeId) throw new Error("No enrolled AURA MUSIC production node");

  const replayKey =
    opts.replayKey?.trim() ||
    `rk_${opts.command}_${crypto.randomBytes(12).toString("hex")}`;

  const existing = (await db.get(
    `SELECT id, status FROM aura_music_node_commands WHERE replay_key = ?`,
    replayKey
  )) as { id: string; status: string } | undefined;
  if (existing) {
    return { id: existing.id, replayKey, status: existing.status };
  }

  const id = `amc_${crypto.randomBytes(10).toString("hex")}`;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO aura_music_node_commands
      (id, node_id, command, args_json, status, requested_by, created_at, replay_key)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
    id,
    nodeId,
    opts.command,
    JSON.stringify(opts.args ?? {}),
    opts.requestedBy ?? null,
    now,
    replayKey
  );
  return { id, replayKey, status: "queued" };
}

export async function claimPendingAuraMusicCommands(
  nodeId: string,
  limit = 5
): Promise<
  {
    id: string;
    command: string;
    args: Record<string, unknown>;
    replayKey: string;
    createdAt: string;
  }[]
> {
  await ensureAuraMusicNodeTables();
  const db = await getDb();
  const rows = (await db.all(
    `SELECT id, command, args_json, replay_key, created_at
     FROM aura_music_node_commands
     WHERE node_id = ? AND status = 'queued'
     ORDER BY created_at ASC
     LIMIT ?`,
    nodeId,
    limit
  )) as {
    id: string;
    command: string;
    args_json: string | null;
    replay_key: string;
    created_at: string;
  }[];

  const now = new Date().toISOString();
  const claimed = [];
  for (const row of rows) {
    const result = await db.run(
      `UPDATE aura_music_node_commands
       SET status = 'claimed', claimed_at = ?
       WHERE id = ? AND status = 'queued'`,
      now,
      row.id
    );
    if ((result.changes ?? 0) < 1) continue;
    let args: Record<string, unknown> = {};
    try {
      args = row.args_json ? (JSON.parse(row.args_json) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }
    claimed.push({
      id: row.id,
      command: row.command,
      args,
      replayKey: row.replay_key,
      createdAt: row.created_at,
    });
  }
  return claimed;
}

export async function completeAuraMusicCommand(opts: {
  nodeId: string;
  commandId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}): Promise<boolean> {
  await ensureAuraMusicNodeTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db.run(
    `UPDATE aura_music_node_commands
     SET status = ?, completed_at = ?, result_json = ?, error = ?
     WHERE id = ? AND node_id = ? AND status IN ('queued', 'claimed')`,
    opts.ok ? "succeeded" : "failed",
    now,
    JSON.stringify(opts.result ?? null),
    opts.error ?? null,
    opts.commandId,
    opts.nodeId
  );
  return (result.changes ?? 0) > 0;
}

export async function getAuraMusicCommand(commandId: string) {
  await ensureAuraMusicNodeTables();
  const db = await getDb();
  const row = (await db.get(
    `SELECT id, node_id, command, args_json, status, requested_by, created_at,
            claimed_at, completed_at, result_json, error, replay_key
     FROM aura_music_node_commands WHERE id = ?`,
    commandId
  )) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id,
    nodeId: row.node_id,
    command: row.command,
    args: row.args_json ? JSON.parse(String(row.args_json)) : {},
    status: row.status,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    result: row.result_json ? JSON.parse(String(row.result_json)) : null,
    error: row.error,
    replayKey: row.replay_key,
  };
}

export async function listRecentAuraMusicCommands(limit = 20) {
  await ensureAuraMusicNodeTables();
  const db = await getDb();
  const rows = (await db.all(
    `SELECT id, node_id, command, status, created_at, completed_at, error, replay_key
     FROM aura_music_node_commands
     ORDER BY created_at DESC
     LIMIT ?`,
    limit
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id,
    nodeId: r.node_id,
    command: r.command,
    status: r.status,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    error: r.error,
    replayKey: r.replay_key,
  }));
}
