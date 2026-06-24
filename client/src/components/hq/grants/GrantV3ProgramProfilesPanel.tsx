import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Shield, BarChart3 } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

type ProgramProfile = {
  slug: string;
  label: string;
  readOnly: boolean;
  currentBudget: number;
  requestedFunding: number;
  awardedFunding: number;
  spending: number;
  remainingBalance: number;
  fundingGoal: number;
  fundingGap: number;
  complianceStatus: string;
  outcomeMetrics: {
    applicationsDecided: number;
    awardsRecorded: number;
    denialsRecorded: number;
    winRate: number | null;
    activeApplications: number;
  };
};

export const GrantV3ProgramProfilesPanel: React.FC = () => {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const profiles = useQuery({
    queryKey: ["grant-v3-profiles"],
    queryFn: grantsApi.v3Profiles,
    staleTime: 60_000,
  });

  if (profiles.isLoading) return <HqLoading message="Loading program funding profiles…" />;

  const list = (profiles.data?.profiles ?? []) as ProgramProfile[];
  const selected = list.find((p) => p.slug === selectedSlug);

  return (
    <div className="hq-fade-in">
      <HqPanel title="Program Funding Profiles" subtitle="Every IFCDC division — budget, pipeline, spending, compliance, and outcomes">
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
                    {p.complianceStatus}
                    {p.readOnly ? " · production-locked" : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: "0.82rem" }}>
                  <div style={{ color: "var(--hq-gold)", fontWeight: 600 }}>{fmt(p.awardedFunding)}</div>
                  <div className="hq-muted-text">Gap {fmt(p.fundingGap)}</div>
                </div>
              </li>
            ))}
          </ul>

          <div>
            {!selected ? (
              <p className="hq-muted-text">Select a program to view its full funding profile.</p>
            ) : (
              <>
                <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>{selected.label}</h4>
                {selected.readOnly && <StatusBadge label="PRODUCTION LOCKED" variant="muted" />}
                <div className="hq-kpi-grid" style={{ margin: "1rem 0" }}>
                  <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Current Budget</div><strong>{fmt(selected.currentBudget)}</strong></div>
                  <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Requested</div><strong>{fmt(selected.requestedFunding)}</strong></div>
                  <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Awarded</div><strong>{fmt(selected.awardedFunding)}</strong></div>
                  <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Spending</div><strong>{fmt(selected.spending)}</strong></div>
                  <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Remaining</div><strong style={{ color: "var(--hq-success)" }}>{fmt(selected.remainingBalance)}</strong></div>
                  <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Funding Goal</div><strong>{fmt(selected.fundingGoal)}</strong></div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  <Shield size={16} style={{ color: selected.complianceStatus === "Current" ? "var(--hq-success)" : "var(--hq-warning)" }} />
                  <span>Compliance: <strong>{selected.complianceStatus}</strong></span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  <BarChart3 size={16} style={{ color: "var(--hq-gold)" }} />
                  <span>Outcome Metrics</span>
                </div>
                <table className="hq-table">
                  <tbody>
                    <tr><td>Active applications</td><td>{selected.outcomeMetrics.activeApplications}</td></tr>
                    <tr><td>Decisions recorded</td><td>{selected.outcomeMetrics.applicationsDecided}</td></tr>
                    <tr><td>Awards / Denials</td><td>{selected.outcomeMetrics.awardsRecorded} / {selected.outcomeMetrics.denialsRecorded}</td></tr>
                    <tr><td>Win rate</td><td>{selected.outcomeMetrics.winRate != null ? `${selected.outcomeMetrics.winRate}%` : "—"}</td></tr>
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </HqPanel>
    </div>
  );
};
