import { hqApiFetch } from "./hqApiFetch";
import { INTEGRATIONS_HUB_FETCH_TIMEOUT_MS } from "../data/integrationsHubDefaults";
import type { IntegrationsHubPayload } from "../data/integrationsHubDefaults";

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
  services: {
    id: string;
    name: string;
    category: string;
    displayStatus: "Connected" | "Warning" | "Disconnected";
    status: string;
    healthy: boolean;
    latencyMs: number | null;
    lastChecked: string | null;
    message: string;
  }[];
  recentFailures: { at: string; provider: string; ok: boolean; latencyMs: number; message: string }[];
  startupVerifiedAt: string | null;
  monitoredAt: string;
  source: "live";
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
  diagnostics: () =>
    apiFetch<{
      startupVerifiedAt: string | null;
      counters: { failedRequestTotal: number; successfulProbeTotal: number };
      recent: { at: string; provider: string; ok: boolean; latencyMs: number; message: string }[];
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
