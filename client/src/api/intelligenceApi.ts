import { hqApiFetch } from "./hqApiFetch";

async function intelFetch<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...init } = options ?? {};
  return hqApiFetch<T>(`/api/hq/intelligence${path}`, { ...init, timeoutMs });
}

export const intelligenceApi = {
  scorecard: () => intelFetch<Record<string, unknown>>("/scorecard"),
  forecast: () => intelFetch<Record<string, unknown>>("/forecast"),
  predictions: () => intelFetch<Record<string, unknown>>("/predictions"),
  complianceRisk: () => intelFetch<Record<string, unknown>>("/compliance-risk"),
  strategicRecommendations: () => intelFetch<Record<string, unknown>>("/strategic-recommendations"),
  boardReport: () => intelFetch<Record<string, unknown>>("/board-report"),
  package: () => intelFetch<Record<string, unknown>>("/package"),
  divisions: () => intelFetch<{ divisions: { id: string; name: string; healthy: boolean; summary: string; metrics: Record<string, unknown> }[] }>("/divisions"),
  division: (id: string) => intelFetch<Record<string, unknown>>(`/divisions/${id}`),
  morningBriefing: () => intelFetch<Record<string, unknown>>("/copilot/morning-briefing"),
  moduleMonitor: () => intelFetch<Record<string, unknown>>("/copilot/module-monitor"),
  correctiveActions: () => intelFetch<Record<string, unknown>>("/copilot/corrective-actions"),
  executiveSummary: () => intelFetch<Record<string, unknown>>("/copilot/executive-summary"),
  ask: (question: string) =>
    intelFetch<Record<string, unknown>>("/copilot/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  automate: (action: string, opts?: { title?: string; assignedTo?: string; payload?: Record<string, unknown> }) =>
    intelFetch<{ action: string; result: unknown }>("/copilot/automate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...opts }),
    }),
  deliverBriefing: (opts?: { to?: string; sendEmail?: boolean }) =>
    intelFetch<Record<string, unknown>>("/deliver/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    }),
  deliverBoardReport: (opts?: { to?: string; sendEmail?: boolean }) =>
    intelFetch<Record<string, unknown>>("/deliver/board-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    }),
  anomalies: () => intelFetch<{ alerts: unknown[] }>("/anomalies"),
  listReports: () => intelFetch<{ reports: { filename: string; mtime: string }[] }>("/reports"),
};
