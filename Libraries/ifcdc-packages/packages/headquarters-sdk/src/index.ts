/**
 * IFCDC Headquarters SDK
 *
 * Connect any IFCDC application to Headquarters enterprise services:
 * authentication, people, finance, grants, analytics, AURA, and notifications.
 */

export const SDK_VERSION = "1.3.0";

export interface HeadquartersConfig {
  /** Headquarters base URL, e.g. https://headquarters.ifcdc.org */
  baseUrl: string;
  /** Software Division app ID from HQ registry */
  appId: string;
  /** JWT from HQ login or service account */
  token?: string;
  /** Include cookies for browser environments */
  credentials?: RequestCredentials;
}

export class HeadquartersError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
    this.name = "HeadquartersError";
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export function createHeadquartersClient(config: HeadquartersConfig) {
  const base = config.baseUrl.replace(/\/$/, "");
  let token = config.token;

  function headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "X-IFCDC-App-Id": config.appId,
      ...extra,
    };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: headers(),
      credentials: config.credentials ?? "include",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = await parseJson<T & { error?: string }>(res);
    if (!res.ok) {
      throw new HeadquartersError(data.error ?? res.statusText, res.status, data);
    }
    return data;
  }

  return {
    setToken(newToken: string) {
      token = newToken;
    },

    auth: {
      verify: () => request<{ valid: boolean; role: string; permissions: string[] }>("POST", "/api/hq/auth/verify"),
      session: () => request<{ user: Record<string, unknown>; platform: string; singleSignOn: boolean }>("GET", "/api/hq/auth/session"),
      roles: () => request<{ roles: { id: string; label: string; permissions: string[] }[] }>("GET", "/api/hq/auth/roles"),
    },

    people: {
      list: (params?: { type?: string; search?: string }) => {
        const q = new URLSearchParams();
        if (params?.type) q.set("type", params.type);
        if (params?.search) q.set("search", params.search);
        const qs = q.toString();
        return request<{ people: Record<string, unknown>[] }>("GET", `/api/hq/people${qs ? `?${qs}` : ""}`);
      },
    },

    finance: {
      overview: () => request<Record<string, unknown>>("GET", "/api/hq/finance/overview"),
    },

    grants: {
      overview: () => request<Record<string, unknown>>("GET", "/api/hq/grants/overview"),
    },

    analytics: {
      overview: () => request<Record<string, unknown>>("GET", "/api/hq/analytics/overview"),
      trends: () => request<Record<string, unknown>>("GET", "/api/hq/analytics/trends"),
      kpiMonitoring: () => request<Record<string, unknown>>("GET", "/api/hq/analytics/kpi-monitoring"),
    },

    aura: {
      chat: (message: string, context?: string) =>
        request<{ response: string }>("POST", "/api/hq/aura/chat", { message, context }),
      summarize: (reportType?: "full" | "financial" | "grants" | "operations") =>
        request<{ summary: string }>("POST", "/api/hq/aura/summarize", { reportType }),
      recommend: () => request<{ recommendations: string }>("POST", "/api/hq/aura/recommend", {}),
      forecast: () => request<{ forecast: string }>("POST", "/api/hq/aura/forecast", {}),
    },

    notifications: {
      list: () => request<{ notifications: Record<string, unknown>[]; unreadCount: number }>("GET", "/api/hq/enterprise/notifications"),
    },

    softwareDivision: {
      framework: () => request<Record<string, unknown>>("GET", "/api/hq/software-division/framework"),
      health: () => request<{ apps: Record<string, unknown>[] }>("GET", "/api/hq/software-division"),
      register: (app: { id: string; name: string; healthUrl: string; launchUrl?: string; description?: string }) =>
        request<{ message: string }>("POST", "/api/hq/software-division/register", app),
      onboard: (app: {
        id: string;
        name: string;
        healthUrl: string;
        launchUrl?: string;
        description?: string;
        inheritedServices?: string[];
      }) => request<Record<string, unknown>>("POST", "/api/hq/developer/onboard", app),
    },

    developer: {
      documentation: () => request<Record<string, unknown>>("GET", "/api/hq/developer/documentation"),
      registeredApps: () => request<{ apps: Record<string, unknown>[] }>("GET", "/api/hq/developer/apps"),
      compatibility: () => request<Record<string, unknown>>("GET", "/api/hq/developer/compatibility"),
      quickRegister: (app: { id: string; name: string; healthUrl: string; launchUrl?: string }) =>
        request<Record<string, unknown>>("POST", "/api/hq/developer/quick-register", app),
      validateEnvironment: (input: { appId: string; healthUrl: string; launchUrl?: string; apiKey?: string; sdkVersion?: string }) =>
        request<Record<string, unknown>>("POST", "/api/hq/developer/validate-environment", input),
      sdkSetup: (appId: string) => request<Record<string, unknown>>("GET", `/api/hq/developer/setup/${appId}`),
      rotateKey: (appId: string) => request<{ appId: string; apiKey: string; envFile: string }>("POST", `/api/hq/developer/apps/${appId}/rotate-key`),
      auditLog: (limit = 50) => request<{ entries: Record<string, unknown>[] }>("GET", `/api/hq/developer/audit-log?limit=${limit}`),
      securityMonitor: () => request<Record<string, unknown>>("GET", "/api/hq/developer/security-monitor"),
    },

    workspace: {
      load: () => request<Record<string, unknown>>("GET", "/api/hq/workspace/dashboard"),
      save: (data: { dashboardMode?: string; widgets?: unknown[] }) =>
        request<Record<string, unknown>>("PUT", "/api/hq/workspace/dashboard", data),
      templates: () => request<{ templates: Record<string, unknown>[] }>("GET", "/api/hq/workspace/templates"),
      applyTemplate: (templateKey?: string) =>
        request<Record<string, unknown>>("POST", "/api/hq/workspace/dashboard/apply-template", { templateKey }),
    },

    health: () => request<{ app: string; status: string; platform: string }>("GET", "/api/hq/health"),

    diagnostics: {
      app: (appId: string) => request<Record<string, unknown>>("GET", `/api/hq/software-division/${appId}/diagnostics`),
      all: () => request<{ diagnostics: Record<string, unknown>[] }>("GET", "/api/hq/software-division/diagnostics"),
    },

    /** Connect to real-time WebSocket hub (browser or Node with ws package) */
    realtimeUrl: () => {
      const wsBase = base.replace(/^http/, "ws");
      return `${wsBase}/api/hq/ws`;
    },
  };
}

export type HeadquartersClient = ReturnType<typeof createHeadquartersClient>;
