import fs from "fs";
import path from "path";

/**
 * SQLite, backups, and uploads root — always relative to process.cwd() on Render.
 * Override with IFCDC_DATA_DIR when needed (e.g. persistent disk mount).
 */
export function getDataDir(): string {
  const dir = process.env.IFCDC_DATA_DIR?.trim() || path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getDbPath(): string {
  return path.join(getDataDir(), "ifcdc.db");
}

export function getBackupDir(): string {
  const dir = path.join(getDataDir(), "backups");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getReportsDir(): string {
  const dir = path.join(getDataDir(), "reports");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
