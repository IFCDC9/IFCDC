import { hqApiFetch } from "./hqApiFetch";
import { PHASE9_FETCH_TIMEOUT_MS } from "../data/phase9Defaults";

async function apiFetch<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...init } = options ?? {};
  return hqApiFetch<T>(`/api/hq/phase9${path}`, { ...init, timeoutMs });
}

export const phase9Api = {
  package: () => apiFetch<Record<string, unknown>>("/package", { timeoutMs: PHASE9_FETCH_TIMEOUT_MS }),
  commandCenter: () => apiFetch<Record<string, unknown>>("/command-center"),
  loginBriefing: () => apiFetch<{
    greeting: string;
    organizationHealth: { overall: number; grade: string };
    highlights: string[];
    priorities: string[];
    riskCount: number;
    complianceOverdue: number;
    recommendations: { action: string; priority: string }[];
    generatedAt: string;
  }>("/login-briefing"),
  predictive: () => apiFetch<Record<string, unknown>>("/predictive", { timeoutMs: PHASE9_FETCH_TIMEOUT_MS }),
  grantProbability: () => apiFetch<{ scores: { opportunityId: string; title: string; probability: number; factors: string[] }[] }>("/grant-probability"),
  divisions: () => apiFetch<Record<string, unknown>>("/divisions"),
  workflows: () => apiFetch<Record<string, unknown>>("/workflows"),
  reporting: () => apiFetch<Record<string, unknown>>("/reporting"),
  deliverReport: (type: "briefing" | "board-report", opts?: { sendEmail?: boolean }) =>
    apiFetch<Record<string, unknown>>(`/reporting/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    }),
  search: (q: string) => apiFetch<{ results: { type: string; id: string; title: string; subtitle: string; path: string }[]; count: number }>(`/search?q=${encodeURIComponent(q)}`),
  notifications: () => apiFetch<{
    notifications: { id: string; type: string; title: string; message: string; priority: string; read: boolean; path?: string; timestamp: string }[];
    unreadCount: number;
    highPriorityCount: number;
    executiveQueue: unknown[];
  }>("/notifications"),
  markRead: (id: string) =>
    apiFetch<{ ok: boolean }>(`/notifications/${id}/read`, { method: "PATCH" }),
};
