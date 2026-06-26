export interface OnboardResult {
  message: string;
  app: {
    id: string;
    name: string;
    status: string;
    healthUrl: string;
    launchUrl?: string;
    inheritedServices: string[];
  };
  credentials: {
    appId: string;
    apiKey: string;
    apiKeyPrefix: string;
    warning: string;
  };
  envFile?: string;
  sdkSetup?: {
    install: string;
    setupScript: string;
    packageJsonSnippet: { dependencies: Record<string, string>; scripts: Record<string, string> };
  };
  integration: {
    sdkInstall: string;
    quickStart: string;
    requiredHeaders: string[];
    websocketUrl: string;
    sdkVersion?: string;
    platformVersion?: string;
  };
  nextSteps: string[];
}

export interface EnvValidationResult {
  valid: boolean;
  score: number;
  checks: {
    id: string;
    label: string;
    passed: boolean;
    message: string;
    severity: "required" | "recommended" | "optional";
  }[];
  sdkVersion: string;
  platformVersion: string;
  compatible: boolean;
  timestamp: string;
}

export interface SecurityMonitorSummary {
  period: string;
  totalEvents: number;
  failedAuthAttempts: number;
  warnings: number;
  criticalAlerts: number;
  status: "healthy" | "warning" | "critical";
  recentEvents: AuditLogEntry[];
}

export interface AuditLogEntry {
  id: string;
  appId: string | null;
  eventType: string;
  actorEmail: string | null;
  detail: string;
  severity: "info" | "warning" | "critical";
  createdAt: string;
}

export interface SdkSetupInfo {
  appId: string;
  sdkInstall: string;
  setupScript: string;
  packageJsonSnippet: { dependencies: Record<string, string>; scripts: Record<string, string> };
  envTemplate: string;
}

export interface CompatibilityMatrix {
  platformVersion: string;
  sdkVersion: string;
  matrix: { sdk: string; platform: string; status: string; notes: string }[];
  recommended: { sdk: string; platform: string };
}

export interface DeveloperDocumentation {
  platform: string;
  platformVersion: string;
  sdk: { package: string; version: string; install: string; quickStart: string };
  versioning: { policy: string; current: string; platform: string; compatibility: Record<string, string>; breakingChanges: string };
  security: {
    requiredHeaders: string[];
    apiKeys: { format: string; storage: string; rotation: string };
    transport: string;
    barbersProductionLocked: boolean;
    rbac: string;
  };
  integrationGuides: { id: string; title: string; steps: string[]; example?: string; endpoint?: string }[];
  implementationExamples?: { id: string; title: string; language: string; code: string }[];
  sampleProjects?: { id: string; name: string; description: string; stack: string; setupSteps: string[]; repoPath: string }[];
  barbersBenchmark: { locked: boolean; message: string };
}

async function devFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/developer${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const developerApi = {
  documentation: () => devFetch<DeveloperDocumentation>("/documentation"),
  compatibility: () => devFetch<CompatibilityMatrix>("/compatibility"),
  registeredApps: () => devFetch<{ apps: { id: string; name: string; status: string; apiKeyPrefix: string; createdAt: string }[] }>("/apps"),
  securityMonitor: () => devFetch<SecurityMonitorSummary>("/security-monitor"),
  auditLog: (limit = 50, appId?: string) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (appId) q.set("appId", appId);
    return devFetch<{ entries: AuditLogEntry[] }>(`/audit-log?${q}`);
  },
  validateEnvironment: (data: { appId: string; healthUrl: string; launchUrl?: string; apiKey?: string; sdkVersion?: string }) =>
    devFetch<EnvValidationResult>("/validate-environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  sdkSetup: (appId: string) => devFetch<SdkSetupInfo>(`/setup/${appId}`),
  rotateKey: (appId: string) =>
    devFetch<{ appId: string; apiKey: string; apiKeyPrefix: string; envFile: string; warning: string }>(`/apps/${appId}/rotate-key`, {
      method: "POST",
    }),
  quickRegister: (data: { id: string; name: string; healthUrl: string; launchUrl?: string }) =>
    devFetch<OnboardResult>("/quick-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  onboard: (data: {
    id: string;
    name: string;
    description?: string;
    healthUrl: string;
    launchUrl?: string;
    inheritedServices?: string[];
  }) =>
    devFetch<OnboardResult>("/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
};
