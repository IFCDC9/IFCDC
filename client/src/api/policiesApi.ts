async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/policies${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface PolicyDashboard {
  total: number;
  published: number;
  pending: number;
  drafts: number;
  reviewsDueSoon: number;
  reviewsOverdue: number;
  acknowledgmentRequired: number;
  acknowledgments: number;
  categories: number;
  categoriesUsed: { id: string; label: string; count: number }[];
  vaultPath: string;
  compliancePath: string;
  operationsCompliancePath: string;
  generatedAt: string;
}

export interface PolicyListItem {
  id: string;
  title: string;
  policy_number: string;
  department: string;
  category: string;
  categoryLabel: string;
  approval_status: string;
  version_number: string;
  effective_date?: string;
  next_review_date?: string;
  purpose_preview?: string;
  means_preview?: string;
  requires_acknowledgment?: number;
}

export const policiesApi = {
  dashboard: () => apiFetch<PolicyDashboard>("/dashboard"),
  categories: () => apiFetch<{ categories: { id: string; label: string; count: number }[] }>("/categories"),
  search: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    const q = qs.toString();
    return apiFetch<{ policies: PolicyListItem[]; count: number }>(`/search${q ? `?${q}` : ""}`);
  },
  get: (id: string) => apiFetch<Record<string, unknown>>(`/${id}`),
  create: (body: Record<string, unknown>) =>
    apiFetch("/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) =>
    apiFetch(`/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  submit: (id: string) => apiFetch(`/${id}/submit`, { method: "POST" }),
  approve: (id: string, body: Record<string, unknown>) =>
    apiFetch(`/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  publish: (id: string) => apiFetch(`/${id}/publish`, { method: "POST" }),
  acknowledge: (id: string, body: Record<string, unknown>) =>
    apiFetch(`/${id}/acknowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  acknowledgments: (policyId?: string) =>
    apiFetch<{ acknowledgments: Record<string, unknown>[] }>(
      `/acknowledgments${policyId ? `?policy_id=${policyId}` : ""}`
    ),
  reviews: () => apiFetch<{ reviews: Record<string, unknown>[] }>("/reviews"),
  activity: () => apiFetch<{ activity: Record<string, unknown>[] }>("/activity"),
  report: () => apiFetch<Record<string, unknown>>("/report"),
};
