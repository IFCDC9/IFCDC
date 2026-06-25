/**
 * Phase 3.1 — Payroll batch preparation from approved timesheets (provider-agnostic)
 */
import { getDb } from "../db";
import { financeId } from "./financeSchema";
import { peopleId, logPeopleActivity } from "./peopleSchema";

const DEDUCTION_RATE = 0.15;

export async function ensureTimesheetPayrollLinkColumn() {
  const db = await getDb();
  try {
    await db.exec("ALTER TABLE payroll_timesheets ADD COLUMN payroll_run_id TEXT");
  } catch { /* exists */ }
}

export async function upsertPayrollItemFromTimesheet(timesheetId: string, actorEmail?: string) {
  await ensureTimesheetPayrollLinkColumn();
  const db = await getDb();
  const ts = await db.get<{
    id: string; person_id: string; period_start: string; period_end: string;
    total_hours: number; status: string; payroll_run_id: string | null;
  }>("SELECT * FROM payroll_timesheets WHERE id = ?", timesheetId);
  if (!ts || ts.status !== "approved") return null;

  const person = await db.get<{ first_name: string; last_name: string; pay_rate: number | null }>(
    "SELECT first_name, last_name, pay_rate FROM people WHERE id = ?", ts.person_id
  );
  if (!person) return null;

  const now = new Date().toISOString();
  let runId = ts.payroll_run_id;

  if (!runId) {
    const existing = await db.get<{ id: string }>(
      `SELECT id FROM finance_payroll_runs WHERE period_start = ? AND period_end = ? AND status = 'draft' LIMIT 1`,
      ts.period_start, ts.period_end
    );
    runId = existing?.id ?? financeId();
    if (!existing) {
      await db.run(
        `INSERT INTO finance_payroll_runs (id, period_start, period_end, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
        runId, ts.period_start, ts.period_end,
        "Auto-prepared from approved timesheets (Phase 3.1)", now, now
      );
    }
    await db.run("UPDATE payroll_timesheets SET payroll_run_id = ?, updated_at = ? WHERE id = ?", runId, now, timesheetId);
  }

  const rate = person.pay_rate ?? 0;
  const hours = ts.total_hours ?? 0;
  const grossCents = Math.round(hours * rate * 100);
  const deductionsCents = Math.round(grossCents * DEDUCTION_RATE);
  const netCents = grossCents - deductionsCents;
  const personName = `${person.first_name} ${person.last_name}`;

  const existingItem = await db.get<{ id: string }>(
    "SELECT id FROM finance_payroll_items WHERE payroll_run_id = ? AND person_id = ?",
    runId, ts.person_id
  );

  if (existingItem) {
    await db.run(
      `UPDATE finance_payroll_items SET hours = ?, gross_cents = ?, deductions_cents = ?, net_cents = ? WHERE id = ?`,
      hours, grossCents, deductionsCents, netCents, existingItem.id
    );
  } else {
    await db.run(
      `INSERT INTO finance_payroll_items (id, payroll_run_id, person_id, person_name, hours, gross_cents, deductions_cents, net_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      financeId(), runId, ts.person_id, personName, hours, grossCents, deductionsCents, netCents, now
    );
  }

  const totals = await db.get<{ gross: number; net: number }>(
    `SELECT COALESCE(SUM(gross_cents), 0) as gross, COALESCE(SUM(net_cents), 0) as net
     FROM finance_payroll_items WHERE payroll_run_id = ?`,
    runId
  );
  await db.run(
    "UPDATE finance_payroll_runs SET total_gross_cents = ?, total_net_cents = ?, updated_at = ? WHERE id = ?",
    totals?.gross ?? 0, totals?.net ?? 0, now, runId
  );

  await logPeopleActivity(ts.person_id, "payroll_prepared", `Timesheet synced to payroll batch ${runId}`, { email: actorEmail });
  return {
    payrollRunId: runId,
    timesheetId,
    grossCents,
    netCents,
    providerReady: true,
  };
}

export async function preparePayrollBatchFromApprovedTimesheets(periodStart?: string, periodEnd?: string) {
  await ensureTimesheetPayrollLinkColumn();
  const db = await getDb();
  let sql = "SELECT id FROM payroll_timesheets WHERE status = 'approved'";
  const params: string[] = [];
  if (periodStart) { sql += " AND period_start >= ?"; params.push(periodStart); }
  if (periodEnd) { sql += " AND period_end <= ?"; params.push(periodEnd); }
  const sheets = await db.all("SELECT id FROM payroll_timesheets WHERE status = 'approved'" + (periodStart ? " AND period_start >= ?" : "") + (periodEnd ? " AND period_end <= ?" : ""), ...params) as { id: string }[];

  const results = [];
  for (let i = 0; i < sheets.length; i++) {
    const r = await upsertPayrollItemFromTimesheet(sheets[i].id);
    if (r) results.push(r);
  }

  const runIdSet: string[] = [];
  for (const r of results) {
    if (!runIdSet.includes(r.payrollRunId)) runIdSet.push(r.payrollRunId);
  }
  const runs = runIdSet.length
    ? await db.all(`SELECT * FROM finance_payroll_runs WHERE id IN (${runIdSet.map(() => "?").join(",")})`, ...runIdSet)
    : [];

  return { prepared: results.length, runs, items: results };
}
