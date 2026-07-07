import { hqApiFetch } from "./hqApiFetch";

async function apiFetch<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...init } = options ?? {};
  return hqApiFetch<T>(`/api/hq/workflows${path}`, { ...init, timeoutMs });
}

export interface WorkflowDefinition {
  id: string;
  workflow_key: string;
  name: string;
  description: string;
  category: string;
  trigger_type?: string;
  steps_json: string;
  enabled: number;
  instanceCount?: number;
  pendingCount?: number;
  lastInstanceAt?: string | null;
  operationalStatus?: string;
}

export interface WorkflowInstance {
  id: string;
  workflow_key: string;
  title: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  entity_type: string | null;
  entity_id: string | null;
  due_at: string | null;
  created_at: string;
  active_step_name?: string | null;
  active_step_key?: string | null;
  can_advance?: boolean;
}

export interface ScheduledJob {
  id: string;
  job_key: string;
  name: string;
  schedule: string;
  schedule_expr?: string;
  last_run_at: string | null;
  next_run_at?: string | null;
  enabled: number;
  runStatus?: string;
  lastError?: string | null;
  sourceModule?: string;
}

export const workflowApi = {
  dashboard: () =>
    apiFetch<{
      definitions: WorkflowDefinition[];
      instances: WorkflowInstance[];
      jobs: ScheduledJob[];
      approvalTasks: unknown[];
      counts: Record<string, number>;
      timestamp: string;
    }>("/dashboard"),
  definitions: () => apiFetch<{ definitions: WorkflowDefinition[] }>("/definitions").catch(() => ({ definitions: [] })),
  instances: (params?: { status?: string; workflow_key?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.workflow_key) qs.set("workflow_key", params.workflow_key);
    const q = qs.toString();
    return apiFetch<{ instances: WorkflowInstance[] }>(q ? `/instances?${q}` : "/instances").catch(() => ({ instances: [] }));
  },
  jobs: () => apiFetch<{ jobs: ScheduledJob[] }>("/jobs").catch(() => ({ jobs: [] })),
  processApproval: (taskId: string, action: "approve" | "reject" | "complete") =>
    apiFetch<{ success: boolean; message?: string }>(`/approvals/${taskId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }),
  runScheduled: () =>
    apiFetch<{ ran: string[]; errors: string[] }>("/run-scheduled", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  runJob: (jobKey: string) =>
    apiFetch<{ ok: boolean; jobKey?: string; ranAt?: string; error?: string }>(`/jobs/${jobKey}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  setJobEnabled: (jobKey: string, enabled: boolean) =>
    apiFetch<{ job: ScheduledJob }>(`/jobs/${jobKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  instanceDetail: (id: string) =>
    apiFetch<{ instance: WorkflowInstance; steps?: unknown[] }>(`/instances/${id}`).catch(() => null),
  steps: (id: string) =>
    apiFetch<{ steps: WorkflowStep[] }>(`/instances/${id}/steps`).catch(() => ({ steps: [] })),
  advance: (id: string, action: "approve" | "reject" | "complete") =>
    apiFetch<{ success: boolean; message: string; completed?: boolean }>(`/instances/${id}/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }),
};

export interface WorkflowStep {
  id: string;
  instance_id: string;
  step_key: string;
  step_name: string;
  step_order: number;
  status: string;
  assignee_role: string | null;
  completed_at: string | null;
  completed_by: string | null;
}
