import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Sparkles, Plus } from "lucide-react";
import { grantsApi, type GrantOpportunity } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

type EnrichedOpportunity = GrantOpportunity & {
  program_areas?: string[];
  division_slugs?: string[];
  match_tags?: string[];
  daysUntilDeadline?: number | null;
  eligibility?: string;
};

export const GrantOpportunityDatabase: React.FC<{
  onStartApplication?: (opportunityId: string) => void;
}> = ({ onStartApplication }) => {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({
    q: "",
    division: "",
    minAmount: "",
    deadlineWithinDays: "",
    scoreDivision: "",
  });

  const search = useQuery({
    queryKey: ["grant-opp-search", filters],
    queryFn: () =>
      grantsApi.searchOpportunities({
        q: filters.q || undefined,
        division: filters.division || undefined,
        minAmount: filters.minAmount ? Number(filters.minAmount) : undefined,
        deadlineWithinDays: filters.deadlineWithinDays ? Number(filters.deadlineWithinDays) : undefined,
      }),
    staleTime: 30_000,
  });

  const scoreOpp = useMutation({
    mutationFn: (payload: { id: string; division?: string }) =>
      grantsApi.scoreOpportunity(payload.id, payload.division),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grant-funding-engine"] }),
  });
  const [lastScore, setLastScore] = useState<{ opportunityId: string; score: number; grade: string } | null>(null);

  const handleScore = async (id: string) => {
    const division = filters.scoreDivision || filters.division || undefined;
    const result = await scoreOpp.mutateAsync({ id, division });
    setLastScore({ opportunityId: result.opportunityId, score: result.score, grade: result.grade });
  };

  const opportunities = (search.data?.opportunities ?? []) as EnrichedOpportunity[];

  return (
    <HqPanel title="Grant Opportunity Database" subtitle="Search, filter, and score funding opportunities">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        <input
          className="hq-aura-input"
          placeholder="Search title, funder, tags…"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          style={{ flex: "1 1 200px" }}
        />
        <select className="hq-aura-input" value={filters.division} onChange={(e) => setFilters({ ...filters, division: e.target.value })}>
          <option value="">All divisions</option>
          <option value="housing">Housing</option>
          <option value="anti_gang">Anti-Gang</option>
          <option value="scholarships">Scholarships</option>
          <option value="economic_development">Economic Development</option>
          <option value="tapis">TAPIS</option>
          <option value="inclusive">Inclusive Community</option>
          <option value="music">Music</option>
          <option value="radio">Radio</option>
          <option value="community_programs">Community Programs</option>
        </select>
        <input
          className="hq-aura-input"
          type="number"
          placeholder="Min amount"
          value={filters.minAmount}
          onChange={(e) => setFilters({ ...filters, minAmount: e.target.value })}
          style={{ width: 110 }}
        />
        <input
          className="hq-aura-input"
          type="number"
          placeholder="Due within (days)"
          value={filters.deadlineWithinDays}
          onChange={(e) => setFilters({ ...filters, deadlineWithinDays: e.target.value })}
          style={{ width: 130 }}
        />
        <select
          className="hq-aura-input"
          value={filters.scoreDivision}
          onChange={(e) => setFilters({ ...filters, scoreDivision: e.target.value })}
          title="Division for eligibility scoring"
        >
          <option value="">Score for division…</option>
          <option value="housing">Housing</option>
          <option value="scholarships">Scholarships</option>
          <option value="tapis">TAPIS</option>
          <option value="community_programs">Community Programs</option>
        </select>
        <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => search.refetch()}>
          <Search size={14} /> Search
        </button>
      </div>

      {search.isLoading ? (
        <HqLoading />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {opportunities.map((o) => (
            <div key={o.id} className="hq-panel" style={{ padding: "0.85rem 1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{o.title}</div>
                  <div className="hq-muted-text" style={{ fontSize: "0.82rem" }}>{o.funder}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.4rem" }}>
                    <StatusBadge label={o.status} variant={o.status === "open" ? "success" : "muted"} />
                    {(o.division_slugs ?? []).slice(0, 3).map((d) => (
                      <StatusBadge key={d} label={d.replace(/_/g, " ")} variant="gold" />
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: "0.85rem" }}>
                  <div style={{ color: "var(--hq-gold)", fontWeight: 700 }}>{fmt(o.amount_max ?? 0)}</div>
                  <div className="hq-muted-text">
                    {o.deadline ? new Date(o.deadline).toLocaleDateString() : "No deadline"}
                    {o.daysUntilDeadline != null ? ` · ${o.daysUntilDeadline}d` : ""}
                  </div>
                </div>
              </div>
              {o.description && (
                <p className="hq-muted-text" style={{ fontSize: "0.8rem", margin: "0.5rem 0 0", lineHeight: 1.5 }}>
                  {String(o.description).slice(0, 200)}
                </p>
              )}
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.65rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="hq-btn hq-btn-secondary hq-btn-sm"
                  disabled={scoreOpp.isPending}
                  onClick={() => handleScore(o.id)}
                >
                  <Sparkles size={14} /> Score eligibility
                </button>
                {onStartApplication && (
                  <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" onClick={() => onStartApplication(o.id)}>
                    <Plus size={14} /> Start application
                  </button>
                )}
              </div>
              {lastScore?.opportunityId === o.id && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.82rem", color: "var(--hq-gold)" }}>
                  Score: {lastScore.score}% — {lastScore.grade}
                </div>
              )}
            </div>
          ))}
          {!opportunities.length && <p className="hq-muted-text">No opportunities match your filters.</p>}
        </div>
      )}
    </HqPanel>
  );
};
