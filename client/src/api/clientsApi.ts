async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/clients${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface ClientRecord {
  id: string;
  fullName: string;
  dateOfBirth?: string | null;
  contactInfo: { phone?: string | null; email?: string | null };
  programs: string[];
  createdAt: string;
  peopleLink?: { personId: string; linked: boolean };
}

export interface ClientOverview {
  totalClients: number;
  activeAssignments: number;
  openGoals: number;
  encounters30d: number;
  upcomingAppointments: number;
  openOutreachTasks: number;
  highRiskClients: number;
  generatedAt: string;
}

export const clientsApi = {
  platform: () =>
    apiFetch<{ module: string; version: string; capabilities: string[] }>("/platform"),
  overview: () => apiFetch<ClientOverview>("/overview"),
  executiveSummary: () => apiFetch<Record<string, unknown>>("/executive-summary"),
  list: (program?: string) =>
    apiFetch<{ clients: ClientRecord[]; count: number }>(program ? `/?program=${encodeURIComponent(program)}` : "/"),
  detail: (id: string) => apiFetch<ClientRecord>(`/${id}`),
  summary: (id: string) => apiFetch<Record<string, unknown>>(`/${id}/summary`),
  appointments: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const q = qs.toString();
    return apiFetch<{ appointments: Record<string, unknown>[]; from: string; to: string }>(
      `/appointments${q ? `?${q}` : ""}`,
    );
  },
  create: (body: {
    fullName: string;
    dateOfBirth?: string;
    contactInfo?: { phone?: string; email?: string };
    programs?: string[];
  }) =>
    apiFetch<ClientRecord>("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  linkPeople: (id: string) =>
    apiFetch<{ ok: boolean; personId?: string }>(`/${id}/link-people`, { method: "POST", body: "{}" }),
};
