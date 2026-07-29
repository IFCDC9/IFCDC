import { hqApiFetch } from "./hqApiFetch";
import { INTEGRATIONS_HUB_FETCH_TIMEOUT_MS } from "../data/integrationsHubDefaults";
import type { IntegrationsHubPayload, IntegrationHubCard, IntegrationHubAction } from "../data/integrationsHubDefaults";

async function apiFetch<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...init } = options ?? {};
  return hqApiFetch<T>(`/api/hq/integrations${path}`, { ...init, timeoutMs });
}

export interface IntegrationCatalogItem {
  id: string;
  name: string;
  category: string;
  description: string;
  status: "available" | "coming_soon" | "configured";
  configFields: string[];
}

export interface IntegrationConnection {
  provider: string;
  enabled: boolean;
  status: string;
  configuredAt?: string;
}

export type IntegrationProbeLogEntry = {
  at: string;
  provider: string;
  ok: boolean;
  latencyMs: number;
  message: string;
  errorCode?: string;
  rootCause?: string;
};

export type IntegrationOpsMetrics = {
  uptime24hPct: number | null;
  uptime7dPct: number | null;
  successFailureTrend: { at: string; ok: boolean; latencyMs: number }[];
  responseTimeHistoryMs: number[];
  last10SyncEvents: IntegrationProbeLogEntry[];
  failedRequestCount: number;
  lastSuccessfulSync: string | null;
  authStatus: "authenticated" | "partial" | "missing" | "unknown";
  environmentName: string;
  productionVsTest: "production" | "test" | "mixed" | "unknown";
  serviceOwner: string;
  credentialExpirationWarning: string | null;
  connectedEnvironment: string;
};

export type IntegrationHealthService = {
  id: string;
  name: string;
  category: string;
  displayStatus: "Connected" | "Warning" | "Disconnected";
  status: string;
  healthy: boolean;
  latencyMs: number | null;
  lastChecked: string | null;
  message: string;
  ops?: IntegrationOpsMetrics;
};

export type IntegrationHealthDashboard = {
  overallHealthScore: number;
  overallLabel: string;
  connectedCount: number;
  warningCount: number;
  offlineCount: number;
  totalServices: number;
  lastSuccessfulSync: string | null;
  avgLatencyMs: number | null;
  failedRequests: number;
  uptimeSeconds: number;
  uptimeLabel: string;
  uptime24hPct: number | null;
  uptime7dPct: number | null;
  successFailureTrend: { at: string; ok: number; fail: number }[];
  responseTimeHistoryMs: number[];
  last10SyncEvents: IntegrationProbeLogEntry[];
  services: IntegrationHealthService[];
  recentFailures: IntegrationProbeLogEntry[];
  startupVerifiedAt: string | null;
  monitoredAt: string;
  source: "live";
  environmentName?: string;
  productionVsTest?: "production" | "test" | "mixed";
};

export type IntegrationLiveDetail = {
  ok: boolean;
  service: IntegrationHealthService | null;
  hubCard: IntegrationHubCard | null;
  recentErrors: IntegrationProbeLogEntry[];
  recentWarnings: IntegrationProbeLogEntry[];
  syncHistory: IntegrationProbeLogEntry[];
  actions: IntegrationHubAction[];
};

export const EMPTY_INTEGRATION_HEALTH: IntegrationHealthDashboard = {
  overallHealthScore: 0,
  overallLabel: "—",
  connectedCount: 0,
  warningCount: 0,
  offlineCount: 0,
  totalServices: 0,
  lastSuccessfulSync: null,
  avgLatencyMs: null,
  failedRequests: 0,
  uptimeSeconds: 0,
  uptimeLabel: "—",
  uptime24hPct: null,
  uptime7dPct: null,
  successFailureTrend: [],
  responseTimeHistoryMs: [],
  last10SyncEvents: [],
  services: [],
  recentFailures: [],
  startupVerifiedAt: null,
  monitoredAt: new Date().toISOString(),
  source: "live",
};

export const integrationsApi = {
  hub: () =>
    apiFetch<IntegrationsHubPayload>("/", { timeoutMs: INTEGRATIONS_HUB_FETCH_TIMEOUT_MS }),
  health: (refresh = false) =>
    apiFetch<IntegrationHealthDashboard>(`/health${refresh ? "?refresh=1" : ""}`, {
      timeoutMs: 25_000,
    }),
  healthDetail: (id: string) =>
    apiFetch<IntegrationLiveDetail>(`/health/${encodeURIComponent(id)}`, {
      timeoutMs: 25_000,
    }),
  diagnostics: () =>
    apiFetch<{
      startupVerifiedAt: string | null;
      counters: { failedRequestTotal: number; successfulProbeTotal: number };
      recent: IntegrationProbeLogEntry[];
    }>("/diagnostics", { timeoutMs: 10_000 }),
  retryDegraded: (providerIds?: string[]) =>
    apiFetch<{
      attempted: number;
      recovered: string[];
      failed: { id: string; message: string }[];
      testedAt: string;
    }>("/retry-degraded", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerIds }),
      timeoutMs: 60_000,
    }),
  configure: (provider: string, config: Record<string, string>, enabled = true) =>
    apiFetch<{ connection: IntegrationConnection }>(`/${provider}/configure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config, enabled }),
      timeoutMs: INTEGRATIONS_HUB_FETCH_TIMEOUT_MS,
    }),
  test: (provider: string) =>
    apiFetch<{ success: boolean; message: string; provider?: string; testedAt?: string }>(
      `/${provider}/test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        timeoutMs: INTEGRATIONS_HUB_FETCH_TIMEOUT_MS,
      }
    ),
  quickBooksConnect: () =>
    apiFetch<{ authUrl: string; oauthConfigured: boolean }>("/quickbooks/connect", {
      timeoutMs: INTEGRATIONS_HUB_FETCH_TIMEOUT_MS,
    }),
  quickBooksSync: () =>
    apiFetch<{ success: boolean; sync: Record<string, unknown> }>("/quickbooks/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      timeoutMs: INTEGRATIONS_HUB_FETCH_TIMEOUT_MS,
    }),
  quickBooksStatus: () =>
    apiFetch<Record<string, unknown>>("/quickbooks/status", {
      timeoutMs: INTEGRATIONS_HUB_FETCH_TIMEOUT_MS,
    }),
};
