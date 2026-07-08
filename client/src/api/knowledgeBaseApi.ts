import { hqApiFetch } from "./hqApiFetch";

const KB_TIMEOUT_MS = 30_000;
const KB_SYNC_TIMEOUT_MS = 180_000;

async function api<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = KB_TIMEOUT_MS, ...init } = options ?? {};
  return hqApiFetch<T>(`/api/hq/knowledge${path}`, { ...init, timeoutMs });
}

export interface KnowledgeDocument {
  id: string;
  source_type: string;
  source_key: string;
  title: string;
  category: string;
  summary: string | null;
  version: number;
  status: string;
  effective_date: string | null;
  origin: string;
  source_ref: string | null;
  token_estimate: number;
  chunk_count: number;
  embedded: number;
  updated_at: string;
  content?: string;
}

export interface KnowledgeStatus {
  total: number;
  embedded: number;
  chunks: number;
  embeddingsConfigured: boolean;
  bySource: { source_type: string; count: number }[];
  byCategory: { category: string; count: number }[];
  lastSync: {
    finished_at: string;
    status: string;
    ingested: number;
    skipped: number;
    embedded_chunks: number;
  } | null;
}

export interface KnowledgeSearchResult {
  documentId: string;
  title: string;
  sourceType: string;
  category: string;
  version: number;
  effectiveDate: string | null;
  content: string;
  score: number;
  matchType: "semantic" | "keyword";
}

export const EMPTY_KNOWLEDGE_STATUS: KnowledgeStatus = {
  total: 0,
  embedded: 0,
  chunks: 0,
  embeddingsConfigured: false,
  bySource: [],
  byCategory: [],
  lastSync: null,
};

export const knowledgeBaseApi = {
  status: () => api<KnowledgeStatus>("/status"),
  list: (params?: { source_type?: string; q?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.source_type) qs.set("source_type", params.source_type);
    if (params?.q) qs.set("q", params.q);
    if (params?.status) qs.set("status", params.status);
    const q = qs.toString();
    return api<{ documents: KnowledgeDocument[]; degraded?: boolean }>(`/documents${q ? `?${q}` : ""}`);
  },
  get: (id: string) => api<{ document: KnowledgeDocument }>(`/documents/${id}`),
  search: (query: string, topK?: number) =>
    api<{ query: string; results: KnowledgeSearchResult[] }>("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, topK }),
    }),
  sync: (embed = true) =>
    api<{ ingested: number; skipped: number; bySource: Record<string, number>; logId: string }>("/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed }),
      timeoutMs: KB_SYNC_TIMEOUT_MS,
    }),
  ingest: (data: { sourceType: string; title: string; content: string; summary?: string; effectiveDate?: string }) =>
    api<{ id: string; status: string; version: number; chunks: number; embedded: boolean }>("/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  approve: (id: string) =>
    api<{ document: KnowledgeDocument }>(`/documents/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  supersede: (id: string) =>
    api<{ document: KnowledgeDocument }>(`/documents/${id}/supersede`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
};

export const KNOWLEDGE_SOURCE_LABELS: Record<string, string> = {
  org_profile: "Organizational Profile",
  program_description: "Program Description",
  operating_budget: "Operating Budget",
  program_budget: "Program Budget",
  hr_budget: "HR & Staffing Budget",
  financial_report: "Financial Report",
  registration: "Registration (SAM/Grants.gov/501c3)",
  prior_narrative: "Prior Approved Narrative",
  grant_template: "Grant Library Template",
  policy: "Policy & Procedure",
  annual_report: "Annual Report",
  strategic_plan: "Strategic Plan",
  board_resolution: "Board Resolution",
  grant_document: "Grant Document",
  document: "Document",
};

export function sourceLabel(sourceType: string): string {
  return KNOWLEDGE_SOURCE_LABELS[sourceType] ?? sourceType;
}
