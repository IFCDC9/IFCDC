/**
 * IFCDC Headquarters — Phase 2 Grant Funding Engine
 * Central orchestration for opportunity DB, AI matching, pipeline, workflow, and executive funding intelligence.
 */
import { getDb } from "../db";
import { grantId, logGrantActivity } from "./grantsSchema";
import { buildGrantExecutiveDashboard } from "./grantReporting";
import { createGrantFinanceBudget } from "./grantFinanceIntegration";
import { auraExecutiveChat } from "../lib/ifcdc";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import { logHqAudit } from "./hqAuditLog";

export const IFCDC_FUNDING_DIVISIONS = [
  { slug: "housing", label: "Transitional Housing", programs: ["transitional_housing", "housing", "shelter"] },
  { slug: "anti_gang", label: "Anti-Gang Program", programs: ["violence_prevention", "community_safety", "gang_prevention"] },
  { slug: "youth_development", label: "Youth Development", programs: ["youth", "young_adults", "teen"] },
  { slug: "tapis", label: "Mentorship", programs: ["mentorship", "youth_mentorship", "tapis"] },
  { slug: "scholarships", label: "Scholarships", programs: ["scholarships", "education"] },
  { slug: "economic_development", label: "Economic Development", programs: ["economic_development", "community_development"] },
  { slug: "workforce_development", label: "Workforce Development", programs: ["workforce", "job_training", "vocational"] },
  { slug: "small_business", label: "Small Business Assistance", programs: ["small_business", "entrepreneurship", "microenterprise"] },
  { slug: "community_programs", label: "Community Programs", programs: ["community", "outreach"] },
  { slug: "radio", label: "IFCDC Radio", programs: ["radio", "broadcast"] },
  { slug: "productions", label: "IFCDC Productions", programs: ["media", "productions", "film"] },
  { slug: "software_division", label: "IFCDC Software Division", programs: ["technology", "software", "digital_literacy"] },
  { slug: "music", label: "IFCDC Music", programs: ["music", "arts"] },
  { slug: "barbers", label: "IFCDC Barbers", programs: ["workforce", "vocational_training"], readOnly: true },
  { slug: "inclusive", label: "Inclusive Community", programs: ["inclusive", "mental_health"] },
] as const;

export type OpportunitySearchFilters = {
  q?: string;
  status?: string;
  minAmount?: number;
  maxAmount?: number;
  division?: string;
  programArea?: string;
  geography?: string;
  funderType?: string;
  deadlineWithinDays?: number;
  limit?: number;
};

const WORKFLOW_STEPS = [
  { key: "intake", label: "Intake & Eligibility" },
  { key: "draft", label: "Draft Application" },
  { key: "documents", label: "Document Assembly" },
  { key: "review", label: "Internal Review" },
  { key: "submitted", label: "Submitted to Funder" },
  { key: "decision", label: "Award / Rejection" },
] as const;

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

function gradeFromScore(score: number): string {
  if (score >= 90) return "Excellent Match";
  if (score >= 75) return "Strong Match";
  if (score >= 60) return "Moderate Match";
  if (score >= 45) return "Stretch Opportunity";
  return "Low Match";
}

export async function searchGrantOpportunities(filters: OpportunitySearchFilters = {}) {
  const db = await getDb();
  let sql = "SELECT * FROM grant_opportunities WHERE 1=1";
  const params: unknown[] = [];

  if (filters.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  } else {
    sql += " AND status IN ('open', 'active', 'researching')";
  }
  if (filters.q) {
    sql += " AND (title LIKE ? OR funder LIKE ? OR description LIKE ? OR match_tags LIKE ?)";
    const q = `%${filters.q}%`;
    params.push(q, q, q, q);
  }
  if (filters.minAmount != null) {
    sql += " AND amount_max >= ?";
    params.push(filters.minAmount);
  }
  if (filters.maxAmount != null) {
    sql += " AND amount_min <= ?";
    params.push(filters.maxAmount);
  }
  if (filters.geography) {
    sql += " AND (geography = ? OR geography IS NULL)";
    params.push(filters.geography);
  }
  if (filters.funderType) {
    sql += " AND funder_type = ?";
    params.push(filters.funderType);
  }
  if (filters.division) {
    sql += " AND division_slugs LIKE ?";
    params.push(`%"${filters.division}"%`);
  }
  if (filters.programArea) {
    sql += " AND program_areas LIKE ?";
    params.push(`%"${filters.programArea}"%`);
  }
  if (filters.deadlineWithinDays != null) {
    sql += " AND deadline IS NOT NULL AND deadline <= date('now', '+' || ? || ' days') AND deadline >= date('now')";
    params.push(filters.deadlineWithinDays);
  }

  sql += " ORDER BY deadline ASC LIMIT ?";
  params.push(filters.limit ?? 50);

  const rows = (await db.all(sql, ...params)) as Record<string, unknown>[];
  return rows.map((row) => ({
    ...row,
    program_areas: parseJsonArray(row.program_areas),
    division_slugs: parseJsonArray(row.division_slugs),
    match_tags: parseJsonArray(row.match_tags),
    daysUntilDeadline: row.deadline
      ? Math.ceil((new Date(String(row.deadline)).getTime() - Date.now()) / 86400000)
      : null,
  }));
}

export async function scoreOpportunityEligibility(
  opportunityId: string,
  opts?: { divisionSlug?: string; actorEmail?: string }
) {
  const db = await getDb();
  const opp = await db.get("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId) as Record<string, unknown> | undefined;
  if (!opp) return null;

  const factors: { factor: string; score: number; max: number; detail: string }[] = [];
  let total = 0;

  const add = (factor: string, score: number, max: number, detail: string) => {
    factors.push({ factor, score, max, detail });
    total += score;
  };

  if (opp.status === "open") add("Opportunity status", 15, 15, "Open for applications");
  else add("Opportunity status", 5, 15, String(opp.status));

  const amountMax = Number(opp.amount_max ?? 0);
  if (amountMax >= 50000) add("Award size", 20, 20, `$${amountMax.toLocaleString()} maximum`);
  else if (amountMax >= 25000) add("Award size", 15, 20, `$${amountMax.toLocaleString()} maximum`);
  else add("Award size", 8, 20, amountMax > 0 ? `$${amountMax.toLocaleString()} maximum` : "Amount TBD");

  if (opp.deadline) {
    const days = Math.ceil((new Date(String(opp.deadline)).getTime() - Date.now()) / 86400000);
    if (days > 30) add("Deadline window", 20, 20, `${days} days — adequate preparation time`);
    else if (days > 14) add("Deadline window", 15, 20, `${days} days remaining`);
    else if (days > 0) add("Deadline window", 8, 20, `${days} days — urgent`);
    else add("Deadline window", 0, 20, "Deadline passed");
  } else {
    add("Deadline window", 10, 20, "Rolling / TBD");
  }

  const divisions = parseJsonArray(opp.division_slugs);
  const targetDivision = opts?.divisionSlug;
  if (targetDivision && divisions.includes(targetDivision)) {
    add("Division alignment", 25, 25, `Matches ${targetDivision} programs`);
  } else if (divisions.length > 0) {
    add("Division alignment", 18, 25, `Supports: ${divisions.join(", ")}`);
  } else {
    add("Division alignment", 10, 25, "General community development fit");
  }

  if (opp.eligibility && String(opp.eligibility).length > 20) {
    add("Eligibility clarity", 10, 10, "Eligibility criteria documented");
  } else {
    add("Eligibility clarity", 4, 10, "Review funder requirements");
  }

  if (opp.last_verified_at) add("Data freshness", 10, 10, `Verified ${String(opp.last_verified_at).slice(0, 10)}`);
  else add("Data freshness", 5, 10, "Verify opportunity details");

  const score = Math.min(100, total);
  const grade = gradeFromScore(score);
  const now = new Date().toISOString();
  const scoreId = grantId();

  await db.run(
    `INSERT INTO grant_opportunity_scores (id, opportunity_id, division_slug, score, grade, factors_json, model, scored_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ifcdc-eligibility-v1', ?, ?)`,
    scoreId,
    opportunityId,
    targetDivision ?? null,
    score,
    grade,
    JSON.stringify(factors),
    opts?.actorEmail ?? "system",
    now
  );

  await logGrantActivity("opportunity", opportunityId, "eligibility_scored", `Score ${score}% (${grade})`, opts?.actorEmail);
  await logHqAudit({
    action: "grant_eligibility_scored",
    entityType: "grant_opportunity",
    entityId: opportunityId,
    detail: `Eligibility score ${score}% for ${String(opp.title)}`,
    actorEmail: opts?.actorEmail,
  }).catch(() => undefined);

  return { opportunityId, scoreId, score, grade, factors, divisionSlug: targetDivision ?? null, scoredAt: now };
}

export async function ensureApplicationWorkflow(applicationId: string): Promise<void> {
  const db = await getDb();
  const existing = await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_application_workflow WHERE application_id = ?",
    applicationId
  );
  if ((existing?.c ?? 0) > 0) return;

  const now = new Date().toISOString();
  for (const step of WORKFLOW_STEPS) {
    await db.run(
      `INSERT INTO grant_application_workflow (id, application_id, step_key, step_label, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      grantId(),
      applicationId,
      step.key,
      step.label,
      now
    );
  }
}

export async function getApplicationWorkflow(applicationId: string) {
  const db = await getDb();
  await ensureApplicationWorkflow(applicationId);
  const steps = await db.all(
    "SELECT * FROM grant_application_workflow WHERE application_id = ? ORDER BY created_at ASC",
    applicationId
  );
  const app = await db.get<{ status: string; workflow_stage: string }>(
    "SELECT status, workflow_stage FROM grant_applications WHERE id = ?",
    applicationId
  );
  return { applicationId, status: app?.status, workflowStage: app?.workflow_stage, steps };
}

export async function advanceApplicationWorkflow(
  applicationId: string,
  action: "submit" | "review" | "award" | "deny",
  opts?: { reason?: string; amountAwarded?: number; actorEmail?: string }
) {
  const db = await getDb();
  const app = await db.get<{ id: string; status: string; opportunity_id: string | null; title: string }>(
    "SELECT id, status, opportunity_id, title FROM grant_applications WHERE id = ?",
    applicationId
  );
  if (!app) return { ok: false, error: "Application not found" };

  const nextStatusByAction: Record<string, string> = {
    submit: "submitted",
    review: "under_review",
    award: "awarded",
    deny: "denied",
  };
  const nextStatus = nextStatusByAction[action];
  const allowedFrom: Record<string, string[]> = {
    submit: ["draft"],
    review: ["submitted"],
    award: ["under_review", "submitted"],
    deny: ["draft", "submitted", "under_review"],
  };

  if (!allowedFrom[action].includes(app.status)) {
    return { ok: false, error: `Cannot ${action} from status ${app.status}` };
  }

  const now = new Date().toISOString();
  await db.run(
    `UPDATE grant_applications SET status = ?, workflow_stage = ?, updated_at = ?,
     submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_at END,
     rejection_reason = CASE WHEN ? = 'denied' THEN ? ELSE rejection_reason END,
     outcome_recorded_at = CASE WHEN ? IN ('awarded','denied') THEN ? ELSE outcome_recorded_at END,
     amount_awarded = CASE WHEN ? = 'awarded' THEN COALESCE(?, amount_awarded) ELSE amount_awarded END
     WHERE id = ?`,
    nextStatus,
    action === "deny" || action === "award" ? "decision" : action === "review" ? "review" : "submitted",
    now,
    nextStatus,
    now,
    nextStatus,
    opts?.reason ?? null,
    nextStatus,
    now,
    nextStatus,
    opts?.amountAwarded ?? null,
    applicationId
  );

  if (action === "deny" || action === "award") {
    await db.run(
      `INSERT INTO grant_outcomes (id, application_id, outcome, reason, amount, recorded_by, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      grantId(),
      applicationId,
      action === "award" ? "awarded" : "denied",
      opts?.reason ?? null,
      opts?.amountAwarded ?? null,
      opts?.actorEmail ?? null,
      now
    );
  }

  await ensureApplicationWorkflow(applicationId);
  const stepKey =
    action === "submit" ? "submitted" : action === "review" ? "review" : "decision";
  await db.run(
    `UPDATE grant_application_workflow SET status = 'completed', completed_at = ?, actor_email = ?
     WHERE application_id = ? AND step_key = ?`,
    now,
    opts?.actorEmail ?? null,
    applicationId,
    stepKey
  );

  await logGrantActivity("application", applicationId, `workflow_${action}`, `Application ${nextStatus}`, opts?.actorEmail);
  await logHqAudit({
    action: `grant_application_${action}`,
    entityType: "grant_application",
    entityId: applicationId,
    detail: `${app.title} → ${nextStatus}`,
    actorEmail: opts?.actorEmail,
  }).catch(() => undefined);

  if (action === "award" && opts?.amountAwarded) {
    await finalizeGrantAward(applicationId, opts.amountAwarded, opts.actorEmail);
  }

  return { ok: true, status: nextStatus, applicationId };
}

async function finalizeGrantAward(applicationId: string, amountAwarded: number, actorEmail?: string) {
  const db = await getDb();
  const app = await db.get<{
    opportunity_id: string | null;
    title: string;
    program_id: string | null;
    department_id: string | null;
  }>("SELECT opportunity_id, title, program_id, department_id FROM grant_applications WHERE id = ?", applicationId);
  if (!app) return;

  const existing = await db.get<{ id: string }>("SELECT id FROM grant_awards WHERE application_id = ?", applicationId);
  const now = new Date().toISOString();
  let awardId: string;

  if (!existing) {
    awardId = grantId();
    await db.run(
      `INSERT INTO grant_awards (id, application_id, opportunity_id, amount, award_date, status, program_id, department_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      awardId,
      applicationId,
      app.opportunity_id,
      amountAwarded,
      now.slice(0, 10),
      app.program_id,
      app.department_id,
      now
    );
    await db.run(
      `INSERT INTO grant_compliance (id, award_id, report_type, due_date, status, notes, created_at)
       VALUES (?, ?, 'Initial Progress Report', date('now', '+90 days'), 'pending', 'Auto-scheduled on award', ?)`,
      grantId(),
      awardId,
      now
    );
  } else {
    awardId = existing.id;
  }

  const opp = await db.get<{ title: string }>("SELECT title FROM grant_opportunities WHERE id = ?", app.opportunity_id);
  const awardRow = await db.get<{ finance_budget_id: string | null }>(
    "SELECT finance_budget_id FROM grant_awards WHERE id = ?",
    awardId
  );
  if (!awardRow?.finance_budget_id) {
    await createGrantFinanceBudget({
      awardId,
      grantTitle: opp?.title ?? app.title,
      amount: Number(amountAwarded),
      programId: app.program_id ?? undefined,
      departmentId: app.department_id ?? undefined,
      actor: { email: actorEmail },
    });
  }

  await logGrantActivity("award", awardId, "awarded", `Grant awarded via funding engine: $${amountAwarded}`, actorEmail);
}

export async function buildExecutiveFundingDashboard() {
  const [grantDash, db] = await Promise.all([buildGrantExecutiveDashboard(), getDb()]);

  const denied = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_applications WHERE status = 'denied'"
  ))?.c ?? 0;
  const renewalsDue = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_renewals WHERE status = 'planned' AND renewal_date <= date('now', '+90 days')"
  ))?.c ?? 0;

  const divisionFunding = await db.all(`
    SELECT json_each.value as division, COUNT(DISTINCT o.id) as opportunities,
      COALESCE(SUM(o.amount_max), 0) as pipeline_value
    FROM grant_opportunities o, json_each(o.division_slugs)
    WHERE o.status = 'open'
    GROUP BY json_each.value
    ORDER BY pipeline_value DESC
  `).catch(() => [] as { division: string; opportunities: number; pipeline_value: number }[]);

  const topScores = (await db.all(`
    SELECT s.score, s.grade, s.division_slug, o.title, o.funder, o.id as opportunity_id
    FROM grant_opportunity_scores s
    JOIN grant_opportunities o ON o.id = s.opportunity_id
    ORDER BY s.created_at DESC LIMIT 8
  `)) as Record<string, unknown>[];

  const budgetLinked = (await db.get<{ c: number; allocated: number; spent: number }>(`
    SELECT COUNT(*) as c, COALESCE(SUM(allocated), 0) as allocated, COALESCE(SUM(spent), 0) as spent
    FROM finance_budgets WHERE grant_id IS NOT NULL OR category = 'grants'
  `)) ?? { c: 0, allocated: 0, spent: 0 };

  return {
    summary: {
      openOpportunities: grantDash.openOpportunities,
      pipelineValue: grantDash.pipelineValue,
      activeAwards: grantDash.activeAwards,
      totalAwarded: grantDash.totalAwarded,
      winRate: grantDash.winRate,
      complianceDue: grantDash.complianceDue,
      pendingApplications: grantDash.pendingApplications,
      upcomingDeadlines: grantDash.upcomingDeadlines,
      deniedApplications: denied,
      renewalsDue,
    },
    pipeline: grantDash.fundingPipeline,
    divisionFunding,
    budgetIntegration: {
      linkedBudgets: budgetLinked.c,
      allocated: budgetLinked.allocated,
      spent: budgetLinked.spent,
      grantBudgetSpent: grantDash.totalBudgetSpent,
      laborCost: grantDash.totalLaborCost,
    },
    topEligibilityScores: topScores,
    divisions: IFCDC_FUNDING_DIVISIONS,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildAuraFundingIntelligence(opts?: { question?: string }) {
  const [dashboard, context] = await Promise.all([
    buildExecutiveFundingDashboard(),
    buildAuraExecutiveContext(),
  ]);

  const prompt = opts?.question?.trim()
    ? opts.question
    : "Provide executive funding intelligence: top 3 grant priorities, pipeline risks, division funding gaps, and recommended actions for the next 30 days.";

  const dataBlock = JSON.stringify(
    {
      summary: dashboard.summary,
      pipeline: dashboard.pipeline,
      divisionFunding: dashboard.divisionFunding,
      budgetIntegration: dashboard.budgetIntegration,
    },
    null,
    2
  );

  let insight: string;
  let offline = false;
  try {
    insight = await auraExecutiveChat(
      `${prompt}\n\nRespond with actionable bullet points for IFCDC leadership.`,
      `${context}\n\nGrant Funding Engine Data:\n${dataBlock}`
    );
  } catch {
    offline = true;
    insight = [
      `Pipeline value: $${dashboard.summary.pipelineValue.toLocaleString()} across ${dashboard.summary.pendingApplications} active applications.`,
      `Win rate: ${dashboard.summary.winRate}% · ${dashboard.summary.activeAwards} active awards totaling $${dashboard.summary.totalAwarded.toLocaleString()}.`,
      dashboard.summary.complianceDue > 0
        ? `${dashboard.summary.complianceDue} compliance reports due within 14 days — prioritize Grant Center compliance tab.`
        : "Grant compliance current — focus on pipeline development.",
      dashboard.summary.renewalsDue > 0
        ? `${dashboard.summary.renewalsDue} renewals planned in the next 90 days.`
        : "Review renewal calendar for upcoming award periods.",
    ].join("\n");
  }

  return {
    insight,
    dashboard: dashboard.summary,
    pipeline: dashboard.pipeline,
    divisions: dashboard.divisions,
    offline,
    generatedAt: new Date().toISOString(),
  };
}

export async function listGrantOutcomes(limit = 25) {
  const db = await getDb();
  return db.all(`
    SELECT go.*, a.title as application_title, o.title as opportunity_title, o.funder
    FROM grant_outcomes go
    JOIN grant_applications a ON a.id = go.application_id
    LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
    ORDER BY go.recorded_at DESC LIMIT ?
  `, limit);
}
