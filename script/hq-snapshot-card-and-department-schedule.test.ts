import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "ifcdc-hq-snapshot-card-"));
process.env.IFCDC_DATA_DIR = dataDir;

const MORNING = "daily/2026-10-19/ifcdc-2026-10-19T11-58-23-661Z.db.enc";
const AFTERNOON = "daily/2026-10-19/ifcdc-2026-10-19T15-58-58-133Z.db.enc";
const CLOSE_EARLY = "daily/2026-10-19/ifcdc-2026-10-19T12-30-00-000Z.db.enc";
const CLOSE_LATE = "daily/2026-10-19/ifcdc-2026-10-19T14-20-00-000Z.db.enc";
const MORNING_RUN = "2026-10-19T11:58:23.661Z";
const AFTERNOON_RUN = "2026-10-19T15:58:58.133Z";
const CLOSE_RUN = "2026-10-19T13:00:00.000Z";
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
  const { ensureHqAuditTables } = await import("../server/hq/hqAuditLog.ts");
  const { getDb } = await import("../server/db.ts");

  const audits = [
    { id: "morning-audit", action: "database_backup_unverified", detail: `object=${MORNING} restoreVerified=false`, createdAt: MORNING_RUN },
    { id: "afternoon-audit", action: "database_backup_unverified", detail: `object=${AFTERNOON} restoreVerified=false`, createdAt: AFTERNOON_RUN },
    { id: "close-early-audit", action: "database_backup_unverified", detail: `object=${CLOSE_EARLY} restoreVerified=false`, createdAt: "2026-10-19T12:30:00.000Z" },
    { id: "close-late-audit", action: "database_backup_unverified", detail: `object=${CLOSE_LATE} restoreVerified=false`, createdAt: "2026-10-19T14:20:00.000Z" },
  ];
  assert.equal(objectKeyForScheduledBackupRun({ storedObjectKey: null, storedAuditId: null, audits }), null);
  assert.equal(objectKeyForScheduledBackupRun({ audits: [audits[0]] }), null);
  assert.equal(
    objectKeyForScheduledBackupRun({
      audits: audits.filter((row) => row.id === "close-early-audit" || row.id === "close-late-audit"),
    }),
    null,
  );
  assert.equal(objectKeyForScheduledBackupRun({ storedObjectKey: CLOSE_LATE, audits }), CLOSE_LATE);
  assert.equal(
    objectKeyForScheduledBackupRun({ storedObjectKey: CLOSE_LATE, storedAuditId: "close-early-audit", audits }),
    CLOSE_LATE,
  );
  assert.equal(objectKeyForScheduledBackupRun({ storedAuditId: "afternoon-audit", audits }), AFTERNOON);
  assert.equal(objectKeyForScheduledBackupRun({ storedAuditId: "morning-audit", audits }), MORNING);
  assert.notEqual(objectKeyForScheduledBackupRun({ storedAuditId: "afternoon-audit", audits }), MORNING);

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
  assert.equal(absent?.databaseIntegrity, "unknown");
  assert.equal(absent?.applicationRecovery, "pending");
  assert.equal(absent?.externalCopy, "pending");
  assert.equal(absent?.fullRecoveryVerified, false);
  const absentText = absent?.lines.join("\n") ?? "";
  assert.match(absentText, /Verification: unknown/);
  assert.match(absentText, /Database integrity: unknown/);
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
  assert.equal(crossed?.databaseIntegrity, "unknown");
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

  const closeEarlyEvidence = {
    objectKey: CLOSE_EARLY,
    capturedAt: "2026-10-19T12:30:00.000Z",
    databaseIntegrity: "passed",
    applicationRecovery: "not_confirmed",
    externalCopy: "not_verified",
    fullRecoveryVerified: false,
  };
  const closeLateEvidence = {
    objectKey: CLOSE_LATE,
    capturedAt: "2026-10-19T14:20:00.000Z",
    databaseIntegrity: "passed",
    applicationRecovery: "not_confirmed",
    externalCopy: "not_verified",
    fullRecoveryVerified: false,
  };
  const unbound = databaseBackupSnapshotCard({
    lastRunStatus: "uploaded_unverified",
    lastError: DB_BACKUP_APPROVAL_SENTENCE,
    objectKey: objectKeyForScheduledBackupRun({
      audits: audits.filter((row) => row.id === "close-early-audit" || row.id === "close-late-audit"),
    }),
    evidence: closeEarlyEvidence,
  });
  assert.equal(unbound?.objectKey, null);
  assert.equal(unbound?.databaseIntegrity, "unknown");
  assert.equal((unbound?.lines ?? []).some((line) => line.includes("passed")), false);
  assert.equal((unbound?.lines ?? []).join("\n").includes(CLOSE_EARLY), false);
  const boundLate = databaseBackupSnapshotCard({
    lastRunStatus: "uploaded_unverified",
    lastError: DB_BACKUP_APPROVAL_SENTENCE,
    objectKey: objectKeyForScheduledBackupRun({ storedObjectKey: CLOSE_LATE, audits }),
    evidence: closeLateEvidence,
  });
  assert.equal(boundLate?.objectKey, CLOSE_LATE);
  assert.equal(boundLate?.databaseIntegrity, "passed");
  assert.equal(boundLate?.applicationRecovery, "pending");
  assert.equal(boundLate?.externalCopy, "pending");
  assert.equal(boundLate?.fullRecoveryVerified, false);
  assert.equal((boundLate?.lines ?? []).join("\n").includes(CLOSE_EARLY), false);

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
  const closeEarlyStored = await persistVerifiedOffServerObjectEvidence({
    objectKey: CLOSE_EARLY,
    capturedAt: "2026-10-19T12:30:00.000Z",
    ciphertextSha256: "33".repeat(32),
    plaintextSha256: "34".repeat(32),
    integrityCheck: "ok",
    databaseIntegrity: "passed",
    applicationRecovery: "not_confirmed",
  });
  const closeLateStored = await persistVerifiedOffServerObjectEvidence({
    objectKey: CLOSE_LATE,
    capturedAt: "2026-10-19T14:20:00.000Z",
    ciphertextSha256: "44".repeat(32),
    plaintextSha256: "45".repeat(32),
    integrityCheck: "ok",
    databaseIntegrity: "passed",
    applicationRecovery: "not_confirmed",
  });
  assert.equal(closeEarlyStored.stored, true);
  assert.equal(closeLateStored.stored, true);
  await ensureHqAuditTables();
  await ensureWorkflowTables();
  const db = await getDb();
  await db.run(
    `INSERT INTO hq_audit_log (id, action, entity_type, entity_id, detail, actor_email, created_at)
     VALUES ('morning-audit', 'database_backup_unverified', 'backup', 'db_backup', ?, 'scheduled', ?)`,
    `object=${MORNING} plaintext_sha256=aa ciphertext_sha256=bb restoreVerified=false`,
    MORNING_RUN,
  );
  await db.run(
    `INSERT INTO hq_audit_log (id, action, entity_type, entity_id, detail, actor_email, created_at)
     VALUES ('afternoon-audit', 'database_backup_unverified', 'backup', 'db_backup', ?, 'scheduled', ?)`,
    `object=${AFTERNOON} plaintext_sha256=cc ciphertext_sha256=dd restoreVerified=false`,
    AFTERNOON_RUN,
  );
  await db.run(
    `INSERT INTO hq_audit_log (id, action, entity_type, entity_id, detail, actor_email, created_at)
     VALUES ('close-early-audit', 'database_backup_unverified', 'backup', 'db_backup', ?, 'scheduled', ?)`,
    `object=${CLOSE_EARLY} restoreVerified=false`,
    "2026-10-19T12:30:00.000Z",
  );
  await db.run(
    `INSERT INTO hq_audit_log (id, action, entity_type, entity_id, detail, actor_email, created_at)
     VALUES ('close-late-audit', 'database_backup_unverified', 'backup', 'db_backup', ?, 'scheduled', ?)`,
    `object=${CLOSE_LATE} restoreVerified=false`,
    "2026-10-19T14:20:00.000Z",
  );
  await db.run(
    `UPDATE hq_scheduled_jobs
     SET enabled = 1, last_run_at = ?, next_run_at = ?, last_run_status = 'uploaded_unverified', last_error = ?,
         backup_object_key = NULL, backup_audit_id = NULL
     WHERE job_key = 'db_backup'`,
    CLOSE_RUN,
    "2026-10-20T13:00:00.000Z",
    DB_BACKUP_APPROVAL_SENTENCE,
  );

  type SnapshotJob = {
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
  const readBackup = async () => {
    const jobs = await listScheduledJobs();
    return jobs.find((job) => String((job as { job_key?: string }).job_key) === "db_backup") as SnapshotJob;
  };

  const unboundJob = await readBackup();
  assert.equal(unboundJob.last_run_status, "uploaded_unverified");
  assert.equal(unboundJob.last_error, DB_BACKUP_APPROVAL_SENTENCE);
  assert.notEqual(unboundJob.last_run_status, "success");
  assert.equal(unboundJob.backupSnapshot?.objectKey, null);
  assert.equal(unboundJob.backupSnapshot?.databaseIntegrity, "unknown");
  assert.equal(unboundJob.backupSnapshot?.applicationRecovery, "pending");
  assert.equal(unboundJob.backupSnapshot?.externalCopy, "pending");
  assert.equal(unboundJob.backupSnapshot?.fullRecoveryVerified, false);
  const unboundText = unboundJob.backupSnapshot?.lines.join("\n") ?? "";
  assert.match(unboundText, /Verification: unknown/);
  assert.equal(unboundText.includes("passed"), false);
  assert.equal(unboundText.includes("approved"), false);
  assert.equal(unboundText.includes(CLOSE_EARLY), false);
  assert.equal(unboundText.includes(CLOSE_LATE), false);

  await db.run(
    `UPDATE hq_scheduled_jobs
     SET last_run_at = ?, backup_object_key = NULL, backup_audit_id = 'afternoon-audit'
     WHERE job_key = 'db_backup'`,
    AFTERNOON_RUN,
  );
  const byAudit = await readBackup();
  assert.equal(byAudit.backupSnapshot?.objectKey, AFTERNOON);
  assert.equal(byAudit.backupSnapshot?.databaseIntegrity, "passed");
  assert.equal(byAudit.backupSnapshot?.applicationRecovery, "pending");
  assert.equal(byAudit.backupSnapshot?.externalCopy, "pending");
  assert.equal(byAudit.backupSnapshot?.fullRecoveryVerified, false);
  assert.equal((byAudit.backupSnapshot?.lines ?? []).join("\n").includes(MORNING), false);
  assert.equal(byAudit.last_run_status, "uploaded_unverified");
  assert.equal(byAudit.last_error, DB_BACKUP_APPROVAL_SENTENCE);

  await db.run(
    "UPDATE hq_scheduled_jobs SET backup_object_key = ?, backup_audit_id = 'close-early-audit' WHERE job_key = 'db_backup'",
    CLOSE_LATE,
  );
  const separated = await readBackup();
  assert.equal(separated.backupSnapshot?.objectKey, CLOSE_LATE);
  assert.equal(separated.backupSnapshot?.databaseIntegrity, "passed");
  assert.equal(separated.backupSnapshot?.applicationRecovery, "pending");
  assert.equal(separated.backupSnapshot?.externalCopy, "pending");
  assert.equal((separated.backupSnapshot?.lines ?? []).join("\n").includes(CLOSE_EARLY), false);
  assert.equal((separated.backupSnapshot?.lines ?? []).join("\n").includes(MORNING), false);
  assert.equal((separated.backupSnapshot?.lines ?? []).join("\n").includes(AFTERNOON), false);

  await db.run(
    "UPDATE hq_scheduled_jobs SET last_run_at = ?, backup_object_key = ?, backup_audit_id = NULL WHERE job_key = 'db_backup'",
    MORNING_RUN,
    MORNING,
  );
  const morningJob = await readBackup();
  assert.equal(morningJob.backupSnapshot?.objectKey, MORNING);
  assert.equal(morningJob.backupSnapshot?.databaseIntegrity, "passed");
  assert.equal(morningJob.backupSnapshot?.applicationRecovery, "readable_scheduled_jobs_and_snapshots");
  assert.equal(morningJob.backupSnapshot?.fullRecoveryVerified, false);
  const morningText = morningJob.backupSnapshot?.lines.join("\n") ?? "";
  assert.match(morningText, /Database integrity: passed/);
  assert.equal(morningText.includes(AFTERNOON), false);
  assert.equal(morningText.includes(CLOSE_EARLY), false);
  assert.equal(morningJob.last_run_status, "uploaded_unverified");
  assert.equal(morningJob.last_error, DB_BACKUP_APPROVAL_SENTENCE);

  await db.run(
    "UPDATE hq_scheduled_jobs SET last_run_at = ?, backup_object_key = ?, backup_audit_id = NULL WHERE job_key = 'db_backup'",
    AFTERNOON_RUN,
    AFTERNOON,
  );
  const backup = await readBackup();
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
  assert.match(page, /Verification: unknown/);
});

test("a db_backup upload stores its object key and the card reads only that object", async () => {
  const { DB_BACKUP_UNVERIFIED_ERROR, listScheduledJobs, runDueScheduledJobs } = await import("../server/hq/workflowEngine.ts");
  const { ensureWorkflowTables } = await import("../server/hq/workflowEngineSchema.ts");
  const { getDb } = await import("../server/db.ts");
  await ensureWorkflowTables();
  const db = await getDb();
  await db.run("UPDATE hq_scheduled_jobs SET enabled = 0");
  await db.run(
    `UPDATE hq_scheduled_jobs
     SET enabled = 1, last_run_at = NULL, next_run_at = NULL, last_run_status = NULL, last_error = NULL,
         backup_object_key = NULL, backup_audit_id = NULL
     WHERE job_key = 'db_backup'`,
  );
  const ranAt = Date.parse("2026-10-19T16:05:00.000Z");
  const executed: string[] = [];
  const due = await runDueScheduledJobs("system-scheduler", {
    now: ranAt,
    catchUp: false,
    executeJob: async (jobKey) => {
      executed.push(jobKey);
      return {
        status: "uploaded_unverified",
        uploaded: true,
        objectKey: AFTERNOON,
        auditId: "afternoon-audit",
      };
    },
  });
  assert.deepEqual(executed, ["db_backup"]);
  assert.equal(due.ran.includes("db_backup"), false);
  const row = await db.get<{
    last_run_status: string;
    last_error: string;
    backup_object_key: string | null;
    backup_audit_id: string | null;
  }>(
    "SELECT last_run_status, last_error, backup_object_key, backup_audit_id FROM hq_scheduled_jobs WHERE job_key = 'db_backup'",
  );
  assert.equal(row?.last_run_status, "uploaded_unverified");
  assert.equal(row?.last_error, DB_BACKUP_UNVERIFIED_ERROR);
  assert.notEqual(row?.last_run_status, "success");
  assert.equal(row?.backup_object_key, AFTERNOON);
  assert.equal(row?.backup_audit_id, "afternoon-audit");
  const jobs = await listScheduledJobs();
  const backup = jobs.find((job) => String((job as { job_key?: string }).job_key) === "db_backup") as {
    backupSnapshot?: { objectKey: string | null; databaseIntegrity: string; applicationRecovery: string; externalCopy: string; fullRecoveryVerified: boolean; lines: string[] } | null;
  };
  assert.equal(backup.backupSnapshot?.objectKey, AFTERNOON);
  assert.equal(backup.backupSnapshot?.databaseIntegrity, "passed");
  assert.equal(backup.backupSnapshot?.applicationRecovery, "pending");
  assert.equal(backup.backupSnapshot?.externalCopy, "pending");
  assert.equal(backup.backupSnapshot?.fullRecoveryVerified, false);
  const text = backup.backupSnapshot?.lines.join("\n") ?? "";
  assert.equal(text.includes(MORNING), false);
  assert.equal(text.includes(CLOSE_EARLY), false);
  assert.equal(text.includes(CLOSE_LATE), false);
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
