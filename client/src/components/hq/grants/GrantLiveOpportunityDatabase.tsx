import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Radio, Sparkles, Plus, RefreshCw } from "lucide-react";
import { grantsApi, type GrantOpportunity } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

const FUNDING_STATUSES = [
  { key: "", label: "All statuses" },
  { key: "identified", label: "Identified" },
  { key: "reviewing", label: "Reviewing" },
  { key: "eligible", label: "Eligible" },
  { key: "in_progress", label: "In Progress" },
  { key: "submitted", label: "Submitted" },
  { key: "awarded", label: "Awarded" },
  { key: "declined", label: "Declined" },
  { key: "renewal", label: "Renewal" },
];

const DIVISIONS = [
  { slug: "housing", label: "Housing" },
  { slug: "anti_gang", label: "Anti-Gang" },
  { slug: "scholarships", label: "Scholarships" },
  { slug: "community_programs", label: "Community Programs" },
  { slug: "economic_development", label: "Economic Development" },
  { slug: "productions", label: "Productions" },
  { slug: "radio", label: "Radio" },
  { slug: "music", label: "Music" },
  { slug: "tapis", label: "TAPIS" },
  { slug: "barbers", label: "Barbers" },
];

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

type LiveOpportunity = GrantOpportunity & {
  division_slugs?: string[];
  latest_score?: number;
  latest_grade?: string;
  strategic_fit_score?: number;
  strategic_fit_grade?: string;
  fundingStatus?: string;
  daysUntilDeadline?: number | null;
  isLive?: boolean;
};

export const GrantLiveOpportunityDatabase: React.FC<{
  onStartApplication?: (opportunityId: string) => void;
}> = ({ onStartApplication }) => {
  const qc = useQueryClient();
  const [scoreDivision, setScoreDivision] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [lastScore, setLastScore] = useState<{
    id: string;
    eligibilityScore: number;
    strategicFitScore: number;
    eligibilityGrade: string;
    strategicFitGrade: string;
  } | null>(null);

  const live = useQuery({
    queryKey: ["grant-live-opportunities", statusFilter],
    queryFn: () => grantsApi.liveOpportunities(50, statusFilter || undefined),
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
    setLastScore({
      id: result.opportunityId,
      eligibilityScore: result.eligibilityScore ?? result.score ?? 0,
      strategicFitScore: result.strategicFitScore ?? 0,
      eligibilityGrade: result.eligibilityGrade ?? result.grade ?? "—",
      strategicFitGrade: result.strategicFitGrade ?? "—",
    });
  };

  return (
    <HqPanel title="Live Grant Opportunity Database" subtitle="Verified open funding opportunities across IFCDC programs">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem", alignItems: "center" }}>
        <StatusBadge label="LIVE" variant="success" />
        <span className="hq-muted-text" style={{ fontSize: "0.82rem" }}>
          {opportunities.length} active opportunities · updated {live.data?.generatedAt ? new Date(live.data.generatedAt).toLocaleTimeString() : "—"}
        </span>
        <select className="hq-aura-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {FUNDING_STATUSES.map((s) => (
            <option key={s.key || "all"} value={s.key}>{s.label}</option>
          ))}
        </select>
        <select className="hq-aura-input" value={scoreDivision} onChange={(e) => setScoreDivision(e.target.value)} style={{ marginLeft: "auto" }}>
          <option value="">Score for program…</option>
          {DIVISIONS.map((d) => (
            <option key={d.slug} value={d.slug}>{d.label}</option>
          ))}
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
                    {o.fundingStatus && (
                      <StatusBadge label={o.fundingStatus.replace(/_/g, " ")} variant={STATUS_VARIANT[o.fundingStatus] ?? "muted"} />
                    )}
                    {(o.division_slugs ?? []).map((d) => (
                      <StatusBadge key={d} label={d.replace(/_/g, " ")} variant="gold" />
                    ))}
                    {o.latest_score != null && (
                      <StatusBadge label={`Eligibility ${o.latest_score}% ${o.latest_grade ?? ""}`} variant="success" />
                    )}
                    {o.strategic_fit_score != null && Number(o.strategic_fit_score) > 0 && (
                      <StatusBadge label={`Strategic Fit ${o.strategic_fit_score}% ${o.strategic_fit_grade ?? ""}`} variant="gold" />
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
                  <Sparkles size={14} /> AI Match & Score
                </button>
                {onStartApplication && (
                  <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" onClick={() => onStartApplication(o.id)}>
                    <Plus size={14} /> Start application
                  </button>
                )}
              </div>
              {lastScore?.id === o.id && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.82rem", color: "var(--hq-gold)" }}>
                  Eligibility: {lastScore.eligibilityScore}% ({lastScore.eligibilityGrade}) · Strategic Fit: {lastScore.strategicFitScore}% ({lastScore.strategicFitGrade})
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
