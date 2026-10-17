/**
 * Opt-in RAM measurement for the off-server backup path.
 * Exits immediately unless IFCDC_BACKUP_MEMORY_BYTES is set, so CI never builds a large fixture.
 * Does not upload to R2. Refuses to write under /Volumes/IFCDC.
 *
 * A 771 MB run needs about three copies on the temp disk. If that does not fit,
 * the script records the shortfall and measures the largest size that leaves headroom.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statfsSync, statSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  configureBackupConnection,
  createOffServerDatabaseBackup,
  decryptBackupFile,
  encryptBackupFile,
  r2BackupUploader,
} from "../server/hq/hqBackupService";

const KEY = Buffer.from("0123456789abcdef0123456789abcdef");
const HEADROOM_BYTES = 160 * 1024 * 1024;

function mb(bytes: number): number {
  return Math.round(bytes / 1048576);
}

function refuseExternalDrive(dir: string): void {
  const resolved = join(dir);
  if (resolved === "/Volumes/IFCDC" || resolved.startsWith("/Volumes/IFCDC/")) {
    throw new Error("refusing to write on /Volumes/IFCDC");
  }
  for (const name of ["IFCDC-HQ-100GB-Encrypted", "IFCDC HQ BACKUPS", "IFCDC-HQ-Secure-Backups", "AURA MUSIC"]) {
    if (resolved.includes(name)) throw new Error("refusing to write on the external backup allocation");
  }
}

function trackMemory() {
  let peakRss = 0;
  let peakHeap = 0;
  const timer = setInterval(() => {
    const usage = process.memoryUsage();
    if (usage.rss > peakRss) peakRss = usage.rss;
    if (usage.heapUsed > peakHeap) peakHeap = usage.heapUsed;
  }, 15);
  return () => {
    clearInterval(timer);
    const usage = process.memoryUsage();
    return {
      peakRss: Math.max(peakRss, usage.rss),
      peakHeap: Math.max(peakHeap, usage.heapUsed),
    };
  };
}

function result(phase: string, fields: Record<string, unknown>): void {
  console.log(`RESULT ${JSON.stringify({ phase, ...fields })}`);
}

async function phaseSnapshot(dir: string): Promise<void> {
  const stop = trackMemory();
  const source = new Database(join(dir, "live.db"), { fileMustExist: true });
  try {
    configureBackupConnection(source);
    const cache = source.pragma("cache_size", { simple: true });
    const mmap = source.pragma("mmap_size", { simple: true });
    const version = (source.prepare("select sqlite_version() as v").get() as { v: string }).v;
    source.prepare("VACUUM INTO ?").run(join(dir, "snap.db"));
    const measured = stop();
    result("snapshot", { ...measured, cache, mmap, sqlite: version, snapBytes: statSync(join(dir, "snap.db")).size });
  } finally {
    source.close();
  }
}

async function phaseEncrypt(dir: string): Promise<void> {
  const stop = trackMemory();
  await encryptBackupFile(join(dir, "snap.db"), join(dir, "snap.db.enc"), KEY);
  const measured = stop();
  result("encrypt", { ...measured, encBytes: statSync(join(dir, "snap.db.enc")).size });
}

async function phaseUpload(dir: string): Promise<void> {
  const filePath = join(dir, "snap.db.enc");
  const bytes = statSync(filePath).size;
  const original = https.request;
  let received = 0;
  let maxChunk = 0;
  https.request = ((_url: string, _options: https.RequestOptions, cb: (res: PassThrough) => void) => {
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
  const stop = trackMemory();
  try {
    await r2BackupUploader({
      encryptionKey: KEY,
      accountId: "measure",
      bucket: "measure",
      accessKeyId: "measure",
      secretAccessKey: "measure-secret",
      tempDir: dir,
    }).put({
      objectKey: "daily/measure/snap.db.enc",
      filePath,
      sha256Ciphertext: "0".repeat(64),
      bytes,
    });
  } finally {
    https.request = original;
  }
  const measured = stop();
  result("upload", { ...measured, received, maxChunk, encBytes: bytes });
}

async function phaseDecrypt(dir: string): Promise<void> {
  const restored = join(dir, "restored.db");
  const stop = trackMemory();
  await decryptBackupFile(join(dir, "snap.db.enc"), restored, KEY);
  const measured = stop();
  result("decrypt", { ...measured, restoredBytes: statSync(restored).size });
}

async function phaseRestore(dir: string): Promise<void> {
  const restored = join(dir, "restored.db");
  const stop = trackMemory();
  const db = new Database(restored, { readonly: true, fileMustExist: true });
  try {
    const integrity = String(db.pragma("integrity_check", { simple: true }));
    const row = db.prepare("SELECT label FROM fixture_records WHERE id = 1").get() as { label: string };
    const measured = stop();
    result("restore", { ...measured, integrity, label: row.label, restoredBytes: statSync(restored).size });
  } finally {
    db.close();
  }
  rmSync(restored, { force: true });
}

async function phaseIntegrated(dir: string): Promise<void> {
  const stop = trackMemory();
  let maxChunk = 0;
  const backup = await createOffServerDatabaseBackup({
    sourcePath: join(dir, "live.db"),
    dataDiskRoot: join(dir, "disk"),
    tempDir: join(dir, "temp"),
    encryptionKey: KEY,
    freeBytes: 1024 * 1024 * 1024 * 8,
    lock: { held: false },
    uploader: {
      async put(input) {
        const { createReadStream } = await import("node:fs");
        for await (const chunk of createReadStream(input.filePath, { highWaterMark: 1024 * 1024 })) {
          const size = (chunk as Buffer).length;
          if (size > maxChunk) maxChunk = size;
        }
      },
    },
  });
  const measured = stop();
  result("integrated", {
    ...measured,
    maxChunk,
    plaintextBytes: backup.plaintextBytes,
    ciphertextBytes: backup.ciphertextBytes,
    restoreVerified: backup.restoreVerified,
  });
}

async function runPhase(phase: string, dir: string): Promise<void> {
  refuseExternalDrive(dir);
  if (phase === "snapshot") return phaseSnapshot(dir);
  if (phase === "encrypt") return phaseEncrypt(dir);
  if (phase === "upload") return phaseUpload(dir);
  if (phase === "decrypt") return phaseDecrypt(dir);
  if (phase === "restore") return phaseRestore(dir);
  if (phase === "integrated") return phaseIntegrated(dir);
  throw new Error(`unknown phase ${phase}`);
}

function buildFixture(dir: string, bytes: number): number {
  const db = new Database(join(dir, "live.db"));
  try {
    db.pragma("journal_mode = DELETE");
    db.exec("CREATE TABLE fixture_records (id INTEGER PRIMARY KEY, label TEXT NOT NULL, payload BLOB)");
    const insert = db.prepare("INSERT INTO fixture_records (label, payload) VALUES (?, ?)");
    const chunk = Buffer.alloc(1024 * 1024, 7);
    let filled = 0;
    let first = true;
    while (filled < bytes) {
      const batch = Math.min(32, Math.ceil((bytes - filled) / chunk.length));
      const write = db.transaction(() => {
        for (let i = 0; i < batch && filled < bytes; i++) {
          insert.run(first ? "memory-row" : "pad", chunk);
          first = false;
          filled += chunk.length;
        }
      });
      write();
    }
  } finally {
    db.close();
  }
  return statSync(join(dir, "live.db")).size;
}

function runChild(phase: string, dir: string): Promise<Record<string, unknown>> {
  const script = fileURLToPath(import.meta.url);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", script], {
      env: {
        ...process.env,
        IFCDC_BACKUP_MEMORY_PHASE: phase,
        IFCDC_BACKUP_MEMORY_DIR: dir,
        IFCDC_BACKUP_MEMORY_BYTES: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
      if (code !== 0 || !line) {
        reject(new Error(`${phase} exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(JSON.parse(line.slice("RESULT ".length)) as Record<string, unknown>);
    });
  });
}

async function main(): Promise<void> {
  const phase = process.env.IFCDC_BACKUP_MEMORY_PHASE || "";
  if (phase) {
    await runPhase(phase, process.env.IFCDC_BACKUP_MEMORY_DIR || "");
    return;
  }
  const requested = Number(process.env.IFCDC_BACKUP_MEMORY_BYTES || "0");
  if (!requested) {
    console.log("hq-offserver-backup-memory: idle. Set IFCDC_BACKUP_MEMORY_BYTES to measure. No fixture is created.");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "ifcdc-backup-memory-"));
  refuseExternalDrive(root);
  try {
    const free = Number(statfsSync(root).bavail) * Number(statfsSync(root).bsize);
    const need = requested * 3 + HEADROOM_BYTES;
    console.log(JSON.stringify({
      requestedBytes: requested,
      freeBytes: free,
      needBytes: need,
      externalDriveUsed: false,
    }));
    if (free < need) {
      throw new Error(`Requested ${mb(requested)} MB needs about ${mb(need)} MB free. Temp filesystem has ${mb(free)} MB free. External /Volumes/IFCDC was not used.`);
    }
    const liveBytes = buildFixture(root, requested);
    if (liveBytes < requested) {
      throw new Error(`fixture is ${liveBytes} bytes, below the requested ${requested}`);
    }
    console.log(JSON.stringify({ liveBytes }));
    const phases = ["integrated", "snapshot", "encrypt", "upload", "decrypt", "restore"];
    for (const name of phases) {
      const row = await runChild(name, root);
      console.log(JSON.stringify(row));
      if (name === "snapshot") rmSync(join(root, "live.db"), { force: true });
      if (name === "encrypt") rmSync(join(root, "snap.db"), { force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "measurement failed");
  process.exit(1);
});
