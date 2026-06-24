async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/grants${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface GrantOverview {
  openOpportunities: number;
  pendingApplications: number;
  upcomingDeadlines: number;
  totalAwarded: number;
  complianceDue: number;
  pipelineValue?: number;
  activeAwards?: number;
  totalBudgetAllocated?: number;
  totalBudgetSpent?: number;
  totalLaborCost?: number;
  totalExpenditures?: number;
  winRate?: number;
  fundingPipeline?: { stage: string; count: number; value: number }[];
  recentNotifications?: { id: string; title: string; due_date: string; notification_type: string }[];
}

export interface GrantOpportunity {
  id: string;
  title: string;
  funder: string;
  description: string;
  amount_min: number | null;
  amount_max: number | null;
  status: string;
  deadline: string | null;
  url: string;
  requirements: string;
  division_slugs?: string[];
  program_areas?: string[];
  eligibility?: string;
  geography?: string;
  funder_type?: string;
  source_type?: string;
}

export interface GrantApplication {
  id: string;
  opportunity_id: string | null;
  title: string;
  status: string;
  amount_requested: number | null;
  amount_awarded: number | null;
  submitted_at: string | null;
  assigned_to: string;
  notes: string;
  opportunity_title?: string;
  funder?: string;
}

export interface GrantDeadline {
  id: string;
  title: string;
  due_date: string;
  deadline_type: string;
  completed: number;
  opportunity_title?: string;
}

export interface GrantAward {
  id: string;
  amount: number;
  award_date: string;
  status: string;
  opportunity_title?: string;
  funder?: string;
  application_title?: string;
  finance_budget_id?: string;
}

export const grantsApi = {
  overview: () => apiFetch<GrantOverview>("/overview"),
  dashboard: () => apiFetch<GrantOverview>("/dashboard"),
  analytics: () => apiFetch<{ byFunder: { funder: string; awards: number; total: number }[]; byProgram: { program: string; awards: number; total: number }[]; monthlyAwards: { month: string; count: number; total: number }[] }>("/analytics"),
  pipeline: () => apiFetch<{ pipeline: { stage: string; count: number; value: number }[]; pipelineValue: number; winRate: number }>("/pipeline"),

  opportunities: () => apiFetch<{ opportunities: GrantOpportunity[] }>("/opportunities"),
  createOpportunity: (data: Partial<GrantOpportunity>) =>
    apiFetch("/opportunities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  applications: () => apiFetch<{ applications: GrantApplication[] }>("/applications"),
  createApplication: (data: Partial<GrantApplication>) =>
    apiFetch("/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updateApplication: (id: string, data: Partial<GrantApplication>) =>
    apiFetch(`/applications/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  deadlines: (upcoming?: boolean) => apiFetch<{ deadlines: GrantDeadline[] }>(`/deadlines${upcoming ? "?upcoming=true" : ""}`),
  completeDeadline: (id: string) =>
    apiFetch(`/deadlines/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: true }) }),

  awards: () => apiFetch<{ awards: GrantAward[] }>("/awards"),
  compliance: () => apiFetch<{ compliance: Record<string, unknown>[] }>("/compliance"),
  createCompliance: (data: { award_id: string; report_type: string; due_date: string; notes?: string }) =>
    apiFetch("/compliance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updateCompliance: (id: string, data: { status?: string; notes?: string }) =>
    apiFetch(`/compliance/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  calendar: (month?: string) => apiFetch<{ deadlines: GrantDeadline[]; compliance: Record<string, unknown>[] }>(`/calendar${month ? `?month=${month}` : ""}`),

  documents: (params?: { opportunity_id?: string; application_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.opportunity_id) qs.set("opportunity_id", params.opportunity_id);
    if (params?.application_id) qs.set("application_id", params.application_id);
    const q = qs.toString();
    return apiFetch<{ documents: Record<string, unknown>[] }>(`/documents${q ? `?${q}` : ""}`);
  },
  uploadDocument: (data: { name: string; opportunity_id?: string; application_id?: string; file_url?: string; doc_type?: string; notes?: string }) =>
    apiFetch("/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  uploadDocumentFile: (data: { fileName: string; base64: string; mimeType?: string; name: string; opportunity_id?: string; application_id?: string; doc_type?: string; notes?: string }) =>
    apiFetch("/documents/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  funderReports: () => apiFetch<{
    reports: { awardId: string; grantTitle: string; funder: string; awardAmount: number; spent: number; burnRate: number; compliancePending: number; reportReady: boolean }[];
    upcomingCompliance: Record<string, unknown>[];
    generatedAt: string;
  }>("/funder-reports"),
  approveDocument: (id: string, status: "approved" | "rejected") =>
    apiFetch(`/documents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }),

  budgets: () => apiFetch<{ budgetLines: Record<string, unknown>[]; financeBudgets: Record<string, unknown>[] }>("/budgets"),
  createBudgetLines: (data: { award_id: string; lines: { category: string; line_name: string; allocated: number }[] }) =>
    apiFetch("/budgets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  financial: (awardId: string) => apiFetch<Record<string, unknown>>(`/financial/${awardId}`),
  labor: (awardId?: string) => apiFetch<{ labor: Record<string, unknown>[]; totalCost: number }>(`/labor${awardId ? `?award_id=${awardId}` : ""}`),
  syncLabor: (award_id: string) =>
    apiFetch("/labor/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ award_id }) }),

  expenditures: (awardId?: string) => apiFetch<{ expenditures: Record<string, unknown>[]; financeExpenses: Record<string, unknown>[] }>(`/expenditures${awardId ? `?award_id=${awardId}` : ""}`),

  notifications: () => apiFetch<{ notifications: Record<string, unknown>[] }>("/notifications"),
  generateNotifications: () => apiFetch<{ created: number }>("/notifications/generate", { method: "POST" }),
  markNotificationRead: (id: string) => apiFetch(`/notifications/${id}/read`, { method: "PATCH" }),

  renewals: () => apiFetch<{ renewals: Record<string, unknown>[] }>("/renewals"),
  createRenewal: (data: { original_award_id: string; renewal_date: string; notes?: string }) =>
    apiFetch("/renewals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  history: () => apiFetch<{ activity: Record<string, unknown>[]; awards: Record<string, unknown>[] }>("/history"),

  aiFind: (criteria: { keywords?: string; minAmount?: number; maxAmount?: number; status?: string; division?: string }) =>
    apiFetch<{ opportunities: Record<string, unknown>[] }>("/ai/find", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(criteria),
    }),
  aiMatch: (applicationId: string) =>
    apiFetch<{ applicationId: string; score: number; factors: { factor: string; match: boolean; detail: string }[]; recommendation: string }>("/ai/match", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId }),
    }),
  aiWrite: (data: { prompt: string; applicationId?: string; opportunityId?: string; section?: string }) =>
    apiFetch<{ narrative: string; generatedAt: string }>("/ai/write", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }),
  aiOutcome: (awardId: string) =>
    apiFetch<{ report: string; generatedAt: string }>(`/ai/outcome/${awardId}`, { method: "POST" }),

  funders: (params?: { stage?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.stage) qs.set("stage", params.stage);
    if (params?.q) qs.set("q", params.q);
    const q = qs.toString();
    return apiFetch<{ funders: GrantFunder[] }>(`/funders${q ? `?${q}` : ""}`);
  },
  funderDashboard: () => apiFetch<{
    totalFunders: number;
    activePartners: number;
    totalAwarded: number;
    byStage: { stage: string; count: number }[];
    funders: GrantFunder[];
  }>("/funders/dashboard"),
  getFunder: (id: string) => apiFetch<{
    funder: GrantFunder;
    opportunities: Record<string, unknown>[];
    awards: Record<string, unknown>[];
    interactions: Record<string, unknown>[];
    complianceDue: Record<string, unknown>[];
  }>(`/funders/${id}`),
  createFunder: (data: Partial<GrantFunder>) =>
    apiFetch("/funders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updateFunder: (id: string, data: Partial<GrantFunder>) =>
    apiFetch(`/funders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  logFunderInteraction: (id: string, data: { subject: string; notes?: string; interaction_type?: string; interaction_date?: string }) =>
    apiFetch(`/funders/${id}/interactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  // Phase 2 — IFCDC Funding Engine
  fundingEngineOverview: () =>
    apiFetch<{
      summary: Record<string, number>;
      pipeline: { stage: string; count: number; value: number }[];
      divisionFunding: { division: string; opportunities: number; pipeline_value: number }[];
      budgetIntegration: { linkedBudgets: number; allocated: number; spent: number; grantBudgetSpent: number; laborCost: number };
      topEligibilityScores: Record<string, unknown>[];
      divisions: { slug: string; label: string; readOnly?: boolean }[];
      generatedAt: string;
    }>("/funding-engine/overview"),
  fundingDivisions: () => apiFetch<{ divisions: { slug: string; label: string; readOnly?: boolean }[] }>("/funding-engine/divisions"),
  fundingOutcomes: (limit = 25) => apiFetch<{ outcomes: Record<string, unknown>[] }>(`/funding-engine/outcomes?limit=${limit}`),
  fundingAura: (question?: string) =>
    apiFetch<{ insight: string; dashboard: Record<string, unknown>; pipeline: unknown[]; generatedAt: string }>("/funding-engine/aura", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  searchOpportunities: (params: {
    q?: string;
    status?: string;
    minAmount?: number;
    maxAmount?: number;
    division?: string;
    programArea?: string;
    geography?: string;
    deadlineWithinDays?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== "") qs.set(k, String(v));
    });
    return apiFetch<{ opportunities: GrantOpportunity[] }>(`/opportunities/search?${qs}`);
  },
  scoreOpportunity: (id: string, divisionSlug?: string) =>
    apiFetch<{ opportunityId: string; score: number; grade: string; factors: { factor: string; score: number; max: number; detail: string }[] }>(
      `/opportunities/${id}/score`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ divisionSlug }) }
    ),
  applicationWorkflow: (applicationId: string) =>
    apiFetch<{ applicationId: string; status: string; workflowStage: string; steps: Record<string, unknown>[] }>(
      `/applications/${applicationId}/workflow`
    ),
  advanceWorkflow: (
    applicationId: string,
    payload: { action: "submit" | "review" | "award" | "deny"; reason?: string; amountAwarded?: number }
  ) =>
    apiFetch<{ ok: boolean; status?: string; error?: string }>(`/applications/${applicationId}/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};

export interface GrantFunder {
  id: string;
  name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  relationship_stage?: string;
  website?: string | null;
  address?: string | null;
  notes?: string | null;
  activeAwards?: number;
  totalAwarded?: number;
  openOpportunities?: number;
  interactionCount?: number;
}
