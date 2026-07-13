import { hqApiFetch } from "./hqApiFetch";

export type AutonomousRecommendation = {
  id: string;
  title: string;
  category: string;
  evidence: string;
  sourceSystems: string[];
  risks: string[];
  benefits: string[];
  confidence: "high" | "medium" | "low";
  recommendedAction: string;
  path: string;
  founderApprovalRequired: boolean;
};

export type FounderCommandCard = {
  id: string;
  label: string;
  value: string;
  meta: string;
  path: string;
  status: "live" | "empty" | "degraded";
  variant?: "gold" | "success" | "warning" | "danger" | "muted";
};

export type WorkspacePerformance = {
  totalMs: number;
  timings: Record<string, { ms: number; timedOut: boolean; error?: string }>;
  slowestEndpoint: { id: string; ms: number } | null;
  liveCards: number;
  degradedCards: number;
  emptyCards: number;
  timedOutCount: number;
  workspaceHealthScore: number;
  targetLoadMs: number;
  targetRefreshMs: number;
};

export type FounderWorkspace = {
  aoVersion: string;
  generatedAt: string;
  todayPriorities: string[];
  todayPriorityItems?: Array<{ id: string; title: string; path: string }>;
  pendingApprovals: number;
  executiveRecommendations: AutonomousRecommendation[];
  activeGrants: { pipelineValue: number | null; activeAwards: number | null; path: string };
  activeProjects: { count: number; path: string };
  criticalAlerts: Array<{ id: string; title: string; message: string; path: string; priority: string }>;
  organizationHealth: number | null;
  enterpriseHealth: number | null;
  strategicGoals: Array<{ title: string; progressPercent: number; status: string; path?: string }>;
  personalReminders: string[];
  personalReminderItems?: Array<{ id: string; title: string; path: string }>;
  dailyBriefing: (Record<string, unknown> & { path?: string }) | null;
  preparedPackages: Array<{
    id: string;
    kind: string;
    title: string;
    status: string;
    summary: string;
    path: string;
    createdAt: string;
  }>;
  monitoring: { score: number; status: string; alerts: number; path?: string } | null;
  memorySummary: string | null;
  memoryPath?: string;
  latestCycle: { id: string; speechSummary: string; monitoringScore: number | null; createdAt: string } | null;
  commandCards?: FounderCommandCard[];
  deepLinks: Array<{ label: string; path: string }>;
  policy: {
    highImpactRequiresFounderApproval: boolean;
    externalDistributionRequiresFounderApproval: boolean;
    autonomousPrepOnly: boolean;
  };
  performance?: WorkspacePerformance;
  cache?: { hit: boolean; ageMs: number; ttlMs: number };
};

export type AutonomousCycle = {
  id: string;
  aoVersion: string;
  speechSummary: string;
  monitoringScore: number | null;
  proactive: { evaluated: number; emitted: number; skipped: number };
  prepared: Array<{ id: string; title: string; status: string; summary: string; path: string }>;
  recommendations: AutonomousRecommendation[];
  founderApprovalsWaiting: number;
};

export const EMPTY_FOUNDER_WORKSPACE: FounderWorkspace = {
  aoVersion: "1.0",
  generatedAt: new Date().toISOString(),
  todayPriorities: [],
  todayPriorityItems: [],
  pendingApprovals: 0,
  executiveRecommendations: [],
  activeGrants: { pipelineValue: null, activeAwards: null, path: "/hq/grants" },
  activeProjects: { count: 0, path: "/hq/operations" },
  criticalAlerts: [],
  organizationHealth: null,
  enterpriseHealth: null,
  strategicGoals: [],
  personalReminders: [],
  personalReminderItems: [],
  dailyBriefing: null,
  preparedPackages: [],
  monitoring: null,
  memorySummary: null,
  memoryPath: "/hq/knowledge",
  latestCycle: null,
  commandCards: [],
  deepLinks: [],
  policy: {
    highImpactRequiresFounderApproval: true,
    externalDistributionRequiresFounderApproval: true,
    autonomousPrepOnly: true,
  },
};

export const autonomousOpsApi = {
  workspace: (opts?: { refresh?: boolean }) =>
    hqApiFetch<FounderWorkspace>(
      `/api/hq/aura/autonomous/workspace${opts?.refresh ? "?refresh=1" : ""}`,
      { timeoutMs: 12_000 }
    ),
  runCycle: (opts?: { notifyFounderChannels?: boolean }) =>
    hqApiFetch<AutonomousCycle>("/api/hq/aura/autonomous/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notifyFounderChannels: Boolean(opts?.notifyFounderChannels),
        prepareCadences: true,
      }),
      timeoutMs: 180_000,
    }),
  command: (request: string) =>
    hqApiFetch<{ speechSummary: string }>("/api/hq/aura/autonomous/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
      timeoutMs: 120_000,
    }),
};
