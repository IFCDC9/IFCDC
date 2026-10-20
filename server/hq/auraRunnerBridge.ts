/** Authenticated, outbound-only runner bridge. First capability: repository inspection. */
import crypto from "node:crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";

const hash = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
export const RUNNER_LEASE_MS = 5 * 60_000;

export class RunnerBridgeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function database() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_runner_devices (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, revoked_at INTEGER, last_seen_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS aura_runner_jobs (
      id TEXT PRIMARY KEY, runner_id TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL, requester_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      lease_hash TEXT, lease_until INTEGER, result_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aura_runner_queue ON aura_runner_jobs(runner_id, status, created_at);
  `);
  return db;
}

async function audit(action: string, id: string, requesterId?: string) {
  await logHqAudit({ action: `aura_runner_${action}`, entityType: "aura_runner", entityId: id,
    actorId: requesterId || "aura", metadata: { productionExecuted: false } });
}

export async function enrollRunner(label: unknown, requesterId: string) {
  if (typeof label !== "string" || !/^[\w .-]{1,60}$/.test(label.trim())) {
    throw new RunnerBridgeError(400, "Use a runner name of 1–60 letters, numbers, spaces, dots or dashes.");
  }
  const db = await database();
  const id = crypto.randomUUID();
  const token = `aura_runner_${id}.${crypto.randomBytes(32).toString("base64url")}`;
  await db.run("INSERT INTO aura_runner_devices (id, label, token_hash, created_at) VALUES (?, ?, ?, ?)",
    id, label.trim(), hash(token), Date.now());
  await audit("enrolled", id, requesterId);
  return { id, label: label.trim(), token };
}

export async function authenticateRunner(authorization?: string) {
  const match = /^Bearer (aura_runner_([a-f0-9-]{36})\.[A-Za-z0-9_-]{43})$/.exec(authorization || "");
  if (!match) throw new RunnerBridgeError(401, "Runner authentication required.");
  const db = await database();
  const row = await db.get<{ id: string; token_hash: string; revoked_at: number | null }>(
    "SELECT id, token_hash, revoked_at FROM aura_runner_devices WHERE id = ?", match[2]);
  if (!row || row.revoked_at !== null || !crypto.timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(hash(match[1])))) {
    throw new RunnerBridgeError(401, "Runner authentication required.");
  }
  return row.id;
}

export async function revokeRunner(id: string, requesterId: string) {
  const db = await database();
  const result = await db.run("UPDATE aura_runner_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", Date.now(), id);
  if (!result.changes) throw new RunnerBridgeError(404, "Active runner not found.");
  await db.run("UPDATE aura_runner_jobs SET status = 'cancelled', lease_hash = NULL WHERE runner_id = ? AND status IN ('queued', 'running')", id);
  await audit("revoked", id, requesterId);
}

async function expireJobs() {
  const db = await database();
  // Never silently retry an uncertain task. Founder can request a new inspection.
  await db.run("UPDATE aura_runner_jobs SET status = 'expired', lease_hash = NULL WHERE status = 'running' AND lease_until < ?", Date.now());
}

export async function listRunnersAndJobs() {
  const db = await database();
  await expireJobs();
  const runners = await db.all("SELECT id, label, created_at, revoked_at, last_seen_at FROM aura_runner_devices ORDER BY created_at DESC LIMIT 100");
  const rows = await db.all("SELECT id, runner_id, kind, status, created_at, result_json FROM aura_runner_jobs ORDER BY created_at DESC LIMIT 100");
  return { runners, jobs: rows.map(({ result_json, ...row }) => ({ ...row, result: result_json ? JSON.parse(result_json) : null })) };
}

export async function queueRunnerInspection(runnerId: unknown, kind: unknown, requesterId: string) {
  if (typeof runnerId !== "string" || kind !== "inspect_repository") {
    throw new RunnerBridgeError(400, "This bridge accepts repository inspection only.");
  }
  const db = await database();
  const id = crypto.randomUUID();
  const added = await db.run(`INSERT INTO aura_runner_jobs (id, runner_id, kind, status, requester_id, created_at)
    SELECT ?, id, 'inspect_repository', 'queued', ?, ? FROM aura_runner_devices
    WHERE id = ? AND revoked_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM aura_runner_jobs WHERE runner_id = ? AND status IN ('queued', 'running'))`,
    id, requesterId, Date.now(), runnerId, runnerId);
  if (!added.changes) throw new RunnerBridgeError(409, "Runner is unavailable or already has a pending inspection.");
  await audit("queued", id, requesterId);
  return { id, status: "queued", kind: "inspect_repository" };
}

export async function claimRunnerJob(runnerId: string) {
  const db = await database();
  await expireJobs();
  const lease = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  // One atomic statement prevents two poll requests from claiming the same task.
  const job = await db.get<{ id: string; kind: "inspect_repository"; lease_until: number }>(`
    UPDATE aura_runner_jobs SET status = 'running', lease_hash = ?, lease_until = ?
    WHERE id = (SELECT id FROM aura_runner_jobs WHERE runner_id = ? AND status = 'queued' ORDER BY created_at, id LIMIT 1)
    AND status = 'queued'
    AND EXISTS (SELECT 1 FROM aura_runner_devices WHERE id = ? AND revoked_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM aura_runner_jobs WHERE runner_id = ? AND status = 'running')
    RETURNING id, kind, lease_until`, hash(lease), now + RUNNER_LEASE_MS, runnerId, runnerId, runnerId);
  await db.run("UPDATE aura_runner_devices SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL", now, runnerId);
  if (!job) return null;
  await audit("claimed", job.id);
  return { ...job, lease };
}

function inspectionResult(body: unknown) {
  if (!body || typeof body !== "object") throw new RunnerBridgeError(400, "Invalid inspection result.");
  const value = body as Record<string, unknown>;
  if (value.status === "failed") {
    // Store an error code, never arbitrary worker output, paths or credentials.
    if (!["repository_unavailable", "wrong_repository", "inspection_failed"].includes(String(value.error))) {
      throw new RunnerBridgeError(400, "Invalid inspection error.");
    }
    return { status: "failed", error: value.error, productionExecuted: false };
  }
  if (value.status !== "succeeded" || !/^[a-f0-9]{40}$/.test(String(value.commit)) ||
      (value.branch !== null && (typeof value.branch !== "string" || !/^[\w./-]{1,200}$/.test(value.branch))) ||
      !Number.isSafeInteger(value.changedFiles) || Number(value.changedFiles) < 0 ||
      !Number.isSafeInteger(value.untrackedFiles) || Number(value.untrackedFiles) < 0) {
    throw new RunnerBridgeError(400, "Invalid inspection result.");
  }
  return { status: "succeeded", repository: "IFCDC9/IFCDC", commit: value.commit, branch: value.branch,
    changedFiles: value.changedFiles, untrackedFiles: value.untrackedFiles, productionExecuted: false };
}

export async function completeRunnerJob(runnerId: string, id: string, lease: unknown, body: unknown) {
  if (typeof lease !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(lease)) throw new RunnerBridgeError(409, "Invalid job lease.");
  const result = inspectionResult(body);
  const db = await database();
  const updated = await db.run(`UPDATE aura_runner_jobs SET status = ?, result_json = ?, lease_hash = NULL
    WHERE id = ? AND runner_id = ? AND status = 'running' AND lease_hash = ? AND lease_until >= ?
    AND EXISTS (SELECT 1 FROM aura_runner_devices WHERE id = ? AND revoked_at IS NULL)`,
    result.status, JSON.stringify(result), id, runnerId, hash(lease), Date.now(), runnerId);
  if (!updated.changes) throw new RunnerBridgeError(409, "Job lease is expired, completed, or not assigned to this runner.");
  await audit(result.status, id);
  return { id, ...result };
}
