import { hqApiFetch } from "./hqApiFetch";

export type SeDashboard = {
  generatedAt: string;
  hqBase?: string;
  hostMode?: "control_plane" | "engineering_workspace";
  hostLabel?: string;
  hostHealthy?: boolean;
  hostDetail?: string;
  github: {
    repository: string;
    branch: string;
    latestCommit: string | null;
    liveCommit: string | null;
    deploymentStatus: string;
    repositoryHealth?: string;
    message?: string;
  } | null;
  index: {
    totalFiles: number;
    workspaceConfigured: boolean;
    githubConfigured: boolean;
    repos: Record<string, unknown>[];
  };
  workspaceConfigured: boolean;
  apps: Array<{
    id: string;
    name: string;
    healthy: boolean | null;
    healthError: string | null;
    deployAlignment: string;
    githubCommit: string | null;
    liveCommit: string | null;
    path: string;
    productionUrl?: string;
    status: string;
  }>;
  openDiagnoses: Record<string, unknown>[];
  pendingApprovals: Record<string, unknown>[];
  changePackages?: Record<string, unknown>[];
  recentTestRuns?: Record<string, unknown>[];
  failedBuildsOrTests?: Record<string, unknown>[];
  securityWarnings?: string[];
  hostNotices?: string[];
  recommendedPriorities: Array<{ priority: string; title: string; detail: string; path?: string }>;
  founderApprovalsWaiting?: Record<string, unknown>[];
  allowlistedRepos?: Array<{ id: string; label: string; repository: string; branch: string }>;
};

export const softwareEngineeringApi = {
  dashboard: () => hqApiFetch<SeDashboard>("/api/hq/aura/software-engineering/dashboard"),
  portfolio: () => hqApiFetch("/api/hq/aura/software-engineering/portfolio"),
  diagnose: (symptom: string) =>
    hqApiFetch("/api/hq/aura/software-engineering/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symptom }),
    }),
  command: (command: string) =>
    hqApiFetch<{ reply: string; action: string; data?: unknown }>("/api/hq/aura/software-engineering/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    }),
  decideApproval: (id: string, decision: "approve" | "reject", note?: string) =>
    hqApiFetch(`/api/hq/aura/software-engineering/approvals/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note }),
    }),
  refreshIndex: () =>
    hqApiFetch("/api/hq/aura/software-engineering/index/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  compareDeploy: () => hqApiFetch("/api/hq/aura/software-engineering/deploy/compare"),
};
