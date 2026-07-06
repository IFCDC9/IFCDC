/**
 * Phase 9 — Enterprise Intelligence & Automation
 * Unified operating-system layer for IFCDC Headquarters.
 */
import { buildMorningBriefingForFounder, monitorAllHeadquartersModules, detectAndRecommendCorrectiveActions } from "./auraExecutiveCopilot";
import { buildExecutiveIntelligencePackage, generateStrategicRecommendations } from "./executiveIntelligenceEngine";
import { buildPredictiveIntelligence } from "./predictiveIntelligence";
import { buildOrganizationHealthScore } from "./analyticsReporting";
import { buildDivisionIntegrationOverview } from "./divisionIntegrationLayer";
import { buildEnterpriseNotifications, enterpriseGlobalSearch } from "./enterpriseHub";
import { detectOperationalAnomalies, trackComplianceDeadlines } from "./auraExecutiveOps";
import { listWorkflowInstances } from "./workflowEngine";
import { getWorkflowSteps } from "./workflowOrchestration";
import { buildPredictiveForecasts } from "./analyticsWarehouse";
import { listRecentReports } from "./executiveDocumentDelivery";
import { buildGrantExecutiveDashboard } from "./grantReporting";
import { getDb } from "../db";

export interface GrantProbabilityScore {
  opportunityId: string;
  title: string;
  funder: string;
  probability: number;
  factors: string[];
  deadline?: string;
}

export async function buildPhase9CommandCenter() {
  const [briefing, health, intelligence, modules, recommendations, anomalies, compliance] = await Promise.all([
    buildMorningBriefingForFounder().catch((err) => {
      console.warn("[phase9] briefing failed:", err instanceof Error ? err.message : err);
      return {
        greeting: `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, Mr. Allah.`,
        highlights: [] as string[],
        priorities: [] as string[],
      };
    }),
    buildOrganizationHealthScore().catch(() => ({ overall: 0, grade: "—", factors: [] })),
    buildExecutiveIntelligencePackage().catch(() => ({
      scorecard: { overall: 0, grade: "—" },
      recommendations: { recommendations: [] },
    })),
    monitorAllHeadquartersModules().catch(() => ({ modules: [] })),
    generateStrategicRecommendations().catch(() => ({ recommendations: [] })),
    detectOperationalAnomalies().catch(() => ({ anomalies: [] })),
    trackComplianceDeadlines().catch(() => ({ overdue: 0, dueNext14Days: 0, deadlines: [] })),
  ]);

  return {
    briefing,
    organizationHealth: {
      overall: health.overall,
      grade: health.grade,
      factors: health.factors,
    },
    scorecard: intelligence.scorecard,
    moduleMonitor: modules,
    recommendations: (recommendations.recommendations ?? []).slice(0, 8).map((r) => ({
      action: r.action,
      priority: r.impact === "high" ? "high" : r.impact === "medium" ? "medium" : "low",
      module: r.area,
    })),
    riskAlerts: anomalies.anomalies,
    complianceAlerts: {
      overdue: compliance.overdue,
      dueNext14Days: compliance.dueNext14Days,
      items: compliance.deadlines?.slice(0, 10) ?? [],
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function buildPredictiveDashboard() {
  const [predictions, warehouseForecasts, grants] = await Promise.all([
    buildPredictiveIntelligence().catch(() => ({ models: [] as { id: string; label: string; current: number; projected30d: number; trend: string; unit: string; confidence?: string; insight?: string }[] })),
    buildPredictiveForecasts().catch(() => ({ forecasts: [] })),
    buildGrantExecutiveDashboard().catch(() => ({ activeAwards: 0, pipelineValue: 0, winRate: 0 })),
  ]);

  const grantScores = await buildGrantProbabilityScores().catch(() => [] as GrantProbabilityScore[]);
  const riskModel = predictions.models.find((m) => m.id === "org_risk");

  return {
    models: predictions.models,
    summary: {
      modelCount: predictions.models.length,
      highConfidence: predictions.models.filter((m) => m.confidence === "high").length,
      riskLevel: riskModel?.insight?.replace("Risk level: ", "") ?? "low",
      riskScore: riskModel?.current ?? 30,
    },
    warehouseForecasts: warehouseForecasts.forecasts,
    grantProbability: {
      portfolioScore: predictions.models.find((m) => m.id === "grant_success")?.current ?? 0,
      opportunities: grantScores,
    },
    cashFlow: predictions.models.find((m) => m.id === "cash_flow"),
    staffing: predictions.models.find((m) => m.id === "staffing"),
    volunteerUtilization: predictions.models.find((m) => m.id === "volunteers"),
    kpiTrends: predictions.models.filter((m) =>
      ["org_risk", "donations", "program_growth"].includes(m.id)
    ),
    grants: {
      activeAwards: grants.activeAwards,
      pipelineValue: grants.pipelineValue,
      winRate: grants.winRate,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function buildGrantProbabilityScores(): Promise<GrantProbabilityScore[]> {
  const db = await getDb();
  const grants = await buildGrantExecutiveDashboard();
  const baseProb = Math.min(95, Math.max(15, Math.round((grants.winRate || 0) * 0.85 + (grants.activeAwards > 0 ? 10 : 0))));

  const opps = (await db.all(
    `SELECT o.id, o.title, o.funder, o.deadline, o.amount_max, o.status,
      (SELECT COUNT(*) FROM grant_applications a WHERE a.opportunity_id = o.id) as app_count
     FROM grant_opportunities o
     WHERE o.status IN ('open', 'awarded')
     ORDER BY o.deadline ASC LIMIT 12`
  ).catch(() => [])) as {
    id: string; title: string; funder: string; deadline: string; amount_max: number; status: string; app_count: number;
  }[];

  return opps.map((o) => {
    const factors: string[] = [];
    let prob = baseProb;
    if (o.app_count > 0) { prob += 8; factors.push("Application in progress"); }
    if (o.amount_max >= 100000) { prob += 5; factors.push("High-value opportunity"); }
    if (o.status === "awarded") { prob = 100; factors.push("Awarded"); }
    const daysToDeadline = o.deadline ? Math.ceil((new Date(o.deadline).getTime() - Date.now()) / 86400000) : 999;
    if (daysToDeadline > 0 && daysToDeadline <= 30) { factors.push("Deadline within 30 days"); prob += 3; }
    if (daysToDeadline < 0) { factors.push("Past deadline"); prob -= 20; }
    return {
      opportunityId: o.id,
      title: o.title,
      funder: o.funder,
      probability: Math.min(100, Math.max(5, prob)),
      factors,
      deadline: o.deadline,
    };
  });
}

export async function buildCrossDivisionDataLayer() {
  const overview = await buildDivisionIntegrationOverview();
  const db = await getDb();

  const webhookCounts = (await db.all(
    `SELECT division_id, COUNT(*) as c, MAX(received_at) as last_received
     FROM hq_division_analytics_snapshots GROUP BY division_id`
  ).catch(() => [])) as { division_id: string; c: number; last_received: string }[];

  const webhookMap = Object.fromEntries(webhookCounts.map((w) => [w.division_id, w]));

  return {
    ...overview,
    dataLayer: {
      mode: "read_only",
      barbersProductionLocked: true,
      divisions: overview.divisions.map((d) => ({
        ...d,
        webhookSnapshots: webhookMap[d.id]?.c ?? 0,
        lastWebhookAt: webhookMap[d.id]?.last_received ?? null,
        dataSource: d.status === "production-locked"
          ? "health_poll_only"
          : webhookMap[d.id]?.c
            ? "webhook_ingest"
            : d.id === "housing" || d.id === "scholarships" || d.id === "community_programs"
              ? "hq_database"
              : "health_poll",
      })),
    },
    timestamp: new Date().toISOString(),
  };
}

export async function buildWorkflowAutomationStatus() {
  const instances = await listWorkflowInstances({ limit: 30 }).catch(() => []);
  const pending = instances.filter((i) => i.status === "pending" || i.status === "active");
  const overdue = pending.filter((i) => i.due_at && new Date(i.due_at) < new Date());

  const withSteps = await Promise.all(
    pending.slice(0, 5).map(async (inst) => {
      const steps = await getWorkflowSteps(inst.id).catch(() => [] as { status: string; step_name: string }[]);
      const activeStep = (steps as { status: string; step_name: string }[]).find((s) => s.status === "active");
      return {
        id: inst.id,
        title: inst.title,
        workflowKey: inst.workflow_key,
        status: inst.status,
        dueAt: inst.due_at,
        assignedTo: inst.assigned_to,
        activeStep: activeStep?.step_name ?? null,
        stepCount: steps.length,
        completedSteps: (steps as { status: string }[]).filter((s) => s.status === "completed").length,
      };
    })
  );

  return {
    totalInstances: instances.length,
    pending: pending.length,
    overdue: overdue.length,
    escalations: overdue.map((i) => ({
      id: i.id,
      title: i.title,
      workflowKey: i.workflow_key,
      dueAt: i.due_at,
      severity: "high",
    })),
    activeWorkflows: withSteps,
    schedulerActive: true,
    timestamp: new Date().toISOString(),
  };
}

export async function buildExecutiveReportingHub() {
  const reports = listRecentReports(15);
  return {
    oneClickReports: [
      { id: "board", label: "Board Report", endpoint: "/api/hq/intelligence/deliver/board-report", format: "pdf" },
      { id: "briefing", label: "Executive Briefing", endpoint: "/api/hq/intelligence/deliver/briefing", format: "pdf" },
      { id: "grants", label: "Grant Portfolio Summary", path: "/hq/grants?tab=analytics" },
      { id: "finance", label: "Financial Summary", path: "/hq/finance?tab=board" },
      { id: "programs", label: "Program Performance", path: "/hq/analytics?tab=programs" },
      { id: "compliance", label: "Compliance Report", path: "/hq/compliance" },
    ],
    recentReports: reports,
    timestamp: new Date().toISOString(),
  };
}

export async function buildUniversalSearchIndex(q: string) {
  const results = await enterpriseGlobalSearch(q);
  return {
    query: q,
    results,
    count: results.length,
    categories: {
      modules: results.filter((r) => r.type === "module").length,
      people: results.filter((r) => r.type === "person").length,
      grants: results.filter((r) => r.type === "grant" || r.type === "application" || r.type === "funder").length,
      finance: results.filter((r) => r.type === "invoice" || r.type === "expense").length,
      documents: results.filter((r) => r.type === "document").length,
    },
    timestamp: new Date().toISOString(),
  };
}

export async function buildPhase9OperatingSystemPackage() {
  const [commandCenter, predictive, divisions, workflows, reporting, notifications] = await Promise.all([
    buildPhase9CommandCenter(),
    buildPredictiveDashboard(),
    buildCrossDivisionDataLayer(),
    buildWorkflowAutomationStatus(),
    Promise.resolve(buildExecutiveReportingHub()),
    buildEnterpriseNotifications().catch(() => ({ notifications: [], unreadCount: 0 })),
  ]);

  return {
    phase: 9,
    platform: "IFCDC Intelligent Operating System",
    commandCenter,
    predictive,
    divisions,
    workflows,
    reporting,
    notifications: {
      unreadCount: notifications.unreadCount,
      highPriority: notifications.notifications.filter((n) => n.priority === "high" && !n.read).length,
      recent: notifications.notifications.slice(0, 12),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Timeout-safe Phase 9 package (production) ───────────────────────────────

const PHASE9_SECTION_TIMEOUT_MS = 3_000;
const PHASE9_AGGREGATE_TIMEOUT_MS = 4_000;

function p9Timeout<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
  const started = Date.now();
  return Promise.race([
    promise
      .then((result) => {
        console.info(`[phase9] ${label} ok (${Date.now() - started}ms)`);
        return result;
      })
      .catch((err) => {
        console.warn(`[phase9] ${label} failed (${Date.now() - started}ms):`, err instanceof Error ? err.message : err);
        return fallback;
      }),
    new Promise<T>((resolve) => {
      setTimeout(() => {
        console.warn(`[phase9] ${label} timed out after ${PHASE9_SECTION_TIMEOUT_MS}ms`);
        resolve(fallback);
      }, PHASE9_SECTION_TIMEOUT_MS);
    }),
  ]);
}

function p9AggregateTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch((err) => {
      console.error("[phase9] aggregate error:", err);
      return fallback;
    }),
    new Promise<T>((resolve) => {
      setTimeout(() => {
        console.warn(`[phase9] aggregate timed out after ${PHASE9_AGGREGATE_TIMEOUT_MS}ms`);
        resolve(fallback);
      }, PHASE9_AGGREGATE_TIMEOUT_MS);
    }),
  ]);
}

export function emptyPhase9CommandCenter() {
  return {
    briefing: {
      greeting: "Executive Command",
      highlights: [] as string[],
      priorities: [] as string[],
    },
    organizationHealth: { overall: 0, grade: "—", factors: [] },
    scorecard: { overall: 0, grade: "—", pillars: [], kpiAlerts: { critical: 0, watch: 0 }, timestamp: new Date().toISOString() },
    moduleMonitor: { modules: [] },
    recommendations: [] as { action: string; priority: string; module: string }[],
    riskAlerts: [] as { title: string; detail: string; severity: string; module?: string }[],
    complianceAlerts: { overdue: 0, dueNext14Days: 0, items: [] },
    generatedAt: new Date().toISOString(),
  };
}

export function emptyPredictiveDashboard() {
  return {
    models: [] as { id: string; label: string; current: number; projected30d: number; trend: string; unit: string }[],
    summary: { modelCount: 0, highConfidence: 0, riskLevel: "low", riskScore: 0 },
    warehouseForecasts: [],
    grantProbability: { portfolioScore: 0, opportunities: [] as GrantProbabilityScore[] },
    cashFlow: undefined,
    staffing: undefined,
    volunteerUtilization: undefined,
    kpiTrends: [],
    grants: { activeAwards: 0, pipelineValue: 0, winRate: 0 },
    generatedAt: new Date().toISOString(),
  };
}

export function emptyCrossDivisionDataLayer() {
  return {
    divisions: [] as { name: string; status: string; healthy: boolean }[],
    counts: { total: 0, healthy: 0, productionLocked: 0 },
    headquartersRole: "single_source_of_truth" as const,
    integrationMode: "read_only" as const,
    barbersProductionLocked: true,
    dataLayer: {
      mode: "read_only" as const,
      barbersProductionLocked: true,
      divisions: [] as { name: string; status: string; healthy: boolean; dataSource: string }[],
    },
    timestamp: new Date().toISOString(),
  };
}

export function emptyWorkflowAutomationStatus() {
  return {
    totalInstances: 0,
    pending: 0,
    overdue: 0,
    escalations: [] as { id: string; title: string; workflowKey: string; dueAt: string | null; severity: string }[],
    activeWorkflows: [] as {
      id: string;
      title: string;
      workflowKey: string;
      status: string;
      dueAt: string | null;
      assignedTo: string | null;
      activeStep: string | null;
      stepCount: number;
      completedSteps: number;
    }[],
    schedulerActive: true,
    timestamp: new Date().toISOString(),
  };
}

export function emptyExecutiveReportingHub() {
  return {
    oneClickReports: [
      { id: "board", label: "Board Report", path: "/hq/reports" },
      { id: "briefing", label: "Executive Briefing", path: "/hq/reports" },
      { id: "grants", label: "Grant Portfolio Summary", path: "/hq/grants?tab=analytics" },
      { id: "finance", label: "Financial Summary", path: "/hq/finance?tab=board" },
    ],
    recentReports: [] as { filename: string; path: string; mtime: string }[],
    timestamp: new Date().toISOString(),
  };
}

export function emptyPhase9Notifications() {
  return { notifications: [] as unknown[], unreadCount: 0, highPriority: 0, recent: [] as unknown[] };
}

export function emptyPhase9OperatingSystemPackage() {
  return {
    phase: 9,
    platform: "IFCDC Intelligent Operating System",
    commandCenter: emptyPhase9CommandCenter(),
    predictive: emptyPredictiveDashboard(),
    divisions: emptyCrossDivisionDataLayer(),
    workflows: emptyWorkflowAutomationStatus(),
    reporting: emptyExecutiveReportingHub(),
    notifications: emptyPhase9Notifications(),
    degraded: true,
    warning: "Phase 9 package returned safe defaults — live intelligence sources were slow or unavailable.",
    generatedAt: new Date().toISOString(),
  };
}

async function buildPhase9OperatingSystemPackageBounded() {
  console.info("[phase9] package build start");
  type CommandCenter = Awaited<ReturnType<typeof buildPhase9CommandCenter>>;
  type Predictive = Awaited<ReturnType<typeof buildPredictiveDashboard>>;
  type Divisions = Awaited<ReturnType<typeof buildCrossDivisionDataLayer>>;
  type Workflows = Awaited<ReturnType<typeof buildWorkflowAutomationStatus>>;
  type Reporting = Awaited<ReturnType<typeof buildExecutiveReportingHub>>;

  const [commandCenter, predictive, divisions, workflows, reporting, notifications] = await Promise.all([
    p9Timeout(buildPhase9CommandCenter(), emptyPhase9CommandCenter() as unknown as CommandCenter, "command-center"),
    p9Timeout(buildPredictiveDashboard(), emptyPredictiveDashboard() as unknown as Predictive, "predictive"),
    p9Timeout(buildCrossDivisionDataLayer(), emptyCrossDivisionDataLayer() as unknown as Divisions, "divisions"),
    p9Timeout(buildWorkflowAutomationStatus(), emptyWorkflowAutomationStatus() as unknown as Workflows, "workflows"),
    p9Timeout(Promise.resolve(buildExecutiveReportingHub()), emptyExecutiveReportingHub() as unknown as Reporting, "reporting"),
    p9Timeout(
      buildEnterpriseNotifications()
        .then((n) => ({
          unreadCount: n.unreadCount,
          highPriority: n.notifications.filter((x) => x.priority === "high" && !x.read).length,
          recent: n.notifications.slice(0, 12),
        }))
        .catch(() => emptyPhase9Notifications()),
      emptyPhase9Notifications(),
      "notifications"
    ),
  ]);

  const degraded = divisions.dataLayer.divisions.length === 0 && predictive.models.length === 0;

  return {
    phase: 9,
    platform: "IFCDC Intelligent Operating System",
    commandCenter,
    predictive,
    divisions,
    workflows,
    reporting,
    notifications,
    degraded,
    warning: degraded
      ? "Some intelligence sources were slow — dashboard may show partial data. Refresh to retry."
      : null,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildPhase9OperatingSystemPackageSafe() {
  const started = Date.now();
  type Package = Awaited<ReturnType<typeof buildPhase9OperatingSystemPackageBounded>>;
  try {
    const payload = await p9AggregateTimeout(
      buildPhase9OperatingSystemPackageBounded(),
      emptyPhase9OperatingSystemPackage() as unknown as Package
    );
    console.info(`[phase9] package build finished (${Date.now() - started}ms, degraded=${Boolean((payload as { degraded?: boolean }).degraded)})`);
    return payload;
  } catch (err) {
    console.error("[phase9] package build fatal:", err);
    return emptyPhase9OperatingSystemPackage();
  }
}
