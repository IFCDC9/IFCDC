/**
 * Phase 7 — autonomous production job recovery.
 * Persist plan, scene/asset/provider state, completed generations, timeline, revision
 * so a failure can resume without regenerating completed assets.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const JOBS_DIR = join(ROOT, "IFCDC-PRODUCTIONS", "autonomous-jobs");

function ensure() {
  mkdirSync(JOBS_DIR, { recursive: true });
}

function jobPath(id) {
  return join(JOBS_DIR, `${id}.json`);
}

export function createAutonomousJob(seed = {}) {
  ensure();
  const id = seed.id || `p7_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const job = {
    id,
    phase: 7,
    company: "IFCDC PRODUCTIONS",
    productionCompany: "IFCDC PRODUCTIONS",
    productionIdentity: "IFCDC PRODUCTION",
    publish: false,
    status: "CREATED",
    gate: "FOUNDER_IDEA",
    instruction: seed.instruction || "",
    project: seed.project || null,
    brandPromoted: seed.brandPromoted || null,
    plan: seed.plan || null,
    intake: seed.intake || null,
    sceneState: seed.sceneState || [],
    assetState: seed.assetState || {
      searched: false,
      libraryMatches: [],
      existingToUse: [],
      newRequired: [],
      completedGenerations: [],
    },
    providerJobIds: seed.providerJobIds || [],
    completedGenerations: seed.completedGenerations || [],
    timelineState: seed.timelineState || null,
    revisionState: seed.revisionState || { history: [] },
    cost: seed.cost || { runwayCredits: 0, entries: [] },
    previews: seed.previews || [],
    blockers: seed.blockers || [],
    lastCompletedStep: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(jobPath(id), JSON.stringify(job, null, 2));
  return job;
}

export function readAutonomousJob(id) {
  if (!id) return null;
  const path = jobPath(id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function updateAutonomousJob(id, patch) {
  const job = readAutonomousJob(id);
  if (!job) return null;
  const next = {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  if (patch.assetState) next.assetState = { ...job.assetState, ...patch.assetState };
  if (patch.revisionState) {
    next.revisionState = {
      ...job.revisionState,
      ...patch.revisionState,
      history: patch.revisionState.history || job.revisionState?.history || [],
    };
  }
  if (patch.cost) next.cost = { ...job.cost, ...patch.cost };
  writeFileSync(jobPath(id), JSON.stringify(next, null, 2));
  return next;
}

export function markStepComplete(id, step, extras = {}) {
  return updateAutonomousJob(id, {
    lastCompletedStep: step,
    status: extras.status || "RUNNING",
    gate: extras.gate || undefined,
    ...extras,
  });
}

export function listAutonomousJobs(limit = 30) {
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
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    .slice(0, limit);
}

export function findLatestJobForProject(project) {
  if (!project) return listAutonomousJobs(1)[0] || null;
  return listAutonomousJobs(40).find((j) => j.project === project) || null;
}

/**
 * Resume from stored state: skip completed generations / asset steps.
 * Does not kill Mac processes — reloads JSON and returns continuation plan.
 */
export function resumeAutonomousJob(id) {
  const job = readAutonomousJob(id);
  if (!job) {
    return { ok: false, blocker: "JOB_NOT_FOUND", message: `No autonomous job ${id}` };
  }
  const completed = new Set(
    (job.completedGenerations || []).map((g) => g.capability || g.fileName || g.path).filter(Boolean),
  );
  const existing = (job.assetState?.existingToUse || []).map((a) => a.name || a.path);
  const remainingNeeds = (job.assetState?.newRequired || []).filter((need) => {
    const key = need.capability || need.fileName || need.label;
    return key && !completed.has(key);
  });

  const canContinue =
    Boolean(job.lastCompletedStep) ||
    (job.completedGenerations || []).length > 0 ||
    (job.assetState?.existingToUse || []).length > 0;

  return {
    ok: true,
    jobId: job.id,
    project: job.project,
    status: job.status,
    gate: job.gate,
    lastCompletedStep: job.lastCompletedStep,
    completedGenerations: job.completedGenerations || [],
    existingAssetsReused: existing,
    remainingNeeds,
    timelineState: job.timelineState,
    revisionState: job.revisionState,
    cost: job.cost,
    canContinue,
    resumeFrom: job.lastCompletedStep || "ASSET_SEARCH",
    willNotRegenerate: [...completed],
    publish: false,
    mode: "resume_from_persisted_state",
    proofNote:
      "Job state reloaded from disk; completed assets will be skipped. Failure-outage not required for this proof.",
  };
}
