async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/board-portal${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const boardApi = {
  overview: () => api<Record<string, unknown>>("/overview"),
  meetings: () => api<{ meetings: Record<string, unknown>[] }>("/meetings"),
  createMeeting: (data: { title: string; meeting_date: string; location?: string; agenda?: string }) =>
    api("/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updateMeeting: (id: string, data: Record<string, unknown>) =>
    api(`/meetings/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  packets: () => api<{ packets: Record<string, unknown>[] }>("/packets"),
  createPacket: (data: { meeting_id?: string; title: string; description?: string; executive_summary?: string }) =>
    api("/packets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  publishPacket: (id: string) => api(`/packets/${id}/publish`, { method: "POST" }),
  resolutions: () => api<{ resolutions: Record<string, unknown>[] }>("/resolutions"),
  createResolution: (data: { meeting_id?: string; title: string; description?: string; resolution_text?: string }) =>
    api("/resolutions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  vote: (id: string, vote: "yes" | "no" | "abstain") =>
    api(`/resolutions/${id}/vote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vote }) }),
  finalizeResolution: (id: string) => api(`/resolutions/${id}/finalize`, { method: "POST" }),
  financialReport: () => api<Record<string, unknown>>("/financial-report"),
  governancePackage: () => api<Record<string, unknown>>("/governance-package"),
  documents: () => api<{ documents: Record<string, unknown>[] }>("/documents"),
};
