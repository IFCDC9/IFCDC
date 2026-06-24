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

export const V2_PIPELINE_STAGES = [
  "Identified",
  "In Progress",
  "Submitted",
  "Awarded",
  "Declined",
  "Renewals",
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

export async function buildV2FundingPipeline() {
  const db = await getDb();

  const identified = await db.get<{ c: number; t: number }>(
    "SELECT COUNT(*) as c, COALESCE(SUM(amount_max), 0) as t FROM grant_opportunities WHERE status = 'open' AND COALESCE(is_live, 1) = 1"
  );
  const inProgress = await db.get<{ c: number; t: number }>(
    "SELECT COUNT(*) as c, COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE status = 'draft'"
  );
  const submitted = await db.get<{ c: number; t: number }>(
    "SELECT COUNT(*) as c, COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE status = 'submitted'"
  );
  const awarded = await db.get<{ c: number; t: number }>(
    "SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as t FROM grant_awards WHERE status = 'active'"
  );
  const declined = await db.get<{ c: number; t: number }>(
    "SELECT COUNT(*) as c, COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE status = 'denied'"
  );
  const renewals = await db.get<{ c: number; t: number }>(`
    SELECT COUNT(*) as c, COALESCE(SUM(ga.amount), 0) as t
    FROM grant_renewals gr
    JOIN grant_awards ga ON ga.id = gr.original_award_id
    WHERE gr.status IN ('planned', 'in_progress')
  `);

  const stages = [
    { stage: "Identified", count: identified?.c ?? 0, value: identified?.t ?? 0, statusKey: "identified" },
    { stage: "In Progress", count: inProgress?.c ?? 0, value: inProgress?.t ?? 0, statusKey: "in_progress" },
    { stage: "Submitted", count: submitted?.c ?? 0, value: submitted?.t ?? 0, statusKey: "submitted" },
    { stage: "Awarded", count: awarded?.c ?? 0, value: awarded?.t ?? 0, statusKey: "awarded" },
    { stage: "Declined", count: declined?.c ?? 0, value: declined?.t ?? 0, statusKey: "declined" },
    { stage: "Renewals", count: renewals?.c ?? 0, value: renewals?.t ?? 0, statusKey: "renewals" },
  ];

  const totalValue = stages.reduce((s, x) => s + x.value, 0);
  return { stages, totalValue, generatedAt: new Date().toISOString() };
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

  return {
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

export async function listLiveGrantOpportunities(limit = 50) {
  const db = await getDb();
  const rows = (await db.all(`
    SELECT o.*,
      (SELECT score FROM grant_opportunity_scores WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) as latest_score,
      (SELECT grade FROM grant_opportunity_scores WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) as latest_grade
    FROM grant_opportunities o
    WHERE o.status IN ('open', 'active', 'researching') AND COALESCE(o.is_live, 1) = 1
    ORDER BY CASE WHEN o.deadline IS NULL THEN 1 ELSE 0 END, o.deadline ASC, o.updated_at DESC
    LIMIT ?
  `, limit)) as Record<string, unknown>[];

  return rows.map((row) => ({
    ...(row as Record<string, unknown>),
    program_areas: parseJsonArray(row.program_areas),
    division_slugs: parseJsonArray(row.division_slugs),
    match_tags: parseJsonArray(row.match_tags),
    daysUntilDeadline: row.deadline
      ? Math.ceil((new Date(String(row.deadline)).getTime() - Date.now()) / 86400000)
      : null,
    isLive: Boolean(row.is_live ?? 1),
  })) as Record<string, unknown>[];
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
      let scoreResult: { score: number; grade: string; factors: unknown[] } | null = null;

      if (opts?.persistScores !== false) {
        scoreResult = await scoreOpportunityEligibility(oppId, {
          divisionSlug,
          actorEmail: opts?.actorEmail,
        });
      } else {
        const latest = await db.get<{ score: number; grade: string; factors_json: string }>(
          `SELECT score, grade, factors_json FROM grant_opportunity_scores WHERE opportunity_id = ? AND division_slug = ?
           ORDER BY created_at DESC LIMIT 1`,
          oppId,
          divisionSlug
        );
        if (latest) {
          scoreResult = {
            score: latest.score,
            grade: latest.grade,
            factors: JSON.parse(latest.factors_json || "[]"),
          };
        } else {
          const scored = await scoreOpportunityEligibility(oppId, { divisionSlug, actorEmail: opts?.actorEmail });
          if (scored) scoreResult = { score: scored.score, grade: scored.grade, factors: scored.factors };
        }
      }

      return {
        ...opp,
        matchScore: scoreResult?.score ?? 0,
        matchGrade: scoreResult?.grade ?? "—",
        factors: scoreResult?.factors ?? [],
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
