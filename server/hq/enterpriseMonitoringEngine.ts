/**
 * Build 55 — Enterprise Monitoring aggregator.
 * Live service, API, DB, storage, auth, jobs, and uptime status (no mock data).
 */
import fs from "fs/promises";
import { getDb } from "../db";
import { checkIfcdcServices, IFCDC_SERVICE_URLS } from "../lib/ifcdc";
import { shouldProbeLegacy4101 } from "./auraLegacy4101";
import { isLocalSidecarUrl } from "./auraE2eDiagnosticsEngine";
import { pollAllApps } from "./appRegistry";
import { buildExecutiveCommandHealth, type ExecutiveCommandHealth } from "./executiveCommandHealth";
import { buildIntegrationsHubSafe, invalidateIntegrationsHubCache, testIntegrationHubProvider } from "./integrationsHubEngine";
import { listScheduledJobs } from "./workflowEngine";
import { listLiveCallMonitors, listRecentVoiceJobs } from "./auraVoiceJobQueue";
import { scanKpiAnomalies, type KpiAnomalyAlert } from "./anomalyMonitor";
import { getHqUploadRoot } from "./hqFileStorage";

export type MonitorComponentStatus =
  | "healthy"
  | "degraded"
  | "critical"
  | "unknown"
  | "timed out"
  | "unreachable"
  | "not configured"
  | "not deployed"
  | "configured";

export type MonitorComponent = {
  id: string;
  label: string;
  status: MonitorComponentStatus;
  score: number | null;
  detail: string;
  meta?: string;
  /** False when this score must not be averaged into an outage. */
  counted?: boolean;
};

export type EnterpriseMonitoringOverview = {
  overallScore: number | null;
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

export function presentCheckedRatio(input: {
  timedOut: boolean;
  healthy: number;
  checked: number;
  notDeployed: number;
  at: string;
  noun: string;
}): { status: MonitorComponentStatus; score: number | null; counted: boolean; detail: string } {
  if (input.timedOut) {
    return {
      status: "timed out",
      score: null,
      counted: false,
      detail: `timed out at ${input.at}. A missing probe is not an outage.`,
    };
  }
  if (input.checked === 0 && input.notDeployed > 0) {
    return {
      status: "not deployed",
      score: null,
      counted: false,
      detail: `not deployed at ${input.at}. localhost sidecars are not the Headquarters database, Founder session, or Postmark path.`,
    };
  }
  if (input.checked === 0) {
    return {
      status: "timed out",
      score: null,
      counted: false,
      detail: `timed out at ${input.at}. A missing probe is not an outage.`,
    };
  }
  const score = Math.round((input.healthy / input.checked) * 100);
  const status: MonitorComponentStatus =
    input.healthy === 0 ? "unreachable" : score >= 80 ? "healthy" : "degraded";
  return {
    status,
    score,
    counted: true,
    detail: `${input.healthy}/${input.checked} ${input.noun}`,
  };
}

export function labelAuthProbe(input: {
  jwtConfigured: boolean;
  authService: boolean | null;
  authUrl: string;
  sidecarTimedOut: boolean;
  sessionCount: number;
  at: string;
}): { status: MonitorComponentStatus; score: number | null; counted: boolean; detail: string; meta: string } {
  if (!input.jwtConfigured) {
    return {
      status: "not configured",
      score: null,
      counted: false,
      detail: "JWT/SESSION secret missing",
      meta: "not configured",
    };
  }
  if (input.sidecarTimedOut) {
    return {
      status: "timed out",
      score: null,
      counted: false,
      detail: `timed out at ${input.at}. Not the Founder session.`,
      meta: "timed out",
    };
  }
  if (input.authService === false && isLocalSidecarUrl(input.authUrl)) {
    return {
      status: "not deployed",
      score: null,
      counted: false,
      detail: "Auth sidecar is not deployed. This is not the Founder session or the Headquarters database.",
      meta: "not deployed",
    };
  }
  if (input.authService === true) {
    return {
      status: "healthy",
      score: 95,
      counted: true,
      detail: `Session secrets configured · ${input.sessionCount} tracked session(s)`,
      meta: "auth service up",
    };
  }
  if (input.authService === false) {
    return {
      status: "unreachable",
      score: 55,
      counted: true,
      detail: `Auth service did not respond at ${input.at}.`,
      meta: "unreachable",
    };
  }
  return {
    status: "unknown",
    score: null,
    counted: false,
    detail: `Auth sidecar was not in the service map at ${input.at}.`,
    meta: "unknown",
  };
}

const UNSCORED_STATUSES = new Set([
  "timed out",
  "unknown",
  "not deployed",
  "not configured",
  "configured",
]);

/** A timed-out or unknown card shows its status, not a zero health score. */
export function formatMonitorCardValue(input: {
  status: string;
  score: number | null;
  counted?: boolean;
}): string {
  if (input.counted === false || input.score == null || UNSCORED_STATUSES.has(input.status)) {
    return input.status || "unknown";
  }
  return `${input.score}/100`;
}

export function overallFromComponents(
  components: Array<{ status: string; score: number | null; counted?: boolean }>
): { overallScore: number | null; overallStatus: MonitorComponentStatus } {
  const scored = components.filter(
    (component) =>
      component.counted !== false &&
      component.score != null &&
      !UNSCORED_STATUSES.has(component.status)
  );
  if (!scored.length) {
    const status: MonitorComponentStatus = components.some((component) => component.status === "timed out")
      ? "timed out"
      : "unknown";
    return { overallScore: null, overallStatus: status };
  }
  const overallScore = Math.round(
    scored.reduce((sum, component) => sum + (component.score as number), 0) / scored.length
  );
  return { overallScore, overallStatus: statusFromScore(overallScore) };
}

async function readMailboxCard(): Promise<MonitorComponent> {
  try {
    const { graphMailboxHealth } = await import("./microsoftGraphMailbox");
    const card = mailboxPollCard(graphMailboxHealth());
    return { id: "mailbox", label: "Mailbox poll", ...card };
  } catch {
    const card = mailboxPollCard(null);
    return { id: "mailbox", label: "Mailbox poll", ...card };
  }
}

export function mailboxPollCard(input: {
  lastSuccessfulMailboxPoll: string | null;
  lastMailboxPollStatus: string | null;
} | null): { status: MonitorComponentStatus; score: number | null; counted: boolean; detail: string } {
  const pollAt = input?.lastSuccessfulMailboxPoll?.trim() || "";
  if (!pollAt) {
    return {
      status: "unknown",
      score: null,
      counted: false,
      detail: "Mailbox poll is unavailable.",
    };
  }
  const pollStatus = input?.lastMailboxPollStatus || "unknown";
  if (pollStatus === "ok") {
    return {
      status: "healthy",
      score: 100,
      counted: true,
      detail: `Last verified mailbox poll ${pollAt} · ok. No mail sent.`,
    };
  }
  if (pollStatus === "failed") {
    return {
      status: "degraded",
      score: 40,
      counted: true,
      detail: `Last verified mailbox poll ${pollAt} · failed. No mail sent.`,
    };
  }
  return {
    status: "unknown",
    score: null,
    counted: false,
    detail: `Last verified mailbox poll ${pollAt} · ${pollStatus}. No mail sent.`,
  };
}

export function integrationDisposition(input: {
  status: string;
  liveHealthy: boolean | null;
}): "healthy" | "degraded" | "not configured" | "configured" | "unknown" {
  if (input.liveHealthy === true) return "healthy";
  const status = input.status.toLowerCase();
  if (status === "degraded" || status === "partial" || status === "error" || status === "unreachable") {
    return "degraded";
  }
  if (input.liveHealthy === false) return "degraded";
  if (status === "not_configured" || status === "not configured" || status === "missing") {
    return "not configured";
  }
  if (status === "connected" || status === "configured") return "configured";
  return "unknown";
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

  const sidecarTimedOut = Object.keys(services).length === 0;
  const labeled = labelAuthProbe({
    jwtConfigured: jwtOk,
    authService: authService === true ? true : authService === false ? false : null,
    authUrl: IFCDC_SERVICE_URLS.auth,
    sidecarTimedOut,
    sessionCount,
    at: new Date().toISOString(),
  });
  return {
    id: "authentication",
    label: "Authentication",
    status: labeled.status,
    score: labeled.score,
    counted: labeled.counted,
    detail: labeled.detail,
    meta: labeled.meta,
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
    overallScore: null,
    overallStatus: "timed out",
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
    degraded: false,
    warning: `Monitoring timed out at ${new Date().toISOString()}. This is not an outage.`,
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
    withTimeout(pollAllApps() as Promise<Awaited<ReturnType<typeof pollAllApps>> | null>, 10_000, null, "apps"),
    withTimeout(buildIntegrationsHubSafe(), 14_000, null, "integrations"),
    withTimeout(listScheduledJobs() as Promise<Awaited<ReturnType<typeof listScheduledJobs>> | null>, 8_000, null, "scheduled-jobs"),
    withTimeout(listRecentVoiceJobs(20), 6_000, [], "voice-jobs"),
    withTimeout(Promise.resolve(listLiveCallMonitors()), 2_000, [], "live-calls"),
    withTimeout(scanKpiAnomalies(), 10_000, [], "anomalies"),
    withTimeout(probeDatabase(), 6_000, {
      id: "database",
      label: "Database",
      status: "timed out" as const,
      score: null,
      counted: false,
      detail: "timed out. A missing probe is not an outage. SELECT 1 did not finish.",
    }, "database"),
    withTimeout(probeStorage(), 4_000, {
      id: "storage",
      label: "Storage",
      status: "timed out" as const,
      score: null,
      counted: false,
      detail: "timed out. A missing probe is not an outage.",
    }, "storage"),
    withTimeout(probeAuth(), 8_000, {
      id: "authentication",
      label: "Authentication",
      status: "timed out" as const,
      score: null,
      counted: false,
      detail: "timed out. Not the Founder session. A missing probe is not an outage.",
    }, "authentication"),
    withTimeout(notificationPendingCount(), 4_000, 0, "notifications"),
  ]);

  const monitoredAt = new Date().toISOString();
  const servicesTimedOut = services == null || Object.keys(services).length === 0;
  const serviceEntries: { id: string; healthy: boolean }[] = [];
  let notDeployedServices = 0;
  for (const [id, ok] of Object.entries(services || {})) {
    const url = IFCDC_SERVICE_URLS[id as keyof typeof IFCDC_SERVICE_URLS] || "";
    const skipped = id === "aura" && !shouldProbeLegacy4101();
    if (!ok && (skipped || isLocalSidecarUrl(url))) {
      notDeployedServices += 1;
      continue;
    }
    serviceEntries.push({ id, healthy: Boolean(ok) });
  }
  const servicesView = presentCheckedRatio({
    timedOut: servicesTimedOut,
    healthy: serviceEntries.filter((s) => s.healthy).length,
    checked: serviceEntries.length,
    notDeployed: notDeployedServices,
    at: monitoredAt,
    noun: "platform services with a live check",
  });

  const appsTimedOut = apps == null;
  const polls = apps ?? [];
  const shortcutPolls = polls.filter(
    (a) => a.deployment === "production-locked" && a.latencyMs === 0 && !a.error
  );
  const livePolls = polls.filter(
    (a) => !(a.deployment === "production-locked" && a.latencyMs === 0 && !a.error)
  );
  const notConfiguredPolls = livePolls.filter((a) =>
    Boolean(a.error && /HEALTH_URL|not_configured|Set HQ_/i.test(a.error))
  );
  const checkedPolls = livePolls.filter((a) => !notConfiguredPolls.includes(a));
  const appsView = presentCheckedRatio({
    timedOut: appsTimedOut,
    healthy: checkedPolls.filter((a) => a.healthy).length,
    checked: appsTimedOut ? 0 : checkedPolls.length,
    notDeployed: 0,
    at: monitoredAt,
    noun: "apps with a live poll",
  });
  if (!appsTimedOut && shortcutPolls.length) {
    appsView.detail += ` ${shortcutPolls.length} registry shortcut(s) are not timed live probes.`;
  }
  if (!appsTimedOut && notConfiguredPolls.length) {
    appsView.detail += ` ${notConfiguredPolls.length} not configured.`;
  }
  const appRows = polls.map((a) => {
    const shortcut = a.deployment === "production-locked" && a.latencyMs === 0 && !a.error;
    if (shortcut) {
      return {
        id: a.id,
        healthy: true,
        error: "Registry shortcut. Not a timed live probe.",
      };
    }
    return {
      id: a.id,
      healthy: Boolean(a.healthy),
      latencyMs: a.latencyMs,
      error: a.error,
    };
  });

  const hubTimedOut = hub == null;
  const integrations = ((hub as { integrations?: Array<{
    id: string;
    name: string;
    status: string;
    health?: { healthy?: boolean; message?: string };
  }> } | null)?.integrations ?? []).map((i) => {
    const disposition = integrationDisposition({
      status: i.status,
      liveHealthy: i.health?.healthy === true ? true : i.health?.healthy === false ? false : null,
    });
    return {
      id: i.id,
      name: i.name,
      status: disposition,
      healthy: disposition === "healthy",
      message: i.health?.message || i.status,
    };
  });
  const liveIntegrations = integrations.filter((i) => i.status === "healthy" || i.status === "degraded");
  const configuredOnly = integrations.filter((i) => i.status === "configured").length;
  const notConfiguredIntegrations = integrations.filter((i) => i.status === "not configured").length;
  const degradedIntegrations = integrations.filter((i) => i.status === "degraded").length;
  const integView = hubTimedOut
    ? presentCheckedRatio({
        timedOut: true,
        healthy: 0,
        checked: 0,
        notDeployed: 0,
        at: monitoredAt,
        noun: "connectors",
      })
    : liveIntegrations.length === 0
      ? {
          status: (notConfiguredIntegrations > 0 ? "not configured" : "configured") as MonitorComponentStatus,
          score: null,
          counted: false,
          detail: `${notConfiguredIntegrations} not configured. ${configuredOnly} configured. A missing probe is not an outage. ${monitoredAt}`,
        }
      : presentCheckedRatio({
          timedOut: false,
          healthy: integrations.filter((i) => i.status === "healthy").length,
          checked: liveIntegrations.length,
          notDeployed: 0,
          at: monitoredAt,
          noun: "connectors with a live check",
        });
  if (!hubTimedOut && liveIntegrations.length > 0) {
    integView.detail += ` ${degradedIntegrations} degraded. ${notConfiguredIntegrations} not configured. ${monitoredAt}`;
  }

  const jobsTimedOut = scheduledJobs == null;
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
  const jobsScore = jobsTimedOut
    ? null
    : jobsMapped.length
      ? Math.max(40, 100 - failedJobs * 15)
      : 85;

  const voiceFailed = (voiceJobs || []).filter((j) => j.status === "error").length;
  const voiceActive = (liveCalls || []).length;

  const systemPillar = commandHealth?.pillars.find((p) => p.id === "system");
  const apiFromPolls = appsView.counted || servicesView.counted
    ? Math.round(((appsView.counted ? appsView.score : servicesView.score) + (servicesView.counted ? servicesView.score : appsView.score)) / 2)
    : null;
  const apiScore = systemPillar?.score ?? apiFromPolls;

  const components: MonitorComponent[] = [
    {
      id: "services",
      label: "Live Services",
      status: servicesView.status,
      score: servicesView.score,
      counted: servicesView.counted,
      detail: servicesView.detail,
    },
    {
      id: "api",
      label: "API Health",
      status: apiScore == null ? appsView.status : systemPillar ? statusFromScore(apiScore) : appsView.status,
      score: apiScore,
      counted: apiScore != null,
      detail: systemPillar?.meta
        ? `${systemPillar.meta} · ${monitoredAt}`
        : appsView.detail,
    },
    database,
    storage,
    authentication,
    {
      id: "integrations",
      label: "Integrations",
      status: integView.status,
      score: integView.score,
      counted: integView.counted,
      detail: integView.detail,
    },
    {
      id: "jobs",
      label: "Background Jobs",
      status: jobsTimedOut ? "timed out" : statusFromScore(jobsScore ?? 0),
      score: jobsScore,
      counted: !jobsTimedOut,
      detail: jobsTimedOut
        ? `timed out at ${monitoredAt}. A missing probe is not an outage.`
        : `${jobsMapped.filter((j) => j.enabled).length} scheduled · ${failedJobs} failed · ${voiceActive} live voice`,
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
    await readMailboxCard(),
  ];

  const overall = overallFromComponents(components);
  const overallScore = overall.overallScore;
  const timedOutComponents = components.filter((c) => c.status === "timed out");

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
    overallStatus: overall.overallStatus,
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
    monitoredAt,
    degraded: components.some((c) => c.status === "degraded" || c.status === "critical" || c.status === "unreachable"),
    warning: timedOutComponents.length
      ? `timed out at ${monitoredAt}. ${timedOutComponents.map((c) => c.label).join(", ")}. A missing probe is not an outage.`
      : null,
    source: "live",
  };

  if (timedOutComponents.length === 0) cache = { at: now, data };
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

/** Continuous recovery + Founder alerts for sustained integration failures. */
let monitoringWatchdogTimer: ReturnType<typeof setInterval> | null = null;
const failureStreak = new Map<string, number>();

export function scheduleEnterpriseMonitoringWatchdog(): void {
  if (monitoringWatchdogTimer) return;
  const intervalMs = Number(process.env.ENTERPRISE_MONITOR_INTERVAL_MS || 15 * 60_000);
  const run = async () => {
    try {
      const overview = await buildEnterpriseMonitoringOverview({ bypassCache: true });
      const retry = await retryDegradedIntegrations({ maxProviders: 8 });
      for (const id of retry.recovered) failureStreak.delete(id);
      for (const f of retry.failed) {
        const n = (failureStreak.get(f.id) ?? 0) + 1;
        failureStreak.set(f.id, n);
        if (n >= 2) {
          try {
            const { createLeadershipAlert } = await import("./criticalAlerts");
            await createLeadershipAlert({
              alertType: "enterprise_monitor_failure",
              title: `Integration still degraded: ${f.id}`,
              message: `${f.message}. AURA attempted automatic recovery ${n} times. Recommend checking credentials and provider status.`,
              priority: "high",
              sourceModule: "technical",
              path: "/hq/integrations",
            });
          } catch {
            /* optional */
          }
        }
      }
      if (overview.degraded || (overview.alerts?.length ?? 0) > 0) {
        console.log(
          `Enterprise monitoring: score=${overview.overallScore ?? "n/a"} recovered=${retry.recovered.length} failed=${retry.failed.length}`
        );
      }
      try {
        const { runEnterpriseHealthWatchdogTick } = await import("./enterpriseHealthImprovementEngine");
        await runEnterpriseHealthWatchdogTick();
      } catch (err) {
        console.warn(
          "Enterprise health watchdog tick failed:",
          err instanceof Error ? err.message : err
        );
      }
    } catch (err) {
      console.warn(
        "Enterprise monitoring watchdog tick failed:",
        err instanceof Error ? err.message : err
      );
    }
  };
  monitoringWatchdogTimer = setInterval(() => {
    void run();
  }, intervalMs);
  // First pass after boot settle
  setTimeout(() => void run(), 180_000);
  console.log(`Enterprise monitoring watchdog: every ${Math.round(intervalMs / 60_000)}m`);
}
