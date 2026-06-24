async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/people${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface Person {
  id: string;
  personType: string;
  personTypeLabel: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  profilePhotoUrl: string | null;
  organizationRole: string | null;
  enterpriseRole: string | null;
  departmentId: string | null;
  departmentName: string | null;
  status: string;
  location: string | null;
  startDate: string | null;
  payRate: number | null;
  payrollStatus: string | null;
  linkedExternalId: string | null;
  sourceApp: string;
  notes: string | null;
}

export interface PeopleOverview {
  total: number;
  active: number;
  departments: number;
  clockedIn: number;
  pendingLeave?: number;
  pendingOnboarding?: number;
  openIncidents?: number;
  upcomingShifts?: number;
  byType: { person_type: string; count: number }[];
  personTypes: { id: string; label: string }[];
}

export const peopleApi = {
  overview: () => api<PeopleOverview>("/overview"),
  certifications: (days?: number) => api<{
    certifications: { id: string; name: string; issuer: string; issued_date: string | null; expiry_date: string | null; first_name: string; last_name: string; person_id: string; alert: string }[];
    summary: { total: number; expired: number; expiring: number };
  }>(`/certifications${days ? `?days=${days}` : ""}`),
  search: (q: string) => api<{ people: Person[] }>(`/search?q=${encodeURIComponent(q)}`),
  list: (params?: { type?: string; department?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.type) qs.set("type", params.type);
    if (params?.department) qs.set("department", params.department);
    if (params?.status) qs.set("status", params.status);
    const q = qs.toString();
    return api<{ people: Person[] }>(q ? `?${q}` : "");
  },
  get: (id: string) => api<{
    person: Person;
    documents: { id: string; name: string; doc_type: string; file_url: string | null; uploaded_at: string }[];
    certifications: { id: string; name: string; issuer: string; issued_date: string | null; expiry_date: string | null }[];
    training: { id: string; title: string; provider: string; status: string; completed_date: string | null }[];
    performance: { id: string; review_date: string; reviewer: string; rating: string; summary: string }[];
    schedules: { id: string; title: string; schedule_date: string; start_time: string | null; end_time: string | null }[];
    timeEntries: { id: string; clock_in: string; clock_out: string | null; hours: number | null }[];
    activity: { id: string; action: string; detail: string; actor_email: string | null; created_at: string }[];
  }>(`/${id}`),
  create: (data: Record<string, unknown>) =>
    api<{ person: Person }>("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  update: (id: string, data: Record<string, unknown>) =>
    api(`/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  departments: () => api<{ departments: { id: string; name: string; code: string; member_count: number }[] }>("/departments"),
  orgChart: () => api<{ departments: unknown[]; people: unknown[] }>("/org-chart"),
  clockIn: (id: string) => api(`/${id}/clock-in`, { method: "POST" }),
  clockOut: (id: string) => api(`/${id}/clock-out`, { method: "POST" }),
  addDocument: (id: string, data: { name: string; doc_type?: string; file_url?: string }) =>
    api(`/${id}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  addTraining: (id: string, data: { title: string; provider?: string; status?: string }) =>
    api(`/${id}/training`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  addCertification: (id: string, data: { name: string; issuer?: string; expiry_date?: string }) =>
    api(`/${id}/certifications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  addSchedule: (id: string, data: { title: string; schedule_date: string; start_time?: string; end_time?: string; location?: string }) =>
    api(`/${id}/schedule`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  addPerformance: (id: string, data: { review_date: string; reviewer?: string; rating?: string; summary?: string }) =>
    api(`/${id}/performance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  createDepartment: (data: { name: string; code?: string }) =>
    api("/departments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  leaveRequests: (params?: { status?: string; person_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.person_id) qs.set("person_id", params.person_id);
    const q = qs.toString();
    return api<{ leaveRequests: LeaveRequest[] }>(`/leave-requests${q ? `?${q}` : ""}`);
  },
  createLeaveRequest: (data: { person_id: string; leave_type?: string; start_date: string; end_date: string; hours?: number; reason?: string }) =>
    api("/leave-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  reviewLeaveRequest: (id: string, data: { status: string; notes?: string }) =>
    api(`/leave-requests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  addBackgroundCheck: (personId: string, data: { check_type?: string; provider?: string; status?: string; result?: string; expiry_date?: string; reference_id?: string; notes?: string }) =>
    api(`/${personId}/background-checks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  addSignature: (personId: string, data: { document_title: string; agreement_type?: string; signer_name: string; signature_text: string; witness_email?: string; notes?: string }) =>
    api(`/${personId}/signatures`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  onboarding: (params?: { incomplete?: boolean }) => {
    const qs = params?.incomplete === false ? "?incomplete=false" : "";
    return api<{ onboarding: OnboardingPerson[] }>(`/onboarding${qs}`);
  },
  personOnboarding: (personId: string) =>
    api<{ items: OnboardingItem[]; completedCount: number; totalCount: number }>(`/${personId}/onboarding`),
  seedOnboarding: (personId: string) =>
    api<{ items: OnboardingItem[] }>(`/${personId}/onboarding/seed`, { method: "POST" }),
  updateOnboardingItem: (personId: string, itemId: string, data: { completed?: boolean; notes?: string }) =>
    api(`/${personId}/onboarding/${itemId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  orgSchedules: (params?: { from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    const q = qs.toString();
    return api<{ schedules: OrgSchedule[] }>(`/schedules${q ? `?${q}` : ""}`);
  },
  orgPerformanceReviews: () => api<{ reviews: OrgPerformanceReview[] }>("/performance-reviews"),
  timeClockSummary: () => api<{ active: TimeClockActive[]; recent: Record<string, unknown>[]; hoursThisMonth: number }>("/time-clock/summary"),
  incidents: (status?: string) => api<{ incidents: HrIncident[] }>(`/incidents${status ? `?status=${status}` : ""}`),
  createIncident: (data: { person_id?: string; incident_date: string; incident_type?: string; severity?: string; location?: string; description: string }) =>
    api("/incidents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updateIncident: (id: string, data: { status?: string; resolution?: string; severity?: string }) =>
    api(`/incidents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  // People & Operations Phase 3 — HR Command Center
  phase3Platform: () => api<{
    version: string;
    modules: { id: string; label: string; tab: string }[];
    counts: Record<string, number>;
    organizationStructure: Record<string, number>;
    payrollTime: Record<string, unknown>;
  }>("/operations/v3/platform"),
  phase3OrganizationStructure: () => api<{
    departments: Record<string, unknown>[];
    positions: Record<string, unknown>[];
    people: Record<string, unknown>[];
    reportingHierarchy: Record<string, unknown>[];
    summary: Record<string, number>;
  }>("/operations/v3/organization-structure"),
  phase3PayrollTimeCenter: () => api<{
    summary: Record<string, unknown>;
    ptoBalances: Record<string, unknown>[];
    contractorPayments: Record<string, unknown>[];
    grantFundedStaff: Record<string, unknown>[];
    payrollRuns: Record<string, unknown>[];
    recentTimeEntries: Record<string, unknown>[];
  }>("/operations/v3/payroll-time-center"),
  phase3PersonnelFiles: (limit = 200) =>
    api<{ files: Record<string, unknown>[] }>(`/operations/v3/personnel-files?limit=${limit}`),
  phase3RolesPermissions: () => api<{
    roles: { role: string; permissions: string[] }[];
    modules: { module: string; allowedRoles: string[] }[];
    peopleRoutes: { path: string; permission: string }[];
    personTypes: { id: string; label: string }[];
  }>("/operations/v3/roles-permissions"),
  phase3Directory: (type: string) => api<{ people: Person[]; personType: string }>(`/operations/v3/directory/${type}`),
  jobApplicants: (status?: string) =>
    api<{ applicants: JobApplicant[] }>(`/job-applicants${status ? `?status=${status}` : ""}`),
  createJobApplicant: (data: { first_name: string; last_name: string; email?: string; phone?: string; position_applied?: string; department_id?: string; notes?: string }) =>
    api("/job-applicants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updateJobApplicant: (id: string, data: { status?: string; notes?: string }) =>
    api(`/job-applicants/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  hireJobApplicant: (id: string) =>
    api<{ person: Person; applicantId: string }>(`/job-applicants/${id}/hire`, { method: "POST" }),
  positions: () => api<{ positions: OrgPosition[] }>("/positions"),
  createPosition: (data: { title: string; department_id?: string; level?: number; description?: string }) =>
    api("/positions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  createContractorPayment: (data: { person_id: string; description: string; amount_cents: number; payment_date?: string; grant_award_id?: string }) =>
    api("/contractor-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
};

export interface OrgSchedule {
  id: string;
  person_id: string;
  title: string;
  schedule_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  first_name: string;
  last_name: string;
  person_type: string;
  department_name: string | null;
}

export interface OrgPerformanceReview {
  id: string;
  person_id: string;
  review_date: string;
  reviewer: string;
  rating: string;
  summary: string;
  first_name: string;
  last_name: string;
  person_type: string;
  organization_role: string | null;
  department_name: string | null;
}

export interface TimeClockActive {
  id: string;
  person_id: string;
  clock_in: string;
  first_name: string;
  last_name: string;
  person_type: string;
  department_name: string | null;
}

export interface HrIncident {
  id: string;
  person_id: string | null;
  incident_date: string;
  incident_type: string;
  severity: string;
  location: string | null;
  description: string;
  status: string;
  resolution: string | null;
  first_name?: string | null;
  last_name?: string | null;
  reporter_first?: string | null;
  reporter_last?: string | null;
}

export interface OnboardingItem {
  id: string;
  person_id: string;
  task_key: string;
  task_label: string;
  sort_order: number;
  completed: number;
  completed_at: string | null;
  completed_by: string | null;
  notes: string | null;
}

export interface OnboardingPerson {
  personId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  personType: string;
  startDate: string | null;
  tasks: OnboardingItem[];
  completedCount: number;
  totalCount: number;
}

export interface LeaveRequest {
  id: string;
  person_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  hours: number | null;
  reason: string;
  status: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

export interface JobApplicant {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  position_applied: string | null;
  department_id: string | null;
  department_name?: string | null;
  status: string;
  applied_at: string;
  notes: string | null;
  hired_person_id: string | null;
}

export interface OrgPosition {
  id: string;
  title: string;
  department_id: string | null;
  department_name?: string | null;
  level: number;
  description: string | null;
  filled_count?: number;
  status: string;
}
