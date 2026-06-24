import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { grantsApi, type GrantApplication } from "../../../api/grantsApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

const STAGE_MAP: Record<string, { appStatus?: string; tab?: string; fundingStatus?: string }> = {
  Identified: { tab: "opportunities", fundingStatus: "identified" },
  Reviewing: { tab: "opportunities", fundingStatus: "reviewing" },
  Eligible: { tab: "opportunities", fundingStatus: "eligible" },
  "In Progress": { appStatus: "draft" },
  Submitted: { appStatus: "submitted" },
  Awarded: { appStatus: "awarded" },
  Declined: { appStatus: "denied" },
  Renewal: { tab: "deadlines" },
};

export const GrantV2PipelineDashboard: React.FC<{
  onNavigate?: (tab: string, applicationId?: string) => void;
}> = ({ onNavigate }) => {
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

  const pipeline = useQuery({
    queryKey: ["grant-v2-pipeline"],
    queryFn: grantsApi.v2Pipeline,
    staleTime: 30_000,
  });
  const applications = useQuery({
    queryKey: ["grants-applications"],
    queryFn: grantsApi.applications,
    staleTime: 30_000,
  });

  const filteredApps = useMemo(() => {
    const apps = applications.data?.applications ?? [];
    const map = selectedStage ? STAGE_MAP[selectedStage] : null;
    if (!map?.appStatus) return [];
    return apps.filter((a) => a.status === map.appStatus);
  }, [applications.data, selectedStage]);

  if (pipeline.isLoading) return <HqLoading message="Loading funding pipeline…" />;

  const stages = pipeline.data?.stages ?? [];
  const maxValue = Math.max(...stages.map((s) => s.value), pipeline.data?.totalValue ?? 1, 1);

  return (
    <div className="hq-fade-in">
      <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Total Pipeline Value" value={fmt(pipeline.data?.totalValue)} icon={TrendingUp} variant="gold" />
      </div>

      <HqPanel title="Funding Pipeline" subtitle="Identified → Reviewing → Eligible → In Progress → Submitted → Awarded → Declined → Renewal">
        <div className="hq-pipeline">
          {stages.map((stage) => (
            <button
              key={stage.stage}
              type="button"
              className="hq-pipeline-stage"
              style={{
                cursor: "pointer",
                border: selectedStage === stage.stage ? "1px solid var(--hq-gold)" : undefined,
                background: selectedStage === stage.stage ? "rgba(212,175,55,0.06)" : undefined,
              }}
              onClick={() => {
                const next = selectedStage === stage.stage ? null : stage.stage;
                setSelectedStage(next);
                const map = next ? STAGE_MAP[next] : null;
                if (map?.tab && onNavigate) onNavigate(map.tab);
              }}
            >
              <div className="hq-pipeline-label">{stage.stage}</div>
              <div className="hq-pipeline-bar">
                <div style={{ width: `${Math.min(100, (stage.value / maxValue) * 100)}%` }} />
              </div>
              <div className="hq-pipeline-meta">{stage.count} · {fmt(stage.value)}</div>
            </button>
          ))}
        </div>
      </HqPanel>

      {selectedStage && STAGE_MAP[selectedStage]?.appStatus && (
        <div style={{ marginTop: "1.25rem" }}>
          <HqPanel title={`${selectedStage} — Applications`}>
            {filteredApps.length ? (
              <table className="hq-table">
                <thead><tr><th>Application</th><th>Funder</th><th>Status</th><th>Amount</th></tr></thead>
                <tbody>
                  {filteredApps.map((a: GrantApplication) => (
                    <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => onNavigate?.("applications", a.id)}>
                      <td><strong>{a.title}</strong></td>
                      <td>{a.funder ?? "—"}</td>
                      <td><StatusBadge label={a.status} variant="gold" /></td>
                      <td>{fmt(a.amount_requested)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="hq-muted-text">No applications in this stage.</p>
            )}
          </HqPanel>
        </div>
      )}
    </div>
  );
};
