import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, AlertTriangle, CheckCircle } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

export const GrantV5ComplianceDashboard: React.FC = () => {
  const compliance = useQuery({
    queryKey: ["grant-v5-compliance"],
    queryFn: grantsApi.v5Compliance,
    staleTime: 30_000,
  });
  const tracker = useQuery({
    queryKey: ["grant-v5-renewal-reporting"],
    queryFn: grantsApi.v5RenewalReporting,
    staleTime: 30_000,
  });

  if (compliance.isLoading) return <HqLoading message="Loading compliance dashboard…" />;

  const summary = compliance.data?.summary;
  const upcoming = compliance.data?.upcoming ?? [];

  return (
    <div className="hq-fade-in">
      <HqPanel title="Compliance Dashboard" subtitle="Reporting requirements, renewal tracker, and compliance health">
        <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
          <div>
            <div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Health Score</div>
            <strong style={{ color: (summary?.healthScore ?? 0) >= 80 ? "var(--hq-success)" : "var(--hq-warning)" }}>
              {summary?.healthScore ?? 0}/100
            </strong>
          </div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Pending</div><strong>{summary?.pending ?? 0}</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Overdue</div><strong style={{ color: (summary?.overdue ?? 0) > 0 ? "var(--hq-danger)" : undefined }}>{summary?.overdue ?? 0}</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Submitted</div><strong>{summary?.submitted ?? 0}</strong></div>
          {tracker.data && (
            <>
              <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Renewals Due</div><strong>{tracker.data.pendingRenewals}</strong></div>
              <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Reports Due</div><strong>{tracker.data.pendingReports}</strong></div>
            </>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
          {(summary?.overdue ?? 0) > 0 ? (
            <AlertTriangle size={16} style={{ color: "var(--hq-danger)" }} />
          ) : (
            <CheckCircle size={16} style={{ color: "var(--hq-success)" }} />
          )}
          <StatusBadge label={summary?.status ?? "unknown"} variant={summary?.status === "healthy" ? "success" : "warning"} />
          <Shield size={14} className="hq-muted-text" />
        </div>

        <table className="hq-table">
          <thead><tr><th>Grant</th><th>Report</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {upcoming.slice(0, 12).map((r) => (
              <tr key={String(r.id)}>
                <td>{String(r.grant_title ?? "—")}</td>
                <td>{String(r.report_type ?? "—")}</td>
                <td>{r.due_date ? new Date(String(r.due_date)).toLocaleDateString() : "—"}</td>
                <td><StatusBadge label={String(r.status ?? "pending")} variant={String(r.status) === "pending" ? "warning" : "success"} /></td>
              </tr>
            ))}
            {!upcoming.length && (
              <tr><td colSpan={4} className="hq-empty-cell">All compliance reports current.</td></tr>
            )}
          </tbody>
        </table>
      </HqPanel>
    </div>
  );
};
