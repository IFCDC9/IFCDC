async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/programs${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface ProgramSummary {
  program: Record<string, unknown>;
  counts: { participants: number; staff: number; upcomingEvents: number; documents: number };
  metrics: ProgramMetric[];
}

export interface ProgramMetric {
  id: string;
  program_slug: string;
  metric_key: string;
  metric_label: string;
  metric_value: number;
  target_value: number | null;
  period: string;
  recorded_at: string;
}

export const programsHqApi = {
  list: () => api<{ programs: { slug: string; name: string; counts: ProgramSummary["counts"]; budget: Record<string, unknown> }[] }>("/modules"),
  get: (slug: string) => api<ProgramSummary>(`/modules/${slug}`),
  updateBudget: (slug: string, data: { budget_allocated?: number; budget_spent?: number }) =>
    api(`/modules/${slug}/budget`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  participants: (slug: string) => api<{ participants: Record<string, unknown>[] }>(`/modules/${slug}/participants`),
  addParticipant: (slug: string, data: { person_id?: string; participant_name?: string; status?: string; outcome_notes?: string }) =>
    api(`/modules/${slug}/participants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updateParticipant: (slug: string, id: string, data: { status?: string; outcome_status?: string; outcome_notes?: string }) =>
    api(`/modules/${slug}/participants/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  staff: (slug: string) => api<{ staff: Record<string, unknown>[] }>(`/modules/${slug}/staff`),
  addStaff: (slug: string, data: { person_id: string; role?: string }) =>
    api(`/modules/${slug}/staff`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  removeStaff: (slug: string, id: string) => api(`/modules/${slug}/staff/${id}`, { method: "DELETE" }),
  events: (slug: string) => api<{ events: Record<string, unknown>[] }>(`/modules/${slug}/events`),
  addEvent: (slug: string, data: { title: string; start_at: string; event_type?: string; end_at?: string; location?: string; notes?: string }) =>
    api(`/modules/${slug}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  metrics: (slug: string) => api<{ metrics: ProgramMetric[] }>(`/modules/${slug}/metrics`),
  updateMetric: (slug: string, id: string, data: { metric_value?: number; target_value?: number }) =>
    api(`/modules/${slug}/metrics/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  documents: (slug: string) => api<{ documents: Record<string, unknown>[] }>(`/modules/${slug}/documents`),
  addDocument: (slug: string, data: { title: string; category?: string; file_url?: string }) =>
    api(`/modules/${slug}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  financeSummary: (slug: string) => api<{
    program: Record<string, unknown>;
    glBudget: { allocated: number; spent: number; name: string } | null;
    expenses: Record<string, unknown>[];
    totalExpenses: number;
    balanceRemaining: number;
    auditTrail: Record<string, unknown>[];
  }>(`/modules/${slug}/finance`),
  compliance: (slug: string) => api<{ compliance: Record<string, unknown>[] }>(`/modules/${slug}/compliance`),
  addCompliance: (slug: string, data: { requirement: string; category?: string; due_date?: string; notes?: string }) =>
    api(`/modules/${slug}/compliance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updateCompliance: (slug: string, id: string, data: { status?: string; notes?: string }) =>
    api(`/modules/${slug}/compliance/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  performanceReport: (slug: string) => api<Record<string, unknown>>(`/modules/${slug}/performance-report`),
};
