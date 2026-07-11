/**
 * AURA Enterprise Brain 3.0 — Executive Decision Intelligence System.
 *
 * Operating intelligence of IFCDC HQ: analyze, recommend, draft, simulate, organize,
 * monitor, coordinate, prepare. Never execute high-impact actions without Founder approval.
 * Facts from live HQ data; assumptions always labeled.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import { runScenarioAnalysis, type ScenarioInput, type ScenarioResult } from "./scenarioModeling";
import { answerDecisionSupportQuestion, type DecisionSupportResult } from "./auraDecisionSupport";
import { listStrategicGoals, type StrategicGoal } from "./strategicGoalsEngine";
import type { DigitalOrganizationModel, PredictiveSignal } from "./auraEnterpriseBrain";

export const BRAIN_VERSION = "3.0" as const;

async function getOrgModel(): Promise<DigitalOrganizationModel> {
  const { buildDigitalOrganizationModel } = await import("./auraEnterpriseBrain");
  return buildDigitalOrganizationModel();
}

async function getPredictions(model?: DigitalOrganizationModel): Promise<PredictiveSignal[]> {
  const { buildPredictiveIntelligenceSignals } = await import("./auraEnterpriseBrain");
  return buildPredictiveIntelligenceSignals(model);
}

export type DecisionConfidence = "high" | "medium" | "low";

export type ExplainabilityBlock = {
  systemsUsed: string[];
  documentsReferenced: string[];
  supportingData: string[];
  confidence: DecisionConfidence;
  missingInformation: string[];
  assumptions: string[];
  risks: string[];
};

export type SimulationScenario = {
  id: string;
  label: string;
  posture: "optimistic" | "base" | "conservative";
  input: ScenarioInput;
  result: ScenarioResult;
  assumptions: string[];
};

export type ExecutiveDecisionPackage = {
  brainVersion: typeof BRAIN_VERSION;
  question: string;
  generatedAt: string;
  decisionType:
    | "grant_apply"
    | "hire"
    | "afford_project"
    | "expand_program"
    | "prioritize"
    | "biggest_risk"
    | "simulation"
    | "general";
  executiveSummary: string;
  analysis: {
    financialImpact: string;
    budgetAvailability: string;
    staffingCapacity: string;
    grantEligibility: string;
    organizationalReadiness: string;
    complianceObligations: string;
    technologyReadiness: string;
    operationalWorkload: string;
    strategicAlignment: string;
    timeline: string;
    dependencies: string[];
    risks: string[];
    expectedOutcomes: string[];
  };
  recommendation: string;
  supportingEvidence: string[];
  alternatives: Array<{ id: string; label: string; summary: string }>;
  confidence: DecisionConfidence;
  founderApprovalRequired: boolean;
  founderMay: string[];
  founderMustApprove: string[];
  explainability: ExplainabilityBlock;
  scenarios?: SimulationScenario[];
  scenario?: ScenarioResult;
  speechSummary: string;
  smsSummary: string;
  rawDecisionSupport?: DecisionSupportResult;
  learningHints?: string[];
};

export type ScorecardDimension = {
  id: string;
  label: string;
  score: number | null;
  grade: string;
  evidence: string[];
  gap?: string;
};

export type OrganizationPerformanceScorecard = {
  generatedAt: string;
  brainVersion: typeof BRAIN_VERSION;
  enterpriseHealthScore: number | null;
  enterpriseGrade: string;
  dimensions: ScorecardDimension[];
  gaps: string[];
};

export type OpportunityItem = {
  id: string;
  category:
    | "funding"
    | "partnership"
    | "revenue"
    | "cost_savings"
    | "program_expansion"
    | "technology"
    | "process"
    | "capacity";
  title: string;
  whyItMatters: string;
  expectedBenefit: string;
  risks: string[];
  estimatedEffort: "low" | "medium" | "high";
  strategicImpact: "low" | "medium" | "high";
  evidence: string[];
  recommendedNextStep: string;
  founderApprovalRequired: boolean;
  confidence: DecisionConfidence;
};

export type WeeklyExecutiveReview = {
  generatedAt: string;
  brainVersion: typeof BRAIN_VERSION;
  periodLabel: string;
  executiveSummary: string;
  accomplishments: string[];
  challenges: string[];
  fundingPipeline: string;
  financialPosition: string;
  grantsWon: string;
  grantsPending: string;
  hr: string;
  operations: string;
  technology: string;
  compliance: string;
  recommendedPriorities: string[];
  speechSummary: string;
  content: string;
};

export type ExecutiveAlert = {
  id: string;
  severity: "critical" | "high" | "medium" | "info";
  title: string;
  detail: string;
  requiresFounderAttention: boolean;
};

export type EnterpriseBrainDashboard = {
  generatedAt: string;
  brainVersion: typeof BRAIN_VERSION;
  organizationHealth: number | null;
  healthGrade: string | null;
  enterpriseHealthScore: number | null;
  enterpriseGrade: string;
  strategicGoals: StrategicGoal[];
  goalsSummary: { onTrack: number; atRisk: number; blocked: number; achieved: number; avgProgress: number };
  fundingPipeline: { pipelineValue: number | null; activeAwards: number | null };
  financialPosition: { cashFlow: number | null; financialHealthScore: number | null; budgetRemaining: number | null };
  activeRisks: PredictiveSignal[];
  opportunities: OpportunityItem[];
  founderPriorities: string[];
  executiveAlerts: ExecutiveAlert[];
  auraRecommendations: string[];
  orgModel: DigitalOrganizationModel;
  scorecard: OrganizationPerformanceScorecard;
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function gradeFromScore(score: number | null): string {
  if (score == null) return "—";
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function truncate(s: string, n = 280): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function confidenceFromGaps(gaps: string[], risk: string): DecisionConfidence {
  if (gaps.length >= 3 || risk === "high") return "low";
  if (gaps.length >= 1 || risk === "medium") return "medium";
  return "high";
}

const FOUNDER_MAY = [
  "Analyze",
  "Recommend",
  "Draft",
  "Simulate",
  "Organize",
  "Monitor",
  "Coordinate",
  "Prepare",
];

const FOUNDER_MUST_APPROVE = [
  "Submit grants",
  "Approve payments",
  "Send external communications",
  "Hire or terminate employees",
  "Delete production data",
  "Deploy production code",
  "Modify security settings",
  "Make irreversible changes",
];

export function wantsExecutiveDecisionIntelligence(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /\b(should we (apply|hire|expand|launch)|can we afford|what happens if|what if we)\b/i.test(m)
    || /\b(what should we work on first|biggest risk (to|for) ifcdc|enterprise brain 3)\b/i.test(m)
    || /\bexecutive decision|decision intelligence|scorecard|strategic goals? center\b/i.test(m)
    || /\bweekly (executive )?review\b/i.test(m)
    || /\b(opportunity intelligence|opportunities for (ifcdc|the organization))\b/i.test(m)
    || /\benterprise (brain )?dashboard\b/i.test(m)
    || /\bsimulat(e|ion)\b/i.test(m)
  );
}

export function classifyDecisionType(question: string): ExecutiveDecisionPackage["decisionType"] {
  if (/\bwhat (happens|if)|simulat/i.test(question)) return "simulation";
  if (/\bbiggest risk\b/i.test(question)) return "biggest_risk";
  if (/\bwhat should we work on first\b|\bpriorit/i.test(question)) return "prioritize";
  if (/\b(apply|submit).{0,40}grant|should we apply\b/i.test(question)) return "grant_apply";
  if (/\bhire|staffing|fte|employees?\b/i.test(question)) return "hire";
  if (/\bafford|project cost|can we fund\b/i.test(question)) return "afford_project";
  if (/\bexpand (this |the )?program|launch .{0,30}program|housing program|community center\b/i.test(question)) {
    return "expand_program";
  }
  return "general";
}

export function parseWhatIfScenario(question: string): { input: ScenarioInput; assumptions: string[]; label: string } {
  const assumptions: string[] = [];
  const input: ScenarioInput = { horizonMonths: 12 };
  let label = "Custom simulation";

  const money =
    question.match(/\$\s?([\d,.]+)\s*(million|m)\b/i)
    || question.match(/\$\s?([\d,.]+)\s*(k|thousand)?\b/i);
  if (money) {
    let amount = parseFloat(money[1].replace(/,/g, ""));
    if (/million|^m$/i.test(money[2] || "")) amount *= 1_000_000;
    else if (/k|thousand/i.test(money[2] || "")) amount *= 1_000;
    if (/\b(lose|lost|cut|without|lose .{0,20}funding)\b/i.test(question)) {
      input.budgetChangePercent = -Math.min(40, Math.round((amount / 2_000_000) * 25));
      input.grantWinRateAdjust = -20;
      label = `Lose ~$${Math.round(amount).toLocaleString()} funding pressure`;
      assumptions.push("Funding loss modeled as budget contraction + lower grant conversion; exact award not identified.");
    } else {
      input.budgetChangePercent = Math.min(35, Math.round((amount / 2_000_000) * 20));
      input.grantWinRateAdjust = 20;
      input.programEnrollmentChange = 10;
      label = `Receive ~$${Math.round(amount).toLocaleString()} grant`;
      assumptions.push("Grant receipt modeled as temporary budget/capacity uplift; award terms not yet in HQ.");
    }
  }

  const hireMatch =
    question.match(/\bhire\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i)
    || question.match(/\b(\d+)\s+employees?\b/i);
  if (hireMatch) {
    const wordMap: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };
    const raw = hireMatch[1].toLowerCase();
    const n = wordMap[raw] ?? parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      input.headcountChange = n;
      input.budgetChangePercent = (input.budgetChangePercent || 0) + Math.min(20, n * 2);
      label = label.startsWith("Custom") ? `Hire ${n} employees` : `${label} + hire ${n}`;
      assumptions.push(`Average fully loaded cost not itemized — headcount +${n} uses scenario staffing model.`);
    }
  }

  if (/\bhousing program|another housing\b/i.test(question)) {
    input.programEnrollmentChange = (input.programEnrollmentChange || 0) + 20;
    input.headcountChange = (input.headcountChange || 0) + 3;
    input.budgetChangePercent = (input.budgetChangePercent || 0) + 12;
    label = label.startsWith("Custom") ? "Open another housing program" : `${label} + housing program`;
    assumptions.push("Housing program modeled as +20% enrollment, +3 FTE, +12% budget — site-specific costs unknown.");
  }

  if (/\b(second|another) software (product|app)|launch .{0,20}software\b/i.test(question)) {
    input.budgetChangePercent = (input.budgetChangePercent || 0) + 8;
    input.headcountChange = (input.headcountChange || 0) + 2;
    label = label.startsWith("Custom") ? "Launch second software product" : `${label} + software product`;
    assumptions.push("Software product launch modeled as +2 FTE engineering/support and +8% budget; roadmap slot not selected.");
  }

  if (/\bcommunity center\b/i.test(question)) {
    input.programEnrollmentChange = (input.programEnrollmentChange || 0) + 25;
    input.headcountChange = (input.headcountChange || 0) + 4;
    input.budgetChangePercent = (input.budgetChangePercent || 0) + 15;
    label = label.startsWith("Custom") ? "Add another community center" : `${label} + community center`;
    assumptions.push("Community center modeled as capacity expansion; facility lease/capex not in HQ model.");
  }

  const programs = question.match(/\b(launch|add|open)\s+(\d+|two|three)\s+(new )?programs?\b/i);
  if (programs || /\blaunch two new programs\b/i.test(question)) {
    const wordMap: Record<string, number> = { two: 2, three: 3 };
    const raw = programs?.[2]?.toLowerCase() || "two";
    const n = (wordMap[raw] ?? parseInt(raw, 10)) || 2;
    input.programEnrollmentChange = (input.programEnrollmentChange || 0) + n * 12;
    input.headcountChange = (input.headcountChange || 0) + n;
    input.budgetChangePercent = (input.budgetChangePercent || 0) + n * 4;
    label = label.startsWith("Custom") ? `Launch ${n} new programs` : `${label} + ${n} programs`;
    assumptions.push("Each new program assumed to need ~1 FTE and enrollment growth; not program-specific.");
  }

  if (/\blose (a )?major (funding|grant|award)\b/i.test(question) && input.budgetChangePercent == null) {
    input.budgetChangePercent = -20;
    input.grantWinRateAdjust = -25;
    label = "Lose major funding source";
    assumptions.push("Major funding loss modeled as -20% budget and -25 win-rate adjust — specific award not selected.");
  }

  if (!Object.keys(input).some((k) => k !== "horizonMonths" && (input as Record<string, unknown>)[k] != null)) {
    assumptions.push("Could not parse concrete levers — running mild growth baseline for illustration only.");
    input.budgetChangePercent = 5;
    label = "Illustrative mild growth (unparsed what-if)";
  }

  return { input, assumptions, label };
}

/** Build optimistic / base / conservative scenario trio for Executive Simulator. */
export async function runMultiScenarioSimulation(question: string): Promise<{
  label: string;
  scenarios: SimulationScenario[];
  assumptions: string[];
}> {
  const parsed = parseWhatIfScenario(question);
  const base = parsed.input;
  const variants: Array<{ posture: SimulationScenario["posture"]; scale: number; label: string }> = [
    { posture: "optimistic", scale: 1.25, label: `${parsed.label} (optimistic)` },
    { posture: "base", scale: 1, label: `${parsed.label} (base)` },
    { posture: "conservative", scale: 0.65, label: `${parsed.label} (conservative)` },
  ];

  const scenarios: SimulationScenario[] = [];
  for (const v of variants) {
    const input: ScenarioInput = {
      horizonMonths: base.horizonMonths ?? 12,
      budgetChangePercent: base.budgetChangePercent != null ? Math.round(base.budgetChangePercent * v.scale) : undefined,
      headcountChange: base.headcountChange != null ? Math.max(0, Math.round(base.headcountChange * v.scale)) : undefined,
      grantWinRateAdjust: base.grantWinRateAdjust != null ? Math.round(base.grantWinRateAdjust * v.scale) : undefined,
      donationGrowthPercent: base.donationGrowthPercent != null ? Math.round(base.donationGrowthPercent * v.scale) : undefined,
      programEnrollmentChange:
        base.programEnrollmentChange != null ? Math.round(base.programEnrollmentChange * v.scale) : undefined,
    };
    if (v.posture === "conservative" && (input.headcountChange || 0) > 0) {
      input.budgetChangePercent = (input.budgetChangePercent || 0) - 3;
    }
    if (v.posture === "optimistic" && (input.grantWinRateAdjust || 0) >= 0) {
      input.grantWinRateAdjust = (input.grantWinRateAdjust || 0) + 5;
    }
    const result = await runScenarioAnalysis(input);
    scenarios.push({
      id: crypto.randomUUID(),
      label: v.label,
      posture: v.posture,
      input,
      result,
      assumptions: [
        ...parsed.assumptions,
        `${v.posture} posture scales levers at ~${Math.round(v.scale * 100)}% of base parse.`,
      ],
    });
  }

  return { label: parsed.label, scenarios, assumptions: parsed.assumptions };
}

async function loadFounderLearningHints(): Promise<string[]> {
  try {
    const db = await getDb();
    const rows = (await db.all(
      `SELECT feedback_type, note FROM aura_founder_feedback ORDER BY created_at DESC LIMIT 8`
    )) as Array<{ feedback_type: string; note: string | null }>;
    return rows.map((r) => {
      const note = (r.note || "").trim();
      return note ? `Prior Founder feedback (${r.feedback_type}): ${note.slice(0, 120)}` : `Prior Founder signal: ${r.feedback_type}`;
    });
  } catch {
    return [];
  }
}

export async function runExecutiveDecisionEngine(question: string): Promise<ExecutiveDecisionPackage> {
  const decisionType = classifyDecisionType(question);
  const systemsUsed = ["executive_decision_engine", "scenario_modeling", "decision_support", "org_model", "strategic_goals"];
  const assumptions: string[] = [];
  const missingInformation: string[] = [];
  const documentsReferenced: string[] = [];

  let scenarios: SimulationScenario[] | undefined;
  let scenario: ScenarioResult | undefined;
  let scenarioLabel = "";

  if (decisionType === "simulation" || /\bwhat (happens|if)\b/i.test(question)) {
    const multi = await runMultiScenarioSimulation(question);
    assumptions.push(...multi.assumptions);
    scenarioLabel = multi.label;
    scenarios = multi.scenarios;
    scenario = multi.scenarios.find((s) => s.posture === "base")?.result || multi.scenarios[0]?.result;
    systemsUsed.push("executive_simulator");
  } else if (decisionType === "hire") {
    const countMatch = question.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
    const wordMap: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };
    const raw = countMatch?.[1]?.toLowerCase() || "2";
    const n = (wordMap[raw] ?? parseInt(raw, 10)) || 2;
    const multi = await runMultiScenarioSimulation(`What happens if we hire ${n} employees`);
    scenarios = multi.scenarios;
    scenario = multi.scenarios.find((s) => s.posture === "base")?.result;
    assumptions.push(`Modeled +${n} FTE across optimistic/base/conservative postures; payroll rates not line-itemed.`);
  } else if (decisionType === "grant_apply") {
    scenario = await runScenarioAnalysis({ grantWinRateAdjust: 10, budgetChangePercent: 3, horizonMonths: 12 });
    assumptions.push("Grant application modeled as modest pipeline conversion uplift — specific NOFO terms may differ.");
    documentsReferenced.push("Grant Center opportunity records (live match when available)");
  } else if (decisionType === "expand_program") {
    const multi = await runMultiScenarioSimulation(question.includes("what") ? question : `What happens if ${question}`);
    scenarios = multi.scenarios;
    scenario = multi.scenarios.find((s) => s.posture === "base")?.result;
    assumptions.push(...multi.assumptions);
  } else if (decisionType === "afford_project") {
    scenario = await runScenarioAnalysis({ budgetChangePercent: -5, horizonMonths: 6 });
    assumptions.push("Project affordability uses a conservative -5% budget stress test when cost is unspecified.");
    missingInformation.push("Exact project cost not provided in the question");
  } else {
    scenario = await runScenarioAnalysis({ horizonMonths: 6 });
  }

  const [decision, org, compliance, goals, learningHints, predictions] = await Promise.all([
    answerDecisionSupportQuestion(question),
    getOrgModel(),
    import("./auraExecutiveOps").then((m) => m.trackComplianceDeadlines()).catch(() => ({
      overdue: 0,
      dueNext14Days: 0,
    })),
    listStrategicGoals(),
    loadFounderLearningHints(),
    getPredictions(),
  ]);

  documentsReferenced.push(
    ...decision.citations.slice(0, 5).map((c) => `${c.source}: ${c.title}${c.excerpt ? ` — ${c.excerpt.slice(0, 80)}` : ""}`)
  );

  const riskLevel = scenario?.summary.riskLevel || "medium";
  const confidence = confidenceFromGaps(
    [...decision.gaps, ...org.gaps, ...missingInformation],
    riskLevel
  );

  const blockedGoals = goals.goals.filter((g) => g.status === "blocked" || g.status === "at_risk");
  const topRisk = predictions[0];

  const analysis = {
    financialImpact: `Cash-flow impact (base model): ${scenario?.summary.cashFlowImpact ?? "n/a"}. Financial health: ${org.financial.financialHealthScore ?? "unavailable"}.`,
    budgetAvailability: `Budget remaining signal: ${org.financial.budgetRemaining ?? "unavailable"}. Cash flow: ${org.financial.cashFlow ?? "unavailable"}.`,
    staffingCapacity: `Staffing gap: ${scenario?.summary.staffingGap ?? "n/a"}. Employees: ${org.people.employees ?? "unavailable"}.`,
    grantEligibility:
      decisionType === "grant_apply"
        ? "Confirm eligibility, match, compliance capacity, and submission deadline in Grant Center before applying."
        : `Pipeline: ${org.grants.pipelineValue ?? "unavailable"}; active awards: ${org.grants.activeAwards ?? "unavailable"}.`,
    organizationalReadiness: `Org health ${org.organizationHealth ?? "n/a"} (${org.healthGrade ?? "—"}). Goals avg progress ${goals.summary.avgProgress}%.`,
    complianceObligations: `Overdue: ${(compliance as { overdue: number }).overdue}; due in 14 days: ${(compliance as { dueNext14Days: number }).dueNext14Days}.`,
    technologyReadiness: `Tech ${org.technology.healthScore ?? "n/a"}/100 (${org.technology.healthLabel ?? "—"}); deploy aligned=${org.technology.deployAligned ?? "unknown"}.`,
    operationalWorkload: `Pending Founder approvals: ${org.approvalsPending}. Blocked/at-risk goals: ${blockedGoals.length}.`,
    strategicAlignment: blockedGoals[0]
      ? `Aligns against pressure on: ${blockedGoals[0].title}`
      : `Strategic goals mostly ${goals.summary.onTrack ? "on track" : "needs attention"} (avg ${goals.summary.avgProgress}%).`,
    timeline:
      decisionType === "simulation"
        ? "Impact modeled over scenario horizon before any execution."
        : "Stage for Founder review; execute only after approval where required.",
    dependencies: [
      "Founder approval for high-impact actions",
      org.compliance.overdue > 0 ? "Clear overdue compliance first" : "Compliance window acceptable for staging",
      org.technology.deployAligned === false ? "Resolve deploy drift before production-dependent work" : "Deploy alignment OK or unknown",
    ],
    risks: [
      ...decision.risks.slice(0, 4),
      ...(topRisk ? [topRisk.title] : []),
      ...blockedGoals.slice(0, 2).map((g) => `Goal risk: ${g.title}`),
    ],
    expectedOutcomes: [
      scenario?.summary.recommendation || decision.recommendedAction,
      `Community impact index (modeled): ${scenario?.summary.communityImpact ?? "n/a"}`,
      scenarioLabel ? `Simulation family: ${scenarioLabel}` : "Live cross-module decision framing applied",
    ],
  };

  let recommendation = decision.recommendedAction;
  if (decisionType === "simulation") {
    recommendation = `Simulation (${scenarioLabel || "custom"}): base posture — ${scenario?.summary.recommendation}. Compare optimistic/conservative before deciding. Do not execute until Founder approves.`;
  } else if (decisionType === "biggest_risk") {
    recommendation = topRisk
      ? `Biggest risk today: ${topRisk.title}. ${topRisk.recommendedAction}`
      : "No high-priority predictive risk flagged from live reads — continue monitoring.";
  } else if (decisionType === "prioritize") {
    recommendation = [
      org.approvalsPending ? `Clear ${org.approvalsPending} Founder approval(s)` : null,
      topRisk?.recommendedAction,
      blockedGoals[0]?.recommendedActions[0],
      "Run weekly executive review for sequenced priorities",
    ]
      .filter(Boolean)
      .slice(0, 3)
      .join(" · ");
  }

  const executiveSummary = [
    `Enterprise Brain 3.0 decision (${decisionType.replace(/_/g, " ")}).`,
    `Confidence: ${confidence}.`,
    `Recommendation: ${truncate(recommendation, 220)}`,
    `Founder approval required before any major execution.`,
  ].join(" ");

  const pkg: ExecutiveDecisionPackage = {
    brainVersion: BRAIN_VERSION,
    question,
    generatedAt: new Date().toISOString(),
    decisionType,
    executiveSummary,
    analysis,
    recommendation,
    supportingEvidence: decision.supportingFacts.slice(0, 10),
    alternatives: decision.options.map((o) => ({ id: o.id, label: o.label, summary: o.summary })),
    confidence,
    founderApprovalRequired: true,
    founderMay: FOUNDER_MAY,
    founderMustApprove: FOUNDER_MUST_APPROVE,
    explainability: {
      systemsUsed: Array.from(new Set([...systemsUsed, ...decision.modulesUsed])),
      documentsReferenced: documentsReferenced.slice(0, 8),
      supportingData: decision.supportingFacts.slice(0, 8),
      confidence,
      missingInformation: Array.from(new Set([...missingInformation, ...decision.gaps, ...org.gaps])).slice(0, 8),
      assumptions,
      risks: analysis.risks.slice(0, 8),
    },
    scenarios,
    scenario,
    speechSummary: [
      `Enterprise Brain 3.0.`,
      executiveSummary,
      assumptions[0] ? `Assumption: ${assumptions[0]}` : "",
      scenarios?.length ? `${scenarios.length} simulation postures prepared.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    smsSummary: [
      `Brain3.0 ${decisionType}: ${confidence}`,
      truncate(recommendation, 100),
      "APPROVAL REQUIRED for major actions",
    ].join("\n"),
    rawDecisionSupport: decision,
    learningHints: learningHints.slice(0, 5),
  };

  await logHqAudit({
    action: "aura_executive_decision",
    entityType: "aura_edi",
    detail: question.slice(0, 240),
    metadata: {
      brainVersion: BRAIN_VERSION,
      decisionType,
      confidence,
      scenarioCount: scenarios?.length || 0,
    },
  }).catch(() => undefined);

  return pkg;
}

export async function buildOrganizationPerformanceScorecard(): Promise<OrganizationPerformanceScorecard> {
  const gaps: string[] = [];
  const [health, finance, grants, tech, compliance, executive, overview] = await Promise.all([
    withTimeout(import("./analyticsReporting").then((m) => m.buildOrganizationHealthScore()).catch(() => null), 6000, null),
    withTimeout(import("./financeReporting").then((m) => m.buildExecutiveDashboard()).catch(() => null), 6000, null),
    withTimeout(import("./grantReporting").then((m) => m.buildGrantExecutiveDashboard()).catch(() => null), 6000, null),
    withTimeout(import("./auraTechnicalCommandEngine").then((m) => m.buildTechnicalCommandBriefing()).catch(() => null), 8000, null),
    withTimeout(
      import("./auraExecutiveOps").then((m) => m.trackComplianceDeadlines()).catch(() => ({ overdue: 0, dueNext14Days: 0 })),
      5000,
      { overdue: 0, dueNext14Days: 0 }
    ),
    withTimeout(import("./auraExecutiveAssistant").then((m) => m.buildExecutiveHealthSummary()).catch(() => null), 6000, null),
    withTimeout(import("./analyticsReporting").then((m) => m.buildSafeAnalyticsOverview()).catch(() => null), 6000, null),
  ]);

  const financialHealth = finance?.financialHealthScore ?? null;
  if (financialHealth == null) gaps.push("Financial health score unavailable");

  const fundingReadiness =
    grants?.pipelineValue != null
      ? Math.min(100, Math.max(20, Math.round(40 + Math.log10(Math.max(grants.pipelineValue, 1)) * 10)))
      : null;
  if (fundingReadiness == null) gaps.push("Funding readiness unavailable");

  const grantPipelineHealth = grants?.winRate != null
    ? Math.round(Number(grants.winRate))
    : fundingReadiness;
  if (grants?.winRate == null) gaps.push("Grant win rate unavailable — pipeline proxy used when possible");

  const hrReadiness = overview?.people?.employees != null
    ? Math.min(100, 50 + Math.round((overview.people.employees / 40) * 50))
    : null;

  const technologyHealth = tech?.overallScore ?? null;
  const softwareReliability = technologyHealth;

  const operationalPerformance = overview?.organizationHealth?.overall ?? health?.overall ?? null;

  const overdue = (compliance as { overdue: number }).overdue;
  const complianceScore = Math.max(0, 100 - overdue * 15 - (compliance as { dueNext14Days: number }).dueNext14Days * 2);

  const communicationsScore = executive
    ? Math.max(50, 100 - (((executive as { pendingApprovals?: number }).pendingApprovals ?? 0) * 5))
    : null;
  if (communicationsScore == null) gaps.push("Communications score uses executive responsiveness proxy");

  const pending = (executive as { pendingApprovals?: number } | null)?.pendingApprovals ?? 0;
  const executiveResponsiveness = Math.max(40, 100 - pending * 8);

  const dimensions: ScorecardDimension[] = [
    { id: "financial_health", label: "Financial Health", score: financialHealth, grade: gradeFromScore(financialHealth), evidence: [`Score ${financialHealth ?? "n/a"}`, `Cash ${finance?.cashFlow ?? "n/a"}`] },
    { id: "funding_readiness", label: "Funding Readiness", score: fundingReadiness, grade: gradeFromScore(fundingReadiness), evidence: [`Pipeline ${grants?.pipelineValue ?? "n/a"}`] },
    { id: "grant_pipeline_health", label: "Grant Pipeline Health", score: grantPipelineHealth, grade: gradeFromScore(grantPipelineHealth), evidence: [`Win rate ${grants?.winRate ?? "n/a"}`, `Awards ${grants?.activeAwards ?? "n/a"}`] },
    { id: "hr_readiness", label: "HR Readiness", score: hrReadiness, grade: gradeFromScore(hrReadiness), evidence: [`Employees ${overview?.people?.employees ?? "n/a"}`] },
    { id: "technology_health", label: "Technology Health", score: technologyHealth, grade: gradeFromScore(technologyHealth), evidence: [`Tech ${technologyHealth ?? "n/a"}/100`, `Aligned ${tech?.deployAligned ?? "?"}`] },
    { id: "operational_performance", label: "Operational Performance", score: operationalPerformance, grade: gradeFromScore(operationalPerformance), evidence: [`Org health ${operationalPerformance ?? "n/a"}`] },
    { id: "compliance", label: "Compliance", score: complianceScore, grade: gradeFromScore(complianceScore), evidence: [`Overdue ${overdue}`, `Due 14d ${(compliance as { dueNext14Days: number }).dueNext14Days}`] },
    { id: "communications", label: "Communications", score: communicationsScore, grade: gradeFromScore(communicationsScore), evidence: ["Proxy from executive approval latency until Comms KPIs link"] },
    { id: "software_reliability", label: "Software Reliability", score: softwareReliability, grade: gradeFromScore(softwareReliability), evidence: [`Technical Command ${softwareReliability ?? "n/a"}`] },
    { id: "executive_responsiveness", label: "Executive Responsiveness", score: executiveResponsiveness, grade: gradeFromScore(executiveResponsiveness), evidence: [`Pending approvals ${pending}`] },
  ];

  const scored = dimensions.filter((d) => d.score != null) as Array<ScorecardDimension & { score: number }>;
  const enterpriseHealthScore = scored.length
    ? Math.round(scored.reduce((s, d) => s + d.score, 0) / scored.length)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    brainVersion: BRAIN_VERSION,
    enterpriseHealthScore,
    enterpriseGrade: gradeFromScore(enterpriseHealthScore),
    dimensions,
    gaps,
  };
}

export async function buildOpportunityIntelligence(): Promise<OpportunityItem[]> {
  const [org, grants, tech, goals, predictions] = await Promise.all([
    getOrgModel(),
    import("./grantIntelligenceEngine")
      .then((m) => m.buildOrgWideGrantMatches({ sort: "funding", limit: 5, actorEmail: "service@ifcdc.org" }))
      .catch(() => ({ matches: [] as Array<{ title?: string; amount?: number }> })),
    import("./auraTechnicalCommandEngine").then((m) => m.buildTechnicalCommandBriefing()).catch(() => null),
    listStrategicGoals(),
    getPredictions(),
  ]);

  const items: OpportunityItem[] = [];
  const matches = Array.isArray((grants as { matches?: unknown[] }).matches)
    ? (grants as { matches: Array<{ title?: string; amount?: number }> }).matches
    : [];

  for (const g of matches.slice(0, 3)) {
    items.push({
      id: crypto.randomUUID(),
      category: "funding",
      title: g.title || "New funding opportunity",
      whyItMatters: "High-ranked live match can advance multi-year funding goals if capacity and compliance allow.",
      expectedBenefit: g.amount != null ? `Potential award signal ~${g.amount}` : "Pipeline uplift if pursued and awarded",
      risks: ["Award not guaranteed", "Application effort may divert staff from delivery"],
      estimatedEffort: "high",
      strategicImpact: "high",
      evidence: [
        g.amount != null ? `Listed amount signal: ${g.amount}` : "Amount not listed on match card",
        `Current pipeline value: ${org.grants.pipelineValue ?? "unavailable"}`,
      ],
      recommendedNextStep: "Review fit in Grant Center; stage application for Founder approval before submit.",
      founderApprovalRequired: true,
      confidence: "medium",
    });
  }

  if (org.financial.budgetRemaining != null && org.financial.budgetRemaining > 0) {
    items.push({
      id: "cost-savings-review",
      category: "cost_savings",
      title: "Budget line efficiency review",
      whyItMatters: "Positive remaining budget creates room to reallocate toward higher-impact programs.",
      expectedBenefit: "Free capacity without new debt",
      risks: ["Misallocation without Founder review"],
      estimatedEffort: "medium",
      strategicImpact: "medium",
      evidence: [`Budget remaining signal: ${org.financial.budgetRemaining}`],
      recommendedNextStep: "Ask CFO path for underutilized lines and redirect options.",
      founderApprovalRequired: true,
      confidence: "medium",
    });
  }

  if (tech && tech.overallScore < 85) {
    items.push({
      id: "tech-improve",
      category: "technology",
      title: "Technology reliability improvements",
      whyItMatters: "Stronger production health protects Founder OTP, voice, and HQ decision latency.",
      expectedBenefit: "Higher Enterprise Health Score and fewer ops interruptions",
      risks: ["Deploy without approval"],
      estimatedEffort: "medium",
      strategicImpact: "high",
      evidence: [`Technical score ${tech.overallScore}/100`],
      recommendedNextStep: "Open Technical Command repair tickets; deploy only after Founder approval.",
      founderApprovalRequired: tech.deployAligned === false,
      confidence: "high",
    });
  }

  const blockedGoal = goals.goals.find((g) => g.status === "blocked" || g.status === "at_risk");
  if (blockedGoal) {
    items.push({
      id: `goal-${blockedGoal.id}`,
      category: "capacity",
      title: `Unblock: ${blockedGoal.title}`,
      whyItMatters: "Strategic goal slippage compounds multi-year risk.",
      expectedBenefit: `Restore progress on ${blockedGoal.department} goal`,
      risks: blockedGoal.risks.slice(0, 2),
      estimatedEffort: "medium",
      strategicImpact: "high",
      evidence: blockedGoal.blockers.slice(0, 3),
      recommendedNextStep: blockedGoal.recommendedActions[0] || "Review Strategic Goals Center with Founder.",
      founderApprovalRequired: true,
      confidence: "medium",
    });
  }

  items.push({
    id: "partnership-scan",
    category: "partnership",
    title: "Partnership / co-applicant scan",
    whyItMatters: "Partnerships can expand capacity without immediate full payroll load.",
    expectedBenefit: "Shared delivery capacity and stronger grant competitiveness",
    risks: ["Partner misalignment", "External communications require Founder approval"],
    estimatedEffort: "medium",
    strategicImpact: "medium",
    evidence: [`Employees: ${org.people.employees ?? "n/a"}`, `Pipeline: ${org.grants.pipelineValue ?? "n/a"}`],
    recommendedNextStep: "Identify 1–2 complementary partners (Founder approval before outreach).",
    founderApprovalRequired: true,
    confidence: "low",
  });

  if (org.approvalsPending >= 3) {
    items.push({
      id: "process-improve",
      category: "process",
      title: "Workflow / approval process improvement",
      whyItMatters: "Faster Founder decision loops reduce organizational idle time.",
      expectedBenefit: "Higher executive responsiveness score",
      risks: ["Process change without Founder buy-in"],
      estimatedEffort: "low",
      strategicImpact: "medium",
      evidence: [`Pending approvals: ${org.approvalsPending}`],
      recommendedNextStep: "Batch Founder approval queue by financial/compliance severity.",
      founderApprovalRequired: false,
      confidence: "medium",
    });
  }

  if (!items.length) {
    items.push({
      id: "baseline-monitor",
      category: "process",
      title: "Continue live monitoring",
      whyItMatters: "No high-confidence opportunity surfaced — monitoring prevents missed windows.",
      expectedBenefit: "Situational awareness",
      risks: ["False sense of stability"],
      estimatedEffort: "low",
      strategicImpact: "low",
      evidence: org.gaps.slice(0, 2),
      recommendedNextStep: "Run weekly executive review and enterprise funding scan.",
      founderApprovalRequired: false,
      confidence: "low",
    });
  }

  return items.slice(0, 10);
}

export async function buildWeeklyExecutiveReview(): Promise<WeeklyExecutiveReview> {
  const [org, scorecard, goals, opportunities, daily, predictions, grants] = await Promise.all([
    getOrgModel(),
    buildOrganizationPerformanceScorecard(),
    listStrategicGoals(),
    buildOpportunityIntelligence(),
    import("./auraEnterpriseBrain").then((m) => m.buildEnterpriseBrainDailyBriefing()).catch(() => null),
    getPredictions(),
    import("./grantReporting").then((m) => m.buildGrantExecutiveDashboard()).catch(() => null),
  ]);

  const accomplishments = [
    scorecard.enterpriseHealthScore != null
      ? `Enterprise Health Score ${scorecard.enterpriseHealthScore}/100 (${scorecard.enterpriseGrade})`
      : null,
    goals.summary.onTrack ? `${goals.summary.onTrack} strategic goal(s) on track` : null,
    org.grants.activeAwards != null ? `${org.grants.activeAwards} active award signal(s)` : null,
    org.technology.deployAligned === true ? "GitHub/Render deploy aligned" : null,
  ].filter(Boolean) as string[];

  const challenges = [
    ...predictions.slice(0, 3).map((p) => p.title),
    ...goals.goals.filter((g) => g.status === "blocked" || g.status === "at_risk").slice(0, 3).map((g) => g.title),
    ...org.gaps.slice(0, 2),
  ];

  const recommendedPriorities = [
    ...goals.goals.flatMap((g) => g.recommendedActions).slice(0, 3),
    ...opportunities.slice(0, 2).map((o) => o.recommendedNextStep),
    "Clear Founder approval queue for high-impact items",
  ].slice(0, 6);

  const periodLabel = `Week of ${new Date().toISOString().slice(0, 10)}`;
  const financialPosition = `Cash flow ${org.financial.cashFlow ?? "n/a"}; financial health ${org.financial.financialHealthScore ?? "n/a"}; budget remaining ${org.financial.budgetRemaining ?? "n/a"}.`;
  const fundingPipeline = `Pipeline ${org.grants.pipelineValue ?? "n/a"}; active awards ${org.grants.activeAwards ?? "n/a"}.`;
  const grantsWon = `Active awards signal: ${grants?.activeAwards ?? org.grants.activeAwards ?? "n/a"} (live dashboard).`;
  const grantsPending = `Pipeline / in-progress value: ${grants?.pipelineValue ?? org.grants.pipelineValue ?? "n/a"}. Win rate signal: ${grants?.winRate ?? "n/a"}.`;
  const hr = `Employees ${org.people.employees ?? "n/a"}; volunteers ${org.people.volunteers ?? "n/a"}.`;
  const operations = `Org health ${org.organizationHealth ?? "n/a"}; pending approvals ${org.approvalsPending}.`;
  const technology = `Tech ${org.technology.healthScore ?? "n/a"}/100; live ${org.technology.liveCommit || "unknown"}; aligned=${org.technology.deployAligned ?? "unknown"}.`;
  const compliance = `Overdue ${org.compliance.overdue}; due 14d ${org.compliance.dueNext14Days}.`;

  const executiveSummary = `Enterprise Brain 3.0 weekly review. Health ${scorecard.enterpriseHealthScore ?? "n/a"} (${scorecard.enterpriseGrade}). Top priority: ${recommendedPriorities[0] || "Review Founder queue"}.`;

  const content = [
    `# Weekly Executive Review — ${periodLabel}`,
    `Brain version: 3.0`,
    "",
    "## Executive Summary",
    executiveSummary,
    "",
    "## Accomplishments",
    ...accomplishments.map((a) => `- ${a}`),
    "",
    "## Challenges",
    ...(challenges.length ? challenges.map((c) => `- ${c}`) : ["- No critical challenges flagged"]),
    "",
    "## Funding Pipeline",
    fundingPipeline,
    "",
    "## Financial Position",
    financialPosition,
    "",
    "## Grants Won",
    grantsWon,
    "",
    "## Grants Pending",
    grantsPending,
    "",
    "## HR",
    hr,
    "",
    "## Operations",
    operations,
    "",
    "## Technology",
    technology,
    "",
    "## Compliance",
    compliance,
    "",
    "## Recommended Priorities",
    ...recommendedPriorities.map((r) => `- ${r}`),
    daily?.highlights?.length ? `\n## Daily Brain Highlights\n${daily.highlights.map((h: string) => `- ${h}`).join("\n")}` : "",
    "",
    "_Assumptions are not facts. Major actions require Founder approval._",
  ]
    .filter((x) => x !== "")
    .join("\n");

  return {
    generatedAt: new Date().toISOString(),
    brainVersion: BRAIN_VERSION,
    periodLabel,
    executiveSummary,
    accomplishments,
    challenges,
    fundingPipeline,
    financialPosition,
    grantsWon,
    grantsPending,
    hr,
    operations,
    technology,
    compliance,
    recommendedPriorities,
    speechSummary: `${executiveSummary} Founder approval required for major actions.`,
    content,
  };
}

export async function buildEnterpriseBrainDashboard(): Promise<EnterpriseBrainDashboard> {
  const [org, scorecard, goals, opportunities, predictions] = await Promise.all([
    getOrgModel(),
    buildOrganizationPerformanceScorecard(),
    listStrategicGoals(),
    buildOpportunityIntelligence(),
    getPredictions(),
  ]);

  const executiveAlerts: ExecutiveAlert[] = [];
  if (org.compliance.overdue > 0) {
    executiveAlerts.push({
      id: "compliance-overdue",
      severity: "critical",
      title: "Compliance overdue",
      detail: `${org.compliance.overdue} item(s) overdue`,
      requiresFounderAttention: true,
    });
  }
  if (org.technology.deployAligned === false) {
    executiveAlerts.push({
      id: "deploy-drift",
      severity: "high",
      title: "Production deploy drift",
      detail: `Live ${org.technology.liveCommit || "unknown"} not aligned with GitHub main`,
      requiresFounderAttention: true,
    });
  }
  if (org.approvalsPending >= 3) {
    executiveAlerts.push({
      id: "approval-backlog",
      severity: "medium",
      title: "Founder approval backlog",
      detail: `${org.approvalsPending} pending approvals`,
      requiresFounderAttention: true,
    });
  }
  for (const p of predictions.slice(0, 3)) {
    executiveAlerts.push({
      id: p.id,
      severity: p.confidence === "high" ? "high" : "medium",
      title: p.title,
      detail: p.whyItMatters,
      requiresFounderAttention: p.founderApprovalRequired,
    });
  }

  const founderPriorities = [
    org.approvalsPending ? `Clear ${org.approvalsPending} pending Founder approval(s)` : "No approval backlog flagged",
    predictions[0] ? `Address risk: ${predictions[0].title}` : "No critical predictive risk",
    goals.goals.find((g) => g.status === "blocked")?.title
      ? `Unblock goal: ${goals.goals.find((g) => g.status === "blocked")!.title}`
      : `Advance goals (avg progress ${goals.summary.avgProgress}%)`,
  ];

  const auraRecommendations = Array.from(
    new Set(
      [
        ...opportunities.slice(0, 3).map((o) => o.recommendedNextStep),
        ...goals.goals.flatMap((g) => g.recommendedActions).slice(0, 2),
        predictions[0]?.recommendedAction,
      ].filter(Boolean) as string[]
    )
  ).slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    brainVersion: BRAIN_VERSION,
    organizationHealth: org.organizationHealth,
    healthGrade: org.healthGrade,
    enterpriseHealthScore: scorecard.enterpriseHealthScore,
    enterpriseGrade: scorecard.enterpriseGrade,
    strategicGoals: goals.goals,
    goalsSummary: goals.summary,
    fundingPipeline: {
      pipelineValue: org.grants.pipelineValue,
      activeAwards: org.grants.activeAwards,
    },
    financialPosition: {
      cashFlow: org.financial.cashFlow,
      financialHealthScore: org.financial.financialHealthScore,
      budgetRemaining: org.financial.budgetRemaining,
    },
    activeRisks: predictions,
    opportunities,
    founderPriorities,
    executiveAlerts,
    auraRecommendations,
    orgModel: org,
    scorecard,
  };
}

export async function runExecutiveDecisionIntelligence(opts: {
  request: string;
  channel: "voice" | "sms" | "hq_web";
  founderMode: boolean;
}): Promise<{
  kind: "decision" | "weekly" | "dashboard" | "goals" | "scorecard" | "opportunities" | "simulation";
  brainVersion: typeof BRAIN_VERSION;
  speechSummary: string;
  smsSummary: string;
  unifiedBriefing: string;
  founderApprovalRequired: boolean;
  payload: unknown;
}> {
  if (!opts.founderMode) {
    return {
      kind: "decision",
      brainVersion: BRAIN_VERSION,
      speechSummary: "Enterprise Brain 3.0 requires Founder Mode.",
      smsSummary: "Founder Mode required.",
      unifiedBriefing: "Verify founder first.",
      founderApprovalRequired: true,
      payload: null,
    };
  }

  const q = opts.request.trim();

  if (/\bweekly (executive )?review\b/i.test(q)) {
    const weekly = await buildWeeklyExecutiveReview();
    return {
      kind: "weekly",
      brainVersion: BRAIN_VERSION,
      speechSummary: weekly.speechSummary,
      smsSummary: truncate(weekly.recommendedPriorities.join(" · "), 300),
      unifiedBriefing: weekly.content,
      founderApprovalRequired: true,
      payload: weekly,
    };
  }

  if (/\b(enterprise (brain )?dashboard|decision intelligence dashboard)\b/i.test(q)) {
    const dash = await buildEnterpriseBrainDashboard();
    return {
      kind: "dashboard",
      brainVersion: BRAIN_VERSION,
      speechSummary: `Enterprise Brain 3.0 Dashboard. Health ${dash.enterpriseHealthScore ?? "n/a"} (${dash.enterpriseGrade}). ${dash.founderPriorities[0]}.`,
      smsSummary: `Brain3.0: ${dash.enterpriseHealthScore ?? "?"}/100`,
      unifiedBriefing: [
        `# Enterprise Brain 3.0 Dashboard`,
        `Enterprise Health: ${dash.enterpriseHealthScore ?? "n/a"} (${dash.enterpriseGrade})`,
        `Alerts: ${dash.executiveAlerts.map((a) => a.title).join("; ") || "none"}`,
        `Goals avg: ${dash.goalsSummary.avgProgress}%`,
        `Priorities: ${dash.founderPriorities.join("; ")}`,
        `Recommendations: ${dash.auraRecommendations.join("; ")}`,
      ].join("\n"),
      founderApprovalRequired: false,
      payload: dash,
    };
  }

  if (/\bstrategic goals?\b/i.test(q)) {
    const goals = await listStrategicGoals();
    return {
      kind: "goals",
      brainVersion: BRAIN_VERSION,
      speechSummary: `Strategic Goals Center. Average progress ${goals.summary.avgProgress}%. ${goals.summary.blocked} blocked, ${goals.summary.atRisk} at risk across ${goals.goals.length} goals.`,
      smsSummary: `Goals: ${goals.summary.avgProgress}% avg · ${goals.goals.length} tracked`,
      unifiedBriefing: goals.goals
        .map((g) => `- [${g.category}] ${g.title}: ${g.progressPercent}% (${g.status}) · ${g.department}`)
        .join("\n"),
      founderApprovalRequired: false,
      payload: goals,
    };
  }

  if (/\bscorecard|enterprise health score\b/i.test(q)) {
    const scorecard = await buildOrganizationPerformanceScorecard();
    return {
      kind: "scorecard",
      brainVersion: BRAIN_VERSION,
      speechSummary: `IFCDC Enterprise Health Score ${scorecard.enterpriseHealthScore ?? "unavailable"} (${scorecard.enterpriseGrade}).`,
      smsSummary: `Health ${scorecard.enterpriseHealthScore ?? "?"}/100`,
      unifiedBriefing: scorecard.dimensions
        .map((d) => `- ${d.label}: ${d.score ?? "n/a"} (${d.grade})`)
        .join("\n"),
      founderApprovalRequired: false,
      payload: scorecard,
    };
  }

  if (/\bopportunit/i.test(q) && !/\bshould we\b/i.test(q)) {
    const opportunities = await buildOpportunityIntelligence();
    return {
      kind: "opportunities",
      brainVersion: BRAIN_VERSION,
      speechSummary: `Opportunity Intelligence found ${opportunities.length} items. Top: ${opportunities[0]?.title}.`,
      smsSummary: opportunities.slice(0, 3).map((o) => o.title).join("\n"),
      unifiedBriefing: opportunities
        .map(
          (o) =>
            `## ${o.title}\nWhy: ${o.whyItMatters}\nBenefit: ${o.expectedBenefit}\nEffort: ${o.estimatedEffort} · Impact: ${o.strategicImpact}\nNext: ${o.recommendedNextStep}`
        )
        .join("\n\n"),
      founderApprovalRequired: opportunities.some((o) => o.founderApprovalRequired),
      payload: { opportunities },
    };
  }

  const decision = await runExecutiveDecisionEngine(q);
  const scenarioBlock = decision.scenarios?.length
    ? [
        "",
        "## Simulation postures (not a single prediction)",
        ...decision.scenarios.map(
          (s) =>
            `- **${s.posture}**: cash Δ ${s.result.summary.cashFlowImpact}; health Δ ${s.result.summary.healthImpact}; risk ${s.result.summary.riskLevel} — ${s.result.summary.recommendation}`
        ),
      ]
    : [];

  return {
    kind: decision.decisionType === "simulation" ? "simulation" : "decision",
    brainVersion: BRAIN_VERSION,
    speechSummary: decision.speechSummary,
    smsSummary: decision.smsSummary,
    unifiedBriefing: [
      `# Enterprise Brain 3.0 — Executive Decision`,
      decision.executiveSummary,
      "",
      "## Recommendation",
      decision.recommendation,
      `Confidence: ${decision.confidence}`,
      `Founder approval: REQUIRED for major actions`,
      "",
      "## Analysis",
      `- Financial: ${decision.analysis.financialImpact}`,
      `- Budget: ${decision.analysis.budgetAvailability}`,
      `- Staffing: ${decision.analysis.staffingCapacity}`,
      `- Grants: ${decision.analysis.grantEligibility}`,
      `- Readiness: ${decision.analysis.organizationalReadiness}`,
      `- Compliance: ${decision.analysis.complianceObligations}`,
      `- Technology: ${decision.analysis.technologyReadiness}`,
      `- Operations: ${decision.analysis.operationalWorkload}`,
      `- Strategic: ${decision.analysis.strategicAlignment}`,
      `- Timeline: ${decision.analysis.timeline}`,
      "",
      "## Evidence",
      ...decision.supportingEvidence.map((e) => `- ${e}`),
      "",
      "## Alternatives",
      ...decision.alternatives.map((a) => `- ${a.label}: ${a.summary}`),
      ...scenarioBlock,
      "",
      "## Explainability",
      `- Systems: ${decision.explainability.systemsUsed.join(", ")}`,
      `- Documents: ${decision.explainability.documentsReferenced.join("; ") || "none indexed for this query"}`,
      `- Assumptions (not facts):`,
      ...decision.explainability.assumptions.map((a) => `  - ${a}`),
      `- Missing:`,
      ...(decision.explainability.missingInformation.length
        ? decision.explainability.missingInformation.map((m) => `  - ${m}`)
        : ["  - None flagged"]),
      "",
      "## Founder control",
      `AURA may: ${decision.founderMay.join(", ")}.`,
      `AURA may NOT without approval: ${decision.founderMustApprove.join(", ")}.`,
    ].join("\n"),
    founderApprovalRequired: decision.founderApprovalRequired,
    payload: decision,
  };
}

let ediTablesReady = false;
export async function ensureExecutiveDecisionIntelligenceTables(): Promise<void> {
  if (ediTablesReady) return;
  const { ensureStrategicGoalsTables } = await import("./strategicGoalsEngine");
  await ensureStrategicGoalsTables();
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_edi_runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      request TEXT,
      founder_approval_required INTEGER DEFAULT 1,
      result_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  ediTablesReady = true;
}
