import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, Clock, Target, FileText, Sparkles, Calendar, AlertTriangle, Building2,
} from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

export const GrantV3ExecutiveDashboard: React.FC = () => {
  const platform = useQuery({
    queryKey: ["grant-v3-platform"],
    queryFn: grantsApi.v3Platform,
    staleTime: 45_000,
  });

  if (platform.isLoading) return <HqLoading message="Loading Intelligent Funding Engine…" />;

  const data = platform.data;
  if (!data) return null;

  const exec = data.executive as Record<string, unknown>;
  const discovery = data.discovery as { topRecommendations?: Record<string, unknown>[] };
  const pipeline = data.pipeline as { stages?: { stage: string; count: number; value: number }[] } | undefined;
  const gaps = (exec.fundingGapByProgram ?? []) as { label: string; gap: number; awardedFunding: number }[];
  const renewals = exec.renewalCalendar as { events?: { type: string; date: string; title: string; amount: number }[]; upcoming90Days?: number } | undefined;
  const maxStage = Math.max(...(pipeline?.stages?.map((s) => s.value) ?? [1]), 1);

  return (
    <div className="hq-fade-in">
      <HqPanel
        title="Intelligent Funding Engine"
        subtitle="Grant Center v3 — AI discovery, executive pipeline, program gaps, and renewal calendar"
      >
        <StatusBadge label="v3 EXECUTIVE" variant="gold" />
        <div className="hq-kpi-grid" style={{ marginTop: "1rem" }}>
          <KpiCard label="Total Opportunities" value={Number(exec.totalOpportunities ?? 0)} icon={FileText} variant="success" />
          <KpiCard label="Funding Requested" value={fmt(Number(exec.totalFundingRequested ?? 0))} icon={DollarSign} variant="gold" />
          <KpiCard label="Funding Awarded" value={fmt(Number(exec.totalFundingAwarded ?? 0))} icon={TrendingUp} variant="success" />
          <KpiCard label="Pending Applications" value={Number(exec.pendingApplications ?? 0)} icon={Clock} variant="warning" meta={fmt(Number(exec.totalPendingValue ?? 0))} />
          <KpiCard label="Upcoming Deadlines" value={Number(exec.upcomingDeadlines ?? 0)} icon={Clock} variant={Number(exec.upcomingDeadlines) > 0 ? "warning" : "success"} meta="30 days" />
          <KpiCard label="Annual Pipeline Est." value={fmt(Number(exec.estimatedAnnualPipeline ?? 0))} icon={Target} variant="gold" meta={`${exec.winRate ?? 0}% win rate`} />
        </div>
      </HqPanel>

      <div style={{ marginTop: "1.25rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "1.25rem" }}>
        <HqPanel title="AI Priority Grants" subtitle="Ranked by eligibility and strategic value to IFCDC">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            {(discovery?.topRecommendations ?? []).slice(0, 5).map((g) => (
              <div key={String(g.id)} className="hq-panel" style={{ padding: "0.75rem 1rem" }}>
                <div style={{ fontWeight: 600 }}>{String(g.title)}</div>
                <div className="hq-muted-text" style={{ fontSize: "0.82rem" }}>{String(g.funder)}</div>
                <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                  <StatusBadge label={`Priority ${g.priorityScore}%`} variant="gold" />
                  <StatusBadge label={String(g.recommendation)} variant="success" />
                  <StatusBadge label={`Eligibility ${g.eligibilityScore}%`} variant="muted" />
                  <StatusBadge label={`Strategic ${g.strategicFitScore}%`} variant="muted" />
                </div>
              </div>
            ))}
            {!discovery?.topRecommendations?.length && (
              <p className="hq-muted-text">Run AI discovery on the Opportunities tab to rank grants.</p>
            )}
          </div>
        </HqPanel>

        <HqPanel title="Renewal Calendar" subtitle={`${renewals?.upcoming90Days ?? 0} events in next 90 days`}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.75rem" }}>
            <Calendar size={16} style={{ color: "var(--hq-gold)" }} />
            <span className="hq-muted-text" style={{ fontSize: "0.82rem" }}>Renewals and grant period expirations</span>
          </div>
          {(renewals?.events ?? []).slice(0, 6).map((e, i) => (
            <div key={i} className="hq-activity-item" style={{ padding: "0.5rem 0" }}>
              <div className="hq-activity-content">
                <div className="hq-activity-title">{e.title}</div>
                <div className="hq-activity-detail">{e.date ? new Date(e.date).toLocaleDateString() : "—"} · {e.type} · {fmt(e.amount)}</div>
              </div>
            </div>
          ))}
          {!renewals?.events?.length && <p className="hq-muted-text">No renewals scheduled — active awards will appear here.</p>}
        </HqPanel>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Funding Gap by Program" subtitle="Division-level gaps driving grant pursuit priorities">
          <table className="hq-table">
            <thead>
              <tr><th>Program</th><th>Awarded</th><th>Gap</th></tr>
            </thead>
            <tbody>
              {gaps.slice(0, 11).map((g) => (
                <tr key={g.label}>
                  <td><Building2 size={14} style={{ marginRight: "0.35rem", verticalAlign: "middle" }} />{g.label}</td>
                  <td>{fmt(g.awardedFunding)}</td>
                  <td style={{ color: g.gap > 0 ? "var(--hq-warning)" : "var(--hq-success)", fontWeight: 600 }}>{fmt(g.gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>
      </div>

      {pipeline?.stages && (
        <div style={{ marginTop: "1.25rem" }}>
          <HqPanel title="Funding Pipeline" subtitle="End-to-end grant lifecycle">
            <div className="hq-pipeline">
              {pipeline.stages.map((stage) => (
                <div key={stage.stage} className="hq-pipeline-stage">
                  <div className="hq-pipeline-label">{stage.stage}</div>
                  <div className="hq-pipeline-bar">
                    <div style={{ width: `${Math.min(100, (stage.value / maxStage) * 100)}%` }} />
                  </div>
                  <div className="hq-pipeline-meta">{stage.count} · {fmt(stage.value)}</div>
                </div>
              ))}
            </div>
          </HqPanel>
        </div>
      )}

      {Number(exec.complianceDue) > 0 && (
        <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--hq-warning)" }}>
          <AlertTriangle size={16} />
          {Number(exec.complianceDue)} compliance reports due within 14 days
        </div>
      )}
    </div>
  );
};
