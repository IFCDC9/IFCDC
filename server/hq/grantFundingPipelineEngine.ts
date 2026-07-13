/**
 * Enterprise Funding Pipeline — live discovery, 12-stage workflow, metrics, founder command, notifications.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { logGrantActivity } from "./grantsSchema";
import { productionGrantOpportunitySqlFilter } from "./grantProductionPolicy";
import {
  enrichAllOpportunities,
  enrichMissingDeadlines,
  scoreOpportunityIntelligence,
  setFounderApproval,
  IFCDC_PROGRAM_CATALOG,
} from "./grantIntelligenceEngine";
import { syncGrantFeeds } from "./grantFeedConnectors";
import { enqueueNotification } from "./notificationQueue";
import { logHqAudit } from "./hqAuditLog";

export const FUNDING_PIPELINE_STAGES = [
  "discovered",
  "matched",
  "qualified",
  "drafting",
  "internal_review",
  "founder_approval",
  "ready_for_submission",
  "submitted",
  "under_review",
  "awarded",
  "declined",
  "closed",
] as const;

export type FundingPipelineStage = (typeof FUNDING_PIPELINE_STAGES)[number];

export const FUNDING_PIPELINE_LABELS: Record<FundingPipelineStage, string> = {
  discovered: "Opportunity Identified",
  matched: "Under Review",
  qualified: "Eligibility Verified",
  drafting: "Application In Progress",
  internal_review: "Internal Review",
  founder_approval: "Founder Approval",
  ready_for_submission: "Ready for Submission",
  submitted: "Submitted",
  under_review: "Under Evaluation",
  awarded: "Awarded",
  declined: "Declined",
  closed: "Closed",
};

const STAGE_TRANSITIONS: Record<string, FundingPipelineStage[]> = {
  discovered: ["matched", "qualified", "closed"],
  matched: ["discovered", "qualified", "drafting", "closed"],
  qualified: ["matched", "drafting", "closed"],
  drafting: ["qualified", "internal_review", "founder_approval", "closed"],
  internal_review: ["drafting", "founder_approval", "declined"],
  founder_approval: ["internal_review", "ready_for_submission", "declined"],
  ready_for_submission: ["founder_approval", "submitted", "declined"],
  submitted: ["ready_for_submission", "under_review", "declined"],
  under_review: ["submitted", "awarded", "declined"],
  awarded: ["closed"],
  declined: ["closed", "discovered"],
  closed: ["discovered"],
};

function parseJsonArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Resolve pipeline stage from entity state (uses pipeline_stage column when set). */
export function resolvePipelineStage(
  entityType: "opportunity" | "application" | "award",
  row: Record<string, unknown>,
  matchScore = 0
): FundingPipelineStage {
  const explicit = row.pipeline_stage ? String(row.pipeline_stage) : null;
  if (explicit && FUNDING_PIPELINE_STAGES.includes(explicit as FundingPipelineStage)) {
    return explicit as FundingPipelineStage;
  }

  if (entityType === "award") {
    return row.status === "closed" ? "closed" : "awarded";
  }

  if (entityType === "application") {
    const status = String(row.status ?? "draft");
    const founder = String(row.founder_approval_status ?? "pending");
    const ready = Number(row.ready_to_submit ?? 0) === 1;
    if (status === "awarded") return "awarded";
    if (status === "denied") return "declined";
    if (status === "under_review") return "under_review";
    if (status === "submitted") return "submitted";
    if (founder === "approved" && ready) return "ready_for_submission";
    if (founder === "approved") return "founder_approval";
    if (founder === "rejected") return "declined";
    if (status === "draft" && founder === "changes_requested") return "internal_review";
    if (status === "draft") return "drafting";
    return "drafting";
  }

  const status = String(row.status ?? "open");
  const fundingStatus = String(row.funding_status ?? "identified");
  if (status === "closed") return "closed";
  if (fundingStatus === "awarded") return "awarded";
  if (fundingStatus === "declined" || fundingStatus === "denied") return "declined";
  if (fundingStatus === "submitted") return "submitted";
  if (matchScore >= 75 || fundingStatus === "eligible") return "qualified";
  if (matchScore >= 55 || fundingStatus === "reviewing") return "matched";
  return "discovered";
}

/** Bulk stage sync — used only by scheduled/manual sync, never on dashboard reads. */
export async function syncAllPipelineStages(): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  let updated = 0;
  const prodFilter = productionGrantOpportunitySqlFilter();

  const closed = await db.run(
    `UPDATE grant_opportunities SET status = 'closed', pipeline_stage = 'closed', updated_at = ?
     WHERE deadline IS NOT NULL AND deadline < date('now') AND status IN ('open','active','researching')
     AND pipeline_stage NOT IN ('awarded','closed')${prodFilter}`,
    now
  );
  updated += closed.changes ?? 0;

  const fromFunding = await db.run(
    `UPDATE grant_opportunities SET pipeline_stage = CASE
       WHEN status = 'closed' THEN 'closed'
       WHEN funding_status = 'awarded' THEN 'awarded'
       WHEN funding_status IN ('declined','denied') THEN 'declined'
       WHEN funding_status = 'submitted' THEN 'submitted'
       WHEN funding_status = 'eligible' THEN 'qualified'
       WHEN funding_status = 'reviewing' THEN 'matched'
       ELSE pipeline_stage
     END, updated_at = ?
     WHERE pipeline_stage IS NULL OR funding_status IN ('awarded','declined','denied','submitted','eligible','reviewing')${prodFilter}`,
    now
  );
  updated += fromFunding.changes ?? 0;

  const qualified = await db.run(
    `UPDATE grant_opportunities SET pipeline_stage = 'qualified', updated_at = ?
     WHERE status IN ('open','active','researching') AND pipeline_stage IN ('discovered','matched')
     AND id IN (
       SELECT opportunity_id FROM grant_opportunity_scores WHERE composite_score >= 75
     )${prodFilter}`,
    now
  );
  updated += qualified.changes ?? 0;

  const matched = await db.run(
    `UPDATE grant_opportunities SET pipeline_stage = 'matched', updated_at = ?
     WHERE status IN ('open','active','researching') AND pipeline_stage = 'discovered'
     AND id IN (
       SELECT opportunity_id FROM grant_opportunity_scores WHERE composite_score >= 55 AND composite_score < 75
     )${prodFilter}`,
    now
  );
  updated += matched.changes ?? 0;

  const discovered = await db.run(
    `UPDATE grant_opportunities SET pipeline_stage = 'discovered', updated_at = ?
     WHERE pipeline_stage IS NULL AND status IN ('open','active','researching')${prodFilter}`,
    now
  );
  updated += discovered.changes ?? 0;

  const apps = await db.run(
    `UPDATE grant_applications SET
       pipeline_stage = CASE
         WHEN status = 'awarded' THEN 'awarded'
         WHEN status = 'denied' THEN 'declined'
         WHEN status = 'under_review' THEN 'under_review'
         WHEN status = 'submitted' THEN 'submitted'
         WHEN founder_approval_status = 'approved' AND COALESCE(ready_to_submit, 0) = 1 THEN 'ready_for_submission'
         WHEN founder_approval_status = 'approved' THEN 'founder_approval'
         WHEN founder_approval_status = 'rejected' THEN 'declined'
         WHEN founder_approval_status = 'changes_requested' THEN 'internal_review'
         ELSE 'drafting'
       END,
       lifecycle_stage = COALESCE(lifecycle_stage,
         CASE
           WHEN status = 'submitted' THEN 'submitted'
           WHEN status = 'draft' THEN 'application_drafting'
           ELSE lifecycle_stage
         END
       ),
       updated_at = ?`,
    now
  );
  updated += apps.changes ?? 0;

  return updated;
}

export interface PipelineBoardItem {
  id: string;
  entityType: "opportunity" | "application" | "award";
  title: string;
  funder: string;
  amount: number;
  pipelineStage: FundingPipelineStage;
  deadline: string | null;
  matchScore: number;
  programFit: string[];
  priority: string | null;
  updatedAt: string | null;
}

function mapOppToBoardItem(r: Record<string, unknown>, stageKey: FundingPipelineStage): PipelineBoardItem {
  return {
    id: String(r.id),
    entityType: "opportunity",
    title: String(r.title),
    funder: String(r.funder ?? "—"),
    amount: Number(r.amount_max ?? 0),
    pipelineStage: stageKey,
    deadline: r.deadline ? String(r.deadline) : null,
    matchScore: Number(r.composite_score ?? 0),
    programFit: parseJsonArray(r.division_slugs),
    priority: null,
    updatedAt: r.updated_at ? String(r.updated_at) : null,
  };
}

function mapAppToBoardItem(r: Record<string, unknown>, stageKey: FundingPipelineStage): PipelineBoardItem {
  return {
    id: String(r.id),
    entityType: "application",
    title: String(r.title),
    funder: String(r.funder ?? "—"),
    amount: Number(r.amount_requested ?? 0),
    pipelineStage: stageKey,
    deadline: r.opp_deadline ? String(r.opp_deadline) : null,
    matchScore: 0,
    programFit: r.matched_program_slug ? [String(r.matched_program_slug)] : [],
    priority: r.founder_priority ? String(r.founder_priority) : null,
    updatedAt: r.updated_at ? String(r.updated_at) : null,
  };
}

export async function buildEnterprisePipelineBoard(limitPerStage = 20) {
  const db = await getDb();
  const prodFilter = productionGrantOpportunitySqlFilter("o");

  const stageStats = (await db.all(`
    SELECT pipeline_stage as stage, COUNT(*) as c, COALESCE(SUM(val), 0) as v FROM (
      SELECT pipeline_stage, COALESCE(amount_max, 0) as val FROM grant_opportunities WHERE pipeline_stage IS NOT NULL
      UNION ALL
      SELECT pipeline_stage, COALESCE(amount_requested, 0) as val FROM grant_applications WHERE pipeline_stage IS NOT NULL
    ) GROUP BY pipeline_stage
  `)) as { stage: string; c: number; v: number }[];
  const statsByStage = new Map(stageStats.map((s) => [s.stage, s]));

  const oppRows = (await db.all(
    `SELECT o.*,
      (SELECT composite_score FROM grant_opportunity_scores WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) as composite_score
     FROM grant_opportunities o
     WHERE o.pipeline_stage IS NOT NULL${prodFilter}
     ORDER BY o.pipeline_stage, o.updated_at DESC`
  )) as Record<string, unknown>[];

  const appRows = (await db.all(
    `SELECT a.*, o.funder, o.deadline as opp_deadline
     FROM grant_applications a LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
     WHERE a.pipeline_stage IS NOT NULL
     ORDER BY a.pipeline_stage, a.updated_at DESC`
  )) as Record<string, unknown>[];

  const oppsByStage = new Map<string, PipelineBoardItem[]>();
  const appsByStage = new Map<string, PipelineBoardItem[]>();
  for (const stageKey of FUNDING_PIPELINE_STAGES) {
    oppsByStage.set(stageKey, []);
    appsByStage.set(stageKey, []);
  }

  for (const r of oppRows) {
    const stage = String(r.pipeline_stage);
    const bucket = oppsByStage.get(stage);
    if (bucket && bucket.length < limitPerStage) {
      bucket.push(mapOppToBoardItem(r, stage as FundingPipelineStage));
    }
  }
  for (const r of appRows) {
    const stage = String(r.pipeline_stage);
    const bucket = appsByStage.get(stage);
    if (bucket && bucket.length < limitPerStage) {
      bucket.push(mapAppToBoardItem(r, stage as FundingPipelineStage));
    }
  }

  const columns = FUNDING_PIPELINE_STAGES.map((stageKey) => {
    const stats = statsByStage.get(stageKey);
    const items = [...(oppsByStage.get(stageKey) ?? []), ...(appsByStage.get(stageKey) ?? [])].slice(0, limitPerStage);
    return {
      stageKey,
      label: FUNDING_PIPELINE_LABELS[stageKey],
      count: stats?.c ?? items.length,
      value: stats?.v ?? 0,
      items,
    };
  });

  return { columns, stages: FUNDING_PIPELINE_STAGES, generatedAt: new Date().toISOString() };
}

export async function buildPipelineMetricsDashboard() {
  const db = await getDb();

  const totalOpportunities = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_opportunities WHERE status IN ('open','active','researching')${productionGrantOpportunitySqlFilter()}`
  ))?.c ?? 0;

  const pipelineValue = (await db.get<{ v: number }>(`
    SELECT COALESCE(SUM(amount_requested), 0) as v FROM grant_applications WHERE status NOT IN ('denied','withdrawn')
  `))?.v ?? 0;

  const estimatedPotential = (await db.get<{ v: number }>(`
    SELECT COALESCE(SUM(amount_max), 0) as v FROM grant_opportunities
    WHERE status IN ('open','active','researching') AND pipeline_stage IN ('discovered','matched','qualified')${productionGrantOpportunitySqlFilter()}
  `))?.v ?? 0;

  const byProgram = (await db.all(`
    SELECT COALESCE(a.matched_program_slug, 'unassigned') as program,
      COUNT(*) as count, COALESCE(SUM(a.amount_requested), 0) as value
    FROM grant_applications a WHERE a.status NOT IN ('denied','withdrawn')
    GROUP BY a.matched_program_slug ORDER BY value DESC LIMIT 15
  `)) as { program: string; count: number; value: number }[];

  const byAgency = (await db.all(`
    SELECT COALESCE(o.funder, 'Unknown') as agency,
      COUNT(*) as count, COALESCE(SUM(o.amount_max), 0) as value
    FROM grant_opportunities o WHERE o.status IN ('open','active','researching')${productionGrantOpportunitySqlFilter("o")}
    GROUP BY o.funder ORDER BY value DESC LIMIT 15
  `)) as { agency: string; count: number; value: number }[];

  const byStatus = (await db.all(`
    SELECT pipeline_stage as status, COUNT(*) as count,
      COALESCE(SUM(CASE WHEN 1=1 THEN 1 ELSE 0 END), 0) as entities
    FROM (
      SELECT pipeline_stage FROM grant_opportunities WHERE pipeline_stage IS NOT NULL
      UNION ALL
      SELECT pipeline_stage FROM grant_applications WHERE pipeline_stage IS NOT NULL
    ) GROUP BY pipeline_stage
  `)) as { status: string; count: number }[];

  const upcomingDeadlines = (await db.all(`
    SELECT o.id, o.title, o.funder, o.deadline, o.pipeline_stage
    FROM grant_opportunities o
    WHERE o.deadline IS NOT NULL AND o.deadline >= date('now') AND o.status IN ('open','active')${productionGrantOpportunitySqlFilter("o")}
    ORDER BY o.deadline ASC LIMIT 20
  `)) as Record<string, unknown>[];

  const awardsReceived = (await db.get<{ c: number; v: number }>(
    "SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as v FROM grant_awards WHERE status = 'active'"
  )) ?? { c: 0, v: 0 };

  const inProgress = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_applications WHERE status IN ('draft','submitted','under_review')"
  ))?.c ?? 0;

  const decided = (await db.get<{ awarded: number; total: number }>(`
    SELECT
      (SELECT COUNT(*) FROM grant_applications WHERE status = 'awarded') as awarded,
      (SELECT COUNT(*) FROM grant_applications WHERE status IN ('awarded','denied')) as total
  `)) ?? { awarded: 0, total: 0 };

  const successRate = decided.total > 0 ? Math.round((decided.awarded / decided.total) * 100) : 0;

  let syncStatus: Record<string, unknown>[] = [];
  try {
    syncStatus = (await db.all(
      "SELECT provider, last_sync_at, last_status, records_imported FROM grant_feed_sync"
    )) as Record<string, unknown>[];
  } catch {
    syncStatus = [];
  }

  return {
    metrics: {
      totalOpportunities,
      totalPipelineValue: pipelineValue,
      estimatedPotentialFunding: estimatedPotential,
      awardsReceived: awardsReceived.c,
      totalAwardedValue: awardsReceived.v,
      applicationsInProgress: inProgress,
      successRate,
      upcomingDeadlineCount: upcomingDeadlines.length,
    },
    byProgram: byProgram.map((p) => ({
      ...p,
      label: IFCDC_PROGRAM_CATALOG.find((d) => d.slug === p.program)?.label ?? p.program.replace(/_/g, " "),
    })),
    byAgency,
    byStatus: byStatus.map((s) => ({
      ...s,
      label: FUNDING_PIPELINE_LABELS[s.status as FundingPipelineStage] ?? s.status,
    })),
    upcomingDeadlines,
    feedSync: syncStatus,
    programs: IFCDC_PROGRAM_CATALOG.map((p) => ({ slug: p.slug, label: p.label })),
    generatedAt: new Date().toISOString(),
  };
}

export async function buildOpportunityPipelineIntelligence(opportunityId: string, opts?: { actorEmail?: string }) {
  const intel = await scoreOpportunityIntelligence(opportunityId, opts);
  if (!intel) return null;

  const db = await getDb();
  const opp = await db.get<Record<string, unknown>>("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId);
  if (!opp) return null;

  const uploaded = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_documents WHERE opportunity_id = ?",
    opportunityId
  ))?.c ?? 0;

  const required = intel.requiredAttachments;
  const missingRequirements = required.filter((_, i) => i >= uploaded);

  const prepHours = intel.estimatedEffort === "high" ? 40 : intel.estimatedEffort === "medium" ? 20 : 8;
  const riskScore = intel.composite >= 70 ? "low" : intel.composite >= 50 ? "medium" : "high";

  const nextSteps: string[] = [];
  if (intel.composite >= 60) nextSteps.push("Start application draft in Grant Center");
  if (intel.daysUntilDeadline != null && intel.daysUntilDeadline <= 30) nextSteps.push("Prioritize — deadline within 30 days");
  if (missingRequirements.length) nextSteps.push(`Gather ${missingRequirements.length} required attachment(s)`);
  if (intel.matchedPrograms.length) nextSteps.push(`Route to ${intel.matchedPrograms[0].label} program lead`);
  nextSteps.push("Founder approval required before federal submission");

  return {
    opportunityId,
    eligibilityAnalysis: {
      score: intel.eligibility,
      grade: intel.eligibilityGrade,
      summary: intel.eligibility >= 60 ? "IFCDC appears eligible based on mission alignment and opportunity criteria." : "Review eligibility carefully — may be a stretch opportunity.",
    },
    matchScore: intel.composite,
    matchExplanation: intel.factors,
    matchedPrograms: intel.matchedPrograms,
    requiredDocuments: required,
    missingRequirements,
    recommendedNextSteps: nextSteps,
    estimatedPreparationTime: `${prepHours}–${prepHours + 8} hours`,
    estimatedEffort: intel.estimatedEffort,
    riskAssessment: {
      level: riskScore,
      awardProbability: intel.awardProbability,
      factors: riskScore === "high"
        ? ["Low composite match", "Competitive funder", "Tight deadline"]
        : riskScore === "medium"
          ? ["Moderate match — strengthen narrative"]
          : ["Strong mission fit", "Adequate preparation window"],
    },
    priority: intel.priority,
    fundingAmount: intel.fundingAmount,
    deadline: intel.deadline,
    generatedAt: new Date().toISOString(),
  };
}

export type FounderCommandFilters = {
  program?: string;
  agency?: string;
  minAmount?: number;
  maxAmount?: number;
  status?: FundingPipelineStage;
  deadlineWithinDays?: number;
  priority?: string;
  q?: string;
  limit?: number;
};

export async function buildFounderCommandCenter(filters: FounderCommandFilters = {}) {
  const db = await getDb();
  const limit = filters.limit ?? 50;

  let sql = `
    SELECT a.*, o.title as opportunity_title, o.funder, o.deadline, o.amount_max, o.url,
      o.pipeline_stage as opp_pipeline_stage
    FROM grant_applications a
    LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
    WHERE 1=1`;
  const params: unknown[] = [];

  if (filters.program) {
    sql += " AND (a.matched_program_slug = ? OR o.division_slugs LIKE ?)";
    params.push(filters.program, `%${filters.program}%`);
  }
  if (filters.agency) {
    sql += " AND o.funder LIKE ?";
    params.push(`%${filters.agency}%`);
  }
  if (filters.minAmount != null) {
    sql += " AND COALESCE(a.amount_requested, o.amount_max, 0) >= ?";
    params.push(filters.minAmount);
  }
  if (filters.maxAmount != null) {
    sql += " AND COALESCE(a.amount_requested, o.amount_max, 999999999) <= ?";
    params.push(filters.maxAmount);
  }
  if (filters.status) {
    sql += " AND a.pipeline_stage = ?";
    params.push(filters.status);
  }
  if (filters.priority) {
    sql += " AND a.founder_priority = ?";
    params.push(filters.priority);
  }
  if (filters.deadlineWithinDays != null) {
    sql += " AND o.deadline IS NOT NULL AND o.deadline <= date('now', '+' || ? || ' days')";
    params.push(filters.deadlineWithinDays);
  }
  if (filters.q) {
    sql += " AND (a.title LIKE ? OR o.title LIKE ? OR o.funder LIKE ?)";
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }
  sql += " ORDER BY COALESCE(a.founder_priority, 'zzz') ASC, a.updated_at DESC LIMIT ?";
  params.push(limit);

  const applications = (await db.all(sql, ...params)) as Record<string, unknown>[];

  const pendingApproval = applications.filter(
    (a) => String(a.pipeline_stage) === "founder_approval" || String(a.founder_approval_status) === "pending"
  );

  return {
    applications: applications.map((a) => ({
      ...a,
      pipelineLabel: FUNDING_PIPELINE_LABELS[String(a.pipeline_stage) as FundingPipelineStage] ?? String(a.pipeline_stage),
      programLabel: IFCDC_PROGRAM_CATALOG.find((p) => p.slug === a.matched_program_slug)?.label ?? a.matched_program_slug,
    })),
    pendingApprovalCount: pendingApproval.length,
    filters,
    generatedAt: new Date().toISOString(),
  };
}

export async function setFounderPipelineDecision(
  applicationId: string,
  decision: "approve" | "reject",
  opts?: { actorEmail?: string; note?: string; priority?: string }
) {
  const result = await setFounderApproval(applicationId, decision, {
    actorEmail: opts?.actorEmail,
    note: opts?.note,
    priority: opts?.priority,
  });
  if (!result.ok) return result;
  await logHqAudit({
    action: `founder_pipeline_${decision}`,
    entityType: "grant_application",
    entityId: applicationId,
    actorEmail: opts?.actorEmail,
    detail: opts?.note ?? decision,
  });
  return { ok: true, decision, applicationId };
}

export async function setApplicationPriority(applicationId: string, priority: "high" | "medium" | "low", actorEmail?: string) {
  const db = await getDb();
  await db.run("UPDATE grant_applications SET founder_priority = ?, updated_at = ? WHERE id = ?", priority, new Date().toISOString(), applicationId);
  await logGrantActivity("application", applicationId, "priority_set", priority, actorEmail);
  return { ok: true, priority };
}

export async function transitionFundingPipelineStage(opts: {
  entityType: "opportunity" | "application" | "award";
  entityId: string;
  toStage: FundingPipelineStage;
  actorEmail?: string;
  note?: string;
}) {
  if (!FUNDING_PIPELINE_STAGES.includes(opts.toStage)) {
    return { ok: false, error: "Invalid pipeline stage" };
  }

  const db = await getDb();
  const table = opts.entityType === "opportunity" ? "grant_opportunities" : opts.entityType === "application" ? "grant_applications" : "grant_awards";
  const row = await db.get<{ pipeline_stage: string | null; title: string }>(
    `SELECT pipeline_stage, title FROM ${table} WHERE id = ?`,
    opts.entityId
  );
  if (!row) return { ok: false, error: "Entity not found" };

  const fromStage = row.pipeline_stage ?? "discovered";
  const allowed = STAGE_TRANSITIONS[fromStage] ?? FUNDING_PIPELINE_STAGES;
  if (!allowed.includes(opts.toStage) && fromStage !== opts.toStage) {
    return { ok: false, error: `Cannot move from ${fromStage} to ${opts.toStage}` };
  }

  await db.run(`UPDATE ${table} SET pipeline_stage = ?, updated_at = ? WHERE id = ?`, opts.toStage, new Date().toISOString(), opts.entityId);

  if (opts.entityType === "application") {
    if (opts.toStage === "submitted") {
      const { assertFounderApprovedForSubmit } = await import("./grantIntelligenceEngine");
      const gate = await assertFounderApprovedForSubmit(opts.entityId);
      if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };
      if (!opts.note && !(gate.application as { portal_confirmation_id?: string }).portal_confirmation_id) {
        return {
          ok: false,
          error:
            "Portal confirmation required. Use confirmPortalSubmission with Grants.gov confirmation ID, or pass note containing the confirmation reference.",
          code: "portal_confirmation_required",
        };
      }
      await db.run(
        "UPDATE grant_applications SET status = 'submitted', submitted_at = ?, pipeline_stage = 'submitted' WHERE id = ?",
        new Date().toISOString(),
        opts.entityId
      );
    }
    if (opts.toStage === "declined") await db.run("UPDATE grant_applications SET status = 'denied' WHERE id = ?", opts.entityId);
    if (opts.toStage === "awarded") await db.run("UPDATE grant_applications SET status = 'awarded' WHERE id = ?", opts.entityId);
  }

  await logGrantActivity(opts.entityType, opts.entityId, "pipeline_stage_transition", `${fromStage} → ${opts.toStage}`, opts.actorEmail);

  try {
    const { notifyHqDataChange } = await import("./hqRealtimeEvents");
    notifyHqDataChange("grants");
  } catch { /* optional */ }

  return { ok: true, fromStage, toStage: opts.toStage };
}

async function ensureNotification(
  entityType: string,
  entityId: string,
  type: string,
  title: string,
  message: string,
  dueDate?: string
): Promise<boolean> {
  const db = await getDb();
  const exists = await db.get(
    "SELECT id FROM grant_notifications WHERE grant_entity_id = ? AND notification_type = ? AND read = 0",
    entityId,
    type
  );
  if (exists) return false;
  await db.run(
    `INSERT INTO grant_notifications (id, grant_entity_type, grant_entity_id, notification_type, title, message, due_date, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    crypto.randomUUID(),
    entityType,
    entityId,
    type,
    title,
    message,
    dueDate ?? null,
    new Date().toISOString()
  );
  await enqueueNotification({
    type,
    priority: type.includes("deadline") || type.includes("approval") ? "high" : "normal",
    title,
    message,
    path: "/hq/grants?tab=pipeline",
  }).catch(() => undefined);
  return true;
}

export async function runPipelineNotificationScan(): Promise<number> {
  const db = await getDb();
  let created = 0;

  const newMatches = (await db.all(`
    SELECT id, title, funder FROM grant_opportunities
    WHERE pipeline_stage IN ('matched','qualified') AND updated_at >= datetime('now', '-24 hours')
    ORDER BY updated_at DESC LIMIT 10
  `)) as { id: string; title: string; funder: string }[];

  for (const o of newMatches) {
    if (await ensureNotification("opportunity", o.id, "new_match", `New matching grant: ${o.title}`, `${o.funder} — review in Funding Pipeline`)) created++;
  }

  const deadlines = (await db.all(`
    SELECT id, title, deadline FROM grant_opportunities
    WHERE deadline IS NOT NULL AND deadline <= date('now', '+7 days') AND deadline >= date('now') AND status IN ('open','active')
  `)) as { id: string; title: string; deadline: string }[];

  for (const d of deadlines) {
    if (await ensureNotification("opportunity", d.id, "deadline_approaching", `Deadline approaching: ${d.title}`, `Due ${d.deadline}`, d.deadline)) created++;
  }

  const needApproval = (await db.all(`
    SELECT id, title FROM grant_applications WHERE pipeline_stage = 'founder_approval' OR (founder_approval_status = 'pending' AND status = 'draft')
  `)) as { id: string; title: string }[];

  for (const a of needApproval) {
    if (await ensureNotification("application", a.id, "approval_required", `Approval required: ${a.title}`, "Founder review needed before submission")) created++;
  }

  const recentAwards = (await db.all(`
    SELECT a.id, a.title FROM grant_applications a
    WHERE a.status = 'awarded' AND a.updated_at >= datetime('now', '-7 days')
  `)) as { id: string; title: string }[];

  for (const a of recentAwards) {
    if (await ensureNotification("application", a.id, "award_received", `Award received: ${a.title}`, "Activate finance and compliance workflows")) created++;
  }

  const submitted = (await db.all(`
    SELECT id, title, portal_confirmation_id, submitted_at FROM grant_applications
    WHERE status IN ('submitted', 'under_review') AND submitted_at >= datetime('now', '-14 days')
  `)) as { id: string; title: string; portal_confirmation_id: string | null; submitted_at: string }[];

  for (const a of submitted) {
    if (
      await ensureNotification(
        "application",
        a.id,
        "submission_tracking",
        `Monitoring submission: ${a.title}`,
        a.portal_confirmation_id
          ? `Portal confirmation ${a.portal_confirmation_id} — tracking until award decision.`
          : `Submitted ${a.submitted_at?.slice(0, 10) ?? ""} — add portal confirmation ID if missing.`
      )
    ) {
      created++;
    }
  }

  const aging = (await db.all(`
    SELECT id, title, submitted_at FROM grant_applications
    WHERE status = 'submitted'
      AND submitted_at IS NOT NULL
      AND submitted_at <= datetime('now', '-30 days')
      AND submitted_at >= datetime('now', '-90 days')
  `)) as { id: string; title: string; submitted_at: string }[];

  for (const a of aging) {
    if (
      await ensureNotification(
        "application",
        a.id,
        "submission_aging",
        `Follow up recommended: ${a.title}`,
        `Submitted ${a.submitted_at?.slice(0, 10)} — check funder status and update HQ.`
      )
    ) {
      created++;
    }
  }

  return created;
}

/** Live pipeline sync — all feeds, stage sync, notifications, realtime push. */
export async function runLivePipelineSync(opts?: { actorEmail?: string }) {
  const feedResults = await syncGrantFeeds({ providers: ["grants_gov", "sam_gov", "foundation_directory"] });
  const enriched = await enrichAllOpportunities(200);
  const deadlinesFilled = await enrichMissingDeadlines(50);
  const stagesSynced = await syncAllPipelineStages();
  const notifications = await runPipelineNotificationScan();

  try {
    const { notifyHqDataChange } = await import("./hqRealtimeEvents");
    notifyHqDataChange("grants");
  } catch { /* optional */ }

  return {
    feedResults,
    enriched,
    deadlinesFilled,
    stagesSynced,
    notifications,
    syncedAt: new Date().toISOString(),
    actor: opts?.actorEmail ?? null,
  };
}

let pipelineSyncTimer: ReturnType<typeof setInterval> | null = null;

export function scheduleLivePipelineSync(): void {
  if (pipelineSyncTimer || process.env.NODE_ENV !== "production") return;
  pipelineSyncTimer = setInterval(() => {
    void runLivePipelineSync().catch((err) =>
      console.warn("Live pipeline sync failed:", err instanceof Error ? err.message : err)
    );
  }, 4 * 60 * 60_000);
  console.log("Enterprise Funding Pipeline: scheduled sync every 4h");
}

export async function loadHqProgramRegistry(): Promise<{ slug: string; label: string }[]> {
  const db = await getDb();
  const registry = (await db.all(
    "SELECT slug, name FROM hq_program_registry WHERE status = 'active' ORDER BY name"
  )) as { slug: string; name: string }[];
  const known = IFCDC_PROGRAM_CATALOG.map((p) => ({ slug: p.slug, label: p.label }));
  const extra = registry
    .filter((r) => !known.some((k) => k.slug === r.slug))
    .map((r) => ({ slug: r.slug, label: r.name }));
  return [...known, ...extra];
}
