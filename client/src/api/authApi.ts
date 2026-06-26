async function authFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/auth${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const authApi = {
  mfaStatus: () => authFetch<{ enabled: boolean }>("/2fa/status"),
  mfaSetup: () =>
    authFetch<{ secret: string; qrCode: string; message: string }>("/2fa/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  mfaVerify: (code: string) =>
    authFetch<{ success: boolean; message: string }>("/2fa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  mfaDisable: (opts: { code?: string; password?: string }) =>
    authFetch<{ success: boolean; message: string }>("/2fa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    }),
};
