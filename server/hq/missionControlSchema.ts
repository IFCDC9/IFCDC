import { getDb } from "../db";
import crypto from "crypto";

export type MissionStatus = "planning" | "active" | "at_risk" | "complete";
export type ObjectiveType = "annual" | "quarterly" | "department_milestone";
export type MissionTaskStatus = "pending" | "in_progress" | "approved" | "rejected" | "completed";
export type FounderDecisionStatus = "pending" | "approved" | "rejected";

export function missionId() {
  return crypto.randomUUID();
}

export async function ensureMissionControlTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_missions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'planning',
      priority TEXT NOT NULL DEFAULT 'medium',
      owner_email TEXT,
      department TEXT,
      target_date TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_by_email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_missions_status ON hq_missions(status);
    CREATE INDEX IF NOT EXISTS idx_hq_missions_target ON hq_missions(target_date);

    CREATE TABLE IF NOT EXISTS hq_mission_timeline_events (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'update',
      title TEXT NOT NULL,
      detail TEXT,
      occurred_at TEXT NOT NULL,
      created_by_email TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_mission_timeline_mission ON hq_mission_timeline_events(mission_id);

    CREATE TABLE IF NOT EXISTS hq_strategic_objectives (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      objective_type TEXT NOT NULL DEFAULT 'quarterly',
      department TEXT,
      fiscal_year INTEGER,
      quarter INTEGER,
      target_kpi TEXT,
      current_value REAL DEFAULT 0,
      target_value REAL DEFAULT 0,
      progress_pct REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      owner_email TEXT,
      due_date TEXT,
      mission_id TEXT,
      created_by_email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_objectives_type ON hq_strategic_objectives(objective_type);
    CREATE INDEX IF NOT EXISTS idx_hq_objectives_status ON hq_strategic_objectives(status);

    CREATE TABLE IF NOT EXISTS hq_mission_tasks (
      id TEXT PRIMARY KEY,
      mission_id TEXT,
      objective_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      owner_email TEXT,
      assigned_by_email TEXT,
      due_date TEXT,
      approved_by_email TEXT,
      rejected_by_email TEXT,
      rejection_reason TEXT,
      created_by_email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hq_mission_tasks_status ON hq_mission_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_hq_mission_tasks_owner ON hq_mission_tasks(owner_email);
    CREATE INDEX IF NOT EXISTS idx_hq_mission_tasks_due ON hq_mission_tasks(due_date);

    CREATE TABLE IF NOT EXISTS hq_mission_task_dependencies (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(task_id, depends_on_task_id)
    );

    CREATE TABLE IF NOT EXISTS hq_mission_task_history (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      actor_email TEXT,
      action TEXT NOT NULL,
      previous_value TEXT,
      new_value TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_mission_task_history_task ON hq_mission_task_history(task_id);

    CREATE TABLE IF NOT EXISTS hq_founder_decisions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      decision_type TEXT NOT NULL DEFAULT 'approval',
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      related_entity_type TEXT,
      related_entity_id TEXT,
      decided_by_email TEXT,
      decision_note TEXT,
      created_by_email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_founder_decisions_status ON hq_founder_decisions(status);

    CREATE TABLE IF NOT EXISTS hq_executive_notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author_email TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'executive',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
