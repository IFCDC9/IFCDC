/**
 * AURA Enterprise Operations 5.0 — Enterprise Operations Engine for IFCDC HQ.
 *
 * Orchestration layer on top of OS 4.0 + Build 60 ops + workforce + goals + SE.
 * Coordinates multi-department work as durable ops runs and cadences.
 * High-impact / external distribution always requires Founder approval.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import {
  OS_VERSION,
  buildEnterpriseOsMissionControl,
  buildExecutiveAutomationPackage,
  type ExecutiveAutomationPackage,
} from "./auraEnterpriseOs4";
import { BRAIN_VERSION } from "./auraExecutiveDecisionIntelligence";

export const EO_VERSION = "5.0" as const;

export type OpsDepartment =
  | "grants"
  | "finance"
  | "hr"
  | "communications"
  | "operations"
  | "software"
  | "executive"
  | "compliance"
  | "documents"
  | "calendar"
  | "workflow";

export type OpsRunStep = {
  id: string;
  department: OpsDepartment;
  title: string;
  detail: string;
  path: string;
  status: "prepared" | "awaiting_founder" | "ready" | "blocked";
  founderApprovalRequired: boolean;
};

export type OpsRun = {
  id: string;
  title: string;
  trigger: string;
  status: "draft" | "awaiting_founder" | "active" | "completed" | "cancelled";
  steps: OpsRunStep[];
  executiveSummary: string;
  founderApprovalRequired: boolean;
  actorEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OpsCadenceId =
  | "weekly_executive"
  | "monthly_board"
  | "monthly_financial"
  | "compliance_digest"
  | "grant_status"
  | "technology_health";

export type OpsCadence = {
  id: OpsCadenceId;
  label: string;
  schedule: string;
  description: string;
  automationKind: ExecutiveAutomationPackage["kind"];
  externalDistributionRequiresFounderApproval: true;
};

export type ContinuousImprovementItem = {
  id: string;
  category: "bottleneck" | "automation" | "cost" | "training" | "technology" | "process";
  title: string;
  evidence: string;
  recommendation: string;
  priority: "high" | "medium" | "low";
  path: string;
};

let tablesReady = false;

export async function ensureEnterpriseOps5Tables(): Promise<void> {
  if (tablesReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_eo5_ops_runs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      trigger_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      steps_json TEXT NOT NULL,
      executive_summary TEXT,
      founder_approval_required INTEGER NOT NULL DEFAULT 1,
      founder_approved INTEGER NOT NULL DEFAULT 0,
      founder_approved_at TEXT,
      founder_approved_by TEXT,
      actor_email TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eo5_runs_status ON aura_eo5_ops_runs(status);
    CREATE INDEX IF NOT EXISTS idx_eo5_runs_created ON aura_eo5_ops_runs(created_at DESC);

    CREATE TABLE IF NOT EXISTS aura_eo5_cadence_preps (
      id TEXT PRIMARY KEY,
      cadence_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      speech_summary TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      founder_approval_required INTEGER NOT NULL DEFAULT 1,
      systems_json TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eo5_cadence_created ON aura_eo5_cadence_preps(created_at DESC);

    CREATE TABLE IF NOT EXISTS aura_eo5_audit (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      detail TEXT,
      founder_mode INTEGER DEFAULT 0,
      metadata_json TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL
    );
  `);
  tablesReady = true;
}

async function eo5Audit(opts: {
  action: string;
  entityType?: string;
  entityId?: string;
  detail?: string;
  founderMode?: boolean;
  actorEmail?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await ensureEnterpriseOps5Tables();
    const db = await getDb();
    await db.run(
      `INSERT INTO aura_eo5_audit (id, action, entity_type, entity_id, detail, founder_mode, metadata_json, actor_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      opts.action,
      opts.entityType ?? null,
      opts.entityId ?? null,
      opts.detail ?? null,
      opts.founderMode ? 1 : 0,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      opts.actorEmail ?? null,
      new Date().toISOString()
    );
    await logHqAudit({
      action: `eo5_${opts.action}`,
      entityType: opts.entityType || "eo5",
      entityId: opts.entityId,
      actorEmail: opts.actorEmail,
      detail: opts.detail,
      metadata: opts.metadata,
    }).catch(() => undefined);
  } catch {
    /* best effort */
  }
}

export const EO5_CADENCES: OpsCadence[] = [
  {
    id: "weekly_executive",
    label: "Weekly executive report",
    schedule: "Every Monday",
    description: "Compose weekly executive review from live HQ modules.",
    automationKind: "weekly_executive",
    externalDistributionRequiresFounderApproval: true,
  },
  {
    id: "monthly_board",
    label: "Monthly board packet",
    schedule: "First week of month",
    description: "Assemble board packet from finance, grants, goals, risks, and weekly highlights.",
    automationKind: "monthly_board",
    externalDistributionRequiresFounderApproval: true,
  },
  {
    id: "monthly_financial",
    label: "Monthly financial summary",
    schedule: "Month-end",
    description: "Financial health and cash/budget summary for Founder review.",
    automationKind: "financial_summary",
    externalDistributionRequiresFounderApproval: true,
  },
  {
    id: "compliance_digest",
    label: "Compliance reminder digest",
    schedule: "Weekly",
    description: "Overdue and upcoming compliance deadlines.",
    automationKind: "compliance_calendar",
    externalDistributionRequiresFounderApproval: true,
  },
  {
    id: "grant_status",
    label: "Grant status update",
    schedule: "Bi-weekly",
    description: "Pipeline and application status for leadership.",
    automationKind: "grant_status",
    externalDistributionRequiresFounderApproval: true,
  },
  {
    id: "technology_health",
    label: "Technology health report",
    schedule: "Weekly",
    description: "Software Division / deploy alignment / monitoring summary.",
    automationKind: "technology_report",
    externalDistributionRequiresFounderApproval: true,
  },
];

function step(
  department: OpsDepartment,
  title: string,
  detail: string,
  path: string,
  founderApprovalRequired = false
): OpsRunStep {
  return {
    id: crypto.randomUUID(),
    department,
    title,
    detail,
    path,
    status: founderApprovalRequired ? "awaiting_founder" : "prepared",
    founderApprovalRequired,
  };
}

/** Map a Founder natural-language request into a multi-department ops run. */
export function planOpsRunFromRequest(request: string): {
  title: string;
  steps: OpsRunStep[];
  executiveSummary: string;
} {
  const r = request.trim();
  const lower = r.toLowerCase();

  if (/\bboard meeting\b|\bboard packet\b|\bprepare.*board\b/i.test(r)) {
    const steps = [
      step("finance", "Gather financial reports", "Pull cash, budget remaining, and financial health from live HQ finance modules.", "/hq/finance"),
      step("grants", "Summarize grants pipeline", "Compile active awards, submissions, and near-term deadlines.", "/hq/grants"),
      step("hr", "Review HR / workforce status", "Capture capacity, open requisitions, and workforce risks.", "/hq/people?tab=workforce"),
      step("software", "Build technology status", "Software Division health and GitHub↔Render alignment.", "/hq/software-engineering"),
      step("compliance", "Check compliance calendar", "List overdue and next-14-day filings.", "/hq/compliance"),
      step("executive", "Prepare executive recommendations", "Draft Founder priorities from Mission Control + strategic goals.", "/hq/enterprise-os"),
      step("documents", "Assemble board packet draft", "Compose packet from live modules for Founder review.", "/hq/board", true),
      step("communications", "Hold external distribution", "Do not send to Board until Founder approves.", "/hq/communications", true),
    ];
    return {
      title: "Prepare next board meeting packet",
      steps,
      executiveSummary:
        "Cross-department board packet run prepared. Packet remains internal draft until Founder approves distribution.",
    };
  }

  if (/\bweekly (executive )?report\b|\bexecutive briefing\b/i.test(r)) {
    return {
      title: "Prepare weekly executive report",
      steps: [
        step("executive", "Compose weekly review", "Build weekly executive review from EDI / Brain.", "/hq/executive-brain"),
        step("grants", "Attach grant highlights", "Include pipeline and deadline risks.", "/hq/grants"),
        step("finance", "Attach financial snapshot", "Cash and budget health.", "/hq/finance"),
        step("software", "Attach technology status", "Deploy alignment and open SE issues.", "/hq/software-engineering"),
        step("communications", "Hold external send", "Founder approval required before any external send.", "/hq/communications", true),
      ],
      executiveSummary: "Weekly executive report draft staged for Founder review before any distribution.",
    };
  }

  if (/\borganization health|enterprise health|command center\b/i.test(r)) {
    return {
      title: "Enterprise health command refresh",
      steps: [
        step("executive", "Refresh Mission Control", "Aggregate OS 4.0 Mission Control signals.", "/hq/enterprise-os"),
        step("operations", "Refresh ops foundation", "Projects, compliance, automation status.", "/hq/operations"),
        step("hr", "Refresh workforce capacity", "Capacity and vacancy signals.", "/hq/people?tab=workforce"),
        step("software", "Refresh SE portfolio", "App health and deploy alignment.", "/hq/software-engineering"),
      ],
      executiveSummary: "Enterprise Operations Command Center refresh planned across core departments.",
    };
  }

  // Generic multi-department coordination
  const steps: OpsRunStep[] = [
    step("executive", "Frame the request", `Interpret Founder request: ${r.slice(0, 200)}`, "/hq/enterprise-ops"),
  ];
  if (/\bgrant|funding|proposal\b/i.test(lower)) {
    steps.push(step("grants", "Coordinate grants", "Open Grant Center actions and pipeline status.", "/hq/grants"));
  }
  if (/\bfinance|budget|cash|payroll\b/i.test(lower)) {
    steps.push(step("finance", "Coordinate finance", "Pull financial center status.", "/hq/finance"));
  }
  if (/\bhr|staff|hire|workforce|people\b/i.test(lower)) {
    steps.push(step("hr", "Coordinate HR", "Workforce and people status.", "/hq/people"));
  }
  if (/\bsoftware|deploy|bug|technology|render|github\b/i.test(lower)) {
    steps.push(step("software", "Coordinate Software Division", "SE portfolio and tech health.", "/hq/software-engineering"));
  }
  if (/\bcompliance|policy|audit\b/i.test(lower)) {
    steps.push(step("compliance", "Coordinate compliance", "Deadlines and policy status.", "/hq/compliance"));
  }
  if (/\bemail|sms|announce|communication|notify\b/i.test(lower)) {
    steps.push(
      step("communications", "Stage communications", "Prepare message; Founder approval before send.", "/hq/communications", true)
    );
  }
  if (steps.length === 1) {
    steps.push(
      step("operations", "Route to Operations Center", "Create or update ops project/tasks as needed.", "/hq/operations"),
      step("workflow", "Check workflow queue", "Review pending approvals and scheduled jobs.", "/hq/workflows")
    );
  }
  steps.push(
    step("executive", "Present for Founder review", "Package recommendations and require approval for high-impact actions.", "/hq/enterprise-ops", true)
  );

  return {
    title: r.slice(0, 100) || "Enterprise operations run",
    steps,
    executiveSummary: `Coordinated ${steps.length} department steps. High-impact actions remain Founder-gated.`,
  };
}

export async function createOpsRun(opts: {
  request: string;
  actorEmail?: string;
  founderMode?: boolean;
}): Promise<OpsRun> {
  await ensureEnterpriseOps5Tables();
  const planned = planOpsRunFromRequest(opts.request);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const founderApprovalRequired = planned.steps.some((s) => s.founderApprovalRequired);
  const run: OpsRun = {
    id,
    title: planned.title,
    trigger: opts.request,
    status: founderApprovalRequired ? "awaiting_founder" : "draft",
    steps: planned.steps,
    executiveSummary: planned.executiveSummary,
    founderApprovalRequired,
    actorEmail: opts.actorEmail ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb();
  await db.run(
    `INSERT INTO aura_eo5_ops_runs (
      id, title, trigger_text, status, steps_json, executive_summary, founder_approval_required,
      actor_email, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    run.id,
    run.title,
    run.trigger,
    run.status,
    JSON.stringify(run.steps),
    run.executiveSummary,
    founderApprovalRequired ? 1 : 0,
    opts.actorEmail ?? null,
    now,
    now
  );

  await eo5Audit({
    action: "create_ops_run",
    entityType: "ops_run",
    entityId: id,
    detail: run.title,
    founderMode: opts.founderMode,
    actorEmail: opts.actorEmail,
  });

  return run;
}

export async function listOpsRuns(limit = 25): Promise<OpsRun[]> {
  await ensureEnterpriseOps5Tables();
  const db = await getDb();
  const rows = (await db.all(
    `SELECT * FROM aura_eo5_ops_runs ORDER BY created_at DESC LIMIT ?`,
    limit
  )) as Record<string, unknown>[];
  return rows.map(rowToOpsRun);
}

export async function getOpsRun(id: string): Promise<OpsRun | null> {
  await ensureEnterpriseOps5Tables();
  const db = await getDb();
  const row = (await db.get(`SELECT * FROM aura_eo5_ops_runs WHERE id = ?`, id)) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToOpsRun(row) : null;
}

function rowToOpsRun(row: Record<string, unknown>): OpsRun {
  let steps: OpsRunStep[] = [];
  try {
    steps = JSON.parse(String(row.steps_json || "[]"));
  } catch {
    steps = [];
  }
  return {
    id: String(row.id),
    title: String(row.title),
    trigger: String(row.trigger_text),
    status: String(row.status) as OpsRun["status"],
    steps,
    executiveSummary: String(row.executive_summary || ""),
    founderApprovalRequired: Number(row.founder_approval_required) === 1,
    actorEmail: row.actor_email ? String(row.actor_email) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function approveOpsRun(opts: {
  id: string;
  actorEmail?: string;
  founderMode?: boolean;
  note?: string;
}): Promise<{ ok: boolean; run?: OpsRun; error?: string }> {
  if (!opts.founderMode) return { ok: false, error: "Founder Mode required to approve ops runs." };
  await ensureEnterpriseOps5Tables();
  const db = await getDb();
  const existing = await getOpsRun(opts.id);
  if (!existing) return { ok: false, error: "Ops run not found" };
  const now = new Date().toISOString();
  const steps = existing.steps.map((s) => ({
    ...s,
    status: s.founderApprovalRequired ? ("ready" as const) : s.status === "prepared" ? ("ready" as const) : s.status,
  }));
  await db.run(
    `UPDATE aura_eo5_ops_runs SET
      status = 'active',
      founder_approved = 1,
      founder_approved_at = ?,
      founder_approved_by = ?,
      steps_json = ?,
      updated_at = ?
     WHERE id = ?`,
    now,
    opts.actorEmail ?? null,
    JSON.stringify(steps),
    now,
    opts.id
  );
  await eo5Audit({
    action: "approve_ops_run",
    entityType: "ops_run",
    entityId: opts.id,
    detail: opts.note || "Founder approved",
    founderMode: true,
    actorEmail: opts.actorEmail,
  });
  return { ok: true, run: await getOpsRun(opts.id) || undefined };
}

export async function prepareCadence(opts: {
  cadenceId: OpsCadenceId;
  actorEmail?: string;
  founderMode?: boolean;
}): Promise<{
  ok: boolean;
  cadence?: OpsCadence;
  package?: ExecutiveAutomationPackage;
  prepId?: string;
  error?: string;
}> {
  const cadence = EO5_CADENCES.find((c) => c.id === opts.cadenceId);
  if (!cadence) return { ok: false, error: "Unknown cadence" };
  if (!opts.founderMode) return { ok: false, error: "Founder Mode required to prepare enterprise cadences." };

  await ensureEnterpriseOps5Tables();
  const pack = await buildExecutiveAutomationPackage(cadence.automationKind);
  const id = crypto.randomUUID();
  const db = await getDb();
  await db.run(
    `INSERT INTO aura_eo5_cadence_preps (
      id, cadence_id, title, content, speech_summary, status, founder_approval_required, systems_json, actor_email, created_at
    ) VALUES (?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?)`,
    id,
    cadence.id,
    pack.title,
    pack.content,
    pack.speechSummary,
    JSON.stringify(pack.systemsUsed),
    opts.actorEmail ?? null,
    new Date().toISOString()
  );
  await eo5Audit({
    action: "prepare_cadence",
    entityType: "cadence_prep",
    entityId: id,
    detail: cadence.label,
    founderMode: true,
    actorEmail: opts.actorEmail,
  });
  return { ok: true, cadence, package: pack, prepId: id };
}

export async function buildContinuousImprovementItems(): Promise<ContinuousImprovementItem[]> {
  const items: ContinuousImprovementItem[] = [];
  try {
    const mc = await buildEnterpriseOsMissionControl();
    if ((mc.pendingApprovals || 0) > 5) {
      items.push({
        id: "ci-approvals",
        category: "bottleneck",
        title: "Approval queue backlog",
        evidence: `${mc.pendingApprovals} pending approvals in HQ.`,
        recommendation: "Clear Founder/workflow approvals in priority order; automate low-risk digests.",
        priority: "high",
        path: "/hq/workflows",
      });
    }
    if ((mc.compliance?.overdue || 0) > 0) {
      items.push({
        id: "ci-compliance",
        category: "process",
        title: "Overdue compliance items",
        evidence: `${mc.compliance.overdue} overdue compliance deadline(s).`,
        recommendation: "Assign owners and enable weekly compliance digest cadence.",
        priority: "high",
        path: "/hq/compliance",
      });
    }
    if (mc.softwareHealth?.deployAligned === false) {
      items.push({
        id: "ci-deploy",
        category: "technology",
        title: "GitHub ahead of Render",
        evidence: "Deploy alignment reports behind.",
        recommendation: "Manual Deploy latest main after Founder review; verify live commit.",
        priority: "high",
        path: "/hq/software-engineering",
      });
    }
  } catch {
    /* optional */
  }

  try {
    const wf = await import("./workforceFoundation").then((m) => m.buildWorkforceAnalytics());
    const capacity = wf.organizationalCapacity?.score;
    if (typeof capacity === "number" && capacity < 60) {
      items.push({
        id: "ci-capacity",
        category: "training",
        title: "Workforce capacity constrained",
        evidence: `Workforce capacity score ${capacity}.`,
        recommendation: "Review open requisitions and redistribute project load in Operations Center.",
        priority: "medium",
        path: "/hq/people?tab=workforce",
      });
    }
  } catch {
    /* optional */
  }

  items.push({
    id: "ci-cadence",
    category: "automation",
    title: "Expand Founder-gated cadences",
    evidence: "Enterprise Operations 5.0 supports weekly/monthly prepared packages.",
    recommendation: "Use Prepare Cadence for board packet and weekly exec report instead of manual assembly.",
    priority: "medium",
    path: "/hq/enterprise-ops",
  });

  return items.slice(0, 12);
}

export async function buildEnterpriseOperationsCommandCenter() {
  await ensureEnterpriseOps5Tables();

  const [mc, opsDash, goals, runs, improvements, seDash] = await Promise.all([
    buildEnterpriseOsMissionControl().catch(() => null),
    import("./executiveOperationsFoundation")
      .then((m) => m.buildExecutiveOperationsDashboard())
      .catch(() => null),
    import("./strategicGoalsEngine")
      .then((m) => m.listStrategicGoals())
      .catch(() => ({ goals: [] as Array<{ title: string; progressPercent?: number; status?: string }> })),
    listOpsRuns(10),
    buildContinuousImprovementItems(),
    import("./auraSoftwareEngineeringEngine")
      .then((m) => m.buildSoftwareEngineeringDashboard())
      .catch(() => null),
  ]);

  const goalList = (goals as { goals?: Array<Record<string, unknown>> })?.goals || [];
  const atRiskGoals = goalList.filter((g) => {
    const status = String(g.status || "");
    const pct = Number(g.progressPercent ?? g.progress_percent ?? 100);
    return status === "at_risk" || status === "behind" || pct < 40;
  });

  const opsDashAny = opsDash as Record<string, unknown> | null;
  const opsProjectCount =
    typeof opsDashAny?.activeProjects === "number"
      ? opsDashAny.activeProjects
      : Array.isArray(opsDashAny?.projects)
        ? opsDashAny.projects.length
        : 0;

  return {
    eoVersion: EO_VERSION,
    osVersion: OS_VERSION,
    brainVersion: BRAIN_VERSION,
    generatedAt: new Date().toISOString(),
    organizationHealth: mc?.organizationHealth ?? mc?.enterpriseHealthScore ?? null,
    enterpriseGrade: mc?.enterpriseGrade ?? null,
    strategicGoals: {
      total: goalList.length,
      atRisk: atRiskGoals.length,
      items: goalList.slice(0, 8).map((g) => ({
        title: String(g.title || ""),
        progressPercent: Number(g.progressPercent ?? g.progress_percent ?? 0),
        status: String(g.status || ""),
      })),
    },
    activeProjects: {
      count: opsProjectCount,
      source: "/hq/operations",
    },
    fundingPipeline: mc?.fundingPipeline ?? { pipelineValue: null, activeAwards: null },
    financialHealth: mc?.financialHealth ?? { cashFlow: null, financialHealthScore: null, budgetRemaining: null },
    hrStatus: mc?.hrStatus ?? "unknown",
    technologyStatus: {
      score: mc?.softwareHealth?.score ?? null,
      label: mc?.softwareHealth?.label ?? null,
      deployAligned: mc?.softwareHealth?.deployAligned ?? seDash?.github?.deploymentStatus === "aligned",
      seHostMode: seDash?.hostMode ?? "control_plane",
      unhealthyApps: Array.isArray(seDash?.apps) ? seDash.apps.filter((a: { healthy: boolean | null }) => a.healthy === false).length : 0,
    },
    compliance: mc?.compliance ?? { overdue: 0, dueNext14Days: 0 },
    criticalAlerts: (mc?.liveAlerts || []).filter((a) => a.severity === "critical" || a.severity === "high").slice(0, 10),
    founderApprovalsWaiting: mc?.pendingApprovals ?? 0,
    opsRuns: runs,
    cadences: EO5_CADENCES,
    continuousImprovement: improvements,
    deepLinks: [
      { label: "Enterprise OS 4.0", path: "/hq/enterprise-os" },
      { label: "Operations Center", path: "/hq/operations" },
      { label: "Mission Control", path: "/hq/phase10" },
      { label: "Workflows", path: "/hq/workflows" },
      { label: "Software Engineering", path: "/hq/software-engineering" },
      { label: "Board Portal", path: "/hq/board" },
      { label: "Grant Center", path: "/hq/grants" },
      { label: "Financial Center", path: "/hq/finance" },
    ],
    policy: {
      externalDistributionRequiresFounderApproval: true,
      highImpactRequiresFounderApproval: true,
    },
  };
}

export function wantsEnterpriseOperations5(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /\benterprise operations?\s*5(\.0)?\b/i.test(m)
    || /\b(prepare|build|assemble)\b.*\bboard (meeting|packet)\b/i.test(m)
    || /\bops run\b|\bcoordinate (all )?departments?\b/i.test(m)
    || /\benterprise (command|operations) (center|engine)\b/i.test(m)
    || /\bprepare (weekly|monthly)\b.*\b(report|packet|summary)\b/i.test(m)
    || /\bcontinuous improvement\b|\bresource (capacity|management)\b/i.test(m)
  );
}

export async function runEnterpriseOperations5(opts: {
  request: string;
  actorEmail?: string;
  founderMode?: boolean;
  channel?: string;
}): Promise<{
  eoVersion: typeof EO_VERSION;
  speechSummary: string;
  founderApprovalRequired: boolean;
  commandCenter?: Awaited<ReturnType<typeof buildEnterpriseOperationsCommandCenter>>;
  opsRun?: OpsRun;
  cadence?: Awaited<ReturnType<typeof prepareCadence>>;
  continuousImprovement?: ContinuousImprovementItem[];
}> {
  const request = opts.request.trim() || "Show Enterprise Operations Command Center";
  const founderMode = Boolean(opts.founderMode);

  if (/\bcommand center|organization health|show (enterprise )?ops\b/i.test(request) && !/\bprepare|create|coordinate\b/i.test(request)) {
    const commandCenter = await buildEnterpriseOperationsCommandCenter();
    return {
      eoVersion: EO_VERSION,
      speechSummary: `Enterprise Operations ${EO_VERSION}: health ${commandCenter.organizationHealth ?? "n/a"}, ${commandCenter.opsRuns.length} recent ops runs, ${commandCenter.founderApprovalsWaiting} approvals waiting.`,
      founderApprovalRequired: false,
      commandCenter,
    };
  }

  if (/\bcontinuous improvement|bottleneck|automation opportunit/i.test(request)) {
    const continuousImprovement = await buildContinuousImprovementItems();
    return {
      eoVersion: EO_VERSION,
      speechSummary: `Identified ${continuousImprovement.length} continuous-improvement recommendations from live HQ signals.`,
      founderApprovalRequired: false,
      continuousImprovement,
    };
  }

  if (/\b(weekly executive|monthly board|financial summary|compliance|grant status|technology (health|report))\b/i.test(request)) {
    let cadenceId: OpsCadenceId = "weekly_executive";
    if (/\bboard\b/i.test(request)) cadenceId = "monthly_board";
    else if (/\bfinancial\b/i.test(request)) cadenceId = "monthly_financial";
    else if (/\bcompliance\b/i.test(request)) cadenceId = "compliance_digest";
    else if (/\bgrant\b/i.test(request)) cadenceId = "grant_status";
    else if (/\btechnology|software|deploy\b/i.test(request)) cadenceId = "technology_health";
    const cadence = await prepareCadence({ cadenceId, actorEmail: opts.actorEmail, founderMode });
    return {
      eoVersion: EO_VERSION,
      speechSummary: cadence.ok
        ? `${cadence.package?.speechSummary || "Cadence prepared."} External distribution still requires Founder approval.`
        : cadence.error || "Could not prepare cadence.",
      founderApprovalRequired: true,
      cadence,
    };
  }

  // Default: create coordinated ops run
  if (!founderMode) {
    return {
      eoVersion: EO_VERSION,
      speechSummary: "Enterprise Operations 5.0 coordination requires Founder Mode to create ops runs.",
      founderApprovalRequired: true,
    };
  }
  const opsRun = await createOpsRun({
    request,
    actorEmail: opts.actorEmail,
    founderMode,
  });
  return {
    eoVersion: EO_VERSION,
    speechSummary: `${opsRun.executiveSummary} Ops run ${opsRun.id.slice(0, 8)} created with ${opsRun.steps.length} department steps.`,
    founderApprovalRequired: opsRun.founderApprovalRequired,
    opsRun,
  };
}
