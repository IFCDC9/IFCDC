import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Award, XCircle } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

type OutcomeRow = {
  id: string;
  outcome: string;
  reason?: string;
  amount?: number;
  recorded_at?: string;
  application_title?: string;
  opportunity_title?: string;
  funder?: string;
};

export const GrantOutcomesPanel: React.FC = () => {
  const outcomes = useQuery({
    queryKey: ["grant-funding-outcomes"],
    queryFn: () => grantsApi.fundingOutcomes(50),
    staleTime: 30_000,
  });

  const rows = (outcomes.data?.outcomes ?? []) as OutcomeRow[];
  const awarded = rows.filter((r) => r.outcome === "awarded");
  const denied = rows.filter((r) => r.outcome === "denied");

  return (
    <HqPanel title="Award & Rejection Tracking" subtitle="Audited outcomes from the funding engine workflow">
      {outcomes.isLoading ? (
        <HqLoading />
      ) : (
        <>
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Award size={16} style={{ color: "var(--hq-success)" }} />
              <span><strong>{awarded.length}</strong> awarded</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <XCircle size={16} style={{ color: "var(--hq-danger)" }} />
              <span><strong>{denied.length}</strong> rejected</span>
            </div>
          </div>
          <table className="hq-table">
            <thead>
              <tr><th>Application</th><th>Funder</th><th>Outcome</th><th>Amount</th><th>Reason</th><th>Recorded</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.application_title ?? r.opportunity_title ?? "—"}</strong></td>
                  <td>{r.funder ?? "—"}</td>
                  <td>
                    <StatusBadge
                      label={r.outcome}
                      variant={r.outcome === "awarded" ? "success" : "danger"}
                    />
                  </td>
                  <td>{r.amount != null ? fmt(r.amount) : "—"}</td>
                  <td className="hq-muted-text" style={{ fontSize: "0.82rem" }}>{r.reason ?? "—"}</td>
                  <td>{r.recorded_at ? new Date(r.recorded_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={6} className="hq-empty-cell">No outcomes recorded yet — use Application Workflow to award or deny.</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </HqPanel>
  );
};
