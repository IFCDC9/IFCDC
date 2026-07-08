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
import { logGrantActivity } from "./grantsSchema";

const QUALIFIED_MATCH_THRESHOLD = 60;
const DEFAULT_MIN_SCORE = 40;
const MAX_OPPORTUNITIES_SCANNED = 400;
const DRAFT_BATCH_CONCURRENCY = 3;

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

export function getLatestExecutiveFundingReport(): ExecutiveFundingReport | null {
  return cachedReport;
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
  opts: { actorEmail?: string; minScore: number; concurrency: number }
): Promise<Map<string, { intel: OpportunityIntelligenceScore; row: Record<string, unknown> }>> {
  const scored = new Map<string, { intel: OpportunityIntelligenceScore; row: Record<string, unknown> }>();
  const queue = [...rows];

  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      if (!row) break;
      const id = String(row.id);
      const intel = await scoreOpportunityIntelligence(id, { actorEmail: opts.actorEmail });
      if (!intel || intel.composite < opts.minScore) continue;
      scored.set(id, { intel, row });
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
  opts?: { actorEmail?: string }
): Promise<EnterpriseDraftResult[]> {
  const qualified = entries.filter((e) => e.qualified);
  const results: EnterpriseDraftResult[] = [];

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
}): Promise<{
  report: ExecutiveFundingReport;
  draftResults: EnterpriseDraftResult[];
  pipelineUpdated: number;
}> {
  if (opts?.syncFeeds) {
    try {
      await runGrantIntelligenceSync({ actorEmail: opts.actorEmail });
    } catch {
      /* optional */
    }
  }

  try {
    await enrichAllOpportunities(200);
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
    concurrency: 5,
  });

  const opportunities = Array.from(scored.values())
    .map(({ intel, row }) => toReportEntry(intel, row, kbCoverage))
    .sort((a, b) => b.matchScore - a.matchScore);

  const programEvaluations = buildProgramEvaluations(programs, scored);

  let pipelineUpdated = 0;
  if (opts?.populatePipeline !== false) {
    pipelineUpdated = await populateEnterprisePipeline(opportunities);
  }

  let draftResults: EnterpriseDraftResult[] = [];
  if (opts?.prepareDrafts) {
    draftResults = await prepareQualifiedDrafts(opportunities, { actorEmail: opts?.actorEmail });
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

  return { report, draftResults, pipelineUpdated };
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
