/**
 * AURA Enterprise Brain v1 — Founder-only executive operating surface.
 * Module 1: Executive Command Center (read-only aggregator).
 * Extends existing HQ engines; does not replace Brain 2.0 / 3.0 / Founder Command Center.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { getEmailDeliveryStatus } from "../lib/notifications";
import { SOFTWARE_DIVISION_APPS, pollAllApps } from "./appRegistry";
import { buildExecutiveCommandHealth } from "./executiveCommandHealth";
import { listLeadershipAlerts } from "./criticalAlerts";
import { buildHeadquartersActivityFeed, buildOrganizationHealthScore } from "./analyticsReporting";
import { checkIfcdcServices } from "../lib/ifcdc";

const SECTION_TIMEOUT_MS = 10_000;

export type AuraBrainV1AttentionItem = {
  id: string;
  severity: "critical" | "high" | "watch" | "info";
  title: string;
  detail: string;
  path?: string;
  source: string;
};

export type AuraBrainV1SystemRow = {
  id: string;
  label: string;
  status: "healthy" | "action_required" | "watch" | "unknown";
  detail: string;
};

export type AuraBrainV1ProjectRow = {
  id: string;
  name: string;
  status: string;
  healthy: boolean | null;
  detail: string;
};

export type ExecutiveCommandCenterV1 = {
  module: "executive-command-center";
  version: "v1";
  generatedAt: string;
  mode: "read_only";
  lastLoginAt: string | null;
  answers: {
    needsAttention: AuraBrainV1AttentionItem[];
    changedSinceLastLogin: AuraBrainV1AttentionItem[];
    systemsHealthy: AuraBrainV1SystemRow[];
    systemsRequireAction: AuraBrainV1SystemRow[];
    activeProjects: AuraBrainV1ProjectRow[];
    deploymentsPending: AuraBrainV1ProjectRow[];
    emailsFailed: AuraBrainV1AttentionItem[];
    doNext: string[];
  };
  summary: {
    attentionCount: number;
    changeCount: number;
    healthySystemCount: number;
    actionSystemCount: number;
    activeProjectCount: number;
    pendingDeployCount: number;
    failedEmailCount: number;
    commandHealthOverall: number | null;
    emailConfigured: boolean;
    emailFrom: string | null;
  };
  moduleRoadmap: Array<{ id: number; name: string; status: "live" | "planned" }>;
  degraded: boolean;
  warning: string | null;
};

function withTimeout<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
  return Promise.race([
    promise.catch((err) => {
      console.warn(`[brain-v1] ${label}:`, err instanceof Error ? err.message : err);
      return fallback;
    }),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), SECTION_TIMEOUT_MS)),
  ]);
}

function redactResult(result: string): string {
  return result
    .replace(/(sk-|re_|whsec_|Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[REDACTED]")
    .replace(/(api[_-]?key|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 2000);
}

export async function ensureAuraBrainV1Tables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_enterprise_brain_v1_action_log (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      user_id TEXT,
      user_email TEXT,
      command TEXT NOT NULL,
      result TEXT NOT NULL,
      metadata_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aura_brain_v1_actions_created
      ON aura_enterprise_brain_v1_action_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aura_brain_v1_actions_user
      ON aura_enterprise_brain_v1_action_log(user_email);
  `);
}

export async function logAuraBrainV1Action(opts: {
  userId?: string | null;
  userEmail?: string | null;
  command: string;
  result: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  await ensureAuraBrainV1Tables();
  const db = await getDb();
  const id = crypto.randomUUID();
  const safeMeta = opts.metadata
    ? JSON.stringify(opts.metadata).replace(/(sk-|re_|whsec_)[A-Za-z0-9._-]{8,}/gi, "$1[REDACTED]")
    : null;
  await db.run(
    `INSERT INTO aura_enterprise_brain_v1_action_log
      (id, created_at, user_id, user_email, command, result, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    new Date().toISOString(),
    opts.userId ?? null,
    opts.userEmail ?? null,
    opts.command.slice(0, 500),
    redactResult(opts.result),
    safeMeta
  );
  return id;
}

export async function listAuraBrainV1Actions(limit = 50): Promise<Record<string, unknown>[]> {
  await ensureAuraBrainV1Tables();
  const db = await getDb();
  return db.all(
    `SELECT id, created_at, user_id, user_email, command, result, metadata_json
     FROM aura_enterprise_brain_v1_action_log
     ORDER BY created_at DESC LIMIT ?`,
    Math.min(Math.max(limit, 1), 200)
  );
}

async function resolveLastLoginAt(email?: string | null): Promise<string | null> {
  if (!email) return null;
  try {
    const db = await getDb();
    const rows = (await db.all(
      `SELECT created_at FROM hq_login_history
       WHERE success = 1 AND lower(email) = lower(?)
       ORDER BY created_at DESC LIMIT 2`,
      email
    )) as { created_at: string }[];
    // Index 0 is current session login; prior successful login is "since last login".
    return rows[1]?.created_at ?? rows[0]?.created_at ?? null;
  } catch {
    return null;
  }
}

async function collectFailedEmailSignals(): Promise<AuraBrainV1AttentionItem[]> {
  const items: AuraBrainV1AttentionItem[] = [];
  try {
    const db = await getDb();
    const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const audit = (await db.all(
      `SELECT id, action, detail, created_at FROM hq_audit_log
       WHERE created_at >= ?
         AND (action LIKE '%email%fail%' OR action LIKE '%otp_send_failed%' OR detail LIKE '%email%fail%')
       ORDER BY created_at DESC LIMIT 15`,
      since
    )) as { id: string; action: string; detail: string; created_at: string }[];
    for (const row of audit) {
      items.push({
        id: `audit-${row.id}`,
        severity: "high",
        title: row.action,
        detail: (row.detail || "Email-related failure").slice(0, 240),
        path: "/hq/email-readiness",
        source: "audit",
      });
    }
  } catch {
    /* table may be empty */
  }

  const email = getEmailDeliveryStatus();
  if (!email.configured) {
    items.push({
      id: "email-not-configured",
      severity: "critical",
      title: "Email transport not configured",
      detail: "Resend API key is not set — outbound HQ email will not send.",
      path: "/hq/email-readiness",
      source: "email",
    });
  }

  return items;
}

function severityFromPriority(priority: unknown): AuraBrainV1AttentionItem["severity"] {
  const p = String(priority || "").toLowerCase();
  if (p === "high" || p === "critical") return "critical";
  if (p === "normal" || p === "medium") return "watch";
  return "info";
}

export async function buildExecutiveCommandCenterV1(opts: {
  userId?: string | null;
  userEmail?: string | null;
}): Promise<ExecutiveCommandCenterV1> {
  const generatedAt = new Date().toISOString();
  let degraded = false;
  const warnings: string[] = [];

  const [commandHealth, apps, services, alerts, activity, lastLoginAt, emailFails] = await Promise.all([
    withTimeout(buildExecutiveCommandHealth(), null, "command-health"),
    withTimeout(pollAllApps(), [], "poll-apps"),
    withTimeout(checkIfcdcServices(), {} as Record<string, boolean>, "services"),
    withTimeout(listLeadershipAlerts(40), [], "alerts"),
    withTimeout(buildHeadquartersActivityFeed(20), [], "activity"),
    withTimeout(resolveLastLoginAt(opts.userEmail), null, "last-login"),
    withTimeout(collectFailedEmailSignals(), [], "email-fails"),
  ]);

  if (!commandHealth) {
    degraded = true;
    warnings.push("Command health timed out or unavailable.");
  }

  const healthByApp = new Map(apps.map((a) => [a.id, a]));
  const systems: AuraBrainV1SystemRow[] = [];

  for (const [id, ok] of Object.entries(services)) {
    systems.push({
      id: `svc-${id}`,
      label: `Platform · ${id}`,
      status: ok ? "healthy" : "action_required",
      detail: ok ? "Responding" : "Unhealthy or unreachable",
    });
  }

  if (commandHealth) {
    for (const pillar of commandHealth.pillars) {
      const status =
        pillar.status === "good"
          ? "healthy"
          : pillar.status === "critical"
            ? "action_required"
            : pillar.status === "watch"
              ? "watch"
              : "unknown";
      systems.push({
        id: `pillar-${pillar.id}`,
        label: pillar.label,
        status,
        detail: `${pillar.score}/100 · ${pillar.meta}`,
      });
    }
  }

  for (const app of SOFTWARE_DIVISION_APPS) {
    const health = healthByApp.get(app.id);
    const healthy = health ? Boolean(health.healthy) : null;
    systems.push({
      id: `app-${app.id}`,
      label: app.name,
      status:
        healthy === true
          ? "healthy"
          : healthy === false
            ? "action_required"
            : app.status === "planned"
              ? "watch"
              : "unknown",
      detail: health?.error
        ? String(health.error).slice(0, 160)
        : healthy === true
          ? `Healthy · ${health?.latencyMs ?? "—"}ms`
          : `Registry status: ${app.status}`,
    });
  }

  const systemsHealthy = systems.filter((s) => s.status === "healthy");
  const systemsRequireAction = systems.filter((s) => s.status === "action_required");

  const activeProjects: AuraBrainV1ProjectRow[] = SOFTWARE_DIVISION_APPS.filter(
    (a) => a.status === "production" || a.status === "mvp" || a.status === "development" || a.status === "locked"
  ).map((a) => {
    const health = healthByApp.get(a.id);
    return {
      id: a.id,
      name: a.name,
      status: a.status,
      healthy: health ? Boolean(health.healthy) : null,
      detail: a.description,
    };
  });

  const deploymentsPending: AuraBrainV1ProjectRow[] = SOFTWARE_DIVISION_APPS.filter(
    (a) => a.status === "development" || a.status === "mvp" || a.status === "planned"
  ).map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    healthy: healthByApp.has(a.id) ? Boolean(healthByApp.get(a.id)?.healthy) : null,
    detail: `Pending production readiness · current status ${a.status}`,
  }));

  const needsAttention: AuraBrainV1AttentionItem[] = [];

  for (const row of systemsRequireAction.slice(0, 12)) {
    needsAttention.push({
      id: `sys-${row.id}`,
      severity: "high",
      title: `${row.label} requires action`,
      detail: row.detail,
      path: row.id.startsWith("app-") ? "/hq/software" : "/hq/monitoring",
      source: "systems",
    });
  }

  for (const alert of alerts.slice(0, 20)) {
    const a = alert as Record<string, unknown>;
    if (Number(a.read) === 1) continue;
    needsAttention.push({
      id: `alert-${String(a.id)}`,
      severity: severityFromPriority(a.priority),
      title: String(a.title || "Leadership alert"),
      detail: String(a.message || "").slice(0, 240),
      path: typeof a.path === "string" ? a.path : "/hq/notifications",
      source: "alerts",
    });
  }

  for (const fail of emailFails) {
    if (!needsAttention.some((n) => n.id === fail.id)) needsAttention.push(fail);
  }

  const since = lastLoginAt ? Date.parse(lastLoginAt) : NaN;
  const changedSinceLastLogin: AuraBrainV1AttentionItem[] = [];
  if (Number.isFinite(since)) {
    for (const event of activity) {
      const e = event as { id: string; title: string; detail: string; timestamp: string; type?: string };
      const ts = Date.parse(e.timestamp);
      if (!Number.isFinite(ts) || ts < since) continue;
      changedSinceLastLogin.push({
        id: `act-${e.id}`,
        severity: "info",
        title: e.title,
        detail: e.detail,
        source: e.type || "activity",
      });
    }
    for (const alert of alerts) {
      const a = alert as Record<string, unknown>;
      const ts = Date.parse(String(a.created_at || ""));
      if (!Number.isFinite(ts) || ts < since) continue;
      changedSinceLastLogin.push({
        id: `chg-alert-${String(a.id)}`,
        severity: severityFromPriority(a.priority),
        title: String(a.title || "New alert"),
        detail: String(a.message || "").slice(0, 240),
        path: typeof a.path === "string" ? a.path : undefined,
        source: "alerts",
      });
    }
  }

  const doNext: string[] = [];
  if (systemsRequireAction.length) {
    doNext.push(`Review ${systemsRequireAction.length} system(s) requiring action in Monitoring / Software Division.`);
  }
  if (emailFails.length) {
    doNext.push("Inspect failed or unconfigured email paths on Email Readiness.");
  }
  const unreadHigh = needsAttention.filter((n) => n.severity === "critical" || n.severity === "high").length;
  if (unreadHigh) {
    doNext.push(`Clear ${unreadHigh} high-priority attention item(s) from the priority queue.`);
  }
  if (deploymentsPending.length) {
    doNext.push(`Track ${deploymentsPending.length} app(s) still below production status.`);
  }
  if (!doNext.length) {
    doNext.push("No critical blockers detected — review daily briefing when Module 3 is live.");
  }

  const email = getEmailDeliveryStatus();

  return {
    module: "executive-command-center",
    version: "v1",
    generatedAt,
    mode: "read_only",
    lastLoginAt,
    answers: {
      needsAttention: needsAttention.slice(0, 25),
      changedSinceLastLogin: changedSinceLastLogin.slice(0, 25),
      systemsHealthy,
      systemsRequireAction,
      activeProjects,
      deploymentsPending,
      emailsFailed: emailFails,
      doNext,
    },
    summary: {
      attentionCount: needsAttention.length,
      changeCount: changedSinceLastLogin.length,
      healthySystemCount: systemsHealthy.length,
      actionSystemCount: systemsRequireAction.length,
      activeProjectCount: activeProjects.length,
      pendingDeployCount: deploymentsPending.length,
      failedEmailCount: emailFails.length,
      commandHealthOverall: commandHealth?.overall ?? null,
      emailConfigured: email.configured,
      emailFrom: email.from,
    },
    moduleRoadmap: brainV1ModuleRoadmap(["executive-command-center", "organization-health"]),
    degraded,
    warning: warnings.length ? warnings.join(" ") : null,
  };
}

export type OrganizationHealthDashboardV1 = {
  module: "organization-health";
  version: "v1";
  generatedAt: string;
  mode: "read_only";
  overall: number | null;
  grade: string;
  factors: Array<{
    label: string;
    score: number;
    max: number;
    weight: string;
    status: "healthy" | "watch" | "action_required" | "unknown";
  }>;
  commandPillars: Array<{
    id: string;
    label: string;
    score: number;
    grade: string;
    status: string;
    meta: string;
  }>;
  highlights: string[];
  watchItems: string[];
  degraded: boolean;
  warning: string | null;
  moduleRoadmap: Array<{ id: number; name: string; status: "live" | "planned" }>;
};

function factorStatus(score: number): "healthy" | "watch" | "action_required" | "unknown" {
  if (!Number.isFinite(score)) return "unknown";
  if (score >= 80) return "healthy";
  if (score >= 60) return "watch";
  return "action_required";
}

function brainV1ModuleRoadmap(live: string[]): Array<{ id: number; name: string; status: "live" | "planned" }> {
  const all = [
    { id: 1, name: "Executive Command Center", key: "executive-command-center" },
    { id: 2, name: "Organization Health Dashboard", key: "organization-health" },
    { id: 3, name: "Executive Daily Briefing", key: "daily-briefing" },
    { id: 4, name: "Project Status Monitor", key: "project-status" },
    { id: 5, name: "System Health Monitor", key: "system-health" },
    { id: 6, name: "Executive Priority Queue", key: "priority-queue" },
    { id: 7, name: "Executive Action Center", key: "action-center" },
    { id: 8, name: "Secure AURA Action Log", key: "action-log" },
  ];
  return all.map((m) => ({
    id: m.id,
    name: m.name,
    status: live.includes(m.key) ? "live" : "planned",
  }));
}

export async function buildOrganizationHealthDashboardV1(): Promise<OrganizationHealthDashboardV1> {
  const generatedAt = new Date().toISOString();
  let degraded = false;
  const warnings: string[] = [];

  const [orgHealth, commandHealth] = await Promise.all([
    withTimeout(buildOrganizationHealthScore(), null, "org-health"),
    withTimeout(buildExecutiveCommandHealth(), null, "command-health"),
  ]);

  if (!orgHealth) {
    degraded = true;
    warnings.push("Organization health score unavailable.");
  }
  if (!commandHealth) {
    degraded = true;
    warnings.push("Command health pillars unavailable.");
  }

  const factors = (orgHealth?.factors ?? []).map((f) => ({
    ...f,
    status: factorStatus(f.score),
  }));

  const highlights: string[] = [];
  const watchItems: string[] = [];
  for (const f of factors) {
    if (f.status === "healthy") highlights.push(`${f.label} is healthy (${f.score}/${f.max}).`);
    if (f.status === "watch") watchItems.push(`${f.label} needs watch (${f.score}/${f.max}).`);
    if (f.status === "action_required") watchItems.push(`${f.label} requires action (${f.score}/${f.max}).`);
  }
  if (commandHealth) {
    highlights.push(`Command health overall ${commandHealth.overall} (${commandHealth.grade}).`);
    for (const p of commandHealth.pillars) {
      if (p.status === "critical" || p.status === "watch") {
        watchItems.push(`${p.label} pillar is ${p.status} (${p.score}).`);
      }
    }
  }
  if (!highlights.length) highlights.push("Health snapshot loading or degraded — retry shortly.");

  return {
    module: "organization-health",
    version: "v1",
    generatedAt,
    mode: "read_only",
    overall: orgHealth?.overall ?? null,
    grade: orgHealth?.grade ?? "—",
    factors,
    commandPillars: (commandHealth?.pillars ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      score: p.score,
      grade: p.grade,
      status: p.status,
      meta: p.meta,
    })),
    highlights: highlights.slice(0, 8),
    watchItems: watchItems.slice(0, 12),
    degraded,
    warning: warnings.length ? warnings.join(" ") : null,
    moduleRoadmap: brainV1ModuleRoadmap(["executive-command-center", "organization-health"]),
  };
}
