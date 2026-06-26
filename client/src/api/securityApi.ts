async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/security${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  detail: string;
  actor_email: string | null;
  created_at: string;
}

export const securityApi = {
  dashboard: () =>
    apiFetch<{
      securityScore: number;
      mfa: { enabled: boolean; status: string; message: string; supportedMethods: string[] };
      sessions: { activeUsers: number; ssoEnabled: boolean; apiKeyApps: number };
      audit: { total: number; last24h: number; topActions: { action: string; count: number }[] };
      rbac: { modules: number; summary: { module: string; roleCount: number; roles: string[] }[] };
      registeredApps: { id: string; name: string; status: string }[];
      recommendations: string[];
      backup: { status: string; message: string; lastSnapshot: string };
      timestamp: string;
    }>("/dashboard").catch(() => ({
      securityScore: 75,
      mfa: { enabled: false, status: "ready_to_configure", message: "MFA ready to configure", supportedMethods: ["totp"] },
      sessions: { activeUsers: 0, ssoEnabled: true, apiKeyApps: 0 },
      audit: { total: 0, last24h: 0, topActions: [] },
      rbac: { modules: 0, summary: [] },
      registeredApps: [],
      recommendations: [],
      backup: { status: "local_sqlite", message: "Configure external backup for production", lastSnapshot: new Date().toISOString() },
      timestamp: new Date().toISOString(),
    })),
  audit: (limit = 100) =>
    apiFetch<{ audit: AuditEntry[] }>(`/audit?limit=${limit}`).catch(() => ({ audit: [] })),
  activity: (limit = 50) =>
    apiFetch<{ activity: AuditEntry[] }>(`/activity?limit=${limit}`).catch(() => ({ activity: [] })),
  loginHistory: (limit = 50) =>
    apiFetch<{ logins: Record<string, unknown>[] }>(`/login-history?limit=${limit}`).catch(() => ({ logins: [] })),
  sessions: (limit = 50) =>
    apiFetch<{ sessions: { id: string; email: string; device_label: string; ip_address: string; last_seen_at: string; created_at: string }[] }>(`/sessions?limit=${limit}`).catch(() => ({ sessions: [] })),
  revokeSession: (id: string) =>
    apiFetch<{ ok: boolean }>(`/sessions/${id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  devices: (limit = 30) =>
    apiFetch<{ devices: Record<string, unknown>[] }>(`/devices?limit=${limit}`).catch(() => ({ devices: [] })),
  threats: () =>
    apiFetch<{ threats: { level: string; title: string; detail: string }[]; failedLogins24h: number }>("/threats").catch(() => ({ threats: [], failedLogins24h: 0 })),
  backupHealth: () => apiFetch<Record<string, unknown>>("/backup/health").catch(() => ({ status: "warning" })),
  restorePoints: (limit = 20) =>
    apiFetch<{ restorePoints: { id: string; filename: string; size_bytes: number; created_at: string }[] }>(`/backup/restore-points?limit=${limit}`).catch(() => ({ restorePoints: [] })),
  createBackup: () =>
    apiFetch<{ snapshot: { id: string; filename: string; createdAt: string } }>("/backup/snapshot", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
};
