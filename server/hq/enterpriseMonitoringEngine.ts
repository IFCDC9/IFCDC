/**
 * Build 55 — Enterprise Monitoring aggregator.
 * Live service, API, DB, storage, auth, jobs, and uptime status (no mock data).
 */
import fs from "fs/promises";
import { getDb } from "../db";
import { checkIfcdcServices } from "../lib/ifcdc";
import { pollAllApps } from "./appRegistry";
import { buildExecutiveCommandHealth, type ExecutiveCommandHealth } from "./executiveCommandHealth";
import { buildIntegrationsHubSafe, invalidateIntegrationsHubCache, testIntegrationHubProvider } from "./integrationsHubEngine";
import { listScheduledJobs } from "./workflowEngine";
import { listLiveCallMonitors, listRecentVoiceJobs } from "./auraVoiceJobQueue";
import { scanKpiAnomalies, type KpiAnomalyAlert } from "./anomalyMonitor";
import { getHqUploadRoot } from "./hqFileStorage";

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
  commandHealth: ExecutiveCommandHealth | null;
  services: { id: string; healthy: boolean }[];
  apps: { id: string; healthy: boolean; latencyMs?: number; error?: string }[];
  integrations: {
    id: string;
    name: string;
    status: string;
    healthy: boolean;
    message: string;
  }[];
  jobs: {
    scheduled: { key: string; name: string; enabled: boolean; runStatus: string; lastError: string | null; sourceModule: string }[];
    voiceActive: number;
    voiceRecentFailed: number;
    notificationPending: number;
  };
  anomalies: KpiAnomalyAlert[];
  alerts: { id: string; severity: "high" | "medium" | "low"; title: string; detail: string; path?: string }[];
  monitoredAt: string;
  degraded: boolean;
  warning: string | null;
  source: "live";
};

function statusFromScore(score: number): MonitorComponentStatus {
  if (!Number.isFinite(score)) return "unknown";
  if (score >= 80) return "healthy";
  if (score >= 60) return "degraded";
  return "critical";
}

function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return Promise.race([
    promise.catch((err) => {
      console.warn(`[enterprise-monitoring] ${label}:`, err instanceof Error ? err.message : err);
      return fallback;
    }),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function probeDatabase(): Promise<MonitorComponent> {
  const started = Date.now();
  try {
    const db = await getDb();
    await db.get("SELECT 1 as ok");
    return {
      id: "database",
      label: "Database",
      status: "healthy",
      score: 100,
      detail: `SELECT 1 ok · ${Date.now() - started}ms`,
      meta: process.env.DATABASE_URL ? "Postgres/Supabase" : "SQLite",
    };
  } catch (err) {
    return {
      id: "database",
      label: "Database",
      status: "critical",
      score: 0,
      detail: err instanceof Error ? err.message : "Database probe failed",
    };
  }
}

async function probeStorage(): Promise<MonitorComponent> {
  try {
    const root = getHqUploadRoot();
    await fs.mkdir(root, { recursive: true });
    await fs.access(root);
    const entries = await fs.readdir(root).catch(() => []);
    return {
      id: "storage",
      label: "Storage",
      status: "healthy",
      score: 100,
      detail: `HQ uploads writable · ${entries.length} file(s)`,
      meta: root,
    };
  } catch (err) {
    return {
      id: "storage",
      label: "Storage",
      status: "critical",
      score: 0,
      detail: err instanceof Error ? err.message : "Storage probe failed",
    };
  }
}

async function probeAuth(): Promise<MonitorComponent> {
  const jwtOk = Boolean((process.env.JWT_SECRET || process.env.SESSION_SECRET || "").trim());
  const services = await withTimeout(checkIfcdcServices(), 6_000, {} as Record<string, boolean>, "auth-services");
  const authService = services.auth ?? services["auth"] ?? null;
  let sessionCount = 0;
  try {
    const db = await getDb();
    sessionCount =
      (await db.get<{ c: number }>(
        `SELECT COUNT(*) as c FROM hq_security_sessions WHERE revoked_at IS NULL`
      ).catch(() => null))?.c ??
      (await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM sessions`).catch(() => null))?.c ??
      0;
  } catch {
    sessionCount = 0;
  }

  const score = jwtOk ? (authService === false ? 55 : 95) : 20;
  return {
    id: "authentication",
    label: "Authentication",
    status: statusFromScore(score),
    score,
    detail: jwtOk
      ? `Session secrets configured · ${sessionCount} tracked session(s)`
      : "JWT/SESSION secret missing",
    meta: authService == null ? "local auth" : authService ? "auth service up" : "auth service down",
  };
}

async function notificationPendingCount(): Promise<number> {
  try {
    const db = await getDb();
    return (
      (await db.get<{ c: number }>(
        `SELECT COUNT(*) as c FROM hq_notification_queue WHERE status = 'pending'`
      ))?.c ?? 0
    );
  } catch {
    return 0;
  }
}

let cache: { at: number; data: EnterpriseMonitoringOverview } | null = null;
const CACHE_TTL_MS = 30_000;

export function emptyEnterpriseMonitoring(): EnterpriseMonitoringOverview {
  return {
    overallScore: 0,
    overallStatus: "unknown",
    uptimeSeconds: Math.floor(process.uptime()),
    uptimeLabel: formatUptime(process.uptime()),
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
    warning: "Enterprise monitoring unavailable — showing safe empty state.",
    source: "live",
  };
}

export async function buildEnterpriseMonitoringOverview(opts?: {
  bypassCache?: boolean;
}): Promise<EnterpriseMonitoringOverview> {
  const now = Date.now();
  if (!opts?.bypassCache && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const [
    commandHealth,
    services,
    apps,
    hub,
    scheduledJobs,
    voiceJobs,
    liveCalls,
    anomalies,
    database,
    storage,
    authentication,
    notifPending,
  ] = await Promise.all([
    withTimeout(buildExecutiveCommandHealth({ bypassCache: opts?.bypassCache }), 14_000, null, "command-health"),
    withTimeout(checkIfcdcServices(), 8_000, {} as Record<string, boolean>, "services"),
    withTimeout(pollAllApps(), 10_000, [], "apps"),
    withTimeout(buildIntegrationsHubSafe(), 14_000, null, "integrations"),
    withTimeout(listScheduledJobs(), 8_000, [], "scheduled-jobs"),
    withTimeout(listRecentVoiceJobs(20), 6_000, [], "voice-jobs"),
    withTimeout(Promise.resolve(listLiveCallMonitors()), 2_000, [], "live-calls"),
    withTimeout(scanKpiAnomalies(), 10_000, [], "anomalies"),
    withTimeout(probeDatabase(), 6_000, {
      id: "database",
      label: "Database",
      status: "unknown" as const,
      score: 0,
      detail: "Probe timed out",
    }, "database"),
    withTimeout(probeStorage(), 4_000, {
      id: "storage",
      label: "Storage",
      status: "unknown" as const,
      score: 0,
      detail: "Probe timed out",
    }, "storage"),
    withTimeout(probeAuth(), 8_000, {
      id: "authentication",
      label: "Authentication",
      status: "unknown" as const,
      score: 0,
      detail: "Probe timed out",
    }, "authentication"),
    withTimeout(notificationPendingCount(), 4_000, 0, "notifications"),
  ]);

  const serviceEntries = Object.entries(services || {}).map(([id, healthy]) => ({ id, healthy: Boolean(healthy) }));
  const servicesHealthy = serviceEntries.filter((s) => s.healthy).length;
  const servicesTotal = serviceEntries.length || 1;
  const servicesScore = Math.round((servicesHealthy / servicesTotal) * 100);

  const appRows = (apps || []).map((a) => ({
    id: a.id,
    healthy: Boolean(a.healthy),
    latencyMs: a.latencyMs,
    error: a.error,
  }));
  const appsHealthy = appRows.filter((a) => a.healthy).length;
  const appsTotal = appRows.length || 1;
  const appsScore = Math.round((appsHealthy / appsTotal) * 100);

  const integrations = ((hub as { integrations?: Array<{
    id: string;
    name: string;
    status: string;
    health?: { healthy?: boolean; message?: string };
  }> } | null)?.integrations ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    status: i.status,
    healthy: Boolean(i.health?.healthy || i.status === "connected"),
    message: i.health?.message || i.status,
  }));
  const integHealthy = integrations.filter((i) => i.healthy).length;
  const integTotal = integrations.length || 1;
  const integScore = Math.round((integHealthy / integTotal) * 100);

  const jobsMapped = (scheduledJobs || []).map((raw) => {
    const j = raw as Record<string, unknown>;
    return {
      key: String(j.job_key ?? j.key ?? ""),
      name: String(j.name ?? ""),
      enabled: Boolean(j.enabled),
      runStatus: String(j.runStatus ?? j.last_run_status ?? "unknown"),
      lastError: j.lastError != null ? String(j.lastError) : j.last_error != null ? String(j.last_error) : null,
      sourceModule: String(j.sourceModule ?? j.source_module ?? "hq"),
    };
  });
  const failedJobs = jobsMapped.filter((j) => j.enabled && j.runStatus === "failed").length;
  const jobsScore = jobsMapped.length
    ? Math.max(40, 100 - failedJobs * 15)
    : 85;

  const voiceFailed = (voiceJobs || []).filter((j) => j.status === "error").length;
  const voiceActive = (liveCalls || []).length;

  const systemPillar = commandHealth?.pillars.find((p) => p.id === "system");
  const apiScore = systemPillar?.score ?? Math.round(appsScore * 0.5 + servicesScore * 0.5);

  const components: MonitorComponent[] = [
    {
      id: "services",
      label: "Live Services",
      status: statusFromScore(servicesScore),
      score: servicesScore,
      detail: `${servicesHealthy}/${servicesTotal} platform services healthy`,
    },
    {
      id: "api",
      label: "API Health",
      status: statusFromScore(apiScore),
      score: apiScore,
      detail: systemPillar?.meta ?? `${appsHealthy}/${appsTotal} apps responding`,
    },
    database,
    storage,
    authentication,
    {
      id: "integrations",
      label: "Integrations",
      status: statusFromScore(integScore),
      score: integScore,
      detail: `${integHealthy}/${integTotal} connectors healthy`,
    },
    {
      id: "jobs",
      label: "Background Jobs",
      status: statusFromScore(jobsScore),
      score: jobsScore,
      detail: `${jobsMapped.filter((j) => j.enabled).length} scheduled · ${failedJobs} failed · ${voiceActive} live voice`,
      meta: notifPending ? `${notifPending} pending notifications` : undefined,
    },
    {
      id: "uptime",
      label: "System Uptime",
      status: "healthy",
      score: 100,
      detail: formatUptime(process.uptime()),
      meta: `Process uptime ${Math.floor(process.uptime())}s`,
    },
  ];

  const overallScore = Math.round(
    components.reduce((sum, c) => sum + c.score, 0) / Math.max(1, components.length)
  );

  const alerts: EnterpriseMonitoringOverview["alerts"] = [];
  for (const c of components) {
    if (c.status === "critical") {
      alerts.push({
        id: `mon-${c.id}`,
        severity: "high",
        title: `${c.label} critical`,
        detail: c.detail,
        path: c.id === "integrations" ? "/hq/integrations" : "/hq/monitoring",
      });
    } else if (c.status === "degraded") {
      alerts.push({
        id: `mon-${c.id}-watch`,
        severity: "medium",
        title: `${c.label} degraded`,
        detail: c.detail,
        path: "/hq/monitoring",
      });
    }
  }
  for (const a of anomalies.slice(0, 8)) {
    alerts.push({
      id: a.id,
      severity: a.severity,
      title: a.title,
      detail: a.detail,
      path: "/hq/intelligence",
    });
  }

  const data: EnterpriseMonitoringOverview = {
    overallScore,
    overallStatus: statusFromScore(overallScore),
    uptimeSeconds: Math.floor(process.uptime()),
    uptimeLabel: formatUptime(process.uptime()),
    components,
    commandHealth,
    services: serviceEntries,
    apps: appRows,
    integrations,
    jobs: {
      scheduled: jobsMapped,
      voiceActive,
      voiceRecentFailed: voiceFailed,
      notificationPending: notifPending,
    },
    anomalies: anomalies.slice(0, 20),
    alerts: alerts.slice(0, 25),
    monitoredAt: new Date().toISOString(),
    degraded: overallScore === 0 && components.every((c) => c.score === 0),
    warning: null,
    source: "live",
  };

  if (!data.degraded) cache = { at: now, data };
  return data;
}

export function invalidateEnterpriseMonitoringCache(): void {
  cache = null;
}

/** Automatic retry for degraded/not_configured live connectors (Build 55). */
export async function retryDegradedIntegrations(opts?: {
  providerIds?: string[];
  maxProviders?: number;
}): Promise<{
  attempted: number;
  recovered: string[];
  failed: { id: string; message: string }[];
  testedAt: string;
}> {
  invalidateIntegrationsHubCache();
  const hub = await buildIntegrationsHubSafe();
  const cards = hub.integrations ?? [];
  const candidates = cards.filter((c) => {
    if (opts?.providerIds?.length) return opts.providerIds.includes(c.id);
    return c.status === "degraded" || (c.status === "configured" && !c.health?.healthy);
  });
  const slice = candidates.slice(0, opts?.maxProviders ?? 6);
  const recovered: string[] = [];
  const failed: { id: string; message: string }[] = [];

  for (const card of slice) {
    try {
      const result = await testIntegrationHubProvider(card.id);
      if (result.success) recovered.push(card.id);
      else failed.push({ id: card.id, message: result.message || "Retry failed" });
    } catch (err) {
      failed.push({
        id: card.id,
        message: err instanceof Error ? err.message : "Retry error",
      });
    }
  }

  invalidateEnterpriseMonitoringCache();
  return {
    attempted: slice.length,
    recovered,
    failed,
    testedAt: new Date().toISOString(),
  };
}
