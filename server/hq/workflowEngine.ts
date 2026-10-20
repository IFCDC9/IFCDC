import { getDb } from "../db";
import { ensureWorkflowTables, workflowId } from "./workflowEngineSchema";
import { buildApprovalQueue, type ApprovalTask } from "./enterpriseApprovals";
import { generateGrantNotifications } from "./grantReporting";
import {
  isFundingWarehouseJob,
  noteFundingRestartDeferral,
  shouldRunScheduledJobNow,
} from "./fundingBootGate";
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
  const backupRow = rows.find((job) => String(job.job_key) === "db_backup");
  const backupSnapshot = backupRow ? await backupSnapshotForScheduledRow(db, backupRow) : null;
  return rows.map((job) => ({
    ...job,
    schedule: job.schedule_expr ?? job.schedule ?? "daily",
    runStatus: job.last_run_status ?? (job.last_run_at ? "success" : "never_run"),
    lastError: job.last_error ?? null,
    sourceModule: job.source_module ?? sourceModuleForJob(String(job.job_key)),
    ...(String(job.job_key) === "db_backup" ? { backupSnapshot } : {}),
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

/** Stored when an upload finished and recovery evidence is not on that run yet. */
export const DB_BACKUP_UNVERIFIED_ERROR =
  "Off-server backup uploaded. Database integrity has not been checked. Application recovery is pending. External copy is pending. Full recovery is not complete.";

/** Earlier rows stored an approval gate. The card does not display that sentence. */
export const DB_BACKUP_APPROVAL_SENTENCE =
  "Off-server backup uploaded. Isolated restore has not been approved.";

const BACKUP_RUN_MATCH_MS = 2 * 60 * 60 * 1000;
const BACKUP_OBJECT_STAMP = /ifcdc-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db\.enc$/;

export type BackupRunAudit = {
  action: string;
  detail: string | null;
  createdAt: string;
};

export type BackupObjectEvidence = {
  objectKey: string;
  capturedAt: string;
  databaseIntegrity?: string;
  applicationRecovery?: string;
  externalCopy?: string;
  fullRecoveryVerified?: boolean;
};

export type DatabaseBackupSnapshotCard = {
  objectKey: string | null;
  databaseIntegrity: "passed" | "not_checked";
  applicationRecovery: "pending" | "failed" | "readable_scheduled_jobs_and_snapshots";
  externalCopy: "pending";
  fullRecoveryVerified: false;
  lines: string[];
};

export function objectKeyFromBackupAuditDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const match = detail.match(/(?:^|\s)object=(\S+)/);
  const objectKey = match?.[1] ?? "";
  if (!objectKey.endsWith(".db.enc")) return null;
  return objectKey;
}

export function embeddedBackupObjectTime(objectKey: string): number | null {
  const match = objectKey.match(BACKUP_OBJECT_STAMP);
  if (!match) return null;
  const stamp = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
  return Number.isFinite(stamp) ? stamp : null;
}

function closestBackupObject(
  lastRunAt: string,
  candidates: { objectKey: string; stamps: number[] }[],
): string | null {
  const last = Date.parse(lastRunAt);
  if (!Number.isFinite(last)) return null;
  const ranked = candidates
    .map((candidate) => {
      const distances = candidate.stamps.filter((stamp) => Number.isFinite(stamp)).map((stamp) => Math.abs(stamp - last));
      if (!distances.length) return null;
      return { objectKey: candidate.objectKey, distance: Math.min(...distances) };
    })
    .filter((candidate): candidate is { objectKey: string; distance: number } => candidate != null && candidate.distance <= BACKUP_RUN_MATCH_MS)
    .sort((a, b) => a.distance - b.distance);
  return ranked[0]?.objectKey ?? null;
}

/**
 * The scheduler row has no object key. Use the unverified audit for this run,
 * and only then an evidence row whose own timestamp is this run. A different
 * object's integrity is not attached.
 */
export function objectKeyForScheduledBackupRun(input: {
  lastRunAt: string | null;
  audits: BackupRunAudit[];
  evidence?: BackupObjectEvidence[];
}): string | null {
  if (!input.lastRunAt) return null;
  const fromAudits = closestBackupObject(
    input.lastRunAt,
    input.audits
      .filter((row) => row.action === "database_backup_unverified")
      .flatMap((row) => {
        const objectKey = objectKeyFromBackupAuditDetail(row.detail);
        if (!objectKey) return [];
        const embedded = embeddedBackupObjectTime(objectKey);
        const created = Date.parse(row.createdAt);
        return [{ objectKey, stamps: [embedded ?? Number.NaN, created] }];
      }),
  );
  if (fromAudits) return fromAudits;
  return closestBackupObject(
    input.lastRunAt,
    (input.evidence ?? []).map((item) => {
      const embedded = embeddedBackupObjectTime(item.objectKey);
      const captured = Date.parse(item.capturedAt);
      return { objectKey: item.objectKey, stamps: [embedded ?? Number.NaN, captured] };
    }),
  );
}

export function databaseBackupSnapshotCard(input: {
  lastRunStatus: string | null;
  lastError: string | null;
  objectKey: string | null;
  evidence: BackupObjectEvidence | null;
}): DatabaseBackupSnapshotCard | null {
  const unverified = input.lastRunStatus === "uploaded_unverified"
    || input.lastError === DB_BACKUP_UNVERIFIED_ERROR
    || input.lastError === DB_BACKUP_APPROVAL_SENTENCE;
  if (!unverified) return null;
  const evidence = input.evidence && input.objectKey && input.evidence.objectKey === input.objectKey
    ? input.evidence
    : null;
  if (evidence?.databaseIntegrity === "passed" && evidence.fullRecoveryVerified !== true) {
    const applicationRecovery = evidence.applicationRecovery === "readable_scheduled_jobs_and_snapshots"
      ? "readable_scheduled_jobs_and_snapshots"
      : evidence.applicationRecovery === "failed"
        ? "failed"
        : "pending";
    const recoveryLabel = applicationRecovery === "readable_scheduled_jobs_and_snapshots"
      ? "readable scheduled-job and snapshot rows"
      : applicationRecovery;
    return {
      objectKey: input.objectKey,
      databaseIntegrity: "passed",
      applicationRecovery,
      externalCopy: "pending",
      fullRecoveryVerified: false,
      lines: [
        `Object: ${input.objectKey}`,
        "Database integrity: passed",
        `Application recovery: ${recoveryLabel}`,
        "External copy: pending",
        "Full recovery: false",
      ],
    };
  }
  return {
    objectKey: input.objectKey,
    databaseIntegrity: "not_checked",
    applicationRecovery: "pending",
    externalCopy: "pending",
    fullRecoveryVerified: false,
    lines: [
      input.objectKey ? `Object: ${input.objectKey}` : "Object: not recorded for this run",
      "Database integrity: not checked",
      "Application recovery: pending",
      "External copy: pending",
      "Full recovery: false",
    ],
  };
}

async function backupSnapshotForScheduledRow(
  db: ScheduledJobWriter & { all(sql: string, ...params: unknown[]): Promise<unknown[]> },
  job: Record<string, unknown>,
): Promise<DatabaseBackupSnapshotCard | null> {
  const lastRunStatus = job.last_run_status != null ? String(job.last_run_status) : null;
  const lastError = job.last_error != null ? String(job.last_error) : null;
  const lastRunAt = job.last_run_at != null ? String(job.last_run_at) : null;
  if (databaseBackupSnapshotCard({ lastRunStatus, lastError, objectKey: null, evidence: null }) == null) return null;
  let audits: BackupRunAudit[] = [];
  let evidence: BackupObjectEvidence[] = [];
  try {
    const { OFFSERVER_BACKUP_EVIDENCE_ACTION, parseStoredOffServerEvidence } = await import("./hqBackupService");
    const rows = (await db.all(
      "SELECT action, detail, entity_id, metadata_json, created_at FROM hq_audit_log WHERE action IN ('database_backup_unverified', ?) ORDER BY created_at ASC",
      OFFSERVER_BACKUP_EVIDENCE_ACTION,
    )) as {
      action?: string;
      detail?: string | null;
      entity_id?: string | null;
      metadata_json?: string | null;
      created_at?: string;
    }[];
    audits = rows
      .filter((row) => row.action === "database_backup_unverified")
      .map((row) => ({
        action: "database_backup_unverified",
        detail: row.detail ?? null,
        createdAt: row.created_at ?? "",
      }));
    evidence = rows.flatMap((row) => {
      if (row.action !== OFFSERVER_BACKUP_EVIDENCE_ACTION) return [];
      const parsed = parseStoredOffServerEvidence(row.metadata_json, row.entity_id ?? "");
      return parsed ? [parsed] : [];
    });
  } catch {
    audits = [];
    evidence = [];
  }
  const objectKey = objectKeyForScheduledBackupRun({ lastRunAt, audits, evidence });
  const matched = evidence.find((item) => item.objectKey === objectKey) ?? null;
  return databaseBackupSnapshotCard({ lastRunStatus, lastError, objectKey, evidence: matched });
}

export type ScheduledJobOutcome = {
  status: "ok" | "uploaded_unverified";
  /** Set only after createDatabaseBackup returns, which is after the off-server upload. */
  uploaded?: boolean;
};

export type DbBackupRunRecord = {
  lastRunAt: string;
  nextRunAt: string;
  lastRunStatus: "success" | "uploaded_unverified" | "failed";
  lastError: string | null;
};

/** Next screen time for db_backup: the stored last_run_at plus the daily interval. */
export function dbBackupRunRecord(input: {
  ranAt: string;
  outcome?: ScheduledJobOutcome;
  error?: string;
}): DbBackupRunRecord {
  const nextRunAt = new Date(new Date(input.ranAt).getTime() + scheduleIntervalMs("daily")).toISOString();
  if (input.error != null) {
    return {
      lastRunAt: input.ranAt,
      nextRunAt,
      lastRunStatus: "failed",
      lastError: input.error,
    };
  }
  if (input.outcome?.status === "uploaded_unverified") {
    return {
      lastRunAt: input.ranAt,
      nextRunAt,
      lastRunStatus: "uploaded_unverified",
      lastError: DB_BACKUP_UNVERIFIED_ERROR,
    };
  }
  if (input.outcome?.status === "ok" && input.outcome.uploaded === true) {
    return {
      lastRunAt: input.ranAt,
      nextRunAt,
      lastRunStatus: "success",
      lastError: null,
    };
  }
  return {
    lastRunAt: input.ranAt,
    nextRunAt,
    lastRunStatus: "failed",
    lastError: "Database backup stopped: off-server upload did not happen",
  };
}

type ScheduledJobWriter = {
  run(sql: string, ...params: unknown[]): Promise<unknown>;
};

async function persistDbBackupRun(db: ScheduledJobWriter, jobKey: string, record: DbBackupRunRecord): Promise<void> {
  if (record.lastRunStatus === "uploaded_unverified") {
    await db.run(
      "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ?, last_run_status = 'uploaded_unverified', last_error = ? WHERE job_key = ?",
      record.lastRunAt,
      record.nextRunAt,
      record.lastError,
      jobKey,
    );
    return;
  }
  if (record.lastRunStatus === "failed") {
    await db.run(
      "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ?, last_run_status = 'failed', last_error = ? WHERE job_key = ?",
      record.lastRunAt,
      record.nextRunAt,
      record.lastError,
      jobKey,
    );
    return;
  }
  await db.run(
    "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ?, last_run_status = 'success', last_error = NULL WHERE job_key = ?",
    record.lastRunAt,
    record.nextRunAt,
    jobKey,
  );
}

export async function runSingleScheduledJob(jobKey: string, actorEmail?: string) {
  await ensureWorkflowTables();
  const db = await getDb();
  const job = await db.get<{ job_key: string; name: string; enabled: number; schedule_expr: string | null }>(
    "SELECT job_key, name, enabled, schedule_expr FROM hq_scheduled_jobs WHERE job_key = ?",
    jobKey
  );
  if (!job) return { ok: false, error: "Job not found" };

  const now = new Date().toISOString();
  try {
    const outcome = await executeScheduledJob(job.job_key, actorEmail);
    if (job.job_key === "db_backup") {
      const record = dbBackupRunRecord({ ranAt: now, outcome });
      await persistDbBackupRun(db, jobKey, record);
      if (record.lastRunStatus === "failed") {
        await logHqAudit({
          action: "scheduled_job_failed",
          entityType: "scheduled_job",
          entityId: jobKey,
          detail: record.lastError ?? "Database backup stopped",
          actorEmail: actorEmail ?? "system",
        });
        return { ok: false, jobKey, error: record.lastError ?? "Database backup stopped", status: "failed" as const };
      }
      if (record.lastRunStatus === "uploaded_unverified") {
        return { ok: true, jobKey, ranAt: now, status: "uploaded_unverified" as const };
      }
      await logHqAudit({
        action: "scheduled_job_run",
        entityType: "scheduled_job",
        entityId: jobKey,
        detail: job.name,
        actorEmail: actorEmail ?? "system",
      });
      return { ok: true, jobKey, ranAt: now, status: "success" as const };
    }
    await db.run(
      "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ?, last_run_status = 'success', last_error = NULL WHERE job_key = ?",
      now,
      computeNextRunAt(job.job_key, job.schedule_expr, now),
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
    if (job.job_key === "db_backup") {
      const record = dbBackupRunRecord({ ranAt: now, error: message });
      await persistDbBackupRun(db, jobKey, record);
    } else {
      await db.run(
        "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ?, last_run_status = 'failed', last_error = ? WHERE job_key = ?",
        now,
        computeNextRunAt(job.job_key, job.schedule_expr, now),
        message,
        jobKey
      );
    }
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

export async function syncApprovalTasksToWorkflows(opts?: { skipGrantApprovals?: boolean }) {
  await ensureWorkflowTables();
  const { tasks } = await buildApprovalQueue(50);
  const db = await getDb();
  let synced = 0;
  for (const task of tasks) {
    if (opts?.skipGrantApprovals && task.type === "grant_founder_approval") continue;
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
    "SELECT job_key, name, schedule_expr FROM hq_scheduled_jobs WHERE enabled = 1"
  )) as { job_key: string; name: string; schedule_expr: string | null }[];
  const ran: string[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const job of jobs) {
    try {
      const outcome = await executeScheduledJob(job.job_key, actorEmail);
      if (job.job_key === "db_backup") {
        const record = dbBackupRunRecord({ ranAt: now, outcome });
        await persistDbBackupRun(db, job.job_key, record);
        if (record.lastRunStatus === "failed") {
          errors.push(`${job.job_key}: ${record.lastError}`);
        } else if (record.lastRunStatus === "success") {
          ran.push(job.job_key);
          await logHqAudit({
            action: "scheduled_job_run",
            entityType: "scheduled_job",
            entityId: job.job_key,
            detail: job.name,
            actorEmail: actorEmail ?? "system",
          });
        }
        continue;
      }
      await db.run(
        "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ?, last_run_status = 'success', last_error = NULL WHERE job_key = ?",
        now, computeNextRunAt(job.job_key, job.schedule_expr, now), job.job_key
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
      if (job.job_key === "db_backup") {
        const record = dbBackupRunRecord({ ranAt: now, error: message });
        await persistDbBackupRun(db, job.job_key, record);
      } else {
        await db.run(
          "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ?, last_run_status = 'failed', last_error = ? WHERE job_key = ?",
          now,
          computeNextRunAt(job.job_key, job.schedule_expr, now),
          message,
          job.job_key
        );
      }
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

/**
 * The screen time is behind the cadence. next earlier than last, or earlier than
 * last plus the job's own interval, is not a new run. Status and last_error stay.
 */
export function staleScheduledNextRun(input: {
  lastRunAt: string | null;
  nextRunAt: string | null;
  scheduleExpr?: string | null;
}): string | null {
  if (!input.lastRunAt || !input.nextRunAt) return null;
  const last = new Date(input.lastRunAt).getTime();
  const next = new Date(input.nextRunAt).getTime();
  if (!Number.isFinite(last) || !Number.isFinite(next)) return null;
  const correctedMs = last + scheduleIntervalMs(input.scheduleExpr ?? "daily");
  if (next >= correctedMs) return null;
  return new Date(correctedMs).toISOString();
}

export function staleDbBackupNextRun(input: {
  lastRunAt: string | null;
  nextRunAt: string | null;
  scheduleExpr?: string | null;
}): string | null {
  return staleScheduledNextRun({
    lastRunAt: input.lastRunAt,
    nextRunAt: input.nextRunAt,
    scheduleExpr: input.scheduleExpr ?? "daily",
  });
}

export function isDbBackupOverlapError(message: string): boolean {
  return message.includes("a backup is already running");
}

let dueScheduledRun: Promise<void> | null = null;

function computeNextRunAt(jobKey: string, scheduleExpr?: string | null, fromIso?: string): string {
  const schedules: Record<string, string> = {
    warehouse_snapshot: "hourly",
    grant_deadlines: "daily",
    compliance_reminders: "daily",
    db_backup: "daily",
    executive_report_daily: "daily",
    onboarding_check: "daily",
    ops_task_reminders: "daily",
    ops_deadline_notifications: "daily",
    ops_compliance_alerts: "daily",
    ops_approval_digest: "daily",
    ops_department_reporting: "weekly",
  };
  const schedule = scheduleExpr?.trim() || schedules[jobKey] || "daily";
  const base = fromIso ? new Date(fromIso).getTime() : Date.now();
  return new Date((Number.isFinite(base) ? base : Date.now()) + scheduleIntervalMs(schedule)).toISOString();
}

export async function runDueScheduledJobs(
  actorEmail?: string,
  opts?: {
    catchUp?: boolean;
    now?: number;
    executeJob?: (
      jobKey: string,
      actorEmail?: string,
      jobOpts?: { catchUp?: boolean },
    ) => Promise<ScheduledJobOutcome>;
  },
): Promise<{ ran: string[]; skipped: string[]; errors: string[] }> {
  if (dueScheduledRun) {
    return { ran: [], skipped: ["in_flight"], errors: [] };
  }
  let release: () => void = () => undefined;
  dueScheduledRun = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    return await runDueScheduledJobsOnce(actorEmail, opts);
  } finally {
    dueScheduledRun = null;
    release();
  }
}

async function runDueScheduledJobsOnce(
  actorEmail?: string,
  opts?: {
    catchUp?: boolean;
    now?: number;
    executeJob?: (
      jobKey: string,
      actorEmail?: string,
      jobOpts?: { catchUp?: boolean },
    ) => Promise<ScheduledJobOutcome>;
  },
): Promise<{ ran: string[]; skipped: string[]; errors: string[] }> {
  await ensureWorkflowTables();
  const db = await getDb();
  const jobs = (await db.all(
    "SELECT job_key, name, schedule_expr, last_run_at, next_run_at, last_run_status, last_error FROM hq_scheduled_jobs WHERE enabled = 1"
  )) as {
    job_key: string;
    name: string;
    schedule_expr: string;
    last_run_at: string | null;
    next_run_at: string | null;
    last_run_status: string | null;
    last_error: string | null;
  }[];

  const ran: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const now = opts?.now ?? Date.now();
  const ts = new Date(now).toISOString();
  const catchUp = opts?.catchUp === true;
  const execute = opts?.executeJob ?? executeScheduledJob;
  const ordered = [
    ...jobs.filter((job) => job.job_key === "db_backup"),
    ...jobs.filter((job) => job.job_key !== "db_backup"),
  ];

  for (const job of ordered) {
    const corrected = staleScheduledNextRun({
      lastRunAt: job.last_run_at,
      nextRunAt: job.next_run_at,
      scheduleExpr: job.schedule_expr,
    });
    if (corrected) {
      await db.run(
        "UPDATE hq_scheduled_jobs SET next_run_at = ? WHERE job_key = ?",
        corrected,
        job.job_key,
      );
      job.next_run_at = corrected;
    }

    const interval = scheduleIntervalMs(job.schedule_expr ?? "daily");
    const lastRun = job.last_run_at ? new Date(job.last_run_at).getTime() : 0;
    const due = !job.last_run_at || now - lastRun >= interval;
    const runNow = shouldRunScheduledJobNow({ jobKey: job.job_key, due, catchUp, now });

    if (!runNow) {
      if (catchUp && due && isFundingWarehouseJob(job.job_key)) {
        noteFundingRestartDeferral(job.job_key, now);
      }
      skipped.push(job.job_key);
      continue;
    }

    try {
      const outcome = await execute(job.job_key, actorEmail, { catchUp });
      if (job.job_key === "db_backup") {
        const record = dbBackupRunRecord({ ranAt: ts, outcome });
        await persistDbBackupRun(db, job.job_key, record);
        if (record.lastRunStatus === "failed") {
          errors.push(`${job.job_key}: ${record.lastError ?? "Database backup stopped"}`);
        } else if (record.lastRunStatus === "success") {
          ran.push(job.job_key);
          await logHqAudit({
            action: "scheduled_job_run",
            entityType: "scheduled_job",
            entityId: job.job_key,
            detail: job.name,
            actorEmail: actorEmail ?? "system",
          });
        }
        continue;
      }
      await db.run(
        "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ?, last_run_status = 'success', last_error = NULL WHERE job_key = ?",
        ts, computeNextRunAt(job.job_key, job.schedule_expr, ts), job.job_key
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
      const message = err instanceof Error ? err.message : String(err);
      if (job.job_key === "db_backup" && isDbBackupOverlapError(message)) {
        skipped.push(job.job_key);
        continue;
      }
      errors.push(`${job.job_key}: ${message}`);
      if (job.job_key === "db_backup") {
        const record = dbBackupRunRecord({ ranAt: ts, error: message });
        try {
          await persistDbBackupRun(db, job.job_key, record);
        } catch {
          errors.push(`${job.job_key}: result was not stored`);
        }
      } else {
        await db.run(
          "UPDATE hq_scheduled_jobs SET last_run_at = ?, next_run_at = ?, last_run_status = 'failed', last_error = ? WHERE job_key = ?",
          ts,
          computeNextRunAt(job.job_key, job.schedule_expr, ts),
          message,
          job.job_key
        );
      }
    }
  }

  return { ran, skipped, errors };
}

async function executeScheduledJob(
  jobKey: string,
  actorEmail?: string,
  opts?: { catchUp?: boolean },
): Promise<ScheduledJobOutcome> {
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
      const { assertOffServerUploadAuthorized, createDatabaseBackup } = await import("./hqBackupService");
      assertOffServerUploadAuthorized();
      const snapshot = await createDatabaseBackup(actorEmail ?? "scheduled");
      if (!snapshot.restoreVerified) return { status: "uploaded_unverified", uploaded: true };
      return { status: "ok", uploaded: true };
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
        includeFundingAlerts: opts?.catchUp !== true,
      });
      break;
    }
    case "onboarding_check":
      await syncApprovalTasksToWorkflows({ skipGrantApprovals: opts?.catchUp === true });
      break;
    default:
      break;
  }
  return { status: "ok" };
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
