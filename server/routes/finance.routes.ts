import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { getDb } from "../db";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import { hasPermission } from "../hq/enterpriseRoles";
import {
  ensureFinanceTables,
  financeId,
  postJournalEntry,
  getAccountByCode,
  logFinanceAudit,
  CATEGORY_TO_ACCOUNT,
  saveTransactionLinks,
} from "../hq/financeSchema";
import { buildExecutiveDashboard, buildFinancialStatements, getIntegrationOptions } from "../hq/financeReporting";
import { syncProgramSpentFromLedger, buildAllProgramsFinanceSummary, buildGrantLinkedExpensesSummary } from "../hq/programFinanceIntegration";
import { syncGrantExpenditureFromFinance } from "../hq/grantFinanceIntegration";
import { notifyExpenseApproved, notifyPayrollProcessed } from "../hq/criticalAlerts";
import { notifyHqDataChange } from "../hq/hqRealtimeEvents";
import { buildFinanceForecast,
  buildMultiYearBudget,
  buildForm990Preview,
  buildBoardFinancialReport,
} from "../hq/financeIntelligence";
import { getQuickBooksSyncSummary, syncQuickBooksToFinance } from "../hq/quickbooksOAuth";
import {
  buildFinanceCommandCenterPlatform,
  buildExecutiveBudgetDashboard,
  buildRevenueTracking,
  buildGrantFinancePortfolio,
  detectSpendingAnomalies,
  buildFinanceExecutiveBriefing,
  createFinanceAccount,
  updateFinanceAccount,
  createBankAccount,
} from "../hq/financePhase4Engine";

const router = Router();

router.use(hqAuthRequired, requireHQModule("finance"));

/** Writes require hq.finance.manage (founder, finance, administrator). */
function requireFinanceWrite(req: Request, res: Response, next: NextFunction) {
  if (req.hqUser?.role === "owner" || req.hqUser?.role === "founder") return next();
  if (hasPermission(req.hqUser!.role, "hq.finance.manage")) return next();
  return res.status(403).json({ error: "Finance manage permission required for this action" });
}

/** Sensitive operations: founder or finance role only. */
function requireFounderOrFinanceRole(req: Request, res: Response, next: NextFunction) {
  const role = req.hqUser?.role;
  if (role === "founder" || role === "owner" || role === "finance") return next();
  return res.status(403).json({ error: "Founder or Finance role required for this operation" });
}

router.use((req, res, next) => {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const path = req.path;
  const founderSensitive =
    path === "/ledger" ||
    path === "/quickbooks/sync" ||
    /\/payroll\/runs\/[^/]+\/process$/.test(path);
  if (founderSensitive) {
    return requireFounderOrFinanceRole(req, res, () => requireFinanceWrite(req, res, next));
  }
  return requireFinanceWrite(req, res, next);
});

router.use(async (_req, _res, next) => {
  try {
    await ensureFinanceTables();
    next();
  } catch (e) {
    next(e);
  }
});

function actor(req: Request) {
  return { id: req.hqUser?.id, email: req.hqUser?.email };
}

router.get("/dashboard", async (_req, res) => {
  const dashboard = await buildExecutiveDashboard();
  res.json(dashboard);
});

// ——— Phase 4: Finance Command Center ———
router.get("/operations/v4/platform", async (_req, res) => {
  res.json(await buildFinanceCommandCenterPlatform());
});

router.get("/operations/v4/executive-budget", async (_req, res) => {
  res.json(await buildExecutiveBudgetDashboard());
});

router.get("/operations/v4/revenue", async (_req, res) => {
  res.json(await buildRevenueTracking());
});

router.get("/operations/v4/grant-portfolio", async (_req, res) => {
  res.json(await buildGrantFinancePortfolio());
});

router.get("/operations/v4/anomalies", async (_req, res) => {
  res.json(await detectSpendingAnomalies());
});

router.get("/operations/v4/aura-briefing", async (req, res) => {
  const question = typeof req.query.question === "string" ? req.query.question : undefined;
  res.json(await buildFinanceExecutiveBriefing({ question }));
});

router.post("/operations/v4/aura-briefing", async (req, res) => {
  res.json(await buildFinanceExecutiveBriefing({ question: req.body?.question }));
});

router.get("/statements", async (_req, res) => {
  const statements = await buildFinancialStatements();
  res.json(statements);
});

router.get("/integrations", async (_req, res) => {
  res.json(await getIntegrationOptions());
});

router.get("/quickbooks", async (_req, res) => {
  res.json(await getQuickBooksSyncSummary());
});

router.post("/quickbooks/sync", async (req: Request, res: Response) => {
  try {
    const sync = await syncQuickBooksToFinance(req.hqUser?.email);
    res.json({ success: true, sync });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/programs/summary", async (_req, res) => {
  try {
    res.json(await buildAllProgramsFinanceSummary());
  } catch (error) {
    console.error("Program finance summary error:", error);
    res.json({ programs: [], legacyPrograms: [], totals: { allocated: 0, spent: 0, remaining: 0 }, timestamp: new Date().toISOString() });
  }
});

router.get("/expenses/by-program", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(`
    SELECT COALESCE(e.program_slug, p.name, 'Unassigned') as program,
      COUNT(*) as expense_count,
      COALESCE(SUM(CASE WHEN e.approval_status = 'approved' THEN e.amount_cents ELSE 0 END), 0) as approved_cents,
      COALESCE(SUM(e.amount_cents), 0) as total_cents
    FROM finance_expenses e
    LEFT JOIN programs p ON p.id = e.program_id
    GROUP BY program
    ORDER BY approved_cents DESC
  `);
  res.json({ byProgram: rows, timestamp: new Date().toISOString() });
});

router.get("/expenses/grant-linked", async (_req, res) => {
  try {
    res.json(await buildGrantLinkedExpensesSummary());
  } catch (error) {
    console.error("Grant-linked expenses error:", error);
    res.json({ expenses: [], payrollRuns: [], grantTotals: [], totalGrantExpenses: 0, timestamp: new Date().toISOString() });
  }
});

router.get("/overview", async (_req, res) => {
  const dashboard = await buildExecutiveDashboard();
  const db = await getDb();
  const budgets = await db.all("SELECT * FROM finance_budgets ORDER BY category ASC");
  const totalAllocated = budgets.reduce((s: number, b: { allocated: number }) => s + b.allocated, 0);
  const totalSpent = budgets.reduce((s: number, b: { spent: number }) => s + b.spent, 0);
  const accounts = await db.all("SELECT code, name, account_type, balance_cents FROM finance_accounts WHERE is_active = 1 ORDER BY code");
  const payrollPending = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM finance_payroll_runs WHERE status = 'draft'"
  ))?.c ?? 0;
  const vendorCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_vendors WHERE status = 'active'"))?.c ?? 0;

  res.json({
    ...dashboard,
    donationRevenue: dashboard.donationsReceived,
    monthlyDonations: dashboard.donationsReceived,
    budgets,
    totalAllocated,
    totalSpent,
    remaining: totalAllocated - totalSpent,
    payrollPending,
    vendorCount,
    accounts,
  });
});

// ——— General Ledger ———
router.get("/accounts", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all("SELECT * FROM finance_accounts WHERE is_active = 1 ORDER BY code");
  res.json({ accounts: rows });
});

router.post("/accounts", async (req: Request, res: Response) => {
  const { code, name, account_type } = req.body ?? {};
  if (!code || !name || !account_type) return res.status(400).json({ error: "code, name, and account_type required" });
  try {
    const account = await createFinanceAccount({ code, name, account_type }, actor(req));
    res.status(201).json({ account });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.patch("/accounts/:id", async (req: Request, res: Response) => {
  const updated = await updateFinanceAccount(req.params.id, req.body ?? {}, actor(req));
  if (!updated) return res.status(404).json({ error: "Account not found" });
  res.json({ account: updated });
});

router.get("/ledger", async (req, res) => {
  const db = await getDb();
  const { account, from, to, limit } = req.query;
  let sql = `
    SELECT je.id, je.entry_date, je.description, je.reference_type, je.reference_id, je.posted_by,
           ll.account_id, ll.debit_cents, ll.credit_cents, ll.description as line_description,
           fa.code as account_code, fa.name as account_name
    FROM finance_journal_entries je
    JOIN finance_ledger_lines ll ON ll.journal_entry_id = je.id
    JOIN finance_accounts fa ON fa.id = ll.account_id
    WHERE 1=1`;
  const params: string[] = [];
  if (account) { sql += " AND fa.code = ?"; params.push(String(account)); }
  if (from) { sql += " AND je.entry_date >= ?"; params.push(String(from)); }
  if (to) { sql += " AND je.entry_date <= ?"; params.push(String(to)); }
  sql += " ORDER BY je.entry_date DESC, je.created_at DESC LIMIT ?";
  params.push(String(limit ?? 100));
  const rows = await db.all(sql, ...params);
  res.json({ entries: rows });
});

router.post("/ledger", async (req: Request, res: Response) => {
  const { entry_date, description, lines } = req.body;
  if (!entry_date || !description || !Array.isArray(lines) || lines.length < 2) {
    return res.status(400).json({ error: "entry_date, description, and at least 2 lines required" });
  }
  try {
    const entryId = await postJournalEntry({
      entryDate: entry_date,
      description,
      lines: lines.map((l: { account_id: string; debit?: number; credit?: number; description?: string }) => ({
        accountId: l.account_id,
        debitCents: Math.round((l.debit ?? 0) * 100),
        creditCents: Math.round((l.credit ?? 0) * 100),
        description: l.description,
      })),
      actor: actor(req),
    });
    res.status(201).json({ entryId });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ——— Donations ———
router.get("/donations", async (_req, res) => {
  const db = await getDb();
  const events = await db.all(
    `SELECT id, source_key, intent, amount_cents, currency, external_id, metadata, created_at
     FROM funding_events WHERE intent = 'donation' ORDER BY created_at DESC LIMIT 100`
  );
  const total = (events as { amount_cents: number }[]).reduce((s, e) => s + e.amount_cents, 0);
  res.json({ donations: events, total: total / 100 });
});

// ——— Expenses ———
router.get("/expenses", async (_req, res) => {
  const db = await getDb();
  const fromEvents = await db.all(
    `SELECT id, source_key as category, intent as description, amount_cents, created_at as expense_date, 'funding_event' as source
     FROM funding_events WHERE intent IN ('expense', 'payroll') ORDER BY created_at DESC LIMIT 50`
  );
  const fromTable = await db.all(
    `SELECT id, category, description, amount_cents, vendor, expense_date, approval_status, requested_by, approved_by, 'manual' as source
     FROM finance_expenses ORDER BY expense_date DESC LIMIT 50`
  );
  res.json({ expenses: [...fromTable, ...fromEvents] });
});

router.post("/expenses", async (req: Request, res: Response) => {
  const {
    category, description, amount, vendor, expense_date,
    person_id, grant_id, program_id, program_slug, department_id, project_id, vendor_id, links,
  } = req.body;
  if (!category || !description || !amount) {
    return res.status(400).json({ error: "category, description, and amount are required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const expId = financeId();
  const cents = Math.round(Number(amount) * 100);
  const date = expense_date || now.slice(0, 10);
  const approvalStatus = "pending";
  const requestedBy = req.hqUser?.email ?? null;

  await db.run(
    `INSERT INTO finance_expenses (id, category, description, amount_cents, vendor, expense_date, journal_entry_id,
     person_id, grant_id, program_id, program_slug, department_id, project_id, vendor_id, approval_status, requested_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    expId, category, description, cents, vendor ?? "", date, null,
    person_id ?? null, grant_id ?? null, program_id ?? null, program_slug ?? null, department_id ?? null, project_id ?? null, vendor_id ?? null,
    approvalStatus, requestedBy, now
  );

  if (Array.isArray(links) && links.length) {
    await saveTransactionLinks("expense", expId, links);
  } else {
    const autoLinks: { link_type: string; link_id: string }[] = [];
    if (person_id) autoLinks.push({ link_type: "person", link_id: person_id });
    if (grant_id) autoLinks.push({ link_type: "grant", link_id: grant_id });
    if (program_id) autoLinks.push({ link_type: "program", link_id: program_id });
    if (department_id) autoLinks.push({ link_type: "department", link_id: department_id });
    if (project_id) autoLinks.push({ link_type: "project", link_id: project_id });
    if (autoLinks.length) await saveTransactionLinks("expense", expId, autoLinks);
  }

  await logFinanceAudit("expense_submitted", "expense", expId, description, actor(req), cents);
  const row = await db.get("SELECT * FROM finance_expenses WHERE id = ?", expId);
  res.status(201).json({ expense: row });
});

async function approveExpenseRecord(
  expId: string,
  req: Request,
  action: "approved" | "denied"
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  const exp = await db.get<{
    id: string; category: string; description: string; amount_cents: number; expense_date: string;
    approval_status: string; journal_entry_id: string | null; program_slug: string | null; grant_id: string | null;
  }>("SELECT * FROM finance_expenses WHERE id = ?", expId);
  if (!exp) return null;
  if (exp.approval_status !== "pending") throw new Error("Expense is not pending approval");

  const now = new Date().toISOString();
  if (action === "denied") {
    await db.run(
      `UPDATE finance_expenses SET approval_status = 'denied', approved_by = ?, approved_at = ? WHERE id = ?`,
      req.hqUser?.email ?? "", now, expId
    );
    await logFinanceAudit("expense_denied", "expense", expId, exp.description, actor(req), exp.amount_cents);
    return (await db.get("SELECT * FROM finance_expenses WHERE id = ?", expId)) ?? null;
  }

  let journalEntryId: string | null = exp.journal_entry_id;
  const expenseCode = CATEGORY_TO_ACCOUNT[exp.category] ?? "5200";
  const expenseAcct = await getAccountByCode(expenseCode);
  const cashAcct = await getAccountByCode("1000");
  if (!journalEntryId && expenseAcct && cashAcct) {
    journalEntryId = await postJournalEntry({
      entryDate: exp.expense_date,
      description: `Expense: ${exp.description}`,
      referenceType: "expense",
      referenceId: expId,
      lines: [
        { accountId: expenseAcct.id, debitCents: exp.amount_cents, creditCents: 0, description: exp.description },
        { accountId: cashAcct.id, debitCents: 0, creditCents: exp.amount_cents, description: "Cash payment" },
      ],
      actor: actor(req),
    });
  }

  await db.run(
    `UPDATE finance_expenses SET approval_status = 'approved', journal_entry_id = ?, approved_by = ?, approved_at = ? WHERE id = ?`,
    journalEntryId, req.hqUser?.email ?? "", now, expId
  );

  const budget = await db.get<{ id: string; spent: number }>(
    "SELECT id, spent FROM finance_budgets WHERE category = ?", exp.category
  );
  if (budget) {
    await db.run("UPDATE finance_budgets SET spent = ?, updated_at = ? WHERE id = ?",
      budget.spent + exp.amount_cents / 100, now, budget.id);
  }

  await logFinanceAudit("expense_approved", "expense", expId, exp.description, actor(req), exp.amount_cents);

  if (exp.program_slug) {
    await syncProgramSpentFromLedger(exp.program_slug).catch(() => undefined);
  }
  if (exp.grant_id) {
    const award = await db.get<{ id: string }>(
      "SELECT id FROM grant_awards WHERE opportunity_id = ? OR id = ? LIMIT 1", exp.grant_id, exp.grant_id
    );
    await syncGrantExpenditureFromFinance(expId, exp.grant_id, award?.id).catch(() => undefined);
  }

  await notifyExpenseApproved({
    description: exp.description,
    amountCents: exp.amount_cents,
    approvedBy: req.hqUser?.email,
    expenseId: expId,
  }).catch(() => undefined);
  notifyHqDataChange("finance");

  return (await db.get("SELECT * FROM finance_expenses WHERE id = ?", expId)) ?? null;
}

router.patch("/expenses/:id/approve", async (req: Request, res: Response) => {
  try {
    const row = await approveExpenseRecord(req.params.id, req, "approved");
    if (!row) return res.status(404).json({ error: "Expense not found" });
    res.json({ expense: row });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Approval failed" });
  }
});

router.patch("/expenses/:id/deny", async (req: Request, res: Response) => {
  try {
    const row = await approveExpenseRecord(req.params.id, req, "denied");
    if (!row) return res.status(404).json({ error: "Expense not found" });
    res.json({ expense: row });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Denial failed" });
  }
});

// ——— Purchase Orders ———
router.get("/purchase-orders", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all("SELECT * FROM finance_purchase_orders ORDER BY created_at DESC LIMIT 100");
  res.json({ purchaseOrders: rows });
});

router.post("/purchase-orders", async (req: Request, res: Response) => {
  const { title, vendor, description, amount, department_id, grant_id } = req.body;
  if (!title || !vendor || !amount) {
    return res.status(400).json({ error: "title, vendor, and amount are required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const id = financeId();
  const count = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_purchase_orders"))?.c ?? 0;
  const poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
  const cents = Math.round(Number(amount) * 100);
  await db.run(
    `INSERT INTO finance_purchase_orders (id, po_number, title, vendor, description, amount_cents, status, requested_by, department_id, grant_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?)`,
    id, poNumber, title, vendor, description ?? "", cents, req.hqUser?.email ?? "", department_id ?? null, grant_id ?? null, now, now
  );
  await logFinanceAudit("po_created", "purchase_order", id, `${poNumber}: ${title}`, actor(req), cents);
  res.status(201).json({ purchaseOrder: await db.get("SELECT * FROM finance_purchase_orders WHERE id = ?", id) });
});

router.patch("/purchase-orders/:id", async (req: Request, res: Response) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "status is required" });
  const db = await getDb();
  const po = await db.get<{ id: string; title: string; status: string }>(
    "SELECT id, title, status FROM finance_purchase_orders WHERE id = ?", req.params.id
  );
  if (!po) return res.status(404).json({ error: "Purchase order not found" });
  const now = new Date().toISOString();
  const approvedBy = ["approved", "denied"].includes(status) ? req.hqUser?.email ?? "" : null;
  const approvedAt = ["approved", "denied"].includes(status) ? now : null;
  await db.run(
    `UPDATE finance_purchase_orders SET status = ?, approved_by = COALESCE(?, approved_by), approved_at = COALESCE(?, approved_at), updated_at = ? WHERE id = ?`,
    status, approvedBy, approvedAt, now, req.params.id
  );
  await logFinanceAudit(`po_${status}`, "purchase_order", req.params.id, po.title, actor(req));
  res.json({ purchaseOrder: await db.get("SELECT * FROM finance_purchase_orders WHERE id = ?", req.params.id) });
});

router.post("/purchase-orders/:id/convert-invoice", async (req: Request, res: Response) => {
  try {
    const { convertPurchaseOrderToInvoice } = await import("../hq/financePurchaseOrders");
    const result = await convertPurchaseOrderToInvoice(req.params.id, actor(req));
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ——— Budgets ———
router.get("/budgets", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all("SELECT * FROM finance_budgets ORDER BY allocated DESC");
  res.json({ budgets: rows });
});

router.post("/budgets", async (req: Request, res: Response) => {
  const { name, category, fiscal_year, allocated, notes, department_id, grant_id, program_id } = req.body;
  if (!name || !category || !allocated) {
    return res.status(400).json({ error: "name, category, and allocated are required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const id = financeId();
  await db.run(
    `INSERT INTO finance_budgets (id, name, category, fiscal_year, allocated, spent, notes, department_id, grant_id, program_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    id, name, category, fiscal_year ?? "2026", Number(allocated), notes ?? "",
    department_id ?? null, grant_id ?? null, program_id ?? null, now, now
  );
  await logFinanceAudit("budget_created", "budget", id, `Created budget: ${name}`, actor(req));
  res.status(201).json({ budget: await db.get("SELECT * FROM finance_budgets WHERE id = ?", id) });
});

router.patch("/budgets/:id", async (req: Request, res: Response) => {
  const { allocated, spent, notes } = req.body;
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `UPDATE finance_budgets SET allocated = COALESCE(?, allocated), spent = COALESCE(?, spent),
     notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`,
    allocated, spent, notes, now, req.params.id
  );
  await logFinanceAudit("budget_updated", "budget", req.params.id, "Budget modified", actor(req));
  const row = await db.get("SELECT * FROM finance_budgets WHERE id = ?", req.params.id);
  res.json({ budget: row });
});

// ——— Vendors ———
router.get("/vendors", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all("SELECT * FROM finance_vendors ORDER BY name ASC");
  res.json({ vendors: rows });
});

router.post("/vendors", async (req: Request, res: Response) => {
  const { name, contact_name, email, phone, address, tax_id, payment_terms, notes } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const id = financeId();
  await db.run(
    `INSERT INTO finance_vendors (id, name, contact_name, email, phone, address, tax_id, payment_terms, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, name, contact_name ?? "", email ?? "", phone ?? "", address ?? "", tax_id ?? "",
    payment_terms ?? "Net 30", notes ?? "", now, now
  );
  await logFinanceAudit("vendor_created", "vendor", id, `Added vendor: ${name}`, actor(req));
  res.status(201).json({ vendor: await db.get("SELECT * FROM finance_vendors WHERE id = ?", id) });
});

// ——— Invoices (AR & AP) ———
router.get("/invoices", async (req, res) => {
  const db = await getDb();
  const { type, status } = req.query;
  let sql = `SELECT i.*, v.name as vendor_name FROM finance_invoices i LEFT JOIN finance_vendors v ON v.id = i.vendor_id WHERE 1=1`;
  const params: string[] = [];
  if (type) { sql += " AND i.invoice_type = ?"; params.push(String(type)); }
  if (status) { sql += " AND i.status = ?"; params.push(String(status)); }
  sql += " ORDER BY i.due_date ASC";
  const rows = await db.all(sql, ...params);
  res.json({ invoices: rows });
});

router.get("/accounts-payable", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(
    `SELECT i.*, v.name as vendor_name FROM finance_invoices i
     LEFT JOIN finance_vendors v ON v.id = i.vendor_id
     WHERE i.invoice_type = 'payable' AND i.status NOT IN ('paid', 'void')
     ORDER BY i.due_date ASC`
  );
  const total = (rows as { amount_cents: number; amount_paid_cents: number }[])
    .reduce((s, r) => s + r.amount_cents - r.amount_paid_cents, 0);
  res.json({ invoices: rows, totalOutstanding: total / 100 });
});

router.get("/accounts-receivable", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(
    `SELECT * FROM finance_invoices
     WHERE invoice_type = 'receivable' AND status NOT IN ('paid', 'void')
     ORDER BY due_date ASC`
  );
  const total = (rows as { amount_cents: number; amount_paid_cents: number }[])
    .reduce((s, r) => s + r.amount_cents - r.amount_paid_cents, 0);
  res.json({ invoices: rows, totalOutstanding: total / 100 });
});

router.post("/invoices", async (req: Request, res: Response) => {
  const {
    invoice_type, invoice_number, vendor_id, customer_name, amount, issue_date, due_date, description, notes,
    person_id, grant_id, program_id, department_id, project_id, status,
  } = req.body;
  if (!invoice_type || !invoice_number || !amount || !due_date) {
    return res.status(400).json({ error: "invoice_type, invoice_number, amount, and due_date are required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const id = financeId();
  const cents = Math.round(Number(amount) * 100);
  const invStatus = status ?? "draft";
  await db.run(
    `INSERT INTO finance_invoices (id, invoice_type, invoice_number, vendor_id, customer_name, amount_cents,
     status, issue_date, due_date, description, notes, person_id, grant_id, program_id, department_id, project_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, invoice_type, invoice_number, vendor_id ?? null, customer_name ?? null, cents,
    invStatus, issue_date ?? now.slice(0, 10), due_date, description ?? "", notes ?? "",
    person_id ?? null, grant_id ?? null, program_id ?? null, department_id ?? null, project_id ?? null, now, now
  );

  if (invStatus === "sent") {
    const isAR = invoice_type === "receivable";
    const arAcct = await getAccountByCode("1100");
    const apAcct = await getAccountByCode("2000");
    const revenueAcct = await getAccountByCode(isAR ? "4200" : "5000");
    if (revenueAcct && (isAR ? arAcct : apAcct)) {
      try {
        await postJournalEntry({
          entryDate: issue_date ?? now.slice(0, 10),
          description: `Invoice ${invoice_number}`,
          referenceType: "invoice",
          referenceId: id,
          lines: isAR
            ? [
                { accountId: arAcct!.id, debitCents: cents, creditCents: 0 },
                { accountId: revenueAcct.id, debitCents: 0, creditCents: cents },
              ]
            : [
                { accountId: revenueAcct.id, debitCents: cents, creditCents: 0 },
                { accountId: apAcct!.id, debitCents: 0, creditCents: cents },
              ],
          actor: actor(req),
        });
      } catch { /* non-blocking */ }
    }
  }

  const autoLinks: { link_type: string; link_id: string }[] = [];
  if (person_id) autoLinks.push({ link_type: "person", link_id: person_id });
  if (grant_id) autoLinks.push({ link_type: "grant", link_id: grant_id });
  if (program_id) autoLinks.push({ link_type: "program", link_id: program_id });
  if (department_id) autoLinks.push({ link_type: "department", link_id: department_id });
  if (project_id) autoLinks.push({ link_type: "project", link_id: project_id });
  if (autoLinks.length) await saveTransactionLinks("invoice", id, autoLinks);
  await logFinanceAudit("invoice_created", "invoice", id, `${invoice_type} ${invoice_number}`, actor(req), cents);
  res.status(201).json({ invoice: await db.get("SELECT * FROM finance_invoices WHERE id = ?", id) });
});

router.patch("/invoices/:id", async (req: Request, res: Response) => {
  const { status, amount_paid } = req.body;
  const db = await getDb();
  const now = new Date().toISOString();
  const inv = await db.get<{ amount_cents: number; amount_paid_cents: number; invoice_type: string; invoice_number: string }>(
    "SELECT amount_cents, amount_paid_cents, invoice_type, invoice_number FROM finance_invoices WHERE id = ?", req.params.id
  );
  if (!inv) return res.status(404).json({ error: "Invoice not found" });

  const paidCents = amount_paid !== undefined ? Math.round(Number(amount_paid) * 100) : inv.amount_paid_cents;
  const newStatus = status ?? (paidCents >= inv.amount_cents ? "paid" : paidCents > 0 ? "partial" : undefined);

  await db.run(
    `UPDATE finance_invoices SET amount_paid_cents = COALESCE(?, amount_paid_cents),
     status = COALESCE(?, status), updated_at = ? WHERE id = ?`,
    paidCents, newStatus, now, req.params.id
  );

  if (newStatus === "paid" && paidCents > inv.amount_paid_cents) {
    const delta = paidCents - inv.amount_paid_cents;
    const cashAcct = await getAccountByCode("1000");
    if (cashAcct) {
      const isReceivable = inv.invoice_type === "receivable";
      const offsetAcct = await getAccountByCode(isReceivable ? "1100" : "2000");
      if (offsetAcct) {
        try {
          await postJournalEntry({
            entryDate: now.slice(0, 10),
            description: `Payment: ${inv.invoice_number}`,
            referenceType: "invoice",
            referenceId: req.params.id,
            lines: isReceivable
              ? [
                  { accountId: cashAcct.id, debitCents: delta, creditCents: 0 },
                  { accountId: offsetAcct.id, debitCents: 0, creditCents: delta },
                ]
              : [
                  { accountId: offsetAcct.id, debitCents: delta, creditCents: 0 },
                  { accountId: cashAcct.id, debitCents: 0, creditCents: delta },
                ],
            actor: actor(req),
          });
        } catch { /* non-blocking */ }
      }
    }
  }

  await logFinanceAudit("invoice_updated", "invoice", req.params.id, `Status: ${newStatus ?? status}`, actor(req));
  res.json({ invoice: await db.get("SELECT * FROM finance_invoices WHERE id = ?", req.params.id) });
});

// ——— Payroll ———
router.get("/payroll/overview", async (_req, res) => {
  const db = await getDb();
  const activePayroll = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM people WHERE person_type IN ('employee', 'contractor', 'barber') AND status = 'active' AND payroll_status = 'active'"
  ))?.c ?? 0;

  const hoursThisMonth = (await db.get<{ h: number }>(
    `SELECT COALESCE(SUM(hours), 0) as h FROM time_clock_entries
     WHERE clock_in >= date('now', 'start of month')`
  ))?.h ?? 0;

  const runs = await db.all("SELECT * FROM finance_payroll_runs ORDER BY period_end DESC LIMIT 5");
  const lastRun = runs[0] as { total_net_cents?: number; status?: string } | undefined;

  res.json({
    activeEmployees: activePayroll,
    hoursThisMonth: Math.round(hoursThisMonth * 100) / 100,
    recentRuns: runs,
    lastRunNet: lastRun?.total_net_cents ? lastRun.total_net_cents / 100 : 0,
    lastRunStatus: lastRun?.status ?? null,
  });
});

router.get("/payroll/runs", async (_req, res) => {
  const db = await getDb();
  const runs = await db.all("SELECT * FROM finance_payroll_runs ORDER BY period_end DESC");
  res.json({ runs });
});

router.post("/payroll/runs", async (req: Request, res: Response) => {
  const { period_start, period_end, notes } = req.body;
  if (!period_start || !period_end) {
    return res.status(400).json({ error: "period_start and period_end are required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const runId = financeId();

  const staff = await db.all(`
    SELECT p.id, p.first_name, p.last_name, p.pay_rate, p.pay_type,
           COALESCE(SUM(t.hours), 0) as hours
    FROM people p
    LEFT JOIN time_clock_entries t ON t.person_id = p.id AND t.clock_in >= ? AND t.clock_in <= ?
    WHERE p.person_type IN ('employee', 'contractor', 'barber') AND p.status = 'active'
    GROUP BY p.id
  `, period_start, period_end + "T23:59:59");

  let totalGross = 0;
  let totalNet = 0;

  await db.run(
    `INSERT INTO finance_payroll_runs (id, period_start, period_end, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
    runId, period_start, period_end, notes ?? "", now, now
  );

  for (const s of staff as { id: string; first_name: string; last_name: string; pay_rate: number | null; hours: number }[]) {
    const rate = s.pay_rate ?? 0;
    const grossCents = Math.round(s.hours * rate * 100);
    const deductionsCents = Math.round(grossCents * 0.15);
    const netCents = grossCents - deductionsCents;
    totalGross += grossCents;
    totalNet += netCents;

    await db.run(
      `INSERT INTO finance_payroll_items (id, payroll_run_id, person_id, person_name, hours, gross_cents, deductions_cents, net_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      financeId(), runId, s.id, `${s.first_name} ${s.last_name}`, s.hours, grossCents, deductionsCents, netCents, now
    );
  }

  await db.run(
    "UPDATE finance_payroll_runs SET total_gross_cents = ?, total_net_cents = ?, updated_at = ? WHERE id = ?",
    totalGross, totalNet, now, runId
  );

  await logFinanceAudit("payroll_run_created", "payroll_run", runId, `Payroll ${period_start} to ${period_end}`, actor(req), totalNet);
  const run = await db.get("SELECT * FROM finance_payroll_runs WHERE id = ?", runId);
  const items = await db.all("SELECT * FROM finance_payroll_items WHERE payroll_run_id = ?", runId);
  res.status(201).json({ run, items });
});

router.post("/payroll/runs/:id/process", async (req: Request, res: Response) => {
  const db = await getDb();
  const run = await db.get<{ id: string; total_net_cents: number; period_start: string; period_end: string; status: string }>(
    "SELECT * FROM finance_payroll_runs WHERE id = ?", req.params.id
  );
  if (!run) return res.status(404).json({ error: "Payroll run not found" });
  if (run.status === "completed") return res.status(400).json({ error: "Already processed" });

  const now = new Date().toISOString();
  await db.run(
    "UPDATE finance_payroll_runs SET status = 'completed', processed_at = ?, updated_at = ? WHERE id = ?",
    now, now, req.params.id
  );

  const payrollAcct = await getAccountByCode("5100");
  const cashAcct = await getAccountByCode("1000");
  if (payrollAcct && cashAcct && run.total_net_cents > 0) {
    try {
      await postJournalEntry({
        entryDate: now.slice(0, 10),
        description: `Payroll processed ${run.period_start} to ${run.period_end}`,
        referenceType: "payroll_run",
        referenceId: run.id,
        lines: [
          { accountId: payrollAcct.id, debitCents: run.total_net_cents, creditCents: 0 },
          { accountId: cashAcct.id, debitCents: 0, creditCents: run.total_net_cents },
        ],
        actor: actor(req),
      });
    } catch { /* non-blocking */ }
  }

  await logFinanceAudit("payroll_processed", "payroll_run", run.id, "Payroll run completed", actor(req), run.total_net_cents);
  await notifyPayrollProcessed({
    periodStart: run.period_start,
    periodEnd: run.period_end,
    netCents: run.total_net_cents,
    runId: run.id,
  }).catch(() => undefined);
  notifyHqDataChange("finance");
  res.json({ run: await db.get("SELECT * FROM finance_payroll_runs WHERE id = ?", req.params.id) });
});

router.get("/payroll/runs/:id", async (req, res) => {
  const db = await getDb();
  const run = await db.get("SELECT * FROM finance_payroll_runs WHERE id = ?", req.params.id);
  if (!run) return res.status(404).json({ error: "Not found" });
  const items = await db.all("SELECT * FROM finance_payroll_items WHERE payroll_run_id = ?", req.params.id);
  res.json({ run, items });
});

// ——— Tax Reporting ———
router.get("/tax", async (_req, res) => {
  const db = await getDb();
  const reports = await db.all("SELECT * FROM finance_tax_reports ORDER BY period DESC");

  const ytdRevenue = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM funding_events
     WHERE intent = 'donation' AND created_at >= date('now', 'start of year')`
  ))?.t ?? 0;

  const ytdExpenses = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM finance_expenses
     WHERE expense_date >= date('now', 'start of year')`
  ))?.t ?? 0;

  res.json({
    reports,
    ytdRevenue: ytdRevenue / 100,
    ytdExpenses: ytdExpenses / 100,
    ytdNet: (ytdRevenue - ytdExpenses) / 100,
  });
});

router.post("/tax", async (req: Request, res: Response) => {
  const { period, report_type, notes } = req.body;
  if (!period || !report_type) return res.status(400).json({ error: "period and report_type required" });

  const { parseTaxPeriod } = await import("../hq/financePurchaseOrders");
  const { start, end } = parseTaxPeriod(String(period));

  const db = await getDb();
  const now = new Date().toISOString();
  const id = financeId();

  const revenue = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM funding_events
     WHERE intent = 'donation' AND created_at >= ? AND created_at <= ?`,
    start, `${end}T23:59:59`
  ))?.t ?? 0;
  const expenses = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM finance_expenses
     WHERE expense_date >= ? AND expense_date <= ?`,
    start, end
  ))?.t ?? 0;

  const deductible = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM finance_expenses
     WHERE expense_date >= ? AND expense_date <= ? AND approval_status != 'denied'`,
    start, end
  ))?.t ?? 0;

  await db.run(
    `INSERT INTO finance_tax_reports (id, period, report_type, total_revenue_cents, total_expense_cents,
     deductible_cents, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    id, period, report_type, revenue, expenses, deductible, notes ?? "", now, now
  );
  await logFinanceAudit("tax_report_created", "tax_report", id, `${report_type} — ${period}`, actor(req));
  res.status(201).json({ report: await db.get("SELECT * FROM finance_tax_reports WHERE id = ?", id) });
});

router.patch("/tax/:id", async (req: Request, res: Response) => {
  const { status, notes } = req.body;
  const db = await getDb();
  const now = new Date().toISOString();
  const filed_at = status === "filed" ? now : undefined;
  await db.run(
    `UPDATE finance_tax_reports SET status = COALESCE(?, status), notes = COALESCE(?, notes),
     filed_at = COALESCE(?, filed_at), updated_at = ? WHERE id = ?`,
    status, notes, filed_at, now, req.params.id
  );
  const report = await db.get("SELECT * FROM finance_tax_reports WHERE id = ?", req.params.id);
  if (!report) return res.status(404).json({ error: "Tax report not found" });
  if (status) await logFinanceAudit(`tax_report_${status}`, "tax_report", req.params.id, String(status), actor(req));
  res.json({ report });
});

router.get("/intelligence/forecast", async (_req, res) => {
  res.json(await buildFinanceForecast());
});

router.get("/intelligence/multi-year", async (req, res) => {
  const years = Number(req.query.years ?? 3);
  res.json(await buildMultiYearBudget(Math.min(Math.max(years, 1), 5)));
});

router.get("/intelligence/form-990", async (_req, res) => {
  res.json(await buildForm990Preview());
});

router.get("/intelligence/board-report", async (_req, res) => {
  res.json(await buildBoardFinancialReport());
});

// ——— Audit Log ———
router.get("/audit", async (req, res) => {
  const db = await getDb();
  const limit = Number(req.query.limit ?? 50);
  const action = String(req.query.action ?? "").trim();
  const entity = String(req.query.entity ?? "").trim();
  let sql = "SELECT * FROM finance_audit_log WHERE 1=1";
  const params: unknown[] = [];
  if (action) { sql += " AND action LIKE ?"; params.push(`%${action}%`); }
  if (entity) { sql += " AND entity_type = ?"; params.push(entity); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  const rows = await db.all(sql, ...params);
  res.json({ audit: rows });
});

// ——— Bank Reconciliation ———
router.get("/bank/accounts", async (_req, res) => {
  const db = await getDb();
  const accounts = await db.all("SELECT * FROM finance_bank_accounts ORDER BY name");
  res.json({ accounts });
});

router.post("/bank/accounts", async (req: Request, res: Response) => {
  const { name, institution, account_number_last4, account_type, opening_balance } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name required" });
  const account = await createBankAccount({ name, institution, account_number_last4, account_type, opening_balance }, actor(req));
  res.status(201).json({ account });
});

router.get("/bank/transactions", async (req, res) => {
  const db = await getDb();
  const { account_id, reconciled } = req.query;
  let sql = "SELECT * FROM finance_bank_transactions WHERE 1=1";
  const params: string[] = [];
  if (account_id) { sql += " AND bank_account_id = ?"; params.push(String(account_id)); }
  if (reconciled !== undefined) { sql += " AND reconciled = ?"; params.push(reconciled === "true" ? "1" : "0"); }
  sql += " ORDER BY transaction_date DESC LIMIT 100";
  const rows = await db.all(sql, ...params);
  res.json({ transactions: rows });
});

router.get("/bank/reconciliations", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(
    `SELECT r.*, b.name as bank_account_name FROM finance_reconciliations r
     JOIN finance_bank_accounts b ON b.id = r.bank_account_id ORDER BY r.statement_date DESC`
  );
  res.json({ reconciliations: rows });
});

router.post("/bank/reconcile", async (req: Request, res: Response) => {
  const { bank_account_id, statement_date, statement_balance, transaction_ids, notes } = req.body;
  if (!bank_account_id || !statement_date || statement_balance === undefined) {
    return res.status(400).json({ error: "bank_account_id, statement_date, and statement_balance required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const id = financeId();
  const bookBalance = (await db.get<{ b: number }>(
    "SELECT balance_cents as b FROM finance_bank_accounts WHERE id = ?", bank_account_id
  ))?.b ?? 0;
  const stmtCents = Math.round(Number(statement_balance) * 100);
  const diff = stmtCents - bookBalance;

  await db.run(
    `INSERT INTO finance_reconciliations (id, bank_account_id, statement_date, statement_balance_cents,
     book_balance_cents, difference_cents, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
    id, bank_account_id, statement_date, stmtCents, bookBalance, diff, notes ?? "", now, now
  );

  if (Array.isArray(transaction_ids)) {
    for (const txId of transaction_ids) {
      await db.run(
        "UPDATE finance_bank_transactions SET reconciled = 1, reconciliation_id = ? WHERE id = ?",
        id, txId
      );
    }
  }

  await logFinanceAudit("bank_reconciled", "reconciliation", id, `Reconciled ${statement_date}`, actor(req), stmtCents);
  res.status(201).json({ reconciliation: await db.get("SELECT * FROM finance_reconciliations WHERE id = ?", id) });
});

router.post("/bank/transactions", async (req: Request, res: Response) => {
  const { bank_account_id, transaction_date, description, amount, transaction_type } = req.body;
  if (!bank_account_id || !description || !amount) {
    return res.status(400).json({ error: "bank_account_id, description, and amount required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const id = financeId();
  const cents = Math.round(Number(amount) * 100);
  const type = transaction_type ?? (cents >= 0 ? "credit" : "debit");
  await db.run(
    `INSERT INTO finance_bank_transactions (id, bank_account_id, transaction_date, description, amount_cents, transaction_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, bank_account_id, transaction_date ?? now.slice(0, 10), description, cents, type, now
  );
  await db.run(
    "UPDATE finance_bank_accounts SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = ?",
    cents, now, bank_account_id
  );
  await logFinanceAudit("bank_transaction", "bank_transaction", id, description, actor(req), cents);
  res.status(201).json({ transaction: await db.get("SELECT * FROM finance_bank_transactions WHERE id = ?", id) });
});

// ——— Payment Sources ———
router.get("/payment-sources", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all("SELECT * FROM funding_sources ORDER BY source_key ASC");
  res.json({ sources: rows });
});

export default router;
