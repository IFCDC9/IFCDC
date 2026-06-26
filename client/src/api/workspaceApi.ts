import type { StoredWidgetLayout } from "../config/executiveWidgets";

export interface UserWorkspace {
  dashboardMode: "standard" | "custom";
  widgets: StoredWidgetLayout[];
  persisted: boolean;
  updatedAt: string | null;
  template?: { key: string; name: string; autoLoaded?: boolean };
  enterpriseRole?: string;
}

async function workspaceFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/workspace${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const workspaceApi = {
  load: () => workspaceFetch<UserWorkspace>("/dashboard"),
  save: (data: { dashboardMode?: "standard" | "custom"; widgets?: StoredWidgetLayout[] }) =>
    workspaceFetch<UserWorkspace>("/dashboard", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  templates: () => workspaceFetch<{ templates: { key: string; name: string; description: string; widgetCount: number }[] }>("/templates"),
  applyTemplate: (templateKey?: string) =>
    workspaceFetch<UserWorkspace>("/dashboard/apply-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateKey }),
    }),
};
