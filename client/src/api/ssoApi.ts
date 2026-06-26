async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/auth${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface SsoApp {
  id: string;
  name: string;
  description: string;
  launchPath: string;
  permission: string;
  status: "production" | "production-locked" | "beta" | "development";
}

export const ssoApi = {
  apps: () => api<{ apps: SsoApp[]; gateway: string }>("/sso/apps"),
  launch: (appId: string) =>
    api<{ appId: string; appName: string; token: string; launchUrl: string; launchPath: string; expiresIn: string }>(
      "/sso/launch",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId }) }
    ),
  manifest: () => api<Record<string, unknown>>("/sso/manifest"),
  exchange: (token: string) =>
    api<{ success: boolean; user: unknown; launchedFrom: string | null }>("/sso/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }),
};
