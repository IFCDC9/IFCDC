import { hqApiFetch } from "./hqApiFetch";
import { DOCUMENTS_FETCH_TIMEOUT_MS } from "../data/documentsDefaults";
import type { DocumentActivityRow, DocumentsOverview, HQDocumentRow } from "../data/documentsDefaults";

async function api<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = DOCUMENTS_FETCH_TIMEOUT_MS, ...init } = options ?? {};
  return hqApiFetch<T>(`/api/hq/documents${path}`, { ...init, timeoutMs });
}

export interface HQDocument extends HQDocumentRow {}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version: number;
  title: string;
  file_url: string | null;
  change_notes: string;
  uploaded_by: string;
  created_at: string;
}

export interface DocumentListParams {
  q?: string;
  category?: string;
  department_id?: string;
  program_id?: string;
  project_id?: string;
  grant_id?: string;
  person_id?: string;
  file_type?: string;
  owner?: string;
  status?: string;
  access_level?: string;
  visibility?: string;
  tag?: string;
  source_module?: string;
  created_from?: string;
  created_to?: string;
  modified_from?: string;
  modified_to?: string;
  archived?: boolean;
}

export interface DocumentUploadPayload {
  fileName: string;
  base64: string;
  mimeType?: string;
  title: string;
  category?: string;
  access_level?: string;
  grant_id?: string;
  person_id?: string;
  department_id?: string;
  program_id?: string;
  project_id?: string;
  requires_approval?: boolean;
  tags?: string[] | string;
  labels?: string[] | string;
  custom_metadata?: Record<string, string>;
  visibility?: string;
  source_module?: string;
}

function toQuery(params?: DocumentListParams): string {
  if (!params) return "";
  const qs = new URLSearchParams();
  const entries: [keyof DocumentListParams, string | boolean | undefined][] = [
    ["q", params.q],
    ["category", params.category],
    ["department_id", params.department_id],
    ["program_id", params.program_id],
    ["project_id", params.project_id],
    ["grant_id", params.grant_id],
    ["person_id", params.person_id],
    ["file_type", params.file_type],
    ["owner", params.owner],
    ["status", params.status],
    ["access_level", params.access_level],
    ["visibility", params.visibility],
    ["tag", params.tag],
    ["source_module", params.source_module],
    ["created_from", params.created_from],
    ["created_to", params.created_to],
    ["modified_from", params.modified_from],
    ["modified_to", params.modified_to],
  ];
  for (const [key, value] of entries) {
    if (typeof value === "string" && value) qs.set(key, value);
  }
  if (params.archived) qs.set("archived", "1");
  const q = qs.toString();
  return q ? `?${q}` : "";
}

export const documentsApi = {
  overview: () => api<DocumentsOverview>("/overview"),
  library: () => api<DocumentsOverview>("/library"),
  list: (params?: DocumentListParams) =>
    api<{ documents: HQDocument[]; total?: number; facets?: DocumentsOverview["facets"]; degraded?: boolean }>(
      toQuery(params)
    ),
  search: (params?: DocumentListParams) =>
    api<{ documents: HQDocument[]; total: number; facets: DocumentsOverview["facets"]; degraded?: boolean }>(
      `/search${toQuery(params)}`
    ),
  modules: () => api<{ modules: { id: string; label: string; path: string; category: string }[] }>("/modules"),
  moduleSnapshot: (moduleId: string) =>
    api<{ module: string; label: string; path: string; documents: HQDocument[]; total: number }>(`/modules/${moduleId}`),
  get: (id: string) =>
    api<{ document: HQDocument; versions: DocumentVersion[]; activity: DocumentActivityRow[] }>(`/${id}`),
  activity: (id: string) => api<{ activity: DocumentActivityRow[] }>(`/${id}/activity`),
  secureDownload: (id: string) => api<{ url: string; title: string }>(`/${id}/download`, { method: "POST", body: "{}" }),
  reindex: () => api<{ ok: boolean; indexed: number }>("/reindex", { method: "POST", body: "{}" }),
  create: (data: Omit<DocumentUploadPayload, "fileName" | "base64" | "mimeType"> & { file_url?: string }) =>
    api("/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  upload: (data: DocumentUploadPayload) =>
    api<{ document: HQDocument; file: { url: string; path: string } }>("/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  addVersion: (id: string, data: { title?: string; file_url?: string; change_notes?: string; mimeType?: string; fileName?: string }) =>
    api(`/${id}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  restoreVersion: (id: string, versionId: string) =>
    api(`/${id}/versions/${versionId}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  update: (id: string, data: Partial<HQDocument> & { tags?: string[] | string; labels?: string[] | string; custom_metadata?: Record<string, string> }) =>
    api(`/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  review: (id: string, action: "approve" | "reject") =>
    api(`/${id}/approval`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }),
  archive: (id: string, archived = true) =>
    api(`/${id}/archive`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived }) }),
  ocrIndex: (id: string, text: string) =>
    api<{ document: HQDocument }>(`/${id}/ocr-index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  sign: (id: string, signatureData: string, signerName?: string) =>
    api<{ document: HQDocument }>(`/${id}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signatureData, signerName }),
    }),
};
