/**
 * IFCDC Headquarters — Grant Center v5 Funding Intelligence Engine
 * National grant DB, multi-dimensional scoring, application workspace, projections, executive intelligence.
 */
import { getDb } from "../db";
import { grantId, logGrantActivity } from "./grantsSchema";
import { logHqAudit } from "./hqAuditLog";
import { auraExecutiveChat } from "../lib/ifcdc";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import {
  IFCDC_FUNDING_DIVISIONS,
  searchGrantOpportunities,
} from "./grantFundingEngine";
import {
  scoreOpportunityDual,
  listLiveGrantOpportunities,
  matchGrantsForDivision,
  listDocumentChecklist,
} from "./grantFundingEngineV2";
import {
  buildProgramFundingProfilesV3,
  buildGrantDocumentCenter,
} from "./grantFundingEngineV3";
import {
  buildExecutiveOperationsDashboard,
  buildOrganizationFundingForecast,
  buildGrantLifecyclePipeline,
  buildFundingOperationsCalendar,
  buildProgramIntegrationPortfolios,
} from "./grantFundingEngineV4";
import {
  buildV2FundingPipeline,
  buildExecutiveFundingAnalytics,
} from "./grantFundingEngineV2";

export const V5_SCORE_DIMENSIONS = ["bestFit", "deadline", "awardSize", "competitiveness"] as const;

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

function parseJsonObjects(raw: unknown): Record<string, unknown>[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function listNationalGrantDatabase(limit = 50) {
  const db = await getDb();
  const rows = (await db.all(`
    SELECT o.*,
      (SELECT composite_score FROM grant_opportunity_scores WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) as composite_score,
      (SELECT award_probability FROM grant_opportunity_scores WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) as award_probability
    FROM grant_opportunities o
    WHERE o.status IN ('open','active','researching')
      AND (COALESCE(o.is_national, 0) = 1 OR o.geography LIKE '%US%' OR o.funder_type = 'federal')
    ORDER BY o.amount_max DESC, o.deadline ASC
    LIMIT ?
  `, limit)) as Record<string, unknown>[];

  return rows.map((row) => ({
    ...row,
    division_slugs: parseJsonArray(row.division_slugs),
    program_areas: parseJsonArray(row.program_areas),
    isNational: Boolean(row.is_national ?? 0),
    daysUntilDeadline: row.deadline
      ? Math.ceil((new Date(String(row.deadline)).getTime() - Date.now()) / 86400000)
      : null,
  }));
}

export async function matchGrantsAllDivisions(opts?: { limitPerDivision?: number; actorEmail?: string; persistScores?: boolean }) {
  const limit = opts?.limitPerDivision ?? 5;
  const persistScores = opts?.persistScores ?? true;
  const results = await Promise.all(
    IFCDC_FUNDING_DIVISIONS.map(async (div) => {
      const match = await matchGrantsForDivision(div.slug, {
        limit,
        persistScores,
        actorEmail: opts?.actorEmail,
      });
      return {
        slug: div.slug,
        label: div.label,
        readOnly: Boolean((div as { readOnly?: boolean }).readOnly),
        programs: div.programs,
        matchCount: match.matches.length,
        topMatches: match.matches.slice(0, limit),
      };
    })
  );

  return {
    divisions: results,
    totalMatches: results.reduce((s, d) => s + d.matchCount, 0),
    generatedAt: new Date().toISOString(),
  };
}

export async function scoreGrantOpportunityV5(
  opportunityId: string,
  opts?: { divisionSlug?: string; actorEmail?: string }
) {
  const db = await getDb();
  const opp = await db.get("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId) as Record<string, unknown> | undefined;
  if (!opp) return null;

  const divisionSlug = opts?.divisionSlug ?? parseJsonArray(opp.division_slugs)[0] ?? "community_programs";
  const dual = await scoreOpportunityDual(opportunityId, { divisionSlug, actorEmail: opts?.actorEmail });
  if (!dual) return null;

  const bestFit = Math.round((dual.eligibilityScore + dual.strategicFitScore) / 2);

  let deadlineScore = 10;
  if (opp.deadline) {
    const days = Math.ceil((new Date(String(opp.deadline)).getTime() - Date.now()) / 86400000);
    if (days > 60) deadlineScore = 90;
    else if (days > 30) deadlineScore = 75;
    else if (days > 14) deadlineScore = 55;
    else if (days > 0) deadlineScore = 30;
    else deadlineScore = 0;
  } else {
    deadlineScore = 50;
  }

  const amountMax = Number(opp.amount_max ?? 0);
  let awardSizeScore = 40;
  if (amountMax >= 500000) awardSizeScore = 95;
  else if (amountMax >= 250000) awardSizeScore = 85;
  else if (amountMax >= 100000) awardSizeScore = 70;
  else if (amountMax >= 50000) awardSizeScore = 55;
  else if (amountMax >= 25000) awardSizeScore = 40;

  const funderType = String(opp.funder_type ?? "").toLowerCase();
  const funder = String(opp.funder ?? "").toLowerCase();
  let competitivenessScore = 50;
  if (funderType === "federal" || funder.includes("department")) competitivenessScore = 35;
  else if (funderType === "foundation" || funder.includes("foundation")) competitivenessScore = 65;
  else if (funderType === "state" || funder.includes("state")) competitivenessScore = 55;
  else competitivenessScore = 50;

  const compositeScore = Math.round(
    bestFit * 0.35 + deadlineScore * 0.2 + awardSizeScore * 0.25 + competitivenessScore * 0.2
  );

  const winRateRow = await db.get<{ awarded: number; decided: number }>(`
    SELECT
      (SELECT COUNT(*) FROM grant_applications WHERE status = 'awarded') as awarded,
      (SELECT COUNT(*) FROM grant_applications WHERE status IN ('awarded','denied')) as decided
  `);
  const orgWinRate = winRateRow && winRateRow.decided > 0
    ? winRateRow.awarded / winRateRow.decided
    : 0.35;

  const awardProbability = Math.min(95, Math.round(compositeScore * orgWinRate * 0.85 + bestFit * 0.1));

  await db.run(
    `UPDATE grant_opportunity_scores SET
      best_fit_score = ?, deadline_score = ?, award_size_score = ?,
      competitiveness_score = ?, composite_score = ?, award_probability = ?
     WHERE id = (SELECT id FROM grant_opportunity_scores WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1)`,
    bestFit, deadlineScore, awardSizeScore, competitivenessScore, compositeScore, awardProbability,
    opportunityId
  );

  await logHqAudit({
    action: "grant_v5_scored",
    entityType: "grant_opportunity",
    entityId: opportunityId,
    detail: `Composite ${compositeScore}% · Award probability ${awardProbability}%`,
    actorEmail: opts?.actorEmail,
  }).catch(() => undefined);

  return {
    opportunityId,
    divisionSlug,
    scores: {
      bestFit,
      deadline: deadlineScore,
      awardSize: awardSizeScore,
      competitiveness: competitivenessScore,
      composite: compositeScore,
      awardProbability,
    },
    eligibilityScore: dual.eligibilityScore,
    strategicFitScore: dual.strategicFitScore,
    grade: compositeScore >= 75 ? "A" : compositeScore >= 60 ? "B" : compositeScore >= 45 ? "C" : "D",
  };
}

export async function getOrCreateProposalBudget(applicationId: string) {
  const db = await getDb();
  const existing = await db.get("SELECT * FROM grant_proposal_budgets WHERE application_id = ?", applicationId);
  if (existing) {
    return {
      ...existing,
      line_items: parseJsonObjects((existing as Record<string, unknown>).line_items),
    };
  }

  const app = await db.get<{ amount_requested: number; title: string }>(
    "SELECT amount_requested, title FROM grant_applications WHERE id = ?", applicationId
  );
  if (!app) return null;

  const now = new Date().toISOString();
  const id = grantId();
  const requested = Number(app.amount_requested ?? 0);
  const defaultLines = [
    { category: "Personnel", amount: Math.round(requested * 0.55), notes: "Salaries and benefits" },
    { category: "Program Supplies", amount: Math.round(requested * 0.15), notes: "Direct program costs" },
    { category: "Contractual", amount: Math.round(requested * 0.1), notes: "Subcontracts and consultants" },
    { category: "Indirect / Admin", amount: Math.round(requested * 0.1), notes: "Administrative overhead" },
    { category: "Other", amount: Math.round(requested * 0.1), notes: "Miscellaneous" },
  ];

  await db.run(
    `INSERT INTO grant_proposal_budgets (id, application_id, line_items, total_requested, direct_costs, indirect_costs, personnel, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, applicationId, JSON.stringify(defaultLines), requested,
    Math.round(requested * 0.8), Math.round(requested * 0.2), Math.round(requested * 0.55),
    `Auto-generated budget for ${app.title}`, now, now
  );

  return db.get("SELECT * FROM grant_proposal_budgets WHERE id = ?", id);
}

export async function updateProposalBudget(
  applicationId: string,
  payload: { lineItems?: Record<string, unknown>[]; notes?: string; totalRequested?: number }
) {
  const db = await getDb();
  const budget = await db.get("SELECT id FROM grant_proposal_budgets WHERE application_id = ?", applicationId);
  if (!budget) return { ok: false, error: "Budget not found" };

  const lineItems = payload.lineItems ?? [];
  const total = payload.totalRequested ?? lineItems.reduce((s, l) => s + Number(l.amount ?? 0), 0);
  const personnel = lineItems.filter((l) => String(l.category).toLowerCase().includes("personnel"))
    .reduce((s, l) => s + Number(l.amount ?? 0), 0);
  const indirect = lineItems.filter((l) => String(l.category).toLowerCase().includes("indirect"))
    .reduce((s, l) => s + Number(l.amount ?? 0), 0);

  await db.run(
    `UPDATE grant_proposal_budgets SET line_items = ?, total_requested = ?, personnel = ?,
      direct_costs = ?, indirect_costs = ?, notes = COALESCE(?, notes), updated_at = ?
     WHERE application_id = ?`,
    JSON.stringify(lineItems), total, personnel, total - indirect, indirect,
    payload.notes ?? null, new Date().toISOString(), applicationId
  );

  return { ok: true, totalRequested: total };
}

export async function buildApplicationWorkspace(applicationId: string, opts?: { actorEmail?: string }) {
  const db = await getDb();
  const app = await db.get(`
    SELECT a.*, o.title as opportunity_title, o.funder, o.deadline, o.amount_max, o.eligibility
    FROM grant_applications a
    LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
    WHERE a.id = ?
  `, applicationId) as Record<string, unknown> | undefined;

  if (!app) return null;

  const [checklist, budget, workflow] = await Promise.all([
    listDocumentChecklist(applicationId),
    getOrCreateProposalBudget(applicationId),
    db.all(
      "SELECT * FROM grant_application_workflow WHERE application_id = ? ORDER BY created_at ASC",
      applicationId
    ),
  ]);

  return {
    application: app,
    documentChecklist: checklist,
    proposalBudget: budget,
    workflowSteps: workflow,
    aiAssistAvailable: true,
    requiredDocuments: checklist.requiredTemplates ?? [],
    completionPct: checklist.totalDocuments
      ? Math.round((checklist.approvedCount / Math.max(checklist.totalDocuments, 1)) * 100)
      : 0,
    generatedAt: new Date().toISOString(),
  };
}

export async function aiAssistApplicationSection(opts: {
  applicationId: string;
  section: string;
  prompt?: string;
  actorEmail?: string;
}) {
  const { assistWriterSectionProduction } = await import("./grantWriterEngine");
  return assistWriterSectionProduction(opts.applicationId, opts.section, opts.prompt, opts.actorEmail);
}

export async function buildPerformanceMetrics() {
  const db = await getDb();

  const outcomes = (await db.all(`
    SELECT go.outcome, COUNT(*) as c, COALESCE(SUM(go.amount), 0) as total
    FROM grant_outcomes go GROUP BY go.outcome
  `)) as { outcome: string; c: number; total: number }[];

  const byDivision = await buildProgramFundingProfilesV3();

  const awardMetrics = await db.get<{ active: number; total: number }>(`
    SELECT
      (SELECT COUNT(*) FROM grant_awards WHERE status = 'active') as active,
      (SELECT COALESCE(SUM(amount), 0) FROM grant_awards WHERE status = 'active') as total
  `);

  return {
    outcomeSummary: outcomes,
    programMetrics: byDivision.map((p) => ({
      slug: p.slug,
      label: p.label,
      awardedFunding: p.awardedFunding,
      winRate: p.outcomeMetrics.winRate,
      activeApplications: p.outcomeMetrics.activeApplications,
      fundingUtilization: p.currentBudget > 0 ? Math.round((p.spending / p.currentBudget) * 100) : 0,
    })),
    activeAwards: awardMetrics?.active ?? 0,
    activeAwardValue: awardMetrics?.total ?? 0,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildRenewalReportingTracker() {
  const db = await getDb();

  const renewals = (await db.all(`
    SELECT gr.*, ga.amount, COALESCE(o.title, a.title) as grant_title
    FROM grant_renewals gr
    JOIN grant_awards ga ON ga.id = gr.original_award_id
    LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
    LEFT JOIN grant_applications a ON a.id = ga.application_id
    ORDER BY gr.renewal_date ASC
  `)) as Record<string, unknown>[];

  const reporting = (await db.all(`
    SELECT gc.*, COALESCE(o.title, a.title) as grant_title, ga.amount
    FROM grant_compliance gc
    JOIN grant_awards ga ON ga.id = gc.award_id
    LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
    LEFT JOIN grant_applications a ON a.id = ga.application_id
    ORDER BY gc.due_date ASC
  `)) as Record<string, unknown>[];

  return {
    renewals: renewals.map((r) => ({
      id: r.id,
      grantTitle: r.grant_title,
      renewalDate: r.renewal_date,
      status: r.status,
      amount: r.amount,
    })),
    reporting: reporting.map((r) => ({
      id: r.id,
      grantTitle: r.grant_title,
      reportType: r.report_type,
      dueDate: r.due_date,
      status: r.status,
      amount: r.amount,
    })),
    pendingRenewals: renewals.filter((r) => r.status !== "completed").length,
    pendingReports: reporting.filter((r) => r.status === "pending").length,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildMultiYearProjections(years = 5) {
  const analytics = await buildOrganizationFundingForecast();
  const baseYear = analytics.total12MonthProjection;
  const growthRate = 0.08;

  const projections = Array.from({ length: years }, (_, i) => {
    const year = new Date().getFullYear() + i;
    const factor = Math.pow(1 + growthRate, i);
    return {
      year,
      projectedFunding: Math.round(baseYear * factor),
      conservative: Math.round(baseYear * factor * 0.75),
      optimistic: Math.round(baseYear * factor * 1.25),
    };
  });

  return {
    years: projections,
    baseAnnual: baseYear,
    growthRate,
    fiveYearTotal: projections.reduce((s, y) => s + y.projectedFunding, 0),
    generatedAt: new Date().toISOString(),
  };
}

export async function buildComplianceDashboard() {
  const db = await getDb();

  const summary = await db.get<{ pending: number; overdue: number; submitted: number }>(`
    SELECT
      SUM(CASE WHEN status = 'pending' AND due_date >= date('now') THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'pending' AND due_date < date('now') THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted
    FROM grant_compliance
  `);

  const upcoming = (await db.all(`
    SELECT gc.id, gc.report_type, gc.due_date, gc.status,
      COALESCE(o.title, a.title) as grant_title, ga.amount
    FROM grant_compliance gc
    JOIN grant_awards ga ON ga.id = gc.award_id
    LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
    LEFT JOIN grant_applications a ON a.id = ga.application_id
    WHERE gc.status = 'pending'
    ORDER BY gc.due_date ASC LIMIT 25
  `)) as Record<string, unknown>[];

  const byAward = (await db.all(`
    SELECT ga.id, COALESCE(o.title, a.title) as title,
      SUM(CASE WHEN gc.status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN gc.status = 'submitted' THEN 1 ELSE 0 END) as submitted
    FROM grant_awards ga
    LEFT JOIN grant_compliance gc ON gc.award_id = ga.id
    LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
    LEFT JOIN grant_applications a ON a.id = ga.application_id
    WHERE ga.status = 'active'
    GROUP BY ga.id
    HAVING pending > 0 OR submitted > 0
  `)) as Record<string, unknown>[];

  const healthScore = summary
    ? Math.max(0, 100 - (summary.overdue ?? 0) * 15 - (summary.pending ?? 0) * 3)
    : 100;

  return {
    summary: {
      pending: summary?.pending ?? 0,
      overdue: summary?.overdue ?? 0,
      submitted: summary?.submitted ?? 0,
      healthScore,
      status: (summary?.overdue ?? 0) > 0 ? "critical" : (summary?.pending ?? 0) > 3 ? "attention" : "healthy",
    },
    upcoming,
    byAward,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildExecutiveIntelligenceV5() {
  const db = await getDb();
  const [ops, forecast, profiles, compliance, multiYear, performance] = await Promise.all([
    buildExecutiveOperationsDashboard(),
    buildOrganizationFundingForecast(),
    buildProgramFundingProfilesV3(),
    buildComplianceDashboard(),
    buildMultiYearProjections(5),
    buildPerformanceMetrics(),
  ]);

  const finance = ops.executive;
  const totalGoals = profiles.reduce((s, p) => s + p.fundingGoal, 0);
  const totalAwarded = profiles.reduce((s, p) => s + p.awardedFunding, 0);
  const totalGap = profiles.reduce((s, p) => s + p.fundingGap, 0);
  const totalBudgetRemaining = profiles.reduce((s, p) => s + p.remainingBalance, 0);
  const totalBudgetAllocated = profiles.reduce((s, p) => s + p.currentBudget, 0);

  const coverageRatio = totalGoals > 0 ? totalAwarded / totalGoals : 0;
  const complianceHealth = compliance.summary.healthScore / 100;
  const pipelineStrength = finance.totalPending > 0
    ? Math.min(1, finance.totalPending / Math.max(totalAwarded, 1))
    : 0.2;
  const reserveRatio = totalBudgetAllocated > 0 ? totalBudgetRemaining / totalBudgetAllocated : 0.5;

  const sustainabilityIndex = Math.round(
    (coverageRatio * 25 + complianceHealth * 25 + Math.min(pipelineStrength, 1) * 25 + reserveRatio * 25)
  );

  const avgProbability = (await db.get<{ avg: number }>(`
    SELECT AVG(award_probability) as avg FROM grant_opportunity_scores WHERE award_probability IS NOT NULL
  `))?.avg ?? 35;

  const monthlyForecast = forecast.months.slice(0, 12);
  const cashFlow = monthlyForecast.map((m, i) => ({
    month: m.month,
    inflow: Math.round(m.projected * 0.6),
    outflow: Math.round(m.projected * 0.35 + (profiles.reduce((s, p) => s + p.spending, 0) / 12)),
    net: Math.round(m.projected * 0.25),
  }));

  const fundingGapAnalysis = profiles
    .map((p) => ({
      slug: p.slug,
      label: p.label,
      fundingGoal: p.fundingGoal,
      awarded: p.awardedFunding,
      gap: p.fundingGap,
      gapPct: p.fundingGoal > 0 ? Math.round((p.fundingGap / p.fundingGoal) * 100) : 0,
    }))
    .sort((a, b) => b.gap - a.gap);

  return {
    monthlyFundingForecast: monthlyForecast,
    fundingGapAnalysis,
    cashFlowProjections: cashFlow,
    awardProbabilityScore: Math.round(avgProbability),
    organizationSustainabilityIndex: sustainabilityIndex,
    multiYearProjections: multiYear,
    complianceSummary: compliance.summary,
    performanceSnapshot: {
      activeAwards: performance.activeAwards,
      activeAwardValue: performance.activeAwardValue,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function buildFundingIntelligencePlatform() {
  const [national, divisionMatches, intelligence, compliance, tracker, performance, ops] =
    await Promise.all([
      listNationalGrantDatabase(30),
      matchGrantsAllDivisions({ limitPerDivision: 3, persistScores: false }),
      buildExecutiveIntelligenceV5(),
      buildComplianceDashboard(),
      buildRenewalReportingTracker(),
      buildPerformanceMetrics(),
      buildExecutiveOperationsDashboard(),
    ]);

  const liveOpps = await listLiveGrantOpportunities(20);

  return {
    version: "v5",
    nationalDatabase: { count: national.length, opportunities: national },
    divisionMatching: divisionMatches,
    liveOpportunities: liveOpps.length,
    executiveIntelligence: intelligence,
    compliance,
    renewalReporting: tracker,
    performance,
    operations: {
      pipelineValue: ops.executive.totalPipelineValue,
      totalAwarded: ops.executive.totalAwarded,
      totalPending: ops.executive.totalPending,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function auraFundingIntelligenceAdvisorV5(opts?: { question?: string; actorEmail?: string }) {
  const [platform, context] = await Promise.all([
    buildFundingIntelligencePlatform(),
    buildAuraExecutiveContext(),
  ]);

  const question = opts?.question?.trim() ?? "Summarize IFCDC funding intelligence priorities for this month.";
  let insight: string;
  let offline = false;

  try {
    insight = await auraExecutiveChat(
      `${question}\n\nRespond as IFCDC Funding Intelligence Advisor with executive-level guidance.`,
      `${context}\n\nFunding Intelligence Engine v5:\n${JSON.stringify({
        sustainabilityIndex: platform.executiveIntelligence.organizationSustainabilityIndex,
        gapAnalysis: platform.executiveIntelligence.fundingGapAnalysis.slice(0, 5),
        compliance: platform.compliance.summary,
        nationalCount: platform.nationalDatabase.count,
        divisionMatches: platform.divisionMatching.totalMatches,
      }, null, 2)}`
    );
  } catch {
    offline = true;
    const intel = platform.executiveIntelligence;
    insight = [
      `Organization Sustainability Index: ${intel.organizationSustainabilityIndex}/100.`,
      `Award probability (avg): ${intel.awardProbabilityScore}%.`,
      `Funding gap leader: ${intel.fundingGapAnalysis[0]?.label ?? "—"} ($${(intel.fundingGapAnalysis[0]?.gap ?? 0).toLocaleString()}).`,
      `Compliance: ${platform.compliance.summary.status} (${platform.compliance.summary.pending} pending, ${platform.compliance.summary.overdue} overdue).`,
      `National opportunities tracked: ${platform.nationalDatabase.count}.`,
      `5-year projection: $${intel.multiYearProjections.fiveYearTotal.toLocaleString()}.`,
    ].join("\n");
  }

  return {
    insight,
    offline,
    question,
    executiveIntelligence: platform.executiveIntelligence,
    generatedAt: new Date().toISOString(),
  };
}

/** Canonical V5 API surface — delegates to underlying engines (V2–V4 remain internal). */
export const getV5LifecyclePipeline = buildGrantLifecyclePipeline;
export const getV5OperationsCalendar = buildFundingOperationsCalendar;
export const getV5ProgramProfiles = buildProgramFundingProfilesV3;
export const getV5ProgramIntegration = buildProgramIntegrationPortfolios;
export const getV5FundingPipeline = buildV2FundingPipeline;
export const getV5ExecutiveAnalytics = buildExecutiveFundingAnalytics;
export const getV5DocumentCenter = buildGrantDocumentCenter;
