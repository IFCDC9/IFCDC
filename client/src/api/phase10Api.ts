import { hqApiFetch, HQ_HEAVY_FETCH_TIMEOUT_MS } from "./hqApiFetch";
import { MISSION_CONTROL_FETCH_TIMEOUT_MS } from "../data/missionControlDefaults";
import type {
  HqAuditEntry,
  HqFounderDecision,
  HqMission,
  HqMissionTask,
  HqObjective,
  HqExecutiveNote,
  MissionControlCommandCenter,
} from "./missionControlTypes";

async function apiFetch<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...init } = options ?? {};
  return hqApiFetch<T>(`/api/hq/phase10${path}`, { ...init, timeoutMs });
}

function jsonBody(method: string, body: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
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
  missionControl: () =>
    apiFetch<MissionControlCommandCenter>("/mission-control", {
      timeoutMs: MISSION_CONTROL_FETCH_TIMEOUT_MS,
    }),
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

  listMissions: (status?: string) =>
    apiFetch<{ missions: HqMission[] }>(status ? `/missions?status=${status}` : "/missions"),
  createMission: (body: Record<string, unknown>) =>
    apiFetch<{ mission: HqMission }>("/missions", jsonBody("POST", body)),
  updateMission: (id: string, body: Record<string, unknown>) =>
    apiFetch<{ mission: HqMission }>(`/missions/${id}`, jsonBody("PATCH", body)),
  deleteMission: (id: string) => apiFetch<{ ok: boolean }>(`/missions/${id}`, { method: "DELETE" }),

  listObjectives: (params?: { objectiveType?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.objectiveType) q.set("objectiveType", params.objectiveType);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return apiFetch<{ objectives: HqObjective[] }>(`/objectives${qs ? `?${qs}` : ""}`);
  },
  createObjective: (body: Record<string, unknown>) =>
    apiFetch<{ objective: HqObjective }>("/objectives", jsonBody("POST", body)),
  updateObjective: (id: string, body: Record<string, unknown>) =>
    apiFetch<{ objective: HqObjective }>(`/objectives/${id}`, jsonBody("PATCH", body)),
  deleteObjective: (id: string) => apiFetch<{ ok: boolean }>(`/objectives/${id}`, { method: "DELETE" }),

  listMissionTasks: (params?: { status?: string; missionId?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.missionId) q.set("missionId", params.missionId);
    const qs = q.toString();
    return apiFetch<{ tasks: HqMissionTask[] }>(`/mission-tasks${qs ? `?${qs}` : ""}`);
  },
  createMissionTask: (body: Record<string, unknown>) =>
    apiFetch<{ task: HqMissionTask }>("/mission-tasks", jsonBody("POST", body)),
  updateMissionTask: (id: string, body: Record<string, unknown>) =>
    apiFetch<{ task: HqMissionTask }>(`/mission-tasks/${id}`, jsonBody("PATCH", body)),
  approveMissionTask: (id: string) =>
    apiFetch<{ task: HqMissionTask }>(`/mission-tasks/${id}/approve`, { method: "POST" }),
  rejectMissionTask: (id: string, reason: string) =>
    apiFetch<{ task: HqMissionTask }>(`/mission-tasks/${id}/reject`, jsonBody("POST", { reason })),
  getTaskHistory: (id: string) => apiFetch<{ history: unknown[] }>(`/mission-tasks/${id}/history`),

  listFounderDecisions: (status?: string) =>
    apiFetch<{ decisions: HqFounderDecision[] }>(status ? `/founder-decisions?status=${status}` : "/founder-decisions"),
  createFounderDecision: (body: Record<string, unknown>) =>
    apiFetch<{ decision: HqFounderDecision }>("/founder-decisions", jsonBody("POST", body)),
  decideFounderDecision: (id: string, decision: "approved" | "rejected", note?: string) =>
    apiFetch<{ decision: HqFounderDecision }>(`/founder-decisions/${id}/decide`, jsonBody("POST", { decision, note })),

  listExecutiveNotes: () => apiFetch<{ notes: HqExecutiveNote[] }>("/executive-notes"),
  createExecutiveNote: (body: Record<string, unknown>) =>
    apiFetch<{ note: HqExecutiveNote }>("/executive-notes", jsonBody("POST", body)),

  audit: (params?: { limit?: number; entityType?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.entityType) q.set("entityType", params.entityType);
    const qs = q.toString();
    return apiFetch<{ entries: HqAuditEntry[] }>(`/audit${qs ? `?${qs}` : ""}`);
  },
};
