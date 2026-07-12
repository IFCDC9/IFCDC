import { hqApiFetch } from "./hqApiFetch";
import type { AppDiagnostics, SoftwareAppEntry } from "./hqApi";

export const SOFTWARE_DIVISION_TIMEOUT_MS = 20_000;

export interface SoftwareDivisionPayload {
  apps: SoftwareAppEntry[];
  timestamp: string;
  degraded?: boolean;
}

async function sdFetch<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = SOFTWARE_DIVISION_TIMEOUT_MS, ...init } = options ?? {};
  return hqApiFetch<T>(`/api/hq${path}`, { ...init, timeoutMs });
}

export const softwareDivisionApi = {
  overview: () => sdFetch<SoftwareDivisionPayload>("/software-division"),
  framework: () => sdFetch<{ version: string; inheritedServices: { id: string; name: string; endpoint: string }[] }>(
    "/software-division/framework",
    { timeoutMs: 10_000 }
  ),
  diagnostics: (appId: string) => sdFetch<AppDiagnostics>(`/software-division/${appId}/diagnostics`),
  allDiagnostics: () => sdFetch<{ diagnostics: AppDiagnostics[] }>("/software-division/diagnostics", { timeoutMs: 15_000 }),
  register: (body: { id: string; name: string; healthUrl: string; launchUrl?: string; description?: string }) =>
    sdFetch<{ message: string; app: Record<string, unknown>; credentials: { apiKey: string; warning: string } }>(
      "/software-division/register",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    ),
  updateApp: (
    appId: string,
    body: Partial<{ name: string; description: string; healthUrl: string; launchUrl: string; status: string }>
  ) =>
    sdFetch<{ app: Record<string, unknown> }>(`/software-division/apps/${appId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteApp: (appId: string) =>
    sdFetch<{ ok: boolean }>(`/software-division/apps/${appId}`, { method: "DELETE" }),
};

export function exportAppsCsv(apps: SoftwareAppEntry[]): string {
  const header = "id,name,status,healthy,latency_ms,version,registered,launch_url,error";
  const rows = apps.map((a) =>
    [
      a.id,
      `"${a.name.replace(/"/g, '""')}"`,
      a.status,
      a.health?.healthy ?? false,
      a.health?.latencyMs ?? "",
      a.version ?? "",
      a.registered ?? false,
      a.launchUrl ?? "",
      `"${(a.health?.error ?? "").replace(/"/g, '""')}"`,
    ].join(",")
  );
  return [header, ...rows].join("\n");
}
