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

export interface ExecutiveOverview {
  organizationHealthScore: number;
  organizationHealth?: {
    overall: number;
    grade: string;
    factors: { label: string; score: number; max: number; weight: string }[];
  };
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

const AURA_COMMAND_TIMEOUT_MS = 120_000;

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
  auraExecutiveActionPlan: () => hqFetch<{ plan: string; summary: Record<string, unknown>; generatedAt: string }>("/aura/executive/action-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  auraNavigate: (query: string) => hqFetch<{
    intent: string; path?: string; label?: string; message: string;
    results?: { type: string; id: string; title: string; subtitle: string; path: string }[];
  }>("/aura/navigate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) }),
  softwareDivisionFramework: () => hqFetch<SoftwareDivisionFramework>("/software-division/framework"),
  appDiagnostics: (appId: string) => hqFetch<AppDiagnostics>(`/software-division/${appId}/diagnostics`),
  allDiagnostics: () => hqFetch<{ diagnostics: AppDiagnostics[] }>("/software-division/diagnostics"),
  auraStatus: () => hqFetch<{ auraCore: boolean; capabilities: string[] }>("/aura/status"),
  auraCommand: (command: string, opts?: { module?: string; contextRef?: Record<string, unknown> }) =>
    hqFetch<AuraCommandResponse>("/aura/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, module: opts?.module, contextRef: opts?.contextRef }),
      timeoutMs: AURA_COMMAND_TIMEOUT_MS,
    }),
  auraAction: (
    actionId: string,
    opts?: { args?: Record<string, unknown>; module?: string; contextRef?: Record<string, unknown> }
  ) =>
    hqFetch<AuraCommandResponse>(`/aura/action/${actionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: opts?.args ?? {}, module: opts?.module, contextRef: opts?.contextRef }),
      timeoutMs: AURA_COMMAND_TIMEOUT_MS,
    }),
  auraActions: () => hqFetch<{ actions: AuraActionCatalogItem[] }>("/aura/actions"),
  auraMemory: () => hqFetch<{ turns: AuraMemoryTurn[] }>("/aura/memory"),
  auraMemoryReset: () =>
    hqFetch<{ cleared: number }>("/aura/memory/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
};
