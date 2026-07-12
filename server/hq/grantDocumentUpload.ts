/** Document upload validation — Grant attachments + Enterprise Document Suite (Build 57). */

export const GRANT_UPLOAD_MAX_BYTES = 15 * 1024 * 1024; // 15 MB
export const HQ_DOCUMENT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024; // 50 MB — media / archives

const GRANT_ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

const ENTERPRISE_ALLOWED_MIME = new Set([
  ...GRANT_ALLOWED_MIME,
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "text/csv",
  "application/rtf",
  "application/json",
]);

const GRANT_EXT_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const ENTERPRISE_EXT_TO_MIME: Record<string, string> = {
  ...GRANT_EXT_TO_MIME,
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".csv": "text/csv",
  ".rtf": "application/rtf",
  ".json": "application/json",
};

function resolveMime(
  fileName: string,
  mimeType: string | undefined,
  allowed: Set<string>,
  extMap: Record<string, string>
): string | null {
  const normalized = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (normalized && allowed.has(normalized)) return normalized;
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
  const fromExt = extMap[ext];
  if (fromExt && allowed.has(fromExt)) return fromExt;
  return null;
}

function validateUpload(
  fileName: string,
  base64: string,
  mimeType: string | undefined,
  maxBytes: number,
  allowed: Set<string>,
  extMap: Record<string, string>,
  typeHint: string
): { ok: true; mime: string; sizeBytes: number } | { ok: false; error: string } {
  if (!fileName?.trim()) return { ok: false, error: "fileName is required" };
  const mime = resolveMime(fileName, mimeType, allowed, extMap);
  if (!mime) {
    return { ok: false, error: `File type not allowed. ${typeHint}` };
  }
  const payload = base64.includes(",") ? base64.split(",").pop()! : base64;
  let sizeBytes: number;
  try {
    sizeBytes = Buffer.from(payload, "base64").length;
  } catch {
    return { ok: false, error: "Invalid file encoding" };
  }
  if (sizeBytes <= 0) return { ok: false, error: "Empty file" };
  if (sizeBytes > maxBytes) {
    return { ok: false, error: `File exceeds ${maxBytes / (1024 * 1024)} MB limit` };
  }
  return { ok: true, mime, sizeBytes };
}

export function resolveGrantUploadMime(fileName: string, mimeType?: string): string | null {
  return resolveMime(fileName, mimeType, GRANT_ALLOWED_MIME, GRANT_EXT_TO_MIME);
}

export function validateGrantDocumentUpload(
  fileName: string,
  base64: string,
  mimeType?: string
): { ok: true; mime: string; sizeBytes: number } | { ok: false; error: string } {
  return validateUpload(
    fileName,
    base64,
    mimeType,
    GRANT_UPLOAD_MAX_BYTES,
    GRANT_ALLOWED_MIME,
    GRANT_EXT_TO_MIME,
    "Use PDF, Word, Excel, PNG, JPEG, or plain text."
  );
}

/** Enterprise Document Center — broader MIME set + 50 MB (Build 57). */
export function validateHqDocumentUpload(
  fileName: string,
  base64: string,
  mimeType?: string
): { ok: true; mime: string; sizeBytes: number } | { ok: false; error: string } {
  return validateUpload(
    fileName,
    base64,
    mimeType,
    HQ_DOCUMENT_UPLOAD_MAX_BYTES,
    ENTERPRISE_ALLOWED_MIME,
    ENTERPRISE_EXT_TO_MIME,
    "Use PDF, Office (Word/Excel/PowerPoint), images, video, audio, ZIP, CSV, or text."
  );
}
