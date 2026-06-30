/**
 * Phase 8 — Division Integration Layer
 * Read-only adapters. Headquarters aggregates division data without modifying division apps.
 * IFCDC Barbers App remains production-locked — health/analytics ingest only.
 */
import { getDb } from "../db";
import { pollAllApps, SOFTWARE_DIVISION_APPS } from "./appRegistry";
import { buildOperationsOverview } from "./operationsSchema";
import { buildProgramAnalytics } from "./analyticsReporting";

export type DivisionId =
  | "barbers"
  | "housing"
  | "scholarships"
  | "community_programs"
  | "media"
  | "radio"
  | "music"
  | "tapis"
  | "inclusive"
  | "case_management"
  | "economic_development"
  | "software_division";

export interface DivisionSnapshot {
  id: DivisionId;
  name: string;
  status: "live" | "beta" | "development" | "production-locked";
  readOnly: true;
  healthy: boolean;
  metrics: Record<string, number | string>;
  summary: string;
  lastSync: string;
  independentlyDeployable: boolean;
}

const DIVISION_META: Record<DivisionId, { name: string; appId?: string }> = {
  barbers: { name: "IFCDC Barbers App", appId: "barbers" },
  housing: { name: "Housing Program" },
  scholarships: { name: "Scholarship Program" },
  community_programs: { name: "Community Programs" },
  media: { name: "Media Division", appId: "music" },
  radio: { name: "IFCDC Radio", appId: "radio" },
  music: { name: "IFCDC Music App", appId: "music" },
  tapis: { name: "IFCDC Tapis", appId: "tapis" },
  inclusive: { name: "Inclusive Community", appId: "inclusive" },
  case_management: { name: "Client & Case Management" },
  economic_development: { name: "Economic Development" },
  software_division: { name: "Software Division Hub" },
};

async function fetchAppHealth(appId: string) {
  const apps = await pollAllApps();
  return apps.find((a) => a.id === appId);
}

async function fetchHousingSnapshot(): Promise<DivisionSnapshot> {
  const db = await getDb();
  const apps = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM housing_applications").catch(() => ({ c: 0 }));
  const placements = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM housing_placements WHERE status = 'active'").catch(() => ({ c: 0 }));
  const units = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM housing_units").catch(() => ({ c: 0 }));
  const ops = await buildOperationsOverview().catch(() => null);

  return {
    id: "housing",
    name: DIVISION_META.housing.name,
    status: "live",
    readOnly: true,
    healthy: true,
    metrics: {
      applications: apps?.c ?? ops?.housing?.applications ?? 0,
      activePlacements: placements?.c ?? ops?.housing?.placements ?? 0,
      units: units?.c ?? ops?.housing?.units ?? 0,
    },
    summary: `${placements?.c ?? ops?.housing?.placements ?? 0} active placements across ${units?.c ?? ops?.housing?.units ?? 0} units`,
    lastSync: new Date().toISOString(),
    independentlyDeployable: true,
  };
}

async function fetchScholarshipSnapshot(): Promise<DivisionSnapshot> {
  const db = await getDb();
  const apps = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM scholarship_applications").catch(() => ({ c: 0 }));
  const awarded = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM scholarship_applications WHERE status = 'awarded'").catch(() => ({ c: 0 }));
  const ops = await buildOperationsOverview().catch(() => null);

  return {
    id: "scholarships",
    name: DIVISION_META.scholarships.name,
    status: "live",
    readOnly: true,
    healthy: true,
    metrics: {
      applications: apps?.c ?? ops?.scholarships?.applications ?? 0,
      awarded: awarded?.c ?? 0,
      programs: ops?.scholarships?.programs ?? 0,
    },
    summary: `${awarded?.c ?? 0} scholarships awarded · ${apps?.c ?? 0} applications`,
    lastSync: new Date().toISOString(),
    independentlyDeployable: true,
  };
}

async function fetchCommunityProgramsSnapshot(): Promise<DivisionSnapshot> {
  const programs = await buildProgramAnalytics().catch(() => ({
    hqPrograms: { active: 0, participants: 0 },
    programModules: [],
    participants: [],
  }));

  return {
    id: "community_programs",
    name: DIVISION_META.community_programs.name,
    status: "live",
    readOnly: true,
    healthy: true,
    metrics: {
      activePrograms: programs.hqPrograms?.active ?? 0,
      participants: programs.hqPrograms?.participants ?? 0,
      modules: programs.programModules?.length ?? 0,
    },
    summary: `${programs.hqPrograms?.active ?? 0} programs · ${programs.hqPrograms?.participants ?? 0} participants`,
    lastSync: new Date().toISOString(),
    independentlyDeployable: true,
  };
}

async function fetchAppDivisionSnapshot(id: DivisionId, appId: string): Promise<DivisionSnapshot> {
  const app = SOFTWARE_DIVISION_APPS.find((a) => a.id === appId);
  const health = await fetchAppHealth(appId);
  const locked = app?.locked === true;
  const webhook = await import("./divisionAnalyticsWebhook").then((m) => m.getLatestDivisionAnalytics(id)).catch(() => null);

  const webhookMetrics = webhook?.metrics as Record<string, number | string> | undefined;
  const integrationOperational = locked || health?.healthy || !!webhook || app?.status === "development" || app?.status === "mvp";

  return {
    id,
    name: DIVISION_META[id].name,
    status: locked ? "production-locked" : (app?.status === "mvp" ? "beta" : app?.status ?? "development") as DivisionSnapshot["status"],
    readOnly: true,
    healthy: integrationOperational,
    metrics: {
      latencyMs: health?.latencyMs ?? 0,
      version: health?.version ?? app?.version ?? "—",
      activeUsers: (webhookMetrics?.activeUsers as number) ?? health?.activeUsers ?? 0,
      deployment: health?.deployment ?? "unknown",
      ...(webhookMetrics ?? {}),
    },
    summary: locked
      ? "Production-locked — read-only health monitoring from Headquarters"
      : webhook
        ? `${DIVISION_META[id].name} · webhook data received ${new Date(webhook.receivedAt).toLocaleString()}`
        : health?.healthy
          ? `${DIVISION_META[id].name} online · ${health.latencyMs}ms latency`
          : `${DIVISION_META[id].name} unreachable — ${health?.error ?? "health check failed"}`,
    lastSync: webhook?.receivedAt ?? new Date().toISOString(),
    independentlyDeployable: true,
  };
}

async function fetchCaseManagementSnapshot(): Promise<DivisionSnapshot> {
  const { buildClientCaseOverview } = await import("./clientCaseEngine");
  const overview = await buildClientCaseOverview();

  return {
    id: "case_management",
    name: DIVISION_META.case_management.name,
    status: "live",
    readOnly: true,
    healthy: true,
    metrics: {
      totalClients: overview.totalClients,
      activeAssignments: overview.activeAssignments,
      openGoals: overview.openGoals,
      encounters30d: overview.encounters30d,
      upcomingAppointments: overview.upcomingAppointments,
      highRiskClients: overview.highRiskClients,
    },
    summary: `${overview.totalClients} clients · ${overview.openGoals} open goals · ${overview.upcomingAppointments} upcoming appointments`,
    lastSync: overview.generatedAt,
    independentlyDeployable: false,
  };
}

async function fetchEconomicDevelopmentSnapshot(): Promise<DivisionSnapshot> {
  const db = await getDb();
  const participants = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM hq_program_participants WHERE program_slug = 'economic-development' AND status = 'active'",
  ).catch(() => ({ c: 0 })))?.c ?? 0;
  const jobsPlaced = (await db.get<{ v: number }>(
    "SELECT COALESCE(metric_value, 0) as v FROM hq_program_metrics WHERE program_slug = 'economic-development' AND metric_key = 'jobs_placed' ORDER BY recorded_at DESC LIMIT 1",
  ).catch(() => ({ v: 0 })))?.v ?? 0;
  const training = (await db.get<{ v: number }>(
    "SELECT COALESCE(metric_value, 0) as v FROM hq_program_metrics WHERE program_slug = 'economic-development' AND metric_key = 'training' ORDER BY recorded_at DESC LIMIT 1",
  ).catch(() => ({ v: 0 })))?.v ?? 0;
  const econClients = (await db.get<{ c: number }>(`
    SELECT COUNT(*) as c FROM clients WHERE programs LIKE '%ECON_DEV%' OR programs LIKE '%economic%'
  `).catch(() => ({ c: 0 })))?.c ?? 0;
  const webhook = await import("./divisionAnalyticsWebhook").then((m) => m.getLatestDivisionAnalytics("economic_development")).catch(() => null);

  return {
    id: "economic_development",
    name: DIVISION_META.economic_development.name,
    status: "live",
    readOnly: true,
    healthy: true,
    metrics: {
      participants,
      jobsPlaced,
      trainingCompletions: training,
      linkedClients: econClients,
      ...(webhook?.metrics as Record<string, number | string> | undefined),
    },
    summary: `${participants} active participants · ${jobsPlaced} jobs placed · ${econClients} case clients`,
    lastSync: webhook?.receivedAt ?? new Date().toISOString(),
    independentlyDeployable: true,
  };
}

async function fetchSoftwareDivisionHubSnapshot(): Promise<DivisionSnapshot> {
  const apps = await pollAllApps();
  const healthy = apps.filter((a) => a.healthy).length;
  const { buildSoftwareDivisionConnectors } = await import("./divisionConnectors");

  return {
    id: "software_division",
    name: DIVISION_META.software_division.name,
    status: "live",
    readOnly: true,
    healthy: healthy > 0,
    metrics: {
      totalApps: apps.length,
      healthyApps: healthy,
      connectors: buildSoftwareDivisionConnectors().length,
      productionLocked: SOFTWARE_DIVISION_APPS.filter((a) => a.locked).length,
    },
    summary: `${healthy}/${apps.length} Software Division apps online · ${buildSoftwareDivisionConnectors().length} connectors`,
    lastSync: new Date().toISOString(),
    independentlyDeployable: true,
  };
}

export async function fetchDivisionSnapshot(divisionId: DivisionId): Promise<DivisionSnapshot | null> {
  switch (divisionId) {
    case "barbers":
      return fetchAppDivisionSnapshot("barbers", "barbers");
    case "housing":
      return fetchHousingSnapshot();
    case "scholarships":
      return fetchScholarshipSnapshot();
    case "community_programs":
      return fetchCommunityProgramsSnapshot();
    case "media":
    case "music":
      return fetchAppDivisionSnapshot(divisionId, "music");
    case "radio":
      return fetchAppDivisionSnapshot("radio", "radio");
    case "tapis":
      return fetchAppDivisionSnapshot("tapis", "tapis");
    case "inclusive":
      return fetchAppDivisionSnapshot("inclusive", "inclusive");
    case "case_management":
      return fetchCaseManagementSnapshot();
    case "economic_development":
      return fetchEconomicDevelopmentSnapshot();
    case "software_division":
      return fetchSoftwareDivisionHubSnapshot();
    default:
      return null;
  }
}

export async function buildDivisionIntegrationOverview() {
  const divisionIds: DivisionId[] = [
    "software_division", "case_management", "economic_development",
    "barbers", "housing", "scholarships", "community_programs", "media", "radio", "music", "tapis", "inclusive",
  ];

  const snapshots = await Promise.all(divisionIds.map((id) => fetchDivisionSnapshot(id)));
  const divisions = snapshots.filter((s): s is DivisionSnapshot => s !== null);
  const healthy = divisions.filter((d) => d.healthy).length;

  return {
    divisions,
    counts: {
      total: divisions.length,
      healthy,
      productionLocked: divisions.filter((d) => d.status === "production-locked").length,
    },
    headquartersRole: "single_source_of_truth",
    integrationMode: "read_only",
    barbersProductionLocked: true,
    timestamp: new Date().toISOString(),
  };
}

export function listDivisionAdapters(): { id: DivisionId; name: string; readOnly: true; appRef?: string }[] {
  return (Object.keys(DIVISION_META) as DivisionId[]).map((id) => ({
    id,
    name: DIVISION_META[id].name,
    readOnly: true as const,
    appRef: DIVISION_META[id].appId,
  }));
}
