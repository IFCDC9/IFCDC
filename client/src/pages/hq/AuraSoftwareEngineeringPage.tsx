import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, CheckCircle2, Code2, RefreshCw, Shield,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { softwareEngineeringApi, type SeDashboard } from "../../api/softwareEngineeringApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { HqWidgetErrorBoundary } from "../../components/hq/HqErrorBoundary";

const EMPTY: SeDashboard = {
  generatedAt: new Date(0).toISOString(),
  github: null,
  index: { totalFiles: 0, workspaceConfigured: false, githubConfigured: false, repos: [] },
  workspaceConfigured: false,
  apps: [],
  openDiagnoses: [],
  pendingApprovals: [],
  recommendedPriorities: [],
  securityWarnings: [],
};

function healthVariant(healthy: boolean | null): "success" | "warning" | "danger" | "muted" {
  if (healthy === true) return "success";
  if (healthy === false) return "danger";
  return "muted";
}

const AuraSoftwareEngineeringPage: React.FC = () => {
  const qc = useQueryClient();
  const [command, setCommand] = useState("");
  const [commandReply, setCommandReply] = useState<string | null>(null);

  const dash = useQuery({
    queryKey: ["aura-se-dashboard"],
    queryFn: async () => {
      try {
        return await softwareEngineeringApi.dashboard();
      } catch (err) {
        console.warn("[software-engineering] dashboard failed:", err);
        return EMPTY;
      }
    },
    placeholderData: EMPTY,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 0,
  });

  const refreshIndex = useMutation({
    mutationFn: () => softwareEngineeringApi.refreshIndex(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["aura-se-dashboard"] }),
  });

  const runCommand = useMutation({
    mutationFn: (c: string) => softwareEngineeringApi.command(c),
    onSuccess: (res) => {
      setCommandReply(res.reply);
      void qc.invalidateQueries({ queryKey: ["aura-se-dashboard"] });
    },
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      softwareEngineeringApi.decideApproval(id, decision),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["aura-se-dashboard"] }),
  });

  const data = dash.data ?? EMPTY;
  const unhealthy = data.apps.filter((a) => a.healthy === false).length;

  return (
    <HQLayout
      title="AURA Software Engineering"
      subtitle="Controlled AI software engineering — diagnose, branch, test, Founder-approve"
      auraModule="software"
      auraActions={["se_portfolio_status", "se_diagnose", "se_compare_deploy", "ask"]}
    >
      <div className="hq-people-toolbar" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <StatusBadge
          label={`Deploy ${data.github?.deploymentStatus ?? "unknown"}`}
          variant={data.github?.deploymentStatus === "aligned" ? "success" : "warning"}
        />
        <StatusBadge
          label={data.workspaceConfigured ? "Workspace ready" : "Workspace off-host"}
          variant={data.workspaceConfigured ? "success" : "muted"}
        />
        <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled={dash.isFetching} onClick={() => void dash.refetch()}>
          <RefreshCw size={14} className={dash.isFetching ? "hq-spin" : ""} /> Refresh
        </button>
        <button
          type="button"
          className="hq-btn hq-btn-sm hq-btn-secondary"
          disabled={refreshIndex.isPending}
          onClick={() => refreshIndex.mutate()}
        >
          <Code2 size={14} /> Refresh code index
        </button>
      </div>

      {dash.isLoading ? <HqLoading label="Loading software engineering…" /> : null}

      <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Apps monitored" value={String(data.apps.length)} icon={Activity} />
        <KpiCard label="Unhealthy" value={String(unhealthy)} icon={AlertTriangle} />
        <KpiCard label="Index files" value={String(data.index.totalFiles)} icon={Code2} />
        <KpiCard label="Approvals waiting" value={String(data.pendingApprovals.length)} icon={Shield} />
      </div>

      {(data.securityWarnings?.length ?? 0) > 0 && (
        <HqPanel title="Security / host notices" style={{ marginBottom: "1rem" }}>
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {data.securityWarnings!.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </HqPanel>
      )}

      <div className="hq-grid-2" style={{ gap: "1rem", marginBottom: "1rem" }}>
        <HqWidgetErrorBoundary label="Portfolio">
          <HqPanel title="Application portfolio">
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {data.apps.map((app) => (
                <div key={app.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
                  <div>
                    <strong>{app.name}</strong>
                    <div className="hq-muted" style={{ fontSize: "0.85rem" }}>{app.path}</div>
                  </div>
                  <StatusBadge label={app.healthy === true ? "healthy" : app.healthy === false ? "down" : "unknown"} variant={healthVariant(app.healthy)} />
                </div>
              ))}
              {!data.apps.length && <p className="hq-muted">No portfolio data yet.</p>}
            </div>
          </HqPanel>
        </HqWidgetErrorBoundary>

        <HqWidgetErrorBoundary label="Alignment">
          <HqPanel title="GitHub ↔ Render">
            <p style={{ marginTop: 0 }}>
              <strong>{data.github?.repository ?? "—"}</strong> @ {data.github?.branch ?? "main"}
            </p>
            <p className="hq-muted" style={{ fontSize: "0.9rem" }}>
              GitHub: {data.github?.latestCommit ?? "—"} · Live: {data.github?.liveCommit ?? "—"}
            </p>
            <p>{data.github?.message}</p>
            <p className="hq-muted" style={{ fontSize: "0.85rem" }}>
              Production deploy/restart/rollback always require Founder approval — AURA never auto-deploys.
            </p>
          </HqPanel>
        </HqWidgetErrorBoundary>
      </div>

      <div className="hq-grid-2" style={{ gap: "1rem", marginBottom: "1rem" }}>
        <HqPanel title="Recommended priorities">
          {(data.recommendedPriorities || []).length === 0 ? (
            <p className="hq-muted">No urgent engineering priorities detected.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
              {data.recommendedPriorities.map((p) => (
                <li key={p.title} style={{ marginBottom: "0.4rem" }}>
                  <StatusBadge label={p.priority} variant={p.priority === "high" ? "danger" : "warning"} />{" "}
                  <strong>{p.title}</strong> — {p.detail}
                </li>
              ))}
            </ul>
          )}
        </HqPanel>

        <HqPanel title="Founder approvals">
          {data.pendingApprovals.length === 0 ? (
            <p className="hq-muted">No pending approvals.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {data.pendingApprovals.map((a) => {
                const id = String(a.id);
                return (
                  <div key={id} style={{ borderTop: "1px solid var(--hq-border, #333)", paddingTop: "0.5rem" }}>
                    <div>
                      <strong>{String(a.action)}</strong> · {String(a.repository)}@{String(a.branch)}
                    </div>
                    <div className="hq-muted" style={{ fontSize: "0.85rem" }}>{String(a.risk_summary || "")}</div>
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
                      <button
                        type="button"
                        className="hq-btn hq-btn-sm hq-btn-primary"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id, decision: "approve" })}
                      >
                        <CheckCircle2 size={14} /> Approve
                      </button>
                      <button
                        type="button"
                        className="hq-btn hq-btn-sm hq-btn-ghost"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id, decision: "reject" })}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </HqPanel>
      </div>

      <HqPanel title="Open diagnoses" style={{ marginBottom: "1rem" }}>
        {data.openDiagnoses.length === 0 ? (
          <p className="hq-muted">No open diagnoses. Ask AURA to check a module or paste an error below.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {data.openDiagnoses.map((d) => (
              <li key={String(d.id)} style={{ marginBottom: "0.35rem" }}>
                <StatusBadge label={String(d.severity || "medium")} variant="warning" />{" "}
                <strong>{String(d.title)}</strong> — {String(d.root_cause || "").slice(0, 160)}
              </li>
            ))}
          </ul>
        )}
      </HqPanel>

      <HqPanel title="Founder command">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!command.trim()) return;
            runCommand.mutate(command.trim());
          }}
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
        >
          <input
            className="hq-input"
            style={{ flex: 1, minWidth: 240 }}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="e.g. Check Software Division health and compare GitHub with Render"
          />
          <button type="submit" className="hq-btn hq-btn-primary" disabled={runCommand.isPending}>
            Run
          </button>
        </form>
        {commandReply && (
          <p style={{ marginTop: "0.75rem", whiteSpace: "pre-wrap" }}>{commandReply}</p>
        )}
      </HqPanel>
    </HQLayout>
  );
};

export default AuraSoftwareEngineeringPage;
