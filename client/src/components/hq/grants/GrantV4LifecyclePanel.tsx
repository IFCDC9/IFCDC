import React from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, TrendingUp } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

export const GrantV4LifecyclePanel: React.FC = () => {
  const lifecycle = useQuery({
    queryKey: ["grant-v5-lifecycle"],
    queryFn: grantsApi.v5Lifecycle,
    staleTime: 30_000,
  });

  if (lifecycle.isLoading) return <HqLoading message="Loading grant lifecycle…" />;

  const stages = lifecycle.data?.stages ?? [];
  const maxValue = Math.max(...stages.map((s) => s.value), lifecycle.data?.totalValue ?? 1, 1);

  return (
    <div className="hq-fade-in">
      <HqPanel title="Grant Lifecycle" subtitle="Prospect → Eligibility Review → Internal Approval → Application Drafting → Submitted → Under Review → Awarded → Active Grant → Reporting → Closeout → Renewal">
        <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
          <KpiCard label="Total Lifecycle Value" value={fmt(lifecycle.data?.totalValue)} icon={TrendingUp} variant="gold" />
          <KpiCard label="Lifecycle Stages" value={stages.length} icon={GitBranch} />
        </div>
        <div className="hq-pipeline">
          {stages.map((stage) => (
            <div key={stage.stageKey} className="hq-pipeline-stage">
              <div className="hq-pipeline-label">{stage.stage}</div>
              <div className="hq-pipeline-bar">
                <div style={{ width: `${Math.min(100, (stage.value / maxValue) * 100)}%` }} />
              </div>
              <div className="hq-pipeline-meta">{stage.count} · {fmt(stage.value)}</div>
            </div>
          ))}
        </div>
      </HqPanel>
    </div>
  );
};
