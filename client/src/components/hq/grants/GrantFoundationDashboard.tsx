import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Award, Calendar, CheckCircle, FileText, FolderOpen, Target, TrendingUp, AlertTriangle,
} from "lucide-react";
import { grantsApi, type GrantFoundationDashboard } from "../../../api/grantsApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";
import { StatusBadge } from "../StatusBadge";

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
}

function complianceVariant(status: string): "success" | "warning" | "danger" {
  if (status === "healthy") return "success";
  if (status === "watch") return "warning";
  return "danger";
}

export const GrantFoundationDashboardPanel: React.FC<{
  onOpenPipeline?: () => void;
  onOpenCalendar?: () => void;
  onOpenDocuments?: () => void;
}> = ({ onOpenPipeline, onOpenCalendar, onOpenDocuments }) => {
  const foundation = useQuery({
    queryKey: ["grant-foundation-dashboard"],
    queryFn: grantsApi.foundationDashboard,
    staleTime: 30_000,
    retry: 0,
  });

  const report = useQuery({
    queryKey: ["grant-foundation-report"],
    queryFn: grantsApi.foundationReport,
    staleTime: 60_000,
    retry: 0,
  });

  if (foundation.isLoading) return <HqLoading message="Loading executive grant dashboard…" />;

  const d = foundation.data as GrantFoundationDashboard | undefined;
  if (!d) {
    return (
      <HqPanel title="Grant Foundation Dashboard" subtitle="Unable to load live funding metrics">
        <p className="hq-muted-text">Retry the Grant Center overview after confirming API connectivity.</p>
        <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={() => void foundation.refetch()}>Retry</button>
      </HqPanel>
    );
  }

  return (
    <div className="hq-fade-in">
      <HqPanel
        title="Executive Grant Dashboard"
        subtitle="Build 59 foundation — live funding engine for IFCDC HQ"
        headerExtra={
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={onOpenPipeline}>Pipeline</button>
            <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={onOpenCalendar}>Calendar</button>
            <Link to="/hq/documents?category=grants" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={onOpenDocuments}>
              <FolderOpen size={12} /> Documents
            </Link>
          </div>
        }
      >
        <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
          <KpiCard label="Total Active Grants" value={d.totalActiveGrants} icon={Award} variant="success" />
          <KpiCard label="Grants Awarded" value={d.grantsAwarded} icon={CheckCircle} variant="gold" />
          <KpiCard label="Pending Applications" value={d.pendingApplications} icon={FileText} variant="warning" />
          <KpiCard label="Funding Requested" value={fmt(d.totalFundingRequested)} icon={TrendingUp} />
          <KpiCard label="Funding Awarded" value={fmt(d.totalFundingAwarded)} icon={Award} variant="gold" />
          <KpiCard label="Upcoming Deadlines" value={d.upcomingDeadlines} icon={Calendar} variant={d.upcomingDeadlines > 0 ? "warning" : "success"} />
          <KpiCard label="Success Rate" value={`${d.successRate}%`} icon={Target} variant="gold" />
          <KpiCard
            label="Compliance"
            value={d.complianceStatus.status}
            icon={AlertTriangle}
            variant={complianceVariant(d.complianceStatus.status)}
            meta={`${d.complianceStatus.dueSoon} due · ${d.complianceStatus.overdue} overdue`}
          />
        </div>

        <div className="hq-grid-2">
          <div>
            <h4 style={{ fontSize: "0.8rem", color: "var(--hq-text-dim)", marginBottom: "0.5rem" }}>Submission Status</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              <StatusBadge label={`Drafting ${d.submissionStatus.drafting}`} variant="muted" />
              <StatusBadge label={`Internal Review ${d.submissionStatus.internalReview}`} variant="warning" />
              <StatusBadge label={`Submitted ${d.submissionStatus.submitted}`} variant="gold" />
              <StatusBadge label={`Under Evaluation ${d.submissionStatus.underEvaluation}`} variant="warning" />
            </div>
          </div>
          <div>
            <h4 style={{ fontSize: "0.8rem", color: "var(--hq-text-dim)", marginBottom: "0.5rem" }}>Funding Sources</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {d.funderTypeBreakdown.filter((f) => f.count > 0).map((f) => (
                <StatusBadge key={f.type} label={`${f.label} ${f.count}`} variant="gold" />
              ))}
              {!d.funderTypeBreakdown.some((f) => f.count > 0) && (
                <span className="hq-muted-text" style={{ fontSize: "0.78rem" }}>No open opportunities categorized yet</span>
              )}
            </div>
          </div>
        </div>
      </HqPanel>

      <div style={{ marginTop: "1rem" }}>
        <HqPanel title="Grant Lifecycle Pipeline" subtitle="Opportunity Identified → Closed">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.5rem" }}>
            {d.pipelineByProductStage.map((stage) => (
              <div key={stage.id} className="hq-panel" style={{ padding: "0.75rem" }}>
                <div style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>{stage.label}</div>
                <div style={{ fontSize: "1.25rem", color: "var(--hq-gold)", fontWeight: 600 }}>{stage.count}</div>
                <div className="hq-muted-text" style={{ fontSize: "0.7rem" }}>{fmt(stage.value)}</div>
              </div>
            ))}
          </div>
        </HqPanel>
      </div>

      {report.data && (
        <div style={{ marginTop: "1rem" }}>
          <HqPanel title="Executive Funding Report" subtitle="Forecast, award pipeline, and performance">
            <div className="hq-kpi-grid" style={{ marginBottom: "0.75rem" }}>
              <KpiCard label="Open Opportunities" value={report.data.activeOpportunities} />
              <KpiCard label="Award Pipeline Stages" value={report.data.awardPipeline?.length ?? 0} />
              <KpiCard label="Forecast Months" value={report.data.forecast?.length ?? 0} />
            </div>
            <ul className="hq-activity-list">
              {(report.data.upcomingDeadlines ?? []).slice(0, 6).map((e) => (
                <li key={String(e.id)} className="hq-activity-item">
                  <div className="hq-activity-content">
                    <div className="hq-activity-title">{String(e.title ?? "Deadline")}</div>
                    <div className="hq-activity-detail">{String(e.category ?? e.event_type ?? "")}</div>
                  </div>
                  <div className="hq-activity-time">{String(e.due_date ?? "")}</div>
                </li>
              ))}
            </ul>
          </HqPanel>
        </div>
      )}
    </div>
  );
};

export const GrantFoundationPipelineBoard: React.FC<{
  onOpenApplication?: (id: string) => void;
}> = ({ onOpenApplication }) => {
  const board = useQuery({
    queryKey: ["grant-foundation-pipeline"],
    queryFn: grantsApi.foundationPipeline,
    staleTime: 20_000,
    retry: 0,
  });

  if (board.isLoading) return <HqLoading message="Loading grant pipeline…" />;
  const stages = board.data?.stages ?? [];

  return (
    <HqPanel title="Foundation Lifecycle Board" subtitle="Ten-stage enterprise grant pipeline with audit-ready stages">
      <div style={{ display: "flex", gap: "0.65rem", overflowX: "auto", paddingBottom: "0.5rem" }}>
        {stages.map((stage) => (
          <div key={stage.id} style={{ minWidth: 200, flex: "0 0 200px" }} className="hq-panel">
            <div style={{ padding: "0.65rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <strong style={{ fontSize: "0.78rem", color: "var(--hq-gold)" }}>{stage.label}</strong>
              <div className="hq-muted-text" style={{ fontSize: "0.7rem" }}>{stage.cards.length} grants</div>
            </div>
            <div style={{ padding: "0.5rem", maxHeight: 360, overflowY: "auto" }}>
              {stage.cards.map((card) => (
                <button
                  key={String(card.id)}
                  type="button"
                  className="hq-panel"
                  style={{ width: "100%", textAlign: "left", padding: "0.55rem", marginBottom: "0.4rem", cursor: "pointer" }}
                  onClick={() => onOpenApplication?.(String(card.id))}
                >
                  <div style={{ fontSize: "0.8rem", color: "var(--hq-gold)" }}>{String(card.title)}</div>
                  <div className="hq-muted-text" style={{ fontSize: "0.7rem" }}>
                    {fmt(Number(card.amount) || 0)} · {String(card.funderType ?? "—")}
                  </div>
                </button>
              ))}
              {!stage.cards.length && <p className="hq-muted-text" style={{ fontSize: "0.72rem" }}>No items</p>}
            </div>
          </div>
        ))}
      </div>
    </HqPanel>
  );
};

export const GrantFoundationCalendarPanel: React.FC = () => {
  const calendar = useQuery({
    queryKey: ["grant-foundation-calendar"],
    queryFn: () => grantsApi.foundationCalendar(90),
    staleTime: 30_000,
    retry: 0,
  });

  if (calendar.isLoading) return <HqLoading message="Loading grant calendar…" />;
  const data = calendar.data;

  return (
    <HqPanel title="Grant Calendar & Milestones" subtitle="Submissions, reporting, renewals, reviews, compliance">
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <StatusBadge label={`Submission ${data?.counts.submission ?? 0}`} variant="gold" />
        <StatusBadge label={`Reporting ${data?.counts.reporting ?? 0}`} variant="warning" />
        <StatusBadge label={`Renewal ${data?.counts.renewal ?? 0}`} variant="muted" />
        <StatusBadge label={`Internal ${data?.counts.internal ?? 0}`} variant="muted" />
      </div>
      <ul className="hq-activity-list">
        {(data?.events ?? []).slice(0, 20).map((e) => (
          <li key={`${e.id}-${e.due_date}`} className="hq-activity-item">
            <div className="hq-activity-content">
              <div className="hq-activity-title">{String(e.title ?? "Event")}</div>
              <div className="hq-activity-detail">{String(e.category ?? "")}</div>
            </div>
            <div className="hq-activity-time">{String(e.due_date ?? "")}</div>
          </li>
        ))}
        {!(data?.events ?? []).length && <li className="hq-muted-text">No upcoming milestones in the next 90 days</li>}
      </ul>
    </HqPanel>
  );
};
