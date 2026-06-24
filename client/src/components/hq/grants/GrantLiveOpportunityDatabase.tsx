import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Radio, Sparkles, Plus, RefreshCw } from "lucide-react";
import { grantsApi, type GrantOpportunity } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

type LiveOpportunity = GrantOpportunity & {
  division_slugs?: string[];
  latest_score?: number;
  latest_grade?: string;
  daysUntilDeadline?: number | null;
  isLive?: boolean;
};

export const GrantLiveOpportunityDatabase: React.FC<{
  onStartApplication?: (opportunityId: string) => void;
}> = ({ onStartApplication }) => {
  const qc = useQueryClient();
  const [scoreDivision, setScoreDivision] = useState("");
  const [lastScore, setLastScore] = useState<{ id: string; score: number; grade: string } | null>(null);

  const live = useQuery({
    queryKey: ["grant-live-opportunities"],
    queryFn: () => grantsApi.liveOpportunities(50),
    staleTime: 30_000,
  });

  const scoreOpp = useMutation({
    mutationFn: (payload: { id: string; division?: string }) =>
      grantsApi.scoreOpportunity(payload.id, payload.division),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grant-live-opportunities"] }),
  });

  const opportunities = (live.data?.opportunities ?? []) as LiveOpportunity[];

  const handleScore = async (id: string) => {
    const result = await scoreOpp.mutateAsync({ id, division: scoreDivision || undefined });
    setLastScore({ id: result.opportunityId, score: result.score, grade: result.grade });
  };

  return (
    <HqPanel title="Live Grant Opportunity Database" subtitle="Verified open funding opportunities across IFCDC divisions">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem", alignItems: "center" }}>
        <StatusBadge label="LIVE" variant="success" />
        <span className="hq-muted-text" style={{ fontSize: "0.82rem" }}>
          {opportunities.length} active opportunities · updated {live.data?.generatedAt ? new Date(live.data.generatedAt).toLocaleTimeString() : "—"}
        </span>
        <select className="hq-aura-input" value={scoreDivision} onChange={(e) => setScoreDivision(e.target.value)} style={{ marginLeft: "auto" }}>
          <option value="">Score for division…</option>
          <option value="housing">Housing</option>
          <option value="anti_gang">Anti-Gang</option>
          <option value="scholarships">Scholarships</option>
          <option value="tapis">TAPIS</option>
          <option value="community_programs">Community Programs</option>
        </select>
        <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => live.refetch()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {live.isLoading ? (
        <HqLoading />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {opportunities.map((o) => (
            <div key={o.id} className="hq-panel" style={{ padding: "0.85rem 1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.25rem" }}>
                    <Radio size={14} style={{ color: "var(--hq-success)" }} />
                    <span style={{ fontWeight: 600 }}>{o.title}</span>
                  </div>
                  <div className="hq-muted-text" style={{ fontSize: "0.82rem" }}>{o.funder}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.4rem" }}>
                    {(o.division_slugs ?? []).map((d) => (
                      <StatusBadge key={d} label={d.replace(/_/g, " ")} variant="gold" />
                    ))}
                    {o.latest_score != null && (
                      <StatusBadge label={`${o.latest_score}% ${o.latest_grade ?? ""}`} variant="success" />
                    )}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: "0.85rem" }}>
                  <div style={{ color: "var(--hq-gold)", fontWeight: 700 }}>{fmt(o.amount_max ?? 0)}</div>
                  <div className="hq-muted-text">
                    {o.deadline ? new Date(o.deadline).toLocaleDateString() : "Rolling"}
                    {o.daysUntilDeadline != null ? ` · ${o.daysUntilDeadline}d` : ""}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.65rem", flexWrap: "wrap" }}>
                <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" disabled={scoreOpp.isPending} onClick={() => handleScore(o.id)}>
                  <Sparkles size={14} /> Score
                </button>
                {onStartApplication && (
                  <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" onClick={() => onStartApplication(o.id)}>
                    <Plus size={14} /> Start application
                  </button>
                )}
              </div>
              {lastScore?.id === o.id && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.82rem", color: "var(--hq-gold)" }}>
                  Score: {lastScore.score}% — {lastScore.grade}
                </div>
              )}
            </div>
          ))}
          {!opportunities.length && <p className="hq-muted-text">No live opportunities — add grants with status open.</p>}
        </div>
      )}
    </HqPanel>
  );
};
