import { hqApiFetch } from "./hqApiFetch";
import { DOCUMENTS_FETCH_TIMEOUT_MS } from "../data/documentsDefaults";
import type { DocumentsOverview, HQDocumentRow } from "../data/documentsDefaults";

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
  requires_approval?: boolean;
}

export const documentsApi = {
  overview: () => api<DocumentsOverview>("/overview"),
  list: (params?: { q?: string; category?: string; grant_id?: string; person_id?: string; archived?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.category) qs.set("category", params.category);
    if (params?.grant_id) qs.set("grant_id", params.grant_id);
    if (params?.person_id) qs.set("person_id", params.person_id);
    if (params?.archived) qs.set("archived", "1");
    const q = qs.toString();
    return api<{ documents: HQDocument[]; degraded?: boolean }>(q ? `?${q}` : "");
  },
  get: (id: string) => api<{ document: HQDocument; versions: DocumentVersion[] }>(`/${id}`),
  create: (data: {
    title: string;
    category?: string;
    file_url?: string;
    access_level?: string;
    grant_id?: string;
    person_id?: string;
    department_id?: string;
    requires_approval?: boolean;
  }) =>
    api("/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  upload: (data: DocumentUploadPayload) =>
    api<{ document: HQDocument; file: { url: string; path: string } }>("/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  addVersion: (id: string, data: { title?: string; file_url?: string; change_notes?: string }) =>
    api(`/${id}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  update: (id: string, data: Partial<HQDocument>) =>
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
