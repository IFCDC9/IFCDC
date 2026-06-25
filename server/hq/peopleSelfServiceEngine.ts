/**
 * Phase 3.1 — Staff self-service and manager portal (department-scoped)
 */
import { getDb } from "../db";
import { peopleId, formatPerson, logPeopleActivity } from "./peopleSchema";
import { saveHqFileBase64 } from "./hqFileStorage";
import { ensureDocumentTables } from "./documentsSchema";

export async function resolvePersonForUser(user: { id: string; email: string }) {
  const db = await getDb();
  let row = await db.get<Record<string, unknown>>(
    "SELECT p.*, d.name as department_name FROM people p LEFT JOIN departments d ON p.department_id = d.id WHERE p.linked_user_id = ? AND p.status != 'archived'",
    user.id
  );
  if (!row) {
    row = await db.get<Record<string, unknown>>(
      `SELECT p.*, d.name as department_name FROM people p LEFT JOIN departments d ON p.department_id = d.id
       WHERE lower(p.email) = lower(?) AND p.status != 'archived' ORDER BY p.created_at DESC LIMIT 1`,
      user.email
    );
    if (row) {
      const now = new Date().toISOString();
      await db.run("UPDATE people SET linked_user_id = ?, updated_at = ? WHERE id = ?", user.id, now, row.id);
    }
  }
  return row ? formatPerson(row) : null;
}

export async function getManagerScope(managerPersonId: string) {
  const db = await getDb();
  const me = await db.get<{ department_id: string | null }>("SELECT department_id FROM people WHERE id = ?", managerPersonId);
  const headed = await db.all("SELECT id FROM departments WHERE head_person_id = ?", managerPersonId) as { id: string }[];
  const departmentIds = Array.from(new Set([me?.department_id, ...headed.map((d) => d.id)].filter(Boolean))) as string[];
  return { managerPersonId, departmentIds };
}

function deptFilterSql(departmentIds: string[], managerPersonId: string, alias = "p") {
  if (!departmentIds.length) {
    return { sql: ` AND ${alias}.reports_to_person_id = ?`, params: [managerPersonId] };
  }
  return {
    sql: ` AND (${alias}.department_id IN (${departmentIds.map(() => "?").join(",")}) OR ${alias}.reports_to_person_id = ?)`,
    params: [...departmentIds, managerPersonId],
  };
}

export async function buildSelfServiceDashboard(personId: string) {
  const db = await getDb();
  const person = await db.get(
    `SELECT p.*, d.name as department_name FROM people p LEFT JOIN departments d ON p.department_id = d.id WHERE p.id = ?`,
    personId
  );
  if (!person) return null;

  const activeClock = await db.get(
    "SELECT id, clock_in FROM time_clock_entries WHERE person_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1",
    personId
  );
  const hoursThisMonth = (await db.get<{ h: number }>(
    `SELECT COALESCE(SUM(hours), 0) as h FROM time_clock_entries WHERE person_id = ? AND clock_in >= date('now', 'start of month')`,
    personId
  ))?.h ?? 0;

  const onboarding = await db.all(
    "SELECT * FROM people_onboarding_items WHERE person_id = ? ORDER BY sort_order",
    personId
  );
  const certifications = await db.all(
    "SELECT * FROM people_certifications WHERE person_id = ? ORDER BY expiry_date",
    personId
  );
  const training = await db.all(
    "SELECT * FROM people_training WHERE person_id = ? ORDER BY created_at DESC",
    personId
  );
  const leaveRequests = await db.all(
    "SELECT * FROM leave_requests WHERE person_id = ? ORDER BY created_at DESC LIMIT 20",
    personId
  );
  const ptoBalance = await db.get("SELECT * FROM pto_balances WHERE person_id = ?", personId);
  const payHistory = await db.all(
    `SELECT fpi.*, fpr.period_start, fpr.period_end, fpr.status as run_status
     FROM finance_payroll_items fpi
     JOIN finance_payroll_runs fpr ON fpr.id = fpi.payroll_run_id
     WHERE fpi.person_id = ? ORDER BY fpr.period_end DESC LIMIT 12`,
    personId
  );
  const timesheets = await db.all(
    "SELECT * FROM payroll_timesheets WHERE person_id = ? ORDER BY period_end DESC LIMIT 10",
    personId
  );

  return {
    person: formatPerson(person as Record<string, unknown>),
    clock: { active: !!activeClock, entry: activeClock, hoursThisMonth },
    onboarding,
    certifications,
    training,
    leaveRequests,
    ptoBalance,
    payHistory,
    timesheets,
    summary: {
      onboardingComplete: (onboarding as { completed: number }[]).filter((o) => o.completed).length,
      onboardingTotal: onboarding.length,
      pendingLeave: (leaveRequests as { status: string }[]).filter((l) => l.status === "pending").length,
    },
  };
}

export async function selfClockIn(personId: string, actor?: { email?: string }) {
  const db = await getDb();
  const open = await db.get("SELECT id FROM time_clock_entries WHERE person_id = ? AND clock_out IS NULL", personId);
  if (open) return { alreadyClockedIn: true, entry: open };
  const now = new Date().toISOString();
  const id = peopleId();
  await db.run(
    "INSERT INTO time_clock_entries (id, person_id, clock_in, created_at) VALUES (?, ?, ?, ?)",
    id, personId, now, now
  );
  await logPeopleActivity(personId, "clock_in", "Self-service clock in", actor);
  return { entry: await db.get("SELECT * FROM time_clock_entries WHERE id = ?", id) };
}

export async function selfClockOut(personId: string, actor?: { email?: string }) {
  const db = await getDb();
  const open = await db.get<{ id: string; clock_in: string }>(
    "SELECT id, clock_in FROM time_clock_entries WHERE person_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1",
    personId
  );
  if (!open) return { notClockedIn: true };
  const now = new Date().toISOString();
  const hours = (new Date(now).getTime() - new Date(open.clock_in).getTime()) / 3600000;
  await db.run("UPDATE time_clock_entries SET clock_out = ?, hours = ? WHERE id = ?", now, Math.round(hours * 100) / 100, open.id);
  await logPeopleActivity(personId, "clock_out", `Self-service clock out (${hours.toFixed(2)}h)`, actor);
  return { entry: await db.get("SELECT * FROM time_clock_entries WHERE id = ?", open.id) };
}

export async function selfCreateLeaveRequest(personId: string, data: Record<string, unknown>, actor?: { email?: string }) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = peopleId();
  await db.run(
    `INSERT INTO leave_requests (id, person_id, leave_type, start_date, end_date, reason, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    id, personId, data.leave_type ?? "pto", data.start_date, data.end_date, data.reason ?? "", now, now
  );
  await logPeopleActivity(personId, "leave_requested", `Leave request ${data.start_date}–${data.end_date}`, actor);
  return db.get("SELECT * FROM leave_requests WHERE id = ?", id);
}

export async function selfUpdateProfile(personId: string, data: Record<string, unknown>, actor?: { email?: string }) {
  const db = await getDb();
  const allowed = ["phone", "location", "contact_address", "emergency_contact", "emergency_phone"];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of allowed) {
    if (data[key] !== undefined) { sets.push(`${key} = ?`); vals.push(data[key]); }
  }
  if (!sets.length) return null;
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString(), personId);
  await db.run(`UPDATE people SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  await logPeopleActivity(personId, "profile_self_update", "Updated contact information", actor);
  const row = await db.get(
    `SELECT p.*, d.name as department_name FROM people p LEFT JOIN departments d ON p.department_id = d.id WHERE p.id = ?`,
    personId
  );
  return formatPerson(row as Record<string, unknown>);
}

export async function uploadPersonnelDocument(
  personId: string,
  data: { fileName: string; base64: string; mimeType?: string; name: string; doc_type?: string; notes?: string },
  actor?: { email?: string }
) {
  await ensureDocumentTables();
  const saved = await saveHqFileBase64(data.fileName, data.base64, data.mimeType);
  const db = await getDb();
  const now = new Date().toISOString();
  const person = await db.get<{ department_id: string | null; first_name: string; last_name: string }>(
    "SELECT department_id, first_name, last_name FROM people WHERE id = ?", personId
  );
  const hqDocId = peopleId();
  const peopleDocId = peopleId();

  await db.run(
    `INSERT INTO hq_documents (id, title, category, file_url, version, person_id, department_id, access_level, approval_status, submitted_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, 'hr', 'approved', ?, ?, ?)`,
    hqDocId, data.name, data.doc_type ?? "personnel", saved.url, personId,
    person?.department_id ?? null, actor?.email ?? "system", now, now
  );
  await db.run(
    `INSERT INTO people_documents (id, person_id, name, doc_type, file_url, notes, uploaded_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    peopleDocId, personId, data.name, data.doc_type ?? "personnel", saved.url,
    data.notes ?? `HQ vault: ${saved.fileName}`, now, now
  );
  await logPeopleActivity(personId, "document_uploaded", `Personnel file: ${data.name}`, actor);
  return {
    document: await db.get("SELECT * FROM people_documents WHERE id = ?", peopleDocId),
    hqDocument: await db.get("SELECT id, title, file_url FROM hq_documents WHERE id = ?", hqDocId),
    file: saved,
  };
}

export async function buildManagerDashboard(managerPersonId: string) {
  const db = await getDb();
  const scope = await getManagerScope(managerPersonId);
  const { sql, params } = deptFilterSql(scope.departmentIds, managerPersonId);

  const team = await db.all(
    `SELECT p.id, p.first_name, p.last_name, p.organization_role, p.status, p.department_id, d.name as department_name
     FROM people p LEFT JOIN departments d ON p.department_id = d.id
     WHERE p.status = 'active' AND p.person_type IN ('employee', 'contractor') ${sql}
     ORDER BY p.last_name`,
    ...params
  );

  const pendingLeave = await db.all(
    `SELECT lr.*, p.first_name, p.last_name, d.name as department_name
     FROM leave_requests lr JOIN people p ON p.id = lr.person_id
     LEFT JOIN departments d ON d.id = p.department_id
     WHERE lr.status = 'pending' ${sql}`,
    ...params
  );

  const pendingTimesheets = await db.all(
    `SELECT ts.*, p.first_name, p.last_name
     FROM payroll_timesheets ts JOIN people p ON p.id = ts.person_id
     WHERE ts.status = 'submitted' ${sql}`,
    ...params
  );

  const attendance = await db.all(
    `SELECT p.id, p.first_name, p.last_name,
      (SELECT COUNT(*) FROM time_clock_entries t WHERE t.person_id = p.id AND t.clock_in >= date('now', 'start of month')) as entries_this_month,
      (SELECT COALESCE(SUM(hours), 0) FROM time_clock_entries t WHERE t.person_id = p.id AND t.clock_in >= date('now', 'start of month')) as hours_this_month
     FROM people p WHERE p.status = 'active' ${sql}`,
    ...params
  );

  const performance = await db.all(
    `SELECT pr.*, p.first_name, p.last_name FROM people_performance pr
     JOIN people p ON p.id = pr.person_id
     WHERE 1=1 ${sql}
     ORDER BY pr.review_date DESC LIMIT 20`,
    ...params
  );

  const departments = scope.departmentIds.length
    ? await db.all(`SELECT * FROM departments WHERE id IN (${scope.departmentIds.map(() => "?").join(",")})`, ...scope.departmentIds)
    : [];

  return {
    scope: { departmentIds: scope.departmentIds, teamCount: team.length },
    departments,
    team,
    pendingLeave,
    pendingTimesheets,
    attendance,
    performance,
    summary: {
      teamCount: team.length,
      pendingLeave: pendingLeave.length,
      pendingTimesheets: pendingTimesheets.length,
      hoursThisMonth: (attendance as { hours_this_month: number }[]).reduce((s, a) => s + Number(a.hours_this_month ?? 0), 0),
    },
  };
}

export async function buildStaffingOverview() {
  const db = await getDb();
  const positions = await db.all(`
    SELECT op.id, op.title as role_name, op.title as role_key,
      (SELECT COUNT(*) FROM people p WHERE p.position_id = op.id AND p.status = 'active') as active_count,
      (SELECT COUNT(*) FROM people p WHERE p.position_id = op.id AND p.status = 'onboarding') as onboarding_count
    FROM org_positions op WHERE op.status = 'active' ORDER BY op.title
  `);
  const overview = (positions as { id: string; role_key: string; role_name: string; active_count: number; onboarding_count: number }[]).map((p) => ({
    id: p.id,
    roleKey: p.role_key,
    roleName: p.role_name,
    targetCount: Math.max(p.active_count + 1, 1),
    activeCount: p.active_count,
    onboardingCount: p.onboarding_count,
    openCount: Math.max(0, 1 - p.active_count),
  }));
  return {
    overview,
    summary: {
      totalTarget: overview.reduce((s, r) => s + r.targetCount, 0),
      totalActive: overview.reduce((s, r) => s + r.activeCount, 0),
      totalOnboarding: overview.reduce((s, r) => s + r.onboardingCount, 0),
      totalOpen: overview.reduce((s, r) => s + r.openCount, 0),
    },
  };
}
