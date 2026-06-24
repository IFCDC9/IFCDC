import React from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Award, FileText, AlertTriangle, Wallet, RefreshCw } from "lucide-react";
import { grantsApi } from "../../api/grantsApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../utils/safeFormat";

const fmt = formatCurrency;

export const GrantFundingEngineOverview: React.FC = () => {
  const overview = useQuery({
    queryKey: ["grant-funding-engine"],
    queryFn: grantsApi.fundingEngineOverview,
    staleTime: 60_000,
  });

  const aura = useQuery({
    queryKey: ["grant-funding-aura"],
    queryFn: () => grantsApi.fundingAura(),
    staleTime: 300_000,
  });

  const data = overview.data;
  if (overview.isLoading) return <HqLoading message="Loading funding engine…" />;

  const summary = data?.summary;
  const pipeline = data?.pipeline ?? [];
  const divisions = (data?.divisionFunding ?? []) as { division: string; opportunities: number; pipeline_value: number }[];

  return (
    <div className="hq-fade-in">
      <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Pipeline Value" value={fmt(summary?.pipelineValue ?? 0)} icon={TrendingUp} variant="gold" />
        <KpiCard label="Active Awards" value={summary?.activeAwards ?? 0} icon={Award} variant="success" />
        <KpiCard label="Open Opportunities" value={summary?.openOpportunities ?? 0} icon={FileText} />
        <KpiCard label="Win Rate" value={`${summary?.winRate ?? 0}%`} icon={TrendingUp} variant={(summary?.winRate ?? 0) >= 50 ? "success" : "warning"} />
        <KpiCard label="Compliance Due" value={summary?.complianceDue ?? 0} icon={AlertTriangle} variant={(summary?.complianceDue ?? 0) > 0 ? "warning" : "success"} />
        <KpiCard label="Grant Budgets" value={fmt(data?.budgetIntegration?.allocated ?? 0)} icon={Wallet} meta={`${fmt(data?.budgetIntegration?.spent ?? 0)} spent`} />
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1.25rem" }}>
        <HqPanel title="Funding Pipeline" subtitle="Live stages across IFCDC grant portfolio">
          <div className="hq-pipeline">
            {pipeline.map((stage) => (
              <div key={stage.stage} className="hq-pipeline-stage">
                <div className="hq-pipeline-label">{stage.stage}</div>
                <div className="hq-pipeline-meta">{stage.count} · {fmt(stage.value ?? 0)}</div>
              </div>
            ))}
            {!pipeline.length && <p className="hq-muted-text">No pipeline data yet</p>}
          </div>
        </HqPanel>

        <HqPanel title="Division Funding Map" subtitle="Open opportunities by IFCDC division">
          <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {divisions.slice(0, 8).map((d) => (
              <li key={d.division} className="hq-activity-item">
                <div className="hq-activity-content">
                  <div className="hq-activity-title">{String(d.division).replace(/_/g, " ")}</div>
                  <div className="hq-activity-detail">{d.opportunities} opportunities</div>
                </div>
                <span style={{ color: "var(--hq-gold)", fontWeight: 600 }}>{fmt(d.pipeline_value ?? 0)}</span>
              </li>
            ))}
            {!divisions.length && <li className="hq-muted-text">Division tags will appear as opportunities are enriched</li>}
          </ul>
        </HqPanel>
      </div>

      <HqPanel title="AURA Funding Intelligence" subtitle="Executive priorities for sustainable funding">
        {aura.isLoading ? (
          <HqLoading />
        ) : (
          <>
            <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" style={{ marginBottom: "0.5rem" }} onClick={() => aura.refetch()}>
              <RefreshCw size={14} /> Refresh briefing
            </button>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.85rem", lineHeight: 1.65, color: "var(--hq-text-muted)", margin: 0 }}>
              {aura.data?.insight ?? "Funding intelligence will generate on next request."}
            </pre>
          </>
        )}
      </HqPanel>

      {(data?.topEligibilityScores?.length ?? 0) > 0 && (
        <div style={{ marginTop: "1.25rem" }}>
          <HqPanel title="Top Eligibility Scores" subtitle="Recent AI-scored opportunities">
            <table className="hq-table">
              <thead>
                <tr><th>Opportunity</th><th>Funder</th><th>Score</th><th>Grade</th></tr>
              </thead>
              <tbody>
                {(data?.topEligibilityScores ?? []).map((s) => (
                  <tr key={String(s.opportunity_id)}>
                    <td>{String(s.title ?? "—")}</td>
                    <td>{String(s.funder ?? "—")}</td>
                    <td><StatusBadge label={`${s.score}%`} variant="gold" /></td>
                    <td>{String(s.grade ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HqPanel>
        </div>
      )}
    </div>
  );
};
