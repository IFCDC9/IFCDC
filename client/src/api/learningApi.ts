async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/learning${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const learningApi = {
  dashboard: () => apiFetch<Record<string, unknown>>("/dashboard"),
  courses: () => apiFetch<{ courses: Record<string, unknown>[] }>("/courses"),
  createCourse: (body: Record<string, unknown>) =>
    apiFetch("/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  linkPolicy: (courseId: string, policy_id: string) =>
    apiFetch(`/courses/${courseId}/link-policy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy_id }),
    }),
  paths: () => apiFetch<{ paths: Record<string, unknown>[] }>("/paths"),
  enrollments: (params?: { person_id?: string; course_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.person_id) qs.set("person_id", params.person_id);
    if (params?.course_id) qs.set("course_id", params.course_id);
    const q = qs.toString();
    return apiFetch<{ enrollments: Record<string, unknown>[] }>(`/enrollments${q ? `?${q}` : ""}`);
  },
  assign: (body: Record<string, unknown>) =>
    apiFetch("/enrollments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  complete: (id: string, body?: Record<string, unknown>) =>
    apiFetch(`/enrollments/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  certificates: () => apiFetch<{ certificates: Record<string, unknown>[] }>("/certificates"),
  pdCosts: () => apiFetch<{ costs: Record<string, unknown>[] }>("/pd-costs"),
  logPdCost: (body: Record<string, unknown>) =>
    apiFetch("/pd-costs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
};
