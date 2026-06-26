import { getDb } from "../db";
import { financeId, logFinanceAudit } from "./financeSchema";

export async function ensureProgramFinanceBudget(
  slug: string,
  actor?: { id?: string; email?: string }
): Promise<string> {
  const db = await getDb();
  const prog = await db.get<{
    id: string; name: string; budget_allocated: number; budget_spent: number; finance_budget_id: string | null;
  }>("SELECT id, name, budget_allocated, budget_spent, finance_budget_id FROM hq_program_registry WHERE slug = ?", slug);
  if (!prog) throw new Error(`Program not found: ${slug}`);

  const now = new Date().toISOString();
  const fiscalYear = String(new Date().getFullYear());
  const budgetName = `Program: ${prog.name}`;

  if (prog.finance_budget_id) {
    await db.run(
      `UPDATE finance_budgets SET name = ?, allocated = ?, spent = ?, program_slug = ?, updated_at = ? WHERE id = ?`,
      budgetName, prog.budget_allocated, prog.budget_spent, slug, now, prog.finance_budget_id
    );
    return prog.finance_budget_id;
  }

  const budgetId = financeId();
  await db.run(
    `INSERT INTO finance_budgets (id, name, category, fiscal_year, allocated, spent, program_id, program_slug, notes, created_at, updated_at)
     VALUES (?, ?, 'programs', ?, ?, ?, ?, ?, ?, ?, ?)`,
    budgetId, budgetName, fiscalYear, prog.budget_allocated, prog.budget_spent, prog.id, slug,
    `Auto-linked GL budget for program module ${slug}`, now, now
  );
  await db.run(
    "UPDATE hq_program_registry SET finance_budget_id = ?, updated_at = ? WHERE slug = ?",
    budgetId, now, slug
  );
  await logFinanceAudit(
    "program_budget_linked", "budget", budgetId,
    `Linked program ${slug} to General Ledger`, actor, Math.round(prog.budget_allocated * 100)
  );
  return budgetId;
}

export async function syncProgramSpentFromLedger(slug: string): Promise<number> {
  const db = await getDb();
  const total = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM finance_expenses
     WHERE approval_status = 'approved' AND (program_slug = ? OR program_id IN (SELECT id FROM hq_program_registry WHERE slug = ?))`,
    slug, slug
  ))?.t ?? 0;
  const spent = total / 100;
  const now = new Date().toISOString();
  await db.run(
    "UPDATE hq_program_registry SET budget_spent = ?, updated_at = ? WHERE slug = ?",
    spent, now, slug
  );
  const prog = await db.get<{ finance_budget_id: string | null }>(
    "SELECT finance_budget_id FROM hq_program_registry WHERE slug = ?", slug
  );
  if (prog?.finance_budget_id) {
    await db.run(
      "UPDATE finance_budgets SET spent = ?, updated_at = ? WHERE id = ?",
      spent, now, prog.finance_budget_id
    );
  }
  return spent;
}

export async function syncAllProgramBudgetsToGL(actor?: { email?: string }): Promise<number> {
  const db = await getDb();
  const rows = (await db.all("SELECT slug FROM hq_program_registry")) as { slug: string }[];
  const slugs = rows.map((r) => r.slug);
  for (const slug of slugs) {
    await ensureProgramFinanceBudget(slug, actor);
    await syncProgramSpentFromLedger(slug);
  }
  return slugs.length;
}

export async function getProgramFinancialSummary(slug: string) {
  const db = await getDb();
  const prog = await db.get<Record<string, unknown>>(
    "SELECT * FROM hq_program_registry WHERE slug = ?", slug
  );
  if (!prog) return null;

  const budgetId = prog.finance_budget_id as string | null;
  const glBudget = budgetId
    ? await db.get<{ allocated: number; spent: number; name: string }>(
        "SELECT allocated, spent, name FROM finance_budgets WHERE id = ?", budgetId
      )
    : null;

  const expenses = await db.all(
    `SELECT id, description, amount_cents, expense_date, category, approval_status, journal_entry_id
     FROM finance_expenses WHERE program_slug = ? OR program_id = ? ORDER BY expense_date DESC LIMIT 25`,
    slug, prog.id
  );

  const donations = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM funding_events WHERE intent = 'donation'`
  ))?.t ?? 0;

  const audit = await db.all(
    `SELECT action, detail, amount_cents, actor_email, created_at FROM finance_audit_log
     WHERE entity_type IN ('budget', 'expense', 'journal_entry') AND (detail LIKE ? OR entity_id = ?)
     ORDER BY created_at DESC LIMIT 15`,
    `%${slug}%`, budgetId ?? ""
  );

  return {
    program: prog,
    glBudget,
    expenses,
    totalExpenses: (expenses as { amount_cents: number }[]).reduce((s, e) => s + e.amount_cents, 0) / 100,
    organizationDonations: donations / 100,
    auditTrail: audit,
    balanceRemaining: (prog.budget_allocated as number) - (prog.budget_spent as number),
  };
}

export async function linkExpenseToProgram(
  expenseId: string,
  programSlug: string,
  actor?: { email?: string }
): Promise<void> {
  const db = await getDb();
  const prog = await db.get<{ id: string }>("SELECT id FROM hq_program_registry WHERE slug = ?", programSlug);
  if (!prog) return;
  await db.run(
    "UPDATE finance_expenses SET program_slug = ?, program_id = ? WHERE id = ?",
    programSlug, prog.id, expenseId
  );
  await ensureProgramFinanceBudget(programSlug, actor);
  await syncProgramSpentFromLedger(programSlug);
}

export async function buildAllProgramsFinanceSummary() {
  const db = await getDb();
  const programs = (await db.all(`
    SELECT r.slug, r.name, r.budget_allocated, r.budget_spent, r.finance_budget_id, r.status,
      (SELECT COUNT(*) FROM finance_expenses e WHERE e.approval_status = 'approved'
        AND (e.program_slug = r.slug OR e.program_id = r.id)) as expense_count,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_expenses e WHERE e.approval_status = 'approved'
        AND (e.program_slug = r.slug OR e.program_id = r.id)) as expense_cents
    FROM hq_program_registry r
    ORDER BY r.name
  `)) as Record<string, unknown>[];

  const legacyPrograms = (await db.all(`
    SELECT p.id, p.code, p.name,
      COALESCE(fb.allocated, 0) as budget_allocated,
      COALESCE(fb.spent, 0) as budget_spent,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_expenses e
        WHERE e.approval_status = 'approved' AND e.program_id = p.id) as expense_cents
    FROM programs p
    LEFT JOIN finance_budgets fb ON fb.program_id = p.id
    ORDER BY p.name
  `)) as Record<string, unknown>[];

  const totalAllocated = programs.reduce((s, p) => s + Number(p.budget_allocated ?? 0), 0)
    + legacyPrograms.reduce((s, p) => s + Number(p.budget_allocated ?? 0), 0);
  const totalSpent = programs.reduce((s, p) => s + Number(p.budget_spent ?? 0), 0)
    + legacyPrograms.reduce((s, p) => s + Number(p.budget_spent ?? 0), 0);

  return {
    programs: programs.map((p) => ({
      slug: p.slug,
      name: p.name,
      status: p.status,
      budgetAllocated: Number(p.budget_allocated ?? 0),
      budgetSpent: Number(p.budget_spent ?? 0),
      expenseCount: Number(p.expense_count ?? 0),
      expenseTotal: Number(p.expense_cents ?? 0) / 100,
      remaining: Number(p.budget_allocated ?? 0) - Number(p.budget_spent ?? 0),
    })),
    legacyPrograms: legacyPrograms.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      budgetAllocated: Number(p.budget_allocated ?? 0),
      budgetSpent: Number(p.budget_spent ?? 0),
      expenseTotal: Number(p.expense_cents ?? 0) / 100,
      remaining: Number(p.budget_allocated ?? 0) - Number(p.budget_spent ?? 0),
    })),
    totals: { allocated: totalAllocated, spent: totalSpent, remaining: totalAllocated - totalSpent },
    timestamp: new Date().toISOString(),
  };
}

export async function buildGrantLinkedExpensesSummary() {
  const db = await getDb();
  const expenses = await db.all(`
    SELECT e.id, e.description, e.amount_cents, e.expense_date, e.category, e.approval_status,
      e.grant_id, aw.id as award_id, o.title as grant_title, o.funder
    FROM finance_expenses e
    LEFT JOIN grant_awards aw ON aw.id = e.grant_id OR aw.opportunity_id = e.grant_id
    LEFT JOIN grant_opportunities o ON o.id = COALESCE(aw.opportunity_id, e.grant_id)
    WHERE e.grant_id IS NOT NULL
    ORDER BY e.expense_date DESC LIMIT 100
  `);
  const payroll = await db.all(`
    SELECT pr.id, pr.period_start, pr.period_end, pr.total_net_cents, pr.status, pr.notes
    FROM finance_payroll_runs pr WHERE pr.status = 'completed'
    ORDER BY pr.processed_at DESC LIMIT 12
  `);
  const grantTotals = await db.all(`
    SELECT o.funder, o.title, COUNT(e.id) as expense_count,
      COALESCE(SUM(e.amount_cents), 0) as total_cents
    FROM finance_expenses e
    LEFT JOIN grant_awards aw ON aw.id = e.grant_id OR aw.opportunity_id = e.grant_id
    LEFT JOIN grant_opportunities o ON o.id = COALESCE(aw.opportunity_id, e.grant_id)
    WHERE e.grant_id IS NOT NULL AND e.approval_status = 'approved'
    GROUP BY o.funder, o.title
    ORDER BY total_cents DESC
  `);
  return {
    expenses,
    payrollRuns: payroll,
    grantTotals,
    totalGrantExpenses: (expenses as { amount_cents: number; approval_status?: string }[])
      .filter((e) => e.approval_status === "approved")
      .reduce((s, e) => s + e.amount_cents, 0) / 100,
    timestamp: new Date().toISOString(),
  };
}
