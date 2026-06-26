import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getDb } from "../db";
import { hasPermission, toHQRole } from "./enterpriseRoles";

const UPLOAD_ROOT = path.join(process.cwd(), "server", "uploads", "hq");

export interface SavedHqFile {
  id: string;
  fileName: string;
  url: string;
  size: number;
  mimeType: string;
  storedName: string;
}

export async function ensureHqFileRegistry(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_file_registry (
      stored_name TEXT PRIMARY KEY,
      uploaded_by TEXT NOT NULL,
      access_level TEXT DEFAULT 'internal',
      created_at TEXT NOT NULL
    );
  `);
}

export async function saveHqFileBase64(
  originalName: string,
  base64: string,
  mimeType = "application/octet-stream",
  uploadedBy?: string,
  accessLevel = "internal"
): Promise<SavedHqFile> {
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
  const id = crypto.randomUUID();
  const ext = path.extname(originalName) || mimeToExt(mimeType);
  const storedName = `${id}${ext}`;
  const payload = base64.includes(",") ? base64.split(",").pop()! : base64;
  const buffer = Buffer.from(payload, "base64");
  await fs.writeFile(path.join(UPLOAD_ROOT, storedName), buffer);

  if (uploadedBy) {
    await ensureHqFileRegistry();
    const db = await getDb();
    await db.run(
      `INSERT OR REPLACE INTO hq_file_registry (stored_name, uploaded_by, access_level, created_at) VALUES (?, ?, ?, ?)`,
      storedName,
      uploadedBy,
      accessLevel,
      new Date().toISOString()
    );
  }

  return {
    id,
    fileName: originalName,
    url: `/api/hq/files/${storedName}`,
    size: buffer.length,
    mimeType,
    storedName,
  };
}

export function canAccessHqFile(role: string, accessLevel: string, uploadedBy?: string, userEmail?: string): boolean {
  const hqRole = toHQRole(role);
  if (role === "owner" || ["founder", "executive", "administrator"].includes(hqRole)) return true;
  if (uploadedBy && userEmail && uploadedBy === userEmail) return true;
  if (accessLevel === "internal") return hasPermission(role, "hq.settings");
  if (accessLevel === "confidential") {
    return (["hr", "finance", "grant_manager"] as const).includes(hqRole as never)
      || hasPermission(role, "hq.hr.manage")
      || hasPermission(role, "hq.finance.manage");
  }
  if (accessLevel === "board") return hqRole === "board_member" || hasPermission(role, "hq.executive");
  return false;
}

export async function verifyHqFileAccess(storedName: string, role: string, userEmail?: string): Promise<boolean> {
  await ensureHqFileRegistry();
  const db = await getDb();
  const row = await db.get<{ uploaded_by: string; access_level: string }>(
    "SELECT uploaded_by, access_level FROM hq_file_registry WHERE stored_name = ?",
    storedName
  );
  if (!row) return role === "owner" || hasPermission(role, "hq.executive") || hasPermission(role, "hq.settings");
  return canAccessHqFile(role, row.access_level ?? "internal", row.uploaded_by, userEmail);
}

export function resolveHqFilePath(storedName: string): string | null {
  const safe = path.basename(storedName);
  if (!safe || safe !== storedName) return null;
  return path.join(UPLOAD_ROOT, safe);
}

function mimeToExt(mime: string): string {
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("png")) return ".png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("word")) return ".docx";
  if (mime.includes("sheet") || mime.includes("excel")) return ".xlsx";
  if (mime.includes("text")) return ".txt";
  return ".bin";
}

export function getHqUploadRoot(): string {
  return UPLOAD_ROOT;
}
