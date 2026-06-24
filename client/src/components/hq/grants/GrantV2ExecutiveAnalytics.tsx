import React from "react";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, TrendingUp, Clock, AlertTriangle, Target } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

export const GrantV2ExecutiveAnalytics: React.FC = () => {
  const analytics = useQuery({
    queryKey: ["grant-v2-analytics"],
    queryFn: grantsApi.v2Analytics,
    staleTime: 60_000,
  });

  if (analytics.isLoading) return <HqLoading message="Loading executive funding analytics…" />;

  const data = analytics.data;
  if (!data) return null;

  return (
    <div className="hq-fade-in">
      <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Total Requested" value={fmt(data.totalRequested)} icon={DollarSign} variant="gold" />
        <KpiCard label="Total Awarded" value={fmt(data.totalAwarded)} icon={TrendingUp} variant="success" />
        <KpiCard label="Pending Review" value={fmt(data.totalPending)} icon={Clock} variant="warning" />
        <KpiCard label="Projected Revenue" value={fmt(data.projectedRevenue)} icon={Target} meta={`${data.winRate}% win rate`} />
        <KpiCard label="Identified Pipeline" value={fmt(data.identifiedValue)} meta="Live opportunities" />
        <KpiCard label="Deadlines (30d)" value={data.upcomingDeadlines} icon={Clock} variant={data.upcomingDeadlines > 0 ? "warning" : "success"} />
        <KpiCard label="Compliance Due" value={data.complianceDue} icon={AlertTriangle} variant={data.complianceDue > 0 ? "danger" : "success"} />
        <KpiCard label="Total Funding Gap" value={fmt(data.totalFundingGap)} icon={AlertTriangle} variant={data.totalFundingGap > 0 ? "warning" : "success"} />
      </div>

      <HqPanel title="Division Funding Gaps" subtitle="Goal minus awarded and pipeline — priority areas for grant pursuit">
        <table className="hq-table">
          <thead>
            <tr><th>Division</th><th>Funding Goal</th><th>Awarded</th><th>Pipeline</th><th>Gap</th></tr>
          </thead>
          <tbody>
            {data.fundingGaps.map((g) => (
              <tr key={g.division}>
                <td><strong>{g.label}</strong></td>
                <td>{fmt(g.fundingGoal)}</td>
                <td>{fmt(g.awardedTotal)}</td>
                <td>{fmt(g.pipelineValue)}</td>
                <td style={{ color: g.gap > 0 ? "var(--hq-warning)" : "var(--hq-success)", fontWeight: 600 }}>{fmt(g.gap)}</td>
              </tr>
            ))}
            {!data.fundingGaps.length && (
              <tr><td colSpan={5} className="hq-empty-cell">Division profiles will populate funding gaps as programs connect.</td></tr>
            )}
          </tbody>
        </table>
      </HqPanel>
    </div>
  );
};
