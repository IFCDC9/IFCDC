import type { ExecutiveOverview } from "../api/hqApi";
import type { AnalyticsOverview } from "../api/analyticsApi";
import type { OperationsOverview } from "../api/operationsApi";
import type { ActivityItem } from "../api/hqApi";

/** Safe defaults so Founder Dashboard always renders even when APIs fail */
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

export function normalizeOperationsOverview(data?: Partial<OperationsOverview> | null): OperationsOverview | null {
  if (!data) return isProductionClient ? null : DEFAULT_OPERATIONS_OVERVIEW;
  if (isProductionClient) return data as OperationsOverview;
  return {
    housing: { ...DEFAULT_OPERATIONS_OVERVIEW.housing, ...data.housing },
    scholarships: { ...DEFAULT_OPERATIONS_OVERVIEW.scholarships, ...data.scholarships },
    media: { ...DEFAULT_OPERATIONS_OVERVIEW.media, ...data.media },
    documents: { ...DEFAULT_OPERATIONS_OVERVIEW.documents, ...data.documents },
    assets: { ...DEFAULT_OPERATIONS_OVERVIEW.assets, ...data.assets },
    fleet: { ...DEFAULT_OPERATIONS_OVERVIEW.fleet, ...data.fleet },
    facilities: { ...DEFAULT_OPERATIONS_OVERVIEW.facilities, ...data.facilities },
    board: { ...DEFAULT_OPERATIONS_OVERVIEW.board, ...data.board },
    compliance: { ...DEFAULT_OPERATIONS_OVERVIEW.compliance, ...data.compliance },
    calendar: { ...DEFAULT_OPERATIONS_OVERVIEW.calendar, ...data.calendar },
  };
}

export function normalizeExecutiveOverview(data?: Partial<ExecutiveOverview> | null): ExecutiveOverview | null {
  if (!data) return isProductionClient ? null : DEFAULT_EXECUTIVE_OVERVIEW;
  if (isProductionClient) {
    return {
      ...data,
      organizationHealth: data.organizationHealth,
      organizationHealthScore:
        data.organizationHealthScore ?? data.organizationHealth?.overall ?? 0,
      metrics: data.metrics!,
      recentActivity: data.recentActivity ?? [],
      softwareDivision: data.softwareDivision,
      platformServices: data.platformServices ?? [],
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
