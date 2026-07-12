/** Document Management — Enterprise Suite (Build 57). */
export const DOCUMENTS_FETCH_TIMEOUT_MS = 20_000;

export const DOCUMENT_CATEGORIES = [
  { id: "grants", label: "Grants" },
  { id: "board_records", label: "Board Records" },
  { id: "irs_nonprofit", label: "IRS / Nonprofit" },
  { id: "policies", label: "Policies" },
  { id: "contracts", label: "Contracts" },
  { id: "program_files", label: "Program Files" },
  { id: "reports", label: "Reports" },
  { id: "founder_approvals", label: "Founder Approvals" },
  { id: "general", label: "General" },
  { id: "personnel", label: "Personnel" },
  { id: "financial", label: "Financial" },
] as const;

export const DOCUMENT_FILE_TYPES = [
  { id: "pdf", label: "PDF" },
  { id: "document", label: "Word" },
  { id: "spreadsheet", label: "Excel" },
  { id: "presentation", label: "PowerPoint" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "archive", label: "ZIP / Archive" },
  { id: "text", label: "Text" },
  { id: "other", label: "Other" },
] as const;

export const DOCUMENT_VISIBILITY = [
  { id: "shared", label: "Shared" },
  { id: "private", label: "Private" },
  { id: "department", label: "Department" },
  { id: "organization", label: "Organization" },
] as const;

export const DOCUMENT_SOURCE_MODULES = [
  { id: "grants", label: "Grant Center", path: "/hq/grants" },
  { id: "executive", label: "Executive Dashboard", path: "/hq" },
  { id: "finance", label: "Finance", path: "/hq/finance" },
  { id: "hr", label: "HR / People", path: "/hq/people" },
  { id: "programs", label: "Programs", path: "/hq/programs" },
  { id: "compliance", label: "Compliance", path: "/hq/compliance" },
  { id: "board", label: "Board Portal", path: "/hq/board" },
  { id: "contracts", label: "Contracts", path: "/hq/documents?category=contracts" },
  { id: "reports", label: "Reports", path: "/hq/reports" },
] as const;

export const ACCEPT_DOCUMENT_UPLOAD =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mov,.mp3,.wav,.ogg,.zip,.csv,.txt,.rtf";

export type DocumentsOverview = {
  total: number;
  byCategory: { category: string; count: number }[];
  pendingApprovals?: number;
  archived?: number;
  facets?: Record<string, { value: string; count: number }[]>;
  byVisibility?: { visibility: string; count: number }[];
  moduleLinks?: typeof DOCUMENT_SOURCE_MODULES;
  recentActivity?: DocumentActivityRow[];
  indexed?: number;
  degraded?: boolean;
};

export const EMPTY_DOCUMENTS_OVERVIEW: DocumentsOverview = {
  total: 0,
  byCategory: [],
  pendingApprovals: 0,
  archived: 0,
  facets: {},
  recentActivity: [],
  indexed: 0,
};

export type DocumentActivityRow = {
  id: string;
  document_id: string;
  action: string;
  actor_email?: string | null;
  actor_role?: string | null;
  detail?: string | null;
  created_at: string;
  document_title?: string;
};

export type HQDocumentRow = {
  id: string;
  title: string;
  category: string;
  file_url: string | null;
  version: number;
  access_level: string;
  approval_status?: string;
  lifecycle_status?: string;
  signature_status?: string;
  signed_by?: string | null;
  signed_at?: string | null;
  ocr_text?: string | null;
  person_id: string | null;
  grant_id: string | null;
  department_id?: string | null;
  department_name?: string | null;
  owner_name?: string | null;
  submitted_by?: string | null;
  program_id?: string | null;
  project_id?: string | null;
  tags?: string[];
  labels?: string[];
  tags_json?: string | null;
  labels_json?: string | null;
  custom_metadata?: Record<string, string>;
  mime_type?: string | null;
  file_type?: string | null;
  owner_email?: string | null;
  visibility?: string | null;
  source_module?: string | null;
  file_name?: string | null;
  file_size_bytes?: number | null;
  created_at: string;
  updated_at: string;
};

export const EMPTY_DOCUMENT_LIST: { documents: HQDocumentRow[]; total?: number; facets?: DocumentsOverview["facets"]; degraded?: boolean } = {
  documents: [],
  total: 0,
  facets: {},
};

export function categoryLabel(id: string): string {
  return DOCUMENT_CATEGORIES.find((c) => c.id === id)?.label ?? id.replace(/_/g, " ");
}

export function fileTypeLabel(id?: string | null): string {
  if (!id) return "File";
  return DOCUMENT_FILE_TYPES.find((c) => c.id === id)?.label ?? id;
}

export type PreviewKind = "pdf" | "image" | "text" | "video" | "audio" | "office" | "other";

export function detectPreviewKind(url: string | null | undefined, mimeType?: string | null, fileType?: string | null): PreviewKind {
  if (!url) return "other";
  const lower = url.toLowerCase().split("?")[0] ?? "";
  const mime = (mimeType || "").toLowerCase();
  const ft = (fileType || "").toLowerCase();
  if (ft === "pdf" || mime.includes("pdf") || lower.endsWith(".pdf")) return "pdf";
  if (ft === "image" || mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return "image";
  if (ft === "video" || mime.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/.test(lower)) return "video";
  if (ft === "audio" || mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a)$/.test(lower)) return "audio";
  if (ft === "text" || mime.startsWith("text/") || lower.endsWith(".txt") || lower.endsWith(".csv")) return "text";
  if (
    ft === "document" ||
    ft === "spreadsheet" ||
    ft === "presentation" ||
    mime.includes("word") ||
    mime.includes("excel") ||
    mime.includes("powerpoint") ||
    mime.includes("spreadsheet") ||
    mime.includes("presentation") ||
    /\.(docx?|xlsx?|pptx?)$/.test(lower)
  ) {
    return "office";
  }
  return "other";
}

export function isPreviewableUrl(url: string | null | undefined, mimeType?: string | null, fileType?: string | null): boolean {
  const kind = detectPreviewKind(url, mimeType, fileType);
  return kind === "pdf" || kind === "image" || kind === "text" || kind === "video" || kind === "audio" || kind === "office";
}
