import { getDb } from "../db";
import crypto from "crypto";

export function peopleId() {
  return crypto.randomUUID();
}

export const PERSON_TYPES = [
  "employee",
  "volunteer",
  "board_member",
  "contractor",
  "mentor",
  "program_participant",
  "barber",
  "client",
  "donor",
  "grant_manager",
] as const;

export type PersonType = (typeof PERSON_TYPES)[number];

export const PERSON_TYPE_LABELS: Record<PersonType, string> = {
  employee: "Employee",
  volunteer: "Volunteer",
  board_member: "Board Member",
  contractor: "Contractor",
  mentor: "Mentor",
  program_participant: "Program Participant",
  barber: "Barber",
  client: "Client",
  donor: "Donor",
  grant_manager: "Grant Manager",
};

export async function ensurePeopleTables(): Promise<void> {
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE,
      parent_id TEXT,
      head_person_id TEXT,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      person_type TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      profile_photo_url TEXT,
      organization_role TEXT,
      enterprise_role TEXT,
      department_id TEXT,
      status TEXT DEFAULT 'active',
      contact_address TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      location TEXT,
      start_date TEXT,
      end_date TEXT,
      pay_rate REAL,
      pay_currency TEXT DEFAULT 'USD',
      pay_type TEXT,
      payroll_status TEXT,
      linked_user_id TEXT,
      linked_external_id TEXT,
      source_app TEXT DEFAULT 'hq',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (department_id) REFERENCES departments(id)
    );

    CREATE TABLE IF NOT EXISTS people_documents (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      name TEXT NOT NULL,
      doc_type TEXT DEFAULT 'personnel',
      file_url TEXT,
      notes TEXT,
      uploaded_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS people_certifications (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      name TEXT NOT NULL,
      issuer TEXT,
      issued_date TEXT,
      expiry_date TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS people_training (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      title TEXT NOT NULL,
      provider TEXT,
      completed_date TEXT,
      status TEXT DEFAULT 'scheduled',
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS people_performance (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      review_date TEXT NOT NULL,
      reviewer TEXT,
      rating TEXT,
      summary TEXT,
      goals TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS people_schedules (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      title TEXT NOT NULL,
      schedule_date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      location TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS time_clock_entries (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      clock_in TEXT NOT NULL,
      clock_out TEXT,
      hours REAL,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS people_activity (
      id TEXT PRIMARY KEY,
      person_id TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      actor_id TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      leave_type TEXT DEFAULT 'pto',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      hours REAL,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      reviewer_email TEXT,
      reviewed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS background_checks (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      check_type TEXT DEFAULT 'criminal',
      provider TEXT,
      status TEXT DEFAULT 'pending',
      initiated_date TEXT,
      completed_date TEXT,
      result TEXT,
      expiry_date TEXT,
      reference_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS people_onboarding_items (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      task_key TEXT NOT NULL,
      task_label TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      completed_at TEXT,
      completed_by TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS people_signatures (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      document_title TEXT NOT NULL,
      agreement_type TEXT DEFAULT 'policy',
      signer_name TEXT NOT NULL,
      signature_text TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      witness_email TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_people_signatures_person ON people_signatures(person_id);

    CREATE INDEX IF NOT EXISTS idx_leave_person ON leave_requests(person_id);
    CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);
    CREATE INDEX IF NOT EXISTS idx_bg_person ON background_checks(person_id);
    CREATE INDEX IF NOT EXISTS idx_onboarding_person ON people_onboarding_items(person_id);
    CREATE INDEX IF NOT EXISTS idx_people_type ON people(person_type);
    CREATE INDEX IF NOT EXISTS idx_people_email ON people(email);
    CREATE INDEX IF NOT EXISTS idx_people_department ON people(department_id);
    CREATE INDEX IF NOT EXISTS idx_people_status ON people(status);

    CREATE TABLE IF NOT EXISTS people_incidents (
      id TEXT PRIMARY KEY,
      person_id TEXT,
      reported_by_person_id TEXT,
      incident_date TEXT NOT NULL,
      incident_type TEXT DEFAULT 'general',
      severity TEXT DEFAULT 'low',
      location TEXT,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      resolution TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_incidents_status ON people_incidents(status);
    CREATE INDEX IF NOT EXISTS idx_incidents_date ON people_incidents(incident_date);
  `);

  await ensurePeoplePhase3Tables(db);

  const deptCount = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM departments");
  if (deptCount && deptCount.c === 0) {
    const now = new Date().toISOString();
    const depts = [
      { name: "Executive Leadership", code: "EXEC" },
      { name: "Human Resources", code: "HR" },
      { name: "Programs & Services", code: "PROGRAMS" },
      { name: "Barbershop Operations", code: "BARBERS" },
      { name: "Media & Radio", code: "MEDIA" },
      { name: "Finance & Grants", code: "FINANCE" },
      { name: "Technology", code: "TECH" },
      { name: "Community Outreach", code: "OUTREACH" },
    ];
    for (const d of depts) {
      await db.run(
        `INSERT INTO departments (id, name, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        peopleId(), d.name, d.code, now, now
      );
    }
  }

  await migrateEmployeesToPeople(db);
}

async function ensurePeoplePhase3Tables(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  for (const [col, type] of [
    ["reports_to_person_id", "TEXT"],
    ["position_id", "TEXT"],
  ] as const) {
    try { await db.exec(`ALTER TABLE people ADD COLUMN ${col} ${type}`); } catch { /* exists */ }
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS org_positions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      department_id TEXT,
      level INTEGER DEFAULT 1,
      description TEXT,
      permissions_json TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (department_id) REFERENCES departments(id)
    );

    CREATE TABLE IF NOT EXISTS job_applicants (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      position_applied TEXT,
      department_id TEXT,
      resume_url TEXT,
      status TEXT DEFAULT 'new',
      source TEXT DEFAULT 'hq',
      notes TEXT,
      applied_at TEXT NOT NULL,
      reviewed_at TEXT,
      hired_person_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pto_balances (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL UNIQUE,
      pto_hours REAL DEFAULT 80,
      sick_hours REAL DEFAULT 40,
      used_pto REAL DEFAULT 0,
      used_sick REAL DEFAULT 0,
      fiscal_year TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS contractor_payments (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      payment_date TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      grant_award_id TEXT,
      invoice_ref TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_positions_dept ON org_positions(department_id);
    CREATE INDEX IF NOT EXISTS idx_applicants_status ON job_applicants(status);
    CREATE INDEX IF NOT EXISTS idx_contractor_pay_person ON contractor_payments(person_id);
    CREATE INDEX IF NOT EXISTS idx_people_reports_to ON people(reports_to_person_id);
  `);

  const posCount = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM org_positions");
  if (posCount && posCount.c === 0) {
    const now = new Date().toISOString();
    const depts = (await db.all("SELECT id, code FROM departments")) as { id: string; code: string }[];
    const byCode = Object.fromEntries(depts.map((d) => [d.code, d.id]));
    const positions = [
      { title: "Executive Director", code: "EXEC", level: 1 },
      { title: "HR Director", code: "HR", level: 2 },
      { title: "Program Director", code: "PROGRAMS", level: 2 },
      { title: "Finance Director", code: "FINANCE", level: 2 },
      { title: "Program Coordinator", code: "PROGRAMS", level: 3 },
      { title: "Volunteer Coordinator", code: "OUTREACH", level: 3 },
    ];
    for (const p of positions) {
      await db.run(
        `INSERT INTO org_positions (id, title, department_id, level, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        peopleId(), p.title, byCode[p.code] ?? null, p.level, now, now
      );
    }
  }
}

async function migrateEmployeesToPeople(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const employees = (await db.all("SELECT * FROM employees")) as Record<string, unknown>[];
  for (const e of employees) {
    const existing = await db.get("SELECT id FROM people WHERE email = ?", e.email);
    if (existing) continue;

    const now = new Date().toISOString();
    const personType = mapRoleToPersonType(String(e.role ?? "employee"));

    let deptId: string | null = null;
    const deptCode = mapRoleToDepartment(String(e.role ?? ""));
    if (deptCode) {
      const dept = await db.get<{ id: string }>("SELECT id FROM departments WHERE code = ?", deptCode);
      deptId = dept?.id ?? null;
    }

    await db.run(
      `INSERT INTO people (id, person_type, first_name, last_name, email, phone, organization_role,
       department_id, status, location, start_date, notes, pay_rate, pay_currency, pay_type,
       payroll_status, source_app, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hq', ?, ?)`,
      e.id ?? peopleId(),
      personType,
      e.first_name,
      e.last_name,
      e.email,
      e.phone ?? null,
      e.role,
      deptId,
      e.status ?? "active",
      e.location ?? null,
      e.start_date ?? null,
      e.notes ?? null,
      e.pay_rate ?? null,
      e.pay_currency ?? "USD",
      e.pay_type ?? null,
      e.pay_rate ? "active" : null,
      e.created_at ?? now,
      now
    );
  }
}

function mapRoleToPersonType(role: string): PersonType {
  const map: Record<string, PersonType> = {
    barber: "barber",
    radio_host: "employee",
    radio: "employee",
    program_staff: "employee",
    volunteer: "volunteer",
    admin: "employee",
    grant_manager: "grant_manager",
    donor: "donor",
    client: "client",
    mentor: "mentor",
    contractor: "contractor",
  };
  return map[role] ?? "employee";
}

function mapRoleToDepartment(role: string): string | null {
  const map: Record<string, string> = {
    barber: "BARBERS",
    radio_host: "MEDIA",
    radio: "MEDIA",
    program_staff: "PROGRAMS",
    admin: "EXEC",
    grant_manager: "FINANCE",
  };
  return map[role] ?? "PROGRAMS";
}

export const DEFAULT_ONBOARDING_TASKS = [
  { key: "welcome", label: "Welcome email & orientation packet", order: 1 },
  { key: "i9", label: "I-9 & employment eligibility documents", order: 2 },
  { key: "direct_deposit", label: "Direct deposit & payroll setup", order: 3 },
  { key: "handbook", label: "Employee handbook acknowledgment", order: 4 },
  { key: "background_check", label: "Background check initiated", order: 5 },
  { key: "equipment", label: "Equipment & access provisioning", order: 6 },
  { key: "department_intro", label: "Department introduction meeting", order: 7 },
  { key: "training", label: "Mandatory compliance training", order: 8 },
] as const;

export async function seedOnboardingForPerson(personId: string): Promise<void> {
  const db = await getDb();
  const existing = await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM people_onboarding_items WHERE person_id = ?", personId
  );
  if (existing && existing.c > 0) return;
  const now = new Date().toISOString();
  for (const task of DEFAULT_ONBOARDING_TASKS) {
    await db.run(
      `INSERT INTO people_onboarding_items (id, person_id, task_key, task_label, sort_order, completed, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      peopleId(), personId, task.key, task.label, task.order, now
    );
  }
}

export function formatPerson(row: Record<string, unknown>) {
  return {
    id: row.id,
    personType: row.person_type,
    personTypeLabel: PERSON_TYPE_LABELS[row.person_type as PersonType] ?? row.person_type,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: `${row.first_name} ${row.last_name}`,
    email: row.email,
    phone: row.phone,
    profilePhotoUrl: row.profile_photo_url,
    organizationRole: row.organization_role,
    enterpriseRole: row.enterprise_role,
    departmentId: row.department_id,
    departmentName: row.department_name ?? null,
    reportsToPersonId: row.reports_to_person_id ?? null,
    positionId: row.position_id ?? null,
    status: row.status,
    contactAddress: row.contact_address,
    emergencyContact: row.emergency_contact,
    emergencyPhone: row.emergency_phone,
    location: row.location,
    startDate: row.start_date,
    endDate: row.end_date,
    payRate: row.pay_rate,
    payCurrency: row.pay_currency,
    payType: row.pay_type,
    payrollStatus: row.payroll_status,
    linkedUserId: row.linked_user_id,
    linkedExternalId: row.linked_external_id,
    sourceApp: row.source_app,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function logPeopleActivity(
  personId: string | null,
  action: string,
  detail: string,
  actor?: { id?: string; email?: string }
): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO people_activity (id, person_id, action, detail, actor_id, actor_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    peopleId(), personId, action, detail, actor?.id ?? null, actor?.email ?? null, new Date().toISOString()
  );
}
