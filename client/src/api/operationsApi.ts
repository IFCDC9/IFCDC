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

export interface ExecutiveOpsDashboard {
  version: string;
  generatedAt: string;
  organizationHealth: number;
  operationalHealth: number;
  financialHealth: number;
  grantActivity: { active: number; deadlinesSoon: number };
  employeeActivity: { active: number; openLeave: number };
  volunteerActivity: { active: number };
  activePrograms: number;
  clientServices: { clients: number; housingPlacements: number; scholarshipAwards: number };
  openTasks: { total: number; overdue: number };
  activeProjects: number;
  complianceStatus: {
    status: string;
    openFilings: number;
    overdue: number;
    dueSoon: number;
    highRisk: number;
    openRisks: number;
    policies: number;
  };
  systemAlerts: { id: string; severity: string; title: string; detail: string; path: string }[];
  upcomingDeadlines: { id: string; title: string; dueDate: string; kind: string; meta: string }[];
  automation: { pendingApprovals: number; scheduledJobs: number };
  operationsSnapshot: OperationsOverview;
  softwareApps: number;
  media: OperationsOverview["media"];
}

export interface ExecutiveDepartment {
  id: string;
  label: string;
  code: string;
  path: string;
  docsPath: string;
  reportsPath: string;
  linkedDepartmentId: string | null;
  linkedDepartmentName: string;
  kpis: { key: string; value: number }[];
  health: string;
}

export const operationsApi = {
  overview: () => apiFetch<OperationsOverview>("/overview"),
  commandCenterV3: () => apiFetch<Record<string, unknown>>("/command-center/v3/platform"),
  tasks: (status?: string) => apiFetch<{ tasks: Record<string, unknown>[] }>(`/tasks${status ? `?status=${status}` : ""}`),
  createTask: (body: Record<string, unknown>) =>
    apiFetch("/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  updateTask: (id: string, body: Record<string, unknown>) =>
    apiFetch(`/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  foundationDashboard: () => apiFetch<ExecutiveOpsDashboard>("/foundation/dashboard"),
  foundationDepartments: () => apiFetch<{ departments: ExecutiveDepartment[]; generatedAt: string }>("/foundation/departments"),
  foundationReport: () => apiFetch<Record<string, unknown>>("/foundation/report"),
  foundationAutomation: () =>
    apiFetch<{
      definitions: Record<string, unknown>[];
      scheduledJobs: Record<string, unknown>[];
      pendingApprovals: Record<string, unknown>[];
    }>("/foundation/automation"),
  complianceFilings: (status?: string) =>
    apiFetch<{ filings: Record<string, unknown>[] }>(`/foundation/compliance${status ? `?status=${status}` : ""}`),
  createComplianceFiling: (body: Record<string, unknown>) =>
    apiFetch("/foundation/compliance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  updateComplianceFiling: (id: string, body: Record<string, unknown>) =>
    apiFetch(`/foundation/compliance/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  projects: (status?: string) =>
    apiFetch<{ projects: Record<string, unknown>[] }>(`/projects${status ? `?status=${status}` : ""}`),
  createProject: (body: Record<string, unknown>) =>
    apiFetch("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  updateProject: (id: string, body: Record<string, unknown>) =>
    apiFetch(`/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  createMilestone: (projectId: string, body: Record<string, unknown>) =>
    apiFetch(`/projects/${projectId}/milestones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
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
