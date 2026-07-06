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

export const integrationsApi = {
  hub: () =>
    apiFetch<IntegrationsHubPayload>("/", { timeoutMs: INTEGRATIONS_HUB_FETCH_TIMEOUT_MS }),
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
