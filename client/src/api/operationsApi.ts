async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/operations${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface OperationsOverview {
  housing: { units: number; available: number; applications: number; placements: number };
  scholarships: { programs: number; applications: number; awarded: number };
  media: { content: number; published: number; broadcasts: number };
  documents: { total: number };
  assets: { total: number };
  fleet: { vehicles: number; maintenanceDue: number };
  facilities: { properties: number; openWorkOrders: number };
  board: { upcomingMeetings: number; openActions: number };
  compliance: { policies: number; openRisks: number; highRisks: number };
  calendar: { upcomingEvents: number };
}

export const operationsApi = {
  overview: () => apiFetch<OperationsOverview>("/overview"),
  commandCenterV3: () => apiFetch<Record<string, unknown>>("/command-center/v3/platform"),
  tasks: (status?: string) => apiFetch<{ tasks: Record<string, unknown>[] }>(`/tasks${status ? `?status=${status}` : ""}`),
  createTask: (body: Record<string, unknown>) =>
    apiFetch("/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  updateTask: (id: string, body: Record<string, unknown>) =>
    apiFetch(`/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  list: (resource: string) => apiFetch<{ items: Record<string, unknown>[] }>(resource),
  create: (resource: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(resource, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  update: (resource: string, id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`${resource}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
};

export const OPS_PATHS = {
  housingUnits: "/housing/units",
  housingApplications: "/housing/applications",
  housingPlacements: "/housing/placements",
  scholarshipPrograms: "/scholarships/programs",
  scholarshipApplications: "/scholarships/applications",
  mediaContent: "/media/content",
  mediaBroadcasts: "/media/broadcasts",
  documents: "/documents",
  assets: "/assets",
  fleetVehicles: "/fleet/vehicles",
  fleetMaintenance: "/fleet/maintenance",
  facilities: "/facilities",
  workOrders: "/facilities/work-orders",
  boardMeetings: "/board/meetings",
  boardActions: "/board/actions",
  compliancePolicies: "/compliance/policies",
  complianceRisks: "/compliance/risks",
  calendarEvents: "/calendar/events",
} as const;
