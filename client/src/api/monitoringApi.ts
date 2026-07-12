import { hqApiFetch } from "./hqApiFetch";

export type MonitorComponentStatus = "healthy" | "degraded" | "critical" | "unknown";

export type MonitorComponent = {
  id: string;
  label: string;
  status: MonitorComponentStatus;
  score: number;
  detail: string;
  meta?: string;
};

export type EnterpriseMonitoringOverview = {
  overallScore: number;
  overallStatus: MonitorComponentStatus;
  uptimeSeconds: number;
  uptimeLabel: string;
  components: MonitorComponent[];
  commandHealth: {
    overall: number;
    grade: string;
    pillars: { id: string; label: string; score: number; grade: string; meta: string; status: string }[];
  } | null;
  services: { id: string; healthy: boolean }[];
  apps: { id: string; healthy: boolean; latencyMs?: number; error?: string }[];
  integrations: { id: string; name: string; status: string; healthy: boolean; message: string }[];
  jobs: {
    scheduled: { key: string; name: string; enabled: boolean; runStatus: string; lastError: string | null; sourceModule: string }[];
    voiceActive: number;
    voiceRecentFailed: number;
    notificationPending: number;
  };
  anomalies: { id: string; severity: string; title: string; detail: string }[];
  alerts: { id: string; severity: "high" | "medium" | "low"; title: string; detail: string; path?: string }[];
  monitoredAt: string;
  degraded?: boolean;
  warning?: string | null;
  source: "live";
};

export const EMPTY_ENTERPRISE_MONITORING: EnterpriseMonitoringOverview = {
  overallScore: 0,
  overallStatus: "unknown",
  uptimeSeconds: 0,
  uptimeLabel: "—",
  components: [],
  commandHealth: null,
  services: [],
  apps: [],
  integrations: [],
  jobs: { scheduled: [], voiceActive: 0, voiceRecentFailed: 0, notificationPending: 0 },
  anomalies: [],
  alerts: [],
  monitoredAt: new Date().toISOString(),
  degraded: true,
  warning: "Monitoring API unavailable",
  source: "live",
};

export const monitoringApi = {
  overview: (refresh = false) =>
    hqApiFetch<EnterpriseMonitoringOverview>(
      `/api/hq/monitoring/overview${refresh ? "?refresh=1" : ""}`,
      { timeoutMs: 25_000 }
    ),
  retryIntegrations: (providerIds?: string[]) =>
    hqApiFetch<{
      attempted: number;
      recovered: string[];
      failed: { id: string; message: string }[];
      testedAt: string;
    }>("/api/hq/monitoring/integrations/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerIds }),
      timeoutMs: 60_000,
    }),
};
