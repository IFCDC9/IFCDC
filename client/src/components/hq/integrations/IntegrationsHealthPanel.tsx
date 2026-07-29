import React from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, Plug, ServerCrash, Timer, Wifi } from "lucide-react";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import type { IntegrationHealthDashboard, IntegrationHealthService } from "../../../api/integrationsApi";

function scoreVariant(score: number): "success" | "warning" | "danger" | "muted" {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  if (score > 0) return "danger";
  return "muted";
}

export type HealthFilter =
  | "all"
  | "connected"
  | "warning"
  | "offline"
  | "latency"
  | "failed";

export const IntegrationsHealthPanel: React.FC<{
  health: IntegrationHealthDashboard | null;
  loading?: boolean;
  filter?: HealthFilter;
  onFilterChange?: (filter: HealthFilter) => void;
  onOpenService?: (service: IntegrationHealthService) => void;
}> = ({ health, loading, filter = "all", onFilterChange, onOpenService }) => {
  if (loading && (!health || health.totalServices === 0)) {
    return (
      <HqPanel title="Integration Health Dashboard" subtitle="Loading live connectivity…">
        <p className="hq-muted-text">Probing connectors and platform systems…</p>
      </HqPanel>
    );
  }
  if (!health || health.totalServices === 0) {
    return (
      <HqPanel title="Integration Health Dashboard" subtitle="Awaiting live probe results">
        <p className="hq-muted-text">No connectivity data yet — refresh status or retry degraded connectors.</p>
      </HqPanel>
    );
  }

  const filteredServices = health.services.filter((s) => {
    if (filter === "connected") return s.displayStatus === "Connected";
    if (filter === "warning") return s.displayStatus === "Warning";
    if (filter === "offline") return s.displayStatus === "Disconnected";
    if (filter === "latency") return typeof s.latencyMs === "number" && s.latencyMs >= 0;
    if (filter === "failed") return !s.healthy || (s.ops?.failedRequestCount ?? 0) > 0 || s.displayStatus === "Disconnected";
    return true;
  });

  const setFilter = (next: HealthFilter) => {
    onFilterChange?.(filter === next && next !== "all" ? "all" : next);
  };

  return (
    <div className="hq-fade-in" style={{ marginBottom: "1.25rem" }}>
      <div className="hq-kpi-grid" style={{ marginBottom: "0.85rem" }}>
        <KpiCard
          label="Integration Health"
          value={`${health.overallHealthScore}/100`}
          icon={Activity}
          variant={scoreVariant(health.overallHealthScore)}
          meta={health.overallLabel}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <KpiCard
          label="Connected"
          value={health.connectedCount}
          icon={Wifi}
          variant="success"
          meta={`of ${health.totalServices}`}
          active={filter === "connected"}
          onClick={() => setFilter("connected")}
        />
        <KpiCard
          label="Warning"
          value={health.warningCount}
          icon={AlertTriangle}
          variant={health.warningCount ? "warning" : "muted"}
          active={filter === "warning"}
          onClick={() => setFilter("warning")}
        />
        <KpiCard
          label="Offline"
          value={health.offlineCount}
          icon={ServerCrash}
          variant={health.offlineCount ? "danger" : "muted"}
          active={filter === "offline"}
          onClick={() => setFilter("offline")}
        />
        <KpiCard
          label="Average API Latency"
          value={health.avgLatencyMs != null ? `${health.avgLatencyMs}ms` : "—"}
          icon={Timer}
          meta="Live probe average"
          active={filter === "latency"}
          onClick={() => setFilter("latency")}
        />
        <KpiCard
          label="Failed Requests"
          value={health.failedRequests}
          icon={Plug}
          variant={health.failedRequests > 0 ? "warning" : "muted"}
          meta={`Uptime ${health.uptimeLabel}`}
          active={filter === "failed"}
          onClick={() => setFilter("failed")}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.45rem",
          marginBottom: "0.85rem",
          fontSize: "0.75rem",
        }}
      >
        <StatusBadge
          label={`24h uptime ${health.uptime24hPct != null ? `${health.uptime24hPct}%` : "—"}`}
          variant="gold"
        />
        <StatusBadge
          label={`7d uptime ${health.uptime7dPct != null ? `${health.uptime7dPct}%` : "—"}`}
          variant="muted"
        />
        {health.environmentName && <StatusBadge label={health.environmentName} variant="muted" />}
        {health.productionVsTest && (
          <StatusBadge
            label={health.productionVsTest === "production" ? "Production" : "Test"}
            variant={health.productionVsTest === "production" ? "success" : "warning"}
          />
        )}
      </div>

      {(health.responseTimeHistoryMs?.length > 0 || health.successFailureTrend?.length > 0) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.75rem",
            marginBottom: "0.85rem",
          }}
        >
          <HqPanel title="Success / failure trend (24h)" subtitle="Hourly live probe buckets">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 48 }}>
              {(health.successFailureTrend ?? []).slice(-24).map((b, i) => {
                const total = b.ok + b.fail || 1;
                return (
                  <div
                    key={`${b.at}-${i}`}
                    title={`${new Date(b.at).toLocaleString()} · ok ${b.ok} / fail ${b.fail}`}
                    style={{ flex: 1, minWidth: 4, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}
                  >
                    <div style={{ height: `${(b.ok / total) * 100}%`, background: "var(--hq-success)", opacity: 0.85 }} />
                    <div style={{ height: `${(b.fail / total) * 100}%`, background: "var(--hq-danger)", opacity: 0.85 }} />
                  </div>
                );
              })}
            </div>
          </HqPanel>
          <HqPanel title="Response-time history" subtitle="Recent live probe latency">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 48 }}>
              {(health.responseTimeHistoryMs ?? []).map((ms, i) => {
                const max = Math.max(...(health.responseTimeHistoryMs ?? [1]), 1);
                return (
                  <div
                    key={i}
                    title={`${ms}ms`}
                    style={{
                      flex: 1,
                      minWidth: 3,
                      height: `${Math.max(8, Math.round((ms / max) * 100))}%`,
                      background: "var(--hq-gold)",
                      opacity: 0.6,
                      borderRadius: 1,
                    }}
                  />
                );
              })}
            </div>
          </HqPanel>
        </div>
      )}

      <HqPanel
        title="Integration Health Dashboard"
        subtitle={
          filter === "all"
            ? "Connected · Warning · Disconnected — live connectivity"
            : `Filtered: ${filter} (${filteredServices.length} records)`
        }
        headerExtra={
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
            <StatusBadge label={`Sync ${health.lastSuccessfulSync ? new Date(health.lastSuccessfulSync).toLocaleString() : "—"}`} variant="muted" />
            {health.startupVerifiedAt && <StatusBadge label="Startup verified" variant="success" />}
            {filter !== "all" && (
              <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={() => onFilterChange?.("all")}>
                Clear filter
              </button>
            )}
            <Link to="/hq/monitoring" className="hq-btn hq-btn-sm hq-btn-ghost">
              Enterprise Monitoring
            </Link>
          </div>
        }
      >
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <StatusBadge
            label={`Last successful sync: ${health.lastSuccessfulSync ? new Date(health.lastSuccessfulSync).toLocaleString() : "none yet"}`}
            variant="gold"
          />
          <StatusBadge label={`Uptime ${health.uptimeLabel}`} variant="muted" />
          <StatusBadge label={`Checked ${new Date(health.monitoredAt).toLocaleTimeString()}`} variant="muted" />
        </div>

        <ul className="hq-activity-list">
          {filteredServices.slice(0, 30).map((s) => (
            <li key={s.id} className="hq-activity-item">
              <button
                type="button"
                className="hq-activity-content"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  textAlign: "left",
                  cursor: onOpenService ? "pointer" : "default",
                  padding: 0,
                  font: "inherit",
                  width: "100%",
                }}
                onClick={() => onOpenService?.(s)}
                aria-label={`Open ${s.name} details`}
              >
                <div className="hq-activity-title">{s.name}</div>
                <div className="hq-activity-detail">
                  {s.category}
                  {s.latencyMs != null ? ` · ${s.latencyMs}ms` : ""}
                  {s.ops?.serviceOwner ? ` · ${s.ops.serviceOwner}` : ""}
                  {s.message ? ` · ${s.message}` : ""}
                </div>
              </button>
              <StatusBadge
                label={s.displayStatus}
                variant={
                  s.displayStatus === "Connected" ? "success" : s.displayStatus === "Warning" ? "warning" : "danger"
                }
              />
            </li>
          ))}
        </ul>

        {health.last10SyncEvents?.length > 0 && (
          <div id="integrations-probe-log" style={{ marginTop: "0.85rem" }}>
            <h4 style={{ fontSize: "0.78rem", color: "var(--hq-text-dim)", marginBottom: "0.35rem" }}>
              Last 10 sync events
            </h4>
            <ul className="hq-activity-list">
              {health.last10SyncEvents.slice(0, 10).map((f, idx) => (
                <li key={`${f.provider}-${f.at}-${idx}`} className="hq-activity-item">
                  <button
                    type="button"
                    className="hq-activity-content"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      textAlign: "left",
                      cursor: onOpenService ? "pointer" : "default",
                      padding: 0,
                      font: "inherit",
                      width: "100%",
                    }}
                    onClick={() => {
                      const svc = health.services.find((s) => s.id === f.provider);
                      if (svc) onOpenService?.(svc);
                      else onOpenService?.({ id: f.provider, name: f.provider, category: "Integration", displayStatus: f.ok ? "Connected" : "Disconnected", status: "platform", healthy: f.ok, latencyMs: f.latencyMs, lastChecked: f.at, message: f.message });
                    }}
                  >
                    <div className="hq-activity-title">
                      {f.provider}
                      {!f.ok && f.errorCode ? ` · ${f.errorCode}` : ""}
                    </div>
                    <div className="hq-activity-detail">
                      {f.rootCause || f.message}
                      {` · ${f.latencyMs}ms`}
                    </div>
                  </button>
                  <div className="hq-activity-time">{new Date(f.at).toLocaleTimeString()}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {health.recentFailures.length > 0 && (
          <div style={{ marginTop: "0.85rem" }}>
            <h4 style={{ fontSize: "0.78rem", color: "var(--hq-text-dim)", marginBottom: "0.35rem" }}>
              Recent failures (error code · root cause)
            </h4>
            <ul className="hq-activity-list">
              {health.recentFailures.slice(0, 8).map((f, idx) => (
                <li key={`${f.provider}-${f.at}-${idx}`} className="hq-activity-item">
                  <button
                    type="button"
                    className="hq-activity-content"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      textAlign: "left",
                      cursor: onOpenService ? "pointer" : "default",
                      padding: 0,
                      font: "inherit",
                      width: "100%",
                    }}
                    onClick={() => {
                      const svc = health.services.find((s) => s.id === f.provider);
                      if (svc) onOpenService?.(svc);
                    }}
                  >
                    <div className="hq-activity-title">
                      {f.provider}
                      {f.errorCode ? ` · ${f.errorCode}` : ""}
                    </div>
                    <div className="hq-activity-detail">
                      {f.rootCause || f.message} · {f.latencyMs}ms
                    </div>
                  </button>
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
