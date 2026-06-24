/**
 * IFCDC Headquarters — Grant Center v2 Funding Engine
 * Live opportunity DB, division profiles, v2 pipeline, executive analytics, enhanced AURA.
 */
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import { auraExecutiveChat } from "../lib/ifcdc";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import {
  IFCDC_FUNDING_DIVISIONS,
  searchGrantOpportunities,
  scoreOpportunityEligibility,
} from "./grantFundingEngine";

export const GRANT_FUNDING_STATUSES = [
  "identified",
  "reviewing",
  "eligible",
  "in_progress",
  "submitted",
  "awarded",
  "declined",
  "renewal",
] as const;

export const GRANT_FUNDING_STATUS_LABELS: Record<(typeof GRANT_FUNDING_STATUSES)[number], string> = {
  identified: "Identified",
  reviewing: "Reviewing",
  eligible: "Eligible",
  in_progress: "In Progress",
  submitted: "Submitted",
  awarded: "Awarded",
  declined: "Declined",
  renewal: "Renewal",
};

/** @deprecated Use GRANT_FUNDING_STATUSES — kept for backward compatibility */
export const V2_PIPELINE_STAGES = GRANT_FUNDING_STATUSES.map((s) => GRANT_FUNDING_STATUS_LABELS[s]);

function gradeFromScore(score: number): string {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

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

export async function buildV2FundingPipeline() {
  const db = await getDb();

  const identified = await db.get<{ c: number; t: number }>(
    `SELECT COUNT(*) as c, COALESCE(SUM(amount_max), 0) as t FROM grant_opportunities
     WHERE COALESCE(is_live, 1) = 1 AND COALESCE(funding_status, 'identified') = 'identified'`
  );
  const reviewing = await db.get<{ c: number; t: number }>(
    `SELECT COUNT(*) as c, COALESCE(SUM(amount_max), 0) as t FROM grant_opportunities
     WHERE COALESCE(is_live, 1) = 1 AND funding_status = 'reviewing'`
  );
  const eligible = await db.get<{ c: number; t: number }>(
    `SELECT COUNT(*) as c, COALESCE(SUM(amount_max), 0) as t FROM grant_opportunities
     WHERE COALESCE(is_live, 1) = 1 AND funding_status = 'eligible'`
  );
  const inProgress = await db.get<{ c: number; t: number }>(
    `SELECT COUNT(*) as c, COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE status = 'draft'`
  );
  const submitted = await db.get<{ c: number; t: number }>(
    `SELECT COUNT(*) as c, COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE status IN ('submitted', 'under_review')`
  );
  const awarded = await db.get<{ c: number; t: number }>(
    `SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as t FROM grant_awards WHERE status = 'active'`
  );
  const declined = await db.get<{ c: number; t: number }>(
    `SELECT COUNT(*) as c, COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE status = 'denied'`
  );
  const renewals = await db.get<{ c: number; t: number }>(`
    SELECT COUNT(*) as c, COALESCE(SUM(ga.amount), 0) as t
    FROM grant_renewals gr
    JOIN grant_awards ga ON ga.id = gr.original_award_id
    WHERE gr.status IN ('planned', 'in_progress')
  `);

  const stages = [
    { stage: "Identified", count: identified?.c ?? 0, value: identified?.t ?? 0, statusKey: "identified" },
    { stage: "Reviewing", count: reviewing?.c ?? 0, value: reviewing?.t ?? 0, statusKey: "reviewing" },
    { stage: "Eligible", count: eligible?.c ?? 0, value: eligible?.t ?? 0, statusKey: "eligible" },
    { stage: "In Progress", count: inProgress?.c ?? 0, value: inProgress?.t ?? 0, statusKey: "in_progress" },
    { stage: "Submitted", count: submitted?.c ?? 0, value: submitted?.t ?? 0, statusKey: "submitted" },
    { stage: "Awarded", count: awarded?.c ?? 0, value: awarded?.t ?? 0, statusKey: "awarded" },
    { stage: "Declined", count: declined?.c ?? 0, value: declined?.t ?? 0, statusKey: "declined" },
    { stage: "Renewal", count: renewals?.c ?? 0, value: renewals?.t ?? 0, statusKey: "renewal" },
  ];

  const totalValue = stages.reduce((s, x) => s + x.value, 0);
  return { stages, totalValue, statuses: GRANT_FUNDING_STATUSES, generatedAt: new Date().toISOString() };
}

export async function buildExecutiveFundingAnalytics() {
  const db = await getDb();

  const totalRequested = (await db.get<{ t: number }>(
    "SELECT COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE status IN ('draft','submitted','under_review')"
  ))?.t ?? 0;

  const totalAwarded = (await db.get<{ t: number }>(
    "SELECT COALESCE(SUM(amount), 0) as t FROM grant_awards WHERE status = 'active'"
  ))?.t ?? 0;

  const totalPending = (await db.get<{ t: number }>(
    "SELECT COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE status IN ('submitted','under_review')"
  ))?.t ?? 0;

  const identifiedValue = (await db.get<{ t: number }>(
    "SELECT COALESCE(SUM(amount_max), 0) as t FROM grant_opportunities WHERE status = 'open' AND COALESCE(is_live, 1) = 1"
  ))?.t ?? 0;

  const winRateRow = await db.get<{ awarded: number; decided: number }>(`
    SELECT
      (SELECT COUNT(*) FROM grant_applications WHERE status = 'awarded') as awarded,
      (SELECT COUNT(*) FROM grant_applications WHERE status IN ('awarded','denied')) as decided
  `);
  const winRate = winRateRow && winRateRow.decided > 0
    ? Math.round((winRateRow.awarded / winRateRow.decided) * 100)
    : 35;

  const projectedRevenue = Math.round(totalAwarded + totalPending * (winRate / 100) + identifiedValue * 0.15);

  const upcomingDeadlines = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_deadlines WHERE completed = 0 AND due_date >= date('now') AND due_date <= date('now', '+30 days')`
  ))?.c ?? 0;

  const complianceDue = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_compliance WHERE status = 'pending' AND due_date <= date('now', '+14 days')`
  ))?.c ?? 0;

  const profiles = await buildDivisionFundingProfiles();
  const fundingGaps = profiles.map((p) => ({
    division: p.slug,
    label: p.label,
    gap: Math.max(0, p.fundingGoal - p.awardedTotal - p.pipelineValue),
    fundingGoal: p.fundingGoal,
    awardedTotal: p.awardedTotal,
    pipelineValue: p.pipelineValue,
  })).sort((a, b) => b.gap - a.gap);

  const totalGap = fundingGaps.reduce((s, g) => s + g.gap, 0);

  const totalOpportunities = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_opportunities WHERE COALESCE(is_live, 1) = 1 AND status IN ('open', 'active', 'researching')`
  ))?.c ?? 0;

  return {
    totalOpportunities,
    totalRequested,
    totalAwarded,
    totalPending,
    projectedRevenue,
    identifiedValue,
    winRate,
    upcomingDeadlines,
    complianceDue,
    fundingGaps,
    totalFundingGap: totalGap,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildDivisionFundingProfiles() {
  const db = await getDb();
  const profiles = (await db.all("SELECT * FROM grant_division_profiles ORDER BY priority_level ASC, label ASC")) as Record<string, unknown>[];

  const enriched = await Promise.all(
    profiles.map(async (p) => {
      const slug = String(p.slug);
      const oppStats = await db.get<{ c: number; t: number }>(
        `SELECT COUNT(*) as c, COALESCE(SUM(amount_max), 0) as t FROM grant_opportunities
         WHERE status = 'open' AND division_slugs LIKE ?`,
        `%"${slug}"%`
      );
      const pipelineStats = await db.get<{ c: number; t: number }>(`
        SELECT COUNT(*) as c, COALESCE(SUM(a.amount_requested), 0) as t
        FROM grant_applications a
        JOIN grant_opportunities o ON o.id = a.opportunity_id
        WHERE a.status IN ('draft','submitted','under_review') AND o.division_slugs LIKE ?`,
        `%"${slug}"%`
      );
      const awardedStats = await db.get<{ t: number }>(`
        SELECT COALESCE(SUM(ga.amount), 0) as t
        FROM grant_awards ga
        JOIN grant_opportunities o ON o.id = ga.opportunity_id
        WHERE ga.status = 'active' AND o.division_slugs LIKE ?`,
        `%"${slug}"%`
      );
      const budgetStats = await db.get<{ allocated: number; spent: number }>(
        `SELECT COALESCE(SUM(allocated), 0) as allocated, COALESCE(SUM(spent), 0) as spent
         FROM finance_budgets WHERE category = 'grants' AND (name LIKE ? OR notes LIKE ?)`,
        `%${slug.replace(/_/g, " ")}%`,
        `%${slug}%`
      );

      const fundingGoal = Number(p.funding_goal ?? 0);
      const awardedTotal = awardedStats?.t ?? 0;
      const pipelineValue = (oppStats?.t ?? 0) + (pipelineStats?.t ?? 0);
      const budgetAllocated = budgetStats?.allocated ?? Number(p.budget_allocated ?? 0);
      const budgetSpent = budgetStats?.spent ?? Number(p.budget_spent ?? 0);

      return {
        slug,
        label: String(p.label),
        readOnly: Boolean(p.read_only),
        priorityLevel: Number(p.priority_level ?? 5),
        programAreas: parseJsonArray(p.program_areas),
        fundingGoal,
        budgetAllocated,
        budgetSpent,
        pipelineValue,
        awardedTotal,
        openOpportunities: oppStats?.c ?? 0,
        activeApplications: pipelineStats?.c ?? 0,
        fundingGap: Math.max(0, fundingGoal - awardedTotal - pipelineValue * 0.5),
        notes: String(p.notes ?? ""),
      };
    })
  );

  return enriched;
}

export async function getDivisionFundingProfile(slug: string) {
  const profiles = await buildDivisionFundingProfiles();
  const profile = profiles.find((p) => p.slug === slug);
  if (!profile) return null;

  const matches = await matchGrantsForDivision(slug, { limit: 8, persistScores: false });
  return { ...profile, topMatches: matches.matches };
}

export async function listLiveGrantOpportunities(limit = 50, opts?: { fundingStatus?: string }) {
  const db = await getDb();
  const params: unknown[] = [];
  let statusFilter = "";
  if (opts?.fundingStatus) {
    statusFilter = " AND COALESCE(o.funding_status, 'identified') = ?";
    params.push(opts.fundingStatus);
  }
  params.push(limit);

  const rows = (await db.all(`
    SELECT o.*,
      (SELECT score FROM grant_opportunity_scores WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) as latest_score,
      (SELECT grade FROM grant_opportunity_scores WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) as latest_grade,
      (SELECT strategic_fit_score FROM grant_opportunity_scores WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) as strategic_fit_score,
      (SELECT strategic_fit_grade FROM grant_opportunity_scores WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) as strategic_fit_grade
    FROM grant_opportunities o
    WHERE o.status IN ('open', 'active', 'researching') AND COALESCE(o.is_live, 1) = 1${statusFilter}
    ORDER BY CASE WHEN o.deadline IS NULL THEN 1 ELSE 0 END, o.deadline ASC, o.updated_at DESC
    LIMIT ?
  `, ...params)) as Record<string, unknown>[];

  return rows.map((row) => ({
    ...(row as Record<string, unknown>),
    program_areas: parseJsonArray(row.program_areas),
    division_slugs: parseJsonArray(row.division_slugs),
    match_tags: parseJsonArray(row.match_tags),
    fundingStatus: String(row.funding_status ?? "identified"),
    daysUntilDeadline: row.deadline
      ? Math.ceil((new Date(String(row.deadline)).getTime() - Date.now()) / 86400000)
      : null,
    isLive: Boolean(row.is_live ?? 1),
  })) as Record<string, unknown>[];
}

export async function computeStrategicFitScore(
  opportunityId: string,
  divisionSlug?: string
): Promise<{ score: number; grade: string; factors: { factor: string; score: number; max: number; detail: string }[] } | null> {
  const db = await getDb();
  const opp = await db.get("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId) as Record<string, unknown> | undefined;
  if (!opp) return null;

  const factors: { factor: string; score: number; max: number; detail: string }[] = [];
  let total = 0;
  const add = (factor: string, score: number, max: number, detail: string) => {
    factors.push({ factor, score, max, detail });
    total += score;
  };

  const divisions = parseJsonArray(opp.division_slugs);
  const targetDivision = divisionSlug ?? divisions[0];
  const division = IFCDC_FUNDING_DIVISIONS.find((d) => d.slug === targetDivision);
  const profile = targetDivision
    ? await db.get<{ funding_goal: number; awarded_total: number; pipeline_value: number; priority_level: number; program_areas: string }>(
        "SELECT funding_goal, awarded_total, pipeline_value, priority_level, program_areas FROM grant_division_profiles WHERE slug = ?",
        targetDivision
      )
    : null;

  if (targetDivision && divisions.includes(targetDivision)) {
    add("Program alignment", 25, 25, `Direct fit for ${targetDivision}`);
  } else if (divisions.length > 0) {
    add("Program alignment", 15, 25, `Cross-division: ${divisions.join(", ")}`);
  } else {
    add("Program alignment", 8, 25, "General IFCDC mission fit");
  }

  const fundingGoal = Number(profile?.funding_goal ?? 100000);
  const awardedTotal = Number(profile?.awarded_total ?? 0);
  const gapRatio = fundingGoal > 0 ? Math.min(1, (fundingGoal - awardedTotal) / fundingGoal) : 0.5;
  add("Funding gap priority", Math.round(gapRatio * 30), 30, gapRatio > 0.5 ? "High unmet funding need" : "Moderate funding need");

  const priorityLevel = Number(profile?.priority_level ?? 5);
  add("Division priority", Math.max(5, 20 - priorityLevel * 2), 20, `Priority level ${priorityLevel}`);

  const oppAreas = parseJsonArray(opp.program_areas);
  const divAreas = profile?.program_areas ? parseJsonArray(profile.program_areas) : (division?.programs ?? []);
  const overlap = oppAreas.filter((a) => divAreas.some((d) => d.includes(a) || a.includes(d))).length;
  if (overlap > 0) add("Program area overlap", Math.min(15, overlap * 5), 15, `${overlap} shared program areas`);
  else add("Program area overlap", 5, 15, "Review program alignment");

  const capacityRatio = fundingGoal > 0 ? awardedTotal / fundingGoal : 0;
  if (capacityRatio < 0.5) add("Capacity headroom", 10, 10, "Room to absorb new awards");
  else if (capacityRatio < 0.85) add("Capacity headroom", 6, 10, "Moderate award capacity");
  else add("Capacity headroom", 2, 10, "Near funding goal — prioritize renewals");

  const score = Math.min(100, total);
  return { score, grade: gradeFromScore(score), factors };
}

export async function scoreOpportunityDual(
  opportunityId: string,
  opts?: { divisionSlug?: string; actorEmail?: string }
) {
  const db = await getDb();

  await db.run(
    `UPDATE grant_opportunities SET funding_status = 'reviewing' WHERE id = ? AND funding_status IN ('identified', 'eligible')`,
    opportunityId
  );

  const eligibility = await scoreOpportunityEligibility(opportunityId, opts);
  if (!eligibility) return null;

  const strategic = await computeStrategicFitScore(opportunityId, opts?.divisionSlug);
  if (strategic) {
    await db.run(
      `UPDATE grant_opportunity_scores SET strategic_fit_score = ?, strategic_fit_grade = ?
       WHERE id = (SELECT id FROM grant_opportunity_scores WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1)`,
      strategic.score,
      strategic.grade,
      opportunityId
    );
  }

  if (eligibility.score >= 60 && (strategic?.score ?? 0) >= 50) {
    await db.run(
      `UPDATE grant_opportunities SET funding_status = 'eligible' WHERE id = ? AND funding_status IN ('identified', 'reviewing')`,
      opportunityId
    );
  }

  await logHqAudit({
    action: "grant_dual_scored",
    entityType: "grant_opportunity",
    entityId: opportunityId,
    detail: `Eligibility ${eligibility.score}% · Strategic fit ${strategic?.score ?? 0}%`,
    actorEmail: opts?.actorEmail,
  }).catch(() => undefined);

  return {
    opportunityId,
    eligibilityScore: eligibility.score,
    eligibilityGrade: eligibility.grade,
    strategicFitScore: strategic?.score ?? 0,
    strategicFitGrade: strategic?.grade ?? "—",
    score: eligibility.score,
    grade: eligibility.grade,
    factors: eligibility.factors,
    strategicFactors: strategic?.factors ?? [],
    fundingStatus: eligibility.score >= 60 && (strategic?.score ?? 0) >= 50 ? "eligible" : "reviewing",
  };
}

export async function updateOpportunityFundingStatus(
  opportunityId: string,
  fundingStatus: string,
  actorEmail?: string
) {
  if (!GRANT_FUNDING_STATUSES.includes(fundingStatus as (typeof GRANT_FUNDING_STATUSES)[number])) {
    return { ok: false, error: "Invalid funding status" };
  }
  const db = await getDb();
  const opp = await db.get("SELECT id FROM grant_opportunities WHERE id = ?", opportunityId);
  if (!opp) return { ok: false, error: "Opportunity not found" };

  await db.run(
    "UPDATE grant_opportunities SET funding_status = ?, updated_at = ? WHERE id = ?",
    fundingStatus,
    new Date().toISOString(),
    opportunityId
  );

  await logHqAudit({
    action: "grant_funding_status_updated",
    entityType: "grant_opportunity",
    entityId: opportunityId,
    detail: `Status → ${fundingStatus}`,
    actorEmail,
  }).catch(() => undefined);

  return { ok: true, fundingStatus };
}

export async function buildGrantFinanceConnection() {
  const db = await getDb();

  const budgetSummary = await db.get<{ linked: number; allocated: number; spent: number }>(`
    SELECT COUNT(*) as linked, COALESCE(SUM(allocated), 0) as allocated, COALESCE(SUM(spent), 0) as spent
    FROM finance_budgets WHERE category = 'grants' OR grant_id IS NOT NULL
  `);

  const complianceDue = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_compliance WHERE status = 'pending' AND due_date <= date('now', '+14 days')`
  ))?.c ?? 0;

  const restrictions = (await db.all(`
    SELECT ga.id as award_id, COALESCE(o.title, a.title, 'Grant Award') as title, ga.amount, fb.allocated, fb.spent,
      (fb.allocated - fb.spent) as remaining, ga.finance_budget_id
    FROM grant_awards ga
    LEFT JOIN finance_budgets fb ON fb.id = ga.finance_budget_id
    LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
    LEFT JOIN grant_applications a ON a.id = ga.application_id
    WHERE ga.status = 'active' AND fb.id IS NOT NULL
    ORDER BY (fb.allocated - fb.spent) ASC LIMIT 10
  `)) as Record<string, unknown>[];

  const spendingAlerts = restrictions.filter((r) => {
    const allocated = Number(r.allocated ?? 0);
    const spent = Number(r.spent ?? 0);
    return allocated > 0 && spent / allocated > 0.85;
  });

  return {
    linkedBudgets: budgetSummary?.linked ?? 0,
    totalAllocated: budgetSummary?.allocated ?? 0,
    totalSpent: budgetSummary?.spent ?? 0,
    totalRemaining: (budgetSummary?.allocated ?? 0) - (budgetSummary?.spent ?? 0),
    complianceDue,
    spendingAlerts: spendingAlerts.length,
    budgetRestrictions: restrictions.map((r) => ({
      awardId: r.award_id,
      title: r.title,
      allocated: Number(r.allocated ?? 0),
      spent: Number(r.spent ?? 0),
      remaining: Number(r.remaining ?? 0),
      financeBudgetId: r.finance_budget_id,
    })),
    generatedAt: new Date().toISOString(),
  };
}

export async function buildAuraFundingRecommendations() {
  const [analytics, liveOpps, profiles] = await Promise.all([
    buildExecutiveFundingAnalytics(),
    listLiveGrantOpportunities(20),
    buildDivisionFundingProfiles(),
  ]);

  const priorityGrants = liveOpps
    .filter((o) => Number(o.latest_score ?? 0) >= 55 || Number(o.strategic_fit_score ?? 0) >= 55)
    .sort((a, b) => (Number(b.latest_score ?? 0) + Number(b.strategic_fit_score ?? 0))
      - (Number(a.latest_score ?? 0) + Number(a.strategic_fit_score ?? 0)))
    .slice(0, 5)
    .map((o) => ({
      id: o.id,
      title: String(o.title ?? ""),
      funder: String(o.funder ?? ""),
      amount: o.amount_max,
      deadline: o.deadline,
      eligibilityScore: o.latest_score,
      strategicFitScore: o.strategic_fit_score,
      fundingStatus: o.fundingStatus,
    }));

  const divisionPriorities = analytics.fundingGaps.slice(0, 5);
  const actions: string[] = [];

  if (analytics.upcomingDeadlines > 0) {
    actions.push(`Review ${analytics.upcomingDeadlines} grant deadlines within 30 days`);
  }
  if (analytics.complianceDue > 0) {
    actions.push(`Complete ${analytics.complianceDue} compliance reports due within 14 days`);
  }
  if (divisionPriorities[0]?.gap > 0) {
    actions.push(`Prioritize ${divisionPriorities[0].label} — $${divisionPriorities[0].gap.toLocaleString()} funding gap`);
  }
  if (priorityGrants.length > 0) {
    actions.push(`Pursue ${String(priorityGrants[0].title)} — strong eligibility and strategic fit`);
  }
  if (!actions.length) {
    actions.push("Pipeline healthy — maintain grant discovery and division profile updates");
  }

  return {
    priorityGrants,
    divisionPriorities,
    actions,
    capacityEstimate: analytics.totalAwarded + analytics.projectedRevenue - analytics.totalPending,
    programProfiles: profiles.length,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildFundingEngineDashboard() {
  const [totals, pipeline, profiles, finance, auraRecommendations] = await Promise.all([
    buildExecutiveFundingAnalytics(),
    buildV2FundingPipeline(),
    buildDivisionFundingProfiles(),
    buildGrantFinanceConnection(),
    buildAuraFundingRecommendations(),
  ]);

  return {
    totals: {
      totalOpportunities: totals.totalOpportunities,
      totalRequested: totals.totalRequested,
      totalAwarded: totals.totalAwarded,
      totalPending: totals.totalPending,
      upcomingDeadlines: totals.upcomingDeadlines,
    },
    pipeline,
    profiles,
    finance,
    auraRecommendations,
    fundingGaps: totals.fundingGaps,
    projectedRevenue: totals.projectedRevenue,
    winRate: totals.winRate,
    statuses: GRANT_FUNDING_STATUSES.map((s) => ({ key: s, label: GRANT_FUNDING_STATUS_LABELS[s] })),
    generatedAt: new Date().toISOString(),
  };
}

export async function matchGrantsForDivision(
  divisionSlug: string,
  opts?: { limit?: number; persistScores?: boolean; actorEmail?: string }
) {
  const division = IFCDC_FUNDING_DIVISIONS.find((d) => d.slug === divisionSlug);
  if (!division) return { divisionSlug, matches: [], generatedAt: new Date().toISOString() };

  const opportunities = await searchGrantOpportunities({
    division: divisionSlug,
    limit: opts?.limit ?? 15,
  });

  const db = await getDb();
  const matches = await Promise.all(
    opportunities.map(async (opp) => {
      const oppId = String((opp as Record<string, unknown>).id);
      let eligibilityScore = 0;
      let eligibilityGrade = "—";
      let strategicFitScore = 0;
      let strategicFitGrade = "—";
      let factors: unknown[] = [];

      if (opts?.persistScores !== false) {
        const dual = await scoreOpportunityDual(oppId, { divisionSlug, actorEmail: opts?.actorEmail });
        if (dual) {
          eligibilityScore = dual.eligibilityScore;
          eligibilityGrade = dual.eligibilityGrade;
          strategicFitScore = dual.strategicFitScore;
          strategicFitGrade = dual.strategicFitGrade;
          factors = dual.factors;
        }
      } else {
        const latest = await db.get<{ score: number; grade: string; factors_json: string; strategic_fit_score: number | null; strategic_fit_grade: string | null }>(
          `SELECT score, grade, factors_json, strategic_fit_score, strategic_fit_grade FROM grant_opportunity_scores
           WHERE opportunity_id = ? AND division_slug = ? ORDER BY created_at DESC LIMIT 1`,
          oppId,
          divisionSlug
        );
        if (latest) {
          eligibilityScore = latest.score;
          eligibilityGrade = latest.grade;
          strategicFitScore = latest.strategic_fit_score ?? 0;
          strategicFitGrade = latest.strategic_fit_grade ?? "—";
          factors = JSON.parse(latest.factors_json || "[]");
        } else {
          const scored = await scoreOpportunityDual(oppId, { divisionSlug, actorEmail: opts?.actorEmail });
          if (scored) {
            eligibilityScore = scored.eligibilityScore;
            eligibilityGrade = scored.eligibilityGrade;
            strategicFitScore = scored.strategicFitScore;
            strategicFitGrade = scored.strategicFitGrade;
            factors = scored.factors;
          }
        }
      }

      return {
        ...opp,
        matchScore: eligibilityScore,
        matchGrade: eligibilityGrade,
        eligibilityScore,
        strategicFitScore,
        strategicFitGrade,
        factors,
        divisionSlug,
        programs: division.programs,
      };
    })
  );

  matches.sort((a, b) => (b.matchScore as number) - (a.matchScore as number));

  await logHqAudit({
    action: "grant_division_match",
    entityType: "grant_division",
    entityId: divisionSlug,
    detail: `Matched ${matches.length} opportunities for ${division.label}`,
    actorEmail: opts?.actorEmail,
  }).catch(() => undefined);

  return {
    divisionSlug,
    divisionLabel: division.label,
    programs: division.programs,
    matches: matches.slice(0, opts?.limit ?? 15),
    generatedAt: new Date().toISOString(),
  };
}

export async function listDocumentChecklist(applicationId?: string) {
  const db = await getDb();
  const categories = ["required", "narrative", "budget", "attachment", "supporting"] as const;

  let sql = `
    SELECT d.*, a.title as application_title, o.title as opportunity_title
    FROM grant_documents d
    LEFT JOIN grant_applications a ON a.id = d.application_id
    LEFT JOIN grant_opportunities o ON o.id = d.opportunity_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (applicationId) {
    sql += " AND d.application_id = ?";
    params.push(applicationId);
  }
  sql += " ORDER BY d.doc_category, d.created_at DESC";

  const documents = (await db.all(sql, ...params)) as Record<string, unknown>[];

  const byCategory = categories.map((cat) => ({
    category: cat,
    documents: documents.filter((d) => String(d.doc_category ?? d.doc_type ?? "attachment") === cat),
    uploaded: documents.filter((d) => String(d.doc_category ?? d.doc_type ?? "attachment") === cat && d.file_url).length,
    total: documents.filter((d) => String(d.doc_category ?? d.doc_type ?? "attachment") === cat).length,
  }));

  const requiredTemplates = applicationId
    ? ((await db.all(
        `SELECT name, doc_type FROM grant_documents WHERE application_id IS NULL AND opportunity_id = (
          SELECT opportunity_id FROM grant_applications WHERE id = ?
        ) AND required = 1`,
        applicationId
      )) as { name: string; doc_type: string }[])
    : [];

  return {
    applicationId: applicationId ?? null,
    byCategory,
    requiredTemplates,
    totalDocuments: documents.length,
    approvedCount: documents.filter((d) => d.status === "approved").length,
    pendingCount: documents.filter((d) => !d.file_url || d.status === "pending").length,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildAuraFundingIntelligenceV2(opts?: { question?: string; actorEmail?: string }) {
  const [analytics, pipeline, profiles, liveOpps, context] = await Promise.all([
    buildExecutiveFundingAnalytics(),
    buildV2FundingPipeline(),
    buildDivisionFundingProfiles(),
    listLiveGrantOpportunities(10),
    buildAuraExecutiveContext(),
  ]);

  const priorityGrants = liveOpps
    .filter((o) => (o.latest_score as number | null) == null || Number(o.latest_score) >= 60)
    .slice(0, 5)
    .map((o) => ({
      title: String(o.title ?? ""),
      funder: String(o.funder ?? ""),
      amount: o.amount_max,
      deadline: o.deadline,
      score: o.latest_score,
    }));

  const topGaps = analytics.fundingGaps.slice(0, 5);
  const capacityEstimate = analytics.totalAwarded + analytics.projectedRevenue - analytics.totalPending;

  const briefingData = {
    analytics,
    pipeline: pipeline.stages,
    topFundingGaps: topGaps,
    priorityGrants,
    divisionCount: profiles.length,
    complianceDue: analytics.complianceDue,
    upcomingDeadlines: analytics.upcomingDeadlines,
    capacityEstimate,
  };

  const defaultPrompt = [
    "As IFCDC AURA Funding Intelligence, provide an executive briefing covering:",
    "1) Top 3 priority grants to pursue now",
    "2) Approaching deadlines within 30 days",
    "3) Compliance risks requiring immediate attention",
    "4) Estimated funding capacity for sustainable staffing growth",
    "5) Division-specific funding gaps and recommended actions",
  ].join("\n");

  const prompt = opts?.question?.trim() || defaultPrompt;

  let insight: string;
  let offline = false;
  try {
    insight = await auraExecutiveChat(
      `${prompt}\n\nRespond with clear bullet points for IFCDC leadership.`,
      `${context}\n\nGrant Center v2 Intelligence Data:\n${JSON.stringify(briefingData, null, 2)}`
    );
  } catch {
    offline = true;
    insight = [
      `Funding capacity estimate: $${capacityEstimate.toLocaleString()} (awarded + projected − pending).`,
      `Pipeline: $${analytics.totalRequested.toLocaleString()} requested · $${analytics.totalAwarded.toLocaleString()} awarded · $${analytics.totalPending.toLocaleString()} pending.`,
      analytics.upcomingDeadlines > 0
        ? `${analytics.upcomingDeadlines} grant deadlines within 30 days — review Grant Center Deadlines tab.`
        : "No critical deadlines in the next 30 days.",
      analytics.complianceDue > 0
        ? `${analytics.complianceDue} compliance reports due within 14 days — compliance risk elevated.`
        : "Compliance reports current.",
      topGaps.length
        ? `Largest funding gap: ${topGaps[0].label} ($${topGaps[0].gap.toLocaleString()} below goal).`
        : "Division funding gaps within acceptable range.",
      priorityGrants.length
        ? `Priority grant: ${String(priorityGrants[0]?.title)} (${String(priorityGrants[0]?.funder)}).`
        : "Add live opportunities to enable priority grant recommendations.",
    ].join("\n");
  }

  return {
    insight,
    offline,
    analytics,
    pipeline: pipeline.stages,
    priorityGrants,
    fundingGaps: topGaps,
    capacityEstimate,
    generatedAt: new Date().toISOString(),
  };
}
