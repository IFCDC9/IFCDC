import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, Clock, Target, FileText, Sparkles, Wallet, AlertTriangle, CheckCircle,
} from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

const STATUS_VARIANT: Record<string, "gold" | "success" | "warning" | "danger" | "muted"> = {
  identified: "muted",
  reviewing: "warning",
  eligible: "success",
  in_progress: "gold",
  submitted: "gold",
  awarded: "success",
  declined: "danger",
  renewal: "gold",
};

export const GrantFundingEngineDashboard: React.FC = () => {
  const dashboard = useQuery({
    queryKey: ["grant-funding-engine-dashboard"],
    queryFn: grantsApi.v2Dashboard,
    staleTime: 45_000,
  });

  if (dashboard.isLoading) return <HqLoading message="Loading IFCDC Funding Engine…" />;

  const data = dashboard.data;
  if (!data) return null;

  const { totals, pipeline, profiles, finance, auraRecommendations } = data;
  const maxStageValue = Math.max(...(pipeline.stages?.map((s) => s.value) ?? [1]), 1);

  return (
    <div className="hq-fade-in">
      <HqPanel
        title="IFCDC Funding Engine"
        subtitle="Live opportunity database · AI grant matching · pipeline totals · Finance integration"
      >
        <div className="hq-kpi-grid">
          <KpiCard label="Total Opportunities" value={totals.totalOpportunities} icon={FileText} variant="success" />
          <KpiCard label="Total Requested" value={fmt(totals.totalRequested)} icon={DollarSign} variant="gold" />
          <KpiCard label="Total Awarded" value={fmt(totals.totalAwarded)} icon={TrendingUp} variant="success" />
          <KpiCard label="Total Pending" value={fmt(totals.totalPending)} icon={Clock} variant="warning" />
          <KpiCard
            label="Upcoming Deadlines"
            value={totals.upcomingDeadlines}
            icon={Clock}
            variant={totals.upcomingDeadlines > 0 ? "warning" : "success"}
            meta="Next 30 days"
          />
        </div>
      </HqPanel>

      <div style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Funding Pipeline" subtitle="Identified → Reviewing → Eligible → In Progress → Submitted → Awarded → Declined → Renewal">
          <div className="hq-pipeline">
            {(pipeline.stages ?? []).map((stage) => (
              <div key={stage.statusKey} className="hq-pipeline-stage">
                <div className="hq-pipeline-label">{stage.stage}</div>
                <div className="hq-pipeline-bar">
                  <div style={{ width: `${Math.min(100, (stage.value / maxStageValue) * 100)}%` }} />
                </div>
                <div className="hq-pipeline-meta">{stage.count} · {fmt(stage.value)}</div>
              </div>
            ))}
          </div>
        </HqPanel>
      </div>

      <div style={{ marginTop: "1.25rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.25rem" }}>
        <HqPanel title="Program Funding Profiles" subtitle="IFCDC division funding goals and pipeline">
          <table className="hq-table">
            <thead>
              <tr><th>Program</th><th>Goal</th><th>Awarded</th><th>Gap</th></tr>
            </thead>
            <tbody>
              {(profiles ?? []).slice(0, 10).map((p) => (
                <tr key={p.slug}>
                  <td>
                    <strong>{p.label}</strong>
                    {p.readOnly && <StatusBadge label="LOCKED" variant="muted" />}
                  </td>
                  <td>{fmt(p.fundingGoal)}</td>
                  <td>{fmt(p.awardedTotal)}</td>
                  <td style={{ color: p.fundingGap > 0 ? "var(--hq-warning)" : "var(--hq-success)" }}>{fmt(p.fundingGap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Finance Connection" subtitle="Budgets, spending, restrictions, and compliance">
          <div className="hq-kpi-grid" style={{ marginBottom: "0.75rem" }}>
            <KpiCard label="Linked Budgets" value={finance.linkedBudgets} icon={Wallet} />
            <KpiCard label="Allocated" value={fmt(finance.totalAllocated)} icon={DollarSign} variant="gold" />
            <KpiCard label="Spent" value={fmt(finance.totalSpent)} icon={TrendingUp} />
            <KpiCard label="Remaining" value={fmt(finance.totalRemaining)} icon={Target} variant="success" />
          </div>
          {finance.complianceDue > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", color: "var(--hq-warning)" }}>
              <AlertTriangle size={16} />
              {finance.complianceDue} compliance report{finance.complianceDue !== 1 ? "s" : ""} due within 14 days
            </div>
          )}
          {finance.spendingAlerts > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", color: "var(--hq-danger)" }}>
              <AlertTriangle size={16} />
              {finance.spendingAlerts} grant budget{finance.spendingAlerts !== 1 ? "s" : ""} above 85% utilization
            </div>
          )}
          {(finance.budgetRestrictions ?? []).slice(0, 4).map((r) => (
            <div key={r.awardId} className="hq-muted-text" style={{ fontSize: "0.82rem", marginBottom: "0.35rem" }}>
              {r.title}: {fmt(r.spent)} / {fmt(r.allocated)} spent · {fmt(r.remaining)} remaining
            </div>
          ))}
        </HqPanel>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <HqPanel title="AURA Funding Recommendations" subtitle="Priority grants and strategic actions based on IFCDC programs">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
            {(auraRecommendations.actions ?? []).map((action) => (
              <div key={action} style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" }}>
                <CheckCircle size={14} style={{ color: "var(--hq-gold)" }} />
                {action}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            {(auraRecommendations.priorityGrants ?? []).map((g) => (
              <div key={String(g.id)} className="hq-panel" style={{ padding: "0.75rem 1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{g.title}</div>
                    <div className="hq-muted-text" style={{ fontSize: "0.82rem" }}>{g.funder}</div>
                    <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                      {g.fundingStatus && (
                        <StatusBadge label={String(g.fundingStatus).replace(/_/g, " ")} variant={STATUS_VARIANT[String(g.fundingStatus)] ?? "muted"} />
                      )}
                      {g.eligibilityScore != null && (
                        <StatusBadge label={`Eligibility ${g.eligibilityScore}%`} variant="success" />
                      )}
                      {g.strategicFitScore != null && Number(g.strategicFitScore) > 0 && (
                        <StatusBadge label={`Strategic Fit ${g.strategicFitScore}%`} variant="gold" />
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "var(--hq-gold)", fontWeight: 700 }}>{fmt(Number(g.amount ?? 0))}</div>
                    {g.deadline && (
                      <div className="hq-muted-text" style={{ fontSize: "0.82rem" }}>
                        Due {new Date(String(g.deadline)).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!auraRecommendations.priorityGrants?.length && (
              <p className="hq-muted-text">Score live opportunities to generate AURA priority grant recommendations.</p>
            )}
          </div>
          <div style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.35rem" }} className="hq-muted-text">
            <Sparkles size={14} style={{ color: "var(--hq-gold)" }} />
            Capacity estimate: {fmt(auraRecommendations.capacityEstimate ?? 0)} · {auraRecommendations.programProfiles ?? 0} program profiles active
          </div>
        </HqPanel>
      </div>
    </div>
  );
};
