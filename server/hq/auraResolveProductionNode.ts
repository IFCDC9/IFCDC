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
import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { getBackupDir, getDataDir, getDbPath, getReportsDir } from "../config/dataPaths";

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const AURA_RESOLVE_COMMANDS = [
  "create_project",
  "open_project",
  "import_media",
  "import_assets",
  "create_bin",
  "create_timeline",
  "add_clip",
  "trim_clip",
  "split_clip",
  "move_clip",
  "remove_clip",
  "duplicate_clip",
  "set_clip_duration",
  "reorder_clips",
  "add_title",
  "add_logo",
  "add_music",
  "add_voiceover",
  "add_transition",
  "fade_audio",
  "fade_video",
  "fade_music",
  "duck_music",
  "adjust_audio_levels",
  "add_subtitles",
  "add_captions",
  "apply_branding",
  "basic_cleanup",
  "save_project",
  "preview_project",
  "queue_render",
  "render_vertical",
  "render_landscape",
  "render_square",
  "editor_plan",
  "editor_run",
  "request_revision",
  "master_formats",
  "resolve_status",
  "designate_founder_media",
  "provider_discovery",
  "ingest_generated_media",
  // Phase 7 HQ preview loop — Mac bridge handles these; missing allowlist entries
  // made APPROVE/REJECT throw with no HTTP response and left the phone UI busy-locked.
  "preview_decision",
  "autonomous_status",
  "resume_autonomous_job",
] as const;

const LOCAL_BRIDGE = "http://127.0.0.1:4181";
/** Production Mac is ONLINE only while heartbeat age is under this TTL. */
export const AURA_RESOLVE_HEARTBEAT_TTL_MS = 45_000;
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
        CREATE TABLE IF NOT EXISTS aura_resolve_creative_memory (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS aura_resolve_previews (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          project TEXT,
          instruction TEXT,
          duration REAL,
          content_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          path TEXT NOT NULL,
          created_at TEXT NOT NULL
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

/** Free disposable disk so Resolve enrollment writes are not blocked by SQLITE_FULL. */
function reclaimDiskForResolveWrites(): { freedBytes: number; actions: string[] } {
  const actions: string[] = [];
  let freedBytes = 0;
  const unlinkSafe = (filePath: string, label: string) => {
    try {
      if (!fs.existsSync(filePath)) return;
      const size = fs.statSync(filePath).size;
      fs.unlinkSync(filePath);
      freedBytes += size;
      actions.push(`${label}:${path.basename(filePath)}`);
    } catch (err) {
      console.warn("[aura-resolve] reclaim skip", filePath, err);
    }
  };

  const backupDir = getBackupDir();
  if (fs.existsSync(backupDir)) {
    const backups = fs
      .readdirSync(backupDir)
      .map((name) => {
        const full = path.join(backupDir, name);
        try {
          const st = fs.statSync(full);
          return st.isFile() ? { full, mtimeMs: st.mtimeMs, size: st.size } : null;
        } catch {
          return null;
        }
      })
      .filter((row): row is { full: string; mtimeMs: number; size: number } => Boolean(row))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    // Drop every backup copy when the disk is full — enrollment needs write headroom.
    for (const row of backups) unlinkSafe(row.full, "backup");
  }

  const dataDir = getDataDir();
  for (const name of fs.readdirSync(dataDir)) {
    if (!/^ifcdc-.*\.db$/i.test(name) && !/\.db\.(bak|tmp|old)$/i.test(name)) continue;
    const full = path.join(dataDir, name);
    if (path.resolve(full) === path.resolve(getDbPath())) continue;
    unlinkSafe(full, "data-copy");
  }

  try {
    const reportsDir = getReportsDir();
    if (fs.existsSync(reportsDir)) {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const name of fs.readdirSync(reportsDir)) {
        const full = path.join(reportsDir, name);
        try {
          const st = fs.statSync(full);
          if (st.isFile() && st.mtimeMs < cutoff) unlinkSafe(full, "report");
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  console.warn("[aura-resolve] disk reclaim", { freedBytes, actions: actions.slice(0, 20) });
  return { freedBytes, actions };
}

async function insertClaimNode(
  db: Database,
  opts: { nodeId: string; token: string; label?: string; hostname?: string }
): Promise<{ ok: true; nodeId: string } | { ok: false; error: string }> {
  const nodeId = opts.nodeId;
  const token = opts.token;
  const existing = (await db.get(
    `SELECT node_id, token_hash FROM aura_resolve_production_nodes WHERE node_id = ? AND active = 1`,
    nodeId
  )) as { node_id: string; token_hash: string } | undefined;
  if (existing) {
    if (tokenHash(token) === existing.token_hash) {
      return { ok: true, nodeId };
    }
    return { ok: false, error: "A Resolve production node is already enrolled" };
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
    return { ok: false, error: "A Resolve production node is already enrolled" };
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
  return { ok: true, nodeId };
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

  const runOnce = () =>
    withResolveDb("claimFirstAuraResolveNode", (db) => insertClaimNode(db, { ...opts, nodeId, token }));

  try {
    return await runOnce();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resolve node database unavailable";
    if (/SQLITE_FULL|database or disk is full/i.test(message)) {
      const reclaim = reclaimDiskForResolveWrites();
      await resetResolveDb("sqlite-full-reclaim");
      try {
        const retry = await runOnce();
        if (retry.ok) return retry;
        return {
          ok: false as const,
          error: `${retry.error} (reclaimed ${reclaim.freedBytes} bytes)`,
        };
      } catch (retryErr) {
        const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.error("[aura-resolve] claim retry failed:", retryMessage, reclaim);
        return {
          ok: false as const,
          error: `Resolve node claim failed after reclaim (${reclaim.freedBytes} bytes): ${retryMessage}`,
        };
      }
    }
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
      const online = ageMs != null && ageMs < AURA_RESOLVE_HEARTBEAT_TTL_MS;
      return {
        online,
        nodeId: row.node_id,
        label: row.label,
        lastSeenAt: row.last_seen_at,
        ageMs,
        // Stale payloads stay available for diagnostics, but callers must gate "live" fields on `online`.
        heartbeat: row.last_heartbeat_json ? JSON.parse(row.last_heartbeat_json) : null,
        heartbeatTtlMs: AURA_RESOLVE_HEARTBEAT_TTL_MS,
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

const MAX_RESOLVE_PREVIEWS = 3;

function previewDir(): string {
  const dir = path.join(getDataDir(), "aura-resolve-previews");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}


function sanitizePreviewName(name: string): string {
  return String(name || "draft.mp4")
    .replace(/[—–]/g, "-")
    .replace(/[^a-zA-Z0-9._\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export async function storeAuraResolvePreview(opts: {
  name: string;
  project?: string | null;
  instruction?: string | null;
  duration?: number | null;
  contentType?: string;
  base64: string;
  size?: number;
}) {
  // Keep Founder-facing titles readable (spaces / en–em dashes); still strip path-unsafe chars.
  const safeName = sanitizePreviewName(opts.name);
  const id = `arp_${crypto.randomBytes(8).toString("hex")}`;
  const bytes = Buffer.from(String(opts.base64 || ""), "base64");
  if (!bytes.length) throw new Error("preview payload empty");
  // Soft cap ~40MB decoded to protect Render disk.
  if (bytes.length > 40 * 1024 * 1024) throw new Error("preview exceeds 40MB limit");
  const filePath = path.join(previewDir(), `${id}-${safeName}`);
  fs.writeFileSync(filePath, bytes);

  return withResolveDb("storeAuraResolvePreview", async (db) => {
    await db.run(
      `INSERT INTO aura_resolve_previews
        (id, name, project, instruction, duration, content_type, size, path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      safeName,
      opts.project ?? null,
      opts.instruction ?? null,
      opts.duration ?? null,
      opts.contentType || "video/mp4",
      bytes.length,
      filePath,
      new Date().toISOString()
    );

    const rows = (await db.all(
      `SELECT id, path FROM aura_resolve_previews ORDER BY created_at DESC`
    )) as { id: string; path: string }[];
    for (const row of rows.slice(MAX_RESOLVE_PREVIEWS)) {
      try {
        if (fs.existsSync(row.path)) fs.unlinkSync(row.path);
      } catch {
        /* ignore */
      }
      await db.run(`DELETE FROM aura_resolve_previews WHERE id = ?`, row.id);
    }

    await db.run(
      `INSERT INTO aura_resolve_creative_memory (id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)`,
      `arm_${crypto.randomBytes(6).toString("hex")}`,
      "preview",
      JSON.stringify({
        previewId: id,
        name: safeName,
        project: opts.project,
        duration: opts.duration,
        publish: false,
      }),
      new Date().toISOString()
    );

    return {
      ok: true as const,
      id,
      name: safeName,
      size: bytes.length,
      duration: opts.duration ?? null,
      publish: false,
      previewUrl: `/api/hq/aura/resolve/preview/${id}`,
    };
  });
}

export async function listAuraResolvePreviews() {
  try {
    return await withResolveDb("listAuraResolvePreviews", async (db) => {
      const rows = (await db.all(
        `SELECT id, name, project, instruction, duration, content_type, size, created_at
         FROM aura_resolve_previews ORDER BY created_at DESC LIMIT 10`
      )) as {
        id: string;
        name: string;
        project: string | null;
        instruction: string | null;
        duration: number | null;
        content_type: string;
        size: number;
        created_at: string;
      }[];
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        project: row.project,
        instruction: row.instruction,
        duration: row.duration,
        contentType: row.content_type,
        size: row.size,
        createdAt: row.created_at,
        previewUrl: `/api/hq/aura/resolve/preview/${row.id}`,
        publish: false,
      }));
    });
  } catch (err) {
    console.error("[aura-resolve] list previews failed:", err);
    return [];
  }
}

export async function getAuraResolvePreview(id: string) {
  return withResolveDb("getAuraResolvePreview", async (db) => {
    const row = (await db.get(
      `SELECT id, name, content_type, path, size FROM aura_resolve_previews WHERE id = ?`,
      id
    )) as { id: string; name: string; content_type: string; path: string; size: number } | undefined;
    if (!row || !fs.existsSync(row.path)) return null;
    return {
      id: row.id,
      name: row.name,
      contentType: row.content_type,
      size: row.size,
      bytes: fs.readFileSync(row.path),
    };
  });
}

/** Correct HQ preview catalog labels without touching original Mac media bytes. */
export async function relabelAuraResolvePreview(opts: {
  id: string;
  name: string;
  project?: string | null;
  instruction?: string | null;
}) {
  const id = String(opts.id || "").trim();
  if (!id) throw new Error("preview id required");
  const safeName = sanitizePreviewName(opts.name);
  if (!safeName) throw new Error("preview name required");

  return withResolveDb("relabelAuraResolvePreview", async (db) => {
    const row = (await db.get(
      `SELECT id, name, project, instruction, path, size, duration, content_type, created_at
       FROM aura_resolve_previews WHERE id = ?`,
      id
    )) as {
      id: string;
      name: string;
      project: string | null;
      instruction: string | null;
      path: string;
      size: number;
      duration: number | null;
      content_type: string;
      created_at: string;
    } | undefined;
    if (!row) throw new Error("preview not found");

    let nextPath = row.path;
    if (fs.existsSync(row.path)) {
      const dir = path.dirname(row.path);
      const candidate = path.join(dir, `${id}-${safeName}`);
      if (candidate !== row.path) {
        // Rename catalog file only — do not rewrite bytes.
        fs.renameSync(row.path, candidate);
        nextPath = candidate;
      }
    }

    await db.run(
      `UPDATE aura_resolve_previews
       SET name = ?, project = ?, instruction = ?, path = ?
       WHERE id = ?`,
      safeName,
      opts.project !== undefined ? opts.project : row.project,
      opts.instruction !== undefined ? opts.instruction : row.instruction,
      nextPath,
      id
    );

    await db.run(
      `INSERT INTO aura_resolve_creative_memory (id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)`,
      `arm_${crypto.randomBytes(6).toString("hex")}`,
      "preview_relabel",
      JSON.stringify({
        previewId: id,
        previousName: row.name,
        previousProject: row.project,
        name: safeName,
        project: opts.project !== undefined ? opts.project : row.project,
        publish: false,
      }),
      new Date().toISOString()
    );

    return {
      ok: true as const,
      id,
      name: safeName,
      project: opts.project !== undefined ? opts.project : row.project,
      instruction: opts.instruction !== undefined ? opts.instruction : row.instruction,
      size: row.size,
      duration: row.duration,
      publish: false,
      previewUrl: `/api/hq/aura/resolve/preview/${id}`,
    };
  });
}

export async function recordAuraResolveCreativeMemory(kind: string, payload: Record<string, unknown>) {
  return withResolveDb("recordAuraResolveCreativeMemory", async (db) => {
    const id = `arm_${crypto.randomBytes(6).toString("hex")}`;
    await db.run(
      `INSERT INTO aura_resolve_creative_memory (id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)`,
      id,
      kind.slice(0, 40),
      JSON.stringify({ ...payload, publish: false }),
      new Date().toISOString()
    );
    return { id };
  });
}

export async function listAuraResolveCreativeMemory(limit = 20) {
  try {
    return await withResolveDb("listAuraResolveCreativeMemory", async (db) => {
      const rows = (await db.all(
        `SELECT id, kind, payload_json, created_at FROM aura_resolve_creative_memory
         ORDER BY created_at DESC LIMIT ?`,
        Math.min(limit, 40)
      )) as { id: string; kind: string; payload_json: string; created_at: string }[];
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        payload: JSON.parse(row.payload_json || "{}"),
        createdAt: row.created_at,
      }));
    });
  } catch {
    return [];
  }
}
