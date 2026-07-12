/**
 * Executive Dashboard overview — timeout-safe aggregate for GET /api/hq/executive/overview
 */
import { pollAllApps, SOFTWARE_DIVISION_APPS } from "./appRegistry";
import { buildSoftwareDivisionHealthScore } from "./enterpriseHealthScoring";
import { toHQRole, HQ_MODULE_PERMISSIONS } from "./enterpriseRoles";
import { checkIfcdcServices } from "../lib/ifcdc";
import { getOrganizationMetrics, getMonthlyTrend } from "./metrics";
import { buildOrganizationHealthScore, buildHeadquartersActivityFeed } from "./analyticsReporting";
import {
  buildExecutiveCommandHealth,
  type ExecutiveCommandHealth,
} from "./executiveCommandHealth";

const EXEC_AGGREGATE_TIMEOUT_MS = 18_000;
const EXEC_SECTION_TIMEOUT_MS = 12_000;

function execTimeout<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
  const started = Date.now();
  return Promise.race([
    promise
      .then((result) => {
        console.info(`[executive-overview] ${label} ok (${Date.now() - started}ms)`);
        return result;
      })
      .catch((err) => {
        console.warn(`[executive-overview] ${label} failed:`, err instanceof Error ? err.message : err);
        return fallback;
      }),
    new Promise<T>((resolve) => {
      setTimeout(() => {
        console.warn(`[executive-overview] ${label} timed out after ${EXEC_SECTION_TIMEOUT_MS}ms`);
        resolve(fallback);
      }, EXEC_SECTION_TIMEOUT_MS);
    }),
  ]);
}

export function emptyExecutiveOverview(user?: { role?: string; hqRole?: string | null }) {
  return {
    organizationHealthScore: 0,
    organizationHealth: { overall: 0, grade: "—", factors: [] as { label: string; score: number; max: number; weight: string }[] },
    commandHealth: null as ExecutiveCommandHealth | null,
    metrics: {
      totalEmployees: 0,
      activeEmployees: 0,
      activeVolunteers: 0,
      activeGrants: 0,
      donationRevenue: 0,
      monthlyDonations: 0,
      monthlyExpenses: 0,
      programsRunning: 0,
    },
    monthlyTrend: [] as { month: string; donations: number; expenses: number }[],
    recentActivity: [] as { id: string; type: string; title: string; detail: string; timestamp: string; amount?: number }[],
    softwareDivision: {
      total: 0,
      healthy: 0,
      operational: 0,
      polledHealthy: 0,
      production: 0,
      inDevelopment: 0,
    },
    platformServices: { total: 0, healthy: 0, details: {} as Record<string, boolean> },
    modules: Object.keys(HQ_MODULE_PERMISSIONS),
    user: user ? { role: user.role, hqRole: user.hqRole } : undefined,
    degraded: true,
    warning: "Executive metrics unavailable — showing safe empty state. Live data will refresh when sources respond.",
    timestamp: new Date().toISOString(),
  };
}

async function buildExecutiveOverviewBounded(user?: { role?: string; hqRole?: string | null }) {
  console.info("[executive-overview] build start");

  const [apps, services, metrics, recentActivity, monthlyTrend, orgHealth, commandHealth] = await Promise.all([
    execTimeout(pollAllApps(), [] as Awaited<ReturnType<typeof pollAllApps>>, "poll-apps"),
    execTimeout(checkIfcdcServices(), {} as Record<string, boolean>, "platform-services"),
    execTimeout(getOrganizationMetrics(), emptyExecutiveOverview().metrics, "org-metrics"),
    execTimeout(buildHeadquartersActivityFeed(12), [], "activity-feed"),
    execTimeout(getMonthlyTrend(), [], "monthly-trend"),
    execTimeout(buildOrganizationHealthScore(), { overall: 0, grade: "—", factors: [] }, "org-health"),
    execTimeout(buildExecutiveCommandHealth(), null as ExecutiveCommandHealth | null, "command-health"),
  ]);

  const softwareHealth = await execTimeout(
    buildSoftwareDivisionHealthScore(apps),
    { score: 0, total: apps.length, operational: apps.filter((a) => a.healthy).length },
    "software-health"
  );

  const healthyApps = softwareHealth.operational ?? apps.filter((a) => a.healthy).length;
  const healthyServices = Object.values(services).filter(Boolean).length;
  const orgFromCommand = commandHealth?.pillars.find((p) => p.id === "organization")?.score;
  const orgHealthScore = orgFromCommand ?? orgHealth.overall ?? 0;
  const organizationHealth =
    orgFromCommand != null && commandHealth
      ? {
          overall: orgFromCommand,
          grade: commandHealth.pillars.find((p) => p.id === "organization")?.grade ?? orgHealth.grade,
          factors: orgHealth.factors?.length ? orgHealth.factors : [],
        }
      : orgHealth;

  const hasLiveSignal =
    orgHealthScore > 0 ||
    metrics.totalEmployees > 0 ||
    recentActivity.length > 0 ||
    apps.length > 0 ||
    Boolean(commandHealth?.pillars.some((p) => p.score > 0));

  const degraded = !hasLiveSignal;

  return {
    organizationHealthScore: orgHealthScore,
    organizationHealth,
    commandHealth,
    metrics,
    monthlyTrend,
    recentActivity,
    softwareDivision: {
      total: softwareHealth.total ?? apps.length,
      healthy: healthyApps,
      operational: healthyApps,
      polledHealthy: apps.filter((a) => a.healthy).length,
      production: SOFTWARE_DIVISION_APPS.filter((a) => a.status === "locked" || a.status === "production").length,
      inDevelopment: SOFTWARE_DIVISION_APPS.filter((a) => a.status === "development" || a.status === "mvp").length,
    },
    platformServices: {
      total: Object.keys(services).length,
      healthy: healthyServices,
      details: services,
    },
    modules: Object.keys(HQ_MODULE_PERMISSIONS),
    user: user ? { role: user.role, hqRole: user.hqRole } : undefined,
    degraded,
    warning: degraded
      ? "Some executive data sources were slow — dashboard may show partial metrics."
      : null,
    timestamp: new Date().toISOString(),
  };
}

let overviewCache: { at: number; key: string; data: Awaited<ReturnType<typeof buildExecutiveOverviewBounded>> } | null = null;
const OVERVIEW_CACHE_TTL = 45_000;

export async function buildExecutiveOverviewSafe(hqUser?: { role?: string; id?: string }) {
  const user = {
    role: hqUser?.role,
    hqRole: hqUser?.role ? toHQRole(hqUser.role) : null,
  };
  const cacheKey = user.role ?? "anonymous";
  const now = Date.now();
  if (overviewCache && overviewCache.key === cacheKey && now - overviewCache.at < OVERVIEW_CACHE_TTL) {
    return overviewCache.data;
  }

  const started = Date.now();
  type Payload = Awaited<ReturnType<typeof buildExecutiveOverviewBounded>>;

  const payload = await Promise.race([
    buildExecutiveOverviewBounded(user).catch((err) => {
      console.error("[executive-overview] aggregate error:", err);
      return emptyExecutiveOverview(user) as Payload;
    }),
    new Promise<Payload>((resolve) => {
      setTimeout(() => {
        console.warn(`[executive-overview] aggregate timed out after ${EXEC_AGGREGATE_TIMEOUT_MS}ms`);
        resolve(emptyExecutiveOverview(user) as Payload);
      }, EXEC_AGGREGATE_TIMEOUT_MS);
    }),
  ]);

  console.info(`[executive-overview] build finished (${Date.now() - started}ms, degraded=${Boolean(payload.degraded)})`);
  if (!payload.degraded) {
    overviewCache = { at: now, key: cacheKey, data: payload };
  }
  return payload;
}

export function invalidateExecutiveOverviewCache(): void {
  overviewCache = null;
}
