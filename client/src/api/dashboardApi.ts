const API_BASE = "";

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardWidget {
  id: string;
  userId: string;
  widgetType: string;
  title: string;
  layout: WidgetLayout;
  settings: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export async function getWidgets(): Promise<DashboardWidget[]> {
  const res = await fetch(`${API_BASE}/api/dashboard/widgets`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch widgets");
  return res.json();
}

export async function addWidget(
  widgetType: string,
  title?: string,
  layout?: WidgetLayout
): Promise<DashboardWidget> {
  const res = await fetch(`${API_BASE}/api/dashboard/widgets`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ widgetType, title, layout }),
  });
  if (!res.ok) throw new Error("Failed to add widget");
  return res.json();
}

export async function updateWidget(
  id: string,
  updates: { title?: string; layout?: WidgetLayout; settings?: Record<string, any> }
): Promise<DashboardWidget> {
  const res = await fetch(`${API_BASE}/api/dashboard/widgets/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update widget");
  return res.json();
}

export async function batchUpdateLayouts(
  updates: { id: string; layout: WidgetLayout }[]
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/dashboard/widgets/batch-layout`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to batch update layouts");
}

export async function deleteWidget(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/dashboard/widgets/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete widget");
}

export async function getWidgetData(type: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/dashboard/widget-data/${type}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch widget data");
  return res.json();
}
