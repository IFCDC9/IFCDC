import { hqApiFetch } from "./hqApiFetch";

export type ErcSeverity = "critical" | "high" | "medium" | "low";
export type ErcCheckStatus = "pass" | "fail" | "warn" | "blocked" | "pending_manual";
export type ErcIssueStatus = "open" | "in_progress" | "resolved" | "accepted_risk";

export type ErcIssue = {
  id: string;
  module: string;
  category: string;
  description: string;
  rootCause: string;
  severity: ErcSeverity;
  filesAffected: string[];
  recommendedFix: string;
  estimatedEffort: string;
  status: ErcIssueStatus;
  checkId: string;
  path?: string;
};

export type ErcCheck = {
  id: string;
  category: string;
  label: string;
  module: string;
  path?: string;
  status: ErcCheckStatus;
  score: number;
  detail: string;
  latencyMs: number;
  live: boolean;
};

export type ErcPillars = {
  overall: number;
  moduleHealth: number;
  integrationHealth: number;
  securityHealth: number;
  communicationsHealth: number;
  aiHealth: number;
  deploymentHealth: number;
  databaseHealth: number;
  mobileReadiness: number;
  performance: number;
};

export type ErcRun = {
  id: string;
  version: string;
  startedAt: string;
  completedAt: string;
  overallReadiness: number;
  certified: boolean;
  certificationStatus: string;
  pillars: ErcPillars;
  checks: ErcCheck[];
  issues: ErcIssue[];
  outstandingIssueCount: number;
  deepQualityRan: boolean;
  host: string;
  speechSummary: string;
};

export type ErcDashboard = {
  version: string;
  target: number;
  generatedAt: string;
  latest: ErcRun | null;
  openIssues: ErcIssue[];
  certified: boolean;
  overallReadiness: number;
  pillars: ErcPillars;
  policy: {
    noDemoData: boolean;
    noSimulatedSuccess: boolean;
    certificationRequires100: boolean;
    liveIntegrationsRequired: boolean;
  };
};

export const EMPTY_ERC_DASHBOARD: ErcDashboard = {
  version: "1.0",
  target: 100,
  generatedAt: new Date().toISOString(),
  latest: null,
  openIssues: [],
  certified: false,
  overallReadiness: 0,
  pillars: {
    overall: 0,
    moduleHealth: 0,
    integrationHealth: 0,
    securityHealth: 0,
    communicationsHealth: 0,
    aiHealth: 0,
    deploymentHealth: 0,
    databaseHealth: 0,
    mobileReadiness: 0,
    performance: 0,
  },
  policy: {
    noDemoData: true,
    noSimulatedSuccess: true,
    certificationRequires100: true,
    liveIntegrationsRequired: true,
  },
};

export const enterpriseReadinessApi = {
  dashboard: () =>
    hqApiFetch<ErcDashboard>("/api/hq/enterprise-readiness/dashboard", { timeoutMs: 30_000 }),
  run: (opts?: { deepQuality?: boolean }) =>
    hqApiFetch<ErcRun>("/api/hq/enterprise-readiness/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deepQuality: Boolean(opts?.deepQuality), liveIntegrations: true }),
      timeoutMs: 180_000,
    }),
  updateIssue: (id: string, status: ErcIssueStatus) =>
    hqApiFetch<{ ok: boolean }>(`/api/hq/enterprise-readiness/issues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }),
};
