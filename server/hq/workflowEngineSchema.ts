import { getDb } from "../db";
import crypto from "crypto";

export function workflowId() {
  return crypto.randomUUID();
}

export const WORKFLOW_DEFINITIONS = [
  { key: "expense_approval", name: "Expense Approval", trigger_type: "event", description: "Route pending expenses to executives" },
  { key: "leave_approval", name: "Leave Request Approval", trigger_type: "event", description: "HR leave request workflow" },
  { key: "grant_deadline_reminder", name: "Grant Deadline Reminder", trigger_type: "scheduled", description: "Notify before grant deadlines" },
  { key: "compliance_reminder", name: "Compliance Reminder", trigger_type: "scheduled", description: "Grant compliance report reminders" },
  { key: "employee_onboarding", name: "Employee Onboarding", trigger_type: "event", description: "8-step onboarding checklist" },
  { key: "board_approval", name: "Board Approval", trigger_type: "event", description: "Board resolution and packet approvals" },
  { key: "scheduled_report", name: "Scheduled Executive Report", trigger_type: "scheduled", description: "Daily/weekly executive report generation" },
  { key: "document_approval", name: "Document Approval", trigger_type: "event", description: "Document review and e-sign workflow" },
] as const;

export async function ensureWorkflowTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_workflow_definitions (
      id TEXT PRIMARY KEY,
      workflow_key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      description TEXT,
      config_json TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_workflow_instances (
      id TEXT PRIMARY KEY,
      workflow_key TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      entity_type TEXT,
      entity_id TEXT,
      title TEXT NOT NULL,
      assigned_to TEXT,
      priority TEXT DEFAULT 'normal',
      payload_json TEXT,
      due_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_instances_status ON hq_workflow_instances(status);
    CREATE INDEX IF NOT EXISTS idx_workflow_instances_key ON hq_workflow_instances(workflow_key);

    CREATE TABLE IF NOT EXISTS hq_scheduled_jobs (
      id TEXT PRIMARY KEY,
      job_key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      schedule_expr TEXT NOT NULL,
      last_run_at TEXT,
      next_run_at TEXT,
      last_run_status TEXT,
      last_error TEXT,
      source_module TEXT,
      config_json TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  for (const col of ["last_run_status TEXT", "last_error TEXT", "source_module TEXT"]) {
    try {
      await db.exec(`ALTER TABLE hq_scheduled_jobs ADD COLUMN ${col}`);
    } catch {
      /* exists */
    }
  }

  const now = new Date().toISOString();
  for (const def of WORKFLOW_DEFINITIONS) {
    const exists = await db.get("SELECT id FROM hq_workflow_definitions WHERE workflow_key = ?", def.key);
    if (!exists) {
      await db.run(
        `INSERT INTO hq_workflow_definitions (id, workflow_key, name, trigger_type, description, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        workflowId(), def.key, def.name, def.trigger_type, def.description, now, now
      );
    }
  }

  const jobs = [
    { key: "grant_deadlines", name: "Grant Deadline Notifications", schedule: "daily", module: "grants" },
    { key: "compliance_reminders", name: "Compliance Reminders", schedule: "daily", module: "grants" },
    { key: "warehouse_snapshot", name: "Data Warehouse Snapshot", schedule: "hourly", module: "analytics" },
    { key: "db_backup", name: "Database Backup Snapshot", schedule: "daily", module: "security" },
    { key: "executive_report_daily", name: "Daily Executive Report", schedule: "daily", module: "executive" },
    { key: "onboarding_check", name: "Onboarding Progress Check", schedule: "daily", module: "people" },
  ];
  for (const job of jobs) {
    const exists = await db.get("SELECT id FROM hq_scheduled_jobs WHERE job_key = ?", job.key);
    if (!exists) {
      await db.run(
        `INSERT INTO hq_scheduled_jobs (id, job_key, name, schedule_expr, source_module, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`,
        workflowId(), job.key, job.name, job.schedule, job.module, now
      );
    } else {
      await db.run(
        "UPDATE hq_scheduled_jobs SET source_module = COALESCE(source_module, ?) WHERE job_key = ?",
        job.module,
        job.key
      );
    }
  }
}
