async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/finance${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface FinanceOverview {
  totalRevenue: number;
  donationsReceived: number;
  donationRevenue: number;
  monthlyDonations: number;
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
  budgets: { id: string; name: string; category: string; allocated: number; spent: number }[];
  totalAllocated: number;
  totalSpent: number;
  remaining: number;
  payrollPending: number;
  vendorCount: number;
  accounts: { code: string; name: string; account_type: string; balance_cents: number }[];
}

export interface FinanceInvoice {
  id: string;
  invoice_type: string;
  invoice_number: string;
  vendor_id: string | null;
  vendor_name?: string;
  customer_name: string | null;
  amount_cents: number;
  amount_paid_cents: number;
  status: string;
  issue_date: string;
  due_date: string;
  description: string | null;
}

export interface IntegrationOptions {
  people: { id: string; label: string; type: string }[];
  grants: { id: string; label: string; funder: string }[];
  programs: { id: string; label: string; code: string; slug?: string }[];
  departments: { id: string; label: string; code: string }[];
  projects: { id: string; label: string }[];
}

export const financeApi = {
  overview: () => apiFetch<FinanceOverview>("/overview"),
  dashboard: () => apiFetch<FinanceOverview>("/dashboard"),
  statements: () => apiFetch<{
    balanceSheet: { assets: { code: string; name: string; balance: number }[]; liabilities: { code: string; name: string; balance: number }[]; equity: { code: string; name: string; balance: number }[]; totalAssets: number; totalLiabilities: number; totalEquity: number };
    incomeStatement: { revenue: { code: string; name: string; amount: number }[]; expenses: { code: string; name: string; amount: number }[]; totalRevenue: number; totalExpenses: number; netIncome: number; period: string };
    cashFlow: { operating: number; investing: number; financing: number; netChange: number; period: string };
  }>("/statements"),
  integrations: () => apiFetch<IntegrationOptions>("/integrations"),

  donations: () => apiFetch<{ donations: Record<string, unknown>[]; total: number }>("/donations"),
  expenses: () => apiFetch<{ expenses: Record<string, unknown>[] }>("/expenses"),
  createExpense: (data: {
    category: string; description: string; amount: number; vendor?: string; expense_date?: string;
    person_id?: string; grant_id?: string; program_id?: string; program_slug?: string; department_id?: string; project_id?: string;
  }) => apiFetch("/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  approveExpense: (id: string) => apiFetch(`/expenses/${id}/approve`, { method: "PATCH" }),
  denyExpense: (id: string) => apiFetch(`/expenses/${id}/deny`, { method: "PATCH" }),

  purchaseOrders: () => apiFetch<{ purchaseOrders: Record<string, unknown>[] }>("/purchase-orders"),
  createPurchaseOrder: (data: { title: string; vendor: string; amount: number; description?: string; department_id?: string; grant_id?: string }) =>
    apiFetch("/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updatePurchaseOrder: (id: string, data: { status: string }) =>
    apiFetch(`/purchase-orders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  convertPoToInvoice: (id: string) =>
    apiFetch<{ invoice: Record<string, unknown>; purchaseOrder: Record<string, unknown> }>(`/purchase-orders/${id}/convert-invoice`, { method: "POST" }),

  budgets: () => apiFetch<{ budgets: Record<string, unknown>[] }>("/budgets"),
  createBudget: (data: { name: string; category: string; allocated: number; fiscal_year?: string; department_id?: string; grant_id?: string; program_id?: string }) =>
    apiFetch("/budgets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  paymentSources: () => apiFetch<{ sources: Record<string, unknown>[] }>("/payment-sources"),

  accounts: () => apiFetch<{ accounts: Record<string, unknown>[] }>("/accounts"),
  ledger: (params?: { account?: string; from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.account) qs.set("account", params.account);
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    const q = qs.toString();
    return apiFetch<{ entries: Record<string, unknown>[] }>(`/ledger${q ? `?${q}` : ""}`);
  },
  postJournal: (data: { entry_date: string; description: string; lines: { account_id: string; debit?: number; credit?: number }[] }) =>
    apiFetch("/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  vendors: () => apiFetch<{ vendors: Record<string, unknown>[] }>("/vendors"),
  createVendor: (data: { name: string; contact_name?: string; email?: string; phone?: string; payment_terms?: string }) =>
    apiFetch("/vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  invoices: (type?: string) => apiFetch<{ invoices: FinanceInvoice[] }>(`/invoices${type ? `?type=${type}` : ""}`),
  accountsPayable: () => apiFetch<{ invoices: FinanceInvoice[]; totalOutstanding: number }>("/accounts-payable"),
  accountsReceivable: () => apiFetch<{ invoices: FinanceInvoice[]; totalOutstanding: number }>("/accounts-receivable"),
  createInvoice: (data: Record<string, unknown>) =>
    apiFetch("/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updateInvoice: (id: string, data: { status?: string; amount_paid?: number }) =>
    apiFetch(`/invoices/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  payrollOverview: () => apiFetch<{
    activeEmployees: number; hoursThisMonth: number; recentRuns: Record<string, unknown>[];
    lastRunNet: number; lastRunStatus: string | null;
  }>("/payroll/overview"),
  payrollRuns: () => apiFetch<{ runs: Record<string, unknown>[] }>("/payroll/runs"),
  createPayrollRun: (data: { period_start: string; period_end: string; notes?: string }) =>
    apiFetch("/payroll/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  processPayrollRun: (id: string) => apiFetch(`/payroll/runs/${id}/process`, { method: "POST" }),

  tax: () => apiFetch<{ reports: Record<string, unknown>[]; ytdRevenue: number; ytdExpenses: number; ytdNet: number }>("/tax"),
  createTaxReport: (data: { period: string; report_type: string; notes?: string }) =>
    apiFetch("/tax", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updateTaxReport: (id: string, data: { status?: string; notes?: string }) =>
    apiFetch(`/tax/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  audit: (opts?: { limit?: number; action?: string; entity?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.limit) qs.set("limit", String(opts.limit));
    if (opts?.action) qs.set("action", opts.action);
    if (opts?.entity) qs.set("entity", opts.entity);
    const q = qs.toString();
    return apiFetch<{ audit: Record<string, unknown>[] }>(`/audit${q ? `?${q}` : ""}`);
  },

  bankAccounts: () => apiFetch<{ accounts: Record<string, unknown>[] }>("/bank/accounts"),
  bankTransactions: (accountId?: string) =>
    apiFetch<{ transactions: Record<string, unknown>[] }>(`/bank/transactions${accountId ? `?account_id=${accountId}` : ""}`),
  bankReconciliations: () => apiFetch<{ reconciliations: Record<string, unknown>[] }>("/bank/reconciliations"),
  reconcileBank: (data: { bank_account_id: string; statement_date: string; statement_balance: number; transaction_ids?: string[]; notes?: string }) =>
    apiFetch("/bank/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),

  forecast: () => apiFetch<Record<string, unknown>>("/intelligence/forecast"),
  multiYearBudget: (years?: number) => apiFetch<Record<string, unknown>>(`/intelligence/multi-year${years ? `?years=${years}` : ""}`),
  form990Preview: () => apiFetch<Record<string, unknown>>("/intelligence/form-990"),
  boardReport: () => apiFetch<Record<string, unknown>>("/intelligence/board-report"),
  programsSummary: () => apiFetch<{
    programs: { slug: string; name: string; budgetAllocated: number; budgetSpent: number; expenseCount: number; expenseTotal: number; remaining: number }[];
    legacyPrograms: { id: string; code: string; name: string; budgetAllocated: number; budgetSpent: number; expenseTotal: number; remaining: number }[];
    totals: { allocated: number; spent: number; remaining: number };
  }>("/programs/summary"),
  expensesByProgram: () => apiFetch<{ byProgram: { program: string; expense_count: number; approved_cents: number; total_cents: number }[] }>("/expenses/by-program"),
  grantLinkedExpenses: () => apiFetch<{
    expenses: Record<string, unknown>[];
    payrollRuns: Record<string, unknown>[];
    grantTotals: { funder: string; title: string; expense_count: number; total_cents: number }[];
    totalGrantExpenses: number;
  }>("/expenses/grant-linked"),
  quickBooks: () => apiFetch<Record<string, unknown>>("/quickbooks"),
  quickBooksSync: () =>
    apiFetch<{ success: boolean; sync: Record<string, unknown> }>("/quickbooks/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),

  // Phase 4 — Finance Command Center
  phase4Platform: () => apiFetch<{ version: string; modules: { id: string; label: string; tab: string }[]; counts: Record<string, number> }>("/operations/v4/platform"),
  phase4ExecutiveBudget: () => apiFetch<Record<string, unknown>>("/operations/v4/executive-budget"),
  phase4Revenue: () => apiFetch<Record<string, unknown>>("/operations/v4/revenue"),
  phase4GrantPortfolio: () => apiFetch<Record<string, unknown>>("/operations/v4/grant-portfolio"),
  phase4Anomalies: () => apiFetch<Record<string, unknown>>("/operations/v4/anomalies"),
  phase4AuraBriefing: (question?: string) =>
    apiFetch<Record<string, unknown>>(`/operations/v4/aura-briefing${question ? `?question=${encodeURIComponent(question)}` : ""}`),
  createAccount: (data: { code: string; name: string; account_type: string }) =>
    apiFetch("/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updateAccount: (id: string, data: { name?: string; is_active?: number }) =>
    apiFetch(`/accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  createBankAccount: (data: { name: string; institution?: string; account_number_last4?: string; account_type?: string; opening_balance?: number }) =>
    apiFetch("/bank/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  updateBudget: (id: string, data: Record<string, unknown>) =>
    apiFetch(`/budgets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
};
