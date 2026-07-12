import React from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, Plug, ServerCrash, Timer, Wifi } from "lucide-react";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import type { IntegrationHealthDashboard } from "../../api/integrationsApi";

function scoreVariant(score: number): "success" | "warning" | "danger" | "muted" {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  if (score > 0) return "danger";
  return "muted";
}

export const IntegrationsHealthPanel: React.FC<{
  health: IntegrationHealthDashboard | null;
  loading?: boolean;
}> = ({ health, loading }) => {
  if (!health && loading) {
    return (
      <HqPanel title="Integration Health Dashboard" subtitle="Loading live connectivity…">
        <p className="hq-muted-text">Probing connectors and platform systems…</p>
      </HqPanel>
    );
  }
  if (!health) return null;

  return (
    <div className="hq-fade-in" style={{ marginBottom: "1.25rem" }}>
      <div className="hq-kpi-grid" style={{ marginBottom: "0.85rem" }}>
        <KpiCard
          label="Integration Health"
          value={`${health.overallHealthScore}/100`}
          icon={Activity}
          variant={scoreVariant(health.overallHealthScore)}
          meta={health.overallLabel}
        />
        <KpiCard label="Connected" value={health.connectedCount} icon={Wifi} variant="success" meta={`of ${health.totalServices}`} />
        <KpiCard label="Warning" value={health.warningCount} icon={AlertTriangle} variant={health.warningCount ? "warning" : "muted"} />
        <KpiCard label="Offline" value={health.offlineCount} icon={ServerCrash} variant={health.offlineCount ? "danger" : "muted"} />
        <KpiCard
          label="Avg API Latency"
          value={health.avgLatencyMs != null ? `${health.avgLatencyMs}ms` : "—"}
          icon={Timer}
          meta="Live probe average"
        />
        <KpiCard
          label="Failed Requests"
          value={health.failedRequests}
          icon={Plug}
          variant={health.failedRequests > 0 ? "warning" : "muted"}
          meta={`Uptime ${health.uptimeLabel}`}
        />
      </div>

      <HqPanel
        title="Integration Health Dashboard"
        subtitle="Connected · Warning · Disconnected — Build 56 live connectivity"
        headerExtra={
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
            <StatusBadge label={`Sync ${health.lastSuccessfulSync ? new Date(health.lastSuccessfulSync).toLocaleString() : "—"}`} variant="muted" />
            {health.startupVerifiedAt && (
              <StatusBadge label="Startup verified" variant="success" />
            )}
            <Link to="/hq/monitoring" className="hq-btn hq-btn-sm hq-btn-ghost">Enterprise Monitoring</Link>
          </div>
        }
      >
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <StatusBadge label={`Last successful sync: ${health.lastSuccessfulSync ? new Date(health.lastSuccessfulSync).toLocaleString() : "none yet"}`} variant="gold" />
          <StatusBadge label={`Uptime ${health.uptimeLabel}`} variant="muted" />
          <StatusBadge label={`Checked ${new Date(health.monitoredAt).toLocaleTimeString()}`} variant="muted" />
        </div>

        <ul className="hq-activity-list">
          {health.services.slice(0, 20).map((s) => (
            <li key={s.id} className="hq-activity-item">
              <div className="hq-activity-content">
                <div className="hq-activity-title">{s.name}</div>
                <div className="hq-activity-detail">
                  {s.category}
                  {s.latencyMs != null ? ` · ${s.latencyMs}ms` : ""}
                  {s.message ? ` · ${s.message}` : ""}
                </div>
              </div>
              <StatusBadge
                label={s.displayStatus}
                variant={
                  s.displayStatus === "Connected" ? "success" : s.displayStatus === "Warning" ? "warning" : "danger"
                }
              />
            </li>
          ))}
        </ul>

        {health.recentFailures.length > 0 && (
          <div style={{ marginTop: "0.85rem" }}>
            <h4 style={{ fontSize: "0.78rem", color: "var(--hq-text-dim)", marginBottom: "0.35rem" }}>Recent failures (diagnostics)</h4>
            <ul className="hq-activity-list">
              {health.recentFailures.slice(0, 6).map((f, idx) => (
                <li key={`${f.provider}-${f.at}-${idx}`} className="hq-activity-item">
                  <div className="hq-activity-content">
                    <div className="hq-activity-title">{f.provider}</div>
                    <div className="hq-activity-detail">{f.message} · {f.latencyMs}ms</div>
                  </div>
                  <div className="hq-activity-time">{new Date(f.at).toLocaleTimeString()}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </HqPanel>
    </div>
  );
};
