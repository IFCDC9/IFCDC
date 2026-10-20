import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "ifcdc-hq-snapshot-card-"));
process.env.IFCDC_DATA_DIR = dataDir;

const MORNING = "daily/2026-10-19/ifcdc-2026-10-19T11-58-23-661Z.db.enc";
const AFTERNOON = "daily/2026-10-19/ifcdc-2026-10-19T15-58-58-133Z.db.enc";
const MORNING_RUN = "2026-10-19T11:58:23.661Z";
const AFTERNOON_RUN = "2026-10-19T15:58:58.133Z";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test("the snapshot card reads evidence for the run's object and leaves the other object alone", async () => {
  const {
    DB_BACKUP_APPROVAL_SENTENCE,
    databaseBackupSnapshotCard,
    listScheduledJobs,
    objectKeyForScheduledBackupRun,
  } = await import("../server/hq/workflowEngine.ts");
  const {
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    ensureBackupTables,
    persistAcceptedOffServerBackupEvidence,
    persistVerifiedOffServerObjectEvidence,
  } = await import("../server/hq/hqBackupService.ts");
  const { ensureWorkflowTables } = await import("../server/hq/workflowEngineSchema.ts");
  const { auditId, ensureHqAuditTables } = await import("../server/hq/hqAuditLog.ts");
  const { getDb } = await import("../server/db.ts");

  const audits = [
    { action: "database_backup_unverified", detail: `object=${MORNING} restoreVerified=false`, createdAt: MORNING_RUN },
    { action: "database_backup_unverified", detail: `object=${AFTERNOON} restoreVerified=false`, createdAt: AFTERNOON_RUN },
  ];
  assert.equal(objectKeyForScheduledBackupRun({ lastRunAt: AFTERNOON_RUN, audits }), AFTERNOON);
  assert.equal(objectKeyForScheduledBackupRun({ lastRunAt: MORNING_RUN, audits }), MORNING);

  const morningEvidence = {
    objectKey: MORNING,
    capturedAt: MORNING_RUN,
    databaseIntegrity: "passed",
    applicationRecovery: "readable_scheduled_jobs_and_snapshots",
    externalCopy: "not_verified",
    fullRecoveryVerified: false,
  };
  const absent = databaseBackupSnapshotCard({
    lastRunStatus: "uploaded_unverified",
    lastError: DB_BACKUP_APPROVAL_SENTENCE,
    objectKey: AFTERNOON,
    evidence: null,
  });
  assert.equal(absent?.databaseIntegrity, "not_checked");
  assert.equal(absent?.applicationRecovery, "pending");
  assert.equal(absent?.externalCopy, "pending");
  assert.equal(absent?.fullRecoveryVerified, false);
  const absentText = absent?.lines.join("\n") ?? "";
  assert.match(absentText, /Database integrity: not checked/);
  assert.match(absentText, /Application recovery: pending/);
  assert.match(absentText, /External copy: pending/);
  assert.match(absentText, /Full recovery: false/);
  assert.equal(absentText.includes("approved"), false);
  assert.equal(absentText.includes("fully verified"), false);
  assert.equal(absentText.toLowerCase().includes("complete"), false);
  assert.equal(absentText.includes(MORNING), false);

  const crossed = databaseBackupSnapshotCard({
    lastRunStatus: "uploaded_unverified",
    lastError: DB_BACKUP_APPROVAL_SENTENCE,
    objectKey: AFTERNOON,
    evidence: morningEvidence,
  });
  assert.equal(crossed?.databaseIntegrity, "not_checked");
  assert.equal(crossed?.objectKey, AFTERNOON);
  assert.equal((crossed?.lines ?? []).some((line) => line.includes("passed")), false);
  assert.equal((crossed?.lines ?? []).join("\n").includes(MORNING), false);

  const morningCard = databaseBackupSnapshotCard({
    lastRunStatus: "uploaded_unverified",
    lastError: DB_BACKUP_APPROVAL_SENTENCE,
    objectKey: MORNING,
    evidence: morningEvidence,
  });
  assert.equal(morningCard?.databaseIntegrity, "passed");
  assert.equal(morningCard?.applicationRecovery, "readable_scheduled_jobs_and_snapshots");
  assert.equal(morningCard?.fullRecoveryVerified, false);
  assert.equal(morningCard?.lines.join("\n").includes(AFTERNOON), false);

  await ensureBackupTables();
  await persistAcceptedOffServerBackupEvidence();
  const stored = await persistVerifiedOffServerObjectEvidence({
    objectKey: AFTERNOON,
    capturedAt: AFTERNOON_RUN,
    ciphertextSha256: "11".repeat(32),
    plaintextSha256: "22".repeat(32),
    integrityCheck: "ok",
    databaseIntegrity: "passed",
    applicationRecovery: "not_confirmed",
  });
  assert.equal(stored.stored, true);
  await ensureHqAuditTables();
  await ensureWorkflowTables();
  const db = await getDb();
  await db.run(
    `INSERT INTO hq_audit_log (id, action, entity_type, entity_id, detail, actor_email, created_at)
     VALUES (?, 'database_backup_unverified', 'backup', 'db_backup', ?, 'scheduled', ?)`,
    auditId(),
    `object=${MORNING} plaintext_sha256=aa ciphertext_sha256=bb restoreVerified=false`,
    MORNING_RUN,
  );
  await db.run(
    `INSERT INTO hq_audit_log (id, action, entity_type, entity_id, detail, actor_email, created_at)
     VALUES (?, 'database_backup_unverified', 'backup', 'db_backup', ?, 'scheduled', ?)`,
    auditId(),
    `object=${AFTERNOON} plaintext_sha256=cc ciphertext_sha256=dd restoreVerified=false`,
    AFTERNOON_RUN,
  );
  await db.run(
    `UPDATE hq_scheduled_jobs
     SET enabled = 1, last_run_at = ?, next_run_at = ?, last_run_status = 'uploaded_unverified', last_error = ?
     WHERE job_key = 'db_backup'`,
    AFTERNOON_RUN,
    "2026-10-20T15:58:58.133Z",
    DB_BACKUP_APPROVAL_SENTENCE,
  );

  const jobs = await listScheduledJobs();
  const backup = jobs.find((job) => String((job as { job_key?: string }).job_key) === "db_backup") as {
    last_error?: string;
    last_run_status?: string;
    backupSnapshot?: {
      objectKey: string | null;
      databaseIntegrity: string;
      applicationRecovery: string;
      externalCopy: string;
      fullRecoveryVerified: boolean;
      lines: string[];
    } | null;
  };
  assert.equal(backup.last_run_status, "uploaded_unverified");
  assert.equal(backup.last_error, DB_BACKUP_APPROVAL_SENTENCE);
  assert.notEqual(backup.last_run_status, "success");
  assert.equal(backup.backupSnapshot?.objectKey, AFTERNOON);
  assert.equal(backup.backupSnapshot?.databaseIntegrity, "passed");
  assert.equal(backup.backupSnapshot?.applicationRecovery, "pending");
  assert.equal(backup.backupSnapshot?.externalCopy, "pending");
  assert.equal(backup.backupSnapshot?.fullRecoveryVerified, false);
  const text = backup.backupSnapshot?.lines.join("\n") ?? "";
  assert.match(text, /Database integrity: passed/);
  assert.match(text, /Application recovery: pending/);
  assert.match(text, /External copy: pending/);
  assert.match(text, /Full recovery: false/);
  assert.equal(text.includes("approved"), false);
  assert.equal(text.includes("fully verified"), false);
  assert.equal(text.toLowerCase().includes("complete"), false);
  assert.equal(text.includes(MORNING), false);
  assert.equal(text.includes("readable scheduled-job"), false);

  const storedRow = await db.get<{ last_run_status: string; last_error: string }>(
    "SELECT last_run_status, last_error FROM hq_scheduled_jobs WHERE job_key = 'db_backup'",
  );
  assert.equal(storedRow?.last_run_status, "uploaded_unverified");
  assert.equal(storedRow?.last_error, DB_BACKUP_APPROVAL_SENTENCE);
  const morningCount = await db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM hq_audit_log WHERE action = ? AND entity_id = ?",
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    MORNING,
  );
  const afternoonCount = await db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM hq_audit_log WHERE action = ? AND entity_id = ?",
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    AFTERNOON,
  );
  assert.equal(morningCount?.c, 1);
  assert.equal(afternoonCount?.c, 1);

  const page = readFileSync(new URL("../client/src/pages/hq/WorkflowAutomationPage.tsx", import.meta.url), "utf8");
  assert.match(page, /backupSnapshot\?\.lines/);
  assert.match(page, /Full recovery: false/);
  assert.match(page, /job\.lastError !== "Off-server backup uploaded\. Isolated restore has not been approved\."/);
});

test("department reporting next run is last run plus the weekly interval", async () => {
  const { getDb } = await import("../server/db.ts");
  const { ensureWorkflowTables } = await import("../server/hq/workflowEngineSchema.ts");
  const { runDueScheduledJobs, staleScheduledNextRun } = await import("../server/hq/workflowEngine.ts");
  const { isFundingWarehouseJob, shouldRunScheduledJobNow } = await import("../server/hq/fundingBootGate.ts");
  await ensureWorkflowTables();
  const db = await getDb();
  await db.run("UPDATE hq_scheduled_jobs SET enabled = 0");

  const last = "2026-10-14T16:00:00.000Z";
  const staleNext = "2026-10-15T16:00:00.000Z";
  const preservedError = "department report did not finish";
  const found = await db.get<{ id: string }>("SELECT id FROM hq_scheduled_jobs WHERE job_key = 'ops_department_reporting'");
  if (!found) {
    await db.run(
      `INSERT INTO hq_scheduled_jobs
        (id, job_key, name, schedule_expr, source_module, enabled, created_at, last_run_at, next_run_at, last_run_status, last_error)
       VALUES ('ops-dept', 'ops_department_reporting', 'Department Reporting Schedule', 'weekly', 'executive', 1, ?, ?, ?, 'failed', ?)`,
      last,
      last,
      staleNext,
      preservedError,
    );
  } else {
    await db.run(
      `UPDATE hq_scheduled_jobs
       SET enabled = 1, name = 'Department Reporting Schedule', schedule_expr = 'weekly', source_module = 'executive',
           last_run_at = ?, next_run_at = ?, last_run_status = 'failed', last_error = ?
       WHERE job_key = 'ops_department_reporting'`,
      last,
      staleNext,
      preservedError,
    );
  }

  assert.equal(isFundingWarehouseJob("ops_department_reporting"), false);
  const easternEvening = Date.parse("2026-10-20T02:03:00.000Z");
  assert.equal(shouldRunScheduledJobNow({
    jobKey: "ops_department_reporting",
    due: false,
    catchUp: true,
    now: easternEvening,
  }), false);
  assert.equal(
    staleScheduledNextRun({ lastRunAt: last, nextRunAt: "2026-10-10T16:00:00.000Z", scheduleExpr: "weekly" }),
    "2026-10-21T16:00:00.000Z",
  );
  assert.equal(
    staleScheduledNextRun({ lastRunAt: last, nextRunAt: staleNext, scheduleExpr: "weekly" }),
    "2026-10-21T16:00:00.000Z",
  );

  let calls = 0;
  const corrected = await runDueScheduledJobs("system-scheduler", {
    now: easternEvening,
    catchUp: true,
    executeJob: async (jobKey) => {
      if (jobKey === "ops_department_reporting") calls += 1;
      return { status: "ok" };
    },
  });
  assert.equal(calls, 0);
  assert.equal(corrected.ran.includes("ops_department_reporting"), false);
  assert.equal(corrected.skipped.includes("ops_department_reporting"), true);
  const correctedRow = await db.get<{
    next_run_at: string;
    last_run_at: string;
    last_run_status: string;
    last_error: string;
    schedule_expr: string;
  }>("SELECT next_run_at, last_run_at, last_run_status, last_error, schedule_expr FROM hq_scheduled_jobs WHERE job_key = 'ops_department_reporting'");
  assert.equal(correctedRow?.schedule_expr, "weekly");
  assert.equal(correctedRow?.last_run_at, last);
  assert.equal(correctedRow?.next_run_at, "2026-10-21T16:00:00.000Z");
  assert.equal(correctedRow?.last_run_status, "failed");
  assert.equal(correctedRow?.last_error, preservedError);
  assert.notEqual(correctedRow?.last_run_status, "success");

  const dueNow = Date.parse("2026-10-21T16:00:00.000Z");
  const executed: string[] = [];
  const due = await runDueScheduledJobs("system-scheduler", {
    now: dueNow,
    catchUp: true,
    executeJob: async (jobKey) => {
      executed.push(jobKey);
      if (jobKey === "ops_department_reporting") throw new Error("department report stopped");
      return { status: "ok" };
    },
  });
  assert.deepEqual(executed, ["ops_department_reporting"]);
  assert.equal(due.skipped.includes("ops_department_reporting"), false);
  assert.equal(due.ran.includes("ops_department_reporting"), false);
  const failed = await db.get<{
    next_run_at: string;
    last_run_at: string;
    last_run_status: string;
    last_error: string;
  }>("SELECT next_run_at, last_run_at, last_run_status, last_error FROM hq_scheduled_jobs WHERE job_key = 'ops_department_reporting'");
  assert.equal(failed?.last_run_status, "failed");
  assert.equal(failed?.last_error, "department report stopped");
  assert.equal(failed?.last_run_at, new Date(dueNow).toISOString());
  assert.equal(failed?.next_run_at, new Date(dueNow + WEEK_MS).toISOString());
  assert.notEqual(failed?.next_run_at, new Date(dueNow + DAY_MS).toISOString());
  assert.notEqual(failed?.last_run_status, "success");

  const successAt = Date.parse("2026-10-28T16:00:00.000Z");
  const succeeded = await runDueScheduledJobs("system-scheduler", {
    now: successAt,
    catchUp: false,
    executeJob: async () => ({ status: "ok" }),
  });
  assert.equal(succeeded.ran.includes("ops_department_reporting"), true);
  assert.equal(succeeded.skipped.includes("ops_department_reporting"), false);
  const successRow = await db.get<{ next_run_at: string; last_run_status: string }>(
    "SELECT next_run_at, last_run_status FROM hq_scheduled_jobs WHERE job_key = 'ops_department_reporting'",
  );
  assert.equal(successRow?.last_run_status, "success");
  assert.equal(successRow?.next_run_at, new Date(successAt + WEEK_MS).toISOString());
  assert.notEqual(successRow?.next_run_at, new Date(successAt + DAY_MS).toISOString());

  const realAt = Date.parse("2026-11-04T16:00:00.000Z");
  const real = await runDueScheduledJobs("system-scheduler", { now: realAt, catchUp: true });
  assert.equal(real.ran.includes("ops_department_reporting"), true);
  assert.equal(real.errors.some((error) => error.startsWith("ops_department_reporting")), false);
  assert.equal(real.skipped.includes("ops_department_reporting"), false);
  const realRow = await db.get<{ next_run_at: string; last_run_status: string }>(
    "SELECT next_run_at, last_run_status FROM hq_scheduled_jobs WHERE job_key = 'ops_department_reporting'",
  );
  assert.equal(realRow?.last_run_status, "success");
  assert.equal(realRow?.next_run_at, new Date(realAt + WEEK_MS).toISOString());

  const ops = readFileSync(new URL("../server/hq/executiveOperationsFoundation.ts", import.meta.url), "utf8");
  assert.match(ops, /key: "ops_department_reporting", name: "Department Reporting Schedule", schedule: "weekly"/);
});
