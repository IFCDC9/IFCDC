import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDb } from "../db";

function getDataDir(): string {
  return path.join(import.meta.dirname, "..", "..", "data");
}

export function getDbPath(): string {
  return path.join(getDataDir(), "ifcdc.db");
}

export function getBackupDir(): string {
  return path.join(getDataDir(), "backups");
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

const MAX_BACKUPS = 30;

export async function createDatabaseBackup(triggeredBy = "system"): Promise<{
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
}> {
  await ensureBackupTables();
  const src = getDbPath();
  if (!fs.existsSync(src)) {
    throw new Error("Database file not found");
  }

  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `ifcdc-${timestamp}.db`;
  const dest = path.join(backupDir, filename);
  fs.copyFileSync(src, dest);

  const stat = fs.statSync(dest);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = await getDb();
  await db.run(
    `INSERT INTO hq_backup_snapshots (id, filename, file_path, size_bytes, status, created_at) VALUES (?, ?, ?, ?, 'healthy', ?)`,
    id, filename, dest, stat.size, now
  );

  await pruneOldBackups();

  const { logHqAudit } = await import("./hqAuditLog");
  await logHqAudit({
    action: "database_backup",
    entityType: "backup",
    entityId: id,
    detail: `Backup created: ${filename} (${stat.size} bytes)`,
    actorEmail: triggeredBy,
  });

  return { id, filename, sizeBytes: stat.size, createdAt: now };
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
    message:
      status === "healthy"
        ? "Automated backups are current"
        : status === "warning"
          ? "Schedule or run a backup — last snapshot is aging"
          : "No recent backup — run scheduled jobs or create a manual snapshot",
    timestamp: new Date().toISOString(),
  };
}
