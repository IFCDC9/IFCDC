/** Integrations Hub must render within 5s — fail fast with safe defaults. */
export const INTEGRATIONS_HUB_FETCH_TIMEOUT_MS = 5_000;

export type IntegrationHubAction = {
  id: string;
  label: string;
  kind: "primary" | "secondary" | "disabled";
  action?: "test" | "configure" | "oauth" | "link" | "sync";
  href?: string;
  reason?: string;
};

export type IntegrationHubCard = {
  id: string;
  name: string;
  category: string;
  description: string;
  status: "connected" | "configured" | "not_configured" | "degraded" | "coming_soon";
  lastChecked: string;
  environmentReadiness: { ready: boolean; missing: string[]; configured: string[] };
  requiredCredentials: { key: string; label: string; configured: boolean }[];
  health: { healthy: boolean; latencyMs?: number; message: string };
  actions: IntegrationHubAction[];
};

export type IntegrationsHubPayload = {
  integrations: IntegrationHubCard[];
  connectedCount: number;
  summary: {
    total: number;
    connected: number;
    configured: number;
    notConfigured: number;
    categories: number;
  };
  degraded?: boolean;
  warning?: string | null;
  timestamp: string;
};

export const EMPTY_INTEGRATIONS_HUB: IntegrationsHubPayload = {
  integrations: [],
  connectedCount: 0,
  summary: { total: 0, connected: 0, configured: 0, notConfigured: 0, categories: 0 },
  degraded: true,
  warning: "Integrations Hub could not load — showing empty state.",
  timestamp: new Date().toISOString(),
};

export function normalizeIntegrationsHub(
  raw: Partial<IntegrationsHubPayload> | null | undefined
): IntegrationsHubPayload {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_INTEGRATIONS_HUB, timestamp: new Date().toISOString() };
  }
  return {
    integrations: Array.isArray(raw.integrations) ? raw.integrations : [],
    connectedCount: typeof raw.connectedCount === "number" ? raw.connectedCount : 0,
    summary: raw.summary ?? EMPTY_INTEGRATIONS_HUB.summary,
    degraded: Boolean(raw.degraded),
    warning: raw.warning ?? null,
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
  };
}
