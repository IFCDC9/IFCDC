import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "ifcdc-hq-evidence-split-"));
process.env.IFCDC_DATA_DIR = dataDir;

const MORNING_KEY = "daily/2026-10-19/ifcdc-2026-10-19T11-58-23-661Z.db.enc";
const AFTERNOON_KEY = "daily/2026-10-19/ifcdc-2026-10-19T15-58-58-133Z.db.enc";
const OTHER_KEY = "daily/2026-10-18/ifcdc-2026-10-18T01-02-03-004Z.db.enc";
const MORNING_HASH = "82a36aa544d787592e92f29c32241809ac3e35f60c3c6d8b4c7a85eb23b76dd8";
const AFTERNOON_HASH = "11".repeat(32);
const AFTERNOON_PLAINTEXT_HASH = "22".repeat(32);
const OCTOBER_13_ID = "october-13-on-disk";

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test("morning evidence stays on its key and the 15:58:58Z key can be stored only with its own hash", async () => {
  const { getDb } = await import("../server/db.ts");
  const {
    ACCEPTED_OFFSERVER_BACKUP,
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    ensureBackupTables,
    getBackupHealth,
    parseStoredOffServerEvidence,
    persistAcceptedOffServerBackupEvidence,
    persistVerifiedOffServerObjectEvidence,
  } = await import("../server/hq/hqBackupService.ts");

  await ensureBackupTables();
  await persistAcceptedOffServerBackupEvidence();
  const db = await getDb();
  await db.run(
    `INSERT INTO hq_backup_snapshots (id, filename, file_path, size_bytes, status, created_at)
     VALUES (?, 'ifcdc-2026-10-13T04-43-20-976Z.db', 'not-a-live-database', 761483264, 'healthy', '2026-10-13T04:43:20.976Z')`,
    OCTOBER_13_ID,
  );

  const morningBefore = await getBackupHealth();
  assert.equal(morningBefore.offServerBackup.objectKey, MORNING_KEY);
  assert.equal(morningBefore.offServerBackup.ciphertextSha256, MORNING_HASH);
  assert.equal(morningBefore.offServerBackup.integrityCheck, "ok");
  assert.equal(morningBefore.offServerBackup.databaseIntegrity, "passed");
  assert.equal(morningBefore.offServerBackup.fullRecoveryVerified, false);
  assert.equal(morningBefore.offServerBackup.externalCopy, "not_verified");
  assert.equal(
    morningBefore.offServerEvidence.some((item: { objectKey: string }) => item.objectKey === AFTERNOON_KEY),
    false,
  );
  assert.equal(
    morningBefore.offServerEvidence.find((item: { objectKey: string }) => item.objectKey === AFTERNOON_KEY),
    undefined,
  );
  assert.equal(morningBefore.offServerBackup.applicationRecovery, "readable_scheduled_jobs_and_snapshots");
  assert.equal(morningBefore.offServerBackup.sourceBytes, 794116132);
  assert.equal(parseStoredOffServerEvidence(JSON.stringify({
    objectKey: AFTERNOON_KEY,
    bucket: "ifcdc-hq-db-backups",
    capturedAt: "2026-10-19T15:58:58.133Z",
    sourceBytes: 1,
    ciphertextBytes: 1,
    ciphertextSha256: MORNING_HASH,
    plaintextBytes: 1,
    integrityCheck: "ok",
    databaseIntegrity: "passed",
    applicationRecovery: "readable_scheduled_jobs_and_snapshots",
    externalCopy: "not_verified",
    fullRecoveryVerified: false,
    offServerRestoreVerified: false,
    productionOverwritten: false,
    productionDatabaseOpened: false,
  }), AFTERNOON_KEY), null);

  const borrowed = await persistVerifiedOffServerObjectEvidence({
    objectKey: AFTERNOON_KEY,
    capturedAt: "2026-10-19T15:58:58.133Z",
    ciphertextSha256: MORNING_HASH,
    plaintextSha256: AFTERNOON_PLAINTEXT_HASH,
    sourceBytes: 10,
    ciphertextBytes: 10,
    plaintextBytes: 8,
    integrityCheck: "ok",
    databaseIntegrity: "passed",
    applicationRecovery: "readable_scheduled_jobs_and_snapshots",
  });
  assert.equal(borrowed.stored, false);
  assert.equal(borrowed.reason, "morning_hash");

  const failedIntegrity = await persistVerifiedOffServerObjectEvidence({
    objectKey: AFTERNOON_KEY,
    capturedAt: "2026-10-19T15:58:58.133Z",
    ciphertextSha256: AFTERNOON_HASH,
    sourceBytes: 10,
    ciphertextBytes: 10,
    plaintextBytes: 8,
    integrityCheck: "failed",
    databaseIntegrity: "passed",
    applicationRecovery: "readable_scheduled_jobs_and_snapshots",
  });
  assert.equal(failedIntegrity.stored, false);
  assert.equal(failedIntegrity.reason, "integrity_check");

  const copiedRecovery = await persistVerifiedOffServerObjectEvidence({
    objectKey: AFTERNOON_KEY,
    capturedAt: "2026-10-19T15:58:58.133Z",
    ciphertextSha256: AFTERNOON_HASH,
    plaintextSha256: AFTERNOON_PLAINTEXT_HASH,
    sourceBytes: null,
    ciphertextBytes: null,
    plaintextBytes: null,
    integrityCheck: "ok",
    databaseIntegrity: "passed",
    applicationRecovery: "readable_scheduled_jobs_and_snapshots",
  });
  assert.equal(copiedRecovery.stored, false);
  assert.equal(copiedRecovery.reason, "application_recovery");
  const inventedBytes = await persistVerifiedOffServerObjectEvidence({
    objectKey: AFTERNOON_KEY,
    capturedAt: "2026-10-19T15:58:58.133Z",
    ciphertextSha256: AFTERNOON_HASH,
    plaintextSha256: AFTERNOON_PLAINTEXT_HASH,
    sourceBytes: -1,
    ciphertextBytes: 1.5,
    plaintextBytes: Number.NaN,
    integrityCheck: "ok",
    databaseIntegrity: "passed",
    applicationRecovery: "not_confirmed",
  });
  assert.equal(inventedBytes.stored, false);
  assert.equal(inventedBytes.reason, "byte_count");

  const stored = await persistVerifiedOffServerObjectEvidence({
    objectKey: AFTERNOON_KEY,
    capturedAt: "2026-10-19T15:58:58.133Z",
    ciphertextSha256: AFTERNOON_HASH,
    plaintextSha256: AFTERNOON_PLAINTEXT_HASH,
    sourceBytes: null,
    ciphertextBytes: null,
    plaintextBytes: null,
    integrityCheck: "ok",
    databaseIntegrity: "passed",
    applicationRecovery: "not_confirmed",
  });
  assert.equal(stored.stored, true);
  const duplicate = await persistVerifiedOffServerObjectEvidence({
    objectKey: AFTERNOON_KEY,
    capturedAt: "2026-10-19T15:58:58.133Z",
    ciphertextSha256: AFTERNOON_HASH,
    plaintextSha256: AFTERNOON_PLAINTEXT_HASH,
    sourceBytes: null,
    ciphertextBytes: null,
    plaintextBytes: null,
    integrityCheck: "ok",
    databaseIntegrity: "passed",
    applicationRecovery: "not_confirmed",
  });
  assert.equal(duplicate.stored, false);
  assert.equal(duplicate.reason, "already_recorded");

  const morningCount = await db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM hq_audit_log WHERE action = ? AND entity_id = ?",
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    MORNING_KEY,
  );
  const afternoonCount = await db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM hq_audit_log WHERE action = ? AND entity_id = ?",
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    AFTERNOON_KEY,
  );
  assert.equal(morningCount?.c, 1);
  assert.equal(afternoonCount?.c, 1);

  const morningRow = await db.get<{ metadata_json: string }>(
    "SELECT metadata_json FROM hq_audit_log WHERE action = ? AND entity_id = ?",
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    MORNING_KEY,
  );
  const morningStored = JSON.parse(morningRow?.metadata_json ?? "{}") as {
    ciphertextSha256?: string;
    integrityCheck?: string;
    fullRecoveryVerified?: boolean;
  };
  assert.equal(morningStored.ciphertextSha256, ACCEPTED_OFFSERVER_BACKUP.ciphertextSha256);
  assert.equal(morningStored.integrityCheck, "ok");
  assert.equal(morningStored.fullRecoveryVerified, false);

  const afternoonRow = await db.get<{ metadata_json: string }>(
    "SELECT metadata_json FROM hq_audit_log WHERE action = ? AND entity_id = ?",
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    AFTERNOON_KEY,
  );
  const afternoonStored = JSON.parse(afternoonRow?.metadata_json ?? "{}") as {
    objectKey?: string;
    ciphertextSha256?: string;
    plaintextSha256?: string;
    sourceBytes?: number | null;
    ciphertextBytes?: number | null;
    plaintextBytes?: number | null;
    integrityCheck?: string;
    databaseIntegrity?: string;
    applicationRecovery?: string;
    fullRecoveryVerified?: boolean;
    externalCopy?: string;
    offServerRestoreVerified?: boolean;
  };
  assert.equal(afternoonStored.objectKey, AFTERNOON_KEY);
  assert.equal(afternoonStored.ciphertextSha256, AFTERNOON_HASH);
  assert.notEqual(afternoonStored.ciphertextSha256, MORNING_HASH);
  assert.equal(afternoonStored.plaintextSha256, AFTERNOON_PLAINTEXT_HASH);
  assert.equal(afternoonStored.sourceBytes, null);
  assert.equal(afternoonStored.ciphertextBytes, null);
  assert.equal(afternoonStored.plaintextBytes, null);
  assert.notEqual(afternoonStored.sourceBytes, 794116132);
  assert.equal(afternoonStored.integrityCheck, "ok");
  assert.equal(afternoonStored.databaseIntegrity, "passed");
  assert.equal(afternoonStored.applicationRecovery, "not_confirmed");
  assert.notEqual(afternoonStored.applicationRecovery, "readable_scheduled_jobs_and_snapshots");
  assert.equal(afternoonStored.fullRecoveryVerified, false);
  assert.equal(afternoonStored.externalCopy, "not_verified");
  assert.equal(afternoonStored.offServerRestoreVerified, false);

  const health = await getBackupHealth();
  assert.equal(health.offServerBackup.objectKey, MORNING_KEY);
  assert.equal(health.offServerBackup.ciphertextSha256, MORNING_HASH);
  assert.equal(health.offServerBackup.integrityCheck, "ok");
  assert.equal(health.offServerBackup.fullRecoveryVerified, false);
  assert.equal(health.offServerRestoreVerified, false);
  const afternoonEvidence = health.offServerEvidence.find((item: { objectKey: string }) => item.objectKey === AFTERNOON_KEY);
  assert.equal(afternoonEvidence?.ciphertextSha256, AFTERNOON_HASH);
  assert.equal(afternoonEvidence?.integrityCheck, "ok");
  assert.equal(afternoonEvidence?.databaseIntegrity, "passed");
  assert.equal(afternoonEvidence?.applicationRecovery, "not_confirmed");
  assert.notEqual(afternoonEvidence?.applicationRecovery, health.offServerBackup.applicationRecovery);
  assert.equal(afternoonEvidence?.fullRecoveryVerified, false);
  assert.equal(afternoonEvidence?.externalCopy, "not_verified");
  assert.notEqual(afternoonEvidence?.ciphertextSha256, health.offServerBackup.ciphertextSha256);
  assert.equal(health.offServerEvidence.some((item: { objectKey: string }) => item.objectKey === OTHER_KEY), false);
  assert.equal(parseStoredOffServerEvidence(afternoonRow?.metadata_json, OTHER_KEY), null);
  assert.match(health.message, /Application recovery is not confirmed for that object/);
  const stillThere = await db.get<{ id: string; size_bytes: number }>(
    "SELECT id, size_bytes FROM hq_backup_snapshots WHERE id = ?",
    OCTOBER_13_ID,
  );
  assert.equal(stillThere?.id, OCTOBER_13_ID);
  assert.equal(stillThere?.size_bytes, 761483264);
  assert.equal(health.message.includes("external copy verified"), false);
  assert.match(health.message, new RegExp(AFTERNOON_KEY.replace(/[.]/g, "\\.")));

  const source = readFileSync(new URL("../server/hq/hqBackupService.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function persistVerifiedOffServerObjectEvidence");
  const end = source.indexOf("export async function ensureBackupTables");
  const fn = source.slice(start, end);
  assert.equal(fn.includes("UPDATE "), false);
  assert.equal(fn.includes("DELETE "), false);
  assert.equal(fn.includes("fullRecoveryVerified: false"), true);
  assert.equal(fn.includes("externalCopy: \"not_verified\""), true);
  assert.equal(fn.includes("applicationRecovery: \"not_confirmed\""), true);
  assert.equal(fn.includes("applicationRecovery: input.applicationRecovery"), false);
  const page = readFileSync(new URL("../client/src/pages/hq/SecurityCenterPage.tsx", import.meta.url), "utf8");
  assert.match(page, /Separate off-server object/);
  assert.match(page, /not confirmed/);
  assert.match(page, /Full recovery: not verified/);
});
