import { getDb } from "../db";
import crypto from "crypto";
import { allowGrantDemoSeed } from "./grantProductionPolicy";

function id() {
  return crypto.randomUUID();
}

export async function ensureGrantTables(): Promise<void> {
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_opportunities (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      funder TEXT NOT NULL,
      description TEXT,
      amount_min REAL,
      amount_max REAL,
      status TEXT DEFAULT 'open',
      deadline TEXT,
      url TEXT,
      requirements TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grant_applications (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      amount_requested REAL,
      amount_awarded REAL,
      submitted_at TEXT,
      assigned_to TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES grant_opportunities(id)
    );

    CREATE TABLE IF NOT EXISTS grant_deadlines (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT,
      application_id TEXT,
      title TEXT NOT NULL,
      due_date TEXT NOT NULL,
      deadline_type TEXT DEFAULT 'submission',
      completed INTEGER DEFAULT 0,
      reminder_days INTEGER DEFAULT 7,
      created_at TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES grant_opportunities(id),
      FOREIGN KEY (application_id) REFERENCES grant_applications(id)
    );

    CREATE TABLE IF NOT EXISTS grant_documents (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT,
      application_id TEXT,
      name TEXT NOT NULL,
      doc_type TEXT DEFAULT 'required',
      file_url TEXT,
      required INTEGER DEFAULT 1,
      uploaded_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES grant_opportunities(id),
      FOREIGN KEY (application_id) REFERENCES grant_applications(id)
    );

    CREATE TABLE IF NOT EXISTS grant_awards (
      id TEXT PRIMARY KEY,
      application_id TEXT,
      opportunity_id TEXT,
      amount REAL NOT NULL,
      award_date TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      reporting_schedule TEXT,
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES grant_applications(id),
      FOREIGN KEY (opportunity_id) REFERENCES grant_opportunities(id)
    );

    CREATE TABLE IF NOT EXISTS grant_compliance (
      id TEXT PRIMARY KEY,
      award_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      due_date TEXT NOT NULL,
      submitted_at TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (award_id) REFERENCES grant_awards(id)
    );

    CREATE TABLE IF NOT EXISTS finance_budgets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      fiscal_year TEXT NOT NULL,
      allocated REAL NOT NULL,
      spent REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_expenses (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      vendor TEXT,
      expense_date TEXT NOT NULL,
      funding_source TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await migrateGrantPhase2();
  await migrateGrantPhase3();
  await migrateGrantPhase4();
  await migrateGrantPhase5();
  await migrateGrantPhase6();
  await migrateGrantPhase7();
  await migrateGrantPhase8();
  if (!allowGrantDemoSeed()) {
    return;
  }
  const count = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_opportunities");
  if (count && count.c === 0) {
    const now = new Date().toISOString();
    const seeds = [
      {
        title: "Community Violence Prevention Initiative",
        funder: "U.S. Department of Justice",
        description: "Federal funding for evidence-based violence prevention programs in underserved communities.",
        amount_min: 150000,
        amount_max: 500000,
        deadline: "2026-09-15",
        url: "https://www.justice.gov/grants",
        requirements: JSON.stringify(["Logic model", "Budget narrative", "Letters of support", "501(c)(3) determination"]),
      },
      {
        title: "Workforce Development & Barber Training",
        funder: "NJ Department of Labor",
        description: "State grant supporting vocational training and workforce placement for barber certification programs.",
        amount_min: 50000,
        amount_max: 125000,
        deadline: "2026-07-30",
        url: "https://www.nj.gov/labor/grants",
        requirements: JSON.stringify(["Training curriculum", "Outcome metrics", "Partnership agreements"]),
      },
      {
        title: "Mental Health Community Outreach",
        funder: "SAMHSA",
        description: "Substance abuse and mental health services block grant for community-based outreach.",
        amount_min: 75000,
        amount_max: 200000,
        deadline: "2026-08-01",
        url: "https://www.samhsa.gov/grants",
        requirements: JSON.stringify(["Needs assessment", "Staff credentials", "HIPAA compliance plan"]),
      },
      {
        title: "Youth Mentorship & Education",
        funder: "Imperial Foundation CDC Foundation",
        description: "Internal foundation grant for youth mentorship, scholarship, and after-school programming.",
        amount_min: 25000,
        amount_max: 75000,
        deadline: "2026-06-30",
        url: "",
        requirements: JSON.stringify(["Program proposal", "Youth impact metrics", "Parent consent forms"]),
      },
    ];

    for (const s of seeds) {
      const oppId = id();
      await db.run(
        `INSERT INTO grant_opportunities (id, title, funder, description, amount_min, amount_max, status, deadline, url, requirements, source_type, import_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 'dev_seed', 'seed', ?, ?)`,
        oppId, s.title, s.funder, s.description, s.amount_min, s.amount_max, s.deadline, s.url, s.requirements, now, now
      );
      await db.run(
        `INSERT INTO grant_deadlines (id, opportunity_id, title, due_date, deadline_type, completed, reminder_days, created_at)
         VALUES (?, ?, ?, ?, 'submission', 0, 14, ?)`,
        id(), oppId, `Application deadline: ${s.title}`, s.deadline, now
      );
      const reqs = JSON.parse(s.requirements) as string[];
      for (const req of reqs) {
        await db.run(
          `INSERT INTO grant_documents (id, opportunity_id, name, doc_type, required, created_at)
           VALUES (?, ?, ?, 'required', 1, ?)`,
          id(), oppId, req, now
        );
      }
    }
  }

  const budgetCount = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_budgets");
  if (budgetCount && budgetCount.c === 0) {
    const now = new Date().toISOString();
    const budgets = [
      { name: "Programs & Services", category: "programs", allocated: 250000 },
      { name: "Payroll & Benefits", category: "payroll", allocated: 180000 },
      { name: "Facilities & Operations", category: "operations", allocated: 45000 },
      { name: "Technology & Software", category: "technology", allocated: 30000 },
      { name: "Grant Administration", category: "grants", allocated: 15000 },
    ];
    for (const b of budgets) {
      await db.run(
        `INSERT INTO finance_budgets (id, name, category, fiscal_year, allocated, spent, created_at, updated_at)
         VALUES (?, ?, ?, '2026', ?, 0, ?, ?)`,
        id(), b.name, b.category, b.allocated, now, now
      );
    }
  }
}

export { id as grantId };

async function migrateGrantPhase2(): Promise<void> {
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_budget_lines (
      id TEXT PRIMARY KEY,
      award_id TEXT NOT NULL,
      finance_budget_id TEXT,
      category TEXT NOT NULL,
      line_name TEXT NOT NULL,
      allocated REAL NOT NULL,
      spent REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (award_id) REFERENCES grant_awards(id)
    );

    CREATE TABLE IF NOT EXISTS grant_labor_allocations (
      id TEXT PRIMARY KEY,
      award_id TEXT NOT NULL,
      person_id TEXT,
      payroll_item_id TEXT,
      role TEXT,
      hours REAL DEFAULT 0,
      hourly_rate REAL DEFAULT 0,
      cost_cents INTEGER DEFAULT 0,
      period_start TEXT,
      period_end TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (award_id) REFERENCES grant_awards(id)
    );

    CREATE TABLE IF NOT EXISTS grant_expenditures (
      id TEXT PRIMARY KEY,
      award_id TEXT,
      grant_id TEXT,
      finance_expense_id TEXT,
      amount_cents INTEGER NOT NULL,
      category TEXT,
      description TEXT,
      expense_date TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grant_links (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      link_type TEXT NOT NULL,
      link_id TEXT NOT NULL,
      link_label TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grant_notifications (
      id TEXT PRIMARY KEY,
      grant_entity_type TEXT NOT NULL,
      grant_entity_id TEXT NOT NULL,
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      due_date TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grant_renewals (
      id TEXT PRIMARY KEY,
      original_award_id TEXT NOT NULL,
      new_opportunity_id TEXT,
      new_application_id TEXT,
      renewal_date TEXT NOT NULL,
      status TEXT DEFAULT 'planned',
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (original_award_id) REFERENCES grant_awards(id)
    );

    CREATE TABLE IF NOT EXISTS grant_activity (
      id TEXT PRIMARY KEY,
      grant_entity_type TEXT NOT NULL,
      grant_entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const addCol = async (table: string, col: string, type: string) => {
    try { await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch { /* exists */ }
  };

  for (const col of ["program_id", "department_id", "assigned_person_id"]) {
    await addCol("grant_opportunities", col, "TEXT");
    await addCol("grant_applications", col, "TEXT");
  }
  await addCol("grant_awards", "finance_budget_id", "TEXT");
  await addCol("grant_awards", "program_id", "TEXT");
  await addCol("grant_awards", "department_id", "TEXT");
  await addCol("grant_awards", "renewal_of_award_id", "TEXT");
  await addCol("grant_documents", "status", "TEXT DEFAULT 'pending'");
  await addCol("grant_documents", "approved_by", "TEXT");
  await addCol("grant_documents", "approved_at", "TEXT");
  await addCol("grant_documents", "notes", "TEXT");
  await addCol("finance_expenses", "grant_id", "TEXT");
  await addCol("finance_budgets", "grant_id", "TEXT");

  await seedGrantCompliance();
}

/** Phase 2 — IFCDC Funding Engine: enriched opportunity DB, scoring, workflow, outcomes. */
async function migrateGrantPhase3(): Promise<void> {
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_opportunity_scores (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      division_slug TEXT,
      score INTEGER NOT NULL,
      grade TEXT,
      factors_json TEXT,
      model TEXT DEFAULT 'ifcdc-eligibility-v1',
      scored_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES grant_opportunities(id)
    );
    CREATE INDEX IF NOT EXISTS idx_grant_opp_scores_opp ON grant_opportunity_scores(opportunity_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS grant_application_workflow (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      step_key TEXT NOT NULL,
      step_label TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      due_date TEXT,
      completed_at TEXT,
      actor_email TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES grant_applications(id)
    );
    CREATE INDEX IF NOT EXISTS idx_grant_app_workflow ON grant_application_workflow(application_id, created_at);

    CREATE TABLE IF NOT EXISTS grant_outcomes (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      reason TEXT,
      amount REAL,
      recorded_by TEXT,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES grant_applications(id)
    );
    CREATE INDEX IF NOT EXISTS idx_grant_outcomes_app ON grant_outcomes(application_id);
  `);

  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };

  for (const col of [
    ["source_type", "TEXT DEFAULT 'manual'"],
    ["funder_type", "TEXT"],
    ["eligibility", "TEXT"],
    ["geography", "TEXT DEFAULT 'US-NJ'"],
    ["program_areas", "TEXT"],
    ["match_tags", "TEXT"],
    ["external_id", "TEXT"],
    ["posted_date", "TEXT"],
    ["close_date", "TEXT"],
    ["last_verified_at", "TEXT"],
    ["import_status", "TEXT DEFAULT 'verified'"],
    ["funder_id", "TEXT"],
    ["division_slugs", "TEXT"],
  ] as const) {
    await addCol("grant_opportunities", col[0], col[1]);
  }

  await addCol("grant_applications", "rejection_reason", "TEXT");
  await addCol("grant_applications", "outcome_recorded_at", "TEXT");
  await addCol("grant_applications", "workflow_stage", "TEXT DEFAULT 'intake'");

  await enrichSeedOpportunities();
}

/** Phase 4 — Grant Center v2: division profiles, live DB, document categories. */
async function migrateGrantPhase4(): Promise<void> {
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_division_profiles (
      slug TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      funding_goal REAL DEFAULT 0,
      budget_allocated REAL DEFAULT 0,
      budget_spent REAL DEFAULT 0,
      pipeline_value REAL DEFAULT 0,
      awarded_total REAL DEFAULT 0,
      priority_level INTEGER DEFAULT 5,
      program_areas TEXT,
      read_only INTEGER DEFAULT 0,
      notes TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };
  await addCol("grant_documents", "doc_category", "TEXT DEFAULT 'attachment'");
  await addCol("grant_opportunities", "is_live", "INTEGER DEFAULT 1");

  const now = new Date().toISOString();
  const divisionSeeds = [
    { slug: "housing", label: "Housing", programs: ["transitional_housing", "housing"], readOnly: false, goal: 500000 },
    { slug: "anti_gang", label: "Anti-Gang", programs: ["violence_prevention", "community_safety"], readOnly: false, goal: 750000 },
    { slug: "scholarships", label: "Scholarships", programs: ["scholarships", "education"], readOnly: false, goal: 250000 },
    { slug: "economic_development", label: "Economic Development", programs: ["workforce", "economic_development"], readOnly: false, goal: 400000 },
    { slug: "productions", label: "Productions & Media", programs: ["media", "productions"], readOnly: false, goal: 150000 },
    { slug: "radio", label: "IFCDC Radio", programs: ["radio", "broadcast"], readOnly: false, goal: 100000 },
    { slug: "music", label: "IFCDC Music", programs: ["music", "arts"], readOnly: false, goal: 150000 },
    { slug: "barbers", label: "IFCDC Barbers", programs: ["workforce", "vocational_training"], readOnly: true, goal: 125000 },
    { slug: "tapis", label: "TAPIS Mentorship", programs: ["mentorship", "youth"], readOnly: false, goal: 300000 },
    { slug: "inclusive", label: "Inclusive Community", programs: ["inclusive", "mental_health"], readOnly: false, goal: 350000 },
    { slug: "community_programs", label: "Community Programs", programs: ["community", "outreach"], readOnly: false, goal: 600000 },
  ] as const;

  for (const div of divisionSeeds) {
    const existing = await db.get("SELECT slug FROM grant_division_profiles WHERE slug = ?", div.slug);
    if (existing) continue;
    await db.run(
      `INSERT INTO grant_division_profiles (slug, label, funding_goal, program_areas, read_only, priority_level, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      div.slug,
      div.label,
      div.goal,
      JSON.stringify(div.programs),
      div.readOnly ? 1 : 0,
      div.readOnly ? 8 : 5,
      now
    );
  }
}

/** Phase 5 — Funding Engine Buildout: unified statuses, strategic fit scoring. */
async function migrateGrantPhase5(): Promise<void> {
  const db = await getDb();

  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };

  await addCol("grant_opportunities", "funding_status", "TEXT DEFAULT 'identified'");
  await addCol("grant_opportunity_scores", "strategic_fit_score", "INTEGER");
  await addCol("grant_opportunity_scores", "strategic_fit_grade", "TEXT");

  await db.run(
    `UPDATE grant_opportunities SET funding_status = 'identified'
     WHERE funding_status IS NULL AND status IN ('open', 'active', 'researching')`
  );

  await db.run(`
    UPDATE grant_opportunities SET funding_status = 'in_progress'
    WHERE id IN (SELECT opportunity_id FROM grant_applications WHERE status = 'draft')
  `);
  await db.run(`
    UPDATE grant_opportunities SET funding_status = 'submitted'
    WHERE id IN (SELECT opportunity_id FROM grant_applications WHERE status IN ('submitted', 'under_review'))
  `);
  await db.run(`
    UPDATE grant_opportunities SET funding_status = 'awarded'
    WHERE id IN (SELECT opportunity_id FROM grant_awards WHERE status = 'active')
  `);
  await db.run(`
    UPDATE grant_opportunities SET funding_status = 'declined'
    WHERE id IN (SELECT opportunity_id FROM grant_applications WHERE status = 'denied')
  `);

  await db.run(`
    UPDATE grant_opportunities SET funding_status = 'eligible'
    WHERE funding_status = 'identified'
      AND id IN (
        SELECT opportunity_id FROM grant_opportunity_scores
        WHERE score >= 60 GROUP BY opportunity_id
      )
  `);
}

/** Phase 6 — Grant Center v3: intelligent funding engine metadata. */
async function migrateGrantPhase6(): Promise<void> {
  const db = await getDb();

  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };

  await addCol("grant_opportunity_scores", "priority_score", "INTEGER");
  await addCol("grant_documents", "board_approval", "INTEGER DEFAULT 0");
  await addCol("grant_division_profiles", "outcome_summary", "TEXT");

  await db.run(`
    UPDATE grant_documents SET doc_category = 'board_approval'
    WHERE doc_category = 'attachment' AND (name LIKE '%board%' OR name LIKE '%approval%')
  `);
}

/** Phase 7 — Grant Center v4: full grant lifecycle operations. */
async function migrateGrantPhase7(): Promise<void> {
  const db = await getDb();

  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };

  await addCol("grant_opportunities", "lifecycle_stage", "TEXT DEFAULT 'prospect'");
  await addCol("grant_applications", "lifecycle_stage", "TEXT");
  await addCol("grant_awards", "lifecycle_stage", "TEXT DEFAULT 'active_grant'");

  await db.run(`
    UPDATE grant_opportunities SET lifecycle_stage = 'prospect'
    WHERE lifecycle_stage IS NULL AND status IN ('open', 'active', 'researching')
  `);
  await db.run(`
    UPDATE grant_opportunities SET lifecycle_stage = 'eligibility_review'
    WHERE funding_status IN ('reviewing', 'eligible') AND lifecycle_stage = 'prospect'
  `);
  await db.run(`
    UPDATE grant_applications SET lifecycle_stage = 'application_drafting' WHERE status = 'draft' AND lifecycle_stage IS NULL
  `);
  await db.run(`
    UPDATE grant_applications SET lifecycle_stage = 'submitted' WHERE status = 'submitted' AND lifecycle_stage IS NULL
  `);
  await db.run(`
    UPDATE grant_applications SET lifecycle_stage = 'under_review' WHERE status = 'under_review' AND lifecycle_stage IS NULL
  `);
  await db.run(`
    UPDATE grant_applications SET lifecycle_stage = 'awarded' WHERE status = 'awarded' AND lifecycle_stage IS NULL
  `);
  await db.run(`
    UPDATE grant_awards SET lifecycle_stage = 'active_grant' WHERE status = 'active' AND lifecycle_stage IS NULL
  `);
  await db.run(`
    UPDATE grant_awards SET lifecycle_stage = 'reporting'
    WHERE id IN (SELECT award_id FROM grant_compliance WHERE status = 'pending')
  `);
}

/** Phase 8 — Grant Center v5: Funding Intelligence Engine. */
async function migrateGrantPhase8(): Promise<void> {
  const db = await getDb();

  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };

  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_proposal_budgets (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL UNIQUE,
      line_items TEXT,
      total_requested REAL DEFAULT 0,
      direct_costs REAL DEFAULT 0,
      indirect_costs REAL DEFAULT 0,
      personnel REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES grant_applications(id)
    );
  `);

  await addCol("grant_opportunities", "is_national", "INTEGER DEFAULT 0");
  await addCol("grant_opportunity_scores", "best_fit_score", "INTEGER");
  await addCol("grant_opportunity_scores", "deadline_score", "INTEGER");
  await addCol("grant_opportunity_scores", "award_size_score", "INTEGER");
  await addCol("grant_opportunity_scores", "competitiveness_score", "INTEGER");
  await addCol("grant_opportunity_scores", "composite_score", "INTEGER");
  await addCol("grant_opportunity_scores", "award_probability", "INTEGER");

  await db.run(`
    UPDATE grant_opportunities SET is_national = 1
    WHERE funder LIKE '%Department%' OR funder LIKE '%U.S.%' OR funder LIKE '%Federal%'
      OR funder LIKE '%SAMHSA%' OR funder LIKE '%NIH%' OR funder_type = 'federal'
  `);
}

async function enrichSeedOpportunities(): Promise<void> {
  const db = await getDb();
  const rows = (await db.all(
    "SELECT id, title, program_areas FROM grant_opportunities WHERE program_areas IS NULL OR program_areas = '' LIMIT 20"
  )) as { id: string; title: string }[];

  const areaMap: Record<string, { areas: string[]; divisions: string[]; tags: string[] }> = {
    "Community Violence Prevention": {
      areas: ["violence_prevention", "community_safety", "youth"],
      divisions: ["anti_gang", "community_programs"],
      tags: ["federal", "doj", "prevention"],
    },
    "Workforce Development": {
      areas: ["workforce", "vocational_training", "employment"],
      divisions: ["barbers", "economic_development"],
      tags: ["state", "nj", "training"],
    },
    "Mental Health": {
      areas: ["mental_health", "substance_abuse", "outreach"],
      divisions: ["community_programs", "inclusive"],
      tags: ["federal", "samhsa", "health"],
    },
    "Youth Mentorship": {
      areas: ["youth", "education", "mentorship"],
      divisions: ["tapis", "scholarships", "community_programs"],
      tags: ["foundation", "internal", "youth"],
    },
  };

  const now = new Date().toISOString();
  for (const row of rows) {
    const key = Object.keys(areaMap).find((k) => row.title.includes(k));
    if (!key) continue;
    const meta = areaMap[key];
    await db.run(
      `UPDATE grant_opportunities SET program_areas = ?, division_slugs = ?, match_tags = ?,
       eligibility = ?, last_verified_at = ?, updated_at = ? WHERE id = ?`,
      JSON.stringify(meta.areas),
      JSON.stringify(meta.divisions),
      JSON.stringify(meta.tags),
      "501(c)(3) community development organization serving Monmouth County, NJ",
      now,
      now,
      row.id
    );
  }
}

async function seedGrantCompliance(): Promise<void> {
  const db = await getDb();
  const count = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_compliance");
  if (count && count.c > 0) return;

  const awards = (await db.all("SELECT id, amount FROM grant_awards LIMIT 2")) as { id: string; amount: number }[];
  if (!awards.length) return;

  const now = new Date().toISOString();
  const due = new Date();
  due.setDate(due.getDate() + 45);

  for (const aw of awards) {
    await db.run(
      `INSERT INTO grant_compliance (id, award_id, report_type, due_date, status, notes, created_at)
       VALUES (?, ?, 'Quarterly Progress Report', ?, 'pending', 'Auto-scheduled compliance report', ?)`,
      id(), aw.id, due.toISOString().slice(0, 10), now
    );
  }
}

export async function logGrantActivity(
  entityType: string,
  entityId: string,
  action: string,
  detail: string,
  actorEmail?: string
): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO grant_activity (id, grant_entity_type, grant_entity_id, action, detail, actor_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id(), entityType, entityId, action, detail, actorEmail ?? null, new Date().toISOString()
  );
}
