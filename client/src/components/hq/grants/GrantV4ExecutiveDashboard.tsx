import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, Clock, Target, AlertTriangle, Building2, PieChart, Shield,
} from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

export const GrantV4ExecutiveDashboard: React.FC = () => {
  const dash = useQuery({
    queryKey: ["grant-v4-dashboard"],
    queryFn: grantsApi.v4Dashboard,
    staleTime: 45_000,
  });

  if (dash.isLoading) return <HqLoading message="Loading Funding Operations…" />;

  const data = dash.data;
  if (!data) return null;

  const { executive, fundingByProgram, fundingBySource, calendar, topPriorities } = data;
  const forecast = executive.organizationFundingForecast;
  const compliance = executive.complianceStatus;

  return (
    <div className="hq-fade-in">
      <HqPanel title="Intelligent Funding Operations" subtitle="Grant Center v4 — executive command center for grants, funding, and compliance">
        <StatusBadge label="v4 OPERATIONS" variant="gold" />
        <div className="hq-kpi-grid" style={{ marginTop: "1rem" }}>
          <KpiCard label="Pipeline Value" value={fmt(executive.totalPipelineValue)} icon={Target} variant="gold" />
          <KpiCard label="Total Awarded" value={fmt(executive.totalAwarded)} icon={TrendingUp} variant="success" />
          <KpiCard label="Total Pending" value={fmt(executive.totalPending)} icon={Clock} variant="warning" meta={`${executive.pendingApplications} apps`} />
          <KpiCard label="Upcoming Deadlines" value={executive.upcomingDeadlines} icon={Clock} variant={executive.upcomingDeadlines > 0 ? "warning" : "success"} />
          <KpiCard label="12-Month Forecast" value={fmt(forecast.total12MonthProjection)} icon={DollarSign} variant="gold" />
          <KpiCard
            label="Compliance"
            value={compliance.overall === "healthy" ? "Healthy" : "Attention"}
            icon={Shield}
            variant={compliance.overall === "healthy" ? "success" : "warning"}
            meta={`${compliance.dueWithin14Days} due · ${compliance.spendingAlerts} alerts`}
          />
        </div>
      </HqPanel>

      <div style={{ marginTop: "1.25rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.25rem" }}>
        <HqPanel title="Funding by Program" subtitle="Awarded and requested by IFCDC division">
          <table className="hq-table">
            <thead><tr><th>Program</th><th>Awarded</th><th>Gap</th></tr></thead>
            <tbody>
              {fundingByProgram.slice(0, 10).map((p) => (
                <tr key={p.slug}>
                  <td><Building2 size={14} style={{ marginRight: "0.35rem", verticalAlign: "middle" }} />{p.label}</td>
                  <td>{fmt(p.awarded)}</td>
                  <td style={{ color: p.gap > 0 ? "var(--hq-warning)" : "var(--hq-success)" }}>{fmt(p.gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Funding by Source" subtitle="Awarded amounts by funder">
          <table className="hq-table">
            <thead><tr><th>Funder</th><th>Awarded</th></tr></thead>
            <tbody>
              {(fundingBySource.byFunder ?? []).slice(0, 8).map((s) => (
                <tr key={s.source}>
                  <td><PieChart size={14} style={{ marginRight: "0.35rem", verticalAlign: "middle" }} />{s.source}</td>
                  <td>{fmt(s.total_awarded)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Monthly Funding Forecast" subtitle="Organization projection over the next 12 months">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {forecast.months.slice(0, 6).map((m) => (
              <div key={m.month} className="hq-panel" style={{ padding: "0.65rem 0.85rem", minWidth: 100 }}>
                <div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>{m.month}</div>
                <div style={{ fontWeight: 700, color: "var(--hq-gold)" }}>{fmt(m.projected)}</div>
              </div>
            ))}
          </div>
        </HqPanel>
      </div>

      {topPriorities.length > 0 && (
        <div style={{ marginTop: "1.25rem" }}>
          <HqPanel title="Priority Grants This Month" subtitle="AI-ranked by eligibility and strategic value">
            {topPriorities.slice(0, 4).map((g) => (
              <div key={String(g.id)} className="hq-activity-item">
                <div className="hq-activity-content">
                  <div className="hq-activity-title">{String(g.title)}</div>
                  <div className="hq-activity-detail">{String(g.funder)} · Priority {String(g.priorityScore)}%</div>
                </div>
              </div>
            ))}
          </HqPanel>
        </div>
      )}

      {(calendar.summary.complianceAlerts ?? 0) > 0 && (
        <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--hq-warning)" }}>
          <AlertTriangle size={16} />
          {calendar.summary.complianceAlerts} compliance alerts in the funding calendar
        </div>
      )}
    </div>
  );
};
