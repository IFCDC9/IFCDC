import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Bell, FileText, Shield, RefreshCw, CheckSquare } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

const TYPE_META: Record<string, { label: string; icon: React.ElementType; variant: "gold" | "success" | "warning" | "danger" | "muted" }> = {
  application_deadline: { label: "Application", icon: FileText, variant: "gold" },
  reporting_deadline: { label: "Reporting", icon: FileText, variant: "warning" },
  renewal_reminder: { label: "Renewal", icon: RefreshCw, variant: "success" },
  compliance_alert: { label: "Compliance", icon: Shield, variant: "danger" },
  board_approval: { label: "Board Approval", icon: CheckSquare, variant: "muted" },
};

export const GrantV4FundingCalendar: React.FC = () => {
  const calendar = useQuery({
    queryKey: ["grant-v4-calendar"],
    queryFn: () => grantsApi.v4Calendar(90),
    staleTime: 30_000,
  });

  if (calendar.isLoading) return <HqLoading message="Loading funding calendar…" />;

  const data = calendar.data;
  const summary = data?.summary ?? {};

  return (
    <div className="hq-fade-in">
      <HqPanel title="Funding Operations Calendar" subtitle="Application deadlines, reporting, renewals, compliance alerts, and board approvals">
        <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Application Deadlines</div><strong>{summary.applicationDeadlines ?? 0}</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Reporting Due</div><strong>{summary.reportingDeadlines ?? 0}</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Renewals</div><strong>{summary.renewalReminders ?? 0}</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Compliance Alerts</div><strong style={{ color: (summary.complianceAlerts ?? 0) > 0 ? "var(--hq-warning)" : undefined }}>{summary.complianceAlerts ?? 0}</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Board Approvals</div><strong>{summary.boardApprovals ?? 0}</strong></div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.75rem" }}>
          <Calendar size={16} style={{ color: "var(--hq-gold)" }} />
          <span className="hq-muted-text" style={{ fontSize: "0.82rem" }}>Next 90 days</span>
          <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" style={{ marginLeft: "auto" }} onClick={() => calendar.refetch()}>
            <Bell size={14} /> Refresh
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {(data?.events ?? []).slice(0, 25).map((e) => {
            const meta = TYPE_META[e.type] ?? TYPE_META.application_deadline;
            const Icon = meta.icon;
            return (
              <div key={`${e.type}-${e.id}`} className="hq-panel" style={{ padding: "0.65rem 0.85rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <Icon size={16} style={{ color: "var(--hq-gold)", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{e.grantTitle || e.title}</div>
                  <div className="hq-muted-text" style={{ fontSize: "0.82rem" }}>{e.title}</div>
                </div>
                <StatusBadge label={meta.label} variant={meta.variant} />
                <div className="hq-muted-text" style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>
                  {e.dueDate ? new Date(e.dueDate).toLocaleDateString() : "—"}
                </div>
              </div>
            );
          })}
          {!data?.events?.length && <p className="hq-muted-text">No calendar events in the next 90 days.</p>}
        </div>
      </HqPanel>
    </div>
  );
};
