/**
 * IFCDC Software Division — application registry.
 * Every IFCDC application registers here for HQ monitoring.
 */

export type AppStatus = "production" | "development" | "mvp" | "planned" | "locked";

export interface SoftwareApp {
  id: string;
  name: string;
  description: string;
  status: AppStatus;
  version?: string;
  locked?: boolean;
  path: string;
  healthUrl: string;
  launchUrl?: string;
  reportsAnalytics?: boolean;
  priority: number;
}

/** Production base URL for HQ-hosted and self health checks. */
export function getHqPublicBase(): string {
  const raw = (process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    return "https://ifcdc-hq-wst6.onrender.com";
  }
  return "http://localhost:5000";
}

function isLocalhostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return url.includes("localhost") || url.includes("127.0.0.1");
  }
}

function envUrl(key: string, fallback: string): string {
  const value = process.env[key]?.trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production" && isLocalhostUrl(fallback)) {
    return fallback;
  }
  return fallback;
}

function selfHealthUrl(): string {
  return envUrl("HQ_SELF_HEALTH_URL", `${getHqPublicBase()}/api/health`);
}

export const SOFTWARE_DIVISION_APPS: SoftwareApp[] = [
  {
    id: "barbers",
    name: "IFCDC Barbers App",
    description: "Production barbershop booking, queue, and payments platform",
    status: "locked",
    locked: true,
    version: "2.2.0",
    path: "Apps/IFCDC-BARBERS-APP/",
    healthUrl: envUrl("HQ_BARBERS_HEALTH_URL", "http://localhost:3000/"),
    priority: 0,
  },
  {
    id: "music",
    name: "IFCDC Music App",
    description: "DJ library, AURA AI, crates, bookings, and client delivery",
    status: "mvp",
    version: "1.0.0",
    path: "Apps/IFCDC-MUSIC-APP/IFCDC-MUSUC-APP/",
    healthUrl: envUrl("HQ_MUSIC_HEALTH_URL", "http://localhost:5001/api/health"),
    launchUrl: envUrl("HQ_MUSIC_LAUNCH_URL", "http://localhost:5001"),
    reportsAnalytics: true,
    priority: 1,
  },
  {
    id: "radio",
    name: "IFCDC Radio",
    description: "Broadcast scheduling and content management",
    status: "development",
    version: "1.0.0",
    path: "Apps/IMPERIAL-FOUNDATION-CDC/",
    healthUrl: envUrl("HQ_RADIO_HEALTH_URL", selfHealthUrl()),
    launchUrl: `${getHqPublicBase()}/radio`,
    priority: 2,
  },
  {
    id: "tapis",
    name: "IFCDC Tapis",
    description: "Mentorship circles and community reflection platform",
    status: "mvp",
    version: "1.0.0",
    path: "Apps/IFCDC-TAPIS/Tapis-Init/",
    healthUrl: envUrl("HQ_TAPIS_HEALTH_URL", "http://localhost:5002/api/health"),
    launchUrl: envUrl("HQ_TAPIS_LAUNCH_URL", "http://localhost:5002"),
    reportsAnalytics: true,
    priority: 3,
  },
  {
    id: "inclusive",
    name: "Inclusive Community",
    description: "Autism support platform with AURA communication assistance",
    status: "mvp",
    version: "1.0.0",
    path: "Apps/INCLUSIVE-COMMUNITY-IFCDC/InclusiveCommunity/",
    healthUrl: envUrl("HQ_INCLUSIVE_HEALTH_URL", "http://localhost:5003/api/health"),
    launchUrl: envUrl("HQ_INCLUSIVE_LAUNCH_URL", "http://localhost:5003"),
    reportsAnalytics: true,
    priority: 4,
  },
  {
    id: "imperial",
    name: "Imperial Foundation CDC Website",
    description: "Public website and community platform (Headquarters host)",
    status: "development",
    version: "1.0.0",
    path: "Apps/IMPERIAL-FOUNDATION-CDC/",
    healthUrl: selfHealthUrl(),
    launchUrl: `${getHqPublicBase()}/`,
    priority: 5,
  },
  {
    id: "swiftware",
    name: "Swift-Ware",
    description: "Business management for IFCDC organizations",
    status: "mvp",
    version: "1.0.0",
    path: "Apps/IFCDC-SWIFT-WARE/Swift-Ware/",
    healthUrl: envUrl("HQ_SWIFTWARE_HEALTH_URL", "http://localhost:5004/api/health"),
    launchUrl: envUrl("HQ_SWIFTWARE_LAUNCH_URL", "http://localhost:5004"),
    reportsAnalytics: true,
    priority: 6,
  },
  {
    id: "cryptocoin",
    name: "CryptoCoin IFCDC",
    description: "ERC-20 token platform with liquidity pools",
    status: "mvp",
    version: "1.0.0",
    path: "Apps/CRYPTOCOIN-IFCDC/CryptoCoinIFCDC/",
    healthUrl: envUrl("HQ_CRYPTO_HEALTH_URL", "http://localhost:5005/api/health"),
    launchUrl: envUrl("HQ_CRYPTO_LAUNCH_URL", "http://localhost:5005"),
    reportsAnalytics: true,
    priority: 7,
  },
];

export async function pollAppHealth(app: SoftwareApp): Promise<{
  id: string;
  healthy: boolean;
  latencyMs: number;
  version?: string;
  deployment?: string;
  activeUsers?: number;
  analytics?: Record<string, unknown>;
  data?: Record<string, unknown>;
  error?: string;
}> {
  const start = Date.now();
  const deployment = process.env[`HQ_${app.id.toUpperCase()}_DEPLOYMENT`] || (app.locked ? "production" : "development");

  if (app.locked) {
    return {
      id: app.id,
      healthy: true,
      latencyMs: 0,
      version: app.version,
      deployment: "production-locked",
      data: { status: "production-locked" },
    };
  }

  if (process.env.NODE_ENV === "production" && isLocalhostUrl(app.healthUrl)) {
    return {
      id: app.id,
      healthy: false,
      latencyMs: 0,
      version: app.version,
      deployment: "not_configured",
      error: `Set HQ_${app.id.toUpperCase()}_HEALTH_URL on Render when this app is deployed`,
    };
  }

  try {
    const res = await fetch(app.healthUrl, { signal: AbortSignal.timeout(8000) });
    const latencyMs = Date.now() - start;
    let data: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = await res.json();
      data = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      data = { status: res.ok ? "ok" : "error" };
    }

    let analytics: Record<string, unknown> | undefined;
    if (app.reportsAnalytics && app.launchUrl) {
      try {
        const analyticsUrl = app.launchUrl.replace(/\/$/, "") + "/api/analytics/overview";
        const aRes = await fetch(analyticsUrl, { signal: AbortSignal.timeout(5000) });
        if (aRes.ok) {
          const parsed: unknown = await aRes.json();
          analytics = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
        }
      } catch {
        // analytics optional
      }
    }

    return {
      id: app.id,
      healthy: res.ok,
      latencyMs,
      version: (data?.version as string) || app.version,
      deployment,
      activeUsers: analytics?.activeUsers as number | undefined,
      analytics,
      data,
    };
  } catch (err) {
    return {
      id: app.id,
      healthy: false,
      latencyMs: Date.now() - start,
      version: app.version,
      deployment,
      error: err instanceof Error ? err.message : "Unreachable",
    };
  }
}

export async function getSoftwareDivisionApps(): Promise<SoftwareApp[]> {
  const { listRegisteredApps } = await import("./softwareDivisionSchema");
  const registered = await listRegisteredApps();
  const staticIds = new Set(SOFTWARE_DIVISION_APPS.map((a) => a.id));

  const dynamicApps: SoftwareApp[] = registered
    .filter((r) => !staticIds.has(r.id) && r.id !== "barbers")
    .map((r, index) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      status: (r.status as AppStatus) ?? "development",
      version: "1.0.0",
      locked: false,
      path: `Apps/${r.id}/`,
      healthUrl: r.health_url,
      launchUrl: r.launch_url ?? undefined,
      reportsAnalytics: JSON.parse(r.inherited_services || "[]").includes("analytics"),
      priority: 100 + index,
    }));

  return [...SOFTWARE_DIVISION_APPS, ...dynamicApps].sort((a, b) => a.priority - b.priority);
}

export async function pollAllApps() {
  const apps = await getSoftwareDivisionApps();
  return Promise.all(apps.map(pollAppHealth));
}

