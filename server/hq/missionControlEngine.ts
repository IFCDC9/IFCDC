/**
 * Mission Control — operational command center engine (CRUD + live aggregates).
 */
import crypto from "crypto";
import { getDb } from "../db";
import { logHqAudit, queryHqAudit } from "./hqAuditLog";
import {
  ensureMissionControlTables,
  missionId,
  type MissionStatus,
  type ObjectiveType,
  type MissionTaskStatus,
} from "./missionControlSchema";
import { buildOrganizationHealthScore } from "./analyticsReporting";
import { buildExecutiveTaskHub } from "./executiveTaskHub";
import { buildDivisionIntegrationOverview } from "./divisionIntegrationLayer";
import { buildApprovalQueue } from "./enterpriseApprovals";
import { getOrGenerateDailyBriefing } from "./executiveBriefings";
import { generateStrategicRecommendations, buildExecutiveScorecard } from "./executiveIntelligenceEngine";
import { buildPredictiveDashboard } from "./phase9OperatingSystem";
import { predictFinancialRisk } from "./auraExecutiveOps";

const MISSION_ENTITY_TYPES = [
  "hq_mission",
  "hq_strategic_objective",
  "hq_mission_task",
  "hq_founder_decision",
  "hq_executive_note",
];

async function recordTaskHistory(
  taskId: string,
  actorEmail: string | undefined,
  action: string,
  previousValue: string | null,
  newValue: string | null,
  detail?: string
) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO hq_mission_task_history (id, task_id, actor_email, action, previous_value, new_value, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    missionId(),
    taskId,
    actorEmail ?? null,
    action,
    previousValue,
    newValue,
    detail ?? null,
    now
  );
}

async function auditWrite(
  actor: { id?: string; email?: string },
  action: string,
  entityType: string,
  entityId: string,
  detail: string,
  metadata?: { previousValue?: unknown; newValue?: unknown }
) {
  await logHqAudit({
    action,
    entityType,
    entityId,
    detail,
    actorId: actor.id,
    actorEmail: actor.email,
    metadata: metadata
      ? {
          previous_value: metadata.previousValue,
          new_value: metadata.newValue,
        }
      : undefined,
  });
}

// ─── Missions ───────────────────────────────────────────────────────────────

export async function listMissions(filters?: { status?: MissionStatus }) {
  await ensureMissionControlTables();
  const db = await getDb();
  let sql = "SELECT * FROM hq_missions";
  const params: unknown[] = [];
  if (filters?.status) {
    sql += " WHERE status = ?";
    params.push(filters.status);
  }
  sql += " ORDER BY CASE status WHEN 'at_risk' THEN 0 WHEN 'active' THEN 1 WHEN 'planning' THEN 2 ELSE 3 END, target_date ASC";
  return db.all(sql, ...params);
}

export async function createMission(
  input: {
    title: string;
    description?: string;
    status?: MissionStatus;
    priority?: string;
    ownerEmail?: string;
    department?: string;
    targetDate?: string;
  },
  actor: { id?: string; email?: string }
) {
  await ensureMissionControlTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = missionId();
  const status = input.status ?? "planning";
  await db.run(
    `INSERT INTO hq_missions (id, title, description, status, priority, owner_email, department, target_date, started_at, created_by_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.title.trim(),
    input.description ?? null,
    status,
    input.priority ?? "medium",
    input.ownerEmail ?? null,
    input.department ?? null,
    input.targetDate ?? null,
    status === "active" ? now : null,
    actor.email ?? null,
    now,
    now
  );
  await db.run(
    `INSERT INTO hq_mission_timeline_events (id, mission_id, event_type, title, detail, occurred_at, created_by_email, created_at)
     VALUES (?, ?, 'created', ?, ?, ?, ?, ?)`,
    missionId(),
    id,
    "Mission created",
    input.title,
    now,
    actor.email ?? null,
    now
  );
  await auditWrite(actor, "mission.create", "hq_mission", id, `Created mission: ${input.title}`, {
    newValue: input,
  });
  return db.get("SELECT * FROM hq_missions WHERE id = ?", id);
}

export async function updateMission(
  id: string,
  input: Partial<{
    title: string;
    description: string;
    status: MissionStatus;
    priority: string;
    ownerEmail: string;
    department: string;
    targetDate: string;
  }>,
  actor: { id?: string; email?: string }
) {
  await ensureMissionControlTables();
  const db = await getDb();
  const prev = await db.get<Record<string, unknown>>("SELECT * FROM hq_missions WHERE id = ?", id);
  if (!prev) return null;
  const now = new Date().toISOString();
  const status = (input.status ?? prev.status) as string;
  await db.run(
    `UPDATE hq_missions SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      status = COALESCE(?, status),
      priority = COALESCE(?, priority),
      owner_email = COALESCE(?, owner_email),
      department = COALESCE(?, department),
      target_date = COALESCE(?, target_date),
      started_at = CASE WHEN ? = 'active' AND started_at IS NULL THEN ? ELSE started_at END,
      completed_at = CASE WHEN ? = 'complete' THEN ? ELSE completed_at END,
      updated_at = ?
     WHERE id = ?`,
    input.title ?? null,
    input.description ?? null,
    input.status ?? null,
    input.priority ?? null,
    input.ownerEmail ?? null,
    input.department ?? null,
    input.targetDate ?? null,
    status,
    now,
    status,
    now,
    now,
    id
  );
  if (input.status && input.status !== prev.status) {
    await db.run(
      `INSERT INTO hq_mission_timeline_events (id, mission_id, event_type, title, detail, occurred_at, created_by_email, created_at)
       VALUES (?, ?, 'status_change', ?, ?, ?, ?, ?)`,
      missionId(),
      id,
      `Status → ${input.status}`,
      String(prev.status),
      now,
      actor.email ?? null,
      now
    );
  }
  const next = await db.get("SELECT * FROM hq_missions WHERE id = ?", id);
  await auditWrite(actor, "mission.update", "hq_mission", id, `Updated mission`, {
    previousValue: prev,
    newValue: next,
  });
  return next;
}

export async function deleteMission(id: string, actor: { id?: string; email?: string }) {
  await ensureMissionControlTables();
  const db = await getDb();
  const prev = await db.get("SELECT * FROM hq_missions WHERE id = ?", id);
  if (!prev) return { ok: false };
  await db.run("DELETE FROM hq_mission_timeline_events WHERE mission_id = ?", id);
  await db.run("DELETE FROM hq_missions WHERE id = ?", id);
  await auditWrite(actor, "mission.delete", "hq_mission", id, "Deleted mission", { previousValue: prev });
  return { ok: true };
}

export async function listMissionTimeline(missionId: string) {
  await ensureMissionControlTables();
  const db = await getDb();
  return db.all(
    "SELECT * FROM hq_mission_timeline_events WHERE mission_id = ? ORDER BY occurred_at DESC",
    missionId
  );
}

export async function addMissionTimelineEvent(
  missionId: string,
  input: { title: string; detail?: string; eventType?: string; occurredAt?: string },
  actor: { id?: string; email?: string }
) {
  await ensureMissionControlTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  await db.run(
    `INSERT INTO hq_mission_timeline_events (id, mission_id, event_type, title, detail, occurred_at, created_by_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    eventId,
    missionId,
    input.eventType ?? "update",
    input.title,
    input.detail ?? null,
    input.occurredAt ?? now,
    actor.email ?? null,
    now
  );
  await auditWrite(actor, "mission.timeline", "hq_mission", missionId, input.title);
  return db.get("SELECT * FROM hq_mission_timeline_events WHERE id = ?", eventId);
}

// ─── Strategic objectives ───────────────────────────────────────────────────

export async function listObjectives(filters?: { objectiveType?: ObjectiveType; status?: string }) {
  await ensureMissionControlTables();
  const db = await getDb();
  let sql = "SELECT * FROM hq_strategic_objectives WHERE 1=1";
  const params: unknown[] = [];
  if (filters?.objectiveType) {
    sql += " AND objective_type = ?";
    params.push(filters.objectiveType);
  }
  if (filters?.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }
  sql += " ORDER BY due_date ASC, progress_pct DESC";
  return db.all(sql, ...params);
}

export async function createObjective(
  input: {
    title: string;
    description?: string;
    objectiveType?: ObjectiveType;
    department?: string;
    fiscalYear?: number;
    quarter?: number;
    targetKpi?: string;
    currentValue?: number;
    targetValue?: number;
    ownerEmail?: string;
    dueDate?: string;
    missionId?: string;
  },
  actor: { id?: string; email?: string }
) {
  await ensureMissionControlTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = missionId();
  const target = input.targetValue ?? 0;
  const current = input.currentValue ?? 0;
  const progress = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  await db.run(
    `INSERT INTO hq_strategic_objectives
     (id, title, description, objective_type, department, fiscal_year, quarter, target_kpi, current_value, target_value, progress_pct, owner_email, due_date, mission_id, created_by_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.title.trim(),
    input.description ?? null,
    input.objectiveType ?? "quarterly",
    input.department ?? null,
    input.fiscalYear ?? new Date().getFullYear(),
    input.quarter ?? Math.ceil((new Date().getMonth() + 1) / 3),
    input.targetKpi ?? null,
    current,
    target,
    progress,
    input.ownerEmail ?? null,
    input.dueDate ?? null,
    input.missionId ?? null,
    actor.email ?? null,
    now,
    now
  );
  await auditWrite(actor, "objective.create", "hq_strategic_objective", id, input.title, { newValue: input });
  return db.get("SELECT * FROM hq_strategic_objectives WHERE id = ?", id);
}

export async function updateObjective(
  id: string,
  input: Partial<{
    title: string;
    description: string;
    currentValue: number;
    targetValue: number;
    status: string;
    ownerEmail: string;
    dueDate: string;
    progressPct: number;
  }>,
  actor: { id?: string; email?: string }
) {
  await ensureMissionControlTables();
  const db = await getDb();
  const prev = await db.get<Record<string, unknown>>("SELECT * FROM hq_strategic_objectives WHERE id = ?", id);
  if (!prev) return null;
  const now = new Date().toISOString();
  const current = input.currentValue ?? (prev.current_value as number);
  const target = input.targetValue ?? (prev.target_value as number);
  const progress =
    input.progressPct ??
    (target > 0 ? Math.min(100, Math.round((current / target) * 100)) : (prev.progress_pct as number));
  await db.run(
    `UPDATE hq_strategic_objectives SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      current_value = COALESCE(?, current_value),
      target_value = COALESCE(?, target_value),
      progress_pct = ?,
      status = COALESCE(?, status),
      owner_email = COALESCE(?, owner_email),
      due_date = COALESCE(?, due_date),
      updated_at = ?
     WHERE id = ?`,
    input.title ?? null,
    input.description ?? null,
    input.currentValue ?? null,
    input.targetValue ?? null,
    progress,
    input.status ?? null,
    input.ownerEmail ?? null,
    input.dueDate ?? null,
    now,
    id
  );
  const next = await db.get("SELECT * FROM hq_strategic_objectives WHERE id = ?", id);
  await auditWrite(actor, "objective.update", "hq_strategic_objective", id, "Updated objective", {
    previousValue: prev,
    newValue: next,
  });
  return next;
}

export async function deleteObjective(id: string, actor: { id?: string; email?: string }) {
  await ensureMissionControlTables();
  const db = await getDb();
  const prev = await db.get("SELECT * FROM hq_strategic_objectives WHERE id = ?", id);
  if (!prev) return { ok: false };
  await db.run("DELETE FROM hq_strategic_objectives WHERE id = ?", id);
  await auditWrite(actor, "objective.delete", "hq_strategic_objective", id, "Deleted objective", {
    previousValue: prev,
  });
  return { ok: true };
}

// ─── Mission tasks ──────────────────────────────────────────────────────────

export async function listMissionTasks(filters?: { status?: MissionTaskStatus; missionId?: string }) {
  await ensureMissionControlTables();
  const db = await getDb();
  let sql = "SELECT * FROM hq_mission_tasks WHERE 1=1";
  const params: unknown[] = [];
  if (filters?.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }
  if (filters?.missionId) {
    sql += " AND mission_id = ?";
    params.push(filters.missionId);
  }
  sql += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, due_date ASC";
  const tasks = await db.all(sql, ...params);
  const withDeps = await Promise.all(
    tasks.map(async (t: { id: string }) => {
      const deps = await db.all(
        `SELECT d.depends_on_task_id, t.title FROM hq_mission_task_dependencies d
         JOIN hq_mission_tasks t ON t.id = d.depends_on_task_id WHERE d.task_id = ?`,
        t.id
      );
      return { ...t, dependencies: deps };
    })
  );
  return withDeps;
}

export async function createMissionTask(
  input: {
    title: string;
    description?: string;
    missionId?: string;
    objectiveId?: string;
    priority?: string;
    ownerEmail?: string;
    dueDate?: string;
    dependsOnTaskIds?: string[];
  },
  actor: { id?: string; email?: string }
) {
  await ensureMissionControlTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = missionId();
  await db.run(
    `INSERT INTO hq_mission_tasks
     (id, mission_id, objective_id, title, description, status, priority, owner_email, assigned_by_email, due_date, created_by_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.missionId ?? null,
    input.objectiveId ?? null,
    input.title.trim(),
    input.description ?? null,
    input.priority ?? "medium",
    input.ownerEmail ?? null,
    actor.email ?? null,
    input.dueDate ?? null,
    actor.email ?? null,
    now,
    now
  );
  for (const depId of input.dependsOnTaskIds ?? []) {
    await db.run(
      `INSERT OR IGNORE INTO hq_mission_task_dependencies (id, task_id, depends_on_task_id, created_at) VALUES (?, ?, ?, ?)`,
      missionId(),
      id,
      depId,
      now
    );
  }
  await recordTaskHistory(id, actor.email, "created", null, "pending", input.title);
  await auditWrite(actor, "task.create", "hq_mission_task", id, input.title, { newValue: input });
  return (await listMissionTasks()).find((t: { id: string }) => t.id === id);
}

export async function updateMissionTask(
  id: string,
  input: Partial<{
    title: string;
    description: string;
    status: MissionTaskStatus;
    priority: string;
    ownerEmail: string;
    dueDate: string;
  }>,
  actor: { id?: string; email?: string }
) {
  await ensureMissionControlTables();
  const db = await getDb();
  const prev = await db.get<Record<string, unknown>>("SELECT * FROM hq_mission_tasks WHERE id = ?", id);
  if (!prev) return null;
  const now = new Date().toISOString();
  await db.run(
    `UPDATE hq_mission_tasks SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      status = COALESCE(?, status),
      priority = COALESCE(?, priority),
      owner_email = COALESCE(?, owner_email),
      due_date = COALESCE(?, due_date),
      updated_at = ?,
      completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END
     WHERE id = ?`,
    input.title ?? null,
    input.description ?? null,
    input.status ?? null,
    input.priority ?? null,
    input.ownerEmail ?? null,
    input.dueDate ?? null,
    now,
    input.status ?? null,
    now,
    id
  );
  if (input.status && input.status !== prev.status) {
    await recordTaskHistory(id, actor.email, "status_change", String(prev.status), input.status);
  }
  const next = await db.get("SELECT * FROM hq_mission_tasks WHERE id = ?", id);
  await auditWrite(actor, "task.update", "hq_mission_task", id, "Updated task", { previousValue: prev, newValue: next });
  return next;
}

export async function approveMissionTask(id: string, actor: { id?: string; email?: string }) {
  return updateMissionTask(id, { status: "approved" }, actor).then(async (task) => {
    if (!task) return null;
    const db = await getDb();
    await db.run(
      "UPDATE hq_mission_tasks SET approved_by_email = ?, rejected_by_email = NULL, rejection_reason = NULL WHERE id = ?",
      actor.email ?? null,
      id
    );
    await recordTaskHistory(id, actor.email, "approved", "pending", "approved");
    await auditWrite(actor, "task.approve", "hq_mission_task", id, "Task approved");
    return db.get("SELECT * FROM hq_mission_tasks WHERE id = ?", id);
  });
}

export async function rejectMissionTask(
  id: string,
  reason: string,
  actor: { id?: string; email?: string }
) {
  const db = await getDb();
  const prev = await db.get<Record<string, unknown>>("SELECT * FROM hq_mission_tasks WHERE id = ?", id);
  if (!prev) return null;
  const now = new Date().toISOString();
  await db.run(
    `UPDATE hq_mission_tasks SET status = 'rejected', rejected_by_email = ?, rejection_reason = ?, updated_at = ? WHERE id = ?`,
    actor.email ?? null,
    reason,
    now,
    id
  );
  await recordTaskHistory(id, actor.email, "rejected", String(prev.status), "rejected", reason);
  await auditWrite(actor, "task.reject", "hq_mission_task", id, reason, { previousValue: prev });
  return db.get("SELECT * FROM hq_mission_tasks WHERE id = ?", id);
}

export async function getTaskHistory(taskId: string) {
  await ensureMissionControlTables();
  const db = await getDb();
  return db.all(
    "SELECT * FROM hq_mission_task_history WHERE task_id = ? ORDER BY created_at DESC",
    taskId
  );
}

// ─── Founder decisions & notes ──────────────────────────────────────────────

export async function listFounderDecisions(status?: string) {
  await ensureMissionControlTables();
  const db = await getDb();
  let sql = "SELECT * FROM hq_founder_decisions";
  const params: unknown[] = [];
  if (status) {
    sql += " WHERE status = ?";
    params.push(status);
  }
  sql += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at DESC";
  return db.all(sql, ...params);
}

export async function createFounderDecision(
  input: {
    title: string;
    description?: string;
    decisionType?: string;
    priority?: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  },
  actor: { id?: string; email?: string }
) {
  await ensureMissionControlTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = missionId();
  await db.run(
    `INSERT INTO hq_founder_decisions (id, title, description, decision_type, status, priority, related_entity_type, related_entity_id, created_by_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    id,
    input.title.trim(),
    input.description ?? null,
    input.decisionType ?? "approval",
    input.priority ?? "medium",
    input.relatedEntityType ?? null,
    input.relatedEntityId ?? null,
    actor.email ?? null,
    now,
    now
  );
  await auditWrite(actor, "decision.create", "hq_founder_decision", id, input.title, { newValue: input });
  return db.get("SELECT * FROM hq_founder_decisions WHERE id = ?", id);
}

export async function decideFounderDecision(
  id: string,
  decision: "approved" | "rejected",
  note: string | undefined,
  actor: { id?: string; email?: string }
) {
  await ensureMissionControlTables();
  const db = await getDb();
  const prev = await db.get<Record<string, unknown>>("SELECT * FROM hq_founder_decisions WHERE id = ?", id);
  if (!prev) return null;
  const now = new Date().toISOString();
  await db.run(
    `UPDATE hq_founder_decisions SET status = ?, decided_by_email = ?, decision_note = ?, updated_at = ? WHERE id = ?`,
    decision,
    actor.email ?? null,
    note ?? null,
    now,
    id
  );
  const next = await db.get("SELECT * FROM hq_founder_decisions WHERE id = ?", id);
  await auditWrite(actor, `decision.${decision}`, "hq_founder_decision", id, note ?? decision, {
    previousValue: prev,
    newValue: next,
  });
  return next;
}

export async function listExecutiveNotes() {
  await ensureMissionControlTables();
  const db = await getDb();
  return db.all("SELECT * FROM hq_executive_notes ORDER BY pinned DESC, updated_at DESC");
}

export async function createExecutiveNote(
  input: { title: string; body: string; visibility?: string; pinned?: boolean },
  actor: { id?: string; email?: string }
) {
  await ensureMissionControlTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = missionId();
  await db.run(
    `INSERT INTO hq_executive_notes (id, title, body, author_email, visibility, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.title.trim(),
    input.body,
    actor.email ?? "system",
    input.visibility ?? "executive",
    input.pinned ? 1 : 0,
    now,
    now
  );
  await auditWrite(actor, "note.create", "hq_executive_note", id, input.title, { newValue: input });
  return db.get("SELECT * FROM hq_executive_notes WHERE id = ?", id);
}

// ─── Command center aggregate ───────────────────────────────────────────────

const DIVISION_MODULES = [
  { key: "grants", label: "Grant Center", path: "/hq/grants" },
  { key: "finance", label: "Financial Center", path: "/hq/finance" },
  { key: "operations", label: "Operations Center", path: "/hq/operations" },
  { key: "communications", label: "Communications", path: "/hq/communications" },
  { key: "people", label: "People Management", path: "/hq/people" },
  { key: "software_division", label: "Software Division", path: "/hq/software" },
  { key: "aura", label: "AURA", path: "/hq/aura" },
  { key: "integrations", label: "Integrations Hub", path: "/hq/integrations" },
];

const MC_AGGREGATE_TIMEOUT_MS = 15_000;

function mcTimeout<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
  return Promise.race([
    promise.catch((err) => {
      console.warn(`[mission-control] ${label} failed:`, err instanceof Error ? err.message : err);
      return fallback;
    }),
    new Promise<T>((resolve) => setTimeout(() => {
      console.warn(`[mission-control] ${label} timed out after ${MC_AGGREGATE_TIMEOUT_MS}ms`);
      resolve(fallback);
    }, MC_AGGREGATE_TIMEOUT_MS)),
  ]);
}

/** Safe empty payload when aggregate build fails — always valid JSON for the client. */
export function emptyMissionControlCommandCenter() {
  return {
    executiveDashboard: {
      organizationHealth: { overall: 0, grade: "—" },
      activePriorities: [] as { action: string; priority: string }[],
      criticalAlerts: [] as { type: string; title: string; severity: string; path?: string; id: string }[],
      scorecard: null,
      dailyBriefing: null,
    },
    missionOperations: {
      missions: [] as unknown[],
      byStatus: { planning: [], active: [], at_risk: [], complete: [] },
      upcoming: [] as unknown[],
      completed: [] as unknown[],
      timeline: [] as { missionId: string; missionTitle: string; events: unknown[] }[],
    },
    strategicObjectives: {
      objectives: [] as unknown[],
      byType: { annual: [], quarterly: [], department_milestone: [] },
      avgProgress: 0,
    },
    taskCommandCenter: {
      missionTasks: [] as unknown[],
      executiveTasks: [] as unknown[],
      counts: { missionPending: 0, missionApproved: 0, executivePending: 0 },
    },
    crossDivision: {
      modules: DIVISION_MODULES.map((mod) => ({
        ...mod,
        healthy: true,
        status: "connected",
        alerts: 0,
      })),
      divisions: [] as unknown[],
    },
    founderPanel: {
      pendingDecisions: [] as unknown[],
      approvalQueue: [] as unknown[],
      executiveNotes: [] as unknown[],
      emergencyOverrides: [] as unknown[],
    },
    missionIntelligence: {
      predictive: null,
      financialRisk: null,
      recommendations: [] as unknown[],
      bottlenecks: [] as unknown[],
      opportunities: [] as unknown[],
    },
    auditHistory: {
      entries: [] as unknown[],
      entityTypes: MISSION_ENTITY_TYPES,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function buildMissionControlCommandCenterSafe(role: string) {
  try {
    return await mcTimeout(
      buildMissionControlCommandCenter(role),
      emptyMissionControlCommandCenter() as Awaited<ReturnType<typeof buildMissionControlCommandCenter>>,
      "aggregate"
    );
  } catch (err) {
    console.error("[mission-control] aggregate error:", err);
    return emptyMissionControlCommandCenter() as Awaited<ReturnType<typeof buildMissionControlCommandCenter>>;
  }
}

export async function buildMissionControlCommandCenter(_role: string) {
  await ensureMissionControlTables();

  const [
    health,
    missions,
    objectives,
    missionTasks,
    executiveTasks,
    divisions,
    approvals,
    briefing,
    scorecard,
    recommendations,
    predictive,
    financialRisk,
    decisions,
    notes,
    auditEntries,
  ] = await Promise.all([
    buildOrganizationHealthScore().catch(() => ({ overall: 0, grade: "—" })),
    listMissions().catch(() => []),
    listObjectives().catch(() => []),
    listMissionTasks().catch(() => []),
    buildExecutiveTaskHub(40).catch(() => ({ tasks: [], counts: { total: 0 } })),
    buildDivisionIntegrationOverview().catch(() => ({ divisions: [] })),
    buildApprovalQueue(20).catch(() => ({ tasks: [] })),
    getOrGenerateDailyBriefing().catch(() => null),
    buildExecutiveScorecard().catch(() => null),
    generateStrategicRecommendations().catch(() => ({ recommendations: [] })),
    buildPredictiveDashboard().catch(() => null),
    predictFinancialRisk().catch(() => null),
    listFounderDecisions("pending").catch(() => []),
    listExecutiveNotes().catch(() => []),
    queryHqAudit({ limit: 50 }).catch(() => []),
  ]);

  const missionsByStatus = {
    planning: missions.filter((m: { status: string }) => m.status === "planning"),
    active: missions.filter((m: { status: string }) => m.status === "active"),
    at_risk: missions.filter((m: { status: string }) => m.status === "at_risk"),
    complete: missions.filter((m: { status: string }) => m.status === "complete"),
  };

  const upcomingMissions = missions.filter(
    (m: { status: string; target_date?: string }) =>
      m.status !== "complete" && m.target_date && new Date(m.target_date) >= new Date()
  );

  const criticalAlerts = [
    ...missionsByStatus.at_risk.map((m: { title: string; id: string }) => ({
      type: "mission_at_risk",
      title: m.title,
      severity: "high",
      path: "/hq/phase10",
      id: m.id,
    })),
    ...(executiveTasks.tasks ?? [])
      .filter((t: { priority: string }) => t.priority === "high")
      .slice(0, 5)
      .map((t: { title: string; path: string | null; id: string }) => ({
        type: "executive_task",
        title: t.title,
        severity: "high",
        path: t.path ?? "/hq/workflows",
        id: t.id,
      })),
  ];

  const divisionMap = Object.fromEntries(
    (divisions.divisions ?? []).map((d: { id: string; name: string; healthy: boolean; status: string }) => [
      d.id,
      d,
    ])
  );

  const crossDivision = DIVISION_MODULES.map((mod) => {
    const div =
      divisionMap[mod.key] ??
      divisionMap[mod.key.replace("_", "")] ??
      null;
    return {
      ...mod,
      healthy: div?.healthy ?? true,
      status: div?.status ?? "connected",
      alerts: div ? (div.healthy ? 0 : 1) : 0,
    };
  });

  const objectivesByType = {
    annual: objectives.filter((o: { objective_type: string }) => o.objective_type === "annual"),
    quarterly: objectives.filter((o: { objective_type: string }) => o.objective_type === "quarterly"),
    department_milestone: objectives.filter(
      (o: { objective_type: string }) => o.objective_type === "department_milestone"
    ),
  };

  const missionAudit = (auditEntries as Record<string, unknown>[]).filter((e) =>
    MISSION_ENTITY_TYPES.includes(String(e.entity_type))
  );

  return {
    executiveDashboard: {
      organizationHealth: health,
      activePriorities: (recommendations as { recommendations?: { action: string; priority: string }[] })
        .recommendations?.slice(0, 6) ?? [],
      criticalAlerts,
      scorecard: scorecard ?? null,
      dailyBriefing: briefing,
    },
    missionOperations: {
      missions,
      byStatus: missionsByStatus,
      upcoming: upcomingMissions,
      completed: missionsByStatus.complete,
      timeline: await Promise.all(
        missions.slice(0, 3).map(async (m: { id: string; title: string }) => ({
          missionId: m.id,
          missionTitle: m.title,
          events: await listMissionTimeline(m.id).catch(() => []),
        }))
      ),
    },
    strategicObjectives: {
      objectives,
      byType: objectivesByType,
      avgProgress:
        objectives.length > 0
          ? Math.round(
              objectives.reduce((s: number, o: { progress_pct: number }) => s + (o.progress_pct ?? 0), 0) /
                objectives.length
            )
          : 0,
    },
    taskCommandCenter: {
      missionTasks,
      executiveTasks: executiveTasks.tasks ?? [],
      counts: {
        missionPending: (missionTasks as { status?: string }[]).filter((t) => t.status === "pending").length,
        missionApproved: (missionTasks as { status?: string }[]).filter((t) => t.status === "approved").length,
        executivePending: executiveTasks.counts?.total ?? 0,
      },
    },
    crossDivision: { modules: crossDivision, divisions: divisions.divisions ?? [] },
    founderPanel: {
      pendingDecisions: decisions,
      approvalQueue: approvals.tasks ?? [],
      executiveNotes: notes.filter((n: { pinned: number }) => n.pinned).slice(0, 5),
      emergencyOverrides: decisions.filter(
        (d: { decision_type: string; status: string }) => d.decision_type === "override" && d.status === "pending"
      ),
    },
    missionIntelligence: {
      predictive,
      financialRisk,
      recommendations: (recommendations as { recommendations?: unknown[] }).recommendations ?? [],
      bottlenecks: (missionTasks as { status?: string; due_date?: string }[]).filter(
        (t) => t.status === "pending" && !!t.due_date && new Date(t.due_date) < new Date()
      ),
      opportunities: objectives.filter((o: { progress_pct: number }) => (o.progress_pct ?? 0) >= 75),
    },
    auditHistory: {
      entries: missionAudit,
      entityTypes: MISSION_ENTITY_TYPES,
    },
    generatedAt: new Date().toISOString(),
  };
}
