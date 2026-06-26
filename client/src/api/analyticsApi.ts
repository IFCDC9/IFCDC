import type { ActivityItem } from "./hqApi";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/analytics${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface OrganizationHealthScore {
  overall: number;
  grade: string;
  factors: { label: string; score: number; max: number; weight: string }[];
}

export interface AnalyticsOverview {
  organizationHealth: OrganizationHealthScore;
  finance: { totalRevenue: number; monthlyExpenses: number; cashFlow: number; netPosition: number; financialHealthScore: number };
  grants: { totalAwarded: number; activeAwards: number; pipelineValue: number; winRate: number; complianceDue: number };
  people: { totalPeople: number; employees: number; volunteers: number; activePayroll: number; hoursThisMonth: number };
  programs: { programsRunning: number; participants: number };
  donations: { total: number; monthly: number; count: number };
  software: { total: number; healthy: number; production: number; inDevelopment: number };
  timestamp: string;
}

export type ReportPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "annual";

export const analyticsApi = {
  overview: () => apiFetch<AnalyticsOverview>("/overview"),
  healthScore: () => apiFetch<OrganizationHealthScore>("/health-score"),
  finance: () => apiFetch<Record<string, unknown>>("/finance"),
  grants: () => apiFetch<Record<string, unknown>>("/grants"),
  people: () => apiFetch<Record<string, unknown>>("/people"),
  payroll: () => apiFetch<Record<string, unknown>>("/payroll"),
  donations: () => apiFetch<Record<string, unknown>>("/donations"),
  programs: () => apiFetch<Record<string, unknown>>("/programs"),
  software: () => apiFetch<Record<string, unknown>>("/software"),
  activity: (limit = 30) => apiFetch<{ activity: ActivityItem[] }>(`/activity?limit=${limit}`),
  trends: () => apiFetch<Record<string, unknown>>("/trends"),
  kpiMonitoring: () => apiFetch<Record<string, unknown>>("/kpi-monitoring"),
  commandCenter: () => apiFetch<Record<string, unknown>>("/command-center"),
  dailyBriefing: (refresh?: boolean) =>
    apiFetch<{ id: string; title: string; content: string; highlights: string[]; generatedAt: string; cached: boolean }>(
      `/daily-briefing${refresh ? "?refresh=true" : ""}`
    ),
  trendAnalysis: () => apiFetch<Record<string, unknown>>("/trends/analysis"),
  predictiveKpi: () => apiFetch<Record<string, unknown>>("/predictive-kpi"),
  board: () => apiFetch<Record<string, unknown>>("/board"),
  founder: () => apiFetch<Record<string, unknown>>("/founder"),
  report: (period: ReportPeriod) => apiFetch<Record<string, unknown>>(`/reports/${period}`),
  auraInsights: (message?: string) =>
    apiFetch<{ insight: string; overview: OrganizationHealthScore; offline?: boolean }>("/aura-insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }),
  exportCsvUrl: (period: ReportPeriod = "monthly") => `/api/hq/analytics/export/csv?period=${period}`,
};

export function downloadReportJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
