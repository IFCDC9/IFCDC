import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const UPLOAD_ROOT = path.join(process.cwd(), "server", "uploads", "hq");

export interface SavedHqFile {
  id: string;
  fileName: string;
  url: string;
  size: number;
  mimeType: string;
}

export async function saveHqFileBase64(
  originalName: string,
  base64: string,
  mimeType = "application/octet-stream"
): Promise<SavedHqFile> {
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
  const id = crypto.randomUUID();
  const ext = path.extname(originalName) || mimeToExt(mimeType);
  const storedName = `${id}${ext}`;
  const payload = base64.includes(",") ? base64.split(",").pop()! : base64;
  const buffer = Buffer.from(payload, "base64");
  await fs.writeFile(path.join(UPLOAD_ROOT, storedName), buffer);
  return {
    id,
    fileName: originalName,
    url: `/api/hq/files/${storedName}`,
    size: buffer.length,
    mimeType,
  };
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
  return ".bin";
}
