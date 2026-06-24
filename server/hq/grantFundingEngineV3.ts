/**
 * IFCDC Headquarters — Grant Center v3 Intelligent Funding Engine
 * AI discovery, executive dashboard, program profiles, document center, AURA executive intelligence.
 */
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import { auraExecutiveChat } from "../lib/ifcdc";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import {
  buildExecutiveFundingAnalytics,
  buildDivisionFundingProfiles,
  listLiveGrantOpportunities,
  scoreOpportunityDual,
  buildGrantFinanceConnection,
  buildFundingEngineDashboard,
} from "./grantFundingEngineV2";

export const AURA_EXECUTIVE_QUESTIONS = [
  "Which grants should we apply for next?",
  "Which programs are underfunded?",
  "What deadlines are approaching?",
  "Can we afford to hire staff?",
  "What funding risks require attention?",
] as const;

export const DOCUMENT_CENTER_CATEGORIES = [
  "narrative",
  "budget",
  "required",
  "attachment",
  "supporting",
  "board_approval",
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

function priorityLabel(score: number): string {
  if (score >= 80) return "Critical Priority";
  if (score >= 65) return "High Priority";
  if (score >= 50) return "Moderate Priority";
  return "Monitor";
}

function combinedPriorityScore(eligibility: number, strategic: number): number {
  return Math.round(eligibility * 0.55 + strategic * 0.45);
}

export async function discoverAndRankGrants(opts?: {
  limit?: number;
  divisionSlug?: string;
  actorEmail?: string;
  persistScores?: boolean;
}) {
  const db = await getDb();
  const limit = opts?.limit ?? 20;
  const opportunities = await listLiveGrantOpportunities(Math.max(limit, 25));

  const ranked = await Promise.all(
    opportunities.map(async (opp) => {
      const oppId = String(opp.id);
      let eligibilityScore = Number(opp.latest_score ?? 0);
      let strategicFitScore = Number(opp.strategic_fit_score ?? 0);

      if ((!eligibilityScore || !strategicFitScore) && opts?.persistScores !== false) {
        const division =
          opts?.divisionSlug ?? parseJsonArray(opp.division_slugs)[0] ?? "community_programs";
        const dual = await scoreOpportunityDual(oppId, {
          divisionSlug: division,
          actorEmail: opts?.actorEmail,
        });
        if (dual) {
          eligibilityScore = dual.eligibilityScore;
          strategicFitScore = dual.strategicFitScore;
        }
      }

      const priorityScore = combinedPriorityScore(eligibilityScore, strategicFitScore);

      if (opts?.persistScores !== false && priorityScore > 0) {
        await db.run(
          `UPDATE grant_opportunity_scores SET priority_score = ?
           WHERE id = (SELECT id FROM grant_opportunity_scores WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1)`,
          priorityScore,
          oppId
        ).catch(() => undefined);
      }

      return {
        id: oppId,
        title: String(opp.title ?? ""),
        funder: String(opp.funder ?? ""),
        amountMax: Number(opp.amount_max ?? 0),
        deadline: opp.deadline ?? null,
        fundingStatus: String(opp.fundingStatus ?? "identified"),
        divisionSlugs: parseJsonArray(opp.division_slugs),
        eligibilityScore,
        strategicFitScore,
        priorityScore,
        recommendation: priorityLabel(priorityScore),
        daysUntilDeadline: opp.daysUntilDeadline ?? null,
      };
    })
  );

  ranked.sort((a, b) => b.priorityScore - a.priorityScore);

  const topRecommendations = ranked.filter((r) => r.priorityScore >= 60).slice(0, 8);

  await logHqAudit({
    action: "grant_v3_discovery",
    entityType: "grant_funding_engine",
    entityId: "v3",
    detail: `Ranked ${ranked.length} opportunities · ${topRecommendations.length} high-priority`,
    actorEmail: opts?.actorEmail,
  }).catch(() => undefined);

  return {
    ranked: ranked.slice(0, limit),
    topRecommendations,
    totalScored: ranked.length,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildRenewalCalendar() {
  const db = await getDb();

  const renewals = (await db.all(`
    SELECT gr.id, gr.renewal_date, gr.status, gr.notes,
      ga.amount, ga.period_end, COALESCE(o.title, a.title, 'Grant Renewal') as grant_title
    FROM grant_renewals gr
    JOIN grant_awards ga ON ga.id = gr.original_award_id
    LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
    LEFT JOIN grant_applications a ON a.id = ga.application_id
    WHERE gr.status IN ('planned', 'in_progress')
    ORDER BY gr.renewal_date ASC
    LIMIT 20
  `)) as Record<string, unknown>[];

  const awardExpirations = (await db.all(`
    SELECT ga.id as award_id, ga.period_end, ga.amount,
      COALESCE(o.title, a.title, 'Active Grant') as grant_title
    FROM grant_awards ga
    LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
    LEFT JOIN grant_applications a ON a.id = ga.application_id
    WHERE ga.status = 'active' AND ga.period_end IS NOT NULL
      AND ga.period_end >= date('now') AND ga.period_end <= date('now', '+365 days')
    ORDER BY ga.period_end ASC
    LIMIT 15
  `)) as Record<string, unknown>[];

  const events = [
    ...renewals.map((r) => ({
      type: "renewal" as const,
      date: String(r.renewal_date ?? r.period_end ?? ""),
      title: String(r.grant_title ?? "Renewal"),
      amount: Number(r.amount ?? 0),
      status: String(r.status ?? "planned"),
    })),
    ...awardExpirations.map((r) => ({
      type: "expiration" as const,
      date: String(r.period_end ?? ""),
      title: String(r.grant_title ?? "Grant period end"),
      amount: Number(r.amount ?? 0),
      status: "active",
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const upcoming90 = events.filter((e) => {
    if (!e.date) return false;
    const days = Math.ceil((new Date(e.date).getTime() - Date.now()) / 86400000);
    return days >= 0 && days <= 90;
  }).length;

  return { events, upcoming90Days: upcoming90, generatedAt: new Date().toISOString() };
}

export async function buildProgramFundingProfilesV3() {
  const db = await getDb();
  const base = await buildDivisionFundingProfiles();

  return Promise.all(
    base.map(async (p) => {
      const slug = p.slug;
      const requested = await db.get<{ t: number; c: number }>(`
        SELECT COALESCE(SUM(a.amount_requested), 0) as t, COUNT(*) as c
        FROM grant_applications a
        JOIN grant_opportunities o ON o.id = a.opportunity_id
        WHERE a.status IN ('draft','submitted','under_review') AND o.division_slugs LIKE ?`,
        `%"${slug}"%`
      );

      const compliance = await db.get<{ pending: number; overdue: number }>(`
        SELECT
          SUM(CASE WHEN gc.status = 'pending' AND gc.due_date >= date('now') THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN gc.status = 'pending' AND gc.due_date < date('now') THEN 1 ELSE 0 END) as overdue
        FROM grant_compliance gc
        JOIN grant_awards ga ON ga.id = gc.award_id
        JOIN grant_opportunities o ON o.id = ga.opportunity_id
        WHERE o.division_slugs LIKE ?`,
        `%"${slug}"%`
      );

      const outcomes = await db.get<{ awarded: number; denied: number; total: number }>(`
        SELECT
          SUM(CASE WHEN go.outcome = 'awarded' THEN 1 ELSE 0 END) as awarded,
          SUM(CASE WHEN go.outcome = 'denied' THEN 1 ELSE 0 END) as denied,
          COUNT(*) as total
        FROM grant_outcomes go
        JOIN grant_applications a ON a.id = go.application_id
        JOIN grant_opportunities o ON o.id = a.opportunity_id
        WHERE o.division_slugs LIKE ?`,
        `%"${slug}"%`
      );

      const awardedCount = Number(outcomes?.awarded ?? 0);
      const deniedCount = Number(outcomes?.denied ?? 0);
      const decided = awardedCount + deniedCount;
      const winRate = decided > 0 ? Math.round((awardedCount / decided) * 100) : null;

      const currentBudget = p.budgetAllocated;
      const spending = p.budgetSpent;
      const remainingBalance = Math.max(0, currentBudget - spending);
      const pendingCompliance = Number(compliance?.pending ?? 0);
      const overdueCompliance = Number(compliance?.overdue ?? 0);

      let complianceStatus = "Current";
      if (overdueCompliance > 0) complianceStatus = `${overdueCompliance} overdue`;
      else if (pendingCompliance > 0) complianceStatus = `${pendingCompliance} due`;

      return {
        ...p,
        currentBudget,
        requestedFunding: requested?.t ?? 0,
        awardedFunding: p.awardedTotal,
        spending,
        remainingBalance,
        complianceStatus,
        compliancePending: pendingCompliance,
        complianceOverdue: overdueCompliance,
        outcomeMetrics: {
          applicationsDecided: decided,
          awardsRecorded: awardedCount,
          denialsRecorded: deniedCount,
          winRate,
          activeApplications: Number(requested?.c ?? 0),
        },
      };
    })
  );
}

export async function buildGrantDocumentCenter(opts?: {
  applicationId?: string;
  opportunityId?: string;
}) {
  const db = await getDb();
  const params: unknown[] = [];
  let filter = "";

  if (opts?.applicationId) {
    filter += " AND (d.application_id = ? OR d.opportunity_id = (SELECT opportunity_id FROM grant_applications WHERE id = ?))";
    params.push(opts.applicationId, opts.applicationId);
  }
  if (opts?.opportunityId) {
    filter += " AND (d.opportunity_id = ? OR d.application_id IN (SELECT id FROM grant_applications WHERE opportunity_id = ?))";
    params.push(opts.opportunityId, opts.opportunityId);
  }

  const documents = (await db.all(`
    SELECT d.*,
      a.title as application_title,
      o.title as opportunity_title,
      o.funder
    FROM grant_documents d
    LEFT JOIN grant_applications a ON a.id = d.application_id
    LEFT JOIN grant_opportunities o ON o.id = COALESCE(d.opportunity_id, a.opportunity_id)
    WHERE 1=1${filter}
    ORDER BY d.doc_category, d.created_at DESC
  `, ...params)) as Record<string, unknown>[];

  const byCategory = DOCUMENT_CENTER_CATEGORIES.map((cat) => ({
    category: cat,
    label: cat === "board_approval" ? "Board Approvals" : cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, " "),
    documents: documents.filter((d) => String(d.doc_category ?? "attachment") === cat),
  }));

  const linkedGrants = (await db.all(`
    SELECT DISTINCT
      COALESCE(a.id, o.id) as grant_key,
      COALESCE(a.title, o.title) as title,
      o.funder,
      a.id as application_id,
      o.id as opportunity_id,
      (SELECT COUNT(*) FROM grant_documents WHERE application_id = a.id OR opportunity_id = o.id) as doc_count
    FROM grant_opportunities o
    LEFT JOIN grant_applications a ON a.opportunity_id = o.id
    WHERE o.status IN ('open','active','researching') OR a.id IS NOT NULL
    ORDER BY doc_count DESC
    LIMIT 25
  `)) as Record<string, unknown>[];

  return {
    byCategory,
    linkedGrants: linkedGrants.map((g) => ({
      grantKey: g.grant_key,
      title: String(g.title ?? "Grant"),
      funder: String(g.funder ?? ""),
      applicationId: g.application_id ?? null,
      opportunityId: g.opportunity_id ?? null,
      documentCount: Number(g.doc_count ?? 0),
    })),
    totalDocuments: documents.length,
    narratives: byCategory.find((c) => c.category === "narrative")?.documents.length ?? 0,
    budgets: byCategory.find((c) => c.category === "budget")?.documents.length ?? 0,
    attachments: byCategory.find((c) => c.category === "required")?.documents.length ?? 0
      + (byCategory.find((c) => c.category === "attachment")?.documents.length ?? 0),
    boardApprovals: byCategory.find((c) => c.category === "board_approval")?.documents.length ?? 0,
    supporting: byCategory.find((c) => c.category === "supporting")?.documents.length ?? 0,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildExecutiveIntelligentDashboardV3() {
  const db = await getDb();
  const [analytics, discovery, profiles, renewals, finance, documents] = await Promise.all([
    buildExecutiveFundingAnalytics(),
    discoverAndRankGrants({ limit: 15, persistScores: true }),
    buildProgramFundingProfilesV3(),
    buildRenewalCalendar(),
    buildGrantFinanceConnection(),
    buildGrantDocumentCenter(),
  ]);

  const pendingApplications = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_applications WHERE status IN ('submitted','under_review')"
  ))?.c ?? 0;

  const monthsRemaining = 12 - new Date().getMonth();
  const estimatedAnnualPipeline = Math.round(
    analytics.projectedRevenue + analytics.totalAwarded * (monthsRemaining / 12)
  );

  const fundingGapByProgram = profiles
    .map((p) => ({
      slug: p.slug,
      label: p.label,
      fundingGoal: p.fundingGoal,
      gap: p.fundingGap,
      requestedFunding: p.requestedFunding,
      awardedFunding: p.awardedFunding,
    }))
    .sort((a, b) => b.gap - a.gap);

  return {
    executive: {
      totalOpportunities: analytics.totalOpportunities,
      totalFundingRequested: analytics.totalRequested,
      totalFundingAwarded: analytics.totalAwarded,
      pendingApplications,
      totalPendingValue: analytics.totalPending,
      upcomingDeadlines: analytics.upcomingDeadlines,
      renewalCalendar: renewals,
      fundingGapByProgram,
      estimatedAnnualPipeline,
      winRate: analytics.winRate,
      complianceDue: analytics.complianceDue,
    },
    discovery,
    profiles,
    finance,
    documents: {
      totalDocuments: documents.totalDocuments,
      narratives: documents.narratives,
      budgets: documents.budgets,
      boardApprovals: documents.boardApprovals,
      linkedGrants: documents.linkedGrants.length,
    },
    topRecommendations: discovery.topRecommendations,
    generatedAt: new Date().toISOString(),
  };
}

function buildOfflineExecutiveAnswer(
  question: string,
  dash: Awaited<ReturnType<typeof buildExecutiveIntelligentDashboardV3>>
): string {
  const q = question.toLowerCase();

  if (q.includes("apply") || q.includes("which grant") || q.includes("next")) {
    const recs = dash.topRecommendations;
    if (!recs.length) return "No high-priority grants scored yet. Run AI Grant Discovery on live opportunities.";
    return recs
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.title} (${r.funder}) — Priority ${r.priorityScore}% · ${r.recommendation}`)
      .join("\n");
  }

  if (q.includes("underfund") || q.includes("funding gap") || q.includes("programs")) {
    const gaps = dash.executive.fundingGapByProgram.slice(0, 5);
    if (!gaps.length) return "All program funding profiles are within goal range.";
    return gaps
      .map((g) => `• ${g.label}: $${g.gap.toLocaleString()} gap (goal $${g.fundingGoal.toLocaleString()}, awarded $${g.awardedFunding.toLocaleString()})`)
      .join("\n");
  }

  if (q.includes("deadline") || q.includes("approaching")) {
    const lines = [
      `${dash.executive.upcomingDeadlines} grant deadlines in the next 30 days.`,
      `${dash.executive.renewalCalendar.upcoming90Days} renewal/expiration events in the next 90 days.`,
    ];
    const next = dash.executive.renewalCalendar.events[0];
    if (next) lines.push(`Next: ${next.title} on ${next.date} (${next.type}).`);
    return lines.join("\n");
  }

  if (q.includes("hire") || q.includes("afford") || q.includes("staff")) {
    const capacity = dash.executive.estimatedAnnualPipeline - dash.executive.totalPendingValue;
    const avgSalary = 55000;
    const headroom = Math.floor(capacity / avgSalary);
    return [
      `Estimated annual funding pipeline: $${dash.executive.estimatedAnnualPipeline.toLocaleString()}.`,
      `After pending applications: ~$${Math.max(0, capacity).toLocaleString()} capacity.`,
      headroom > 0
        ? `Conservative staffing headroom: ${headroom} FTE at $${avgSalary.toLocaleString()}/year — verify against restricted grant funds.`
        : "Limited unrestricted capacity for new hires until pending awards resolve.",
    ].join("\n");
  }

  if (q.includes("risk") || q.includes("compliance") || q.includes("attention")) {
    const risks: string[] = [];
    if (dash.executive.complianceDue > 0) risks.push(`${dash.executive.complianceDue} compliance reports due within 14 days.`);
    if (dash.finance.spendingAlerts > 0) risks.push(`${dash.finance.spendingAlerts} grant budgets above 85% utilization.`);
    const overdue = dash.profiles.filter((p) => p.complianceOverdue > 0);
    if (overdue.length) risks.push(`Overdue compliance: ${overdue.map((p) => p.label).join(", ")}.`);
    if (dash.executive.upcomingDeadlines > 3) risks.push(`${dash.executive.upcomingDeadlines} deadlines may strain proposal capacity.`);
    return risks.length ? risks.join("\n") : "No critical funding risks detected. Maintain grant discovery and compliance monitoring.";
  }

  return [
    `Pipeline: $${dash.executive.totalFundingRequested.toLocaleString()} requested · $${dash.executive.totalFundingAwarded.toLocaleString()} awarded.`,
    `Top priority grant: ${dash.topRecommendations[0]?.title ?? "Run discovery to rank opportunities"}.`,
    `Largest funding gap: ${dash.executive.fundingGapByProgram[0]?.label ?? "None"} ($${(dash.executive.fundingGapByProgram[0]?.gap ?? 0).toLocaleString()}).`,
  ].join("\n");
}

export async function auraExecutiveFundingIntelligence(opts?: {
  question?: string;
  actorEmail?: string;
}) {
  const [dash, context] = await Promise.all([
    buildExecutiveIntelligentDashboardV3(),
    buildAuraExecutiveContext(),
  ]);

  const question = opts?.question?.trim() || AURA_EXECUTIVE_QUESTIONS[0];
  const briefing = {
    executive: dash.executive,
    topRecommendations: dash.topRecommendations.slice(0, 5),
    underfundedPrograms: dash.executive.fundingGapByProgram.slice(0, 5),
    renewalEvents: dash.executive.renewalCalendar.events.slice(0, 8),
    finance: dash.finance,
    staffingEstimate: {
      annualPipeline: dash.executive.estimatedAnnualPipeline,
      pendingValue: dash.executive.totalPendingValue,
    },
    fundingRisks: {
      complianceDue: dash.executive.complianceDue,
      spendingAlerts: dash.finance.spendingAlerts,
      overduePrograms: dash.profiles.filter((p) => p.complianceOverdue > 0).map((p) => p.label),
    },
  };

  let insight: string;
  let offline = false;

  try {
    insight = await auraExecutiveChat(
      `${question}\n\nRespond as IFCDC AURA Executive Funding Advisor with clear, actionable bullet points for leadership.`,
      `${context}\n\nGrant Center v3 Executive Intelligence:\n${JSON.stringify(briefing, null, 2)}`
    );
  } catch {
    offline = true;
    insight = buildOfflineExecutiveAnswer(question, dash);
  }

  return {
    insight,
    offline,
    question,
    suggestedQuestions: AURA_EXECUTIVE_QUESTIONS,
    executive: dash.executive,
    topRecommendations: dash.topRecommendations,
    fundingGapByProgram: dash.executive.fundingGapByProgram,
    renewalCalendar: dash.executive.renewalCalendar,
    staffingAffordability: {
      estimatedAnnualPipeline: dash.executive.estimatedAnnualPipeline,
      capacityAfterPending: dash.executive.estimatedAnnualPipeline - dash.executive.totalPendingValue,
    },
    fundingRisks: briefing.fundingRisks,
    generatedAt: new Date().toISOString(),
  };
}

/** Unified v3 platform entry — wraps v2 dashboard with intelligent layer. */
export async function buildIntelligentFundingPlatform() {
  const [v3Dash, v2Dash] = await Promise.all([
    buildExecutiveIntelligentDashboardV3(),
    buildFundingEngineDashboard(),
  ]);

  return {
    ...v3Dash,
    pipeline: v2Dash.pipeline,
    auraRecommendations: v2Dash.auraRecommendations,
    version: "v3",
    generatedAt: new Date().toISOString(),
  };
}
