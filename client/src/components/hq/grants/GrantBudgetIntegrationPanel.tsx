import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Wallet, ExternalLink } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { KpiCard } from "../KpiCard";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

export const GrantBudgetIntegrationPanel: React.FC = () => {
  const overview = useQuery({
    queryKey: ["grant-funding-engine"],
    queryFn: grantsApi.fundingEngineOverview,
    staleTime: 60_000,
  });
  const budgets = useQuery({
    queryKey: ["grants-budgets"],
    queryFn: grantsApi.budgets,
    staleTime: 60_000,
  });

  if (overview.isLoading) return <HqLoading message="Loading budget integration…" />;

  const integration = overview.data?.budgetIntegration;
  const financeBudgets = budgets.data?.financeBudgets ?? [];

  return (
    <div className="hq-fade-in">
      <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Linked Budgets" value={integration?.linkedBudgets ?? 0} icon={Wallet} variant="gold" />
        <KpiCard label="Allocated" value={fmt(integration?.allocated ?? 0)} meta={`${fmt(integration?.spent ?? 0)} spent`} />
        <KpiCard label="Grant Expenditures" value={fmt(integration?.grantBudgetSpent ?? 0)} />
        <KpiCard label="Labor (Payroll)" value={fmt(integration?.laborCost ?? 0)} meta="Synced from HR" />
      </div>

      <HqPanel
        title="Headquarters Financial Center Integration"
        subtitle="Grant awards auto-create budgets — no separate accounting system"
      >
        <p className="hq-muted-text" style={{ marginBottom: "1rem" }}>
          All grant finances flow through the centralized Financial Center. Awards create budgets automatically;
          expenditures and payroll allocations stay auditable across both systems.
        </p>
        <Link to="/hq/finance" className="hq-btn hq-btn-secondary hq-btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", marginBottom: "1rem" }}>
          <ExternalLink size={14} /> Open Financial Center
        </Link>
        {budgets.isLoading ? (
          <HqLoading />
        ) : (
          <table className="hq-table">
            <thead>
              <tr><th>Budget</th><th>Category</th><th>Allocated</th><th>Spent</th><th>Grant ID</th></tr>
            </thead>
            <tbody>
              {financeBudgets.slice(0, 10).map((b) => (
                <tr key={String(b.id)}>
                  <td><strong>{String(b.name ?? b.title ?? "—")}</strong></td>
                  <td>{String(b.category ?? "grants")}</td>
                  <td>{fmt(Number(b.allocated ?? 0))}</td>
                  <td>{fmt(Number(b.spent ?? 0))}</td>
                  <td className="hq-muted-text" style={{ fontSize: "0.78rem" }}>{String(b.grant_id ?? "—")}</td>
                </tr>
              ))}
              {!financeBudgets.length && (
                <tr><td colSpan={5} className="hq-empty-cell">No grant-linked budgets yet — award an application to create one.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </HqPanel>
    </div>
  );
};
