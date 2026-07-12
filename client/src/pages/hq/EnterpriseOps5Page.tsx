import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, CheckCircle2, GitBranch, Lightbulb, Shield, Target, Wallet,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { hqApi } from "../../api/hqApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqApiError } from "../../api/hqApiFetch";
import { formatCurrency } from "../../utils/safeFormat";

function errorMessage(err: unknown): string {
  if (err instanceof HqApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Request failed.";
}

const QUICK = [
  "Show Enterprise Operations Command Center",
  "Prepare next month's board meeting",
  "Prepare weekly executive report",
  "Prepare monthly financial summary",
  "Prepare technology health report",
  "Show continuous improvement",
  "Coordinate departments for grant closeout",
];

const EnterpriseOps5Page: React.FC = () => {
  const qc = useQueryClient();
  const [q, setQ] = useState("Prepare next month's board meeting");
  const [out, setOut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cc = useQuery({
    queryKey: ["aura-os5-command-center"],
    queryFn: hqApi.auraOs5CommandCenter,
    staleTime: 45_000,
  });

  const runMutation = useMutation({
    mutationFn: (request: string) => hqApi.auraOs5Run(request),
    onSuccess: (data) => {
      setError(null);
      setOut(data.speechSummary);
      qc.invalidateQueries({ queryKey: ["aura-os5-command-center"] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => hqApi.auraOs5ApproveOpsRun(id),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["aura-os5-command-center"] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const cadenceMutation = useMutation({
    mutationFn: (id: string) => hqApi.auraOs5PrepareCadence(id),
    onSuccess: (data) => {
      setError(null);
      setOut(data.package?.speechSummary || (data.ok ? "Cadence prepared — Founder approval required before external distribution." : data.error || "Failed"));
      qc.invalidateQueries({ queryKey: ["aura-os5-command-center"] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const d = cc.data;
  const alerts = d?.criticalAlerts ?? [];
  const runs = d?.opsRuns ?? [];
  const improvements = d?.continuousImprovement ?? [];

  return (
    <HQLayout
      title="Enterprise Operations 5.0"
      subtitle="AURA coordinates departments, projects, and cadences — Founder approval for high-impact and external distribution"
      auraModule="aura"
    >
      {error && <p style={{ color: "var(--hq-danger)", marginBottom: "0.75rem" }}>{error}</p>}
      {cc.isError && (
        <p style={{ color: "var(--hq-danger)", marginBottom: "0.75rem" }}>
          {errorMessage(cc.error)}. Founder Mode may be required for some actions.
        </p>
      )}

      <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
        <KpiCard
          label="Org Health"
          value={d?.organizationHealth != null ? `${d.organizationHealth}%` : "—"}
          meta={d?.enterpriseGrade || undefined}
          icon={Activity}
          variant="gold"
        />
        <KpiCard
          label="Goals at Risk"
          value={d?.strategicGoals?.atRisk ?? "—"}
          meta={`${d?.strategicGoals?.total ?? 0} total`}
          icon={Target}
        />
        <KpiCard
          label="Pipeline"
          value={d?.fundingPipeline?.pipelineValue != null ? formatCurrency(d.fundingPipeline.pipelineValue) : "—"}
          icon={Wallet}
        />
        <KpiCard
          label="Technology"
          value={d?.technologyStatus?.score ?? "—"}
          meta={d?.technologyStatus?.label || undefined}
          icon={Shield}
        />
        <KpiCard
          label="Critical Alerts"
          value={alerts.length}
          icon={AlertTriangle}
          variant={alerts.length ? "warning" : "success"}
        />
        <KpiCard
          label="Founder Approvals"
          value={d?.founderApprovalsWaiting ?? "—"}
          icon={CheckCircle2}
          variant={(d?.founderApprovalsWaiting ?? 0) >= 3 ? "warning" : "success"}
        />
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Command Center Snapshot</h4>
            <p style={{ fontSize: "0.85rem" }}>HR: {d?.hrStatus || "—"}</p>
            <p style={{ fontSize: "0.85rem" }}>
              Finance: score {d?.financialHealth?.financialHealthScore ?? "—"} · cash{" "}
              {d?.financialHealth?.cashFlow != null ? formatCurrency(d.financialHealth.cashFlow) : "—"}
            </p>
            <p style={{ fontSize: "0.85rem" }}>
              Compliance: overdue {d?.compliance?.overdue ?? "—"} · due 14d {d?.compliance?.dueNext14Days ?? "—"}
            </p>
            <p style={{ fontSize: "0.85rem" }}>
              Active projects: {d?.activeProjects?.count ?? "—"} · Deploy aligned:{" "}
              {d?.technologyStatus?.deployAligned == null ? "—" : d.technologyStatus.deployAligned ? "yes" : "no"}
            </p>
            <p style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)", marginTop: "0.5rem" }}>
              External distribution and high-impact actions require Founder approval.
            </p>
          </div>
        </div>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Strategic Goals</h4>
            {(d?.strategicGoals?.items ?? []).length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>No goals loaded.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem", lineHeight: 1.55 }}>
                {(d?.strategicGoals?.items ?? []).map((g) => (
                  <li key={g.title}>
                    {g.title} — {g.progressPercent}% ({g.status || "—"})
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="hq-panel" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel-body">
          <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
            <GitBranch size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Enterprise Command
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.65rem" }}>
            {QUICK.map((cmd) => (
              <button
                key={cmd}
                type="button"
                className="hq-btn hq-btn-ghost"
                style={{ fontSize: "0.78rem" }}
                onClick={() => {
                  setQ(cmd);
                  runMutation.mutate(cmd);
                }}
              >
                {cmd}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              className="hq-input"
              style={{ flex: 1, minWidth: 220 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && q.trim()) runMutation.mutate(q.trim());
              }}
              placeholder="e.g. Prepare next month's board meeting"
            />
            <button
              type="button"
              className="hq-btn hq-btn-primary"
              disabled={runMutation.isPending || !q.trim()}
              onClick={() => runMutation.mutate(q.trim())}
            >
              {runMutation.isPending ? "Running…" : "Run"}
            </button>
          </div>
          {out && (
            <p style={{ marginTop: "0.75rem", fontSize: "0.9rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{out}</p>
          )}
        </div>
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Ops Runs</h4>
            {runs.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>No ops runs yet. Create one with a board or coordination command.</p>
            ) : (
              runs.map((run) => (
                <div key={run.id} style={{ marginBottom: "0.85rem", paddingBottom: "0.65rem", borderBottom: "1px solid var(--hq-border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "center" }}>
                    <strong style={{ fontSize: "0.88rem" }}>{run.title}</strong>
                    <StatusBadge status={run.status} />
                  </div>
                  <p style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)", margin: "0.35rem 0" }}>{run.executiveSummary}</p>
                  <div style={{ fontSize: "0.75rem", color: "var(--hq-muted-text)" }}>
                    {(run.steps || []).slice(0, 6).map((s) => (
                      <span key={s.id} style={{ marginRight: "0.65rem" }}>
                        {s.department}: {s.title}
                      </span>
                    ))}
                  </div>
                  {run.status === "awaiting_founder" && (
                    <button
                      type="button"
                      className="hq-btn hq-btn-primary"
                      style={{ marginTop: "0.5rem", fontSize: "0.78rem" }}
                      disabled={approveMutation.isPending}
                      onClick={() => approveMutation.mutate(run.id)}
                    >
                      Founder Approve
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Cadences</h4>
            <p style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)", marginBottom: "0.65rem" }}>
              Prepare packages for Founder review. External send stays gated.
            </p>
            {(d?.cadences ?? []).map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.55rem", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{c.label}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--hq-muted-text)" }}>{c.schedule}</div>
                </div>
                <button
                  type="button"
                  className="hq-btn hq-btn-ghost"
                  style={{ fontSize: "0.75rem", flexShrink: 0 }}
                  disabled={cadenceMutation.isPending}
                  onClick={() => cadenceMutation.mutate(c.id)}
                >
                  Prepare
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="hq-panel" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel-body">
          <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
            <Lightbulb size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Continuous Improvement
          </h4>
          {improvements.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>No recommendations right now.</p>
          ) : (
            improvements.map((item) => (
              <div key={item.id} style={{ marginBottom: "0.7rem" }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <StatusBadge status={item.priority} />
                  <strong style={{ fontSize: "0.88rem" }}>{item.title}</strong>
                </div>
                <p style={{ fontSize: "0.8rem", margin: "0.25rem 0" }}>{item.evidence}</p>
                <p style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)", margin: 0 }}>{item.recommendation}</p>
                <Link to={item.path} style={{ fontSize: "0.78rem" }}>{item.path}</Link>
              </div>
            ))
          )}
        </div>
      </div>

      {(d?.deepLinks?.length ?? 0) > 0 && (
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Department Systems</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {d!.deepLinks.map((link) => (
                <Link key={link.path} to={link.path} className="hq-btn hq-btn-ghost" style={{ fontSize: "0.78rem" }}>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </HQLayout>
  );
};

export default EnterpriseOps5Page;
