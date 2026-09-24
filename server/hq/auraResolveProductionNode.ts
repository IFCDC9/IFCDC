/**
 * AURA Resolve production node.
 * The Mac calls HQ. HQ never opens 127.0.0.1 from the public internet.
 * Separate from the Ableton and Serato node tables.
 *
 * Uses a dedicated sqlite connection (same file, separate handle) so a stuck
 * CREATE/write on the shared getDb() singleton cannot pin claim/status forever,
 * and Resolve schema work cannot queue behind other modules on that singleton.
 */
import crypto from "crypto";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { getDataDir, getDbPath } from "../config/dataPaths";

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const AURA_RESOLVE_COMMANDS = [
  "create_project",
  "open_project",
  "import_media",
  "create_timeline",
  "add_clip",
  "add_title",
  "add_logo",
  "add_music",
  "add_voiceover",
  "add_transition",
  "fade_audio",
  "fade_video",
  "save_project",
  "preview_project",
  "queue_render",
  "render_vertical",
  "render_landscape",
  "editor_plan",
  "resolve_status",
] as const;

const LOCAL_BRIDGE = "http://127.0.0.1:4181";
/** Hard ceiling so a wedged sqlite op cannot pin an HTTP request. */
const DB_OP_TIMEOUT_MS = 4_000;
const ENSURE_TIMEOUT_MS = 3_000;

let resolveDb: Database | null = null;
let resolveDbOpen: Promise<Database> | null = null;
let tablesReady = false;
let ensureInFlight: Promise<void> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function resetResolveDb(reason: string): Promise<void> {
  tablesReady = false;
  ensureInFlight = null;
  const prior = resolveDb;
  resolveDb = null;
  resolveDbOpen = null;
  if (prior) {
    try {
      await withTimeout(prior.close(), 1_000, "resolve-db-close");
    } catch (err) {
      console.warn("[aura-resolve] db close after reset failed:", reason, err);
    }
  }
}

async function openResolveDb(): Promise<Database> {
  if (resolveDb) return resolveDb;
  if (resolveDbOpen) return resolveDbOpen;
  resolveDbOpen = (async () => {
    getDataDir();
    const db = await open({
      filename: getDbPath(),
      driver: sqlite3.Database,
    });
    // Fail fast on lock contention instead of waiting forever.
    await db.exec(`PRAGMA busy_timeout = 2500;`);
    resolveDb = db;
    return db;
  })();
  try {
    return await resolveDbOpen;
  } catch (err) {
    resolveDbOpen = null;
    throw err;
  }
}

async function getResolveDb(): Promise<Database> {
  return openResolveDb();
}

export async function ensureAuraResolveNodeTables(): Promise<void> {
  if (tablesReady) return;
  if (ensureInFlight) return ensureInFlight;

  ensureInFlight = (async () => {
    const db = await getResolveDb();
    await withTimeout(
      db.exec(`
        CREATE TABLE IF NOT EXISTS aura_resolve_production_nodes (
          node_id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          hostname TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          last_seen_at TEXT,
          last_heartbeat_json TEXT
        );
        CREATE TABLE IF NOT EXISTS aura_resolve_node_commands (
          id TEXT PRIMARY KEY,
          node_id TEXT NOT NULL,
          command TEXT NOT NULL,
          args_json TEXT,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          result_json TEXT
        );
      `),
      ENSURE_TIMEOUT_MS,
      "ensureAuraResolveNodeTables"
    );
    tablesReady = true;
  })();

  try {
    await ensureInFlight;
  } catch (err) {
    ensureInFlight = null;
    tablesReady = false;
    await resetResolveDb("ensure-failed");
    throw err;
  }
}

async function withResolveDb<T>(label: string, fn: (db: Database) => Promise<T>): Promise<T> {
  try {
    await ensureAuraResolveNodeTables();
    const db = await getResolveDb();
    return await withTimeout(fn(db), DB_OP_TIMEOUT_MS, label);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("timed out")) {
      await resetResolveDb(label);
    }
    throw err;
  }
}

function bearer(req: { headers: Record<string, unknown> }): string | null {
  const auth = String(req.headers.authorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

export async function claimFirstAuraResolveNode(opts: {
  nodeId: string;
  token: string;
  label?: string;
  hostname?: string;
}) {
  const nodeId = String(opts.nodeId || "").trim();
  const token = String(opts.token || "").trim();
  if (!nodeId || token.length < 24) return { ok: false as const, error: "Invalid node credentials" };

  try {
    return await withResolveDb("claimFirstAuraResolveNode", async (db) => {
      const existing = (await db.get(
        `SELECT node_id, token_hash FROM aura_resolve_production_nodes WHERE node_id = ? AND active = 1`,
        nodeId
      )) as { node_id: string; token_hash: string } | undefined;
      if (existing) {
        if (tokenHash(token) === existing.token_hash) {
          return { ok: true as const, nodeId };
        }
        return { ok: false as const, error: "A Resolve production node is already enrolled" };
      }

      // Drop never-heartbeated enrollments so a lost credential cannot permanently block the Mac.
      await db.run(
        `UPDATE aura_resolve_production_nodes SET active = 0
         WHERE active = 1 AND last_seen_at IS NULL`
      );

      const countRow = (await db.get(
        `SELECT COUNT(*) AS c FROM aura_resolve_production_nodes WHERE active = 1`
      )) as { c: number };
      if (Number(countRow?.c || 0) > 0) {
        return { ok: false as const, error: "A Resolve production node is already enrolled" };
      }

      await db.run(
        `INSERT INTO aura_resolve_production_nodes
          (node_id, label, token_hash, hostname, active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
        nodeId,
        (opts.label || "Founder Mac Resolve Node").slice(0, 120),
        tokenHash(token),
        opts.hostname ?? null,
        new Date().toISOString()
      );
      return { ok: true as const, nodeId };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resolve node database unavailable";
    console.error("[aura-resolve] claim failed:", message);
    return { ok: false as const, error: `Resolve node claim failed: ${message}` };
  }
}

export async function enrollAuraResolveNode(opts: { label?: string; hostname?: string }) {
  return withResolveDb("enrollAuraResolveNode", async (db) => {
    const nodeId = `arn_${crypto.randomBytes(8).toString("hex")}`;
    const token = `arnt_${crypto.randomBytes(24).toString("base64url")}`;
    await db.run(
      `INSERT INTO aura_resolve_production_nodes
        (node_id, label, token_hash, hostname, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      nodeId,
      (opts.label || "Founder Mac Resolve Node").slice(0, 120),
      tokenHash(token),
      opts.hostname ?? null,
      new Date().toISOString()
    );
    return { nodeId, token };
  });
}

export async function authenticateAuraResolveNode(req: {
  headers: Record<string, unknown>;
  body?: { nodeId?: string };
}) {
  const token = bearer(req);
  const nodeId = String(req.body?.nodeId || req.headers["x-aura-resolve-node-id"] || "").trim();
  if (!token || !nodeId) return null;
  try {
    return await withResolveDb("authenticateAuraResolveNode", async (db) => {
      const row = (await db.get(
        `SELECT node_id, label, token_hash, active FROM aura_resolve_production_nodes WHERE node_id = ? AND active = 1`,
        nodeId
      )) as { node_id: string; label: string; token_hash: string } | undefined;
      if (!row || tokenHash(token) !== row.token_hash) return null;
      return { nodeId: row.node_id, label: row.label };
    });
  } catch (err) {
    console.error("[aura-resolve] authenticate failed:", err);
    return null;
  }
}

export async function recordAuraResolveHeartbeat(nodeId: string, payload: Record<string, unknown>) {
  await withResolveDb("recordAuraResolveHeartbeat", async (db) => {
    const now = new Date().toISOString();
    await db.run(
      `UPDATE aura_resolve_production_nodes SET last_seen_at = ?, last_heartbeat_json = ? WHERE node_id = ?`,
      now,
      JSON.stringify({ ...payload, receivedAt: now }),
      nodeId
    );
  });
}

export async function queueAuraResolveCommand(nodeId: string, command: string, args: Record<string, unknown>) {
  if (!AURA_RESOLVE_COMMANDS.includes(command as (typeof AURA_RESOLVE_COMMANDS)[number])) {
    throw new Error("command is not allowlisted");
  }
  return withResolveDb("queueAuraResolveCommand", async (db) => {
    const id = `arc_${crypto.randomBytes(8).toString("hex")}`;
    await db.run(
      `INSERT INTO aura_resolve_node_commands (id, node_id, command, args_json, status, created_at)
       VALUES (?, ?, ?, ?, 'queued', ?)`,
      id,
      nodeId,
      command,
      JSON.stringify({ ...args, publish: false }),
      new Date().toISOString()
    );
    return { id, publish: false };
  });
}

export async function claimAuraResolveCommands(nodeId: string) {
  return withResolveDb("claimAuraResolveCommands", async (db) => {
    const rows = (await db.all(
      `SELECT id, command, args_json FROM aura_resolve_node_commands
       WHERE node_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 5`,
      nodeId
    )) as { id: string; command: string; args_json: string }[];
    for (const row of rows) {
      await db.run(`UPDATE aura_resolve_node_commands SET status = 'claimed' WHERE id = ?`, row.id);
    }
    return rows.map((row) => ({ id: row.id, command: row.command, args: JSON.parse(row.args_json || "{}") }));
  });
}

export async function completeAuraResolveCommand(id: string, result: unknown) {
  await withResolveDb("completeAuraResolveCommand", async (db) => {
    await db.run(
      `UPDATE aura_resolve_node_commands SET status = 'complete', result_json = ? WHERE id = ?`,
      JSON.stringify(result),
      id
    );
  });
}

export async function getAuraResolveNodeSnapshot() {
  try {
    return await withResolveDb("getAuraResolveNodeSnapshot", async (db) => {
      const row = (await db.get(
        `SELECT node_id, label, last_seen_at, last_heartbeat_json
         FROM aura_resolve_production_nodes WHERE active = 1
         ORDER BY COALESCE(last_seen_at, created_at) DESC LIMIT 1`
      )) as { node_id: string; label: string; last_seen_at: string | null; last_heartbeat_json: string | null } | undefined;
      if (!row) return { online: false, nodeId: null, heartbeat: null };
      const ageMs = row.last_seen_at ? Date.now() - Date.parse(row.last_seen_at) : null;
      return {
        online: ageMs != null && ageMs < 45_000,
        nodeId: row.node_id,
        label: row.label,
        lastSeenAt: row.last_seen_at,
        ageMs,
        heartbeat: row.last_heartbeat_json ? JSON.parse(row.last_heartbeat_json) : null,
      };
    });
  } catch (err) {
    console.error("[aura-resolve] snapshot failed:", err);
    return { online: false, nodeId: null, heartbeat: null, error: "snapshot_unavailable" as const };
  }
}

export async function listAuraResolveJobs(nodeId: string | null) {
  try {
    return await withResolveDb("listAuraResolveJobs", async (db) => {
      const rows = (await db.all(
        `SELECT id, command, args_json, status, created_at, result_json
         FROM aura_resolve_node_commands
         ${nodeId ? "WHERE node_id = ?" : ""}
         ORDER BY created_at DESC LIMIT 40`,
        ...(nodeId ? [nodeId] : [])
      )) as { id: string; command: string; args_json: string; status: string; created_at: string; result_json: string | null }[];
      return rows.map((row) => ({
        id: row.id,
        command: row.command,
        status: row.status,
        createdAt: row.created_at,
        args: JSON.parse(row.args_json || "{}"),
        result: row.result_json ? JSON.parse(row.result_json) : null,
      }));
    });
  } catch (err) {
    console.error("[aura-resolve] list jobs failed:", err);
    return [];
  }
}

export async function cancelAuraResolveJob(id: string) {
  return withResolveDb("cancelAuraResolveJob", async (db) => {
    const result = await db.run(
      `UPDATE aura_resolve_node_commands SET status = 'cancelled', result_json = ? WHERE id = ? AND status = 'queued'`,
      JSON.stringify({ ok: false, error: "cancelled by Founder" }),
      id
    );
    return { cancelled: (result.changes || 0) > 0 };
  });
}

export async function readLocalResolveBridge(): Promise<Record<string, unknown> | null> {
  // Cloud HQ must never wait on the Mac's private loopback bridge.
  if (process.env.RENDER === "true" || process.env.AURA_RESOLVE_SKIP_LOCAL_BRIDGE === "true") {
    return null;
  }
  try {
    const response = await fetch(`${LOCAL_BRIDGE}/health`, { signal: AbortSignal.timeout(400) });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
