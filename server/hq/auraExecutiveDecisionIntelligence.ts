/**
 * AURA Enterprise Brain Phase 3 — Executive Decision Intelligence.
 *
 * Evidence-based recommendations, scorecard, opportunities, simulations,
 * weekly review, and a single dashboard package. Major actions require Founder approval.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import { runScenarioAnalysis, type ScenarioInput, type ScenarioResult } from "./scenarioModeling";
import { answerDecisionSupportQuestion, type DecisionSupportResult } from "./auraDecisionSupport";
import { listStrategicGoals, type StrategicGoal } from "./strategicGoalsEngine";
import type { DigitalOrganizationModel, PredictiveSignal } from "./auraEnterpriseBrain";

async function getOrgModel(): Promise<DigitalOrganizationModel> {
  const { buildDigitalOrganizationModel } = await import("./auraEnterpriseBrain");
  return buildDigitalOrganizationModel();
}

async function getPredictions(model?: DigitalOrganizationModel): Promise<PredictiveSignal[]> {
  const { buildPredictiveIntelligenceSignals } = await import("./auraEnterpriseBrain");
  return buildPredictiveIntelligenceSignals(model);
}

export type DecisionConfidence = "high" | "medium" | "low";

export type ExecutiveDecisionPackage = {
  question: string;
  generatedAt: string;
  decisionType: "grant_apply" | "hire" | "afford_project" | "expand_program" | "simulation" | "general";
  analysis: {
    budgetImpact: string;
    staffingImpact: string;
    grantRequirements: string;
    organizationalCapacity: string;
    compliance: string;
    risks: string[];
    timeline: string;
    expectedOutcomes: string[];
  };
  recommendation: string;
  supportingEvidence: string[];
  alternatives: Array<{ id: string; label: string; summary: string }>;
  confidence: DecisionConfidence;
  founderApprovalRequired: boolean;
  assumptions: string[];
  missingInformation: string[];
  systemsUsed: string[];
  scenario?: ScenarioResult;
  speechSummary: string;
  smsSummary: string;
  rawDecisionSupport?: DecisionSupportResult;
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
  enterpriseHealthScore: number | null;
  enterpriseGrade: string;
  dimensions: ScorecardDimension[];
  gaps: string[];
};

export type OpportunityItem = {
  id: string;
  category: "funding" | "partnership" | "cost_savings" | "program_expansion" | "technology" | "process";
  title: string;
  whyItMatters: string;
  evidence: string[];
  recommendedNextStep: string;
  founderApprovalRequired: boolean;
  confidence: DecisionConfidence;
};

export type WeeklyExecutiveReview = {
  generatedAt: string;
  periodLabel: string;
  accomplishments: string[];
  challenges: string[];
  financialSummary: string;
  grantPipeline: string;
  softwareStatus: string;
  hrUpdates: string;
  recommendationsNextWeek: string[];
  speechSummary: string;
  content: string;
};

export type EnterpriseBrainDashboard = {
  generatedAt: string;
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

export function wantsExecutiveDecisionIntelligence(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /\b(should we (apply|hire|expand|launch)|can we afford|what happens if|what if we)\b/i.test(m)
    || /\bexecutive decision|decision intelligence|scorecard|strategic goals? center\b/i.test(m)
    || /\bweekly (executive )?review\b/i.test(m)
    || /\b(opportunity intelligence|opportunities for (ifcdc|the organization))\b/i.test(m)
    || /\benterprise (brain )?dashboard\b/i.test(m)
    || /\bsimulat(e|ion)\b/i.test(m)
  );
}

export function classifyDecisionType(question: string): ExecutiveDecisionPackage["decisionType"] {
  if (/\bwhat (happens|if)|simulat/i.test(question)) return "simulation";
  if (/\b(apply|submit).{0,40}grant|should we apply\b/i.test(question)) return "grant_apply";
  if (/\bhire|staffing|fte|employees?\b/i.test(question)) return "hire";
  if (/\bafford|project cost|can we fund\b/i.test(question)) return "afford_project";
  if (/\bexpand (this |the )?program|launch .{0,30}program\b/i.test(question)) return "expand_program";
  return "general";
}

/** Parse Founder "what if" language into scenario inputs — labeled assumptions when ambiguous. */
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
      input.budgetChangePercent = (input.budgetChangePercent || 0) + Math.min(15, n * 2);
      label = label.startsWith("Custom") ? `Hire ${n} employees` : `${label} + hire ${n}`;
      assumptions.push(`Average fully loaded cost not itemized — headcount +${n} uses scenario staffing model.`);
    }
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

function confidenceFromGaps(gaps: string[], risk: string): DecisionConfidence {
  if (gaps.length >= 3 || risk === "high") return "low";
  if (gaps.length >= 1 || risk === "medium") return "medium";
  return "high";
}

export async function runExecutiveDecisionEngine(question: string): Promise<ExecutiveDecisionPackage> {
  const decisionType = classifyDecisionType(question);
  const systemsUsed = ["executive_decision_engine", "scenario_modeling", "decision_support", "org_model"];
  const assumptions: string[] = [];
  const missingInformation: string[] = [];

  let scenario: ScenarioResult | undefined;
  let scenarioLabel = "";

  if (decisionType === "simulation" || /\bwhat (happens|if)\b/i.test(question)) {
    const parsed = parseWhatIfScenario(question);
    assumptions.push(...parsed.assumptions);
    scenarioLabel = parsed.label;
    scenario = await runScenarioAnalysis(parsed.input);
    systemsUsed.push("what_if_parser");
  } else if (decisionType === "hire") {
    const countMatch = question.match(/\b(\d+|one|two|three|four|five)\b/i);
    const wordMap: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const raw = countMatch?.[1]?.toLowerCase() || "2";
    const n = (wordMap[raw] ?? parseInt(raw, 10)) || 2;
    scenario = await runScenarioAnalysis({ headcountChange: n, budgetChangePercent: 5, horizonMonths: 12 });
    assumptions.push(`Modeled +${n} FTE with modest budget uplift; payroll rates not line-itemed.`);
  } else if (decisionType === "grant_apply") {
    scenario = await runScenarioAnalysis({ grantWinRateAdjust: 10, budgetChangePercent: 3, horizonMonths: 12 });
    assumptions.push("Grant application modeled as modest pipeline conversion uplift — specific NOFO terms may differ.");
  } else if (decisionType === "expand_program") {
    scenario = await runScenarioAnalysis({
      programEnrollmentChange: 15,
      headcountChange: 2,
      budgetChangePercent: 8,
      horizonMonths: 12,
    });
    assumptions.push("Program expansion assumes +15% enrollment and +2 FTE unless Founder specifies otherwise.");
  } else if (decisionType === "afford_project") {
    scenario = await runScenarioAnalysis({ budgetChangePercent: -5, horizonMonths: 6 });
    assumptions.push("Project affordability uses a conservative -5% budget stress test when cost is unspecified.");
    missingInformation.push("Exact project cost not provided in the question");
  } else {
    scenario = await runScenarioAnalysis({ horizonMonths: 6 });
  }

  const [decision, org, compliance] = await Promise.all([
    answerDecisionSupportQuestion(question),
    getOrgModel(),
    import("./auraExecutiveOps").then((m) => m.trackComplianceDeadlines()).catch(() => ({
      overdue: 0,
      dueNext14Days: 0,
    })),
  ]);

  const riskLevel = scenario.summary.riskLevel;
  const confidence = confidenceFromGaps(
    [...decision.gaps, ...org.gaps, ...missingInformation],
    riskLevel
  );

  const analysis = {
    budgetImpact: `Scenario cash-flow impact: ${scenario.summary.cashFlowImpact}. Financial health signal: ${org.financial.financialHealthScore ?? "unavailable"}.`,
    staffingImpact: `Staffing gap signal: ${scenario.summary.staffingGap}. Employees in model: ${org.people.employees ?? "unavailable"}.`,
    grantRequirements:
      decisionType === "grant_apply"
        ? "Confirm eligibility, match, compliance capacity, and submission deadline in Grant Center before applying."
        : `Pipeline value: ${org.grants.pipelineValue ?? "unavailable"}; active awards: ${org.grants.activeAwards ?? "unavailable"}.`,
    organizationalCapacity: `Org health ${org.organizationHealth ?? "n/a"} (${org.healthGrade ?? "—"}); tech score ${org.technology.healthScore ?? "n/a"}/100.`,
    compliance: `Overdue: ${(compliance as { overdue: number }).overdue}; due in 14 days: ${(compliance as { dueNext14Days: number }).dueNext14Days}.`,
    risks: decision.risks.slice(0, 6),
    timeline: decisionType === "simulation" ? "Impact modeled over scenario horizon before any execution." : "Stage decision for Founder review; execute only after approval where required.",
    expectedOutcomes: [
      scenario.summary.recommendation,
      `Community impact index (modeled): ${scenario.summary.communityImpact}`,
      scenarioLabel ? `Simulation: ${scenarioLabel}` : "Live cross-module decision framing applied",
    ],
  };

  const alternatives = decision.options.map((o) => ({
    id: o.id,
    label: o.label,
    summary: o.summary,
  }));

  const recommendation =
    decisionType === "simulation"
      ? `Simulation (${scenarioLabel || "custom"}): ${scenario.summary.recommendation} Do not execute until Founder approves any resulting actions.`
      : decision.recommendedAction;

  const founderApprovalRequired =
    true; // Phase 3 policy: major organizational decisions always gate through Founder for act paths

  const pkg: ExecutiveDecisionPackage = {
    question,
    generatedAt: new Date().toISOString(),
    decisionType,
    analysis,
    recommendation,
    supportingEvidence: decision.supportingFacts.slice(0, 8),
    alternatives,
    confidence,
    founderApprovalRequired,
    assumptions,
    missingInformation: [...missingInformation, ...decision.gaps].slice(0, 8),
    systemsUsed: Array.from(new Set([...systemsUsed, ...decision.modulesUsed])),
    scenario,
    speechSummary: [
      `Executive Decision Intelligence.`,
      `Type: ${decisionType.replace(/_/g, " ")}.`,
      `Recommendation: ${truncate(recommendation, 200)}`,
      `Confidence: ${confidence}.`,
      `Founder approval required before major execution.`,
      assumptions[0] ? `Assumption: ${assumptions[0]}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    smsSummary: [
      `EDI ${decisionType}: ${confidence}`,
      truncate(recommendation, 100),
      "APPROVAL REQUIRED for major actions",
    ].join("\n"),
    rawDecisionSupport: decision,
  };

  await logHqAudit({
    action: "aura_executive_decision",
    entityType: "aura_edi",
    detail: question.slice(0, 240),
    metadata: {
      decisionType,
      confidence,
      founderApprovalRequired,
      riskLevel,
    },
  }).catch(() => undefined);

  return pkg;
}

export async function buildOrganizationPerformanceScorecard(): Promise<OrganizationPerformanceScorecard> {
  const gaps: string[] = [];
  const [
    health,
    finance,
    grants,
    tech,
    compliance,
    executive,
    overview,
  ] = await Promise.all([
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

  const grantSuccess = grants?.winRate != null
    ? Math.round(Number(grants.winRate))
    : grants?.pipelineValue
      ? Math.min(85, 40 + Math.round(Math.log10(Math.max(grants.pipelineValue, 1)) * 8))
      : null;
  if (grantSuccess == null) gaps.push("Grant success rate unavailable — using pipeline proxy when possible");

  const financialHealth = finance?.financialHealthScore ?? null;
  if (financialHealth == null) gaps.push("Financial health score unavailable");

  const opsEfficiency = overview?.organizationHealth?.overall
    ?? health?.overall
    ?? null;
  if (opsEfficiency == null) gaps.push("Operational efficiency signal unavailable");

  const softwareReliability = tech?.overallScore ?? null;
  if (softwareReliability == null) gaps.push("Software reliability (Technical Command) unavailable");

  const overdue = (compliance as { overdue: number }).overdue;
  const complianceScore = Math.max(0, 100 - overdue * 15 - (compliance as { dueNext14Days: number }).dueNext14Days * 2);

  const hrReadiness = overview?.people?.employees != null
    ? Math.min(100, 50 + Math.round((overview.people.employees / 40) * 50))
    : null;
  if (hrReadiness == null) gaps.push("HR readiness (headcount) unavailable");

  const pending = (executive as { pendingApprovals?: number } | null)?.pendingApprovals ?? 0;
  const executiveResponsiveness = Math.max(40, 100 - pending * 8);

  const dimensions: ScorecardDimension[] = [
    {
      id: "grant_success",
      label: "Grant success",
      score: grantSuccess,
      grade: gradeFromScore(grantSuccess),
      evidence: [
        grants?.winRate != null ? `Win rate: ${grants.winRate}` : "Win rate not in dashboard",
        `Pipeline value: ${grants?.pipelineValue ?? "n/a"}`,
        `Active awards: ${grants?.activeAwards ?? "n/a"}`,
      ],
    },
    {
      id: "financial_health",
      label: "Financial health",
      score: financialHealth,
      grade: gradeFromScore(financialHealth),
      evidence: [
        `Financial health score: ${financialHealth ?? "n/a"}`,
        `Cash flow: ${finance?.cashFlow ?? "n/a"}`,
        `Budget remaining: ${finance?.budgetRemaining ?? "n/a"}`,
      ],
    },
    {
      id: "operational_efficiency",
      label: "Operational efficiency",
      score: opsEfficiency,
      grade: gradeFromScore(opsEfficiency),
      evidence: [`Organization health overall: ${opsEfficiency ?? "n/a"}`],
    },
    {
      id: "software_reliability",
      label: "Software reliability",
      score: softwareReliability,
      grade: gradeFromScore(softwareReliability),
      evidence: [
        `Technical score: ${softwareReliability ?? "n/a"}/100 (${tech?.overallLabel ?? "—"})`,
        `Deploy aligned: ${tech?.deployAligned == null ? "unknown" : tech.deployAligned ? "yes" : "no"}`,
      ],
    },
    {
      id: "compliance",
      label: "Compliance",
      score: complianceScore,
      grade: gradeFromScore(complianceScore),
      evidence: [
        `Overdue: ${overdue}`,
        `Due in 14 days: ${(compliance as { dueNext14Days: number }).dueNext14Days}`,
      ],
    },
    {
      id: "hr_readiness",
      label: "HR readiness",
      score: hrReadiness,
      grade: gradeFromScore(hrReadiness),
      evidence: [
        `Employees: ${overview?.people?.employees ?? "n/a"}`,
        `Volunteers: ${overview?.people?.volunteers ?? "n/a"}`,
      ],
    },
    {
      id: "executive_responsiveness",
      label: "Executive responsiveness",
      score: executiveResponsiveness,
      grade: gradeFromScore(executiveResponsiveness),
      evidence: [`Pending Founder approvals: ${pending}`],
    },
  ];

  const scored = dimensions.filter((d) => d.score != null) as Array<ScorecardDimension & { score: number }>;
  const enterpriseHealthScore = scored.length
    ? Math.round(scored.reduce((s, d) => s + d.score, 0) / scored.length)
    : null;

  return {
    generatedAt: new Date().toISOString(),
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
      whyItMatters: "High-ranked live match can advance funding goals if capacity and compliance allow.",
      evidence: [
        g.amount != null ? `Listed amount signal: ${g.amount}` : "Amount not listed on match card",
        `Current pipeline value: ${org.grants.pipelineValue ?? "unavailable"}`,
      ],
      recommendedNextStep: "Review fit in Grant Center; stage application for Founder approval before submit.",
      founderApprovalRequired: true,
      confidence: "medium",
    });
  }

  if (org.financial.budgetRemaining != null && org.financial.budgetRemaining > 0 && predictions.every((p) => p.category !== "budget")) {
    items.push({
      id: "cost-savings-review",
      category: "cost_savings",
      title: "Budget line efficiency review",
      whyItMatters: "Positive remaining budget creates room to reallocate toward higher-impact programs without new debt.",
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
      evidence: [`Technical score ${tech.overallScore}/100`, ...(tech.critical || []).slice(0, 2).map((c) => c.title)],
      recommendedNextStep: "Open Technical Command repair tickets; deploy only after Founder approval.",
      founderApprovalRequired: tech.deployAligned === false,
      confidence: "high",
    });
  }

  const blockedGoal = goals.goals.find((g) => g.status === "blocked" || g.status === "at_risk");
  if (blockedGoal) {
    items.push({
      id: `goal-${blockedGoal.id}`,
      category: blockedGoal.category === "program" ? "program_expansion" : "process",
      title: `Unblock: ${blockedGoal.title}`,
      whyItMatters: "Strategic goal slippage compounds multi-year risk.",
      evidence: blockedGoal.blockers.slice(0, 3),
      recommendedNextStep: blockedGoal.recommendedActions[0] || "Review Strategic Goals Center with Founder.",
      founderApprovalRequired: true,
      confidence: "medium",
    });
  }

  if (org.people.employees != null && (org.grants.pipelineValue ?? 0) > 0) {
    items.push({
      id: "partnership-scan",
      category: "partnership",
      title: "Partnership / co-applicant scan",
      whyItMatters: "Partnerships can expand capacity without immediate full payroll load.",
      evidence: [
        `Employees: ${org.people.employees}`,
        `Pipeline: ${org.grants.pipelineValue}`,
      ],
      recommendedNextStep: "Identify 1–2 complementary partners for priority grant applications (Founder approval before outreach).",
      founderApprovalRequired: true,
      confidence: "low",
    });
  }

  if (!items.length) {
    items.push({
      id: "baseline-monitor",
      category: "process",
      title: "Continue live monitoring",
      whyItMatters: "No high-confidence opportunity surfaced from current live reads — monitoring prevents missed windows.",
      evidence: org.gaps.slice(0, 2),
      recommendedNextStep: "Run weekly executive review and enterprise funding scan.",
      founderApprovalRequired: false,
      confidence: "low",
    });
  }

  return items.slice(0, 8);
}

export async function buildWeeklyExecutiveReview(): Promise<WeeklyExecutiveReview> {
  const [org, scorecard, goals, opportunities, daily, predictions] = await Promise.all([
    getOrgModel(),
    buildOrganizationPerformanceScorecard(),
    listStrategicGoals(),
    buildOpportunityIntelligence(),
    import("./auraEnterpriseBrain").then((m) => m.buildEnterpriseBrainDailyBriefing()).catch(() => null),
    getPredictions(),
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
    ...goals.goals.filter((g) => g.status === "blocked" || g.status === "at_risk").slice(0, 2).map((g) => g.title),
    ...org.gaps.slice(0, 2),
  ];

  const recommendationsNextWeek = [
    ...goals.goals.flatMap((g) => g.recommendedActions).slice(0, 3),
    ...opportunities.slice(0, 2).map((o) => o.recommendedNextStep),
    "Clear Founder approval queue for high-impact items",
  ].slice(0, 6);

  const periodLabel = `Week of ${new Date().toISOString().slice(0, 10)}`;
  const financialSummary = `Cash flow ${org.financial.cashFlow ?? "n/a"}; financial health ${org.financial.financialHealthScore ?? "n/a"}; budget remaining ${org.financial.budgetRemaining ?? "n/a"}.`;
  const grantPipeline = `Pipeline ${org.grants.pipelineValue ?? "n/a"}; active awards ${org.grants.activeAwards ?? "n/a"}.`;
  const softwareStatus = `Tech ${org.technology.healthScore ?? "n/a"}/100 (${org.technology.healthLabel ?? "—"}); live ${org.technology.liveCommit || "unknown"}; aligned=${org.technology.deployAligned ?? "unknown"}.`;
  const hrUpdates = `Employees ${org.people.employees ?? "n/a"}; volunteers ${org.people.volunteers ?? "n/a"}; pending approvals ${org.approvalsPending}.`;

  const content = [
    `# Weekly Executive Review — ${periodLabel}`,
    "",
    "## Accomplishments",
    ...accomplishments.map((a) => `- ${a}`),
    "",
    "## Challenges",
    ...(challenges.length ? challenges.map((c) => `- ${c}`) : ["- No critical challenges flagged from live reads"]),
    "",
    "## Financial Summary",
    financialSummary,
    "",
    "## Grant Pipeline",
    grantPipeline,
    "",
    "## Software Status",
    softwareStatus,
    "",
    "## HR Updates",
    hrUpdates,
    "",
    "## Recommendations for Next Week",
    ...recommendationsNextWeek.map((r) => `- ${r}`),
    "",
    daily?.highlights?.length ? `## Daily Brain Highlights\n${daily.highlights.map((h: string) => `- ${h}`).join("\n")}` : "",
    "",
    "_Assumptions are not presented as facts. Major actions require Founder approval._",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    generatedAt: new Date().toISOString(),
    periodLabel,
    accomplishments,
    challenges,
    financialSummary,
    grantPipeline,
    softwareStatus,
    hrUpdates,
    recommendationsNextWeek,
    speechSummary: `Weekly executive review. Enterprise health ${scorecard.enterpriseHealthScore ?? "n/a"}. Top recommendation: ${recommendationsNextWeek[0] || "Review Founder priorities"}. Founder approval required for major actions.`,
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

  const founderPriorities = [
    org.approvalsPending ? `Clear ${org.approvalsPending} pending Founder approval(s)` : "No approval backlog flagged",
    predictions[0] ? `Address risk: ${predictions[0].title}` : "No critical predictive risk",
    goals.goals.find((g) => g.status === "blocked")?.title
      ? `Unblock goal: ${goals.goals.find((g) => g.status === "blocked")!.title}`
      : `Advance goals (avg progress ${goals.summary.avgProgress}%)`,
  ];

  const auraRecommendations = [
    ...opportunities.slice(0, 3).map((o) => o.recommendedNextStep),
    ...goals.goals.flatMap((g) => g.recommendedActions).slice(0, 2),
    predictions[0]?.recommendedAction,
  ].filter(Boolean) as string[];

  return {
    generatedAt: new Date().toISOString(),
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
    auraRecommendations: Array.from(new Set(auraRecommendations)).slice(0, 8),
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
  speechSummary: string;
  smsSummary: string;
  unifiedBriefing: string;
  founderApprovalRequired: boolean;
  payload: unknown;
}> {
  if (!opts.founderMode) {
    return {
      kind: "decision",
      speechSummary: "Executive Decision Intelligence requires Founder Mode.",
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
      speechSummary: weekly.speechSummary,
      smsSummary: truncate(weekly.recommendationsNextWeek.join(" · "), 300),
      unifiedBriefing: weekly.content,
      founderApprovalRequired: true,
      payload: weekly,
    };
  }

  if (/\b(enterprise (brain )?dashboard|decision intelligence dashboard)\b/i.test(q)) {
    const dash = await buildEnterpriseBrainDashboard();
    return {
      kind: "dashboard",
      speechSummary: `Enterprise Brain Dashboard. Health ${dash.enterpriseHealthScore ?? "n/a"} (${dash.enterpriseGrade}). ${dash.founderPriorities[0]}.`,
      smsSummary: `EDI dash: ${dash.enterpriseHealthScore ?? "?"}/100`,
      unifiedBriefing: [
        `# Enterprise Brain Dashboard`,
        `Enterprise Health: ${dash.enterpriseHealthScore ?? "n/a"} (${dash.enterpriseGrade})`,
        `Org Health: ${dash.organizationHealth ?? "n/a"}`,
        `Goals avg progress: ${dash.goalsSummary.avgProgress}%`,
        `Pipeline: ${dash.fundingPipeline.pipelineValue ?? "n/a"}`,
        `Risks: ${dash.activeRisks.map((r) => r.title).join("; ") || "none flagged"}`,
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
      speechSummary: `Strategic Goals Center. Average progress ${goals.summary.avgProgress}%. ${goals.summary.blocked} blocked, ${goals.summary.atRisk} at risk.`,
      smsSummary: `Goals: ${goals.summary.avgProgress}% avg · ${goals.summary.blocked} blocked`,
      unifiedBriefing: goals.goals
        .map((g) => `- [${g.category}] ${g.title}: ${g.progressPercent}% (${g.status})`)
        .join("\n"),
      founderApprovalRequired: false,
      payload: goals,
    };
  }

  if (/\bscorecard|enterprise health score\b/i.test(q)) {
    const scorecard = await buildOrganizationPerformanceScorecard();
    return {
      kind: "scorecard",
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
      speechSummary: `Opportunity Intelligence found ${opportunities.length} items. Top: ${opportunities[0]?.title}.`,
      smsSummary: opportunities.slice(0, 3).map((o) => o.title).join("\n"),
      unifiedBriefing: opportunities
        .map((o) => `## ${o.title}\nWhy: ${o.whyItMatters}\nNext: ${o.recommendedNextStep}`)
        .join("\n\n"),
      founderApprovalRequired: opportunities.some((o) => o.founderApprovalRequired),
      payload: { opportunities },
    };
  }

  const decision = await runExecutiveDecisionEngine(q);
  return {
    kind: decision.decisionType === "simulation" ? "simulation" : "decision",
    speechSummary: decision.speechSummary,
    smsSummary: decision.smsSummary,
    unifiedBriefing: [
      `# Executive Decision`,
      `Type: ${decision.decisionType}`,
      `Recommendation: ${decision.recommendation}`,
      `Confidence: ${decision.confidence}`,
      `Founder approval: REQUIRED for major actions`,
      "",
      "## Analysis",
      `- Budget: ${decision.analysis.budgetImpact}`,
      `- Staffing: ${decision.analysis.staffingImpact}`,
      `- Grants: ${decision.analysis.grantRequirements}`,
      `- Capacity: ${decision.analysis.organizationalCapacity}`,
      `- Compliance: ${decision.analysis.compliance}`,
      `- Timeline: ${decision.analysis.timeline}`,
      "",
      "## Evidence",
      ...decision.supportingEvidence.map((e) => `- ${e}`),
      "",
      "## Alternatives",
      ...decision.alternatives.map((a) => `- ${a.label}: ${a.summary}`),
      "",
      "## Assumptions (not facts)",
      ...decision.assumptions.map((a) => `- ${a}`),
      "",
      "## Missing information",
      ...(decision.missingInformation.length ? decision.missingInformation.map((m) => `- ${m}`) : ["- None flagged"]),
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
