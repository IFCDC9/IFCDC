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
  await migrateGrantPhase9();
  await migrateGrantPhase10();
  await migrateGrantPhase8A();
  await migrateGrantPhase8A2();
  await migrateGrantPhase8A3();
  await migrateGrantPhase8A4();
  await migrateGrantPhase8A5();
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

/** Phase 9 — Grant Intelligence Engine: founder approval + program matching on applications. */
async function migrateGrantPhase9(): Promise<void> {
  const db = await getDb();
  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };
  await addCol("grant_applications", "founder_approval_status", "TEXT DEFAULT 'pending'");
  await addCol("grant_applications", "founder_approved_at", "TEXT");
  await addCol("grant_applications", "founder_approved_by", "TEXT");
  await addCol("grant_applications", "matched_program_slug", "TEXT");
  await addCol("grant_applications", "ready_to_submit", "INTEGER DEFAULT 0");
  await db.run(`
    UPDATE grant_applications SET founder_approval_status = 'pending'
    WHERE founder_approval_status IS NULL AND status IN ('draft', 'under_review')
  `);
}

/** Phase 10 — Enterprise Funding Pipeline stages and founder priorities. */
async function migrateGrantPhase10(): Promise<void> {
  const db = await getDb();
  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };
  await addCol("grant_opportunities", "pipeline_stage", "TEXT DEFAULT 'discovered'");
  await addCol("grant_applications", "pipeline_stage", "TEXT");
  await addCol("grant_applications", "founder_priority", "TEXT DEFAULT 'medium'");
  await addCol("grant_awards", "pipeline_stage", "TEXT DEFAULT 'awarded'");
  await db.run(`UPDATE grant_opportunities SET pipeline_stage = 'discovered' WHERE pipeline_stage IS NULL`);
  await db.run(`UPDATE grant_applications SET pipeline_stage = 'drafting' WHERE pipeline_stage IS NULL AND status = 'draft'`);
  await db.run(`UPDATE grant_applications SET founder_priority = 'medium' WHERE founder_priority IS NULL`);
}

/**
 * Phase 8A — AURA Funding Intelligence (additive).
 * Reuses grant_opportunities / applications / awards; adds sources, matches,
 * eligibility checks, qualification scores, fingerprint, audit events.
 */
async function migrateGrantPhase8A(): Promise<void> {
  const db = await getDb();
  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };

  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_sources (
      id TEXT PRIMARY KEY,
      provider_key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'federal',
      base_url TEXT,
      api_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      schedule_hint TEXT,
      notes TEXT,
      last_sync_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grant_eligibility_checks (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      result TEXT NOT NULL,
      reasons_json TEXT,
      checked_at TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'ifcdc-eligibility-8a',
      actor TEXT,
      FOREIGN KEY (opportunity_id) REFERENCES grant_opportunities(id)
    );

    CREATE TABLE IF NOT EXISTS grant_matches (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      program_slug TEXT NOT NULL,
      program_label TEXT,
      match_score INTEGER NOT NULL DEFAULT 0,
      rationale TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(opportunity_id, program_slug),
      FOREIGN KEY (opportunity_id) REFERENCES grant_opportunities(id)
    );

    CREATE TABLE IF NOT EXISTS grant_qualification_scores (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      total_score INTEGER NOT NULL,
      classification TEXT NOT NULL,
      breakdown_json TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'ifcdc-qualification-8a-v1',
      created_at TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES grant_opportunities(id)
    );

    CREATE TABLE IF NOT EXISTS grant_audit_events (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT,
      source TEXT,
      action TEXT NOT NULL,
      eligibility_result TEXT,
      score INTEGER,
      detail TEXT,
      actor_email TEXT,
      source_verified_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grant_elig_opp ON grant_eligibility_checks(opportunity_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_grant_match_opp ON grant_matches(opportunity_id);
    CREATE INDEX IF NOT EXISTS idx_grant_qual_opp ON grant_qualification_scores(opportunity_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_grant_audit_created ON grant_audit_events(created_at DESC);
  `);

  await addCol("grant_opportunities", "fingerprint", "TEXT");
  await addCol("grant_opportunities", "assistance_listing", "TEXT");
  await addCol("grant_opportunities", "award_floor", "REAL");
  await addCol("grant_opportunities", "award_ceiling", "REAL");
  await addCol("grant_opportunities", "estimated_funding", "REAL");
  await addCol("grant_opportunities", "anticipated_awards", "INTEGER");
  await addCol("grant_opportunities", "eligible_applicant_types", "TEXT");
  await addCol("grant_opportunities", "open_date", "TEXT");
  await addCol("grant_opportunities", "eligibility_result", "TEXT");
  await addCol("grant_opportunities", "qualification_score", "INTEGER");
  await addCol("grant_opportunities", "qualification_class", "TEXT");
  await addCol("grant_opportunities", "raw_source_json", "TEXT");
  await addCol("grant_opportunities", "duplicate_of_id", "TEXT");
  await addCol("grant_opportunities", "data_confidence", "TEXT DEFAULT 'medium'");

  try {
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_grant_opp_fingerprint ON grant_opportunities(fingerprint)`);
  } catch {
    /* ignore */
  }

  const now = new Date().toISOString();
  const sources = [
    ["grants_gov", "Grants.gov", "federal", "https://www.grants.gov", "https://api.grants.gov/v1/api/search2"],
    ["simpler_grants", "Simpler.Grants.gov", "federal", "https://simpler.grants.gov", null],
    ["sam_gov", "SAM.gov Assistance Listings", "federal", "https://sam.gov", null],
    ["nj_state", "New Jersey State Grants", "state", "https://www.nj.gov", null],
    ["foundation_directory", "Foundation Directory (partial)", "foundation", null, null],
    ["corporate_csr", "Corporate CSR (curated)", "corporate", null, null],
  ] as const;
  for (const [key, label, category, baseUrl, apiUrl] of sources) {
    await db.run(
      `INSERT INTO grant_sources (id, provider_key, label, category, base_url, api_url, status, schedule_hint, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 'on_demand', 'Phase 8A registry — connector may be partial', ?, ?)
       ON CONFLICT(provider_key) DO UPDATE SET updated_at = excluded.updated_at, label = excluded.label`,
      id(),
      key,
      label,
      category,
      baseUrl,
      apiUrl,
      now,
      now
    );
  }
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

/**
 * Phase 8A.2 — Enrichment fields, funding confidence, IFCDC program profiles.
 * Missing award amounts stay UNKNOWN (never coerced to $0 in pipeline totals).
 */
async function migrateGrantPhase8A2(): Promise<void> {
  const db = await getDb();
  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ifcdc_program_profiles (
      slug TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      mission_purpose TEXT,
      population_served TEXT,
      age_groups TEXT,
      geography TEXT,
      services_provided TEXT,
      funding_needs TEXT,
      eligible_spending_categories TEXT,
      keywords_json TEXT,
      outcomes TEXT,
      current_funding_priorities TEXT,
      organizational_capabilities TEXT,
      founder_completion_needed_json TEXT,
      source_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await addCol("grant_opportunities", "funding_amount_status", "TEXT DEFAULT 'unknown'");
  await addCol("grant_opportunities", "funding_value_source", "TEXT");
  await addCol("grant_opportunities", "funding_instrument", "TEXT");
  await addCol("grant_opportunities", "cost_share_required", "TEXT");
  await addCol("grant_opportunities", "application_instructions", "TEXT");
  await addCol("grant_opportunities", "required_documents_json", "TEXT");
  await addCol("grant_opportunities", "attachments_json", "TEXT");
  await addCol("grant_opportunities", "enrichment_status", "TEXT DEFAULT 'pending'");
  await addCol("grant_opportunities", "enriched_at", "TEXT");
  await addCol("grant_opportunities", "preliminary_score", "INTEGER");
  await addCol("grant_opportunities", "enriched_final_score", "INTEGER");
  await addCol("grant_opportunities", "best_program_slug", "TEXT");
  await addCol("grant_opportunities", "best_program_match_pct", "INTEGER");
  await addCol("grant_opportunities", "program_match_json", "TEXT");
  await addCol("grant_matches", "match_pct", "INTEGER");
  await addCol("grant_matches", "eligibility_concerns", "TEXT");
  await addCol("grant_matches", "program_gaps", "TEXT");

  const now = new Date().toISOString();
  /** Known HQ facts only — missing fields flagged for Founder completion (no fabrication). */
  const profiles: Array<{
    slug: string;
    label: string;
    mission: string | null;
    population: string | null;
    ages: string | null;
    geography: string;
    services: string | null;
    keywords: string[];
    outcomes: string | null;
    priorities: string | null;
    capabilities: string | null;
    missing: string[];
  }> = [
    {
      slug: "anti_gang",
      label: "Anti-Gang Program",
      mission: "Community violence prevention and anti-gang / community safety programming under IFCDC community development.",
      population: "Community residents in IFCDC service area facing gang and community violence risk",
      ages: null,
      geography: "Asbury Park / Monmouth County, New Jersey",
      services: "Violence prevention, community safety, anti-gang programming",
      keywords: ["anti_gang", "violence_prevention", "community_safety", "gang", "prevention"],
      outcomes: null,
      priorities: null,
      capabilities: "IFCDC 501(c)(3) CDC with Grant Center + community programs capacity",
      missing: ["age_groups", "outcomes", "current_funding_priorities", "eligible_spending_categories", "funding_needs"],
    },
    {
      slug: "housing",
      label: "Transitional Housing",
      mission: "Housing stability and transitional housing supports as part of IFCDC community development.",
      population: "Individuals and families needing transitional housing / housing stability",
      ages: null,
      geography: "Asbury Park / Monmouth County, New Jersey",
      services: "Transitional housing, housing stability supports",
      keywords: ["transitional_housing", "housing", "shelter", "homeless_services"],
      outcomes: null,
      priorities: null,
      capabilities: "IFCDC housing-related program division in Grant Center catalog",
      missing: ["age_groups", "outcomes", "current_funding_priorities", "eligible_spending_categories", "funding_needs"],
    },
    {
      slug: "youth_development",
      label: "Youth Programs",
      mission: "Youth development programming within IFCDC's community development ecosystem.",
      population: "Youth and young adults in IFCDC service area",
      ages: null,
      geography: "Asbury Park / Monmouth County, New Jersey",
      services: "Youth development programming",
      keywords: ["youth", "young_adults", "teen", "youth_development"],
      outcomes: null,
      priorities: null,
      capabilities: "IFCDC youth division listed in funding catalog",
      missing: ["age_groups", "outcomes", "current_funding_priorities", "eligible_spending_categories", "funding_needs", "services_provided_detail"],
    },
    {
      slug: "tapis",
      label: "Mentorship (TAPIS)",
      mission: "Mentorship services (TAPIS) supporting youth and community development.",
      population: "Mentees / youth engaged in mentorship",
      ages: null,
      geography: "Asbury Park / Monmouth County, New Jersey",
      services: "Mentorship",
      keywords: ["mentorship", "youth_mentorship", "tapis", "mentor"],
      outcomes: null,
      priorities: null,
      capabilities: "TAPIS Mentorship division in IFCDC Grant Center",
      missing: ["age_groups", "outcomes", "current_funding_priorities", "eligible_spending_categories", "funding_needs"],
    },
    {
      slug: "economic_development",
      label: "Economic Development",
      mission: "Economic empowerment and community economic development through IFCDC programs.",
      population: "Residents and community stakeholders seeking economic opportunity",
      ages: null,
      geography: "Asbury Park / Monmouth County, New Jersey",
      services: "Economic development, community economic empowerment",
      keywords: ["economic_development", "community_development", "economic_growth", "workforce"],
      outcomes: null,
      priorities: null,
      capabilities: "Economic Development division + workforce-related programs",
      missing: ["age_groups", "outcomes", "current_funding_priorities", "eligible_spending_categories", "funding_needs"],
    },
    {
      slug: "community_programs",
      label: "Community Programs",
      mission: "Community outreach and neighborhood services under IFCDC CDC mission.",
      population: "General community / neighborhood residents",
      ages: null,
      geography: "Asbury Park / Monmouth County, New Jersey",
      services: "Community programs, outreach",
      keywords: ["community", "outreach", "neighborhood_services", "community_programs"],
      outcomes: null,
      priorities: null,
      capabilities: "Community Programs division in Grant Center",
      missing: ["age_groups", "outcomes", "current_funding_priorities", "eligible_spending_categories", "funding_needs"],
    },
    {
      slug: "scholarships",
      label: "Scholarship Program",
      mission: "Scholarship and education support within IFCDC program catalog.",
      population: "Students / scholarship recipients",
      ages: null,
      geography: "Asbury Park / Monmouth County, New Jersey",
      services: "Scholarships, education support",
      keywords: ["scholarships", "education", "tuition_assistance"],
      outcomes: null,
      priorities: null,
      capabilities: "Scholarships division in IFCDC funding catalog",
      missing: ["age_groups", "outcomes", "current_funding_priorities", "eligible_spending_categories", "funding_needs", "population_detail"],
    },
  ];

  for (const p of profiles) {
    await db.run(
      `INSERT INTO ifcdc_program_profiles (
         slug, label, mission_purpose, population_served, age_groups, geography, services_provided,
         funding_needs, eligible_spending_categories, keywords_json, outcomes, current_funding_priorities,
         organizational_capabilities, founder_completion_needed_json, source_note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         label = excluded.label,
         mission_purpose = excluded.mission_purpose,
         population_served = excluded.population_served,
         geography = excluded.geography,
         services_provided = excluded.services_provided,
         keywords_json = excluded.keywords_json,
         organizational_capabilities = excluded.organizational_capabilities,
         founder_completion_needed_json = excluded.founder_completion_needed_json,
         updated_at = excluded.updated_at`,
      p.slug,
      p.label,
      p.mission,
      p.population,
      p.ages,
      p.geography,
      p.services,
      JSON.stringify(p.keywords),
      p.outcomes,
      p.priorities,
      p.capabilities,
      JSON.stringify(p.missing),
      "Seeded from IFCDC_FUNDING_DIVISIONS + IFCDC_ORG_PROFILE known HQ facts; missing fields await Founder completion",
      now,
      now
    );
  }
}

/**
 * Phase 8A.3 — Awardability, IFCDC addressable funding, application readiness.
 * Total program funding is never treated as IFCDC-addressable by default.
 */
async function migrateGrantPhase8A3(): Promise<void> {
  const db = await getDb();
  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };

  await addCol("grant_opportunities", "total_program_funding", "REAL");
  await addCol("grant_opportunities", "max_individual_award", "REAL");
  await addCol("grant_opportunities", "typical_individual_award", "REAL");
  await addCol("grant_opportunities", "multiple_awards_expected", "INTEGER");
  await addCol("grant_opportunities", "ifcdc_max_eligible_request", "REAL");
  await addCol("grant_opportunities", "ifcdc_recommended_request_min", "REAL");
  await addCol("grant_opportunities", "ifcdc_recommended_request_max", "REAL");
  await addCol("grant_opportunities", "ifcdc_addressable_amount", "REAL");
  await addCol("grant_opportunities", "addressable_status", "TEXT DEFAULT 'unknown'");
  await addCol("grant_opportunities", "addressable_explanation", "TEXT");
  await addCol("grant_opportunities", "match_required", "INTEGER DEFAULT 0");
  await addCol("grant_opportunities", "match_type", "TEXT");
  await addCol("grant_opportunities", "match_percentage", "TEXT");
  await addCol("grant_opportunities", "match_amount", "REAL");
  await addCol("grant_opportunities", "funding_period", "TEXT");
  await addCol("grant_opportunities", "applicant_restrictions", "TEXT");
  await addCol("grant_opportunities", "program_limitations", "TEXT");
  await addCol("grant_opportunities", "can_ifcdc_apply", "TEXT");
  await addCol("grant_opportunities", "org_requirements_met", "TEXT");
  await addCol("grant_opportunities", "awardability_json", "TEXT");
  await addCol("grant_opportunities", "application_readiness_score", "INTEGER");
  await addCol("grant_opportunities", "readiness_class", "TEXT");
  await addCol("grant_opportunities", "readiness_breakdown_json", "TEXT");
  await addCol("grant_opportunities", "document_gaps_json", "TEXT");
  await addCol("grant_opportunities", "missing_info_json", "TEXT");
  await addCol("grant_opportunities", "is_realistic_to_pursue", "INTEGER");
  await addCol("grant_opportunities", "pilot_rank", "INTEGER");
  await addCol("grant_opportunities", "awardability_verified_at", "TEXT");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_awardability_checks (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      can_apply TEXT,
      best_program_slug TEXT,
      addressable_amount REAL,
      recommended_min REAL,
      recommended_max REAL,
      match_required INTEGER,
      readiness_class TEXT,
      readiness_score INTEGER,
      missing_docs_json TEXT,
      answers_json TEXT,
      official_source_url TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_awardability_opp ON grant_awardability_checks(opportunity_id);
  `);
}

/**
 * Phase 8A.4 — Grant Evidence Vault index + opportunity requirement checklists.
 * Extends hq_documents / grant_documents; does not invent files.
 */
async function migrateGrantPhase8A4(): Promise<void> {
  const db = await getDb();
  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };

  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_evidence_records (
      id TEXT PRIMARY KEY,
      evidence_type TEXT NOT NULL,
      title TEXT NOT NULL,
      hq_document_id TEXT,
      grant_document_id TEXT,
      file_url TEXT,
      effective_date TEXT,
      expiration_date TEXT,
      verification_status TEXT NOT NULL DEFAULT 'missing',
      source TEXT,
      program_slug TEXT,
      opportunity_id TEXT,
      last_reviewed_at TEXT,
      aura_confidence REAL DEFAULT 0,
      founder_approved INTEGER DEFAULT 0,
      notes TEXT,
      reusable INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_type ON grant_evidence_records(evidence_type);
    CREATE INDEX IF NOT EXISTS idx_evidence_status ON grant_evidence_records(verification_status);
    CREATE INDEX IF NOT EXISTS idx_evidence_hq_doc ON grant_evidence_records(hq_document_id);

    CREATE TABLE IF NOT EXISTS grant_opportunity_requirements (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      requirement_key TEXT NOT NULL,
      label TEXT NOT NULL,
      category TEXT NOT NULL,
      mandatory INTEGER DEFAULT 1,
      source_excerpt TEXT,
      extraction_source TEXT,
      page_limit TEXT,
      file_format TEXT,
      match_status TEXT DEFAULT 'missing',
      evidence_record_id TEXT,
      gap_bucket TEXT,
      hard_blocker INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(opportunity_id, requirement_key)
    );
    CREATE INDEX IF NOT EXISTS idx_req_opp ON grant_opportunity_requirements(opportunity_id);

    CREATE TABLE IF NOT EXISTS grant_requirement_evidence_links (
      id TEXT PRIMARY KEY,
      requirement_id TEXT NOT NULL,
      evidence_record_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      link_note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(requirement_id, evidence_record_id)
    );

    CREATE TABLE IF NOT EXISTS grant_readiness_gap_reports (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      available_json TEXT,
      needs_update_json TEXT,
      can_generate_json TEXT,
      founder_input_json TEXT,
      third_party_json TEXT,
      hard_blockers_json TEXT,
      summary_json TEXT,
      readiness_class TEXT,
      readiness_score INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gap_opp ON grant_readiness_gap_reports(opportunity_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS grant_pilot_capacity_audits (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      findings_json TEXT NOT NULL,
      risk_factors_json TEXT,
      official_source_url TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pilot_audit_opp ON grant_pilot_capacity_audits(opportunity_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS grant_document_versions (
      id TEXT PRIMARY KEY,
      grant_document_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT,
      file_url TEXT,
      change_notes TEXT,
      uploaded_by TEXT,
      application_id TEXT,
      opportunity_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_grant_doc_versions ON grant_document_versions(grant_document_id);
  `);

  await addCol("grant_opportunities", "gap_report_json", "TEXT");
  await addCol("grant_opportunities", "hard_blocker_count", "INTEGER DEFAULT 0");
  await addCol("grant_opportunities", "requirement_count", "INTEGER DEFAULT 0");
  await addCol("grant_opportunities", "requirements_met_count", "INTEGER DEFAULT 0");
  await addCol("grant_opportunities", "evidence_readiness_at", "TEXT");
  await addCol("grant_opportunities", "pilot_audit_recommendation", "TEXT");
  await addCol("grant_documents", "version", "INTEGER DEFAULT 1");
  await addCol("grant_documents", "effective_date", "TEXT");
  await addCol("grant_documents", "expiration_date", "TEXT");
  await addCol("hq_documents", "evidence_type", "TEXT");
  await addCol("hq_documents", "effective_date", "TEXT");
  await addCol("hq_documents", "expiration_date", "TEXT");
  await addCol("hq_documents", "verification_status", "TEXT");
}

/**
 * Phase 8A.5 — Evidence population, org grant profile snapshot, unlock events.
 * Does not invent documents; banking evidence stays status-only in API consumers.
 */
async function migrateGrantPhase8A5(): Promise<void> {
  const db = await getDb();
  const addCol = async (table: string, col: string, type: string) => {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* exists */
    }
  };

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ifcdc_org_grant_profiles (
      id TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL,
      verified_fields_json TEXT,
      unknown_fields_json TEXT,
      source_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grant_evidence_unlock_events (
      id TEXT PRIMARY KEY,
      evidence_type TEXT NOT NULL,
      opportunity_id TEXT,
      addressable_amount REAL,
      readiness_class_before TEXT,
      readiness_class_after TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_unlock_evidence ON grant_evidence_unlock_events(evidence_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_unlock_opp ON grant_evidence_unlock_events(opportunity_id);
  `);

  await addCol("grant_evidence_records", "associated_opportunity_ids_json", "TEXT");
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
