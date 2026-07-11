import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Bell, Brain, Lightbulb, Network, Search, Shield, Target, Wallet,
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
  "Show Mission Control",
  "Run autonomous workflow scan",
  "Orchestrate grant opportunity workflow",
  "Show knowledge graph",
  "What approvals are still outstanding?",
  "What happens if this grant is not awarded?",
  "Prepare monthly board packet",
  "Prepare compliance calendar",
  "Prepare technology report",
];

const EnterpriseOsMissionControlPage: React.FC = () => {
  const [q, setQ] = useState("Show Mission Control");
  const [out, setOut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mc = useQuery({
    queryKey: ["aura-os-mission-control"],
    queryFn: hqApi.auraOsMissionControl,
    staleTime: 45_000,
  });

  const graph = useQuery({
    queryKey: ["aura-os-graph"],
    queryFn: hqApi.auraOsKnowledgeGraph,
    staleTime: 120_000,
  });

  const runMutation = useMutation({
    mutationFn: (request: string) => hqApi.auraOsRun(request),
    onSuccess: (data) => {
      setError(null);
      setOut(String(data.unifiedBriefing || data.speechSummary || JSON.stringify(data)));
      mc.refetch();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const d = mc.data;
  const alerts = d?.liveAlerts ?? [];
  const prepared = d?.preparedActions ?? [];
  const edges = graph.data?.edges ?? [];
  const nodes = graph.data?.nodes ?? [];

  return (
    <HQLayout
      title="Enterprise OS 4.0"
      subtitle="Mission Control — AURA coordinates IFCDC; Founder retains final authority on high-impact actions"
      auraModule="aura"
    >
      {error && <p style={{ color: "var(--hq-danger)", marginBottom: "0.75rem" }}>{error}</p>}
      {mc.isError && (
        <p style={{ color: "var(--hq-danger)", marginBottom: "0.75rem" }}>
          {errorMessage(mc.error)}. Founder Mode may be required.
        </p>
      )}

      <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
        <KpiCard label="Enterprise Health" value={d?.enterpriseHealthScore ?? "—"} meta={d?.enterpriseGrade || undefined} icon={Activity} variant="gold" />
        <KpiCard label="Org Health" value={d?.organizationHealth != null ? `${d.organizationHealth}%` : "—"} icon={Target} />
        <KpiCard label="Pipeline" value={d?.fundingPipeline?.pipelineValue != null ? formatCurrency(d.fundingPipeline.pipelineValue) : "—"} icon={Wallet} />
        <KpiCard label="Software" value={d?.softwareHealth?.score ?? "—"} meta={d?.softwareHealth?.label || undefined} icon={Shield} />
        <KpiCard label="Live Alerts" value={alerts.length} icon={Bell} variant={alerts.length ? "warning" : "success"} />
        <KpiCard label="Approvals" value={d?.pendingApprovals ?? "—"} icon={AlertTriangle} variant={(d?.pendingApprovals ?? 0) >= 3 ? "warning" : "success"} />
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Organization Snapshot</h4>
            <p style={{ fontSize: "0.85rem" }}>Grants: {d?.grantStatus || "—"}</p>
            <p style={{ fontSize: "0.85rem" }}>HR: {d?.hrStatus || "—"}</p>
            <p style={{ fontSize: "0.85rem" }}>Operations: {d?.operations || "—"}</p>
            <p style={{ fontSize: "0.85rem" }}>
              Finance: cash {d?.financialHealth?.cashFlow != null ? formatCurrency(d.financialHealth.cashFlow) : "—"} ·
              health {d?.financialHealth?.financialHealthScore ?? "—"}
            </p>
            <p style={{ fontSize: "0.85rem" }}>
              Compliance: overdue {d?.compliance?.overdue ?? "—"} · due 14d {d?.compliance?.dueNext14Days ?? "—"}
            </p>
            <p style={{ fontSize: "0.85rem" }}>Security: {d?.security || "—"}</p>
          </div>
        </div>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Founder Priorities</h4>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.88rem", lineHeight: 1.6 }}>
              {(d?.founderPriorities ?? ["Loading…"]).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <h4 style={{ color: "var(--hq-gold)", margin: "0.85rem 0 0.4rem" }}>Risks & Opportunities</h4>
            <div style={{ fontSize: "0.82rem" }}>
              {(d?.activeRisks ?? []).slice(0, 3).map((r) => (
                <div key={r.id} style={{ marginBottom: "0.35rem" }}>Risk: {r.title}</div>
              ))}
              {(d?.opportunities ?? []).slice(0, 3).map((o) => (
                <div key={o.id} style={{ marginBottom: "0.35rem" }}>Opportunity: {o.title}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Live Alerts</h4>
            <div style={{ maxHeight: "280px", overflow: "auto" }}>
              {alerts.slice(0, 10).map((a) => (
                <div key={a.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.84rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                    <strong>{a.title}</strong>
                    <StatusBadge label={a.severity} variant={a.severity === "critical" || a.severity === "high" ? "danger" : "warning"} />
                  </div>
                  <div style={{ opacity: 0.85 }}>{a.explanation}</div>
                </div>
              ))}
              {!alerts.length && <p className="hq-muted-text">No live alerts.</p>}
            </div>
          </div>
        </div>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Autonomous Workflows (Prepared)</h4>
            <div style={{ maxHeight: "280px", overflow: "auto" }}>
              {prepared.slice(0, 10).map((a) => (
                <div key={a.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.84rem" }}>
                  <strong>{a.title}</strong>
                  <div style={{ opacity: 0.85 }}>{a.explanation}</div>
                  <div style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}>
                    {a.preparedWork[0]}
                    {a.founderApprovalRequired ? " · Founder approval required" : ""}
                  </div>
                </div>
              ))}
              {!prepared.length && <p className="hq-muted-text">Scan loading…</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="hq-panel" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel-body">
          <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Network size={18} /> Knowledge Graph
          </h4>
          <p style={{ fontSize: "0.82rem", opacity: 0.85, marginBottom: "0.5rem" }}>
            {nodes.length} entities · {edges.length} relationships
          </p>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.82rem", maxHeight: "200px", overflow: "auto" }}>
            {edges.slice(0, 12).map((e) => {
              const from = nodes.find((n) => n.id === e.from)?.label || e.from;
              const to = nodes.find((n) => n.id === e.to)?.label || e.to;
              return <li key={e.id}>{from} —[{e.relation}]→ {to}</li>;
            })}
            {!edges.length && <li className="hq-muted-text">Graph loading…</li>}
          </ul>
        </div>
      </div>

      <div className="hq-panel">
        <div className="hq-panel-body">
          <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Brain size={18} /> Enterprise OS Command
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.75rem" }}>
            {QUICK.map((item) => (
              <button
                key={item}
                type="button"
                className="hq-btn hq-btn-ghost hq-btn-sm"
                onClick={() => {
                  setQ(item);
                  runMutation.mutate(item);
                }}
              >
                {item.length > 40 ? `${item.slice(0, 38)}…` : item}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              className="hq-input"
              style={{ flex: 1, minWidth: "220px" }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Mission Control, search, orchestrate, automate…"
            />
            <button
              type="button"
              className="hq-btn hq-btn-primary"
              disabled={runMutation.isPending || q.trim().length < 3}
              onClick={() => runMutation.mutate(q.trim())}
            >
              <Lightbulb size={16} /> Run
            </button>
            <button type="button" className="hq-btn hq-btn-secondary" onClick={() => { mc.refetch(); graph.refetch(); }}>
              <Search size={16} /> Refresh
            </button>
          </div>
          {runMutation.isPending && <p className="hq-muted-text" style={{ marginTop: "0.75rem" }}>Enterprise OS coordinating…</p>}
          {out && (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: "0.82rem",
                lineHeight: 1.6,
                maxHeight: "min(55dvh, 520px)",
                overflow: "auto",
                marginTop: "0.75rem",
              }}
            >
              {out}
            </pre>
          )}
          <p style={{ fontSize: "0.75rem", opacity: 0.7, marginTop: "0.75rem" }}>
            OS {d?.osVersion || "4.0"} · Brain {d?.brainVersion || "3.0"}. AURA prepares and coordinates —
            high-impact actions require Founder approval.
          </p>
        </div>
      </div>
    </HQLayout>
  );
};

export default EnterpriseOsMissionControlPage;
