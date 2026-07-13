import { hqApiFetch } from "./hqApiFetch";

export type EhiCategory = {
  id: string;
  label: string;
  score: number | null;
  status: "healthy" | "degraded" | "critical" | "unverified";
  detail: string;
  probes: { id: string; label: string; ok: boolean; score: number; detail: string; live: boolean }[];
};

export type EhiIssue = {
  id: string;
  module: string;
  category: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  rootCause: string;
  impact: string;
  recommendedFix: string;
  estimatedEffort: string;
  status: string;
  scoreDeltaIfFixed: number;
  path?: string;
};

export type EnterpriseHealthReport = {
  version: string;
  overallScore: number;
  verifiedCoveragePct: number;
  canReach100: boolean;
  certifiedReady: boolean;
  categories: EhiCategory[];
  issues: EhiIssue[];
  criticalCount: number;
  warningCount: number;
  passingModules: string[];
  failingModules: string[];
  performance: {
    monitoringOverall: number | null;
    avgProbeLatencyMs: number | null;
    slowProbes: { id: string; latencyMs: number }[];
  };
  deployment: { host: string; commit: string | null; nodeEnv: string | null };
  integrations: { id: string; name: string; healthy: boolean; status: string; message: string }[];
  recommendedPriorities: { rank: number; issueId: string; title: string; severity: string; effort: string }[];
  estimatedHealthAfterPendingFixes: number;
  speechSummary: string;
  generatedAt: string;
};

export const EMPTY_EHI_REPORT: EnterpriseHealthReport = {
  version: "1.0",
  overallScore: 0,
  verifiedCoveragePct: 0,
  canReach100: false,
  certifiedReady: false,
  categories: [],
  issues: [],
  criticalCount: 0,
  warningCount: 0,
  passingModules: [],
  failingModules: [],
  performance: { monitoringOverall: null, avgProbeLatencyMs: null, slowProbes: [] },
  deployment: { host: "unknown", commit: null, nodeEnv: null },
  integrations: [],
  recommendedPriorities: [],
  estimatedHealthAfterPendingFixes: 0,
  speechSummary: "",
  generatedAt: "",
};

export const enterpriseHealthApi = {
  dashboard: () =>
    hqApiFetch<EnterpriseHealthReport>("/api/hq/enterprise-health/dashboard", { timeoutMs: 45_000 }),
  refresh: (liveIntegrationTests = true) =>
    hqApiFetch<EnterpriseHealthReport>("/api/hq/enterprise-health/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ liveIntegrationTests }),
      timeoutMs: 180_000,
    }),
};
