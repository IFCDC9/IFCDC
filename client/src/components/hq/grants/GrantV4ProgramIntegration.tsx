import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, FileText, BarChart3 } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

type ProgramPortfolio = {
  slug: string;
  label: string;
  readOnly: boolean;
  currentBudget: number;
  awardedFunding: number;
  requestedFunding: number;
  spending: number;
  remainingBalance: number;
  fundingGap: number;
  complianceStatus: string;
  reportingRequirementsDue: number;
  grantPortfolio: { kind: string; id: string; title: string; status: string; amount: number; lifecycleStage: string }[];
  performanceMetrics: { portfolioSize: number; fundingUtilization: number; winRate: number | null; activeApplications: number };
};

export const GrantV4ProgramIntegration: React.FC = () => {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const programs = useQuery({
    queryKey: ["grant-v4-programs"],
    queryFn: grantsApi.v5Programs,
    staleTime: 60_000,
  });

  if (programs.isLoading) return <HqLoading message="Loading program integration…" />;

  const list = (programs.data?.programs ?? []) as ProgramPortfolio[];
  const selected = list.find((p) => p.slug === selectedSlug);

  return (
    <div className="hq-fade-in">
      <HqPanel title="Program Integration" subtitle="Each IFCDC division connected to grant portfolio, budget, reporting, and performance metrics">
        <div className="hq-grid-2">
          <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {list.map((p) => (
              <li
                key={p.slug}
                className="hq-activity-item"
                style={{ cursor: "pointer", background: selectedSlug === p.slug ? "rgba(212,175,55,0.08)" : undefined }}
                onClick={() => setSelectedSlug(p.slug)}
              >
                <div className="hq-activity-icon"><Building2 size={16} /></div>
                <div className="hq-activity-content">
                  <div className="hq-activity-title">{p.label}</div>
                  <div className="hq-activity-detail">{p.grantPortfolio.length} grants · {p.complianceStatus}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: "0.82rem" }}>
                  <div style={{ color: "var(--hq-gold)", fontWeight: 600 }}>{fmt(p.awardedFunding)}</div>
                </div>
              </li>
            ))}
          </ul>

          <div>
            {!selected ? (
              <p className="hq-muted-text">Select a program to view its integrated grant portfolio.</p>
            ) : (
              <>
                <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>{selected.label}</h4>
                {selected.readOnly && <StatusBadge label="PRODUCTION LOCKED" variant="muted" />}
                <div className="hq-kpi-grid" style={{ margin: "1rem 0" }}>
                  <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Budget</div><strong>{fmt(selected.currentBudget)}</strong></div>
                  <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Spending</div><strong>{fmt(selected.spending)}</strong></div>
                  <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Remaining</div><strong>{fmt(selected.remainingBalance)}</strong></div>
                  <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Reports Due</div><strong>{selected.reportingRequirementsDue}</strong></div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  <BarChart3 size={16} style={{ color: "var(--hq-gold)" }} />
                  Utilization {selected.performanceMetrics.fundingUtilization}% · Win rate {selected.performanceMetrics.winRate ?? "—"}%
                </div>

                <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
                  <FileText size={14} style={{ verticalAlign: "middle", marginRight: "0.35rem" }} />
                  Grant Portfolio
                </h4>
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {selected.grantPortfolio.map((g) => (
                    <li key={g.id} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{g.title}</div>
                        <div className="hq-activity-detail">{g.kind} · {g.lifecycleStage.replace(/_/g, " ") || g.status}</div>
                      </div>
                      <div style={{ fontSize: "0.82rem", color: "var(--hq-gold)" }}>{fmt(g.amount)}</div>
                    </li>
                  ))}
                  {!selected.grantPortfolio.length && <li className="hq-muted-text">No grants linked to this program yet.</li>}
                </ul>
              </>
            )}
          </div>
        </div>
      </HqPanel>
    </div>
  );
};
