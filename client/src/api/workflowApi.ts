async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/workflows${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface WorkflowDefinition {
  id: string;
  workflow_key: string;
  name: string;
  description: string;
  category: string;
  steps_json: string;
  enabled: number;
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
}

export interface ScheduledJob {
  id: string;
  job_key: string;
  name: string;
  schedule: string;
  last_run_at: string | null;
  enabled: number;
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
    }>("/dashboard").catch(() => ({
      definitions: [],
      instances: [],
      jobs: [],
      approvalTasks: [],
      counts: { total: 0, workflowPending: 0 },
      timestamp: new Date().toISOString(),
    })),
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
