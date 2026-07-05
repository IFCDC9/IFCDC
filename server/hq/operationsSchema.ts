import { getDb } from "../db";
import crypto from "crypto";

export function opsId() {
  return crypto.randomUUID();
}

export async function ensureOperationsTables(): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS housing_units (
      id TEXT PRIMARY KEY, address TEXT NOT NULL, unit_type TEXT DEFAULT 'apartment',
      status TEXT DEFAULT 'available', capacity INTEGER DEFAULT 1, monthly_rent REAL DEFAULT 0,
      program_id TEXT, notes TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS housing_applications (
      id TEXT PRIMARY KEY, person_id TEXT, unit_id TEXT, status TEXT DEFAULT 'pending',
      applied_at TEXT NOT NULL, case_manager_id TEXT, notes TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS housing_placements (
      id TEXT PRIMARY KEY, application_id TEXT, unit_id TEXT, person_id TEXT,
      move_in_date TEXT, move_out_date TEXT, status TEXT DEFAULT 'active', created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scholarship_programs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, amount REAL DEFAULT 0, deadline TEXT,
      status TEXT DEFAULT 'open', requirements TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scholarship_applications (
      id TEXT PRIMARY KEY, program_id TEXT, person_id TEXT, status TEXT DEFAULT 'submitted',
      amount_requested REAL, amount_awarded REAL, submitted_at TEXT, notes TEXT, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_content (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content_type TEXT DEFAULT 'article',
      channel TEXT DEFAULT 'web', status TEXT DEFAULT 'draft', scheduled_at TEXT,
      published_at TEXT, author_person_id TEXT, description TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media_broadcasts (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, platform TEXT DEFAULT 'radio',
      scheduled_at TEXT, duration_min INTEGER DEFAULT 60, status TEXT DEFAULT 'scheduled', created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_documents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT DEFAULT 'general',
      file_url TEXT, version INTEGER DEFAULT 1, person_id TEXT, grant_id TEXT,
      department_id TEXT, access_level TEXT DEFAULT 'internal', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT DEFAULT 'equipment',
      asset_tag TEXT, location TEXT, assigned_person_id TEXT, facility_id TEXT,
      value_cents INTEGER DEFAULT 0, status TEXT DEFAULT 'active', purchase_date TEXT, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fleet_vehicles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, make TEXT, model TEXT, year INTEGER,
      license_plate TEXT, vin TEXT, status TEXT DEFAULT 'active', assigned_person_id TEXT,
      mileage INTEGER DEFAULT 0, last_service_date TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fleet_maintenance (
      id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, service_type TEXT, service_date TEXT NOT NULL,
      cost_cents INTEGER DEFAULT 0, notes TEXT, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facilities (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT, facility_type TEXT DEFAULT 'office',
      sqft INTEGER DEFAULT 0, status TEXT DEFAULT 'active', manager_person_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS facility_work_orders (
      id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, title TEXT NOT NULL, priority TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'open', assigned_person_id TEXT, due_date TEXT, completed_at TEXT, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS board_meetings (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, meeting_date TEXT NOT NULL, location TEXT,
      status TEXT DEFAULT 'scheduled', agenda TEXT, minutes TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS board_action_items (
      id TEXT PRIMARY KEY, meeting_id TEXT, title TEXT NOT NULL, assigned_person_id TEXT,
      due_date TEXT, status TEXT DEFAULT 'open', created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS compliance_policies (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT DEFAULT 'general',
      effective_date TEXT, review_date TEXT, status TEXT DEFAULT 'active',
      owner_person_id TEXT, description TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS compliance_risks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, risk_level TEXT DEFAULT 'medium',
      category TEXT DEFAULT 'operational', status TEXT DEFAULT 'open', mitigated_at TEXT,
      owner_person_id TEXT, description TEXT, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS org_events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, event_type TEXT DEFAULT 'meeting',
      start_at TEXT NOT NULL, end_at TEXT, location TEXT, department_id TEXT,
      program_id TEXT, person_id TEXT, all_day INTEGER DEFAULT 0, status TEXT DEFAULT 'scheduled',
      description TEXT, created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ops_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      assigned_person_id TEXT,
      department_id TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'open',
      priority TEXT DEFAULT 'normal',
      created_by_email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ops_tasks_status ON ops_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_ops_tasks_assignee ON ops_tasks(assigned_person_id);
  `);

  const housingCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM housing_units"))?.c ?? 0;
  if (housingCount === 0) {
    const u1 = opsId();
    await db.run(
      `INSERT INTO housing_units (id, address, unit_type, status, capacity, monthly_rent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      u1, "1240 Community Way, Unit 3A", "apartment", "occupied", 4, 850, now
    );
    await db.run(
      `INSERT INTO housing_units (id, address, unit_type, status, capacity, monthly_rent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      opsId(), "1240 Community Way, Unit 3B", "apartment", "available", 4, 850, now
    );
    await db.run(
      `INSERT INTO housing_applications (id, status, applied_at, notes, created_at) VALUES (?, ?, ?, ?, ?)`,
      opsId(), "under_review", now, "Family of 4 — transitional housing", now
    );
  }

  const schCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM scholarship_programs"))?.c ?? 0;
  if (schCount === 0) {
    await db.run(
      `INSERT INTO scholarship_programs (id, name, amount, deadline, status, requirements, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      opsId(), "IFCDC Community Leadership Scholarship", 2500, "2026-08-01", "open", "Essay, 2 references, GPA 2.5+", now
    );
  }

  const mediaCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM media_content"))?.c ?? 0;
  if (mediaCount === 0) {
    await db.run(
      `INSERT INTO media_content (id, title, content_type, channel, status, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      opsId(), "IFCDC Community Impact Report Q1", "report", "web", "published", "Quarterly community impact summary", now
    );
    await db.run(
      `INSERT INTO media_broadcasts (id, title, platform, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      opsId(), "Morning Community Hour", "radio", new Date(Date.now() + 86400000).toISOString(), "scheduled", now
    );
  }

  const docCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_documents"))?.c ?? 0;
  if (docCount === 0) {
    await db.run(
      `INSERT INTO hq_documents (id, title, category, access_level, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      opsId(), "IFCDC Employee Handbook 2026", "policy", "internal", 1, now, now
    );
  }

  const assetCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM assets"))?.c ?? 0;
  if (assetCount === 0) {
    await db.run(
      `INSERT INTO assets (id, name, category, asset_tag, location, value_cents, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      opsId(), "MacBook Pro — Programs Dept", "technology", "IFCDC-LT-001", "HQ Office", 180000, "active", now
    );
  }

  const fleetCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM fleet_vehicles"))?.c ?? 0;
  if (fleetCount === 0) {
    const vId = opsId();
    await db.run(
      `INSERT INTO fleet_vehicles (id, name, make, model, year, license_plate, status, mileage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      vId, "Community Outreach Van", "Ford", "Transit", 2022, "IFC-2022", "active", 28400, now
    );
  }

  const facCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM facilities"))?.c ?? 0;
  if (facCount === 0) {
    const fId = opsId();
    await db.run(
      `INSERT INTO facilities (id, name, address, facility_type, sqft, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      fId, "IFCDC Headquarters", "100 Enterprise Blvd", "office", 12000, "active", now
    );
    await db.run(
      `INSERT INTO facility_work_orders (id, facility_id, title, priority, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      opsId(), fId, "HVAC filter replacement — Building A", "normal", "open", now
    );
  }

  const boardCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM board_meetings"))?.c ?? 0;
  if (boardCount === 0) {
    const mId = opsId();
    await db.run(
      `INSERT INTO board_meetings (id, title, meeting_date, location, status, agenda, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      mId, "Q2 Board of Directors Meeting", "2026-07-15T18:00:00", "IFCDC HQ — Conference Room", "scheduled", "Financial review, grant pipeline, strategic plan", now
    );
    await db.run(
      `INSERT INTO board_action_items (id, meeting_id, title, status, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      opsId(), mId, "Approve FY2027 operating budget", "open", "2026-07-30", now
    );
  }

  const compCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM compliance_policies"))?.c ?? 0;
  if (compCount === 0) {
    await db.run(
      `INSERT INTO compliance_policies (id, title, category, effective_date, review_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      opsId(), "Non-Discrimination Policy", "hr", "2025-01-01", "2026-12-31", "active", now
    );
    await db.run(
      `INSERT INTO compliance_risks (id, title, risk_level, category, status, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      opsId(), "Grant reporting deadline backlog", "medium", "grants", "open", "Multiple compliance reports due within 14 days", now
    );
  }

  const eventCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM org_events"))?.c ?? 0;
  if (eventCount === 0) {
    await db.run(
      `INSERT INTO org_events (id, title, event_type, start_at, end_at, location, status, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      opsId(), "All-Staff Town Hall", "meeting", "2026-07-01T10:00:00", "2026-07-01T11:30:00", "IFCDC HQ", "scheduled", "Organization-wide quarterly update", now
    );
  }
}

export const EMPTY_OPERATIONS_OVERVIEW = {
  housing: { units: 0, available: 0, applications: 0, placements: 0 },
  scholarships: { programs: 0, applications: 0, awarded: 0 },
  media: { content: 0, published: 0, broadcasts: 0 },
  documents: { total: 0 },
  assets: { total: 0 },
  fleet: { vehicles: 0, maintenanceDue: 0 },
  facilities: { properties: 0, openWorkOrders: 0 },
  board: { upcomingMeetings: 0, openActions: 0 },
  compliance: { policies: 0, openRisks: 0, highRisks: 0 },
  calendar: { upcomingEvents: 0 },
} as const;

export async function buildOperationsOverview() {
  try {
    const db = await getDb();
  const safeCount = async (table: string, where = "1=1") =>
    (await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM ${table} WHERE ${where}`))?.c ?? 0;

  return {
    housing: {
      units: await safeCount("housing_units"),
      available: await safeCount("housing_units", "status = 'available'"),
      applications: await safeCount("housing_applications"),
      placements: await safeCount("housing_placements", "status = 'active'"),
    },
    scholarships: {
      programs: await safeCount("scholarship_programs", "status = 'open'"),
      applications: await safeCount("scholarship_applications"),
      awarded: await safeCount("scholarship_applications", "status = 'awarded'"),
    },
    media: {
      content: await safeCount("media_content"),
      published: await safeCount("media_content", "status = 'published'"),
      broadcasts: await safeCount("media_broadcasts"),
    },
    documents: { total: await safeCount("hq_documents") },
    assets: { total: await safeCount("assets", "status = 'active'") },
    fleet: {
      vehicles: await safeCount("fleet_vehicles", "status = 'active'"),
      maintenanceDue: await safeCount("fleet_vehicles", "last_service_date IS NULL OR last_service_date < date('now', '-90 days')"),
    },
    facilities: {
      properties: await safeCount("facilities", "status = 'active'"),
      openWorkOrders: await safeCount("facility_work_orders", "status = 'open'"),
    },
    board: {
      upcomingMeetings: await safeCount("board_meetings", "status = 'scheduled'"),
      openActions: await safeCount("board_action_items", "status = 'open'"),
    },
    compliance: {
      policies: await safeCount("compliance_policies", "status = 'active'"),
      openRisks: await safeCount("compliance_risks", "status = 'open'"),
      highRisks: await safeCount("compliance_risks", "status = 'open' AND risk_level = 'high'"),
    },
    calendar: {
      upcomingEvents: await safeCount("org_events", "start_at >= date('now') AND status = 'scheduled'"),
    },
  };
  } catch (error) {
    console.error("buildOperationsOverview failed — returning empty snapshot:", error);
    return { ...EMPTY_OPERATIONS_OVERVIEW };
  }
}
