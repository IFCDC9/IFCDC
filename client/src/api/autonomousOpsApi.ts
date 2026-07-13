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

export type FounderWorkspace = {
  aoVersion: string;
  generatedAt: string;
  todayPriorities: string[];
  pendingApprovals: number;
  executiveRecommendations: AutonomousRecommendation[];
  activeGrants: { pipelineValue: number | null; activeAwards: number | null; path: string };
  activeProjects: { count: number; path: string };
  criticalAlerts: Array<{ id: string; title: string; message: string; path: string; priority: string }>;
  organizationHealth: number | null;
  enterpriseHealth: number | null;
  strategicGoals: Array<{ title: string; progressPercent: number; status: string }>;
  personalReminders: string[];
  dailyBriefing: unknown;
  preparedPackages: Array<{
    id: string;
    kind: string;
    title: string;
    status: string;
    summary: string;
    path: string;
    createdAt: string;
  }>;
  monitoring: { score: number; status: string; alerts: number } | null;
  memorySummary: string | null;
  latestCycle: { id: string; speechSummary: string; monitoringScore: number | null; createdAt: string } | null;
  deepLinks: Array<{ label: string; path: string }>;
  policy: {
    highImpactRequiresFounderApproval: boolean;
    externalDistributionRequiresFounderApproval: boolean;
    autonomousPrepOnly: boolean;
  };
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
  pendingApprovals: 0,
  executiveRecommendations: [],
  activeGrants: { pipelineValue: null, activeAwards: null, path: "/hq/grants" },
  activeProjects: { count: 0, path: "/hq/operations" },
  criticalAlerts: [],
  organizationHealth: null,
  enterpriseHealth: null,
  strategicGoals: [],
  personalReminders: [],
  dailyBriefing: null,
  preparedPackages: [],
  monitoring: null,
  memorySummary: null,
  latestCycle: null,
  deepLinks: [],
  policy: {
    highImpactRequiresFounderApproval: true,
    externalDistributionRequiresFounderApproval: true,
    autonomousPrepOnly: true,
  },
};

export const autonomousOpsApi = {
  workspace: () =>
    hqApiFetch<FounderWorkspace>("/api/hq/aura/autonomous/workspace", { timeoutMs: 45_000 }),
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
