import { getDb } from "../db";
import { ensureWorkflowTables, workflowId } from "./workflowEngineSchema";
import { buildApprovalQueue, type ApprovalTask } from "./enterpriseApprovals";
import { generateGrantNotifications } from "./grantReporting";
import { captureFullWarehouseSnapshot } from "./analyticsWarehouse";
import { logHqAudit } from "./hqAuditLog";
import { syncGrantExpenditureFromFinance } from "./grantFinanceIntegration";

export async function listWorkflowDefinitions() {
  await ensureWorkflowTables();
  const db = await getDb();
  return db.all("SELECT * FROM hq_workflow_definitions WHERE enabled = 1 ORDER BY name");
}

export async function listWorkflowInstances(opts?: { status?: string; workflowKey?: string; limit?: number }) {
  await ensureWorkflowTables();
  const db = await getDb();
  let sql = "SELECT * FROM hq_workflow_instances WHERE 1=1";
  const params: unknown[] = [];
  if (opts?.status) { sql += " AND status = ?"; params.push(opts.status); }
  if (opts?.workflowKey) { sql += " AND workflow_key = ?"; params.push(opts.workflowKey); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(opts?.limit ?? 50);
  return db.all(sql, ...params);
}

export async function listScheduledJobs() {
  await ensureWorkflowTables();
  const db = await getDb();
  return db.all("SELECT * FROM hq_scheduled_jobs ORDER BY name");
}

export async function createWorkflowInstance(opts: {
  workflowKey: string;
  title: string;
  entityType?: string;
  entityId?: string;
  assignedTo?: string;
  priority?: string;
  payload?: Record<string, unknown>;
  dueAt?: string;
}) {
  await ensureWorkflowTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = workflowId();
  await db.run(
    `INSERT INTO hq_workflow_instances (id, workflow_key, status, entity_type, entity_id, title, assigned_to, priority, payload_json, due_at, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, opts.workflowKey, opts.entityType ?? null, opts.entityId ?? null, opts.title,
    opts.assignedTo ?? null, opts.priority ?? "normal",
    opts.payload ? JSON.stringify(opts.payload) : null, opts.dueAt ?? null, now, now
  );
  const { initializeWorkflowSteps } = await import("./workflowOrchestration");
  await initializeWorkflowSteps(id, opts.workflowKey).catch(() => undefined);
  return db.get("SELECT * FROM hq_workflow_instances WHERE id = ?", id);
}

export async function syncApprovalTasksToWorkflows() {
  await ensureWorkflowTables();
  const { tasks } = await buildApprovalQueue(50);
  const db = await getDb();
  let synced = 0;
  for (const task of tasks) {
    const workflowKey = taskTypeToWorkflowKey(task.type);
    const existing = await db.get(
      `SELECT id FROM hq_workflow_instances WHERE entity_type = ? AND entity_id = ? AND status = 'pending'`,
      task.type, task.entityId
    );
    if (existing) continue;
    await createWorkflowInstance({
      workflowKey,
      title: task.title,
      entityType: task.type,
      entityId: task.entityId,
      priority: task.priority,
      payload: { subtitle: task.subtitle, path: task.path, amount: task.amount, dueDate: task.dueDate },
      dueAt: task.dueDate,
    });
    synced++;
  }
  return synced;
}

function taskTypeToWorkflowKey(type: ApprovalTask["type"]): string {
  const map: Record<string, string> = {
    leave: "leave_approval",
    expense: "expense_approval",
    purchase_order: "expense_approval",
    grant_application: "board_approval",
    document: "document_approval",
    grant_deadline: "grant_deadline_reminder",
  };
  return map[type] ?? "expense_approval";
}

export async function processApprovalTask(
  taskId: string,
  action: "approve" | "reject" | "complete",
  actor?: { id?: string; email?: string }
): Promise<{ success: boolean; message?: string }> {
  const [type, entityId] = parseTaskId(taskId);
  if (!type || !entityId) return { success: false, message: "Invalid task ID" };

  const db = await getDb();
  const now = new Date().toISOString();

  try {
    switch (type) {
      case "leave":
        await db.run(
          `UPDATE leave_requests SET status = ?, reviewer_email = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
          action === "approve" ? "approved" : "rejected", actor?.email ?? "", now, now, entityId
        );
        break;
      case "expense":
        if (action === "approve") {
          await db.run(`UPDATE finance_expenses SET approval_status = 'approved' WHERE id = ?`, entityId);
          const exp = await db.get<{ grant_id: string | null }>("SELECT grant_id FROM finance_expenses WHERE id = ?", entityId);
          if (exp?.grant_id) {
            await syncGrantExpenditureFromFinance(entityId, exp.grant_id).catch(() => undefined);
          }
        } else {
          await db.run(`UPDATE finance_expenses SET approval_status = 'denied' WHERE id = ?`, entityId);
        }
        break;
      case "purchase_order":
        await db.run(
          `UPDATE finance_purchase_orders SET status = ?, updated_at = ? WHERE id = ?`,
          action === "approve" ? "approved" : "rejected", now, entityId
        );
        break;
      case "document":
        await db.run(
          `UPDATE hq_documents SET approval_status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`,
          action === "approve" ? "approved" : "rejected", actor?.email ?? "", now, now, entityId
        );
        break;
      case "grant_application":
        if (action === "approve") {
          await db.run(`UPDATE grant_applications SET status = 'awarded' WHERE id = ?`, entityId);
        } else if (action === "reject") {
          await db.run(`UPDATE grant_applications SET status = 'rejected' WHERE id = ?`, entityId);
        }
        break;
      case "grant_deadline":
        if (action === "approve" || action === "complete") {
          await db.run(`UPDATE grant_deadlines SET completed = 1 WHERE id = ?`, entityId);
        }
        break;
      case "workflow": {
        const { advanceWorkflowStep } = await import("./workflowOrchestration");
        const wfResult = await advanceWorkflowStep(entityId, action === "complete" ? "complete" : action, { email: actor?.email });
        if (!wfResult.success) return wfResult;
        await logHqAudit({
          action: `workflow_${action}`,
          entityType: "workflow_instance",
          entityId,
          detail: wfResult.message,
          actorId: actor?.id,
          actorEmail: actor?.email,
        });
        return { success: true, message: wfResult.message };
      }
      default:
        return { success: false, message: "Unknown task type" };
    }

    await db.run(
      `UPDATE hq_workflow_instances SET status = ?, completed_at = ?, updated_at = ? WHERE entity_type = ? AND entity_id = ? AND status = 'pending'`,
      action === "reject" ? "rejected" : "completed", now, now, type, entityId
    );

    await logHqAudit({
      action: `workflow_${action}`,
      entityType: type,
      entityId,
      detail: `Workflow ${action} on ${type}`,
      actorId: actor?.id,
      actorEmail: actor?.email,
    });

    return { success: true, message: action === "approve" ? "Approved successfully" : action === "reject" ? "Rejected successfully" : "Completed successfully" };
  } catch (err) {
    console.error("Workflow process error:", err);
    return { success: false, message: "Processing failed" };
  }
}

export function parseApprovalTaskId(taskId: string): [string | null, string | null] {
  const idx = taskId.indexOf("-");
  if (idx < 0) return [null, null];
  const prefix = taskId.slice(0, idx);
  const rest = taskId.slice(idx + 1);
  if (prefix === "grant" && rest.startsWith("app-")) return ["grant_application", rest.slice(4)];
  if (prefix === "grant" && rest.startsWith("deadline-")) return ["grant_deadline", rest.slice(9)];
  if (prefix === "grant") return ["grant_deadline", rest];
  if (prefix === "po") return ["purchase_order", rest];
  if (prefix === "doc") return ["document", rest];
  if (prefix === "workflow") return ["workflow", rest];
  if (prefix === "deadline") return ["grant_deadline", rest];
  const typeMap: Record<string, string> = {
    leave: "leave",
    expense: "expense",
  };
  return [typeMap[prefix] ?? prefix, rest];
}

function parseTaskId(taskId: string): [string | null, string | null] {
  return parseApprovalTaskId(taskId);
}

export async function runScheduledJobs(actorEmail?: string): Promise<{ ran: string[]; errors: string[] }> {
  await ensureWorkflowTables();
  const db = await getDb();
  const jobs = (await db.all(
    "SELECT job_key, name FROM hq_scheduled_jobs WHERE enabled = 1"
  )) as { job_key: string; name: string }[];
  const ran: string[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const job of jobs) {
    try {
      await executeScheduledJob(job.job_key, actorEmail);
      await db.run(
        "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ? WHERE job_key = ?",
        now, computeNextRunAt(job.job_key), job.job_key
      );
      ran.push(job.job_key);
      await logHqAudit({
        action: "scheduled_job_run",
        entityType: "scheduled_job",
        entityId: job.job_key,
        detail: job.name,
        actorEmail: actorEmail ?? "system",
      });
    } catch (err) {
      errors.push(`${job.job_key}: ${(err as Error).message}`);
    }
  }
  return { ran, errors };
}

function scheduleIntervalMs(schedule: string): number {
  switch (schedule) {
    case "hourly": return 60 * 60 * 1000;
    case "daily": return 24 * 60 * 60 * 1000;
    case "weekly": return 7 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

function computeNextRunAt(jobKey: string): string {
  const schedules: Record<string, string> = {
    warehouse_snapshot: "hourly",
    grant_deadlines: "daily",
    compliance_reminders: "daily",
    db_backup: "daily",
    executive_report_daily: "daily",
    onboarding_check: "daily",
  };
  const schedule = schedules[jobKey] ?? "daily";
  return new Date(Date.now() + scheduleIntervalMs(schedule)).toISOString();
}

export async function runDueScheduledJobs(actorEmail?: string): Promise<{ ran: string[]; skipped: string[]; errors: string[] }> {
  await ensureWorkflowTables();
  const db = await getDb();
  const jobs = (await db.all(
    "SELECT job_key, name, schedule_expr, last_run_at, next_run_at FROM hq_scheduled_jobs WHERE enabled = 1"
  )) as { job_key: string; name: string; schedule_expr: string; last_run_at: string | null; next_run_at: string | null }[];

  const ran: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const now = Date.now();

  for (const job of jobs) {
    const interval = scheduleIntervalMs(job.schedule_expr ?? "daily");
    const lastRun = job.last_run_at ? new Date(job.last_run_at).getTime() : 0;
    const due = !job.last_run_at || now - lastRun >= interval;

    if (!due) {
      skipped.push(job.job_key);
      continue;
    }

    try {
      await executeScheduledJob(job.job_key, actorEmail);
      const ts = new Date().toISOString();
      await db.run(
        "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ? WHERE job_key = ?",
        ts, computeNextRunAt(job.job_key), job.job_key
      );
      ran.push(job.job_key);
      await logHqAudit({
        action: "scheduled_job_run",
        entityType: "scheduled_job",
        entityId: job.job_key,
        detail: job.name,
        actorEmail: actorEmail ?? "system",
      });
    } catch (err) {
      errors.push(`${job.job_key}: ${(err as Error).message}`);
    }
  }

  return { ran, skipped, errors };
}

async function executeScheduledJob(jobKey: string, actorEmail?: string): Promise<void> {
  const now = new Date().toISOString();
  switch (jobKey) {
    case "grant_deadlines":
      await generateGrantNotifications();
      await syncApprovalTasksToWorkflows();
      break;
    case "compliance_reminders":
      await generateGrantNotifications();
      break;
    case "warehouse_snapshot":
      await captureFullWarehouseSnapshot();
      break;
    case "db_backup": {
      const { createDatabaseBackup } = await import("./hqBackupService");
      await createDatabaseBackup(actorEmail ?? "scheduled");
      break;
    }
    case "executive_report_daily": {
      const { buildExecutiveReport } = await import("./analyticsReporting");
      const { generateExecutiveBoardReport } = await import("./executiveIntelligenceEngine");
      const report = await buildExecutiveReport("daily").catch(() => null);
      const boardReport = await generateExecutiveBoardReport().catch(() => null);
      await createWorkflowInstance({
        workflowKey: "scheduled_report",
        title: `Daily executive report — ${now.slice(0, 10)}`,
        assignedTo: "executive@hq",
        payload: {
          reportType: "daily",
          generated: !!report,
          boardSummary: boardReport?.executiveSummary?.slice(0, 500),
        },
      });
      break;
    }
    case "onboarding_check":
      await syncApprovalTasksToWorkflows();
      break;
    default:
      break;
  }
}

export async function repairPendingWorkflowSteps(): Promise<number> {
  await ensureWorkflowTables();
  const db = await getDb();
  const instances = (await db.all(
    "SELECT id, workflow_key FROM hq_workflow_instances WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100"
  )) as { id: string; workflow_key: string }[];
  const { initializeWorkflowSteps, ensureWorkflowStepTables } = await import("./workflowOrchestration");
  await ensureWorkflowStepTables();
  let repaired = 0;
  for (const inst of instances) {
    const existing = await db.get("SELECT id FROM hq_workflow_steps WHERE instance_id = ? LIMIT 1", inst.id);
    if (!existing) {
      await initializeWorkflowSteps(inst.id, inst.workflow_key);
      repaired++;
    }
  }
  return repaired;
}

export async function buildWorkflowDashboard() {
  await ensureWorkflowTables();
  const { getWorkflowSteps, ensureWorkflowStepTables } = await import("./workflowOrchestration");
  await ensureWorkflowStepTables();
  await repairPendingWorkflowSteps().catch(() => undefined);
  const [definitions, instances, jobs, approvalQueue] = await Promise.all([
    listWorkflowDefinitions(),
    listWorkflowInstances({ limit: 20 }),
    listScheduledJobs(),
    buildApprovalQueue(15),
  ]);
  const enrichedInstances = await Promise.all(
    (instances as { id: string; status: string; [key: string]: unknown }[]).map(async (inst) => {
      const steps = await getWorkflowSteps(inst.id).catch(() => []);
      const active = (steps as { status: string; step_name: string; step_key: string }[]).find((s) => s.status === "active");
      return {
        ...inst,
        active_step_name: active?.step_name ?? null,
        active_step_key: active?.step_key ?? null,
        can_advance: inst.status === "pending" && !!active,
      };
    })
  );
  const pending = enrichedInstances.filter((i) => i.status === "pending").length;
  return {
    definitions,
    instances: enrichedInstances,
    jobs,
    approvalTasks: approvalQueue.tasks,
    counts: { ...approvalQueue.counts, workflowPending: pending },
    timestamp: new Date().toISOString(),
  };
}
