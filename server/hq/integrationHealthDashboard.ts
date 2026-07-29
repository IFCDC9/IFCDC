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
  type IntegrationHubAction,
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
  services: IntegrationHealthRow[];
  recentFailures: IntegrationProbeLogEntry[];
  startupVerifiedAt: string | null;
  monitoredAt: string;
  source: "live";
  environmentName: string;
  productionVsTest: "production" | "test" | "mixed";
};

const probeLog: IntegrationProbeLogEntry[] = [];
const PROBE_LOG_MAX = 400;
let startupVerifiedAt: string | null = null;
let failedRequestTotal = 0;
let successfulProbeTotal = 0;

const SERVICE_META: Record<
  string,
  { owner: string; environment: string; productionVsTest: "production" | "test" | "mixed" | "unknown" }
> = {
  grants_gov: { owner: "Grants Division", environment: "production", productionVsTest: "production" },
  sam_gov: { owner: "Grants Division", environment: "production", productionVsTest: "production" },
  paypal: { owner: "Finance", environment: process.env.PAYPAL_ENV || "live", productionVsTest: /live/i.test(process.env.PAYPAL_ENV || "live") ? "production" : "test" },
  resend: { owner: "Communications", environment: "production", productionVsTest: "production" },
  openai_aura: { owner: "AURA / Executive", environment: "production", productionVsTest: "production" },
  render: { owner: "Platform Ops", environment: "production", productionVsTest: "production" },
  github: { owner: "Software Engineering", environment: "production", productionVsTest: "production" },
  postgres: { owner: "Platform Ops", environment: "production", productionVsTest: "production" },
  twilio: { owner: "Communications", environment: "production", productionVsTest: "production" },
  website_apps: { owner: "Software Division", environment: "production", productionVsTest: "production" },
  quickbooks: { owner: "Finance", environment: "production", productionVsTest: "production" },
  platform_auth: { owner: "Security", environment: "production", productionVsTest: "production" },
  platform_notifications: { owner: "Communications", environment: "production", productionVsTest: "production" },
  platform_storage: { owner: "Platform Ops", environment: "production", productionVsTest: "production" },
  platform_calendar: { owner: "Operations", environment: "production", productionVsTest: "production" },
};

function inferErrorCode(message: string): string | undefined {
  const m = message || "";
  if (/timeout/i.test(m)) return "TIMEOUT";
  if (/401|unauthorized|auth failed/i.test(m)) return "AUTH_FAILED";
  if (/403|forbidden/i.test(m)) return "FORBIDDEN";
  if (/404|not found/i.test(m)) return "NOT_FOUND";
  if (/429|rate.?limit/i.test(m)) return "RATE_LIMITED";
  if (/5\d\d|server error/i.test(m)) return "UPSTREAM_5XX";
  if (/missing|not configured|not set/i.test(m)) return "CONFIG_MISSING";
  if (/dns|domain|unverified/i.test(m)) return "DNS_OR_DOMAIN";
  return undefined;
}

function inferRootCause(message: string, errorCode?: string): string | undefined {
  if (errorCode === "CONFIG_MISSING") return "Required Render environment variable is unset";
  if (errorCode === "AUTH_FAILED") return "API credentials rejected by provider";
  if (errorCode === "TIMEOUT") return "Provider did not respond within probe budget";
  if (errorCode === "DNS_OR_DOMAIN") return "Sender/domain authentication incomplete";
  if (errorCode === "RATE_LIMITED") return "Provider throttled HQ probes";
  if (!message) return undefined;
  return message.slice(0, 180);
}

export function recordIntegrationProbe(
  entry: Omit<IntegrationProbeLogEntry, "at"> & { at?: string; errorCode?: string; rootCause?: string },
) {
  const errorCode = entry.errorCode || (!entry.ok ? inferErrorCode(entry.message) : undefined);
  const rootCause = entry.rootCause || (!entry.ok ? inferRootCause(entry.message, errorCode) : undefined);
  const row: IntegrationProbeLogEntry = {
    at: entry.at ?? new Date().toISOString(),
    provider: entry.provider,
    ok: entry.ok,
    latencyMs: entry.latencyMs,
    message: entry.message,
    errorCode,
    rootCause,
  };
  probeLog.unshift(row);
  if (probeLog.length > PROBE_LOG_MAX) probeLog.length = PROBE_LOG_MAX;
  if (entry.ok) successfulProbeTotal += 1;
  else failedRequestTotal += 1;
}

export function getIntegrationProbeLog(limit = 25): IntegrationProbeLogEntry[] {
  return probeLog.slice(0, limit);
}

function probesForProvider(provider: string, sinceMs?: number): IntegrationProbeLogEntry[] {
  const since = sinceMs != null ? Date.now() - sinceMs : 0;
  return probeLog.filter((p) => p.provider === provider && new Date(p.at).getTime() >= since);
}

function uptimePct(entries: IntegrationProbeLogEntry[]): number | null {
  if (!entries.length) return null;
  const ok = entries.filter((e) => e.ok).length;
  return Math.round((ok / entries.length) * 1000) / 10;
}

function buildOpsForProvider(provider: string, card?: IntegrationHubCard): IntegrationOpsMetrics {
  const day = probesForProvider(provider, 24 * 60 * 60 * 1000);
  const week = probesForProvider(provider, 7 * 24 * 60 * 60 * 1000);
  const all = probesForProvider(provider);
  const meta = SERVICE_META[provider] || {
    owner: "IFCDC Headquarters",
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    productionVsTest: process.env.NODE_ENV === "production" ? "production" as const : "test" as const,
  };
  const missing = card?.environmentReadiness?.missing ?? [];
  const configured = card?.environmentReadiness?.configured ?? [];
  let authStatus: IntegrationOpsMetrics["authStatus"] = "unknown";
  if (card) {
    if (missing.length === 0 && configured.length > 0) authStatus = "authenticated";
    else if (configured.length > 0) authStatus = "partial";
    else if ((card.requiredCredentials?.length ?? 0) > 0) authStatus = "missing";
  }
  const lastOk = all.find((e) => e.ok)?.at || (card?.status === "connected" ? card.lastChecked : null);
  const envName = process.env.RENDER_SERVICE_NAME || process.env.IFCDC_ENV_NAME || meta.environment;
  const expireHit = all.find((e) => /expir|credential.*invalid|token.*revok/i.test(e.message));
  let credentialExpirationWarning: string | null = null;
  if (expireHit) {
    credentialExpirationWarning = expireHit.rootCause || expireHit.message.slice(0, 160);
  } else if (authStatus === "missing") {
    credentialExpirationWarning = "Credentials not configured on Render — reconnect required";
  } else if (authStatus === "partial") {
    credentialExpirationWarning = "Partial credentials detected — complete env vars or reconnect";
  }

  return {
    uptime24hPct: uptimePct(day.length ? day : all.slice(0, 20)),
    uptime7dPct: uptimePct(week.length ? week : all.slice(0, 50)),
    successFailureTrend: all.slice(0, 24).map((e) => ({ at: e.at, ok: e.ok, latencyMs: e.latencyMs })).reverse(),
    responseTimeHistoryMs: all.slice(0, 24).map((e) => e.latencyMs).filter((n) => n >= 0).reverse(),
    last10SyncEvents: all.slice(0, 10),
    failedRequestCount: all.filter((e) => !e.ok).length,
    lastSuccessfulSync: lastOk || null,
    authStatus,
    environmentName: envName,
    productionVsTest: meta.productionVsTest,
    serviceOwner: meta.owner,
    credentialExpirationWarning,
    connectedEnvironment: envName,
  };
}

function hourlyTrend(hours = 24): { at: string; ok: number; fail: number }[] {
  const buckets: { at: string; ok: number; fail: number }[] = [];
  const now = Date.now();
  for (let i = hours - 1; i >= 0; i--) {
    const start = now - (i + 1) * 3600_000;
    const end = now - i * 3600_000;
    const slice = probeLog.filter((p) => {
      const t = new Date(p.at).getTime();
      return t >= start && t < end;
    });
    buckets.push({
      at: new Date(end).toISOString(),
      ok: slice.filter((s) => s.ok).length,
      fail: slice.filter((s) => !s.ok).length,
    });
  }
  return buckets;
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
    ops: buildOpsForProvider(card.id, card),
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
    const platformRows = platform.map((row) => ({
      ...row,
      ops: buildOpsForProvider(row.id),
    }));
    const serviceRows = [...cards.map(cardToRow), ...platformRows];

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

    const allDay = probeLog.filter((p) => Date.now() - new Date(p.at).getTime() <= 24 * 3600_000);
    const allWeek = probeLog.filter((p) => Date.now() - new Date(p.at).getTime() <= 7 * 24 * 3600_000);
    const envName = process.env.RENDER_SERVICE_NAME || process.env.IFCDC_ENV_NAME || (process.env.NODE_ENV === "production" ? "production" : "development");

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
      uptime24hPct: uptimePct(allDay.length ? allDay : probeLog.slice(0, 40)),
      uptime7dPct: uptimePct(allWeek.length ? allWeek : probeLog.slice(0, 100)),
      successFailureTrend: hourlyTrend(24),
      responseTimeHistoryMs: probeLog.slice(0, 40).map((p) => p.latencyMs).filter((n) => n >= 0).reverse(),
      last10SyncEvents: getIntegrationProbeLog(10),
      services: serviceRows,
      recentFailures: getIntegrationProbeLog(15).filter((e) => !e.ok),
      startupVerifiedAt,
      monitoredAt: new Date().toISOString(),
      source: "live",
      environmentName: envName,
      productionVsTest: process.env.NODE_ENV === "production" ? "production" : "test",
    };
  } catch (err) {
    console.error("[integration-health] dashboard failed:", err instanceof Error ? err.message : err);
    const envName = process.env.RENDER_SERVICE_NAME || "unknown";
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
      uptime24hPct: null,
      uptime7dPct: null,
      successFailureTrend: [],
      responseTimeHistoryMs: [],
      last10SyncEvents: getIntegrationProbeLog(10),
      services: [],
      recentFailures: getIntegrationProbeLog(15).filter((e) => !e.ok),
      startupVerifiedAt,
      monitoredAt: new Date().toISOString(),
      source: "live",
      environmentName: envName,
      productionVsTest: process.env.NODE_ENV === "production" ? "production" : "test",
    };
  }
}

const PLATFORM_DISPLAY: Record<string, { name: string; category: string }> = {
  platform_auth: { name: "Authentication", category: "Platform" },
  platform_notifications: { name: "Notifications", category: "Platform" },
  platform_storage: { name: "Document Storage", category: "Platform" },
  platform_calendar: { name: "Calendar Services", category: "Platform" },
};

/** Full live detail for one integration (modal drill-down). */
export async function getIntegrationLiveDetail(providerId: string): Promise<{
  ok: boolean;
  service: IntegrationHealthRow | null;
  hubCard: IntegrationHubCard | null;
  recentErrors: IntegrationProbeLogEntry[];
  recentWarnings: IntegrationProbeLogEntry[];
  syncHistory: IntegrationProbeLogEntry[];
  actions: IntegrationHubAction[];
}> {
  const hub = await buildIntegrationsHubSafe();
  const card = (hub.integrations ?? []).find((c) => c.id === providerId) || null;

  let service: IntegrationHealthRow | null = card ? cardToRow(card) : null;
  if (!service && providerId.startsWith("platform_")) {
    const platform = await probePlatformSystems();
    service =
      platform
        .map((row) => ({ ...row, ops: buildOpsForProvider(row.id) }))
        .find((s) => s.id === providerId) ?? null;
  }
  if (!service) {
    const recent = probesForProvider(providerId)[0];
    const display = PLATFORM_DISPLAY[providerId];
    if (recent || display) {
      const ok = recent?.ok ?? false;
      service = {
        id: providerId,
        name: display?.name || providerId,
        category: display?.category || "Integration",
        displayStatus: ok ? "Connected" : "Disconnected",
        status: "platform",
        healthy: ok,
        latencyMs: recent?.latencyMs ?? null,
        lastChecked: recent?.at ?? null,
        message: recent?.message || "No recent probe",
        ops: buildOpsForProvider(providerId),
      };
    }
  }

  const history = probesForProvider(providerId).slice(0, 10);
  const recentErrors = history.filter((e) => !e.ok);
  const recentWarnings = history.filter(
    (e) => !e.ok || /warn|degraded|fallback/i.test(e.message),
  );
  const defaultActions: IntegrationHubAction[] = [
    { id: "test", label: "Test connection", kind: "primary", action: "test" },
    { id: "refresh", label: "Refresh status", kind: "secondary", action: "test" },
    { id: "retry", label: "Retry failed request", kind: "secondary", action: "test" },
    { id: "logs", label: "View logs", kind: "secondary", action: "configure" },
    { id: "config", label: "Open configuration", kind: "secondary", action: "configure" },
    { id: "reconnect", label: "Reconnect", kind: "secondary", action: card?.id === "quickbooks" ? "oauth" : "test" },
  ];
  const actions = card?.actions?.length ? card.actions : defaultActions;

  return {
    ok: Boolean(service || card),
    service: service
      ? { ...service, ops: service.ops || buildOpsForProvider(providerId, card || undefined) }
      : null,
    hubCard: card,
    recentErrors,
    recentWarnings: recentWarnings.slice(0, 8),
    syncHistory: history,
    actions,
  };
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
