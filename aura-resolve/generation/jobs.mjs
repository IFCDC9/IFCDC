/**
 * Generation job persistence + bounded retry (Phase 6).
 * Never loses the job. Never runaway-retries. Never silently substitutes incompatible models.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const JOBS_DIR = join(ROOT, "IFCDC-PRODUCTIONS", "generation-jobs");
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

function ensure() {
  mkdirSync(JOBS_DIR, { recursive: true });
}

function jobPath(id) {
  return join(JOBS_DIR, `${id}.json`);
}

export function createGenerationJob({ capability, request = {}, providerHint = null } = {}) {
  ensure();
  const id = `gen_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const job = {
    id,
    capability,
    request: sanitizeRequest(request),
    providerHint,
    status: "QUEUED",
    attempts: [],
    maxAttempts: MAX_ATTEMPTS,
    result: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    publish: false,
    company: "IFCDC PRODUCTIONS",
  };
  writeFileSync(jobPath(id), JSON.stringify(job, null, 2));
  return job;
}

function sanitizeRequest(request) {
  const out = { ...request };
  for (const key of Object.keys(out)) {
    if (/key|token|secret|password|authorization|apiKey/i.test(key)) delete out[key];
    if (Buffer.isBuffer(out[key])) out[key] = `[bytes:${out[key].length}]`;
    if (typeof out[key] === "string" && out[key].length > 4000) out[key] = out[key].slice(0, 4000) + "…";
  }
  return out;
}

export function readGenerationJob(id) {
  const path = jobPath(id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function updateGenerationJob(id, patch) {
  const job = readGenerationJob(id);
  if (!job) return null;
  const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
  writeFileSync(jobPath(id), JSON.stringify(next, null, 2));
  return next;
}

export function listGenerationJobs(limit = 40) {
  ensure();
  return readdirSync(JOBS_DIR)
    .filter((n) => n.endsWith(".json"))
    .map((n) => {
      try {
        return JSON.parse(readFileSync(join(JOBS_DIR, n), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run generate() with persistence + bounded retry across failover chain (handled inside generate).
 */
export async function runGenerationJob(jobId, generateFn) {
  const job = readGenerationJob(jobId);
  if (!job) return { ok: false, status: "JOB_NOT_FOUND", blocker: "JOB_NOT_FOUND" };
  if (job.status === "SUCCEEDED" && job.result?.ok) return job.result;

  updateGenerationJob(jobId, { status: "RUNNING" });

  let last = null;
  for (let i = 0; i < (job.maxAttempts || MAX_ATTEMPTS); i++) {
    const started = new Date().toISOString();
    try {
      last = await generateFn(job.capability, job.request || {});
      const attempt = {
        n: i + 1,
        at: started,
        finishedAt: new Date().toISOString(),
        provider: last?.provider || null,
        status: last?.status || (last?.ok ? "GENERATED" : "FAILED"),
        blocker: last?.blocker || null,
        ok: Boolean(last?.ok),
      };
      const attempts = [...(readGenerationJob(jobId)?.attempts || []), attempt];
      if (last?.ok) {
        updateGenerationJob(jobId, { status: "SUCCEEDED", attempts, result: last });
        return last;
      }
      updateGenerationJob(jobId, { status: "RETRYING", attempts, result: last });
      // Do not retry hard NOT_CONFIGURED / missing credential — precise dependency.
      if (/NOT_CONFIGURED|MISSING_PROVIDER|MISSING_CREDENTIAL|MISSING_MODEL_ACCESS|FOUNDATION_MEDIA/i.test(
        String(last?.blocker || last?.status || ""),
      )) {
        updateGenerationJob(jobId, { status: "FAILED_DEPENDENCY", attempts, result: last });
        return last;
      }
      if (i < (job.maxAttempts || MAX_ATTEMPTS) - 1) await sleep(RETRY_DELAY_MS * (i + 1));
    } catch (error) {
      last = {
        ok: false,
        status: "FAILED",
        blocker: `PROVIDER_ERROR:${job.capability}`,
        reason: String(error?.message || error).slice(0, 400),
      };
      const attempts = [
        ...(readGenerationJob(jobId)?.attempts || []),
        { n: i + 1, at: started, status: "FAILED", reason: last.reason, ok: false },
      ];
      updateGenerationJob(jobId, { status: "RETRYING", attempts, result: last });
      if (i < (job.maxAttempts || MAX_ATTEMPTS) - 1) await sleep(RETRY_DELAY_MS * (i + 1));
    }
  }

  updateGenerationJob(jobId, { status: "FAILED", result: last });
  return last || { ok: false, status: "FAILED", blocker: `JOB_FAILED:${job.capability}` };
}

export const GENERATION_JOB_LIMITS = { MAX_ATTEMPTS, RETRY_DELAY_MS };
