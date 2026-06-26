import { getDb } from "../db";

export interface OrganizationMetrics {
  totalEmployees: number;
  activeEmployees: number;
  activeVolunteers: number;
  activeGrants: number;
  donationRevenue: number;
  monthlyDonations: number;
  monthlyExpenses: number;
  programsRunning: number;
}

export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  timestamp: string;
  amount?: number;
}

export async function getOrganizationMetrics(): Promise<OrganizationMetrics> {
  const db = await getDb();

  let totalEmployees = 0;
  let activeEmployees = 0;
  let activeVolunteers = 0;

  try {
    const peopleStats = await db.get<{ total: number; employees: number; volunteers: number }>(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN person_type = 'employee' THEN 1 ELSE 0 END) as employees,
        SUM(CASE WHEN person_type = 'volunteer' AND status = 'active' THEN 1 ELSE 0 END) as volunteers
      FROM people WHERE status != 'archived'
    `);
    totalEmployees = peopleStats?.total ?? 0;
    activeEmployees = peopleStats?.employees ?? 0;
    activeVolunteers = peopleStats?.volunteers ?? 0;
  } catch {
    totalEmployees = (await db.get<{ count: number }>("SELECT COUNT(*) as count FROM employees"))?.count ?? 0;
    activeEmployees = (await db.get<{ count: number }>("SELECT COUNT(*) as count FROM employees WHERE status = 'active'"))?.count ?? 0;
    activeVolunteers = (await db.get<{ count: number }>("SELECT COUNT(*) as count FROM employees WHERE role LIKE '%volunteer%'"))?.count ?? 0;
  }

  const programsRunning =
    (await db.get<{ count: number }>("SELECT COUNT(*) as count FROM programs"))?.count ?? 0;

  const donationRevenueCents =
    (await db.get<{ total: number }>(
      "SELECT COALESCE(SUM(amount_cents), 0) as total FROM funding_events WHERE intent = 'donation'"
    ))?.total ?? 0;

  const monthlyDonationsCents =
    (await db.get<{ total: number }>(
      `SELECT COALESCE(SUM(amount_cents), 0) as total FROM funding_events
       WHERE intent = 'donation' AND created_at >= date('now', 'start of month')`
    ))?.total ?? 0;

  let activeGrants = 0;
  try {
    activeGrants =
      (await db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM grant_awards WHERE status = 'active'"
      ))?.count ?? 0;
  } catch {
    activeGrants = 0;
  }

  let monthlyExpensesCents = 0;
  try {
    monthlyExpensesCents =
      (await db.get<{ total: number }>(
        `SELECT COALESCE(SUM(amount_cents), 0) as total FROM finance_expenses WHERE expense_date >= date('now', 'start of month')`
      ))?.total ?? 0;
  } catch {
    monthlyExpensesCents =
      (await db.get<{ total: number }>(
        `SELECT COALESCE(SUM(amount_cents), 0) as total FROM funding_events
         WHERE intent IN ('expense', 'payroll', 'grant') AND created_at >= date('now', 'start of month')`
      ))?.total ?? 0;
  }

  return {
    totalEmployees,
    activeEmployees,
    activeVolunteers,
    activeGrants,
    donationRevenue: donationRevenueCents / 100,
    monthlyDonations: monthlyDonationsCents / 100,
    monthlyExpenses: monthlyExpensesCents / 100,
    programsRunning,
  };
}

export async function getRecentActivity(): Promise<ActivityItem[]> {
  const db = await getDb();
  const items: ActivityItem[] = [];

  try {
    const funding = (await db.all(
      `SELECT id, intent, amount_cents, source_key, created_at
       FROM funding_events ORDER BY created_at DESC LIMIT 6`
    )) as {
      id: string;
      intent: string;
      amount_cents: number;
      source_key: string;
      created_at: string;
    }[];

    for (const f of funding) {
      items.push({
        id: f.id,
        type: f.intent,
        title: `${f.intent.charAt(0).toUpperCase() + f.intent.slice(1)} via ${f.source_key}`,
        detail: `$${(f.amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        timestamp: f.created_at,
        amount: f.amount_cents / 100,
      });
    }
  } catch {
    // funding_events may be empty
  }

  try {
    const employees = (await db.all(
      `SELECT id, first_name, last_name, role, created_at
       FROM employees ORDER BY created_at DESC LIMIT 4`
    )) as {
      id: string;
      first_name: string;
      last_name: string;
      role: string;
      created_at: string;
    }[];

    for (const e of employees) {
      items.push({
        id: `emp-${e.id}`,
        type: "hr",
        title: `New employee: ${e.first_name} ${e.last_name}`,
        detail: e.role,
        timestamp: e.created_at,
      });
    }
  } catch {
    // employees may be empty
  }

  try {
    const grants = (await db.all(
      `SELECT title, status, updated_at FROM grant_applications ORDER BY updated_at DESC LIMIT 3`
    )) as { title: string; status: string; updated_at: string }[];
    for (const g of grants) {
      items.push({
        id: `grant-${g.title}`,
        type: "grant",
        title: `Grant application: ${g.title}`,
        detail: g.status,
        timestamp: g.updated_at,
      });
    }
  } catch {
    // grant tables may not exist yet
  }

  return items
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8);
}

export async function getMonthlyTrend(): Promise<{ month: string; donations: number; expenses: number }[]> {
  const db = await getDb();
  const months: { month: string; donations: number; expenses: number }[] = [];

  for (let i = 5; i >= 0; i--) {
    const label = new Date();
    label.setMonth(label.getMonth() - i);
    const monthKey = label.toISOString().slice(0, 7);

    const donations =
      (await db.get<{ total: number }>(
        `SELECT COALESCE(SUM(amount_cents), 0) as total FROM funding_events
         WHERE intent = 'donation' AND created_at LIKE ?`,
        `${monthKey}%`
      ))?.total ?? 0;

    const expenses =
      (await db.get<{ total: number }>(
        `SELECT COALESCE(SUM(amount_cents), 0) as total FROM funding_events
         WHERE intent IN ('expense', 'payroll', 'grant') AND created_at LIKE ?`,
        `${monthKey}%`
      ))?.total ?? 0;

    months.push({
      month: label.toLocaleDateString("en-US", { month: "short" }),
      donations: donations / 100,
      expenses: expenses / 100,
    });
  }

  return months;
}
