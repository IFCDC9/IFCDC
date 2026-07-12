import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, TrendingUp, Sparkles, FileBarChart, Shield, Bell,
  Users, Wallet, FileText, Activity, Briefcase, AlertTriangle,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { analyticsApi } from "../../api/analyticsApi";
import { hqApi } from "../../api/hqApi";
import { enterpriseApi } from "../../api/enterpriseApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { ActivityFeed } from "../../components/hq/ActivityFeed";
import { HqLiveIndicator } from "../../components/hq/HqLiveIndicator";
import { formatCurrency } from "../../utils/safeFormat";
import { resolveOrganizationHealth, formatHealthScore } from "../../utils/organizationHealth";

const fmt = formatCurrency;

const FounderCommandCenterPage: React.FC = () => {
  const commandCenter = useQuery({ queryKey: ["founder-command-center"], queryFn: analyticsApi.commandCenter, staleTime: 60_000 });
  const briefing = useQuery({ queryKey: ["founder-daily-briefing"], queryFn: () => analyticsApi.dailyBriefing(), staleTime: 300_000 });
  const trends = useQuery({ queryKey: ["founder-trend-analysis"], queryFn: analyticsApi.trendAnalysis, staleTime: 120_000 });
  const predictive = useQuery({ queryKey: ["founder-predictive-kpi"], queryFn: analyticsApi.predictiveKpi, staleTime: 60_000 });
  const anomalies = useQuery({ queryKey: ["founder-anomalies"], queryFn: hqApi.auraAnomalies, staleTime: 60_000 });
  const risk = useQuery({ queryKey: ["founder-financial-risk"], queryFn: hqApi.auraFinancialRisk, staleTime: 120_000 });
  const activity = useQuery({ queryKey: ["founder-activity"], queryFn: () => analyticsApi.activity(15), staleTime: 30_000 });
  const notifs = useQuery({ queryKey: ["founder-notifs"], queryFn: enterpriseApi.notifications, staleTime: 30_000 });

  const cc = commandCenter.data;
  const health = resolveOrganizationHealth(
    cc?.organizationHealth ? { organizationHealth: cc.organizationHealth as { overall: number; grade: string; factors?: { label: string; score: number; max: number; weight: string }[] } } : null
  );
  const healthLabel = formatHealthScore(health, commandCenter.isLoading);
  const finance = cc?.financialHealth as { score: number; cashFlow: number; budgetRemaining: number } | undefined;
  const grants = cc?.grantPipeline as { activeAwards: number; pipelineValue: number; complianceDue: number } | undefined;
  const series = (trends.data?.series ?? []) as { domain: string; metric: string; changePct: number; direction: string; status: string }[];

  if (commandCenter.isLoading && !cc) {
    return (
      <HQLayout title="Founder Command Center" subtitle="Organization-wide executive visibility">
        <HqLoading message="Loading founder command data…" />
      </HQLayout>
    );
  }

  return (
    <HQLayout title="Founder Command Center" subtitle="Complete organization-wide visibility — intelligence, risk, and priorities">
      {commandCenter.isError && !cc && (
        <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "1rem" }} role="status">
          <AlertTriangle size={16} />
          <div>
            <strong>Command center unavailable</strong>
            <span>Live founder metrics did not load. Retry or open the Executive Dashboard.</span>
            <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" style={{ marginLeft: "0.5rem" }} onClick={() => void commandCenter.refetch()}>
              Retry
            </button>
          </div>
        </div>
      )}
      <div className="hq-analytics-toolbar">
        <HqLiveIndicator intervalSec={30} />
        <Link to="/hq/aura" className="hq-btn hq-btn-secondary hq-btn-sm"><Sparkles size={14} /> Ask AURA</Link>
        <Link to="/hq/reports" className="hq-btn hq-btn-secondary hq-btn-sm"><FileBarChart size={14} /> Enterprise Reports</Link>
      </div>

      <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Organization Health" value={healthLabel} icon={LayoutDashboard} variant="gold" />
        <KpiCard label="Financial Health" value={`${finance?.score ?? "—"}%`} icon={Wallet} />
        <KpiCard label="Cash Flow" value={fmt(finance?.cashFlow ?? 0)} icon={TrendingUp} variant={(finance?.cashFlow ?? 0) >= 0 ? "success" : "warning"} />
        <KpiCard label="Grant Pipeline" value={fmt(grants?.pipelineValue ?? 0)} icon={FileText} />
        <KpiCard label="Financial Risk" value={risk.data?.riskLevel ?? "—"} icon={AlertTriangle} variant={risk.data?.riskLevel === "high" ? "danger" : risk.data?.riskLevel === "moderate" ? "warning" : "success"} />
        <KpiCard label="Leadership Alerts" value={notifs.data?.unreadCount ?? 0} icon={Bell} variant={(notifs.data?.unreadCount ?? 0) > 0 ? "warning" : "muted"} />
      </div>

      <div className="hq-grid-2 hq-fade-in">
        <HqPanel title="Daily Executive Briefing" subtitle={briefing.data?.cached ? "Generated this morning" : "Live briefing"}>
          {briefing.data ? (
            <>
              <ul style={{ margin: "0 0 0.75rem", paddingLeft: "1.1rem", fontSize: "0.85rem", color: "var(--hq-text-muted)" }}>
                {(briefing.data.highlights ?? []).map((h) => <li key={h}>{h}</li>)}
              </ul>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.78rem", lineHeight: 1.55, maxHeight: 200, overflow: "auto", color: "var(--hq-text-muted)" }}>
                {briefing.data.content.slice(0, 1500)}
              </pre>
              <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" style={{ marginTop: "0.5rem" }} onClick={() => briefing.refetch()}>Refresh Briefing</button>
            </>
          ) : <HqLoading />}
        </HqPanel>

        <HqPanel title="Operational Anomalies" subtitle={`${anomalies.data?.anomalies.length ?? 0} detected`}>
          <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {(anomalies.data?.anomalies ?? []).slice(0, 6).map((a, i) => (
              <li key={i} className="hq-activity-item">
                <div className="hq-activity-content">
                  <div className="hq-activity-title">{a.title}</div>
                  <div className="hq-activity-detail">{a.module} · {a.detail}</div>
                </div>
                <StatusBadge label={a.severity} variant={a.severity === "high" ? "danger" : a.severity === "medium" ? "warning" : "muted"} />
              </li>
            ))}
            {!anomalies.data?.anomalies?.length && <li className="hq-muted-text">No anomalies detected</li>}
          </ul>
        </HqPanel>

        <HqPanel title="Cross-Domain Trend Analysis" subtitle={String(trends.data?.summary ?? "")}>
          <table className="hq-table">
            <thead><tr><th>Domain</th><th>Metric</th><th>Change</th><th>Status</th></tr></thead>
            <tbody>
              {series.map((s) => (
                <tr key={`${s.domain}-${s.metric}`}>
                  <td>{s.domain}</td>
                  <td>{s.metric}</td>
                  <td style={{ color: s.direction === "up" ? "var(--hq-success)" : s.direction === "down" ? "var(--hq-warning)" : "inherit" }}>
                    {s.changePct > 0 ? "+" : ""}{s.changePct}%
                  </td>
                  <td><StatusBadge label={s.status} variant={s.status === "positive" ? "success" : s.status === "watch" || s.status === "negative" ? "warning" : "muted"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Predictive KPI Dashboard" subtitle={`Overall trend: ${String(predictive.data?.overallTrend ?? "—")}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
            {((predictive.data?.kpis ?? []) as { label: string; value: number; unit: string; status: string; projectedStatus: string; changePct: number }[]).slice(0, 8).map((k) => (
              <div key={k.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.82rem" }}>
                <span>{k.label}</span>
                <span>
                  <strong style={{ color: "var(--hq-gold)", marginRight: "0.35rem" }}>{k.unit === "$" ? fmt(k.value) : `${k.value}${k.unit}`}</strong>
                  <StatusBadge label={k.projectedStatus ?? k.status} variant={k.projectedStatus === "on_track" ? "success" : k.projectedStatus === "at_risk" ? "danger" : "warning"} />
                </span>
              </div>
            ))}
          </div>
          <Link to="/hq/analytics?tab=kpi" className="hq-entity-link" style={{ display: "block", marginTop: "0.75rem" }}>Full KPI Monitor →</Link>
        </HqPanel>

        <HqPanel title="Financial Risk Assessment" subtitle={`Score: ${risk.data?.riskScore ?? "—"}/100`}>
          {risk.data ? (
            <>
              <StatusBadge label={`${risk.data.riskLevel} risk`} variant={risk.data.riskLevel === "high" ? "danger" : risk.data.riskLevel === "moderate" ? "warning" : "success"} />
              <ul style={{ marginTop: "0.75rem", fontSize: "0.85rem", paddingLeft: "1.1rem" }}>
                {risk.data.factors.map((f) => <li key={f}>{f}</li>)}
              </ul>
              <div style={{ marginTop: "0.75rem", fontSize: "0.82rem", color: "var(--hq-text-muted)" }}>
                <strong>Recommendations:</strong>
                <ul style={{ paddingLeft: "1.1rem" }}>{risk.data.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            </>
          ) : <HqLoading />}
        </HqPanel>

        <HqPanel title="Live Activity Feed">
          <ActivityFeed items={activity.data?.activity ?? []} linkable />
        </HqPanel>
      </div>

      <div className="hq-app-grid hq-fade-in" style={{ marginTop: "1.25rem" }}>
        {[
          { label: "Financial Center", to: "/hq/finance", icon: Wallet },
          { label: "Grant Center", to: "/hq/grants", icon: FileText },
          { label: "People & HR", to: "/hq/people", icon: Users },
          { label: "Programs", to: "/hq/programs", icon: Activity },
          { label: "Board Portal", to: "/hq/board", icon: Briefcase },
          { label: "Compliance", to: "/hq/compliance", icon: Shield },
        ].map((m) => (
          <Link key={m.to} to={m.to} className="hq-app-card hq-entity-link">
            <m.icon size={20} style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }} />
            <div className="hq-app-name">{m.label}</div>
          </Link>
        ))}
      </div>
    </HQLayout>
  );
};

export default FounderCommandCenterPage;
