import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import Database from "better-sqlite3";
import { getDb } from "../db";
import { getBackupDir, getDbPath } from "../config/dataPaths";

/** Daily objects kept off the production disk. Ten copies of ~780 MB stay under the 10 GB-month R2 free allowance. */
export const OFF_SERVER_DAILY_RETENTION = 10;
const BACKUP_MAGIC = Buffer.from("IFCDCDB1");
const TEMP_MARGIN_BYTES = 32 * 1024 * 1024;
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

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

export function decryptBackupBytes(payload: Buffer, key: Buffer): Buffer {
  if (payload.length < BACKUP_MAGIC.length + 12 + 16 || !payload.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error("Database backup stopped: encrypted payload is not readable");
  }
  const iv = payload.subarray(8, 20);
  const tag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(20, payload.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function encryptBackupFile(source: string, destination: string, key: Buffer): Promise<void> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const output = fs.createWriteStream(destination);
  await new Promise<void>((resolve, reject) => {
    output.once("error", reject);
    output.write(Buffer.concat([BACKUP_MAGIC, iv]), (err) => err ? reject(err) : resolve());
  });
  await pipeline(fs.createReadStream(source), cipher, output);
  fs.appendFileSync(destination, cipher.getAuthTag());
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
        payloadHash: input.sha256Ciphertext,
        amzDate,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        contentLength: input.bytes,
      });
      if (authorization.includes(config.secretAccessKey)) {
        throw new Error("Database backup stopped: off-server upload could not be signed");
      }
      const response = await fetch(`https://${host}${canonicalUri}`, {
        method: "PUT",
        headers: {
          "content-length": String(input.bytes),
          "content-type": "application/octet-stream",
          "x-amz-content-sha256": input.sha256Ciphertext,
          "x-amz-date": amzDate,
          Authorization: authorization,
        },
        body: Readable.toWeb(fs.createReadStream(input.filePath)) as unknown as ReadableStream,
        duplex: "half",
      } as RequestInit);
      if (!response.ok) {
        throw new Error(`Database backup stopped: off-server upload failed (${response.status})`);
      }
    },
  };
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

function sqliteCodes(err: unknown): { code: string; extended: string } {
  const raw = typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : "";
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
    backup: "source.backup",
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
    // SQLite checkpoints a WAL database through this connection. A readonly
    // handle throws "attempt to write a readonly database" before upload.
    let source: Database.Database | undefined;
    try {
      try {
        source = new Database(opts.sourcePath, { fileMustExist: true });
      } catch (err) {
        throw backupStepFailure("open", err, "data-disk");
      }
      try {
        await source.backup(plaintextPath);
      } catch (err) {
        throw backupStepFailure("backup", err, "data-disk-and-temp");
      }
    } finally {
      source?.close();
    }
    let check: Database.Database | undefined;
    let integrity = "";
    try {
      try {
        check = new Database(plaintextPath, { fileMustExist: true });
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
    try {
      plaintextSha256 = await sha256File(plaintextPath);
      await encryptBackupFile(plaintextPath, ciphertextPath, opts.encryptionKey);
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
      plaintextBytes: fs.statSync(plaintextPath).size,
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
}

const MAX_BACKUPS = 3;

export async function createDatabaseBackup(triggeredBy = "system"): Promise<{
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  restoreVerified: false;
  status: "uploaded_unverified";
}> {
  const { logHqAudit } = await import("./hqAuditLog");
  const audit = async (action: string, detail: string) => {
    await logHqAudit({
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
    await audit(
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

  let ageHours: number | null = null;
  let status: "healthy" | "warning" | "critical" = "critical";
  if (latest?.created_at) {
    ageHours = (Date.now() - new Date(latest.created_at).getTime()) / 3600000;
    if (ageHours <= 24) status = "healthy";
    else if (ageHours <= 72) status = "warning";
    else status = "critical";
  } else if (dbExists) {
    status = "warning";
  }

  return {
    status,
    dbPath: "data/ifcdc.db",
    dbSizeBytes: dbSize,
    backupDir: "data/backups",
    backupDirExists: dirExists,
    restorePointCount: count,
    lastBackup: latest
      ? { filename: latest.filename, createdAt: latest.created_at, sizeBytes: latest.size_bytes, ageHours: ageHours ?? 0 }
      : null,
    offServerRestoreVerified: false,
    message:
      status === "healthy"
        ? "An on-disk snapshot is recent. The off-server backup is not restore-verified."
        : status === "warning"
          ? "Schedule or run a backup — last snapshot is aging. The off-server backup is not restore-verified."
          : "No recent backup — the off-server backup is not restore-verified.",
    timestamp: new Date().toISOString(),
  };
}
