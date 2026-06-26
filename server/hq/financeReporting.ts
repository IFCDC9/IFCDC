import { getDb } from "../db";

export interface ExecutiveDashboard {
  totalRevenue: number;
  donationsReceived: number;
  monthlyExpenses: number;
  monthlyPayroll: number;
  operatingBudget: number;
  budgetRemaining: number;
  grantRevenue: number;
  outstandingInvoices: number;
  accountsReceivable: number;
  accountsPayable: number;
  cashFlow: number;
  programSpending: number;
  financialHealthScore: number;
  healthFactors: { label: string; score: number; max: number }[];
  netPosition: number;
  totalAssets: number;
  cashBalance: number;
}

export interface FinancialStatements {
  balanceSheet: {
    assets: { code: string; name: string; balance: number }[];
    liabilities: { code: string; name: string; balance: number }[];
    equity: { code: string; name: string; balance: number }[];
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
  };
  incomeStatement: {
    revenue: { code: string; name: string; amount: number }[];
    expenses: { code: string; name: string; amount: number }[];
    totalRevenue: number;
    totalExpenses: number;
    netIncome: number;
    period: string;
  };
  cashFlow: {
    operating: number;
    investing: number;
    financing: number;
    netChange: number;
    period: string;
  };
}

export async function buildExecutiveDashboard(): Promise<ExecutiveDashboard> {
  const db = await getDb();

  const donationTotal = (await db.get<{ t: number }>(
    "SELECT COALESCE(SUM(amount_cents), 0) as t FROM funding_events WHERE intent = 'donation'"
  ))?.t ?? 0;

  const monthlyDonations = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM funding_events
     WHERE intent = 'donation' AND created_at >= date('now', 'start of month')`
  ))?.t ?? 0;

  const grantRevenue = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount), 0) as t FROM grant_awards WHERE status = 'active'`
  ))?.t ?? 0;

  const monthlyExpensesTable = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM finance_expenses
     WHERE expense_date >= date('now', 'start of month')`
  ))?.t ?? 0;

  const monthlyPayrollCents = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(total_net_cents), 0) as t FROM finance_payroll_runs
     WHERE status = 'completed' AND processed_at >= date('now', 'start of month')`
  ))?.t ?? 0;

  const programSpending = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM finance_expenses
     WHERE category = 'programs' AND expense_date >= date('now', 'start of year')`
  ))?.t ?? 0;

  const budgets = (await db.all("SELECT allocated, spent FROM finance_budgets")) as { allocated: number; spent: number }[];
  const totalAllocated = budgets.reduce((s, b) => s + b.allocated, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);

  const accounts = (await db.all(
    "SELECT code, account_type, balance_cents FROM finance_accounts WHERE is_active = 1"
  )) as { code: string; account_type: string; balance_cents: number }[];
  const totalAssets = accounts.filter((a) => a.account_type === "asset").reduce((s, a) => s + a.balance_cents, 0);
  const totalLiabilities = accounts.filter((a) => a.account_type === "liability").reduce((s, a) => s + a.balance_cents, 0);
  const cashBalance = accounts.find((a) => a.code === "1000")?.balance_cents ?? 0;

  const arOutstanding = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents - amount_paid_cents), 0) as t FROM finance_invoices
     WHERE invoice_type = 'receivable' AND status NOT IN ('paid', 'void')`
  ))?.t ?? 0;

  const apOutstanding = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents - amount_paid_cents), 0) as t FROM finance_invoices
     WHERE invoice_type = 'payable' AND status NOT IN ('paid', 'void')`
  ))?.t ?? 0;

  const monthlyInflows = monthlyDonations + Math.round((grantRevenue * 100) / 12);
  const monthlyOutflowsTotal = monthlyExpensesTable + monthlyPayrollCents;
  const cashFlow = (monthlyInflows - monthlyOutflowsTotal) / 100;
  const totalRevenue = donationTotal / 100 + grantRevenue;
  const netPosition = (totalAssets - totalLiabilities) / 100;

  const healthFactors = [
    {
      label: "Liquidity (cash vs monthly burn)",
      score: Math.min(25, Math.round((cashBalance / Math.max(monthlyOutflowsTotal, 1)) * 25)),
      max: 25,
    },
    {
      label: "Budget health (remaining allocation)",
      score: totalAllocated > 0 ? Math.min(25, Math.round(((totalAllocated - totalSpent) / totalAllocated) * 25)) : 12,
      max: 25,
    },
    {
      label: "Receivables vs payables",
      score: arOutstanding >= apOutstanding ? 25 : Math.max(0, 25 - Math.round(((apOutstanding - arOutstanding) / Math.max(apOutstanding, 1)) * 25)),
      max: 25,
    },
    {
      label: "Net financial position",
      score: netPosition > 0 ? 25 : Math.max(0, 25 + Math.round(netPosition / 10000)),
      max: 25,
    },
  ];

  const financialHealthScore = Math.min(100, Math.max(0, healthFactors.reduce((s, f) => s + f.score, 0)));

  return {
    totalRevenue,
    donationsReceived: donationTotal / 100,
    monthlyExpenses: monthlyExpensesTable / 100,
    monthlyPayroll: monthlyPayrollCents / 100,
    operatingBudget: totalAllocated,
    budgetRemaining: totalAllocated - totalSpent,
    grantRevenue,
    outstandingInvoices: (arOutstanding + apOutstanding) / 100,
    accountsReceivable: arOutstanding / 100,
    accountsPayable: apOutstanding / 100,
    cashFlow,
    programSpending: programSpending / 100,
    financialHealthScore,
    healthFactors,
    netPosition,
    totalAssets: totalAssets / 100,
    cashBalance: cashBalance / 100,
  };
}

export async function buildFinancialStatements(): Promise<FinancialStatements> {
  const db = await getDb();
  const accounts = (await db.all(
    "SELECT code, name, account_type, balance_cents FROM finance_accounts WHERE is_active = 1 ORDER BY code"
  )) as { code: string; name: string; account_type: string; balance_cents: number }[];

  const toDollars = (cents: number) => Math.round(cents) / 100;
  const assets = accounts.filter((a) => a.account_type === "asset").map((a) => ({ code: a.code, name: a.name, balance: toDollars(a.balance_cents) }));
  const liabilities = accounts.filter((a) => a.account_type === "liability").map((a) => ({ code: a.code, name: a.name, balance: toDollars(a.balance_cents) }));
  const equity = accounts.filter((a) => a.account_type === "equity").map((a) => ({ code: a.code, name: a.name, balance: toDollars(a.balance_cents) }));

  const revenueAccounts = accounts.filter((a) => a.account_type === "revenue");
  const expenseAccounts = accounts.filter((a) => a.account_type === "expense");

  const ytdRevenueLedger = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(ll.credit_cents - ll.debit_cents), 0) as t
     FROM finance_ledger_lines ll JOIN finance_accounts fa ON fa.id = ll.account_id
     WHERE fa.account_type = 'revenue' AND ll.created_at >= date('now', 'start of year')`
  ))?.t ?? 0;

  const ytdExpenseLedger = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(ll.debit_cents - ll.credit_cents), 0) as t
     FROM finance_ledger_lines ll JOIN finance_accounts fa ON fa.id = ll.account_id
     WHERE fa.account_type = 'expense' AND ll.created_at >= date('now', 'start of year')`
  ))?.t ?? 0;

  const revenue = revenueAccounts.map((a) => ({ code: a.code, name: a.name, amount: toDollars(a.balance_cents) }));
  const expenses = expenseAccounts.map((a) => ({ code: a.code, name: a.name, amount: toDollars(a.balance_cents) }));

  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0) || toDollars(ytdRevenueLedger);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0) || toDollars(ytdExpenseLedger);

  const monthlyIn = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(credit_cents), 0) as t FROM finance_ledger_lines ll
     JOIN finance_accounts fa ON fa.id = ll.account_id
     WHERE fa.code = '1000' AND ll.created_at >= date('now', 'start of month')`
  ))?.t ?? 0;

  const monthlyOut = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(debit_cents), 0) as t FROM finance_ledger_lines ll
     JOIN finance_accounts fa ON fa.id = ll.account_id
     WHERE fa.code = '1000' AND ll.created_at >= date('now', 'start of month')`
  ))?.t ?? 0;

  const investingOut = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM finance_expenses
     WHERE expense_date >= date('now', 'start of month')
     AND category IN ('capital', 'equipment', 'facilities', 'assets', 'technology')`
  ))?.t ?? 0;

  const financingNet = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(ll.credit_cents - ll.debit_cents), 0) as t
     FROM finance_ledger_lines ll JOIN finance_accounts fa ON fa.id = ll.account_id
     WHERE fa.account_type IN ('equity', 'liability')
     AND fa.code NOT IN ('2000', '2100')
     AND ll.created_at >= date('now', 'start of month')`
  ))?.t ?? 0;

  const operating = toDollars(monthlyIn - monthlyOut);
  const investing = -toDollars(investingOut);
  const financing = toDollars(financingNet);

  return {
    balanceSheet: {
      assets,
      liabilities,
      equity,
      totalAssets: assets.reduce((s, a) => s + a.balance, 0),
      totalLiabilities: liabilities.reduce((s, l) => s + l.balance, 0),
      totalEquity: equity.reduce((s, e) => s + e.balance, 0),
    },
    incomeStatement: {
      revenue,
      expenses,
      totalRevenue,
      totalExpenses,
      netIncome: totalRevenue - totalExpenses,
      period: `YTD ${new Date().getFullYear()}`,
    },
    cashFlow: {
      operating,
      investing,
      financing,
      netChange: operating + investing + financing,
      period: "Current Month",
    },
  };
}

export async function getIntegrationOptions() {
  const db = await getDb();
  const [people, grants, programs, hqPrograms, departments] = await Promise.all([
    db.all(`SELECT id, first_name, last_name, person_type FROM people WHERE status = 'active' ORDER BY last_name LIMIT 100`),
    db.all(`SELECT aw.id, o.title, o.funder FROM grant_awards aw JOIN grant_opportunities o ON o.id = aw.opportunity_id WHERE aw.status = 'active' ORDER BY o.title LIMIT 50`).catch(() => []),
    db.all(`SELECT id, code, name FROM programs ORDER BY name LIMIT 50`).catch(() => []),
    db.all(`SELECT id, slug, name FROM hq_program_registry WHERE status = 'active' ORDER BY name LIMIT 50`).catch(() => []),
    db.all(`SELECT id, name, code FROM departments ORDER BY name`),
  ]);
  const legacy = (programs as { id: string; code: string; name: string }[]).map((p) => ({
    id: p.id, label: p.name, code: p.code, slug: p.code?.toLowerCase().replace(/\s+/g, "-") ?? p.id,
  }));
  const registry = (hqPrograms as { id: string; slug: string; name: string }[]).map((p) => ({
    id: p.id, label: p.name, code: p.slug, slug: p.slug,
  }));
  const mergedPrograms = [...registry, ...legacy.filter((l) => !registry.some((r) => r.slug === l.slug))];
  return {
    people: (people as { id: string; first_name: string; last_name: string; person_type: string }[]).map((p) => ({
      id: p.id, label: `${p.first_name} ${p.last_name}`, type: p.person_type,
    })),
    grants: (grants as { id: string; title: string; funder: string }[]).map((g) => ({
      id: g.id, label: g.title, funder: g.funder,
    })),
    programs: mergedPrograms,
    departments: (departments as { id: string; name: string; code: string }[]).map((d) => ({
      id: d.id, label: d.name, code: d.code,
    })),
    projects: [
      { id: "barbers", label: "IFCDC Barbers Program" },
      { id: "housing", label: "Housing Assistance" },
      { id: "scholarships", label: "Scholarship Fund" },
      { id: "radio", label: "IFCDC Radio" },
      { id: "mentorship", label: "Youth Mentorship" },
    ],
  };
}
