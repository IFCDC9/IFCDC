import { getOrGenerateDailyBriefing } from "./executiveBriefings";
import { buildExecutiveIntelligencePackage, generateStrategicRecommendations } from "./executiveIntelligenceEngine";
import { buildDivisionIntegrationOverview, type DivisionId } from "./divisionIntegrationLayer";
import { detectOperationalAnomalies, trackComplianceDeadlines } from "./auraExecutiveOps";
import { buildExecutiveHealthSummary, generateExecutiveActionPlan } from "./auraExecutiveAssistant";
import { buildApprovalQueue } from "./enterpriseApprovals";
import { createWorkflowInstance } from "./workflowEngine";
import { buildEnterpriseNotifications } from "./enterpriseHub";
import { answerEnterpriseQuestion } from "./auraEnterpriseIntelligence";
import { askOperationsCopilot } from "./auraOperationsCopilot";
import { auraExecutiveChat } from "../lib/ifcdc";
import { ifcdc } from "../lib/ifcdc";

const MODULE_KEYWORDS: Record<string, string[]> = {
  finance: ["finance", "financial", "budget", "cash", "invoice", "expense", "payroll", "ledger"],
  grants: ["grant", "funder", "award", "compliance", "pipeline"],
  hr: ["people", "hr", "employee", "volunteer", "staff", "onboarding", "certification"],
  operations: ["operations", "fleet", "facility", "housing", "risk"],
  programs: ["program", "participant", "community", "scholarship"],
};

function detectModule(question: string): string | undefined {
  const q = question.toLowerCase();
  for (const [mod, keywords] of Object.entries(MODULE_KEYWORDS)) {
    if (keywords.some((k) => q.includes(k))) return mod;
  }
  return undefined;
}

export async function buildMorningBriefingForFounder() {
  const [daily, intelligence, health, anomalies, tasks] = await Promise.all([
    getOrGenerateDailyBriefing(false),
    buildExecutiveIntelligencePackage(),
    buildExecutiveHealthSummary(),
    detectOperationalAnomalies(),
    buildApprovalQueue(8),
  ]);

  return {
    greeting: `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, Mr. Allah.`,
    date: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    organizationHealth: intelligence.scorecard.overall,
    grade: intelligence.scorecard.grade,
    highlights: daily.highlights ?? [],
    content: daily.content,
    priorities: intelligence.recommendations.recommendations.slice(0, 5).map((r) => r.action),
    anomalies: anomalies.anomalies.slice(0, 5),
    pendingTasks: tasks.tasks.slice(0, 6),
    financialSnapshot: intelligence.forecasts.financial.current,
    grantPipeline: {
      active: intelligence.forecasts.grants.activeAwards,
      pipeline: intelligence.forecasts.grants.pipelineValue,
    },
    complianceAlerts: {
      overdue: intelligence.compliance.overdue,
      dueNext14Days: intelligence.compliance.dueNext14Days,
    },
    risks: health.risks,
    generatedAt: new Date().toISOString(),
  };
}

export async function monitorAllHeadquartersModules() {
  const [divisions, anomalies, compliance, health, notifications] = await Promise.all([
    buildDivisionIntegrationOverview(),
    detectOperationalAnomalies(),
    trackComplianceDeadlines(),
    buildExecutiveHealthSummary(),
    buildEnterpriseNotifications(),
  ]);

  const modules = [
    { id: "finance", label: "Financial Center", healthy: ((health.modules as { finance?: { financialHealthScore?: number } })?.finance?.financialHealthScore ?? 0) >= 60, alerts: anomalies.anomalies.filter((a) => a.module === "finance").length },
    { id: "grants", label: "Grant Center", healthy: compliance.overdue === 0, alerts: compliance.overdue + compliance.dueNext14Days },
    { id: "hr", label: "People & HR", healthy: true, alerts: anomalies.anomalies.filter((a) => a.module === "hr").length },
    { id: "operations", label: "Operations", healthy: anomalies.anomalies.filter((a) => a.severity === "high").length === 0, alerts: anomalies.anomalies.filter((a) => a.module === "operations").length },
    { id: "programs", label: "Community Programs", healthy: true, alerts: 0 },
    { id: "aura", label: "AURA Intelligence", healthy: true, alerts: 0 },
    { id: "security", label: "Security Center", healthy: health.risks.filter((r) => r.area === "Security").length === 0, alerts: health.risks.filter((r) => r.area === "Security").length },
  ];

  return {
    modules,
    divisions: divisions.divisions,
    anomalyCount: anomalies.anomalies.length,
    highSeverity: anomalies.anomalies.filter((a) => a.severity === "high").length,
    unreadNotifications: notifications.unreadCount,
    scannedAt: new Date().toISOString(),
  };
}

export async function detectAndRecommendCorrectiveActions() {
  const [anomalies, recommendations, actionPlan] = await Promise.all([
    detectOperationalAnomalies(),
    generateStrategicRecommendations(),
    generateExecutiveActionPlan(),
  ]);

  const correctiveActions = [
    ...anomalies.anomalies.map((a) => ({
      source: "anomaly",
      severity: a.severity,
      area: a.module,
      action: a.title,
      detail: a.detail,
    })),
    ...recommendations.recommendations.map((r) => ({
      source: "strategic",
      severity: r.impact === "high" ? "high" as const : r.impact === "medium" ? "medium" as const : "low" as const,
      area: r.area,
      action: r.action,
      detail: `Priority ${r.priority}`,
    })),
  ];

  return {
    correctiveActions: correctiveActions.slice(0, 12),
    actionPlan: actionPlan.plan,
    generatedAt: new Date().toISOString(),
  };
}

export async function answerExecutiveCopilotQuestion(question: string) {
  const module = detectModule(question);
  if (module === "operations" || module === "programs") {
    return askOperationsCopilot(question, module);
  }
  return answerEnterpriseQuestion(question, module);
}

export type AutomationAction =
  | "task_assignment"
  | "deadline_reminder"
  | "executive_notification"
  | "grant_followup"
  | "board_packet"
  | "financial_report"
  | "compliance_monitor";

export async function executeCopilotAutomation(
  action: AutomationAction,
  opts?: { title?: string; assignedTo?: string; payload?: Record<string, unknown> }
) {
  const now = new Date().toISOString();
  const actorEmail = opts?.assignedTo ?? "aura-copilot";

  switch (action) {
    case "task_assignment":
      return createWorkflowInstance({
        workflowKey: "expense_approval",
        title: opts?.title ?? "AURA-assigned executive task",
        assignedTo: actorEmail,
        priority: "high",
        payload: opts?.payload,
      });

    case "deadline_reminder": {
      const compliance = await trackComplianceDeadlines();
      if (compliance.dueNext14Days === 0) return { ok: true, message: "No upcoming deadlines" };
      return createWorkflowInstance({
        workflowKey: "compliance_reminder",
        title: opts?.title ?? `Compliance reminder — ${compliance.dueNext14Days} items due`,
        assignedTo: "grants@ifcdc.org",
        payload: { deadlines: compliance.deadlines.slice(0, 5) },
      });
    }

    case "executive_notification": {
      const briefing = await buildMorningBriefingForFounder();
      try {
        await ifcdc.notifications.send({
          to: "service@ifcdc.org",
          subject: opts?.title ?? "IFCDC Executive Alert — AURA Copilot",
          body: briefing.priorities.join("\n") || "Review Headquarters dashboard for updates.",
          channel: "email",
        });
      } catch { /* notification optional */ }
      return { ok: true, message: "Executive notification queued", priorities: briefing.priorities };
    }

    case "grant_followup":
      return createWorkflowInstance({
        workflowKey: "grant_deadline_reminder",
        title: opts?.title ?? "Grant follow-up — AURA automation",
        assignedTo: "grants@ifcdc.org",
        payload: opts?.payload ?? { source: "aura_copilot" },
      });

    case "board_packet": {
      const { generateExecutiveBoardReport } = await import("./executiveIntelligenceEngine");
      const report = await generateExecutiveBoardReport();
      return createWorkflowInstance({
        workflowKey: "board_approval",
        title: opts?.title ?? `Board packet — ${report.title}`,
        assignedTo: "board@ifcdc.org",
        payload: { reportTitle: report.title, summary: report.executiveSummary.slice(0, 2000) },
      });
    }

    case "financial_report":
      return createWorkflowInstance({
        workflowKey: "scheduled_report",
        title: opts?.title ?? `Financial report — ${now.slice(0, 10)}`,
        assignedTo: "finance@ifcdc.org",
        payload: { reportType: "financial", ...opts?.payload },
      });

    case "compliance_monitor": {
      const compliance = await trackComplianceDeadlines();
      const anomalies = await detectOperationalAnomalies();
      if (compliance.overdue === 0 && anomalies.anomalies.length === 0) {
        return { ok: true, message: "Compliance monitoring complete — no issues" };
      }
      return createWorkflowInstance({
        workflowKey: "compliance_reminder",
        title: opts?.title ?? `Compliance monitor — ${compliance.overdue} overdue`,
        assignedTo: "compliance@ifcdc.org",
        payload: { overdue: compliance.overdue, anomalies: anomalies.anomalies.length },
      });
    }

    default:
      return { ok: false, message: "Unknown automation action" };
  }
}

export async function generateExecutiveSummaryNarrative() {
  const [briefing, intelligence] = await Promise.all([
    buildMorningBriefingForFounder(),
    buildExecutiveIntelligencePackage(),
  ]);

  try {
    const summary = await auraExecutiveChat([
      "Write a 2-paragraph executive summary for IFCDC's Founder.",
      `Health: ${intelligence.scorecard.overall}% (${intelligence.scorecard.grade})`,
      `Cash flow: $${intelligence.forecasts.financial.current.cashFlow}`,
      `Grants: ${intelligence.forecasts.grants.activeAwards} active, pipeline $${intelligence.forecasts.grants.pipelineValue}`,
      `Compliance overdue: ${intelligence.compliance.overdue}`,
      `Top priorities: ${briefing.priorities.join("; ")}`,
    ].join("\n"));
    return { summary, briefing, generatedAt: new Date().toISOString() };
  } catch {
    return {
      summary: briefing.content?.slice(0, 800) ?? "Executive summary unavailable.",
      briefing,
      generatedAt: new Date().toISOString(),
    };
  }
}
