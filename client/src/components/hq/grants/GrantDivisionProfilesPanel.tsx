import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Building2, Sparkles } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

export const GrantDivisionProfilesPanel: React.FC = () => {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const profiles = useQuery({
    queryKey: ["grant-v2-division-profiles"],
    queryFn: grantsApi.v2DivisionProfiles,
    staleTime: 60_000,
  });

  const match = useMutation({
    mutationFn: (slug: string) => grantsApi.v2MatchDivision(slug),
  });

  const detail = useQuery({
    queryKey: ["grant-v2-division-profile", selectedSlug],
    queryFn: () => grantsApi.v2DivisionProfile(selectedSlug!),
    enabled: !!selectedSlug,
  });

  if (profiles.isLoading) return <HqLoading message="Loading division funding profiles…" />;

  const list = profiles.data?.profiles ?? [];

  return (
    <div className="hq-fade-in">
      <HqPanel title="IFCDC Division Funding Profiles" subtitle="Every program division connected to the Grant Center funding engine">
        <div className="hq-grid-2">
          <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {list.map((p) => (
              <li
                key={p.slug}
                className="hq-activity-item"
                style={{
                  cursor: "pointer",
                  background: selectedSlug === p.slug ? "rgba(212,175,55,0.08)" : undefined,
                }}
                onClick={() => setSelectedSlug(p.slug)}
              >
                <div className="hq-activity-icon"><Building2 size={16} /></div>
                <div className="hq-activity-content">
                  <div className="hq-activity-title">{p.label}</div>
                  <div className="hq-activity-detail">
                    {p.openOpportunities} opps · {p.activeApplications} apps
                    {p.readOnly ? " · read-only" : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: "0.82rem" }}>
                  <div style={{ color: "var(--hq-gold)", fontWeight: 600 }}>{fmt(p.awardedTotal)}</div>
                  <div className="hq-muted-text">Gap {fmt(p.fundingGap)}</div>
                </div>
              </li>
            ))}
          </ul>

          <div>
            {!selectedSlug ? (
              <p className="hq-muted-text">Select a division to view funding profile and AI-matched grants.</p>
            ) : detail.isLoading ? (
              <HqLoading />
            ) : detail.data?.profile ? (
              <>
                {(() => {
                  const p = detail.data.profile as Record<string, unknown>;
                  return (
                    <>
                      <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>{String(p.label)}</h4>
                      <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
                        <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Funding Goal</div><strong>{fmt(Number(p.fundingGoal))}</strong></div>
                        <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Awarded</div><strong>{fmt(Number(p.awardedTotal))}</strong></div>
                        <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Budget Allocated</div><strong>{fmt(Number(p.budgetAllocated))}</strong></div>
                        <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Budget Spent</div><strong>{fmt(Number(p.budgetSpent))}</strong></div>
                      </div>
                      <button
                        type="button"
                        className="hq-btn hq-btn-secondary hq-btn-sm"
                        disabled={match.isPending || Boolean(p.readOnly)}
                        onClick={() => match.mutate(selectedSlug)}
                        style={{ marginBottom: "0.75rem" }}
                      >
                        <Sparkles size={14} /> AI Match Grants for Division
                      </button>
                      {(match.data?.matches ?? (p.topMatches as Record<string, unknown>[]) ?? []).slice(0, 5).map((m) => (
                        <div key={String(m.id ?? m.title)} className="hq-panel" style={{ padding: "0.65rem 0.85rem", marginBottom: "0.5rem" }}>
                          <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{String(m.title ?? "—")}</div>
                          <div className="hq-muted-text" style={{ fontSize: "0.78rem" }}>{String(m.funder ?? "")}</div>
                          <StatusBadge label={`${m.matchScore ?? m.latest_score ?? "—"}% match`} variant="gold" />
                        </div>
                      ))}
                    </>
                  );
                })()}
              </>
            ) : null}
          </div>
        </div>
      </HqPanel>
    </div>
  );
};
