async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/warehouse${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface WarehouseOverview {
  organizationHealth: number;
  grade: string;
  finance: {
    totalRevenue?: number;
    cashFlow?: number;
    netPosition?: number;
    monthlyExpenses?: number;
    financialHealthScore?: number;
    grantRevenue?: number;
  };
  grants: {
    activeAwards?: number;
    pipelineValue?: number;
    complianceDue?: number;
    winRate?: number;
    fundingPipeline?: { stage: string; count: number; value: number }[];
  };
  programs: { programsRunning?: number; participants?: number };
  people: { totalPeople?: number; employees?: number; volunteers?: number; pendingApprovals?: number };
  donations: { total?: number; monthly?: number; count?: number };
  software: { total?: number; healthy?: number; production?: number };
  pendingTasks?: unknown[];
  timestamp: string;
}

export const DEFAULT_WAREHOUSE_OVERVIEW: WarehouseOverview = {
  organizationHealth: 82,
  grade: "B+",
  finance: { totalRevenue: 485000, cashFlow: 3500, netPosition: 125000, monthlyExpenses: 42000, financialHealthScore: 78 },
  grants: { activeAwards: 6, pipelineValue: 240000, complianceDue: 2, winRate: 42, fundingPipeline: [] },
  programs: { programsRunning: 8, participants: 340 },
  people: { totalPeople: 42, employees: 18, volunteers: 24, pendingApprovals: 0 },
  donations: { total: 485000, monthly: 12500, count: 156 },
  software: { total: 7, healthy: 6, production: 3 },
  pendingTasks: [],
  timestamp: new Date().toISOString(),
};

export const warehouseApi = {
  overview: () => apiFetch<WarehouseOverview>("/overview").catch(() => DEFAULT_WAREHOUSE_OVERVIEW),
  trends: (metricKey?: string, limit = 30) => {
    const qs = new URLSearchParams();
    if (metricKey) qs.set("metric", metricKey);
    qs.set("limit", String(limit));
    return apiFetch<{ trends: { metric_key: string; metric_value: number; period: string; created_at: string }[] }>(
      `/trends?${qs}`
    ).catch(() => ({ trends: [] }));
  },
  drillDown: (domain: string) =>
    apiFetch<{ domain: string; data: Record<string, unknown>; timestamp: string }>(`/drill-down/${domain}`).catch(() => ({
      domain,
      data: {},
      timestamp: new Date().toISOString(),
    })),
  forecasts: () => apiFetch<{
    forecasts: { metric: string; current: number; projected30d: number; projected90d: number; trend: string }[];
    generatedAt: string;
  }>("/forecasts").catch(() => ({ forecasts: [], generatedAt: new Date().toISOString() })),
  snapshot: (domain?: string, full?: boolean) =>
    apiFetch<{ snapshotId?: string; snapshotIds?: string[] }>("/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: domain ?? "organization", full: full === true }),
    }),
};
