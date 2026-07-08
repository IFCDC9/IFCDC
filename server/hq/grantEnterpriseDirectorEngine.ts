/**
 * AURA Enterprise Grants Director — org-wide funding scan, executive report,
 * pipeline population, and qualified draft preparation (founder approval required).
 */
import { getDb } from "../db";
import { productionGrantOpportunitySqlFilter } from "./grantProductionPolicy";
import { getKnowledgeBaseStatus } from "./knowledgeBaseEngine";
import { loadHqProgramRegistry, resolvePipelineStage, syncAllPipelineStages } from "./grantFundingPipelineEngine";
import { runGrantIntelligenceSync, enrichAllOpportunities } from "./grantIntelligenceEngine";
import {
  IFCDC_PROGRAM_CATALOG,
  inferProgramMatches,
  scoreOpportunityIntelligence,
  startGrantApplicationWorkflow,
  generateFullProposalDraft,
  type OpportunityIntelligenceScore,
  type OrgWideGrantMatch,
} from "./grantIntelligenceEngine";
import { grantId, logGrantActivity } from "./grantsSchema";

const QUALIFIED_MATCH_THRESHOLD = 60;
const DEFAULT_MIN_SCORE = 40;
/** Cap live scan so scoring stays within background-job latency budgets. */
const MAX_OPPORTUNITIES_SCANNED = 120;
const DRAFT_BATCH_CONCURRENCY = 2;
/** Cap how many full proposal drafts are queued in one enterprise run. */
const MAX_DRAFTS_PER_SCAN = 8;
const ENRICH_LIMIT = 80;

export type EnterpriseJobPhase =
  | "queued"
  | "syncing_feeds"
  | "scoring"
  | "building_report"
  | "populating_pipeline"
  | "preparing_drafts"
  | "completed"
  | "failed";

export type EnterpriseFundingJob = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  phase: EnterpriseJobPhase;
  progress: number;
  message: string;
  steps: { phase: EnterpriseJobPhase; label: string; status: "pending" | "active" | "done" | "error" }[];
  report: ExecutiveFundingReport | null;
  draftResults: EnterpriseDraftResult[];
  pipelineUpdated: number;
  error: string | null;
  actorEmail: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ExecutiveFundingReportEntry = {
  opportunityId: string;
  title: string;
  fundingAgency: string;
  awardAmountMin: number | null;
  awardAmountMax: number | null;
  awardAmountLabel: string;
  deadline: string | null;
  daysUntilDeadline: number | null;
  matchScore: number;
  probabilityOfSuccess: number;
  organizationalReadiness: number;
  organizationalReadinessGrade: string;
  requiredDocuments: string[];
  recommendedPriority: "high" | "medium" | "low";
  programAssignment: { slug: string; label: string; score: number };
  alternatePrograms: { slug: string; label: string }[];
  pipelineStage: string;
  qualified: boolean;
  url: string | null;
  recommendedNextStep: string;
};

export type ProgramEvaluationSummary = {
  programSlug: string;
  programLabel: string;
  evaluated: boolean;
  matchingOpportunities: number;
  qualifiedOpportunities: number;
  topMatchScore: number | null;
};

export type ExecutiveFundingReport = {
  opportunities: ExecutiveFundingReportEntry[];
  programEvaluations: ProgramEvaluationSummary[];
  totals: {
    programsEvaluated: number;
    opportunitiesScored: number;
    matchingGrants: number;
    qualifiedGrants: number;
    pipelineUpdated: number;
    draftsPrepared: number;
  };
  generatedAt: string;
  actorEmail: string | null;
  mode: "enterprise";
};

export type EnterpriseDraftResult = {
  opportunityId: string;
  title: string;
  applicationId?: string;
  draftJobId?: string;
  ok: boolean;
  error?: string;
};

let cachedReport: ExecutiveFundingReport | null = null;
const enterpriseJobs = new Map<string, EnterpriseFundingJob>();
let enterpriseTablesReady = false;

export function getLatestExecutiveFundingReport(): ExecutiveFundingReport | null {
  return cachedReport;
}

async function ensureEnterpriseJobTables(): Promise<void> {
  if (enterpriseTablesReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_enterprise_scan_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      steps_json TEXT,
      report_json TEXT,
      draft_results_json TEXT,
      pipeline_updated INTEGER DEFAULT 0,
      error TEXT,
      actor_email TEXT,
      options_json TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_enterprise_jobs_status ON grant_enterprise_scan_jobs(status);
  `);
  enterpriseTablesReady = true;
}

function defaultSteps(): EnterpriseFundingJob["steps"] {
  return [
    { phase: "syncing_feeds", label: "Sync Grants.gov + SAM.gov", status: "pending" },
    { phase: "scoring", label: "Score opportunities across all programs", status: "pending" },
    { phase: "building_report", label: "Build Executive Funding Report", status: "pending" },
    { phase: "populating_pipeline", label: "Populate Enterprise Funding Pipeline", status: "pending" },
    { phase: "preparing_drafts", label: "Queue Grant Writer Studio drafts", status: "pending" },
  ];
}

function serializeJob(job: EnterpriseFundingJob) {
  return {
    jobId: job.jobId,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    steps: job.steps,
    report: job.report,
    draftResults: job.draftResults,
    pipelineUpdated: job.pipelineUpdated,
    error: job.error,
    actorEmail: job.actorEmail,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

async function persistJob(job: EnterpriseFundingJob, options?: Record<string, unknown>): Promise<void> {
  await ensureEnterpriseJobTables();
  const db = await getDb();
  await db.run(
    `INSERT INTO grant_enterprise_scan_jobs (
      id, status, phase, progress, message, steps_json, report_json, draft_results_json,
      pipeline_updated, error, actor_email, options_json, started_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      phase = excluded.phase,
      progress = excluded.progress,
      message = excluded.message,
      steps_json = excluded.steps_json,
      report_json = excluded.report_json,
      draft_results_json = excluded.draft_results_json,
      pipeline_updated = excluded.pipeline_updated,
      error = excluded.error,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at`,
    job.jobId,
    job.status,
    job.phase,
    job.progress,
    job.message,
    JSON.stringify(job.steps),
    job.report ? JSON.stringify(job.report) : null,
    JSON.stringify(job.draftResults),
    job.pipelineUpdated,
    job.error,
    job.actorEmail,
    options ? JSON.stringify(options) : null,
    job.startedAt,
    job.updatedAt,
    job.completedAt
  );
}

async function updateJobProgress(
  job: EnterpriseFundingJob,
  patch: Partial<Pick<EnterpriseFundingJob, "status" | "phase" | "progress" | "message" | "error" | "report" | "draftResults" | "pipelineUpdated" | "completedAt">>
): Promise<void> {
  Object.assign(job, patch);
  job.updatedAt = new Date().toISOString();
  if (patch.phase) {
    for (const step of job.steps) {
      if (step.phase === patch.phase) step.status = "active";
      else if (
        ["syncing_feeds", "scoring", "building_report", "populating_pipeline", "preparing_drafts"].indexOf(step.phase)
        < ["syncing_feeds", "scoring", "building_report", "populating_pipeline", "preparing_drafts"].indexOf(patch.phase)
      ) {
        if (step.status !== "error") step.status = "done";
      }
    }
  }
  if (patch.status === "completed") {
    for (const step of job.steps) {
      if (step.status !== "error") step.status = "done";
    }
  }
  if (patch.status === "failed" && patch.phase) {
    const active = job.steps.find((s) => s.phase === patch.phase);
    if (active) active.status = "error";
  }
  enterpriseJobs.set(job.jobId, job);
  await persistJob(job);
}

export function isEnterpriseFundingQuery(question: string): boolean {
  const q = question.trim().toLowerCase();
  return (
    /enterprise mode|executive funding report|director of grants|full.?time grant|grant director/.test(q)
    || /scan all program|every program|every division|all initiative|all department/.test(q)
    || /complete funding report|full organization scan|org.?wide scan|evaluate every/.test(q)
    || /populate.*pipeline|enterprise funding pipeline/.test(q)
    || (/whole ifcdc|entire organization|all program/.test(q) && /report|scan|evaluate|director|enterprise/.test(q))
  );
}

function formatFundingAmount(min: number | null, max: number | null): string {
  if (max != null && min != null && min !== max) return `$${min.toLocaleString()} – $${max.toLocaleString()}`;
  if (max != null) return `Up to $${max.toLocaleString()}`;
  if (min != null) return `From $${min.toLocaleString()}`;
  return "Amount TBD";
}

function recommendNextStep(intel: OpportunityIntelligenceScore): string {
  if (intel.composite >= 75 && intel.priority === "high") {
    return "Start application draft and schedule founder review";
  }
  if (intel.composite >= 60) {
    return "Review eligibility requirements and begin narrative outline";
  }
  if (intel.daysUntilDeadline != null && intel.daysUntilDeadline <= 14) {
    return "Urgent: confirm eligibility and assign writer within 48 hours";
  }
  return "Add to watchlist — monitor deadline and gather required documents";
}

function computeOrganizationalReadiness(
  intel: OpportunityIntelligenceScore,
  kbCoverage: number
): { score: number; grade: string } {
  const score = Math.round(intel.eligibility * 0.4 + intel.strategicFit * 0.35 + kbCoverage * 0.25);
  const grade =
    score >= 85 ? "Ready to Pursue"
    : score >= 70 ? "Strong Capacity"
    : score >= 55 ? "Moderate Capacity"
    : score >= 40 ? "Capacity Gaps"
    : "Not Ready";
  return { score, grade };
}

function resolveBestProgramAssignment(
  intel: OpportunityIntelligenceScore,
  row: Record<string, unknown>
): { slug: string; label: string; score: number } {
  const best = intel.matchedPrograms[0];
  if (best) return { slug: best.slug, label: best.label, score: best.score };
  const inferred = inferProgramMatches(row);
  const slug = inferred.divisionSlugs[0] ?? "headquarters";
  const label = IFCDC_PROGRAM_CATALOG.find((p) => p.slug === slug)?.label ?? slug.replace(/_/g, " ");
  return { slug, label, score: intel.composite };
}

function toReportEntry(
  intel: OpportunityIntelligenceScore,
  row: Record<string, unknown>,
  kbCoverage: number
): ExecutiveFundingReportEntry {
  const programAssignment = resolveBestProgramAssignment(intel, row);
  const readiness = computeOrganizationalReadiness(intel, kbCoverage);
  const pipelineStage = resolvePipelineStage("opportunity", row, intel.composite);

  return {
    opportunityId: intel.opportunityId,
    title: String(row.title ?? ""),
    fundingAgency: String(row.funder ?? ""),
    awardAmountMin: intel.fundingAmount.min,
    awardAmountMax: intel.fundingAmount.max,
    awardAmountLabel: formatFundingAmount(intel.fundingAmount.min, intel.fundingAmount.max),
    deadline: intel.deadline,
    daysUntilDeadline: intel.daysUntilDeadline,
    matchScore: intel.composite,
    probabilityOfSuccess: intel.awardProbability,
    organizationalReadiness: readiness.score,
    organizationalReadinessGrade: readiness.grade,
    requiredDocuments: intel.requiredAttachments,
    recommendedPriority: intel.priority,
    programAssignment,
    alternatePrograms: intel.matchedPrograms.slice(1, 4).map((p) => ({ slug: p.slug, label: p.label })),
    pipelineStage,
    qualified: intel.composite >= QUALIFIED_MATCH_THRESHOLD,
    url: row.url ? String(row.url) : null,
    recommendedNextStep: recommendNextStep(intel),
  };
}

export function toOrgWideGrantMatch(entry: ExecutiveFundingReportEntry): OrgWideGrantMatch {
  return {
    opportunityId: entry.opportunityId,
    title: entry.title,
    funder: entry.fundingAgency,
    bestProgram: entry.programAssignment,
    eligibility: {
      score: entry.organizationalReadiness,
      grade: entry.organizationalReadinessGrade,
    },
    fundingAmount: { min: entry.awardAmountMin, max: entry.awardAmountMax },
    deadline: entry.deadline,
    daysUntilDeadline: entry.daysUntilDeadline,
    requiredDocuments: entry.requiredDocuments,
    matchScore: entry.matchScore,
    priority: entry.recommendedPriority,
    estimatedEffort: entry.matchScore >= 70 ? "high" : entry.matchScore >= 55 ? "medium" : "low",
    recommendedNextStep: entry.recommendedNextStep,
    url: entry.url,
  };
}

async function scoreOpportunitiesInBatches(
  rows: Record<string, unknown>[],
  opts: {
    actorEmail?: string;
    minScore: number;
    concurrency: number;
    onProgress?: (done: number, total: number) => void | Promise<void>;
  }
): Promise<Map<string, { intel: OpportunityIntelligenceScore; row: Record<string, unknown> }>> {
  const scored = new Map<string, { intel: OpportunityIntelligenceScore; row: Record<string, unknown> }>();
  const queue = [...rows];
  const total = rows.length;
  let done = 0;

  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      if (!row) break;
      const id = String(row.id);
      try {
        const intel = await scoreOpportunityIntelligence(id, { actorEmail: opts.actorEmail });
        if (intel && intel.composite >= opts.minScore) {
          scored.set(id, { intel, row });
        }
      } catch (err) {
        console.warn(
          `[enterprise-scan] score failed for ${id}:`,
          err instanceof Error ? err.message : err
        );
      }
      done += 1;
      if (opts.onProgress && (done % 5 === 0 || done === total)) {
        await opts.onProgress(done, total);
      }
    }
  }

  const workers = Array.from({ length: Math.min(opts.concurrency, rows.length || 1) }, () => worker());
  await Promise.all(workers);
  return scored;
}

function buildProgramEvaluations(
  programs: { slug: string; label: string }[],
  scored: Map<string, { intel: OpportunityIntelligenceScore; row: Record<string, unknown> }>
): ProgramEvaluationSummary[] {
  return programs.map((prog) => {
    let matching = 0;
    let qualified = 0;
    let top: number | null = null;

    for (const { intel, row } of Array.from(scored.values())) {
      const inferred = inferProgramMatches(row);
      const matchesProgram =
        intel.matchedPrograms.some((p: { slug: string }) => p.slug === prog.slug)
        || inferred.divisionSlugs.includes(prog.slug)
        || String(row.division_slugs ?? "").includes(prog.slug)
        || String(row.program_areas ?? "").includes(prog.slug);

      if (!matchesProgram) continue;
      matching++;
      if (intel.composite >= QUALIFIED_MATCH_THRESHOLD) qualified++;
      top = top == null ? intel.composite : Math.max(top, intel.composite);
    }

    return {
      programSlug: prog.slug,
      programLabel: prog.label,
      evaluated: true,
      matchingOpportunities: matching,
      qualifiedOpportunities: qualified,
      topMatchScore: top,
    };
  });
}

async function populateEnterprisePipeline(entries: ExecutiveFundingReportEntry[]): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  let updated = 0;

  for (const entry of entries) {
    const stage =
      entry.matchScore >= 75 ? "qualified"
      : entry.matchScore >= 55 ? "matched"
      : "discovered";
    const fundingStatus = entry.qualified ? "eligible" : "reviewing";
    const lifecycle = entry.qualified ? "eligibility_review" : "identified";

    const result = await db.run(
      `UPDATE grant_opportunities
       SET pipeline_stage = ?, funding_status = ?, lifecycle_stage = ?, updated_at = ?
       WHERE id = ?`,
      stage,
      fundingStatus,
      lifecycle,
      now,
      entry.opportunityId
    );
    updated += result.changes ?? 0;
  }

  updated += await syncAllPipelineStages();
  return updated;
}

async function prepareQualifiedDrafts(
  entries: ExecutiveFundingReportEntry[],
  opts?: { actorEmail?: string; maxDrafts?: number; onProgress?: (done: number, total: number) => void | Promise<void> }
): Promise<EnterpriseDraftResult[]> {
  const qualified = entries
    .filter((e) => e.qualified)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, opts?.maxDrafts ?? MAX_DRAFTS_PER_SCAN);
  const results: EnterpriseDraftResult[] = [];
  let done = 0;

  for (let i = 0; i < qualified.length; i += DRAFT_BATCH_CONCURRENCY) {
    const batch = qualified.slice(i, i + DRAFT_BATCH_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        try {
          const workflow = await startGrantApplicationWorkflow(entry.opportunityId, {
            actorEmail: opts?.actorEmail,
            generateDrafts: false,
          });
          if (!workflow.ok || !workflow.applicationId) {
            return {
              opportunityId: entry.opportunityId,
              title: entry.title,
              ok: false,
              error: workflow.error ?? "Could not start application workspace",
            };
          }

          const draftJob = await generateFullProposalDraft(workflow.applicationId, {
            actorEmail: opts?.actorEmail,
          });

          await logGrantActivity(
            "application",
            workflow.applicationId,
            "enterprise_draft_queued",
            entry.title,
            opts?.actorEmail
          );

          return {
            opportunityId: entry.opportunityId,
            title: entry.title,
            applicationId: workflow.applicationId,
            draftJobId: (draftJob as { jobId?: string }).jobId,
            ok: true,
          };
        } catch (err) {
          return {
            opportunityId: entry.opportunityId,
            title: entry.title,
            ok: false,
            error: err instanceof Error ? err.message : "Draft preparation failed",
          };
        }
      })
    );
    results.push(...batchResults);
    done += batch.length;
    await opts?.onProgress?.(done, qualified.length);
  }

  return results;
}

/** Full org-wide enterprise funding scan — every program, department, and initiative. */
export async function runEnterpriseFundingScan(opts?: {
  actorEmail?: string;
  syncFeeds?: boolean;
  populatePipeline?: boolean;
  prepareDrafts?: boolean;
  minScore?: number;
  maxOpportunities?: number;
  onProgress?: (update: { phase: EnterpriseJobPhase; progress: number; message: string }) => void | Promise<void>;
}): Promise<{
  report: ExecutiveFundingReport;
  draftResults: EnterpriseDraftResult[];
  pipelineUpdated: number;
}> {
  const notify = async (phase: EnterpriseJobPhase, progress: number, message: string) => {
    await opts?.onProgress?.({ phase, progress, message });
  };

  if (opts?.syncFeeds) {
    await notify("syncing_feeds", 5, "Refreshing Grants.gov and SAM.gov live feeds…");
    try {
      await Promise.race([
        runGrantIntelligenceSync({ actorEmail: opts.actorEmail }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Feed sync timeout")), 90_000)),
      ]);
    } catch (err) {
      console.warn(
        "[enterprise-scan] feed sync skipped:",
        err instanceof Error ? err.message : err
      );
    }
  }

  await notify("scoring", 15, "Enriching and scoring live opportunities…");
  try {
    await enrichAllOpportunities(ENRICH_LIMIT);
  } catch {
    /* optional */
  }

  const db = await getDb();
  const minScore = opts?.minScore ?? DEFAULT_MIN_SCORE;
  const maxOpps = opts?.maxOpportunities ?? MAX_OPPORTUNITIES_SCANNED;
  const programs = await loadHqProgramRegistry();
  const kb = await getKnowledgeBaseStatus();
  const kbCoverage = Math.min(100, Math.round(((kb.embedded ?? 0) / Math.max(kb.total ?? 1, 1)) * 100));

  const rows = (await db.all(
    `SELECT o.* FROM grant_opportunities o
     WHERE o.status IN ('open','active','researching')${productionGrantOpportunitySqlFilter("o")}
     ORDER BY o.updated_at DESC LIMIT ?`,
    maxOpps
  )) as Record<string, unknown>[];

  const scored = await scoreOpportunitiesInBatches(rows, {
    actorEmail: opts?.actorEmail,
    minScore,
    concurrency: 8,
    onProgress: async (done, total) => {
      const pct = 15 + Math.round((done / Math.max(total, 1)) * 50);
      await notify("scoring", pct, `Scored ${done}/${total} live opportunities…`);
    },
  });

  await notify("building_report", 70, "Building Executive Funding Report…");
  const opportunities = Array.from(scored.values())
    .map(({ intel, row }) => toReportEntry(intel, row, kbCoverage))
    .sort((a, b) => b.matchScore - a.matchScore);

  const programEvaluations = buildProgramEvaluations(programs, scored);

  let pipelineUpdated = 0;
  if (opts?.populatePipeline !== false) {
    await notify("populating_pipeline", 78, "Populating Enterprise Funding Pipeline…");
    pipelineUpdated = await populateEnterprisePipeline(opportunities);
  }

  let draftResults: EnterpriseDraftResult[] = [];
  if (opts?.prepareDrafts) {
    await notify("preparing_drafts", 85, "Queuing Grant Writer Studio drafts for qualified matches…");
    draftResults = await prepareQualifiedDrafts(opportunities, {
      actorEmail: opts?.actorEmail,
      maxDrafts: MAX_DRAFTS_PER_SCAN,
      onProgress: async (done, total) => {
        const pct = 85 + Math.round((done / Math.max(total, 1)) * 12);
        await notify("preparing_drafts", pct, `Queued drafts ${done}/${total}…`);
      },
    });
  }

  const report: ExecutiveFundingReport = {
    opportunities,
    programEvaluations,
    totals: {
      programsEvaluated: programEvaluations.length,
      opportunitiesScored: rows.length,
      matchingGrants: opportunities.length,
      qualifiedGrants: opportunities.filter((o) => o.qualified).length,
      pipelineUpdated,
      draftsPrepared: draftResults.filter((d) => d.ok).length,
    },
    generatedAt: new Date().toISOString(),
    actorEmail: opts?.actorEmail ?? null,
    mode: "enterprise",
  };

  cachedReport = report;

  try {
    const { notifyHqDataChange } = await import("./hqRealtimeEvents");
    notifyHqDataChange("grants");
  } catch {
    /* optional */
  }

  await notify("completed", 100, "Enterprise Funding Report ready for founder review.");
  return { report, draftResults, pipelineUpdated };
}

/** Start enterprise scan as a background job — returns immediately with progress handle. */
export async function startEnterpriseFundingScanJob(opts?: {
  actorEmail?: string;
  syncFeeds?: boolean;
  populatePipeline?: boolean;
  prepareDrafts?: boolean;
  minScore?: number;
  maxOpportunities?: number;
}): Promise<{ jobId: string; status: string; message: string }> {
  await ensureEnterpriseJobTables();
  const now = new Date().toISOString();
  const jobId = grantId();
  const job: EnterpriseFundingJob = {
    jobId,
    status: "queued",
    phase: "queued",
    progress: 0,
    message: "Enterprise scan accepted — AURA is starting live funding research now.",
    steps: defaultSteps(),
    report: null,
    draftResults: [],
    pipelineUpdated: 0,
    error: null,
    actorEmail: opts?.actorEmail ?? null,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
  };
  enterpriseJobs.set(jobId, job);
  await persistJob(job, opts as Record<string, unknown>);

  void (async () => {
    try {
      await updateJobProgress(job, {
        status: "running",
        phase: "syncing_feeds",
        progress: 2,
        message: "Enterprise mode engaged — syncing live federal feeds…",
      });

      const result = await runEnterpriseFundingScan({
        ...opts,
        onProgress: async ({ phase, progress, message }) => {
          await updateJobProgress(job, { phase, progress, message, status: "running" });
        },
      });

      await updateJobProgress(job, {
        status: "completed",
        phase: "completed",
        progress: 100,
        message: `Ready: ${result.report.totals.matchingGrants} matches · ${result.report.totals.draftsPrepared} drafts queued for founder review.`,
        report: result.report,
        draftResults: result.draftResults,
        pipelineUpdated: result.pipelineUpdated,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Enterprise funding scan failed";
      console.error("[enterprise-scan] job failed:", message);
      await updateJobProgress(job, {
        status: "failed",
        phase: "failed",
        progress: job.progress,
        message,
        error: message,
        completedAt: new Date().toISOString(),
      });
    }
  })();

  return {
    jobId,
    status: "queued",
    message: job.message,
  };
}

export async function getEnterpriseFundingJob(jobId: string): Promise<EnterpriseFundingJob | null> {
  const cached = enterpriseJobs.get(jobId);
  if (cached) return serializeJob(cached) as EnterpriseFundingJob;

  await ensureEnterpriseJobTables();
  const db = await getDb();
  const row = await db.get<Record<string, unknown>>(
    "SELECT * FROM grant_enterprise_scan_jobs WHERE id = ?",
    jobId
  );
  if (!row) return null;

  const parseJson = <T>(raw: unknown, fallback: T): T => {
    if (!raw) return fallback;
    try {
      return JSON.parse(String(raw)) as T;
    } catch {
      return fallback;
    }
  };

  const job: EnterpriseFundingJob = {
    jobId: String(row.id),
    status: String(row.status) as EnterpriseFundingJob["status"],
    phase: String(row.phase) as EnterpriseJobPhase,
    progress: Number(row.progress ?? 0),
    message: String(row.message ?? ""),
    steps: parseJson(row.steps_json, defaultSteps()),
    report: parseJson(row.report_json, null),
    draftResults: parseJson(row.draft_results_json, []),
    pipelineUpdated: Number(row.pipeline_updated ?? 0),
    error: row.error ? String(row.error) : null,
    actorEmail: row.actor_email ? String(row.actor_email) : null,
    startedAt: String(row.started_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
  enterpriseJobs.set(jobId, job);
  return serializeJob(job) as EnterpriseFundingJob;
}

export function formatEnterpriseJobAck(jobId: string, prepareDrafts: boolean): string {
  return [
    "## Enterprise Mode Started",
    "",
    "AURA acknowledged your request and is running as IFCDC's Director of Grants in the background.",
    "",
    "**Live pipeline in progress:**",
    "1. Sync Grants.gov + SAM.gov",
    "2. Score opportunities across every program, department, and initiative",
    "3. Build the Executive Funding Report",
    "4. Populate the Enterprise Funding Pipeline",
    prepareDrafts
      ? "5. Queue Grant Writer Studio drafts for qualified opportunities"
      : "5. Skip draft generation unless you request proposals",
    "",
    `Job ID: \`${jobId}\``,
    "",
    "I will keep updating progress. When finished, the complete report will be ready — drafts require **Founder Review** before any submission.",
  ].join("\n");
}

export function formatExecutiveFundingReportAnswer(
  report: ExecutiveFundingReport,
  opts?: { includeDrafts?: boolean }
): string {
  const { totals, opportunities, programEvaluations } = report;
  const lines: string[] = [
    "## Executive Funding Report — IFCDC Enterprise Mode",
    "",
    `Scanned **${totals.opportunitiesScored}** live opportunities across **${totals.programsEvaluated}** programs, departments, and initiatives.`,
    `**${totals.matchingGrants}** matching grants identified · **${totals.qualifiedGrants}** qualified for pursuit.`,
  ];

  if (opts?.includeDrafts) {
    lines.push(
      `Enterprise Funding Pipeline updated (**${totals.pipelineUpdated}** records) · **${totals.draftsPrepared}** draft proposals queued for founder review.`
    );
  } else {
    lines.push(`Enterprise Funding Pipeline updated (**${totals.pipelineUpdated}** records).`);
  }

  lines.push("", "### Program & Initiative Coverage");
  for (const prog of programEvaluations.filter((p) => p.matchingOpportunities > 0).slice(0, 20)) {
    lines.push(
      `• **${prog.programLabel}** — ${prog.matchingOpportunities} match${prog.matchingOpportunities === 1 ? "" : "es"} (${prog.qualifiedOpportunities} qualified${prog.topMatchScore != null ? `, top ${prog.topMatchScore}%` : ""})`
    );
  }

  const unevaluated = programEvaluations.filter((p) => p.matchingOpportunities === 0);
  if (unevaluated.length) {
    lines.push(`• ${unevaluated.length} additional programs evaluated — no live matches above threshold at this time.`);
  }

  lines.push("", "### All Matching Grants");
  for (const o of opportunities) {
    const dl = o.deadline ? new Date(o.deadline).toLocaleDateString() : "rolling/TBD";
    const docs = o.requiredDocuments.slice(0, 4).join("; ") + (o.requiredDocuments.length > 4 ? "…" : "");
    lines.push(
      `• **${o.title}**`,
      `  Agency: ${o.fundingAgency} | Award: ${o.awardAmountLabel} | Due: ${dl}`,
      `  Match: ${o.matchScore}% | Success probability: ${o.probabilityOfSuccess}% | Readiness: ${o.organizationalReadiness}% (${o.organizationalReadinessGrade})`,
      `  Priority: ${o.recommendedPriority.toUpperCase()} → **${o.programAssignment.label}** | Pipeline: ${o.pipelineStage}`,
      `  Documents: ${docs}`,
      `  Next: ${o.recommendedNextStep}`,
      ""
    );
  }

  lines.push(
    "⚠ **Founder Review required** before any grant is submitted to a funder. AURA prepares drafts — you approve every submission."
  );
  return lines.join("\n");
}
