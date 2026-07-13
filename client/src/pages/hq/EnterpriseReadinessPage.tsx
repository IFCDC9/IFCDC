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
import { StatusBadge } from "../../components/hq/StatusBadge";
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
    queryFn: async () => {
      try {
        return await enterpriseReadinessApi.dashboard();
      } catch (err) {
        console.warn("[enterprise-readiness] load failed:", err);
        return EMPTY_ERC_DASHBOARD;
      }
    },
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
  const issues = d.openIssues.length ? d.openIssues : (d.latest?.issues.filter((i) => i.status === "open") ?? []);

  return (
    <HQLayout
      title="Enterprise Readiness Certification"
      subtitle="Live production validation — no demo data · Target 100% before new AURA capabilities"
      auraModule="aura"
    >
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
            {runMutation.isPending ? "Running live certification…" : "Run Full Certification"}
          </button>
          <label style={{ fontSize: "0.82rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input type="checkbox" checked={deepQuality} onChange={(e) => setDeepQuality(e.target.checked)} />
            Deep quality (tsc on local host)
          </label>
          <span style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)" }}>
            Founder Mode required · live Integrations Hub probes
          </span>
          {d.latest && (
            <span style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)", marginLeft: "auto" }}>
              Last run {new Date(d.latest.completedAt).toLocaleString()} · host {d.latest.host}
            </span>
          )}
        </div>
      </div>

      {runMutation.isPending && <HqLoading label="Probing modules and production integrations…" />}

      <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
        <KpiCard
          label="Enterprise Readiness"
          value={`${d.overallReadiness}%`}
          meta={d.certified ? "CERTIFIED" : `Target ${d.target}%`}
          icon={Activity}
          variant={d.certified ? "success" : d.overallReadiness >= 80 ? "gold" : "warning"}
        />
        <KpiCard label="Modules" value={`${pillars.moduleHealth}%`} icon={CheckCircle2} />
        <KpiCard label="Integrations" value={`${pillars.integrationHealth}%`} icon={Plug} />
        <KpiCard label="Security" value={`${pillars.securityHealth}%`} icon={Shield} />
        <KpiCard label="Database" value={`${pillars.databaseHealth}%`} icon={Database} />
        <KpiCard
          label="Open Issues"
          value={issues.length}
          icon={AlertTriangle}
          variant={issues.length ? "warning" : "success"}
        />
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Health Pillars</h4>
            {(
              [
                ["Communications", pillars.communicationsHealth],
                ["AI", pillars.aiHealth],
                ["Deployment", pillars.deploymentHealth],
                ["Mobile", pillars.mobileReadiness],
                ["Performance", pillars.performance],
              ] as const
            ).map(([label, score]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.35rem" }}>
                <span>{label}</span>
                <strong>{score}%</strong>
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
            <p style={{ fontSize: "0.85rem" }}>Live integration transactions required</p>
            <p style={{ fontSize: "0.85rem" }}>Certification only at {d.target}% with all checks pass</p>
            <p style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
              Status:{" "}
              <StatusBadge status={d.certified ? "certified" : "not_certified"} />
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
              No run yet. Click Run Full Certification to probe live HQ modules and integrations.
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
                  <span style={{ color: "var(--hq-muted-text)" }}>{c.score}% · {c.latencyMs}ms</span>
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
            <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>No open issues on the latest run.</p>
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
