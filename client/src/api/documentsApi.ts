async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/documents${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface HQDocument {
  id: string;
  title: string;
  category: string;
  file_url: string | null;
  version: number;
  access_level: string;
  approval_status?: string;
  signature_status?: string;
  signed_by?: string | null;
  signed_at?: string | null;
  ocr_text?: string | null;
  person_id: string | null;
  grant_id: string | null;
  created_at: string;
  updated_at: string;
}

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

export const documentsApi = {
  overview: () => api<{ total: number; byCategory: { category: string; count: number }[] }>("/overview"),
  list: (params?: { q?: string; category?: string }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.category) qs.set("category", params.category);
    const q = qs.toString();
    return api<{ documents: HQDocument[] }>(q ? `?${q}` : "");
  },
  get: (id: string) => api<{ document: HQDocument; versions: DocumentVersion[] }>(`/${id}`),
  create: (data: { title: string; category?: string; file_url?: string; access_level?: string }) =>
    api("/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  addVersion: (id: string, data: { title?: string; file_url?: string; change_notes?: string }) =>
    api(`/${id}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  update: (id: string, data: Partial<HQDocument>) =>
    api(`/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  review: (id: string, action: "approve" | "reject") =>
    api(`/${id}/approval`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }),
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
