import { hqApiFetch, HQ_HEAVY_FETCH_TIMEOUT_MS } from "./hqApiFetch";

async function apiFetch<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...init } = options ?? {};
  return hqApiFetch<T>(`/api/hq/phase10${path}`, { ...init, timeoutMs });
}

export interface ScenarioProjection {
  id: string;
  label: string;
  baseline: number;
  projected: number;
  unit: string;
  delta: number;
  deltaPercent: number;
  insight: string;
}

export interface ScenarioResult {
  scenario: Record<string, number | undefined>;
  horizonMonths: number;
  projections: ScenarioProjection[];
  summary: {
    cashFlowImpact: number;
    healthImpact: number;
    staffingGap: number;
    communityImpact: number;
    riskLevel: string;
    recommendation: string;
  };
}

export const phase10Api = {
  package: () => apiFetch<Record<string, unknown>>("/package", { timeoutMs: HQ_HEAVY_FETCH_TIMEOUT_MS }),
  missionControl: () => apiFetch<Record<string, unknown>>("/mission-control"),
  roleHome: () => apiFetch<{ path: string; role: string }>("/role-home"),
  enterpriseAI: () => apiFetch<Record<string, unknown>>("/enterprise-ai"),
  ask: (question: string) =>
    apiFetch<{ answer: string; sources?: string[] }>("/enterprise-ai/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  operations: () => apiFetch<Record<string, unknown>>("/operations"),
  tasks: () => apiFetch<{ tasks: unknown[]; counts: Record<string, number> }>("/tasks"),
  decisionIntelligence: () => apiFetch<Record<string, unknown>>("/decision-intelligence"),
  runScenario: (input: Record<string, number | undefined>) =>
    apiFetch<ScenarioResult>("/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  commandConsole: () => apiFetch<Record<string, unknown>>("/command-console"),
  search: (q: string) =>
    apiFetch<{ results: { type: string; title: string; subtitle: string; path: string }[]; count: number }>(
      `/search?q=${encodeURIComponent(q)}`
    ),
};
