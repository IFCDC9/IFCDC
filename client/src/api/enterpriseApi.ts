async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/enterprise${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface EnterpriseModuleStatus {
  id: string;
  name: string;
  path: string;
  section: string;
  status: "live" | "beta" | "coming-soon";
  connected: boolean;
  metric?: string;
  metricLabel?: string;
}

export interface EnterpriseSearchResult {
  type: "module" | "person" | "grant" | "program" | "page" | "document" | "application" | "invoice" | "expense" | "funder" | "compliance";
  id: string;
  title: string;
  subtitle: string;
  path: string;
}

export interface EnterpriseNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  path?: string;
  priority: "high" | "normal" | "low";
}

export interface ApprovalTask {
  id: string;
  type: "leave" | "expense" | "purchase_order" | "grant_application" | "document" | "grant_deadline" | "workflow";
  title: string;
  subtitle: string;
  amount?: number;
  dueDate?: string;
  path: string;
  entityId: string;
  priority: "high" | "normal" | "low";
  createdAt: string;
  workflowStep?: string;
  workflowKey?: string;
}

export const enterpriseApi = {
  overview: () => apiFetch<{
    modules: EnterpriseModuleStatus[];
    unreadCount: number;
    summary: { totalModules: number; liveModules: number; connectedModules: number };
  }>("/overview"),
  modules: () => apiFetch<{ modules: EnterpriseModuleStatus[] }>("/modules"),
  search: (q: string) => apiFetch<{ results: EnterpriseSearchResult[] }>(`/search?q=${encodeURIComponent(q)}`),
  notifications: () => apiFetch<{ notifications: EnterpriseNotification[]; unreadCount: number }>("/notifications"),
  markRead: (id: string) =>
    apiFetch<{ ok: boolean }>(`/notifications/${id}/read`, { method: "PATCH" }),
  approvals: () => apiFetch<{ tasks: ApprovalTask[]; counts: Record<string, number> }>("/approvals"),
  processApproval: (taskId: string, action: "approve" | "reject" | "complete") =>
    apiFetch<{ success: boolean; message?: string }>(`/approvals/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }),
};
