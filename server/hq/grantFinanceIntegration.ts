import { getDb } from "../db";
import { financeId, logFinanceAudit } from "./financeSchema";

export async function createGrantFinanceBudget(opts: {
  awardId: string;
  grantTitle: string;
  amount: number;
  programId?: string;
  departmentId?: string;
  actor?: { email?: string };
}): Promise<string> {
  const db = await getDb();
  const now = new Date().toISOString();
  const budgetId = financeId();

  await db.run(
    `INSERT INTO finance_budgets (id, name, category, fiscal_year, allocated, spent, grant_id, program_id, department_id, notes, created_at, updated_at)
     VALUES (?, ?, 'grants', ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    budgetId, `Grant: ${opts.grantTitle}`, String(new Date().getFullYear()), opts.amount,
    opts.awardId, opts.programId ?? null, opts.departmentId ?? null,
    `Auto-created from Grant Center award`, now, now
  );

  await db.run("UPDATE grant_awards SET finance_budget_id = ? WHERE id = ?", budgetId, opts.awardId);

  await logFinanceAudit("grant_budget_created", "budget", budgetId, `Grant budget for ${opts.grantTitle}`, opts.actor, Math.round(opts.amount * 100));
  return budgetId;
}

export async function getGrantFinancialSummary(awardId: string) {
  const db = await getDb();
  const award = await db.get<{
    id: string; amount: number; finance_budget_id: string | null; opportunity_id: string;
  }>("SELECT id, amount, finance_budget_id, opportunity_id FROM grant_awards WHERE id = ?", awardId);
  if (!award) return null;

  const budget = award.finance_budget_id
    ? await db.get<{ allocated: number; spent: number; name: string }>(
        "SELECT allocated, spent, name FROM finance_budgets WHERE id = ?", award.finance_budget_id
      )
    : null;

  const expenses = (await db.all(
    `SELECT id, description, amount_cents, expense_date, category FROM finance_expenses
     WHERE grant_id = ? OR grant_id = ? ORDER BY expense_date DESC`,
    awardId, award.opportunity_id
  )) as { id: string; description: string; amount_cents: number; expense_date: string; category: string }[];

  const totalExpenses = expenses.reduce((s, e) => s + e.amount_cents, 0);

  const labor = (await db.all(
    `SELECT gla.*, p.first_name, p.last_name, p.person_type
     FROM grant_labor_allocations gla
     LEFT JOIN people p ON p.id = gla.person_id
     WHERE gla.award_id = ?`,
    awardId
  )) as Record<string, unknown>[];

  const totalLabor = (labor as { cost_cents: number }[]).reduce((s, l) => s + (l.cost_cents ?? 0), 0);

  return {
    awardAmount: award.amount,
    budgetAllocated: budget?.allocated ?? award.amount,
    budgetSpent: budget?.spent ?? totalExpenses / 100,
    budgetRemaining: (budget?.allocated ?? award.amount) - (budget?.spent ?? totalExpenses / 100),
    budgetName: budget?.name ?? null,
    financeBudgetId: award.finance_budget_id,
    expenses,
    totalExpenses: totalExpenses / 100,
    labor,
    totalLabor: totalLabor / 100,
    burnRate: award.amount > 0 ? Math.round(((totalExpenses / 100 + totalLabor / 100) / award.amount) * 100) : 0,
  };
}

export async function syncGrantExpenditureFromFinance(expenseId: string, grantId: string, awardId?: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const expense = await db.get<{ amount_cents: number; description: string; category: string }>(
    "SELECT amount_cents, description, category FROM finance_expenses WHERE id = ?", expenseId
  );
  if (!expense) return;

  await db.run(
    `INSERT INTO grant_expenditures (id, award_id, grant_id, finance_expense_id, amount_cents, category, description, expense_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), ?)`,
    financeId(), awardId ?? null, grantId, expenseId, expense.amount_cents,
    expense.category, expense.description, now
  );

  if (awardId) {
    const award = await db.get<{ finance_budget_id: string | null }>(
      "SELECT finance_budget_id FROM grant_awards WHERE id = ?", awardId
    );
    if (award?.finance_budget_id) {
      await db.run(
        "UPDATE finance_budgets SET spent = spent + ?, updated_at = ? WHERE id = ?",
        expense.amount_cents / 100, now, award.finance_budget_id
      );
    }
  }
}
