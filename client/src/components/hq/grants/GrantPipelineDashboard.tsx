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

const STAGE_FILTERS: Record<string, { status?: string; tab?: string }> = {
  Prospecting: { tab: "opportunities" },
  Applied: { status: "submitted" },
  "Under Review": { status: "under_review" },
  Awarded: { status: "awarded" },
  "Active Grants": { status: "awarded" },
};

export const GrantPipelineDashboard: React.FC<{
  onNavigate?: (tab: string, applicationId?: string) => void;
}> = ({ onNavigate }) => {
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

  const pipeline = useQuery({
    queryKey: ["grants-pipeline"],
    queryFn: grantsApi.pipeline,
    staleTime: 30_000,
  });
  const applications = useQuery({
    queryKey: ["grants-applications"],
    queryFn: grantsApi.applications,
    staleTime: 30_000,
  });

  const filteredApps = useMemo(() => {
    const apps = applications.data?.applications ?? [];
    const filter = selectedStage ? STAGE_FILTERS[selectedStage] : null;
    if (!filter?.status) return [];
    return apps.filter((a) => a.status === filter.status);
  }, [applications.data, selectedStage]);

  if (pipeline.isLoading) return <HqLoading message="Loading funding pipeline…" />;

  const stages = pipeline.data?.pipeline ?? [];
  const maxValue = Math.max(...stages.map((s) => s.value), pipeline.data?.pipelineValue ?? 1, 1);

  return (
    <div className="hq-fade-in">
      <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Pipeline Value" value={fmt(pipeline.data?.pipelineValue)} icon={TrendingUp} variant="gold" />
        <KpiCard label="Win Rate" value={`${pipeline.data?.winRate ?? 0}%`} variant="success" />
      </div>

      <HqPanel title="Funding Pipeline" subtitle="Click a stage to drill into applications">
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
                const filter = next ? STAGE_FILTERS[next] : null;
                if (filter?.tab && onNavigate) onNavigate(filter.tab);
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

      {selectedStage && STAGE_FILTERS[selectedStage]?.status && (
        <div style={{ marginTop: "1.25rem" }}>
          <HqPanel title={`${selectedStage} — Applications`} subtitle={`${filteredApps.length} in this stage`}>
            {applications.isLoading ? (
              <HqLoading />
            ) : filteredApps.length ? (
              <table className="hq-table">
                <thead>
                  <tr><th>Application</th><th>Funder</th><th>Status</th><th>Requested</th></tr>
                </thead>
                <tbody>
                  {filteredApps.map((a: GrantApplication) => (
                    <tr
                      key={a.id}
                      style={{ cursor: onNavigate ? "pointer" : undefined }}
                      onClick={() => onNavigate?.("applications", a.id)}
                    >
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
