import { SDK_VERSION, PLATFORM_VERSION } from "./developerDocumentation";
import { getSoftwareDivisionApps, pollAppHealth } from "./appRegistry";
import { HQ_INHERITED_SERVICES } from "./softwareDivisionFramework";
import { getRegisteredApp } from "./softwareDivisionSchema";

export interface AppDiagnosticResult {
  appId: string;
  appName: string;
  timestamp: string;
  overall: "healthy" | "degraded" | "offline";
  health: {
    healthy: boolean;
    latencyMs: number;
    version?: string;
    deployment?: string;
    error?: string;
    url: string;
  };
  deployment: {
    status: string;
    environment: string;
    registered: boolean;
    apiKeyPrefix?: string;
    onboardedAt?: string;
  };
  sdkCompatibility: {
    requiredSdk: string;
    platformVersion: string;
    compatible: boolean;
    inheritedServices: string[];
    message: string;
  };
  inheritedServices: { id: string; name: string; endpoint: string; available: boolean }[];
  recommendations: string[];
}

const ALL_INHERITED = ["auth", "people", "finance", "grants", "analytics", "aura", "notifications", "operations", "enterprise"];

export async function runAppDiagnostics(appId: string): Promise<AppDiagnosticResult> {
  const apps = await getSoftwareDivisionApps();
  const app = apps.find((a) => a.id === appId);
  if (!app) {
    throw new Error("Application not found in Software Division registry");
  }

  const registered = await getRegisteredApp(appId);
  const health = await pollAppHealth(app);
  const inheritedIds = registered
    ? (JSON.parse(registered.inherited_services || "[]") as string[])
    : ALL_INHERITED;

  const inheritedServices = HQ_INHERITED_SERVICES.filter((s) =>
    inheritedIds.includes(s.id) || !registered
  ).map((s) => ({
    id: s.id,
    name: s.name,
    endpoint: s.endpoint,
    available: true,
  }));

  const recommendations: string[] = [];
  if (!health.healthy) {
    recommendations.push(`Health check failed at ${app.healthUrl} — verify the application is running and the URL is reachable.`);
  } else if (health.latencyMs > 2000) {
    recommendations.push(`High latency (${health.latencyMs}ms) — consider optimizing health endpoint or checking deployment region.`);
  }
  if (!registered && !app.locked) {
    recommendations.push("Register this application via the Developer Portal to receive API credentials and appear in the enterprise registry.");
  }
  if (health.healthy && registered) {
    recommendations.push("Install @ifcdc/headquarters-sdk and configure IFCDC_HQ_BASE_URL, IFCDC_APP_ID, and IFCDC_HQ_TOKEN.");
  }
  if (app.locked) {
    recommendations.push("Production locked — use as integration benchmark only. Do not modify via HQ integration.");
  }

  const overall: AppDiagnosticResult["overall"] = health.healthy
    ? health.latencyMs > 2000
      ? "degraded"
      : "healthy"
    : "offline";

  // Persist last health check for registered apps
  if (registered) {
    const { getDb } = await import("../db");
    const db = await getDb();
    await db.run(
      `UPDATE hq_registered_apps SET updated_at = datetime('now') WHERE id = ?`,
      appId
    ).catch(() => undefined);
  }

  return {
    appId: app.id,
    appName: app.name,
    timestamp: new Date().toISOString(),
    overall,
    health: {
      healthy: health.healthy,
      latencyMs: health.latencyMs,
      version: health.version,
      deployment: health.deployment,
      error: health.error,
      url: app.healthUrl,
    },
    deployment: {
      status: app.status,
      environment: health.deployment ?? (app.locked ? "production" : "development"),
      registered: Boolean(registered),
      apiKeyPrefix: registered?.api_key_prefix,
      onboardedAt: registered?.created_at,
    },
    sdkCompatibility: {
      requiredSdk: SDK_VERSION,
      platformVersion: PLATFORM_VERSION,
      compatible: true,
      inheritedServices: inheritedIds,
      message: `Compatible with @ifcdc/headquarters-sdk ^${SDK_VERSION} and HQ platform ${PLATFORM_VERSION}`,
    },
    inheritedServices,
    recommendations,
  };
}

export async function runAllAppDiagnostics() {
  const apps = await getSoftwareDivisionApps();
  const results = await Promise.all(apps.map((a) => runAppDiagnostics(a.id).catch((e) => ({
    appId: a.id,
    appName: a.name,
    timestamp: new Date().toISOString(),
    overall: "offline" as const,
    error: e instanceof Error ? e.message : "Diagnostics failed",
  }))));
  return results;
}

export function buildCompatibilityMatrix() {
  return {
    platformVersion: PLATFORM_VERSION,
    sdkVersion: SDK_VERSION,
    matrix: [
      { sdk: "1.0.x", platform: "2.0.x", status: "supported", notes: "Legacy — auth, analytics, aura" },
      { sdk: "1.1.x", platform: "2.1.x", status: "supported", notes: "Onboarding, WebSocket push, role templates" },
      { sdk: "1.2.x", platform: "2.1.x", status: "supported", notes: "Quick register, diagnostics, compatibility tracking" },
      { sdk: "1.3.x", platform: "2.1.x", status: "current", notes: "Env validation, credential rotation, audit logging, setup scripts" },
    ],
    recommended: {
      sdk: SDK_VERSION,
      platform: PLATFORM_VERSION,
    },
    inheritedServices: ALL_INHERITED,
    timestamp: new Date().toISOString(),
  };
}

export function buildEnvFile(appId: string, apiKey: string, baseUrl = "http://localhost:5000") {
  return `# IFCDC Headquarters — ${appId}
# Generated by Developer Portal — store securely, never commit

IFCDC_HQ_BASE_URL=${baseUrl}
IFCDC_APP_ID=${appId}
IFCDC_HQ_TOKEN=${apiKey}

# SDK: npm install @ifcdc/headquarters-sdk
`;
}
