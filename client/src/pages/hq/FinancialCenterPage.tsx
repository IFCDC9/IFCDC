import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import {
  Heart, Wallet, PieChart, CreditCard, Plus, BookOpen, Building2,
  FileText, ArrowDownLeft, ArrowUpRight, Users, Receipt, Shield, Landmark, Scale, ClipboardList, Check, X, TrendingUp,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { financeApi, type FinanceInvoice } from "../../api/financeApi";
import { integrationsApi } from "../../api/integrationsApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { FinanceChart } from "../../components/hq/FinanceChart";
import { ExecutiveBudgetDashboard, GrantFinancePortfolioPanel, FinanceAuraExecutivePanel, RevenueTrackingPanel } from "../../components/hq/finance/FinancePhase4Panels";
import { hqApi } from "../../api/hqApi";
import { formatCurrency, formatDateTime } from "../../utils/safeFormat";

type Tab = "overview" | "executive-budget" | "revenue" | "grant-portfolio" | "ledger" | "budgets" | "donations" | "expenses" | "purchase-orders" | "invoices"
  | "payable" | "receivable" | "vendors" | "payroll" | "tax" | "audit" | "payments" | "statements" | "bank" | "intelligence"
  | "programs" | "grant-expenses" | "board" | "quickbooks";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Executive Dashboard", icon: PieChart },
  { id: "executive-budget", label: "Budget Command", icon: TrendingUp },
  { id: "revenue", label: "Revenue", icon: ArrowDownLeft },
  { id: "grant-portfolio", label: "Grant Finance", icon: FileText },
  { id: "ledger", label: "General Ledger", icon: BookOpen },
  { id: "statements", label: "Financial Statements", icon: Scale },
  { id: "budgets", label: "Budget Planning", icon: PieChart },
  { id: "programs", label: "Program Budgets", icon: Users },
  { id: "grant-expenses", label: "Grant Expenses", icon: FileText },
  { id: "donations", label: "Donations", icon: Heart },
  { id: "expenses", label: "Expenses", icon: Wallet },
  { id: "purchase-orders", label: "Purchase Orders", icon: ClipboardList },
  { id: "payable", label: "Accounts Payable", icon: ArrowUpRight },
  { id: "receivable", label: "Accounts Receivable", icon: ArrowDownLeft },
  { id: "invoices", label: "Invoicing", icon: FileText },
  { id: "vendors", label: "Vendors", icon: Building2 },
  { id: "payroll", label: "Payroll", icon: Users },
  { id: "board", label: "Board Summary", icon: Building2 },
  { id: "quickbooks", label: "QuickBooks Sync", icon: Landmark },
  { id: "bank", label: "Bank Reconciliation", icon: Landmark },
  { id: "tax", label: "Tax Reporting", icon: Receipt },
  { id: "intelligence", label: "Financial Intelligence", icon: TrendingUp },
  { id: "audit", label: "Audit Trail", icon: Shield },
  { id: "payments", label: "Payment Sources", icon: CreditCard },
];

const INV_STATUS: Record<string, "gold" | "success" | "warning" | "danger" | "muted"> = {
  draft: "muted", sent: "gold", partial: "warning", paid: "success", overdue: "danger", void: "muted",
};

function fmtCents(c: number | null | undefined): string {
  if (c == null || Number.isNaN(c)) return "—";
  return `$${(c / 100).toFixed(2)}`;
}

const fmt = formatCurrency;

function fmtDate(d: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const FinancialCenterPage: React.FC = () => {
  const location = useLocation();
  const [tab, setTab] = useState<Tab>("overview");
  const [expenseForm, setExpenseForm] = useState({
    category: "operations", description: "", amount: "", vendor: "",
    department_id: "", grant_id: "", program_id: "", project_id: "", person_id: "",
  });
  const [vendorForm, setVendorForm] = useState({ name: "", contact_name: "", email: "" });
  const [invoiceForm, setInvoiceForm] = useState({
    invoice_type: "receivable", invoice_number: "", amount: "", customer_name: "", vendor_id: "",
    due_date: "", description: "", grant_id: "", department_id: "", program_id: "",
  });
  const [budgetForm, setBudgetForm] = useState({ name: "", category: "programs", allocated: "", department_id: "", grant_id: "" });
  const [poForm, setPoForm] = useState({ title: "", vendor: "", amount: "", description: "", department_id: "", grant_id: "" });
  const [taxForm, setTaxForm] = useState({ period: `${new Date().getFullYear()}-Q1`, report_type: "form_990", notes: "" });
  const [reconcileForm, setReconcileForm] = useState({ bank_account_id: "", statement_date: "", statement_balance: "" });
  const [selectedBankTxns, setSelectedBankTxns] = useState<string[]>([]);
  const [auditFilter, setAuditFilter] = useState({ action: "", entity: "" });
  const [journalForm, setJournalForm] = useState({ entry_date: new Date().toISOString().slice(0, 10), description: "", debit_account_id: "", credit_account_id: "", amount: "" });
  const qc = useQueryClient();

  useEffect(() => {
    if (location.pathname === "/hq/donations") setTab("donations");
    const params = new URLSearchParams(location.search);
    const t = params.get("tab");
    if (t === "quickbooks") setTab("quickbooks");
    else if (t && TABS.some((x) => x.id === t)) setTab(t as Tab);
  }, [location.pathname, location.search]);

  const overview = useQuery({ queryKey: ["finance-overview"], queryFn: financeApi.overview });
  const donations = useQuery({ queryKey: ["finance-donations"], queryFn: financeApi.donations, enabled: tab === "donations" || tab === "overview" });
  const expenses = useQuery({ queryKey: ["finance-expenses"], queryFn: financeApi.expenses, enabled: tab === "expenses" || tab === "overview" });
  const purchaseOrders = useQuery({ queryKey: ["finance-purchase-orders"], queryFn: financeApi.purchaseOrders, enabled: tab === "purchase-orders" || tab === "overview" });
  const budgets = useQuery({ queryKey: ["finance-budgets"], queryFn: financeApi.budgets, enabled: tab === "budgets" || tab === "overview" });
  const payments = useQuery({ queryKey: ["finance-payments"], queryFn: financeApi.paymentSources, enabled: tab === "payments" });
  const ledger = useQuery({ queryKey: ["finance-ledger"], queryFn: () => financeApi.ledger(), enabled: tab === "ledger" });
  const accounts = useQuery({ queryKey: ["finance-accounts"], queryFn: financeApi.accounts, enabled: tab === "ledger" || tab === "overview" });
  const vendors = useQuery({ queryKey: ["finance-vendors"], queryFn: financeApi.vendors, enabled: tab === "vendors" || tab === "invoices" });
  const invoices = useQuery({ queryKey: ["finance-invoices"], queryFn: () => financeApi.invoices(), enabled: tab === "invoices" });
  const payable = useQuery({ queryKey: ["finance-ap"], queryFn: financeApi.accountsPayable, enabled: tab === "payable" || tab === "overview" });
  const receivable = useQuery({ queryKey: ["finance-ar"], queryFn: financeApi.accountsReceivable, enabled: tab === "receivable" || tab === "overview" });
  const payroll = useQuery({ queryKey: ["finance-payroll"], queryFn: financeApi.payrollOverview, enabled: tab === "payroll" || tab === "overview" });
  const payrollRuns = useQuery({ queryKey: ["finance-payroll-runs"], queryFn: financeApi.payrollRuns, enabled: tab === "payroll" });
  const tax = useQuery({ queryKey: ["finance-tax"], queryFn: financeApi.tax, enabled: tab === "tax" });
  const audit = useQuery({
    queryKey: ["finance-audit", auditFilter],
    queryFn: () => financeApi.audit({ limit: 75, action: auditFilter.action || undefined, entity: auditFilter.entity || undefined }),
    enabled: tab === "audit",
  });
  const statements = useQuery({ queryKey: ["finance-statements"], queryFn: financeApi.statements, enabled: tab === "statements" || tab === "overview" });
  const bankAccounts = useQuery({ queryKey: ["finance-bank-accounts"], queryFn: financeApi.bankAccounts, enabled: tab === "bank" });
  const forecast = useQuery({ queryKey: ["finance-forecast"], queryFn: financeApi.forecast, enabled: tab === "intelligence" || tab === "overview" });
  const multiYear = useQuery({ queryKey: ["finance-multi-year"], queryFn: () => financeApi.multiYearBudget(3), enabled: tab === "intelligence" });
  const form990 = useQuery({ queryKey: ["finance-form-990"], queryFn: financeApi.form990Preview, enabled: tab === "intelligence" });
  const boardReport = useQuery({ queryKey: ["finance-board-report"], queryFn: financeApi.boardReport, enabled: tab === "intelligence" || tab === "board" });
  const programsSummary = useQuery({ queryKey: ["finance-programs-summary"], queryFn: financeApi.programsSummary, enabled: tab === "programs" || tab === "overview" });
  const expensesByProgram = useQuery({ queryKey: ["finance-expenses-by-program"], queryFn: financeApi.expensesByProgram, enabled: tab === "programs" });
  const grantLinked = useQuery({ queryKey: ["finance-grant-linked"], queryFn: financeApi.grantLinkedExpenses, enabled: tab === "grant-expenses" || tab === "overview" });
  const bankTxns = useQuery({ queryKey: ["finance-bank-txns"], queryFn: () => financeApi.bankTransactions(), enabled: tab === "bank" });
  const reconciliations = useQuery({ queryKey: ["finance-reconciliations"], queryFn: financeApi.bankReconciliations, enabled: tab === "bank" });
  const integrations = useQuery({ queryKey: ["finance-integrations"], queryFn: financeApi.integrations, enabled: tab === "expenses" || tab === "invoices" || tab === "budgets" || tab === "purchase-orders" || tab === "programs" });
  const trend = useQuery({ queryKey: ["hq-executive-overview"], queryFn: hqApi.executiveOverview, enabled: tab === "overview" });
  const quickBooks = useQuery({ queryKey: ["finance-quickbooks"], queryFn: financeApi.quickBooks, enabled: tab === "quickbooks" });
  const qbConnect = useMutation({
    mutationFn: integrationsApi.quickBooksConnect,
    onSuccess: (data) => { if (data.authUrl) window.location.href = data.authUrl; },
  });
  const qbSync = useMutation({
    mutationFn: financeApi.quickBooksSync,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-quickbooks"] }),
  });

  const addExpense = useMutation({
    mutationFn: financeApi.createExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-expenses"] });
      qc.invalidateQueries({ queryKey: ["finance-overview"] });
      qc.invalidateQueries({ queryKey: ["finance-audit"] });
      qc.invalidateQueries({ queryKey: ["hq-approval-tasks"] });
      setExpenseForm({ category: "operations", description: "", amount: "", vendor: "", department_id: "", grant_id: "", program_id: "", project_id: "", person_id: "" });
    },
  });

  const approveExpense = useMutation({
    mutationFn: financeApi.approveExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-expenses"] });
      qc.invalidateQueries({ queryKey: ["finance-overview"] });
      qc.invalidateQueries({ queryKey: ["finance-ledger"] });
      qc.invalidateQueries({ queryKey: ["finance-budgets"] });
      qc.invalidateQueries({ queryKey: ["hq-approval-tasks"] });
    },
  });

  const denyExpense = useMutation({
    mutationFn: financeApi.denyExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-expenses"] });
      qc.invalidateQueries({ queryKey: ["hq-approval-tasks"] });
    },
  });

  const addPurchaseOrder = useMutation({
    mutationFn: financeApi.createPurchaseOrder,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["hq-approval-tasks"] });
      setPoForm({ title: "", vendor: "", amount: "", description: "", department_id: "", grant_id: "" });
    },
  });

  const updatePurchaseOrder = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => financeApi.updatePurchaseOrder(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["hq-approval-tasks"] });
    },
  });

  const convertPoToInvoice = useMutation({
    mutationFn: financeApi.convertPoToInvoice,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["finance-ap"] });
      qc.invalidateQueries({ queryKey: ["finance-invoices"] });
      qc.invalidateQueries({ queryKey: ["finance-overview"] });
    },
  });

  const createTaxReport = useMutation({
    mutationFn: financeApi.createTaxReport,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-tax"] });
      setTaxForm((f) => ({ ...f, notes: "" }));
    },
  });

  const fileTaxReport = useMutation({
    mutationFn: ({ id }: { id: string }) => financeApi.updateTaxReport(id, { status: "filed" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-tax"] }),
  });

  const addVendor = useMutation({
    mutationFn: financeApi.createVendor,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-vendors"] });
      qc.invalidateQueries({ queryKey: ["finance-overview"] });
      setVendorForm({ name: "", contact_name: "", email: "" });
    },
  });

  const processPayroll = useMutation({
    mutationFn: financeApi.processPayrollRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-payroll"] });
      qc.invalidateQueries({ queryKey: ["finance-payroll-runs"] });
      qc.invalidateQueries({ queryKey: ["finance-overview"] });
      qc.invalidateQueries({ queryKey: ["finance-ledger"] });
    },
  });

  const createPayroll = useMutation({
    mutationFn: financeApi.createPayrollRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-payroll"] });
      qc.invalidateQueries({ queryKey: ["finance-payroll-runs"] });
    },
  });

  const markPaid = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      financeApi.updateInvoice(id, { status: "paid", amount_paid: amount }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-ap"] });
      qc.invalidateQueries({ queryKey: ["finance-ar"] });
      qc.invalidateQueries({ queryKey: ["finance-invoices"] });
      qc.invalidateQueries({ queryKey: ["finance-overview"] });
    },
  });

  const createInvoice = useMutation({
    mutationFn: financeApi.createInvoice,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-invoices"] });
      qc.invalidateQueries({ queryKey: ["finance-ap"] });
      qc.invalidateQueries({ queryKey: ["finance-ar"] });
      qc.invalidateQueries({ queryKey: ["finance-overview"] });
      setInvoiceForm({ invoice_type: "receivable", invoice_number: "", amount: "", customer_name: "", vendor_id: "", due_date: "", description: "", grant_id: "", department_id: "", program_id: "" });
    },
  });

  const createBudget = useMutation({
    mutationFn: financeApi.createBudget,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-budgets"] });
      qc.invalidateQueries({ queryKey: ["finance-overview"] });
      setBudgetForm({ name: "", category: "programs", allocated: "", department_id: "", grant_id: "" });
    },
  });

  const reconcileBank = useMutation({
    mutationFn: financeApi.reconcileBank,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-bank-txns"] });
      qc.invalidateQueries({ queryKey: ["finance-reconciliations"] });
      qc.invalidateQueries({ queryKey: ["finance-audit"] });
      setSelectedBankTxns([]);
    },
  });

  const postJournal = useMutation({
    mutationFn: () => financeApi.postJournal({
      entry_date: journalForm.entry_date,
      description: journalForm.description,
      lines: [
        { account_id: journalForm.debit_account_id, debit: Number(journalForm.amount) },
        { account_id: journalForm.credit_account_id, credit: Number(journalForm.amount) },
      ],
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-ledger"] });
      qc.invalidateQueries({ queryKey: ["finance-accounts"] });
      qc.invalidateQueries({ queryKey: ["finance-audit"] });
      setJournalForm({ entry_date: new Date().toISOString().slice(0, 10), description: "", debit_account_id: "", credit_account_id: "", amount: "" });
    },
  });

  const startPayrollRun = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    createPayroll.mutate({ period_start: start, period_end: end });
  };

  const renderInvoiceTable = (rows: FinanceInvoice[], showPay = false) => (
    <table className="hq-table">
      <thead>
        <tr><th>Invoice</th><th>Party</th><th>Amount</th><th>Outstanding</th><th>Due</th><th>Status</th>{showPay && <th></th>}</tr>
      </thead>
      <tbody>
        {rows.map((inv) => {
          const outstanding = inv.amount_cents - inv.amount_paid_cents;
          return (
            <tr key={inv.id}>
              <td><strong>{inv.invoice_number}</strong><div className="hq-muted-text">{inv.description}</div></td>
              <td>{inv.vendor_name ?? inv.customer_name ?? "—"}</td>
              <td>{fmtCents(inv.amount_cents)}</td>
              <td style={{ color: outstanding > 0 ? "var(--hq-warning)" : "var(--hq-success)" }}>{fmtCents(outstanding)}</td>
              <td>{fmtDate(inv.due_date)}</td>
              <td><StatusBadge label={inv.status} variant={INV_STATUS[inv.status] ?? "muted"} /></td>
              {showPay && outstanding > 0 && (
                <td>
                  <button type="button" className="hq-btn hq-btn-sm" onClick={() => markPaid.mutate({ id: inv.id, amount: inv.amount_cents / 100 })}>
                    Mark Paid
                  </button>
                </td>
              )}
            </tr>
          );
        })}
        {!rows.length && <tr><td colSpan={showPay ? 7 : 6} className="hq-empty-cell">No invoices</td></tr>}
      </tbody>
    </table>
  );

  return (
    <HQLayout
      title="Financial Center"
      subtitle="Complete financial management platform — the accounting backbone for every Headquarters module"
    >
      <nav className="hq-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`hq-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </nav>

      <div className="hq-tab-content hq-fade-in">
        {tab === "overview" && overview.data && (
          <>
            <div className="hq-finance-health">
              <div className="hq-finance-health-score">
                <span className="hq-finance-health-value">{overview.data.financialHealthScore}</span>
                <span className="hq-finance-health-label">Financial Health Score</span>
              </div>
              <div className="hq-finance-health-factors">
                {(overview.data.healthFactors ?? []).map((f) => (
                  <div key={f.label} className="hq-finance-health-factor">
                    <span>{f.label}</span>
                    <div className="hq-budget-bar"><div style={{ width: `${(f.score / f.max) * 100}%` }} /></div>
                    <span>{f.score}/{f.max}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="hq-kpi-grid">
              <KpiCard label="Total Revenue" value={fmt(overview.data.totalRevenue)} variant="gold" />
              <KpiCard label="Donations Received" value={fmt(overview.data.donationsReceived)} variant="success" />
              <KpiCard label="Grant Revenue" value={fmt(overview.data.grantRevenue)} variant="gold" />
              <KpiCard label="Monthly Expenses" value={fmt(overview.data.monthlyExpenses)} variant="warning" />
              <KpiCard label="Monthly Payroll" value={fmt(overview.data.monthlyPayroll)} />
              <KpiCard label="Operating Budget" value={fmt(overview.data.operatingBudget)} meta={`${fmt(overview.data.budgetRemaining)} remaining`} />
              <KpiCard label="Outstanding Invoices" value={fmt(overview.data.outstandingInvoices)} variant="warning" />
              <KpiCard label="Cash Flow" value={fmt(overview.data.cashFlow)} variant={overview.data.cashFlow >= 0 ? "success" : "danger"} />
              <KpiCard label="Program Spending" value={fmt(overview.data.programSpending)} />
              <KpiCard label="Net Position" value={fmt(overview.data.netPosition)} variant="gold" />
              <KpiCard label="Cash Balance" value={fmt(overview.data.cashBalance)} variant="success" />
              <KpiCard label="Accounts Receivable" value={fmt(overview.data.accountsReceivable)} />
            </div>
            <div className="hq-grid-2">
              {trend.data && (
                <HqPanel title="Revenue vs Expenses" subtitle="6-month trend">
                  <FinanceChart data={trend.data.monthlyTrend} />
                </HqPanel>
              )}
              <HqPanel title="Chart of Accounts" subtitle="Live balances">
                <table className="hq-table hq-table-compact">
                  <thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Balance</th></tr></thead>
                  <tbody>
                    {(overview.data.accounts ?? []).slice(0, 8).map((a) => (
                      <tr key={a.code}>
                        <td>{a.code}</td>
                        <td>{a.name}</td>
                        <td><StatusBadge label={a.account_type} variant="muted" /></td>
                        <td>{fmtCents(a.balance_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HqPanel>
            </div>
            <HqPanel title="Financial Engine" subtitle="Central accounting for all IFCDC modules">
              <p className="hq-muted-text" style={{ marginBottom: "0.75rem" }}>
                Every Headquarters module — Grants, People Management, Programs, and future applications — posts through this unified financial engine.
              </p>
              <ul className="hq-feature-list">
                <li>Double-entry general ledger with automatic journal posting</li>
                <li>Payroll integrated with People Management time clock</li>
                <li>Donations flow from Stripe/PayPal payment sources</li>
                <li>Grant awards, program budgets, and payroll post automatically to the General Ledger</li>
              </ul>
            </HqPanel>
          </>
        )}

        {tab === "executive-budget" && (
          <>
            <ExecutiveBudgetDashboard />
            <div style={{ marginTop: "1.25rem" }}>
              <FinanceAuraExecutivePanel />
            </div>
          </>
        )}

        {tab === "revenue" && <RevenueTrackingPanel />}

        {tab === "grant-portfolio" && <GrantFinancePortfolioPanel />}

        {tab === "ledger" && (
          <>
            <div className="hq-panel" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Manual Journal Entry</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
                <div><label style={{ fontSize: "0.72rem" }}>Date</label><input className="hq-aura-input" type="date" value={journalForm.entry_date} onChange={(e) => setJournalForm({ ...journalForm, entry_date: e.target.value })} /></div>
                <div><label style={{ fontSize: "0.72rem" }}>Description</label><input className="hq-aura-input" value={journalForm.description} onChange={(e) => setJournalForm({ ...journalForm, description: e.target.value })} /></div>
                <div><label style={{ fontSize: "0.72rem" }}>Debit Account</label>
                  <select className="hq-aura-input" value={journalForm.debit_account_id} onChange={(e) => setJournalForm({ ...journalForm, debit_account_id: e.target.value })}>
                    <option value="">Select…</option>
                    {(accounts.data?.accounts ?? []).map((a) => <option key={a.id as string} value={a.id as string}>{a.code as string} — {a.name as string}</option>)}
                  </select></div>
                <div><label style={{ fontSize: "0.72rem" }}>Credit Account</label>
                  <select className="hq-aura-input" value={journalForm.credit_account_id} onChange={(e) => setJournalForm({ ...journalForm, credit_account_id: e.target.value })}>
                    <option value="">Select…</option>
                    {(accounts.data?.accounts ?? []).map((a) => <option key={`c-${a.id as string}`} value={a.id as string}>{a.code as string} — {a.name as string}</option>)}
                  </select></div>
                <div><label style={{ fontSize: "0.72rem" }}>Amount ($)</label><input className="hq-aura-input" type="number" value={journalForm.amount} onChange={(e) => setJournalForm({ ...journalForm, amount: e.target.value })} /></div>
                <button type="button" className="hq-btn hq-btn-primary" disabled={!journalForm.description || !journalForm.debit_account_id || !journalForm.credit_account_id || !journalForm.amount || postJournal.isPending} onClick={() => postJournal.mutate()}>
                  Post Entry
                </button>
              </div>
            </div>
          <div className="hq-grid-2">
            <HqPanel title="Chart of Accounts">
              {accounts.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Balance</th></tr></thead>
                  <tbody>
                    {(accounts.data?.accounts ?? []).map((a) => (
                      <tr key={a.id as string}>
                        <td>{a.code as string}</td>
                        <td>{a.name as string}</td>
                        <td>{a.account_type as string}</td>
                        <td style={{ fontWeight: 600 }}>{fmtCents(a.balance_cents as number)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </HqPanel>
            <HqPanel title="Journal Entries">
              {ledger.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead>
                  <tbody>
                    {(ledger.data?.entries ?? []).map((e, i) => (
                      <tr key={`${e.id}-${i}`}>
                        <td>{fmtDate(e.entry_date as string)}</td>
                        <td>{e.account_code as string}</td>
                        <td>{(e.line_description as string) || (e.description as string)}</td>
                        <td>{(e.debit_cents as number) > 0 ? fmtCents(e.debit_cents as number) : "—"}</td>
                        <td>{(e.credit_cents as number) > 0 ? fmtCents(e.credit_cents as number) : "—"}</td>
                      </tr>
                    ))}
                    {!(ledger.data?.entries ?? []).length && <tr><td colSpan={5} className="hq-empty-cell">No journal entries yet. Expenses and payroll runs post automatically.</td></tr>}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </div>
          </>
        )}

        {tab === "donations" && (
          <HqPanel title="Donation Ledger" subtitle={donations.data ? `Total: ${fmt(donations.data.total)}` : ""}>
            {donations.isLoading ? <HqLoading /> : (donations.data?.donations ?? []).length === 0 ? (
              <div className="hq-empty">No donations recorded yet. Stripe and PayPal donations appear here automatically.</div>
            ) : (
              <table className="hq-table">
                <thead><tr><th>Date</th><th>Source</th><th>Amount</th><th>Reference</th></tr></thead>
                <tbody>
                  {donations.data!.donations.map((d) => (
                    <tr key={d.id as string}>
                      <td>{new Date(d.created_at as string).toLocaleDateString()}</td>
                      <td><StatusBadge label={(d.source_key as string).toUpperCase()} variant="gold" /></td>
                      <td style={{ color: "var(--hq-success)", fontWeight: 700 }}>${((d.amount_cents as number) / 100).toFixed(2)}</td>
                      <td style={{ fontSize: "0.78rem", color: "var(--hq-text-dim)" }}>{(d.external_id as string) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </HqPanel>
        )}

        {tab === "expenses" && (
          <>
            <div className="hq-panel hq-fade-in" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--hq-gold)" }}>Submit Expense for Approval</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Category</label>
                  <select className="hq-aura-input" value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}>
                    <option value="programs">Programs</option>
                    <option value="payroll">Payroll</option>
                    <option value="operations">Operations</option>
                    <option value="technology">Technology</option>
                    <option value="grants">Grants</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Description</label>
                  <input className="hq-aura-input" value={expenseForm.description} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Amount</label>
                  <input className="hq-aura-input" type="number" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Vendor</label>
                  <input className="hq-aura-input" value={expenseForm.vendor} onChange={(e) => setExpenseForm({ ...expenseForm, vendor: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Department</label>
                  <select className="hq-aura-input" value={expenseForm.department_id} onChange={(e) => setExpenseForm({ ...expenseForm, department_id: e.target.value })}>
                    <option value="">—</option>
                    {(integrations.data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Grant</label>
                  <select className="hq-aura-input" value={expenseForm.grant_id} onChange={(e) => setExpenseForm({ ...expenseForm, grant_id: e.target.value })}>
                    <option value="">—</option>
                    {(integrations.data?.grants ?? []).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Program</label>
                  <select className="hq-aura-input" value={expenseForm.program_id} onChange={(e) => setExpenseForm({ ...expenseForm, program_id: e.target.value })}>
                    <option value="">—</option>
                    {(integrations.data?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Project</label>
                  <select className="hq-aura-input" value={expenseForm.project_id} onChange={(e) => setExpenseForm({ ...expenseForm, project_id: e.target.value })}>
                    <option value="">—</option>
                    {(integrations.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <button type="button" className="hq-btn hq-btn-primary" disabled={addExpense.isPending}
                  onClick={() => {
                    const prog = (integrations.data?.programs ?? []).find((p) => p.id === expenseForm.program_id);
                    addExpense.mutate({
                      ...expenseForm,
                      amount: Number(expenseForm.amount),
                      department_id: expenseForm.department_id || undefined,
                      grant_id: expenseForm.grant_id || undefined,
                      program_id: expenseForm.program_id || undefined,
                      program_slug: prog?.slug ?? prog?.code?.toLowerCase().replace(/\s+/g, "-"),
                      project_id: expenseForm.project_id || undefined,
                      person_id: expenseForm.person_id || undefined,
                    });
                  }}>
                  <Plus size={14} /> Add
                </button>
              </div>
            </div>
            <HqPanel title="Expense History" subtitle="Pending items require executive approval before posting to the General Ledger">
              {expenses.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {(expenses.data?.expenses ?? []).map((e) => {
                      const status = (e.approval_status as string) ?? "approved";
                      const isPending = status === "pending";
                      return (
                        <tr key={e.id as string}>
                          <td>{fmtDate(e.expense_date as string)}</td>
                          <td>{e.category as string}</td>
                          <td>{e.description as string}</td>
                          <td style={{ color: "var(--hq-warning)" }}>${((e.amount_cents as number) / 100).toFixed(2)}</td>
                          <td><StatusBadge label={status} variant={status === "approved" ? "success" : isPending ? "warning" : "danger"} /></td>
                          <td>
                            {isPending && e.source === "manual" && (
                              <div style={{ display: "flex", gap: "0.35rem" }}>
                                <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" disabled={approveExpense.isPending}
                                  onClick={() => approveExpense.mutate(e.id as string)}><Check size={12} /></button>
                                <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled={denyExpense.isPending}
                                  onClick={() => denyExpense.mutate(e.id as string)}><X size={12} /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
        )}

        {tab === "purchase-orders" && (
          <>
            <div className="hq-panel hq-fade-in" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--hq-gold)" }}>Create Purchase Order</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Title</label>
                  <input className="hq-aura-input" value={poForm.title} onChange={(e) => setPoForm({ ...poForm, title: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Vendor</label>
                  <input className="hq-aura-input" value={poForm.vendor} onChange={(e) => setPoForm({ ...poForm, vendor: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Amount</label>
                  <input className="hq-aura-input" type="number" value={poForm.amount} onChange={(e) => setPoForm({ ...poForm, amount: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Description</label>
                  <input className="hq-aura-input" value={poForm.description} onChange={(e) => setPoForm({ ...poForm, description: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Department</label>
                  <select className="hq-aura-input" value={poForm.department_id} onChange={(e) => setPoForm({ ...poForm, department_id: e.target.value })}>
                    <option value="">—</option>
                    {(integrations.data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                </div>
                <button type="button" className="hq-btn hq-btn-primary" disabled={addPurchaseOrder.isPending || !poForm.title || !poForm.vendor || !poForm.amount}
                  onClick={() => addPurchaseOrder.mutate({
                    title: poForm.title,
                    vendor: poForm.vendor,
                    amount: Number(poForm.amount),
                    description: poForm.description || undefined,
                    department_id: poForm.department_id || undefined,
                    grant_id: poForm.grant_id || undefined,
                  })}>
                  <Plus size={14} /> Submit PO
                </button>
              </div>
            </div>
            <HqPanel title="Purchase Orders" subtitle="Approval workflow before procurement">
              {purchaseOrders.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>PO #</th><th>Title</th><th>Vendor</th><th>Amount</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {(purchaseOrders.data?.purchaseOrders ?? []).map((po) => {
                      const status = po.status as string;
                      const isPending = status === "pending_approval";
                      return (
                        <tr key={po.id as string}>
                          <td>{po.po_number as string}</td>
                          <td>{po.title as string}</td>
                          <td>{po.vendor as string}</td>
                          <td>{fmtCents(po.amount_cents as number)}</td>
                          <td><StatusBadge label={status.replace(/_/g, " ")} variant={status === "approved" ? "success" : isPending ? "warning" : "muted"} /></td>
                          <td>
                            {isPending && (
                              <div style={{ display: "flex", gap: "0.35rem" }}>
                                <button type="button" className="hq-btn hq-btn-sm hq-btn-primary"
                                  onClick={() => updatePurchaseOrder.mutate({ id: po.id as string, status: "approved" })}><Check size={12} /></button>
                                <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost"
                                  onClick={() => updatePurchaseOrder.mutate({ id: po.id as string, status: "denied" })}><X size={12} /></button>
                              </div>
                            )}
                            {status === "approved" && !po.invoice_id && (
                              <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary"
                                disabled={convertPoToInvoice.isPending}
                                onClick={() => convertPoToInvoice.mutate(po.id as string)}>
                                Create AP Invoice
                              </button>
                            )}
                            {po.invoice_id && <span className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Invoiced</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {!purchaseOrders.data?.purchaseOrders?.length && (
                      <tr><td colSpan={6} className="hq-empty-cell">No purchase orders yet</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
        )}

        {tab === "budgets" && (
          <>
            <div className="hq-panel" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--hq-gold)" }}>Create Budget</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Name</label>
                  <input className="hq-aura-input" value={budgetForm.name} onChange={(e) => setBudgetForm({ ...budgetForm, name: e.target.value })} /></div>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Category</label>
                  <select className="hq-aura-input" value={budgetForm.category} onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value })}>
                    <option value="programs">Programs</option><option value="payroll">Payroll</option><option value="operations">Operations</option>
                    <option value="technology">Technology</option><option value="grants">Grants</option>
                  </select></div>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Allocated</label>
                  <input className="hq-aura-input" type="number" value={budgetForm.allocated} onChange={(e) => setBudgetForm({ ...budgetForm, allocated: e.target.value })} /></div>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Department</label>
                  <select className="hq-aura-input" value={budgetForm.department_id} onChange={(e) => setBudgetForm({ ...budgetForm, department_id: e.target.value })}>
                    <option value="">—</option>
                    {(integrations.data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select></div>
                <button type="button" className="hq-btn hq-btn-primary" disabled={!budgetForm.name || !budgetForm.allocated || createBudget.isPending}
                  onClick={() => createBudget.mutate({ ...budgetForm, allocated: Number(budgetForm.allocated), department_id: budgetForm.department_id || undefined, grant_id: budgetForm.grant_id || undefined })}>
                  <Plus size={14} /> Add Budget
                </button>
              </div>
            </div>
            <div className="hq-app-grid">
            {budgets.isLoading ? <HqLoading /> : (budgets.data?.budgets ?? []).map((b) => {
              const allocated = b.allocated as number;
              const spent = b.spent as number;
              const pct = allocated > 0 ? Math.round((spent / allocated) * 100) : 0;
              return (
                <div key={b.id as string} className="hq-app-card">
                  <div className="hq-app-name">{b.name as string}</div>
                  <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--hq-gold)", margin: "0.5rem 0" }}>{fmt(allocated)}</div>
                  <div className="hq-app-meta-item">Spent: {fmt(spent)} ({pct}%)</div>
                  <div style={{ height: 6, background: "var(--hq-black-elevated)", borderRadius: 3, marginTop: "0.5rem" }}>
                    <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: pct > 90 ? "var(--hq-danger)" : "var(--hq-gold)", borderRadius: 3, transition: "width 0.4s ease" }} />
                  </div>
                </div>
              );
            })}
            </div>
          </>
        )}

        {tab === "payable" && (
          <HqPanel title="Accounts Payable" subtitle={payable.data ? `Outstanding: ${fmt(payable.data.totalOutstanding)}` : ""}>
            {payable.isLoading ? <HqLoading /> : renderInvoiceTable(payable.data?.invoices ?? [], true)}
          </HqPanel>
        )}

        {tab === "receivable" && (
          <HqPanel title="Accounts Receivable" subtitle={receivable.data ? `Outstanding: ${fmt(receivable.data.totalOutstanding)}` : ""}>
            {receivable.isLoading ? <HqLoading /> : renderInvoiceTable(receivable.data?.invoices ?? [], true)}
          </HqPanel>
        )}

        {tab === "invoices" && (
          <>
            <div className="hq-panel" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--hq-gold)" }}>Create Invoice</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Type</label>
                  <select className="hq-aura-input" value={invoiceForm.invoice_type} onChange={(e) => setInvoiceForm({ ...invoiceForm, invoice_type: e.target.value })}>
                    <option value="receivable">Receivable (AR)</option><option value="payable">Payable (AP)</option>
                  </select></div>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Invoice #</label>
                  <input className="hq-aura-input" value={invoiceForm.invoice_number} onChange={(e) => setInvoiceForm({ ...invoiceForm, invoice_number: e.target.value })} /></div>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Amount</label>
                  <input className="hq-aura-input" type="number" value={invoiceForm.amount} onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} /></div>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Due Date</label>
                  <input className="hq-aura-input" type="date" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} /></div>
                {invoiceForm.invoice_type === "receivable" ? (
                  <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Customer</label>
                    <input className="hq-aura-input" value={invoiceForm.customer_name} onChange={(e) => setInvoiceForm({ ...invoiceForm, customer_name: e.target.value })} /></div>
                ) : (
                  <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Vendor</label>
                    <select className="hq-aura-input" value={invoiceForm.vendor_id} onChange={(e) => setInvoiceForm({ ...invoiceForm, vendor_id: e.target.value })}>
                      <option value="">—</option>
                      {(vendors.data?.vendors ?? []).map((v) => <option key={v.id as string} value={v.id as string}>{v.name as string}</option>)}
                    </select></div>
                )}
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Grant</label>
                  <select className="hq-aura-input" value={invoiceForm.grant_id} onChange={(e) => setInvoiceForm({ ...invoiceForm, grant_id: e.target.value })}>
                    <option value="">—</option>
                    {(integrations.data?.grants ?? []).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select></div>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Description</label>
                  <input className="hq-aura-input" value={invoiceForm.description} onChange={(e) => setInvoiceForm({ ...invoiceForm, description: e.target.value })} /></div>
                <button type="button" className="hq-btn hq-btn-primary" disabled={!invoiceForm.invoice_number || !invoiceForm.amount || !invoiceForm.due_date || createInvoice.isPending}
                  onClick={() => createInvoice.mutate({ ...invoiceForm, amount: Number(invoiceForm.amount), status: "sent", grant_id: invoiceForm.grant_id || undefined, department_id: invoiceForm.department_id || undefined, program_id: invoiceForm.program_id || undefined })}>
                  <Plus size={14} /> Create & Send
                </button>
              </div>
            </div>
            <HqPanel title="All Invoices">
              {invoices.isLoading ? <HqLoading /> : renderInvoiceTable(invoices.data?.invoices ?? [])}
            </HqPanel>
          </>
        )}

        {tab === "vendors" && (
          <>
            <div className="hq-panel" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--hq-gold)" }}>Add Vendor</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Name</label>
                  <input className="hq-aura-input" value={vendorForm.name} onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })} /></div>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Contact</label>
                  <input className="hq-aura-input" value={vendorForm.contact_name} onChange={(e) => setVendorForm({ ...vendorForm, contact_name: e.target.value })} /></div>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Email</label>
                  <input className="hq-aura-input" value={vendorForm.email} onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })} /></div>
                <button type="button" className="hq-btn hq-btn-primary" disabled={!vendorForm.name || addVendor.isPending} onClick={() => addVendor.mutate(vendorForm)}>
                  <Plus size={14} /> Add Vendor
                </button>
              </div>
            </div>
            <HqPanel title="Vendor Directory">
              {vendors.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Vendor</th><th>Contact</th><th>Email</th><th>Terms</th><th>Status</th></tr></thead>
                  <tbody>
                    {(vendors.data?.vendors ?? []).map((v) => (
                      <tr key={v.id as string}>
                        <td><strong>{v.name as string}</strong></td>
                        <td>{(v.contact_name as string) || "—"}</td>
                        <td>{(v.email as string) || "—"}</td>
                        <td>{v.payment_terms as string}</td>
                        <td><StatusBadge label={v.status as string} variant="success" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
        )}

        {tab === "payroll" && (
          <>
            {payroll.data && (
              <div className="hq-kpi-grid">
                <KpiCard label="Active Payroll Staff" value={payroll.data.activeEmployees} />
                <KpiCard label="Hours This Month" value={payroll.data.hoursThisMonth} variant="gold" />
                <KpiCard label="Last Run Net" value={fmt(payroll.data.lastRunNet)} variant="success" />
                <KpiCard label="Last Run Status" value={payroll.data.lastRunStatus ?? "—"} variant="muted" />
              </div>
            )}
            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
              <button type="button" className="hq-btn hq-btn-primary" disabled={createPayroll.isPending} onClick={startPayrollRun}>
                <Plus size={14} /> Create Monthly Payroll Run
              </button>
            </div>
            <HqPanel title="Payroll Runs" subtitle="Integrated with People Management time clock">
              {payrollRuns.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Period</th><th>Gross</th><th>Net</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {(payrollRuns.data?.runs ?? []).map((r) => (
                      <tr key={r.id as string}>
                        <td>{fmtDate(r.period_start as string)} — {fmtDate(r.period_end as string)}</td>
                        <td>{fmtCents(r.total_gross_cents as number)}</td>
                        <td>{fmtCents(r.total_net_cents as number)}</td>
                        <td><StatusBadge label={r.status as string} variant={r.status === "completed" ? "success" : "warning"} /></td>
                        <td>
                          {r.status !== "completed" && (
                            <button type="button" className="hq-btn hq-btn-sm" disabled={processPayroll.isPending}
                              onClick={() => processPayroll.mutate(r.id as string)}>Process</button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!(payrollRuns.data?.runs ?? []).length && (
                      <tr><td colSpan={5} className="hq-empty-cell">No payroll runs yet. Create one to calculate from time clock hours.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
        )}

        {tab === "tax" && (
          <>
            {tax.data && (
              <div className="hq-kpi-grid">
                <KpiCard label="YTD Revenue" value={fmt(tax.data.ytdRevenue)} variant="success" />
                <KpiCard label="YTD Expenses" value={fmt(tax.data.ytdExpenses)} variant="warning" />
                <KpiCard label="YTD Net" value={fmt(tax.data.ytdNet)} variant="gold" />
              </div>
            )}
            <div className="hq-panel hq-fade-in" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--hq-gold)" }}>Generate Tax Report</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
                <label>Period<input className="hq-aura-input" value={taxForm.period} onChange={(e) => setTaxForm({ ...taxForm, period: e.target.value })} placeholder="2026-Q1" /></label>
                <label>Type
                  <select className="hq-aura-input" value={taxForm.report_type} onChange={(e) => setTaxForm({ ...taxForm, report_type: e.target.value })}>
                    <option value="form_990">Form 990 Preview</option>
                    <option value="quarterly">Quarterly Summary</option>
                    <option value="annual">Annual Report</option>
                    <option value="state_filing">State Filing</option>
                  </select>
                </label>
                <label style={{ gridColumn: "span 2" }}>Notes<input className="hq-aura-input" value={taxForm.notes} onChange={(e) => setTaxForm({ ...taxForm, notes: e.target.value })} /></label>
                <button type="button" className="hq-btn hq-btn-primary" disabled={createTaxReport.isPending || !taxForm.period}
                  onClick={() => createTaxReport.mutate(taxForm)}>
                  {createTaxReport.isPending ? "Generating…" : "Generate Report"}
                </button>
              </div>
            </div>
            <HqPanel title="Tax Reports">
              {tax.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Period</th><th>Type</th><th>Revenue</th><th>Expenses</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {(tax.data?.reports ?? []).map((r) => (
                      <tr key={r.id as string}>
                        <td>{r.period as string}</td>
                        <td>{r.report_type as string}</td>
                        <td>{fmtCents(r.total_revenue_cents as number)}</td>
                        <td>{fmtCents(r.total_expense_cents as number)}</td>
                        <td><StatusBadge label={r.status as string} variant={r.status === "filed" ? "success" : "muted"} /></td>
                        <td>{r.status === "draft" && (
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" disabled={fileTaxReport.isPending}
                            onClick={() => fileTaxReport.mutate({ id: r.id as string })}>Mark Filed</button>
                        )}</td>
                      </tr>
                    ))}
                    {!(tax.data?.reports ?? []).length && (
                      <tr><td colSpan={6} className="hq-empty-cell">No tax reports generated yet.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
        )}

        {tab === "statements" && (
          statements.isLoading ? <HqLoading /> : statements.data && (
            <div className="hq-grid-3">
              <HqPanel title="Balance Sheet">
                <h5 className="hq-stmt-section">Assets</h5>
                {statements.data.balanceSheet.assets.map((a) => (
                  <div key={a.code} className="hq-stmt-row"><span>{a.code} {a.name}</span><span>{fmt(a.balance)}</span></div>
                ))}
                <div className="hq-stmt-total">Total Assets: {fmt(statements.data.balanceSheet.totalAssets)}</div>
                <h5 className="hq-stmt-section">Liabilities</h5>
                {statements.data.balanceSheet.liabilities.map((l) => (
                  <div key={l.code} className="hq-stmt-row"><span>{l.code} {l.name}</span><span>{fmt(l.balance)}</span></div>
                ))}
                <div className="hq-stmt-total">Total Liabilities: {fmt(statements.data.balanceSheet.totalLiabilities)}</div>
                <h5 className="hq-stmt-section">Equity</h5>
                {statements.data.balanceSheet.equity.map((e) => (
                  <div key={e.code} className="hq-stmt-row"><span>{e.code} {e.name}</span><span>{fmt(e.balance)}</span></div>
                ))}
              </HqPanel>
              <HqPanel title="Income Statement" subtitle={statements.data.incomeStatement.period}>
                {statements.data.incomeStatement.revenue.map((r) => (
                  <div key={r.code} className="hq-stmt-row"><span>{r.name}</span><span style={{ color: "var(--hq-success)" }}>{fmt(r.amount)}</span></div>
                ))}
                <div className="hq-stmt-total">Total Revenue: {fmt(statements.data.incomeStatement.totalRevenue)}</div>
                {statements.data.incomeStatement.expenses.map((e) => (
                  <div key={e.code} className="hq-stmt-row"><span>{e.name}</span><span style={{ color: "var(--hq-warning)" }}>{fmt(e.amount)}</span></div>
                ))}
                <div className="hq-stmt-total">Net Income: {fmt(statements.data.incomeStatement.netIncome)}</div>
              </HqPanel>
              <HqPanel title="Cash Flow" subtitle={statements.data.cashFlow.period}>
                <div className="hq-stmt-row"><span>Operating</span><span>{fmt(statements.data.cashFlow.operating)}</span></div>
                <div className="hq-stmt-row"><span>Investing</span><span>{fmt(statements.data.cashFlow.investing)}</span></div>
                <div className="hq-stmt-row"><span>Financing</span><span>{fmt(statements.data.cashFlow.financing)}</span></div>
                <div className="hq-stmt-total">Net Change: {fmt(statements.data.cashFlow.netChange)}</div>
              </HqPanel>
            </div>
          )
        )}

        {tab === "bank" && (
          <>
            <div className="hq-kpi-grid">
              {(bankAccounts.data?.accounts ?? []).map((a) => (
                <KpiCard key={a.id as string} label={a.name as string} value={fmtCents(a.balance_cents as number)}
                  meta={`${a.institution as string} •••• ${a.account_number_last4 as string}`} variant="gold" />
              ))}
            </div>
            <div className="hq-panel" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--hq-gold)" }}>Reconcile Bank Statement</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Account</label>
                  <select className="hq-aura-input" value={reconcileForm.bank_account_id} onChange={(e) => setReconcileForm({ ...reconcileForm, bank_account_id: e.target.value })}>
                    <option value="">—</option>
                    {(bankAccounts.data?.accounts ?? []).map((a) => <option key={a.id as string} value={a.id as string}>{a.name as string}</option>)}
                  </select></div>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Statement Date</label>
                  <input className="hq-aura-input" type="date" value={reconcileForm.statement_date} onChange={(e) => setReconcileForm({ ...reconcileForm, statement_date: e.target.value })} /></div>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Statement Balance</label>
                  <input className="hq-aura-input" type="number" value={reconcileForm.statement_balance} onChange={(e) => setReconcileForm({ ...reconcileForm, statement_balance: e.target.value })} /></div>
                <button type="button" className="hq-btn hq-btn-primary" disabled={!reconcileForm.bank_account_id || !reconcileForm.statement_date || reconcileBank.isPending}
                  onClick={() => reconcileBank.mutate({
                    ...reconcileForm,
                    statement_balance: Number(reconcileForm.statement_balance),
                    transaction_ids: selectedBankTxns.length ? selectedBankTxns : undefined,
                  })}>
                  Reconcile
                </button>
              </div>
            </div>
            <div className="hq-grid-2">
              <HqPanel title="Bank Transactions">
                {bankTxns.isLoading ? <HqLoading /> : (
                  <table className="hq-table">
                    <thead><tr><th></th><th>Date</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {(bankTxns.data?.transactions ?? []).map((t) => (
                        <tr key={t.id as string}>
                          <td>
                            {!(t.reconciled as number) && (
                              <input type="checkbox" checked={selectedBankTxns.includes(t.id as string)} onChange={(e) => {
                                if (e.target.checked) setSelectedBankTxns((ids) => [...ids, t.id as string]);
                                else setSelectedBankTxns((ids) => ids.filter((id) => id !== t.id));
                              }} />
                            )}
                          </td>
                          <td>{fmtDate(t.transaction_date as string)}</td>
                          <td>{t.description as string}</td>
                          <td style={{ color: (t.amount_cents as number) >= 0 ? "var(--hq-success)" : "var(--hq-warning)" }}>{fmtCents(t.amount_cents as number)}</td>
                          <td><StatusBadge label={(t.reconciled as number) ? "Reconciled" : "Open"} variant={(t.reconciled as number) ? "success" : "warning"} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </HqPanel>
              <HqPanel title="Reconciliation History">
                {reconciliations.isLoading ? <HqLoading /> : (
                  <table className="hq-table">
                    <thead><tr><th>Date</th><th>Account</th><th>Statement</th><th>Difference</th><th>Status</th></tr></thead>
                    <tbody>
                      {(reconciliations.data?.reconciliations ?? []).map((r) => (
                        <tr key={r.id as string}>
                          <td>{fmtDate(r.statement_date as string)}</td>
                          <td>{r.bank_account_name as string}</td>
                          <td>{fmtCents(r.statement_balance_cents as number)}</td>
                          <td>{fmtCents(r.difference_cents as number)}</td>
                          <td><StatusBadge label={r.status as string} variant="success" /></td>
                        </tr>
                      ))}
                      {!(reconciliations.data?.reconciliations ?? []).length && (
                        <tr><td colSpan={5} className="hq-empty-cell">No reconciliations yet</td></tr>
                      )}
                    </tbody>
                  </table>
                )}
              </HqPanel>
            </div>
          </>
        )}

        {tab === "programs" && (
          programsSummary.isLoading ? <HqLoading /> : (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
                <KpiCard label="Total Allocated" value={fmt(programsSummary.data?.totals.allocated ?? 0)} icon={PieChart} variant="gold" />
                <KpiCard label="Total Spent" value={fmt(programsSummary.data?.totals.spent ?? 0)} icon={Wallet} />
                <KpiCard label="Remaining" value={fmt(programsSummary.data?.totals.remaining ?? 0)} icon={TrendingUp} variant={(programsSummary.data?.totals.remaining ?? 0) >= 0 ? "success" : "danger"} />
              </div>
              <HqPanel title="Community Program Budgets" subtitle="Linked to General Ledger and expense approvals">
                <table className="hq-table">
                  <thead><tr><th>Program</th><th>Allocated</th><th>Spent</th><th>Remaining</th><th>Expenses</th></tr></thead>
                  <tbody>
                    {(programsSummary.data?.programs ?? []).map((p) => (
                      <tr key={p.slug}>
                        <td>{p.name}</td>
                        <td>{fmt(p.budgetAllocated)}</td>
                        <td>{fmt(p.budgetSpent)}</td>
                        <td>{fmt(p.remaining)}</td>
                        <td>{p.expenseCount}</td>
                      </tr>
                    ))}
                    {(programsSummary.data?.legacyPrograms ?? []).map((p) => (
                      <tr key={p.id}>
                        <td>{p.name} <span className="hq-muted-text">(legacy)</span></td>
                        <td>{fmt(p.budgetAllocated)}</td>
                        <td>{fmt(p.budgetSpent)}</td>
                        <td>{fmt(p.remaining)}</td>
                        <td>—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HqPanel>
              {expensesByProgram.data && (
                <div style={{ marginTop: "1.25rem" }}>
                <HqPanel title="Expenses by Program" subtitle="Approved spend rollup">
                  <table className="hq-table">
                    <thead><tr><th>Program</th><th>Count</th><th>Approved</th></tr></thead>
                    <tbody>
                      {(expensesByProgram.data.byProgram ?? []).map((row) => (
                        <tr key={row.program as string}>
                          <td>{row.program}</td>
                          <td>{row.expense_count}</td>
                          <td>{fmtCents(row.approved_cents as number)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </HqPanel>
                </div>
              )}
            </>
          )
        )}

        {tab === "grant-expenses" && (
          grantLinked.isLoading ? <HqLoading /> : (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
                <KpiCard label="Grant-Linked Expenses" value={fmt(grantLinked.data?.totalGrantExpenses ?? 0)} icon={FileText} variant="gold" />
                <KpiCard label="Payroll Runs" value={grantLinked.data?.payrollRuns.length ?? 0} icon={Users} meta="Completed runs (labor tie-in)" />
              </div>
              <HqPanel title="Spend by Grant / Funder">
                <table className="hq-table">
                  <thead><tr><th>Funder</th><th>Grant</th><th>Expenses</th><th>Total</th></tr></thead>
                  <tbody>
                    {(grantLinked.data?.grantTotals ?? []).map((g, i) => (
                      <tr key={`${g.funder}-${i}`}>
                        <td>{g.funder ?? "—"}</td>
                        <td>{g.title ?? "—"}</td>
                        <td>{g.expense_count}</td>
                        <td>{fmtCents(g.total_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HqPanel>
              <HqPanel title="Recent Grant-Linked Expenses" subtitle="Synced to Grant Center on approval">
                <table className="hq-table">
                  <thead><tr><th>Date</th><th>Description</th><th>Grant</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {(grantLinked.data?.expenses ?? []).slice(0, 25).map((e) => (
                      <tr key={e.id as string}>
                        <td>{fmtDate(String(e.expense_date ?? ""))}</td>
                        <td>{String(e.description ?? "")}</td>
                        <td>{String(e.grant_title ?? e.funder ?? "—")}</td>
                        <td>{fmtCents(e.amount_cents as number)}</td>
                        <td><StatusBadge label={String(e.approval_status ?? "—")} variant={e.approval_status === "approved" ? "success" : "warning"} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HqPanel>
            </>
          )
        )}

        {tab === "quickbooks" && (
          quickBooks.isLoading ? <HqLoading /> : (
            <HqPanel title="QuickBooks Integration" subtitle="Sync income, expenses, payroll, and account balances">
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <StatusBadge
                  label={(quickBooks.data?.connection as { connected?: boolean })?.connected ? "Connected" : "Not Connected"}
                  variant={(quickBooks.data?.connection as { connected?: boolean })?.connected ? "success" : "warning"}
                />
                <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={qbConnect.isPending} onClick={() => qbConnect.mutate()}>
                  Connect QuickBooks
                </button>
                <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" disabled={qbSync.isPending} onClick={() => qbSync.mutate()}>
                  {qbSync.isPending ? "Syncing…" : "Sync Now"}
                </button>
              </div>
              {quickBooks.data?.lastSync && (
                <pre style={{ fontSize: "0.75rem", overflow: "auto", maxHeight: 320, background: "var(--hq-bg-subtle)", padding: "0.75rem", borderRadius: 6 }}>
                  {JSON.stringify(quickBooks.data.lastSync, null, 2)}
                </pre>
              )}
              {!quickBooks.data?.lastSync && (
                <p className="hq-muted-text">Connect QuickBooks via OAuth or run Sync to import HQ financial data as a fallback.</p>
              )}
            </HqPanel>
          )
        )}

        {tab === "board" && (
          boardReport.isLoading ? <HqLoading /> : (
            <HqPanel title="Board-Ready Financial Summary" subtitle={String((boardReport.data as { title?: string })?.title ?? "Executive financial package")}>
              {(boardReport.data as { executiveSummary?: Record<string, number> })?.executiveSummary && (
                <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
                  <KpiCard label="Health Score" value={`${(boardReport.data as { executiveSummary: { financialHealthScore: number } }).executiveSummary.financialHealthScore}%`} icon={Shield} variant="success" />
                  <KpiCard label="Net Position" value={fmt(Number((boardReport.data as { executiveSummary: { netPosition: number } }).executiveSummary.netPosition))} icon={Scale} />
                  <KpiCard label="Cash Flow" value={fmt(Number((boardReport.data as { executiveSummary: { cashFlow: number } }).executiveSummary.cashFlow))} icon={TrendingUp} />
                  <KpiCard label="Grant Revenue" value={fmt(Number((boardReport.data as { executiveSummary: { grantRevenue: number } }).executiveSummary.grantRevenue))} icon={FileText} />
                </div>
              )}
              <div style={{ fontSize: "0.85rem", lineHeight: 1.65, color: "var(--hq-text-muted)" }}>
                <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Recommendations</h4>
                <ul>
                  {(((boardReport.data as { recommendations?: string[] })?.recommendations) ?? []).map((r) => <li key={r}>{r}</li>)}
                </ul>
                <h4 style={{ color: "var(--hq-gold)", margin: "1rem 0 0.5rem" }}>Income Statement (summary)</h4>
                <p>Revenue: {fmt(Number((boardReport.data as { incomeStatement?: { totalRevenue: number } })?.incomeStatement?.totalRevenue ?? 0))} ·
                  Expenses: {fmt(Number((boardReport.data as { incomeStatement?: { totalExpenses: number } })?.incomeStatement?.totalExpenses ?? 0))} ·
                  Net: {fmt(Number((boardReport.data as { incomeStatement?: { netIncome: number } })?.incomeStatement?.netIncome ?? 0))}</p>
              </div>
            </HqPanel>
          )
        )}

        {tab === "intelligence" && (
          forecast.isLoading ? <HqLoading /> : (
            <div className="hq-grid-2">
              <HqPanel title="Cash Flow Forecast" subtitle={`Trend: ${String(forecast.data?.trend ?? "—")}`}>
                <div className="hq-widget-stat-grid" style={{ marginBottom: "1rem" }}>
                  <div className="hq-widget-stat"><span className="hq-widget-stat-val">{fmt(Number(forecast.data?.projectedCashFlow ?? 0))}</span><span className="hq-widget-stat-lbl">Projected/mo</span></div>
                  <div className="hq-widget-stat"><span className="hq-widget-stat-val">{fmt(Number(forecast.data?.budgetRemaining ?? 0))}</span><span className="hq-widget-stat-lbl">Budget Left</span></div>
                </div>
                <table className="hq-table">
                  <thead><tr><th>Department</th><th>Allocated</th><th>Spent</th></tr></thead>
                  <tbody>
                    {((forecast.data?.departmentBudgets ?? []) as { department: string; allocated: number; spent: number }[]).slice(0, 6).map((d) => (
                      <tr key={d.department}><td>{d.department}</td><td>{fmt(Number(d.allocated))}</td><td>{fmt(Number(d.spent))}</td></tr>
                    ))}
                  </tbody>
                </table>
              </HqPanel>
              <HqPanel title="Multi-Year Budget" subtitle={String(multiYear.data?.assumptions ?? "")}>
                <table className="hq-table">
                  <thead><tr><th>Year</th><th>Revenue</th><th>Expenses</th><th>Surplus</th></tr></thead>
                  <tbody>
                    {((multiYear.data?.projections ?? []) as { fiscalYear: string; projectedRevenue: number; projectedExpenses: number; projectedSurplus: number }[]).map((p) => (
                      <tr key={p.fiscalYear}><td>{p.fiscalYear}</td><td>{fmt(p.projectedRevenue)}</td><td>{fmt(p.projectedExpenses)}</td><td style={{ color: p.projectedSurplus >= 0 ? "var(--hq-success)" : "var(--hq-warning)" }}>{fmt(p.projectedSurplus)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </HqPanel>
              <HqPanel title="Form 990 Preview" subtitle={`Fiscal year ${String(form990.data?.fiscalYear ?? new Date().getFullYear())}`}>
                {form990.data ? (
                  <div style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>
                    <div>Total revenue: <strong>{fmt(Number((form990.data as { totalRevenue?: number }).totalRevenue ?? 0))}</strong></div>
                    <div>Total expenses: <strong>{fmt(Number((form990.data as { totalExpenses?: number }).totalExpenses ?? 0))}</strong></div>
                    <div>Net assets: <strong>{fmt(Number((form990.data as { netAssets?: number }).netAssets ?? 0))}</strong></div>
                    <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", marginTop: "0.75rem", fontSize: "0.78rem", color: "var(--hq-text-muted)" }}>
                      {String((form990.data as { summary?: string }).summary ?? "").slice(0, 600)}
                    </pre>
                  </div>
                ) : <HqLoading />}
              </HqPanel>
              <HqPanel title="Board Financial Report">
                {boardReport.data ? (
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0, fontSize: "0.82rem", lineHeight: 1.6, color: "var(--hq-text-muted)" }}>
                    {String((boardReport.data as { narrative?: string }).narrative ?? JSON.stringify(boardReport.data, null, 2)).slice(0, 2000)}
                  </pre>
                ) : <HqLoading />}
              </HqPanel>
            </div>
          )
        )}

        {tab === "audit" && (
          <HqPanel title="Financial Audit Log" subtitle="Every financial action is recorded — filter by action or entity type">
            <div className="hq-filter-row" style={{ marginBottom: "1rem" }}>
              <input className="hq-aura-input" placeholder="Filter action…" value={auditFilter.action} onChange={(e) => setAuditFilter({ ...auditFilter, action: e.target.value })} />
              <select className="hq-aura-input" value={auditFilter.entity} onChange={(e) => setAuditFilter({ ...auditFilter, entity: e.target.value })}>
                <option value="">All entities</option>
                <option value="expense">Expense</option>
                <option value="budget">Budget</option>
                <option value="journal_entry">Journal Entry</option>
                <option value="payroll_run">Payroll</option>
                <option value="invoice">Invoice</option>
              </select>
            </div>
            {audit.isLoading ? <HqLoading /> : (
              <table className="hq-table">
                <thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>Detail</th><th>Actor</th></tr></thead>
                <tbody>
                  {(audit.data?.audit ?? []).map((a) => (
                    <tr key={a.id as string}>
                      <td>{formatDateTime(a.created_at as string)}</td>
                      <td><StatusBadge label={a.action as string} variant="gold" /></td>
                      <td>{a.entity_type as string}</td>
                      <td>{a.detail as string}</td>
                      <td style={{ fontSize: "0.78rem" }}>{(a.actor_email as string) ?? "—"}</td>
                    </tr>
                  ))}
                  {!(audit.data?.audit ?? []).length && (
                    <tr><td colSpan={5} className="hq-empty-cell">Audit log will populate as financial actions occur.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </HqPanel>
        )}

        {tab === "payments" && (
          <div className="hq-app-grid">
            {payments.isLoading ? <HqLoading /> : (payments.data?.sources ?? []).map((s) => (
              <div key={s.id as string} className="hq-app-card">
                <div className="hq-app-name">{s.display_name as string}</div>
                <StatusBadge label={(s.enabled as number) ? "Enabled" : "Disabled"} variant={(s.enabled as number) ? "success" : "muted"} />
                <div className="hq-app-meta-item" style={{ marginTop: "0.5rem" }}>{s.source_key as string}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </HQLayout>
  );
};

export default FinancialCenterPage;
