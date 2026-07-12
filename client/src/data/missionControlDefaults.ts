import type { MissionControlCommandCenter } from "../api/missionControlTypes";

/** Allow live Mission Control aggregation across divisions. */
export const MISSION_CONTROL_FETCH_TIMEOUT_MS = 22_000;

const DIVISION_MODULE_LINKS = [
  { key: "grants", label: "Grant Center", path: "/hq/grants" },
  { key: "finance", label: "Financial Center", path: "/hq/finance" },
  { key: "operations", label: "Operations Center", path: "/hq/operations" },
  { key: "communications", label: "Communications", path: "/hq/communications" },
  { key: "people", label: "People Management", path: "/hq/people" },
  { key: "software_division", label: "Software Division", path: "/hq/software" },
  { key: "aura", label: "AURA", path: "/hq/aura" },
  { key: "integrations", label: "Integrations Hub", path: "/hq/integrations" },
] as const;

export const EMPTY_MISSION_CONTROL: MissionControlCommandCenter = {
  executiveDashboard: {
    organizationHealth: { overall: 0, grade: "—" },
    activePriorities: [],
    criticalAlerts: [],
    scorecard: null,
    dailyBriefing: null,
  },
  missionOperations: {
    missions: [],
    byStatus: { planning: [], active: [], at_risk: [], complete: [] },
    upcoming: [],
    completed: [],
    timeline: [],
  },
  strategicObjectives: {
    objectives: [],
    byType: { annual: [], quarterly: [], department_milestone: [] },
    avgProgress: 0,
  },
  taskCommandCenter: {
    missionTasks: [],
    executiveTasks: [],
    counts: { missionPending: 0, missionApproved: 0, executivePending: 0 },
  },
  crossDivision: {
    modules: DIVISION_MODULE_LINKS.map((m) => ({
      ...m,
      healthy: true,
      status: "connected",
      alerts: 0,
    })),
    divisions: [],
  },
  founderPanel: {
    pendingDecisions: [],
    approvalQueue: [],
    executiveNotes: [],
    emergencyOverrides: [],
  },
  missionIntelligence: {
    predictive: null,
    financialRisk: null,
    recommendations: [],
    bottlenecks: [],
    opportunities: [],
  },
  auditHistory: { entries: [], entityTypes: [] },
  generatedAt: new Date().toISOString(),
};

/** Merge partial API payloads — never returns null/undefined nested fields that crash the UI. */
export function normalizeMissionControl(
  raw: Partial<MissionControlCommandCenter> | null | undefined
): MissionControlCommandCenter {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_MISSION_CONTROL, generatedAt: new Date().toISOString() };
  }
  const e = EMPTY_MISSION_CONTROL;
  return {
    executiveDashboard: {
      organizationHealth:
        raw.executiveDashboard?.organizationHealth ?? e.executiveDashboard.organizationHealth,
      activePriorities: raw.executiveDashboard?.activePriorities ?? [],
      criticalAlerts: raw.executiveDashboard?.criticalAlerts ?? [],
      scorecard: raw.executiveDashboard?.scorecard ?? null,
      dailyBriefing: raw.executiveDashboard?.dailyBriefing ?? null,
    },
    missionOperations: {
      missions: raw.missionOperations?.missions ?? [],
      byStatus: {
        planning: raw.missionOperations?.byStatus?.planning ?? [],
        active: raw.missionOperations?.byStatus?.active ?? [],
        at_risk: raw.missionOperations?.byStatus?.at_risk ?? [],
        complete: raw.missionOperations?.byStatus?.complete ?? [],
      },
      upcoming: raw.missionOperations?.upcoming ?? [],
      completed: raw.missionOperations?.completed ?? [],
      timeline: raw.missionOperations?.timeline ?? [],
    },
    strategicObjectives: {
      objectives: raw.strategicObjectives?.objectives ?? [],
      byType: {
        annual: raw.strategicObjectives?.byType?.annual ?? [],
        quarterly: raw.strategicObjectives?.byType?.quarterly ?? [],
        department_milestone: raw.strategicObjectives?.byType?.department_milestone ?? [],
      },
      avgProgress: raw.strategicObjectives?.avgProgress ?? 0,
    },
    taskCommandCenter: {
      missionTasks: raw.taskCommandCenter?.missionTasks ?? [],
      executiveTasks: raw.taskCommandCenter?.executiveTasks ?? [],
      counts: raw.taskCommandCenter?.counts ?? e.taskCommandCenter.counts,
    },
    crossDivision: {
      modules:
        raw.crossDivision?.modules?.length ? raw.crossDivision.modules : e.crossDivision.modules,
      divisions: raw.crossDivision?.divisions ?? [],
    },
    founderPanel: {
      pendingDecisions: raw.founderPanel?.pendingDecisions ?? [],
      approvalQueue: raw.founderPanel?.approvalQueue ?? [],
      executiveNotes: raw.founderPanel?.executiveNotes ?? [],
      emergencyOverrides: raw.founderPanel?.emergencyOverrides ?? [],
    },
    missionIntelligence: {
      predictive: raw.missionIntelligence?.predictive ?? null,
      financialRisk: raw.missionIntelligence?.financialRisk ?? null,
      recommendations: raw.missionIntelligence?.recommendations ?? [],
      bottlenecks: raw.missionIntelligence?.bottlenecks ?? [],
      opportunities: raw.missionIntelligence?.opportunities ?? [],
    },
    auditHistory: {
      entries: raw.auditHistory?.entries ?? [],
      entityTypes: raw.auditHistory?.entityTypes ?? [],
    },
    generatedAt: raw.generatedAt ?? new Date().toISOString(),
  };
}
