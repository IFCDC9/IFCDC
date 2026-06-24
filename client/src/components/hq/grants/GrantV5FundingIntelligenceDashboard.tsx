import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, Target, Shield, Activity, BarChart3, Sparkles,
} from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

export const GrantV5FundingIntelligenceDashboard: React.FC = () => {
  const platform = useQuery({
    queryKey: ["grant-v5-platform"],
    queryFn: grantsApi.v5Platform,
    staleTime: 45_000,
  });
  const intelligence = useQuery({
    queryKey: ["grant-v5-intelligence"],
    queryFn: grantsApi.v5ExecutiveIntelligence,
    staleTime: 60_000,
  });

  if (platform.isLoading || intelligence.isLoading) {
    return <HqLoading message="Loading Funding Intelligence Engine…" />;
  }

  const intel = intelligence.data;
  const ops = platform.data?.operations as { pipelineValue?: number; totalAwarded?: number; totalPending?: number } | undefined;
  const national = platform.data?.nationalDatabase as { count?: number } | undefined;

  return (
    <div className="hq-fade-in">
      <HqPanel title="Funding Intelligence Engine" subtitle="Grant Center v5 — national database, scoring, projections, and executive intelligence">
        <StatusBadge label="v5 INTELLIGENCE" variant="gold" />
        <div className="hq-kpi-grid" style={{ marginTop: "1rem" }}>
          <KpiCard label="Pipeline Value" value={fmt(Number(ops?.pipelineValue ?? 0))} icon={Target} variant="gold" />
          <KpiCard label="Total Awarded" value={fmt(Number(ops?.totalAwarded ?? 0))} icon={TrendingUp} variant="success" />
          <KpiCard label="Total Pending" value={fmt(Number(ops?.totalPending ?? 0))} icon={DollarSign} variant="warning" />
          <KpiCard label="National Opps" value={national?.count ?? 0} icon={BarChart3} />
          <KpiCard
            label="Sustainability Index"
            value={`${intel?.organizationSustainabilityIndex ?? 0}/100`}
            icon={Activity}
            variant={(intel?.organizationSustainabilityIndex ?? 0) >= 70 ? "success" : "warning"}
          />
          <KpiCard label="Award Probability" value={`${intel?.awardProbabilityScore ?? 0}%`} icon={Sparkles} variant="gold" />
        </div>
      </HqPanel>

      {intel && (
        <>
          <div style={{ marginTop: "1.25rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.25rem" }}>
            <HqPanel title="Monthly Funding Forecast">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {intel.monthlyFundingForecast.slice(0, 6).map((m) => (
                  <div key={m.month} className="hq-panel" style={{ padding: "0.6rem 0.8rem" }}>
                    <div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>{m.month}</div>
                    <div style={{ fontWeight: 700, color: "var(--hq-gold)" }}>{fmt(m.projected)}</div>
                  </div>
                ))}
              </div>
            </HqPanel>

            <HqPanel title="Cash Flow Projections">
              <table className="hq-table">
                <thead><tr><th>Month</th><th>Inflow</th><th>Outflow</th><th>Net</th></tr></thead>
                <tbody>
                  {intel.cashFlowProjections.slice(0, 4).map((c) => (
                    <tr key={c.month}>
                      <td>{c.month}</td>
                      <td>{fmt(c.inflow)}</td>
                      <td>{fmt(c.outflow)}</td>
                      <td style={{ color: c.net >= 0 ? "var(--hq-success)" : "var(--hq-warning)" }}>{fmt(c.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </HqPanel>
          </div>

          <div style={{ marginTop: "1.25rem" }}>
            <HqPanel title="Funding Gap Analysis" subtitle="Programs with the largest unmet funding need">
              <table className="hq-table">
                <thead><tr><th>Program</th><th>Gap</th><th>Gap %</th></tr></thead>
                <tbody>
                  {intel.fundingGapAnalysis.slice(0, 10).map((g) => (
                    <tr key={g.label}>
                      <td>{g.label}</td>
                      <td style={{ color: "var(--hq-warning)" }}>{fmt(g.gap)}</td>
                      <td>{g.gapPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </HqPanel>
          </div>

          <div style={{ marginTop: "1.25rem" }}>
            <HqPanel title="Multi-Year Funding Projections" subtitle={`5-year total: ${fmt(intel.multiYearProjections.fiveYearTotal)}`}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {intel.multiYearProjections.years.map((y) => (
                  <div key={y.year} className="hq-panel" style={{ padding: "0.65rem 0.85rem" }}>
                    <div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>{y.year}</div>
                    <div style={{ fontWeight: 700 }}>{fmt(y.projectedFunding)}</div>
                  </div>
                ))}
              </div>
            </HqPanel>
          </div>

          <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Shield size={16} style={{ color: intel.complianceSummary.status === "healthy" ? "var(--hq-success)" : "var(--hq-warning)" }} />
            Compliance: {intel.complianceSummary.status} · Health score {intel.complianceSummary.healthScore}/100
          </div>
        </>
      )}
    </div>
  );
};
