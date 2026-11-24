import { INTAKE_WORKSPACE_BANNER } from "@shared/intakeMedicalBilling";
import { INTAKE_COORD_BANNER } from "@shared/hqIntake";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/hq/intake-medical${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || "Intake workspace request failed");
  }
  return data as T;
}

export const intakeMedicalApi = {
  banner: `${INTAKE_COORD_BANNER} ${INTAKE_WORKSPACE_BANNER}`,
  meta: () => api("/meta"),
  list: () => api<{ cases: Array<{ id: string; displayLabel: string; status: string; serviceIntent: string }> }>("/cases"),
  saveCase: (body: Record<string, unknown>) => api("/cases", { method: "POST", body: JSON.stringify(body) }),
  get: (id: string) => api(`/cases/${id}`),
  insurance: (id: string, body: Record<string, unknown>) =>
    api(`/cases/${id}/insurance`, { method: "POST", body: JSON.stringify(body) }),
  clinical: (id: string, body: Record<string, unknown>) =>
    api(`/cases/${id}/clinical`, { method: "POST", body: JSON.stringify(body) }),
  coding: (id: string) => api(`/cases/${id}/coding`, { method: "POST", body: "{}" }),
  approveCoding: (id: string) => api(`/coding/${id}/approve`, { method: "POST", body: JSON.stringify({ approved: true }) }),
  claim: (id: string, body: Record<string, unknown>) =>
    api(`/cases/${id}/claims`, { method: "POST", body: JSON.stringify(body) }),
  listCoordination: () =>
    api<{
      intakes: Array<{ id: string; displayLabel: string; workflowStatus: string; assignedDepartment?: string }>;
      hipaaCompliance: string;
    }>("/coordination"),
  createCoordination: (body: Record<string, unknown>) => api("/coordination", { method: "POST", body: JSON.stringify(body) }),
  getCoordination: (id: string) => api<Record<string, unknown>>(`/coordination/${id}`),
  confirmAssignment: (id: string, body: Record<string, unknown>) =>
    api(`/coordination/${id}/assignment`, { method: "POST", body: JSON.stringify(body) }),
  referral: (id: string, body: Record<string, unknown>) =>
    api(`/coordination/${id}/referrals`, { method: "POST", body: JSON.stringify(body) }),
  followup: (id: string, body: Record<string, unknown>) =>
    api(`/coordination/${id}/followups`, { method: "POST", body: JSON.stringify(body) }),
  notice: (id: string) => api(`/coordination/${id}/notice`, { method: "POST", body: "{}" }),
  audit: () => api<{ events: Array<{ action: string; entityId?: string; createdAt: string }> }>("/audit"),
};
