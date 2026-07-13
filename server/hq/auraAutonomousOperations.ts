/**
 * AURA Autonomous Operations — Executive Chief of Staff loop for IFCDC HQ.
 *
 * Composes live briefings, monitoring, proactive alerts, OS4 prep, Ops5 cadences,
 * organizational memory, and Founder Workspace. High-impact / external actions
 * remain Founder-gated (prep only — never silent execute).
 */
import crypto from "crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import { createLeadershipAlert, listLeadershipAlerts } from "./criticalAlerts";

export const AO_VERSION = "1.0" as const;

export type AutonomousRecommendation = {
  id: string;
  title: string;
  category: "funding" | "risk" | "budget" | "staffing" | "technology" | "process" | "partnership" | "compliance" | "executive";
  evidence: string;
  sourceSystems: string[];
  risks: string[];
  benefits: string[];
  confidence: "high" | "medium" | "low";
  recommendedAction: string;
  path: string;
  founderApprovalRequired: boolean;
};

export type PreparedPackage = {
  id: string;
  kind: string;
  title: string;
  status: "ready_for_review" | "awaiting_founder" | "draft";
  summary: string;
  path: string;
  founderApprovalRequired: true;
};

let tablesReady = false;

export async function ensureAutonomousOperationsTables(): Promise<void> {
  if (tablesReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_ao_cycles (
      id TEXT PRIMARY KEY,
      speech_summary TEXT NOT NULL,
      briefing_json TEXT,
      recommendations_json TEXT,
      prepared_json TEXT,
      alerts_emitted INTEGER DEFAULT 0,
      monitoring_score INTEGER,
      notify_founder INTEGER DEFAULT 0,
      actor_email TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ao_cycles_created ON aura_ao_cycles(created_at DESC);

    CREATE TABLE IF NOT EXISTS aura_ao_prepared (
      id TEXT PRIMARY KEY,
      cycle_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      path TEXT,
      payload_json TEXT,
      founder_approval_required INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ao_prepared_created ON aura_ao_prepared(created_at DESC);
  `);

  // Ensure scheduled job exists (visible on /hq/workflows)
  const now = new Date().toISOString();
  const exists = await db.get("SELECT id FROM hq_scheduled_jobs WHERE job_key = ?", "aura_autonomous_ops");
  if (!exists) {
    await db.run(
      `INSERT INTO hq_scheduled_jobs (id, job_key, name, schedule_expr, source_module, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      crypto.randomUUID(),
      "aura_autonomous_ops",
      "AURA Autonomous Operations Cycle",
      "hourly",
      "aura",
      now
    ).catch(() => undefined);
  }
  tablesReady = true;
}

async function softTimed<T>(label: string, fn: () => Promise<T>, fallback: T, timeoutMs = 3_500): Promise<{ value: T; ms: number; timedOut: boolean; error?: string }> {
  const t0 = Date.now();
  try {
    const value = await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { value, ms: Date.now() - t0, timedOut: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[aura-autonomous] ${label}:`, message);
    return {
      value: fallback,
      ms: Date.now() - t0,
      timedOut: /timeout/i.test(message),
      error: message,
    };
  }
}

async function soft<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  const r = await softTimed(label, fn, fallback, 8_000);
  return r.value;
}

type WorkspaceMcLite = {
  organizationHealth?: number | null;
  enterpriseHealthScore?: number | null;
  fundingPipeline?: { pipelineValue: number | null; activeAwards: number | null };
  financialHealth?: { financialHealthScore?: number | null; cashFlow?: number | null };
  softwareHealth?: { score?: number | null; label?: string | null; deployAligned?: boolean | null };
  hrStatus?: string;
  compliance?: { overdue?: number; dueNext14Days?: number };
  pendingApprovals?: number;
};

function buildRecommendations(ctx: {
  mc: WorkspaceMcLite | null;
  mon: { overallScore?: number; overallStatus?: string; alerts?: unknown[] } | null;
  proactive: { alerts: Array<{ title: string; message: string; path?: string; priority: string; sourceModule: string }> };
  goalsAtRisk: number;
  pendingApprovals: number;
}): AutonomousRecommendation[] {
  const recs: AutonomousRecommendation[] = [];

  if ((ctx.mc?.compliance?.overdue || 0) > 0) {
    recs.push({
      id: "rec-compliance",
      title: "Clear overdue compliance items",
      category: "compliance",
      evidence: `${ctx.mc?.compliance?.overdue} overdue compliance deadline(s); ${ctx.mc?.compliance?.dueNext14Days ?? 0} due in 14 days.`,
      sourceSystems: ["Compliance", "Enterprise OS Mission Control"],
      risks: ["Regulatory exposure", "Funding hold risk"],
      benefits: ["Restore compliance posture", "Reduce Founder risk load"],
      confidence: "high",
      recommendedAction: "Open Compliance Center, assign owners, approve prepared compliance digest.",
      path: "/hq/compliance",
      founderApprovalRequired: true,
    });
  }

  if (ctx.pendingApprovals >= 3) {
    recs.push({
      id: "rec-approvals",
      title: "Work Founder approval queue",
      category: "executive",
      evidence: `${ctx.pendingApprovals} approvals waiting across HQ workflows.`,
      sourceSystems: ["Workflows", "Mission Control"],
      risks: ["Blocked grants/ops", "Missed deadlines"],
      benefits: ["Unblock multi-department work"],
      confidence: "high",
      recommendedAction: "Review pending approvals in Founder Workspace and Workflows.",
      path: "/hq/workflows",
      founderApprovalRequired: true,
    });
  }

  if (ctx.mon && typeof ctx.mon.overallScore === "number" && ctx.mon.overallScore < 70) {
    recs.push({
      id: "rec-monitoring",
      title: "Stabilize enterprise monitoring health",
      category: "technology",
      evidence: `Monitoring overall ${ctx.mon.overallScore} (${ctx.mon.overallStatus}); ${ctx.mon.alerts?.length || 0} alerts.`,
      sourceSystems: ["Enterprise Monitoring", "Integrations Hub"],
      risks: ["Production incidents", "Silent integration failure"],
      benefits: ["Restore operational reliability"],
      confidence: "high",
      recommendedAction: "Open Monitoring, retry degraded integrations, verify Render deploy alignment.",
      path: "/hq/monitoring",
      founderApprovalRequired: false,
    });
  }

  if (ctx.mc?.softwareHealth?.deployAligned === false) {
    recs.push({
      id: "rec-deploy",
      title: "Align production deploy with GitHub main",
      category: "technology",
      evidence: "Deploy alignment reports behind (GitHub ahead of Render).",
      sourceSystems: ["Software Engineering", "Render", "GitHub"],
      risks: ["Live HQ missing shipped fixes"],
      benefits: ["Production matches certified main"],
      confidence: "high",
      recommendedAction: "Manual Deploy latest main after review; verify live commit.",
      path: "/hq/software-engineering",
      founderApprovalRequired: true,
    });
  }

  const pipeline = ctx.mc?.fundingPipeline?.pipelineValue;
  if (pipeline == null || Number(pipeline) === 0) {
    recs.push({
      id: "rec-funding",
      title: "Refresh funding pipeline and grant matches",
      category: "funding",
      evidence: "Pipeline value empty or unavailable on Mission Control.",
      sourceSystems: ["Grant Center", "Grants.gov", "SAM.gov"],
      risks: ["Missed opportunities"],
      benefits: ["Visible funding runway"],
      confidence: "medium",
      recommendedAction: "Run Grant Center sync and review top matches for Founder shortlist.",
      path: "/hq/grants",
      founderApprovalRequired: false,
    });
  }

  if (ctx.goalsAtRisk > 0) {
    recs.push({
      id: "rec-goals",
      title: "Address at-risk strategic goals",
      category: "process",
      evidence: `${ctx.goalsAtRisk} strategic goal(s) at risk or behind.`,
      sourceSystems: ["Strategic Goals", "Enterprise Operations"],
      risks: ["Missed mission outcomes"],
      benefits: ["Restore strategic trajectory"],
      confidence: "medium",
      recommendedAction: "Review goals in Founder Workspace and create Ops 5 coordination run if multi-department.",
      path: "/hq/enterprise-ops",
      founderApprovalRequired: true,
    });
  }

  for (const a of ctx.proactive.alerts.slice(0, 4)) {
    recs.push({
      id: `rec-proactive-${a.title.slice(0, 24)}`,
      title: a.title,
      category: a.sourceModule === "grants" ? "funding" : a.priority === "high" ? "risk" : "executive",
      evidence: a.message,
      sourceSystems: [a.sourceModule, "AURA Proactive Intelligence"],
      risks: a.priority === "high" ? ["Immediate Founder attention required"] : ["Operational drag"],
      benefits: ["Early intervention"],
      confidence: a.priority === "high" ? "high" : "medium",
      recommendedAction: `Review alert and act from ${a.path || "/hq/founder-workspace"}.`,
      path: a.path || "/hq/founder-workspace",
      founderApprovalRequired: a.priority === "high",
    });
  }

  if (!recs.length) {
    recs.push({
      id: "rec-steady",
      title: "Maintain steady-state operations",
      category: "executive",
      evidence: "No critical autonomous signals this cycle.",
      sourceSystems: ["Autonomous Operations"],
      risks: ["Complacency if monitoring pauses"],
      benefits: ["Preserve readiness"],
      confidence: "medium",
      recommendedAction: "Review daily briefing and keep Founder approval queue clear.",
      path: "/hq/founder-workspace",
      founderApprovalRequired: false,
    });
  }

  return recs.slice(0, 12);
}

export async function runAutonomousOperationsCycle(opts?: {
  actorEmail?: string;
  notifyFounderChannels?: boolean;
  prepareCadences?: boolean;
}): Promise<{
  id: string;
  aoVersion: typeof AO_VERSION;
  startedAt: string;
  completedAt: string;
  speechSummary: string;
  dailyBriefing: unknown;
  monitoringScore: number | null;
  proactive: { evaluated: number; emitted: number; skipped: number };
  prepared: PreparedPackage[];
  recommendations: AutonomousRecommendation[];
  founderApprovalsWaiting: number;
}> {
  await ensureAutonomousOperationsTables();
  const startedAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const notify = Boolean(opts?.notifyFounderChannels);

  const [
    dailyBriefing,
    mc,
    mon,
    proactive,
    preparedActions,
    goals,
    leadershipAlerts,
  ] = await Promise.all([
    soft("briefing", () => import("./executiveBriefings").then((m) => m.getOrGenerateDailyBriefing(false)), null),
    soft("mission-control", () => import("./auraEnterpriseOs4").then((m) => m.buildEnterpriseOsMissionControl()), null),
    soft("monitoring", () => import("./enterpriseMonitoringEngine").then((m) => m.buildEnterpriseMonitoringOverview({ bypassCache: true })), null),
    soft(
      "proactive",
      () =>
        import("./auraProactiveIntelligence").then((m) =>
          m.evaluateAndEmitProactiveAlerts({ notifyFounderChannels: notify })
        ),
      { evaluated: 0, emitted: 0, skipped: 0, alerts: [] }
    ),
    soft("os4-scan", () => import("./auraEnterpriseOs4").then((m) => m.runAutonomousWorkflowScan()), []),
    soft("goals", async () => {
      const m = await import("./strategicGoalsEngine");
      return m.listStrategicGoals() as Promise<{ goals: Array<Record<string, unknown>> }>;
    }, { goals: [] }),
    soft("alerts", () => listLeadershipAlerts(15), [] as Record<string, unknown>[]),
  ]);

  const goalList = (goals as { goals?: Array<Record<string, unknown>> })?.goals || [];
  const goalsAtRisk = goalList.filter((g) => {
    const status = String(g.status || "");
    const pct = Number(g.progressPercent ?? g.progress_percent ?? 100);
    return status === "at_risk" || status === "behind" || pct < 40;
  }).length;

  const pendingApprovals = Number(mc?.pendingApprovals ?? 0);
  const prepared: PreparedPackage[] = [];

  // OS4 prepared actions → review queue (never auto-execute)
  for (const a of preparedActions.slice(0, 8)) {
    prepared.push({
      id: a.id || crypto.randomUUID(),
      kind: "os4_prepared_action",
      title: a.title,
      status: a.founderApprovalRequired ? "awaiting_founder" : "ready_for_review",
      summary: a.explanation || a.title,
      path: a.suggestedPath || "/hq/enterprise-os",
      founderApprovalRequired: true,
    });
  }

  // Optional cadence drafts (Founder review before external distribution)
  if (opts?.prepareCadences !== false) {
    const hour = new Date().getUTCHours();
    // Morning window UTC 11–15 ≈ US morning Eastern — prepare weekly/board materials lightly
    if (hour >= 11 && hour <= 16) {
      const cadence = await soft(
        "cadence",
        async () => {
          const { prepareCadence } = await import("./auraEnterpriseOs5");
          return prepareCadence({
            cadenceId: "weekly_executive",
            actorEmail: opts?.actorEmail,
            founderMode: true,
          });
        },
        null
      );
      if (cadence?.ok && cadence.package) {
        prepared.push({
          id: cadence.prepId || crypto.randomUUID(),
          kind: "eo5_weekly_executive",
          title: cadence.package.title,
          status: "awaiting_founder",
          summary: cadence.package.speechSummary,
          path: "/hq/enterprise-ops",
          founderApprovalRequired: true,
        });
      }
    }
  }

  // Persist prepared packages
  const db = await getDb();
  for (const p of prepared) {
    await db.run(
      `INSERT OR REPLACE INTO aura_ao_prepared (
        id, cycle_id, kind, title, status, summary, path, payload_json, founder_approval_required, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      p.id,
      id,
      p.kind,
      p.title,
      p.status,
      p.summary,
      p.path,
      null,
      startedAt
    ).catch(() => undefined);
  }

  const recommendations = buildRecommendations({
    mc,
    mon,
    proactive: { alerts: proactive.alerts || [] },
    goalsAtRisk,
    pendingApprovals,
  });

  const monitoringScore = mon?.overallScore ?? null;
  const speechSummary = [
    `AURA Autonomous Operations ${AO_VERSION}: cycle complete.`,
    monitoringScore != null ? `Monitoring ${monitoringScore}/100.` : null,
    `Proactive ${proactive.emitted} alert(s) emitted (${proactive.evaluated} evaluated).`,
    `${prepared.length} package(s) ready for Founder review.`,
    `${pendingApprovals} Founder approval(s) waiting.`,
    `${recommendations.length} recommendation(s).`,
  ]
    .filter(Boolean)
    .join(" ");

  // Critical cycle alert if monitoring critical
  if (monitoringScore != null && monitoringScore < 50) {
    await createLeadershipAlert({
      alertType: "aura_autonomous",
      title: "Enterprise monitoring critical",
      message: `Autonomous cycle detected monitoring score ${monitoringScore}.`,
      priority: "high",
      sourceModule: "aura_autonomous",
      sourceId: id,
      path: "/hq/monitoring",
    }).catch(() => undefined);
  }

  await db.run(
    `INSERT INTO aura_ao_cycles (
      id, speech_summary, briefing_json, recommendations_json, prepared_json,
      alerts_emitted, monitoring_score, notify_founder, actor_email, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    speechSummary,
    JSON.stringify(dailyBriefing),
    JSON.stringify(recommendations),
    JSON.stringify(prepared),
    proactive.emitted,
    monitoringScore,
    notify ? 1 : 0,
    opts?.actorEmail ?? null,
    new Date().toISOString()
  );

  await logHqAudit({
    action: "aura_autonomous_cycle",
    entityType: "ao_cycle",
    entityId: id,
    actorEmail: opts?.actorEmail,
    detail: speechSummary.slice(0, 400),
    metadata: {
      monitoringScore,
      emitted: proactive.emitted,
      prepared: prepared.length,
      notify,
    },
  }).catch(() => undefined);

  void leadershipAlerts;

  return {
    id,
    aoVersion: AO_VERSION,
    startedAt,
    completedAt: new Date().toISOString(),
    speechSummary,
    dailyBriefing,
    monitoringScore,
    proactive: {
      evaluated: proactive.evaluated,
      emitted: proactive.emitted,
      skipped: proactive.skipped,
    },
    prepared,
    recommendations,
    founderApprovalsWaiting: pendingApprovals,
  };
}


let workspaceCache: { at: number; data: Awaited<ReturnType<typeof buildFounderWorkspaceUncached>> } | null = null;
const WORKSPACE_CACHE_TTL_MS = 25_000;

export async function buildFounderWorkspace(opts?: { bypassCache?: boolean }) {
  const now = Date.now();
  if (!opts?.bypassCache && workspaceCache && now - workspaceCache.at < WORKSPACE_CACHE_TTL_MS) {
    return {
      ...workspaceCache.data,
      generatedAt: new Date().toISOString(),
      cache: { hit: true, ageMs: now - workspaceCache.at, ttlMs: WORKSPACE_CACHE_TTL_MS },
    };
  }
  const data = await buildFounderWorkspaceUncached();
  workspaceCache = { at: Date.now(), data };
  return { ...data, cache: { hit: false, ageMs: 0, ttlMs: WORKSPACE_CACHE_TTL_MS } };
}

async function buildFounderWorkspaceUncached() {
  await ensureAutonomousOperationsTables();
  const wallStart = Date.now();

  // Light, parallel, hard-timed sources — avoid Mission Control / EO5 / Brain aggregates.
  const [
    orgHealthR,
    grantsR,
    financeR,
    monR,
    briefingR,
    alertsR,
    goalsR,
    preparedR,
    latestCycleR,
    workforceR,
    docR,
    commR,
    approvalsR,
    projectsR,
    softwareR,
  ] = await Promise.all([
    softTimed("org-health", () => import("./analyticsReporting").then((m) => m.buildOrganizationHealthScore()), null, 2_500),
    softTimed("grants", () => import("./grantReporting").then((m) => m.buildGrantExecutiveDashboard()), null, 2_500),
    softTimed("finance", () => import("./financeReporting").then((m) => m.buildExecutiveDashboard()), null, 2_500),
    softTimed(
      "monitoring",
      () => import("./enterpriseMonitoringEngine").then((m) => m.buildEnterpriseMonitoringOverview({ bypassCache: false })),
      null,
      4_000
    ),
    softTimed("briefing", () => import("./executiveBriefings").then((m) => m.getOrGenerateDailyBriefing(false)), null, 2_500),
    softTimed("alerts", () => listLeadershipAlerts(20), [] as Record<string, unknown>[], 2_000),
    softTimed(
      "goals",
      async () => {
        const m = await import("./strategicGoalsEngine");
        return m.listStrategicGoals() as Promise<{ goals: Array<Record<string, unknown>> }>;
      },
      { goals: [] },
      2_000
    ),
    softTimed(
      "prepared",
      async () => {
        const db = await getDb();
        return ((await db.all(
          `SELECT id, kind, title, status, summary, path, created_at FROM aura_ao_prepared ORDER BY created_at DESC LIMIT 20`
        )) || []) as Array<Record<string, unknown>>;
      },
      [] as Array<Record<string, unknown>>,
      1_500
    ),
    softTimed(
      "cycle",
      async () => {
        const db = await getDb();
        return db.get(
          `SELECT id, speech_summary, recommendations_json, prepared_json, monitoring_score, alerts_emitted, created_at
           FROM aura_ao_cycles ORDER BY created_at DESC LIMIT 1`
        );
      },
      null,
      1_500
    ),
    softTimed("workforce", () => import("./workforceFoundation").then((m) => m.buildWorkforceDashboard()), null, 2_500),
    softTimed(
      "documents",
      async () => {
        const db = await getDb();
        const countRow = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM hq_documents`).catch(() => null);
        if (countRow) return { count: Number(countRow.c || 0), ready: true };
        return { count: 0, ready: false };
      },
      { count: 0, ready: false },
      1_500
    ),
    softTimed(
      "comms",
      async () => {
        const db = await getDb();
        const row = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM hq_communications_messages`).catch(() => null);
        if (row) return { count: Number(row.c || 0), ready: true };
        const alt = await db.get<{ c: number }>(
          `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name LIKE 'comm%'`
        ).catch(() => ({ c: 0 }));
        return { count: 0, ready: (alt?.c || 0) > 0 };
      },
      { count: 0, ready: false },
      1_500
    ),
    softTimed(
      "approvals",
      () =>
        import("./enterpriseApprovals").then((m) => m.buildApprovalQueue(20)).catch(() => ({ tasks: [], counts: { total: 0 } })),
      { tasks: [], counts: { total: 0 } },
      2_000
    ),
    softTimed(
      "projects",
      async () => {
        const db = await getDb();
        const row = await db.get<{ c: number }>(
          `SELECT COUNT(*) as c FROM ops_projects WHERE status IN ('planning','active')`
        ).catch(() => ({ c: 0 }));
        return Number(row?.c || 0);
      },
      0,
      1_500
    ),
    softTimed(
      "software",
      () =>
        import("./auraTechnicalCommandEngine")
          .then((m) => m.buildTechnicalCommandBriefing())
          .catch(() => null),
      null,
      3_000
    ),
  ]);

  const timings: Record<string, { ms: number; timedOut: boolean; error?: string }> = {
    "org-health": { ms: orgHealthR.ms, timedOut: orgHealthR.timedOut, error: orgHealthR.error },
    grants: { ms: grantsR.ms, timedOut: grantsR.timedOut, error: grantsR.error },
    finance: { ms: financeR.ms, timedOut: financeR.timedOut, error: financeR.error },
    monitoring: { ms: monR.ms, timedOut: monR.timedOut, error: monR.error },
    briefing: { ms: briefingR.ms, timedOut: briefingR.timedOut, error: briefingR.error },
    alerts: { ms: alertsR.ms, timedOut: alertsR.timedOut, error: alertsR.error },
    goals: { ms: goalsR.ms, timedOut: goalsR.timedOut, error: goalsR.error },
    prepared: { ms: preparedR.ms, timedOut: preparedR.timedOut, error: preparedR.error },
    cycle: { ms: latestCycleR.ms, timedOut: latestCycleR.timedOut, error: latestCycleR.error },
    workforce: { ms: workforceR.ms, timedOut: workforceR.timedOut, error: workforceR.error },
    documents: { ms: docR.ms, timedOut: docR.timedOut, error: docR.error },
    comms: { ms: commR.ms, timedOut: commR.timedOut, error: commR.error },
    approvals: { ms: approvalsR.ms, timedOut: approvalsR.timedOut, error: approvalsR.error },
    projects: { ms: projectsR.ms, timedOut: projectsR.timedOut, error: projectsR.error },
    software: { ms: softwareR.ms, timedOut: softwareR.timedOut, error: softwareR.error },
  };

  const orgHealthScore = orgHealthR.value?.overall ?? null;
  const grants = grantsR.value;
  const finance = financeR.value;
  const mon = monR.value;
  const briefing = briefingR.value;
  const alerts = alertsR.value || [];
  const goals = goalsR.value;
  const prepared = preparedR.value || [];
  const latestCycle = latestCycleR.value;
  const workforce = workforceR.value;
  const docCount = docR.value;
  const commCount = commR.value;
  const approvals = approvalsR.value as { counts?: { total?: number }; tasks?: unknown[] };
  const projectCount = projectsR.value;
  const software = softwareR.value as { overallScore?: number; overallLabel?: string; deployAligned?: boolean | null } | null;

  const pipelineValue = grants?.pipelineValue ?? null;
  const activeAwards = grants?.activeAwards ?? null;
  const pendingApprovals =
    Number(approvals?.counts?.total ?? approvals?.tasks?.length ?? 0);
  const financeScore = finance?.financialHealthScore ?? null;
  const cashFlow = finance?.cashFlow ?? null;
  const hrHeadcount = workforce?.kpis?.totalWorkforce ?? workforce?.kpis?.totalEmployees ?? null;
  const monitoringScore = mon?.overallScore ?? null;
  const softwareScore = software?.overallScore ?? null;
  const enterpriseHealth = monitoringScore ?? orgHealthScore;
  const orgHealth = orgHealthScore;

  const mcLite: WorkspaceMcLite = {
    organizationHealth: orgHealth,
    enterpriseHealthScore: enterpriseHealth,
    fundingPipeline: { pipelineValue, activeAwards },
    financialHealth: { financialHealthScore: financeScore, cashFlow },
    softwareHealth: {
      score: softwareScore,
      label: software?.overallLabel ?? null,
      deployAligned: software?.deployAligned ?? null,
    },
    hrStatus: hrHeadcount != null ? `${hrHeadcount} people` : "unknown",
    compliance: { overdue: 0, dueNext14Days: 0 },
    pendingApprovals,
  };

  const goalList = (goals as { goals?: Array<Record<string, unknown>> })?.goals || [];
  const recommendations: AutonomousRecommendation[] =
    latestCycle && (latestCycle as { recommendations_json?: string }).recommendations_json
      ? (JSON.parse(String((latestCycle as { recommendations_json: string }).recommendations_json)) as AutonomousRecommendation[])
      : buildRecommendations({
          mc: mcLite,
          mon: mon,
          proactive: { alerts: [] },
          goalsAtRisk: goalList.filter(
            (g) => String(g.status || "") === "at_risk" || Number(g.progressPercent ?? 100) < 40
          ).length,
          pendingApprovals,
        });

  const criticalAlerts = (alerts || [])
    .filter(
      (a) =>
        String(a.priority || a.severity || "") === "high" || String(a.priority || "") === "critical"
    )
    .slice(0, 10);

  const priorities = [
    ...recommendations.filter((r) => r.confidence === "high").slice(0, 5).map((r) => r.title),
    pendingLabel(pendingApprovals),
  ].filter(Boolean) as string[];

  const briefingObj = briefing as { title?: string; content?: string; highlights?: string[]; generatedAt?: string; date?: string } | null;
  const briefingReady = Boolean(briefingObj?.content || briefingObj?.title);

  type CommandCard = {
    id: string;
    label: string;
    value: string;
    meta: string;
    path: string;
    status: "live" | "empty" | "degraded";
    variant?: "gold" | "success" | "warning" | "danger" | "muted";
  };

  const fmtMoney = (n: number | null | undefined) =>
    n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  const cardStatus = (live: boolean, timedOut?: boolean): CommandCard["status"] => {
    if (live) return "live";
    if (timedOut) return "degraded";
    return "empty";
  };

  const commandCards: CommandCard[] = [
    {
      id: "executive-briefing",
      label: "Executive Briefing",
      value: briefingReady ? "Today" : briefingR.timedOut ? "Unavailable" : "No data",
      meta: briefingReady
        ? (briefingObj?.title || "Open live briefing")
        : briefingR.timedOut
          ? "Service unavailable — open Founder Command Center"
          : "No data available",
      path: "/hq/founder",
      status: cardStatus(briefingReady, briefingR.timedOut),
      variant: briefingReady ? "gold" : "muted",
    },
    {
      id: "pending-approvals",
      label: "Pending Approvals",
      value: String(pendingApprovals),
      meta: pendingApprovals ? "Open live approval queue" : "Queue clear",
      path: "/hq/workflows",
      status: "live",
      variant: pendingApprovals >= 3 ? "warning" : "success",
    },
    {
      id: "organization-health",
      label: "Organization Health",
      value: orgHealth != null ? `${orgHealth}%` : orgHealthR.timedOut ? "Unavailable" : "No data",
      meta:
        orgHealth != null
          ? `Grade ${(orgHealthR.value as { grade?: string } | null)?.grade || "—"} · Enterprise health dashboard`
          : orgHealthR.timedOut
            ? "Service unavailable"
            : "No data available",
      path: "/hq/enterprise-os",
      status: cardStatus(orgHealth != null, orgHealthR.timedOut),
      variant: orgHealth != null ? "gold" : "muted",
    },
    {
      id: "enterprise-health",
      label: "Enterprise Health",
      value: enterpriseHealth != null ? String(enterpriseHealth) : "No data",
      meta: "Composite of org + monitoring",
      path: "/hq/enterprise-os",
      status: cardStatus(enterpriseHealth != null),
    },
    {
      id: "active-grants",
      label: "Active Grants",
      value: activeAwards != null ? String(activeAwards) : grantsR.timedOut ? "Unavailable" : "No data",
      meta: "Open Grant Center",
      path: "/hq/grants",
      status: cardStatus(activeAwards != null, grantsR.timedOut),
    },
    {
      id: "funding-pipeline",
      label: "Funding Pipeline",
      value: pipelineValue != null ? fmtMoney(pipelineValue) : grantsR.timedOut ? "Unavailable" : "No data",
      meta: pipelineValue != null ? "Enterprise funding pipeline" : grantsR.timedOut ? "Service unavailable" : "No data available",
      path: "/hq/grants",
      status: cardStatus(pipelineValue != null, grantsR.timedOut),
      variant: pipelineValue != null ? "gold" : "muted",
    },
    {
      id: "financial-summary",
      label: "Financial Summary",
      value: financeScore != null ? String(financeScore) : cashFlow != null ? fmtMoney(cashFlow) : financeR.timedOut ? "Unavailable" : "No data",
      meta: cashFlow != null ? `Cash ${fmtMoney(cashFlow)} · Financial Center` : "Open Financial Center",
      path: "/hq/finance",
      status: cardStatus(financeScore != null || cashFlow != null, financeR.timedOut),
    },
    {
      id: "hr-summary",
      label: "HR Summary",
      value: hrHeadcount != null ? String(hrHeadcount) : workforceR.timedOut ? "Unavailable" : "No data",
      meta: "Open HR / People Center",
      path: "/hq/people",
      status: cardStatus(hrHeadcount != null, workforceR.timedOut),
    },
    {
      id: "communications",
      label: "Communications",
      value: commCount.ready ? String(commCount.count) : "No data",
      meta: commCount.ready ? "Open Communications Center" : "No data available",
      path: "/hq/communications",
      status: cardStatus(commCount.ready),
      variant: commCount.ready ? "gold" : "muted",
    },
    {
      id: "system-health",
      label: "System Health",
      value: monitoringScore != null ? String(monitoringScore) : monR.timedOut ? "Unavailable" : "No data",
      meta: mon
        ? `${mon.overallStatus} · Technical operations`
        : monR.timedOut
          ? "Service unavailable — open Monitoring"
          : "No data available",
      path: "/hq/monitoring",
      status: cardStatus(monitoringScore != null, monR.timedOut),
      variant: monitoringScore != null && monitoringScore < 70 ? "warning" : monitoringScore != null ? "success" : "muted",
    },
    {
      id: "alerts",
      label: "Critical Alerts",
      value: String(criticalAlerts.length),
      meta: "Open notifications / alerts",
      path: "/hq/notifications",
      status: "live",
      variant: criticalAlerts.length ? "warning" : "success",
    },
    {
      id: "projects",
      label: "Active Projects",
      value: String(projectCount),
      meta: "Operations project dashboard",
      path: "/hq/operations",
      status: "live",
    },
    {
      id: "calendar",
      label: "Calendar",
      value: "Open",
      meta: "Executive calendar",
      path: "/hq/calendar",
      status: "live",
    },
    {
      id: "documents",
      label: "Documents",
      value: docCount.ready ? String(docCount.count) : "No data",
      meta: docCount.ready ? "Document Management" : "No data available",
      path: "/hq/documents",
      status: cardStatus(docCount.ready),
      variant: docCount.ready ? "gold" : "muted",
    },
    {
      id: "software-division",
      label: "Software Division",
      value: softwareScore != null ? String(softwareScore) : "Open",
      meta: software?.overallLabel || "Software Engineering dashboard",
      path: "/hq/software-engineering",
      status: "live",
      variant: software?.deployAligned === false ? "warning" : "gold",
    },
  ];

  const priorityItems = recommendations
    .filter((r) => r.confidence === "high")
    .slice(0, 6)
    .map((r) => ({ title: r.title, path: r.path, id: r.id }));

  if (pendingApprovals > 0) {
    priorityItems.unshift({
      id: "priority-approvals",
      title: `Clear ${pendingApprovals} Founder approval(s)`,
      path: "/hq/workflows",
    });
  }

  const liveCards = commandCards.filter((c) => c.status === "live").length;
  const degradedCards = commandCards.filter((c) => c.status === "degraded").length;
  const emptyCards = commandCards.filter((c) => c.status === "empty").length;
  const totalMs = Date.now() - wallStart;
  const timedOutCount = Object.values(timings).filter((t) => t.timedOut).length;
  const workspaceHealthScore = Math.max(
    0,
    Math.min(
      100,
      Math.round((liveCards / Math.max(commandCards.length, 1)) * 100 - timedOutCount * 5 - (totalMs > 5000 ? 10 : 0))
    )
  );
  const slowest = Object.entries(timings).sort((a, b) => b[1].ms - a[1].ms)[0];

  return {
    aoVersion: AO_VERSION,
    generatedAt: new Date().toISOString(),
    todayPriorities: priorities.slice(0, 8),
    todayPriorityItems: priorityItems.slice(0, 8),
    pendingApprovals,
    executiveRecommendations: recommendations,
    activeGrants: {
      pipelineValue,
      activeAwards,
      path: "/hq/grants",
    },
    activeProjects: {
      count: projectCount,
      path: "/hq/operations",
    },
    criticalAlerts: criticalAlerts.map((a) => ({
      id: String(a.id || crypto.randomUUID()),
      title: String(a.title || "Alert"),
      message: String(a.message || a.detail || ""),
      path: a.path ? String(a.path) : "/hq/notifications",
      priority: String(a.priority || "high"),
    })),
    organizationHealth: orgHealth,
    enterpriseHealth,
    strategicGoals: goalList.slice(0, 8).map((g) => ({
      title: String(g.title || ""),
      progressPercent: Number(g.progressPercent ?? g.progress_percent ?? 0),
      status: String(g.status || ""),
      path: "/hq/enterprise-ops",
    })),
    personalReminders: [
      pendingApprovals > 0 ? `${pendingApprovals} Founder approval(s) waiting` : null,
      software?.deployAligned === false ? "Manual Deploy may be required" : null,
      "High-impact actions require explicit Founder approval",
    ].filter(Boolean) as string[],
    personalReminderItems: [
      pendingApprovals > 0
        ? { id: "rem-approvals", title: `${pendingApprovals} Founder approval(s) waiting`, path: "/hq/workflows" }
        : null,
      software?.deployAligned === false
        ? { id: "rem-deploy", title: "Manual Deploy may be required", path: "/hq/software-engineering" }
        : null,
      { id: "rem-gate", title: "High-impact actions require Founder approval", path: "/hq/workflows" },
    ].filter(Boolean) as Array<{ id: string; title: string; path: string }>,
    dailyBriefing: briefing
      ? {
          ...(typeof briefing === "object" ? briefing : { content: String(briefing) }),
          path: "/hq/founder",
        }
      : null,
    preparedPackages: prepared.map((p) => ({
      id: String(p.id),
      kind: String(p.kind),
      title: String(p.title),
      status: String(p.status),
      summary: String(p.summary || ""),
      path: String(p.path || "/hq/enterprise-ops"),
      createdAt: String(p.created_at || ""),
    })),
    monitoring: mon
      ? { score: mon.overallScore, status: mon.overallStatus, alerts: mon.alerts?.length || 0, path: "/hq/monitoring" }
      : null,
    memorySummary: null,
    memoryPath: "/hq/knowledge",
    latestCycle: latestCycle
      ? {
          id: String((latestCycle as { id: string }).id),
          speechSummary: String((latestCycle as { speech_summary: string }).speech_summary || ""),
          monitoringScore: (latestCycle as { monitoring_score?: number }).monitoring_score ?? null,
          createdAt: String((latestCycle as { created_at: string }).created_at),
        }
      : null,
    commandCards,
    deepLinks: [
      { label: "Founder Command Center", path: "/hq/founder" },
      { label: "Grant Center", path: "/hq/grants" },
      { label: "Financial Center", path: "/hq/finance" },
      { label: "HR / People", path: "/hq/people" },
      { label: "Communications", path: "/hq/communications" },
      { label: "Operations", path: "/hq/operations" },
      { label: "Workflows / Approvals", path: "/hq/workflows" },
      { label: "Monitoring", path: "/hq/monitoring" },
      { label: "Software Engineering", path: "/hq/software-engineering" },
      { label: "Documents", path: "/hq/documents" },
      { label: "Calendar", path: "/hq/calendar" },
      { label: "Enterprise Ops 5.0", path: "/hq/enterprise-ops" },
      { label: "AURA Chat", path: "/hq/aura" },
    ],
    policy: {
      highImpactRequiresFounderApproval: true,
      externalDistributionRequiresFounderApproval: true,
      autonomousPrepOnly: true,
    },
    performance: {
      totalMs,
      timings,
      slowestEndpoint: slowest ? { id: slowest[0], ms: slowest[1].ms } : null,
      liveCards,
      degradedCards,
      emptyCards,
      timedOutCount,
      workspaceHealthScore,
      targetLoadMs: 2000,
      targetRefreshMs: 5000,
    },
  };
}


function pendingLabel(n: number): string | null {
  return n > 0 ? `Clear ${n} Founder approval(s)` : null;
}

export async function listPreparedPackages(limit = 25): Promise<PreparedPackage[]> {
  await ensureAutonomousOperationsTables();
  const db = await getDb();
  const rows = ((await db.all(
    `SELECT id, kind, title, status, summary, path FROM aura_ao_prepared ORDER BY created_at DESC LIMIT ?`,
    Math.min(Math.max(limit, 1), 100)
  )) || []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    title: String(r.title),
    status: (String(r.status) as PreparedPackage["status"]) || "draft",
    summary: String(r.summary || ""),
    path: String(r.path || "/hq/founder-workspace"),
    founderApprovalRequired: true as const,
  }));
}

export function wantsAutonomousOperations(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /\bautonomous operations?\b/i.test(m)
    || /\bchief of staff\b/i.test(m)
    || /\bfounder workspace\b/i.test(m)
    || /\bdaily briefing\b/i.test(m)
    || /\brun (an? )?(autonomous|ops) cycle\b/i.test(m)
    || /\bproactive (scan|intelligence|alerts)\b/i.test(m)
    || /\btoday'?s priorities\b/i.test(m)
  );
}

export async function runAutonomousOperationsCommand(opts: {
  request: string;
  actorEmail?: string;
  founderMode?: boolean;
}): Promise<{
  speechSummary: string;
  founderApprovalRequired: boolean;
  workspace?: Awaited<ReturnType<typeof buildFounderWorkspace>>;
  cycle?: Awaited<ReturnType<typeof runAutonomousOperationsCycle>>;
}> {
  const req = opts.request.trim();

  if (/\b(workspace|priorities|show|open|status|dashboard)\b/i.test(req) && !/\b(run|start|execute|cycle|scan)\b/i.test(req)) {
    const workspace = await buildFounderWorkspace();
    return {
      speechSummary: `Founder Workspace ready: health ${workspace.organizationHealth ?? "n/a"}, ${workspace.pendingApprovals} approvals, ${workspace.executiveRecommendations.length} recommendations, ${workspace.preparedPackages.length} prepared packages.`,
      founderApprovalRequired: false,
      workspace,
    };
  }

  if (/\bdaily briefing\b/i.test(req) && !/\bcycle\b/i.test(req)) {
    const workspace = await buildFounderWorkspace();
    const brief = workspace.dailyBriefing as { speechSummary?: string; summary?: string } | null;
    return {
      speechSummary: brief?.speechSummary || brief?.summary || "Daily briefing prepared in Founder Workspace.",
      founderApprovalRequired: false,
      workspace,
    };
  }

  if (!opts.founderMode && /\b(run|start|execute|cycle|scan|notify)\b/i.test(req)) {
    return {
      speechSummary: "Running the Autonomous Operations cycle requires Founder Mode.",
      founderApprovalRequired: true,
    };
  }

  const notify = /\bnotify\b|\balert me\b|\bemail\b|\bsms\b/i.test(req);
  const cycle = await runAutonomousOperationsCycle({
    actorEmail: opts.actorEmail,
    notifyFounderChannels: notify && Boolean(opts.founderMode),
    prepareCadences: true,
  });
  return {
    speechSummary: cycle.speechSummary,
    founderApprovalRequired: false,
    cycle,
  };
}
