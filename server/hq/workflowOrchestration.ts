import { getDb } from "../db";
import { ensureWorkflowTables, workflowId, WORKFLOW_DEFINITIONS } from "./workflowEngineSchema";

export interface WorkflowStep {
  key: string;
  name: string;
  assigneeRole?: string;
  action?: "approve" | "review" | "notify" | "complete";
}

export const WORKFLOW_STEP_TEMPLATES: Record<string, WorkflowStep[]> = {
  expense_approval: [
    { key: "submit", name: "Submitted", action: "review" },
    { key: "manager_review", name: "Manager Review", assigneeRole: "manager", action: "approve" },
    { key: "executive_approval", name: "Executive Approval", assigneeRole: "executive", action: "approve" },
    { key: "complete", name: "Posted to GL", action: "complete" },
  ],
  leave_approval: [
    { key: "submit", name: "Request Submitted", action: "review" },
    { key: "hr_review", name: "HR Review", assigneeRole: "hr", action: "approve" },
    { key: "executive_signoff", name: "Executive Sign-off", assigneeRole: "executive", action: "approve" },
    { key: "complete", name: "Leave Recorded", action: "complete" },
  ],
  grant_deadline_reminder: [
    { key: "detect", name: "Deadline Detected", action: "notify" },
    { key: "notify_grants", name: "Notify Grants Team", assigneeRole: "grants", action: "review" },
    { key: "complete", name: "Reminder Sent", action: "complete" },
  ],
  compliance_reminder: [
    { key: "scan", name: "Compliance Scan", action: "review" },
    { key: "notify", name: "Notify Stakeholders", assigneeRole: "compliance", action: "notify" },
    { key: "complete", name: "Monitoring Complete", action: "complete" },
  ],
  employee_onboarding: [
    { key: "hr_setup", name: "HR Setup", assigneeRole: "hr", action: "review" },
    { key: "documents", name: "Document Collection", assigneeRole: "hr", action: "approve" },
    { key: "it_access", name: "IT Access", assigneeRole: "admin", action: "approve" },
    { key: "orientation", name: "Orientation", assigneeRole: "manager", action: "complete" },
    { key: "complete", name: "Onboarding Complete", action: "complete" },
  ],
  board_approval: [
    { key: "draft", name: "Packet Drafted", action: "review" },
    { key: "executive_review", name: "Executive Review", assigneeRole: "executive", action: "approve" },
    { key: "board_vote", name: "Board Vote", assigneeRole: "board", action: "approve" },
    { key: "complete", name: "Resolution Recorded", action: "complete" },
  ],
  scheduled_report: [
    { key: "generate", name: "Report Generated", action: "review" },
    { key: "executive_review", name: "Executive Review", assigneeRole: "executive", action: "approve" },
    { key: "distribute", name: "Distributed", action: "notify" },
    { key: "complete", name: "Archived", action: "complete" },
  ],
  document_approval: [
    { key: "upload", name: "Document Uploaded", action: "review" },
    { key: "review", name: "Compliance Review", assigneeRole: "compliance", action: "approve" },
    { key: "executive_sign", name: "Executive Signature", assigneeRole: "executive", action: "approve" },
    { key: "complete", name: "Published", action: "complete" },
  ],
};

export async function ensureWorkflowStepTables(): Promise<void> {
  await ensureWorkflowTables();
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_workflow_steps (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      step_key TEXT NOT NULL,
      step_name TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      assignee_role TEXT,
      assigned_to TEXT,
      completed_at TEXT,
      completed_by TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_steps_instance ON hq_workflow_steps(instance_id, step_order);
  `);

  const now = new Date().toISOString();
  for (const def of WORKFLOW_DEFINITIONS) {
    const steps = WORKFLOW_STEP_TEMPLATES[def.key];
    if (!steps) continue;
    const exists = await db.get("SELECT config_json FROM hq_workflow_definitions WHERE workflow_key = ?", def.key);
    if (exists && (exists as { config_json: string | null }).config_json) continue;
    await db.run(
      "UPDATE hq_workflow_definitions SET config_json = ?, updated_at = ? WHERE workflow_key = ?",
      JSON.stringify({ steps }), now, def.key
    );
  }
}

export async function initializeWorkflowSteps(instanceId: string, workflowKey: string): Promise<void> {
  await ensureWorkflowStepTables();
  const steps = WORKFLOW_STEP_TEMPLATES[workflowKey];
  if (!steps?.length) return;

  const db = await getDb();
  const existing = await db.get("SELECT id FROM hq_workflow_steps WHERE instance_id = ? LIMIT 1", instanceId);
  if (existing) return;

  const now = new Date().toISOString();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await db.run(
      `INSERT INTO hq_workflow_steps (id, instance_id, step_key, step_name, step_order, status, assignee_role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      workflowId(), instanceId, s.key, s.name, i,
      i === 0 ? "active" : "pending",
      s.assigneeRole ?? null, now, now
    );
  }
}

export async function getWorkflowSteps(instanceId: string) {
  await ensureWorkflowStepTables();
  const db = await getDb();
  return db.all(
    "SELECT * FROM hq_workflow_steps WHERE instance_id = ? ORDER BY step_order",
    instanceId
  );
}

export async function advanceWorkflowStep(
  instanceId: string,
  action: "approve" | "reject" | "complete",
  actor?: { email?: string }
): Promise<{ success: boolean; message: string; completed?: boolean }> {
  await ensureWorkflowStepTables();
  const db = await getDb();
  const active = await db.get(
    "SELECT * FROM hq_workflow_steps WHERE instance_id = ? AND status = 'active' ORDER BY step_order LIMIT 1",
    instanceId
  ) as { id: string; step_key: string; step_order: number } | undefined;

  if (!active) {
    return { success: false, message: "No active step" };
  }

  const now = new Date().toISOString();

  if (action === "reject") {
    await db.run(
      "UPDATE hq_workflow_steps SET status = 'rejected', completed_at = ?, completed_by = ?, updated_at = ? WHERE id = ?",
      now, actor?.email ?? null, now, active.id
    );
    await db.run("UPDATE hq_workflow_instances SET status = 'rejected', updated_at = ? WHERE id = ?", now, instanceId);
    return { success: true, message: "Workflow rejected" };
  }

  await db.run(
    "UPDATE hq_workflow_steps SET status = 'completed', completed_at = ?, completed_by = ?, updated_at = ? WHERE id = ?",
    now, actor?.email ?? null, now, active.id
  );

  const next = await db.get(
    "SELECT id FROM hq_workflow_steps WHERE instance_id = ? AND step_order = ?",
    instanceId, active.step_order + 1
  );

  if (next) {
    await db.run(
      "UPDATE hq_workflow_steps SET status = 'active', updated_at = ? WHERE id = ?",
      now, (next as { id: string }).id
    );
    const nextStep = await db.get<{ step_name: string }>(
      "SELECT step_name FROM hq_workflow_steps WHERE id = ?",
      (next as { id: string }).id
    );
    return { success: true, message: `Advanced to ${nextStep?.step_name ?? "next step"}` };
  }

  await db.run(
    "UPDATE hq_workflow_instances SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
    now, now, instanceId
  );
  return { success: true, message: "Workflow completed and archived", completed: true };
}

export async function getWorkflowInstanceDetail(instanceId: string) {
  await ensureWorkflowStepTables();
  const db = await getDb();
  const instance = await db.get("SELECT * FROM hq_workflow_instances WHERE id = ?", instanceId);
  if (!instance) return null;
  const steps = await getWorkflowSteps(instanceId);
  return { instance, steps };
}
