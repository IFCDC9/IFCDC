/**
 * Phase 4 — Finance, Budgeting, and Executive Intelligence
 */
import { getDb } from "../db";
import { buildExecutiveDashboard, buildFinancialStatements } from "./financeReporting";
import { buildFinanceForecast } from "./financeIntelligence";
import { getGrantFinancialSummary } from "./grantFinanceIntegration";
import { predictFinancialRisk } from "./auraExecutiveOps";
import { financeId, logFinanceAudit } from "./financeSchema";

export const FINANCE_PHASE4_MODULES = [
  { id: "chart-of-accounts", label: "Chart of Accounts", tab: "ledger" },
  { id: "budgets", label: "Budget Management", tab: "budgets" },
  { id: "revenue", label: "Revenue Tracking", tab: "donations" },
  { id: "expenses", label: "Expense Tracking", tab: "expenses" },
  { id: "ap", label: "Accounts Payable", tab: "payable" },
  { id: "ar", label: "Accounts Receivable", tab: "receivable" },
  { id: "cash-flow", label: "Cash Flow Dashboard", tab: "executive-budget" },
  { id: "bank", label: "Bank Account Management", tab: "bank" },
  { id: "statements", label: "Financial Statements", tab: "statements" },
  { id: "audit", label: "Audit Log", tab: "audit" },
  { id: "grants", label: "Grant Financial Integration", tab: "grant-portfolio" },
  { id: "intelligence", label: "Executive Intelligence", tab: "intelligence" },
] as const;

export async function buildFinanceCommandCenterPlatform() {
  const db = await getDb();
  const counts = {
    accounts: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_accounts WHERE is_active = 1"))?.c ?? 0,
    budgets: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_budgets"))?.c ?? 0,
    expenses: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_expenses"))?.c ?? 0,
    invoices: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_invoices"))?.c ?? 0,
    bankAccounts: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_bank_accounts"))?.c ?? 0,
    auditEntries: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_audit_log"))?.c ?? 0,
    activeGrants: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_awards WHERE status = 'active'"))?.c ?? 0,
  };
  return {
    version: "phase4",
    modules: FINANCE_PHASE4_MODULES,
    counts,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildExecutiveBudgetDashboard() {
  const [dashboard, forecast, statements, payrollObligations] = await Promise.all([
    buildExecutiveDashboard(),
    buildFinanceForecast(),
    buildFinancialStatements(),
    buildPayrollObligations(),
  ]);

  const monthlyBurnRate = dashboard.monthlyExpenses + dashboard.monthlyPayroll;
  const grantFundsAvailable = Math.max(0, dashboard.grantRevenue - dashboard.programSpending);

  return {
    totalOrganizationalBudget: dashboard.operatingBudget,
    availableCash: dashboard.cashBalance,
    grantFundsAvailable,
    programSpending: dashboard.programSpending,
    payrollObligations,
    monthlyBurnRate,
    fundingForecast: forecast.cashFlowForecast ?? forecast.monthlyTrend,
    financialHealthScore: dashboard.financialHealthScore,
    healthFactors: dashboard.healthFactors,
    cashFlow: dashboard.cashFlow,
    netPosition: dashboard.netPosition,
    accountsPayable: dashboard.accountsPayable,
    accountsReceivable: dashboard.accountsReceivable,
    budgetRemaining: dashboard.budgetRemaining,
    totalRevenue: dashboard.totalRevenue,
    incomeStatement: statements.incomeStatement,
    timestamp: new Date().toISOString(),
  };
}

async function buildPayrollObligations() {
  const db = await getDb();
  const draftRuns = await db.all(
    `SELECT id, period_start, period_end, total_net_cents, status FROM finance_payroll_runs
     WHERE status IN ('draft', 'pending') ORDER BY period_end DESC LIMIT 5`
  );
  const activePayrollStaff = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM people WHERE status = 'active' AND pay_rate IS NOT NULL
     AND person_type IN ('employee', 'contractor', 'barber')`
  ))?.c ?? 0;
  const avgRate = (await db.get<{ avg: number }>(
    "SELECT AVG(pay_rate) as avg FROM people WHERE status = 'active' AND pay_rate IS NOT NULL"
  ))?.avg ?? 25;
  const estimatedMonthly = Math.round(activePayrollStaff * avgRate * 80);
  const draftTotal = (draftRuns as { total_net_cents: number }[]).reduce((s, r) => s + (r.total_net_cents ?? 0), 0);
  return {
    draftRuns,
    draftTotalCents: draftTotal,
    estimatedMonthlyPayroll: estimatedMonthly,
    activePayrollStaff,
  };
}

export async function buildRevenueTracking() {
  const db = await getDb();
  const donationsYtd = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM funding_events
     WHERE intent = 'donation' AND created_at >= date('now', 'start of year')`
  ))?.t ?? 0;
  const donationsMonth = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM funding_events
     WHERE intent = 'donation' AND created_at >= date('now', 'start of month')`
  ))?.t ?? 0;
  const grantAwardsYtd = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount), 0) as t FROM grant_awards WHERE status = 'active'`
  ))?.t ?? 0;
  const arCollected = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_paid_cents), 0) as t FROM finance_invoices
     WHERE invoice_type = 'receivable' AND status = 'paid' AND updated_at >= date('now', 'start of year')`
  ))?.t ?? 0;
  const arOutstanding = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents - amount_paid_cents), 0) as t FROM finance_invoices
     WHERE invoice_type = 'receivable' AND status NOT IN ('paid', 'void')`
  ))?.t ?? 0;

  const bySource = await db.all(`
    SELECT COALESCE(source_key, 'Direct') as source, COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as total_cents
    FROM funding_events
    WHERE intent = 'donation' AND created_at >= date('now', 'start of year')
    GROUP BY source_key ORDER BY total_cents DESC LIMIT 10
  `);

  const recentDonations = await db.all(
    `SELECT id, amount_cents, source_key, created_at FROM funding_events
     WHERE intent = 'donation' ORDER BY created_at DESC LIMIT 15`
  );

  return {
    summary: {
      donationsYtd: donationsYtd / 100,
      donationsMonth: donationsMonth / 100,
      grantAwardsActive: grantAwardsYtd,
      arCollected: arCollected / 100,
      arOutstanding: arOutstanding / 100,
      totalRevenueYtd: donationsYtd / 100 + grantAwardsYtd + arCollected / 100,
    },
    bySource,
    recentDonations,
    timestamp: new Date().toISOString(),
  };
}

export async function buildGrantFinancePortfolio() {
  const db = await getDb();
  const awards = await db.all(`
    SELECT ga.id, ga.amount, ga.status, ga.lifecycle_stage, ga.finance_budget_id, ga.period_start, ga.period_end,
      go.title as grant_title, go.funder,
      fb.allocated, fb.spent, fb.name as budget_name,
      (SELECT COUNT(*) FROM grant_compliance gc WHERE gc.award_id = ga.id AND gc.status IN ('pending', 'overdue')) as pending_reports,
      (SELECT MIN(gc.due_date) FROM grant_compliance gc WHERE gc.award_id = ga.id AND gc.status = 'pending') as next_report_due
    FROM grant_awards ga
    LEFT JOIN grant_opportunities go ON go.id = ga.opportunity_id
    LEFT JOIN finance_budgets fb ON fb.id = ga.finance_budget_id
    WHERE ga.status IN ('active', 'reporting')
    ORDER BY ga.period_end ASC
  `);

  const portfolio = await Promise.all(
    (awards as { id: string; amount: number; allocated: number; spent: number; pending_reports: number }[]).map(async (a) => {
      const detail = await getGrantFinancialSummary(a.id);
      return {
        ...a,
        remainingBalance: detail?.budgetRemaining ?? (a.amount - (a.spent ?? 0)),
        burnRate: detail?.burnRate ?? 0,
        totalExpenses: detail?.totalExpenses ?? 0,
        totalLabor: detail?.totalLabor ?? 0,
        reportingStatus: a.pending_reports > 0 ? "reports_due" : "current",
      };
    })
  );

  const totals = {
    awardAmount: portfolio.reduce((s, g) => s + Number(g.amount ?? 0), 0),
    spent: portfolio.reduce((s, g) => s + Number(g.spent ?? g.totalExpenses ?? 0), 0),
    remaining: portfolio.reduce((s, g) => s + Number(g.remainingBalance ?? 0), 0),
    grantsWithReportsDue: portfolio.filter((g) => g.reportingStatus === "reports_due").length,
  };

  return { grants: portfolio, totals, timestamp: new Date().toISOString() };
}

export async function detectSpendingAnomalies() {
  const db = await getDb();
  const thisMonth = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM finance_expenses
     WHERE expense_date >= date('now', 'start of month') AND approval_status = 'approved'`
  ))?.t ?? 0;
  const avgPrior = (await db.get<{ t: number }>(
    `SELECT COALESCE(AVG(monthly_total), 0) as t FROM (
      SELECT strftime('%Y-%m', expense_date) as m, SUM(amount_cents) as monthly_total
      FROM finance_expenses WHERE approval_status = 'approved'
        AND expense_date >= date('now', '-6 months') AND expense_date < date('now', 'start of month')
      GROUP BY m
    )`
  ))?.t ?? 0;

  const anomalies: { type: string; severity: string; message: string; amount?: number }[] = [];
  if (avgPrior > 0 && thisMonth > avgPrior * 1.35) {
    anomalies.push({
      type: "expense_spike",
      severity: "high",
      message: `Monthly expenses ${Math.round((thisMonth / avgPrior - 1) * 100)}% above 6-month average`,
      amount: thisMonth / 100,
    });
  }

  const largeExpenses = await db.all(`
    SELECT id, description, amount_cents, category, expense_date FROM finance_expenses
    WHERE approval_status = 'approved' AND amount_cents > ?
    AND expense_date >= date('now', '-30 days') ORDER BY amount_cents DESC LIMIT 5
  `, Math.max(avgPrior * 0.25, 50000));

  for (const e of largeExpenses as { id: string; description: string; amount_cents: number }[]) {
    anomalies.push({
      type: "large_expense",
      severity: "medium",
      message: `Large expense: ${e.description}`,
      amount: e.amount_cents / 100,
    });
  }

  const overdueAp = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM finance_invoices
     WHERE invoice_type = 'payable' AND status NOT IN ('paid', 'void') AND due_date < date('now')`
  ))?.c ?? 0;
  if (overdueAp > 0) {
    anomalies.push({ type: "overdue_ap", severity: "high", message: `${overdueAp} overdue payable invoice(s)` });
  }

  return { anomalies, thisMonth: thisMonth / 100, avgPriorMonth: avgPrior / 100, timestamp: new Date().toISOString() };
}

export async function buildFinanceExecutiveBriefing(opts?: { question?: string }) {
  const [budgetDash, revenue, grantPortfolio, risk, anomalies, forecast] = await Promise.all([
    buildExecutiveBudgetDashboard(),
    buildRevenueTracking(),
    buildGrantFinancePortfolio(),
    predictFinancialRisk(),
    detectSpendingAnomalies(),
    buildFinanceForecast(),
  ]);

  const alerts: string[] = [];
  if (budgetDash.financialHealthScore < 70) alerts.push(`Financial health score ${budgetDash.financialHealthScore}/100 — attention needed`);
  if (grantPortfolio.totals.grantsWithReportsDue > 0) {
    alerts.push(`${grantPortfolio.totals.grantsWithReportsDue} grant(s) with reporting due`);
  }
  if (anomalies.anomalies.some((a) => a.severity === "high")) {
    alerts.push("High-severity spending anomalies detected");
  }
  if (risk.riskLevel === "high" || risk.riskLevel === "moderate") {
    alerts.push(`Financial risk level: ${risk.riskLevel}`);
  }

  const briefing = {
    financialHealthScore: budgetDash.financialHealthScore,
    availableCash: budgetDash.availableCash,
    monthlyBurnRate: budgetDash.monthlyBurnRate,
    grantFundsAvailable: budgetDash.grantFundsAvailable,
    payrollObligations: budgetDash.payrollObligations,
    revenue: revenue.summary,
    grantPortfolio: grantPortfolio.totals,
    risk,
    anomalies: anomalies.anomalies,
    alerts,
    recommendations: risk.recommendations ?? [],
    projectedCashFlow: forecast.projectedCashFlow,
  };

  const question = opts?.question?.trim() ?? "Summarize IFCDC financial position, budget alerts, and executive recommendations.";
  let auraInsight = [
    `Financial Health: ${budgetDash.financialHealthScore}/100`,
    `Available Cash: $${budgetDash.availableCash.toLocaleString()}`,
    `Monthly Burn Rate: $${budgetDash.monthlyBurnRate.toLocaleString()}`,
    `Grant Funds Available: $${budgetDash.grantFundsAvailable.toLocaleString()}`,
    alerts.length ? `Alerts: ${alerts.join("; ")}` : "No critical financial alerts.",
    (risk.recommendations as string[] | undefined)?.slice(0, 3).join("\n") ?? "",
  ].filter(Boolean).join("\n");
  let offline = true;

  try {
    const { auraExecutiveChat } = await import("../lib/ifcdc");
    const { buildAuraExecutiveContext } = await import("./auraExecutiveContext");
    const context = await buildAuraExecutiveContext();
    auraInsight = await auraExecutiveChat(
      `${question}\n\nRespond as IFCDC Finance Executive Intelligence advisor.`,
      `${context}\n\nPhase 4 Finance Briefing:\n${JSON.stringify(briefing, null, 2)}`
    );
    offline = false;
  } catch {
    // offline briefing
  }

  return { ...briefing, auraInsight, offline, insight: auraInsight };
}

export async function createFinanceAccount(data: {
  code: string; name: string; account_type: string; parent_code?: string;
}, actor?: { email?: string }) {
  const db = await getDb();
  const existing = await db.get("SELECT id FROM finance_accounts WHERE code = ?", data.code);
  if (existing) throw new Error("Account code already exists");
  const now = new Date().toISOString();
  const id = financeId();
  await db.run(
    `INSERT INTO finance_accounts (id, code, name, account_type, balance_cents, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
    id, data.code, data.name, data.account_type, now, now
  );
  await logFinanceAudit("account_created", "account", id, `${data.code} ${data.name}`, actor);
  return db.get("SELECT * FROM finance_accounts WHERE id = ?", id);
}

export async function updateFinanceAccount(id: string, data: { name?: string; is_active?: number }, actor?: { email?: string }) {
  const db = await getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.name !== undefined) { sets.push("name = ?"); vals.push(data.name); }
  if (data.is_active !== undefined) { sets.push("is_active = ?"); vals.push(data.is_active); }
  if (!sets.length) return null;
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString(), id);
  await db.run(`UPDATE finance_accounts SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  await logFinanceAudit("account_updated", "account", id, "Chart of accounts update", actor);
  return db.get("SELECT * FROM finance_accounts WHERE id = ?", id);
}

export async function createBankAccount(data: {
  name: string; institution?: string; account_number_last4?: string; account_type?: string; opening_balance?: number;
}, actor?: { email?: string }) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = financeId();
  const balanceCents = Math.round((data.opening_balance ?? 0) * 100);
  await db.run(
    `INSERT INTO finance_bank_accounts (id, name, institution, account_number_last4, balance_cents, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, data.name, data.institution ?? "", data.account_number_last4 ?? "", balanceCents, now, now
  );
  await logFinanceAudit("bank_account_created", "bank_account", id, data.name, actor, balanceCents);
  return db.get("SELECT * FROM finance_bank_accounts WHERE id = ?", id);
}
