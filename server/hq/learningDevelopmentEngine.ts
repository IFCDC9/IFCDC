/**
 * IFCDC Learning & Development Center
 * Courses, role learning paths, quizzes, certificates, acknowledgments,
 * and grant-funded professional development cost tracking.
 * Freeze-safe: server/hq only — links to Policy Center + People training.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { ensurePolicyGovernanceTables, policyCategoryLabel } from "./policyGovernanceEngine";
import { ensurePeopleTables, peopleId } from "./peopleSchema";

export function learningId() {
  return crypto.randomUUID();
}

export async function ensureLearningDevelopmentTables(): Promise<void> {
  await ensurePeopleTables();
  await ensurePolicyGovernanceTables();
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_learning_courses (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      source_type TEXT DEFAULT 'ifcdc',
      source_url TEXT,
      policy_id TEXT,
      policy_category TEXT,
      duration_minutes INTEGER DEFAULT 30,
      quiz_required INTEGER DEFAULT 1,
      passing_score INTEGER DEFAULT 80,
      certificate_enabled INTEGER DEFAULT 1,
      grant_eligible INTEGER DEFAULT 1,
      status TEXT DEFAULT 'published',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_learning_paths (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      role_key TEXT NOT NULL,
      description TEXT,
      required INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_learning_path_courses (
      id TEXT PRIMARY KEY,
      path_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      required INTEGER DEFAULT 1,
      UNIQUE(path_id, course_id)
    );

    CREATE TABLE IF NOT EXISTS hq_learning_enrollments (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      person_id TEXT,
      person_name TEXT,
      person_role TEXT,
      status TEXT DEFAULT 'assigned',
      progress_pct INTEGER DEFAULT 0,
      quiz_score INTEGER,
      completed_at TEXT,
      acknowledged_at TEXT,
      certificate_id TEXT,
      assigned_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_learning_certificates (
      id TEXT PRIMARY KEY,
      enrollment_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      person_name TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT,
      certificate_code TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_learning_pd_costs (
      id TEXT PRIMARY KEY,
      course_id TEXT,
      person_id TEXT,
      person_name TEXT,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT DEFAULT 'USD',
      grant_award_id TEXT,
      grant_eligible INTEGER DEFAULT 1,
      incurred_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learn_courses_policy ON hq_learning_courses(policy_id);
    CREATE INDEX IF NOT EXISTS idx_learn_enroll_course ON hq_learning_enrollments(course_id);
    CREATE INDEX IF NOT EXISTS idx_learn_enroll_person ON hq_learning_enrollments(person_id);
    CREATE INDEX IF NOT EXISTS idx_learn_pd_grant ON hq_learning_pd_costs(grant_award_id);
  `);

  await seedLearningCatalogIfNeeded();
}

async function seedLearningCatalogIfNeeded(): Promise<void> {
  const db = await getDb();
  const count = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_learning_courses"))?.c ?? 0;
  if (count > 0) return;

  const now = new Date().toISOString();
  const courseDefs = [
    { title: "IFCDC Code of Ethics Orientation", cat: "code_of_ethics", source: "ifcdc", minutes: 25 },
    { title: "Conflict of Interest Disclosure Training", cat: "conflict_of_interest", source: "ifcdc", minutes: 20 },
    { title: "Whistleblower Protection Awareness", cat: "whistleblower", source: "ifcdc", minutes: 20 },
    { title: "Cybersecurity & Phishing Awareness", cat: "cybersecurity", source: "external", minutes: 45 },
    { title: "AURA AI Responsible Use", cat: "ai_governance", source: "ifcdc", minutes: 30 },
    { title: "Privacy & Confidentiality Essentials", cat: "privacy_confidentiality", source: "ifcdc", minutes: 35 },
    { title: "Grants Compliance Basics", cat: "grants_management", source: "ifcdc", minutes: 40 },
    { title: "Youth Protection Safeguarding", cat: "youth_programs", source: "ifcdc", minutes: 50 },
    { title: "Volunteer Orientation Essentials", cat: "volunteer_management", source: "ifcdc", minutes: 30 },
    { title: "Emergency Operations Awareness", cat: "emergency_operations", source: "ifcdc", minutes: 25 },
    { title: "Finance Controls for Budget Owners", cat: "finance_accounting", source: "ifcdc", minutes: 40 },
    { title: "Software Development Standards Overview", cat: "software_standards", source: "ifcdc", minutes: 35 },
  ];

  const courseIds: string[] = [];
  for (const c of courseDefs) {
    const id = learningId();
    courseIds.push(id);
    const policy = await db.get<{ id: string }>(
      "SELECT id FROM hq_policies WHERE category = ? AND approval_status = 'published' ORDER BY policy_number ASC LIMIT 1",
      c.cat
    );
    await db.run(
      `INSERT INTO hq_learning_courses (
        id, title, description, source_type, source_url, policy_id, policy_category,
        duration_minutes, quiz_required, passing_score, certificate_enabled, grant_eligible,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 80, 1, 1, 'published', ?, ?)`,
      id,
      c.title,
      `Foundational training linked to ${policyCategoryLabel(c.cat)}. IFCDC-produced content preferred; external modules used where high quality.`,
      c.source,
      c.source === "external" ? "https://training.external.placeholder/ifcdc" : null,
      policy?.id ?? null,
      c.cat,
      c.minutes,
      now,
      now
    );
  }

  const paths = [
    { role: "employee", title: "Required Learning — Employees", courses: [0, 1, 2, 3, 4, 5] },
    { role: "volunteer", title: "Required Learning — Volunteers", courses: [0, 5, 8, 7] },
    { role: "board_member", title: "Required Learning — Board Members", courses: [0, 1, 2, 5] },
    { role: "manager", title: "Required Learning — Managers", courses: [0, 1, 2, 3, 4, 5, 10] },
    { role: "grant_manager", title: "Required Learning — Grant Managers", courses: [0, 5, 6, 10] },
    { role: "contractor", title: "Required Learning — Contractors", courses: [0, 3, 5] },
  ];

  for (const p of paths) {
    const pathId = learningId();
    await db.run(
      `INSERT INTO hq_learning_paths (id, title, role_key, description, required, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'active', ?, ?)`,
      pathId,
      p.title,
      p.role,
      `Role-based learning path for ${p.role.replace("_", " ")} — policy acknowledgments and competency.`,
      now,
      now
    );
    for (let order = 0; order < p.courses.length; order++) {
      const idx = p.courses[order];
      await db.run(
        `INSERT INTO hq_learning_path_courses (id, path_id, course_id, sort_order, required) VALUES (?, ?, ?, ?, 1)`,
        learningId(),
        pathId,
        courseIds[idx],
        order + 1
      );
    }
  }
}

export async function buildLearningDashboard() {
  await ensureLearningDevelopmentTables();
  const db = await getDb();
  const [courses, paths, enrollments, completed, certificates, pdSpend] = await Promise.all([
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_learning_courses WHERE status = 'published'"),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_learning_paths WHERE status = 'active'"),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_learning_enrollments"),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_learning_enrollments WHERE status = 'completed'"),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_learning_certificates"),
    db.get<{ c: number }>("SELECT COALESCE(SUM(amount_cents), 0) as c FROM hq_learning_pd_costs WHERE grant_eligible = 1"),
  ]);

  return {
    version: "learning-development-v1",
    generatedAt: new Date().toISOString(),
    courses: courses?.c ?? 0,
    learningPaths: paths?.c ?? 0,
    enrollments: enrollments?.c ?? 0,
    completed: completed?.c ?? 0,
    certificates: certificates?.c ?? 0,
    grantEligiblePdSpendCents: pdSpend?.c ?? 0,
    completionPct: (enrollments?.c ?? 0) > 0 ? Math.round(((completed?.c ?? 0) / (enrollments?.c ?? 1)) * 100) : 0,
    deepLinks: {
      policies: "/hq/policies",
      peopleTraining: "/hq/people?tab=certifications",
      grants: "/hq/grants",
      documents: "/hq/documents",
    },
  };
}

export async function listLearningCourses() {
  await ensureLearningDevelopmentTables();
  const db = await getDb();
  return db.all(`
    SELECT c.*, p.title as policy_title, p.policy_number
    FROM hq_learning_courses c
    LEFT JOIN hq_policies p ON p.id = c.policy_id
    WHERE c.status != 'archived'
    ORDER BY c.title ASC
  `);
}

export async function listLearningPaths() {
  await ensureLearningDevelopmentTables();
  const db = await getDb();
  const paths = (await db.all("SELECT * FROM hq_learning_paths WHERE status = 'active' ORDER BY role_key")) as Array<Record<string, unknown>>;
  const out = [];
  for (const path of paths) {
    const courses = await db.all(
      `SELECT pc.sort_order, pc.required, c.*
       FROM hq_learning_path_courses pc
       JOIN hq_learning_courses c ON c.id = pc.course_id
       WHERE pc.path_id = ?
       ORDER BY pc.sort_order`,
      path.id
    );
    out.push({ ...path, courses });
  }
  return out;
}

export async function listEnrollments(opts?: { person_id?: string; course_id?: string }) {
  await ensureLearningDevelopmentTables();
  const db = await getDb();
  let sql = `
    SELECT e.*, c.title as course_title, c.policy_category
    FROM hq_learning_enrollments e
    JOIN hq_learning_courses c ON c.id = e.course_id
    WHERE 1=1`;
  const params: string[] = [];
  if (opts?.person_id) {
    sql += " AND e.person_id = ?";
    params.push(opts.person_id);
  }
  if (opts?.course_id) {
    sql += " AND e.course_id = ?";
    params.push(opts.course_id);
  }
  sql += " ORDER BY e.updated_at DESC LIMIT 200";
  return db.all(sql, ...params);
}

export async function assignCourse(input: {
  course_id: string;
  person_id?: string;
  person_name: string;
  person_role?: string;
  assigned_by?: string;
}) {
  await ensureLearningDevelopmentTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = learningId();
  await db.run(
    `INSERT INTO hq_learning_enrollments (
      id, course_id, person_id, person_name, person_role, status, progress_pct, assigned_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'assigned', 0, ?, ?, ?)`,
    id,
    input.course_id,
    input.person_id ?? null,
    input.person_name,
    input.person_role ?? "employee",
    input.assigned_by ?? null,
    now,
    now
  );
  return db.get("SELECT * FROM hq_learning_enrollments WHERE id = ?", id);
}

export async function completeEnrollment(
  enrollmentId: string,
  opts?: { quiz_score?: number; acknowledge?: boolean }
) {
  await ensureLearningDevelopmentTables();
  const db = await getDb();
  const enrollment = (await db.get("SELECT * FROM hq_learning_enrollments WHERE id = ?", enrollmentId)) as Record<string, unknown> | undefined;
  if (!enrollment) throw new Error("Enrollment not found");
  const course = (await db.get("SELECT * FROM hq_learning_courses WHERE id = ?", enrollment.course_id)) as Record<string, unknown> | undefined;
  if (!course) throw new Error("Course not found");

  const score = opts?.quiz_score ?? 100;
  const passing = Number(course.passing_score ?? 80);
  if (course.quiz_required && score < passing) {
    const now = new Date().toISOString();
    await db.run(
      `UPDATE hq_learning_enrollments SET status = 'failed_quiz', quiz_score = ?, progress_pct = 90, updated_at = ? WHERE id = ?`,
      score,
      now,
      enrollmentId
    );
    return { enrollment: await db.get("SELECT * FROM hq_learning_enrollments WHERE id = ?", enrollmentId), passed: false };
  }

  const now = new Date().toISOString();
  let certificateId: string | null = null;
  if (course.certificate_enabled) {
    certificateId = learningId();
    const code = `IFCDC-LD-${String(certificateId).slice(0, 8).toUpperCase()}`;
    await db.run(
      `INSERT INTO hq_learning_certificates (id, enrollment_id, course_id, person_name, issued_at, certificate_code)
       VALUES (?, ?, ?, ?, ?, ?)`,
      certificateId,
      enrollmentId,
      enrollment.course_id,
      enrollment.person_name,
      now,
      code
    );
  }

  await db.run(
    `UPDATE hq_learning_enrollments SET
      status = 'completed', quiz_score = ?, progress_pct = 100, completed_at = ?,
      acknowledged_at = ?, certificate_id = ?, updated_at = ?
     WHERE id = ?`,
    score,
    now,
    opts?.acknowledge === false ? null : now,
    certificateId,
    now,
    enrollmentId
  );

  // Mirror completion into people_training when person linked
  if (enrollment.person_id) {
    try {
      await db.run(
        `INSERT INTO people_training (id, person_id, title, provider, completed_date, status, notes, created_at)
         VALUES (?, ?, ?, 'IFCDC Learning & Development', ?, 'completed', ?, ?)`,
        peopleId(),
        enrollment.person_id,
        course.title,
        now.slice(0, 10),
        `Linked course ${course.id}; certificate ${certificateId ?? "n/a"}`,
        now
      );
    } catch {
      /* people_training insert optional */
    }
  }

  return {
    enrollment: await db.get("SELECT * FROM hq_learning_enrollments WHERE id = ?", enrollmentId),
    certificate: certificateId ? await db.get("SELECT * FROM hq_learning_certificates WHERE id = ?", certificateId) : null,
    passed: true,
  };
}

export async function listCertificates() {
  await ensureLearningDevelopmentTables();
  const db = await getDb();
  return db.all(`
    SELECT cert.*, c.title as course_title
    FROM hq_learning_certificates cert
    JOIN hq_learning_courses c ON c.id = cert.course_id
    ORDER BY cert.issued_at DESC LIMIT 100
  `);
}

export async function logProfessionalDevelopmentCost(input: {
  course_id?: string;
  person_id?: string;
  person_name?: string;
  description: string;
  amount_cents: number;
  grant_award_id?: string;
  grant_eligible?: boolean;
  incurred_date: string;
  notes?: string;
}) {
  await ensureLearningDevelopmentTables();
  const db = await getDb();
  const id = learningId();
  await db.run(
    `INSERT INTO hq_learning_pd_costs (
      id, course_id, person_id, person_name, description, amount_cents, grant_award_id, grant_eligible, incurred_date, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.course_id ?? null,
    input.person_id ?? null,
    input.person_name ?? null,
    input.description,
    input.amount_cents,
    input.grant_award_id ?? null,
    input.grant_eligible === false ? 0 : 1,
    input.incurred_date,
    input.notes ?? null,
    new Date().toISOString()
  );
  return db.get("SELECT * FROM hq_learning_pd_costs WHERE id = ?", id);
}

export async function listProfessionalDevelopmentCosts() {
  await ensureLearningDevelopmentTables();
  const db = await getDb();
  return db.all("SELECT * FROM hq_learning_pd_costs ORDER BY incurred_date DESC LIMIT 100");
}

export async function createLearningCourse(input: {
  title: string;
  description?: string;
  source_type?: string;
  source_url?: string;
  policy_id?: string;
  policy_category?: string;
  duration_minutes?: number;
  grant_eligible?: boolean;
}) {
  await ensureLearningDevelopmentTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = learningId();
  await db.run(
    `INSERT INTO hq_learning_courses (
      id, title, description, source_type, source_url, policy_id, policy_category,
      duration_minutes, quiz_required, passing_score, certificate_enabled, grant_eligible,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 80, 1, ?, 'published', ?, ?)`,
    id,
    input.title,
    input.description ?? "",
    input.source_type ?? "ifcdc",
    input.source_url ?? null,
    input.policy_id ?? null,
    input.policy_category ?? null,
    input.duration_minutes ?? 30,
    input.grant_eligible === false ? 0 : 1,
    now,
    now
  );
  return db.get("SELECT * FROM hq_learning_courses WHERE id = ?", id);
}

export async function linkCourseToPolicy(courseId: string, policyId: string) {
  await ensureLearningDevelopmentTables();
  const db = await getDb();
  const policy = await db.get<{ category: string }>("SELECT category FROM hq_policies WHERE id = ?", policyId);
  await db.run(
    `UPDATE hq_learning_courses SET policy_id = ?, policy_category = ?, updated_at = ? WHERE id = ?`,
    policyId,
    policy?.category ?? null,
    new Date().toISOString(),
    courseId
  );
  return db.get("SELECT * FROM hq_learning_courses WHERE id = ?", courseId);
}
