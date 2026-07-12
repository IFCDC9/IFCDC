/**
 * Build 56 — Integration Health Dashboard + probe diagnostics + startup verify.
 * Isolates connector failures; never throws into other HQ modules.
 */
import fs from "fs/promises";
import { checkIfcdcServices } from "../lib/ifcdc";
import { getHqUploadRoot } from "./hqFileStorage";
import {
  buildIntegrationsHubSafe,
  invalidateIntegrationsHubCache,
  testIntegrationHubProvider,
  type IntegrationHubCard,
  type IntegrationHubStatus,
} from "./integrationsHubEngine";

export type IntegrationDisplayStatus = "Connected" | "Warning" | "Disconnected";

export type IntegrationProbeLogEntry = {
  at: string;
  provider: string;
  ok: boolean;
  latencyMs: number;
  message: string;
};

export type IntegrationHealthRow = {
  id: string;
  name: string;
  category: string;
  displayStatus: IntegrationDisplayStatus;
  status: IntegrationHubStatus | "platform";
  healthy: boolean;
  latencyMs: number | null;
  lastChecked: string | null;
  message: string;
  systemKey?: string;
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
  services: IntegrationHealthRow[];
  recentFailures: IntegrationProbeLogEntry[];
  startupVerifiedAt: string | null;
  monitoredAt: string;
  source: "live";
};

const probeLog: IntegrationProbeLogEntry[] = [];
const PROBE_LOG_MAX = 100;
let startupVerifiedAt: string | null = null;
let failedRequestTotal = 0;
let successfulProbeTotal = 0;

export function recordIntegrationProbe(entry: Omit<IntegrationProbeLogEntry, "at"> & { at?: string }) {
  const row: IntegrationProbeLogEntry = {
    at: entry.at ?? new Date().toISOString(),
    provider: entry.provider,
    ok: entry.ok,
    latencyMs: entry.latencyMs,
    message: entry.message,
  };
  probeLog.unshift(row);
  if (probeLog.length > PROBE_LOG_MAX) probeLog.length = PROBE_LOG_MAX;
  if (entry.ok) successfulProbeTotal += 1;
  else failedRequestTotal += 1;
}

export function getIntegrationProbeLog(limit = 25): IntegrationProbeLogEntry[] {
  return probeLog.slice(0, limit);
}

export function mapDisplayStatus(status: IntegrationHubStatus, healthy: boolean): IntegrationDisplayStatus {
  if (status === "connected" && healthy) return "Connected";
  if (status === "degraded" || status === "configured") return "Warning";
  return "Disconnected";
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

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function probePlatformSystems(): Promise<IntegrationHealthRow[]> {
  const now = new Date().toISOString();
  const rows: IntegrationHealthRow[] = [];

  // Authentication
  {
    const started = Date.now();
    const jwtOk = Boolean((process.env.JWT_SECRET || process.env.SESSION_SECRET || "").trim());
    const services = await withTimeout(checkIfcdcServices(), 5_000, {} as Record<string, boolean>);
    const authOk = jwtOk && (services.auth !== false);
    const latencyMs = Date.now() - started;
    rows.push({
      id: "platform_auth",
      name: "Authentication",
      category: "Platform",
      displayStatus: authOk ? "Connected" : jwtOk ? "Warning" : "Disconnected",
      status: "platform",
      healthy: authOk,
      latencyMs,
      lastChecked: now,
      message: authOk ? "Session secrets + auth path ready" : "Auth secret or auth service unavailable",
      systemKey: "authentication",
    });
    recordIntegrationProbe({
      provider: "platform_auth",
      ok: authOk,
      latencyMs,
      message: rows[rows.length - 1]!.message,
    });
  }

  // Notifications service
  {
    const started = Date.now();
    const services = await withTimeout(checkIfcdcServices(), 5_000, {} as Record<string, boolean>);
    const notifOk = services.notifications !== false && (
      Boolean((process.env.RESEND_API_KEY || "").trim()) || services.notifications === true
    );
    const latencyMs = Date.now() - started;
    rows.push({
      id: "platform_notifications",
      name: "Notifications",
      category: "Platform",
      displayStatus: notifOk ? "Connected" : "Warning",
      status: "platform",
      healthy: notifOk,
      latencyMs,
      lastChecked: now,
      message: notifOk ? "Notification channel available" : "Notifications service / email channel check",
      systemKey: "notifications",
    });
    recordIntegrationProbe({
      provider: "platform_notifications",
      ok: notifOk,
      latencyMs,
      message: rows[rows.length - 1]!.message,
    });
  }

  // Document storage
  {
    const started = Date.now();
    let ok = false;
    let message = "Storage unavailable";
    try {
      const root = getHqUploadRoot();
      await fs.mkdir(root, { recursive: true });
      await fs.access(root);
      ok = true;
      message = "HQ document storage writable";
    } catch (err) {
      message = err instanceof Error ? err.message : "Storage probe failed";
    }
    const latencyMs = Date.now() - started;
    rows.push({
      id: "platform_storage",
      name: "Document Storage",
      category: "Platform",
      displayStatus: ok ? "Connected" : "Disconnected",
      status: "platform",
      healthy: ok,
      latencyMs,
      lastChecked: now,
      message,
      systemKey: "storage",
    });
    recordIntegrationProbe({ provider: "platform_storage", ok, latencyMs, message });
  }

  // Calendar services — HQ organization calendar (internal module; not Google OAuth).
  {
    const started = Date.now();
    let ok = false;
    let message = "Calendar module unreachable";
    try {
      const ops = await import("./operationsSchema").then((m) => m.buildOperationsOverview());
      const upcoming = ops?.calendar?.upcomingEvents ?? 0;
      ok = true;
      message = `Organization calendar online · ${upcoming} upcoming event(s)`;
    } catch (err) {
      message = err instanceof Error ? err.message : "Calendar probe failed";
    }
    const latencyMs = Date.now() - started;
    rows.push({
      id: "platform_calendar",
      name: "Calendar Services",
      category: "Platform",
      displayStatus: ok ? "Connected" : "Warning",
      status: "platform",
      healthy: ok,
      latencyMs,
      lastChecked: now,
      message,
      systemKey: "calendar",
    });
    recordIntegrationProbe({ provider: "platform_calendar", ok, latencyMs, message });
  }

  return rows;
}

function cardToRow(card: IntegrationHubCard): IntegrationHealthRow {
  const healthy = Boolean(card.health?.healthy || card.status === "connected");
  return {
    id: card.id,
    name: card.name,
    category: card.category,
    displayStatus: mapDisplayStatus(card.status, healthy),
    status: card.status,
    healthy,
    latencyMs: typeof card.health?.latencyMs === "number" ? card.health.latencyMs : null,
    lastChecked: card.lastChecked || null,
    message: card.health?.message || card.status,
  };
}

export function buildHealthSummaryFromCards(integrations: IntegrationHubCard[]) {
  const connected = integrations.filter((i) => i.status === "connected" && (i.health?.healthy ?? true)).length;
  const warning = integrations.filter((i) => i.status === "degraded" || i.status === "configured").length;
  const offline = integrations.filter((i) => i.status === "not_configured" || i.status === "coming_soon" || (i.status === "connected" && i.health?.healthy === false)).length;
  const latencies = integrations
    .map((i) => i.health?.latencyMs)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);
  const avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;
  const lastSuccessfulSync = integrations
    .filter((i) => i.status === "connected")
    .map((i) => i.lastChecked)
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? null;
  const failedProbeCount = integrations.filter((i) => i.health?.healthy === false).length;
  const healthScore = integrations.length
    ? Math.round((connected / integrations.length) * 100)
    : 0;

  return {
    healthScore,
    connected,
    warning,
    offline,
    avgLatencyMs,
    lastSuccessfulSync,
    failedProbeCount,
    total: integrations.length,
  };
}

export async function buildIntegrationHealthDashboard(opts?: {
  bypassCache?: boolean;
}): Promise<IntegrationHealthDashboard> {
  try {
    if (opts?.bypassCache) invalidateIntegrationsHubCache();
    const hub = await buildIntegrationsHubSafe();
    const cards = hub.integrations ?? [];
    const platform = await probePlatformSystems();
    const serviceRows = [...cards.map(cardToRow), ...platform];

    const connectedCount = serviceRows.filter((s) => s.displayStatus === "Connected").length;
    const warningCount = serviceRows.filter((s) => s.displayStatus === "Warning").length;
    const offlineCount = serviceRows.filter((s) => s.displayStatus === "Disconnected").length;
    const latencies = serviceRows
      .map((s) => s.latencyMs)
      .filter((n): n is number => typeof n === "number" && n >= 0);
    const avgLatencyMs = latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;
    const lastSuccessfulSync = serviceRows
      .filter((s) => s.displayStatus === "Connected" && s.lastChecked)
      .map((s) => s.lastChecked!)
      .sort()
      .reverse()[0] ?? null;

    const overallHealthScore = serviceRows.length
      ? Math.round((connectedCount / serviceRows.length) * 100)
      : 0;
    const overallLabel =
      overallHealthScore >= 80 ? "Strong" : overallHealthScore >= 60 ? "Stable" : overallHealthScore >= 40 ? "Needs Attention" : "Critical";

    return {
      overallHealthScore,
      overallLabel,
      connectedCount,
      warningCount,
      offlineCount,
      totalServices: serviceRows.length,
      lastSuccessfulSync,
      avgLatencyMs,
      failedRequests: failedRequestTotal,
      uptimeSeconds: Math.floor(process.uptime()),
      uptimeLabel: formatUptime(process.uptime()),
      services: serviceRows,
      recentFailures: getIntegrationProbeLog(15).filter((e) => !e.ok),
      startupVerifiedAt,
      monitoredAt: new Date().toISOString(),
      source: "live",
    };
  } catch (err) {
    console.error("[integration-health] dashboard failed:", err instanceof Error ? err.message : err);
    return {
      overallHealthScore: 0,
      overallLabel: "Unavailable",
      connectedCount: 0,
      warningCount: 0,
      offlineCount: 0,
      totalServices: 0,
      lastSuccessfulSync: null,
      avgLatencyMs: null,
      failedRequests: failedRequestTotal,
      uptimeSeconds: Math.floor(process.uptime()),
      uptimeLabel: formatUptime(process.uptime()),
      services: [],
      recentFailures: getIntegrationProbeLog(15).filter((e) => !e.ok),
      startupVerifiedAt,
      monitoredAt: new Date().toISOString(),
      source: "live",
    };
  }
}

/** Non-blocking startup verification — warms hub cache and logs connectivity. */
export async function verifyIntegrationsOnStartup(): Promise<void> {
  const started = Date.now();
  try {
    console.info("[integrations-hub] startup verification begin");
    invalidateIntegrationsHubCache();
    const hub = await buildIntegrationsHubSafe();
    const summary = buildHealthSummaryFromCards(hub.integrations ?? []);
    for (const card of hub.integrations ?? []) {
      recordIntegrationProbe({
        provider: card.id,
        ok: Boolean(card.health?.healthy || card.status === "connected"),
        latencyMs: card.health?.latencyMs ?? 0,
        message: card.health?.message || card.status,
      });
    }
    await probePlatformSystems();
    startupVerifiedAt = new Date().toISOString();
    console.info(
      `[integrations-hub] startup verification complete (${Date.now() - started}ms) — ` +
        `score ${summary.healthScore}/100 · connected ${summary.connected} · warning ${summary.warning} · offline ${summary.offline}`
    );

    // Auto-retry temporary failures (degraded only) after boot settles.
    const degraded = (hub.integrations ?? []).filter((c) => c.status === "degraded").slice(0, 4);
    for (const card of degraded) {
      try {
        const result = await testIntegrationHubProvider(card.id);
        recordIntegrationProbe({
          provider: card.id,
          ok: Boolean(result.success),
          latencyMs: 0,
          message: `startup-retry: ${result.message}`,
        });
        console.info(`[integrations-hub] startup retry ${card.id}: ${result.success ? "recovered" : result.message}`);
      } catch (err) {
        recordIntegrationProbe({
          provider: card.id,
          ok: false,
          latencyMs: 0,
          message: err instanceof Error ? err.message : "startup retry failed",
        });
        console.warn(`[integrations-hub] startup retry ${card.id} failed:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.warn("[integrations-hub] startup verification skipped:", err instanceof Error ? err.message : err);
  }
}

export function getIntegrationStartupVerifiedAt(): string | null {
  return startupVerifiedAt;
}

export function getIntegrationProbeCounters() {
  return { failedRequestTotal, successfulProbeTotal };
}
