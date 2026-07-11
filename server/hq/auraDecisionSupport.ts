/**
 * AURA Decision Support — cross-module answers with live data, options, risks, and citations.
 * Never invents financial/grant/HR figures; labels recommendations separately from facts.
 */
import { runScenarioAnalysis } from "./scenarioModeling";
import { retrieveOrganizationalMemory, type MemoryCitation } from "./auraOrganizationalMemory";
import { buildOrgWideGrantMatches } from "./grantIntelligenceEngine";
import { buildTechnicalCommandBriefing } from "./auraTechnicalCommandEngine";
import { buildExecutiveHealthSummary } from "./auraExecutiveAssistant";
import { logHqAudit } from "./hqAuditLog";
import { auraExecutiveChat } from "../lib/ifcdc";

export type DecisionOption = {
  id: string;
  label: string;
  summary: string;
  risk: "low" | "medium" | "high";
  founderApprovalRequired: boolean;
};

export type DecisionSupportResult = {
  question: string;
  generatedAt: string;
  whatHappened: string;
  whyItMatters: string;
  supportingFacts: string[];
  options: DecisionOption[];
  risks: string[];
  recommendedAction: string;
  founderApprovalRequired: boolean;
  citations: MemoryCitation[];
  gaps: string[];
  modulesUsed: string[];
  speechSummary: string;
  smsSummary: string;
  raw?: Record<string, unknown>;
};

function extractHireCount(question: string): number {
  if (/\btwo\b/i.test(question)) return 2;
  if (/\bthree\b/i.test(question)) return 3;
  if (/\bfour\b/i.test(question)) return 4;
  if (/\bone\b/i.test(question) && /\b(hire|add|case manager)\b/i.test(question)) return 1;
  const m =
    question.match(/\b(?:hire|add|onboard)\s+(\d+)\b/i)
    || question.match(/\b(\d+)\s+(?:case managers?|staff|employees?|fte|workers?)\b/i);
  const n = m?.[1] ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(n) && n > 0 && n < 50 ? n : 2;
}

export function wantsDecisionSupport(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  return (
    /\b(can we afford|should we hire|what if we|decision support|analyze|trade[- ]?off|recommend|options?|risks?)\b/i.test(q)
    || /\b(hire|staffing|case managers?|budget impact|sustainability)\b/i.test(q)
    || /\bif (this|the) grant (is )?awarded\b/i.test(q)
    || /\bcross[- ]?module\b/i.test(q)
  );
}

async function answerHireAffordability(question: string): Promise<DecisionSupportResult> {
  const headcount = extractHireCount(question);
  const [scenario, memory, grants, executive] = await Promise.all([
    runScenarioAnalysis({ headcountChange: headcount, budgetChangePercent: 5, horizonMonths: 12 }),
    retrieveOrganizationalMemory(`${question} staffing budget payroll programs`, { topK: 6, includeTechHealth: false }),
    buildOrgWideGrantMatches({ sort: "funding", limit: 8, actorEmail: "service@ifcdc.org" }).catch(() => ({ matches: [] })),
    buildExecutiveHealthSummary().catch(() => null),
  ]);

  const matches = Array.isArray((grants as { matches?: unknown[] }).matches)
    ? (grants as { matches: Array<{ title?: string; amount?: number; fitScore?: number }> }).matches
    : [];
  const topGrant = matches[0];
  const modulesUsed = ["scenario_modeling", "knowledge_base", "grants", "executive"];
  const supportingFacts = [
    ...memory.facts.slice(0, 4).map((f) => f.statement.slice(0, 220)),
    `Scenario baseline headcount impact: +${headcount} FTE.`,
    scenario.summary.recommendation,
    topGrant
      ? `Top live grant match: ${topGrant.title || "opportunity"} (fit/funding ranked).`
      : "No live grant match returned for pipeline context.",
    executive
      ? `Organization health grade: ${(executive as { grade?: string }).grade ?? "n/a"}; pending approvals: ${(executive as { pendingApprovals?: number }).pendingApprovals ?? 0}.`
      : "Executive health summary unavailable.",
  ].filter(Boolean);

  const cashImpact = scenario.summary.cashFlowImpact;
  const riskLevel = scenario.summary.riskLevel;
  const options: DecisionOption[] = [
    {
      id: "hire_now_contingent",
      label: `Hire ${headcount} contingent on grant award`,
      summary: "Stage hiring plan and Founder approval; do not onboard until award is confirmed in Grant Center.",
      risk: riskLevel === "high" ? "high" : "medium",
      founderApprovalRequired: true,
    },
    {
      id: "hire_phased",
      label: "Phase hires (1 now, remainder after award)",
      summary: "Reduce near-term payroll risk while preserving program capacity plan.",
      risk: "medium",
      founderApprovalRequired: true,
    },
    {
      id: "wait",
      label: "Wait for award + budget line confirmation",
      summary: "Safest cash path; may delay program capacity.",
      risk: "low",
      founderApprovalRequired: false,
    },
  ];

  const recommended = riskLevel === "high" ? options[2] : options[0];
  const result: DecisionSupportResult = {
    question,
    generatedAt: new Date().toISOString(),
    whatHappened: `You asked whether IFCDC can support hiring ${headcount} staff (e.g. case managers) in context of grant award and budget sustainability.`,
    whyItMatters: "Hiring changes payroll burn, program capacity, and grant budget compliance. Premature hiring without award confirmation creates sustainability risk.",
    supportingFacts,
    options,
    risks: [
      riskLevel === "high" ? "Scenario model flags elevated risk for this headcount change." : `Scenario risk level: ${riskLevel}.`,
      cashImpact < 0 ? `Modeled cash-flow impact is negative (${cashImpact}).` : `Modeled cash-flow impact: ${cashImpact}.`,
      "Grant award is not guaranteed until officially recorded.",
      ...memory.gaps.slice(0, 2),
    ],
    recommendedAction: recommended.summary,
    founderApprovalRequired: recommended.founderApprovalRequired,
    citations: memory.citations,
    gaps: memory.gaps,
    modulesUsed,
    speechSummary: [
      `Decision support for hiring ${headcount}.`,
      `Scenario risk is ${riskLevel}.`,
      `Recommended: ${recommended.label}.`,
      recommended.founderApprovalRequired ? "Founder approval is required before hiring." : "No Founder approval required for the wait option.",
      memory.gaps[0] ? `Data gap: ${memory.gaps[0]}` : "Key facts were pulled from approved HQ records and live scenario modeling.",
    ].join(" "),
    smsSummary: [
      `Hire ${headcount}: risk ${riskLevel}`,
      `Rec: ${recommended.label}`,
      `Approval: ${recommended.founderApprovalRequired ? "REQUIRED" : "not required"}`,
    ].join("\n"),
    raw: { scenario, topGrant, executive },
  };
  return result;
}

async function answerGeneralDecision(question: string): Promise<DecisionSupportResult> {
  const [memory, tech, executive] = await Promise.all([
    retrieveOrganizationalMemory(question, { topK: 8 }),
    buildTechnicalCommandBriefing().catch(() => null),
    buildExecutiveHealthSummary().catch(() => null),
  ]);

  const modulesUsed = ["knowledge_base", "technical", "executive"];
  const supportingFacts = [
    ...memory.facts.slice(0, 5).map((f) => f.statement.slice(0, 220)),
    tech ? `Technical health score ${tech.overallScore}/100 (${tech.overallLabel}).` : "",
    executive
      ? `Executive health grade ${(executive as { grade?: string }).grade ?? "n/a"}; risks=${((executive as { risks?: unknown[] }).risks || []).length}.`
      : "",
  ].filter(Boolean);

  let narrative = "";
  try {
    narrative = await auraExecutiveChat(
      [
        "Produce a concise Founder decision brief. Use ONLY the facts below. If data is missing, say so.",
        "Format: What happened; Why it matters; Options (max 3); Risks; Recommended action; Approval needed yes/no.",
        `Question: ${question}`,
        `Verified facts:\n${supportingFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")}`,
        `Gaps:\n${memory.gaps.join("\n") || "none listed"}`,
      ].join("\n\n"),
      "You are AURA Decision Support. Never invent financial, grant, HR, or system figures."
    );
  } catch {
    narrative = "";
  }

  const options: DecisionOption[] = [
    {
      id: "act",
      label: "Act on recommended path",
      summary: memory.recommendations[0]?.statement || "Proceed with the highest-priority verified recommendation.",
      risk: "medium",
      founderApprovalRequired: true,
    },
    {
      id: "gather",
      label: "Gather missing data first",
      summary: memory.gaps[0] || "Close knowledge gaps before irreversible action.",
      risk: "low",
      founderApprovalRequired: false,
    },
    {
      id: "monitor",
      label: "Monitor and reassess",
      summary: "Track live KPIs and revisit after next data sync.",
      risk: "low",
      founderApprovalRequired: false,
    },
  ];

  return {
    question,
    generatedAt: new Date().toISOString(),
    whatHappened: narrative.split("\n")[0] || `Cross-module analysis requested: ${question.slice(0, 180)}`,
    whyItMatters: "This decision touches multiple HQ modules; acting without live grounding risks incorrect Founder direction.",
    supportingFacts,
    options,
    risks: [
      ...memory.gaps.map((g) => `Gap: ${g}`),
      ...(tech?.critical || []).slice(0, 2).map((f) => `Tech: ${f.title}`),
    ],
    recommendedAction: options[memory.gaps.length ? 1 : 0].summary,
    founderApprovalRequired: !memory.gaps.length,
    citations: memory.citations,
    gaps: memory.gaps,
    modulesUsed,
    speechSummary: narrative
      ? narrative.replace(/\n+/g, " ").slice(0, 900)
      : [
          `I pulled ${memory.facts.length} verified facts across ${modulesUsed.join(", ")}.`,
          memory.gaps[0] ? `Primary gap: ${memory.gaps[0]}` : "No major gaps flagged.",
          `Recommended: ${options[memory.gaps.length ? 1 : 0].label}.`,
        ].join(" "),
    smsSummary: [
      `Decision: ${memory.facts.length} facts`,
      `Rec: ${options[memory.gaps.length ? 1 : 0].label}`,
      memory.gaps[0] ? `Gap: ${memory.gaps[0].slice(0, 80)}` : "No gaps",
    ].join("\n"),
    raw: { narrative, techScore: tech?.overallScore },
  };
}

export async function answerDecisionSupportQuestion(question: string): Promise<DecisionSupportResult> {
  const q = question.trim();
  const result =
    /\b(hire|case manager|staffing|afford|fte|headcount)\b/i.test(q)
      ? await answerHireAffordability(q)
      : await answerGeneralDecision(q);

  await logHqAudit({
    action: "aura_decision_support",
    entityType: "aura_intelligence",
    detail: q.slice(0, 240),
    metadata: {
      founderApprovalRequired: result.founderApprovalRequired,
      modulesUsed: result.modulesUsed,
      gaps: result.gaps.length,
      citations: result.citations.length,
    },
  }).catch(() => undefined);

  return result;
}
