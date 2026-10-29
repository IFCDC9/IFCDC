import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, CheckCircle2, Database, Plug, RefreshCw, Shield, Smartphone,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import {
  EMPTY_ERC_DASHBOARD,
  enterpriseReadinessApi,
  type ErcIssueStatus,
} from "../../api/enterpriseReadinessApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { ReadinessStatusBadge as StatusBadge } from "../../components/hq/ReadinessStatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { HqApiError } from "../../api/hqApiFetch";

function errorMessage(err: unknown): string {
  if (err instanceof HqApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Request failed.";
}

const EnterpriseReadinessPage: React.FC = () => {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [deepQuality, setDeepQuality] = useState(false);

  const dash = useQuery({
    queryKey: ["enterprise-readiness"],
    queryFn: () => enterpriseReadinessApi.dashboard(),
    placeholderData: EMPTY_ERC_DASHBOARD,
    staleTime: 30_000,
  });

  const runMutation = useMutation({
    mutationFn: () => enterpriseReadinessApi.run({ deepQuality }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["enterprise-readiness"] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const issueMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ErcIssueStatus }) =>
      enterpriseReadinessApi.updateIssue(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["enterprise-readiness"] }),
    onError: (err) => setError(errorMessage(err)),
  });

  const d = dash.data ?? EMPTY_ERC_DASHBOARD;
  const pillars = d.pillars;
  const checks = d.latest?.checks ?? [];
  const scoreText = (score: number, categories?: string[]) => {
    if (dash.isError) return "Unavailable";
    if (!d.latest) return "Not assessed";
    if (!checks.some((c) => c.score != null && (!categories || categories.includes(c.category)))) return "Unscored";
    return `${score}%`;
  };
  const issues = d.openIssues.length ? d.openIssues : (d.latest?.issues.filter((i) => i.status === "open") ?? []);

  return (
    <HQLayout
      title="Enterprise Readiness Assessment"
      subtitle="Read-only checks and missing acceptance evidence · Check scores are not completion percentages"
      auraModule="aura"
    >
      {dash.isError && <p role="alert" style={{ color: "var(--hq-danger)", marginBottom: "0.75rem" }}>Could not load readiness evidence: {errorMessage(dash.error)}. Status is unknown; no zero score or successful assessment is implied.</p>}
      {error && <p style={{ color: "var(--hq-danger)", marginBottom: "0.75rem" }}>{error}</p>}

      <div className="hq-panel" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel-body" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <button
            type="button"
            className="hq-btn hq-btn-primary"
            disabled={runMutation.isPending}
            onClick={() => runMutation.mutate()}
          >
            <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
            {runMutation.isPending ? "Running read-only assessment…" : "Run Read-only Assessment"}
          </button>
          <label style={{ fontSize: "0.82rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input type="checkbox" checked={deepQuality} onChange={(e) => setDeepQuality(e.target.checked)} />
            Deep quality (tsc on local host)
          </label>
          <span style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)" }}>
            Founder Mode required · no webhook changes, orders, payments or messages · saves assessment records
          </span>
          {d.latest && (
            <span style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)", marginLeft: "auto" }}>
              Last run {new Date(d.latest.completedAt).toLocaleString()} · host {d.latest.host}
            </span>
          )}
        </div>
      </div>

      {runMutation.isPending && <HqLoading label="Checking configuration and supported read-only connections…" />}

      <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
        <KpiCard
          label="Scored Checks"
          value={scoreText(d.overallReadiness)}
          meta={d.latest ? "Not a completion percentage" : "No assessment evidence yet"}
          icon={Activity}
          variant={d.certified ? "success" : d.overallReadiness >= 80 ? "gold" : "warning"}
        />
        <KpiCard label="Modules" value={scoreText(pillars.moduleHealth, ["module"])} icon={CheckCircle2} />
        <KpiCard label="Integrations" value={scoreText(pillars.integrationHealth, ["integration"])} icon={Plug} />
        <KpiCard label="Security" value={scoreText(pillars.securityHealth, ["security"])} icon={Shield} />
        <KpiCard label="Database" value={scoreText(pillars.databaseHealth, ["database"])} icon={Database} />
        <KpiCard
          label="Open Issues"
          value={dash.isError ? "Unknown" : d.latest ? issues.length : "Not assessed"}
          icon={AlertTriangle}
          variant={issues.length ? "warning" : "success"}
        />
      </div>

      {d.latest && !dash.isError && (
        <p style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
          Latest checklist: {checks.filter((c) => c.status === "fail").length} failed checks;
          {" "}{checks.filter((c) => c.status === "pending_manual").length} checks awaiting verification.
          Findings below are from this run only. Prior runs remain in assessment history.
        </p>
      )}

      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Health Pillars</h4>
            {(
              [
                ["Communications", pillars.communicationsHealth, ["communications"]],
                ["AI", pillars.aiHealth, ["ai"]],
                ["Deployment", pillars.deploymentHealth, ["deployment"]],
                ["Mobile", pillars.mobileReadiness, ["mobile"]],
                ["Performance", pillars.performance, ["performance", "quality"]],
              ] as const
            ).map(([label, score, categories]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.35rem" }}>
                <span>{label}</span>
                <strong>{scoreText(score, [...categories])}</strong>
              </div>
            ))}
            <p style={{ fontSize: "0.78rem", color: "var(--hq-muted-text)", marginTop: "0.75rem" }}>
              <Smartphone size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
              Mobile / full UI matrix remain Founder UAT until browser matrix is signed off.
            </p>
          </div>
        </div>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Certification Policy</h4>
            <p style={{ fontSize: "0.85rem" }}>No demo data · No simulated success</p>
            <p style={{ fontSize: "0.85rem" }}>Assessment does not perform transactions or repair connections</p>
            <p style={{ fontSize: "0.85rem" }}>Unverified flows remain open until their acceptance tests are recorded</p>
            <p style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
              Status:{" "}
              <StatusBadge status={dash.isError || !d.latest ? "pending_manual" : d.certified ? "certified" : "not_certified"} />
            </p>
            {d.latest?.speechSummary && (
              <p style={{ fontSize: "0.82rem", marginTop: "0.65rem", lineHeight: 1.45 }}>{d.latest.speechSummary}</p>
            )}
          </div>
        </div>
      </div>

      <div className="hq-panel" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel-body">
          <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Checklist Results</h4>
          {checks.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>
              No assessment yet. Run Read-only Assessment to collect supported connection/configuration evidence and list unverified flows.
            </p>
          ) : (
            <div style={{ maxHeight: 420, overflow: "auto" }}>
              {checks.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr auto",
                    gap: "0.5rem",
                    alignItems: "start",
                    padding: "0.45rem 0",
                    borderBottom: "1px solid var(--hq-border)",
                    fontSize: "0.82rem",
                  }}
                >
                  <StatusBadge status={c.status} />
                  <div>
                    <strong>{c.label}</strong>
                    <div style={{ color: "var(--hq-muted-text)" }}>{c.detail}</div>
                    {c.path && (
                      <Link to={c.path} style={{ fontSize: "0.75rem" }}>{c.path}</Link>
                    )}
                  </div>
                  <span style={{ color: "var(--hq-muted-text)" }}>{c.score == null ? "Unscored" : `${c.score}%`} · {c.latencyMs}ms</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="hq-panel">
        <div className="hq-panel-body">
          <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Outstanding Issues</h4>
          {issues.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>{d.latest ? "No open issues recorded in the latest run; this alone does not prove functional completion." : "No assessment yet; issues are unknown."}</p>
          ) : (
            issues.map((issue) => (
              <div key={issue.id} style={{ marginBottom: "0.85rem", paddingBottom: "0.75rem", borderBottom: "1px solid var(--hq-border)" }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <StatusBadge status={issue.severity} />
                  <strong style={{ fontSize: "0.88rem" }}>{issue.module}</strong>
                  <StatusBadge status={issue.status} />
                </div>
                <p style={{ fontSize: "0.82rem", margin: "0.35rem 0" }}>{issue.description}</p>
                <p style={{ fontSize: "0.78rem", color: "var(--hq-muted-text)", margin: "0.2rem 0" }}>
                  Root cause: {issue.rootCause}
                </p>
                <p style={{ fontSize: "0.78rem", margin: "0.2rem 0" }}>Fix: {issue.recommendedFix}</p>
                <p style={{ fontSize: "0.75rem", color: "var(--hq-muted-text)" }}>
                  Effort: {issue.estimatedEffort}
                  {issue.filesAffected?.length ? ` · Files: ${issue.filesAffected.join(", ")}` : ""}
                </p>
                <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
                  {(["in_progress", "resolved", "accepted_risk"] as ErcIssueStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      className="hq-btn hq-btn-ghost"
                      style={{ fontSize: "0.72rem" }}
                      disabled={issueMutation.isPending}
                      onClick={() => issueMutation.mutate({ id: issue.id, status: st })}
                    >
                      Mark {st.replace("_", " ")}
                    </button>
                  ))}
                  {issue.path && (
                    <Link to={issue.path} className="hq-btn hq-btn-ghost" style={{ fontSize: "0.72rem" }}>
                      Open module
                    </Link>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </HQLayout>
  );
};

export default EnterpriseReadinessPage;
