import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  OFF_SERVER_DAILY_RETENTION,
  assertOffServerUploadAuthorized,
  createOffServerDatabaseBackup,
  dailyObjectKeysToExpire,
  decryptBackupBytes,
  offServerUploadEnabled,
  readOffServerBackupConfig,
  r2BackupUploader,
} from "../server/hq/hqBackupService";

const root = mkdtempSync(join(tmpdir(), "ifcdc-offserver-backup-"));
const key = Buffer.from("0123456789abcdef0123456789abcdef");
const sourceDir = join(root, "source");
const tempDir = join(root, "temp");
const dataDisk = join(root, "persistent");
const sourcePath = join(sourceDir, "fixture.db");

test.before(() => {
  for (const dir of [sourceDir, tempDir, dataDisk]) mkdirSync(dir, { recursive: true });
  const src = new Database(sourcePath);
  src.exec("CREATE TABLE fixture_records (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
  src.prepare("INSERT INTO fixture_records (label) VALUES (?)").run("local-only");
  src.close();
});

test.after(() => {
  rmSync(root, { recursive: true, force: true });
});

test("a fixture snapshot is backed up, encrypted, restored, and the temp files are removed", async () => {
  let saved: Buffer | null = null;
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("network disabled");
  }) as typeof fetch;
  try {
    const result = await createOffServerDatabaseBackup({
      sourcePath,
      dataDiskRoot: dataDisk,
      tempDir,
      encryptionKey: key,
      now: new Date("2026-10-14T12:00:00.000Z"),
      lock: { held: false },
      uploader: {
        async put(input) {
          saved = readFileSync(input.filePath);
          assert.equal(input.sha256Ciphertext.length, 64);
        },
      },
      verifyRestored: async ({ ciphertextPath, plaintextSha256 }) => {
        const plain = decryptBackupBytes(readFileSync(ciphertextPath), key);
        const restoredPath = join(root, "restored.db");
        writeFileSync(restoredPath, plain);
        const restored = new Database(restoredPath, { readonly: true, fileMustExist: true });
        const integrity = String(restored.pragma("integrity_check", { simple: true }));
        const row = restored.prepare("SELECT label FROM fixture_records WHERE id = 1").get() as { label: string };
        restored.close();
        assert.equal(integrity, "ok");
        assert.equal(row.label, "local-only");
        assert.equal(plaintextSha256, resultSha(plain));
        return true;
      },
    });
    assert.equal(result.restoreVerified, true);
    assert.equal(result.wrotePersistentDiskCopy, false);
    assert.equal(result.objectKey, "daily/2026-10-14/ifcdc-2026-10-14T12-00-00-000Z.db.enc");
    assert.equal(saved && saved.length > 0, true);
    assert.equal(networkCalls, 0);
    assert.throws(() => statSync(join(tempDir, "ifcdc-2026-10-14T12-00-00-000Z.db")));
    assert.throws(() => statSync(join(tempDir, "ifcdc-2026-10-14T12-00-00-000Z.db.enc")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an upload stays unauthorized unless the flag is exactly true", () => {
  const secret = "super-secret-value-not-for-logs";
  for (const value of [undefined, "", "false", "TRUE", "True", "1", "yes", " true", "true "]) {
    const env = { R2_SECRET_ACCESS_KEY: secret, IFCDC_DB_BACKUP_UPLOAD_ENABLED: value };
    assert.equal(offServerUploadEnabled(env), false);
    assert.throws(
      () => assertOffServerUploadAuthorized(env),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : "";
        return message.includes("IFCDC_DB_BACKUP_UPLOAD_ENABLED")
          && message.includes("not authorized")
          && !message.includes(secret)
          && !message.includes("success");
      },
    );
  }
  assert.equal(offServerUploadEnabled({ IFCDC_DB_BACKUP_UPLOAD_ENABLED: "true" }), true);
  assert.doesNotThrow(() => assertOffServerUploadAuthorized({ IFCDC_DB_BACKUP_UPLOAD_ENABLED: "true" }));
});

test("missing configuration names the Founder variables and does not echo a secret", () => {
  const secret = "super-secret-value-not-for-logs";
  assert.throws(
    () => readOffServerBackupConfig({
      R2_SECRET_ACCESS_KEY: secret,
    }),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : "";
      return message.includes("R2_BUCKET_NAME")
        && message.includes("R2_ACCOUNT_ID")
        && message.includes("R2_ACCESS_KEY_ID")
        && message.includes("BACKUP_ENCRYPTION_KEY")
        && !message.includes(secret);
    },
  );
});

test("Founder variable names override the older backup names", () => {
  const founderKey = Buffer.alloc(32, 7);
  const olderKey = Buffer.alloc(32, 9);
  const cfg = readOffServerBackupConfig({
    R2_BUCKET_NAME: "ifcdc-hq-db-backups",
    R2_ACCOUNT_ID: "founder-account",
    R2_ACCESS_KEY_ID: "founder-access",
    R2_SECRET_ACCESS_KEY: "founder-secret",
    BACKUP_ENCRYPTION_KEY: founderKey.toString("base64"),
    IFCDC_DB_BACKUP_R2_BUCKET: "old-bucket",
    IFCDC_DB_BACKUP_R2_ACCOUNT_ID: "old-account",
    IFCDC_DB_BACKUP_R2_ACCESS_KEY_ID: "old-access",
    IFCDC_DB_BACKUP_R2_SECRET_ACCESS_KEY: "old-secret",
    IFCDC_DB_BACKUP_ENCRYPTION_KEY: olderKey.toString("base64"),
  });
  assert.equal(cfg.bucket === "ifcdc-hq-db-backups", true);
  assert.equal(cfg.accountId === "founder-account", true);
  assert.equal(cfg.accessKeyId === "founder-access", true);
  assert.equal(cfg.secretAccessKey === "founder-secret", true);
  assert.equal(cfg.encryptionKey.equals(founderKey), true);
});

test("a backup refuses the persistent data disk and insufficient temporary space", async () => {
  await assert.rejects(
    () => createOffServerDatabaseBackup({
      sourcePath,
      dataDiskRoot: dataDisk,
      tempDir: dataDisk,
      encryptionKey: key,
      lock: { held: false },
      uploader: { async put() { throw new Error("should not upload"); } },
    }),
    /persistent data disk/,
  );
  await assert.rejects(
    () => createOffServerDatabaseBackup({
      sourcePath,
      dataDiskRoot: dataDisk,
      tempDir: join(root, "temp"),
      encryptionKey: key,
      freeBytes: 1,
      lock: { held: false },
      uploader: { async put() { throw new Error("should not upload"); } },
    }),
    /temporary storage cannot hold/,
  );
});

test("overlapping backups stop instead of stacking", async () => {
  const lock = { held: false };
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = createOffServerDatabaseBackup({
    sourcePath,
    dataDiskRoot: join(root, "persistent"),
    tempDir: join(root, "temp"),
    encryptionKey: key,
    lock,
    uploader: { async put() { await gate; } },
    verifyRestored: () => true,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await assert.rejects(
    () => createOffServerDatabaseBackup({
      sourcePath,
      dataDiskRoot: join(root, "persistent"),
      tempDir: join(root, "temp"),
      encryptionKey: key,
      lock,
      uploader: { async put() {} },
    }),
    /already running/,
  );
  release();
  const result = await first;
  assert.equal(result.restoreVerified, true);
});

test("retention keeps ten daily keys and a signed upload does not reveal the secret", async () => {
  const keys = Array.from({ length: 12 }, (_, i) => `daily/2026-10-${String(i + 1).padStart(2, "0")}/file.db.enc`);
  const expired = dailyObjectKeysToExpire(keys, OFF_SERVER_DAILY_RETENTION);
  assert.equal(expired.length, 2);
  assert.deepEqual(expired, keys.slice(0, 2));
  const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const file = join(root, "cipher.bin");
  writeFileSync(file, Buffer.from("ciphertext"));
  const originalFetch = globalThis.fetch;
  let authorization = "";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    authorization = headers.get("authorization") || "";
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  try {
    await r2BackupUploader({
      encryptionKey: key,
      accountId: "account",
      bucket: "ifcdc-hq-db-backups",
      accessKeyId: "example-access",
      secretAccessKey: secret,
      tempDir: join(root, "temp"),
    }).put({
      objectKey: "daily/2026-10-14/file.db.enc",
      filePath: file,
      sha256Ciphertext: "abc",
      bytes: statSync(file).size,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(authorization.includes(secret), false);
  assert.match(authorization, /^AWS4-HMAC-SHA256 /);
});

test("the scheduled backup function does not copy onto the persistent backup directory", () => {
  const source = readFileSync(new URL("../server/hq/hqBackupService.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function createDatabaseBackup");
  const end = source.indexOf("async function pruneOldBackups");
  const fn = source.slice(start, end);
  assert.equal(fn.includes("copyFileSync"), false);
  assert.equal(fn.includes("pruneOldBackups"), false);
  assert.equal(fn.includes("isolated restore has not passed"), false);
  assert.match(fn, /restoreVerified: false/);
  assert.ok(fn.indexOf("assertOffServerUploadAuthorized") < fn.indexOf("readOffServerBackupConfig"));
  assert.ok(fn.indexOf("assertOffServerUploadAuthorized") < fn.indexOf("createOffServerDatabaseBackup"));
  assert.match(source, /R2_BUCKET_NAME/);
  assert.match(source, /R2_ACCOUNT_ID/);
  assert.match(source, /R2_ACCESS_KEY_ID/);
  assert.match(source, /R2_SECRET_ACCESS_KEY/);
  assert.match(source, /BACKUP_ENCRYPTION_KEY/);
  const scheduler = readFileSync(new URL("../server/hq/workflowEngine.ts", import.meta.url), "utf8");
  const backupCase = scheduler.slice(scheduler.indexOf('case "db_backup"'), scheduler.indexOf('case "executive_report_daily"'));
  assert.match(backupCase, /uploaded_unverified/);
  assert.equal(backupCase.includes("last_run_status = 'success'"), false);
  assert.ok(backupCase.indexOf("assertOffServerUploadAuthorized") < backupCase.indexOf("createDatabaseBackup("));
  assert.match(scheduler, /last_run_status = 'uploaded_unverified'/);
  assert.match(scheduler, /last_run_status = 'failed'/);
});

test("Create Backup Now shows the snapshot result and does not mark the scheduled job success", () => {
  const page = readFileSync(new URL("../client/src/pages/hq/SecurityCenterPage.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../client/src/api/securityApi.ts", import.meta.url), "utf8");
  const button = page.slice(page.indexOf("Create Backup Now") - 400, page.indexOf("Create Backup Now"));
  assert.match(api, /method: "POST"/);
  assert.match(api, /\/backup\/snapshot/);
  assert.match(page, /function startOneBackup/);
  assert.match(page, /backupClickLock\.current \|\| createBackup\.isPending/);
  assert.match(button, /disabled=\{createBackup\.isPending\}/);
  assert.match(button, /onClick=\{startOneBackup\}/);
  assert.match(page, /role="alert"/);
  assert.match(page, /Creating an encrypted off-server backup/);
  assert.match(page, /Backup result: \{status\}/);
  assert.match(page, /Off-server restore is not verified/);
  assert.equal(page.includes("/jobs/"), false);
  assert.equal(page.includes("run-scheduled"), false);
  assert.equal(page.includes("last_run_status = 'success'"), false);
});

function resultSha(plain: Buffer): string {
  return createHash("sha256").update(plain).digest("hex");
}
