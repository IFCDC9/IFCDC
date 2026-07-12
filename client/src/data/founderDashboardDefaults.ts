import type { ExecutiveOverview } from "../api/hqApi";
import type { AnalyticsOverview } from "../api/analyticsApi";
import type { OperationsOverview } from "../api/operationsApi";
import type { ActivityItem } from "../api/hqApi";

/** Allow live pillar aggregation (org + system + finance + ops + security + integrations). */
export const EXECUTIVE_OVERVIEW_FETCH_TIMEOUT_MS = 22_000;

/** Production-safe empty executive snapshot — zeros only, never demo seed numbers. */
export const EMPTY_EXECUTIVE_OVERVIEW: ExecutiveOverview = {
  organizationHealthScore: 0,
  organizationHealth: { overall: 0, grade: "—", factors: [] },
  commandHealth: null,
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
  monthlyTrend: [],
  recentActivity: [],
  softwareDivision: { total: 0, healthy: 0, operational: 0, production: 0, inDevelopment: 0 },
  platformServices: { total: 0, healthy: 0, details: {} },
  timestamp: new Date().toISOString(),
};

/** Safe defaults so Founder Dashboard always renders even when APIs fail (development only) */
export const DEFAULT_EXECUTIVE_OVERVIEW: ExecutiveOverview = {
  organizationHealthScore: 82,
  organizationHealth: {
    overall: 82,
    grade: "B+",
    factors: [
      { label: "Finance", score: 85, max: 100, weight: "25%" },
      { label: "Grants", score: 78, max: 100, weight: "20%" },
      { label: "Programs", score: 88, max: 100, weight: "20%" },
      { label: "People", score: 80, max: 100, weight: "20%" },
      { label: "Software", score: 79, max: 100, weight: "15%" },
    ],
  },
  commandHealth: null,
  metrics: {
    totalEmployees: 24,
    activeEmployees: 22,
    activeVolunteers: 18,
    activeGrants: 6,
    donationRevenue: 485000,
    monthlyDonations: 42000,
    monthlyExpenses: 38500,
    programsRunning: 8,
  },
  monthlyTrend: [
    { month: "Jan", donations: 32000, expenses: 28000 },
    { month: "Feb", donations: 35000, expenses: 30000 },
    { month: "Mar", donations: 38000, expenses: 31000 },
    { month: "Apr", donations: 40000, expenses: 33000 },
    { month: "May", donations: 41000, expenses: 36000 },
    { month: "Jun", donations: 42000, expenses: 38500 },
  ],
  recentActivity: [
    { id: "seed-1", type: "grant", title: "Grant award active", detail: "Community Development Block Grant", timestamp: new Date().toISOString() },
    { id: "seed-2", type: "donation", title: "Donation received", detail: "Monthly giving campaign", timestamp: new Date().toISOString(), amount: 2500 },
    { id: "seed-3", type: "program", title: "Program milestone", detail: "Youth mentorship cohort started", timestamp: new Date().toISOString() },
  ],
  softwareDivision: { total: 5, healthy: 4, production: 2, inDevelopment: 2 },
  platformServices: { total: 4, healthy: 4, details: { database: true, auth: true, api: true, realtime: true } },
  timestamp: new Date().toISOString(),
};

export const DEFAULT_ANALYTICS_OVERVIEW: AnalyticsOverview = {
  organizationHealth: DEFAULT_EXECUTIVE_OVERVIEW.organizationHealth!,
  finance: { totalRevenue: 485000, monthlyExpenses: 38500, cashFlow: 3500, netPosition: 125000, financialHealthScore: 85 },
  grants: { totalAwarded: 1200000, activeAwards: 6, pipelineValue: 450000, winRate: 68, complianceDue: 1 },
  people: { totalPeople: 42, employees: 24, volunteers: 18, activePayroll: 22, hoursThisMonth: 3840 },
  programs: { programsRunning: 8, participants: 340 },
  donations: { total: 485000, monthly: 42000, count: 156 },
  software: { total: 5, healthy: 4, production: 2, inDevelopment: 2 },
  timestamp: new Date().toISOString(),
};

export const DEFAULT_OPERATIONS_OVERVIEW: OperationsOverview = {
  housing: { units: 12, available: 3, applications: 8, placements: 9 },
  scholarships: { programs: 4, applications: 22, awarded: 15 },
  media: { content: 48, published: 32, broadcasts: 6 },
  documents: { total: 1240 },
  assets: { total: 86 },
  fleet: { vehicles: 4, maintenanceDue: 1 },
  facilities: { properties: 3, openWorkOrders: 2 },
  board: { upcomingMeetings: 2, openActions: 5 },
  compliance: { policies: 18, openRisks: 2, highRisks: 0 },
  calendar: { upcomingEvents: 7 },
};

/** Production-safe empty operations snapshot — zeros only, never demo seed numbers. */
export const EMPTY_OPERATIONS_OVERVIEW: OperationsOverview = {
  housing: { units: 0, available: 0, applications: 0, placements: 0 },
  scholarships: { programs: 0, applications: 0, awarded: 0 },
  media: { content: 0, published: 0, broadcasts: 0 },
  documents: { total: 0 },
  assets: { total: 0 },
  fleet: { vehicles: 0, maintenanceDue: 0 },
  facilities: { properties: 0, openWorkOrders: 0 },
  board: { upcomingMeetings: 0, openActions: 0 },
  compliance: { policies: 0, openRisks: 0, highRisks: 0 },
  calendar: { upcomingEvents: 0 },
};

function mergeOpsSection<T extends Record<string, number>>(
  base: T,
  partial: Partial<T> | null | undefined,
): T {
  if (partial == null || typeof partial !== "object") return { ...base };
  return { ...base, ...partial };
}

export const DEFAULT_ACTIVITY: ActivityItem[] = DEFAULT_EXECUTIVE_OVERVIEW.recentActivity;

export const DEFAULT_AURA_INSIGHT = {
  insight:
    "1. Review active grant compliance reports due this month.\n2. Expand youth program enrollment — capacity is available.\n3. Schedule board meeting to approve Q3 operating budget.",
};

export const DEFAULT_TRENDS = {
  trend: "positive",
  projectedCashFlow: 42000,
  donationGrowth: 8.5,
};

import { isProductionClient } from "../utils/productionDataPolicy";

/** Dev: merge partial API payloads with defaults. Production: live data only — no demo fill. */
export function normalizeAnalyticsOverview(data?: Partial<AnalyticsOverview> | null): AnalyticsOverview | null {
  if (!data) return isProductionClient ? null : DEFAULT_ANALYTICS_OVERVIEW;
  if (isProductionClient) {
    return {
      organizationHealth: data.organizationHealth!,
      finance: data.finance!,
      grants: data.grants!,
      people: data.people!,
      programs: data.programs!,
      donations: data.donations!,
      software: data.software!,
      timestamp: data.timestamp ?? new Date().toISOString(),
    };
  }
  return {
    organizationHealth: {
      ...DEFAULT_ANALYTICS_OVERVIEW.organizationHealth,
      ...data.organizationHealth,
      factors: data.organizationHealth?.factors?.length
        ? data.organizationHealth.factors
        : DEFAULT_ANALYTICS_OVERVIEW.organizationHealth.factors,
    },
    finance: { ...DEFAULT_ANALYTICS_OVERVIEW.finance, ...data.finance },
    grants: { ...DEFAULT_ANALYTICS_OVERVIEW.grants, ...data.grants },
    people: { ...DEFAULT_ANALYTICS_OVERVIEW.people, ...data.people },
    programs: {
      programsRunning: data.programs?.programsRunning ?? DEFAULT_ANALYTICS_OVERVIEW.programs.programsRunning,
      participants: data.programs?.participants ?? DEFAULT_ANALYTICS_OVERVIEW.programs.participants,
    },
    donations: { ...DEFAULT_ANALYTICS_OVERVIEW.donations, ...data.donations },
    software: { ...DEFAULT_ANALYTICS_OVERVIEW.software, ...data.software },
    timestamp: data.timestamp ?? DEFAULT_ANALYTICS_OVERVIEW.timestamp,
  };
}

export function normalizeOperationsOverview(data?: Partial<OperationsOverview> | null): OperationsOverview {
  const base = isProductionClient ? EMPTY_OPERATIONS_OVERVIEW : DEFAULT_OPERATIONS_OVERVIEW;
  if (!data) return { ...base };
  return {
    housing: mergeOpsSection(base.housing, data.housing),
    scholarships: mergeOpsSection(base.scholarships, data.scholarships),
    media: mergeOpsSection(base.media, data.media),
    documents: mergeOpsSection(base.documents, data.documents),
    assets: mergeOpsSection(base.assets, data.assets),
    fleet: mergeOpsSection(base.fleet, data.fleet),
    facilities: mergeOpsSection(base.facilities, data.facilities),
    board: mergeOpsSection(base.board, data.board),
    compliance: mergeOpsSection(base.compliance, data.compliance),
    calendar: mergeOpsSection(base.calendar, data.calendar),
  };
}

export function normalizeExecutiveOverview(data?: Partial<ExecutiveOverview> | null): ExecutiveOverview {
  if (!data) return isProductionClient ? { ...EMPTY_EXECUTIVE_OVERVIEW } : DEFAULT_EXECUTIVE_OVERVIEW;
  if (isProductionClient) {
    const base = EMPTY_EXECUTIVE_OVERVIEW;
    return {
      organizationHealthScore: data.organizationHealthScore ?? data.organizationHealth?.overall ?? base.organizationHealthScore,
      organizationHealth: data.organizationHealth ?? base.organizationHealth,
      commandHealth: data.commandHealth ?? null,
      metrics: { ...base.metrics, ...data.metrics },
      monthlyTrend: data.monthlyTrend ?? base.monthlyTrend,
      recentActivity: data.recentActivity ?? base.recentActivity,
      softwareDivision: { ...base.softwareDivision, ...data.softwareDivision },
      platformServices: data.platformServices ?? base.platformServices,
      timestamp: data.timestamp ?? new Date().toISOString(),
      degraded: (data as { degraded?: boolean }).degraded,
      warning: (data as { warning?: string | null }).warning ?? undefined,
    } as ExecutiveOverview;
  }
  const orgHealth = data.organizationHealth
    ? {
        ...DEFAULT_EXECUTIVE_OVERVIEW.organizationHealth!,
        ...data.organizationHealth,
        factors: data.organizationHealth.factors?.length
          ? data.organizationHealth.factors
          : DEFAULT_EXECUTIVE_OVERVIEW.organizationHealth!.factors,
      }
    : DEFAULT_EXECUTIVE_OVERVIEW.organizationHealth;

  return {
    ...DEFAULT_EXECUTIVE_OVERVIEW,
    ...data,
    organizationHealth: orgHealth,
    organizationHealthScore:
      data.organizationHealthScore ??
      data.organizationHealth?.overall ??
      DEFAULT_EXECUTIVE_OVERVIEW.organizationHealthScore,
    metrics: { ...DEFAULT_EXECUTIVE_OVERVIEW.metrics, ...data.metrics },
    recentActivity: data.recentActivity?.length ? data.recentActivity : DEFAULT_EXECUTIVE_OVERVIEW.recentActivity,
    softwareDivision: { ...DEFAULT_EXECUTIVE_OVERVIEW.softwareDivision, ...data.softwareDivision },
    platformServices: data.platformServices ?? DEFAULT_EXECUTIVE_OVERVIEW.platformServices,
  };
}
