export type MissionStatus = "planning" | "active" | "at_risk" | "complete";
export type ObjectiveType = "annual" | "quarterly" | "department_milestone";
export type MissionTaskStatus = "pending" | "in_progress" | "approved" | "rejected" | "completed";

export interface HqMission {
  id: string;
  title: string;
  description?: string | null;
  status: MissionStatus;
  priority: string;
  owner_email?: string | null;
  department?: string | null;
  target_date?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_by_email?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HqObjective {
  id: string;
  title: string;
  description?: string | null;
  objective_type: ObjectiveType;
  department?: string | null;
  fiscal_year?: number | null;
  quarter?: number | null;
  target_kpi?: string | null;
  current_value?: number;
  target_value?: number;
  progress_pct?: number;
  status: string;
  owner_email?: string | null;
  due_date?: string | null;
  mission_id?: string | null;
}

export interface HqMissionTask {
  id: string;
  title: string;
  description?: string | null;
  status: MissionTaskStatus;
  priority: string;
  owner_email?: string | null;
  due_date?: string | null;
  mission_id?: string | null;
  objective_id?: string | null;
  dependencies?: { depends_on_task_id: string; title: string }[];
}

export interface HqFounderDecision {
  id: string;
  title: string;
  description?: string | null;
  decision_type: string;
  status: string;
  priority: string;
}

export interface HqExecutiveNote {
  id: string;
  title: string;
  body: string;
  author_email: string;
  pinned: number;
  created_at: string;
}

export interface HqAuditEntry {
  id: string;
  actor_email?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  summary?: string | null;
  metadata?: string | null;
  metadata_json?: string | null;
  created_at: string;
}

export interface MissionControlCommandCenter {
  executiveDashboard: {
    organizationHealth?: { overall: number; grade: string };
    activePriorities?: { action: string; priority: string }[];
    criticalAlerts?: { type: string; title: string; severity: string; path?: string; id: string }[];
    scorecard?: Record<string, unknown> | null;
    dailyBriefing?: Record<string, unknown> | null;
  };
  missionOperations: {
    missions: HqMission[];
    byStatus: Record<MissionStatus, HqMission[]>;
    upcoming: HqMission[];
    completed: HqMission[];
    timeline: { missionId: string; missionTitle: string; events: unknown[] }[];
  };
  strategicObjectives: {
    objectives: HqObjective[];
    byType: Record<ObjectiveType, HqObjective[]>;
    avgProgress: number;
  };
  taskCommandCenter: {
    missionTasks: HqMissionTask[];
    executiveTasks: unknown[];
    counts: { missionPending: number; missionApproved: number; executivePending: number };
  };
  crossDivision: {
    modules: { key: string; label: string; path: string; healthy: boolean; status: string; alerts: number }[];
    divisions: unknown[];
  };
  founderPanel: {
    pendingDecisions: HqFounderDecision[];
    approvalQueue: unknown[];
    executiveNotes: HqExecutiveNote[];
    emergencyOverrides: HqFounderDecision[];
  };
  missionIntelligence: {
    predictive?: unknown;
    financialRisk?: unknown;
    recommendations?: unknown[];
    bottlenecks: HqMissionTask[];
    opportunities: HqObjective[];
  };
  auditHistory: {
    entries: HqAuditEntry[];
    entityTypes: string[];
  };
  generatedAt: string;
}
