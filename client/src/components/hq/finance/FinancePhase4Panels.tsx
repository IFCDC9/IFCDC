import React from "react";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, TrendingUp, Wallet, PieChart, Users, Shield, Sparkles } from "lucide-react";
import { financeApi } from "../../../api/financeApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

export const ExecutiveBudgetDashboard: React.FC = () => {
  const budget = useQuery({ queryKey: ["executive-budget"], queryFn: financeApi.phase4ExecutiveBudget, staleTime: 60_000 });

  if (budget.isLoading) return <HqLoading message="Loading executive budget dashboard…" />;

  const d = budget.data as {
    totalOrganizationalBudget?: number;
    availableCash?: number;
    grantFundsAvailable?: number;
    programSpending?: number;
    payrollObligations?: { estimatedMonthlyPayroll?: number; draftTotalCents?: number };
    monthlyBurnRate?: number;
    financialHealthScore?: number;
    healthFactors?: { label: string; score: number; max: number }[];
    budgetRemaining?: number;
    cashFlow?: number;
    netPosition?: number;
    accountsPayable?: number;
    accountsReceivable?: number;
    fundingForecast?: unknown[];
  } | undefined;

  return (
    <div className="hq-fade-in">
      <HqPanel title="Executive Budget Dashboard" subtitle="Phase 4 — real-time organizational financial command center">
        <StatusBadge label="FINANCE PHASE 4" variant="gold" />
        <div className="hq-kpi-grid" style={{ marginTop: "1rem" }}>
          <KpiCard label="Org Budget" value={fmt(d?.totalOrganizationalBudget ?? 0)} icon={PieChart} variant="gold" meta={`${fmt(d?.budgetRemaining ?? 0)} remaining`} />
          <KpiCard label="Available Cash" value={fmt(d?.availableCash ?? 0)} icon={Wallet} variant="success" />
          <KpiCard label="Grant Funds" value={fmt(d?.grantFundsAvailable ?? 0)} icon={DollarSign} variant="gold" />
          <KpiCard label="Program Spending" value={fmt(d?.programSpending ?? 0)} icon={Users} />
          <KpiCard label="Payroll Obligations" value={fmt(d?.payrollObligations?.estimatedMonthlyPayroll ?? 0)} icon={Users} variant="warning" meta="Est. monthly" />
          <KpiCard label="Monthly Burn Rate" value={fmt(d?.monthlyBurnRate ?? 0)} icon={TrendingUp} variant="warning" />
          <KpiCard label="Financial Health" value={`${d?.financialHealthScore ?? 0}/100`} icon={Shield} variant={(d?.financialHealthScore ?? 0) >= 80 ? "success" : "warning"} />
          <KpiCard label="Net Position" value={fmt(d?.netPosition ?? 0)} icon={DollarSign} />
        </div>
      </HqPanel>

      <div className="hq-grid-2 hq-fade-in" style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Cash Flow & Liquidity">
          <div className="hq-activity-item" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Monthly cash flow</span>
            <span style={{ color: (d?.cashFlow ?? 0) >= 0 ? "var(--hq-success)" : "var(--hq-danger)", fontWeight: 600 }}>{fmt(d?.cashFlow ?? 0)}</span>
          </div>
          <div className="hq-activity-item" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Accounts receivable</span>
            <span>{fmt(d?.accountsReceivable ?? 0)}</span>
          </div>
          <div className="hq-activity-item" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Accounts payable</span>
            <span>{fmt(d?.accountsPayable ?? 0)}</span>
          </div>
          <div className="hq-activity-item" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Draft payroll runs</span>
            <span>{fmt((d?.payrollObligations?.draftTotalCents ?? 0) / 100)}</span>
          </div>
        </HqPanel>

        <HqPanel title="Health Score Factors">
          <ul className="hq-mini-list">
            {(d?.healthFactors ?? []).map((f) => (
              <li key={f.label}>{f.label}: {f.score}/{f.max}</li>
            ))}
          </ul>
        </HqPanel>
      </div>
    </div>
  );
};

export const GrantFinancePortfolioPanel: React.FC = () => {
  const portfolio = useQuery({ queryKey: ["grant-finance-portfolio"], queryFn: financeApi.phase4GrantPortfolio, staleTime: 60_000 });

  if (portfolio.isLoading) return <HqLoading message="Loading grant financial portfolio…" />;

  const data = portfolio.data as {
    grants?: Record<string, unknown>[];
    totals?: { awardAmount: number; spent: number; remaining: number; grantsWithReportsDue: number };
  } | undefined;

  return (
    <HqPanel title="Grant Financial Integration" subtitle="Award amounts, balances, spending limits, and reporting status">
      <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
        <KpiCard label="Total Awarded" value={fmt(data?.totals?.awardAmount ?? 0)} icon={DollarSign} variant="gold" />
        <KpiCard label="Spent" value={fmt(data?.totals?.spent ?? 0)} icon={TrendingUp} />
        <KpiCard label="Remaining" value={fmt(data?.totals?.remaining ?? 0)} icon={Wallet} variant="success" />
        <KpiCard label="Reports Due" value={data?.totals?.grantsWithReportsDue ?? 0} icon={Shield} variant={(data?.totals?.grantsWithReportsDue ?? 0) > 0 ? "warning" : "success"} />
      </div>
      <table className="hq-table">
        <thead><tr><th>Grant</th><th>Funder</th><th>Awarded</th><th>Spent</th><th>Remaining</th><th>Burn</th><th>Reports</th></tr></thead>
        <tbody>
          {(data?.grants ?? []).map((g) => (
            <tr key={String(g.id)}>
              <td>{String(g.grant_title ?? g.budget_name ?? "—")}</td>
              <td>{String(g.funder ?? "—")}</td>
              <td>{fmt(Number(g.amount ?? 0))}</td>
              <td>{fmt(Number(g.spent ?? g.totalExpenses ?? 0))}</td>
              <td>{fmt(Number(g.remainingBalance ?? 0))}</td>
              <td>{String(g.burnRate ?? 0)}%</td>
              <td><StatusBadge label={String(g.reportingStatus ?? "current")} variant={g.reportingStatus === "reports_due" ? "warning" : "success"} /></td>
            </tr>
          ))}
          {(data?.grants ?? []).length === 0 && <tr><td colSpan={7} className="hq-muted-text">No active grant awards linked to Finance.</td></tr>}
        </tbody>
      </table>
    </HqPanel>
  );
};

export const FinanceAuraExecutivePanel: React.FC = () => {
  const briefing = useQuery({ queryKey: ["finance-aura-briefing"], queryFn: () => financeApi.phase4AuraBriefing(), staleTime: 120_000 });

  const data = briefing.data as {
    auraInsight?: string; insight?: string; alerts?: string[]; recommendations?: string[]; offline?: boolean;
    financialHealthScore?: number; anomalies?: { message: string; severity: string }[];
  } | undefined;

  return (
    <HqPanel title="AURA Executive Financial Intelligence" subtitle="Budget alerts, anomalies, compliance warnings, and recommendations">
      {briefing.isLoading ? <HqLoading /> : (
        <>
          {(data?.alerts ?? []).length > 0 && (
            <ul className="hq-mini-list" style={{ marginBottom: "0.75rem" }}>
              {(data?.alerts ?? []).map((a) => <li key={a}><StatusBadge label={a} variant="warning" /></li>)}
            </ul>
          )}
          <div className="hq-panel" style={{ padding: "1rem", whiteSpace: "pre-wrap", fontSize: "0.88rem", lineHeight: 1.6 }}>
            <Sparkles size={14} style={{ display: "inline", marginRight: "0.35rem", color: "var(--hq-gold)" }} />
            {data?.auraInsight ?? data?.insight ?? "Briefing will generate on next load."}
            {data?.offline && <div className="hq-muted-text" style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>Offline advisory mode</div>}
          </div>
          {(data?.recommendations ?? []).length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <h4 style={{ fontSize: "0.8rem", color: "var(--hq-gold)" }}>Recommendations</h4>
              <ul className="hq-mini-list">{(data?.recommendations ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </HqPanel>
  );
};

export const RevenueTrackingPanel: React.FC = () => {
  const revenue = useQuery({ queryKey: ["finance-revenue"], queryFn: financeApi.phase4Revenue, staleTime: 60_000 });
  if (revenue.isLoading) return <HqLoading message="Loading revenue tracking…" />;

  const data = revenue.data as {
    summary?: { donationsYtd: number; donationsMonth: number; grantAwardsActive: number; arCollected: number; arOutstanding: number; totalRevenueYtd: number };
    bySource?: { source: string; count: number; total_cents: number }[];
  } | undefined;
  const s = data?.summary;

  return (
    <HqPanel title="Revenue Tracking" subtitle="Donations, grant awards, and accounts receivable">
      <div className="hq-kpi-grid">
        <KpiCard label="Revenue YTD" value={fmt(s?.totalRevenueYtd ?? 0)} icon={DollarSign} variant="gold" />
        <KpiCard label="Donations YTD" value={fmt(s?.donationsYtd ?? 0)} icon={Wallet} />
        <KpiCard label="Donations (Month)" value={fmt(s?.donationsMonth ?? 0)} icon={TrendingUp} />
        <KpiCard label="Active Grants" value={fmt(s?.grantAwardsActive ?? 0)} icon={PieChart} />
        <KpiCard label="AR Collected" value={fmt(s?.arCollected ?? 0)} icon={DollarSign} variant="success" />
        <KpiCard label="AR Outstanding" value={fmt(s?.arOutstanding ?? 0)} icon={Shield} variant={(s?.arOutstanding ?? 0) > 0 ? "warning" : "muted"} />
      </div>
      <table className="hq-table" style={{ marginTop: "1rem" }}>
        <thead><tr><th>Source</th><th>Count</th><th>Total</th></tr></thead>
        <tbody>
          {(data?.bySource ?? []).map((r) => (
            <tr key={String(r.source)}><td>{String(r.source)}</td><td>{r.count}</td><td>{fmt(r.total_cents / 100)}</td></tr>
          ))}
        </tbody>
      </table>
    </HqPanel>
  );
};
