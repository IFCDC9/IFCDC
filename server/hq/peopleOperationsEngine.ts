/**
 * IFCDC Headquarters — People & Operations Phase 3
 * HR Command Center, Organization Structure, Payroll & Time Management
 */
import { getDb } from "../db";
import {
  peopleId,
  formatPerson,
  logPeopleActivity,
  seedOnboardingForPerson,
  PERSON_TYPE_LABELS,
} from "./peopleSchema";
import {
  ROLE_PERMISSIONS,
  HQ_MODULE_PERMISSIONS,
  ROUTE_PERMISSIONS,
} from "./enterpriseRoles";

export const HR_COMMAND_MODULES = [
  { id: "employees", label: "Employee Directory", personType: "employee", tab: "employees" },
  { id: "volunteers", label: "Volunteer Directory", personType: "volunteer", tab: "volunteers" },
  { id: "board", label: "Board of Directors", personType: "board_member", tab: "board" },
  { id: "contractors", label: "Contractors & Consultants", personType: "contractor", tab: "contractors" },
  { id: "applicants", label: "Job Applicants", tab: "applicants" },
  { id: "onboarding", label: "Onboarding Center", tab: "onboarding" },
  { id: "training", label: "Training & Certifications", tab: "certifications" },
  { id: "performance", label: "Performance Reviews", tab: "performance" },
  { id: "roles", label: "Roles & Permissions", tab: "roles" },
  { id: "personnel-files", label: "Digital Personnel Files", tab: "personnel-files" },
  { id: "org-chart", label: "Organization Chart", tab: "org-chart" },
  { id: "timesheets", label: "Timesheets", tab: "timesheets" },
] as const;

export async function listPeopleByType(personType: string, limit = 100) {
  const db = await getDb();
  const rows = await db.all(
    `SELECT p.*, d.name as department_name FROM people p
     LEFT JOIN departments d ON p.department_id = d.id
     WHERE p.person_type = ? AND p.status != 'archived'
     ORDER BY p.last_name, p.first_name LIMIT ?`,
    personType, limit
  );
  return rows.map((r) => formatPerson(r as Record<string, unknown>));
}

export async function listJobApplicants(status?: string) {
  const db = await getDb();
  let sql = `
    SELECT ja.*, d.name as department_name
    FROM job_applicants ja LEFT JOIN departments d ON ja.department_id = d.id WHERE 1=1`;
  const params: string[] = [];
  if (status) { sql += " AND ja.status = ?"; params.push(status); }
  sql += " ORDER BY ja.applied_at DESC";
  const rows = await db.all(sql, ...params);
  return rows;
}

export async function createJobApplicant(data: Record<string, unknown>, actor?: { email?: string }) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = peopleId();
  await db.run(
    `INSERT INTO job_applicants (id, first_name, last_name, email, phone, position_applied, department_id,
     resume_url, status, source, notes, applied_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.first_name,
    data.last_name,
    data.email ?? null,
    data.phone ?? null,
    data.position_applied ?? null,
    data.department_id ?? null,
    data.resume_url ?? null,
    data.status ?? "new",
    data.source ?? "hq",
    data.notes ?? "",
    now,
    now,
    now
  );
  await logPeopleActivity(null, "applicant_created", `${data.first_name} ${data.last_name} — ${data.position_applied ?? "position TBD"}`, actor);
  return db.get("SELECT * FROM job_applicants WHERE id = ?", id);
}

export async function updateJobApplicant(id: string, data: Record<string, unknown>, actor?: { email?: string }) {
  const db = await getDb();
  const now = new Date().toISOString();
  const fields: string[] = [];
  const vals: unknown[] = [];
  for (const key of ["status", "notes", "position_applied", "department_id", "reviewed_at"]) {
    if (data[key] !== undefined) { fields.push(`${key} = ?`); vals.push(data[key]); }
  }
  if (fields.length === 0) return db.get("SELECT * FROM job_applicants WHERE id = ?", id);
  fields.push("updated_at = ?");
  vals.push(now, id);
  await db.run(`UPDATE job_applicants SET ${fields.join(", ")} WHERE id = ?`, ...vals);
  await logPeopleActivity(null, "applicant_updated", `Applicant ${id} → ${data.status ?? "updated"}`, actor);
  return db.get("SELECT * FROM job_applicants WHERE id = ?", id);
}

export async function hireJobApplicant(
  applicantId: string,
  actor?: { id?: string; email?: string },
  opts?: { position_id?: string; department_id?: string; enterprise_role?: string; pay_rate?: number; reports_to_person_id?: string }
) {
  const db = await getDb();
  const app = await db.get<Record<string, unknown>>("SELECT * FROM job_applicants WHERE id = ?", applicantId);
  if (!app) return null;
  if (app.hired_person_id) return { person: await db.get("SELECT * FROM people WHERE id = ?", app.hired_person_id), alreadyHired: true };

  const now = new Date().toISOString();
  const personId = peopleId();
  const departmentId = opts?.department_id ?? app.department_id ?? null;

  let positionId = opts?.position_id ?? null;
  if (!positionId && app.position_applied) {
    const pos = await db.get<{ id: string }>(
      "SELECT id FROM org_positions WHERE title = ? AND status = 'active' LIMIT 1",
      app.position_applied
    );
    positionId = pos?.id ?? null;
  }

  const enterpriseRole = opts?.enterprise_role ?? "employee";
  const payRate = opts?.pay_rate ?? null;

  await db.run(
    `INSERT INTO people (id, person_type, first_name, last_name, email, phone, department_id, organization_role,
     enterprise_role, position_id, reports_to_person_id, status, start_date, pay_rate, pay_type, payroll_status,
     source_app, created_at, updated_at)
     VALUES (?, 'employee', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 'hourly', 'active', 'hq', ?, ?)`,
    personId,
    app.first_name,
    app.last_name,
    app.email ?? null,
    app.phone ?? null,
    departmentId,
    app.position_applied ?? "New Hire",
    enterpriseRole,
    positionId,
    opts?.reports_to_person_id ?? null,
    now.slice(0, 10),
    payRate,
    now,
    now
  );
  await seedOnboardingForPerson(personId);
  await ensurePtoBalance(personId);
  await db.run(
    "UPDATE job_applicants SET status = 'hired', hired_person_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ?",
    personId, now, now, applicantId
  );
  await logPeopleActivity(personId, "hired_from_applicant", `Hired from applicant pipeline`, actor);
  const row = await db.get(
    `SELECT p.*, d.name as department_name FROM people p LEFT JOIN departments d ON p.department_id = d.id WHERE p.id = ?`,
    personId
  );
  return { person: formatPerson(row as Record<string, unknown>), applicantId };
}

export async function listOrgPositions() {
  const db = await getDb();
  return db.all(`
    SELECT op.*, d.name as department_name,
      (SELECT COUNT(*) FROM people p WHERE p.position_id = op.id AND p.status = 'active') as filled_count
    FROM org_positions op LEFT JOIN departments d ON op.department_id = d.id
    WHERE op.status = 'active' ORDER BY op.level, op.title
  `);
}

export async function createOrgPosition(data: Record<string, unknown>) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = peopleId();
  await db.run(
    `INSERT INTO org_positions (id, title, department_id, level, description, permissions_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    id, data.title, data.department_id ?? null, data.level ?? 3,
    data.description ?? "", data.permissions_json ?? "[]", now, now
  );
  return db.get("SELECT * FROM org_positions WHERE id = ?", id);
}

export async function buildOrganizationStructure() {
  const db = await getDb();
  const departments = await db.all(`
    SELECT d.*, COUNT(p.id) as member_count,
      (SELECT first_name || ' ' || last_name FROM people WHERE id = d.head_person_id) as head_name
    FROM departments d LEFT JOIN people p ON p.department_id = d.id AND p.status = 'active'
    GROUP BY d.id ORDER BY d.name
  `);
  const positions = await listOrgPositions();
  const people = await db.all(`
    SELECT p.id, p.first_name, p.last_name, p.person_type, p.organization_role, p.department_id,
      p.reports_to_person_id, p.position_id, p.status, d.name as department_name,
      op.title as position_title,
      (SELECT first_name || ' ' || last_name FROM people WHERE id = p.reports_to_person_id) as reports_to_name
    FROM people p
    LEFT JOIN departments d ON p.department_id = d.id
    LEFT JOIN org_positions op ON op.id = p.position_id
    WHERE p.status = 'active' AND p.person_type IN ('employee', 'board_member', 'contractor')
    ORDER BY p.last_name
  `);

  const hierarchy = (people as { id: string; reports_to_person_id: string | null }[]).filter((p) => !p.reports_to_person_id);
  const buildTree = (parentId: string | null): unknown[] =>
    (people as { id: string; reports_to_person_id: string | null; first_name: string; last_name: string }[])
      .filter((p) => p.reports_to_person_id === parentId)
      .map((p) => ({
        ...p,
        name: `${p.first_name} ${p.last_name}`,
        directReports: buildTree(p.id),
      }));

  const roots = buildTree(null);

  return {
    departments,
    positions,
    people,
    reportingHierarchy: roots,
    summary: {
      departmentCount: departments.length,
      positionCount: positions.length,
      activeStaff: people.length,
      withManager: (people as { reports_to_person_id: string | null }[]).filter((p) => p.reports_to_person_id).length,
    },
  };
}

export async function listPersonnelFiles(limit = 200) {
  const db = await getDb();
  return db.all(`
    SELECT pd.*, p.first_name, p.last_name, p.person_type, p.email, d.name as department_name
    FROM people_documents pd
    JOIN people p ON p.id = pd.person_id
    LEFT JOIN departments d ON p.department_id = d.id
    WHERE p.status != 'archived'
    ORDER BY pd.created_at DESC LIMIT ?
  `, limit);
}

export function getRolesPermissionsMatrix() {
  const roles = Object.keys(ROLE_PERMISSIONS);
  const modules = Object.entries(HQ_MODULE_PERMISSIONS).map(([module, allowedRoles]) => ({
    module,
    allowedRoles,
  }));
  const routes = Object.entries(ROUTE_PERMISSIONS)
    .filter(([path]) => path.includes("people") || path.includes("hr") || path.includes("payroll") || path.includes("board"))
    .map(([path, permission]) => ({ path, permission }));

  return {
    roles: roles.map((role) => ({
      role,
      permissions: ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS],
    })),
    modules,
    peopleRoutes: routes,
    personTypes: Object.entries(PERSON_TYPE_LABELS).map(([id, label]) => ({ id, label })),
  };
}

export async function buildPayrollTimeCenter() {
  const db = await getDb();

  const activePayroll = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM people WHERE person_type IN ('employee', 'contractor', 'barber') AND status = 'active' AND payroll_status = 'active'"
  ))?.c ?? 0;

  const hoursThisMonth = (await db.get<{ h: number }>(
    `SELECT COALESCE(SUM(hours), 0) as h FROM time_clock_entries
     WHERE clock_in >= date('now', 'start of month')`
  ))?.h ?? 0;

  const clockedIn = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM time_clock_entries WHERE clock_out IS NULL"
  ))?.c ?? 0;

  const pendingLeave = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM leave_requests WHERE status = 'pending'"
  ))?.c ?? 0;

  const ptoBalances = await db.all(`
    SELECT pb.*, p.first_name, p.last_name, p.person_type
    FROM pto_balances pb JOIN people p ON p.id = pb.person_id
    WHERE p.status = 'active' ORDER BY p.last_name LIMIT 50
  `);

  const contractorPayments = await db.all(`
    SELECT cp.*, p.first_name, p.last_name
    FROM contractor_payments cp JOIN people p ON p.id = cp.person_id
    ORDER BY cp.payment_date DESC LIMIT 25
  `);

  const grantFundedStaff = await db.all(`
    SELECT gla.*, p.first_name, p.last_name, o.title as grant_title
    FROM grant_labor_allocations gla
    JOIN people p ON p.id = gla.person_id
    LEFT JOIN grant_awards ga ON ga.id = gla.award_id
    LEFT JOIN grant_opportunities o ON o.id = ga.opportunity_id
    ORDER BY gla.created_at DESC LIMIT 50
  `);

  const payrollRuns = await db.all(
    "SELECT * FROM finance_payroll_runs ORDER BY period_end DESC LIMIT 5"
  );
  const lastRun = payrollRuns[0] as { total_net_cents?: number; status?: string } | undefined;

  const recentTime = await db.all(`
    SELECT t.*, p.first_name, p.last_name, p.person_type
    FROM time_clock_entries t JOIN people p ON p.id = t.person_id
    ORDER BY t.clock_in DESC LIMIT 20
  `);

  return {
    summary: {
      activePayroll,
      hoursThisMonth: Math.round(hoursThisMonth * 100) / 100,
      clockedIn,
      pendingLeave,
      contractorPaymentsPending: (contractorPayments as { status: string }[]).filter((c) => c.status === "pending").length,
      grantFundedStaffCount: grantFundedStaff.length,
      lastPayrollNetCents: lastRun?.total_net_cents ?? 0,
      lastPayrollStatus: lastRun?.status ?? "none",
    },
    ptoBalances,
    contractorPayments,
    grantFundedStaff,
    payrollRuns,
    recentTimeEntries: recentTime,
  };
}

export async function ensurePtoBalance(personId: string) {
  const db = await getDb();
  const existing = await db.get("SELECT id FROM pto_balances WHERE person_id = ?", personId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = peopleId();
  await db.run(
    `INSERT INTO pto_balances (id, person_id, pto_hours, sick_hours, used_pto, used_sick, fiscal_year, updated_at)
     VALUES (?, ?, 80, 40, 0, 0, ?, ?)`,
    id, personId, new Date().getFullYear().toString(), now
  );
  return db.get("SELECT * FROM pto_balances WHERE person_id = ?", personId);
}

export async function createContractorPayment(data: Record<string, unknown>, actor?: { email?: string }) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = peopleId();
  await db.run(
    `INSERT INTO contractor_payments (id, person_id, description, amount_cents, payment_date, status, grant_award_id, invoice_ref, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, data.person_id, data.description, data.amount_cents, data.payment_date ?? now.slice(0, 10),
    data.status ?? "pending", data.grant_award_id ?? null, data.invoice_ref ?? "", data.notes ?? "", now
  );
  await logPeopleActivity(String(data.person_id), "contractor_payment", `${data.description} — $${(Number(data.amount_cents) / 100).toFixed(2)}`, actor);
  return db.get("SELECT * FROM contractor_payments WHERE id = ?", id);
}

export async function buildHrCommandCenterPlatform() {
  const db = await getDb();
  const [employees, volunteers, board, contractors, applicants, onboardingPending, personnelFileCount] = await Promise.all([
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM people WHERE person_type = 'employee' AND status = 'active'"),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM people WHERE person_type = 'volunteer' AND status = 'active'"),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM people WHERE person_type = 'board_member' AND status = 'active'"),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM people WHERE person_type = 'contractor' AND status = 'active'"),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM job_applicants WHERE status IN ('new', 'reviewing', 'interview')"),
    db.get<{ c: number }>("SELECT COUNT(DISTINCT person_id) as c FROM people_onboarding_items WHERE completed = 0"),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM people_documents"),
  ]);

  const orgStructure = await buildOrganizationStructure();
  const payrollTime = await buildPayrollTimeCenter();

  return {
    version: "phase3",
    modules: HR_COMMAND_MODULES,
    counts: {
      employees: employees?.c ?? 0,
      volunteers: volunteers?.c ?? 0,
      board: board?.c ?? 0,
      contractors: contractors?.c ?? 0,
      applicants: applicants?.c ?? 0,
      onboardingInProgress: onboardingPending?.c ?? 0,
      personnelFiles: personnelFileCount?.c ?? 0,
    },
    organizationStructure: orgStructure.summary,
    payrollTime: payrollTime.summary,
    generatedAt: new Date().toISOString(),
  };
}

// ——— Workforce Executive Intelligence (Phase 3 Priority 4) ———

export async function buildHiringPipelineMetrics() {
  const db = await getDb();
  const byStatus = await db.all(
    "SELECT status, COUNT(*) as count FROM job_applicants GROUP BY status"
  );
  const recent = await db.all(
    "SELECT * FROM job_applicants ORDER BY applied_at DESC LIMIT 10"
  );
  const hired = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM job_applicants WHERE status = 'hired'"))?.c ?? 0;
  const open = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM job_applicants WHERE status IN ('new', 'reviewing', 'interview')"
  ))?.c ?? 0;
  return { byStatus, recent, hired, open, conversionRate: open + hired > 0 ? Math.round((hired / (open + hired)) * 100) : 0 };
}

export async function buildHrComplianceScore() {
  const db = await getDb();
  const activePeople = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM people WHERE status = 'active'"))?.c ?? 0;
  const expiredCerts = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM people_certifications pc JOIN people p ON p.id = pc.person_id
     WHERE p.status = 'active' AND pc.expiry_date IS NOT NULL AND pc.expiry_date < date('now')`
  ))?.c ?? 0;
  const expiringCerts = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM people_certifications pc JOIN people p ON p.id = pc.person_id
     WHERE p.status = 'active' AND pc.expiry_date BETWEEN date('now') AND date('now', '+60 days')`
  ))?.c ?? 0;
  const pendingBg = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM background_checks WHERE status IN ('pending', 'in_progress')`
  ))?.c ?? 0;
  const incompleteOnboarding = (await db.get<{ c: number }>(
    "SELECT COUNT(DISTINCT person_id) as c FROM people_onboarding_items WHERE completed = 0"
  ))?.c ?? 0;
  const openIncidents = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM people_incidents WHERE status IN ('open', 'investigating')"
  ))?.c ?? 0;

  let score = 100;
  if (activePeople > 0) {
    score -= Math.min(25, Math.round((expiredCerts / activePeople) * 100));
    score -= Math.min(15, expiringCerts * 3);
    score -= Math.min(20, pendingBg * 5);
    score -= Math.min(20, incompleteOnboarding * 4);
    score -= Math.min(20, openIncidents * 5);
  }
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    grade: score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D",
    factors: { expiredCerts, expiringCerts, pendingBg, incompleteOnboarding, openIncidents, activePeople },
    status: score >= 80 ? "healthy" : score >= 60 ? "attention" : "critical",
  };
}

export async function buildDepartmentPerformance() {
  const db = await getDb();
  const depts = await db.all(`
    SELECT d.id, d.name, d.code,
      COUNT(DISTINCT p.id) as headcount,
      COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_count,
      COALESCE(SUM(t.hours), 0) as hours_this_month,
      COUNT(DISTINCT lr.id) as pending_leave
    FROM departments d
    LEFT JOIN people p ON p.department_id = d.id
    LEFT JOIN time_clock_entries t ON t.person_id = p.id AND t.clock_in >= date('now', 'start of month')
    LEFT JOIN leave_requests lr ON lr.person_id = p.id AND lr.status = 'pending'
    GROUP BY d.id ORDER BY headcount DESC
  `);
  return depts;
}

export async function buildStaffingForecast() {
  const db = await getDb();
  const current = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM people WHERE person_type IN ('employee', 'contractor') AND status = 'active'"
  ))?.c ?? 0;
  const applicants = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM job_applicants WHERE status IN ('reviewing', 'interview')"
  ))?.c ?? 0;
  const onboarding = (await db.get<{ c: number }>(
    "SELECT COUNT(DISTINCT person_id) as c FROM people_onboarding_items WHERE completed = 0"
  ))?.c ?? 0;
  const months = [0, 1, 2, 3, 4, 5].map((offset) => {
    const d = new Date();
    d.setMonth(d.getMonth() + offset);
    const label = d.toISOString().slice(0, 7);
    const projected = current + Math.round(applicants * 0.3) - Math.round(onboarding * 0.1 * offset);
    return { month: label, projectedHeadcount: Math.max(current, projected) };
  });
  return { currentHeadcount: current, pipelineApplicants: applicants, onboardingInProgress: onboarding, forecast: months };
}

export async function buildPayrollForecast() {
  const db = await getDb();
  const activePayroll = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM people WHERE person_type IN ('employee', 'contractor', 'barber') AND status = 'active' AND pay_rate IS NOT NULL"
  ))?.c ?? 0;
  const avgRate = (await db.get<{ avg: number }>(
    "SELECT AVG(pay_rate) as avg FROM people WHERE status = 'active' AND pay_rate IS NOT NULL"
  ))?.avg ?? 25;
  const hoursMonth = (await db.get<{ h: number }>(
    `SELECT COALESCE(SUM(hours), 0) as h FROM time_clock_entries WHERE clock_in >= date('now', 'start of month')`
  ))?.h ?? 0;
  const monthlyLabor = hoursMonth > 0 ? hoursMonth * avgRate : activePayroll * avgRate * 80;
  const forecast = [0, 1, 2, 3].map((offset) => {
    const d = new Date();
    d.setMonth(d.getMonth() + offset);
    return { month: d.toISOString().slice(0, 7), projectedPayroll: Math.round(monthlyLabor * (1 + offset * 0.02)) };
  });
  return { monthlyLabor: Math.round(monthlyLabor), activePayroll, avgHourlyRate: Math.round(avgRate * 100) / 100, forecast };
}

export async function buildPayrollReports() {
  const db = await getDb();
  const runs = await db.all("SELECT * FROM finance_payroll_runs ORDER BY period_end DESC LIMIT 12");
  const items = await db.all(`
    SELECT pi.*, p.department_id, d.name as department_name
    FROM finance_payroll_items pi
    LEFT JOIN people p ON p.id = pi.person_id
    LEFT JOIN departments d ON d.id = p.department_id
    ORDER BY pi.created_at DESC LIMIT 50
  `);
  const totalNet = runs.reduce((s, r) => s + Number((r as { total_net_cents?: number }).total_net_cents ?? 0), 0);
  return { runs, items, summary: { runCount: runs.length, totalNetCents: totalNet } };
}

export async function listTimesheets(status?: string) {
  const db = await getDb();
  let sql = `
    SELECT ts.*, p.first_name, p.last_name, p.person_type, d.name as department_name
    FROM payroll_timesheets ts
    JOIN people p ON p.id = ts.person_id
    LEFT JOIN departments d ON p.department_id = d.id
    WHERE 1=1`;
  const params: string[] = [];
  if (status) { sql += " AND ts.status = ?"; params.push(status); }
  sql += " ORDER BY ts.period_end DESC";
  return db.all(sql, ...params);
}

export async function createTimesheet(data: Record<string, unknown>, actor?: { email?: string }) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = peopleId();
  const personId = String(data.person_id);
  const periodStart = String(data.period_start);
  const periodEnd = String(data.period_end);

  const hours = (await db.get<{ h: number }>(
    `SELECT COALESCE(SUM(hours), 0) as h FROM time_clock_entries
     WHERE person_id = ? AND clock_in >= ? AND clock_in <= ?`,
    personId, periodStart, periodEnd + "T23:59:59"
  ))?.h ?? 0;

  await db.run(
    `INSERT INTO payroll_timesheets (id, person_id, period_start, period_end, total_hours, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, personId, periodStart, periodEnd, hours, data.status ?? "draft", data.notes ?? "", now, now
  );
  await logPeopleActivity(personId, "timesheet_created", `Timesheet ${periodStart}–${periodEnd}`, actor);
  return db.get("SELECT * FROM payroll_timesheets WHERE id = ?", id);
}

export async function updateTimesheetStatus(id: string, status: string, actor?: { email?: string }) {
  const db = await getDb();
  const now = new Date().toISOString();
  const row = await db.get<{ person_id: string }>("SELECT person_id FROM payroll_timesheets WHERE id = ?", id);
  if (!row) return null;
  await db.run(
    `UPDATE payroll_timesheets SET status = ?, submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_at END,
     approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END,
     approver_email = CASE WHEN ? IN ('approved', 'rejected') THEN ? ELSE approver_email END, updated_at = ? WHERE id = ?`,
    status, status, now, status, now, status, actor?.email ?? null, now, id
  );
  await logPeopleActivity(row.person_id, "timesheet_" + status, `Timesheet ${status}`, actor);
  return db.get("SELECT * FROM payroll_timesheets WHERE id = ?", id);
}

export async function listTeamAssignments(departmentId?: string) {
  const db = await getDb();
  let sql = `
    SELECT ta.*, p.first_name, p.last_name, d.name as department_name
    FROM people_team_assignments ta
    JOIN people p ON p.id = ta.person_id
    LEFT JOIN departments d ON d.id = ta.department_id WHERE ta.status = 'active'`;
  const params: string[] = [];
  if (departmentId) { sql += " AND ta.department_id = ?"; params.push(departmentId); }
  sql += " ORDER BY ta.team_name, p.last_name";
  return db.all(sql, ...params);
}

export async function createTeamAssignment(data: Record<string, unknown>, actor?: { email?: string }) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = peopleId();
  await db.run(
    `INSERT INTO people_team_assignments (id, person_id, department_id, team_name, role, assignment_type, start_date, status, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    id, data.person_id, data.department_id ?? null, data.team_name, data.role ?? "",
    data.assignment_type ?? "team", data.start_date ?? now.slice(0, 10), data.notes ?? "", now
  );
  await logPeopleActivity(String(data.person_id), "team_assignment", `Assigned to ${data.team_name}`, actor);
  return db.get("SELECT * FROM people_team_assignments WHERE id = ?", id);
}

export async function buildWorkforceExecutiveIntelligence() {
  const [hiring, compliance, deptPerf, staffing, payrollForecast, payrollReports, platform] = await Promise.all([
    buildHiringPipelineMetrics(),
    buildHrComplianceScore(),
    buildDepartmentPerformance(),
    buildStaffingForecast(),
    buildPayrollForecast(),
    buildPayrollReports(),
    buildHrCommandCenterPlatform(),
  ]);

  return {
    workforceAnalytics: {
      totalPeople: platform.counts.employees + platform.counts.volunteers + platform.counts.contractors,
      employees: platform.counts.employees,
      volunteers: platform.counts.volunteers,
      contractors: platform.counts.contractors,
      onboardingInProgress: platform.counts.onboardingInProgress,
    },
    hiringPipeline: hiring,
    hrComplianceScore: compliance,
    departmentPerformance: deptPerf,
    payrollForecast,
    staffingForecast: staffing,
    payrollReports: payrollReports.summary,
    organizationGrowth: {
      headcountTrend: staffing.forecast,
      applicantsOpen: hiring.open,
      hiredTotal: hiring.hired,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function buildWorkforceIntelligencePlatform() {
  const [hrPlatform, intelligence, payrollTime, orgStructure] = await Promise.all([
    buildHrCommandCenterPlatform(),
    buildWorkforceExecutiveIntelligence(),
    buildPayrollTimeCenter(),
    buildOrganizationStructure(),
  ]);
  return {
    version: "phase3-intelligence",
    hrPlatform,
    executiveIntelligence: intelligence,
    payrollTime: payrollTime.summary,
    organizationStructure: orgStructure.summary,
    generatedAt: new Date().toISOString(),
  };
}

export async function auraWorkforceIntelligenceAdvisor(opts?: { question?: string }) {
  const { auraExecutiveChat } = await import("../lib/ifcdc");
  const { buildAuraExecutiveContext } = await import("./auraExecutiveContext");
  const [platform, context] = await Promise.all([
    buildWorkforceIntelligencePlatform(),
    buildAuraExecutiveContext(),
  ]);
  const question = opts?.question?.trim() ?? "Summarize IFCDC workforce priorities and HR compliance for leadership.";
  let insight: string;
  let offline = false;
  try {
    insight = await auraExecutiveChat(
      `${question}\n\nRespond as IFCDC Workforce Intelligence Advisor.`,
      `${context}\n\nWorkforce Intelligence:\n${JSON.stringify({
        compliance: platform.executiveIntelligence.hrComplianceScore,
        hiring: platform.executiveIntelligence.hiringPipeline,
        staffing: platform.executiveIntelligence.staffingForecast,
        payroll: platform.executiveIntelligence.payrollForecast,
      }, null, 2)}`
    );
  } catch {
    offline = true;
    const intel = platform.executiveIntelligence;
    insight = [
      `HR Compliance Score: ${intel.hrComplianceScore.score}/100 (${intel.hrComplianceScore.grade}).`,
      `Active workforce: ${intel.workforceAnalytics.totalPeople} (employees: ${intel.workforceAnalytics.employees}).`,
      `Hiring pipeline: ${intel.hiringPipeline.open} open applicants, ${intel.hiringPipeline.hired} hired.`,
      `Projected monthly payroll: $${intel.payrollForecast.monthlyLabor.toLocaleString()}.`,
      `Staffing forecast (6mo): ${intel.staffingForecast.forecast[5]?.projectedHeadcount ?? intel.staffingForecast.currentHeadcount} headcount.`,
    ].join("\n");
  }
  return { insight, offline, executiveIntelligence: platform.executiveIntelligence };
}
