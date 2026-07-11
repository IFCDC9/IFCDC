/**
 * AURA Enterprise Brain 2.0 — Executive Operating Intelligence for IFCDC HQ.
 *
 * One conversation. One intelligence. One organizational memory. One command system.
 * Behind the scenes: multi-agent specialists + live HQ engines.
 * Founder retains approval on all high-impact actions.
 *
 * No demo intelligence. No invented figures. Assumptions labeled separately from facts.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import { getFounderEmail } from "./auraFounderTrustEngine";
import { createLeadershipAlert } from "./criticalAlerts";

export type BrainIntent =
  | "daily_briefing"
  | "work_today"
  | "org_risks"
  | "strategic_goals"
  | "board_prep"
  | "capital_strategy"
  | "org_model"
  | "predictive"
  | "monitor"
  | "general";

export type ExplainableRecommendation = {
  recommendation: string;
  whyItMatters: string;
  evidence: string[];
  systemsUsed: string[];
  assumptions: string[];
  missingInformation: string[];
  risks: string[];
  alternatives: string[];
  confidence: "high" | "medium" | "low";
  founderApprovalRequired: boolean;
};

export type PredictiveSignal = {
  id: string;
  title: string;
  category: "budget" | "grants" | "compliance" | "staffing" | "infrastructure" | "deployment" | "other";
  whyItMatters: string;
  evidence: string[];
  confidence: "high" | "medium" | "low";
  recommendedAction: string;
  founderApprovalRequired: boolean;
};

export type DigitalOrganizationModel = {
  generatedAt: string;
  organizationHealth: number | null;
  healthGrade: string | null;
  financial: {
    cashFlow: number | null;
    financialHealthScore: number | null;
    budgetRemaining: number | null;
  };
  grants: {
    pipelineValue: number | null;
    activeAwards: number | null;
    openOpportunities: number | null;
  };
  people: {
    employees: number | null;
    volunteers: number | null;
  };
  operations: {
    note: string;
  };
  technology: {
    healthScore: number | null;
    healthLabel: string | null;
    liveCommit: string | null;
    deployAligned: boolean | null;
  };
  compliance: {
    overdue: number;
    dueNext14Days: number;
  };
  approvalsPending: number;
  gaps: string[];
};

export type EnterpriseBrainResult = {
  brainVersion: "2.0";
  orchestrationId: string;
  intent: BrainIntent;
  generatedAt: string;
  orgModel: DigitalOrganizationModel;
  predictions: PredictiveSignal[];
  recommendations: ExplainableRecommendation[];
  unifiedBriefing: string;
  speechSummary: string;
  smsSummary: string;
  founderApprovalRequired: boolean;
  agentsDelegated: string[];
  multiAgent?: unknown;
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function truncate(s: string, n = 280): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

export function wantsEnterpriseBrain(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /\b(enterprise brain|operating intelligence|digital (org|organization) model)\b/i.test(m)
    || /\bwhat should i (work on|focus on|do) today\b/i.test(m)
    || /\b(daily|morning|executive) briefing\b/i.test(m)
    || /\bbiggest (organizational )?risks?\b|\borg(anization(al)?)? risks?\b/i.test(m)
    || /\bhow close (are we|is ifcdc) to (our )?strategic goals?\b/i.test(m)
    || /\bstrategic goals?\b|\bpredict(ive)? intelligence\b|\bpredict (risks?|issues?)\b/i.test(m)
    || /\borganization(al)? (health|status|snapshot|model)\b/i.test(m)
    || /\bcontinuous monitoring\b|\bmonitor (the )?(entire )?(organization|hq|system)\b/i.test(m)
  );
}

export function classifyBrainIntent(message: string): BrainIntent {
  if (/\bboard (meeting|packet|briefing)\b|\bprepare .+ board\b/i.test(message)) return "board_prep";
  if (/\braise\s+\$?\d+|\$\s?10\s*million|funding strategy|capital (campaign|plan)|five[- ]year/i.test(message)) {
    return "capital_strategy";
  }
  if (/\bwhat should i (work on|focus on|do) today\b/i.test(message)) return "work_today";
  if (/\b(daily|morning|executive) briefing\b/i.test(message)) return "daily_briefing";
  if (/\bbiggest (organizational )?risks?\b|\borg(anization(al)?)? risks?\b/i.test(message)) return "org_risks";
  if (/\bhow close .*(strategic goals?)|strategic goals?\b/i.test(message)) return "strategic_goals";
  if (/\bdigital (org|organization) model|organization(al)? (snapshot|model|status)\b/i.test(message)) {
    return "org_model";
  }
  if (/\bpredict(ive)?|forecast (risks?|issues?)\b/i.test(message)) return "predictive";
  if (/\bcontinuous monitoring|monitor (the )?(entire )?(organization|hq)\b/i.test(message)) return "monitor";
  if (wantsEnterpriseBrain(message)) return "general";
  return "general";
}

/** Live digital model of IFCDC — facts only from HQ systems. */
export async function buildDigitalOrganizationModel(): Promise<DigitalOrganizationModel> {
  const gaps: string[] = [];
  const [
    health,
    finance,
    grants,
    overview,
    tech,
    compliance,
    executive,
  ] = await Promise.all([
    withTimeout(
      import("./analyticsReporting").then((m) => m.buildOrganizationHealthScore()).catch(() => null),
      6_000,
      null
    ),
    withTimeout(
      import("./financeReporting").then((m) => m.buildExecutiveDashboard()).catch(() => null),
      6_000,
      null
    ),
    withTimeout(
      import("./grantReporting").then((m) => m.buildGrantExecutiveDashboard()).catch(() => null),
      6_000,
      null
    ),
    withTimeout(
      import("./analyticsReporting").then((m) => m.buildSafeAnalyticsOverview()).catch(() => null),
      6_000,
      null
    ),
    withTimeout(
      import("./auraTechnicalCommandEngine").then((m) => m.buildTechnicalCommandBriefing()).catch(() => null),
      8_000,
      null
    ),
    withTimeout(
      import("./auraExecutiveOps").then((m) => m.trackComplianceDeadlines()).catch(() => ({
        overdue: 0,
        dueNext14Days: 0,
      })),
      5_000,
      { overdue: 0, dueNext14Days: 0 }
    ),
    withTimeout(
      import("./auraExecutiveAssistant").then((m) => m.buildExecutiveHealthSummary()).catch(() => null),
      6_000,
      null
    ),
  ]);

  if (!health) gaps.push("Organization health score unavailable in this window");
  if (!finance) gaps.push("Finance dashboard unavailable in this window");
  if (!grants) gaps.push("Grant dashboard unavailable in this window");
  if (!tech) gaps.push("Technical health briefing unavailable in this window");

  return {
    generatedAt: new Date().toISOString(),
    organizationHealth: health?.overall ?? null,
    healthGrade: health?.grade ?? null,
    financial: {
      cashFlow: finance?.cashFlow ?? overview?.finance?.cashFlow ?? null,
      financialHealthScore: finance?.financialHealthScore ?? null,
      budgetRemaining: finance?.budgetRemaining ?? null,
    },
    grants: {
      pipelineValue: grants?.pipelineValue ?? null,
      activeAwards: grants?.activeAwards ?? null,
      openOpportunities: null,
    },
    people: {
      employees: overview?.people?.employees ?? null,
      volunteers: overview?.people?.volunteers ?? null,
    },
    operations: {
      note: "Operations capacity inferred from Mission Control / Operations modules when available",
    },
    technology: {
      healthScore: tech?.overallScore ?? null,
      healthLabel: tech?.overallLabel ?? null,
      liveCommit: tech?.liveCommit ?? null,
      deployAligned: tech?.deployAligned ?? null,
    },
    compliance: {
      overdue: (compliance as { overdue?: number }).overdue ?? 0,
      dueNext14Days: (compliance as { dueNext14Days?: number }).dueNext14Days ?? 0,
    },
    approvalsPending: (executive as { pendingApprovals?: number } | null)?.pendingApprovals ?? 0,
    gaps,
  };
}

/** Predictive signals with evidence, confidence, and recommended action. */
export async function buildPredictiveIntelligenceSignals(
  model?: DigitalOrganizationModel
): Promise<PredictiveSignal[]> {
  const org = model || (await buildDigitalOrganizationModel());
  const signals: PredictiveSignal[] = [];

  if (org.financial.budgetRemaining != null && org.financial.budgetRemaining < 0) {
    signals.push({
      id: "budget-shortfall",
      title: "Budget shortfall risk",
      category: "budget",
      whyItMatters: "Negative remaining budget reduces capacity for payroll and program delivery.",
      evidence: [`Budget remaining signal: ${org.financial.budgetRemaining}`],
      confidence: "high",
      recommendedAction: "Review Financial Center budget lines and pause non-essential spend pending Founder approval.",
      founderApprovalRequired: true,
    });
  } else if (org.financial.cashFlow != null && org.financial.cashFlow < 0) {
    signals.push({
      id: "cashflow-pressure",
      title: "Cash-flow pressure",
      category: "budget",
      whyItMatters: "Negative cash-flow trend can constrain near-term operations.",
      evidence: [`Cash flow signal: ${org.financial.cashFlow}`],
      confidence: "medium",
      recommendedAction: "Ask CFO path for 90-day cash forecast and fundraising acceleration options.",
      founderApprovalRequired: false,
    });
  }

  if (org.compliance.overdue > 0) {
    signals.push({
      id: "compliance-overdue",
      title: "Compliance deadline conflict / overdue filings",
      category: "compliance",
      whyItMatters: "Overdue compliance can jeopardize awards and registrations.",
      evidence: [`Overdue compliance items: ${org.compliance.overdue}`],
      confidence: "high",
      recommendedAction: "Clear overdue compliance items before new submissions.",
      founderApprovalRequired: true,
    });
  } else if (org.compliance.dueNext14Days > 0) {
    signals.push({
      id: "compliance-due-soon",
      title: "Compliance deadlines within 14 days",
      category: "compliance",
      whyItMatters: "Clustered deadlines create operational bottleneck risk.",
      evidence: [`Due within 14 days: ${org.compliance.dueNext14Days}`],
      confidence: "medium",
      recommendedAction: "Schedule compliance sweep this week.",
      founderApprovalRequired: false,
    });
  }

  if (org.technology.deployAligned === false) {
    signals.push({
      id: "deploy-drift",
      title: "Deployment drift risk",
      category: "deployment",
      whyItMatters: "Render behind GitHub means production may miss fixes and security patches.",
      evidence: [
        `Live commit: ${org.technology.liveCommit || "unknown"}`,
        "GitHub/Render alignment: not aligned",
      ],
      confidence: "high",
      recommendedAction: "Review latest main and Manual Deploy only after Founder approval.",
      founderApprovalRequired: true,
    });
  }

  if (org.technology.healthScore != null && org.technology.healthScore < 70) {
    signals.push({
      id: "infra-bottleneck",
      title: "Infrastructure / integration bottleneck",
      category: "infrastructure",
      whyItMatters: "Degraded production health threatens Founder OTP, voice, and HQ reliability.",
      evidence: [`Technical health score: ${org.technology.healthScore}/100 (${org.technology.healthLabel})`],
      confidence: "high",
      recommendedAction: "Run Technical Command briefing and open repair tickets for critical findings.",
      founderApprovalRequired: false,
    });
  }

  if (org.approvalsPending >= 3) {
    signals.push({
      id: "approval-backlog",
      title: "Founder approval backlog",
      category: "other",
      whyItMatters: "Unreviewed approvals block workflows and funding progress.",
      evidence: [`Pending approvals: ${org.approvalsPending}`],
      confidence: "medium",
      recommendedAction: "Work approval queue today — highest financial/compliance items first.",
      founderApprovalRequired: false,
    });
  }

  if (org.grants.pipelineValue != null && org.grants.pipelineValue === 0) {
    signals.push({
      id: "pipeline-thin",
      title: "Thin funding pipeline",
      category: "grants",
      whyItMatters: "Low pipeline increases multi-year sustainability risk.",
      evidence: [`Pipeline value signal: ${org.grants.pipelineValue}`],
      confidence: "medium",
      recommendedAction: "Run enterprise funding scan across all programs.",
      founderApprovalRequired: false,
    });
  }

  // Scenario-backed staffing pressure (optional live probe)
  try {
    const { runScenarioAnalysis } = await import("./scenarioModeling");
    const scenario = await withTimeout(runScenarioAnalysis({ headcountChange: 0, horizonMonths: 6 }), 5_000, null);
    if (scenario && scenario.summary.staffingGap > 2) {
      signals.push({
        id: "staffing-shortage",
        title: "Staffing shortage risk",
        category: "staffing",
        whyItMatters: "Modeled staffing gap can reduce program capacity and grant deliverability.",
        evidence: [`Scenario staffing gap signal: ${scenario.summary.staffingGap}`],
        confidence: "medium",
        recommendedAction: "Request HR + Operations staffing plan contingent on funded awards.",
        founderApprovalRequired: true,
      });
    }
  } catch {
    /* optional */
  }

  return signals;
}

function buildWorkTodayRecommendations(
  org: DigitalOrganizationModel,
  predictions: PredictiveSignal[]
): ExplainableRecommendation[] {
  const recs: ExplainableRecommendation[] = [];
  for (const p of predictions.slice(0, 4)) {
    recs.push({
      recommendation: p.recommendedAction,
      whyItMatters: p.whyItMatters,
      evidence: p.evidence,
      systemsUsed: ["digital_organization_model", "predictive_intelligence", p.category],
      assumptions: ["Signals reflect the latest successful HQ module reads in this window."],
      missingInformation: org.gaps,
      risks: [p.title],
      alternatives: ["Monitor only", "Delegate to specialist agent team for deeper packet"],
      confidence: p.confidence,
      founderApprovalRequired: p.founderApprovalRequired,
    });
  }
  if (!recs.length) {
    recs.push({
      recommendation: "Review daily executive briefing and clear any unread leadership alerts.",
      whyItMatters: "Maintains Founder situational awareness when no critical predictions are active.",
      evidence: [
        `Org health: ${org.organizationHealth ?? "n/a"}`,
        `Tech health: ${org.technology.healthScore ?? "n/a"}`,
      ],
      systemsUsed: ["digital_organization_model"],
      assumptions: [],
      missingInformation: org.gaps,
      risks: ["Silent degradation if monitoring is skipped"],
      alternatives: ["Ask for full multi-agent board packet"],
      confidence: "medium",
      founderApprovalRequired: false,
    });
  }
  return recs;
}

export async function buildEnterpriseBrainDailyBriefing(): Promise<{
  title: string;
  content: string;
  highlights: string[];
  orgModel: DigitalOrganizationModel;
  predictions: PredictiveSignal[];
}> {
  const [org, predictions, legacy] = await Promise.all([
    buildDigitalOrganizationModel(),
    buildPredictiveIntelligenceSignals(),
    import("./executiveBriefings")
      .then((m) => m.buildDailyExecutiveBriefingContent())
      .catch(() => null),
  ]);

  const highlights = [
    `Organization Health: ${org.organizationHealth ?? "n/a"}${org.healthGrade ? ` (${org.healthGrade})` : ""}`,
    `Financial health: ${org.financial.financialHealthScore ?? "n/a"} · Cash flow: ${org.financial.cashFlow ?? "n/a"}`,
    `Grant pipeline: ${org.grants.pipelineValue ?? "n/a"} · Active awards: ${org.grants.activeAwards ?? "n/a"}`,
    `Compliance: ${org.compliance.overdue} overdue · ${org.compliance.dueNext14Days} due in 14 days`,
    `System health: ${org.technology.healthScore ?? "n/a"}/100 (${org.technology.healthLabel ?? "n/a"})`,
    `Founder approvals pending: ${org.approvalsPending}`,
    ...predictions.slice(0, 3).map((p) => `Prediction [${p.confidence}]: ${p.title}`),
  ];

  const brainSections = [
    `# AURA Enterprise Brain 2.0 — Daily Executive Report`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Organization Health",
    `- Score: ${org.organizationHealth ?? "unavailable"} (${org.healthGrade ?? "n/a"})`,
    "",
    "## Financial Summary",
    `- Financial health: ${org.financial.financialHealthScore ?? "unavailable"}`,
    `- Cash flow: ${org.financial.cashFlow ?? "unavailable"}`,
    `- Budget remaining: ${org.financial.budgetRemaining ?? "unavailable"}`,
    "",
    "## Funding Pipeline",
    `- Pipeline value: ${org.grants.pipelineValue ?? "unavailable"}`,
    `- Active awards: ${org.grants.activeAwards ?? "unavailable"}`,
    "",
    "## Compliance Deadlines",
    `- Overdue: ${org.compliance.overdue}`,
    `- Due in 14 days: ${org.compliance.dueNext14Days}`,
    "",
    "## HR / Workforce",
    `- Employees: ${org.people.employees ?? "unavailable"} · Volunteers: ${org.people.volunteers ?? "unavailable"}`,
    "",
    "## System Health / Production",
    `- Tech score: ${org.technology.healthScore ?? "n/a"} (${org.technology.healthLabel ?? "n/a"})`,
    `- Live commit: ${org.technology.liveCommit ?? "unknown"} · Deploy aligned: ${
      org.technology.deployAligned === true ? "yes" : org.technology.deployAligned === false ? "no" : "unknown"
    }`,
    "",
    "## Founder Approvals",
    `- Pending: ${org.approvalsPending}`,
    "",
    "## Predictive Intelligence",
    ...(predictions.length
      ? predictions.map(
          (p) =>
            `- **${p.title}** (${p.confidence} confidence): ${p.whyItMatters} → ${p.recommendedAction}`
        )
      : ["- No high-confidence predictive signals in this window."]),
    "",
    "## Executive Recommendations",
    ...buildWorkTodayRecommendations(org, predictions).map(
      (r, i) =>
        `${i + 1}. ${r.recommendation} [confidence=${r.confidence}; approval=${r.founderApprovalRequired ? "required" : "not required"}]`
    ),
    "",
    "## Data Gaps / Assumptions",
    ...(org.gaps.length ? org.gaps.map((g) => `- Gap: ${g}`) : ["- No major module gaps flagged."]),
    "- Assumptions are not facts; figures come only from successful live HQ module reads.",
  ];

  if (legacy?.content) {
    brainSections.push("", "## Legacy Daily Briefing Supplement", legacy.content.slice(0, 2500));
  }

  return {
    title: "AURA Enterprise Brain 2.0 Daily Executive Report",
    content: brainSections.join("\n"),
    highlights,
    orgModel: org,
    predictions,
  };
}

let brainTablesReady = false;
export async function ensureEnterpriseBrainTables(): Promise<void> {
  if (brainTablesReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_enterprise_brain_runs (
      id TEXT PRIMARY KEY,
      intent TEXT NOT NULL,
      request TEXT,
      founder_approval_required INTEGER DEFAULT 0,
      actor_email TEXT,
      channel TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS aura_founder_feedback (
      id TEXT PRIMARY KEY,
      brain_run_id TEXT,
      feedback_type TEXT NOT NULL,
      rating INTEGER,
      note TEXT,
      decision_ref TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_brain_runs_created ON aura_enterprise_brain_runs(created_at DESC);
  `);
  brainTablesReady = true;
}

/** Record Founder feedback for continuous improvement (approved decisions, corrections). */
export async function recordFounderBrainFeedback(opts: {
  brainRunId?: string;
  feedbackType: "approved" | "rejected" | "correction" | "useful" | "not_useful";
  rating?: number;
  note?: string;
  decisionRef?: string;
  actorEmail?: string | null;
}): Promise<{ ok: boolean; id: string }> {
  await ensureEnterpriseBrainTables();
  const id = crypto.randomUUID();
  const db = await getDb();
  await db.run(
    `INSERT INTO aura_founder_feedback (id, brain_run_id, feedback_type, rating, note, decision_ref, actor_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    opts.brainRunId ?? null,
    opts.feedbackType,
    opts.rating ?? null,
    opts.note ?? null,
    opts.decisionRef ?? null,
    opts.actorEmail || getFounderEmail(),
    new Date().toISOString()
  );
  await logHqAudit({
    action: "aura_enterprise_brain_feedback",
    entityType: "aura_enterprise_brain",
    entityId: id,
    detail: opts.feedbackType,
    actorEmail: opts.actorEmail || getFounderEmail(),
    metadata: { brainRunId: opts.brainRunId, note: opts.note },
  });
  return { ok: true, id };
}

function synthesizeBrainSpeech(opts: {
  intent: BrainIntent;
  org: DigitalOrganizationModel;
  predictions: PredictiveSignal[];
  recommendations: ExplainableRecommendation[];
}): { speech: string; sms: string; briefing: string } {
  const { intent, org, predictions, recommendations } = opts;
  const topPred = predictions[0];
  const topRec = recommendations[0];
  const speech = [
    `Enterprise Brain 2.0 report.`,
    `Organization health ${org.organizationHealth ?? "unavailable"}${org.healthGrade ? ` (${org.healthGrade})` : ""}.`,
    `System health ${org.technology.healthScore ?? "n/a"} out of 100.`,
    topPred
      ? `Top predictive signal: ${topPred.title}, confidence ${topPred.confidence}. ${topPred.recommendedAction}`
      : "No high-priority predictive signals right now.",
    topRec
      ? `Recommended focus: ${topRec.recommendation}${topRec.founderApprovalRequired ? " Founder approval required before execution." : ""}`
      : "",
    org.gaps[0] ? `Data gap: ${org.gaps[0]}` : "Live module reads completed for this briefing.",
  ]
    .filter(Boolean)
    .join(" ");

  const sms = [
    `Brain2.0 ${intent}: health ${org.organizationHealth ?? "?"}`,
    `Tech ${org.technology.healthScore ?? "?"}/100`,
    topPred ? `Risk: ${topPred.title} (${topPred.confidence})` : "No critical predictions",
    topRec ? `Next: ${truncate(topRec.recommendation, 90)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const briefing = [
    `AURA ENTERPRISE BRAIN 2.0 — ${intent.replace(/_/g, " ").toUpperCase()}`,
    `Org health: ${org.organizationHealth ?? "n/a"} (${org.healthGrade ?? "n/a"})`,
    `Finance: health ${org.financial.financialHealthScore ?? "n/a"} · cash ${org.financial.cashFlow ?? "n/a"}`,
    `Grants pipeline: ${org.grants.pipelineValue ?? "n/a"}`,
    `Compliance overdue: ${org.compliance.overdue} · due 14d: ${org.compliance.dueNext14Days}`,
    `Tech: ${org.technology.healthScore ?? "n/a"}/100 · commit ${org.technology.liveCommit ?? "?"}`,
    `Approvals pending: ${org.approvalsPending}`,
    "",
    "Predictions:",
    ...(predictions.length
      ? predictions.map(
          (p) =>
            `- [${p.confidence}] ${p.title}: ${p.whyItMatters} | Action: ${p.recommendedAction} | Evidence: ${p.evidence.join("; ")}`
        )
      : ["- None"]),
    "",
    "Explainable recommendations:",
    ...recommendations.map((r, i) => {
      return [
        `${i + 1}. ${r.recommendation}`,
        `   Why: ${r.whyItMatters}`,
        `   Evidence: ${r.evidence.join(" | ") || "n/a"}`,
        `   Systems: ${r.systemsUsed.join(", ")}`,
        `   Assumptions: ${r.assumptions.join("; ") || "none"}`,
        `   Missing: ${r.missingInformation.join("; ") || "none flagged"}`,
        `   Risks: ${r.risks.join("; ") || "n/a"}`,
        `   Alternatives: ${r.alternatives.join("; ") || "n/a"}`,
        `   Confidence: ${r.confidence} · Founder approval: ${r.founderApprovalRequired ? "REQUIRED" : "not required"}`,
      ].join("\n");
    }),
  ].join("\n");

  return { speech, sms, briefing };
}

/**
 * Primary Enterprise Brain 2.0 entry — Founder speaks to AURA; Brain routes/orchestrates.
 */
export async function runEnterpriseBrain(opts: {
  request: string;
  channel: "voice" | "sms" | "hq_web";
  actorEmail?: string | null;
  founderMode: boolean;
}): Promise<EnterpriseBrainResult> {
  const orchestrationId = crypto.randomUUID();
  if (!opts.founderMode) {
    return {
      brainVersion: "2.0",
      orchestrationId,
      intent: "general",
      generatedAt: new Date().toISOString(),
      orgModel: {
        generatedAt: new Date().toISOString(),
        organizationHealth: null,
        healthGrade: null,
        financial: { cashFlow: null, financialHealthScore: null, budgetRemaining: null },
        grants: { pipelineValue: null, activeAwards: null, openOpportunities: null },
        people: { employees: null, volunteers: null },
        operations: { note: "Founder Mode required" },
        technology: { healthScore: null, healthLabel: null, liveCommit: null, deployAligned: null },
        compliance: { overdue: 0, dueNext14Days: 0 },
        approvalsPending: 0,
        gaps: ["Founder Mode required"],
      },
      predictions: [],
      recommendations: [],
      unifiedBriefing: "Enterprise Brain 2.0 requires Founder Mode.",
      speechSummary: "Please verify founder first, then ask for your daily briefing or organizational risks.",
      smsSummary: "Founder Mode required for Enterprise Brain.",
      founderApprovalRequired: true,
      agentsDelegated: [],
    };
  }

  let intent = classifyBrainIntent(opts.request);
  // Also catch multi-agent style requests through Brain facade
  const { wantsMultiAgentOrchestration, classifyExecutiveIntent, orchestrateExecutiveAgentTeam } =
    await import("./auraExecutiveAgentOrchestrator");
  if (wantsMultiAgentOrchestration(opts.request)) {
    const execIntent = classifyExecutiveIntent(opts.request);
    if (execIntent === "board_briefing") intent = "board_prep";
    if (execIntent === "capital_strategy") intent = "capital_strategy";
  }

  const agentsDelegated: string[] = ["enterprise_brain", "knowledge_librarian", "intelligence_analyst"];
  let multiAgent: unknown;

  // Board / capital → full specialist team under Brain
  if (intent === "board_prep" || intent === "capital_strategy" || wantsMultiAgentOrchestration(opts.request)) {
    multiAgent = await orchestrateExecutiveAgentTeam({
      request: opts.request,
      channel: opts.channel,
      actorEmail: opts.actorEmail,
      founderMode: true,
    });
    agentsDelegated.push(
      ...(((multiAgent as { agentsInvoked?: string[] }).agentsInvoked) || [])
    );
  }

  if (intent === "monitor") {
    const { evaluateAndEmitProactiveAlerts } = await import("./auraProactiveIntelligence");
    await evaluateAndEmitProactiveAlerts({ notifyFounderChannels: false }).catch(() => null);
    agentsDelegated.push("proactive_monitor", "cto");
  }

  const orgModel = await buildDigitalOrganizationModel();
  const predictions =
    intent === "daily_briefing"
      ? (await buildEnterpriseBrainDailyBriefing()).predictions
      : await buildPredictiveIntelligenceSignals(orgModel);

  let recommendations = buildWorkTodayRecommendations(orgModel, predictions);
  let unifiedBriefing = "";
  let speechSummary = "";
  let smsSummary = "";

  if (intent === "daily_briefing") {
    const daily = await buildEnterpriseBrainDailyBriefing();
    unifiedBriefing = daily.content;
    speechSummary = `Here is your Enterprise Brain daily briefing. ${daily.highlights.slice(0, 4).join(". ")}.`;
    smsSummary = daily.highlights.slice(0, 5).join("\n");
    recommendations = buildWorkTodayRecommendations(daily.orgModel, daily.predictions);
  } else if (intent === "board_prep" || intent === "capital_strategy") {
    const ma = multiAgent as {
      unifiedBriefing?: string;
      speechSummary?: string;
      smsSummary?: string;
      founderApprovalRequired?: boolean;
    };
    unifiedBriefing = ma.unifiedBriefing || "Multi-agent briefing unavailable.";
    speechSummary = ma.speechSummary || speechSummary;
    smsSummary = ma.smsSummary || smsSummary;
  } else if (intent === "strategic_goals") {
    recommendations = [
      {
        recommendation: "Align near-term execution to funded pipeline and compliance clearance before expansion.",
        whyItMatters: "Strategic progress depends on funded capacity and clean compliance posture.",
        evidence: [
          `Org health: ${orgModel.organizationHealth ?? "n/a"}`,
          `Pipeline: ${orgModel.grants.pipelineValue ?? "n/a"}`,
          `Compliance overdue: ${orgModel.compliance.overdue}`,
        ],
        systemsUsed: ["digital_organization_model", "grants", "compliance"],
        assumptions: ["Strategic goals are inferred from live HQ health and pipeline signals until a formal goals document is indexed."],
        missingInformation: [
          ...orgModel.gaps,
          "Formal strategic plan document may need Knowledge Base sync for precise goal tracking",
        ],
        risks: predictions.map((p) => p.title),
        alternatives: ["Run five-year capital strategy multi-agent plan", "Request Knowledge Librarian sync of strategic plan"],
        confidence: orgModel.gaps.length ? "low" : "medium",
        founderApprovalRequired: true,
      },
      ...recommendations.slice(0, 2),
    ];
    const synth = synthesizeBrainSpeech({ intent, org: orgModel, predictions, recommendations });
    unifiedBriefing = synth.briefing;
    speechSummary = synth.speech;
    smsSummary = synth.sms;
  } else {
    const synth = synthesizeBrainSpeech({ intent, org: orgModel, predictions, recommendations });
    unifiedBriefing = synth.briefing;
    speechSummary = synth.speech;
    smsSummary = synth.sms;
  }

  // If multi-agent provided speech and we didn't set daily-only path, prefer blending
  if (multiAgent && intent !== "daily_briefing" && !(intent === "board_prep" || intent === "capital_strategy")) {
    const ma = multiAgent as { speechSummary?: string };
    if (ma.speechSummary) speechSummary = `${speechSummary} ${ma.speechSummary}`;
  }

  const founderApprovalRequired =
    recommendations.some((r) => r.founderApprovalRequired)
    || predictions.some((p) => p.founderApprovalRequired)
    || intent === "capital_strategy"
    || intent === "board_prep"
    || Boolean((multiAgent as { founderApprovalRequired?: boolean } | undefined)?.founderApprovalRequired);

  await ensureEnterpriseBrainTables();
  const db = await getDb();
  const resultPayload: EnterpriseBrainResult = {
    brainVersion: "2.0",
    orchestrationId,
    intent,
    generatedAt: new Date().toISOString(),
    orgModel,
    predictions,
    recommendations,
    unifiedBriefing,
    speechSummary,
    smsSummary,
    founderApprovalRequired,
    agentsDelegated: Array.from(new Set(agentsDelegated)),
    multiAgent,
  };

  await db.run(
    `INSERT INTO aura_enterprise_brain_runs (id, intent, request, founder_approval_required, actor_email, channel, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    orchestrationId,
    intent,
    opts.request.slice(0, 1000),
    founderApprovalRequired ? 1 : 0,
    opts.actorEmail || getFounderEmail(),
    opts.channel,
    JSON.stringify({
      intent,
      predictions: predictions.map((p) => p.id),
      recommendationCount: recommendations.length,
      agentsDelegated: resultPayload.agentsDelegated,
    }),
    new Date().toISOString()
  );

  await logHqAudit({
    action: "aura_enterprise_brain_run",
    entityType: "aura_enterprise_brain",
    entityId: orchestrationId,
    detail: `${intent}: ${opts.request.slice(0, 180)}`,
    actorEmail: opts.actorEmail || getFounderEmail(),
    metadata: {
      intent,
      founderApprovalRequired,
      agentsDelegated: resultPayload.agentsDelegated,
      channel: opts.channel,
    },
  });

  if (intent === "daily_briefing" || intent === "work_today") {
    await createLeadershipAlert({
      alertType: "aura_enterprise_brain",
      title: intent === "daily_briefing" ? "Enterprise Brain daily briefing ready" : "Enterprise Brain — Founder focus list",
      message: speechSummary.slice(0, 400),
      priority: predictions.some((p) => p.confidence === "high") ? "high" : "normal",
      sourceModule: "aura_enterprise_brain",
      sourceId: orchestrationId,
      path: "/hq/aura",
    }).catch(() => undefined);
  }

  return resultPayload;
}

/** Prompt block for Founder Mode — Enterprise Brain 2.0 identity. */
export function buildEnterpriseBrainSystemBlock(): string {
  return `
═══ AURA ENTERPRISE BRAIN 2.0 ═══
You are the Executive Operating Intelligence for IFCDC Headquarters.
One conversation. One intelligence. One organizational memory. One command system.
Behind the scenes you may convene specialist executives; the Founder only hears AURA.
Always separate verified HQ facts from recommendations and assumptions.
High-impact actions require Founder approval before execution.
For daily briefing, risks, strategic goals, board prep, or capital strategy — use Enterprise Brain orchestration.
═══ END ENTERPRISE BRAIN 2.0 ═══`;
}
