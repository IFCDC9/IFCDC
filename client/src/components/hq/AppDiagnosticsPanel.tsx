import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, X, RefreshCw, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { hqApi } from "../../api/hqApi";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime } from "../../utils/safeFormat";

interface AppDiagnosticsPanelProps {
  appId: string;
  appName: string;
  onClose: () => void;
}

const OVERALL_VARIANT: Record<string, "success" | "warning" | "danger"> = {
  healthy: "success",
  degraded: "warning",
  offline: "danger",
};

const OVERALL_ICON = {
  healthy: CheckCircle,
  degraded: AlertTriangle,
  offline: XCircle,
};

export const AppDiagnosticsPanel: React.FC<AppDiagnosticsPanelProps> = ({ appId, appName, onClose }) => {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["hq-app-diagnostics", appId],
    queryFn: () => hqApi.appDiagnostics(appId),
  });

  const Icon = data ? OVERALL_ICON[data.overall] : Activity;

  return (
    <div className="hq-modal-overlay" onClick={onClose} role="presentation">
      <div className="hq-modal hq-diagnostics-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hq-diagnostics-header">
          <div>
            <h3><Activity size={18} /> Deployment Diagnostics</h3>
            <p>{appName} ({appId})</p>
          </div>
          <button type="button" className="hq-widget-remove" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {isLoading && <div className="hq-muted-text" style={{ padding: "1.5rem" }}>Running diagnostics…</div>}
        {error && <div style={{ color: "#ef4444", padding: "1rem" }}>{(error as Error).message}</div>}

        {data && (
          <div className="hq-diagnostics-body hq-fade-in">
            <div className="hq-diagnostics-overall">
              <Icon size={28} />
              <div>
                <StatusBadge label={data.overall.toUpperCase()} variant={OVERALL_VARIANT[data.overall]} pulse={data.overall === "healthy"} />
                <span className="hq-muted-text" style={{ fontSize: "0.75rem", display: "block", marginTop: "0.25rem" }}>
                  Checked {formatDateTime(data.timestamp)}
                </span>
              </div>
              <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw size={14} className={isFetching ? "hq-spinner" : ""} /> Re-run
              </button>
            </div>

            <div className="hq-diagnostics-grid">
              <div className="hq-diagnostics-section">
                <h4>Health</h4>
                <div className="hq-diagnostics-row"><span>Status</span><StatusBadge label={data.health.healthy ? "Online" : "Offline"} variant={data.health.healthy ? "success" : "danger"} /></div>
                <div className="hq-diagnostics-row"><span>Latency</span><strong>{data.health.latencyMs}ms</strong></div>
                {data.health.version && <div className="hq-diagnostics-row"><span>Version</span><strong>{data.health.version}</strong></div>}
                <div className="hq-diagnostics-row"><span>URL</span><code>{data.health.url}</code></div>
                {data.health.error && <div className="hq-diagnostics-error">{data.health.error}</div>}
              </div>

              <div className="hq-diagnostics-section">
                <h4>Deployment</h4>
                <div className="hq-diagnostics-row"><span>Environment</span><strong>{data.deployment.environment}</strong></div>
                <div className="hq-diagnostics-row"><span>Status</span><StatusBadge label={data.deployment.status} variant="muted" /></div>
                <div className="hq-diagnostics-row"><span>Registered</span><StatusBadge label={data.deployment.registered ? "Yes" : "No"} variant={data.deployment.registered ? "success" : "warning"} /></div>
                {data.deployment.apiKeyPrefix && <div className="hq-diagnostics-row"><span>API Key</span><code>{data.deployment.apiKeyPrefix}</code></div>}
              </div>

              <div className="hq-diagnostics-section">
                <h4>SDK Compatibility</h4>
                <div className="hq-diagnostics-row"><span>SDK</span><strong>v{data.sdkCompatibility.requiredSdk}</strong></div>
                <div className="hq-diagnostics-row"><span>Platform</span><strong>v{data.sdkCompatibility.platformVersion}</strong></div>
                <div className="hq-diagnostics-row"><span>Compatible</span><StatusBadge label={data.sdkCompatibility.compatible ? "Yes" : "No"} variant={data.sdkCompatibility.compatible ? "success" : "danger"} /></div>
                <p className="hq-muted-text" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>{data.sdkCompatibility.message}</p>
              </div>

              <div className="hq-diagnostics-section hq-diagnostics-full">
                <h4>Inherited Services ({data.inheritedServices.length})</h4>
                <div className="hq-framework-scopes">
                  {data.inheritedServices.map((s) => (
                    <StatusBadge key={s.id} label={s.name} variant="muted" />
                  ))}
                </div>
              </div>
            </div>

            {data.recommendations.length > 0 && (
              <div className="hq-diagnostics-recommendations">
                <h4>Recommendations</h4>
                <ul>{data.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
