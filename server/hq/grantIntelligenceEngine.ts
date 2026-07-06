/**
 * Grant Intelligence Engine — unified discovery, matching, scoring, drafting, and AURA advisory.
 */
import { getDb } from "../db";
import { grantId, logGrantActivity } from "./grantsSchema";
import { auraExecutiveChat } from "../lib/ifcdc";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import { syncGrantFeeds } from "./grantFeedConnectors";
import {
  IFCDC_FUNDING_DIVISIONS,
  ensureApplicationWorkflow,
} from "./grantFundingEngine";
import { scoreGrantOpportunityV5 } from "./grantFundingEngineV5";
import {
  seedWriterSectionsForApplication,
  assistWriterSection,
  updateWriterSection,
  listWriterSections,
} from "./grantCenterEngine";
import { buildGrantExecutiveDashboard } from "./grantReporting";
import { productionGrantOpportunitySqlFilter } from "./grantProductionPolicy";
import { buildApplicationWorkspace } from "./grantFundingEngineV5";
import { getApplicationWorkflow } from "./grantFundingEngine";
import { fetchGrantsGovOpportunityDeadline } from "./grantsGovIntegrationEngine";

/** User-facing grant lifecycle workflow (human approval gate before submit). */
export const GRANT_DISPLAY_WORKFLOW = [
  { key: "discovered", label: "Discovered" },
  { key: "matched", label: "Matched" },
  { key: "drafting", label: "Drafting" },
  { key: "founder_review", label: "Founder Review" },
  { key: "ready_to_submit", label: "Ready to Submit" },
  { key: "submitted", label: "Submitted" },
  { key: "awarded", label: "Awarded" },
  { key: "rejected", label: "Rejected" },
] as const;

export type EnrichedOpportunityRow = {
  id: string;
  title: string;
  funder: string;
  fundingAmount: { min: number | null; max: number | null; label: string };
  eligibility: string;
  matchScore: number;
  deadline: string | null;
  deadlineLabel: string;
  programFit: { slugs: string[]; labels: string[] };
  status: string;
  statusLabel: string;
  lastSynced: string | null;
  sourceType: string;
  dataSourceLabel: string;
  url: string | null;
  compositeScore: number;
};

function formatFundingLabel(min: number | null, max: number | null): string {
  if (max != null && min != null && min !== max) return `$${min.toLocaleString()} – $${max.toLocaleString()}`;
  if (max != null) return `Up to $${max.toLocaleString()}`;
  if (min != null) return `From $${min.toLocaleString()}`;
  return "Amount TBD";
}

function deadlineLabel(deadline: string | null | undefined): string {
  if (!deadline?.trim()) return "No deadline listed";
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return "No deadline listed";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function sourceLabel(sourceType: string | null | undefined): string {
  const map: Record<string, string> = {
    grants_gov: "Grants.gov",
    sam_gov: "SAM.gov",
    foundation_directory: "Foundation Directory",
    corporate_csr: "Corporate CSR",
    manual: "Manual entry",
  };
  return map[String(sourceType ?? "")] ?? "IFCDC HQ";
}

function displayStatusForOpportunity(row: Record<string, unknown>, matchScore: number): { status: string; label: string } {
  const fundingStatus = String(row.funding_status ?? "identified");
  const lifecycle = String(row.lifecycle_stage ?? "prospect");
  if (fundingStatus === "awarded" || lifecycle === "awarded") return { status: "awarded", label: "Awarded" };
  if (fundingStatus === "declined") return { status: "rejected", label: "Rejected" };
  if (fundingStatus === "submitted") return { status: "submitted", label: "Submitted" };
  if (fundingStatus === "eligible" || matchScore >= 60) return { status: "matched", label: "Matched" };
  if (fundingStatus === "reviewing") return { status: "matched", label: "Matched" };
  return { status: "discovered", label: "Discovered" };
}

function displayStatusForApplication(app: Record<string, unknown>): { status: string; label: string } {
  const status = String(app.status ?? "draft");
  const founder = String(app.founder_approval_status ?? "pending");
  const ready = Number(app.ready_to_submit ?? 0) === 1;
  if (status === "awarded") return { status: "awarded", label: "Awarded" };
  if (status === "denied") return { status: "rejected", label: "Rejected" };
  if (status === "submitted" || status === "under_review") return { status: "submitted", label: "Submitted" };
  if (founder === "approved" && ready) return { status: "ready_to_submit", label: "Ready to Submit" };
  if (founder === "approved") return { status: "founder_review", label: "Founder Review" };
  if (founder === "changes_requested") return { status: "drafting", label: "Drafting" };
  if (status === "draft") return { status: "drafting", label: "Drafting" };
  return { status: "drafting", label: "Drafting" };
}

async function mapOpportunityRow(row: Record<string, unknown>): Promise<EnrichedOpportunityRow> {
  await enrichOpportunityPrograms(String(row.id));
  const fresh = (await getDb().then((db) =>
    db.get<Record<string, unknown>>("SELECT * FROM grant_opportunities WHERE id = ?", row.id)
  )) ?? row;
  const inferred = inferProgramMatches(fresh);
  const slugs = parseJsonArray(fresh.division_slugs).length ? parseJsonArray(fresh.division_slugs) : inferred.divisionSlugs;
  const labels = slugs.map((s) => IFCDC_PROGRAM_CATALOG.find((p) => p.slug === s)?.label ?? s.replace(/_/g, " "));
  const composite = fresh.composite_score != null
    ? Number(fresh.composite_score)
    : inferred.matchScore;
  const matchScore = composite || inferred.matchScore;
  const disp = displayStatusForOpportunity(fresh, matchScore);
  const syncRow = await getDb().then((db) =>
    db.get<{ last_sync_at: string }>("SELECT last_sync_at FROM grant_feed_sync WHERE provider = ?", String(fresh.source_type ?? "grants_gov"))
  );

  return {
    id: String(fresh.id),
    title: String(fresh.title ?? ""),
    funder: String(fresh.funder ?? "—"),
    fundingAmount: {
      min: fresh.amount_min != null ? Number(fresh.amount_min) : null,
      max: fresh.amount_max != null ? Number(fresh.amount_max) : null,
      label: formatFundingLabel(
        fresh.amount_min != null ? Number(fresh.amount_min) : null,
        fresh.amount_max != null ? Number(fresh.amount_max) : null
      ),
    },
    eligibility: String(fresh.eligibility ?? "See opportunity listing"),
    matchScore,
    deadline: fresh.deadline ? String(fresh.deadline) : null,
    deadlineLabel: deadlineLabel(fresh.deadline ? String(fresh.deadline) : null),
    programFit: { slugs, labels },
    status: disp.status,
    statusLabel: disp.label,
    lastSynced: syncRow?.last_sync_at ?? (fresh.updated_at ? String(fresh.updated_at) : null),
    sourceType: String(fresh.source_type ?? "manual"),
    dataSourceLabel: sourceLabel(fresh.source_type ? String(fresh.source_type) : null),
    url: fresh.url ? String(fresh.url) : null,
    compositeScore: matchScore,
  };
}

/** Enriched opportunity list for Discover / Matched / Program views. */
export async function buildEnrichedOpportunityList(opts?: {
  filter?: "all" | "matched" | "program";
  programSlug?: string;
  q?: string;
  limit?: number;
}) {
  const db = await getDb();
  const limit = opts?.limit ?? 100;
  let sql = `
    SELECT o.*,
      (SELECT composite_score FROM grant_opportunity_scores WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) as composite_score
    FROM grant_opportunities o
    WHERE o.status IN ('open','active','researching')${productionGrantOpportunitySqlFilter("o")}`;
  const params: unknown[] = [];

  if (opts?.q) {
    sql += " AND (o.title LIKE ? OR o.funder LIKE ? OR o.description LIKE ?)";
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  if (opts?.filter === "program" && opts.programSlug) {
    const like = `%${opts.programSlug}%`;
    sql += " AND (o.division_slugs LIKE ? OR o.program_areas LIKE ? OR o.title LIKE ? OR o.description LIKE ?)";
    params.push(like, like, like, like);
  }
  sql += " ORDER BY o.updated_at DESC LIMIT ?";
  params.push(limit);

  const rows = (await db.all(sql, ...params)) as Record<string, unknown>[];
  let enriched = await Promise.all(rows.map((r) => mapOpportunityRow(r)));

  if (opts?.filter === "matched") {
    enriched = enriched.filter((o) => o.matchScore >= 55 || o.programFit.slugs.length > 0);
  }

  return {
    opportunities: enriched,
    filter: opts?.filter ?? "all",
    programSlug: opts?.programSlug ?? null,
    generatedAt: new Date().toISOString(),
  };
}

/** Backfill missing deadlines from Grants.gov fetchOpportunity. */
export async function enrichMissingDeadlines(limit = 30): Promise<number> {
  const db = await getDb();
  const rows = (await db.all(
    `SELECT id, external_id, source_type FROM grant_opportunities
     WHERE (deadline IS NULL OR deadline = '') AND source_type = 'grants_gov' AND external_id IS NOT NULL
     ORDER BY updated_at DESC LIMIT ?`,
    limit
  )) as { id: string; external_id: string }[];

  let updated = 0;
  for (const row of rows) {
    const deadline = await fetchGrantsGovOpportunityDeadline(row.external_id);
    if (!deadline) continue;
    await db.run("UPDATE grant_opportunities SET deadline = ?, updated_at = ? WHERE id = ?", deadline, new Date().toISOString(), row.id);
    updated++;
  }
  return updated;
}

async function ensureApplicationDeadlineRecord(
  opportunityId: string,
  applicationId: string,
  deadline: string | null,
  title: string
): Promise<void> {
  if (!deadline) return;
  const db = await getDb();
  const existing = await db.get("SELECT id FROM grant_deadlines WHERE application_id = ? AND deadline_type = 'submission'", applicationId);
  if (existing) return;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO grant_deadlines (id, opportunity_id, application_id, title, due_date, deadline_type, completed, reminder_days, created_at)
     VALUES (?, ?, ?, ?, ?, 'submission', 0, 14, ?)`,
    grantId(),
    opportunityId,
    applicationId,
    `Submit: ${title.slice(0, 80)}`,
    deadline,
    now
  );
}

/** Full application workspace for Grant Center UI. */
export async function buildFullApplicationWorkspace(applicationId: string, opts?: { actorEmail?: string }) {
  const [base, workflow, sections, intel] = await Promise.all([
    buildApplicationWorkspace(applicationId, opts),
    getApplicationWorkflow(applicationId),
    listWriterSections(applicationId),
    (async () => {
      const db = await getDb();
      const app = await db.get<{ opportunity_id: string | null }>("SELECT opportunity_id FROM grant_applications WHERE id = ?", applicationId);
      if (!app?.opportunity_id) return null;
      return scoreOpportunityIntelligence(app.opportunity_id, { actorEmail: opts?.actorEmail });
    })(),
  ]);

  if (!base) return null;

  const app = base.application as Record<string, unknown>;
  const db = await getDb();
  const deadlines = await db.all(
    "SELECT * FROM grant_deadlines WHERE application_id = ? OR opportunity_id = ? ORDER BY due_date ASC",
    applicationId,
    app.opportunity_id ?? ""
  );
  const matchedSlug = String(app.matched_program_slug ?? intel?.matchedPrograms?.[0]?.slug ?? "");
  const matchedLabel = IFCDC_PROGRAM_CATALOG.find((p) => p.slug === matchedSlug)?.label
    ?? (matchedSlug ? matchedSlug.replace(/_/g, " ") : "—");
  const disp = displayStatusForApplication(app);
  const narrativeSection = (sections.sections as { section_key: string; content: string }[]).find((s) => s.section_key === "executive_summary");
  const budget = base.proposalBudget as Record<string, unknown>;

  const tasks = (workflow.steps as { step_key: string; step_label: string; status: string }[]).map((s) => ({
    key: s.step_key,
    label: s.step_label,
    done: s.status === "completed",
  }));

  return {
    ...base,
    displayWorkflow: GRANT_DISPLAY_WORKFLOW,
    currentWorkflowStage: disp,
    opportunity: {
      id: app.opportunity_id,
      title: app.opportunity_title,
      funder: app.funder,
      deadline: app.deadline,
      deadlineLabel: deadlineLabel(app.deadline ? String(app.deadline) : null),
      amountMax: app.amount_max,
      eligibility: app.eligibility,
    },
    matchedProgram: { slug: matchedSlug, label: matchedLabel },
    intelligence: intel,
    writerSections: sections,
    narrativeDraft: narrativeSection?.content ?? "",
    budgetDraft: budget,
    taskChecklist: tasks,
    deadlineTracker: deadlines,
    founderApproval: {
      status: String(app.founder_approval_status ?? "pending"),
      approvedAt: app.founder_approved_at ?? null,
      approvedBy: app.founder_approved_by ?? null,
      readyToSubmit: Number(app.ready_to_submit ?? 0) === 1,
    },
    humanReviewRequired: true,
    generatedAt: new Date().toISOString(),
  };
}

export async function setFounderApproval(
  applicationId: string,
  action: "approve" | "request_changes" | "mark_ready",
  opts?: { actorEmail?: string; note?: string }
) {
  const db = await getDb();
  const app = await db.get<{ id: string; status: string }>("SELECT id, status FROM grant_applications WHERE id = ?", applicationId);
  if (!app) return { ok: false, error: "Application not found" };

  const now = new Date().toISOString();
  if (action === "approve") {
    await db.run(
      `UPDATE grant_applications SET founder_approval_status = 'approved', founder_approved_at = ?, founder_approved_by = ?, ready_to_submit = 1, lifecycle_stage = 'internal_approval', updated_at = ? WHERE id = ?`,
      now,
      opts?.actorEmail ?? null,
      now,
      applicationId
    );
  } else if (action === "request_changes") {
    await db.run(
      `UPDATE grant_applications SET founder_approval_status = 'changes_requested', ready_to_submit = 0, updated_at = ? WHERE id = ?`,
      now,
      applicationId
    );
  } else if (action === "mark_ready") {
    const approval = await db.get<{ founder_approval_status: string }>(
      "SELECT founder_approval_status FROM grant_applications WHERE id = ?",
      applicationId
    );
    if (approval?.founder_approval_status !== "approved") {
      return { ok: false, error: "Founder must approve before marking ready to submit." };
    }
    await db.run(
      `UPDATE grant_applications SET ready_to_submit = 1, lifecycle_stage = 'application_drafting', updated_at = ? WHERE id = ?`,
      now,
      applicationId
    );
  }

  await logGrantActivity("application", applicationId, `founder_${action}`, opts?.note ?? action, opts?.actorEmail);
  return { ok: true, workspace: await buildFullApplicationWorkspace(applicationId, opts) };
}

export async function listEnrichedApplications(opts?: { status?: string; limit?: number }) {
  const db = await getDb();
  let sql = `
    SELECT a.*, o.title as opportunity_title, o.funder, o.deadline as opportunity_deadline, o.amount_max
    FROM grant_applications a
    LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
    WHERE 1=1`;
  const params: unknown[] = [];

  if (opts?.status === "drafts") {
    sql += " AND a.status = 'draft'";
  } else if (opts?.status === "submitted") {
    sql += " AND a.status IN ('submitted', 'under_review')";
  } else if (opts?.status === "awards") {
    sql += " AND a.status = 'awarded'";
  } else if (opts?.status === "rejected") {
    sql += " AND a.status = 'denied'";
  }
  sql += " ORDER BY a.updated_at DESC LIMIT ?";
  params.push(opts?.limit ?? 100);

  const rows = (await db.all(sql, ...params)) as Record<string, unknown>[];
  return {
    applications: rows.map((a) => ({
      ...a,
      workflowStage: displayStatusForApplication(a),
      deadlineLabel: deadlineLabel(a.opportunity_deadline ? String(a.opportunity_deadline) : null),
    })),
    generatedAt: new Date().toISOString(),
  };
}

const SYNC_INTERVAL_MS = 6 * 60 * 60_000;
let syncTimer: ReturnType<typeof setInterval> | null = null;

/** IFCDC mission keywords — used to tag and filter Grants.gov imports. */
export const IFCDC_MISSION_KEYWORDS = [
  "community development",
  "nonprofit",
  "housing",
  "transitional housing",
  "homeless",
  "youth",
  "mentorship",
  "violence prevention",
  "gang",
  "scholarship",
  "education",
  "workforce",
  "economic development",
  "small business",
  "mental health",
  "disadvantaged",
  "underserved",
  "minority",
  "low-income",
  "job training",
  "media",
  "arts",
  "radio",
  "technology",
];

/** Extended program catalog for matching (divisions + HQ registry). */
export const IFCDC_PROGRAM_CATALOG = IFCDC_FUNDING_DIVISIONS.map((d) => ({
  slug: d.slug,
  label: d.label,
  programs: [...d.programs],
  keywords: [...d.programs, d.slug.replace(/_/g, " "), d.label.toLowerCase()],
}));

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

function textBlob(opp: Record<string, unknown>): string {
  return [opp.title, opp.funder, opp.description, opp.eligibility, opp.requirements, opp.match_tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Infer division + program tags from opportunity text. */
export function inferProgramMatches(opp: Record<string, unknown>): {
  divisionSlugs: string[];
  programAreas: string[];
  matchScore: number;
} {
  const blob = textBlob(opp);
  const divisionSlugs = new Set<string>();
  const programAreas = new Set<string>();
  let hits = 0;

  for (const prog of IFCDC_PROGRAM_CATALOG) {
    const matched = prog.keywords.some((kw) => blob.includes(kw.toLowerCase()));
    if (matched) {
      divisionSlugs.add(prog.slug);
      prog.programs.forEach((p) => programAreas.add(p));
      hits++;
    }
  }

  for (const kw of IFCDC_MISSION_KEYWORDS) {
    if (blob.includes(kw.toLowerCase())) hits += 0.25;
  }

  const matchScore = Math.min(100, Math.round(40 + hits * 12));
  return {
    divisionSlugs: Array.from(divisionSlugs),
    programAreas: Array.from(programAreas),
    matchScore,
  };
}

export async function enrichOpportunityPrograms(opportunityId: string): Promise<void> {
  const db = await getDb();
  const opp = await db.get<Record<string, unknown>>("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId);
  if (!opp) return;

  const inferred = inferProgramMatches(opp);
  const existingDivisions = parseJsonArray(opp.division_slugs);
  const existingPrograms = parseJsonArray(opp.program_areas);
  const mergedDivisions = Array.from(new Set([...existingDivisions, ...inferred.divisionSlugs]));
  const mergedPrograms = Array.from(new Set([...existingPrograms, ...inferred.programAreas]));

  if (mergedDivisions.length === existingDivisions.length && mergedPrograms.length === existingPrograms.length) return;

  await db.run(
    `UPDATE grant_opportunities SET division_slugs = ?, program_areas = ?, updated_at = ? WHERE id = ?`,
    JSON.stringify(mergedDivisions),
    JSON.stringify(mergedPrograms),
    new Date().toISOString(),
    opportunityId
  );
}

export async function enrichAllOpportunities(limit = 200): Promise<number> {
  const db = await getDb();
  const rows = (await db.all(
    `SELECT id FROM grant_opportunities WHERE status IN ('open','active','researching')${productionGrantOpportunitySqlFilter()}
     ORDER BY updated_at DESC LIMIT ?`,
    limit
  )) as { id: string }[];

  let count = 0;
  for (const row of rows) {
    await enrichOpportunityPrograms(row.id);
    count++;
  }
  return count;
}

export type OpportunityIntelligenceScore = {
  opportunityId: string;
  eligibility: number;
  eligibilityGrade: string;
  strategicFit: number;
  composite: number;
  awardProbability: number;
  priority: "high" | "medium" | "low";
  fundingAmount: { min: number | null; max: number | null };
  deadline: string | null;
  daysUntilDeadline: number | null;
  requiredAttachments: string[];
  estimatedEffort: "low" | "medium" | "high";
  matchedPrograms: { slug: string; label: string; score: number }[];
  factors: { label: string; value: string }[];
};

function parseAttachments(requirements: string | null | undefined): string[] {
  if (!requirements?.trim()) {
    return ["Project narrative", "Budget justification", "IRS determination letter", "Board roster", "Logic model"];
  }
  const items = requirements
    .split(/[,;\n•]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  return items.length ? items.slice(0, 12) : ["See funder requirements in opportunity record"];
}

function estimateEffort(opp: Record<string, unknown>, composite: number): "low" | "medium" | "high" {
  const funderType = String(opp.funder_type ?? "").toLowerCase();
  const amount = Number(opp.amount_max ?? 0);
  if (funderType === "federal" || amount >= 250000) return "high";
  if (amount >= 75000 || composite >= 70) return "medium";
  return "low";
}

function priorityFromScore(composite: number, days: number | null): "high" | "medium" | "low" {
  if (composite >= 75 && (days == null || days > 14)) return "high";
  if (composite >= 55 && (days == null || days > 7)) return "medium";
  return "low";
}

/** Full intelligence score for one opportunity. */
export async function scoreOpportunityIntelligence(
  opportunityId: string,
  opts?: { divisionSlug?: string; actorEmail?: string }
): Promise<OpportunityIntelligenceScore | null> {
  await enrichOpportunityPrograms(opportunityId);

  const v5 = await scoreGrantOpportunityV5(opportunityId, {
    divisionSlug: opts?.divisionSlug,
    actorEmail: opts?.actorEmail,
  });
  if (!v5) return null;

  const db = await getDb();
  const opp = await db.get<Record<string, unknown>>("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId);
  if (!opp) return null;

  const composite = v5.scores.composite;
  const days = opp.deadline
    ? Math.ceil((new Date(String(opp.deadline)).getTime() - Date.now()) / 86400000)
    : null;

  const inferred = inferProgramMatches(opp);
  const matchedPrograms = IFCDC_PROGRAM_CATALOG.filter((p) => inferred.divisionSlugs.includes(p.slug)).map((p) => ({
    slug: p.slug,
    label: p.label,
    score: Math.round((v5.eligibilityScore + v5.strategicFitScore) / 2),
  }));

  return {
    opportunityId,
    eligibility: v5.eligibilityScore,
    eligibilityGrade:
      v5.eligibilityScore >= 90 ? "Excellent Match"
      : v5.eligibilityScore >= 75 ? "Strong Match"
      : v5.eligibilityScore >= 60 ? "Moderate Match"
      : v5.eligibilityScore >= 45 ? "Stretch Opportunity"
      : "Low Match",
    strategicFit: v5.strategicFitScore,
    composite,
    awardProbability: v5.scores.awardProbability,
    priority: priorityFromScore(composite, days),
    fundingAmount: {
      min: opp.amount_min != null ? Number(opp.amount_min) : null,
      max: opp.amount_max != null ? Number(opp.amount_max) : null,
    },
    deadline: opp.deadline ? String(opp.deadline) : null,
    daysUntilDeadline: days,
    requiredAttachments: parseAttachments(String(opp.requirements ?? "")),
    estimatedEffort: estimateEffort(opp, composite),
    matchedPrograms,
    factors: [
      { label: "Eligibility", value: `${v5.eligibilityScore}%` },
      { label: "Strategic fit", value: `${v5.strategicFitScore}%` },
      { label: "Deadline urgency", value: `${v5.scores.deadline}%` },
      { label: "Award size", value: `${v5.scores.awardSize}%` },
      { label: "Competitiveness", value: `${v5.scores.competitiveness}%` },
    ],
  };
}

export async function matchOpportunitiesForProgram(programSlug: string, limit = 25) {
  const db = await getDb();
  const catalog = IFCDC_PROGRAM_CATALOG.find((p) => p.slug === programSlug);
  const like = `%${programSlug}%`;
  const rows = (await db.all(
    `SELECT o.* FROM grant_opportunities o
     WHERE o.status IN ('open','active','researching')${productionGrantOpportunitySqlFilter("o")}
       AND (o.division_slugs LIKE ? OR o.program_areas LIKE ? OR o.title LIKE ? OR o.description LIKE ?)
     ORDER BY o.deadline ASC LIMIT ?`,
    like,
    like,
    like,
    like,
    limit * 2
  )) as Record<string, unknown>[];

  const scored = await Promise.all(
    rows.slice(0, limit).map(async (row) => {
      const id = String(row.id);
      await enrichOpportunityPrograms(id);
      const intel = await scoreOpportunityIntelligence(id, { divisionSlug: programSlug });
      return { ...row, intelligence: intel };
    })
  );

  return {
    programSlug,
    programLabel: catalog?.label ?? programSlug,
    matches: scored.sort((a, b) => (b.intelligence?.composite ?? 0) - (a.intelligence?.composite ?? 0)),
    generatedAt: new Date().toISOString(),
  };
}

/** Live feed — newly synced + mission-relevant opportunities. */
export async function getLiveOpportunityFeed(opts?: { sinceHours?: number; limit?: number }) {
  const sinceHours = opts?.sinceHours ?? 72;
  const limit = opts?.limit ?? 40;
  const cutoff = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const db = await getDb();

  const rows = (await db.all(
    `SELECT o.*,
      (SELECT composite_score FROM grant_opportunity_scores WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) as composite_score
     FROM grant_opportunities o
     WHERE o.status IN ('open','active','researching')${productionGrantOpportunitySqlFilter("o")}
       AND (o.created_at >= ? OR o.updated_at >= ?)
     ORDER BY o.updated_at DESC LIMIT ?`,
    cutoff,
    cutoff,
    limit
  )) as Record<string, unknown>[];

  const feed = await Promise.all(
    rows.map(async (row) => {
      const inferred = inferProgramMatches(row);
      return {
        ...row,
        division_slugs: parseJsonArray(row.division_slugs).length ? parseJsonArray(row.division_slugs) : inferred.divisionSlugs,
        program_areas: parseJsonArray(row.program_areas).length ? parseJsonArray(row.program_areas) : inferred.programAreas,
        missionRelevant: inferred.matchScore >= 52,
        compositeScore: row.composite_score != null ? Number(row.composite_score) : inferred.matchScore,
      };
    })
  );

  const syncRow = await db.get<{ last_sync_at: string }>(
    "SELECT last_sync_at FROM grant_feed_sync WHERE provider = 'grants_gov'"
  );

  return {
    opportunities: feed.filter((o) => o.missionRelevant),
    allRecent: feed,
    lastGrantsGovSync: syncRow?.last_sync_at ?? null,
    generatedAt: new Date().toISOString(),
  };
}

/** Real-time grant dashboard aggregates. */
export async function buildGrantIntelligenceDashboard() {
  const [dash, feed, db] = await Promise.all([
    buildGrantExecutiveDashboard(),
    getLiveOpportunityFeed({ sinceHours: 168, limit: 20 }),
    getDb(),
  ]);

  const pipeline = await db.all(`
    SELECT status, COUNT(*) as count, COALESCE(SUM(amount_requested), 0) as value
    FROM grant_applications GROUP BY status
  `) as { status: string; count: number; value: number }[];

  const writing = (pipeline.find((p) => p.status === "draft")?.count ?? 0) +
    (pipeline.find((p) => p.status === "under_review")?.count ?? 0);
  const submitted = pipeline.find((p) => p.status === "submitted")?.count ?? 0;
  const awarded = pipeline.find((p) => p.status === "awarded")?.count ?? 0;
  const denied = pipeline.find((p) => p.status === "denied")?.count ?? 0;

  const totalPipeline = pipeline.reduce((s, p) => s + Number(p.value), 0);
  const secured = (await db.get<{ t: number }>("SELECT COALESCE(SUM(amount), 0) as t FROM grant_awards WHERE status = 'active'"))?.t ?? 0;

  return {
    summary: {
      newOpportunities: feed.opportunities.length,
      grantsBeingWritten: writing,
      drafts: pipeline.find((p) => p.status === "draft")?.count ?? 0,
      submitted,
      awards: awarded,
      rejections: denied,
      totalPipelineValue: totalPipeline,
      totalFundingSecured: secured,
      openOpportunities: dash.openOpportunities,
      upcomingDeadlines: dash.upcomingDeadlines,
    },
    liveFeed: feed.opportunities.slice(0, 10),
    pipeline,
    programs: IFCDC_PROGRAM_CATALOG.map((p) => ({ slug: p.slug, label: p.label })),
    lastSync: feed.lastGrantsGovSync,
    generatedAt: new Date().toISOString(),
  };
}

/** One-click workflow: review → draft shell → score → writer sections. Human must approve before submit. */
export async function startGrantApplicationWorkflow(
  opportunityId: string,
  opts?: { actorEmail?: string; generateDrafts?: boolean }
) {
  const db = await getDb();
  const opp = await db.get<Record<string, unknown>>("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId);
  if (!opp) return { ok: false, error: "Opportunity not found" };

  const existing = await db.get<{ id: string }>(
    "SELECT id FROM grant_applications WHERE opportunity_id = ? AND status NOT IN ('denied','withdrawn') ORDER BY created_at DESC LIMIT 1",
    opportunityId
  );
  if (existing) {
    const intel = await scoreOpportunityIntelligence(opportunityId, { actorEmail: opts?.actorEmail });
    await seedWriterSectionsForApplication(existing.id);
    const workspace = await buildFullApplicationWorkspace(existing.id, { actorEmail: opts?.actorEmail });
    return {
      ok: true,
      applicationId: existing.id,
      existing: true,
      intelligence: intel,
      workspace,
      message: "Existing draft application resumed — human review required before federal submission.",
    };
  }

  const intel = await scoreOpportunityIntelligence(opportunityId, { actorEmail: opts?.actorEmail });
  const now = new Date().toISOString();
  const appId = grantId();
  const title = `Application: ${String(opp.title)}`;
  const matchedSlug = intel?.matchedPrograms?.[0]?.slug ?? inferProgramMatches(opp).divisionSlugs[0] ?? null;

  await db.run(
    `INSERT INTO grant_applications (id, opportunity_id, title, status, amount_requested, assigned_to, notes, workflow_stage, lifecycle_stage, matched_program_slug, founder_approval_status, pipeline_stage, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, 'intake', 'application_drafting', ?, 'pending', 'drafting', ?, ?)`,
    appId,
    opportunityId,
    title,
    opp.amount_max != null ? Number(opp.amount_max) : null,
    opts?.actorEmail ?? "",
    "Created via Grant Intelligence Engine — requires human review before submission.",
    matchedSlug,
    now,
    now
  );

  await ensureApplicationWorkflow(appId);
  await ensureApplicationDeadlineRecord(
    opportunityId,
    appId,
    opp.deadline ? String(opp.deadline) : null,
    String(opp.title)
  );
  const sections = await seedWriterSectionsForApplication(appId);

  const attachments = parseAttachments(String(opp.requirements ?? ""));
  const checklist = attachments.map((a, i) => `${i + 1}. ${a}`).join("\n");
  await updateWriterSection(appId, "attachments_checklist", checklist, { email: opts?.actorEmail });

  if (opts?.generateDrafts) {
    await generateFullProposalDraft(appId, { actorEmail: opts?.actorEmail, sections: ["executive_summary", "need_statement"] });
  }

  await logGrantActivity("application", appId, "intelligence_workflow_started", title, opts?.actorEmail);
  await db.run(
    `UPDATE grant_opportunities SET funding_status = 'eligible', lifecycle_stage = 'eligibility_review', updated_at = ? WHERE id = ?`,
    now,
    opportunityId
  );

  const workspace = await buildFullApplicationWorkspace(appId, { actorEmail: opts?.actorEmail });

  return {
    ok: true,
    applicationId: appId,
    existing: false,
    intelligence: intel,
    writerSections: sections,
    workspace,
    humanReviewRequired: true,
    message: "Application draft created. Review all sections before submitting to the funder.",
  };
}

const FULL_DRAFT_SECTIONS = [
  "executive_summary",
  "need_statement",
  "project_description",
  "goals_objectives",
  "methods",
  "evaluation",
  "sustainability",
  "organizational_capacity",
  "budget_narrative",
] as const;

/** Generate all proposal sections via AURA (saved to writer studio). */
export async function generateFullProposalDraft(
  applicationId: string,
  opts?: { actorEmail?: string; sections?: string[] }
) {
  const sectionKeys = opts?.sections ?? [...FULL_DRAFT_SECTIONS];
  const results: { section: string; ok: boolean; wordCount?: number }[] = [];

  for (const key of sectionKeys) {
    try {
      const draft = await assistWriterSection(applicationId, key);
      const content = String((draft as { content?: string; narrative?: string }).content ?? (draft as { narrative?: string }).narrative ?? "");
      if (content.trim()) {
        await updateWriterSection(applicationId, key, content, { email: opts?.actorEmail });
        results.push({ section: key, ok: true, wordCount: content.split(/\s+/).length });
      } else {
        results.push({ section: key, ok: false });
      }
    } catch {
      results.push({ section: key, ok: false });
    }
  }

  return {
    applicationId,
    sections: results,
    completed: results.filter((r) => r.ok).length,
    total: sectionKeys.length,
    humanReviewRequired: true,
    generatedAt: new Date().toISOString(),
  };
}

/** Natural-language grant advisor for AURA. */
export async function askGrantAura(question: string, opts?: { actorEmail?: string }) {
  const q = question.trim().toLowerCase();
  const [dashboard, context] = await Promise.all([
    buildGrantIntelligenceDashboard(),
    buildAuraExecutiveContext(),
  ]);

  let structured = "";
  if (/available today|new grant|what grant/.test(q)) {
    structured = JSON.stringify(dashboard.liveFeed.slice(0, 8), null, 2);
  } else if (/transitional housing|housing program/.test(q)) {
    const match = await matchOpportunitiesForProgram("housing", 8);
    structured = JSON.stringify(match.matches.slice(0, 5), null, 2);
  } else if (/due this month|deadline/.test(q)) {
    const db = await getDb();
    const monthEnd = new Date();
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    const rows = await db.all(
      `SELECT title, funder, deadline, amount_max FROM grant_opportunities
       WHERE status IN ('open','active') AND deadline IS NOT NULL AND deadline <= ?
       ORDER BY deadline ASC LIMIT 15`,
      monthEnd.toISOString().slice(0, 10)
    );
    structured = JSON.stringify(rows, null, 2);
  } else if (/pipeline|funding secured|how much/.test(q)) {
    structured = JSON.stringify(dashboard.summary, null, 2);
  }

  const prompt = `${question}\n\nUse the structured grant intelligence data below. Be specific and actionable. Remind the user that all federal submissions require human review.\n\nData:\n${structured || JSON.stringify(dashboard.summary, null, 2)}`;

  let answer: string;
  let offline = false;
  try {
    answer = await auraExecutiveChat(prompt, `${context}\n\nGrant Intelligence Dashboard:\n${JSON.stringify(dashboard.summary, null, 2)}`);
  } catch {
    offline = true;
    answer = `Pipeline value: $${dashboard.summary.totalPipelineValue.toLocaleString()}. Secured: $${dashboard.summary.totalFundingSecured.toLocaleString()}. ${dashboard.summary.newOpportunities} new opportunities in the last week.`;
  }

  return { answer, offline, dashboard: dashboard.summary, askedBy: opts?.actorEmail ?? null, generatedAt: new Date().toISOString() };
}

/** Sync feeds + enrich + optional broadcast. */
export async function runGrantIntelligenceSync(opts?: { actorEmail?: string }) {
  const feedResults = await syncGrantFeeds({ providers: ["grants_gov", "sam_gov"] });
  const enriched = await enrichAllOpportunities(150);
  const deadlinesFilled = await enrichMissingDeadlines(40);

  try {
    const { notifyHqDataChange } = await import("./hqRealtimeEvents");
    notifyHqDataChange("grants");
  } catch {
    /* optional realtime */
  }

  return {
    feedResults,
    enriched,
    deadlinesFilled,
    syncedAt: new Date().toISOString(),
    actor: opts?.actorEmail ?? null,
  };
}

export function scheduleGrantIntelligenceSync(): void {
  if (syncTimer || process.env.NODE_ENV !== "production") return;
  syncTimer = setInterval(() => {
    void runGrantIntelligenceSync().catch((err) =>
      console.warn("Grant intelligence sync failed:", err instanceof Error ? err.message : err)
    );
  }, SYNC_INTERVAL_MS);
  console.log(`Grant Intelligence Engine: scheduled sync every ${SYNC_INTERVAL_MS / 3600_000}h`);
}
