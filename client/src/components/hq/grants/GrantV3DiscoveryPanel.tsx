import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, RefreshCw, Target } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

const DIVISIONS = [
  { slug: "", label: "All programs" },
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

export const GrantV3DiscoveryPanel: React.FC = () => {
  const [division, setDivision] = useState("");

  const discovery = useQuery({
    queryKey: ["grant-v3-discovery", division],
    queryFn: () => grantsApi.v3Discovery(division || undefined, 15),
    staleTime: 60_000,
  });

  const refresh = useMutation({
    mutationFn: () => grantsApi.v3RunDiscovery(division || undefined, 15),
    onSuccess: () => discovery.refetch(),
  });

  if (discovery.isLoading) return <HqLoading message="Running AI grant discovery…" />;

  const ranked = discovery.data?.ranked ?? [];

  return (
    <HqPanel title="AI Grant Discovery & Matching" subtitle="Score by eligibility · Rank by strategic value · Recommend highest-priority grants">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem", alignItems: "center" }}>
        <select className="hq-aura-input" value={division} onChange={(e) => setDivision(e.target.value)}>
          {DIVISIONS.map((d) => (
            <option key={d.slug || "all"} value={d.slug}>{d.label}</option>
          ))}
        </select>
        <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          <Sparkles size={14} /> Run AI Discovery
        </button>
        <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => discovery.refetch()}>
          <RefreshCw size={14} /> Refresh
        </button>
        <span className="hq-muted-text" style={{ fontSize: "0.82rem", marginLeft: "auto" }}>
          {discovery.data?.totalScored ?? ranked.length} opportunities scored
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {ranked.map((g, i) => (
          <div key={String(g.id)} className="hq-panel" style={{ padding: "0.85rem 1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <Target size={14} style={{ color: "var(--hq-gold)" }} />
                  <span style={{ fontWeight: 600 }}>#{i + 1} {String(g.title)}</span>
                </div>
                <div className="hq-muted-text" style={{ fontSize: "0.82rem" }}>{String(g.funder)}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.4rem" }}>
                  <StatusBadge label={String(g.recommendation)} variant={Number(g.priorityScore) >= 65 ? "success" : "gold"} />
                  <StatusBadge label={`Priority ${g.priorityScore}%`} variant="gold" />
                  <StatusBadge label={`Eligibility ${g.eligibilityScore}%`} variant="success" />
                  <StatusBadge label={`Strategic ${g.strategicFitScore}%`} variant="muted" />
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "var(--hq-gold)", fontWeight: 700 }}>{fmt(Number(g.amountMax ?? 0))}</div>
                {g.deadline && (
                  <div className="hq-muted-text" style={{ fontSize: "0.82rem" }}>
                    Due {new Date(String(g.deadline)).toLocaleDateString()}
                    {g.daysUntilDeadline != null ? ` · ${g.daysUntilDeadline}d` : ""}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {!ranked.length && <p className="hq-muted-text">No live opportunities to rank — add open grants to the database.</p>}
      </div>
    </HqPanel>
  );
};
