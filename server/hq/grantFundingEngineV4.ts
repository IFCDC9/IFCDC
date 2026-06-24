/**
 * IFCDC Headquarters — Grant Center v4 Intelligent Funding Operations
 * Full grant lifecycle, funding calendar, executive operations, program integration, AURA advisor.
 */
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import { auraExecutiveChat } from "../lib/ifcdc";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import {
  buildExecutiveFundingAnalytics,
  buildV2FundingPipeline,
  buildGrantFinanceConnection,
} from "./grantFundingEngineV2";
import {
  buildProgramFundingProfilesV3,
  buildRenewalCalendar,
  discoverAndRankGrants,
  buildExecutiveIntelligentDashboardV3,
} from "./grantFundingEngineV3";

export const GRANT_LIFECYCLE_STAGES = [
  "prospect",
  "eligibility_review",
  "internal_approval",
  "application_drafting",
  "submitted",
  "under_review",
  "awarded",
  "active_grant",
  "reporting",
  "closeout",
  "renewal",
] as const;

export const GRANT_LIFECYCLE_LABELS: Record<(typeof GRANT_LIFECYCLE_STAGES)[number], string> = {
  prospect: "Prospect",
  eligibility_review: "Eligibility Review",
  internal_approval: "Internal Approval",
  application_drafting: "Application Drafting",
  submitted: "Submitted",
  under_review: "Under Review",
  awarded: "Awarded",
  active_grant: "Active Grant",
  reporting: "Reporting",
  closeout: "Closeout",
  renewal: "Renewal",
};

export const AURA_V4_ADVISOR_QUESTIONS = [
  "What grants should we prioritize this month?",
  "Which programs have funding gaps?",
  "Which reporting deadlines are approaching?",
  "What awards are pending?",
  "What is our projected funding over the next 12 months?",
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

export async function buildGrantLifecyclePipeline() {
  const db = await getDb();

  const stageQueries: { stage: string; countSql: string; valueSql: string; params?: unknown[] }[] = [
    {
      stage: "prospect",
      countSql: `SELECT COUNT(*) as c FROM grant_opportunities WHERE COALESCE(lifecycle_stage, 'prospect') = 'prospect' AND status IN ('open','active','researching')`,
      valueSql: `SELECT COALESCE(SUM(amount_max), 0) as t FROM grant_opportunities WHERE COALESCE(lifecycle_stage, 'prospect') = 'prospect' AND status IN ('open','active','researching')`,
    },
    {
      stage: "eligibility_review",
      countSql: `SELECT COUNT(*) as c FROM grant_opportunities WHERE lifecycle_stage = 'eligibility_review'`,
      valueSql: `SELECT COALESCE(SUM(amount_max), 0) as t FROM grant_opportunities WHERE lifecycle_stage = 'eligibility_review'`,
    },
    {
      stage: "internal_approval",
      countSql: `SELECT COUNT(*) as c FROM grant_applications WHERE lifecycle_stage = 'internal_approval'`,
      valueSql: `SELECT COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE lifecycle_stage = 'internal_approval'`,
    },
    {
      stage: "application_drafting",
      countSql: `SELECT COUNT(*) as c FROM grant_applications WHERE lifecycle_stage = 'application_drafting' OR (lifecycle_stage IS NULL AND status = 'draft')`,
      valueSql: `SELECT COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE lifecycle_stage = 'application_drafting' OR (lifecycle_stage IS NULL AND status = 'draft')`,
    },
    {
      stage: "submitted",
      countSql: `SELECT COUNT(*) as c FROM grant_applications WHERE lifecycle_stage = 'submitted' OR (lifecycle_stage IS NULL AND status = 'submitted')`,
      valueSql: `SELECT COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE lifecycle_stage = 'submitted' OR (lifecycle_stage IS NULL AND status = 'submitted')`,
    },
    {
      stage: "under_review",
      countSql: `SELECT COUNT(*) as c FROM grant_applications WHERE lifecycle_stage = 'under_review' OR (lifecycle_stage IS NULL AND status = 'under_review')`,
      valueSql: `SELECT COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE lifecycle_stage = 'under_review' OR (lifecycle_stage IS NULL AND status = 'under_review')`,
    },
    {
      stage: "awarded",
      countSql: `SELECT COUNT(*) as c FROM grant_applications WHERE lifecycle_stage = 'awarded' OR status = 'awarded'`,
      valueSql: `SELECT COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE lifecycle_stage = 'awarded' OR status = 'awarded'`,
    },
    {
      stage: "active_grant",
      countSql: `SELECT COUNT(*) as c FROM grant_awards WHERE lifecycle_stage = 'active_grant' AND status = 'active'`,
      valueSql: `SELECT COALESCE(SUM(amount), 0) as t FROM grant_awards WHERE lifecycle_stage = 'active_grant' AND status = 'active'`,
    },
    {
      stage: "reporting",
      countSql: `SELECT COUNT(DISTINCT ga.id) as c FROM grant_awards ga JOIN grant_compliance gc ON gc.award_id = ga.id WHERE gc.status = 'pending'`,
      valueSql: `SELECT COALESCE(SUM(ga.amount), 0) as t FROM grant_awards ga JOIN grant_compliance gc ON gc.award_id = ga.id WHERE gc.status = 'pending'`,
    },
    {
      stage: "closeout",
      countSql: `SELECT COUNT(*) as c FROM grant_awards WHERE lifecycle_stage = 'closeout' OR status = 'closed'`,
      valueSql: `SELECT COALESCE(SUM(amount), 0) as t FROM grant_awards WHERE lifecycle_stage = 'closeout' OR status = 'closed'`,
    },
    {
      stage: "renewal",
      countSql: `SELECT COUNT(*) as c FROM grant_renewals WHERE status IN ('planned', 'in_progress')`,
      valueSql: `SELECT COALESCE(SUM(ga.amount), 0) as t FROM grant_renewals gr JOIN grant_awards ga ON ga.id = gr.original_award_id WHERE gr.status IN ('planned', 'in_progress')`,
    },
  ];

  const stages = await Promise.all(
    stageQueries.map(async ({ stage, countSql, valueSql }) => {
      const countRow = await db.get<{ c: number }>(countSql);
      const valueRow = await db.get<{ t: number }>(valueSql);
      return {
        stage: GRANT_LIFECYCLE_LABELS[stage as (typeof GRANT_LIFECYCLE_STAGES)[number]],
        stageKey: stage,
        count: countRow?.c ?? 0,
        value: valueRow?.t ?? 0,
      };
    })
  );

  const totalValue = stages.reduce((s, x) => s + x.value, 0);
  return { stages, totalValue, lifecycleStages: GRANT_LIFECYCLE_STAGES, generatedAt: new Date().toISOString() };
}

export async function updateGrantLifecycleStage(opts: {
  entityType: "opportunity" | "application" | "award";
  entityId: string;
  lifecycleStage: string;
  actorEmail?: string;
}) {
  if (!GRANT_LIFECYCLE_STAGES.includes(opts.lifecycleStage as (typeof GRANT_LIFECYCLE_STAGES)[number])) {
    return { ok: false, error: "Invalid lifecycle stage" };
  }

  const db = await getDb();
  const table =
    opts.entityType === "opportunity"
      ? "grant_opportunities"
      : opts.entityType === "application"
        ? "grant_applications"
        : "grant_awards";

  const row = await db.get(`SELECT id FROM ${table} WHERE id = ?`, opts.entityId);
  if (!row) return { ok: false, error: "Entity not found" };

  const now = new Date().toISOString();
  if (opts.entityType === "award") {
    await db.run(`UPDATE ${table} SET lifecycle_stage = ? WHERE id = ?`, opts.lifecycleStage, opts.entityId);
  } else {
    await db.run(`UPDATE ${table} SET lifecycle_stage = ?, updated_at = ? WHERE id = ?`, opts.lifecycleStage, now, opts.entityId);
  }

  await logHqAudit({
    action: "grant_lifecycle_updated",
    entityType: `grant_${opts.entityType}`,
    entityId: opts.entityId,
    detail: `Lifecycle → ${opts.lifecycleStage}`,
    actorEmail: opts.actorEmail,
  }).catch(() => undefined);

  return { ok: true, lifecycleStage: opts.lifecycleStage };
}

export async function buildFundingOperationsCalendar(opts?: { daysAhead?: number }) {
  const db = await getDb();
  const days = opts?.daysAhead ?? 90;
  const horizon = `date('now', '+${days} days')`;

  const applicationDeadlines = (await db.all(`
    SELECT d.id, d.title, d.due_date, d.deadline_type, o.title as grant_title, o.funder, 'application' as event_type
    FROM grant_deadlines d
    LEFT JOIN grant_opportunities o ON o.id = d.opportunity_id
    WHERE d.completed = 0 AND d.due_date >= date('now') AND d.due_date <= ${horizon}
    ORDER BY d.due_date ASC LIMIT 30
  `)) as Record<string, unknown>[];

  const reportingDeadlines = (await db.all(`
    SELECT gc.id, gc.report_type as title, gc.due_date, gc.status,
      COALESCE(o.title, a.title, 'Grant Report') as grant_title, 'reporting' as event_type
    FROM grant_compliance gc
    JOIN grant_awards ga ON ga.id = gc.award_id
    LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
    LEFT JOIN grant_applications a ON a.id = ga.application_id
    WHERE gc.status = 'pending' AND gc.due_date >= date('now') AND gc.due_date <= ${horizon}
    ORDER BY gc.due_date ASC LIMIT 30
  `)) as Record<string, unknown>[];

  const renewalReminders = (await db.all(`
    SELECT gr.id, gr.renewal_date as due_date, gr.status,
      COALESCE(o.title, a.title, 'Grant Renewal') as grant_title, 'renewal' as event_type
    FROM grant_renewals gr
    JOIN grant_awards ga ON ga.id = gr.original_award_id
    LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
    LEFT JOIN grant_applications a ON a.id = ga.application_id
    WHERE gr.status IN ('planned', 'in_progress') AND gr.renewal_date >= date('now') AND gr.renewal_date <= ${horizon}
    ORDER BY gr.renewal_date ASC LIMIT 20
  `)) as Record<string, unknown>[];

  const complianceAlerts = (await db.all(`
    SELECT gc.id, gc.report_type as title, gc.due_date, gc.status,
      COALESCE(o.title, a.title, 'Compliance') as grant_title, 'compliance_alert' as event_type
    FROM grant_compliance gc
    JOIN grant_awards ga ON ga.id = gc.award_id
    LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
    LEFT JOIN grant_applications a ON a.id = ga.application_id
    WHERE gc.status = 'pending' AND gc.due_date < date('now', '+14 days')
    ORDER BY gc.due_date ASC LIMIT 15
  `)) as Record<string, unknown>[];

  const boardApprovals = (await db.all(`
    SELECT d.id, d.name as title, COALESCE(d.uploaded_at, d.created_at) as due_date,
      COALESCE(a.title, o.title, 'Board Approval') as grant_title, 'board_approval' as event_type
    FROM grant_documents d
    LEFT JOIN grant_applications a ON a.id = d.application_id
    LEFT JOIN grant_opportunities o ON o.id = COALESCE(d.opportunity_id, a.opportunity_id)
    WHERE d.doc_category = 'board_approval'
    ORDER BY d.created_at DESC LIMIT 15
  `)) as Record<string, unknown>[];

  const events = [
    ...applicationDeadlines.map((e) => ({
      id: String(e.id),
      type: "application_deadline" as const,
      title: String(e.title ?? "Application deadline"),
      grantTitle: String(e.grant_title ?? ""),
      funder: String(e.funder ?? ""),
      dueDate: String(e.due_date ?? ""),
      status: "upcoming",
    })),
    ...reportingDeadlines.map((e) => ({
      id: String(e.id),
      type: "reporting_deadline" as const,
      title: String(e.title ?? "Report due"),
      grantTitle: String(e.grant_title ?? ""),
      dueDate: String(e.due_date ?? ""),
      status: String(e.status ?? "pending"),
    })),
    ...renewalReminders.map((e) => ({
      id: String(e.id),
      type: "renewal_reminder" as const,
      title: "Renewal due",
      grantTitle: String(e.grant_title ?? ""),
      dueDate: String(e.due_date ?? ""),
      status: String(e.status ?? "planned"),
    })),
    ...complianceAlerts.map((e) => ({
      id: String(e.id),
      type: "compliance_alert" as const,
      title: String(e.title ?? "Compliance due"),
      grantTitle: String(e.grant_title ?? ""),
      dueDate: String(e.due_date ?? ""),
      status: "alert",
    })),
    ...boardApprovals.map((e) => ({
      id: String(e.id),
      type: "board_approval" as const,
      title: String(e.title ?? "Board approval"),
      grantTitle: String(e.grant_title ?? ""),
      dueDate: String(e.due_date ?? "").slice(0, 10),
      status: "recorded",
    })),
  ].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return {
    events,
    summary: {
      applicationDeadlines: applicationDeadlines.length,
      reportingDeadlines: reportingDeadlines.length,
      renewalReminders: renewalReminders.length,
      complianceAlerts: complianceAlerts.length,
      boardApprovals: boardApprovals.length,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function buildFundingBySource() {
  const db = await getDb();

  const byFunder = (await db.all(`
    SELECT o.funder as source, COUNT(DISTINCT ga.id) as award_count,
      COALESCE(SUM(ga.amount), 0) as total_awarded,
      COALESCE(SUM(a.amount_requested), 0) as total_requested
    FROM grant_opportunities o
    LEFT JOIN grant_awards ga ON ga.opportunity_id = o.id AND ga.status = 'active'
    LEFT JOIN grant_applications a ON a.opportunity_id = o.id AND a.status IN ('submitted','under_review','draft')
    WHERE o.funder IS NOT NULL AND o.funder != ''
    GROUP BY o.funder
    ORDER BY total_awarded DESC, total_requested DESC
    LIMIT 15
  `)) as { source: string; award_count: number; total_awarded: number; total_requested: number }[];

  const byType = (await db.all(`
    SELECT COALESCE(funder_type, 'other') as source_type, COUNT(*) as c, COALESCE(SUM(amount_max), 0) as pipeline
    FROM grant_opportunities WHERE status IN ('open','active','researching')
    GROUP BY COALESCE(funder_type, 'other')
    ORDER BY pipeline DESC
  `)) as { source_type: string; c: number; pipeline: number }[];

  return { byFunder, byType, generatedAt: new Date().toISOString() };
}

export async function buildOrganizationFundingForecast() {
  const analytics = await buildExecutiveFundingAnalytics();
  const now = new Date();
  const months: { month: string; projected: number; awarded: number; pending: number }[] = [];

  const monthlyAwardRate = analytics.totalAwarded / Math.max(1, now.getMonth() + 1);
  const monthlyPendingConversion = (analytics.totalPending * (analytics.winRate / 100)) / 3;
  const monthlyPipeline = analytics.identifiedValue * 0.08;

  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const factor = i < 3 ? 1 : i < 6 ? 0.85 : 0.7;
    months.push({
      month: label,
      projected: Math.round((monthlyAwardRate + monthlyPendingConversion + monthlyPipeline) * factor),
      awarded: i === 0 ? Math.round(analytics.totalAwarded) : Math.round(monthlyAwardRate * (i + 1)),
      pending: Math.round(analytics.totalPending * Math.max(0.2, 1 - i * 0.08)),
    });
  }

  const total12Month = months.reduce((s, m) => s + m.projected, 0);

  return {
    months,
    total12MonthProjection: total12Month,
    currentAwarded: analytics.totalAwarded,
    currentPending: analytics.totalPending,
    winRate: analytics.winRate,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildProgramIntegrationPortfolios() {
  const db = await getDb();
  const profiles = await buildProgramFundingProfilesV3();

  return Promise.all(
    profiles.map(async (p) => {
      const slug = p.slug;

      const portfolio = (await db.all(`
        SELECT 'application' as kind, a.id, a.title, a.status, a.amount_requested as amount, a.lifecycle_stage
        FROM grant_applications a
        JOIN grant_opportunities o ON o.id = a.opportunity_id
        WHERE o.division_slugs LIKE ?
        UNION ALL
        SELECT 'award' as kind, ga.id, COALESCE(o.title, a.title, 'Award') as title, ga.status, ga.amount, ga.lifecycle_stage
        FROM grant_awards ga
        LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
        LEFT JOIN grant_applications a ON a.id = ga.application_id
        WHERE o.division_slugs LIKE ? OR (o.id IS NULL AND ga.notes LIKE ?)
        ORDER BY amount DESC LIMIT 12
      `, `%"${slug}"%`, `%"${slug}"%`, `%${slug}%`)) as Record<string, unknown>[];

      const reportingDue = (await db.get<{ c: number }>(`
        SELECT COUNT(*) as c FROM grant_compliance gc
        JOIN grant_awards ga ON ga.id = gc.award_id
        JOIN grant_opportunities o ON o.id = ga.opportunity_id
        WHERE gc.status = 'pending' AND o.division_slugs LIKE ?`,
        `%"${slug}"%`
      ))?.c ?? 0;

      return {
        ...p,
        grantPortfolio: portfolio.map((g) => ({
          kind: String(g.kind),
          id: String(g.id),
          title: String(g.title ?? ""),
          status: String(g.status ?? ""),
          amount: Number(g.amount ?? 0),
          lifecycleStage: String(g.lifecycle_stage ?? ""),
        })),
        reportingRequirementsDue: reportingDue,
        performanceMetrics: {
          ...p.outcomeMetrics,
          portfolioSize: portfolio.length,
          fundingUtilization: p.currentBudget > 0 ? Math.round((p.spending / p.currentBudget) * 100) : 0,
        },
      };
    })
  );
}

export async function buildExecutiveOperationsDashboard() {
  const [lifecycle, analytics, pipeline, calendar, bySource, forecast, programs, finance, discovery] =
    await Promise.all([
      buildGrantLifecyclePipeline(),
      buildExecutiveFundingAnalytics(),
      buildV2FundingPipeline(),
      buildFundingOperationsCalendar({ daysAhead: 90 }),
      buildFundingBySource(),
      buildOrganizationFundingForecast(),
      buildProgramIntegrationPortfolios(),
      buildGrantFinanceConnection(),
      discoverAndRankGrants({ limit: 8, persistScores: false }),
    ]);

  const fundingByProgram = programs.map((p) => ({
    slug: p.slug,
    label: p.label,
    awarded: p.awardedFunding,
    requested: p.requestedFunding,
    gap: p.fundingGap,
    budget: p.currentBudget,
  })).sort((a, b) => b.awarded - a.awarded);

  const db = await getDb();
  const pendingAwards = await db.get<{ c: number; t: number }>(`
    SELECT COUNT(*) as c, COALESCE(SUM(amount_requested), 0) as t
    FROM grant_applications WHERE status IN ('submitted','under_review') OR lifecycle_stage IN ('submitted','under_review')
  `);

  return {
    executive: {
      totalPipelineValue: lifecycle.totalValue,
      totalAwarded: analytics.totalAwarded,
      totalPending: analytics.totalPending,
      pendingApplications: pendingAwards?.c ?? 0,
      upcomingDeadlines: analytics.upcomingDeadlines,
      complianceStatus: {
        dueWithin14Days: analytics.complianceDue,
        spendingAlerts: finance.spendingAlerts,
        overall: analytics.complianceDue > 0 || finance.spendingAlerts > 0 ? "attention" : "healthy",
      },
      organizationFundingForecast: forecast,
    },
    lifecycle,
    fundingByProgram,
    fundingBySource: bySource,
    calendar,
    programs,
    topPriorities: discovery.topRecommendations,
    pipeline,
    generatedAt: new Date().toISOString(),
  };
}

function buildOfflineAdvisorAnswer(
  question: string,
  dash: Awaited<ReturnType<typeof buildExecutiveOperationsDashboard>>
): string {
  const q = question.toLowerCase();

  if (q.includes("prioritize") || q.includes("this month")) {
    const recs = dash.topPriorities;
    if (!recs.length) return "Run AI discovery to generate monthly grant priorities.";
    return recs.slice(0, 5).map((r, i) =>
      `${i + 1}. ${String(r.title)} — Priority ${r.priorityScore}% (${r.recommendation})`
    ).join("\n");
  }

  if (q.includes("funding gap") || q.includes("programs")) {
    return dash.fundingByProgram
      .filter((p) => p.gap > 0)
      .slice(0, 5)
      .map((p) => `• ${p.label}: $${p.gap.toLocaleString()} gap (awarded $${p.awarded.toLocaleString()})`)
      .join("\n") || "Program funding gaps within acceptable range.";
  }

  if (q.includes("reporting") || q.includes("deadline")) {
    const reporting = dash.calendar.events.filter((e) =>
      e.type === "reporting_deadline" || e.type === "compliance_alert"
    );
    if (!reporting.length) return "No reporting deadlines in the next 90 days.";
    return reporting.slice(0, 6).map((e) =>
      `• ${e.grantTitle}: ${e.title} — ${e.dueDate}`
    ).join("\n");
  }

  if (q.includes("pending") || q.includes("awards")) {
    return [
      `${dash.executive.pendingApplications} applications pending review ($${dash.executive.totalPending.toLocaleString()}).`,
      dash.topPriorities.length
        ? `Highest priority: ${String(dash.topPriorities[0]?.title)}.`
        : "No scored priorities — run discovery.",
    ].join("\n");
  }

  if (q.includes("projected") || q.includes("12 month") || q.includes("next 12")) {
    const f = dash.executive.organizationFundingForecast;
    return [
      `12-month projection: $${f.total12MonthProjection.toLocaleString()}.`,
      `Current awarded: $${f.currentAwarded.toLocaleString()} · Pending: $${f.currentPending.toLocaleString()}.`,
      `Next month estimate: $${f.months[0]?.projected.toLocaleString() ?? 0}.`,
    ].join("\n");
  }

  return [
    `Pipeline: $${dash.executive.totalPipelineValue.toLocaleString()} · Awarded: $${dash.executive.totalAwarded.toLocaleString()}.`,
    `${dash.calendar.summary.complianceAlerts} compliance alerts · ${dash.calendar.summary.applicationDeadlines} application deadlines.`,
  ].join("\n");
}

export async function auraExecutiveAdvisorV4(opts?: { question?: string; actorEmail?: string }) {
  const [dash, context] = await Promise.all([
    buildExecutiveOperationsDashboard(),
    buildAuraExecutiveContext(),
  ]);

  const question = opts?.question?.trim() || AURA_V4_ADVISOR_QUESTIONS[0];
  const briefing = {
    executive: dash.executive,
    lifecycle: dash.lifecycle.stages,
    fundingByProgram: dash.fundingByProgram.slice(0, 8),
    fundingBySource: dash.fundingBySource.byFunder.slice(0, 8),
    calendarSummary: dash.calendar.summary,
    upcomingEvents: dash.calendar.events.slice(0, 10),
    topPriorities: dash.topPriorities.slice(0, 5),
    forecast: dash.executive.organizationFundingForecast,
  };

  let insight: string;
  let offline = false;

  try {
    insight = await auraExecutiveChat(
      `${question}\n\nRespond as IFCDC AURA Executive Advisor with actionable guidance for grant operations leadership.`,
      `${context}\n\nGrant Center v4 Operations Intelligence:\n${JSON.stringify(briefing, null, 2)}`
    );
  } catch {
    offline = true;
    insight = buildOfflineAdvisorAnswer(question, dash);
  }

  return {
    insight,
    offline,
    question,
    suggestedQuestions: AURA_V4_ADVISOR_QUESTIONS,
    executive: dash.executive,
    topPriorities: dash.topPriorities,
    calendar: dash.calendar.summary,
    forecast: dash.executive.organizationFundingForecast,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildIntelligentFundingOperationsPlatform() {
  const [v4Dash, v3Dash] = await Promise.all([
    buildExecutiveOperationsDashboard(),
    buildExecutiveIntelligentDashboardV3(),
  ]);

  return {
    ...v4Dash,
    v3: {
      discovery: v3Dash.discovery,
      documents: v3Dash.documents,
    },
    version: "v4",
    generatedAt: new Date().toISOString(),
  };
}
