/**
 * Build 62 — Enterprise Human Resources & Workforce Management Foundation
 * Aggregates People/HR engines + recruitment/volunteer/goals tables into one command surface.
 * Freeze-safe: server/hq only — deep CRUD remains in /hq/people.
 */
import { getDb } from "../db";
import { ensurePeopleTables, peopleId, PERSON_TYPE_LABELS } from "./peopleSchema";
import {
  buildHrCommandCenterPlatform,
  buildWorkforceExecutiveIntelligence,
  buildWorkforceIntelligencePlatform,
  buildPayrollTimeCenter,
  buildHiringPipelineMetrics,
  auraWorkforceIntelligenceAdvisor,
  listJobApplicants,
  listOrgPositions,
} from "./peopleOperationsEngine";
import { buildHrComplianceDashboard, buildStaffingOverview } from "./peopleSelfServiceEngine";
import { listReviewReminders } from "./policyGovernanceEngine";

async function soft<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[workforce-foundation] ${label}:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

async function count(sql: string, ...params: unknown[]): Promise<number> {
  const db = await getDb();
  const row = await db.get<{ c: number }>(sql, ...params);
  return row?.c ?? 0;
}

export async function buildWorkforceDashboard() {
  await ensurePeopleTables();
  const db = await getDb();

  const [
    employees,
    volunteers,
    contractors,
    interns,
    board,
    openPositions,
    activeRecruitments,
    newHires,
    trainingIncomplete,
    trainingComplete,
    performanceReviews,
    attendanceToday,
    timeOffPending,
    certifications,
    certificationsExpiring,
    onboardingInProgress,
    openRequisitions,
    volunteerHoursYtd,
    capacity,
    platform,
    intelligence,
    payrollTime,
    compliance,
  ] = await Promise.all([
    count("SELECT COUNT(*) as c FROM people WHERE person_type = 'employee' AND status = 'active'"),
    count("SELECT COUNT(*) as c FROM people WHERE person_type = 'volunteer' AND status = 'active'"),
    count("SELECT COUNT(*) as c FROM people WHERE person_type = 'contractor' AND status = 'active'"),
    count("SELECT COUNT(*) as c FROM people WHERE person_type = 'intern' AND status = 'active'"),
    count("SELECT COUNT(*) as c FROM people WHERE person_type = 'board_member' AND status = 'active'"),
    count("SELECT COUNT(*) as c FROM org_positions WHERE status = 'open' OR status = 'vacant'"),
    count("SELECT COUNT(*) as c FROM job_applicants WHERE status IN ('new', 'reviewing', 'interview')"),
    count("SELECT COUNT(*) as c FROM people WHERE start_date >= date('now', '-90 days') AND status = 'active'"),
    count("SELECT COUNT(*) as c FROM people_training WHERE status IN ('scheduled', 'in_progress', 'required')"),
    count("SELECT COUNT(*) as c FROM people_training WHERE status = 'completed'"),
    count("SELECT COUNT(*) as c FROM people_performance WHERE review_date >= date('now', '-365 days')"),
    count("SELECT COUNT(*) as c FROM time_clock_entries WHERE clock_out IS NULL"),
    count("SELECT COUNT(*) as c FROM leave_requests WHERE status = 'pending'"),
    count("SELECT COUNT(*) as c FROM people_certifications"),
    count(
      `SELECT COUNT(*) as c FROM people_certifications WHERE expiry_date IS NOT NULL
       AND expiry_date BETWEEN date('now') AND date('now', '+60 days')`
    ),
    count("SELECT COUNT(DISTINCT person_id) as c FROM people_onboarding_items WHERE completed = 0"),
    count("SELECT COUNT(*) as c FROM job_requisitions WHERE status = 'open'"),
    soft(
      "vol-hours",
      async () => {
        const row = await db.get<{ h: number }>(
          "SELECT COALESCE(SUM(hours), 0) as h FROM volunteer_hours WHERE service_date >= date('now', 'start of year')"
        );
        return row?.h ?? 0;
      },
      0
    ),
    soft("staffing", () => buildStaffingOverview(), null as Awaited<ReturnType<typeof buildStaffingOverview>> | null),
    soft("platform", () => buildHrCommandCenterPlatform(), null as Awaited<ReturnType<typeof buildHrCommandCenterPlatform>> | null),
    soft("intel", () => buildWorkforceExecutiveIntelligence(), null as Awaited<ReturnType<typeof buildWorkforceExecutiveIntelligence>> | null),
    soft("payroll-time", () => buildPayrollTimeCenter(), null as Awaited<ReturnType<typeof buildPayrollTimeCenter>> | null),
    soft("compliance", () => buildHrComplianceDashboard(), null as Awaited<ReturnType<typeof buildHrComplianceDashboard>> | null),
  ]);

  const totalWorkforce = employees + volunteers + contractors + interns + board;
  const openPos = openPositions > 0 ? openPositions : openRequisitions;
  const vacancyRate = totalWorkforce + openPos > 0 ? Math.round((openPos / (totalWorkforce + openPos)) * 100) : 0;
  const trainingCompletion =
    trainingComplete + trainingIncomplete > 0
      ? Math.round((trainingComplete / (trainingComplete + trainingIncomplete)) * 100)
      : 100;

  const orgCapacity = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          vacancyRate * 0.35 -
          (onboardingInProgress > 5 ? 10 : onboardingInProgress * 1.5) -
          (certificationsExpiring > 0 ? Math.min(15, certificationsExpiring * 2) : 0) -
          (timeOffPending > 8 ? 8 : timeOffPending)
      )
    )
  );

  return {
    version: "build62-workforce",
    generatedAt: new Date().toISOString(),
    kpis: {
      totalEmployees: employees,
      volunteers,
      contractors,
      interns,
      boardMembers: board,
      totalWorkforce,
      openPositions: openPos,
      activeRecruitments,
      newHires,
      trainingIncomplete,
      trainingComplete,
      trainingCompletionPct: trainingCompletion,
      performanceReviews,
      attendanceClockedIn: attendanceToday,
      timeOffRequests: timeOffPending,
      certifications,
      certificationsExpiring,
      onboardingInProgress,
      volunteerHoursYtd,
      organizationalCapacity: orgCapacity,
      vacancyRate,
    },
    capacity: {
      score: orgCapacity,
      vacancyRate,
      staffing: capacity,
      note:
        orgCapacity >= 80
          ? "Workforce capacity is healthy"
          : orgCapacity >= 60
            ? "Workforce capacity needs attention"
            : "Workforce capacity is constrained — prioritize hiring and onboarding",
    },
    platform,
    intelligence,
    payrollTime: payrollTime?.summary ?? null,
    compliance,
    deepLinks: {
      people: "/hq/people",
      employees: "/hq/people?tab=employees",
      volunteers: "/hq/people?tab=volunteers",
      recruitment: "/hq/people?tab=workforce&wf=recruitment",
      onboarding: "/hq/people?tab=onboarding",
      training: "/hq/people?tab=certifications",
      performance: "/hq/people?tab=performance",
      policies: "/hq/policies",
      documents: "/hq/documents",
      grants: "/hq/grants",
      operations: "/hq/operations",
      compliance: "/hq/compliance",
      calendar: "/hq/calendar",
      notifications: "/hq/notifications",
      executive: "/hq",
      payroll: "/hq/payroll",
    },
    personTypeLabels: PERSON_TYPE_LABELS,
  };
}

export async function buildWorkforceRecruitmentCenter() {
  await ensurePeopleTables();
  const db = await getDb();
  const [requisitions, applicants, hiring, positions] = await Promise.all([
    db.all(`
      SELECT r.*, d.name as department_name
      FROM job_requisitions r
      LEFT JOIN departments d ON d.id = r.department_id
      ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.updated_at DESC
    `),
    soft("applicants", () => listJobApplicants(), [] as Awaited<ReturnType<typeof listJobApplicants>>),
    soft("hiring", () => buildHiringPipelineMetrics(), null as Awaited<ReturnType<typeof buildHiringPipelineMetrics>> | null),
    soft("positions", () => listOrgPositions(), [] as Awaited<ReturnType<typeof listOrgPositions>>),
  ]);

  const pipeline = [
    { stage: "requisition", label: "Job Requisitions", count: (requisitions as { status: string }[]).filter((r) => r.status === "open").length },
    { stage: "new", label: "New Applications", count: (hiring?.byStatus as { status: string; count: number }[] | undefined)?.find((s) => s.status === "new")?.count ?? 0 },
    { stage: "interview", label: "Interviews", count: (hiring?.byStatus as { status: string; count: number }[] | undefined)?.find((s) => s.status === "interview")?.count ?? 0 },
    { stage: "offer", label: "Offers", count: await count("SELECT COUNT(*) as c FROM job_applicants WHERE offer_status IN ('extended', 'accepted', 'pending')") },
    { stage: "background", label: "Background Checks", count: await count("SELECT COUNT(*) as c FROM job_applicants WHERE background_status IN ('pending', 'in_progress') OR status = 'background'") },
    { stage: "hired", label: "Hired", count: hiring?.hired ?? 0 },
  ];

  return {
    generatedAt: new Date().toISOString(),
    pipeline,
    requisitions,
    applicants: Array.isArray(applicants) ? applicants.slice(0, 40) : [],
    hiring,
    positions: Array.isArray(positions) ? positions : [],
    workflows: [
      "Create job requisition & position description",
      "Track candidates through interview stages",
      "Capture interview notes & hiring approvals",
      "Issue offer letters & monitor background checks",
      "Hire into People directory with onboarding seed",
    ],
  };
}

export async function createJobRequisition(input: {
  title: string;
  department_id?: string;
  position_id?: string;
  description?: string;
  employment_type?: string;
  openings?: number;
  hiring_manager?: string;
}) {
  await ensurePeopleTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = peopleId();
  await db.run(
    `INSERT INTO job_requisitions (id, title, department_id, position_id, description, employment_type, status, openings, hiring_manager, approval_status, posted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, 'pending', ?, ?, ?)`,
    id,
    input.title,
    input.department_id ?? null,
    input.position_id ?? null,
    input.description ?? null,
    input.employment_type ?? "employee",
    input.openings ?? 1,
    input.hiring_manager ?? null,
    now,
    now,
    now
  );
  return db.get("SELECT * FROM job_requisitions WHERE id = ?", id);
}

export async function updateJobRequisition(id: string, patch: Record<string, unknown>) {
  await ensurePeopleTables();
  const db = await getDb();
  const allowed = ["title", "department_id", "position_id", "description", "employment_type", "status", "openings", "hiring_manager", "approval_status", "closed_at"] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(patch[key]);
    }
  }
  if (!sets.length) return null;
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString(), id);
  await db.run(`UPDATE job_requisitions SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  return db.get("SELECT * FROM job_requisitions WHERE id = ?", id);
}

export async function updateApplicantRecruitment(id: string, patch: Record<string, unknown>) {
  await ensurePeopleTables();
  const db = await getDb();
  const allowed = [
    "status",
    "notes",
    "interview_date",
    "interview_notes",
    "offer_status",
    "background_status",
    "hiring_approval",
    "requisition_id",
    "position_applied",
  ] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(patch[key]);
    }
  }
  if (!sets.length) return null;
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString(), id);
  await db.run(`UPDATE job_applicants SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  return db.get("SELECT * FROM job_applicants WHERE id = ?", id);
}

export async function buildWorkforceOnboardingCenter() {
  await ensurePeopleTables();
  const db = await getDb();
  const people = (await db.all(`
    SELECT DISTINCT p.id, p.first_name, p.last_name, p.email, p.person_type, p.start_date, p.organization_role, d.name as department_name
    FROM people p
    JOIN people_onboarding_items oi ON oi.person_id = p.id
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE p.status = 'active'
    ORDER BY p.start_date DESC
  `)) as Array<Record<string, unknown>>;

  const rows = [];
  for (const p of people) {
    const tasks = (await db.all(
      "SELECT * FROM people_onboarding_items WHERE person_id = ? ORDER BY sort_order",
      p.id
    )) as Array<{ completed: number; task_key: string; task_label: string }>;
    const completed = tasks.filter((t) => t.completed).length;
    const total = tasks.length || 1;
    rows.push({
      personId: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      email: p.email,
      personType: p.person_type,
      startDate: p.start_date,
      role: p.organization_role,
      department: p.department_name,
      completedCount: completed,
      totalCount: total,
      progressPct: Math.round((completed / total) * 100),
      incompleteTasks: tasks.filter((t) => !t.completed).map((t) => t.task_label),
      checklist: tasks,
    });
  }

  const inProgress = rows.filter((r) => r.progressPct < 100);
  const complete = rows.filter((r) => r.progressPct >= 100);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      inProgress: inProgress.length,
      complete: complete.length,
      avgProgress: rows.length ? Math.round(rows.reduce((s, r) => s + r.progressPct, 0) / rows.length) : 100,
    },
    people: rows,
    stages: [
      "Welcome Checklist",
      "Required Documents",
      "Policy Acknowledgments",
      "Handbook Review",
      "Equipment Assignment",
      "Account Provisioning",
      "Orientation",
      "Required Training",
      "Manager Approval",
    ],
  };
}

export async function buildVolunteerManagementCenter() {
  await ensurePeopleTables();
  const db = await getDb();
  const volunteers = (await db.all(`
    SELECT p.*, d.name as department_name
    FROM people p
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE p.person_type = 'volunteer'
    ORDER BY p.last_name, p.first_name
  `)) as Array<Record<string, unknown>>;

  const profiles = [];
  for (const v of volunteers.slice(0, 100)) {
    const [hours, awards, training, certs, bg, schedules, teams] = await Promise.all([
      db.get<{ h: number }>("SELECT COALESCE(SUM(hours), 0) as h FROM volunteer_hours WHERE person_id = ?", v.id),
      db.all("SELECT * FROM volunteer_recognition WHERE person_id = ? ORDER BY award_date DESC LIMIT 5", v.id),
      db.all("SELECT * FROM people_training WHERE person_id = ? ORDER BY created_at DESC LIMIT 5", v.id),
      db.all("SELECT * FROM people_certifications WHERE person_id = ? LIMIT 5", v.id),
      db.all("SELECT * FROM background_checks WHERE person_id = ? ORDER BY created_at DESC LIMIT 3", v.id),
      db.all(
        "SELECT * FROM people_schedules WHERE person_id = ? AND schedule_date >= date('now') ORDER BY schedule_date LIMIT 5",
        v.id
      ),
      db.all("SELECT * FROM people_team_assignments WHERE person_id = ? AND status = 'active'", v.id),
    ]);
    profiles.push({
      id: v.id,
      name: `${v.first_name} ${v.last_name}`,
      email: v.email,
      phone: v.phone,
      status: v.status,
      skills: v.notes,
      department: v.department_name,
      hoursYtd: hours?.h ?? 0,
      recognition: awards,
      training,
      certifications: certs,
      backgroundChecks: bg,
      availability: schedules,
      assignedPrograms: teams,
    });
  }

  const totalHours = (await db.get<{ h: number }>("SELECT COALESCE(SUM(hours), 0) as h FROM volunteer_hours"))?.h ?? 0;
  const awardsCount = await count("SELECT COUNT(*) as c FROM volunteer_recognition");

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      activeVolunteers: volunteers.filter((v) => v.status === "active").length,
      totalVolunteers: volunteers.length,
      totalHoursLogged: totalHours,
      recognitionAwards: awardsCount,
    },
    profiles,
  };
}

export async function logVolunteerHours(input: {
  person_id: string;
  hours: number;
  service_date: string;
  program_name?: string;
  notes?: string;
}) {
  await ensurePeopleTables();
  const db = await getDb();
  const id = peopleId();
  await db.run(
    `INSERT INTO volunteer_hours (id, person_id, program_name, hours, service_date, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.person_id,
    input.program_name ?? null,
    input.hours,
    input.service_date,
    input.notes ?? null,
    new Date().toISOString()
  );
  return db.get("SELECT * FROM volunteer_hours WHERE id = ?", id);
}

export async function addVolunteerRecognition(input: {
  person_id: string;
  award_title: string;
  award_date: string;
  notes?: string;
}) {
  await ensurePeopleTables();
  const db = await getDb();
  const id = peopleId();
  await db.run(
    `INSERT INTO volunteer_recognition (id, person_id, award_title, award_date, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    input.person_id,
    input.award_title,
    input.award_date,
    input.notes ?? null,
    new Date().toISOString()
  );
  return db.get("SELECT * FROM volunteer_recognition WHERE id = ?", id);
}

export async function buildPerformanceManagementCenter() {
  await ensurePeopleTables();
  const db = await getDb();
  const [reviews, goals, improvement] = await Promise.all([
    db.all(`
      SELECT pr.*, p.first_name, p.last_name, p.person_type, p.organization_role, d.name as department_name
      FROM people_performance pr
      JOIN people p ON p.id = pr.person_id
      LEFT JOIN departments d ON d.id = p.department_id
      ORDER BY pr.review_date DESC LIMIT 50
    `),
    db.all(`
      SELECT g.*, p.first_name, p.last_name, d.name as department_name
      FROM people_goals g
      JOIN people p ON p.id = g.person_id
      LEFT JOIN departments d ON d.id = p.department_id
      ORDER BY CASE g.status WHEN 'active' THEN 0 ELSE 1 END, g.due_date ASC LIMIT 50
    `),
    db.all(`
      SELECT pr.*, p.first_name, p.last_name
      FROM people_performance pr
      JOIN people p ON p.id = pr.person_id
      WHERE lower(pr.rating) LIKE '%improve%' OR lower(pr.summary) LIKE '%pip%' OR lower(pr.summary) LIKE '%improvement%'
      ORDER BY pr.review_date DESC LIMIT 20
    `),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      reviewsLastYear: await count("SELECT COUNT(*) as c FROM people_performance WHERE review_date >= date('now', '-365 days')"),
      activeGoals: await count("SELECT COUNT(*) as c FROM people_goals WHERE status = 'active'"),
      recognitionNotes: await count(
        "SELECT COUNT(*) as c FROM people_performance WHERE lower(rating) LIKE '%exceed%' OR lower(summary) LIKE '%recogni%'"
      ),
    },
    goals,
    reviews,
    improvementPlans: improvement,
    coachingFocus: [
      "Goals & objectives tracking",
      "Performance reviews",
      "Coaching notes in review summaries",
      "Recognition via high ratings",
      "Improvement plans",
      "Promotion & career development notes",
    ],
  };
}

export async function createPeopleGoal(input: {
  person_id: string;
  title: string;
  objective?: string;
  due_date?: string;
  progress_pct?: number;
}) {
  await ensurePeopleTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = peopleId();
  await db.run(
    `INSERT INTO people_goals (id, person_id, title, objective, status, due_date, progress_pct, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    id,
    input.person_id,
    input.title,
    input.objective ?? null,
    input.due_date ?? null,
    input.progress_pct ?? 0,
    now,
    now
  );
  return db.get("SELECT * FROM people_goals WHERE id = ?", id);
}

export async function updatePeopleGoal(id: string, patch: Record<string, unknown>) {
  await ensurePeopleTables();
  const db = await getDb();
  const allowed = ["title", "objective", "status", "due_date", "progress_pct"] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(patch[key]);
    }
  }
  if (!sets.length) return null;
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString(), id);
  await db.run(`UPDATE people_goals SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  return db.get("SELECT * FROM people_goals WHERE id = ?", id);
}

export async function buildTrainingCenter() {
  await ensurePeopleTables();
  const db = await getDb();
  const [required, certifications, expiring, completed, complianceLike] = await Promise.all([
    db.all(`
      SELECT t.*, p.first_name, p.last_name, p.person_type
      FROM people_training t JOIN people p ON p.id = t.person_id
      WHERE t.status IN ('scheduled', 'in_progress', 'required')
      ORDER BY t.created_at DESC LIMIT 40
    `),
    db.all(`
      SELECT c.*, p.first_name, p.last_name
      FROM people_certifications c JOIN people p ON p.id = c.person_id
      WHERE p.status = 'active'
      ORDER BY CASE WHEN c.expiry_date IS NULL THEN 1 ELSE 0 END, c.expiry_date ASC LIMIT 40
    `),
    db.all(`
      SELECT c.*, p.first_name, p.last_name
      FROM people_certifications c JOIN people p ON p.id = c.person_id
      WHERE c.expiry_date IS NOT NULL AND c.expiry_date BETWEEN date('now') AND date('now', '+90 days')
      ORDER BY c.expiry_date ASC LIMIT 30
    `),
    count("SELECT COUNT(*) as c FROM people_training WHERE status = 'completed'"),
    db.all(`
      SELECT t.*, p.first_name, p.last_name
      FROM people_training t JOIN people p ON p.id = t.person_id
      WHERE lower(t.title) LIKE '%compliance%' OR lower(t.title) LIKE '%safety%'
         OR lower(t.title) LIKE '%cyber%' OR lower(t.title) LIKE '%security%'
         OR lower(t.title) LIKE '%aura%' OR lower(t.title) LIKE '%ai %'
      ORDER BY t.created_at DESC LIMIT 30
    `),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      requiredOpen: (required as unknown[]).length,
      certifications: (certifications as unknown[]).length,
      expiringSoon: (expiring as unknown[]).length,
      completedTotal: completed,
      complianceSafetyAi: (complianceLike as unknown[]).length,
    },
    requiredTraining: required,
    certifications,
    expirationWatch: expiring,
    complianceSafetyCyberAi: complianceLike,
    catalogHints: [
      "Compliance Training",
      "Safety Training",
      "AI & Cybersecurity Awareness",
      "Continuing Education",
      "Required Certifications",
    ],
  };
}

export async function buildWorkforceAnalytics() {
  await ensurePeopleTables();
  const [dashboard, intelligence, platform, hiring, policyReviews] = await Promise.all([
    buildWorkforceDashboard(),
    soft("intel", () => buildWorkforceExecutiveIntelligence(), null as Awaited<ReturnType<typeof buildWorkforceExecutiveIntelligence>> | null),
    soft("platform", () => buildWorkforceIntelligencePlatform(), null as Awaited<ReturnType<typeof buildWorkforceIntelligencePlatform>> | null),
    soft("hiring", () => buildHiringPipelineMetrics(), null as Awaited<ReturnType<typeof buildHiringPipelineMetrics>> | null),
    soft("policies", () => listReviewReminders(), [] as Awaited<ReturnType<typeof listReviewReminders>>),
  ]);

  const k = dashboard.kpis;
  const retentionProxy = Math.max(0, 100 - Math.min(40, Math.round((k.timeOffRequests + k.onboardingInProgress) / Math.max(1, k.totalEmployees) * 20)));
  const turnoverProxy = Math.max(0, Math.min(40, 100 - retentionProxy - 40));

  return {
    generatedAt: new Date().toISOString(),
    staffingLevels: {
      employees: k.totalEmployees,
      volunteers: k.volunteers,
      contractors: k.contractors,
      interns: k.interns,
      board: k.boardMembers,
      total: k.totalWorkforce,
    },
    vacancyRates: { openPositions: k.openPositions, vacancyRate: k.vacancyRate },
    retention: { score: retentionProxy, note: "Proxy score from leave pressure and onboarding load" },
    turnover: { score: turnoverProxy, note: "Inverse retention proxy — refine with exit interviews in later builds" },
    volunteerEngagement: {
      active: k.volunteers,
      hoursYtd: k.volunteerHoursYtd,
    },
    trainingCompletion: { pct: k.trainingCompletionPct, incomplete: k.trainingIncomplete, complete: k.trainingComplete },
    performanceTrends: {
      reviewsLastYear: k.performanceReviews,
      intelligence: intelligence?.departmentPerformance ?? null,
    },
    organizationalCapacity: dashboard.capacity,
    hiringPipeline: hiring,
    policyReviewsDue: Array.isArray(policyReviews) ? policyReviews.slice(0, 8) : [],
    executiveIntelligence: intelligence,
    platform,
  };
}

export async function buildWorkforceExecutiveReport() {
  const [dashboard, analytics, recruitment, onboarding, volunteers, performance, training] = await Promise.all([
    buildWorkforceDashboard(),
    buildWorkforceAnalytics(),
    buildWorkforceRecruitmentCenter(),
    buildWorkforceOnboardingCenter(),
    buildVolunteerManagementCenter(),
    buildPerformanceManagementCenter(),
    buildTrainingCenter(),
  ]);

  return {
    title: "IFCDC Workforce & HR Executive Report",
    generatedAt: new Date().toISOString(),
    dashboard: dashboard.kpis,
    capacity: dashboard.capacity,
    analytics,
    recruitment: { pipeline: recruitment.pipeline, openRequisitions: recruitment.pipeline[0]?.count },
    onboarding: onboarding.summary,
    volunteers: volunteers.summary,
    performance: performance.summary,
    training: training.summary,
    integrations: dashboard.deepLinks,
  };
}

export async function askWorkforceFoundation(question: string) {
  return auraWorkforceIntelligenceAdvisor({ question });
}

/** Re-export ensure for callers that only import foundation */
export async function ensureWorkforceFoundationReady() {
  await ensurePeopleTables();
}
