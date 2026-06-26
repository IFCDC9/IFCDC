import { getDb } from "../db";

export interface HqSearchResult {
  module: string;
  id: string;
  title: string;
  subtitle: string;
  path: string;
}

export async function searchHqModules(query: string, limit = 20): Promise<HqSearchResult[]> {
  const q = query.trim();
  if (!q || q.length < 2) return [];

  const db = await getDb();
  const like = `%${q}%`;
  const results: HqSearchResult[] = [];

  const people = await db.all(
    `SELECT id, first_name, last_name, email, person_type, organization_role FROM people
     WHERE status != 'archived' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR organization_role LIKE ?)
     LIMIT 8`, like, like, like, like
  );
  for (const p of people as { id: string; first_name: string; last_name: string; email: string; person_type: string }[]) {
    results.push({
      module: "people",
      id: p.id,
      title: `${p.first_name} ${p.last_name}`,
      subtitle: `${p.person_type} · ${p.email ?? ""}`,
      path: `/hq/people`,
    });
  }

  const grants = await db.all(
    `SELECT id, title, funder, status FROM grant_opportunities WHERE title LIKE ? OR funder LIKE ? LIMIT 6`, like, like
  );
  for (const g of grants as { id: string; title: string; funder: string }[]) {
    results.push({ module: "grants", id: g.id, title: g.title, subtitle: g.funder, path: "/hq/grants" });
  }

  const programs = await db.all(
    "SELECT slug, name, status FROM hq_program_registry WHERE name LIKE ? OR slug LIKE ? LIMIT 6", like, like
  );
  for (const p of programs as { slug: string; name: string }[]) {
    results.push({ module: "programs", id: p.slug, title: p.name, subtitle: "Program module", path: `/hq/programs/${p.slug}` });
  }

  const docs = await db.all(
    "SELECT id, title, category FROM hq_documents WHERE title LIKE ? OR category LIKE ? LIMIT 6", like, like
  );
  for (const d of docs as { id: string; title: string; category: string }[]) {
    results.push({ module: "documents", id: d.id, title: d.title, subtitle: d.category, path: "/hq/documents" });
  }

  const expenses = await db.all(
    "SELECT id, description, category, amount_cents FROM finance_expenses WHERE description LIKE ? LIMIT 4", like
  );
  for (const e of expenses as { id: string; description: string; category: string; amount_cents: number }[]) {
    results.push({
      module: "finance",
      id: e.id,
      title: e.description,
      subtitle: `${e.category} · $${(e.amount_cents / 100).toLocaleString()}`,
      path: "/hq/finance",
    });
  }

  return results.slice(0, limit);
}

export async function buildDepartmentMonitoringSummary(): Promise<string> {
  const db = await getDb();
  const departments = await db.all(`
    SELECT d.name, COUNT(p.id) as headcount,
      SUM(CASE WHEN p.payroll_status = 'active' THEN 1 ELSE 0 END) as on_payroll
    FROM departments d LEFT JOIN people p ON p.department_id = d.id AND p.status = 'active'
    GROUP BY d.id ORDER BY headcount DESC
  `);

  const pendingLeave = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM leave_requests WHERE status = 'pending'"))?.c ?? 0;
  const openPOs = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_purchase_orders WHERE status = 'pending'"))?.c ?? 0;

  const lines = [
    "Department Monitoring:",
    ...departments.map((d: { name: string; headcount: number; on_payroll: number }) =>
      `- ${d.name}: ${d.headcount} staff (${d.on_payroll} on payroll)`
    ),
    `Pending leave requests: ${pendingLeave}`,
    `Pending purchase orders: ${openPOs}`,
  ];
  return lines.join("\n");
}
