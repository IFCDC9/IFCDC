async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/phase10${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
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
  package: () => apiFetch<Record<string, unknown>>("/package"),
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
