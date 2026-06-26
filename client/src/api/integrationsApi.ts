async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/integrations${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
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
    apiFetch<{
      catalog: IntegrationCatalogItem[];
      connections: IntegrationConnection[];
      connectedCount: number;
    }>("/").catch(() => ({ catalog: [], connections: [], connectedCount: 0 })),
  configure: (provider: string, config: Record<string, string>, enabled = true) =>
    apiFetch<{ connection: IntegrationConnection }>(`/${provider}/configure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config, enabled }),
    }),
  test: (provider: string) =>
    apiFetch<{ success: boolean; message: string }>(`/${provider}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  quickBooksConnect: () => apiFetch<{ authUrl: string; oauthConfigured: boolean }>("/quickbooks/connect"),
  quickBooksSync: () =>
    apiFetch<{ success: boolean; sync: Record<string, unknown> }>("/quickbooks/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  quickBooksStatus: () => apiFetch<Record<string, unknown>>("/quickbooks/status"),
};
