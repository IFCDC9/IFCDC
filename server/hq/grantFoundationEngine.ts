/**
 * Build 59 — Enterprise Grant Center Foundation
 * Canonical product vocabulary, executive dashboard, workspace, doc links, calendar, reports.
 * Extends existing grant engines — no new top-level services.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { allowGrantDemoSeed } from "./grantProductionPolicy";
import {
  FUNDING_PIPELINE_STAGES,
  FUNDING_PIPELINE_LABELS,
  type FundingPipelineStage,
  resolvePipelineStage,
} from "./grantFundingPipelineEngine";
import { buildGrantExecutiveDashboard } from "./grantReporting";
import { ensureDocumentTables } from "./documentsSchema";

export const GRANT_FUNDER_TYPES = [
  "federal",
  "state",
  "county",
  "municipal",
  "foundation",
  "corporate",
  "private",
] as const;

export type GrantFunderType = (typeof GRANT_FUNDER_TYPES)[number];

export const GRANT_FUNDER_TYPE_LABELS: Record<GrantFunderType, string> = {
  federal: "Federal",
  state: "State",
  county: "County",
  municipal: "Municipal",
  foundation: "Foundation",
  corporate: "Corporate",
  private: "Private",
};

/** Build 59 product lifecycle (10 stages) mapped onto internal 12-stage pipeline keys. */
export const GRANT_PRODUCT_STAGES = [
  {
    id: "opportunity_identified",
    label: "Opportunity Identified",
    maps: ["discovered"] as FundingPipelineStage[],
  },
  {
    id: "under_review",
    label: "Under Review",
    maps: ["matched"] as FundingPipelineStage[],
  },
  {
    id: "eligibility_verified",
    label: "Eligibility Verified",
    maps: ["qualified"] as FundingPipelineStage[],
  },
  {
    id: "application_in_progress",
    label: "Application In Progress",
    maps: ["drafting", "ready_for_submission"] as FundingPipelineStage[],
  },
  {
    id: "internal_review",
    label: "Internal Review",
    maps: ["internal_review", "founder_approval"] as FundingPipelineStage[],
  },
  {
    id: "submitted",
    label: "Submitted",
    maps: ["submitted"] as FundingPipelineStage[],
  },
  {
    id: "under_evaluation",
    label: "Under Evaluation",
    maps: ["under_review"] as FundingPipelineStage[],
  },
  {
    id: "awarded",
    label: "Awarded",
    maps: ["awarded"] as FundingPipelineStage[],
  },
  {
    id: "declined",
    label: "Declined",
    maps: ["declined"] as FundingPipelineStage[],
  },
  {
    id: "closed",
    label: "Closed",
    maps: ["closed"] as FundingPipelineStage[],
  },
] as const;

export type GrantProductStageId = (typeof GRANT_PRODUCT_STAGES)[number]["id"];

/** Product-facing labels for internal pipeline stages (Build 59 vocabulary). */
export const GRANT_PIPELINE_PRODUCT_LABELS: Record<FundingPipelineStage, string> = {
  discovered: "Opportunity Identified",
  matched: "Under Review",
  qualified: "Eligibility Verified",
  drafting: "Application In Progress",
  internal_review: "Internal Review",
  founder_approval: "Internal Review",
  ready_for_submission: "Application In Progress",
  submitted: "Submitted",
  under_review: "Under Evaluation",
  awarded: "Awarded",
  declined: "Declined",
  closed: "Closed",
};

export function toProductStage(pipelineStage: FundingPipelineStage): GrantProductStageId {
  for (const stage of GRANT_PRODUCT_STAGES) {
    if ((stage.maps as readonly string[]).includes(pipelineStage)) return stage.id;
  }
  return "opportunity_identified";
}

export function normalizeFunderType(raw: string | null | undefined): GrantFunderType | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (GRANT_FUNDER_TYPES.includes(v as GrantFunderType)) return v as GrantFunderType;
  if (v.includes("federal") || v === "gov" || v === "government") return "federal";
  if (v.includes("state")) return "state";
  if (v.includes("county")) return "county";
  if (v.includes("municipal") || v.includes("city") || v.includes("local")) return "municipal";
  if (v.includes("foundation") || v.includes("philanthrop")) return "foundation";
  if (v.includes("corporate") || v.includes("csr") || v.includes("company")) return "corporate";
  if (v.includes("private") || v.includes("individual")) return "private";
  return null;
}

const LIVE_OPP_FILTER = allowGrantDemoSeed()
  ? ""
  : " AND COALESCE(source_type, '') != 'dev_seed' AND COALESCE(import_status, '') != 'seed'";

function linkId() {
  return crypto.randomUUID();
}

export type GrantFoundationDashboard = {
  totalActiveGrants: number;
  grantsAwarded: number;
  pendingApplications: number;
  totalFundingRequested: number;
  totalFundingAwarded: number;
  upcomingDeadlines: number;
  submissionStatus: {
    drafting: number;
    internalReview: number;
    submitted: number;
    underEvaluation: number;
  };
  successRate: number;
  complianceStatus: {
    dueSoon: number;
    overdue: number;
    status: "healthy" | "watch" | "critical";
  };
  openOpportunities: number;
  pipelineByProductStage: { id: string; label: string; count: number; value: number }[];
  funderTypeBreakdown: { type: string; label: string; count: number }[];
  fundingForecast: { month: string; requested: number; awarded: number }[];
  monitoredAt: string;
  source: "live";
};

export async function buildGrantFoundationDashboard(): Promise<GrantFoundationDashboard> {
  const db = await getDb();
  const base = await buildGrantExecutiveDashboard();

  const totalActiveGrants = base.activeAwards;
  const grantsAwarded = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_applications WHERE status = 'awarded'"
  ))?.c ?? 0;

  const totalFundingRequested = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_requested), 0) as t FROM grant_applications
     WHERE status IN ('draft','submitted','under_review','awarded')`
  ))?.t ?? 0;

  const totalFundingAwarded = base.totalAwarded;

  const decided = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_applications WHERE status IN ('awarded','denied')"
  ))?.c ?? 0;
  const successRate = decided > 0 ? Math.round((grantsAwarded / decided) * 100) : base.winRate;

  const drafting = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_applications WHERE status = 'draft' AND COALESCE(pipeline_stage, 'drafting') IN ('drafting','ready_for_submission','')"
  ))?.c ?? 0;
  const internalReview = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_applications
     WHERE status = 'draft' AND (
       COALESCE(pipeline_stage, '') IN ('internal_review','founder_approval')
       OR COALESCE(founder_approval_status, 'pending') IN ('pending','changes_requested')
     )`
  ))?.c ?? 0;
  const submitted = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_applications WHERE status = 'submitted'"
  ))?.c ?? 0;
  const underEvaluation = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_applications WHERE status = 'under_review'"
  ))?.c ?? 0;

  const overdue = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_compliance WHERE status = 'pending' AND due_date < date('now')`
  ))?.c ?? 0;
  const dueSoon = base.complianceDue;
  const complianceStatus =
    overdue > 0 ? "critical" : dueSoon > 0 ? "watch" : "healthy";

  const apps = (await db.all(
    `SELECT id, status, amount_requested, pipeline_stage, founder_approval_status, ready_to_submit
     FROM grant_applications`
  )) as Record<string, unknown>[];

  const stageBuckets = new Map<string, { count: number; value: number }>();
  for (const stage of GRANT_PRODUCT_STAGES) {
    stageBuckets.set(stage.id, { count: 0, value: 0 });
  }
  for (const row of apps) {
    const internal = resolvePipelineStage("application", row);
    const product = toProductStage(internal);
    const bucket = stageBuckets.get(product) ?? { count: 0, value: 0 };
    bucket.count += 1;
    bucket.value += Number(row.amount_requested) || 0;
    stageBuckets.set(product, bucket);
  }

  const pipelineByProductStage = GRANT_PRODUCT_STAGES.map((s) => {
    const b = stageBuckets.get(s.id) ?? { count: 0, value: 0 };
    return { id: s.id, label: s.label, count: b.count, value: b.value };
  });

  const funderRows = (await db.all(
    `SELECT LOWER(COALESCE(funder_type, 'unknown')) as funder_type, COUNT(*) as c
     FROM grant_opportunities WHERE status = 'open'${LIVE_OPP_FILTER}
     GROUP BY LOWER(COALESCE(funder_type, 'unknown'))`
  )) as { funder_type: string; c: number }[];

  const funderTypeBreakdown = GRANT_FUNDER_TYPES.map((type) => {
    const match = funderRows.find((r) => normalizeFunderType(r.funder_type) === type);
    return {
      type,
      label: GRANT_FUNDER_TYPE_LABELS[type],
      count: match?.c ?? 0,
    };
  });

  const forecastRows = (await db.all(
    `SELECT strftime('%Y-%m', COALESCE(submitted_at, created_at)) as month,
            COALESCE(SUM(CASE WHEN status IN ('draft','submitted','under_review','awarded') THEN amount_requested ELSE 0 END), 0) as requested,
            COALESCE(SUM(CASE WHEN status = 'awarded' THEN amount_requested ELSE 0 END), 0) as awarded
     FROM grant_applications
     WHERE COALESCE(submitted_at, created_at) >= date('now', '-5 months')
     GROUP BY strftime('%Y-%m', COALESCE(submitted_at, created_at))
     ORDER BY month ASC`
  )) as { month: string; requested: number; awarded: number }[];

  return {
    totalActiveGrants,
    grantsAwarded,
    pendingApplications: base.pendingApplications,
    totalFundingRequested,
    totalFundingAwarded,
    upcomingDeadlines: base.upcomingDeadlines,
    submissionStatus: {
      drafting,
      internalReview,
      submitted,
      underEvaluation,
    },
    successRate,
    complianceStatus: {
      dueSoon,
      overdue,
      status: complianceStatus,
    },
    openOpportunities: base.openOpportunities,
    pipelineByProductStage,
    funderTypeBreakdown,
    fundingForecast: forecastRows,
    monitoredAt: new Date().toISOString(),
    source: "live",
  };
}

export async function buildGrantFoundationPipelineBoard() {
  const db = await getDb();
  const apps = (await db.all(
    `SELECT a.*, o.title as opportunity_title, o.deadline as opportunity_deadline, o.funder_type
     FROM grant_applications a
     LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
     ORDER BY a.updated_at DESC`
  )) as Record<string, unknown>[];

  const columns = GRANT_PRODUCT_STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    cards: [] as Array<Record<string, unknown>>,
  }));

  for (const row of apps) {
    const internal = resolvePipelineStage("application", row);
    const product = toProductStage(internal);
    const col = columns.find((c) => c.id === product);
    if (!col) continue;
    col.cards.push({
      id: row.id,
      title: row.title || row.opportunity_title || "Untitled application",
      amount: Number(row.amount_requested) || 0,
      status: row.status,
      pipelineStage: internal,
      productStage: product,
      productLabel: GRANT_PIPELINE_PRODUCT_LABELS[internal],
      opportunityId: row.opportunity_id,
      deadline: row.opportunity_deadline,
      funderType: normalizeFunderType(String(row.funder_type ?? "")) ?? row.funder_type,
      updatedAt: row.updated_at,
    });
  }

  return {
    stages: columns,
    labels: GRANT_PIPELINE_PRODUCT_LABELS,
    internalStages: FUNDING_PIPELINE_STAGES.map((s) => ({
      id: s,
      label: GRANT_PIPELINE_PRODUCT_LABELS[s],
      legacyLabel: FUNDING_PIPELINE_LABELS[s],
    })),
    monitoredAt: new Date().toISOString(),
  };
}

const REQUIRED_DOC_TYPES = [
  { id: "irs_determination", label: "IRS Determination Letter" },
  { id: "sam_registration", label: "SAM Registration" },
  { id: "uei", label: "UEI Information" },
  { id: "cage", label: "CAGE Information" },
  { id: "board_documents", label: "Board Documents" },
  { id: "financial_statements", label: "Financial Statements" },
  { id: "budget", label: "Budgets" },
  { id: "policies", label: "Organizational Policies" },
  { id: "resumes", label: "Resumes" },
  { id: "letters_of_support", label: "Letters of Support" },
  { id: "narrative", label: "Project Narratives" },
  { id: "supporting", label: "Supporting Documents" },
] as const;

export async function buildGrantFoundationWorkspace(applicationId: string) {
  const db = await getDb();
  await ensureDocumentTables();

  const app = await db.get<Record<string, unknown>>(
    `SELECT a.*, o.title as opportunity_title, o.funder, o.funder_type, o.amount_min, o.amount_max,
            o.deadline, o.requirements, o.eligibility, o.url as opportunity_url, o.description as opportunity_description,
            o.geography
     FROM grant_applications a
     LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
     WHERE a.id = ?`,
    applicationId
  );
  if (!app) return null;

  const internal = resolvePipelineStage("application", app);
  const product = toProductStage(internal);

  const grantDocs = (await db.all(
    `SELECT * FROM grant_documents
     WHERE application_id = ? OR opportunity_id = ?
     ORDER BY uploaded_at DESC`,
    applicationId,
    app.opportunity_id ?? ""
  )) as Record<string, unknown>[];

  const hqDocs = (await db.all(
    `SELECT id, title, category, file_url, access_level, updated_at, version
     FROM hq_documents
     WHERE grant_id = ? AND COALESCE(lifecycle_status, 'active') != 'archived'
     ORDER BY updated_at DESC LIMIT 50`,
    String(app.opportunity_id ?? applicationId)
  )) as Record<string, unknown>[];

  const links = (await db.all(
    `SELECT * FROM grant_links
     WHERE (entity_type = 'application' AND entity_id = ?)
        OR (entity_type = 'opportunity' AND entity_id = ?)
     ORDER BY created_at DESC`,
    applicationId,
    app.opportunity_id ?? ""
  )) as Record<string, unknown>[];

  const activity = (await db.all(
    `SELECT * FROM grant_activity
     WHERE (grant_entity_type = 'application' AND grant_entity_id = ?)
        OR (grant_entity_type = 'opportunity' AND grant_entity_id = ?)
     ORDER BY created_at DESC LIMIT 40`,
    applicationId,
    app.opportunity_id ?? ""
  )) as Record<string, unknown>[];

  const deadlines = (await db.all(
    `SELECT * FROM grant_deadlines
     WHERE opportunity_id = ? OR application_id = ?
     ORDER BY due_date ASC`,
    app.opportunity_id ?? "",
    applicationId
  )) as Record<string, unknown>[];

  const checklist = REQUIRED_DOC_TYPES.map((docType) => {
    const hit =
      grantDocs.find((d) => String(d.doc_category ?? d.doc_type ?? "").toLowerCase().includes(docType.id.replace(/_/g, ""))) ||
      grantDocs.find((d) => String(d.name ?? "").toLowerCase().includes(docType.label.toLowerCase().split(" ")[0]!)) ||
      links.find((l) => String(l.link_type) === docType.id);
    return {
      ...docType,
      linked: Boolean(hit),
      documentId: hit ? (hit.id ?? hit.link_id) : null,
    };
  });

  const team = parseTeam(app.assigned_team ?? app.team_members ?? app.notes);

  return {
    application: app,
    pipeline: {
      internal,
      product,
      productLabel: GRANT_PIPELINE_PRODUCT_LABELS[internal],
      internalLabel: FUNDING_PIPELINE_LABELS[internal],
    },
    opportunity: {
      id: app.opportunity_id,
      title: app.opportunity_title,
      funder: app.funder,
      funderType: normalizeFunderType(String(app.funder_type ?? "")) ?? app.funder_type,
      amountMin: app.amount_min,
      amountMax: app.amount_max,
      deadline: app.deadline,
      requirements: app.requirements,
      eligibility: app.eligibility,
      matchingRequired: null,
      geography: app.geography,
      url: app.opportunity_url,
      description: app.opportunity_description,
    },
    fundingAmount: Number(app.amount_requested) || Number(app.amount_max) || 0,
    team,
    documents: {
      grantDocuments: grantDocs,
      hqDocuments: hqDocs,
      links,
      checklist,
      vaultPath: `/hq/documents?category=grants`,
    },
    deadlines,
    activity,
    progress: {
      checklistComplete: checklist.filter((c) => c.linked).length,
      checklistTotal: checklist.length,
      percent: Math.round((checklist.filter((c) => c.linked).length / checklist.length) * 100),
    },
    monitoredAt: new Date().toISOString(),
  };
}

function parseTeam(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* ignore */
  }
  return String(raw)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export async function linkGrantEntityDocument(input: {
  entityType: "opportunity" | "application" | "award";
  entityId: string;
  linkType: string;
  linkId: string;
  linkLabel?: string;
}) {
  const db = await getDb();
  const id = linkId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO grant_links (id, entity_type, entity_id, link_type, link_id, link_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.entityType,
    input.entityId,
    input.linkType,
    input.linkId,
    input.linkLabel ?? null,
    now
  );
  return { id, ...input, created_at: now };
}

export async function buildGrantFoundationCalendar(days = 90) {
  const db = await getDb();
  const horizon = Math.min(Math.max(days, 7), 365);

  const submissionDeadlines = (await db.all(
    `SELECT id, title, deadline as due_date, 'submission' as event_type, funder_type
     FROM grant_opportunities
     WHERE status = 'open' AND deadline IS NOT NULL
       AND deadline >= date('now') AND deadline <= date('now', '+' || ? || ' days')${LIVE_OPP_FILTER}
     ORDER BY deadline ASC`,
    horizon
  )) as Record<string, unknown>[];

  const reportingDeadlines = (await db.all(
    `SELECT id, report_type as title, due_date, 'reporting' as event_type, report_type as requirement_type
     FROM grant_compliance
     WHERE status = 'pending' AND due_date IS NOT NULL
       AND due_date >= date('now') AND due_date <= date('now', '+' || ? || ' days')
     ORDER BY due_date ASC`,
    horizon
  )) as Record<string, unknown>[];

  const renewals = (await db.all(
    `SELECT id, renewal_date as due_date, 'renewal' as event_type, status, notes
     FROM grant_renewals
     WHERE renewal_date >= date('now') AND renewal_date <= date('now', '+' || ? || ' days')
     ORDER BY renewal_date ASC`,
    horizon
  )) as Record<string, unknown>[];

  const internalDeadlines = (await db.all(
    `SELECT id, title, due_date, deadline_type as event_type
     FROM grant_deadlines
     WHERE completed = 0 AND due_date >= date('now') AND due_date <= date('now', '+' || ? || ' days')
     ORDER BY due_date ASC`,
    horizon
  )) as Record<string, unknown>[];

  const events: Array<Record<string, unknown> & { category: string }> = [];
  for (const e of submissionDeadlines) events.push({ ...e, category: "Submission Deadline" });
  for (const e of reportingDeadlines) events.push({ ...e, category: "Reporting Deadline" });
  for (const e of renewals) events.push({ ...e, title: e.notes || "Grant renewal", category: "Renewal Date" });
  for (const e of internalDeadlines) {
    events.push({
      ...e,
      category:
        String(e.event_type).includes("review") || String(e.event_type).includes("meeting")
          ? "Internal Review Meeting"
          : String(e.event_type).includes("compliance")
            ? "Compliance Milestone"
            : "Internal Deadline",
    });
  }
  events.sort((a, b) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")));

  return {
    days: horizon,
    events,
    counts: {
      submission: submissionDeadlines.length,
      reporting: reportingDeadlines.length,
      renewal: renewals.length,
      internal: internalDeadlines.length,
      total: events.length,
    },
    monitoredAt: new Date().toISOString(),
  };
}

export async function buildGrantFoundationExecutiveReport() {
  const dashboard = await buildGrantFoundationDashboard();
  const calendar = await buildGrantFoundationCalendar(60);
  const db = await getDb();

  const byProgram = (await db.all(
    `SELECT COALESCE(program_id, 'unassigned') as program_id, COUNT(*) as applications,
            COALESCE(SUM(amount_requested), 0) as requested
     FROM grant_applications
     GROUP BY COALESCE(program_id, 'unassigned')
     ORDER BY requested DESC LIMIT 20`
  )) as Record<string, unknown>[];

  const byDepartment = (await db.all(
    `SELECT COALESCE(department_id, 'unassigned') as department_id, COUNT(*) as applications,
            COALESCE(SUM(amount_requested), 0) as requested
     FROM grant_applications
     GROUP BY COALESCE(department_id, 'unassigned')
     ORDER BY requested DESC LIMIT 20`
  )) as Record<string, unknown>[];

  return {
    title: "IFCDC Executive Funding Report",
    generatedAt: new Date().toISOString(),
    dashboard,
    activeOpportunities: dashboard.openOpportunities,
    upcomingDeadlines: calendar.events.slice(0, 15),
    awardPipeline: dashboard.pipelineByProductStage.filter((s) =>
      ["submitted", "under_evaluation", "awarded"].includes(s.id)
    ),
    fundingByProgram: byProgram,
    fundingByDepartment: byDepartment,
    performance: {
      successRate: dashboard.successRate,
      grantsAwarded: dashboard.grantsAwarded,
      totalFundingAwarded: dashboard.totalFundingAwarded,
      totalFundingRequested: dashboard.totalFundingRequested,
      compliance: dashboard.complianceStatus,
    },
    forecast: dashboard.fundingForecast,
  };
}

export async function listOpportunitiesByFunderType(funderType?: string, q?: string) {
  const db = await getDb();
  let sql = `SELECT * FROM grant_opportunities WHERE status = 'open'${LIVE_OPP_FILTER}`;
  const params: unknown[] = [];
  if (funderType) {
    const normalized = normalizeFunderType(funderType) ?? funderType.toLowerCase();
    sql += " AND LOWER(COALESCE(funder_type, '')) LIKE ?";
    params.push(`%${normalized}%`);
  }
  if (q) {
    sql += " AND (title LIKE ? OR funder LIKE ? OR description LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += " ORDER BY deadline ASC NULLS LAST, updated_at DESC LIMIT 200";
  // SQLite may not support NULLS LAST — fallback
  try {
    return await db.all(sql, ...params);
  } catch {
    sql = sql.replace(" NULLS LAST", "");
    return db.all(sql, ...params);
  }
}
