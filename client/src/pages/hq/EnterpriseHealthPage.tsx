import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { EMPTY_EHI_REPORT, enterpriseHealthApi } from "../../api/enterpriseHealthApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { HqApiError } from "../../api/hqApiFetch";

function errorMessage(err: unknown): string {
  if (err instanceof HqApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Request failed.";
}

function statusVariant(status: string): "success" | "warning" | "danger" | "muted" | "gold" {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  if (status === "critical") return "danger";
  return "muted";
}

const EnterpriseHealthPage: React.FC = () => {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const reportQ = useQuery({
    queryKey: ["enterprise-health"],
    queryFn: async () => {
      try {
        return await enterpriseHealthApi.dashboard();
      } catch (err) {
        console.warn("[enterprise-health] load failed:", err);
        throw err;
      }
    },
    staleTime: 30_000,
  });

  const refresh = useMutation({
    mutationFn: () => enterpriseHealthApi.refresh(true),
    onSuccess: (data) => {
      setError(null);
      qc.setQueryData(["enterprise-health"], data);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  if (reportQ.isLoading) {
    return (
      <HQLayout title="Enterprise Health" subtitle="Live production health — no placeholders" auraModule="aura">
        <HqLoading />
      </HQLayout>
    );
  }

  if (reportQ.isError && !reportQ.data) {
    return (
      <HQLayout title="Enterprise Health" subtitle="Live production health — no placeholders" auraModule="aura">
        <p style={{ color: "var(--hq-danger)" }}>{errorMessage(reportQ.error)}</p>
      </HQLayout>
    );
  }

  const d = reportQ.data ?? EMPTY_EHI_REPORT;

  return (
    <HQLayout
      title="Enterprise Health"
      subtitle="12-category live score · points earned only after verified production probes"
      auraModule="aura"
    >
      {error && <p style={{ color: "var(--hq-danger)", marginBottom: "0.75rem" }}>{error}</p>}

      <div className="hq-panel" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel-body" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <button
            type="button"
            className="hq-btn hq-btn-primary"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
            {refresh.isPending ? "Refreshing…" : "Founder Deep Refresh"}
          </button>
          <button
            type="button"
            className="hq-btn hq-btn-ghost"
            disabled={reportQ.isFetching}
            onClick={() => reportQ.refetch()}
          >
            Refresh dashboard
          </button>
          <Link to="/hq/enterprise-readiness" className="hq-btn hq-btn-ghost hq-btn-sm">Certification</Link>
          <Link to="/hq/monitoring" className="hq-btn hq-btn-ghost hq-btn-sm">Monitoring</Link>
          <Link to="/hq/integrations" className="hq-btn hq-btn-ghost hq-btn-sm">Integrations</Link>
          <span className="hq-muted-text" style={{ fontSize: "0.78rem" }}>
            {d.generatedAt ? `Generated ${new Date(d.generatedAt).toLocaleString()}` : ""}
            {d.deployment.commit ? ` · ${d.deployment.commit.slice(0, 7)}` : ""}
          </span>
        </div>
      </div>

      <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
        <KpiCard
          label="Overall Enterprise Health"
          value={`${d.overallScore}%`}
          icon={Activity}
          variant={d.overallScore >= 80 ? "success" : d.overallScore >= 60 ? "warning" : "danger"}
          meta={d.certifiedReady ? "Certified ready" : d.canReach100 ? "Not certified" : "Coverage incomplete"}
        />
        <KpiCard label="Critical Issues" value={String(d.criticalCount)} icon={AlertTriangle} variant={d.criticalCount ? "danger" : "success"} />
        <KpiCard label="Warnings" value={String(d.warningCount)} icon={AlertTriangle} variant={d.warningCount ? "warning" : "muted"} />
        <KpiCard label="Verified Coverage" value={`${d.verifiedCoveragePct}%`} icon={CheckCircle2} variant={d.verifiedCoveragePct === 100 ? "success" : "warning"} meta="Categories with live probes" />
        <KpiCard
          label="Est. After Pending Fixes"
          value={`${d.estimatedHealthAfterPendingFixes}%`}
          icon={Activity}
          variant="gold"
          meta="Upper bound if open issues are repaired and re-verified"
        />
      </div>

      {d.speechSummary && (
        <p className="hq-muted-text" style={{ marginBottom: "1rem", fontSize: "0.9rem" }}>{d.speechSummary}</p>
      )}

      <div className="hq-panel" style={{ marginBottom: "1.25rem" }}>
        <div className="hq-panel-header"><h3>Category Scores</h3></div>
        <div className="hq-panel-body" style={{ display: "grid", gap: "0.65rem" }}>
          {d.categories.map((c) => (
            <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0.75rem", alignItems: "center" }}>
              <div>
                <strong style={{ fontSize: "0.9rem" }}>{c.label}</strong>
                <div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>{c.detail}</div>
              </div>
              <StatusBadge label={c.status} variant={statusVariant(c.status)} />
              <strong>{c.score == null ? "—" : `${c.score}%`}</strong>
            </div>
          ))}
          {!d.categories.length && <p className="hq-muted-text">No category data yet.</p>}
        </div>
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1.25rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-header"><h3>Passing Modules</h3></div>
          <div className="hq-panel-body" style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
            {d.passingModules.map((m) => <StatusBadge key={m} label={m} variant="success" />)}
            {!d.passingModules.length && <span className="hq-muted-text">None yet</span>}
          </div>
        </div>
        <div className="hq-panel">
          <div className="hq-panel-header"><h3>Failing / Unverified</h3></div>
          <div className="hq-panel-body" style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
            {d.failingModules.map((m) => <StatusBadge key={m} label={m} variant="danger" />)}
            {!d.failingModules.length && <span className="hq-muted-text">None</span>}
          </div>
        </div>
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1.25rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-header"><h3>Performance</h3></div>
          <div className="hq-panel-body" style={{ fontSize: "0.85rem" }}>
            <p>Monitoring overall: {d.performance.monitoringOverall != null ? `${d.performance.monitoringOverall}%` : "—"}</p>
            <p>Avg probe latency: {d.performance.avgProbeLatencyMs != null ? `${d.performance.avgProbeLatencyMs}ms` : "—"}</p>
            {d.performance.slowProbes.map((p) => (
              <div key={p.id} className="hq-muted-text">{p.id}: {p.latencyMs}ms</div>
            ))}
          </div>
        </div>
        <div className="hq-panel">
          <div className="hq-panel-header"><h3>Deployment / Integrations</h3></div>
          <div className="hq-panel-body" style={{ fontSize: "0.85rem" }}>
            <p>Host: {d.deployment.host} · env: {d.deployment.nodeEnv || "—"}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
              {d.integrations.slice(0, 12).map((i) => (
                <StatusBadge key={i.id} label={i.name} variant={i.healthy ? "success" : "warning"} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="hq-panel" style={{ marginBottom: "1.25rem" }}>
        <div className="hq-panel-header"><h3>Recommended Priorities</h3></div>
        <div className="hq-panel-body" style={{ display: "grid", gap: "0.5rem" }}>
          {d.recommendedPriorities.map((p) => (
            <div key={p.issueId} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
              <strong style={{ minWidth: "1.5rem" }}>{p.rank}.</strong>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.85rem" }}>{p.title}</div>
                <div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>{p.severity} · {p.effort}</div>
              </div>
            </div>
          ))}
          {!d.recommendedPriorities.length && <p className="hq-muted-text">No open priorities — re-run after deploy to confirm.</p>}
        </div>
      </div>

      <div className="hq-panel">
        <div className="hq-panel-header"><h3>All Issues Reducing Score</h3></div>
        <div className="hq-panel-body" style={{ display: "grid", gap: "0.85rem" }}>
          {d.issues.map((issue) => (
            <div key={issue.id} style={{ borderTop: "1px solid var(--hq-border)", paddingTop: "0.75rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.35rem" }}>
                <StatusBadge label={issue.severity} variant={issue.severity === "critical" ? "danger" : issue.severity === "high" ? "warning" : "muted"} />
                <strong style={{ fontSize: "0.85rem" }}>{issue.module}</strong>
                {issue.path && <Link to={issue.path} className="hq-btn hq-btn-ghost hq-btn-sm">Open</Link>}
              </div>
              <p style={{ fontSize: "0.85rem", margin: "0 0 0.35rem" }}>{issue.description}</p>
              <p className="hq-muted-text" style={{ fontSize: "0.75rem", margin: 0 }}>
                Root cause: {issue.rootCause} · Impact: {issue.impact}
              </p>
              <p className="hq-muted-text" style={{ fontSize: "0.75rem", margin: "0.25rem 0 0" }}>
                Fix: {issue.recommendedFix} · Effort: {issue.estimatedEffort} · +~{issue.scoreDeltaIfFixed} pts if verified
              </p>
            </div>
          ))}
          {!d.issues.length && <p className="hq-muted-text">No open issues from live probes.</p>}
        </div>
      </div>
    </HQLayout>
  );
};

export default EnterpriseHealthPage;
