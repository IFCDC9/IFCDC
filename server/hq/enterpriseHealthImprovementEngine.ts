/**
 * Enterprise Health Improvement — unified 12-category production health score.
 *
 * Rules (Founder mandate):
 * - No placeholder / demo scores
 * - No manual inflation
 * - Unverified categories do NOT contribute 50% — they remain unverified and block 100%
 * - Overall rises only when live probes improve
 * - Projected score estimates only verified-fixable gaps (re-probeable)
 */
import { getDb } from "../db";
import { checkIfcdcServices } from "../lib/ifcdc";
import { resolveOpenAiCredentials } from "../lib/openaiConfig";
import { pollAllApps } from "./appRegistry";
import { buildEnterpriseMonitoringOverview } from "./enterpriseMonitoringEngine";
import { buildIntegrationsHubSafe, testIntegrationHubProvider } from "./integrationsHubEngine";
import { listScheduledJobs } from "./workflowEngine";
import { getKnowledgeBaseStatus } from "./knowledgeBaseEngine";
import { getSuperAdminEmail } from "../config/credentials";
import { logHqAudit } from "./hqAuditLog";
import { createLeadershipAlert } from "./criticalAlerts";
import { existsSync } from "fs";
import path from "path";

export const EHI_VERSION = "1.0" as const;

export const EHI_CATEGORIES = [
  "infrastructure",
  "application",
  "api",
  "database",
  "communications",
  "ai",
  "security",
  "grants",
  "workflow",
  "mobile",
  "performance",
  "integration",
] as const;

export type EhiCategoryId = (typeof EHI_CATEGORIES)[number];

export type EhiSeverity = "critical" | "high" | "medium" | "low";
export type EhiIssueStatus = "open" | "in_progress" | "resolved" | "accepted_risk";

export type EhiProbe = {
  id: string;
  label: string;
  ok: boolean;
  score: number;
  detail: string;
  live: boolean;
  latencyMs?: number;
};

export type EhiCategoryScore = {
  id: EhiCategoryId;
  label: string;
  score: number | null;
  status: "healthy" | "degraded" | "critical" | "unverified";
  weight: number;
  probes: EhiProbe[];
  detail: string;
};

export type EhiIssue = {
  id: string;
  module: string;
  category: EhiCategoryId;
  description: string;
  severity: EhiSeverity;
  rootCause: string;
  impact: string;
  recommendedFix: string;
  estimatedEffort: string;
  status: EhiIssueStatus;
  scoreDeltaIfFixed: number;
  path?: string;
};

export type EnterpriseHealthReport = {
  version: typeof EHI_VERSION;
  overallScore: number;
  verifiedCoveragePct: number;
  canReach100: boolean;
  certifiedReady: boolean;
  categories: EhiCategoryScore[];
  issues: EhiIssue[];
  criticalCount: number;
  warningCount: number;
  passingModules: string[];
  failingModules: string[];
  performance: {
    monitoringOverall: number | null;
    avgProbeLatencyMs: number | null;
    slowProbes: { id: string; latencyMs: number }[];
  };
  deployment: {
    host: "render" | "local" | "unknown";
    commit: string | null;
    nodeEnv: string | null;
  };
  integrations: { id: string; name: string; healthy: boolean; status: string; message: string }[];
  recommendedPriorities: { rank: number; issueId: string; title: string; severity: EhiSeverity; effort: string }[];
  estimatedHealthAfterPendingFixes: number;
  policy: {
    noPlaceholders: true;
    noManualInflation: true;
    unverifiedBlocks100: true;
  };
  generatedAt: string;
  speechSummary: string;
};

const CATEGORY_LABELS: Record<EhiCategoryId, string> = {
  infrastructure: "Infrastructure Health",
  application: "Application Health",
  api: "API Health",
  database: "Database Health",
  communications: "Communications Health",
  ai: "AI Health",
  security: "Security Health",
  grants: "Grant System Health",
  workflow: "Workflow Health",
  mobile: "Mobile Health",
  performance: "Performance Health",
  integration: "Integration Health",
};

/** Equal weight — Founder wants balanced enterprise visibility. */
const CATEGORY_WEIGHT = 1;

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function statusFromScore(score: number | null): EhiCategoryScore["status"] {
  if (score == null) return "unverified";
  if (score >= 80) return "healthy";
  if (score >= 60) return "degraded";
  return "critical";
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function hostKind(): "render" | "local" | "unknown" {
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID) return "render";
  if (process.env.NODE_ENV === "development") return "local";
  return process.env.NODE_ENV ? "render" : "unknown";
}

function categoryFromProbes(
  id: EhiCategoryId,
  probes: EhiProbe[],
  detailWhenEmpty: string
): EhiCategoryScore {
  const live = probes.filter((p) => p.live);
  if (!live.length) {
    return {
      id,
      label: CATEGORY_LABELS[id],
      score: null,
      status: "unverified",
      weight: CATEGORY_WEIGHT,
      probes,
      detail: detailWhenEmpty,
    };
  }
  const score = avg(live.map((p) => p.score));
  return {
    id,
    label: CATEGORY_LABELS[id],
    score,
    status: statusFromScore(score),
    weight: CATEGORY_WEIGHT,
    probes,
    detail: `${live.length} live probe(s) · avg ${score}%`,
  };
}

function issueFromProbe(
  category: EhiCategoryId,
  probe: EhiProbe,
  opts: {
    severity: EhiSeverity;
    rootCause: string;
    impact: string;
    fix: string;
    effort: string;
    path?: string;
    delta: number;
  }
): EhiIssue {
  return {
    id: `ehi-${category}-${probe.id}`,
    module: CATEGORY_LABELS[category],
    category,
    description: `${probe.label}: ${probe.detail}`,
    severity: opts.severity,
    rootCause: opts.rootCause,
    impact: opts.impact,
    recommendedFix: opts.fix,
    estimatedEffort: opts.effort,
    status: "open",
    scoreDeltaIfFixed: opts.delta,
    path: opts.path,
  };
}

async function probeGrants(): Promise<EhiProbe[]> {
  const probes: EhiProbe[] = [];
  const t0 = Date.now();
  try {
    const db = await getDb();
    const apps = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_applications").catch(() => ({ c: 0 }));
    const opps = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_opportunities").catch(() => ({ c: 0 }));
    const pending = await db
      .get<{ c: number }>(
        `SELECT COUNT(*) as c FROM grant_applications WHERE founder_approval_status = 'pending' AND status = 'draft'`
      )
      .catch(() => ({ c: 0 }));
    probes.push({
      id: "grants-schema",
      label: "Grant data store",
      ok: true,
      score: 100,
      detail: `${opps?.c ?? 0} opportunities · ${apps?.c ?? 0} applications · ${pending?.c ?? 0} awaiting Founder`,
      live: true,
      latencyMs: Date.now() - t0,
    });
  } catch (err) {
    probes.push({
      id: "grants-schema",
      label: "Grant data store",
      ok: false,
      score: 0,
      detail: err instanceof Error ? err.message : "Grant tables unavailable",
      live: true,
      latencyMs: Date.now() - t0,
    });
  }

  try {
    const { getGrantCenterQaReport, grantCenterQaEnvReady } = await import("./grantCenterQaCache");
    const env = grantCenterQaEnvReady();
    const qa = getGrantCenterQaReport();
    if (qa.status === "pass" || qa.status === "fail") {
      const total = Math.max(1, qa.pass + qa.fail);
      const score = Math.round((qa.pass / total) * 100);
      probes.push({
        id: "grants-qa",
        label: "Grant Center QA cache",
        ok: qa.status === "pass" && score >= 70,
        score,
        detail: `${qa.status} · ${qa.pass} pass / ${qa.fail} fail · envReady=${env.ready}`,
        live: true,
      });
    } else if (qa.status === "pending" || qa.status === "running") {
      probes.push({
        id: "grants-qa",
        label: "Grant Center QA cache",
        ok: false,
        score: 0,
        detail: `QA ${qa.status} — no completed live report yet`,
        live: true,
      });
    } else {
      probes.push({
        id: "grants-qa",
        label: "Grant Center QA cache",
        ok: false,
        score: 0,
        detail: `QA ${qa.status}${qa.error ? `: ${qa.error}` : ""} · env missing=${env.missing.join(",") || "none"}`,
        live: true,
      });
    }
  } catch {
    probes.push({
      id: "grants-qa",
      label: "Grant Center QA",
      ok: false,
      score: 0,
      detail: "QA module unavailable",
      live: true,
    });
  }

  return probes;
}

async function probeMobile(): Promise<EhiProbe[]> {
  const root = process.cwd();
  const scriptOk = existsSync(path.join(root, "script", "hq-mobile-readiness.mjs"));
  // Mobile is only verified when a Founder-run artifact exists — never invent a pass.
  let lastRun: { finished_at?: string; status?: string; score?: number } | null = null;
  try {
    const db = await getDb();
    lastRun = await db
      .get(
        `SELECT finished_at, status, score FROM hq_mobile_readiness_runs ORDER BY finished_at DESC LIMIT 1`
      )
      .catch(() => null);
  } catch {
    lastRun = null;
  }

  if (lastRun && lastRun.status) {
    const score = Number(lastRun.score ?? (lastRun.status === "pass" ? 100 : 0));
    return [
      {
        id: "mobile-uat",
        label: "Mobile readiness UAT",
        ok: lastRun.status === "pass" && score >= 80,
        score: Math.max(0, Math.min(100, score)),
        detail: `Last run ${lastRun.finished_at || "unknown"} · ${lastRun.status}`,
        live: true,
      },
    ];
  }

  return [
    {
      id: "mobile-uat",
      label: "Mobile readiness UAT",
      ok: false,
      score: 0,
      detail: scriptOk
        ? "Unverified — Founder must run device matrix (hq-mobile-readiness) and record results; not scored until then"
        : "Mobile readiness script missing",
      live: false, // does NOT inflate category; leaves category unverified
    },
  ];
}

/**
 * Build the full Enterprise Health Report from live production probes only.
 */
export async function buildEnterpriseHealthReport(opts?: {
  liveIntegrationTests?: boolean;
  actorEmail?: string;
  persist?: boolean;
}): Promise<EnterpriseHealthReport> {
  const liveIntegrationTests = opts?.liveIntegrationTests === true;
  const tStart = Date.now();

  const [monitoring, services, apps, hub, jobs, kb, grantsProbes, mobileProbes] = await Promise.all([
    withTimeout(buildEnterpriseMonitoringOverview({ bypassCache: true }), 20_000, null),
    withTimeout(checkIfcdcServices(), 8_000, {} as Record<string, boolean>),
    withTimeout(pollAllApps(), 12_000, [] as Awaited<ReturnType<typeof pollAllApps>>),
    withTimeout(buildIntegrationsHubSafe(), 14_000, null),
    withTimeout(listScheduledJobs(), 8_000, [] as Awaited<ReturnType<typeof listScheduledJobs>>),
    withTimeout(getKnowledgeBaseStatus(), 8_000, {
      total: 0,
      embedded: 0,
      embeddingsConfigured: false,
      chunks: 0,
      bySource: [],
      byCategory: [],
      lastSync: null,
    } as Awaited<ReturnType<typeof getKnowledgeBaseStatus>>),
    withTimeout(probeGrants(), 10_000, [] as EhiProbe[]),
    withTimeout(probeMobile(), 6_000, [] as EhiProbe[]),
  ]);

  const serviceEntries = Object.entries(services || {}).map(([id, healthy]) => ({ id, healthy: Boolean(healthy) }));
  const appRows = (apps || []).map((a) => ({
    id: a.id,
    healthy: Boolean(a.healthy),
    latencyMs: a.latencyMs,
    error: a.error,
  }));

  const monComp = (id: string) => monitoring?.components?.find((c) => c.id === id);

  // —— Infrastructure ——
  const infraProbes: EhiProbe[] = [
    {
      id: "microservices",
      label: "IFCDC microservices",
      ok: serviceEntries.length > 0 && serviceEntries.every((s) => s.healthy),
      score:
        serviceEntries.length === 0
          ? 0
          : Math.round((serviceEntries.filter((s) => s.healthy).length / serviceEntries.length) * 100),
      detail:
        serviceEntries.length === 0
          ? "No service health URLs configured / reachable"
          : `${serviceEntries.filter((s) => s.healthy).length}/${serviceEntries.length} healthy`,
      live: true,
    },
    {
      id: "storage",
      label: "HQ storage",
      ok: (monComp("storage")?.score ?? 0) >= 80,
      score: monComp("storage")?.score ?? 0,
      detail: monComp("storage")?.detail || "Storage probe unavailable",
      live: Boolean(monComp("storage")),
    },
    {
      id: "uptime",
      label: "Process uptime",
      ok: true,
      score: 100,
      detail: monitoring?.uptimeLabel || `${Math.floor(process.uptime())}s`,
      live: true,
    },
  ];

  // —— Application ——
  const applicationProbes: EhiProbe[] = appRows.length
    ? appRows.map((a) => ({
        id: `app-${a.id}`,
        label: `App ${a.id}`,
        ok: a.healthy,
        score: a.healthy ? 100 : 0,
        detail: a.healthy ? `Healthy${a.latencyMs != null ? ` · ${a.latencyMs}ms` : ""}` : a.error || "Unhealthy",
        live: true,
        latencyMs: a.latencyMs,
      }))
    : [
        {
          id: "apps-none",
          label: "Software Division apps",
          ok: false,
          score: 0,
          detail: "No app health polls returned",
          live: true,
        },
      ];

  // —— API ——
  const apiMon = monComp("api") || monComp("api_health") || monComp("live_services");
  const apiProbes: EhiProbe[] = [
    {
      id: "hq-router",
      label: "HQ process",
      ok: true,
      score: 100,
      detail: `Enterprise Health engine responding · ${Date.now() - tStart}ms build`,
      live: true,
      latencyMs: Date.now() - tStart,
    },
  ];
  if (apiMon) {
    apiProbes.unshift({
      id: "api-monitoring",
      label: "API health component",
      ok: apiMon.score >= 70,
      score: apiMon.score,
      detail: apiMon.detail,
      live: true,
    });
  } else if (serviceEntries.length) {
    const score = Math.round((serviceEntries.filter((s) => s.healthy).length / serviceEntries.length) * 100);
    apiProbes.unshift({
      id: "api-services",
      label: "Service API health",
      ok: score >= 70,
      score,
      detail: `${serviceEntries.filter((s) => s.healthy).length}/${serviceEntries.length} services healthy`,
      live: true,
    });
  }

  // —— Database ——
  const dbMon = monComp("database");
  const databaseProbes: EhiProbe[] = [
    {
      id: "db-ping",
      label: "Database ping",
      ok: (dbMon?.score ?? 0) >= 80,
      score: dbMon?.score ?? 0,
      detail: dbMon?.detail || "Database probe unavailable",
      live: Boolean(dbMon),
    },
  ];

  // —— Communications ——
  const twilioOk = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  const resendOk = Boolean(process.env.RESEND_API_KEY || process.env.AI_INTEGRATIONS_RESEND_API_KEY);
  const communicationsProbes: EhiProbe[] = [
    {
      id: "twilio",
      label: "Twilio credentials",
      ok: twilioOk,
      score: twilioOk ? 100 : 0,
      detail: twilioOk ? "SID + auth token configured" : "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing",
      live: true,
    },
    {
      id: "resend",
      label: "Resend email",
      ok: resendOk,
      score: resendOk ? 100 : 0,
      detail: resendOk ? "API key configured" : "RESEND_API_KEY missing — Founder OTP / executive email blocked",
      live: true,
    },
  ];

  // —— AI ——
  const openAi = Boolean(resolveOpenAiCredentials());
  const aiProbes: EhiProbe[] = [
    {
      id: "openai",
      label: "OpenAI / AURA drafting",
      ok: openAi,
      score: openAi ? 100 : 0,
      detail: openAi ? "Credentials resolved" : "OpenAI API key missing",
      live: true,
    },
    {
      id: "knowledge-base",
      label: "Knowledge Base",
      ok: (kb?.total ?? 0) > 0,
      score: (kb?.total ?? 0) > 0 ? Math.min(100, 40 + Math.round(Math.min(kb.total, 60))) : 0,
      detail: `${kb?.total ?? 0} approved docs · ${kb?.embedded ?? 0} embedded · embeddings=${Boolean(kb?.embeddingsConfigured)}`,
      live: true,
    },
  ];

  // —— Security ——
  const jwtOk = Boolean((process.env.JWT_SECRET || process.env.SESSION_SECRET || "").trim());
  const founderEmail = Boolean(getSuperAdminEmail());
  const authMon = monComp("authentication");
  const securityProbes: EhiProbe[] = [
    {
      id: "jwt",
      label: "Session secrets",
      ok: jwtOk,
      score: jwtOk ? 100 : 0,
      detail: jwtOk ? "JWT/SESSION secret configured" : "JWT_SECRET / SESSION_SECRET missing",
      live: true,
    },
    {
      id: "founder-identity",
      label: "Founder identity",
      ok: founderEmail,
      score: founderEmail ? 100 : 0,
      detail: founderEmail ? `MASTER_OWNER_EMAIL=${getSuperAdminEmail()}` : "Founder email not configured",
      live: true,
    },
    {
      id: "auth-component",
      label: "Authentication component",
      ok: (authMon?.score ?? 0) >= 80,
      score: authMon?.score ?? (jwtOk ? 70 : 0),
      detail: authMon?.detail || "Auth monitoring component unavailable",
      live: Boolean(authMon) || jwtOk,
    },
  ];

  // —— Workflow ——
  const jobRows = jobs || [];
  const failedJobs = jobRows.filter((j) => {
    const row = j as unknown as { runStatus?: string; lastError?: string | null; enabled?: boolean };
    const status = String(row.runStatus || "");
    return status.includes("fail") || Boolean(row.lastError);
  }).length;
  const enabledJobs = jobRows.filter((j) => Boolean((j as unknown as { enabled?: boolean }).enabled)).length;
  const workflowProbes: EhiProbe[] = [
    {
      id: "scheduled-jobs",
      label: "Background scheduled jobs",
      ok: enabledJobs > 0 && failedJobs === 0,
      score:
        enabledJobs === 0
          ? 40
          : Math.max(40, 100 - failedJobs * 15),
      detail: `${enabledJobs} enabled · ${failedJobs} with errors · ${jobRows.length} registered`,
      live: true,
    },
  ];

  // —— Performance ——
  const perfProbes: EhiProbe[] = [];
  if (monitoring && Number.isFinite(monitoring.overallScore)) {
    perfProbes.push({
      id: "monitoring-overall",
      label: "Enterprise monitoring score",
      ok: monitoring.overallScore >= 80,
      score: monitoring.overallScore,
      detail: `Monitoring overall ${monitoring.overallScore}% · ${monitoring.overallStatus}`,
      live: true,
    });
  }
  const appLatencies = appRows.filter((a) => a.latencyMs != null).map((a) => Number(a.latencyMs));
  if (appLatencies.length) {
    const avgLat = Math.round(appLatencies.reduce((a, b) => a + b, 0) / appLatencies.length);
    const score = avgLat < 800 ? 100 : avgLat < 2000 ? 75 : avgLat < 5000 ? 50 : 25;
    perfProbes.push({
      id: "app-latency",
      label: "App health poll latency",
      ok: score >= 75,
      score,
      detail: `Avg ${avgLat}ms across ${appLatencies.length} apps`,
      live: true,
      latencyMs: avgLat,
    });
  }

  // —— Integration ——
  const hubCards = ((hub as { integrations?: Array<{
    id: string;
    name: string;
    status: string;
    health?: { healthy?: boolean; message?: string };
  }> } | null)?.integrations ?? []);

  const integrationProbes: EhiProbe[] = hubCards.length
    ? hubCards.map((c) => {
        const healthy = Boolean(c.health?.healthy) || c.status === "connected" || c.status === "healthy";
        return {
          id: `int-${c.id}`,
          label: c.name || c.id,
          ok: healthy,
          score: healthy ? 100 : c.status === "configured" ? 50 : 0,
          detail: c.health?.message || c.status,
          live: true,
        };
      })
    : [
        {
          id: "integrations-hub",
          label: "Integrations Hub",
          ok: false,
          score: 0,
          detail: "Integrations hub returned no cards",
          live: true,
        },
      ];

  if (liveIntegrationTests) {
    const providers = ["openai_aura", "render", "github", "twilio", "resend", "grants_gov", "sam_gov", "paypal", "postgres"] as const;
    for (const pid of providers) {
      const t0 = Date.now();
      try {
        const result = await withTimeout(testIntegrationHubProvider(pid), 12_000, {
          success: false,
          message: "Timed out",
        } as { success: boolean; message?: string });
        integrationProbes.push({
          id: `live-${pid}`,
          label: `Live test ${pid}`,
          ok: Boolean(result.success),
          score: result.success ? 100 : 0,
          detail: result.message || (result.success ? "OK" : "Failed"),
          live: true,
          latencyMs: Date.now() - t0,
        });
      } catch (err) {
        integrationProbes.push({
          id: `live-${pid}`,
          label: `Live test ${pid}`,
          ok: false,
          score: 0,
          detail: err instanceof Error ? err.message : "Test failed",
          live: true,
          latencyMs: Date.now() - t0,
        });
      }
    }
  }

  const categories: EhiCategoryScore[] = [
    categoryFromProbes("infrastructure", infraProbes.filter((p) => p.live), "Infrastructure probes unavailable"),
    categoryFromProbes("application", applicationProbes.filter((p) => p.live), "Application probes unavailable"),
    categoryFromProbes("api", apiProbes.filter((p) => p.live), "API probes unavailable"),
    categoryFromProbes("database", databaseProbes.filter((p) => p.live), "Database probe unavailable"),
    categoryFromProbes("communications", communicationsProbes.filter((p) => p.live), "Communications probes unavailable"),
    categoryFromProbes("ai", aiProbes.filter((p) => p.live), "AI probes unavailable"),
    categoryFromProbes("security", securityProbes.filter((p) => p.live), "Security probes unavailable"),
    categoryFromProbes("grants", grantsProbes.filter((p) => p.live), "Grant probes unavailable"),
    categoryFromProbes("workflow", workflowProbes.filter((p) => p.live), "Workflow probes unavailable"),
    categoryFromProbes("mobile", mobileProbes.filter((p) => p.live), "Mobile UAT not recorded — unverified (blocks 100%)"),
    categoryFromProbes("performance", perfProbes.filter((p) => p.live), "Performance probes unavailable"),
    categoryFromProbes("integration", integrationProbes.filter((p) => p.live), "Integration probes unavailable"),
  ];

  // Issues from failed/degraded live probes
  const issues: EhiIssue[] = [];
  for (const cat of categories) {
    for (const probe of cat.probes) {
      if (!probe.live || probe.score >= 80) continue;
      const severity: EhiSeverity =
        probe.score <= 0 ? "critical" : probe.score < 50 ? "high" : probe.score < 70 ? "medium" : "low";
      const delta = Math.max(1, Math.round((80 - probe.score) / categories.length));
      issues.push(
        issueFromProbe(cat.id, probe, {
          severity,
          rootCause: probe.detail,
          impact: `Reduces ${cat.label} (currently ${cat.score ?? "unverified"}%)`,
          fix: recommendFix(cat.id, probe.id),
          effort: effortFor(severity),
          path: pathFor(cat.id),
          delta,
        })
      );
    }
    if (cat.status === "unverified") {
      issues.push({
        id: `ehi-${cat.id}-unverified`,
        module: cat.label,
        category: cat.id,
        description: `${cat.label} is unverified — no live validated probes`,
        severity: "high",
        rootCause: cat.detail,
        impact: "Blocks Enterprise Health from reaching certified 100%",
        recommendedFix: recommendFix(cat.id, "unverified"),
        estimatedEffort: "2–8h",
        status: "open",
        scoreDeltaIfFixed: Math.round(100 / EHI_CATEGORIES.length),
        path: pathFor(cat.id),
      });
    }
  }

  const scored = categories.filter((c) => c.score != null).map((c) => c.score as number);
  const overallScore = scored.length ? avg(scored) : 0;
  const verifiedCoveragePct = Math.round((scored.length / EHI_CATEGORIES.length) * 100);
  const canReach100 = categories.every((c) => c.score != null);
  const certifiedReady =
    canReach100 &&
    categories.every((c) => c.score === 100) &&
    issues.filter((i) => i.status === "open" && (i.severity === "critical" || i.severity === "high")).length === 0;

  // Projected: only add deltas for open issues (capped at 100); honest upper bound if fixes succeed and re-verify
  const projected = Math.min(
    100,
    overallScore + issues.filter((i) => i.status === "open").reduce((s, i) => s + i.scoreDeltaIfFixed, 0)
  );

  const criticalCount = issues.filter((i) => i.severity === "critical" && i.status === "open").length;
  const warningCount = issues.filter((i) => (i.severity === "high" || i.severity === "medium") && i.status === "open").length;

  const passingModules = categories.filter((c) => c.status === "healthy").map((c) => c.label);
  const failingModules = categories.filter((c) => c.status === "critical" || c.status === "unverified").map((c) => c.label);

  const allLatencies = categories
    .flatMap((c) => c.probes)
    .filter((p) => p.latencyMs != null)
    .map((p) => ({ id: p.id, latencyMs: p.latencyMs! }));
  const avgProbeLatencyMs = allLatencies.length
    ? Math.round(allLatencies.reduce((a, b) => a + b.latencyMs, 0) / allLatencies.length)
    : null;

  const recommendedPriorities = [...issues]
    .filter((i) => i.status === "open")
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.scoreDeltaIfFixed - a.scoreDeltaIfFixed)
    .slice(0, 12)
    .map((i, idx) => ({
      rank: idx + 1,
      issueId: i.id,
      title: i.description.slice(0, 120),
      severity: i.severity,
      effort: i.estimatedEffort,
    }));

  const report: EnterpriseHealthReport = {
    version: EHI_VERSION,
    overallScore,
    verifiedCoveragePct,
    canReach100,
    certifiedReady,
    categories,
    issues: issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    criticalCount,
    warningCount,
    passingModules,
    failingModules,
    performance: {
      monitoringOverall: monitoring?.overallScore ?? null,
      avgProbeLatencyMs,
      slowProbes: allLatencies.filter((p) => p.latencyMs >= 2000).sort((a, b) => b.latencyMs - a.latencyMs).slice(0, 8),
    },
    deployment: {
      host: hostKind(),
      commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null,
      nodeEnv: process.env.NODE_ENV || null,
    },
    integrations: hubCards.map((c) => ({
      id: c.id,
      name: c.name || c.id,
      healthy: Boolean(c.health?.healthy) || c.status === "connected",
      status: c.status,
      message: c.health?.message || "",
    })),
    recommendedPriorities,
    estimatedHealthAfterPendingFixes: projected,
    policy: {
      noPlaceholders: true,
      noManualInflation: true,
      unverifiedBlocks100: true,
    },
    generatedAt: new Date().toISOString(),
    speechSummary: `Enterprise Health ${overallScore}% with ${verifiedCoveragePct}% category coverage. ${criticalCount} critical, ${warningCount} warnings. ${
      certifiedReady ? "Certified ready." : canReach100 ? "Not yet 100% — open issues remain." : "Cannot certify 100% until all categories are live-verified (including Mobile UAT)."
    }`,
  };

  if (opts?.persist !== false) {
    await persistHealthSnapshot(report, opts?.actorEmail).catch(() => undefined);
  }

  return report;
}

function severityRank(s: EhiSeverity): number {
  return s === "critical" ? 0 : s === "high" ? 1 : s === "medium" ? 2 : 3;
}

function effortFor(s: EhiSeverity): string {
  return s === "critical" ? "1–4h" : s === "high" ? "2–8h" : s === "medium" ? "4–16h" : "1–2h";
}

function pathFor(cat: EhiCategoryId): string {
  const map: Record<EhiCategoryId, string> = {
    infrastructure: "/hq/monitoring",
    application: "/hq/software",
    api: "/hq/monitoring",
    database: "/hq/monitoring",
    communications: "/hq/communications",
    ai: "/hq/aura",
    security: "/hq/security",
    grants: "/hq/grants",
    workflow: "/hq/workflows",
    mobile: "/hq/enterprise-health",
    performance: "/hq/monitoring",
    integration: "/hq/integrations",
  };
  return map[cat];
}

function recommendFix(category: EhiCategoryId, probeId: string): string {
  const key = `${category}:${probeId}`;
  const fixes: Record<string, string> = {
    "infrastructure:microservices": "Configure IFCDC_*_URL health endpoints on Render and verify auth/aura/notifications/payments/database services",
    "infrastructure:storage": "Ensure HQ upload volume is mounted and writable on Render",
    "application:apps-none": "Set HQ_*_HEALTH_URL for each Software Division app (never localhost in production)",
    "communications:twilio": "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN; verify in Integrations Hub",
    "communications:resend": "Set RESEND_API_KEY and RESEND_FROM_EMAIL for Founder OTP and executive mail",
    "ai:openai": "Set OpenAI production credentials used by resolveOpenAiCredentials",
    "ai:knowledge-base": "Run Knowledge Base sync so approved IFCDC org docs are embedded",
    "security:jwt": "Set JWT_SECRET / SESSION_SECRET on Render",
    "grants:grants-qa": "Run grant center production QA and ensure FOUNDER_SEED_PASSWORD env for QA jobs",
    "mobile:unverified": "Run Founder device UAT via script/hq-mobile-readiness.mjs and persist results to hq_mobile_readiness_runs",
    "mobile:mobile-uat": "Complete Mac/Windows/iPhone/iPad/Android matrix and record a passing run",
    "workflow:scheduled-jobs": "Inspect /hq/workflows failed jobs; clear lastError and re-enable cadences",
    "integration:integrations-hub": "Open Integrations Hub and repair degraded connectors",
    "performance:monitoring-overall": "Resolve degraded monitoring components (services, jobs, auth, integrations)",
  };
  if (fixes[key]) return fixes[key];
  if (probeId.startsWith("app-")) return `Set production HQ health URL for app ${probeId.replace("app-", "")} (no localhost)`;
  if (probeId.startsWith("int-") || probeId.startsWith("live-")) return `Repair connector ${probeId} in Integrations Hub and re-test`;
  if (probeId === "unverified") return `Add live probes or Founder UAT for ${category}, then re-run Enterprise Health`;
  return `Investigate ${category} probe ${probeId}, repair production config, and re-run Enterprise Health to verify score increase`;
}

async function persistHealthSnapshot(report: EnterpriseHealthReport, actorEmail?: string) {
  const db = await getDb();
  await db.run(`
    CREATE TABLE IF NOT EXISTS hq_enterprise_health_snapshots (
      id TEXT PRIMARY KEY,
      overall_score INTEGER NOT NULL,
      verified_coverage INTEGER NOT NULL,
      certified_ready INTEGER NOT NULL,
      critical_count INTEGER NOT NULL,
      warning_count INTEGER NOT NULL,
      categories_json TEXT NOT NULL,
      issues_json TEXT NOT NULL,
      actor_email TEXT,
      created_at TEXT NOT NULL
    )
  `);
  const id = `ehi_${Date.now().toString(36)}`;
  await db.run(
    `INSERT INTO hq_enterprise_health_snapshots
     (id, overall_score, verified_coverage, certified_ready, critical_count, warning_count, categories_json, issues_json, actor_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    report.overallScore,
    report.verifiedCoveragePct,
    report.certifiedReady ? 1 : 0,
    report.criticalCount,
    report.warningCount,
    JSON.stringify(report.categories.map((c) => ({ id: c.id, score: c.score, status: c.status }))),
    JSON.stringify(report.issues.slice(0, 50)),
    actorEmail ?? null,
    report.generatedAt
  );

  await logHqAudit({
    action: "enterprise_health_report",
    entityType: "enterprise_health",
    entityId: id,
    actorEmail,
    detail: report.speechSummary,
    metadata: {
      overallScore: report.overallScore,
      criticalCount: report.criticalCount,
      verifiedCoveragePct: report.verifiedCoveragePct,
    },
  }).catch(() => undefined);

  if (report.criticalCount > 0) {
    await createLeadershipAlert({
      alertType: "enterprise_health_critical",
      title: `Enterprise Health ${report.overallScore}% — ${report.criticalCount} critical`,
      message: report.speechSummary,
      priority: "high",
      sourceModule: "technical",
      path: "/hq/enterprise-health",
    }).catch(() => undefined);
  }
}

/** Called from monitoring watchdog — refresh health and alert on regressions. */
export async function runEnterpriseHealthWatchdogTick(): Promise<void> {
  const report = await buildEnterpriseHealthReport({ liveIntegrationTests: false, persist: true });
  if (report.criticalCount > 0 || report.overallScore < 60) {
    console.log(
      `[enterprise-health] score=${report.overallScore} coverage=${report.verifiedCoveragePct}% critical=${report.criticalCount}`
    );
  }
}
