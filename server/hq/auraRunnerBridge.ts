/** Authenticated, outbound-only runner bridge. First capability: repository inspection. */
import crypto from "node:crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import { validateChangePackage, reviewChangePackage, type ChangePackage } from "../../shared/auraChangePackage.mjs";

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
    CREATE TABLE IF NOT EXISTS aura_runner_change_payloads (
      job_id TEXT PRIMARY KEY, package_sha256 TEXT NOT NULL, package_json TEXT NOT NULL
    );
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
  await db.run("UPDATE aura_runner_jobs SET status = 'expired' WHERE status = 'queued' AND created_at < ?", Date.now() - 30 * 60_000);
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
  await expireJobs();
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

export function reviewRunnerChangePackage(input: unknown) {
  try { return reviewChangePackage(input); }
  catch { throw new RunnerBridgeError(400, "Invalid change package. Check its version, file paths and size limits."); }
}

export async function queueRunnerChangePackage(runnerId: unknown, input: unknown, reviewedSha256: unknown,
  approved: unknown, requesterId: string) {
  const review = reviewRunnerChangePackage(input);
  if (typeof runnerId !== "string" || approved !== true || reviewedSha256 !== review.packageSha256) {
    throw new RunnerBridgeError(400, "Explicit approval of the exact reviewed package is required.");
  }
  const value = validateChangePackage(input);
  const db = await database();
  await expireJobs();
  const id = crypto.randomUUID();
  // Save immutable content before making the job claimable. Failure removes only this payload.
  await db.run("INSERT INTO aura_runner_change_payloads (job_id, package_sha256, package_json) VALUES (?, ?, ?)",
    id, review.packageSha256, JSON.stringify(value));
  try {
    const added = await db.run(`INSERT INTO aura_runner_jobs (id, runner_id, kind, status, requester_id, created_at)
      SELECT ?, id, 'stage_change_package_v1', 'queued', ?, ? FROM aura_runner_devices
      WHERE id = ? AND revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM aura_runner_jobs WHERE runner_id = ? AND status IN ('queued', 'running'))`,
      id, requesterId, Date.now(), runnerId, runnerId);
    if (!added.changes) throw new RunnerBridgeError(409, "Runner is unavailable or already has a pending job.");
  } catch (error) {
    await db.run("DELETE FROM aura_runner_change_payloads WHERE job_id = ?", id);
    throw error;
  }
  await audit("change_approved_and_queued", id, requesterId);
  return { id, kind: "stage_change_package_v1", status: "queued", packageSha256: review.packageSha256 };
}

export async function claimRunnerJob(runnerId: string, capabilities: unknown = []) {
  const db = await database();
  await expireJobs();
  const lease = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  // One atomic statement prevents two poll requests from claiming the same task.
  const staging = Array.isArray(capabilities) && capabilities.includes("stage_change_package_v1");
  const job = await db.get<{ id: string; kind: "inspect_repository" | "stage_change_package_v1"; lease_until: number }>(`
    UPDATE aura_runner_jobs SET status = 'running', lease_hash = ?, lease_until = ?
    WHERE id = (SELECT id FROM aura_runner_jobs WHERE runner_id = ? AND status = 'queued'
      AND (kind = 'inspect_repository' OR (kind = 'stage_change_package_v1' AND ? = 1)) ORDER BY created_at, id LIMIT 1)
    AND status = 'queued'
    AND EXISTS (SELECT 1 FROM aura_runner_devices WHERE id = ? AND revoked_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM aura_runner_jobs WHERE runner_id = ? AND status = 'running')
    RETURNING id, kind, lease_until`, hash(lease), now + RUNNER_LEASE_MS, runnerId, staging ? 1 : 0, runnerId, runnerId);
  await db.run("UPDATE aura_runner_devices SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL", now, runnerId);
  if (!job) return null;
  await audit("claimed", job.id);
  if (job.kind === "stage_change_package_v1") {
    const payload = await db.get<{ package_sha256: string; package_json: string }>(
      "SELECT package_sha256, package_json FROM aura_runner_change_payloads WHERE job_id = ?", job.id);
    if (!payload) throw new RunnerBridgeError(409, "Change package unavailable.");
    return { ...job, lease, reviewedSha256: payload.package_sha256, changePackage: JSON.parse(payload.package_json) as ChangePackage };
  }
  return { ...job, lease };
}

function stagingResult(body: unknown, expectedDigest: string, expectedCount: number, baseCommit: string) {
  if (!body || typeof body !== "object") throw new RunnerBridgeError(400, "Invalid staging result.");
  const value = body as Record<string, unknown>;
  if (value.packageSha256 !== expectedDigest || value.testsRun !== false || value.productionExecuted !== false) {
    throw new RunnerBridgeError(400, "Staging result does not match the approved package.");
  }
  if (value.status === "failed" && value.error === "package_staging_failed") {
    return { status: "failed", error: "package_staging_failed", packageSha256: expectedDigest, testsRun: false, productionExecuted: false };
  }
  if (value.status !== "succeeded" || value.baseCommit !== baseCommit || value.fileCount !== expectedCount ||
      typeof value.reviewId !== "string" || !/^aura-review-[A-Za-z0-9_-]{1,60}$/.test(value.reviewId)) {
    throw new RunnerBridgeError(400, "Invalid staging result.");
  }
  return { status: "succeeded", packageSha256: expectedDigest, baseCommit, fileCount: expectedCount,
    reviewId: value.reviewId, testsRun: false, productionExecuted: false };
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
  const db = await database();
  const job = await db.get<{ kind: string }>(`SELECT kind FROM aura_runner_jobs WHERE id = ? AND runner_id = ?
    AND status = 'running' AND lease_hash = ? AND lease_until >= ?
    AND EXISTS (SELECT 1 FROM aura_runner_devices WHERE id = ? AND revoked_at IS NULL)`,
    id, runnerId, hash(lease), Date.now(), runnerId);
  if (!job) throw new RunnerBridgeError(409, "Job lease is expired, completed, or not assigned to this runner.");
  let result;
  if (job.kind === "stage_change_package_v1") {
    const payload = await db.get<{ package_sha256: string; package_json: string }>(
      "SELECT package_sha256, package_json FROM aura_runner_change_payloads WHERE job_id = ?", id);
    if (!payload) throw new RunnerBridgeError(409, "Change package unavailable.");
    const value = validateChangePackage(JSON.parse(payload.package_json));
    result = stagingResult(body, payload.package_sha256, value.files.length, value.baseCommit);
  } else result = inspectionResult(body);
  const updated = await db.run(`UPDATE aura_runner_jobs SET status = ?, result_json = ?, lease_hash = NULL
    WHERE id = ? AND runner_id = ? AND status = 'running' AND lease_hash = ? AND lease_until >= ?
    AND EXISTS (SELECT 1 FROM aura_runner_devices WHERE id = ? AND revoked_at IS NULL)`,
    result.status, JSON.stringify(result), id, runnerId, hash(lease), Date.now(), runnerId);
  if (!updated.changes) throw new RunnerBridgeError(409, "Job lease is expired, completed, or not assigned to this runner.");
  await audit(result.status, id);
  return { id, ...result };
}
