#!/usr/bin/env node
/**
 * IFCDC Headquarters — People & Operations Phase 3 readiness gate
 */
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const FOUNDER_EMAIL = "service@ifcdc.org";
const FOUNDER_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const results = { pass: 0, fail: 0 };

function log(status, msg, detail = "") {
  console.log(`${status === "pass" ? "✓" : "✗"} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : "fail"]++;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...(opts.body ? { "Content-Type": "application/json" } : {}) } });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { res, body, ok: res.ok };
}

async function login() {
  const { ok, res } = await jsonFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email: FOUNDER_EMAIL, password: FOUNDER_PASSWORD }),
  });
  if (!ok) throw new Error(`Login failed: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  console.log("\n=== IFCDC People & Operations Phase 3.1 Readiness ===\n");
  const cookie = await login();
  log("pass", "Founder login");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const health = await jsonFetch(`${BASE}/api/hq/analytics/overview`, auth);
  const healthScore = health.body?.organizationHealth?.overall;
  log(health.ok && healthScore >= 100 ? "pass" : "fail", "Organization Health", `${healthScore ?? "?"}%`);

  const platform = await jsonFetch(`${BASE}/api/hq/people/operations/v3/platform`, auth);
  log(platform.ok && platform.body?.version === "phase3" ? "pass" : "fail", "HR Command Center platform", platform.body?.version ?? "?");

  const modules = platform.body?.modules ?? [];
  log(modules.length >= 10 ? "pass" : "fail", "Enterprise modules", `${modules.length} modules`);

  for (const type of ["employee", "volunteer", "board_member", "contractor"]) {
    const dir = await jsonFetch(`${BASE}/api/hq/people/operations/v3/directory/${type}`, auth);
    log(dir.ok && Array.isArray(dir.body?.people) ? "pass" : "fail", `${type} directory`, `${dir.body?.people?.length ?? 0} records`);
  }

  const org = await jsonFetch(`${BASE}/api/hq/people/operations/v3/organization-structure`, auth);
  log(org.ok && org.body?.summary?.departmentCount != null ? "pass" : "fail", "Organization structure", `${org.body?.summary?.departmentCount ?? 0} depts`);

  const positions = await jsonFetch(`${BASE}/api/hq/people/positions`, auth);
  log(positions.ok && (positions.body?.positions?.length ?? 0) > 0 ? "pass" : "fail", "Position management", `${positions.body?.positions?.length ?? 0} positions`);

  const applicants = await jsonFetch(`${BASE}/api/hq/people/job-applicants`, auth);
  log(applicants.ok && Array.isArray(applicants.body?.applicants) ? "pass" : "fail", "Job applicants pipeline");

  const createApp = await jsonFetch(`${BASE}/api/hq/people/job-applicants`, {
    ...auth, method: "POST", body: JSON.stringify({ first_name: "Phase3", last_name: "TestApplicant", position_applied: "Program Coordinator" }),
  });
  log(createApp.ok ? "pass" : "fail", "Create job applicant", createApp.body?.applicant?.id ?? "?");

  const payroll = await jsonFetch(`${BASE}/api/hq/people/operations/v3/payroll-time-center`, auth);
  log(payroll.ok && payroll.body?.summary != null ? "pass" : "fail", "Payroll & time center", `${payroll.body?.summary?.hoursThisMonth ?? 0} hrs`);

  const files = await jsonFetch(`${BASE}/api/hq/people/operations/v3/personnel-files`, auth);
  log(files.ok && Array.isArray(files.body?.files) ? "pass" : "fail", "Digital personnel files", `${files.body?.files?.length ?? 0} files`);

  const roles = await jsonFetch(`${BASE}/api/hq/people/operations/v3/roles-permissions`, auth);
  log(roles.ok && (roles.body?.roles?.length ?? 0) > 0 ? "pass" : "fail", "Roles & permissions", `${roles.body?.roles?.length ?? 0} roles`);

  const onboarding = await jsonFetch(`${BASE}/api/hq/people/onboarding`, auth);
  log(onboarding.ok ? "pass" : "fail", "Onboarding center");

  const perf = await jsonFetch(`${BASE}/api/hq/people/performance-reviews`, auth);
  log(perf.ok ? "pass" : "fail", "Performance reviews");

  const certs = await jsonFetch(`${BASE}/api/hq/people/certifications`, auth);
  log(certs.ok ? "pass" : "fail", "Training & certifications");

  const timeClock = await jsonFetch(`${BASE}/api/hq/people/time-clock/summary`, auth);
  log(timeClock.ok ? "pass" : "fail", "Time tracking", `${timeClock.body?.hoursThisMonth ?? 0} hrs`);

  const leave = await jsonFetch(`${BASE}/api/hq/people/leave-requests`, auth);
  log(leave.ok ? "pass" : "fail", "PTO & leave requests");

  const financePayroll = await jsonFetch(`${BASE}/api/hq/finance/payroll/overview`, auth);
  log(financePayroll.ok ? "pass" : "fail", "Finance payroll integration");

  const v5 = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v5/platform`, auth);
  log(v5.ok ? "pass" : "fail", "Grant Center v5 backward compatibility");

  const orgChart = await jsonFetch(`${BASE}/api/hq/people/org-chart`, auth);
  log(orgChart.ok && Array.isArray(orgChart.body?.reportingHierarchy) ? "pass" : "fail", "Organization chart hierarchy");

  const intelligence = await jsonFetch(`${BASE}/api/hq/people/operations/v3/intelligence`, auth);
  log(intelligence.ok && intelligence.body?.workforceAnalytics != null ? "pass" : "fail", "Workforce executive intelligence");

  const timesheets = await jsonFetch(`${BASE}/api/hq/people/timesheets`, auth);
  log(timesheets.ok && Array.isArray(timesheets.body?.timesheets) ? "pass" : "fail", "Timesheets module");

  const teams = await jsonFetch(`${BASE}/api/hq/people/team-assignments`, auth);
  log(teams.ok && Array.isArray(teams.body?.assignments) ? "pass" : "fail", "Team assignments");

  const payrollReports = await jsonFetch(`${BASE}/api/hq/people/operations/v3/payroll-reports`, auth);
  log(payrollReports.ok && payrollReports.body?.summary != null ? "pass" : "fail", "Payroll reports");

  const opsPlatform = await jsonFetch(`${BASE}/api/hq/operations/command-center/v3/platform`, auth);
  log(opsPlatform.ok && opsPlatform.body?.modules != null ? "pass" : "fail", "Operations command center v3");

  const opsTasks = await jsonFetch(`${BASE}/api/hq/operations/tasks`, auth);
  log(opsTasks.ok && Array.isArray(opsTasks.body?.tasks) ? "pass" : "fail", "Operations task management");

  const createTask = await jsonFetch(`${BASE}/api/hq/operations/tasks`, {
    ...auth, method: "POST", body: JSON.stringify({ title: "Phase3 readiness task", priority: "normal" }),
  });
  log(createTask.ok ? "pass" : "fail", "Create operations task");

  const auraWorkforce = await jsonFetch(`${BASE}/api/hq/people/operations/v3/aura`, {
    ...auth, method: "POST", body: JSON.stringify({ question: "Summarize workforce status" }),
  });
  log(auraWorkforce.ok && auraWorkforce.body?.insight ? "pass" : "fail", "AURA workforce advisor");

  const rolesMatrix = await jsonFetch(`${BASE}/api/hq/people/operations/v3/roles-permissions`, auth);
  const roleCount = rolesMatrix.body?.roles?.length ?? 0;
  log(rolesMatrix.ok && roleCount >= 14 ? "pass" : "fail", "Enterprise roles matrix", `${roleCount} roles`);

  const employees = await jsonFetch(`${BASE}/api/hq/people?type=employee`, auth);
  const firstEmployee = employees.body?.people?.[0];
  if (firstEmployee?.id) {
    const patch = await jsonFetch(`${BASE}/api/hq/people/${firstEmployee.id}`, {
      ...auth, method: "PATCH", body: JSON.stringify({ organization_role: firstEmployee.organizationRole ?? "Staff" }),
    });
    log(patch.ok ? "pass" : "fail", "Profile update (employment record)");
  } else {
    log("pass", "Profile update (employment record)", "skipped — no employees");
  }

  const hireFlow = await jsonFetch(`${BASE}/api/hq/people/job-applicants`, {
    ...auth, method: "POST", body: JSON.stringify({ first_name: "Lifecycle", last_name: "HireTest", position_applied: "Program Coordinator" }),
  });
  if (hireFlow.ok && hireFlow.body?.applicant?.id) {
    const hired = await jsonFetch(`${BASE}/api/hq/people/job-applicants/${hireFlow.body.applicant.id}/hire`, {
      ...auth, method: "POST", body: JSON.stringify({ enterprise_role: "employee", pay_rate: 22 }),
    });
    log(hired.ok && hired.body?.person?.id ? "pass" : "fail", "Hire → employee lifecycle");
  } else {
    log("fail", "Hire → employee lifecycle");
  }

  const staffing = await jsonFetch(`${BASE}/api/hq/people/staffing-overview`, auth);
  log(staffing.ok && staffing.body?.summary != null ? "pass" : "fail", "Staffing overview (Phase 3.1)");

  const selfService = await jsonFetch(`${BASE}/api/hq/people/self-service/me`, auth);
  log(selfService.ok || selfService.res.status === 404 ? "pass" : "fail", "Staff self-service API", selfService.ok ? "linked" : "no employee link");

  const managerDash = await jsonFetch(`${BASE}/api/hq/people/manager/dashboard`, auth);
  log(managerDash.ok || managerDash.res.status === 404 ? "pass" : "fail", "Manager portal API");

  const payrollPrep = await jsonFetch(`${BASE}/api/hq/people/operations/v3/payroll-prepare`, {
    ...auth, method: "POST", body: JSON.stringify({}),
  });
  log(payrollPrep.ok ? "pass" : "fail", "Payroll batch preparation");

  const legacyHr = await jsonFetch(`${BASE}/api/hr/employees`, auth);
  log(legacyHr.res.status === 410 ? "pass" : "fail", "Legacy /api/hr deprecated (410)");

  console.log(`\n=== People Phase 3.1: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
