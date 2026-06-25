import { Router } from "express";
import type { Request, Response } from "express";
import { getDb } from "../db";
import { hqAuthRequired, requireHQModule, requireHQPermission } from "../middleware/hqAuth";
import { hasPermission } from "../hq/enterpriseRoles";
import {
  ensurePeopleTables,
  peopleId,
  formatPerson,
  logPeopleActivity,
  PERSON_TYPES,
  PERSON_TYPE_LABELS,
  seedOnboardingForPerson,
} from "../hq/peopleSchema";
import {
  buildHrCommandCenterPlatform,
  buildOrganizationStructure,
  buildPayrollTimeCenter,
  listJobApplicants,
  createJobApplicant,
  updateJobApplicant,
  hireJobApplicant,
  listOrgPositions,
  createOrgPosition,
  listPersonnelFiles,
  getRolesPermissionsMatrix,
  listPeopleByType,
  createContractorPayment,
  ensurePtoBalance,
  buildWorkforceIntelligencePlatform,
  buildWorkforceExecutiveIntelligence,
  auraWorkforceIntelligenceAdvisor,
  buildPayrollReports,
  listTimesheets,
  createTimesheet,
  updateTimesheetStatus,
  listTeamAssignments,
  createTeamAssignment,
} from "../hq/peopleOperationsEngine";
import {
  resolvePersonForUser,
  buildSelfServiceDashboard,
  selfClockIn,
  selfClockOut,
  selfCreateLeaveRequest,
  selfUpdateProfile,
  uploadPersonnelDocument,
  buildManagerDashboard,
  buildStaffingOverview,
  selfSubmitTimesheet,
  selfCompleteOnboardingItem,
  managerReviewLeave,
  managerReviewTimesheet,
  managerCompleteOnboarding,
  buildHrComplianceDashboard,
  buildStaffHrBriefing,
  auraStaffHrBriefing,
} from "../hq/peopleSelfServiceEngine";
import { preparePayrollBatchFromApprovedTimesheets } from "../hq/payrollPreparation";

const router = Router();

router.use(hqAuthRequired);

// ——— Phase 3.1: Staff self-service (no full HR module required) ———
router.get("/self-service/me", requireHQPermission("hq.hr.self"), async (req, res) => {
  const person = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!person) return res.status(404).json({ error: "No employee record linked to your account. Contact HR." });
  const dashboard = await buildSelfServiceDashboard(String(person.id));
  res.json(dashboard);
});

router.post("/self-service/clock-in", requireHQPermission("hq.hr.self"), async (req, res) => {
  const person = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!person) return res.status(404).json({ error: "Employee record not found" });
  res.json(await selfClockIn(String(person.id), { email: req.hqUser?.email }));
});

router.post("/self-service/clock-out", requireHQPermission("hq.hr.self"), async (req, res) => {
  const person = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!person) return res.status(404).json({ error: "Employee record not found" });
  res.json(await selfClockOut(String(person.id), { email: req.hqUser?.email }));
});

router.post("/self-service/leave-requests", requireHQPermission("hq.hr.self"), async (req, res) => {
  const person = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!person) return res.status(404).json({ error: "Employee record not found" });
  const { leave_type, start_date, end_date, reason } = req.body;
  if (!start_date || !end_date) return res.status(400).json({ error: "start_date and end_date required" });
  const row = await selfCreateLeaveRequest(String(person.id), { leave_type, start_date, end_date, reason }, { email: req.hqUser?.email });
  res.status(201).json({ leaveRequest: row });
});

router.patch("/self-service/profile", requireHQPermission("hq.hr.self"), async (req, res) => {
  const person = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!person) return res.status(404).json({ error: "Employee record not found" });
  const updated = await selfUpdateProfile(String(person.id), req.body, { email: req.hqUser?.email });
  if (!updated) return res.status(400).json({ error: "No valid profile fields" });
  res.json({ person: updated });
});

router.post("/self-service/documents/upload", requireHQPermission("hq.hr.self"), async (req, res) => {
  const person = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!person) return res.status(404).json({ error: "Employee record not found" });
  const { fileName, base64, mimeType, name, doc_type, notes } = req.body;
  if (!fileName || !base64 || !name) return res.status(400).json({ error: "fileName, base64, and name required" });
  try {
    const result = await uploadPersonnelDocument(String(person.id), { fileName, base64, mimeType, name, doc_type, notes }, { email: req.hqUser?.email });
    res.status(201).json(result);
  } catch (e) {
    console.error("Self-service document upload:", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

router.post("/self-service/timesheets/submit", requireHQPermission("hq.hr.self"), async (req, res) => {
  const person = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!person) return res.status(404).json({ error: "Employee record not found" });
  res.json(await selfSubmitTimesheet(String(person.id), { email: req.hqUser?.email }));
});

router.patch("/self-service/onboarding/:itemId", requireHQPermission("hq.hr.self"), async (req, res) => {
  const person = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!person) return res.status(404).json({ error: "Employee record not found" });
  const item = await selfCompleteOnboardingItem(String(person.id), req.params.itemId, { email: req.hqUser?.email });
  if (!item) return res.status(404).json({ error: "Onboarding item not found" });
  res.json({ item });
});

router.get("/self-service/briefing", requireHQPermission("hq.hr.self"), async (req, res) => {
  const person = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!person) return res.status(404).json({ error: "Employee record not found" });
  const question = typeof req.query.question === "string" ? req.query.question : undefined;
  res.json(await auraStaffHrBriefing({ personId: String(person.id), question }));
});

// ——— Phase 3.1: Manager portal (department-scoped) ———
router.get("/manager/dashboard", requireHQPermission("hq.hr.approve", "hq.hr.manage"), async (req, res) => {
  const manager = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!manager) return res.status(404).json({ error: "Manager employee record not linked" });
  res.json(await buildManagerDashboard(String(manager.id)));
});

router.get("/manager/briefing", requireHQPermission("hq.hr.approve", "hq.hr.manage"), async (req, res) => {
  const manager = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!manager) return res.status(404).json({ error: "Manager employee record not linked" });
  const question = typeof req.query.question === "string" ? req.query.question : undefined;
  res.json(await auraStaffHrBriefing({ managerPersonId: String(manager.id), question }));
});

router.patch("/manager/leave-requests/:leaveId", requireHQPermission("hq.hr.approve", "hq.hr.manage"), async (req, res) => {
  const manager = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!manager) return res.status(404).json({ error: "Manager employee record not linked" });
  const { status, notes } = req.body ?? {};
  if (!status) return res.status(400).json({ error: "status required" });
  const result = await managerReviewLeave(String(manager.id), req.params.leaveId, status, notes, { email: req.hqUser?.email });
  if (result.error === "not_found") return res.status(404).json({ error: "Leave request not found" });
  if (result.error === "forbidden") return res.status(403).json({ error: "Outside your department scope" });
  res.json(result);
});

router.patch("/manager/timesheets/:id", requireHQPermission("hq.hr.approve", "hq.hr.manage"), async (req, res) => {
  const manager = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!manager) return res.status(404).json({ error: "Manager employee record not linked" });
  const { status } = req.body ?? {};
  if (!status) return res.status(400).json({ error: "status required" });
  const result = await managerReviewTimesheet(String(manager.id), req.params.id, status, { email: req.hqUser?.email });
  if (result.error === "not_found") return res.status(404).json({ error: "Timesheet not found" });
  if (result.error === "forbidden") return res.status(403).json({ error: "Outside your department scope" });
  res.json(result);
});

router.patch("/manager/onboarding/:personId/:itemId", requireHQPermission("hq.hr.approve", "hq.hr.manage"), async (req, res) => {
  const manager = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  if (!manager) return res.status(404).json({ error: "Manager employee record not linked" });
  const result = await managerCompleteOnboarding(String(manager.id), req.params.personId, req.params.itemId, { email: req.hqUser?.email });
  if (result.error === "not_found") return res.status(404).json({ error: "Onboarding item not found" });
  if (result.error === "forbidden") return res.status(403).json({ error: "Outside your department scope" });
  res.json(result);
});

router.get("/compliance/dashboard", requireHQPermission("hq.hr", "hq.hr.manage", "hq.hr.approve"), async (req, res) => {
  const manager = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  const scope = manager ? (await buildManagerDashboard(String(manager.id))).scope.departmentIds : undefined;
  const hasManage = hasPermission(req.hqUser!.role, "hq.hr.manage") || req.hqUser!.role === "founder" || req.hqUser!.role === "owner";
  res.json(await buildHrComplianceDashboard(hasManage ? undefined : scope));
});

router.get("/operations/v3/hr-briefing", requireHQPermission("hq.hr", "hq.hr.manage", "hq.hr.approve", "hq.hr.self"), async (req, res) => {
  const question = typeof req.query.question === "string" ? req.query.question : undefined;
  const person = await resolvePersonForUser({ id: req.hqUser!.id, email: req.hqUser!.email });
  const role = req.hqUser!.role;
  if (person && hasPermission(role, "hq.hr.approve") && !hasPermission(role, "hq.hr.manage") && role !== "founder" && role !== "owner") {
    return res.json(await auraStaffHrBriefing({ managerPersonId: String(person.id), question }));
  }
  if (person && hasPermission(role, "hq.hr.self") && !hasPermission(role, "hq.hr.manage") && !hasPermission(role, "hq.hr.approve")) {
    return res.json(await auraStaffHrBriefing({ personId: String(person.id), question }));
  }
  res.json(await auraStaffHrBriefing({ question }));
});

router.get("/staffing-overview", requireHQPermission("hq.hr", "hq.hr.manage", "hq.hr.approve"), async (_req, res) => {
  res.json(await buildStaffingOverview());
});

router.post("/operations/v3/payroll-prepare", requireHQPermission("hq.hr.manage", "hq.payroll"), async (req, res) => {
  const { period_start, period_end } = req.body ?? {};
  res.json(await preparePayrollBatchFromApprovedTimesheets(period_start, period_end));
});

router.use(requireHQModule("hr"));

router.use((req, res, next) => {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const path = req.path;
  const isApproval =
    (path.includes("/leave-requests/") || path.includes("/timesheets/")) && req.method === "PATCH";
  if (isApproval) {
    return requireHQPermission("hq.hr.manage", "hq.hr.approve")(req, res, next);
  }
  return requireHQPermission("hq.hr.manage")(req, res, next);
});

router.use(async (_req, _res, next) => {
  try {
    await ensurePeopleTables();
    next();
  } catch (e) {
    next(e);
  }
});

router.get("/overview", async (_req, res) => {
  const db = await getDb();
  const byType = await db.all(
    `SELECT person_type, COUNT(*) as count FROM people WHERE status != 'archived' GROUP BY person_type`
  );
  const total = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM people WHERE status != 'archived'"))?.c ?? 0;
  const active = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM people WHERE status = 'active'"))?.c ?? 0;
  const departments = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM departments"))?.c ?? 0;
  const clockedIn = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM time_clock_entries WHERE clock_out IS NULL"
  ))?.c ?? 0;
  const pendingLeave = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM leave_requests WHERE status = 'pending'"
  ))?.c ?? 0;
  const pendingOnboarding = (await db.get<{ c: number }>(
    `SELECT COUNT(DISTINCT person_id) as c FROM people_onboarding_items WHERE completed = 0`
  ))?.c ?? 0;
  const openIncidents = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM people_incidents WHERE status IN ('open', 'investigating')"
  ))?.c ?? 0;
  const upcomingShifts = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM people_schedules WHERE schedule_date >= date('now') AND schedule_date <= date('now', '+7 days')`
  ))?.c ?? 0;

  res.json({ total, active, departments, clockedIn, pendingLeave, pendingOnboarding, openIncidents, upcomingShifts, byType, personTypes: PERSON_TYPES.map((t) => ({ id: t, label: PERSON_TYPE_LABELS[t] })) });
});

router.get("/certifications", async (req, res) => {
  const db = await getDb();
  const days = Number(req.query.days ?? 60);
  const rows = await db.all(`
    SELECT pc.*, p.first_name, p.last_name, p.email, p.person_type, p.status as person_status
    FROM people_certifications pc
    JOIN people p ON p.id = pc.person_id
    WHERE p.status != 'archived'
    ORDER BY CASE WHEN pc.expiry_date IS NULL THEN 1 ELSE 0 END, pc.expiry_date ASC, pc.issued_date DESC
  `);
  const today = new Date();
  const enriched = (rows as { expiry_date: string | null; [k: string]: unknown }[]).map((c) => {
    let alert: "expired" | "expiring" | "valid" | "none" = "none";
    if (c.expiry_date) {
      const exp = new Date(c.expiry_date);
      const diff = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diff < 0) alert = "expired";
      else if (diff <= days) alert = "expiring";
      else alert = "valid";
    }
    return { ...c, alert };
  });
  const expired = enriched.filter((c) => c.alert === "expired").length;
  const expiring = enriched.filter((c) => c.alert === "expiring").length;
  res.json({ certifications: enriched, summary: { total: enriched.length, expired, expiring } });
});

router.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const db = await getDb();
  if (!q) return res.json({ people: [] });

  const rows = await db.all(
    `SELECT p.*, d.name as department_name FROM people p
     LEFT JOIN departments d ON p.department_id = d.id
     WHERE p.status != 'archived' AND (
       p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ?
       OR p.organization_role LIKE ? OR p.phone LIKE ?
     ) ORDER BY p.last_name LIMIT 50`,
    `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`
  );
  res.json({ people: rows.map((r) => formatPerson(r as Record<string, unknown>)) });
});

router.get("/departments", async (_req, res) => {
  const db = await getDb();
  const depts = await db.all(`
    SELECT d.*, COUNT(p.id) as member_count
    FROM departments d LEFT JOIN people p ON p.department_id = d.id AND p.status = 'active'
    GROUP BY d.id ORDER BY d.name
  `);
  res.json({ departments: depts });
});

router.post("/departments", async (req, res) => {
  const { name, code, description, parent_id } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const id = peopleId();
  await db.run(
    `INSERT INTO departments (id, name, code, parent_id, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, name, code ?? name.toUpperCase().slice(0, 6), parent_id ?? null, description ?? "", now, now
  );
  const row = await db.get("SELECT * FROM departments WHERE id = ?", id);
  res.status(201).json({ department: row });
});

router.get("/org-chart", async (_req, res) => {
  const structure = await buildOrganizationStructure();
  res.json(structure);
});

router.patch("/departments/:id", async (req, res) => {
  const { name, code, description, parent_id, head_person_id } = req.body;
  const db = await getDb();
  const now = new Date().toISOString();
  const fields: [string, unknown][] = [];
  if (name !== undefined) fields.push(["name", name]);
  if (code !== undefined) fields.push(["code", code]);
  if (description !== undefined) fields.push(["description", description]);
  if (parent_id !== undefined) fields.push(["parent_id", parent_id]);
  if (head_person_id !== undefined) fields.push(["head_person_id", head_person_id]);
  if (!fields.length) return res.status(400).json({ error: "No valid fields" });
  await db.run(
    `UPDATE departments SET ${fields.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
    ...fields.map(([, v]) => v), now, req.params.id
  );
  res.json({ department: await db.get("SELECT * FROM departments WHERE id = ?", req.params.id) });
});

router.get("/", async (req, res) => {
  const db = await getDb();
  const { type, department, status } = req.query;
  let sql = `SELECT p.*, d.name as department_name FROM people p LEFT JOIN departments d ON p.department_id = d.id WHERE 1=1`;
  const params: string[] = [];

  if (type) { sql += " AND p.person_type = ?"; params.push(String(type)); }
  if (department) { sql += " AND p.department_id = ?"; params.push(String(department)); }
  if (status) { sql += " AND p.status = ?"; params.push(String(status)); }
  else { sql += " AND p.status != 'archived'"; }

  sql += " ORDER BY p.last_name, p.first_name";
  const rows = await db.all(sql, ...params);
  res.json({ people: rows.map((r) => formatPerson(r as Record<string, unknown>)) });
});

router.post("/", async (req: Request, res: Response) => {
  const {
    person_type, first_name, last_name, email, phone, organization_role, enterprise_role,
    department_id, status, location, start_date, notes, pay_rate, pay_type, payroll_status,
    linked_external_id, source_app, profile_photo_url,
  } = req.body;

  if (!person_type || !first_name || !last_name) {
    return res.status(400).json({ error: "person_type, first_name, and last_name are required" });
  }

  const db = await getDb();
  const now = new Date().toISOString();
  const id = peopleId();

  await db.run(
    `INSERT INTO people (id, person_type, first_name, last_name, email, phone, profile_photo_url,
     organization_role, enterprise_role, department_id, status, location, start_date, notes,
     pay_rate, pay_currency, pay_type, payroll_status, linked_external_id, source_app, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?)`,
    id, person_type, first_name, last_name, email?.toLowerCase() ?? null, phone ?? null,
    profile_photo_url ?? null, organization_role ?? null, enterprise_role ?? null,
    department_id ?? null, status ?? "active", location ?? null, start_date ?? null,
    notes ?? null, pay_rate ?? null, pay_type ?? null, payroll_status ?? null,
    linked_external_id ?? null, source_app ?? "hq", now, now
  );

  await logPeopleActivity(id, "created", `Added ${first_name} ${last_name} as ${person_type}`, {
    id: req.hqUser?.id,
    email: req.hqUser?.email,
  });

  if (["employee", "volunteer", "contractor"].includes(person_type)) {
    await seedOnboardingForPerson(id);
  }

  const row = await db.get(
    `SELECT p.*, d.name as department_name FROM people p LEFT JOIN departments d ON p.department_id = d.id WHERE p.id = ?`, id
  );
  res.status(201).json({ person: formatPerson(row as Record<string, unknown>) });
});

router.get("/leave-requests", async (req, res) => {
  const db = await getDb();
  const { status, person_id } = req.query;
  let sql = `
    SELECT lr.*, p.first_name, p.last_name, p.email
    FROM leave_requests lr
    JOIN people p ON p.id = lr.person_id
    WHERE 1=1`;
  const params: string[] = [];
  if (status) { sql += " AND lr.status = ?"; params.push(String(status)); }
  if (person_id) { sql += " AND lr.person_id = ?"; params.push(String(person_id)); }
  sql += " ORDER BY lr.created_at DESC LIMIT 100";
  const rows = await db.all(sql, ...params);
  res.json({ leaveRequests: rows });
});

router.post("/leave-requests", async (req: Request, res: Response) => {
  const { person_id, leave_type, start_date, end_date, hours, reason } = req.body;
  if (!person_id || !start_date || !end_date) {
    return res.status(400).json({ error: "person_id, start_date, and end_date are required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const id = peopleId();
  await db.run(
    `INSERT INTO leave_requests (id, person_id, leave_type, start_date, end_date, hours, reason, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    id, person_id, leave_type ?? "pto", start_date, end_date, hours ?? null, reason ?? "", now, now
  );
  await logPeopleActivity(person_id, "leave_request", `Leave request ${start_date} – ${end_date}`, {
    id: req.hqUser?.id,
    email: req.hqUser?.email,
  });
  res.status(201).json({ leaveRequest: await db.get("SELECT * FROM leave_requests WHERE id = ?", id) });
});

router.patch("/leave-requests/:leaveId", async (req: Request, res: Response) => {
  const { status, notes, reviewer_email } = req.body;
  if (!status) return res.status(400).json({ error: "status is required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const row = await db.get<{ person_id: string }>("SELECT person_id FROM leave_requests WHERE id = ?", req.params.leaveId);
  if (!row) return res.status(404).json({ error: "Leave request not found" });

  await db.run(
    `UPDATE leave_requests SET status = ?, notes = ?, reviewer_email = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
    status, notes ?? "", reviewer_email ?? req.hqUser?.email ?? "", now, now, req.params.leaveId
  );
  if (status === "approved") {
    await db.run("UPDATE people SET status = 'on_leave' WHERE id = ?", row.person_id);
    const lr = await db.get<{ leave_type: string; hours: number | null; start_date: string; end_date: string }>(
      "SELECT leave_type, hours, start_date, end_date FROM leave_requests WHERE id = ?", req.params.leaveId
    );
    if (lr) {
      await ensurePtoBalance(row.person_id);
      const hours = lr.hours ?? Math.max(1, Math.ceil(
        (new Date(lr.end_date).getTime() - new Date(lr.start_date).getTime()) / 86400000
      )) * 8;
      if (lr.leave_type === "sick") {
        await db.run("UPDATE pto_balances SET used_sick = used_sick + ?, updated_at = ? WHERE person_id = ?",
          hours, now, row.person_id);
      } else {
        await db.run("UPDATE pto_balances SET used_pto = used_pto + ?, updated_at = ? WHERE person_id = ?",
          hours, now, row.person_id);
      }
    }
  } else if (status === "denied" || status === "cancelled") {
    await db.run("UPDATE people SET status = 'active' WHERE id = ? AND status = 'on_leave'", row.person_id);
  }
  await logPeopleActivity(row.person_id, "leave_review", `Leave ${status}`, { id: req.hqUser?.id, email: req.hqUser?.email });
  res.json({ leaveRequest: await db.get("SELECT * FROM leave_requests WHERE id = ?", req.params.leaveId) });
});

router.get("/onboarding", async (req, res) => {
  const db = await getDb();
  const incompleteOnly = req.query.incomplete !== "false";
  const summaries = await db.all(`
    SELECT p.id as person_id, p.first_name, p.last_name, p.email, p.person_type, p.start_date,
      COUNT(oi.id) as total_count,
      SUM(CASE WHEN oi.completed = 1 THEN 1 ELSE 0 END) as completed_count
    FROM people p
    JOIN people_onboarding_items oi ON oi.person_id = p.id
    WHERE p.status != 'archived'
    GROUP BY p.id
    ${incompleteOnly ? "HAVING SUM(CASE WHEN oi.completed = 0 THEN 1 ELSE 0 END) > 0" : ""}
    ORDER BY p.last_name
  `);
  const personIds = summaries.map((s: { person_id: string }) => s.person_id);
  const allItems = personIds.length
    ? await db.all(
        `SELECT id, person_id, task_label, task_key, completed, sort_order FROM people_onboarding_items
         WHERE person_id IN (${personIds.map(() => "?").join(",")}) ORDER BY sort_order`,
        ...personIds
      )
    : [];
  const tasksByPerson = new Map<string, unknown[]>();
  for (const item of allItems as { person_id: string }[]) {
    const list = tasksByPerson.get(item.person_id) ?? [];
    list.push(item);
    tasksByPerson.set(item.person_id, list);
  }
  res.json({
    onboarding: summaries.map((s: Record<string, unknown>) => ({
      personId: s.person_id,
      firstName: s.first_name,
      lastName: s.last_name,
      email: s.email,
      personType: s.person_type,
      startDate: s.start_date,
      totalCount: s.total_count,
      completedCount: s.completed_count,
      tasks: tasksByPerson.get(String(s.person_id)) ?? [],
    })),
  });
});

router.get("/schedules", async (req, res) => {
  const db = await getDb();
  const from = String(req.query.from ?? new Date().toISOString().slice(0, 10));
  const to = String(req.query.to ?? "");
  let sql = `
    SELECT s.*, p.first_name, p.last_name, p.person_type, d.name as department_name
    FROM people_schedules s
    JOIN people p ON p.id = s.person_id
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE p.status != 'archived' AND s.schedule_date >= ?`;
  const params: string[] = [from];
  if (to) { sql += " AND s.schedule_date <= ?"; params.push(to); }
  sql += " ORDER BY s.schedule_date ASC, s.start_time ASC LIMIT 200";
  const rows = await db.all(sql, ...params);
  res.json({ schedules: rows });
});

router.get("/performance-reviews", async (req, res) => {
  const db = await getDb();
  const rows = await db.all(`
    SELECT pr.*, p.first_name, p.last_name, p.person_type, p.organization_role, d.name as department_name
    FROM people_performance pr
    JOIN people p ON p.id = pr.person_id
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE p.status != 'archived'
    ORDER BY pr.review_date DESC LIMIT 100
  `);
  res.json({ reviews: rows });
});

router.get("/time-clock/summary", async (req, res) => {
  const db = await getDb();
  const active = await db.all(`
    SELECT t.id, t.person_id, t.clock_in, p.first_name, p.last_name, p.person_type, d.name as department_name
    FROM time_clock_entries t
    JOIN people p ON p.id = t.person_id
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE t.clock_out IS NULL
    ORDER BY t.clock_in DESC
  `);
  const recent = await db.all(`
    SELECT t.*, p.first_name, p.last_name, p.person_type
    FROM time_clock_entries t
    JOIN people p ON p.id = t.person_id
    ORDER BY t.clock_in DESC LIMIT 50
  `);
  const hoursThisMonth = (await db.get<{ h: number }>(
    `SELECT COALESCE(SUM(hours), 0) as h FROM time_clock_entries WHERE clock_in >= date('now', 'start of month')`
  ))?.h ?? 0;
  res.json({ active, recent, hoursThisMonth: Math.round(hoursThisMonth * 100) / 100 });
});

router.get("/incidents", async (req, res) => {
  const db = await getDb();
  const status = String(req.query.status ?? "").trim();
  let sql = `
    SELECT i.*, p.first_name, p.last_name, rp.first_name as reporter_first, rp.last_name as reporter_last
    FROM people_incidents i
    LEFT JOIN people p ON p.id = i.person_id
    LEFT JOIN people rp ON rp.id = i.reported_by_person_id
    WHERE 1=1`;
  const params: string[] = [];
  if (status) { sql += " AND i.status = ?"; params.push(status); }
  sql += " ORDER BY i.incident_date DESC, i.created_at DESC LIMIT 100";
  const rows = await db.all(sql, ...params);
  res.json({ incidents: rows });
});

router.post("/incidents", async (req: Request, res: Response) => {
  const { person_id, reported_by_person_id, incident_date, incident_type, severity, location, description } = req.body;
  if (!incident_date || !description) {
    return res.status(400).json({ error: "incident_date and description are required" });
  }
  const db = await getDb();
  const id = peopleId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO people_incidents (id, person_id, reported_by_person_id, incident_date, incident_type, severity, location, description, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    id, person_id ?? null, reported_by_person_id ?? null, incident_date,
    incident_type ?? "general", severity ?? "low", location ?? "", description, now, now
  );
  if (person_id) {
    await logPeopleActivity(person_id, "incident_reported", `Incident reported: ${incident_type ?? "general"}`, {
      id: req.hqUser?.id, email: req.hqUser?.email,
    });
  }
  res.status(201).json({ incident: await db.get("SELECT * FROM people_incidents WHERE id = ?", id) });
});

router.patch("/incidents/:incidentId", async (req: Request, res: Response) => {
  const { status, resolution, severity } = req.body;
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `UPDATE people_incidents SET
      status = COALESCE(?, status),
      resolution = COALESCE(?, resolution),
      severity = COALESCE(?, severity),
      resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE resolved_at END,
      updated_at = ?
     WHERE id = ?`,
    status ?? null, resolution ?? null, severity ?? null, status ?? null,
    status === "resolved" ? now : null, now, req.params.incidentId
  );
  res.json({ incident: await db.get("SELECT * FROM people_incidents WHERE id = ?", req.params.incidentId) });
});

// ——— People & Operations Phase 3 — HR Command Center ———

router.get("/operations/v3/platform", async (_req, res) => {
  res.json(await buildHrCommandCenterPlatform());
});

router.get("/operations/v3/organization-structure", async (_req, res) => {
  res.json(await buildOrganizationStructure());
});

router.get("/operations/v3/payroll-time-center", async (_req, res) => {
  res.json(await buildPayrollTimeCenter());
});

router.get("/operations/v3/personnel-files", async (req, res) => {
  const limit = Number(req.query.limit ?? 200);
  res.json({ files: await listPersonnelFiles(limit) });
});

router.get("/operations/v3/roles-permissions", (_req, res) => {
  res.json(getRolesPermissionsMatrix());
});

router.get("/operations/v3/intelligence", async (_req, res) => {
  res.json(await buildWorkforceExecutiveIntelligence());
});

router.get("/operations/v3/intelligence-platform", async (_req, res) => {
  res.json(await buildWorkforceIntelligencePlatform());
});

router.get("/operations/v3/payroll-reports", async (_req, res) => {
  res.json(await buildPayrollReports());
});

router.post("/operations/v3/aura", async (req, res) => {
  try {
    const result = await auraWorkforceIntelligenceAdvisor({ question: req.body?.question });
    res.json(result);
  } catch (e) {
    console.error("AURA workforce intelligence error:", e);
    res.status(500).json({ error: "AURA advisor unavailable" });
  }
});

router.get("/timesheets", async (req, res) => {
  res.json({ timesheets: await listTimesheets(req.query.status as string | undefined) });
});

router.post("/timesheets", async (req: Request, res: Response) => {
  const { person_id, period_start, period_end } = req.body;
  if (!person_id || !period_start || !period_end) {
    return res.status(400).json({ error: "person_id, period_start, and period_end are required" });
  }
  const timesheet = await createTimesheet(req.body, { email: req.hqUser?.email });
  res.status(201).json({ timesheet });
});

router.patch("/timesheets/:id", async (req: Request, res: Response) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "status is required" });
  const timesheet = await updateTimesheetStatus(req.params.id, status, { email: req.hqUser?.email });
  if (!timesheet) return res.status(404).json({ error: "Timesheet not found" });
  res.json({ timesheet });
});

router.get("/team-assignments", async (req, res) => {
  res.json({ assignments: await listTeamAssignments(req.query.department_id as string | undefined) });
});

router.post("/team-assignments", async (req: Request, res: Response) => {
  const { person_id, team_name } = req.body;
  if (!person_id || !team_name) return res.status(400).json({ error: "person_id and team_name are required" });
  const assignment = await createTeamAssignment(req.body, { email: req.hqUser?.email });
  res.status(201).json({ assignment });
});

router.get("/operations/v3/directory/:type", async (req, res) => {
  const people = await listPeopleByType(req.params.type, Number(req.query.limit ?? 100));
  res.json({ people, personType: req.params.type });
});

router.get("/job-applicants", async (req, res) => {
  res.json({ applicants: await listJobApplicants(req.query.status as string | undefined) });
});

router.post("/job-applicants", async (req: Request, res: Response) => {
  const { first_name, last_name } = req.body;
  if (!first_name || !last_name) return res.status(400).json({ error: "first_name and last_name are required" });
  const applicant = await createJobApplicant(req.body, { email: req.hqUser?.email });
  res.status(201).json({ applicant });
});

router.patch("/job-applicants/:id", async (req: Request, res: Response) => {
  const applicant = await updateJobApplicant(req.params.id, req.body, { email: req.hqUser?.email });
  if (!applicant) return res.status(404).json({ error: "Applicant not found" });
  res.json({ applicant });
});

router.post("/job-applicants/:id/hire", async (req: Request, res: Response) => {
  const result = await hireJobApplicant(req.params.id, { id: req.hqUser?.id, email: req.hqUser?.email }, req.body);
  if (!result) return res.status(404).json({ error: "Applicant not found" });
  res.json(result);
});

router.get("/positions", async (_req, res) => {
  res.json({ positions: await listOrgPositions() });
});

router.post("/positions", async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  const position = await createOrgPosition(req.body);
  res.status(201).json({ position });
});

router.post("/contractor-payments", async (req: Request, res: Response) => {
  const { person_id, description, amount_cents } = req.body;
  if (!person_id || !description || amount_cents == null) {
    return res.status(400).json({ error: "person_id, description, and amount_cents are required" });
  }
  const payment = await createContractorPayment(req.body, { email: req.hqUser?.email });
  res.status(201).json({ payment });
});

router.post("/:id/pto-balance/seed", async (req, res) => {
  const balance = await ensurePtoBalance(req.params.id);
  res.json({ balance });
});

router.get("/:id/onboarding", async (req, res) => {
  const db = await getDb();
  const person = await db.get("SELECT id, first_name, last_name FROM people WHERE id = ?", req.params.id);
  if (!person) return res.status(404).json({ error: "Person not found" });
  const items = await db.all(
    "SELECT * FROM people_onboarding_items WHERE person_id = ? ORDER BY sort_order", req.params.id
  );
  res.json({ items, completedCount: items.filter((i: { completed: number }) => i.completed === 1).length, totalCount: items.length });
});

router.post("/:id/onboarding/seed", async (req, res) => {
  const db = await getDb();
  const person = await db.get("SELECT id FROM people WHERE id = ?", req.params.id);
  if (!person) return res.status(404).json({ error: "Person not found" });
  await seedOnboardingForPerson(req.params.id);
  const items = await db.all(
    "SELECT * FROM people_onboarding_items WHERE person_id = ? ORDER BY sort_order", req.params.id
  );
  res.status(201).json({ items });
});

router.patch("/:id/onboarding/:itemId", async (req: Request, res: Response) => {
  const { completed, notes } = req.body;
  const db = await getDb();
  const item = await db.get<{ person_id: string }>(
    "SELECT person_id FROM people_onboarding_items WHERE id = ? AND person_id = ?",
    req.params.itemId, req.params.id
  );
  if (!item) return res.status(404).json({ error: "Onboarding item not found" });
  const now = new Date().toISOString();
  const isComplete = completed !== false && completed !== 0;
  await db.run(
    `UPDATE people_onboarding_items SET completed = ?, completed_at = ?, completed_by = ?, notes = COALESCE(?, notes) WHERE id = ?`,
    isComplete ? 1 : 0, isComplete ? now : null, isComplete ? req.hqUser?.email ?? "" : null, notes ?? null, req.params.itemId
  );
  if (isComplete) {
    const remaining = await db.get<{ c: number }>(
      "SELECT COUNT(*) as c FROM people_onboarding_items WHERE person_id = ? AND completed = 0", req.params.id
    );
    if (remaining && remaining.c === 0) {
      await logPeopleActivity(req.params.id, "onboarding_complete", "All onboarding tasks completed", {
        id: req.hqUser?.id, email: req.hqUser?.email,
      });
    }
  }
  res.json({ item: await db.get("SELECT * FROM people_onboarding_items WHERE id = ?", req.params.itemId) });
});

router.get("/:id", async (req, res) => {
  const db = await getDb();
  const row = await db.get(
    `SELECT p.*, d.name as department_name FROM people p LEFT JOIN departments d ON p.department_id = d.id WHERE p.id = ?`,
    req.params.id
  );
  if (!row) return res.status(404).json({ error: "Person not found" });

  const [documents, certifications, training, performance, schedules, timeEntries, activity, leaveRequests, backgroundChecks, signatures] = await Promise.all([
    db.all("SELECT * FROM people_documents WHERE person_id = ? ORDER BY created_at DESC", req.params.id),
    db.all("SELECT * FROM people_certifications WHERE person_id = ? ORDER BY issued_date DESC", req.params.id),
    db.all("SELECT * FROM people_training WHERE person_id = ? ORDER BY completed_date DESC", req.params.id),
    db.all("SELECT * FROM people_performance WHERE person_id = ? ORDER BY review_date DESC", req.params.id),
    db.all("SELECT * FROM people_schedules WHERE person_id = ? ORDER BY schedule_date DESC LIMIT 20", req.params.id),
    db.all("SELECT * FROM time_clock_entries WHERE person_id = ? ORDER BY clock_in DESC LIMIT 20", req.params.id),
    db.all("SELECT * FROM people_activity WHERE person_id = ? ORDER BY created_at DESC LIMIT 15", req.params.id),
    db.all("SELECT * FROM leave_requests WHERE person_id = ? ORDER BY created_at DESC LIMIT 10", req.params.id),
    db.all("SELECT * FROM background_checks WHERE person_id = ? ORDER BY created_at DESC", req.params.id),
    db.all("SELECT * FROM people_signatures WHERE person_id = ? ORDER BY signed_at DESC", req.params.id).catch(() => []),
  ]);

  res.json({
    person: formatPerson(row as Record<string, unknown>),
    documents,
    certifications,
    training,
    performance,
    schedules,
    timeEntries,
    activity,
    leaveRequests,
    backgroundChecks,
    signatures,
  });
});

router.patch("/:id", async (req: Request, res: Response) => {
  const db = await getDb();
  const fields = req.body;
  const allowed = [
    "first_name", "last_name", "email", "phone", "profile_photo_url", "organization_role",
    "enterprise_role", "department_id", "status", "contact_address", "emergency_contact",
    "emergency_phone", "location", "start_date", "end_date", "notes", "pay_rate",
    "pay_type", "payroll_status", "person_type", "linked_external_id",
    "reports_to_person_id", "position_id",
  ];

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (!sets.length) return res.status(400).json({ error: "No valid fields to update" });

  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(req.params.id);

  await db.run(`UPDATE people SET ${sets.join(", ")} WHERE id = ?`, ...values);

  await logPeopleActivity(req.params.id, "updated", `Profile updated`, {
    id: req.hqUser?.id,
    email: req.hqUser?.email,
  });

  const row = await db.get(
    `SELECT p.*, d.name as department_name FROM people p LEFT JOIN departments d ON p.department_id = d.id WHERE p.id = ?`,
    req.params.id
  );
  res.json({ person: formatPerson(row as Record<string, unknown>) });
});

// Sub-resources
router.post("/:id/documents/upload", async (req: Request, res: Response) => {
  const { fileName, base64, mimeType, name, doc_type, notes } = req.body;
  if (!fileName || !base64 || !name) return res.status(400).json({ error: "fileName, base64, and name are required" });
  try {
    const result = await uploadPersonnelDocument(req.params.id, { fileName, base64, mimeType, name, doc_type, notes }, { email: req.hqUser?.email });
    res.status(201).json(result);
  } catch (e) {
    console.error("Personnel document upload:", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

router.post("/:id/documents", async (req, res) => {
  const { name, doc_type, file_url, notes } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const db = await getDb();
  const id = peopleId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO people_documents (id, person_id, name, doc_type, file_url, notes, uploaded_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, req.params.id, name, doc_type ?? "personnel", file_url ?? null, notes ?? "", now, now
  );
  res.status(201).json({ document: await db.get("SELECT * FROM people_documents WHERE id = ?", id) });
});

router.post("/:id/certifications", async (req, res) => {
  const { name, issuer, issued_date, expiry_date } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const db = await getDb();
  const id = peopleId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO people_certifications (id, person_id, name, issuer, issued_date, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, req.params.id, name, issuer ?? "", issued_date ?? null, expiry_date ?? null, now
  );
  res.status(201).json({ certification: await db.get("SELECT * FROM people_certifications WHERE id = ?", id) });
});

router.post("/:id/training", async (req, res) => {
  const { title, provider, completed_date, status, notes } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  const db = await getDb();
  const id = peopleId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO people_training (id, person_id, title, provider, completed_date, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, req.params.id, title, provider ?? "", completed_date ?? null, status ?? "scheduled", notes ?? "", now
  );
  res.status(201).json({ training: await db.get("SELECT * FROM people_training WHERE id = ?", id) });
});

router.post("/:id/performance", async (req, res) => {
  const { review_date, reviewer, rating, summary, goals } = req.body;
  if (!review_date) return res.status(400).json({ error: "review_date is required" });
  const db = await getDb();
  const id = peopleId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO people_performance (id, person_id, review_date, reviewer, rating, summary, goals, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, req.params.id, review_date, reviewer ?? "", rating ?? "", summary ?? "", goals ?? "", now
  );
  res.status(201).json({ performance: await db.get("SELECT * FROM people_performance WHERE id = ?", id) });
});

router.post("/:id/schedule", async (req, res) => {
  const { title, schedule_date, start_time, end_time, location, notes } = req.body;
  if (!title || !schedule_date) return res.status(400).json({ error: "title and schedule_date are required" });
  const db = await getDb();
  const id = peopleId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO people_schedules (id, person_id, title, schedule_date, start_time, end_time, location, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, req.params.id, title, schedule_date, start_time ?? null, end_time ?? null, location ?? "", notes ?? "", now
  );
  res.status(201).json({ schedule: await db.get("SELECT * FROM people_schedules WHERE id = ?", id) });
});

router.post("/:id/background-checks", async (req: Request, res: Response) => {
  const { check_type, provider, status, initiated_date, completed_date, result, expiry_date, reference_id, notes } = req.body;
  const db = await getDb();
  const id = peopleId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO background_checks (id, person_id, check_type, provider, status, initiated_date, completed_date, result, expiry_date, reference_id, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, req.params.id, check_type ?? "criminal", provider ?? "", status ?? "pending",
    initiated_date ?? now.slice(0, 10), completed_date ?? null, result ?? "", expiry_date ?? null,
    reference_id ?? "", notes ?? "", now
  );
  await logPeopleActivity(req.params.id, "background_check", `${check_type ?? "criminal"} check — ${status ?? "pending"}`, {
    id: req.hqUser?.id,
    email: req.hqUser?.email,
  });
  res.status(201).json({ backgroundCheck: await db.get("SELECT * FROM background_checks WHERE id = ?", id) });
});

router.post("/:id/signatures", async (req: Request, res: Response) => {
  const { document_title, agreement_type, signer_name, signature_text, witness_email, notes } = req.body;
  if (!document_title || !signer_name || !signature_text) {
    return res.status(400).json({ error: "document_title, signer_name, and signature_text are required" });
  }
  const db = await getDb();
  const person = await db.get("SELECT id FROM people WHERE id = ?", req.params.id);
  if (!person) return res.status(404).json({ error: "Person not found" });

  const id = peopleId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO people_signatures (id, person_id, document_title, agreement_type, signer_name, signature_text, signed_at, witness_email, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, req.params.id, document_title, agreement_type ?? "policy", signer_name, signature_text,
    now, witness_email ?? req.hqUser?.email ?? null, notes ?? "", now
  );
  await logPeopleActivity(req.params.id, "signature", `Signed: ${document_title}`, {
    id: req.hqUser?.id,
    email: req.hqUser?.email,
  });
  res.status(201).json({ signature: await db.get("SELECT * FROM people_signatures WHERE id = ?", id) });
});

router.post("/:id/clock-in", async (req: Request, res: Response) => {
  const db = await getDb();
  const open = await db.get("SELECT id FROM time_clock_entries WHERE person_id = ? AND clock_out IS NULL", req.params.id);
  if (open) return res.status(400).json({ error: "Already clocked in" });

  const id = peopleId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO time_clock_entries (id, person_id, clock_in, created_at) VALUES (?, ?, ?, ?)`,
    id, req.params.id, now, now
  );
  await logPeopleActivity(req.params.id, "clock_in", "Clocked in", { id: req.hqUser?.id, email: req.hqUser?.email });
  res.status(201).json({ entry: await db.get("SELECT * FROM time_clock_entries WHERE id = ?", id) });
});

router.post("/:id/clock-out", async (req: Request, res: Response) => {
  const db = await getDb();
  const entry = await db.get<{ id: string; clock_in: string }>(
    "SELECT id, clock_in FROM time_clock_entries WHERE person_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1",
    req.params.id
  );
  if (!entry) return res.status(400).json({ error: "Not clocked in" });

  const now = new Date().toISOString();
  const hours = (new Date(now).getTime() - new Date(entry.clock_in).getTime()) / 3600000;
  await db.run("UPDATE time_clock_entries SET clock_out = ?, hours = ? WHERE id = ?", now, Math.round(hours * 100) / 100, entry.id);
  await logPeopleActivity(req.params.id, "clock_out", `Clocked out (${hours.toFixed(2)}h)`, { id: req.hqUser?.id, email: req.hqUser?.email });
  res.json({ entry: await db.get("SELECT * FROM time_clock_entries WHERE id = ?", entry.id) });
});

/** External app sync — Barbers clients, etc. (read-only from locked app) */
router.post("/sync", async (req: Request, res: Response) => {
  const { source_app, people: batch } = req.body;
  if (!source_app || !Array.isArray(batch)) {
    return res.status(400).json({ error: "source_app and people array required" });
  }

  const db = await getDb();
  let synced = 0;
  for (const p of batch) {
    const existing = p.linked_external_id
      ? await db.get("SELECT id FROM people WHERE linked_external_id = ? AND source_app = ?", p.linked_external_id, source_app)
      : p.email
        ? await db.get("SELECT id FROM people WHERE email = ? AND source_app = ?", p.email, source_app)
        : null;

    if (existing) {
      await db.run(
        `UPDATE people SET first_name = ?, last_name = ?, phone = ?, status = ?, updated_at = ? WHERE id = ?`,
        p.first_name, p.last_name, p.phone ?? null, p.status ?? "active", new Date().toISOString(), (existing as { id: string }).id
      );
    } else {
      const id = peopleId();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO people (id, person_type, first_name, last_name, email, phone, linked_external_id, source_app, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, p.person_type ?? "client", p.first_name, p.last_name, p.email ?? null, p.phone ?? null,
        p.linked_external_id ?? null, source_app, p.status ?? "active", now, now
      );
    }
    synced++;
  }
  res.json({ synced, source_app });
});

export default router;
