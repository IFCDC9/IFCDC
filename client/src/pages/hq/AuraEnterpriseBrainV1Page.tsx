/**
 * AURA Enterprise Brain v1 — Module 1: Executive Command Center
 * Founder-only, read-only. Answers: attention, changes, health, next actions.
 */
import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Brain, CheckCircle2, Clock, Mail, Monitor,
  RefreshCw, Shield, Target,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { hqApi } from "../../api/hqApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { HqApiError } from "../../api/hqApiFetch";

function errorMessage(err: unknown): string {
  if (err instanceof HqApiError) {
    if (err.status === 403) return "Founder access required for AURA Enterprise Brain v1.";
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Request failed.";
}

function severityVariant(severity: string): "danger" | "warning" | "muted" | "success" {
  if (severity === "critical" || severity === "high") return "danger";
  if (severity === "watch") return "warning";
  if (severity === "info") return "muted";
  return "muted";
}

const AuraEnterpriseBrainV1Page: React.FC = () => {
  const cc = useQuery({
    queryKey: ["aura-brain-v1-command-center"],
    queryFn: hqApi.auraBrainV1CommandCenter,
    staleTime: 30_000,
    refetchInterval: 90_000,
    retry: 1,
  });

  const d = cc.data;

  if (cc.isPending && !d) {
    return (
      <HQLayout
        title="AURA Enterprise Brain v1"
        subtitle="Executive Command Center — Founder read-only"
        auraModule="aura"
      >
        <HqLoading message="Loading Executive Command Center…" />
      </HQLayout>
    );
  }

  return (
    <HQLayout
      title="AURA Enterprise Brain v1"
      subtitle="Executive Command Center — what needs attention, what changed, what to do next"
      auraModule="aura"
    >
      {cc.isError && (
        <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "1rem" }} role="status">
          <AlertTriangle size={16} />
          <div>
            <strong>Command Center unavailable</strong>
            <span> {errorMessage(cc.error)}</span>
            <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" style={{ marginLeft: "0.5rem" }} onClick={() => void cc.refetch()}>
              Retry
            </button>
          </div>
        </div>
      )}

      {d?.warning && (
        <p style={{ color: "var(--hq-warning)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>{d.warning}</p>
      )}

      <div className="hq-analytics-toolbar" style={{ marginBottom: "1rem" }}>
        <StatusBadge label={d?.mode === "read_only" ? "Read-only" : "—"} variant="muted" />
        <span className="hq-muted-text" style={{ fontSize: "0.8rem" }}>
          Last login: {d?.lastLoginAt ? new Date(d.lastLoginAt).toLocaleString() : "—"}
        </span>
        <span className="hq-muted-text" style={{ fontSize: "0.8rem" }}>
          Generated: {d?.generatedAt ? new Date(d.generatedAt).toLocaleString() : "—"}
        </span>
        <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => void cc.refetch()} disabled={cc.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
        <Link to="/hq/email-readiness" className="hq-btn hq-btn-ghost hq-btn-sm">Email Readiness</Link>
        <Link to="/hq/monitoring" className="hq-btn hq-btn-ghost hq-btn-sm">Monitoring</Link>
      </div>

      <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Needs Attention" value={d?.summary.attentionCount ?? "—"} icon={AlertTriangle} variant={(d?.summary.attentionCount ?? 0) > 0 ? "warning" : "success"} />
        <KpiCard label="Changed Since Login" value={d?.summary.changeCount ?? "—"} icon={Clock} />
        <KpiCard label="Systems Healthy" value={d?.summary.healthySystemCount ?? "—"} icon={Shield} variant="success" />
        <KpiCard label="Action Required" value={d?.summary.actionSystemCount ?? "—"} icon={Activity} variant={(d?.summary.actionSystemCount ?? 0) > 0 ? "danger" : "success"} />
        <KpiCard label="Active Projects" value={d?.summary.activeProjectCount ?? "—"} icon={Target} />
        <KpiCard label="Pending Deploys" value={d?.summary.pendingDeployCount ?? "—"} icon={Monitor} variant={(d?.summary.pendingDeployCount ?? 0) > 0 ? "warning" : "muted"} />
        <KpiCard label="Email Issues" value={d?.summary.failedEmailCount ?? "—"} icon={Mail} variant={(d?.summary.failedEmailCount ?? 0) > 0 ? "danger" : "success"} />
        <KpiCard label="Command Health" value={d?.summary.commandHealthOverall != null ? `${d.summary.commandHealthOverall}` : "—"} icon={Brain} variant="gold" />
      </div>

      <div className="hq-panel" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel-body">
          <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>What should I do next?</h4>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.9rem", lineHeight: 1.6 }}>
            {(d?.answers.doNext ?? ["Loading…"]).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
          <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.78rem" }}>
            Email: {d?.summary.emailConfigured ? `configured · ${d.summary.emailFrom || "from set"}` : "not configured"} — no secrets shown.
          </p>
        </div>
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>What needs my attention?</h4>
            {(d?.answers.needsAttention ?? []).slice(0, 10).map((item) => (
              <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", padding: "0.45rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.85rem" }}>
                <div>
                  <strong>{item.title}</strong>
                  <div style={{ opacity: 0.85 }}>{item.detail}</div>
                  {item.path && (
                    <Link to={item.path} style={{ fontSize: "0.75rem" }}>{item.path}</Link>
                  )}
                </div>
                <StatusBadge label={item.severity} variant={severityVariant(item.severity)} />
              </div>
            ))}
            {!d?.answers.needsAttention?.length && (
              <p className="hq-muted-text"><CheckCircle2 size={14} style={{ verticalAlign: "middle" }} /> Nothing urgent.</p>
            )}
          </div>
        </div>

        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>What changed since last login?</h4>
            {(d?.answers.changedSinceLastLogin ?? []).slice(0, 10).map((item) => (
              <div key={item.id} style={{ padding: "0.45rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.85rem" }}>
                <strong>{item.title}</strong>
                <div style={{ opacity: 0.85 }}>{item.detail}</div>
              </div>
            ))}
            {!d?.answers.changedSinceLastLogin?.length && (
              <p className="hq-muted-text">No recorded changes since last login (or login history unavailable).</p>
            )}
          </div>
        </div>

        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Systems requiring action</h4>
            {(d?.answers.systemsRequireAction ?? []).slice(0, 12).map((row) => (
              <div key={row.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", padding: "0.35rem 0", fontSize: "0.85rem", borderBottom: "1px solid var(--hq-border-subtle)" }}>
                <div>
                  <strong>{row.label}</strong>
                  <div style={{ opacity: 0.85 }}>{row.detail}</div>
                </div>
                <StatusBadge label="action" variant="danger" />
              </div>
            ))}
            {!d?.answers.systemsRequireAction?.length && (
              <p className="hq-muted-text">All monitored systems healthy or watch-only.</p>
            )}
            <h4 style={{ color: "var(--hq-gold)", margin: "1rem 0 0.5rem" }}>Healthy systems ({d?.summary.healthySystemCount ?? 0})</h4>
            <p className="hq-muted-text" style={{ fontSize: "0.8rem" }}>
              {(d?.answers.systemsHealthy ?? []).slice(0, 8).map((s) => s.label).join(" · ") || "—"}
              {(d?.answers.systemsHealthy?.length ?? 0) > 8 ? " · …" : ""}
            </p>
          </div>
        </div>

        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Active projects & pending deployments</h4>
            {(d?.answers.activeProjects ?? []).map((p) => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", padding: "0.35rem 0", fontSize: "0.85rem", borderBottom: "1px solid var(--hq-border-subtle)" }}>
                <div>
                  <strong>{p.name}</strong>
                  <div style={{ opacity: 0.85 }}>{p.detail}</div>
                </div>
                <StatusBadge
                  label={p.status}
                  variant={p.healthy === false ? "danger" : p.status === "production" || p.status === "locked" ? "success" : "warning"}
                />
              </div>
            ))}
            {(d?.answers.deploymentsPending?.length ?? 0) > 0 && (
              <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>
                Pending production: {d!.answers.deploymentsPending.map((p) => p.name).join(", ")}
              </p>
            )}
          </div>
        </div>
      </div>

      {(d?.answers.emailsFailed?.length ?? 0) > 0 && (
        <div className="hq-panel" style={{ marginBottom: "1rem" }}>
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>What emails failed?</h4>
            {d!.answers.emailsFailed.map((item) => (
              <div key={item.id} style={{ padding: "0.4rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.85rem" }}>
                <strong>{item.title}</strong>
                <div style={{ opacity: 0.85 }}>{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="hq-panel">
        <div className="hq-panel-body">
          <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Brain v1 module roadmap</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {(d?.moduleRoadmap ?? []).map((m) => (
              <StatusBadge
                key={m.id}
                label={`${m.id}. ${m.name}`}
                variant={m.status === "live" ? "success" : "muted"}
              />
            ))}
          </div>
          <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.78rem" }}>
            Modules 2–8 ship next in separate commits. Action Center mutations will require explicit confirmation. Every AURA Brain v1 read is logged.
          </p>
        </div>
      </div>
    </HQLayout>
  );
};

export default AuraEnterpriseBrainV1Page;
