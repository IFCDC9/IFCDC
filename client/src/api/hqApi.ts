export interface OrganizationMetrics {
  totalEmployees: number;
  activeEmployees: number;
  activeVolunteers: number;
  activeGrants: number;
  donationRevenue: number;
  monthlyDonations: number;
  monthlyExpenses: number;
  programsRunning: number;
}

export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  timestamp: string;
  amount?: number;
}

export interface CommandHealthPillar {
  id: "organization" | "system" | "financial" | "operational" | "security" | "integration";
  label: string;
  score: number;
  grade: string;
  meta: string;
  status: "good" | "watch" | "critical" | "unknown";
}

export interface ExecutiveCommandHealth {
  overall: number;
  grade: string;
  pillars: CommandHealthPillar[];
  monitoredAt: string;
  source: "live";
}

export interface ExecutiveOverview {
  organizationHealthScore: number;
  organizationHealth?: {
    overall: number;
    grade: string;
    factors: { label: string; score: number; max: number; weight: string }[];
  };
  /** Six live command pillars (org / system / financial / operational / security / integration). */
  commandHealth?: ExecutiveCommandHealth | null;
  metrics: OrganizationMetrics;
  monthlyTrend: { month: string; donations: number; expenses: number }[];
  recentActivity: ActivityItem[];
  softwareDivision: {
    total: number;
    healthy: number;
    operational?: number;
    polledHealthy?: number;
    production: number;
    inDevelopment: number;
  };
  platformServices: {
    total: number;
    healthy: number;
    details: Record<string, boolean>;
  };
  degraded?: boolean;
  warning?: string | null;
  timestamp: string;
}

export interface SoftwareAppHealth {
  id: string;
  healthy: boolean;
  latencyMs: number;
  data?: Record<string, unknown>;
  error?: string;
}

export interface SoftwareAppEntry {
  id: string;
  name: string;
  description: string;
  status: string;
  version?: string;
  locked?: boolean;
  launchUrl?: string;
  registered?: boolean;
  apiKeyPrefix?: string;
  onboardedAt?: string;
  health?: SoftwareAppHealth;
}

export interface AppDiagnostics {
  appId: string;
  appName: string;
  timestamp: string;
  overall: "healthy" | "degraded" | "offline";
  health: { healthy: boolean; latencyMs: number; version?: string; deployment?: string; error?: string; url: string };
  deployment: { status: string; environment: string; registered: boolean; apiKeyPrefix?: string; onboardedAt?: string };
  sdkCompatibility: { requiredSdk: string; platformVersion: string; compatible: boolean; inheritedServices: string[]; message: string };
  inheritedServices: { id: string; name: string; endpoint: string; available: boolean }[];
  recommendations: string[];
}

export interface SoftwareDivisionFramework {
  platform: string;
  version: string;
  principles: string[];
  inheritedServices: { id: string; name: string; description: string; endpoint: string; scopes: string[] }[];
  apps: {
    appId: string;
    appName: string;
    status: string;
    locked: boolean;
    independentlyDeployable: true;
    inheritedServices: string[];
    integrationEndpoints: Record<string, string>;
    requiredHeaders: string[];
    analyticsWebhook?: string;
  }[];
  barbersProductionLocked: boolean;
  timestamp: string;
}

export interface AuraExecutedAction {
  id: string;
  label: string;
  status: "done" | "prepared" | "pending_approval" | "error";
  summary: string;
  data?: unknown;
  navigation?: { path: string; label: string };
  approval?: { path: string; label: string };
}

export interface AuraCommandResponse {
  reply: string;
  actions: AuraExecutedAction[];
  navigation?: { path: string; label: string };
  approvalsCreated: Array<{ path: string; label: string }>;
  poweredBy: string;
  enterpriseJobId?: string;
  identity?: {
    founderMode: boolean;
    isFounder: boolean;
    displayName: string | null;
    email: string | null;
    enterpriseRole: string;
    enterpriseRoleLabel: string;
    assurance: string;
    channel: string;
    modules: string[];
    verifiedAt: string | null;
    trustedDevice?: boolean;
    seamless?: boolean;
  };
}

export interface AuraActionCatalogItem {
  id: string;
  label: string;
  module: string;
  kind: "read" | "prepare" | "mutating";
  description: string;
}

export interface AuraMemoryTurn {
  id: string;
  module: string | null;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

import { hqApiFetch } from "./hqApiFetch";
import { EXECUTIVE_OVERVIEW_FETCH_TIMEOUT_MS } from "../data/founderDashboardDefaults";
import { getOrCreateFounderDeviceId } from "../lib/founderTrustedDevice";

const AURA_COMMAND_TIMEOUT_MS = 45_000;

function auraDeviceHeaders(): Record<string, string> {
  try {
    const id = getOrCreateFounderDeviceId();
    return { "X-Aura-Device-Id": id };
  } catch {
    return {};
  }
}

async function hqFetch<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...init } = options ?? {};
  return hqApiFetch<T>(`/api/hq${path}`, { ...init, timeoutMs });
}

export const hqApi = {
  executiveOverview: () =>
    hqFetch<ExecutiveOverview>("/executive/overview", { timeoutMs: EXECUTIVE_OVERVIEW_FETCH_TIMEOUT_MS }),
  softwareDivision: () => hqFetch<{ apps: SoftwareAppEntry[] }>("/software-division"),
  auraChat: (message: string, context?: string, mode?: string) =>
    hqFetch<{ response: string }>("/aura/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, context, mode }),
    }),
  auraSummarize: (reportType?: "full" | "financial" | "grants" | "operations") =>
    hqFetch<{ summary: string; reportType: string; generatedAt: string }>("/aura/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportType: reportType ?? "full" }),
    }),
  auraRecommend: () =>
    hqFetch<{ recommendations: string; generatedAt: string }>("/aura/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  auraForecast: () =>
    hqFetch<{ forecast: string; trends: Record<string, unknown>; generatedAt: string }>("/aura/forecast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  auraCompliance: () =>
    hqFetch<{ review: string; generatedAt: string }>("/aura/compliance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  auraBriefing: (focus?: "daily" | "board") =>
    hqFetch<{ briefing: string; focus: string; generatedAt: string }>("/aura/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ focus: focus ?? "daily" }),
    }),
  auraSearch: (query: string) =>
    hqFetch<{ results: { module: string; id: string; title: string; subtitle: string; path: string }[]; query: string }>("/aura/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }),
  auraDepartments: () => hqFetch<{ summary: string; generatedAt: string }>("/aura/departments"),
  auraAnomalies: () => hqFetch<{ anomalies: { module: string; severity: string; title: string; detail: string }[]; scannedAt: string }>("/aura/anomalies"),
  auraFinancialRisk: () => hqFetch<{ riskScore: number; riskLevel: string; factors: string[]; recommendations: string[] }>("/aura/financial-risk"),
  auraComplianceTracker: () => hqFetch<{ totalDue: number; overdue: number; dueNext14Days: number; deadlines: Record<string, unknown>[] }>("/aura/compliance-tracker"),
  auraExecutiveSummary: () => hqFetch<{ summary: string; generatedAt: string }>("/aura/executive-summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  auraEnterpriseAsk: (question: string, context?: string) =>
    hqFetch<{ answer: string; sources: string[]; generatedAt: string }>("/aura/enterprise/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, context }),
    }),
  auraEnterpriseInsights: () => hqFetch<Record<string, unknown>>("/aura/enterprise/insights"),
  auraEnterpriseBoardReport: () => hqFetch<Record<string, unknown>>("/aura/enterprise/board-report"),
  auraOperationsAsk: (question: string, module?: string) =>
    hqFetch<{ answer: string; modules: string[]; generatedAt: string }>("/aura/operations/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, module }),
    }),
  auraOperationsBriefing: () => hqFetch<Record<string, unknown>>("/aura/operations/briefing"),
  auraExecutiveHealth: () => hqFetch<Record<string, unknown>>("/aura/executive/health"),
  /** Build 61 — Executive Intelligence Command Center */
  auraEiDashboard: () => hqFetch<Record<string, unknown>>("/aura/ei/dashboard"),
  auraEiRecommendations: () => hqFetch<{ recommendations: Record<string, unknown>[]; generatedAt: string }>("/aura/ei/recommendations"),
  auraEiHealthPillar: (pillar: string) => hqFetch<Record<string, unknown>>(`/aura/ei/health/${encodeURIComponent(pillar)}`),
  auraEiBriefing: (type: string) => hqFetch<Record<string, unknown>>(`/aura/ei/briefings/${encodeURIComponent(type)}`),
  auraEiPredictions: () => hqFetch<Record<string, unknown>>("/aura/ei/predictions"),
  auraEiAsk: (question: string) =>
    hqFetch<{
      question: string;
      answer: string;
      source: string;
      knowledgeUsed: number;
      knowledge: Record<string, unknown>[];
      healthSnapshot: Record<string, unknown> | null;
      generatedAt: string;
    }>("/aura/ei/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  auraExecutiveActionPlan: () => hqFetch<{ plan: string; summary: Record<string, unknown>; generatedAt: string }>("/aura/executive/action-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  auraIntelligenceMetrics: () => hqFetch<Record<string, unknown>>("/aura/intelligence/metrics"),
  auraDecisionSupport: (question: string) =>
    hqFetch<Record<string, unknown>>("/aura/intelligence/decision-support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  auraOrgMemory: (query: string) =>
    hqFetch<Record<string, unknown>>("/aura/intelligence/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }),
  auraProactiveScan: (notifyFounderChannels = false) =>
    hqFetch<{ evaluated: number; emitted: number; skipped: number; alerts: unknown[] }>("/aura/intelligence/proactive-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifyFounderChannels }),
    }),
  auraTechnicalBriefing: () => hqFetch<Record<string, unknown>>("/aura/technical/briefing"),
  auraExecutiveAgents: () => hqFetch<{ agents: Array<{ id: string; title: string; role: string }> }>("/aura/agents"),
  auraOrchestrateAgents: (request: string) =>
    hqFetch<Record<string, unknown>>("/aura/agents/orchestrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
    }),
  /** AURA Enterprise Brain v1 — Executive Command Center (Founder-only, read-only). */
  auraBrainV1CommandCenter: () =>
    hqFetch<{
      module: string;
      version: string;
      generatedAt: string;
      mode: "read_only";
      lastLoginAt: string | null;
      answers: {
        needsAttention: Array<{ id: string; severity: string; title: string; detail: string; path?: string; source: string }>;
        changedSinceLastLogin: Array<{ id: string; severity: string; title: string; detail: string; path?: string; source: string }>;
        systemsHealthy: Array<{ id: string; label: string; status: string; detail: string }>;
        systemsRequireAction: Array<{ id: string; label: string; status: string; detail: string }>;
        activeProjects: Array<{ id: string; name: string; status: string; healthy: boolean | null; detail: string }>;
        deploymentsPending: Array<{ id: string; name: string; status: string; healthy: boolean | null; detail: string }>;
        emailsFailed: Array<{ id: string; severity: string; title: string; detail: string; path?: string; source: string }>;
        doNext: string[];
      };
      summary: {
        attentionCount: number;
        changeCount: number;
        healthySystemCount: number;
        actionSystemCount: number;
        activeProjectCount: number;
        pendingDeployCount: number;
        failedEmailCount: number;
        commandHealthOverall: number | null;
        emailConfigured: boolean;
        emailFrom: string | null;
      };
      moduleRoadmap: Array<{ id: number; name: string; status: "live" | "planned" }>;
      degraded: boolean;
      warning: string | null;
    }>("/aura/brain-v1/command-center", { timeoutMs: 45_000 }),
  auraBrainV1OrgHealth: () =>
    hqFetch<{
      module: string;
      version: string;
      generatedAt: string;
      mode: "read_only";
      overall: number | null;
      grade: string;
      factors: Array<{ label: string; score: number; max: number; weight: string; status: string }>;
      commandPillars: Array<{ id: string; label: string; score: number; grade: string; status: string; meta: string }>;
      highlights: string[];
      watchItems: string[];
      degraded: boolean;
      warning: string | null;
      moduleRoadmap: Array<{ id: number; name: string; status: "live" | "planned" }>;
    }>("/aura/brain-v1/org-health", { timeoutMs: 45_000 }),
  auraBrainV1DailyBriefing: () =>
    hqFetch<{
      module: string;
      version: string;
      generatedAt: string;
      mode: "read_only";
      title: string;
      date: string | null;
      content: string;
      highlights: string[];
      brainHighlights: string[];
      cached: boolean;
      source: string;
      degraded: boolean;
      warning: string | null;
      moduleRoadmap: Array<{ id: number; name: string; status: "live" | "planned" }>;
    }>("/aura/brain-v1/daily-briefing", { timeoutMs: 60_000 }),
  auraBrainV1Projects: () =>
    hqFetch<{
      module: string;
      version: string;
      generatedAt: string;
      mode: "read_only";
      projects: Array<{
        id: string;
        name: string;
        status: string;
        priority: number;
        healthy: boolean | null;
        latencyMs: number | null;
        detail: string;
        path: string;
      }>;
      summary: { total: number; productionLike: number; pending: number; unhealthy: number };
      degraded: boolean;
      warning: string | null;
      moduleRoadmap: Array<{ id: number; name: string; status: "live" | "planned" }>;
    }>("/aura/brain-v1/projects", { timeoutMs: 45_000 }),
  auraBrainV1SystemHealth: () =>
    hqFetch<{
      module: string;
      version: string;
      generatedAt: string;
      mode: "read_only";
      overallScore: number | null;
      overallStatus: string;
      components: Array<{ id: string; label: string; status: string; score: number; detail: string }>;
      alerts: Array<{ id: string; severity: string; title: string; detail: string; path?: string }>;
      degraded: boolean;
      warning: string | null;
      moduleRoadmap: Array<{ id: number; name: string; status: "live" | "planned" }>;
    }>("/aura/brain-v1/system-health", { timeoutMs: 45_000 }),
  auraBrainV1PriorityQueue: () =>
    hqFetch<{
      module: string;
      version: string;
      generatedAt: string;
      mode: "read_only";
      items: Array<{ id: string; severity: string; title: string; detail: string; path?: string; source: string }>;
      summary: { total: number; critical: number; high: number; watch: number };
      degraded: boolean;
      warning: string | null;
      moduleRoadmap: Array<{ id: number; name: string; status: "live" | "planned" }>;
    }>("/aura/brain-v1/priority-queue", { timeoutMs: 45_000 }),
  auraBrainV1Actions: () =>
    hqFetch<{
      module: string;
      version: string;
      generatedAt: string;
      mode: "read_only";
      actions: Array<{
        id: string;
        label: string;
        description: string;
        changesProduction: boolean;
        confirmRequired: boolean;
        href?: string;
        command?: string;
      }>;
      note: string;
      moduleRoadmap: Array<{ id: number; name: string; status: "live" | "planned" }>;
    }>("/aura/brain-v1/actions"),
  auraBrainV1ExecuteAction: (actionId: string, confirmed: boolean) =>
    hqFetch<{ ok: boolean; error?: string; result?: string; href?: string }>("/aura/brain-v1/actions/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId, confirmed }),
    }),
  auraBrainV1ActionLog: (limit = 50) =>
    hqFetch<{
      module: string;
      version: string;
      generatedAt: string;
      mode: "read_only";
      entries: Array<{
        id: string;
        createdAt: string;
        userId: string | null;
        userEmail: string | null;
        command: string;
        result: string;
      }>;
      summary: { totalReturned: number };
      moduleRoadmap: Array<{ id: number; name: string; status: "live" | "planned" }>;
    }>(`/aura/brain-v1/action-log?limit=${limit}`),
  auraE2eDiagnostics: () =>
    hqFetch<{
      generatedAt: string;
      mode: "read_only";
      twilioConfigUntouched: true;
      summary: {
        connected: number;
        partial: number;
        missing: number;
        unsafe: number;
        actionCatalog: { total: number; read: number; prepare: number; execute: number };
      };
      identity: {
        founderMode: boolean;
        isFounder: boolean;
        email: string | null;
        assurance: string | null;
      };
      probes: Array<{
        id: string;
        area: string;
        label: string;
        status: "connected" | "partial" | "missing" | "unsafe";
        detail: string;
        route?: string;
        files?: string[];
        env?: string[];
        tables?: string[];
        risk?: "low" | "medium" | "high";
        touchesTwilioConfig?: boolean;
      }>;
      webhookUrls: Record<string, string>;
      publicBaseUrl: string;
      note: string;
    }>("/aura/diagnostics/e2e"),
  auraEnterpriseBrain: (request: string) =>
    hqFetch<Record<string, unknown>>("/aura/brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
    }),
  auraEnterpriseBrainOrgModel: () => hqFetch<Record<string, unknown>>("/aura/brain/org-model"),
  auraEnterpriseBrainDailyBriefing: () => hqFetch<Record<string, unknown>>("/aura/brain/daily-briefing"),
  auraEnterpriseBrainPredictions: () =>
    hqFetch<{ predictions: Array<Record<string, unknown>> }>("/aura/brain/predictions"),
  auraEnterpriseBrainFeedback: (body: {
    brainRunId?: string;
    feedbackType: "approved" | "rejected" | "correction" | "useful" | "not_useful";
    rating?: number;
    note?: string;
    decisionRef?: string;
  }) =>
    hqFetch<{ ok: boolean; id: string }>("/aura/brain/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  auraEdiDashboard: () => hqFetch<{
    generatedAt: string;
    brainVersion?: string;
    organizationHealth: number | null;
    healthGrade: string | null;
    enterpriseHealthScore: number | null;
    enterpriseGrade: string;
    strategicGoals: Array<{
      id: string;
      category: string;
      title: string;
      progressPercent: number;
      status: string;
      blockers: string[];
      recommendedActions: string[];
      owner: string;
      department?: string;
    }>;
    goalsSummary: { onTrack: number; atRisk: number; blocked: number; achieved: number; avgProgress: number };
    fundingPipeline: { pipelineValue: number | null; activeAwards: number | null };
    financialPosition: { cashFlow: number | null; financialHealthScore: number | null; budgetRemaining: number | null };
    activeRisks: Array<{ id: string; title: string; whyItMatters: string; confidence: string; recommendedAction: string }>;
    opportunities: Array<{ id: string; title: string; whyItMatters: string; recommendedNextStep: string; expectedBenefit?: string }>;
    founderPriorities: string[];
    executiveAlerts?: Array<{ id: string; severity: string; title: string; detail: string; requiresFounderAttention: boolean }>;
    auraRecommendations: string[];
    orgModel?: { technology?: { healthScore?: number | null } };
    scorecard?: { dimensions: Array<{ id: string; label: string; score: number | null; grade: string; evidence?: string[]; gap?: string }> };
  }>("/aura/edi/dashboard"),
  auraEdiDecide: (request: string) =>
    hqFetch<{ kind: string; brainVersion?: string; speechSummary: string; unifiedBriefing: string; founderApprovalRequired: boolean; payload: unknown }>(
      "/aura/edi/decide",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request }),
      }
    ),
  auraEdiSimulate: (request: string) =>
    hqFetch<Record<string, unknown>>("/aura/edi/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
    }),
  auraEdiWeeklyReview: () => hqFetch<Record<string, unknown>>("/aura/edi/weekly-review"),
  auraEdiGoals: () => hqFetch<Record<string, unknown>>("/aura/edi/goals"),
  auraEdiScorecard: () => hqFetch<Record<string, unknown>>("/aura/edi/scorecard"),
  auraOsMissionControl: () => hqFetch<{
    osVersion?: string;
    brainVersion?: string;
    organizationHealth: number | null;
    enterpriseHealthScore: number | null;
    enterpriseGrade: string | null;
    fundingPipeline: { pipelineValue: number | null; activeAwards: number | null };
    financialHealth: { cashFlow: number | null; financialHealthScore: number | null; budgetRemaining: number | null };
    grantStatus: string;
    hrStatus: string;
    operations: string;
    softwareHealth: { score: number | null; label: string | null; deployAligned: boolean | null };
    security: string;
    compliance: { overdue: number; dueNext14Days: number };
    activeRisks: Array<{ id: string; title: string; confidence: string }>;
    opportunities: Array<{ id: string; title: string }>;
    founderPriorities: string[];
    liveAlerts: Array<{ id: string; title: string; explanation: string; severity: string; preparedWork: string[]; founderApprovalRequired: boolean }>;
    preparedActions: Array<{ id: string; title: string; explanation: string; preparedWork: string[]; founderApprovalRequired: boolean }>;
    pendingApprovals: number;
  }>("/aura/os/mission-control"),
  auraOsRun: (request: string) =>
    hqFetch<{ kind: string; osVersion?: string; speechSummary: string; unifiedBriefing: string; founderApprovalRequired: boolean; payload: unknown }>(
      "/aura/os/run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request }),
      }
    ),
  auraOsKnowledgeGraph: () =>
    hqFetch<{
      nodes: Array<{ id: string; type: string; label: string; meta?: string }>;
      edges: Array<{ id: string; from: string; to: string; relation: string; evidence: string }>;
      gaps: string[];
    }>("/aura/os/knowledge-graph"),
  auraOsSearch: (question: string) =>
    hqFetch<Record<string, unknown>>("/aura/os/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  auraOs5CommandCenter: () =>
    hqFetch<{
      eoVersion: string;
      osVersion?: string;
      brainVersion?: string;
      generatedAt: string;
      organizationHealth: number | null;
      enterpriseGrade: string | null;
      strategicGoals: { total: number; atRisk: number; items: Array<{ title: string; progressPercent: number; status: string }> };
      activeProjects: { count: number; source: string };
      fundingPipeline: { pipelineValue: number | null; activeAwards: number | null };
      financialHealth: { cashFlow: number | null; financialHealthScore: number | null; budgetRemaining: number | null };
      hrStatus: string;
      technologyStatus: {
        score: number | null;
        label: string | null;
        deployAligned: boolean | null;
        seHostMode?: string;
        unhealthyApps: number;
      };
      compliance: { overdue: number; dueNext14Days: number };
      criticalAlerts: Array<{ id: string; title: string; explanation?: string; severity: string }>;
      founderApprovalsWaiting: number;
      opsRuns: Array<{
        id: string;
        title: string;
        status: string;
        executiveSummary: string;
        founderApprovalRequired: boolean;
        steps: Array<{ id: string; department: string; title: string; status: string; path: string }>;
        createdAt: string;
      }>;
      cadences: Array<{ id: string; label: string; schedule: string; description: string }>;
      continuousImprovement: Array<{
        id: string;
        category: string;
        title: string;
        evidence: string;
        recommendation: string;
        priority: string;
        path: string;
      }>;
      deepLinks: Array<{ label: string; path: string }>;
      policy: { externalDistributionRequiresFounderApproval: boolean; highImpactRequiresFounderApproval: boolean };
    }>("/aura/os5/command-center"),
  auraOs5Run: (request: string) =>
    hqFetch<{
      eoVersion: string;
      speechSummary: string;
      founderApprovalRequired: boolean;
      opsRun?: { id: string; title: string; status: string; executiveSummary: string };
      cadence?: { ok: boolean; prepId?: string; error?: string };
    }>("/aura/os5/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
    }),
  auraOs5ApproveOpsRun: (id: string, note?: string) =>
    hqFetch<{ ok: boolean; run?: unknown; error?: string }>(`/aura/os5/ops-runs/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    }),
  auraOs5PrepareCadence: (id: string) =>
    hqFetch<{ ok: boolean; prepId?: string; package?: { title: string; speechSummary: string; content: string }; error?: string }>(
      `/aura/os5/cadences/${id}/prepare`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
    ),
  auraNavigate: (query: string) => hqFetch<{
    intent: string; path?: string; label?: string; message: string;
    results?: { type: string; id: string; title: string; subtitle: string; path: string }[];
  }>("/aura/navigate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) }),
  softwareDivisionFramework: () => hqFetch<SoftwareDivisionFramework>("/software-division/framework"),
  appDiagnostics: (appId: string) => hqFetch<AppDiagnostics>(`/software-division/${appId}/diagnostics`),
  allDiagnostics: () => hqFetch<{ diagnostics: AppDiagnostics[] }>("/software-division/diagnostics"),
  auraStatus: () => hqFetch<{ auraCore: boolean; capabilities: string[] }>("/aura/status"),
  auraCommand: (command: string, opts?: { module?: string; contextRef?: Record<string, unknown> }) => {
    const deviceId = getOrCreateFounderDeviceId();
    return hqFetch<AuraCommandResponse>("/aura/command", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auraDeviceHeaders() },
      body: JSON.stringify({ command, module: opts?.module, contextRef: opts?.contextRef, deviceId }),
      timeoutMs: AURA_COMMAND_TIMEOUT_MS,
    });
  },
  auraAction: (
    actionId: string,
    opts?: { args?: Record<string, unknown>; module?: string; contextRef?: Record<string, unknown> }
  ) => {
    const deviceId = getOrCreateFounderDeviceId();
    return hqFetch<AuraCommandResponse>(`/aura/action/${actionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auraDeviceHeaders() },
      body: JSON.stringify({
        args: opts?.args ?? {},
        module: opts?.module,
        contextRef: opts?.contextRef,
        deviceId,
      }),
      timeoutMs: AURA_COMMAND_TIMEOUT_MS,
    });
  },
  auraActions: () => hqFetch<{ actions: AuraActionCatalogItem[] }>("/aura/actions"),
  auraMemory: () => hqFetch<{ turns: AuraMemoryTurn[] }>("/aura/memory"),
  auraIdentity: () => {
    const deviceId = getOrCreateFounderDeviceId();
    const qs = encodeURIComponent(deviceId);
    return hqFetch<{
      identity: {
        founderMode: boolean;
        isFounder: boolean;
        displayName: string | null;
        email: string | null;
        enterpriseRole: string;
        enterpriseRoleLabel: string;
        assurance: string;
        channel: string;
        modules: string[];
        verifiedAt: string | null;
        trustedDevice?: boolean;
        seamless?: boolean;
      };
      device?: { trusted: boolean; biometricBound: boolean; expiresAt: string | null };
    }>(`/aura/identity?deviceId=${qs}`, { headers: auraDeviceHeaders() });
  },
  auraTrustDevice: (opts?: { label?: string; biometricBound?: boolean }) => {
    const deviceId = getOrCreateFounderDeviceId();
    return hqFetch<{
      ok: boolean;
      deviceId: string;
      expiresAt: string;
      message: string;
      identity?: AuraCommandResponse["identity"];
    }>("/aura/identity/trust-device", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auraDeviceHeaders() },
      body: JSON.stringify({
        deviceId,
        label: opts?.label || "Founder HQ browser",
        biometricBound: Boolean(opts?.biometricBound),
      }),
    });
  },
  auraMemoryReset: () =>
    hqFetch<{ cleared: number }>("/aura/memory/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
};
