/**
 * Build 61 — AURA Executive Intelligence Foundation
 * Aggregates live HQ engines into one Executive AI Command Center surface.
 * Freeze-safe: server/hq only — no new packages or microservices.
 */
import { buildExecutiveCommandHealth, type CommandHealthPillar } from "./executiveCommandHealth";
import { buildMorningBriefingForFounder, detectAndRecommendCorrectiveActions, answerExecutiveCopilotQuestion } from "./auraExecutiveCopilot";
import { getOrGenerateDailyBriefing } from "./executiveBriefings";
import { getOperationsCopilotBriefing } from "./auraOperationsCopilot";
import { buildWeeklyExecutiveReview } from "./auraExecutiveDecisionIntelligence";
import { buildPredictiveIntelligence } from "./predictiveIntelligence";
import { buildExecutiveIntelligencePackage, generateStrategicRecommendations } from "./executiveIntelligenceEngine";
import { detectOperationalAnomalies, trackComplianceDeadlines, predictFinancialRisk } from "./auraExecutiveOps";
import { generateExecutiveActionPlan } from "./auraExecutiveAssistant";
import { retrieveKnowledge } from "./knowledgeBaseEngine";
import { auraExecutiveChat } from "../lib/ifcdc";
import { listReviewReminders } from "./policyGovernanceEngine";
import { buildExecutiveOperationsDashboard } from "./executiveOperationsFoundation";

export const BRIEFING_TYPES = [
  "morning",
  "evening",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "annual",
  "ops",
] as const;

export type BriefingType = (typeof BRIEFING_TYPES)[number];

export type HealthPillarId = CommandHealthPillar["id"];

type Recommendation = {
  id: string;
  priority: number;
  title: string;
  recommendedAction: string;
  estimatedImpact: string;
  estimatedCompletion: string;
  departments: string[];
  dependencies: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  expectedImprovement: string;
  relatedPath?: string;
};

function effortFromScore(score: number): string {
  if (score >= 90) return "1–2 hours (polish)";
  if (score >= 75) return "1–2 days";
  if (score >= 60) return "3–5 days";
  if (score >= 40) return "1–2 weeks";
  return "2–4 weeks (cross-department)";
}

function progressTo100(score: number): number {
  return Math.max(0, Math.min(100, 100 - Math.round(score)));
}

async function soft<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[ei-foundation] ${label}:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asList(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

function normalizeRisk(raw: unknown): Recommendation["riskLevel"] {
  const s = String(raw ?? "medium").toLowerCase();
  if (s === "critical" || s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

function departmentsForPillar(id: HealthPillarId): string[] {
  switch (id) {
    case "financial":
      return ["Finance", "Grants", "Executive"];
    case "operational":
      return ["Operations", "Programs", "Facilities", "HR"];
    case "system":
      return ["Technology", "Software Division"];
    case "security":
      return ["Technology", "Security", "Executive"];
    case "integration":
      return ["Technology", "Integrations", "Software Division"];
    default:
      return ["Executive", "Operations", "Finance", "HR"];
  }
}

export async function buildEiRecommendations(): Promise<Recommendation[]> {
  const [corrective, strategic, health, actionPlan, policyReviews] = await Promise.all([
    soft("corrective", () => detectAndRecommendCorrectiveActions(), null as Awaited<ReturnType<typeof detectAndRecommendCorrectiveActions>> | null),
    soft("strategic", () => generateStrategicRecommendations(), null as Awaited<ReturnType<typeof generateStrategicRecommendations>> | null),
    soft("health", () => buildExecutiveCommandHealth(), null as Awaited<ReturnType<typeof buildExecutiveCommandHealth>> | null),
    soft("action-plan", () => generateExecutiveActionPlan(), null as Awaited<ReturnType<typeof generateExecutiveActionPlan>> | null),
    soft("policy-reviews", () => listReviewReminders(), [] as Awaited<ReturnType<typeof listReviewReminders>>),
  ]);

  const out: Recommendation[] = [];
  let priority = 1;

  const weakest = [...(health?.pillars ?? [])].sort((a, b) => a.score - b.score)[0];
  if (weakest && weakest.score < 80) {
    out.push({
      id: `pillar-${weakest.id}`,
      priority: priority++,
      title: `Highest priority: improve ${weakest.label}`,
      recommendedAction: `Open the ${weakest.label} explainer and close the top open issues until the score reaches 80+.`,
      estimatedImpact: `+${Math.min(25, progressTo100(weakest.score))} points toward 100% organizational readiness`,
      estimatedCompletion: effortFromScore(weakest.score),
      departments: departmentsForPillar(weakest.id),
      dependencies: ["Operations", "Technology", "Executive"],
      riskLevel: weakest.score < 40 ? "critical" : weakest.score < 60 ? "high" : "medium",
      expectedImprovement: `${weakest.label} moves from ${weakest.score}/100 toward healthy range (≥80)`,
      relatedPath: `/hq/aura-executive?pillar=${weakest.id}`,
    });
  }

  for (const a of asList(corrective?.correctiveActions).slice(0, 5)) {
    out.push({
      id: `corr-${priority}`,
      priority: priority++,
      title: String(a.action ?? a.title ?? "Corrective action"),
      recommendedAction: String(a.action ?? a.recommendation ?? a.detail ?? "Review and resolve"),
      estimatedImpact: String(a.impact ?? a.severity ?? "Reduces operational risk"),
      estimatedCompletion: String(a.effort ?? a.eta ?? "1–3 days"),
      departments: Array.isArray(a.modules) ? (a.modules as string[]) : [String(a.module ?? a.area ?? "Executive")],
      dependencies: Array.isArray(a.dependencies) ? (a.dependencies as string[]) : [],
      riskLevel: normalizeRisk(a.severity),
      expectedImprovement: String(a.expectedImprovement ?? "Stabilizes related health pillar"),
      relatedPath: typeof a.path === "string" ? a.path : "/hq/intelligence",
    });
  }

  for (const r of asList(strategic?.recommendations).slice(0, 4)) {
    out.push({
      id: `strat-${priority}`,
      priority: priority++,
      title: String(r.action ?? r.title ?? "Strategic recommendation"),
      recommendedAction: String(r.action ?? r.detail ?? "Execute strategic recommendation"),
      estimatedImpact: String(r.impact ?? "Improves executive scorecard"),
      estimatedCompletion: String(r.timeframe ?? "This week"),
      departments: [String(r.area ?? r.module ?? "Executive")],
      dependencies: [],
      riskLevel: "medium",
      expectedImprovement: String(r.outcome ?? "Advances organizational priorities"),
      relatedPath: "/hq/intelligence",
    });
  }

  for (const p of asList(policyReviews).slice(0, 3)) {
    out.push({
      id: `policy-${String(p.id)}`,
      priority: priority++,
      title: `Policy review due: ${String(p.title)}`,
      recommendedAction: `Review and re-approve ${String(p.policy_number ?? p.title)} before ${String(p.next_review_date)}.`,
      estimatedImpact: "Maintains governance compliance",
      estimatedCompletion: "2–4 hours",
      departments: [String(p.department ?? "Compliance"), "Executive"],
      dependencies: ["Policy & Governance Center"],
      riskLevel: "medium",
      expectedImprovement: "Clears upcoming policy review reminder",
      relatedPath: `/hq/policies?id=${String(p.id)}`,
    });
  }

  if (actionPlan?.plan) {
    out.push({
      id: "action-plan",
      priority: priority++,
      title: "Execute AURA executive action plan",
      recommendedAction: String(actionPlan.plan).slice(0, 280),
      estimatedImpact: "Coordinates cross-module remediation",
      estimatedCompletion: "This week",
      departments: ["Executive", "Operations", "Finance", "Grants"],
      dependencies: ["AURA Executive Assistant"],
      riskLevel: "medium",
      expectedImprovement: "Aligns leadership on sequenced fixes",
      relatedPath: "/hq/aura-executive?tab=recommendations",
    });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

export async function buildEiDashboard() {
  const [health, predictions, anomalies, compliance, opsDash, financialRisk, intelligence] = await Promise.all([
    soft("command-health", () => buildExecutiveCommandHealth(), null as Awaited<ReturnType<typeof buildExecutiveCommandHealth>> | null),
    soft("predictions", () => buildPredictiveIntelligence(), null as Awaited<ReturnType<typeof buildPredictiveIntelligence>> | null),
    soft("anomalies", () => detectOperationalAnomalies(), null as Awaited<ReturnType<typeof detectOperationalAnomalies>> | null),
    soft("compliance", () => trackComplianceDeadlines(), null as Awaited<ReturnType<typeof trackComplianceDeadlines>> | null),
    soft("ops", () => buildExecutiveOperationsDashboard(), null as Awaited<ReturnType<typeof buildExecutiveOperationsDashboard>> | null),
    soft("financial-risk", () => predictFinancialRisk(), null as Awaited<ReturnType<typeof predictFinancialRisk>> | null),
    soft("intelligence", () => buildExecutiveIntelligencePackage(), null as Awaited<ReturnType<typeof buildExecutiveIntelligencePackage>> | null),
  ]);

  const recommendations = await buildEiRecommendations();

  return {
    version: "build61-executive-intelligence",
    generatedAt: new Date().toISOString(),
    overallHealth: health?.overall ?? null,
    grade: health?.grade ?? "—",
    pillars: health?.pillars ?? [],
    degraded: health?.degraded ?? false,
    monitoredAt: health?.monitoredAt ?? new Date().toISOString(),
    topRecommendation: recommendations[0] ?? null,
    recommendations: recommendations.slice(0, 8),
    predictive: {
      signals: predictions?.models ?? [],
      organizationHealth: predictions?.organizationHealth ?? null,
      summary: null as string | null,
    },
    monitoring: {
      anomalies: anomalies?.anomalies?.slice(0, 10) ?? [],
      complianceOverdue: compliance?.overdue ?? 0,
      complianceDueSoon: compliance?.dueNext14Days ?? 0,
      financialRiskLevel: financialRisk?.riskLevel ?? null,
      grantActivity: opsDash?.grantActivity ?? null,
      employeeActivity: opsDash?.employeeActivity ?? null,
      volunteerActivity: opsDash?.volunteerActivity ?? null,
      activePrograms: opsDash?.activePrograms ?? null,
      openTasks: opsDash?.openTasks ?? null,
      activeProjects: opsDash?.activeProjects ?? null,
      scorecard: intelligence?.scorecard ?? null,
    },
    briefingTypes: BRIEFING_TYPES,
    deepLinks: {
      aura: "/hq/aura",
      intelligence: "/hq/intelligence",
      knowledge: "/hq/knowledge",
      policies: "/hq/policies",
      operations: "/hq/operations",
      grants: "/hq/grants",
      brain: "/hq/executive-brain",
      enterpriseOs: "/hq/enterprise-os",
    },
  };
}

export async function explainHealthPillar(pillarId: string) {
  const health = await buildExecutiveCommandHealth();
  const pillar = health.pillars.find((p) => p.id === pillarId) ?? health.pillars[0];
  const [anomalies, corrective, compliance, financialRisk, tech, ops] = await Promise.all([
    soft("anomalies", () => detectOperationalAnomalies(), null as Awaited<ReturnType<typeof detectOperationalAnomalies>> | null),
    soft("corrective", () => detectAndRecommendCorrectiveActions(), null as Awaited<ReturnType<typeof detectAndRecommendCorrectiveActions>> | null),
    soft("compliance", () => trackComplianceDeadlines(), null as Awaited<ReturnType<typeof trackComplianceDeadlines>> | null),
    soft("financial-risk", () => predictFinancialRisk(), null as Awaited<ReturnType<typeof predictFinancialRisk>> | null),
    soft("tech", () => import("./auraTechnicalCommandEngine").then((m) => m.buildTechnicalCommandBriefing()), null as Record<string, unknown> | null),
    soft("ops", () => buildExecutiveOperationsDashboard(), null as Awaited<ReturnType<typeof buildExecutiveOperationsDashboard>> | null),
  ]);

  const issues: Array<{
    id: string;
    title: string;
    severity: string;
    detail: string;
    recommendedFix: string;
    path?: string;
  }> = [];

  if (pillar.id === "system" || pillar.id === "security" || pillar.id === "integration") {
    const techRec = asRec(tech);
    const findings = asList(techRec.findings ?? techRec.issues);
    for (const f of findings.slice(0, 8)) {
      issues.push({
        id: String(f.id ?? f.code ?? issues.length),
        title: String(f.title ?? f.name ?? "Technical finding"),
        severity: String(f.severity ?? f.level ?? "medium"),
        detail: String(f.detail ?? f.description ?? ""),
        recommendedFix: String(f.recommendedFix ?? f.fix ?? f.recommendation ?? "Investigate in Integrations / Security Center"),
        path: typeof f.path === "string" ? f.path : "/hq/integrations",
      });
    }
  }

  if (pillar.id === "financial" && financialRisk) {
    const factors = financialRisk.factors ?? [];
    const recs = financialRisk.recommendations ?? [];
    factors.forEach((f, i) => {
      issues.push({
        id: `fin-${i}`,
        title: f,
        severity: financialRisk.riskLevel ?? "medium",
        detail: f,
        recommendedFix: recs[i] ?? recs[0] ?? "Review Financial Center cash position and grant receivables",
        path: "/hq/finance",
      });
    });
  }

  if (pillar.id === "operational" || pillar.id === "organization") {
    for (const a of (anomalies?.anomalies ?? []).slice(0, 8)) {
      issues.push({
        id: `anom-${issues.length}`,
        title: a.title ?? a.module ?? "Operational anomaly",
        severity: a.severity ?? "medium",
        detail: a.detail ?? "",
        recommendedFix: "Open Operations Center and clear related alerts",
        path: "/hq/operations",
      });
    }
    if (compliance?.overdue) {
      issues.push({
        id: "compliance-overdue",
        title: `${compliance.overdue} compliance items overdue`,
        severity: "high",
        detail: `${compliance.dueNext14Days ?? 0} additional items due within 14 days`,
        recommendedFix: "Clear overdue filings in Compliance and Grant Center calendars",
        path: "/hq/operations?tab=compliance",
      });
    }
    if (ops?.openTasks?.overdue) {
      issues.push({
        id: "overdue-tasks",
        title: `${ops.openTasks.overdue} overdue operational tasks`,
        severity: "medium",
        detail: `${ops.openTasks.total} open tasks total`,
        recommendedFix: "Assign owners and close overdue tasks in Executive Operations",
        path: "/hq/operations?tab=projects",
      });
    }
  }

  for (const c of asList(corrective?.correctiveActions).slice(0, 4)) {
    issues.push({
      id: `fix-${issues.length}`,
      title: String(c.action ?? c.title ?? "Recommended fix"),
      severity: String(c.severity ?? "medium"),
      detail: String(c.detail ?? c.impact ?? ""),
      recommendedFix: String(c.action ?? c.recommendation ?? "Execute corrective action"),
      path: typeof c.path === "string" ? c.path : "/hq/intelligence",
    });
  }

  if (!issues.length) {
    issues.push({
      id: "healthy",
      title: `${pillar.label} is within acceptable range`,
      severity: "low",
      detail: pillar.meta,
      recommendedFix: "Continue monitoring — no urgent remediation required",
      path: "/hq/aura-executive",
    });
  }

  const gap = progressTo100(pillar.score);
  return {
    pillar,
    overall: health.overall,
    why: `${pillar.label} is ${pillar.score}/100 (${pillar.grade}) because ${pillar.meta}. Status: ${pillar.status}.`,
    issues,
    progressToward100: {
      current: pillar.score,
      remainingPoints: gap,
      percentComplete: pillar.score,
    },
    estimatedEffort: effortFromScore(pillar.score),
    recommendedFixes: issues.filter((i) => i.severity !== "low").map((i) => i.recommendedFix),
    departments: departmentsForPillar(pillar.id),
    generatedAt: new Date().toISOString(),
  };
}

export async function buildEiBriefing(type: BriefingType) {
  switch (type) {
    case "morning": {
      const morning = await buildMorningBriefingForFounder();
      return { type, title: "Morning Executive Briefing", ...morning };
    }
    case "daily": {
      const daily = await getOrGenerateDailyBriefing(false);
      return { type, title: "Daily Executive Report", payload: daily };
    }
    case "ops": {
      const ops = await getOperationsCopilotBriefing();
      return { type, title: "Operations Summary", payload: ops };
    }
    case "weekly": {
      const weekly = await buildWeeklyExecutiveReview();
      return { type, title: "Weekly Executive Report", payload: weekly };
    }
    case "evening": {
      const [ops, anomalies, corrective, health, morning] = await Promise.all([
        soft("ops-brief", () => getOperationsCopilotBriefing(), null as Awaited<ReturnType<typeof getOperationsCopilotBriefing>> | null),
        soft("anomalies", () => detectOperationalAnomalies(), null as Awaited<ReturnType<typeof detectOperationalAnomalies>> | null),
        soft("corrective", () => detectAndRecommendCorrectiveActions(), null as Awaited<ReturnType<typeof detectAndRecommendCorrectiveActions>> | null),
        soft("health", () => buildExecutiveCommandHealth(), null as Awaited<ReturnType<typeof buildExecutiveCommandHealth>> | null),
        soft("morning", () => buildMorningBriefingForFounder(), null as Awaited<ReturnType<typeof buildMorningBriefingForFounder>> | null),
      ]);
      return {
        type,
        title: "Evening Operations Summary",
        greeting: "End-of-day executive wrap-up",
        organizationHealth: health?.overall ?? null,
        pillars: health?.pillars ?? [],
        anomalies: anomalies?.anomalies?.slice(0, 6) ?? [],
        pendingActions: asList(corrective?.correctiveActions).slice(0, 5),
        tomorrowPriorities: morning?.priorities?.slice(0, 5) ?? [],
        operations: ops,
        generatedAt: new Date().toISOString(),
      };
    }
    case "monthly":
    case "quarterly":
    case "annual": {
      const [intelligence, weekly, health, strategic] = await Promise.all([
        soft("intel", () => buildExecutiveIntelligencePackage(), null as Awaited<ReturnType<typeof buildExecutiveIntelligencePackage>> | null),
        soft("weekly", () => buildWeeklyExecutiveReview(), null as Awaited<ReturnType<typeof buildWeeklyExecutiveReview>> | null),
        soft("health", () => buildExecutiveCommandHealth(), null as Awaited<ReturnType<typeof buildExecutiveCommandHealth>> | null),
        soft("strategic", () => generateStrategicRecommendations(), null as Awaited<ReturnType<typeof generateStrategicRecommendations>> | null),
      ]);
      const horizon =
        type === "monthly"
          ? "Monthly Organizational Report"
          : type === "quarterly"
            ? "Quarterly Performance Review"
            : "Annual Organizational Review";
      return {
        type,
        title: horizon,
        organizationHealth: health?.overall ?? null,
        pillars: health?.pillars ?? [],
        scorecard: intelligence?.scorecard ?? null,
        forecasts: intelligence?.forecasts ?? null,
        weeklyReview: weekly,
        recommendations: strategic?.recommendations ?? [],
        narrative:
          type === "annual"
            ? "Annual review aggregates live scorecard, forecasts, weekly executive review signals, and strategic recommendations for board and founder planning."
            : `${horizon} compiled from live Headquarters intelligence engines.`,
        generatedAt: new Date().toISOString(),
      };
    }
    default:
      return { type, error: "Unknown briefing type", generatedAt: new Date().toISOString() };
  }
}

export async function buildEiPredictions() {
  const [packagePred, compliance, financialRisk, policyReviews, ops] = await Promise.all([
    soft("pred-pkg", () => buildPredictiveIntelligence(), null as Awaited<ReturnType<typeof buildPredictiveIntelligence>> | null),
    soft("compliance", () => trackComplianceDeadlines(), null as Awaited<ReturnType<typeof trackComplianceDeadlines>> | null),
    soft("fin-risk", () => predictFinancialRisk(), null as Awaited<ReturnType<typeof predictFinancialRisk>> | null),
    soft("policies", () => listReviewReminders(), [] as Awaited<ReturnType<typeof listReviewReminders>>),
    soft("ops", () => buildExecutiveOperationsDashboard(), null as Awaited<ReturnType<typeof buildExecutiveOperationsDashboard>> | null),
  ]);

  let brainPredictions: unknown[] = [];
  try {
    const brainMod = await import("./auraEnterpriseBrain");
    const result = await brainMod.buildPredictiveIntelligenceSignals();
    brainPredictions = Array.isArray(result) ? result : [];
  } catch {
    brainPredictions = [];
  }

  const models = packagePred?.models ?? [];
  const concerning = models.filter((m) => m.trend === "down" || m.id === "org_risk" || m.id === "staffing").slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    package: packagePred,
    models,
    brainPredictions: brainPredictions.slice(0, 12),
    risks: {
      potentialSystemFailures: concerning.length ? concerning : models.slice(0, 5),
      complianceDeadlines: {
        overdue: compliance?.overdue ?? 0,
        dueSoon: compliance?.dueNext14Days ?? 0,
        items: compliance?.deadlines?.slice(0, 10) ?? [],
      },
      grantDeadlines: ops?.grantActivity ?? null,
      financialTrends: financialRisk,
      staffingAndCapacity: ops?.employeeActivity ?? null,
      operationalRisks: ops?.systemAlerts ?? [],
      policyReviewsDue: asList(policyReviews).slice(0, 8),
      infrastructure: brainPredictions.slice(0, 5),
      organizationHealthProjection: packagePred?.organizationHealth ?? null,
    },
  };
}

export async function askExecutiveIntelligence(question: string) {
  const q = question.trim();
  if (q.length < 3) return { error: "Question too short", answer: "" };

  const [kbChunks, health, corrective, compliance] = await Promise.all([
    soft("kb", () => retrieveKnowledge(q, { topK: 5 }), [] as Awaited<ReturnType<typeof retrieveKnowledge>>),
    soft("health", () => buildExecutiveCommandHealth(), null as Awaited<ReturnType<typeof buildExecutiveCommandHealth>> | null),
    soft("corrective", () => detectAndRecommendCorrectiveActions(), null as Awaited<ReturnType<typeof detectAndRecommendCorrectiveActions>> | null),
    soft("compliance", () => trackComplianceDeadlines(), null as Awaited<ReturnType<typeof trackComplianceDeadlines>> | null),
  ]);

  const kbContext = kbChunks
    .map((c, i) => `[KB ${i + 1}] ${c.title} (${c.category})\n${String(c.content ?? "").slice(0, 500)}`)
    .join("\n\n");

  const liveContext = [
    health ? `Command health overall ${health.overall}/100. Pillars: ${health.pillars.map((p) => `${p.label}=${p.score}`).join(", ")}.` : "",
    `Compliance overdue=${compliance?.overdue ?? 0}; dueSoon=${compliance?.dueNext14Days ?? 0}.`,
    `Top corrective actions: ${asList(corrective?.correctiveActions).slice(0, 3).map((a) => String(a.action ?? "")).filter(Boolean).join("; ") || "none"}.`,
  ]
    .filter(Boolean)
    .join("\n");

  let answer: string;
  let source: string;
  try {
    answer = await auraExecutiveChat(
      [
        "You are AURA Executive Intelligence for IFCDC HQ.",
        "Answer as an executive advisor using live HQ metrics and knowledge base excerpts.",
        "Be specific, actionable, and concise. Cite when knowledge base context is used.",
        `LIVE CONTEXT:\n${liveContext}`,
        kbContext ? `KNOWLEDGE BASE:\n${kbContext}` : "KNOWLEDGE BASE: (no matching chunks)",
        `QUESTION: ${q}`,
      ].join("\n\n"),
      "executive-intelligence"
    );
    source = "aura+kb";
  } catch {
    const fallback = await answerExecutiveCopilotQuestion(q);
    answer =
      typeof fallback === "string"
        ? fallback
        : String((fallback as { answer?: string })?.answer ?? JSON.stringify(fallback));
    source = "copilot-fallback";
  }

  return {
    question: q,
    answer,
    source,
    knowledgeUsed: kbChunks.length,
    knowledge: kbChunks.slice(0, 5).map((c) => ({
      title: c.title,
      category: c.category,
      score: c.score,
      sourceType: c.sourceType,
    })),
    healthSnapshot: health
      ? { overall: health.overall, pillars: health.pillars.map((p) => ({ id: p.id, score: p.score, status: p.status })) }
      : null,
    generatedAt: new Date().toISOString(),
  };
}
