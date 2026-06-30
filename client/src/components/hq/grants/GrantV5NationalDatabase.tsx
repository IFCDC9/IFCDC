import React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Globe, Sparkles, RefreshCw } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";
import { useGrantManage } from "../../../hooks/useGrantManage";

const fmt = formatCurrency;

export const GrantV5NationalDatabase: React.FC = () => {
  const { canManage } = useGrantManage();
  const national = useQuery({
    queryKey: ["grant-v5-national"],
    queryFn: () => grantsApi.v5NationalDatabase(30),
    staleTime: 60_000,
  });

  const matchAll = useMutation({
    mutationFn: () => grantsApi.v5MatchAllDivisions(3),
  });

  if (national.isLoading) return <HqLoading message="Loading national grant database…" />;

  const opps = national.data?.opportunities ?? [];

  return (
    <HqPanel title="National Grant Opportunity Database" subtitle="Federal and national funding sources matched to every IFCDC division">
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <StatusBadge label="NATIONAL" variant="gold" />
        <Globe size={16} style={{ color: "var(--hq-gold)" }} />
        <span className="hq-muted-text" style={{ fontSize: "0.82rem" }}>{opps.length} national opportunities</span>
        {canManage && (
        <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" style={{ marginLeft: "auto" }} disabled={matchAll.isPending} onClick={() => matchAll.mutate()}>
          <Sparkles size={14} /> Match All Divisions
        </button>
        )}
        <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => national.refetch()}>
          <RefreshCw size={14} />
        </button>
      </div>

      {matchAll.data && (
        <div className="hq-muted-text" style={{ fontSize: "0.82rem", marginBottom: "0.75rem" }}>
          Matched {matchAll.data.totalMatches} opportunities across {matchAll.data.divisions.length} IFCDC divisions
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        {opps.map((o) => (
          <div key={String(o.id)} className="hq-panel" style={{ padding: "0.75rem 1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{String(o.title)}</div>
                <div className="hq-muted-text" style={{ fontSize: "0.82rem" }}>{String(o.funder)}</div>
                <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                  {o.composite_score != null && <StatusBadge label={`Score ${o.composite_score}%`} variant="success" />}
                  {o.award_probability != null && <StatusBadge label={`Win ${o.award_probability}%`} variant="gold" />}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "var(--hq-gold)", fontWeight: 700 }}>{fmt(Number(o.amount_max ?? 0))}</div>
                {o.deadline && <div className="hq-muted-text" style={{ fontSize: "0.82rem" }}>Due {new Date(String(o.deadline)).toLocaleDateString()}</div>}
              </div>
            </div>
          </div>
        ))}
        {!opps.length && <p className="hq-muted-text">No national opportunities indexed — federal grants will appear as opportunities are added.</p>}
      </div>
    </HqPanel>
  );
};
