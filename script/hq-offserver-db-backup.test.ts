import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { chmodSync, copyFileSync, createReadStream, createWriteStream, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import Database from "better-sqlite3";
import {
  BACKUP_SQLITE_CACHE_KIB,
  BACKUP_STREAM_CHUNK_BYTES,
  OFF_SERVER_DAILY_RETENTION,
  R2_UNSIGNED_PAYLOAD,
  assertOffServerUploadAuthorized,
  backupStepFailure,
  configureBackupConnection,
  createOffServerDatabaseBackup,
  dailyObjectKeysToExpire,
  decryptBackupBytes,
  decryptBackupFile,
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
  const payload = Buffer.alloc(BACKUP_STREAM_CHUNK_BYTES + 100, 4);
  writeFileSync(file, payload);
  const originalRequest = https.request;
  let authorization = "";
  let payloadHash = "";
  let contentLength = "";
  let received = 0;
  let maxChunk = 0;
  https.request = ((url: string, options: https.RequestOptions, cb: (res: PassThrough) => void) => {
    assert.equal(String(url).includes(secret), false);
    const headers = options.headers ?? {};
    authorization = String(headers.Authorization || headers.authorization || "");
    payloadHash = String(headers["x-amz-content-sha256"] || "");
    contentLength = String(headers["content-length"] || "");
    const req = new PassThrough();
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (chunk.length > maxChunk) maxChunk = chunk.length;
    });
    req.on("finish", () => {
      const res = new PassThrough();
      (res as PassThrough & { statusCode: number }).statusCode = 200;
      cb(res);
      res.end();
    });
    return req as unknown as ReturnType<typeof https.request>;
  }) as typeof https.request;
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
    https.request = originalRequest;
  }
  assert.equal(authorization.includes(secret), false);
  assert.match(authorization, /^AWS4-HMAC-SHA256 /);
  assert.equal(payloadHash, R2_UNSIGNED_PAYLOAD);
  assert.equal(contentLength, String(payload.length));
  assert.equal(received, payload.length);
  assert.ok(maxChunk > 0 && maxChunk <= BACKUP_STREAM_CHUNK_BYTES);
  assert.ok(received > BACKUP_STREAM_CHUNK_BYTES);
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

test("a supplied sqlite code is kept with its step and is not a reproduced disk I/O error", () => {
  const wrapped = backupStepFailure("integrity", Object.assign(new Error("disk I/O error"), { code: "SQLITE_IOERR_READ" }), "temp");
  assert.equal(wrapped.message, "hq-backup stage=integrity operation=integrity_check pathClass=temp code=SQLITE_IOERR extended=SQLITE_IOERR_READ message=disk I/O error");
  assert.equal(wrapped.message.includes("uploaded_unverified"), false);
  const leaked = backupStepFailure("open", new Error("disk I/O error /opt/render/project/src/data/ifcdc.db SELECT secret"), "data-disk");
  assert.equal(leaked.message.includes("/opt/render"), false);
  assert.equal(leaked.message.includes("SELECT"), false);
  assert.equal(leaked.message.includes("secret"), false);
  assert.match(leaked.message, /^hq-backup stage=open /);
  const dbPath = join(root, "code-check.db");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE fixture_records (id INTEGER PRIMARY KEY)");
  db.close();
  const readonly = new Database(dbPath, { readonly: true, fileMustExist: true });
  let caught: unknown;
  try {
    readonly.exec("INSERT INTO fixture_records (id) VALUES (1)");
  } catch (err) {
    caught = err;
  } finally {
    readonly.close();
  }
  const reported = backupStepFailure("open", caught, "data-disk");
  assert.match(reported.message, /^hq-backup stage=open operation=open-source pathClass=data-disk code=SQLITE_READONLY extended=none message=attempt to write a readonly database$/);
  assert.equal(reported.message.includes("SQLITE_IOERR"), false);
});

test("a readonly WAL connection throws before upload and a live WAL database uploads once", async () => {
  const dir = mkdtempSync(join(root, "wal-readonly-"));
  const frozen = join(dir, "frozen");
  const writable = join(dir, "writable");
  const disk = join(dir, "disk");
  const temp = join(dir, "temp");
  for (const path of [frozen, writable, disk, temp]) mkdirSync(path);
  let writer: Database.Database | null = null;
  try {
  const walPath = join(writable, "live.db");
  writer = new Database(walPath);
  writer.pragma("journal_mode = WAL");
  writer.exec("CREATE TABLE fixture_records (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
  writer.prepare("INSERT INTO fixture_records (label) VALUES (?)").run("wal-live");
  copyFileSync(walPath, join(frozen, "live.db"));
  chmodSync(frozen, 0o555);
  chmodSync(join(frozen, "live.db"), 0o444);
  const readonlySource = new Database(join(frozen, "live.db"), { readonly: true, fileMustExist: true });
  await assert.rejects(
    () => readonlySource.backup(join(dir, "blocked.db")),
    /attempt to write a readonly database/,
  );
  readonlySource.close();

  let blockedPuts = 0;
  await assert.rejects(
    () => createOffServerDatabaseBackup({
      sourcePath: join(frozen, "live.db"),
      dataDiskRoot: disk,
      tempDir: temp,
      encryptionKey: key,
      freeBytes: 1024 * 1024 * 1024,
      lock: { held: false },
      uploader: { async put() { blockedPuts += 1; } },
    }),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : "";
      return message.includes("hq-backup")
        && message.includes("stage=backup")
        && message.includes("operation=vacuum-into")
        && message.includes("pathClass=data-disk-and-temp")
        && message.includes("attempt to write a readonly database")
        && message.includes("code=SQLITE_READONLY")
        && message.includes("extended=SQLITE_READONLY_DIRECTORY")
        && !message.includes(frozen)
        && !message.includes("uploaded_unverified");
    },
  );
  assert.equal(blockedPuts, 0);

  const service = readFileSync(new URL("../server/hq/hqBackupService.ts", import.meta.url), "utf8");
  const backupFn = service.slice(
    service.indexOf("export async function createOffServerDatabaseBackup"),
    service.indexOf("export function getDbPathForBackup"),
  );
  assert.equal(backupFn.includes("readonly: true"), false);
  assert.match(backupFn, /new Database\(opts\.sourcePath, \{ fileMustExist: true \}\)/);
  assert.match(backupFn, /VACUUM INTO \?/);
  assert.equal(backupFn.includes(".backup("), false);
  assert.equal(backupFn.includes("journal_mode"), false);
  assert.equal(backupFn.includes("wal_checkpoint"), false);
  assert.equal(backupFn.includes("immutable"), false);
  assert.ok(backupFn.indexOf("VACUUM INTO") < backupFn.indexOf("uploader.put"));
  assert.equal(backupFn.includes("copyFileSync"), false);
  assert.equal(backupFn.includes("pruneOldBackups"), false);

  const dbBefore = statSync(walPath).size;
  const walBefore = statSync(walPath + "-wal").size;
  let saved: Buffer | null = null;
  const result = await createOffServerDatabaseBackup({
    sourcePath: walPath,
    dataDiskRoot: disk,
    tempDir: temp,
    encryptionKey: key,
    freeBytes: 1024 * 1024 * 1024,
    now: new Date("2026-10-15T22:30:00.000Z"),
    lock: { held: false },
    uploader: {
      async put(input) {
        saved = readFileSync(input.filePath);
      },
    },
  });
  assert.equal(result.wrotePersistentDiskCopy, false);
  assert.equal(saved !== null, true);
  assert.equal(statSync(walPath).size, dbBefore);
  assert.equal(statSync(walPath + "-wal").size, walBefore);
  const plain = decryptBackupBytes(saved!, key);
  const restoredPath = join(dir, "restored.db");
  writeFileSync(restoredPath, plain);
  const restored = new Database(restoredPath, { readonly: true, fileMustExist: true });
  const integrity = String(restored.pragma("integrity_check", { simple: true }));
  const row = restored.prepare("SELECT label FROM fixture_records WHERE id = 1").get() as { label: string };
  restored.close();
  assert.equal(integrity, "ok");
  assert.equal(row.label, "wal-live");
  assert.equal(readdirSync(disk).length, 0);
  assert.equal(readdirSync(temp).some((name) => name.endsWith(".db") || name.endsWith(".enc")), false);
  } finally {
    writer?.close();
    chmodSync(frozen, 0o755);
  }
});

test("backup streams encryption and upload in fixed chunks and restores from the stream", async () => {
  const service = readFileSync(new URL("../server/hq/hqBackupService.ts", import.meta.url), "utf8");
  const encryptFn = service.slice(service.indexOf("export async function encryptBackupFile"), service.indexOf("export async function decryptBackupFile"));
  const uploadFn = service.slice(service.indexOf("export function r2BackupUploader"), service.indexOf("const SQLITE_PRIMARY"));
  assert.match(encryptFn, /highWaterMark: BACKUP_STREAM_CHUNK_BYTES/);
  assert.match(uploadFn, /boundedReadStream\(filePath\)/);
  assert.match(uploadFn, /R2_UNSIGNED_PAYLOAD/);
  assert.equal(encryptFn.includes("readFileSync"), false);
  assert.equal(encryptFn.includes("readFile("), false);
  assert.equal(uploadFn.includes("readFileSync"), false);
  assert.equal(uploadFn.includes("readFile("), false);
  assert.equal(uploadFn.includes("Readable.toWeb"), false);
  assert.equal(service.includes('payloadHash: input.sha256Ciphertext'), false);

  const dir = mkdtempSync(join(root, "stream-"));
  const live = join(dir, "live.db");
  const disk = join(dir, "disk");
  const temp = join(dir, "temp");
  mkdirSync(disk);
  mkdirSync(temp);
  const src = new Database(live);
  src.exec("CREATE TABLE fixture_records (id INTEGER PRIMARY KEY, label TEXT NOT NULL, payload BLOB)");
  const blob = Buffer.alloc(256 * 1024, 9);
  const insert = src.prepare("INSERT INTO fixture_records (label, payload) VALUES (?, ?)");
  for (let i = 0; i < 6; i++) insert.run(i === 0 ? "stream-row" : "pad", blob);
  src.close();
  let maxChunk = 0;
  let received = 0;
  const result = await createOffServerDatabaseBackup({
    sourcePath: live,
    dataDiskRoot: disk,
    tempDir: temp,
    encryptionKey: key,
    freeBytes: 1024 * 1024 * 1024,
    now: new Date("2026-10-16T14:00:00.000Z"),
    lock: { held: false },
    uploader: {
      async put(input) {
        for await (const chunk of createReadStream(input.filePath, { highWaterMark: BACKUP_STREAM_CHUNK_BYTES })) {
          const buf = chunk as Buffer;
          received += buf.length;
          if (buf.length > maxChunk) maxChunk = buf.length;
        }
        assert.equal(input.bytes, received);
        assert.equal(input.sha256Ciphertext.length, 64);
      },
    },
  });
  assert.equal(result.restoreVerified, false);
  assert.equal(result.wrotePersistentDiskCopy, false);
  assert.ok(maxChunk > 0 && maxChunk <= BACKUP_STREAM_CHUNK_BYTES);
  assert.equal(readdirSync(temp).length, 0);

  const cachePath = join(dir, "cache.db");
  const cacheDb = new Database(cachePath);
  configureBackupConnection(cacheDb);
  assert.equal(Number(cacheDb.pragma("cache_size", { simple: true })), -BACKUP_SQLITE_CACHE_KIB);
  assert.equal(Number(cacheDb.pragma("mmap_size", { simple: true })), 0);
  cacheDb.close();
});

test("a streamed decrypt opens an isolated database and reads the known row", async () => {
  const dir = mkdtempSync(join(root, "restore-"));
  const live = join(dir, "live.db");
  const disk = join(dir, "disk");
  const temp = join(dir, "temp");
  const sink = join(dir, "object.db.enc");
  mkdirSync(disk);
  mkdirSync(temp);
  const src = new Database(live);
  src.exec("CREATE TABLE fixture_records (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
  src.prepare("INSERT INTO fixture_records (label) VALUES (?)").run("isolated-row");
  src.close();
  await createOffServerDatabaseBackup({
    sourcePath: live,
    dataDiskRoot: disk,
    tempDir: temp,
    encryptionKey: key,
    freeBytes: 1024 * 1024 * 1024,
    lock: { held: false },
      uploader: {
      async put(input) {
        await new Promise<void>((resolve, reject) => {
          const out = createWriteStream(sink);
          createReadStream(input.filePath, { highWaterMark: BACKUP_STREAM_CHUNK_BYTES }).pipe(out);
          out.on("finish", () => resolve());
          out.on("error", reject);
        });
      },
    },
  });
  const restoredPath = join(dir, "restored.db");
  await decryptBackupFile(sink, restoredPath, key);
  const restored = new Database(restoredPath, { readonly: true, fileMustExist: true });
  const integrity = String(restored.pragma("integrity_check", { simple: true }));
  const row = restored.prepare("SELECT label FROM fixture_records WHERE id = 1").get() as { label: string };
  restored.close();
  assert.equal(integrity, "ok");
  assert.equal(row.label, "isolated-row");
  assert.equal(readdirSync(disk).length, 0);
});

test("a local https server receives a streamed UNSIGNED-PAYLOAD put", async () => {
  const dir = mkdtempSync(join(root, "r2-mock-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", keyPath, "-out", certPath,
    "-days", "1", "-nodes", "-subj", "/CN=localhost",
  ], { stdio: "ignore" });
  const payload = Buffer.alloc(BACKUP_STREAM_CHUNK_BYTES + 128 * 1024, 5);
  const file = join(dir, "body.bin");
  writeFileSync(file, payload);
  const secret = "local-test-secret-not-a-credential";
  const accessKeyId = "local-test-access";
  const accountId = "exampleaccount";
  const bucket = "ifcdc-hq-db-backups";
  const objectKey = "daily/2026-10-16/file.db.enc";
  let requestUrl = "";
  let authorization = "";
  let amzDate = "";
  let signedLength = "";
  let signedHash = "";
  const received: number[] = [];
  let total = 0;
  const server = https.createServer({
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  }, (req, res) => {
    req.on("data", (chunk: Buffer) => {
      received.push(chunk.length);
      total += chunk.length;
    });
    req.on("end", () => {
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const original = https.request;
  https.request = ((url: string, options: https.RequestOptions, cb: (res: PassThrough) => void) => {
    requestUrl = String(url);
    const headers = options.headers ?? {};
    authorization = String(headers.Authorization || "");
    amzDate = String(headers["x-amz-date"] || "");
    signedLength = String(headers["content-length"] || "");
    signedHash = String(headers["x-amz-content-sha256"] || "");
    const parsed = new URL(requestUrl);
    return original.call(https, {
      method: "PUT",
      headers,
      hostname: "127.0.0.1",
      port,
      path: parsed.pathname,
      servername: parsed.hostname,
      rejectUnauthorized: false,
    }, cb);
  }) as typeof https.request;
  try {
    await r2BackupUploader({
      encryptionKey: key,
      accountId,
      bucket,
      accessKeyId,
      secretAccessKey: secret,
      tempDir: dir,
    }).put({
      objectKey,
      filePath: file,
      sha256Ciphertext: "unused-body-hash",
      bytes: payload.length,
    });
  } finally {
    https.request = original;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${bucket}/${objectKey}`;
  assert.equal(requestUrl, `https://${host}${canonicalUri}`);
  assert.equal(signedHash, R2_UNSIGNED_PAYLOAD);
  assert.equal(signedLength, String(payload.length));
  assert.equal(authorization.includes(secret), false);
  assert.equal(authorization, expectedUnsignedPutAuthorization({
    secret,
    accessKeyId,
    host,
    canonicalUri,
    amzDate,
    contentLength: payload.length,
  }));
  assert.match(authorization, /\/auto\/s3\/aws4_request/);
  assert.equal(total, payload.length);
  assert.ok(received.length >= 2);
  assert.ok(received[0] > 0 && received[0] <= BACKUP_STREAM_CHUNK_BYTES);
});

function expectedUnsignedPutAuthorization(opts: {
  secret: string;
  accessKeyId: string;
  host: string;
  canonicalUri: string;
  amzDate: string;
  contentLength: number;
}): string {
  const dateStamp = opts.amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const payloadHash = "UNSIGNED-PAYLOAD";
  const canonicalHeaders =
    `content-length:${opts.contentLength}\n` +
    `content-type:application/octet-stream\n` +
    `host:${opts.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${opts.amzDate}\n`;
  const signedHeaders = "content-length;content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `PUT\n${opts.canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${opts.amzDate}\n${scope}\n${createHash("sha256").update(canonicalRequest).digest("hex")}`;
  const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${opts.secret}`, dateStamp), region), service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function resultSha(plain: Buffer): string {
  return createHash("sha256").update(plain).digest("hex");
}
