import bcrypt from "bcryptjs";
import { setMonolithDb } from "./dbAccess";
import { ROLES, cryptoRandomId } from "./constants";
import { getDataDir, getDbPath } from "../config/dataPaths";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";

interface LegacyUser {
  id: string;
  name: string;
  email: string;
  role: string;
  password_hash: string | null;
  created_at: string;
}

export interface FounderSeedConfig {
  email: string;
  seedPassword: string;
  name: string;
  grantsOperator?: {
    email: string;
    seedPassword: string;
    name: string;
  };
}

export async function initLegacyMonolithDb(founder: FounderSeedConfig): Promise<Database> {
  getDataDir();

  const db = await open({
    filename: getDbPath(),
    driver: sqlite3.Database,
  });
  setMonolithDb(db);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT,
      created_at TEXT NOT NULL,
      replit_id TEXT UNIQUE,
      profile_image_url TEXT,
      twofa_secret TEXT,
      twofa_enabled INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      date_of_birth TEXT,
      phone TEXT,
      email TEXT,
      programs TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS encounters (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      program TEXT NOT NULL,
      type TEXT NOT NULL,
      summary TEXT,
      note TEXT,
      created_by TEXT NOT NULL,
      created_by_role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      user_id TEXT,
      user_role TEXT,
      method TEXT,
      path TEXT,
      entity_type TEXT,
      entity_id TEXT,
      action TEXT,
      ip_address TEXT,
      extra TEXT
    );
  `);

  const auditCols = await db.all("PRAGMA table_info(audit_logs)") as { name: string }[];
  if (!auditCols.some((c: { name: string }) => c.name === "ip_address")) {
    await db.exec("ALTER TABLE audit_logs ADD COLUMN ip_address TEXT");
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS client_assignments (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      program TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      location TEXT,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS appointment_notifications (
      id TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      lead_hour INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS outreach_tasks (
      id TEXT PRIMARY KEY,
      client_id TEXT,
      phone TEXT NOT NULL,
      channel TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_widgets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      widget_type TEXT NOT NULL,
      title TEXT,
      layout TEXT NOT NULL,
      settings TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  await db.exec(`CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_user ON dashboard_widgets(user_id);`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS programs (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT
    );
  `);

  // --- Notification preferences per client ---
  try {
    await db.exec(`ALTER TABLE clients ADD COLUMN notify_channel TEXT`);
  } catch (e) {
    // column probably already exists; ignore
  }

  // --- 2FA columns for users ---
  try {
    await db.exec(`ALTER TABLE users ADD COLUMN twofa_secret TEXT`);
  } catch (e) {}
  try {
    await db.exec(`ALTER TABLE users ADD COLUMN twofa_enabled INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    await db.exec(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'`);
  } catch (e) {}

  // --- Per-program reminder lead hours ---
  try {
    await db.exec(`ALTER TABLE programs ADD COLUMN default_sms_lead_hours INTEGER`);
  } catch (e) {}

  try {
    await db.exec(`ALTER TABLE programs ADD COLUMN default_voice_lead_hours INTEGER`);
  } catch (e) {}

  // Seed basic IFCDC programs if table is empty
  const progCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM programs");
  if (!progCount || progCount.count === 0) {
    const seedPrograms = [
      { code: "MENTAL_HEALTH", name: "Mental Health Services" },
      { code: "HOUSING", name: "Transitional Housing" },
      { code: "ANTI_GANG", name: "Anti-Gang Intervention" },
      { code: "ECON_DEV", name: "Economic Development & Jobs" },
    ];
    for (const p of seedPrograms) {
      await db.run(
        `INSERT INTO programs (id, code, name, description) VALUES (?, ?, ?, ?)`,
        cryptoRandomId(), p.code, p.name, ""
      );
    }
    console.log("Seeded", seedPrograms.length, "IFCDC programs.");
  }

  // Defaults: Housing 48h SMS, MH 24h SMS; voice off by default
  await db.run(
    `UPDATE programs
     SET default_sms_lead_hours = 48
     WHERE code = 'HOUSING' AND default_sms_lead_hours IS NULL`
  );
  await db.run(
    `UPDATE programs
     SET default_sms_lead_hours = 24
     WHERE code = 'MENTAL_HEALTH' AND default_sms_lead_hours IS NULL`
  );
  await db.run(
    `UPDATE programs
     SET default_sms_lead_hours = 24
     WHERE code = 'ANTI_GANG' AND default_sms_lead_hours IS NULL`
  );
  await db.run(
    `UPDATE programs
     SET default_sms_lead_hours = 24
     WHERE code = 'ECON_DEV' AND default_sms_lead_hours IS NULL`
  );

  // Voice defaults = null (you can turn them on later if you want)
  await db.run(
    `UPDATE programs
     SET default_voice_lead_hours = NULL
     WHERE default_voice_lead_hours IS NULL`
  );

  await db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      program TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      target_date TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  // HR Employees table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      role TEXT NOT NULL,
      location TEXT,
      start_date TEXT,
      status TEXT DEFAULT 'onboarding',
      notes TEXT,
      pay_rate REAL,
      pay_currency TEXT DEFAULT 'USD',
      pay_type TEXT DEFAULT 'hourly',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Staffing Plan table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS staffing_plan (
      id TEXT PRIMARY KEY,
      role_key TEXT UNIQUE NOT NULL,
      role_name TEXT NOT NULL,
      target_count INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Seed default staffing plan if empty
  const staffingPlanCount = await db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM staffing_plan");
  if (staffingPlanCount && staffingPlanCount.cnt === 0) {
    const now = new Date().toISOString();
    const roles = [
      { key: "barber", name: "Barber", target: 5, priority: 1 },
      { key: "radio_host", name: "Radio Host", target: 3, priority: 2 },
      { key: "program_staff", name: "Program Staff", target: 4, priority: 3 },
      { key: "admin", name: "Admin", target: 2, priority: 4 },
      { key: "clinician", name: "Clinician", target: 2, priority: 5 },
      { key: "case_manager", name: "Case Manager", target: 2, priority: 6 },
      { key: "chw", name: "Community Health Worker", target: 3, priority: 7 },
    ];
    for (const r of roles) {
      await db.run(
        `INSERT INTO staffing_plan (id, role_key, role_name, target_count, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        cryptoRandomId(), r.key, r.name, r.target, r.priority, now, now
      );
    }
  }

  // Services table for admin-managed services
  await db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      duration INTEGER DEFAULT 30,
      price REAL DEFAULT 0,
      category TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Logic Models table for program frameworks
  await db.exec(`
    CREATE TABLE IF NOT EXISTS logic_models (
      id TEXT PRIMARY KEY,
      program_code TEXT NOT NULL,
      program_name TEXT NOT NULL,
      inputs TEXT NOT NULL,
      activities TEXT NOT NULL,
      outputs TEXT NOT NULL,
      short_term_outcomes TEXT NOT NULL,
      mid_term_outcomes TEXT NOT NULL,
      long_term_impact TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Funding sources table for payment methods
  await db.exec(`
    CREATE TABLE IF NOT EXISTS funding_sources (
      id TEXT PRIMARY KEY,
      source_key TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      sandbox INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // Seed default funding sources if empty
  const fundingCount = await db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM funding_sources");
  if (fundingCount && fundingCount.cnt === 0) {
    const now = new Date().toISOString();
    const sources = [
      { key: "stripe", name: "Stripe (Cards & Wallets)", enabled: 1, sandbox: 0 },
      { key: "paypal", name: "PayPal", enabled: 1, sandbox: 0 },
      { key: "venmo", name: "Venmo", enabled: 0, sandbox: 0 },
      { key: "ach", name: "ACH / Wire", enabled: 0, sandbox: 0 },
      { key: "crypto", name: "Crypto (Sandbox)", enabled: 0, sandbox: 1 }
    ];
    for (const s of sources) {
      await db.run(
        `INSERT INTO funding_sources (id, source_key, display_name, enabled, sandbox, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        cryptoRandomId(), s.key, s.name, s.enabled, s.sandbox, now
      );
    }
    console.log("Seeded", sources.length, "funding sources.");
  }

  // Funding events table for tracking all payment transactions
  await db.exec(`
    CREATE TABLE IF NOT EXISTS funding_events (
      id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL,
      intent TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT DEFAULT 'USD',
      external_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Policy versions table for managing organizational policies
  await db.exec(`
    CREATE TABLE IF NOT EXISTS policy_versions (
      id TEXT PRIMARY KEY,
      policy_name TEXT NOT NULL,
      version TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      effective_date TEXT,
      status TEXT DEFAULT 'draft',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_policy_name ON policy_versions(policy_name);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_policy_status ON policy_versions(status);`);

  // Seed Violence Prevention Logic Model if not exists
  const existingLogicModel = await db.get("SELECT 1 FROM logic_models WHERE program_code = ?", "VIOLENCE_PREVENTION");
  if (!existingLogicModel) {
    const logicModelId = cryptoRandomId();
    const now = new Date().toISOString();
    
    const inputs = JSON.stringify([
      "IFCDC staff (outreach, mentors, case managers)",
      "Evidence-based curriculum",
      "Community partners + schools",
      "Workforce partners",
      "Evaluation team",
      "IFCDC Radio + outreach platforms"
    ]);
    
    const activities = JSON.stringify([
      "Violence interruption & mediation",
      "Mentorship sessions (weekly)",
      "Intake, screening, case management",
      "Workforce training + placement",
      "Family engagement",
      "Public awareness & prevention messaging"
    ]);
    
    const outputs = JSON.stringify([
      "# of youth enrolled",
      "# of outreach engagements",
      "# of conflicts interrupted",
      "# of families connected to supports",
      "# of jobs/internships secured",
      "# of prevention messages broadcast"
    ]);
    
    const shortTermOutcomes = JSON.stringify([
      "Increased conflict resolution skills",
      "Increased school engagement",
      "Increased access to resources",
      "Reduced exposure to violent peers"
    ]);
    
    const midTermOutcomes = JSON.stringify([
      "Reduced violent incidents among participants",
      "Increased employment rates",
      "Increased family stability",
      "Reduced school suspensions"
    ]);
    
    const longTermImpact = JSON.stringify([
      "Reduction in community violence",
      "Reduced gang involvement",
      "Increased economic mobility",
      "Improved community safety and wellbeing"
    ]);

    await db.run(
      `INSERT INTO logic_models (id, program_code, program_name, inputs, activities, outputs, short_term_outcomes, mid_term_outcomes, long_term_impact, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      logicModelId, "VIOLENCE_PREVENTION", "Violence Prevention Program", inputs, activities, outputs, shortTermOutcomes, midTermOutcomes, longTermImpact, now, now
    );
    console.log("Seeded Violence Prevention Logic Model");
  }

  const execUser = await db.get<LegacyUser>("SELECT * FROM users WHERE role = ? LIMIT 1", ROLES.EXEC);

  if (!execUser) {
    const id = cryptoRandomId();
    const name = "Mr. Fahreal Allah";
    const email = "exec@ifcdc.org";
    const rawPassword = "IFCDCExec!2025";
    const password_hash = await bcrypt.hash(rawPassword, 10);
    const created_at = new Date().toISOString();

    await db.run(
      `INSERT INTO users (id, name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      id, name, email, ROLES.EXEC, password_hash, created_at
    );

    console.log("===============================================");
    console.log("EXEC user seeded for IFCDC:");
    console.log("Email:", email);
    console.log("ROLE:", ROLES.EXEC);
    console.log("Log in via /auth/login to generate a JWT.");
    console.log("===============================================");
  }

  await ensureFounderAccount(db, founder);
  if (founder.grantsOperator?.email && founder.grantsOperator.seedPassword) {
    await ensureGrantOperatorAccount(db, founder.grantsOperator);
  }
  await enforceCredentialSeparation(db, founder.email, founder.grantsOperator?.email);

  return db;
}

async function enforceCredentialSeparation(
  db: Database,
  superAdminEmail: string,
  grantsOperatorEmail?: string,
): Promise<void> {
  const superEmail = superAdminEmail.toLowerCase();
  if (grantsOperatorEmail && grantsOperatorEmail.toLowerCase() !== superEmail) {
    const row = await db.get<{ role: string }>("SELECT role FROM users WHERE email = ?", grantsOperatorEmail.toLowerCase());
    if (row?.role === "owner" || row?.role === "admin") {
      await db.run(
        `UPDATE users SET role = 'grant_manager' WHERE email = ?`,
        grantsOperatorEmail.toLowerCase(),
      );
      console.log("Credential separation: grants operator demoted from HQ admin role:", grantsOperatorEmail);
    }
  }
  const strayOwners = (await db.all(
    "SELECT email FROM users WHERE role = 'owner' AND email != ?",
    superEmail,
  )) as { email: string }[];
  for (const u of strayOwners) {
    await db.run(`UPDATE users SET role = 'grant_manager' WHERE email = ?`, u.email);
    console.log("Credential separation: removed duplicate owner role from:", u.email);
  }
}

async function ensureGrantOperatorAccount(
  db: Database,
  operator: { email: string; seedPassword: string; name: string },
): Promise<void> {
  const email = operator.email.toLowerCase();
  const password_hash = await bcrypt.hash(operator.seedPassword, 10);
  const created_at = new Date().toISOString();
  const existing = await db.get<LegacyUser>("SELECT * FROM users WHERE email = ?", email);

  if (existing) {
    await db.run(
      `UPDATE users SET name = ?, role = 'grant_manager', password_hash = ?, status = 'active' WHERE email = ?`,
      operator.name, password_hash, email,
    );
    console.log("Grants operator account ready:", email);
  } else {
    await db.run(
      `INSERT INTO users (id, name, email, role, password_hash, created_at, status, twofa_enabled) VALUES (?, ?, ?, 'grant_manager', ?, ?, 'active', 0)`,
      cryptoRandomId(), operator.name, email, password_hash, created_at,
    );
    console.log("Grants operator account created:", email);
  }
}

async function ensureFounderAccount(db: Database, founder: FounderSeedConfig) {
  const email = founder.email;
  const password_hash = await bcrypt.hash(founder.seedPassword, 10);
  const created_at = new Date().toISOString();
  const existing = await db.get<LegacyUser>("SELECT * FROM users WHERE email = ?", email);

  if (existing) {
    await db.run(
      `UPDATE users SET name = ?, role = ?, password_hash = ?, status = 'active' WHERE email = ?`,
      founder.name, "owner", password_hash, email,
    );
    console.log("Super Admin account ready:", email);
  } else {
    await db.run(
      `INSERT INTO users (id, name, email, role, password_hash, created_at, status, twofa_enabled) VALUES (?, ?, ?, ?, ?, ?, 'active', 0)`,
      cryptoRandomId(), founder.name, email, "owner", password_hash, created_at,
    );
    console.log("Super Admin account created:", email);
  }

  const emp = await db.get("SELECT id FROM employees WHERE email = ?", email);
  if (!emp) {
    const empId = cryptoRandomId();
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO employees (id, first_name, last_name, email, phone, role, location, start_date, status, notes, pay_rate, pay_currency, pay_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, 'USD', 'salary', ?, ?)`,
      empId, "Fahreal", "Allah", email, null, "Executive Director", "Asbury Park, NJ", now.slice(0, 10),
      "IFCDC Founder — Headquarters executive profile", now, now
    );
  } else {
    await db.run(
      `UPDATE employees SET first_name = ?, last_name = ?, role = ?, status = 'active', updated_at = ? WHERE email = ?`,
      "Fahreal", "Allah", "Executive Director", new Date().toISOString(), email
    );
  }
}

