/** Document Management — allow upload + overview without false timeouts. */
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
  // Legacy categories still in database
  { id: "general", label: "General" },
  { id: "personnel", label: "Personnel" },
  { id: "financial", label: "Financial" },
] as const;

export const DEPARTMENTS_PLACEHOLDER = [
  { id: "", label: "— No department —" },
];

export type DocumentsOverview = {
  total: number;
  byCategory: { category: string; count: number }[];
  pendingApprovals?: number;
  archived?: number;
};

export const EMPTY_DOCUMENTS_OVERVIEW: DocumentsOverview = {
  total: 0,
  byCategory: [],
  pendingApprovals: 0,
  archived: 0,
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
  created_at: string;
  updated_at: string;
};

export const EMPTY_DOCUMENT_LIST: { documents: HQDocumentRow[] } = {
  documents: [],
};

export function categoryLabel(id: string): string {
  return DOCUMENT_CATEGORIES.find((c) => c.id === id)?.label ?? id.replace(/_/g, " ");
}
