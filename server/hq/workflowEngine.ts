import { getDb } from "../db";
import { ensureWorkflowTables, workflowId } from "./workflowEngineSchema";
import { buildApprovalQueue, type ApprovalTask } from "./enterpriseApprovals";
import { generateGrantNotifications } from "./grantReporting";
import { captureFullWarehouseSnapshot } from "./analyticsWarehouse";
import { logHqAudit } from "./hqAuditLog";
import { syncGrantExpenditureFromFinance } from "./grantFinanceIntegration";
import { productionWorkflowInstanceSqlFilter } from "./workflowProductionCleanup";

export async function listWorkflowDefinitions() {
  await ensureWorkflowTables();
  const db = await getDb();
  const defs = (await db.all(
    "SELECT * FROM hq_workflow_definitions ORDER BY name"
  )) as Record<string, unknown>[];

  return Promise.all(
    defs.map(async (def) => {
      const key = String(def.workflow_key);
      const stats = await db.get<{ pending: number; total: number; last_at: string | null }>(
        `SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          COUNT(*) as total,
          MAX(created_at) as last_at
         FROM hq_workflow_instances WHERE workflow_key = ?${productionWorkflowInstanceSqlFilter()}`,
        key
      );
      const pending = Number(stats?.pending ?? 0);
      return {
        ...def,
        category: def.trigger_type ?? "event",
        instanceCount: Number(stats?.total ?? 0),
        pendingCount: pending,
        lastInstanceAt: stats?.last_at ?? null,
        operationalStatus: pending > 0 ? "in_use" : Number(stats?.total ?? 0) > 0 ? "configured" : "idle",
      };
    })
  );
}

export async function listWorkflowInstances(opts?: { status?: string; workflowKey?: string; limit?: number }) {
  await ensureWorkflowTables();
  const db = await getDb();
  let sql = `SELECT * FROM hq_workflow_instances WHERE 1=1${productionWorkflowInstanceSqlFilter()}`;
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
  const rows = (await db.all("SELECT * FROM hq_scheduled_jobs ORDER BY name")) as Record<string, unknown>[];
  return rows.map((job) => ({
    ...job,
    schedule: job.schedule_expr ?? job.schedule ?? "daily",
    runStatus: job.last_run_status ?? (job.last_run_at ? "success" : "never_run"),
    lastError: job.last_error ?? null,
    sourceModule: job.source_module ?? sourceModuleForJob(String(job.job_key)),
  }));
}

function sourceModuleForJob(jobKey: string): string {
  const map: Record<string, string> = {
    grant_deadlines: "grants",
    compliance_reminders: "grants",
    warehouse_snapshot: "analytics",
    db_backup: "security",
    executive_report_daily: "executive",
    onboarding_check: "people",
  };
  return map[jobKey] ?? "hq";
}

export async function setScheduledJobEnabled(jobKey: string, enabled: boolean, actorEmail?: string) {
  await ensureWorkflowTables();
  const db = await getDb();
  await db.run("UPDATE hq_scheduled_jobs SET enabled = ? WHERE job_key = ?", enabled ? 1 : 0, jobKey);
  await logHqAudit({
    action: enabled ? "scheduled_job_enabled" : "scheduled_job_disabled",
    entityType: "scheduled_job",
    entityId: jobKey,
    actorEmail,
  });
  return db.get("SELECT * FROM hq_scheduled_jobs WHERE job_key = ?", jobKey);
}

export async function runSingleScheduledJob(jobKey: string, actorEmail?: string) {
  await ensureWorkflowTables();
  const db = await getDb();
  const job = await db.get<{ job_key: string; name: string; enabled: number }>(
    "SELECT job_key, name, enabled FROM hq_scheduled_jobs WHERE job_key = ?",
    jobKey
  );
  if (!job) return { ok: false, error: "Job not found" };

  const now = new Date().toISOString();
  try {
    await executeScheduledJob(job.job_key, actorEmail);
    await db.run(
      "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ?, last_run_status = 'success', last_error = NULL WHERE job_key = ?",
      now,
      computeNextRunAt(job.job_key),
      jobKey
    );
    await logHqAudit({
      action: "scheduled_job_run",
      entityType: "scheduled_job",
      entityId: jobKey,
      detail: job.name,
      actorEmail: actorEmail ?? "system",
    });
    return { ok: true, jobKey, ranAt: now };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.run(
      "UPDATE hq_scheduled_jobs SET last_run_at = ?, last_run_status = 'failed', last_error = ? WHERE job_key = ?",
      now,
      message,
      jobKey
    );
    await logHqAudit({
      action: "scheduled_job_failed",
      entityType: "scheduled_job",
      entityId: jobKey,
      detail: message,
      actorEmail: actorEmail ?? "system",
    });
    return { ok: false, jobKey, error: message };
  }
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
    grant_founder_approval: "board_approval",
    document: "document_approval",
    onboarding: "employee_onboarding",
    board_resolution: "board_approval",
    board_packet: "board_approval",
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
      case "grant_founder_approval": {
        const { setFounderApproval } = await import("./grantIntelligenceEngine");
        const result = await setFounderApproval(
          entityId,
          action === "approve" ? "approve" : "request_changes",
          { actorEmail: actor?.email }
        );
        if (!result.ok) return { success: false, message: result.error ?? "Grant approval failed" };
        break;
      }
      case "board_resolution":
        await db.run(
          `UPDATE board_resolutions SET status = ?, adopted_at = ? WHERE id = ?`,
          action === "approve" ? "adopted" : "rejected",
          action === "approve" ? now : null,
          entityId
        );
        break;
      case "board_packet":
        await db.run(
          `UPDATE board_packets SET status = ?, published_at = ? WHERE id = ?`,
          action === "approve" ? "published" : "draft",
          action === "approve" ? now : null,
          entityId
        );
        break;
      case "onboarding":
        if (action === "approve") {
          await db.run(
            `UPDATE people_onboarding_items SET completed = 1, completed_at = ?, completed_by = ?
             WHERE person_id = ? AND completed = 0`,
            now,
            actor?.email ?? "",
            entityId
          );
          const remaining = await db.get<{ c: number }>(
            "SELECT COUNT(*) as c FROM people_onboarding_items WHERE person_id = ? AND completed = 0",
            entityId
          );
          if ((remaining?.c ?? 0) === 0) {
            await db.run("UPDATE people SET status = 'active', updated_at = ? WHERE id = ?", now, entityId);
          }
        }
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
  if (taskId.startsWith("grant-founder-")) return ["grant_founder_approval", taskId.slice(14)];
  if (taskId.startsWith("board-packet-")) return ["board_packet", taskId.slice(13)];
  if (taskId.startsWith("onboarding-")) return ["onboarding", taskId.slice(11)];
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
  if (prefix === "board") return ["board_resolution", rest];
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
        "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ?, last_run_status = 'success', last_error = NULL WHERE job_key = ?",
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
      const message = (err as Error).message;
      errors.push(`${job.job_key}: ${message}`);
      await db.run(
        "UPDATE hq_scheduled_jobs SET last_run_at = ?, last_run_status = 'failed', last_error = ? WHERE job_key = ?",
        now,
        message,
        job.job_key
      );
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
        "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ?, last_run_status = 'success', last_error = NULL WHERE job_key = ?",
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
      const message = (err as Error).message;
      errors.push(`${job.job_key}: ${message}`);
      await db.run(
        "UPDATE hq_scheduled_jobs SET last_run_at = ?, last_run_status = 'failed', last_error = ? WHERE job_key = ?",
        new Date().toISOString(),
        message,
        job.job_key
      );
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
    case "aura_autonomous_ops": {
      const { runAutonomousOperationsCycle } = await import("./auraAutonomousOperations");
      await runAutonomousOperationsCycle({
        actorEmail: actorEmail ?? "system-scheduler",
        notifyFounderChannels: false,
        prepareCadences: true,
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
