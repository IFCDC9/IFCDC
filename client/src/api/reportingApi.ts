async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/reporting${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface ReportCatalogItem {
  id: string;
  category: string;
  title: string;
  description: string;
  frequency: string;
  endpoint: string;
}

export const reportingApi = {
  catalog: () => api<{ reports: ReportCatalogItem[] }>("/catalog"),
  irs990: () => api<Record<string, unknown>>("/irs/990"),
  funderGrant: (awardId?: string) => api<Record<string, unknown>>(`/funder/grant${awardId ? `?awardId=${awardId}` : ""}`),
  funderPipeline: () => api<Record<string, unknown>>("/funder/pipeline"),
  stateAnnual: () => api<Record<string, unknown>>("/state/annual"),
  stateCharitable: () => api<Record<string, unknown>>("/state/charitable"),
  internalManagement: () => api<Record<string, unknown>>("/internal/management"),
  internalFinance: () => api<Record<string, unknown>>("/internal/finance"),
  boardPackage: () => api<Record<string, unknown>>("/board/package"),
  annualOrganizational: () => api<Record<string, unknown>>("/annual/organizational"),
};
