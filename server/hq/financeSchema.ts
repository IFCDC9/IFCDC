import { getDb } from "../db";
import crypto from "crypto";
import { allowHqDemoSeed } from "./grantProductionPolicy";

export function financeId() {
  return crypto.randomUUID();
}

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export async function logFinanceAudit(
  action: string,
  entityType: string,
  entityId: string | null,
  detail: string,
  actor?: { id?: string; email?: string },
  amountCents?: number
): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO finance_audit_log (id, action, entity_type, entity_id, detail, amount_cents, actor_id, actor_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    financeId(), action, entityType, entityId, detail, amountCents ?? null,
    actor?.id ?? null, actor?.email ?? null, new Date().toISOString()
  );
}

export async function postJournalEntry(opts: {
  entryDate: string;
  description: string;
  referenceType?: string;
  referenceId?: string;
  lines: { accountId: string; debitCents: number; creditCents: number; description?: string }[];
  actor?: { id?: string; email?: string };
}): Promise<string> {
  const db = await getDb();
  const now = new Date().toISOString();
  const entryId = financeId();

  const totalDebit = opts.lines.reduce((s, l) => s + l.debitCents, 0);
  const totalCredit = opts.lines.reduce((s, l) => s + l.creditCents, 0);
  if (totalDebit !== totalCredit || totalDebit === 0) {
    throw new Error("Journal entry must balance with non-zero amounts");
  }

  await db.run(
    `INSERT INTO finance_journal_entries (id, entry_date, description, reference_type, reference_id, posted_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    entryId, opts.entryDate, opts.description, opts.referenceType ?? null, opts.referenceId ?? null,
    opts.actor?.email ?? null, now
  );

  for (const line of opts.lines) {
    await db.run(
      `INSERT INTO finance_ledger_lines (id, journal_entry_id, account_id, debit_cents, credit_cents, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      financeId(), entryId, line.accountId, line.debitCents, line.creditCents, line.description ?? "", now
    );
    const delta = line.debitCents - line.creditCents;
    await db.run(
      `UPDATE finance_accounts SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = ?`,
      delta, now, line.accountId
    );
  }

  await logFinanceAudit("journal_posted", "journal_entry", entryId, opts.description, opts.actor);
  return entryId;
}

export async function getAccountByCode(code: string): Promise<{ id: string; code: string; name: string } | null> {
  const db = await getDb();
  const row = await db.get<{ id: string; code: string; name: string }>("SELECT id, code, name FROM finance_accounts WHERE code = ?", code);
  return row ?? null;
}

export async function ensureFinanceTables(): Promise<void> {
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS finance_budgets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      fiscal_year TEXT NOT NULL,
      allocated REAL NOT NULL,
      spent REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_expenses (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      vendor TEXT,
      expense_date TEXT NOT NULL,
      funding_source TEXT,
      journal_entry_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_accounts (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL,
      parent_id TEXT,
      balance_cents INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_journal_entries (
      id TEXT PRIMARY KEY,
      entry_date TEXT NOT NULL,
      description TEXT NOT NULL,
      reference_type TEXT,
      reference_id TEXT,
      posted_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_ledger_lines (
      id TEXT PRIMARY KEY,
      journal_entry_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      debit_cents INTEGER DEFAULT 0,
      credit_cents INTEGER DEFAULT 0,
      description TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (journal_entry_id) REFERENCES finance_journal_entries(id),
      FOREIGN KEY (account_id) REFERENCES finance_accounts(id)
    );

    CREATE TABLE IF NOT EXISTS finance_vendors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact_name TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      tax_id TEXT,
      payment_terms TEXT DEFAULT 'Net 30',
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_invoices (
      id TEXT PRIMARY KEY,
      invoice_type TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      vendor_id TEXT,
      customer_name TEXT,
      amount_cents INTEGER NOT NULL,
      amount_paid_cents INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      description TEXT,
      notes TEXT,
      journal_entry_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (vendor_id) REFERENCES finance_vendors(id)
    );

    CREATE TABLE IF NOT EXISTS finance_payroll_runs (
      id TEXT PRIMARY KEY,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      total_gross_cents INTEGER DEFAULT 0,
      total_net_cents INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      processed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_payroll_items (
      id TEXT PRIMARY KEY,
      payroll_run_id TEXT NOT NULL,
      person_id TEXT,
      person_name TEXT NOT NULL,
      hours REAL DEFAULT 0,
      gross_cents INTEGER NOT NULL,
      deductions_cents INTEGER DEFAULT 0,
      net_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (payroll_run_id) REFERENCES finance_payroll_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS finance_tax_reports (
      id TEXT PRIMARY KEY,
      period TEXT NOT NULL,
      report_type TEXT NOT NULL,
      total_revenue_cents INTEGER DEFAULT 0,
      total_expense_cents INTEGER DEFAULT 0,
      deductible_cents INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      filed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      detail TEXT NOT NULL,
      amount_cents INTEGER,
      actor_id TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_transaction_links (
      id TEXT PRIMARY KEY,
      transaction_type TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      link_type TEXT NOT NULL,
      link_id TEXT NOT NULL,
      link_label TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_bank_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      institution TEXT,
      account_number_last4 TEXT,
      balance_cents INTEGER DEFAULT 0,
      gl_account_code TEXT DEFAULT '1000',
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_bank_transactions (
      id TEXT PRIMARY KEY,
      bank_account_id TEXT NOT NULL,
      transaction_date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      reconciled INTEGER DEFAULT 0,
      reconciliation_id TEXT,
      reference_type TEXT,
      reference_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (bank_account_id) REFERENCES finance_bank_accounts(id)
    );

    CREATE TABLE IF NOT EXISTS finance_reconciliations (
      id TEXT PRIMARY KEY,
      bank_account_id TEXT NOT NULL,
      statement_date TEXT NOT NULL,
      statement_balance_cents INTEGER NOT NULL,
      book_balance_cents INTEGER NOT NULL,
      difference_cents INTEGER DEFAULT 0,
      status TEXT DEFAULT 'open',
      completed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (bank_account_id) REFERENCES finance_bank_accounts(id)
    );

    CREATE TABLE IF NOT EXISTS finance_purchase_orders (
      id TEXT PRIMARY KEY,
      po_number TEXT NOT NULL,
      title TEXT NOT NULL,
      vendor TEXT NOT NULL,
      description TEXT,
      amount_cents INTEGER NOT NULL,
      status TEXT DEFAULT 'pending_approval',
      requested_by TEXT,
      approved_by TEXT,
      approved_at TEXT,
      department_id TEXT,
      grant_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await migrateFinanceColumns();
  await seedChartOfAccounts();
  if (allowHqDemoSeed()) {
    await seedBudgets();
    await seedVendors();
    await seedSampleInvoices();
    await seedBankAccounts();
  }
}

async function migrateFinanceColumns(): Promise<void> {
  const db = await getDb();
  const addCol = async (table: string, col: string, type: string) => {
    try { await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch { /* exists */ }
  };
  const linkCols = ["person_id", "grant_id", "program_id", "department_id", "project_id", "vendor_id"];
  for (const col of linkCols) {
    await addCol("finance_expenses", col, "TEXT");
    await addCol("finance_invoices", col, "TEXT");
  }
  await addCol("finance_budgets", "department_id", "TEXT");
  await addCol("finance_budgets", "grant_id", "TEXT");
  await addCol("finance_budgets", "program_id", "TEXT");
  await addCol("finance_journal_entries", "department_id", "TEXT");
  await addCol("finance_journal_entries", "grant_id", "TEXT");
  await addCol("finance_expenses", "approval_status", "TEXT DEFAULT 'approved'");
  await addCol("finance_expenses", "requested_by", "TEXT");
  await addCol("finance_expenses", "approved_by", "TEXT");
  await addCol("finance_expenses", "approved_at", "TEXT");
  await addCol("finance_expenses", "program_slug", "TEXT");
  await addCol("finance_expenses", "journal_entry_id", "TEXT");
  await addCol("finance_budgets", "program_slug", "TEXT");
  await addCol("finance_purchase_orders", "vendor_id", "TEXT");
  await addCol("finance_purchase_orders", "invoice_id", "TEXT");
  await addCol("finance_invoices", "purchase_order_id", "TEXT");
}

export async function saveTransactionLinks(
  transactionType: string,
  transactionId: string,
  links: { link_type: string; link_id: string; link_label?: string }[]
): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM finance_transaction_links WHERE transaction_type = ? AND transaction_id = ?", transactionType, transactionId);
  const now = new Date().toISOString();
  for (const l of links) {
    if (!l.link_id) continue;
    await db.run(
      `INSERT INTO finance_transaction_links (id, transaction_type, transaction_id, link_type, link_id, link_label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      financeId(), transactionType, transactionId, l.link_type, l.link_id, l.link_label ?? "", now
    );
  }
}

export async function getTransactionLinks(transactionType: string, transactionId: string) {
  const db = await getDb();
  return db.all(
    "SELECT * FROM finance_transaction_links WHERE transaction_type = ? AND transaction_id = ?",
    transactionType, transactionId
  );
}

async function seedBankAccounts(): Promise<void> {
  const db = await getDb();
  const count = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_bank_accounts");
  if (count && count.c > 0) return;

  const now = new Date().toISOString();
  const accounts = [
    { name: "IFCDC Operating Account", institution: "TD Bank", last4: "4821", balance: 12500000 },
    { name: "IFCDC Grant Restricted Fund", institution: "TD Bank", last4: "7392", balance: 3200000 },
  ];
  for (const a of accounts) {
    await db.run(
      `INSERT INTO finance_bank_accounts (id, name, institution, account_number_last4, balance_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      financeId(), a.name, a.institution, a.last4, a.balance, now, now
    );
  }

  const bank = await db.get<{ id: string }>("SELECT id FROM finance_bank_accounts LIMIT 1");
  if (bank) {
    const txns = [
      { date: now.slice(0, 10), desc: "Stripe donation deposit", amount: 125000, type: "credit" },
      { date: now.slice(0, 10), desc: "Payroll disbursement", amount: -4500000, type: "debit" },
      { date: now.slice(0, 10), desc: "Office supply payment", amount: -245000, type: "debit" },
    ];
    for (const t of txns) {
      await db.run(
        `INSERT INTO finance_bank_transactions (id, bank_account_id, transaction_date, description, amount_cents, transaction_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        financeId(), bank.id, t.date, t.desc, t.amount, t.type, now
      );
    }
  }
}

async function seedChartOfAccounts(): Promise<void> {
  const db = await getDb();
  const count = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_accounts");
  if (count && count.c > 0) return;

  const now = new Date().toISOString();
  const useSampleBalances = allowHqDemoSeed();
  const accounts: { code: string; name: string; type: AccountType; balance?: number }[] = [
    { code: "1000", name: "Cash & Bank", type: "asset", balance: useSampleBalances ? 12500000 : 0 },
    { code: "1100", name: "Accounts Receivable", type: "asset", balance: useSampleBalances ? 450000 : 0 },
    { code: "1200", name: "Prepaid Expenses", type: "asset" },
    { code: "2000", name: "Accounts Payable", type: "liability", balance: useSampleBalances ? 320000 : 0 },
    { code: "2100", name: "Accrued Payroll", type: "liability" },
    { code: "3000", name: "Net Assets — Unrestricted", type: "equity", balance: useSampleBalances ? 11800000 : 0 },
    { code: "3100", name: "Net Assets — Restricted (Grants)", type: "equity" },
    { code: "4000", name: "Donation Revenue", type: "revenue" },
    { code: "4100", name: "Grant Revenue", type: "revenue" },
    { code: "4200", name: "Program Service Revenue", type: "revenue" },
    { code: "5000", name: "Program Expenses", type: "expense" },
    { code: "5100", name: "Payroll & Benefits", type: "expense" },
    { code: "5200", name: "Operations & Facilities", type: "expense" },
    { code: "5300", name: "Technology & Software", type: "expense" },
    { code: "5400", name: "Grant Administration", type: "expense" },
  ];

  for (const a of accounts) {
    await db.run(
      `INSERT INTO finance_accounts (id, code, name, account_type, balance_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      financeId(), a.code, a.name, a.type, a.balance ?? 0, now, now
    );
  }
}

async function seedBudgets(): Promise<void> {
  const db = await getDb();
  const count = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_budgets");
  if (count && count.c > 0) return;

  const now = new Date().toISOString();
  const budgets = [
    { name: "Programs & Services", category: "programs", allocated: 250000 },
    { name: "Payroll & Benefits", category: "payroll", allocated: 180000 },
    { name: "Facilities & Operations", category: "operations", allocated: 45000 },
    { name: "Technology & Software", category: "technology", allocated: 30000 },
    { name: "Grant Administration", category: "grants", allocated: 15000 },
  ];
  for (const b of budgets) {
    await db.run(
      `INSERT INTO finance_budgets (id, name, category, fiscal_year, allocated, spent, created_at, updated_at)
       VALUES (?, ?, ?, '2026', ?, 0, ?, ?)`,
      financeId(), b.name, b.category, b.allocated, now, now
    );
  }
}

async function seedVendors(): Promise<void> {
  const db = await getDb();
  const count = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_vendors");
  if (count && count.c > 0) return;

  const now = new Date().toISOString();
  const vendors = [
    { name: "Atlantic Office Supply", contact: "Maria Santos", email: "orders@atlanticoffice.com", terms: "Net 30" },
    { name: "NJ Electric & Gas", contact: "Billing Dept", email: "billing@njelectric.com", terms: "Net 15" },
    { name: "CloudHost Pro", contact: "Accounts", email: "billing@cloudhostpro.com", terms: "Net 30" },
    { name: "Community Print Works", contact: "James Lee", email: "james@communityprint.com", terms: "Net 30" },
  ];
  for (const v of vendors) {
    await db.run(
      `INSERT INTO finance_vendors (id, name, contact_name, email, payment_terms, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      financeId(), v.name, v.contact, v.email, v.terms, now, now
    );
  }
}

async function seedSampleInvoices(): Promise<void> {
  const db = await getDb();
  const count = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_invoices");
  if (count && count.c > 0) return;

  const now = new Date().toISOString();
  const vendor = await db.get<{ id: string }>("SELECT id FROM finance_vendors LIMIT 1");
  const due = new Date();
  due.setDate(due.getDate() + 30);

  const samples = [
    { type: "payable", number: "AP-2026-001", vendor_id: vendor?.id, customer: null, amount: 245000, status: "sent", desc: "Office supplies — Q2" },
    { type: "payable", number: "AP-2026-002", vendor_id: vendor?.id, customer: null, amount: 89000, status: "overdue", desc: "Utilities — May" },
    { type: "receivable", number: "AR-2026-001", vendor_id: null, customer: "Mercer County Foundation", amount: 1500000, status: "sent", desc: "Program sponsorship" },
    { type: "receivable", number: "AR-2026-002", vendor_id: null, customer: "State Workforce Board", amount: 750000, status: "partial", desc: "Training services — invoice 2 of 3" },
  ];

  for (const s of samples) {
    await db.run(
      `INSERT INTO finance_invoices (id, invoice_type, invoice_number, vendor_id, customer_name, amount_cents, amount_paid_cents,
       status, issue_date, due_date, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      financeId(), s.type, s.number, s.vendor_id ?? null, s.customer, s.amount,
      s.status === "partial" ? 250000 : 0, s.status,
      now.slice(0, 10), due.toISOString().slice(0, 10), s.desc, now, now
    );
  }
}

export const CATEGORY_TO_ACCOUNT: Record<string, string> = {
  programs: "5000",
  payroll: "5100",
  operations: "5200",
  technology: "5300",
  grants: "5400",
};
