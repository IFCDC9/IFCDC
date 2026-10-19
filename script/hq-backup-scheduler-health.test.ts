import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

const dataDir = mkdtempSync(join(tmpdir(), "ifcdc-hq-scheduler-health-"));
process.env.IFCDC_DATA_DIR = dataDir;

const LAST_RUN = "2026-10-18T15:56:17.298Z";
const STALE_NEXT = "2026-10-14T04:43:30.567Z";
const CORRECTED_NEXT = "2026-10-19T15:56:17.298Z";
const NOT_DUE = Date.parse("2026-10-19T12:00:00.000Z");
const DUE = Date.parse("2026-10-19T23:23:00.000Z");
const OLD_ERROR = "hq-backup stage=backup operation=vacuum-into pathClass=data-disk-and-temp code=SQLITE_IOERR extended=none message=unavailable";
const OCTOBER_13_ID = "october-13-on-disk";

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test("application recovery criteria stay separate from integrity and do not open the production path", async () => {
  const { applicationRecoveryDecision, assessRestoredApplicationDatabase } = await import("../server/hq/hqBackupService.ts");
  const blocked = applicationRecoveryDecision({
    integrity: "fail",
    tableNames: ["hq_scheduled_jobs", "hq_backup_snapshots"],
    scheduledJobQueryOk: true,
    snapshotQueryOk: true,
  });
  assert.equal(blocked.databaseIntegrity, "failed");
  assert.equal(blocked.applicationRecovery, "not_run");
  assert.equal(blocked.readApplicationTables, false);

  const root = mkdtempSync(join(tmpdir(), "ifcdc-recovery-"));
  try {
    const productionPath = join(root, "production.db");
    const fixturePath = join(root, "fixture.db");
    let opens = 0;
    const refused = assessRestoredApplicationDatabase(productionPath, productionPath, () => {
      opens += 1;
      throw new Error("production database was opened");
    });
    assert.equal(opens, 0);
    assert.equal(refused.productionPathOpened, false);
    assert.equal(refused.applicationRecovery, "not_run");
    assert.match(refused.detail, /production database path/);

    const missing = new Database(fixturePath);
    missing.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
    missing.close();
    const missingResult = assessRestoredApplicationDatabase(fixturePath, productionPath);
    assert.equal(missingResult.databaseIntegrity, "passed");
    assert.equal(missingResult.applicationRecovery, "failed");
    assert.equal(missingResult.queriedTables.includes("hq_scheduled_jobs"), false);
    assert.equal(missingResult.fullRecoveryVerified, false);
    assert.equal(missingResult.externalCopy, "not_verified");

    const readable = new Database(fixturePath);
    readable.exec(`
      CREATE TABLE hq_scheduled_jobs (job_key TEXT);
      CREATE TABLE hq_backup_snapshots (id TEXT);
      INSERT INTO hq_scheduled_jobs (job_key) VALUES ('db_backup');
      INSERT INTO hq_backup_snapshots (id) VALUES ('snap');
    `);
    readable.close();
    const readableResult = assessRestoredApplicationDatabase(fixturePath, productionPath);
    assert.equal(readableResult.databaseIntegrity, "passed");
    assert.equal(readableResult.applicationRecovery, "readable_scheduled_jobs_and_snapshots");
    assert.deepEqual(readableResult.queriedTables, ["hq_scheduled_jobs", "hq_backup_snapshots"]);
    assert.equal(readableResult.fullRecoveryVerified, false);
    assert.equal(readableResult.externalCopy, "not_verified");
    assert.equal(readableResult.productionPathOpened, false);

    let prepared = 0;
    const gated = assessRestoredApplicationDatabase(fixturePath, productionPath, () => ({
      pragma() {
        return "fail";
      },
      prepare() {
        prepared += 1;
        throw new Error("application table was read before integrity passed");
      },
      close() {
        return undefined;
      },
    }) as unknown as Database.Database);
    assert.equal(prepared, 0);
    assert.equal(gated.databaseIntegrity, "failed");
    assert.equal(gated.applicationRecovery, "not_run");
    assert.deepEqual(gated.queriedTables, []);

    const unread = assessRestoredApplicationDatabase(join(root, "missing.db"), productionPath);
    assert.equal(unread.applicationRecovery, "not_run");
    assert.deepEqual(unread.queriedTables, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a due db_backup tick corrects a stale screen time and persists an honest result", async () => {
  const { getDb } = await import("../server/db.ts");
  const { ensureWorkflowTables } = await import("../server/hq/workflowEngineSchema.ts");
  const {
    DB_BACKUP_UNVERIFIED_ERROR,
    runDueScheduledJobs,
  } = await import("../server/hq/workflowEngine.ts");
  const {
    ACCEPTED_OFFSERVER_BACKUP,
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    ensureBackupTables,
    getBackupHealth,
    persistAcceptedOffServerBackupEvidence,
  } = await import("../server/hq/hqBackupService.ts");

  await ensureWorkflowTables();
  const db = await getDb();
  assert.equal(String(process.env.IFCDC_DATA_DIR), dataDir);

  async function readBackup() {
    return db.get<{
      enabled: number;
      last_run_at: string | null;
      next_run_at: string | null;
      last_run_status: string | null;
      last_error: string | null;
    }>("SELECT enabled, last_run_at, next_run_at, last_run_status, last_error FROM hq_scheduled_jobs WHERE job_key = 'db_backup'");
  }

  async function resetPreFixRow() {
    await db.run("UPDATE hq_scheduled_jobs SET enabled = 0");
    await db.run("DELETE FROM hq_scheduled_jobs WHERE job_key = 'blocker_job'");
    await db.run(
      "UPDATE hq_scheduled_jobs SET enabled = 1, last_run_at = ?, next_run_at = ?, last_run_status = 'failed', last_error = ? WHERE job_key = 'db_backup'",
      LAST_RUN,
      STALE_NEXT,
      OLD_ERROR,
    );
  }

  await resetPreFixRow();
  let calls = 0;
  const corrected = await runDueScheduledJobs("system-scheduler", {
    now: NOT_DUE,
    executeJob: async () => {
      calls += 1;
      return { status: "ok", uploaded: true };
    },
  });
  assert.equal(calls, 0);
  assert.equal(corrected.skipped.includes("db_backup"), true);
  const correctedRow = await readBackup();
  assert.equal(correctedRow?.next_run_at, CORRECTED_NEXT);
  assert.equal(correctedRow?.last_run_at, LAST_RUN);
  assert.equal(correctedRow?.last_run_status, "failed");
  assert.equal(correctedRow?.last_error, OLD_ERROR);
  assert.notEqual(correctedRow?.last_run_status, "success");

  await resetPreFixRow();
  const failed = await runDueScheduledJobs("system-scheduler", {
    now: DUE,
    executeJob: async () => {
      throw new Error("Database backup stopped: off-server upload is not authorized (IFCDC_DB_BACKUP_UPLOAD_ENABLED)");
    },
  });
  assert.equal(failed.ran.includes("db_backup"), false);
  const failedRow = await readBackup();
  assert.equal(failedRow?.last_run_at, "2026-10-19T23:23:00.000Z");
  assert.equal(failedRow?.next_run_at, "2026-10-20T23:23:00.000Z");
  assert.equal(failedRow?.last_run_status, "failed");
  assert.match(failedRow?.last_error ?? "", /IFCDC_DB_BACKUP_UPLOAD_ENABLED/);
  assert.equal(failedRow?.last_error?.includes("success"), false);
  assert.notEqual(failedRow?.last_run_status, "success");

  await resetPreFixRow();
  await runDueScheduledJobs("system-scheduler", {
    now: DUE,
    executeJob: async () => ({ status: "ok" }),
  });
  const missingUpload = await readBackup();
  assert.equal(missingUpload?.last_run_status, "failed");
  assert.match(missingUpload?.last_error ?? "", /off-server upload did not happen/);
  assert.equal(missingUpload?.next_run_at, "2026-10-20T23:23:00.000Z");
  assert.notEqual(missingUpload?.last_run_status, "success");

  await resetPreFixRow();
  await runDueScheduledJobs("system-scheduler", {
    now: DUE,
    executeJob: async () => ({ status: "uploaded_unverified", uploaded: true }),
  });
  const uploaded = await readBackup();
  assert.equal(uploaded?.last_run_status, "uploaded_unverified");
  assert.equal(uploaded?.last_error, DB_BACKUP_UNVERIFIED_ERROR);
  assert.equal(uploaded?.next_run_at, "2026-10-20T23:23:00.000Z");
  assert.notEqual(uploaded?.last_run_status, "success");
  assert.equal(uploaded?.last_error?.includes("success"), false);

  await resetPreFixRow();
  await runDueScheduledJobs("system-scheduler", {
    now: DUE,
    executeJob: async () => {
      throw new Error("Database backup stopped: a backup is already running");
    },
  });
  const overlapped = await readBackup();
  assert.equal(overlapped?.last_run_at, LAST_RUN);
  assert.equal(overlapped?.last_run_status, "failed");
  assert.equal(overlapped?.last_error, OLD_ERROR);
  assert.equal(overlapped?.next_run_at, CORRECTED_NEXT);
  assert.notEqual(overlapped?.last_run_status, "success");

  await resetPreFixRow();
  await db.run(
    `INSERT INTO hq_scheduled_jobs (id, job_key, name, schedule_expr, enabled, created_at)
     VALUES ('blocker', 'blocker_job', 'Blocker', 'daily', 1, ?)`,
    LAST_RUN,
  );
  const order: string[] = [];
  let releaseBlocker: () => void = () => undefined;
  const blocker = new Promise<void>((resolve) => {
    releaseBlocker = resolve;
  });
  const pending = runDueScheduledJobs("system-scheduler", {
    now: DUE,
    executeJob: async (jobKey) => {
      order.push(jobKey);
      if (jobKey !== "db_backup") await blocker;
      return { status: "uploaded_unverified", uploaded: true };
    },
  });
  const started = Date.now();
  let during = await readBackup();
  while (during?.last_run_status !== "uploaded_unverified" && Date.now() - started < 5000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    during = await readBackup();
  }
  assert.equal(order[0], "db_backup");
  assert.equal(during?.last_run_status, "uploaded_unverified");
  assert.equal(during?.next_run_at, "2026-10-20T23:23:00.000Z");
  releaseBlocker();
  await pending;

  await resetPreFixRow();
  let backupCalls = 0;
  let releaseRun: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  const first = runDueScheduledJobs("system-scheduler", {
    now: DUE,
    executeJob: async () => {
      backupCalls += 1;
      await gate;
      return { status: "uploaded_unverified", uploaded: true };
    },
  });
  const waitForCall = Date.now();
  while (backupCalls < 1 && Date.now() - waitForCall < 5000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const second = await runDueScheduledJobs("system-scheduler", {
    now: DUE,
    executeJob: async () => {
      backupCalls += 1;
      return { status: "ok", uploaded: true };
    },
  });
  assert.deepEqual(second.skipped, ["in_flight"]);
  assert.equal(backupCalls, 1);
  releaseRun();
  await first;
  const singleRun = await readBackup();
  assert.equal(singleRun?.last_run_status, "uploaded_unverified");
  assert.notEqual(singleRun?.last_run_status, "success");

  await ensureBackupTables();
  await db.run(
    `INSERT INTO hq_backup_snapshots (id, filename, file_path, size_bytes, status, created_at)
     VALUES (?, 'ifcdc-2026-10-13T04-43-20-976Z.db', 'not-a-live-database', 761483264, 'healthy', '2026-10-13T04:43:20.976Z')`,
    OCTOBER_13_ID,
  );
  await persistAcceptedOffServerBackupEvidence();
  await persistAcceptedOffServerBackupEvidence();
  const evidenceCount = await db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM hq_audit_log WHERE action = ? AND entity_id = ?",
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    ACCEPTED_OFFSERVER_BACKUP.objectKey,
  );
  assert.equal(evidenceCount?.c, 1);
  const health = await getBackupHealth();
  const stillThere = await db.get<{ id: string }>("SELECT id FROM hq_backup_snapshots WHERE id = ?", OCTOBER_13_ID);
  assert.equal(stillThere?.id, OCTOBER_13_ID);
  assert.equal(health.offServerRestoreVerified, false);
  assert.equal(health.offServerBackup.databaseIntegrity, "passed");
  assert.equal(health.offServerBackup.applicationRecovery, "readable_scheduled_jobs_and_snapshots");
  assert.notEqual(health.offServerBackup.applicationRecovery, "passed");
  assert.equal(health.offServerBackup.externalCopy, "not_verified");
  assert.equal(health.offServerBackup.fullRecoveryVerified, false);
  assert.equal(health.offServerBackup.objectKey, "daily/2026-10-19/ifcdc-2026-10-19T11-58-23-661Z.db.enc");
  assert.equal(health.offServerBackup.sourceBytes, 794116132);
  assert.equal(health.offServerBackup.ciphertextBytes, 794116132);
  assert.equal(health.offServerBackup.plaintextBytes, 794116096);
  assert.equal(health.offServerBackup.ciphertextSha256, "82a36aa544d787592e92f29c32241809ac3e35f60c3c6d8b4c7a85eb23b76dd8");
  assert.equal(health.offServerBackup.integrityCheck, "ok");
  assert.equal(health.offServerBackup.plaintextDeleted, true);
  assert.equal(health.offServerBackup.productionOverwritten, false);
  assert.equal(health.lastBackup?.filename, health.offServerBackup.objectKey);
  assert.equal(health.onDiskSnapshot?.filename, "ifcdc-2026-10-13T04-43-20-976Z.db");
  assert.match(health.message, /External copy is not verified/);
  assert.equal(health.message.includes("external copy verified"), false);

  const index = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
  const boot = readFileSync(new URL("../server/bootstrap/initializeHqModules.ts", import.meta.url), "utf8");
  const healthSource = readFileSync(new URL("../server/hq/hqBackupService.ts", import.meta.url), "utf8");
  const healthStart = healthSource.indexOf("export async function getBackupHealth");
  const healthFn = healthSource.slice(healthStart);
  assert.ok(healthStart > healthSource.indexOf("export async function restoreFromBackup"));
  assert.match(index, /startHqScheduler\(\)/);
  assert.match(index, /\[HQ Scheduler\] Failed to start/);
  assert.equal(boot.includes("startHqScheduler"), false);
  assert.equal(boot.includes(".catch(() => undefined)"), false);
  assert.equal(healthFn.includes("assessRestoredApplicationDatabase"), false);
  assert.equal(healthFn.includes("VACUUM"), false);
  const page = readFileSync(new URL("../client/src/pages/hq/SecurityCenterPage.tsx", import.meta.url), "utf8");
  assert.match(page, /Database integrity:/);
  assert.match(page, /readable scheduled-job and snapshot rows/);
  assert.match(page, /External copy:/);
  assert.match(page, /Full recovery:/);
  assert.match(page, /not verified/);
});
