import { getDb } from "../db";
import crypto from "crypto";
import { notifyHqDataChange } from "./hqRealtimeEvents";

export function alertId() {
  return crypto.randomUUID();
}

export async function ensureLeadershipAlertsTable(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_leadership_alerts (
      id TEXT PRIMARY KEY,
      alert_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      priority TEXT DEFAULT 'normal',
      source_module TEXT,
      source_id TEXT,
      path TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leadership_alerts_read ON hq_leadership_alerts(read);
  `);
}

export async function createLeadershipAlert(opts: {
  alertType: string;
  title: string;
  message: string;
  priority?: "high" | "normal" | "low";
  sourceModule?: string;
  sourceId?: string;
  path?: string;
}): Promise<string> {
  await ensureLeadershipAlertsTable();
  const db = await getDb();
  const id = alertId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO hq_leadership_alerts (id, alert_type, title, message, priority, source_module, source_id, path, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    id, opts.alertType, opts.title, opts.message,
    opts.priority ?? "normal", opts.sourceModule ?? null, opts.sourceId ?? null, opts.path ?? null, now
  );
  notifyHqDataChange("notifications");
  return id;
}

export async function notifyExpenseApproved(opts: {
  description: string;
  amountCents: number;
  approvedBy?: string;
  expenseId: string;
}): Promise<void> {
  const amount = opts.amountCents / 100;
  const priority = amount >= 5000 ? "high" : amount >= 1000 ? "normal" : "low";
  await createLeadershipAlert({
    alertType: "finance",
    title: `Expense approved: $${amount.toLocaleString()}`,
    message: `${opts.description}${opts.approvedBy ? ` · Approved by ${opts.approvedBy}` : ""}`,
    priority,
    sourceModule: "finance",
    sourceId: opts.expenseId,
    path: "/hq/finance",
  });
}

export async function notifyPayrollProcessed(opts: {
  periodStart: string;
  periodEnd: string;
  netCents: number;
  runId: string;
}): Promise<void> {
  await createLeadershipAlert({
    alertType: "payroll",
    title: "Payroll run processed",
    message: `Period ${opts.periodStart} – ${opts.periodEnd} · Net $${(opts.netCents / 100).toLocaleString()}`,
    priority: "normal",
    sourceModule: "payroll",
    sourceId: opts.runId,
    path: "/hq/payroll",
  });
}

export async function notifyGrantAwarded(opts: {
  title: string;
  amount: number;
  awardId: string;
}): Promise<void> {
  await createLeadershipAlert({
    alertType: "grant",
    title: `Grant awarded: ${opts.title}`,
    message: `$${opts.amount.toLocaleString()} added to budgets and General Ledger`,
    priority: "high",
    sourceModule: "grants",
    sourceId: opts.awardId,
    path: "/hq/grants",
  });
}

export async function notifyProgramBudgetThreshold(opts: {
  programName: string;
  slug: string;
  spent: number;
  allocated: number;
}): Promise<void> {
  const pct = opts.allocated > 0 ? Math.round((opts.spent / opts.allocated) * 100) : 0;
  if (pct < 80) return;
  await createLeadershipAlert({
    alertType: "program",
    title: `${opts.programName} budget at ${pct}%`,
    message: `$${opts.spent.toLocaleString()} of $${opts.allocated.toLocaleString()} spent`,
    priority: pct >= 95 ? "high" : "normal",
    sourceModule: "programs",
    sourceId: opts.slug,
    path: `/hq/programs/${opts.slug}`,
  });
}

export async function listLeadershipAlerts(limit = 25): Promise<Record<string, unknown>[]> {
  await ensureLeadershipAlertsTable();
  const db = await getDb();
  return db.all(
    "SELECT * FROM hq_leadership_alerts ORDER BY created_at DESC LIMIT ?", limit
  );
}

export async function markLeadershipAlertRead(id: string): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE hq_leadership_alerts SET read = 1 WHERE id = ?", id);
  notifyHqDataChange("notifications");
}
