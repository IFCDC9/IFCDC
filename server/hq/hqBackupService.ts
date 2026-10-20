import fs from "fs";
import https from "https";
import os from "os";
import path from "path";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import Database from "better-sqlite3";
import { getDb } from "../db";
import { getBackupDir, getDbPath } from "../config/dataPaths";

/** Daily objects kept off the production disk. Ten copies of ~780 MB stay under the 10 GB-month R2 free allowance. */
export const OFF_SERVER_DAILY_RETENTION = 10;
const BACKUP_MAGIC = Buffer.from("IFCDCDB1");
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const HEADER_BYTES = BACKUP_MAGIC.length + GCM_IV_BYTES;
const TEMP_MARGIN_BYTES = 32 * 1024 * 1024;

/**
 * Memory ceiling for the existing 2 GB Render instance.
 * Encrypt, hash, and upload move 1 MiB chunks. The backup connection keeps an
 * 8 MiB page cache and mmap off, so VACUUM INTO does not pin the database.
 * Extra anonymous RAM for that work stays on the order of a few chunks plus
 * the cache. Ciphertext is fsynced every 32 MiB so dirty pages stay under the
 * 256 MiB backup budget while the plaintext snapshot is only clean cache.
 * The plaintext file is removed before the upload read. The rest of the 2 GB
 * RSS belongs to the live HQ process. Do not raise the 2.5s Aura busy timeout
 * to hide the read lock.
 */
export const BACKUP_STREAM_CHUNK_BYTES = 1024 * 1024;
export const BACKUP_SQLITE_CACHE_KIB = 8192;
/** Dirty ciphertext is synced at this interval so both full files are not dirty together. */
export const BACKUP_DIRTY_SYNC_BYTES = 32 * 1024 * 1024;
/** SigV4 payload marker. The PUT body is not hashed into one buffer before upload. */
export const R2_UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
const productionBackupLock = { held: false };

/** Names already set on Render. Older IFCDC_DB_BACKUP_* names are fallbacks only. */
export const OFF_SERVER_BACKUP_ENV = [
  "BACKUP_ENCRYPTION_KEY",
  "R2_ACCOUNT_ID",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

const ENV_FALLBACKS = {
  BACKUP_ENCRYPTION_KEY: "IFCDC_DB_BACKUP_ENCRYPTION_KEY",
  R2_ACCOUNT_ID: "IFCDC_DB_BACKUP_R2_ACCOUNT_ID",
  R2_BUCKET_NAME: "IFCDC_DB_BACKUP_R2_BUCKET",
  R2_ACCESS_KEY_ID: "IFCDC_DB_BACKUP_R2_ACCESS_KEY_ID",
  R2_SECRET_ACCESS_KEY: "IFCDC_DB_BACKUP_R2_SECRET_ACCESS_KEY",
} as const;

function envValue(env: NodeJS.ProcessEnv, name: keyof typeof ENV_FALLBACKS): string | undefined {
  const primary = env[name]?.trim();
  if (primary) return primary;
  return env[ENV_FALLBACKS[name]]?.trim() || undefined;
}

export type OffServerBackupConfig = {
  encryptionKey: Buffer;
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  tempDir: string;
};

export type EncryptedBackupPut = {
  objectKey: string;
  filePath: string;
  sha256Ciphertext: string;
  bytes: number;
};

export type EncryptedBackupUploader = {
  put(input: EncryptedBackupPut): Promise<void>;
};

export type OffServerBackupResult = {
  objectKey: string;
  plaintextSha256: string;
  ciphertextSha256: string;
  plaintextBytes: number;
  ciphertextBytes: number;
  restoreVerified: boolean;
  wrotePersistentDiskCopy: false;
};

/** Default off. A live R2 upload starts only when this value is exactly "true". */
export const OFF_SERVER_UPLOAD_FLAG = "IFCDC_DB_BACKUP_UPLOAD_ENABLED";

export function offServerUploadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[OFF_SERVER_UPLOAD_FLAG] === "true";
}

export function assertOffServerUploadAuthorized(env: NodeJS.ProcessEnv = process.env): void {
  if (!offServerUploadEnabled(env)) {
    throw new Error(
      "Database backup stopped: off-server upload is not authorized (IFCDC_DB_BACKUP_UPLOAD_ENABLED)",
    );
  }
}

export function readOffServerBackupConfig(env: NodeJS.ProcessEnv = process.env): OffServerBackupConfig {
  const missing = OFF_SERVER_BACKUP_ENV.filter((name) => !envValue(env, name));
  if (missing.length) {
    throw new Error(`Database backup stopped: off-server backup is not configured (${missing.join(", ")})`);
  }
  const encryptionKey = Buffer.from(envValue(env, "BACKUP_ENCRYPTION_KEY")!, "base64");
  if (encryptionKey.length !== 32) {
    throw new Error("Database backup stopped: encryption key is not usable");
  }
  return {
    encryptionKey,
    accountId: envValue(env, "R2_ACCOUNT_ID")!,
    bucket: envValue(env, "R2_BUCKET_NAME")!,
    accessKeyId: envValue(env, "R2_ACCESS_KEY_ID")!,
    secretAccessKey: envValue(env, "R2_SECRET_ACCESS_KEY")!,
    tempDir: env.IFCDC_DB_BACKUP_TMP_DIR?.trim() || os.tmpdir(),
  };
}

export function dailyObjectKeysToExpire(keys: string[], keep = OFF_SERVER_DAILY_RETENTION): string[] {
  const sorted = [...keys].sort();
  return sorted.slice(0, Math.max(0, sorted.length - keep));
}

function isInside(child: string, parent: string): boolean {
  const root = path.resolve(parent);
  const target = path.resolve(child);
  return target === root || target.startsWith(root + path.sep);
}

function availableBytes(dir: string): number {
  const stat = fs.statfsSync(dir);
  return Number(stat.bavail) * Number(stat.bsize);
}

function boundedReadStream(filePath: string, extra?: { start?: number; end?: number }): fs.ReadStream {
  return fs.createReadStream(filePath, { highWaterMark: BACKUP_STREAM_CHUNK_BYTES, ...extra });
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await pipeline(boundedReadStream(filePath), hash);
  return hash.digest("hex");
}

export function configureBackupConnection(db: Database.Database): void {
  db.pragma(`cache_size = -${BACKUP_SQLITE_CACHE_KIB}`);
  db.pragma("mmap_size = 0");
}

function assertBackupHeader(header: Buffer): void {
  if (header.length < HEADER_BYTES || !header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error("Database backup stopped: encrypted payload is not readable");
  }
}

export function decryptBackupBytes(payload: Buffer, key: Buffer): Buffer {
  if (payload.length < HEADER_BYTES + GCM_TAG_BYTES) {
    throw new Error("Database backup stopped: encrypted payload is not readable");
  }
  assertBackupHeader(payload.subarray(0, HEADER_BYTES));
  const iv = payload.subarray(BACKUP_MAGIC.length, HEADER_BYTES);
  const tag = payload.subarray(payload.length - GCM_TAG_BYTES);
  const ciphertext = payload.subarray(HEADER_BYTES, payload.length - GCM_TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function writeAll(fh: fs.promises.FileHandle, buf: Buffer): Promise<void> {
  let offset = 0;
  while (offset < buf.length) {
    const { bytesWritten } = await fh.write(buf, offset, buf.length - offset);
    if (bytesWritten <= 0) throw new Error("Database backup stopped: temporary storage is unavailable");
    offset += bytesWritten;
  }
}

/** Make VACUUM output clean cache before encryption so it is reclaimable under cgroup pressure. */
export async function syncBackupFile(filePath: string): Promise<void> {
  const fh = await fs.promises.open(filePath, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** On-disk format stays IFCDCDB1 + 12-byte IV + ciphertext + 16-byte tag. Reads and writes 1 MiB chunks. */
export async function encryptBackupFile(source: string, destination: string, key: Buffer): Promise<void> {
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: GCM_TAG_BYTES,
    highWaterMark: BACKUP_STREAM_CHUNK_BYTES,
  });
  const input = boundedReadStream(source);
  const fh = await fs.promises.open(destination, "w");
  try {
    await writeAll(fh, Buffer.concat([BACKUP_MAGIC, iv]));
    let dirty = 0;
    for await (const chunk of input) {
      const out = cipher.update(chunk as Buffer);
      if (out.length) {
        await writeAll(fh, out);
        dirty += out.length;
        if (dirty >= BACKUP_DIRTY_SYNC_BYTES) {
          await fh.sync();
          dirty = 0;
        }
      }
    }
    const tail = cipher.final();
    if (tail.length) await writeAll(fh, tail);
    await writeAll(fh, cipher.getAuthTag());
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Stream the same IFCDCDB1 layout back to a file. The tag is read from the end; the body is not one buffer. */
export async function decryptBackupFile(source: string, destination: string, key: Buffer): Promise<void> {
  const stat = await fs.promises.stat(source);
  if (stat.size < HEADER_BYTES + GCM_TAG_BYTES) {
    throw new Error("Database backup stopped: encrypted payload is not readable");
  }
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(GCM_TAG_BYTES);
  const fh = await fs.promises.open(source, "r");
  try {
    const headerRead = await fh.read(header, 0, HEADER_BYTES, 0);
    const tagRead = await fh.read(tag, 0, GCM_TAG_BYTES, stat.size - GCM_TAG_BYTES);
    if (headerRead.bytesRead !== HEADER_BYTES || tagRead.bytesRead !== GCM_TAG_BYTES) {
      throw new Error("Database backup stopped: encrypted payload is not readable");
    }
    assertBackupHeader(header);
  } finally {
    await fh.close();
  }
  const iv = header.subarray(BACKUP_MAGIC.length);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: GCM_TAG_BYTES });
  decipher.setAuthTag(tag);
  const ciphertextEnd = stat.size - GCM_TAG_BYTES - 1;
  if (ciphertextEnd < HEADER_BYTES) {
    const plain = Buffer.concat([decipher.update(Buffer.alloc(0)), decipher.final()]);
    await fs.promises.writeFile(destination, plain);
    return;
  }
  await pipeline(
    boundedReadStream(source, { start: HEADER_BYTES, end: ciphertextEnd }),
    decipher,
    fs.createWriteStream(destination, { highWaterMark: BACKUP_STREAM_CHUNK_BYTES }),
  );
}

function r2Authorization(opts: {
  method: "PUT";
  host: string;
  canonicalUri: string;
  payloadHash: string;
  amzDate: string;
  accessKeyId: string;
  secretAccessKey: string;
  contentLength: number;
}): string {
  const dateStamp = opts.amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const canonicalHeaders =
    `content-length:${opts.contentLength}\n` +
    `content-type:application/octet-stream\n` +
    `host:${opts.host}\n` +
    `x-amz-content-sha256:${opts.payloadHash}\n` +
    `x-amz-date:${opts.amzDate}\n`;
  const signedHeaders = "content-length;content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `${opts.method}\n${opts.canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${opts.payloadHash}`;
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${opts.amzDate}\n${scope}\n${crypto.createHash("sha256").update(canonicalRequest).digest("hex")}`;
  const hmac = (key: Buffer | string, value: string) => crypto.createHmac("sha256", key).update(value).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${opts.secretAccessKey}`, dateStamp), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export function r2BackupUploader(config: OffServerBackupConfig): EncryptedBackupUploader {
  return {
    async put(input) {
      const host = `${config.accountId}.r2.cloudflarestorage.com`;
      const encodedKey = input.objectKey.split("/").map((part) => encodeURIComponent(part)).join("/");
      const canonicalUri = `/${config.bucket}/${encodedKey}`;
      const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
      const authorization = r2Authorization({
        method: "PUT",
        host,
        canonicalUri,
        payloadHash: R2_UNSIGNED_PAYLOAD,
        amzDate,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        contentLength: input.bytes,
      });
      if (authorization.includes(config.secretAccessKey)) {
        throw new Error("Database backup stopped: off-server upload could not be signed");
      }
      await streamHttpsPut(`https://${host}${canonicalUri}`, {
        "content-length": String(input.bytes),
        "content-type": "application/octet-stream",
        "x-amz-content-sha256": R2_UNSIGNED_PAYLOAD,
        "x-amz-date": amzDate,
        Authorization: authorization,
      }, input.filePath);
    },
  };
}

function streamHttpsPut(url: string, headers: Record<string, string>, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "PUT", headers }, (res) => {
      const status = res.statusCode ?? 0;
      res.resume();
      res.on("error", reject);
      res.on("end", () => {
        if (status >= 200 && status < 300) resolve();
        else reject(new Error(`Database backup stopped: off-server upload failed (${status})`));
      });
    });
    req.on("error", reject);
    pipeline(boundedReadStream(filePath), req).catch((err) => {
      req.destroy();
      reject(err);
    });
  });
}

const SQLITE_PRIMARY = [
  "SQLITE_IOERR",
  "SQLITE_READONLY",
  "SQLITE_BUSY",
  "SQLITE_FULL",
  "SQLITE_CANTOPEN",
  "SQLITE_CORRUPT",
  "SQLITE_PERM",
  "SQLITE_LOCKED",
  "SQLITE_NOMEM",
  "SQLITE_CONSTRAINT",
  "SQLITE_ABORT",
] as const;

function sqliteErrorCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : "";
}

function sqliteCodes(err: unknown): { code: string; extended: string } {
  const raw = sqliteErrorCode(err);
  if (!/^SQLITE_[A-Z0-9_]+$/.test(raw)) return { code: "none", extended: "none" };
  const primary = SQLITE_PRIMARY.find((name) => raw === name || raw.startsWith(`${name}_`));
  if (!primary) return { code: raw, extended: "none" };
  return { code: primary, extended: raw === primary ? "none" : raw };
}

function safeBackupMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  const withoutIo = message.replaceAll("I/O", "IO");
  if (!message || message.length > 80 || /[\r\n@\\]/.test(withoutIo) || withoutIo.includes("/") || /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i.test(message)) {
    return "unavailable";
  }
  return message;
}

export function backupStepFailure(
  step: "open" | "backup" | "integrity" | "encrypt" | "upload",
  err: unknown,
  pathClass: "data-disk" | "temp" | "data-disk-and-temp" | "off-server",
): Error {
  const operation = {
    open: "open-source",
    backup: "vacuum-into",
    integrity: "integrity_check",
    encrypt: "encrypt",
    upload: "put",
  }[step];
  const { code, extended } = sqliteCodes(err);
  const line = `hq-backup stage=${step} operation=${operation} pathClass=${pathClass} code=${code} extended=${extended} message=${safeBackupMessage(err)}`;
  console.error(line);
  return new Error(line);
}

export async function createOffServerDatabaseBackup(opts: {
  sourcePath: string;
  dataDiskRoot: string;
  tempDir: string;
  encryptionKey: Buffer;
  uploader: EncryptedBackupUploader;
  triggeredBy?: string;
  now?: Date;
  freeBytes?: number;
  verifyRestored?: (input: { ciphertextPath: string; plaintextSha256: string }) => Promise<boolean> | boolean;
  lock?: { held: boolean };
}): Promise<OffServerBackupResult> {
  const lock = opts.lock ?? productionBackupLock;
  if (lock.held) throw new Error("Database backup stopped: a backup is already running");
  lock.held = true;
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const day = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const plaintextPath = path.join(opts.tempDir, `ifcdc-${stamp}.db`);
  const ciphertextPath = path.join(opts.tempDir, `ifcdc-${stamp}.db.enc`);
  const removeTemps = () => {
    for (const file of [plaintextPath, ciphertextPath]) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch { /* temp cleanup must not touch the live database */ }
    }
  };
  try {
    if (!fs.existsSync(opts.sourcePath)) throw new Error("Database file not found");
    if (isInside(opts.tempDir, opts.dataDiskRoot) || isInside(plaintextPath, opts.dataDiskRoot)) {
      throw new Error("Database backup stopped: refusing to write a second full copy on the persistent data disk");
    }
    try {
      fs.mkdirSync(opts.tempDir, { recursive: true });
    } catch {
      throw new Error("Database backup stopped: temporary storage is unavailable");
    }
    const sourceBytes = fs.statSync(opts.sourcePath).size;
    const free = opts.freeBytes ?? availableBytes(opts.tempDir);
    if (free < sourceBytes * 2 + TEMP_MARGIN_BYTES) {
      throw new Error("Database backup stopped: temporary storage cannot hold a snapshot without using the persistent data disk");
    }
    // VACUUM INTO writes a new file and takes a read lock on the source.
    // Plain VACUUM is not used: that path copies the result back over the
    // live database. The online backup step masks its status with 0xff, so
    // that call can only report primary SQLITE_IOERR.
    let source: Database.Database | undefined;
    try {
      try {
        source = new Database(opts.sourcePath, { fileMustExist: true });
      } catch (err) {
        throw backupStepFailure("open", err, "data-disk");
      }
      try {
        configureBackupConnection(source);
      } catch (err) {
        const code = sqliteErrorCode(err);
        if (code !== "SQLITE_READONLY" && !code.startsWith("SQLITE_READONLY_")) {
          throw backupStepFailure("open", err, "data-disk");
        }
      }
      try {
        source.prepare("VACUUM INTO ?").run(plaintextPath);
      } catch (err) {
        throw backupStepFailure("backup", err, "data-disk-and-temp");
      }
    } finally {
      source?.close();
    }
    try {
      await syncBackupFile(plaintextPath);
    } catch (err) {
      throw backupStepFailure("backup", err, "temp");
    }
    let check: Database.Database | undefined;
    let integrity = "";
    try {
      try {
        check = new Database(plaintextPath, { fileMustExist: true });
        configureBackupConnection(check);
      } catch (err) {
        throw backupStepFailure("integrity", err, "temp");
      }
      try {
        integrity = String(check.pragma("integrity_check", { simple: true }));
      } catch (err) {
        throw backupStepFailure("integrity", err, "temp");
      }
    } finally {
      check?.close();
    }
    if (integrity !== "ok") throw backupStepFailure("integrity", new Error("integrity check failed"), "temp");
    let plaintextSha256 = "";
    let plaintextBytes = 0;
    try {
      plaintextSha256 = await sha256File(plaintextPath);
      await encryptBackupFile(plaintextPath, ciphertextPath, opts.encryptionKey);
      plaintextBytes = fs.statSync(plaintextPath).size;
      fs.unlinkSync(plaintextPath);
    } catch (err) {
      throw backupStepFailure("encrypt", err, "temp");
    }
    let ciphertextSha256 = "";
    let ciphertextBytes = 0;
    const objectKey = `daily/${day}/ifcdc-${stamp}.db.enc`;
    try {
      ciphertextSha256 = await sha256File(ciphertextPath);
      ciphertextBytes = fs.statSync(ciphertextPath).size;
      await opts.uploader.put({ objectKey, filePath: ciphertextPath, sha256Ciphertext: ciphertextSha256, bytes: ciphertextBytes });
    } catch (err) {
      throw backupStepFailure("upload", err, "off-server");
    }
    const restoreVerified = opts.verifyRestored
      ? await opts.verifyRestored({ ciphertextPath, plaintextSha256 })
      : false;
    return {
      objectKey,
      plaintextSha256,
      ciphertextSha256,
      plaintextBytes,
      ciphertextBytes,
      restoreVerified: Boolean(restoreVerified),
      wrotePersistentDiskCopy: false,
    };
  } finally {
    removeTemps();
    lock.held = false;
  }
}

export function getDbPathForBackup(): string {
  return getDbPath();
}

export function getBackupDirPath(): string {
  return getBackupDir();
}

/**
 * Accepted October 19 off-server object. Integrity was already checked.
 * This record does not reopen that file and does not claim full recovery.
 */
export const ACCEPTED_OFFSERVER_BACKUP = {
  objectKey: "daily/2026-10-19/ifcdc-2026-10-19T11-58-23-661Z.db.enc",
  bucket: "ifcdc-hq-db-backups",
  capturedAt: "2026-10-19T11:58:23.661Z",
  sourceBytes: 794116132,
  ciphertextBytes: 794116132,
  ciphertextSha256: "82a36aa544d787592e92f29c32241809ac3e35f60c3c6d8b4c7a85eb23b76dd8",
  plaintextBytes: 794116096,
  envelopeOverheadBytes: 36,
  integrityCheck: "ok",
  userTableCount: 225,
  scheduledJobRows: 14,
  backupSnapshotRows: 3,
  plaintextDeleted: true,
  productionOverwritten: false,
  productionDatabaseOpened: false,
  databaseIntegrity: "passed",
  applicationRecovery: "readable_scheduled_jobs_and_snapshots",
  applicationRecoveryAutomatedCriteria: "tested_on_fixture",
  applicationRecoveryDetail:
    "Automated recovery criteria were tested on a fixture database. This production object was not opened again. Accepted evidence already showed integrity_check ok and readable hq_scheduled_jobs (14) and hq_backup_snapshots (3) rows. That is not full application recovery.",
  externalCopy: "not_verified",
  fullRecoveryVerified: false,
  offServerRestoreVerified: false,
} as const;

export const OFFSERVER_BACKUP_EVIDENCE_ACTION = "offserver_backup_evidence";

export type ApplicationRecoveryLevel =
  | "not_run"
  | "failed"
  | "readable_scheduled_jobs_and_snapshots";

export type ApplicationRecoveryAssessment = {
  databaseIntegrity: "passed" | "failed" | "not_run";
  applicationRecovery: ApplicationRecoveryLevel;
  externalCopy: "not_verified";
  fullRecoveryVerified: false;
  productionPathOpened: false;
  queriedTables: string[];
  detail: string;
};

export function applicationRecoveryDecision(input: {
  integrity: string;
  tableNames: string[];
  scheduledJobQueryOk: boolean;
  snapshotQueryOk: boolean;
}): { databaseIntegrity: "passed" | "failed"; applicationRecovery: ApplicationRecoveryLevel; readApplicationTables: boolean } {
  if (input.integrity !== "ok") {
    return { databaseIntegrity: "failed", applicationRecovery: "not_run", readApplicationTables: false };
  }
  if (!input.tableNames.includes("hq_scheduled_jobs") || !input.scheduledJobQueryOk) {
    return { databaseIntegrity: "passed", applicationRecovery: "failed", readApplicationTables: true };
  }
  if (!input.tableNames.includes("hq_backup_snapshots") || !input.snapshotQueryOk) {
    return { databaseIntegrity: "passed", applicationRecovery: "failed", readApplicationTables: true };
  }
  return {
    databaseIntegrity: "passed",
    applicationRecovery: "readable_scheduled_jobs_and_snapshots",
    readApplicationTables: true,
  };
}

export function assessRestoredApplicationDatabase(
  filePath: string,
  productionDbPath: string,
  openDatabase: (filePath: string) => Database.Database = (target) => new Database(target, { readonly: true, fileMustExist: true }),
): ApplicationRecoveryAssessment {
  const resolved = path.resolve(filePath);
  const production = path.resolve(productionDbPath);
  if (resolved === production) {
    return {
      databaseIntegrity: "not_run",
      applicationRecovery: "not_run",
      externalCopy: "not_verified",
      fullRecoveryVerified: false,
      productionPathOpened: false,
      queriedTables: [],
      detail: "Refused to open the production database path",
    };
  }
  let db: Database.Database | undefined;
  try {
    db = openDatabase(resolved);
    const integrity = String(db.pragma("integrity_check", { simple: true }));
    const decisionBeforeRead = applicationRecoveryDecision({
      integrity,
      tableNames: [],
      scheduledJobQueryOk: false,
      snapshotQueryOk: false,
    });
    if (!decisionBeforeRead.readApplicationTables) {
      return {
        databaseIntegrity: "failed",
        applicationRecovery: "not_run",
        externalCopy: "not_verified",
        fullRecoveryVerified: false,
        productionPathOpened: false,
        queriedTables: [],
        detail: "integrity_check did not pass; application tables were not read",
      };
    }
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    const tableNames = tableRows.map((row) => row.name);
    let scheduledJobQueryOk = false;
    let snapshotQueryOk = false;
    const queriedTables: string[] = [];
    if (tableNames.includes("hq_scheduled_jobs")) {
      db.prepare("SELECT COUNT(*) AS c FROM hq_scheduled_jobs").get();
      scheduledJobQueryOk = true;
      queriedTables.push("hq_scheduled_jobs");
    }
    if (tableNames.includes("hq_backup_snapshots")) {
      db.prepare("SELECT COUNT(*) AS c FROM hq_backup_snapshots").get();
      snapshotQueryOk = true;
      queriedTables.push("hq_backup_snapshots");
    }
    const decision = applicationRecoveryDecision({
      integrity,
      tableNames,
      scheduledJobQueryOk,
      snapshotQueryOk,
    });
    return {
      databaseIntegrity: decision.databaseIntegrity,
      applicationRecovery: decision.applicationRecovery,
      externalCopy: "not_verified",
      fullRecoveryVerified: false,
      productionPathOpened: false,
      queriedTables,
      detail: decision.applicationRecovery === "readable_scheduled_jobs_and_snapshots"
        ? "Opened readonly after integrity_check ok. Readable scheduled-job and snapshot rows are not full application recovery."
        : "integrity_check passed and a critical application table could not be queried",
    };
  } catch {
    return {
      databaseIntegrity: "failed",
      applicationRecovery: "not_run",
      externalCopy: "not_verified",
      fullRecoveryVerified: false,
      productionPathOpened: false,
      queriedTables: [],
      detail: "Restored file could not be opened readonly; application tables were not read",
    };
  } finally {
    db?.close();
  }
}

function storedOffServerEvidence(metadata: string | null | undefined): typeof ACCEPTED_OFFSERVER_BACKUP | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { objectKey?: string; ciphertextSha256?: string; capturedAt?: string };
    if (parsed.objectKey !== ACCEPTED_OFFSERVER_BACKUP.objectKey) return null;
    if (parsed.ciphertextSha256 !== ACCEPTED_OFFSERVER_BACKUP.ciphertextSha256) return null;
    if (!parsed.capturedAt) return null;
    return parsed as typeof ACCEPTED_OFFSERVER_BACKUP;
  } catch {
    return null;
  }
}

export async function persistAcceptedOffServerBackupEvidence(): Promise<void> {
  const { ensureHqAuditTables } = await import("./hqAuditLog");
  await ensureHqAuditTables();
  const db = await getDb();
  const evidence = ACCEPTED_OFFSERVER_BACKUP;
  const existing = await db.get<{ id: string }>(
    "SELECT id FROM hq_audit_log WHERE action = ? AND entity_id = ? LIMIT 1",
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    evidence.objectKey,
  );
  if (existing) return;
  const { auditId } = await import("./hqAuditLog");
  await db.run(
    `INSERT INTO hq_audit_log (id, action, entity_type, entity_id, detail, actor_id, actor_email, ip_address, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    auditId(),
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    "backup",
    evidence.objectKey,
    "Accepted off-server backup evidence. Database integrity passed. Application recovery is limited to readable scheduled-job and snapshot rows. External copy is not verified. Full recovery is not verified. Production was not overwritten.",
    null,
    "system",
    null,
    JSON.stringify(evidence),
    new Date().toISOString(),
  );
}

const OFFSERVER_OBJECT_KEY = /^daily\/\d{4}-\d{2}-\d{2}\/ifcdc-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db\.enc$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export const OFFSERVER_OBJECT_EVIDENCE_RECORDER = "persistVerifiedOffServerObjectEvidence";

export type OffServerObjectApplicationRecovery = ApplicationRecoveryLevel | "not_confirmed";

export type StoredOffServerEvidence = {
  objectKey: string;
  bucket: "ifcdc-hq-db-backups";
  capturedAt: string;
  sourceBytes: number | null;
  ciphertextBytes: number | null;
  ciphertextSha256: string;
  plaintextBytes: number | null;
  plaintextSha256: string | null;
  integrityCheck: "ok";
  databaseIntegrity: "passed";
  applicationRecovery: OffServerObjectApplicationRecovery;
  externalCopy: "not_verified";
  fullRecoveryVerified: false;
  offServerRestoreVerified: false;
  productionOverwritten: false;
  productionDatabaseOpened: false;
};

export type OffServerEvidenceWriteResult = {
  stored: boolean;
  reason:
    | "stored"
    | "already_recorded"
    | "morning_record_preserved"
    | "morning_hash"
    | "integrity_check"
    | "database_integrity"
    | "ciphertext_sha256"
    | "plaintext_sha256"
    | "application_recovery"
    | "object_key"
    | "byte_count"
    | "captured_at";
};

function wholeByteCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/** Unknown sizes stay null. A missing count is not filled from another object. */
function providedByteCount(value: unknown): number | null | undefined {
  if (value == null) return null;
  if (typeof value !== "number" || !wholeByteCount(value)) return undefined;
  return value;
}

/** Read one evidence row. A different object key never receives the morning record. */
export function parseStoredOffServerEvidence(
  metadata: string | null | undefined,
  entityId: string,
): StoredOffServerEvidence | null {
  if (!metadata || !entityId) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (parsed.objectKey !== entityId || !OFFSERVER_OBJECT_KEY.test(entityId)) return null;
  if (parsed.bucket !== "ifcdc-hq-db-backups") return null;
  if (typeof parsed.ciphertextSha256 !== "string" || !SHA256_HEX.test(parsed.ciphertextSha256)) return null;
  if (
    entityId !== ACCEPTED_OFFSERVER_BACKUP.objectKey &&
    parsed.ciphertextSha256 === ACCEPTED_OFFSERVER_BACKUP.ciphertextSha256
  ) {
    return null;
  }
  if (parsed.integrityCheck !== "ok" || parsed.databaseIntegrity !== "passed") return null;
  if (parsed.fullRecoveryVerified !== false || parsed.offServerRestoreVerified !== false) return null;
  if (parsed.externalCopy !== "not_verified") return null;
  if (parsed.productionOverwritten !== false || parsed.productionDatabaseOpened !== false) return null;
  if (
    parsed.applicationRecovery !== "not_run" &&
    parsed.applicationRecovery !== "failed" &&
    parsed.applicationRecovery !== "not_confirmed" &&
    parsed.applicationRecovery !== "readable_scheduled_jobs_and_snapshots"
  ) {
    return null;
  }
  if (typeof parsed.capturedAt !== "string" || !parsed.capturedAt.trim()) return null;
  const sourceBytes = providedByteCount(parsed.sourceBytes);
  const ciphertextBytes = providedByteCount(parsed.ciphertextBytes);
  const plaintextBytes = providedByteCount(parsed.plaintextBytes);
  if (sourceBytes === undefined || ciphertextBytes === undefined || plaintextBytes === undefined) return null;
  const plaintextSha256 = parsed.plaintextSha256;
  if (plaintextSha256 != null && (typeof plaintextSha256 !== "string" || !SHA256_HEX.test(plaintextSha256))) return null;
  return {
    objectKey: entityId,
    bucket: "ifcdc-hq-db-backups",
    capturedAt: parsed.capturedAt,
    sourceBytes,
    ciphertextBytes,
    ciphertextSha256: parsed.ciphertextSha256,
    plaintextBytes,
    plaintextSha256: typeof plaintextSha256 === "string" ? plaintextSha256 : null,
    integrityCheck: "ok",
    databaseIntegrity: "passed",
    applicationRecovery: parsed.applicationRecovery as OffServerObjectApplicationRecovery,
    externalCopy: "not_verified",
    fullRecoveryVerified: false,
    offServerRestoreVerified: false,
    productionOverwritten: false,
    productionDatabaseOpened: false,
  };
}

/** Backup Health and the snapshot card show one current level. A later readable audit wins; earlier audits stay stored. */
export function currentOffServerObjectEvidence<T extends { objectKey: string; applicationRecovery?: string }>(
  rows: readonly T[],
  objectKey: string,
): T | null {
  let first: T | null = null;
  let readable: T | null = null;
  for (const item of rows) {
    if (item.objectKey !== objectKey) continue;
    if (!first) first = item;
    if (item.applicationRecovery === "readable_scheduled_jobs_and_snapshots") readable = item;
  }
  return readable ?? first;
}

export function currentOffServerEvidenceRows<T extends { objectKey: string; applicationRecovery?: string }>(
  rows: readonly T[],
): T[] {
  const keys: string[] = [];
  for (const item of rows) {
    if (!keys.includes(item.objectKey)) keys.push(item.objectKey);
  }
  const listed: T[] = [];
  for (const key of keys) {
    const current = currentOffServerObjectEvidence(rows, key);
    if (current) listed.push(current);
  }
  return listed;
}

function evidenceAdvanceMismatch(
  stored: StoredOffServerEvidence,
  input: {
    objectKey: string;
    capturedAt: string;
    ciphertextSha256: string;
    plaintextSha256?: string | null;
    integrityCheck: string;
    databaseIntegrity: "passed" | "failed" | "not_run";
  },
  sourceBytes: number | null,
  ciphertextBytes: number | null,
  plaintextBytes: number | null,
): OffServerEvidenceWriteResult["reason"] | null {
  if (input.objectKey !== stored.objectKey) return "object_key";
  if (input.ciphertextSha256 !== stored.ciphertextSha256) return "ciphertext_sha256";
  if ((input.plaintextSha256 ?? null) !== stored.plaintextSha256) return "plaintext_sha256";
  if (
    sourceBytes !== stored.sourceBytes
    || ciphertextBytes !== stored.ciphertextBytes
    || plaintextBytes !== stored.plaintextBytes
  ) {
    return "byte_count";
  }
  if (input.capturedAt !== stored.capturedAt) return "captured_at";
  if (input.integrityCheck !== "ok" || stored.integrityCheck !== "ok") return "integrity_check";
  if (input.databaseIntegrity !== "passed" || stored.databaseIntegrity !== "passed") return "database_integrity";
  return null;
}

/**
 * Append evidence for one object key. The morning row is never rewritten.
 * A new object is stored only as not_confirmed, with that object's own hashes and integrity_check ok.
 * An existing not_confirmed row may advance once to readable_scheduled_jobs_and_snapshots.
 * The advance appends a new audit and leaves the original audit, hashes, sizes, and object key in place.
 * Full recovery and external copy stay unverified. No other recovery step is written.
 */
export async function persistVerifiedOffServerObjectEvidence(input: {
  objectKey: string;
  capturedAt: string;
  ciphertextSha256: string;
  plaintextSha256?: string | null;
  sourceBytes?: number | null;
  ciphertextBytes?: number | null;
  plaintextBytes?: number | null;
  integrityCheck: string;
  databaseIntegrity: "passed" | "failed" | "not_run";
  applicationRecovery: OffServerObjectApplicationRecovery;
}): Promise<OffServerEvidenceWriteResult> {
  if (input.objectKey === ACCEPTED_OFFSERVER_BACKUP.objectKey) {
    if (input.ciphertextSha256 !== ACCEPTED_OFFSERVER_BACKUP.ciphertextSha256 || input.integrityCheck !== "ok") {
      return { stored: false, reason: "morning_record_preserved" };
    }
    await persistAcceptedOffServerBackupEvidence();
    return { stored: false, reason: "morning_record_preserved" };
  }
  if (!OFFSERVER_OBJECT_KEY.test(input.objectKey)) return { stored: false, reason: "object_key" };
  if (input.integrityCheck !== "ok") return { stored: false, reason: "integrity_check" };
  if (input.databaseIntegrity !== "passed") return { stored: false, reason: "database_integrity" };
  if (!SHA256_HEX.test(input.ciphertextSha256)) return { stored: false, reason: "ciphertext_sha256" };
  if (
    input.ciphertextSha256 === ACCEPTED_OFFSERVER_BACKUP.ciphertextSha256 ||
    input.plaintextSha256 === ACCEPTED_OFFSERVER_BACKUP.ciphertextSha256
  ) {
    return { stored: false, reason: "morning_hash" };
  }
  if (input.plaintextSha256 != null && input.plaintextSha256 !== "" && !SHA256_HEX.test(input.plaintextSha256)) {
    return { stored: false, reason: "plaintext_sha256" };
  }
  if (input.plaintextSha256 === "") return { stored: false, reason: "plaintext_sha256" };
  if (
    input.applicationRecovery !== "not_confirmed" &&
    input.applicationRecovery !== "readable_scheduled_jobs_and_snapshots"
  ) {
    return { stored: false, reason: "application_recovery" };
  }
  const sourceBytes = providedByteCount(input.sourceBytes);
  const ciphertextBytes = providedByteCount(input.ciphertextBytes);
  const plaintextBytes = providedByteCount(input.plaintextBytes);
  if (sourceBytes === undefined || ciphertextBytes === undefined || plaintextBytes === undefined) {
    return { stored: false, reason: "byte_count" };
  }
  if (typeof input.capturedAt !== "string" || !input.capturedAt.trim()) return { stored: false, reason: "captured_at" };

  const { ensureHqAuditTables, auditId } = await import("./hqAuditLog");
  await ensureHqAuditTables();
  const db = await getDb();
  const existingRows = (await db.all(
    "SELECT id, metadata_json FROM hq_audit_log WHERE action = ? AND entity_id = ? ORDER BY created_at ASC",
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    input.objectKey,
  ) as unknown) as { id: string; metadata_json: string | null }[];
  const storedRows = existingRows.flatMap((row) => {
    const parsed = parseStoredOffServerEvidence(row.metadata_json, input.objectKey);
    return parsed ? [parsed] : [];
  });
  const readable = storedRows.find((row) => row.applicationRecovery === "readable_scheduled_jobs_and_snapshots") ?? null;
  const original = storedRows.find((row) => row.applicationRecovery === "not_confirmed") ?? null;

  if (input.applicationRecovery === "readable_scheduled_jobs_and_snapshots") {
    if (readable) return { stored: false, reason: "already_recorded" };
    if (!original) return { stored: false, reason: "application_recovery" };
    const mismatch = evidenceAdvanceMismatch(original, input, sourceBytes, ciphertextBytes, plaintextBytes);
    if (mismatch) return { stored: false, reason: mismatch };
    const advanced: StoredOffServerEvidence = {
      objectKey: original.objectKey,
      bucket: "ifcdc-hq-db-backups",
      capturedAt: original.capturedAt,
      sourceBytes: original.sourceBytes,
      ciphertextBytes: original.ciphertextBytes,
      ciphertextSha256: original.ciphertextSha256,
      plaintextBytes: original.plaintextBytes,
      plaintextSha256: original.plaintextSha256,
      integrityCheck: "ok",
      databaseIntegrity: "passed",
      applicationRecovery: "readable_scheduled_jobs_and_snapshots",
      externalCopy: "not_verified",
      fullRecoveryVerified: false,
      offServerRestoreVerified: false,
      productionOverwritten: false,
      productionDatabaseOpened: false,
    };
    await db.run(
      `INSERT INTO hq_audit_log (id, action, entity_type, entity_id, detail, actor_id, actor_email, ip_address, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      auditId(),
      OFFSERVER_BACKUP_EVIDENCE_ACTION,
      "backup",
      original.objectKey,
      "Off-server backup evidence for this object key only. Database integrity passed. Application recovery is limited to readable scheduled-job and snapshot rows. External copy is not verified. Full recovery is not verified. Production was not overwritten.",
      null,
      "system",
      null,
      JSON.stringify(advanced),
      new Date().toISOString(),
    );
    return { stored: true, reason: "stored" };
  }

  if (readable) return { stored: false, reason: "application_recovery" };
  if (existingRows.length > 0) return { stored: false, reason: "already_recorded" };
  if (input.applicationRecovery !== "not_confirmed") return { stored: false, reason: "application_recovery" };

  const record: StoredOffServerEvidence = {
    objectKey: input.objectKey,
    bucket: "ifcdc-hq-db-backups",
    capturedAt: input.capturedAt,
    sourceBytes,
    ciphertextBytes,
    ciphertextSha256: input.ciphertextSha256,
    plaintextBytes,
    plaintextSha256: input.plaintextSha256 ?? null,
    integrityCheck: "ok",
    databaseIntegrity: "passed",
    applicationRecovery: "not_confirmed",
    externalCopy: "not_verified",
    fullRecoveryVerified: false,
    offServerRestoreVerified: false,
    productionOverwritten: false,
    productionDatabaseOpened: false,
  };
  await db.run(
    `INSERT INTO hq_audit_log (id, action, entity_type, entity_id, detail, actor_id, actor_email, ip_address, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    auditId(),
    OFFSERVER_BACKUP_EVIDENCE_ACTION,
    "backup",
    input.objectKey,
    "Off-server backup evidence for this object key only. Database integrity passed. Application recovery is not confirmed. External copy is not verified. Full recovery is not verified. Production was not overwritten.",
    null,
    "system",
    null,
    JSON.stringify(record),
    new Date().toISOString(),
  );
  return { stored: true, reason: "stored" };
}

export async function ensureBackupTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_backup_snapshots (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      status TEXT DEFAULT 'healthy',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_backup_created ON hq_backup_snapshots(created_at DESC);
  `);
  try {
    await persistAcceptedOffServerBackupEvidence();
  } catch {
    console.error("Off-server backup evidence was not stored");
  }
}

const MAX_BACKUPS = 3;

export async function createDatabaseBackup(triggeredBy = "system"): Promise<{
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  restoreVerified: false;
  status: "uploaded_unverified";
  auditId: string | null;
}> {
  const { logHqAudit } = await import("./hqAuditLog");
  const audit = async (action: string, detail: string) => {
    return logHqAudit({
      action,
      entityType: "backup",
      entityId: "db_backup",
      detail,
      actorEmail: triggeredBy,
    });
  };
  try {
    assertOffServerUploadAuthorized();
    const config = readOffServerBackupConfig();
    const result = await createOffServerDatabaseBackup({
      sourcePath: getDbPath(),
      dataDiskRoot: path.dirname(getDbPath()),
      tempDir: config.tempDir,
      encryptionKey: config.encryptionKey,
      uploader: r2BackupUploader(config),
      triggeredBy,
      verifyRestored: async () => false,
    });
    const auditId = await audit(
      "database_backup_unverified",
      `object=${result.objectKey} plaintext_sha256=${result.plaintextSha256} ciphertext_sha256=${result.ciphertextSha256} restoreVerified=false`,
    );
    return {
      id: result.objectKey,
      filename: result.objectKey,
      sizeBytes: result.plaintextBytes,
      createdAt: new Date().toISOString(),
      restoreVerified: false,
      status: "uploaded_unverified",
      auditId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database backup stopped";
    await audit("database_backup_stopped", message);
    throw err;
  }
}

async function pruneOldBackups(): Promise<void> {
  const db = await getDb();
  const rows = (await db.all(
    "SELECT id, file_path FROM hq_backup_snapshots ORDER BY created_at DESC"
  ) as unknown) as { id: string; file_path: string }[];
  if (rows.length <= MAX_BACKUPS) return;
  const toRemove = rows.slice(MAX_BACKUPS);
  for (const row of toRemove) {
    try {
      if (fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path);
    } catch { /* ignore */ }
    await db.run("DELETE FROM hq_backup_snapshots WHERE id = ?", row.id);
  }
}

export async function listRestorePoints(limit = 20) {
  await ensureBackupTables();
  const db = await getDb();
  const rows = await db.all(
    `SELECT id, filename, size_bytes, status, created_at FROM hq_backup_snapshots ORDER BY created_at DESC LIMIT ?`,
    limit
  );
  return rows;
}

export async function restoreFromBackup(snapshotId: string, actorEmail?: string): Promise<{ success: boolean; message: string }> {
  await ensureBackupTables();
  const db = await getDb();
  const snap = await db.get<{ file_path: string; filename: string }>(
    "SELECT file_path, filename FROM hq_backup_snapshots WHERE id = ?", snapshotId
  );
  if (!snap || !fs.existsSync(snap.file_path)) {
    return { success: false, message: "Restore point not found" };
  }

  const dest = getDbPath();
  const preRestore = await createDatabaseBackup(actorEmail ?? "pre-restore");
  fs.copyFileSync(snap.file_path, dest);

  const { logHqAudit } = await import("./hqAuditLog");
  await logHqAudit({
    action: "database_restore",
    entityType: "backup",
    entityId: snapshotId,
    detail: `Restored from ${snap.filename}; pre-restore backup: ${preRestore.id}`,
    actorEmail,
  });

  return { success: true, message: `Restored from ${snap.filename}` };
}

export async function getBackupHealth() {
  await ensureBackupTables();
  const db = await getDb();
  const latest = await db.get<{ created_at: string; size_bytes: number; filename: string }>(
    "SELECT created_at, size_bytes, filename FROM hq_backup_snapshots ORDER BY created_at DESC LIMIT 1"
  );
  const count = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_backup_snapshots"))?.c ?? 0;
  const dbPath = getDbPath();
  const dbExists = fs.existsSync(dbPath);
  const dbSize = dbExists ? fs.statSync(dbPath).size : 0;
  const backupDir = getBackupDir();
  const dirExists = fs.existsSync(backupDir);
  let stored: { metadata_json: string | null } | undefined;
  try {
    stored = await db.get<{ metadata_json: string | null }>(
      "SELECT metadata_json FROM hq_audit_log WHERE action = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1",
      OFFSERVER_BACKUP_EVIDENCE_ACTION,
      ACCEPTED_OFFSERVER_BACKUP.objectKey,
    );
  } catch {
    stored = undefined;
  }
  const evidence = storedOffServerEvidence(stored?.metadata_json) ?? ACCEPTED_OFFSERVER_BACKUP;
  let evidenceRows: { entity_id: string | null; metadata_json: string | null }[] = [];
  try {
    evidenceRows = (await db.all(
      "SELECT entity_id, metadata_json FROM hq_audit_log WHERE action = ? ORDER BY created_at ASC",
      OFFSERVER_BACKUP_EVIDENCE_ACTION,
    ) as unknown) as { entity_id: string | null; metadata_json: string | null }[];
  } catch {
    evidenceRows = [];
  }
  const offServerEvidence = currentOffServerEvidenceRows(evidenceRows.flatMap((row) => {
    const parsed = parseStoredOffServerEvidence(row.metadata_json, row.entity_id ?? "");
    return parsed ? [parsed] : [];
  }));
  const separateEvidence = offServerEvidence.filter((item) => item.objectKey !== evidence.objectKey);
  const separateSentence = (item: StoredOffServerEvidence) => {
    const recovery = item.applicationRecovery === "readable_scheduled_jobs_and_snapshots"
      ? "Application recovery for that object is limited to readable scheduled-job and snapshot rows."
      : "Application recovery is not confirmed for that object.";
    return `Separate off-server object ${item.objectKey}. Database integrity passed for that object only. ${recovery} External copy is not verified. Full recovery is not verified.`;
  };
  const offServerAgeHours = (Date.now() - new Date(evidence.capturedAt).getTime()) / 3600000;

  let onDiskAgeHours: number | null = null;
  let onDiskStatus: "healthy" | "warning" | "critical" = "critical";
  if (latest?.created_at) {
    onDiskAgeHours = (Date.now() - new Date(latest.created_at).getTime()) / 3600000;
    if (onDiskAgeHours <= 24) onDiskStatus = "healthy";
    else if (onDiskAgeHours <= 72) onDiskStatus = "warning";
    else onDiskStatus = "critical";
  } else if (dbExists) {
    onDiskStatus = "warning";
  }

  const onDiskSnapshot = latest
    ? { filename: latest.filename, createdAt: latest.created_at, sizeBytes: latest.size_bytes, ageHours: onDiskAgeHours ?? 0, status: onDiskStatus }
    : null;

  return {
    status: "warning" as const,
    dbPath: "data/ifcdc.db",
    dbSizeBytes: dbSize,
    backupDir: "data/backups",
    backupDirExists: dirExists,
    restorePointCount: count,
    lastBackup: {
      filename: evidence.objectKey,
      createdAt: evidence.capturedAt,
      sizeBytes: evidence.ciphertextBytes,
      ageHours: offServerAgeHours,
    },
    onDiskSnapshot,
    offServerBackup: evidence,
    offServerEvidence,
    offServerObjectRecorder: OFFSERVER_OBJECT_EVIDENCE_RECORDER,
    offServerRestoreVerified: false as const,
    message: separateEvidence.length
      ? `Latest off-server backup: ${evidence.objectKey}. Database integrity passed. Application recovery is limited to readable scheduled-job and snapshot rows. External copy is not verified. Full recovery is not verified. ${separateEvidence.map(separateSentence).join(" ")}`
      : `Latest off-server backup: ${evidence.objectKey}. Database integrity passed. Application recovery is limited to readable scheduled-job and snapshot rows. External copy is not verified. Full recovery is not verified.`,
    timestamp: new Date().toISOString(),
  };
}
