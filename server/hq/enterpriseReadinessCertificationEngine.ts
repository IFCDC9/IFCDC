/**
 * Enterprise Readiness Certification — Phase 1
 *
 * Live aggregation of modules, integrations, security, quality, and ops signals.
 * No demo data / simulated success: checks call production engines and live probes.
 * Certification requires 100% readiness with zero open critical/high issues.
 */
import crypto from "crypto";
import { existsSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import {
  buildEnterpriseMonitoringOverview,
  type EnterpriseMonitoringOverview,
} from "./enterpriseMonitoringEngine";
import { testIntegrationHubProvider } from "./integrationsHubEngine";

export const ERC_VERSION = "1.0" as const;
export const ERC_CERTIFICATION_TARGET = 100;

export type ErcSeverity = "critical" | "high" | "medium" | "low";
export type ErcCheckStatus = "pass" | "fail" | "warn" | "blocked" | "pending_manual";
export type ErcIssueStatus = "open" | "in_progress" | "resolved" | "accepted_risk";
export type ErcCategory =
  | "module"
  | "integration"
  | "security"
  | "communications"
  | "ai"
  | "deployment"
  | "database"
  | "mobile"
  | "performance"
  | "quality"
  | "ui";

export type ErcIssue = {
  id: string;
  module: string;
  category: ErcCategory;
  description: string;
  rootCause: string;
  severity: ErcSeverity;
  filesAffected: string[];
  recommendedFix: string;
  estimatedEffort: string;
  status: ErcIssueStatus;
  checkId: string;
  path?: string;
};

export type ErcCheck = {
  id: string;
  category: ErcCategory;
  label: string;
  module: string;
  path?: string;
  status: ErcCheckStatus;
  score: number;
  detail: string;
  latencyMs: number;
  live: boolean;
  filesAffected?: string[];
};

export type ErcPillarScores = {
  overall: number;
  moduleHealth: number;
  integrationHealth: number;
  securityHealth: number;
  communicationsHealth: number;
  aiHealth: number;
  deploymentHealth: number;
  databaseHealth: number;
  mobileReadiness: number;
  performance: number;
};

export type ErcCertificationRun = {
  id: string;
  version: typeof ERC_VERSION;
  startedAt: string;
  completedAt: string;
  overallReadiness: number;
  certified: boolean;
  certificationStatus: "certified" | "not_certified" | "in_progress";
  pillars: ErcPillarScores;
  checks: ErcCheck[];
  issues: ErcIssue[];
  outstandingIssueCount: number;
  deepQualityRan: boolean;
  host: "render" | "local" | "unknown";
  actorEmail: string | null;
  speechSummary: string;
};

let tablesReady = false;

export async function ensureEnterpriseReadinessCertificationTables(): Promise<void> {
  if (tablesReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_erc_runs (
      id TEXT PRIMARY KEY,
      overall_readiness INTEGER NOT NULL,
      certified INTEGER NOT NULL DEFAULT 0,
      pillars_json TEXT NOT NULL,
      checks_json TEXT NOT NULL,
      issues_json TEXT NOT NULL,
      deep_quality INTEGER NOT NULL DEFAULT 0,
      host TEXT,
      actor_email TEXT,
      speech_summary TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_erc_runs_completed ON aura_erc_runs(completed_at DESC);

    CREATE TABLE IF NOT EXISTS aura_erc_issues (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      module TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      root_cause TEXT,
      severity TEXT NOT NULL,
      files_affected_json TEXT,
      recommended_fix TEXT,
      estimated_effort TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      check_id TEXT,
      path TEXT,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_erc_issues_status ON aura_erc_issues(status);
    CREATE INDEX IF NOT EXISTS idx_erc_issues_severity ON aura_erc_issues(severity);
  `);
  tablesReady = true;
}

function isRenderHost(): boolean {
  return process.env.RENDER === "true" || Boolean(process.env.RENDER_SERVICE_ID);
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function scoreFromStatus(status: ErcCheckStatus): number {
  if (status === "pass") return 100;
  if (status === "warn") return 70;
  if (status === "pending_manual") return 50;
  if (status === "blocked") return 20;
  return 0;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { value, latencyMs: Date.now() - t0 };
  } catch (err) {
    return {
      value: undefined as T,
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function issueFromCheck(
  check: ErcCheck,
  opts: { rootCause: string; recommendedFix: string; severity: ErcSeverity; effort: string; files?: string[] }
): ErcIssue {
  return {
    id: crypto.randomUUID(),
    module: check.module,
    category: check.category,
    description: `${check.label}: ${check.detail}`,
    rootCause: opts.rootCause,
    severity: opts.severity,
    filesAffected: opts.files || check.filesAffected || [],
    recommendedFix: opts.recommendedFix,
    estimatedEffort: opts.effort,
    status: "open",
    checkId: check.id,
    path: check.path,
  };
}

type ModuleProbe = {
  id: string;
  label: string;
  module: string;
  path: string;
  category: ErcCategory;
  probe: () => Promise<{ ok: boolean; detail: string; warn?: boolean }>;
};

async function moduleProbes(): Promise<ModuleProbe[]> {
  return [
    {
      id: "mod-executive-dashboard",
      label: "Executive Dashboard",
      module: "Executive Dashboard",
      path: "/hq",
      category: "module",
      probe: async () => {
        const { buildExecutiveCommandHealth } = await import("./executiveCommandHealth");
        const h = await buildExecutiveCommandHealth();
        return { ok: Number.isFinite(h.overall), detail: `Command health ${h.overall} (${h.grade})` };
      },
    },
    {
      id: "mod-aura-chat",
      label: "AURA Executive Chat",
      module: "AURA",
      path: "/hq/aura",
      category: "ai",
      probe: async () => {
        const { openAiConfigStatus } = await import("../lib/openaiConfig");
        const s = openAiConfigStatus();
        return {
          ok: Boolean(s.configured),
          detail: s.configured ? `OpenAI configured (${s.source || "key"})` : "OpenAI API key not configured",
          warn: !s.configured,
        };
      },
    },
    {
      id: "mod-aura-voice",
      label: "AURA Voice",
      module: "AURA Voice",
      path: "/hq/aura",
      category: "communications",
      probe: async () => {
        const sid = Boolean((process.env.TWILIO_ACCOUNT_SID || "").trim());
        const token = Boolean((process.env.TWILIO_AUTH_TOKEN || "").trim());
        return {
          ok: sid && token,
          detail: sid && token ? "Twilio credentials present for voice" : "Twilio voice credentials missing",
        };
      },
    },
    {
      id: "mod-founder-mode",
      label: "Founder Mode",
      module: "Founder Mode",
      path: "/hq/founder",
      category: "security",
      probe: async () => {
        const email = (process.env.MASTER_OWNER_EMAIL || process.env.FOUNDER_EMAIL || "").trim();
        return {
          ok: Boolean(email),
          detail: email ? `Founder identity seeded (${email})` : "MASTER_OWNER_EMAIL / FOUNDER_EMAIL missing",
        };
      },
    },
    {
      id: "mod-identity",
      label: "Identity Verification",
      module: "Identity / MFA",
      path: "/hq/security",
      category: "security",
      probe: async () => {
        const { getEmailDeliveryStatus } = await import("../lib/notifications");
        const email = getEmailDeliveryStatus();
        return {
          ok: Boolean(email.apiKeySet),
          detail: email.apiKeySet
            ? "Founder OTP email delivery configured"
            : "Email API key missing — Founder OTP blocked",
        };
      },
    },
    {
      id: "mod-communications",
      label: "Communications Center",
      module: "Communications",
      path: "/hq/communications",
      category: "communications",
      probe: async () => {
        const db = await getDb();
        const row = await db.get<{ c: number }>(
          `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name LIKE 'comm%'`
        ).catch(() => ({ c: 0 }));
        return {
          ok: (row?.c || 0) > 0,
          detail: (row?.c || 0) > 0 ? "Communications schema present" : "Communications tables missing",
        };
      },
    },
    {
      id: "mod-grants",
      label: "Grant Center",
      module: "Grants",
      path: "/hq/grants",
      category: "module",
      probe: async () => {
        const { getGrantCenterQaReport } = await import("./grantCenterQaCache");
        const snap = getGrantCenterQaReport();
        if (snap.status === "pass" || snap.status === "fail") {
          const total = snap.pass + snap.fail;
          const score = total ? Math.round((snap.pass / total) * 100) : 0;
          return {
            ok: snap.status === "pass" || score >= 70,
            detail: `Grant Center QA ${snap.status}: ${snap.pass} pass / ${snap.fail} fail`,
            warn: snap.status !== "pass",
          };
        }
        const db = await getDb();
        const row = await db.get<{ c: number }>(
          `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name LIKE '%grant%'`
        ).catch(() => ({ c: 0 }));
        return {
          ok: (row?.c || 0) > 0,
          detail: (row?.c || 0) > 0
            ? `Grant tables present (QA status: ${snap.status})`
            : "Grant schema missing",
          warn: true,
        };
      },
    },
    {
      id: "mod-grant-writer",
      label: "Grant Writer Studio",
      module: "Grant Writer",
      path: "/hq/grants",
      category: "module",
      probe: async () => {
        const db = await getDb();
        const row = await db.get<{ c: number }>(
          `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name LIKE '%grant_writer%'`
        ).catch(() => ({ c: 0 }));
        return {
          ok: (row?.c || 0) > 0,
          detail: (row?.c || 0) > 0 ? "Grant Writer tables present" : "Grant Writer tables missing",
        };
      },
    },
    {
      id: "mod-funding-pipeline",
      label: "Enterprise Funding Pipeline",
      module: "Funding Pipeline",
      path: "/hq/grants",
      category: "module",
      probe: async () => {
        const { buildEnterpriseOsMissionControl } = await import("./auraEnterpriseOs4");
        const mc = await buildEnterpriseOsMissionControl();
        const pv = mc.fundingPipeline?.pipelineValue;
        return {
          ok: true,
          detail: pv != null ? `Pipeline value live: ${pv}` : "Pipeline endpoint live (value null/empty)",
          warn: pv == null,
        };
      },
    },
    {
      id: "mod-knowledge",
      label: "Knowledge Base",
      module: "Knowledge Base",
      path: "/hq/knowledge",
      category: "module",
      probe: async () => {
        const { getKnowledgeBaseStatus } = await import("./knowledgeBaseEngine");
        const o = await getKnowledgeBaseStatus();
        const n = Number(o.total ?? 0);
        return { ok: true, detail: `Knowledge Base live (${n} approved documents)`, warn: n === 0 };
      },
    },
    {
      id: "mod-workflows",
      label: "Workflow Automation",
      module: "Workflows",
      path: "/hq/workflows",
      category: "module",
      probe: async () => {
        const { listScheduledJobs } = await import("./workflowEngine");
        const jobs = await listScheduledJobs();
        return { ok: true, detail: `${jobs.length} scheduled workflow job(s)`, warn: jobs.length === 0 };
      },
    },
    {
      id: "mod-documents",
      label: "Document Management",
      module: "Documents",
      path: "/hq/documents",
      category: "module",
      probe: async () => {
        const db = await getDb();
        const row = await db.get<{ c: number }>(
          `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name LIKE '%document%'`
        ).catch(() => ({ c: 0 }));
        return {
          ok: (row?.c || 0) > 0,
          detail: (row?.c || 0) > 0 ? "Document schema present" : "Document tables missing",
        };
      },
    },
    {
      id: "mod-intelligence",
      label: "Executive Intelligence",
      module: "Executive Intelligence",
      path: "/hq/intelligence",
      category: "ai",
      probe: async () => {
        const { buildExecutiveCommandHealth } = await import("./executiveCommandHealth");
        const h = await buildExecutiveCommandHealth();
        return { ok: h.overall >= 50, detail: `Intelligence pillars overall ${h.overall}` };
      },
    },
    {
      id: "mod-finance",
      label: "Financial Center",
      module: "Finance",
      path: "/hq/finance",
      category: "module",
      probe: async () => {
        const db = await getDb();
        const row = await db.get<{ c: number }>(
          `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND (name LIKE '%finance%' OR name LIKE '%ledger%' OR name LIKE '%budget%')`
        ).catch(() => ({ c: 0 }));
        return {
          ok: (row?.c || 0) > 0,
          detail: (row?.c || 0) > 0 ? "Finance schema present" : "Finance tables missing",
        };
      },
    },
    {
      id: "mod-hr",
      label: "HR Center",
      module: "HR / People",
      path: "/hq/people",
      category: "module",
      probe: async () => {
        const { buildWorkforceDashboard } = await import("./workforceFoundation");
        const d = await buildWorkforceDashboard();
        const n = d.kpis?.totalWorkforce ?? d.kpis?.totalEmployees ?? 0;
        return { ok: true, detail: `Workforce live (${n} people)`, warn: n === 0 };
      },
    },
    {
      id: "mod-operations",
      label: "Operations Center",
      module: "Operations",
      path: "/hq/operations",
      category: "module",
      probe: async () => {
        const { buildExecutiveOperationsDashboard } = await import("./executiveOperationsFoundation");
        const d = await buildExecutiveOperationsDashboard();
        return {
          ok: Number.isFinite(d.organizationHealth),
          detail: `Ops org health ${d.organizationHealth}; projects ${d.activeProjects}`,
        };
      },
    },
    {
      id: "mod-software",
      label: "Software Division",
      module: "Software Division",
      path: "/hq/software",
      category: "deployment",
      probe: async () => {
        const { pollAllApps } = await import("./appRegistry");
        const apps = await pollAllApps();
        const unhealthy = apps.filter((a) => a.healthy === false).length;
        return {
          ok: unhealthy === 0,
          detail: `${apps.length} apps polled; ${unhealthy} unhealthy`,
          warn: unhealthy > 0,
        };
      },
    },
    {
      id: "mod-integrations",
      label: "Integrations Hub",
      module: "Integrations",
      path: "/hq/integrations",
      category: "integration",
      probe: async () => {
        const { buildIntegrationsHubSafe } = await import("./integrationsHubEngine");
        const hub = await buildIntegrationsHubSafe();
        const n = hub.integrations?.length || 0;
        return { ok: n > 0, detail: `${n} integration card(s) loaded` };
      },
    },
    {
      id: "mod-mission-control",
      label: "Mission Control",
      module: "Mission Control",
      path: "/hq/phase10",
      category: "module",
      probe: async () => {
        const db = await getDb();
        const row = await db.get<{ c: number }>(
          `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name LIKE '%mission%'`
        ).catch(() => ({ c: 0 }));
        return {
          ok: (row?.c || 0) > 0,
          detail: (row?.c || 0) > 0 ? "Mission Control schema present" : "Mission Control tables missing",
          warn: (row?.c || 0) === 0,
        };
      },
    },
    {
      id: "mod-enterprise-brain",
      label: "Enterprise Brain",
      module: "Enterprise Brain",
      path: "/hq/executive-brain",
      category: "ai",
      probe: async () => {
        const { BRAIN_VERSION } = await import("./auraExecutiveDecisionIntelligence");
        return { ok: Boolean(BRAIN_VERSION), detail: `Brain version ${BRAIN_VERSION}` };
      },
    },
    {
      id: "mod-enterprise-ops5",
      label: "Enterprise Operations 5.0",
      module: "Enterprise Operations",
      path: "/hq/enterprise-ops",
      category: "module",
      probe: async () => {
        const { buildEnterpriseOperationsCommandCenter } = await import("./auraEnterpriseOs5");
        const cc = await buildEnterpriseOperationsCommandCenter();
        return {
          ok: cc.eoVersion === "5.0",
          detail: `EO ${cc.eoVersion}; ${cc.opsRuns?.length || 0} recent ops runs`,
        };
      },
    },
    {
      id: "mod-reporting",
      label: "Reporting",
      module: "Reporting",
      path: "/hq/reports",
      category: "module",
      probe: async () => {
        const db = await getDb();
        const row = await db.get<{ c: number }>(
          `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND (name LIKE '%report%' OR name LIKE '%warehouse%')`
        ).catch(() => ({ c: 0 }));
        return {
          ok: (row?.c || 0) > 0,
          detail: (row?.c || 0) > 0 ? "Reporting/warehouse schema present" : "Reporting tables missing",
          warn: (row?.c || 0) === 0,
        };
      },
    },
    {
      id: "mod-notifications",
      label: "Notifications",
      module: "Notifications",
      path: "/hq/notifications",
      category: "communications",
      probe: async () => {
        const db = await getDb();
        const row = await db.get<{ c: number }>(
          `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name LIKE '%notification%'`
        ).catch(() => ({ c: 0 }));
        return {
          ok: (row?.c || 0) > 0,
          detail: (row?.c || 0) > 0 ? "Notification queue schema present" : "Notification tables missing",
        };
      },
    },
    {
      id: "mod-monitoring",
      label: "Enterprise Monitoring",
      module: "Monitoring",
      path: "/hq/monitoring",
      category: "performance",
      probe: async () => {
        const mon = await buildEnterpriseMonitoringOverview({ bypassCache: true });
        return {
          ok: mon.overallScore >= 60,
          detail: `Monitoring score ${mon.overallScore} (${mon.overallStatus})`,
          warn: mon.overallScore < 80,
        };
      },
    },
  ];
}

const INTEGRATION_PROVIDERS: Array<{ id: string; label: string; category: ErcCategory }> = [
  { id: "openai_aura", label: "OpenAI / AURA", category: "ai" },
  { id: "render", label: "Render", category: "deployment" },
  { id: "github", label: "GitHub", category: "deployment" },
  { id: "twilio", label: "Twilio Voice/SMS", category: "communications" },
  { id: "resend", label: "Resend Email", category: "communications" },
  { id: "grants_gov", label: "Grants.gov", category: "integration" },
  { id: "sam_gov", label: "SAM.gov", category: "integration" },
  { id: "paypal", label: "PayPal", category: "integration" },
  { id: "postgres", label: "Database", category: "database" },
];

async function runQualityChecks(deep: boolean): Promise<ErcCheck[]> {
  const checks: ErcCheck[] = [];
  const root = path.resolve(process.cwd());

  const dbTimed = await timed(async () => {
    const db = await getDb();
    await db.get("SELECT 1 as ok");
    return true;
  });
  checks.push({
    id: "quality-db-ping",
    category: "database",
    label: "Database ping",
    module: "Database",
    status: dbTimed.error ? "fail" : "pass",
    score: dbTimed.error ? 0 : 100,
    detail: dbTimed.error || "SELECT 1 succeeded",
    latencyMs: dbTimed.latencyMs,
    live: true,
    filesAffected: ["server/db.ts"],
  });

  const distOk = existsSync(path.join(root, "dist")) || existsSync(path.join(root, "client", "dist"));
  checks.push({
    id: "quality-build-artifact",
    category: "quality",
    label: "Build artifact presence",
    module: "Software Quality",
    status: distOk ? "pass" : "warn",
    score: distOk ? 100 : 60,
    detail: distOk ? "Client/server dist present" : "No dist/ found — run production build before certify",
    latencyMs: 0,
    live: true,
    filesAffected: ["dist/", "client/dist/"],
  });

  const pkg = existsSync(path.join(root, "package.json"));
  checks.push({
    id: "quality-scripts",
    category: "quality",
    label: "Verification scripts present",
    module: "Software Quality",
    status: pkg && existsSync(path.join(root, "script", "enterprise-production-verify.mjs")) ? "pass" : "fail",
    score: pkg ? 100 : 0,
    detail: "enterprise:verify orchestration script",
    latencyMs: 0,
    live: true,
    filesAffected: ["script/enterprise-production-verify.mjs", "package.json"],
  });

  if (deep && !isRenderHost()) {
    const t0 = Date.now();
    const result = spawnSync("npx", ["tsc", "--noEmit"], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      env: process.env,
    });
    const ok = result.status === 0;
    checks.push({
      id: "quality-tsc",
      category: "quality",
      label: "TypeScript check",
      module: "Software Quality",
      status: ok ? "pass" : "fail",
      score: ok ? 100 : 0,
      detail: ok
        ? "tsc --noEmit passed"
        : (result.stderr || result.stdout || "tsc failed").slice(0, 400),
      latencyMs: Date.now() - t0,
      live: true,
      filesAffected: ["tsconfig.json"],
    });
  } else {
    checks.push({
      id: "quality-tsc",
      category: "quality",
      label: "TypeScript check",
      module: "Software Quality",
      status: "pending_manual",
      score: 50,
      detail: isRenderHost()
        ? "Deep tsc skipped on Render — run npm run check / enterprise:verify on Founder Mac or CI"
        : "Enable deepQuality to run tsc in this certification pass",
      latencyMs: 0,
      live: false,
      filesAffected: ["tsconfig.json"],
    });
  }

  checks.push({
    id: "quality-mobile",
    category: "mobile",
    label: "Mobile readiness script",
    module: "Mobile UX",
    path: "/hq",
    status: existsSync(path.join(root, "script", "hq-mobile-readiness.mjs")) ? "pending_manual" : "fail",
    score: existsSync(path.join(root, "script", "hq-mobile-readiness.mjs")) ? 50 : 0,
    detail: "Device matrix (Mac/Windows/iPhone/iPad/Android) requires Founder browser UAT + hq-mobile-readiness.mjs",
    latencyMs: 0,
    live: false,
    filesAffected: ["script/hq-mobile-readiness.mjs"],
  });

  checks.push({
    id: "quality-ui-matrix",
    category: "ui",
    label: "Full UI control matrix",
    module: "UI / UX",
    path: "/hq",
    status: "pending_manual",
    score: 50,
    detail: "Every button/form/modal requires Founder browser UAT; server certifies API/module/integration layers",
    latencyMs: 0,
    live: false,
    filesAffected: ["client/src/App.tsx", "client/src/config/hqNavigation.ts"],
  });

  return checks;
}

function pillarScores(checks: ErcCheck[]): ErcPillarScores {
  const by = (cats: ErcCategory[]) => avg(checks.filter((c) => cats.includes(c.category)).map((c) => c.score));
  const moduleHealth = by(["module"]);
  const integrationHealth = by(["integration"]);
  const securityHealth = by(["security"]);
  const communicationsHealth = by(["communications"]);
  const aiHealth = by(["ai"]);
  const deploymentHealth = by(["deployment"]);
  const databaseHealth = by(["database"]);
  const mobileReadiness = by(["mobile"]);
  const performance = by(["performance", "quality"]);
  const overall = avg([
    moduleHealth,
    integrationHealth,
    securityHealth,
    communicationsHealth,
    aiHealth,
    deploymentHealth,
    databaseHealth,
    mobileReadiness,
    performance,
  ]);
  return {
    overall,
    moduleHealth,
    integrationHealth,
    securityHealth,
    communicationsHealth,
    aiHealth,
    deploymentHealth,
    databaseHealth,
    mobileReadiness,
    performance,
  };
}

export async function runEnterpriseReadinessCertification(opts?: {
  actorEmail?: string;
  deepQuality?: boolean;
  liveIntegrations?: boolean;
}): Promise<ErcCertificationRun> {
  await ensureEnterpriseReadinessCertificationTables();
  const startedAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const deepQuality = Boolean(opts?.deepQuality);
  const liveIntegrations = opts?.liveIntegrations !== false;
  const checks: ErcCheck[] = [];
  const issues: ErcIssue[] = [];

  // Modules
  const probes = await moduleProbes();
  for (const p of probes) {
    const r = await timed(() => p.probe());
    if (r.error) {
      const check: ErcCheck = {
        id: p.id,
        category: p.category,
        label: p.label,
        module: p.module,
        path: p.path,
        status: "fail",
        score: 0,
        detail: r.error,
        latencyMs: r.latencyMs,
        live: true,
      };
      checks.push(check);
      issues.push(
        issueFromCheck(check, {
          rootCause: "Live module probe threw an exception",
          recommendedFix: `Inspect ${p.path} backend builders and repair the failure path`,
          severity: "high",
          effort: "2–8h",
        })
      );
      continue;
    }
    const result = r.value!;
    const status: ErcCheckStatus = !result.ok ? "fail" : result.warn ? "warn" : "pass";
    const check: ErcCheck = {
      id: p.id,
      category: p.category,
      label: p.label,
      module: p.module,
      path: p.path,
      status,
      score: scoreFromStatus(status),
      detail: result.detail,
      latencyMs: r.latencyMs,
      live: true,
    };
    checks.push(check);
    if (status === "fail") {
      issues.push(
        issueFromCheck(check, {
          rootCause: "Module live probe returned failure",
          recommendedFix: `Restore ${p.label} production path and re-run certification`,
          severity: "high",
          effort: "2–8h",
        })
      );
    } else if (status === "warn") {
      issues.push(
        issueFromCheck(check, {
          rootCause: "Module live but incomplete or below target threshold",
          recommendedFix: `Harden ${p.label} until probe returns clean pass`,
          severity: "medium",
          effort: "1–4h",
        })
      );
    }
  }

  // Integrations — real hub live tests
  if (liveIntegrations) {
    for (const provider of INTEGRATION_PROVIDERS) {
      const r = await timed(() => testIntegrationHubProvider(provider.id));
      if (r.error) {
        const check: ErcCheck = {
          id: `int-${provider.id}`,
          category: provider.category,
          label: provider.label,
          module: provider.label,
          path: "/hq/integrations",
          status: "fail",
          score: 0,
          detail: r.error,
          latencyMs: r.latencyMs,
          live: true,
          filesAffected: ["server/hq/integrationsHubEngine.ts"],
        };
        checks.push(check);
        issues.push(
          issueFromCheck(check, {
            rootCause: "Live integration test threw",
            recommendedFix: `Fix ${provider.label} credentials/connectivity on Render and re-test from Integrations Hub`,
            severity: provider.id === "openai_aura" || provider.id === "postgres" ? "critical" : "high",
            effort: "1–4h",
            files: ["server/hq/integrationsHubEngine.ts"],
          })
        );
        continue;
      }
      const result = r.value as { success?: boolean; message?: string };
      const ok = Boolean(result?.success);
      const check: ErcCheck = {
        id: `int-${provider.id}`,
        category: provider.category,
        label: provider.label,
        module: provider.label,
        path: "/hq/integrations",
        status: ok ? "pass" : "fail",
        score: ok ? 100 : 0,
        detail: result?.message || (ok ? "Live test passed" : "Live test failed"),
        latencyMs: r.latencyMs,
        live: true,
        filesAffected: ["server/hq/integrationsHubEngine.ts"],
      };
      checks.push(check);
      if (!ok) {
        issues.push(
          issueFromCheck(check, {
            rootCause: "Production integration live test failed",
            recommendedFix: `Open Integrations Hub → Test ${provider.label}; repair secrets/config; confirm real API response`,
            severity: provider.id === "openai_aura" || provider.id === "postgres" ? "critical" : "high",
            effort: "1–4h",
            files: ["server/hq/integrationsHubEngine.ts", "Render env"],
          })
        );
      }
    }
  }

  // Auth / security env
  {
    const jwt = Boolean((process.env.JWT_SECRET || process.env.SESSION_SECRET || "").trim());
    const check: ErcCheck = {
      id: "sec-auth-secrets",
      category: "security",
      label: "Authentication secrets",
      module: "Authentication",
      path: "/hq/security",
      status: jwt ? "pass" : "fail",
      score: jwt ? 100 : 0,
      detail: jwt ? "JWT/SESSION secret configured" : "JWT_SECRET / SESSION_SECRET missing",
      latencyMs: 0,
      live: true,
      filesAffected: ["server/middleware/hqAuth.ts"],
    };
    checks.push(check);
    if (!jwt) {
      issues.push(
        issueFromCheck(check, {
          rootCause: "Auth secret env missing",
          recommendedFix: "Set JWT_SECRET (and SESSION_SECRET if used) on Render",
          severity: "critical",
          effort: "30m",
        })
      );
    }
  }

  // Monitoring aggregate for performance/deploy
  {
    const monTimed = await timed(() => buildEnterpriseMonitoringOverview({ bypassCache: true }));
    const mon = monTimed.value as EnterpriseMonitoringOverview | undefined;
    if (mon && !monTimed.error) {
      checks.push({
        id: "perf-monitoring-overall",
        category: "performance",
        label: "Enterprise Monitoring overall",
        module: "Monitoring",
        path: "/hq/monitoring",
        status: mon.overallScore >= 80 ? "pass" : mon.overallScore >= 60 ? "warn" : "fail",
        score: mon.overallScore,
        detail: `${mon.overallStatus} · ${mon.uptimeLabel} uptime · ${mon.alerts?.length || 0} alerts`,
        latencyMs: monTimed.latencyMs,
        live: true,
      });
      const deployAligned = mon.components?.find((c) => c.id.includes("deploy") || c.label.toLowerCase().includes("deploy"));
      if (deployAligned) {
        checks.push({
          id: "deploy-monitoring-component",
          category: "deployment",
          label: deployAligned.label,
          module: "Deployment",
          path: "/hq/monitoring",
          status: deployAligned.status === "healthy" ? "pass" : deployAligned.status === "degraded" ? "warn" : "fail",
          score: deployAligned.score,
          detail: deployAligned.detail,
          latencyMs: 0,
          live: true,
        });
      }
    } else {
      const check: ErcCheck = {
        id: "perf-monitoring-overall",
        category: "performance",
        label: "Enterprise Monitoring overall",
        module: "Monitoring",
        path: "/hq/monitoring",
        status: "fail",
        score: 0,
        detail: monTimed.error || "Monitoring overview failed",
        latencyMs: monTimed.latencyMs,
        live: true,
      };
      checks.push(check);
      issues.push(
        issueFromCheck(check, {
          rootCause: "Monitoring aggregator failed",
          recommendedFix: "Investigate enterpriseMonitoringEngine and dependent services",
          severity: "high",
          effort: "2–6h",
          files: ["server/hq/enterpriseMonitoringEngine.ts"],
        })
      );
    }
  }

  checks.push(...(await runQualityChecks(deepQuality)));
  for (const c of checks.filter((x) => x.id.startsWith("quality-") && (x.status === "fail" || x.status === "pending_manual" || x.status === "warn"))) {
    if (issues.some((i) => i.checkId === c.id)) continue;
    if (c.status === "pass") continue;
    issues.push(
      issueFromCheck(c, {
        rootCause:
          c.status === "pending_manual"
            ? "Requires Founder/CI verification outside automated server probe"
            : c.detail,
        recommendedFix:
          c.status === "pending_manual"
            ? "Complete Founder UAT / npm run enterprise:verify, then re-run certification"
            : "Repair quality gate failure and re-run",
        severity: c.status === "fail" ? "high" : "medium",
        effort: c.status === "pending_manual" ? "2–8h UAT" : "1–4h",
      })
    );
  }

  const pillars = pillarScores(checks);
  // Overall readiness: mean of check scores (strict) — certification needs 100
  const overallReadiness = avg(checks.map((c) => c.score));
  const openBlocking = issues.filter((i) => i.status === "open" && (i.severity === "critical" || i.severity === "high"));
  const certified =
    overallReadiness >= ERC_CERTIFICATION_TARGET
    && checks.every((c) => c.status === "pass")
    && openBlocking.length === 0;

  const completedAt = new Date().toISOString();
  const speechSummary = certified
    ? `Enterprise Readiness Certification ${ERC_VERSION}: CERTIFIED at ${overallReadiness}%. All live checks passed.`
    : `Enterprise Readiness Certification ${ERC_VERSION}: NOT CERTIFIED — ${overallReadiness}% ready, ${issues.filter((i) => i.status === "open").length} open issues (${openBlocking.length} critical/high). Target is ${ERC_CERTIFICATION_TARGET}%.`;

  const run: ErcCertificationRun = {
    id,
    version: ERC_VERSION,
    startedAt,
    completedAt,
    overallReadiness,
    certified,
    certificationStatus: certified ? "certified" : "not_certified",
    pillars: { ...pillars, overall: overallReadiness },
    checks,
    issues,
    outstandingIssueCount: issues.filter((i) => i.status === "open").length,
    deepQualityRan: deepQuality && !isRenderHost(),
    host: isRenderHost() ? "render" : "local",
    actorEmail: opts?.actorEmail ?? null,
    speechSummary,
  };

  const db = await getDb();
  await db.run(
    `INSERT INTO aura_erc_runs (
      id, overall_readiness, certified, pillars_json, checks_json, issues_json,
      deep_quality, host, actor_email, speech_summary, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    run.id,
    run.overallReadiness,
    run.certified ? 1 : 0,
    JSON.stringify(run.pillars),
    JSON.stringify(run.checks),
    JSON.stringify(run.issues),
    run.deepQualityRan ? 1 : 0,
    run.host,
    run.actorEmail,
    run.speechSummary,
    run.startedAt,
    run.completedAt
  );
  for (const issue of issues) {
    await db.run(
      `INSERT INTO aura_erc_issues (
        id, run_id, module, category, description, root_cause, severity,
        files_affected_json, recommended_fix, estimated_effort, status, check_id, path, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      issue.id,
      run.id,
      issue.module,
      issue.category,
      issue.description,
      issue.rootCause,
      issue.severity,
      JSON.stringify(issue.filesAffected),
      issue.recommendedFix,
      issue.estimatedEffort,
      issue.status,
      issue.checkId,
      issue.path ?? null,
      completedAt,
      completedAt
    );
  }

  await logHqAudit({
    action: "erc_certification_run",
    entityType: "erc_run",
    entityId: run.id,
    actorEmail: opts?.actorEmail,
    detail: run.speechSummary.slice(0, 400),
    metadata: {
      overallReadiness: run.overallReadiness,
      certified: run.certified,
      outstandingIssueCount: run.outstandingIssueCount,
    },
  }).catch(() => undefined);

  return run;
}

export async function getLatestCertificationRun(): Promise<ErcCertificationRun | null> {
  await ensureEnterpriseReadinessCertificationTables();
  const db = await getDb();
  const row = await db.get<{
    id: string;
    overall_readiness: number;
    certified: number;
    pillars_json: string;
    checks_json: string;
    issues_json: string;
    deep_quality: number;
    host: string;
    actor_email: string | null;
    speech_summary: string;
    started_at: string;
    completed_at: string;
  }>(`SELECT * FROM aura_erc_runs ORDER BY completed_at DESC LIMIT 1`);
  if (!row) return null;
  return {
    id: row.id,
    version: ERC_VERSION,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    overallReadiness: row.overall_readiness,
    certified: Boolean(row.certified),
    certificationStatus: row.certified ? "certified" : "not_certified",
    pillars: JSON.parse(row.pillars_json) as ErcPillarScores,
    checks: JSON.parse(row.checks_json) as ErcCheck[],
    issues: JSON.parse(row.issues_json) as ErcIssue[],
    outstandingIssueCount: (JSON.parse(row.issues_json) as ErcIssue[]).filter((i) => i.status === "open").length,
    deepQualityRan: Boolean(row.deep_quality),
    host: (row.host as ErcCertificationRun["host"]) || "unknown",
    actorEmail: row.actor_email,
    speechSummary: row.speech_summary,
  };
}

export async function listCertificationIssues(opts?: { status?: ErcIssueStatus; limit?: number }): Promise<ErcIssue[]> {
  await ensureEnterpriseReadinessCertificationTables();
  const db = await getDb();
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 300);
  const rows = (opts?.status
    ? await db.all(
      `SELECT * FROM aura_erc_issues WHERE status = ? ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC LIMIT ?`,
      opts.status,
      limit
    )
    : await db.all(
      `SELECT * FROM aura_erc_issues ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC LIMIT ?`,
      limit
    )) as Array<Record<string, unknown>> | null;
  return (rows || []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    module: String(r.module),
    category: r.category as ErcCategory,
    description: String(r.description),
    rootCause: String(r.root_cause || ""),
    severity: r.severity as ErcSeverity,
    filesAffected: JSON.parse(String(r.files_affected_json || "[]")) as string[],
    recommendedFix: String(r.recommended_fix || ""),
    estimatedEffort: String(r.estimated_effort || ""),
    status: r.status as ErcIssueStatus,
    checkId: String(r.check_id || ""),
    path: r.path ? String(r.path) : undefined,
  }));
}

export async function updateCertificationIssueStatus(opts: {
  id: string;
  status: ErcIssueStatus;
  actorEmail?: string;
}): Promise<{ ok: boolean; error?: string }> {
  await ensureEnterpriseReadinessCertificationTables();
  const db = await getDb();
  const result = await db.run(
    `UPDATE aura_erc_issues SET status = ?, updated_at = ? WHERE id = ?`,
    opts.status,
    new Date().toISOString(),
    opts.id
  );
  if (!result.changes) return { ok: false, error: "Issue not found" };
  await logHqAudit({
    action: "erc_issue_status",
    entityType: "erc_issue",
    entityId: opts.id,
    actorEmail: opts.actorEmail,
    detail: `status=${opts.status}`,
  }).catch(() => undefined);
  return { ok: true };
}

export async function buildEnterpriseReadinessDashboard() {
  const latest = await getLatestCertificationRun();
  const openIssues = await listCertificationIssues({ status: "open", limit: 50 });
  return {
    version: ERC_VERSION,
    target: ERC_CERTIFICATION_TARGET,
    generatedAt: new Date().toISOString(),
    latest,
    openIssues,
    certified: Boolean(latest?.certified),
    overallReadiness: latest?.overallReadiness ?? 0,
    pillars: latest?.pillars ?? {
      overall: 0,
      moduleHealth: 0,
      integrationHealth: 0,
      securityHealth: 0,
      communicationsHealth: 0,
      aiHealth: 0,
      deploymentHealth: 0,
      databaseHealth: 0,
      mobileReadiness: 0,
      performance: 0,
    },
    policy: {
      noDemoData: true,
      noSimulatedSuccess: true,
      certificationRequires100: true,
      liveIntegrationsRequired: true,
    },
  };
}

export function wantsEnterpriseReadinessCertification(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /\benterprise readiness\b/i.test(m)
    || /\breadiness certification\b/i.test(m)
    || /\bcertify (the )?(platform|headquarters|hq)\b/i.test(m)
    || /\bproduction[- ]ready\b/i.test(m)
    || /\brun (full |complete )?(enterprise )?validation\b/i.test(m)
    || /\b100%\s*enterprise readiness\b/i.test(m)
  );
}

export async function runEnterpriseReadinessCommand(opts: {
  request: string;
  actorEmail?: string;
  founderMode?: boolean;
}): Promise<{ speechSummary: string; run?: ErcCertificationRun; dashboard?: Awaited<ReturnType<typeof buildEnterpriseReadinessDashboard>>; founderApprovalRequired: boolean }> {
  const req = opts.request.trim();
  if (/\b(show|open|dashboard|status|score)\b/i.test(req) && !/\b(run|start|execute|certify)\b/i.test(req)) {
    const dashboard = await buildEnterpriseReadinessDashboard();
    return {
      speechSummary: dashboard.latest
        ? `Enterprise Readiness ${dashboard.overallReadiness}% — ${dashboard.certified ? "CERTIFIED" : "NOT CERTIFIED"}; ${dashboard.openIssues.length} open issues.`
        : "No certification run yet. Say “Run enterprise readiness certification” to start live validation.",
      dashboard,
      founderApprovalRequired: false,
    };
  }
  if (!opts.founderMode) {
    return {
      speechSummary: "Running Enterprise Readiness Certification requires Founder Mode (live production probes).",
      founderApprovalRequired: true,
    };
  }
  const deepQuality = /\bdeep\b|\btypescript\b|\bfull quality\b/i.test(req);
  const run = await runEnterpriseReadinessCertification({
    actorEmail: opts.actorEmail,
    deepQuality,
    liveIntegrations: true,
  });
  return {
    speechSummary: run.speechSummary,
    run,
    founderApprovalRequired: false,
  };
}
