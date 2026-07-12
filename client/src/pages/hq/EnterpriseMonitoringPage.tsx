import React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Database, HardDrive, Lock, Plug, RefreshCw, Server, Timer, Workflow,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import {
  EMPTY_ENTERPRISE_MONITORING,
  monitoringApi,
  type MonitorComponentStatus,
} from "../../api/monitoringApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { HqWidgetErrorBoundary } from "../../components/hq/HqErrorBoundary";

function statusVariant(status: MonitorComponentStatus): "success" | "warning" | "danger" | "muted" {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  if (status === "critical") return "danger";
  return "muted";
}

const EnterpriseMonitoringPage: React.FC = () => {
  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: ["enterprise-monitoring"],
    queryFn: async () => {
      try {
        return await monitoringApi.overview();
      } catch (err) {
        console.warn("[enterprise-monitoring] load failed:", err);
        return EMPTY_ENTERPRISE_MONITORING;
      }
    },
    placeholderData: EMPTY_ENTERPRISE_MONITORING,
    staleTime: 30_000,
    refetchInterval: 45_000,
    retry: 0,
  });

  const retry = useMutation({
    mutationFn: () => monitoringApi.retryIntegrations(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["enterprise-monitoring"] });
      void qc.invalidateQueries({ queryKey: ["integrations-hub"] });
      void qc.invalidateQueries({ queryKey: ["hq-executive-overview"] });
    },
  });

  const data = overview.data ?? EMPTY_ENTERPRISE_MONITORING;
  const components = data.components ?? [];

  return (
    <HQLayout
      title="Enterprise Monitoring"
      subtitle="Live service, API, database, storage, auth, jobs, and uptime — Build 55"
      auraModule="software"
      auraActions={["ask", "diagnose", "summarize"]}
    >
      <div className="hq-people-toolbar" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <StatusBadge
          label={`Health ${data.overallScore}/100`}
          variant={statusVariant(data.overallStatus)}
        />
        <StatusBadge label={`Uptime ${data.uptimeLabel}`} variant="gold" />
        <button
          type="button"
          className="hq-btn hq-btn-sm hq-btn-ghost"
          disabled={overview.isFetching}
          onClick={() => void overview.refetch()}
        >
          <RefreshCw size={14} className={overview.isFetching ? "hq-spin" : ""} /> Refresh
        </button>
        <button
          type="button"
          className="hq-btn hq-btn-sm hq-btn-secondary"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          <Plug size={14} /> {retry.isPending ? "Retrying…" : "Retry degraded integrations"}
        </button>
        <Link to="/hq/integrations" className="hq-btn hq-btn-sm hq-btn-ghost">Integrations Hub</Link>
        <Link to="/hq" className="hq-btn hq-btn-sm hq-btn-ghost">Executive Dashboard</Link>
      </div>

      {data.degraded && (
        <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "1rem" }} role="status">
          <AlertTriangle size={16} />
          <div>
            <strong>Degraded monitoring</strong>
            <span>{data.warning ?? "Some probes did not respond — retry to refresh live status."}</span>
          </div>
        </div>
      )}

      {retry.isSuccess && (
        <div className="hq-anomaly-alert hq-sev-low" style={{ marginBottom: "1rem" }} role="status">
          <Plug size={16} />
          <div>
            <strong>Integration retry complete</strong>
            <span>
              Attempted {retry.data.attempted} · recovered {retry.data.recovered.length}
              {retry.data.failed.length ? ` · failed ${retry.data.failed.length}` : ""}
            </span>
          </div>
        </div>
      )}

      {overview.isLoading && !overview.isFetched ? (
        <HqLoading message="Loading enterprise monitoring…" />
      ) : (
        <>
          <HqWidgetErrorBoundary label="Monitoring KPIs">
            <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1rem" }}>
              <KpiCard label="System Health" value={`${data.overallScore}/100`} icon={Activity} variant={statusVariant(data.overallStatus)} meta={data.overallStatus} />
              <KpiCard label="Uptime" value={data.uptimeLabel} icon={Timer} variant="success" meta={`${data.uptimeSeconds}s process`} />
              <KpiCard
                label="Services"
                value={`${data.services.filter((s) => s.healthy).length}/${data.services.length || "—"}`}
                icon={Server}
                variant={data.services.every((s) => s.healthy) ? "success" : "warning"}
              />
              <KpiCard
                label="Integrations"
                value={`${data.integrations.filter((i) => i.healthy).length}/${data.integrations.length || "—"}`}
                icon={Plug}
                variant={data.integrations.every((i) => i.healthy) || !data.integrations.length ? "success" : "warning"}
              />
              <KpiCard label="Voice Jobs Active" value={data.jobs.voiceActive} icon={Workflow} meta={`${data.jobs.voiceRecentFailed} recent failed`} />
              <KpiCard label="Pending Alerts" value={data.alerts.length} icon={AlertTriangle} variant={data.alerts.some((a) => a.severity === "high") ? "danger" : "muted"} />
            </div>
          </HqWidgetErrorBoundary>

          <div className="hq-executive-health-strip hq-fade-in" aria-label="Monitoring components">
            {components.map((c) => (
              <div key={c.id} className={`hq-executive-health-card hq-health-${c.status === "healthy" ? "good" : c.status === "degraded" ? "watch" : c.status === "critical" ? "critical" : "unknown"}`}>
                <span className="hq-executive-health-label">{c.label}</span>
                <span className="hq-executive-health-value">{c.score}/100</span>
                <span className="hq-executive-health-meta">{c.detail}</span>
              </div>
            ))}
          </div>

          {(data.commandHealth?.pillars?.length ?? 0) > 0 && (
            <HqPanel title="Executive Command Pillars" subtitle="Same live scores as the Executive Dashboard" className="hq-fade-in">
              <div className="hq-executive-scorecard-strip">
                {data.commandHealth!.pillars.map((p) => (
                  <div key={p.id} className={`hq-executive-scorecard-pillar hq-score-${p.status}`}>
                    <span className="hq-executive-health-label">{p.label}</span>
                    <span className="hq-executive-health-value">{p.score}/100</span>
                    <span className="hq-executive-health-meta">{p.grade}</span>
                  </div>
                ))}
              </div>
            </HqPanel>
          )}

          <div className="hq-grid-2 hq-fade-in" style={{ marginTop: "1rem" }}>
            <HqPanel title="Platform Services" subtitle="Centralized @ifcdc service status">
              {data.services.length === 0 ? (
                <p className="hq-muted-text">No platform services reported.</p>
              ) : (
                <ul className="hq-activity-list">
                  {data.services.map((s) => (
                    <li key={s.id} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{s.id}</div>
                      </div>
                      <StatusBadge label={s.healthy ? "healthy" : "down"} variant={s.healthy ? "success" : "danger"} />
                    </li>
                  ))}
                </ul>
              )}
            </HqPanel>

            <HqPanel title="Apps" subtitle="Software Division live polls">
              {data.apps.length === 0 ? (
                <p className="hq-muted-text">No apps polled.</p>
              ) : (
                <ul className="hq-activity-list">
                  {data.apps.map((a) => (
                    <li key={a.id} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{a.id}</div>
                        <div className="hq-activity-detail">
                          {a.latencyMs != null ? `${a.latencyMs}ms` : ""}{a.error ? ` · ${a.error}` : ""}
                        </div>
                      </div>
                      <StatusBadge label={a.healthy ? "up" : "down"} variant={a.healthy ? "success" : "danger"} />
                    </li>
                  ))}
                </ul>
              )}
            </HqPanel>

            <HqPanel title="Integrations" subtitle="Live connector health">
              {data.integrations.length === 0 ? (
                <p className="hq-muted-text">No integrations loaded.</p>
              ) : (
                <ul className="hq-activity-list">
                  {data.integrations.map((i) => (
                    <li key={i.id} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{i.name}</div>
                        <div className="hq-activity-detail">{i.message}</div>
                      </div>
                      <StatusBadge label={i.status} variant={i.healthy ? "success" : "warning"} />
                    </li>
                  ))}
                </ul>
              )}
            </HqPanel>

            <HqPanel title="Background Jobs" subtitle="Scheduled workflows + voice queue">
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                <StatusBadge label={`Pending notifications ${data.jobs.notificationPending}`} variant="muted" />
                <StatusBadge label={`Voice failed ${data.jobs.voiceRecentFailed}`} variant={data.jobs.voiceRecentFailed ? "warning" : "muted"} />
              </div>
              {data.jobs.scheduled.length === 0 ? (
                <p className="hq-muted-text">No scheduled jobs registered.</p>
              ) : (
                <ul className="hq-activity-list">
                  {data.jobs.scheduled.map((j) => (
                    <li key={j.key || j.name} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{j.name || j.key}</div>
                        <div className="hq-activity-detail">
                          {j.sourceModule} · {j.enabled ? "enabled" : "disabled"}
                          {j.lastError ? ` · ${j.lastError}` : ""}
                        </div>
                      </div>
                      <StatusBadge
                        label={j.runStatus}
                        variant={j.runStatus === "failed" ? "danger" : j.runStatus === "success" ? "success" : "muted"}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </HqPanel>
          </div>

          {data.alerts.length > 0 && (
            <div className="hq-fade-in" style={{ marginTop: "1rem" }}>
              <HqPanel title="Active Alerts" subtitle="Monitoring + KPI anomalies">
                <div className="hq-anomaly-alert-strip">
                  {data.alerts.slice(0, 10).map((a) => (
                    <div key={a.id} className={`hq-anomaly-alert hq-sev-${a.severity === "high" ? "high" : a.severity === "medium" ? "medium" : "low"}`}>
                      <strong>{a.title}</strong>
                      <span>{a.detail}</span>
                      {a.path && <Link to={a.path} className="hq-entity-link">Open</Link>}
                    </div>
                  ))}
                </div>
              </HqPanel>
            </div>
          )}

          <div className="hq-muted-text" style={{ marginTop: "1rem", fontSize: "0.75rem" }}>
            Last monitored {data.monitoredAt ? new Date(data.monitoredAt).toLocaleString() : "—"} · source {data.source}
            <span style={{ marginLeft: "0.75rem" }}>
              <Database size={12} style={{ verticalAlign: "middle" }} /> DB ·{" "}
              <HardDrive size={12} style={{ verticalAlign: "middle" }} /> Storage ·{" "}
              <Lock size={12} style={{ verticalAlign: "middle" }} /> Auth
            </span>
          </div>
        </>
      )}
    </HQLayout>
  );
};

export default EnterpriseMonitoringPage;
