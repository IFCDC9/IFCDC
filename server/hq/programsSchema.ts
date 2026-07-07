import { getDb } from "../db";
import crypto from "crypto";
import { ensurePeopleTables } from "./peopleSchema";
import { allowHqDemoSeed } from "./grantProductionPolicy";

export function programId() {
  return crypto.randomUUID();
}

export const PROGRAM_SLUGS = [
  "housing",
  "anti-gang",
  "scholarships",
  "outreach",
  "mentorship",
  "economic-development",
] as const;

export type ProgramSlug = (typeof PROGRAM_SLUGS)[number];

export const PROGRAM_DEFINITIONS: Record<ProgramSlug, { name: string; description: string; budgetAllocated: number }> = {
  housing: {
    name: "Transitional Housing",
    description: "Safe transitional housing, case management, and placement tracking for families in need.",
    budgetAllocated: 185000,
  },
  "anti-gang": {
    name: "Anti-Gang Program",
    description: "Violence prevention, youth intervention, and community safety initiatives.",
    budgetAllocated: 95000,
  },
  scholarships: {
    name: "Scholarship Program",
    description: "Educational scholarships, application review, and award disbursement.",
    budgetAllocated: 75000,
  },
  outreach: {
    name: "Community Outreach",
    description: "Community events, resource fairs, and neighborhood engagement.",
    budgetAllocated: 45000,
  },
  mentorship: {
    name: "Youth Mentorship",
    description: "Mentor-mentee matching, session tracking, and youth development outcomes.",
    budgetAllocated: 60000,
  },
  "economic-development": {
    name: "Economic Development",
    description: "Job training, workforce placement, and small business support.",
    budgetAllocated: 120000,
  },
};

export async function ensureProgramModuleTables(): Promise<void> {
  await ensurePeopleTables();
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_program_registry (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      budget_allocated REAL DEFAULT 0,
      budget_spent REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_program_participants (
      id TEXT PRIMARY KEY,
      program_slug TEXT NOT NULL,
      person_id TEXT,
      participant_name TEXT,
      status TEXT DEFAULT 'active',
      enrolled_at TEXT,
      outcome_status TEXT,
      outcome_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_program_staff (
      id TEXT PRIMARY KEY,
      program_slug TEXT NOT NULL,
      person_id TEXT NOT NULL,
      role TEXT DEFAULT 'coordinator',
      assigned_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_program_events (
      id TEXT PRIMARY KEY,
      program_slug TEXT NOT NULL,
      title TEXT NOT NULL,
      event_type TEXT DEFAULT 'session',
      start_at TEXT NOT NULL,
      end_at TEXT,
      location TEXT,
      status TEXT DEFAULT 'scheduled',
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_program_metrics (
      id TEXT PRIMARY KEY,
      program_slug TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      metric_label TEXT NOT NULL,
      metric_value REAL DEFAULT 0,
      target_value REAL,
      period TEXT,
      recorded_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_program_documents (
      id TEXT PRIMARY KEY,
      program_slug TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      file_url TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hq_program_compliance (
      id TEXT PRIMARY KEY,
      program_slug TEXT NOT NULL,
      requirement TEXT NOT NULL,
      category TEXT DEFAULT 'regulatory',
      due_date TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_prog_compliance_slug ON hq_program_compliance(program_slug);
    CREATE INDEX IF NOT EXISTS idx_prog_part_slug ON hq_program_participants(program_slug);
    CREATE INDEX IF NOT EXISTS idx_prog_staff_slug ON hq_program_staff(program_slug);
    CREATE INDEX IF NOT EXISTS idx_prog_events_slug ON hq_program_events(program_slug);
    CREATE INDEX IF NOT EXISTS idx_prog_metrics_slug ON hq_program_metrics(program_slug);
  `);

  const now = new Date().toISOString();
  for (const slug of PROGRAM_SLUGS) {
    const def = PROGRAM_DEFINITIONS[slug];
    const existing = await db.get("SELECT id FROM hq_program_registry WHERE slug = ?", slug);
    if (existing) continue;
    await db.run(
      `INSERT INTO hq_program_registry (id, slug, name, description, status, budget_allocated, budget_spent, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?)`,
      programId(), slug, def.name, def.description, allowHqDemoSeed() ? def.budgetAllocated : 0, now, now
    );
    await seedProgramMetrics(db, slug, now);
  }

  try { await db.exec(`ALTER TABLE hq_program_registry ADD COLUMN finance_budget_id TEXT`); } catch { /* exists */ }

  const { syncAllProgramBudgetsToGL } = await import("./programFinanceIntegration");
  await syncAllProgramBudgetsToGL().catch(() => undefined);
}

async function seedProgramMetrics(db: Awaited<ReturnType<typeof getDb>>, slug: ProgramSlug, now: string): Promise<void> {
  const defaults: Record<ProgramSlug, { key: string; label: string; value: number; target: number }[]> = {
    housing: [
      { key: "placements", label: "Active Placements", value: 0, target: 24 },
      { key: "retention", label: "90-Day Retention Rate %", value: 0, target: 85 },
    ],
    "anti-gang": [
      { key: "youth_served", label: "Youth Served", value: 0, target: 120 },
      { key: "interventions", label: "Interventions Completed", value: 0, target: 48 },
    ],
    scholarships: [
      { key: "awarded", label: "Scholarships Awarded", value: 0, target: 15 },
      { key: "disbursed", label: "Funds Disbursed ($)", value: 0, target: 50000 },
    ],
    outreach: [
      { key: "events", label: "Events Held", value: 0, target: 24 },
      { key: "contacts", label: "Community Contacts", value: 0, target: 500 },
    ],
    mentorship: [
      { key: "pairs", label: "Active Mentor Pairs", value: 0, target: 40 },
      { key: "hours", label: "Mentoring Hours", value: 0, target: 800 },
    ],
    "economic-development": [
      { key: "jobs_placed", label: "Jobs Placed", value: 0, target: 35 },
      { key: "training", label: "Training Completions", value: 0, target: 60 },
    ],
  };
  for (const m of defaults[slug]) {
    await db.run(
      `INSERT INTO hq_program_metrics (id, program_slug, metric_key, metric_label, metric_value, target_value, period, recorded_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'year', ?, ?)`,
      programId(), slug, m.key, m.label, m.value, m.target, now.slice(0, 10), now
    );
  }
}

export async function getProgramSummary(slug: string) {
  const db = await getDb();
  const program = await db.get("SELECT * FROM hq_program_registry WHERE slug = ?", slug);
  if (!program) return null;
  const [participants, staff, events, metrics, documents] = await Promise.all([
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_program_participants WHERE program_slug = ? AND status = 'active'", slug),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_program_staff WHERE program_slug = ?", slug),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_program_events WHERE program_slug = ? AND start_at >= date('now')", slug),
    db.all("SELECT * FROM hq_program_metrics WHERE program_slug = ? ORDER BY metric_label", slug),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_program_documents WHERE program_slug = ?", slug),
  ]);
  return {
    program,
    counts: {
      participants: participants?.c ?? 0,
      staff: staff?.c ?? 0,
      upcomingEvents: events?.c ?? 0,
      documents: documents?.c ?? 0,
    },
    metrics,
  };
}
