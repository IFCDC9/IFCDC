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

export async function getWidgets(token: string): Promise<DashboardWidget[]> {
  const res = await fetch(`${API_BASE}/api/dashboard/widgets`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch widgets");
  return res.json();
}

export async function addWidget(
  token: string,
  widgetType: string,
  title?: string,
  layout?: WidgetLayout
): Promise<DashboardWidget> {
  const res = await fetch(`${API_BASE}/api/dashboard/widgets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ widgetType, title, layout }),
  });
  if (!res.ok) throw new Error("Failed to add widget");
  return res.json();
}

export async function updateWidget(
  token: string,
  id: string,
  updates: { title?: string; layout?: WidgetLayout; settings?: Record<string, any> }
): Promise<DashboardWidget> {
  const res = await fetch(`${API_BASE}/api/dashboard/widgets/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update widget");
  return res.json();
}

export async function batchUpdateLayouts(
  token: string,
  updates: { id: string; layout: WidgetLayout }[]
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/dashboard/widgets/batch-layout`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to batch update layouts");
}

export async function deleteWidget(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/dashboard/widgets/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to delete widget");
}

export async function getWidgetData(token: string, type: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/dashboard/widget-data/${type}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch widget data");
  return res.json();
}
