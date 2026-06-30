/** Grant document upload limits (production hardening). */

export const GRANT_UPLOAD_MAX_BYTES = 15 * 1024 * 1024; // 15 MB

const ALLOWED_MIME = new Set([
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

const EXT_TO_MIME: Record<string, string> = {
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

export function resolveGrantUploadMime(fileName: string, mimeType?: string): string | null {
  const normalized = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (normalized && ALLOWED_MIME.has(normalized)) return normalized;
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
  return EXT_TO_MIME[ext] ?? null;
}

export function validateGrantDocumentUpload(
  fileName: string,
  base64: string,
  mimeType?: string
): { ok: true; mime: string; sizeBytes: number } | { ok: false; error: string } {
  if (!fileName?.trim()) return { ok: false, error: "fileName is required" };
  const mime = resolveGrantUploadMime(fileName, mimeType);
  if (!mime) {
    return {
      ok: false,
      error: "File type not allowed. Use PDF, Word, Excel, PNG, JPEG, or plain text.",
    };
  }
  const payload = base64.includes(",") ? base64.split(",").pop()! : base64;
  let sizeBytes: number;
  try {
    sizeBytes = Buffer.from(payload, "base64").length;
  } catch {
    return { ok: false, error: "Invalid file encoding" };
  }
  if (sizeBytes <= 0) return { ok: false, error: "Empty file" };
  if (sizeBytes > GRANT_UPLOAD_MAX_BYTES) {
    return { ok: false, error: `File exceeds ${GRANT_UPLOAD_MAX_BYTES / (1024 * 1024)} MB limit` };
  }
  return { ok: true, mime, sizeBytes };
}
