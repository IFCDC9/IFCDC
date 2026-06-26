import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, Activity, AlertTriangle, CheckCircle } from "lucide-react";
import { developerApi } from "../../api/developerApi";
import { HqPanel } from "./HqPanel";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime } from "../../utils/safeFormat";

const SEVERITY_VARIANT: Record<string, "success" | "warning" | "danger" | "muted"> = {
  info: "muted",
  warning: "warning",
  critical: "danger",
};

export const SecurityAuditPanel: React.FC = () => {
  const monitor = useQuery({
    queryKey: ["hq-security-monitor"],
    queryFn: developerApi.securityMonitor,
    refetchInterval: 60_000,
  });

  const auditLog = useQuery({
    queryKey: ["hq-audit-log"],
    queryFn: () => developerApi.auditLog(50),
    refetchInterval: 60_000,
  });

  const statusVariant = monitor.data?.status === "healthy" ? "success" : monitor.data?.status === "warning" ? "warning" : "danger";
  const StatusIcon = monitor.data?.status === "healthy" ? CheckCircle : AlertTriangle;

  return (
    <div className="hq-security-audit hq-fade-in">
      <HqPanel title="Security Monitor" subtitle="Enterprise audit logging for all connected applications (24h)">
        {monitor.isLoading ? (
          <p className="hq-muted-text">Loading security status…</p>
        ) : monitor.data && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <StatusIcon size={24} color={statusVariant === "success" ? "#22c55e" : "#f59e0b"} />
              <StatusBadge label={monitor.data.status.toUpperCase()} variant={statusVariant} />
            </div>
            <div className="hq-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
              <div className="hq-stat-card">
                <Activity size={16} />
                <strong>{monitor.data.totalEvents}</strong>
                <span className="hq-muted-text">Total events</span>
              </div>
              <div className="hq-stat-card">
                <Shield size={16} />
                <strong>{monitor.data.failedAuthAttempts}</strong>
                <span className="hq-muted-text">Failed auth</span>
              </div>
              <div className="hq-stat-card">
                <AlertTriangle size={16} />
                <strong>{monitor.data.warnings}</strong>
                <span className="hq-muted-text">Warnings</span>
              </div>
              <div className="hq-stat-card">
                <AlertTriangle size={16} />
                <strong>{monitor.data.criticalAlerts}</strong>
                <span className="hq-muted-text">Critical</span>
              </div>
            </div>
          </>
        )}
      </HqPanel>

      <HqPanel title="Audit Log" subtitle="Registration, validation, key rotation, and auth events" className="hq-mt-panel">
        {auditLog.isLoading ? (
          <p className="hq-muted-text">Loading audit log…</p>
        ) : !auditLog.data?.entries.length ? (
          <p className="hq-muted-text">No audit events yet.</p>
        ) : (
          <div className="hq-audit-log">
            {auditLog.data.entries.map((entry) => (
              <div key={entry.id} className="hq-audit-entry">
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <StatusBadge label={entry.eventType} variant={SEVERITY_VARIANT[entry.severity] ?? "muted"} />
                  {entry.appId && <code>{entry.appId}</code>}
                  <span className="hq-muted-text" style={{ marginLeft: "auto", fontSize: "0.75rem" }}>
                    {formatDateTime(entry.createdAt)}
                  </span>
                </div>
                <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>{entry.detail}</p>
                {entry.actorEmail && <span className="hq-muted-text" style={{ fontSize: "0.75rem" }}>by {entry.actorEmail}</span>}
              </div>
            ))}
          </div>
        )}
      </HqPanel>
    </div>
  );
};
