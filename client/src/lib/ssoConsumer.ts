/**
 * SSO consumer helpers for IFCDC satellite applications.
 * Future apps call exchangeSsoToken() on load when launched with ?sso_token=...
 */

export function readSsoTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("sso_token");
  if (!token) return null;
  params.delete("sso_token");
  const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", next);
  return token;
}

export async function exchangeSsoToken(token: string): Promise<{ success: boolean; user?: unknown; error?: string }> {
  const res = await fetch("/api/hq/auth/sso/exchange", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: data.error ?? "SSO exchange failed" };
  return { success: true, user: data.user };
}

export async function verifyHqToken(token?: string): Promise<{ valid: boolean; permissions?: string[] }> {
  const res = await fetch("/api/hq/auth/verify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: token ? JSON.stringify({ token }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { valid: !!data.valid, permissions: data.permissions };
}

/** Run once at app boot — exchanges URL token and returns whether session is ready. */
export async function bootstrapSsoFromUrl(): Promise<boolean> {
  const token = readSsoTokenFromUrl();
  if (!token) return false;
  const result = await exchangeSsoToken(token);
  return result.success;
}
