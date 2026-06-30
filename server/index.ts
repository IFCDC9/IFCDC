import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import bcrypt from "bcryptjs";
import twilio from "twilio";
import cookieParser from "cookie-parser";
import OpenAI from "openai";
import rateLimit from "express-rate-limit";
import donationsRouter from "./routes/donations";
import adminFundingRouter from "./routes/adminFunding";
import hqRouter from "./routes/hq.routes";
import enterpriseApiRouter from "./routes/enterpriseApi.routes";
import { ensureGrantTables } from "./hq/grantsSchema";
import { ensurePeopleTables } from "./hq/peopleSchema";
import { ensureFinanceTables } from "./hq/financeSchema";
import { ensureOperationsTables } from "./hq/operationsSchema";
import { ensureDashboardTables } from "./hq/dashboardSchema";
import { ensureSoftwareDivisionTables } from "./hq/softwareDivisionSchema";
import { ensureDeveloperAuditTables } from "./hq/hqDeveloperAudit";
import { ensureExecutiveBriefingsTable, getOrGenerateDailyBriefing } from "./hq/executiveBriefings";
import { ensureBoardPortalTables } from "./hq/boardPortalSchema";
import { ensureHqAuditTables } from "./hq/hqAuditLog";
import { ensureWarehouseTables } from "./hq/analyticsWarehouseSchema";
import { ensureWorkflowTables } from "./hq/workflowEngineSchema";
import { ensureBackupTables } from "./hq/hqBackupService";
import { ensureSecuritySessionTables } from "./hq/hqSecuritySessions";
import { ensureProgramModuleTables } from "./hq/programsSchema";
import { ensureEnterpriseReadinessSeed } from "./hq/enterpriseReadinessSeed";
import { ensureNotificationQueueTables } from "./hq/notificationQueue";
import { ensureCommunicationsTables } from "./hq/communicationsSchema";
import { ensureDocumentTables } from "./hq/documentsSchema";
import { ensureHqFileRegistry } from "./hq/hqFileStorage";
import { syncGrantFeeds } from "./hq/grantFeedConnectors";
import { attachHqRealtimeHub } from "./hq/hqRealtimeHub";
import { getAppRoot, getDistPublicDir, getPublicDir, getSpaIndexPath } from "./appPaths";
import { assertProductionEnv } from "./config/validateProductionEnv";
import { registerMonolithRoutes, registerMonolithCronRoutes } from "./routes/monolith";
import { setMonolithDb } from "./monolith/dbAccess";
import { hasClientAccess } from "./monolith/clientAccess";
import { createTwilioSenders } from "./monolith/twilioHelpers";
import {
  buildSafeAppointmentReminderText,
  isSmsAllowedForChannel,
  normalizeChannel,
  normalizePhone,
} from "./monolith/phoneUtils";
import { logAudit } from "./monolith/audit";
import { ROLES, ROLE_VALUES, assignRole, cryptoRandomId } from "./monolith/constants";
import { initGoogleOAuth } from "./monolith/googleOAuth";
import { authRequired, requireAdmin, requireRole } from "./middleware/legacyAuth";
import http from "http";

assertProductionEnv();

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey,
  });
}

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);
const isDev = process.env.NODE_ENV !== "production";

if (!isDev) {
  app.set("trust proxy", 1);
}

if (isDev) {
  console.log('DEV MODE ACTIVE');
}

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_SMS_FROM,
  TWILIO_VOICE_FROM,
  PUBLIC_IFCDC_PHONE,
  PUBLIC_APP_URL,
  CRON_SECRET_TOKEN,
  APPT_REMINDER_LEAD_HOURS,
  MASTER_OWNER_EMAIL,
} = process.env;

const ADMIN_EMAIL = "813786b@gmail.com";
const FOUNDER_EMAIL = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
const FOUNDER_SEED_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";
const FOUNDER_NAME = process.env.FOUNDER_NAME || "Mr. Fahreal Allah";

function assignRoleForEmail(email: string): string {
  return assignRole(email, FOUNDER_EMAIL);
}

// Only initialize Twilio if credentials are properly configured (SID must start with AC)
// Trim whitespace that may have been accidentally added
const twilioAccountSid = TWILIO_ACCOUNT_SID?.trim();
const twilioAuthToken = TWILIO_AUTH_TOKEN?.trim();
const twilioClient =
  twilioAccountSid && twilioAuthToken && twilioAccountSid.startsWith("AC")
    ? twilio(twilioAccountSid, twilioAuthToken)
    : null;

if (twilioAccountSid && !twilioAccountSid.startsWith("AC")) {
  console.warn("Warning: TWILIO_ACCOUNT_SID does not start with 'AC'. Twilio SMS disabled.");
}

const twilioSenders = createTwilioSenders({
  twilioClient,
  smsFrom: TWILIO_SMS_FROM,
  voiceFrom: TWILIO_VOICE_FROM,
  publicAppUrl: PUBLIC_APP_URL,
});
const { sendSafeSms, sendVoiceReminderCall } = twilioSenders;

app.use(express.json());
app.use(cookieParser());
app.use("/api", donationsRouter);
app.use("/api/admin", adminFundingRouter);
app.use("/api/hq", hqRouter);
app.use("/api/hq/v1", enterpriseApiRouter);
const monolithDeps = {
  twilio: twilioSenders,
  twilioClient,
  twilioSmsFrom: TWILIO_SMS_FROM,
  cronSecret: CRON_SECRET_TOKEN,
  apptReminderLeadHours: APPT_REMINDER_LEAD_HOURS,
  publicIfcdcPhone: PUBLIC_IFCDC_PHONE,
};
registerMonolithRoutes(app, monolithDeps);
registerMonolithCronRoutes(app, monolithDeps);

const publicDir = getPublicDir();
// Serve static assets from public/ but don't serve index.html (let Vite handle SPA)
app.use(express.static(publicDir, { index: false }));

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  password_hash: string | null;
  created_at: string;
  replit_id?: string | null;
  profile_image_url?: string | null;
}

declare global {
  namespace Express {
    interface User {
      id: string;
      name?: string;
      email?: string;
      role: string;
      claims?: {
        id: string;
        email?: string;
        first_name?: string;
        last_name?: string;
        profile_image_url?: string;
      };
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
    }
    interface Request {
      user?: User;
    }
  }
}

let db: Database;

async function initDb() {
  const dataDir = path.join(import.meta.dirname, "..", "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = await open({
    filename: path.join(dataDir, "ifcdc.db"),
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

  const execUser = await db.get<User>("SELECT * FROM users WHERE role = ? LIMIT 1", ROLES.EXEC);

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

  await ensureFounderAccount();
}

async function ensureFounderAccount() {
  const email = FOUNDER_EMAIL;
  const password_hash = await bcrypt.hash(FOUNDER_SEED_PASSWORD, 10);
  const created_at = new Date().toISOString();
  const existing = await db.get<User>("SELECT * FROM users WHERE email = ?", email);

  if (existing) {
    await db.run(
      `UPDATE users SET name = ?, role = ?, password_hash = ?, status = 'active', twofa_enabled = 0 WHERE email = ?`,
      FOUNDER_NAME, "owner", password_hash, email
    );
    console.log("Founder / Super Admin account ready:", email);
  } else {
    await db.run(
      `INSERT INTO users (id, name, email, role, password_hash, created_at, status, twofa_enabled) VALUES (?, ?, ?, ?, ?, ?, 'active', 0)`,
      cryptoRandomId(), FOUNDER_NAME, email, "owner", password_hash, created_at
    );
    console.log("Founder / Super Admin account created:", email);
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

async function findAppointmentsNeedingReminder(leadHours: number) {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + leadHours * 60 * 60 * 1000);

  const nowIso = now.toISOString();
  const endIso = windowEnd.toISOString();

  const rows = await db.all<any[]>(
    `
    SELECT a.id, a.client_id, a.program, a.start_time, a.location,
           c.full_name, c.phone
    FROM appointments a
    JOIN clients c ON c.id = a.client_id
    WHERE a.start_time >= ?
      AND a.start_time < ?
      AND c.phone IS NOT NULL
      AND c.phone <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM appointment_notifications an
        WHERE an.appointment_id = a.id
          AND an.channel = 'SMS'
          AND an.lead_hour = ?
      )
    ORDER BY a.start_time ASC
    `,
    nowIso,
    endIso,
    leadHours
  );

  return rows;
}

async function recordAppointmentNotification(
  appointmentId: string,
  channel: string,
  leadHours: number,
  status: string,
  errorMessage?: string | null
) {
  const id = cryptoRandomId();
  const created_at = new Date().toISOString();

  await db.run(
    `
    INSERT INTO appointment_notifications (
      id, appointment_id, channel, lead_hour, status, error, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    appointmentId,
    channel,
    leadHours,
    status,
    errorMessage || null,
    created_at
  );
}

async function findSmsReminderCandidates(
  programMap: Record<string, { sms: number | null; voice: number | null }>,
  globalFallbackHours: number
): Promise<any[]> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 96 * 60 * 60 * 1000);

  const nowIso = now.toISOString();
  const endIso = windowEnd.toISOString();

  const rows = await db.all<any[]>(
    `
    SELECT a.id, a.client_id, a.program, a.start_time, a.location,
           c.full_name, c.phone, c.notify_channel
    FROM appointments a
    JOIN clients c ON c.id = a.client_id
    WHERE a.start_time >= ?
      AND a.start_time < ?
      AND c.phone IS NOT NULL
      AND c.phone <> ''
    ORDER BY a.start_time ASC
    `,
    nowIso,
    endIso
  );

  const candidates: any[] = [];
  for (const appt of rows) {
    const chan = normalizeChannel(appt.notify_channel);
    if (!isSmsAllowedForChannel(chan)) continue;

    const programCode = appt.program || "";
    const leadHours = resolveSmsLeadHours(programCode, programMap, globalFallbackHours);
    if (!leadHours || leadHours <= 0) continue;

    const start = new Date(appt.start_time);
    const diffMs = start.getTime() - now.getTime();
    const diffHours = diffMs / (60 * 60 * 1000);

    if (diffHours < leadHours || diffHours >= leadHours + 24) continue;

    const exists = await appointmentNotificationExists(appt.id, "SMS", leadHours);
    if (exists) continue;

    candidates.push({ ...appt, leadHours });
  }

  return candidates;
}

async function appointmentNotificationExists(
  appointmentId: string,
  channel: string,
  leadHours: number
): Promise<boolean> {
  const row = await db.get(
    `
    SELECT 1
    FROM appointment_notifications
    WHERE appointment_id = ?
      AND channel = ?
      AND lead_hour = ?
    LIMIT 1
    `,
    appointmentId,
    channel,
    leadHours
  );
  return !!row;
}

async function getProgramLeadHoursMap(): Promise<Record<string, { sms: number | null; voice: number | null }>> {
  const rows = await db.all<any[]>(
    `SELECT code, default_sms_lead_hours, default_voice_lead_hours FROM programs`
  );
  const map: Record<string, { sms: number | null; voice: number | null }> = {};
  for (const r of rows) {
    map[r.code] = {
      sms: r.default_sms_lead_hours,
      voice: r.default_voice_lead_hours,
    };
  }
  return map;
}

function resolveSmsLeadHours(
  programCode: string,
  programMap: Record<string, { sms: number | null; voice: number | null }>,
  globalFallbackHours: number
): number {
  const entry = programMap[programCode] || {};
  const v = entry.sms;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return globalFallbackHours;
}

function resolveVoiceLeadHours(
  programCode: string,
  programMap: Record<string, { sms: number | null; voice: number | null }>,
  globalFallbackHours: number
): number {
  const entry = programMap[programCode] || {};
  const v = entry.voice;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return globalFallbackHours;
}



// ----- Legacy HR (deprecated Phase 3.1 — use /api/hq/people) -----

app.all("/api/hr/employees", (_req, res) => {
  res.status(410).json({ error: "Deprecated. Use GET/POST /api/hq/people", migration: "phase3.1" });
});

app.all("/api/hr/staffing-overview", (_req, res) => {
  res.status(410).json({ error: "Deprecated. Use GET /api/hq/people/staffing-overview", migration: "phase3.1" });
});

// ----- Barbershop Booking Endpoints -----

// Barbershop services list
const BARBERSHOP_SERVICES = [
  { id: "haircut", name: "Haircut", duration: 30, price: 25 },
  { id: "beard", name: "Beard Trim", duration: 15, price: 15 },
  { id: "haircut_beard", name: "Haircut + Beard", duration: 45, price: 35 },
  { id: "lineup", name: "Line Up / Edge Up", duration: 15, price: 15 },
  { id: "kids_cut", name: "Kids Cut (12 & Under)", duration: 25, price: 20 },
  { id: "shave", name: "Full Shave", duration: 30, price: 25 },
];

app.get("/api/barbershop/services", authRequired, async (_req, res) => {
  res.json(BARBERSHOP_SERVICES);
});

app.get("/api/barbershop/barbers", authRequired, async (_req, res) => {
  try {
    const barbers = await db.all<any[]>(
      `SELECT id, first_name, last_name, email, phone FROM employees WHERE role = 'barber' AND status = 'active' ORDER BY first_name`
    );
    res.json(barbers.map(b => ({
      id: b.id,
      firstName: b.first_name,
      lastName: b.last_name,
      name: `${b.first_name} ${b.last_name}`,
      email: b.email,
      phone: b.phone,
    })));
  } catch (err) {
    console.error("Error fetching barbers:", err);
    res.status(500).json({ error: "Failed to load barbers" });
  }
});

app.post("/api/barbershop/book", authRequired, requireRole("barber", "admin", "owner", ROLES.EXEC), async (req, res) => {
  try {
    const { clientFirstName, clientLastName, clientPhone, clientEmail, serviceId, barberId, date, startTime, notes } = req.body;

    // Validate required fields
    if (!clientFirstName || !clientLastName || !serviceId || !barberId || !date || !startTime) {
      return res.status(400).json({ error: "Missing required fields: clientFirstName, clientLastName, serviceId, barberId, date, startTime" });
    }

    const fullName = `${clientFirstName} ${clientLastName}`;

    // Find or create client - use correct schema with phone/email columns
    let client = await db.get<any>(
      `SELECT id, notify_channel FROM clients WHERE LOWER(full_name) = LOWER(?) OR (phone = ? AND phone IS NOT NULL AND phone != '')`,
      [fullName, clientPhone || null]
    );

    if (!client) {
      const clientId = cryptoRandomId();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO clients (id, full_name, phone, email, programs, notify_channel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        clientId, fullName, clientPhone || null, clientEmail || null, JSON.stringify(["BARBERSHOP"]), 'SMS', now
      );
      client = { id: clientId, notify_channel: 'SMS' };
    }

    // Get service details
    const service = BARBERSHOP_SERVICES.find(s => s.id === serviceId);
    if (!service) {
      return res.status(400).json({ error: "Invalid service" });
    }

    // Calculate end time
    const [hours, minutes] = startTime.split(":").map(Number);
    const startDateTime = new Date(`${date}T${startTime}:00`);
    const endDateTime = new Date(startDateTime.getTime() + service.duration * 60000);
    const endTime = `${String(endDateTime.getHours()).padStart(2, '0')}:${String(endDateTime.getMinutes()).padStart(2, '0')}`;

    const startISO = `${date}T${startTime}:00`;
    const endISO = `${date}T${endTime}:00`;

    // Check for conflicts - match by barber (created_by) on same day with overlapping times
    const conflicts = await db.get<any>(
      `SELECT id FROM appointments 
       WHERE program = 'BARBERSHOP' 
       AND created_by = ?
       AND start_time >= ? AND start_time < ?
       AND (
         (start_time < ? AND end_time > ?)
         OR (start_time >= ? AND start_time < ?)
       )`,
      barberId, `${date}T00:00:00`, `${date}T23:59:59`, endISO, startISO, startISO, endISO
    );

    if (conflicts) {
      return res.status(409).json({ error: "Time slot conflicts with existing appointment" });
    }

    // Create appointment - store service name in notes for display
    const appointmentId = cryptoRandomId();
    const now = new Date().toISOString();
    const appointmentNotes = `[${service.name}]${notes ? ' ' + notes : ''}`;

    await db.run(
      `INSERT INTO appointments (id, client_id, program, start_time, end_time, location, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      appointmentId, client.id, "BARBERSHOP", startISO, endISO, "IFCDC Barbershop", appointmentNotes, barberId, now
    );

    await logAudit(req, { action: "CREATE_BARBERSHOP_BOOKING", targetType: "APPOINTMENT", targetId: appointmentId, extra: { 
      clientName: fullName, 
      service: service.name,
      date, 
      startTime,
      barberId 
    } });

    // Send SMS confirmation if client opted in, Twilio configured, and phone available
    const clientOptedIn = client.notify_channel === 'SMS' || !client.notify_channel;
    if (clientOptedIn && twilioClient && clientPhone) {
      try {
        const formattedDate = new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const smsBody = `IFCDC Barbershop: Your ${service.name} appointment is confirmed for ${formattedDate} at ${startTime}. See you soon!`;
        
        await twilioClient.messages.create({
          body: smsBody,
          from: TWILIO_SMS_FROM,
          to: clientPhone.startsWith('+') ? clientPhone : `+1${clientPhone.replace(/\D/g, '')}`
        });
        console.log(`SMS confirmation sent to ${clientPhone}`);
      } catch (smsErr) {
        console.error("SMS confirmation failed:", smsErr);
      }
    }

    res.status(201).json({
      id: appointmentId,
      clientId: client.id,
      clientName: fullName,
      service: service.name,
      serviceDuration: service.duration,
      date,
      startTime,
      endTime,
      barberId,
    });
  } catch (err) {
    console.error("Error creating booking:", err);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

// Send SMS reminder for a barbershop appointment
app.post("/api/barbershop/appointments/:id/send-reminder", authRequired, requireRole("barber", "admin", "owner", ROLES.EXEC), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if Twilio is configured for SMS
    if (!twilioClient || !TWILIO_SMS_FROM) {
      return res.status(503).json({ error: "SMS service is not configured. Please configure Twilio credentials." });
    }

    // Get the appointment with client info including notification preferences
    const appointment = await db.get<any>(
      `SELECT a.id, a.start_time, a.end_time, a.notes, a.program, c.id as client_id, c.full_name, c.phone, c.notify_channel
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       WHERE a.id = ? AND a.program = 'BARBERSHOP'`,
      id
    );

    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    if (!appointment.phone) {
      return res.status(400).json({ error: "Client has no phone number on file" });
    }

    // Check if client opted out of SMS notifications
    if (appointment.notify_channel === 'NONE') {
      return res.status(400).json({ error: "Client has opted out of SMS notifications" });
    }

    // Build the reminder message
    const reminderText = buildSafeAppointmentReminderText(
      { fullName: appointment.full_name },
      { start_time: appointment.start_time }
    );

    // Send SMS directly (only requires SMS_FROM, not VOICE_FROM)
    const phoneNorm = normalizePhone(appointment.phone);
    if (!phoneNorm) {
      return res.status(400).json({ error: "Invalid phone number format" });
    }
    await twilioClient.messages.create({
      to: phoneNorm,
      from: TWILIO_SMS_FROM,
      body: reminderText,
    });

    await logAudit(req, { action: "SEND_BARBERSHOP_REMINDER", targetType: "SMS", targetId: id, extra: {
      clientName: appointment.full_name,
      phone: appointment.phone,
      appointmentTime: appointment.start_time,
    } });

    res.json({ success: true, message: "Reminder sent successfully" });
  } catch (err: any) {
    console.error("Error sending reminder:", err);
    if (err.message?.includes("Twilio is not configured")) {
      return res.status(503).json({ error: "SMS service is not properly configured" });
    }
    res.status(500).json({ error: "Failed to send reminder: " + (err.message || "Unknown error") });
  }
});

// Test SMS endpoint - admin only
app.post("/api/test-sms", authRequired, requireRole("admin", "owner", ROLES.EXEC), async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!twilioClient || !TWILIO_SMS_FROM) {
      return res.status(503).json({ error: "SMS service is not configured. Ensure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_SMS_FROM are set." });
    }

    if (!to) {
      return res.status(400).json({ error: "Phone number (to) is required" });
    }

    const phoneNorm = normalizePhone(to);
    if (!phoneNorm) {
      return res.status(400).json({ error: "Invalid phone number format" });
    }

    const smsBody = message || "Test message from IFCDC Health System";

    // Direct SMS send without requiring TWILIO_VOICE_FROM
    await twilioClient.messages.create({
      to: phoneNorm,
      from: TWILIO_SMS_FROM,
      body: smsBody,
    });

    await logAudit(req, { action: "TEST_SMS", targetType: "SMS", targetId: "test", extra: { to: phoneNorm } });

    res.json({ success: true, message: "Test SMS sent successfully to " + phoneNorm });
  } catch (err: any) {
    console.error("Error sending test SMS:", err);
    res.status(500).json({ error: "Failed to send SMS: " + (err.message || "Unknown error") });
  }
});

// PayPal Integration Endpoints
app.get("/api/paypal/client-id", async (req, res) => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: "PayPal not configured" });
  }
  res.json({ clientId });
});

app.post("/api/paypal/create-order", async (req, res) => {
  try {
    const { amount, currency = "USD" } = req.body;
    
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const isLive = process.env.PAYPAL_ENV === "live";
    
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: "PayPal not configured" });
    }

    const baseUrl = isLive 
      ? "https://api-m.paypal.com" 
      : "https://api-m.sandbox.paypal.com";

    const authRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
      },
      body: "grant_type=client_credentials"
    });
    
    const authData = await authRes.json() as { access_token?: string };
    if (!authData.access_token) {
      throw new Error("Failed to get PayPal access token");
    }

    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authData.access_token}`
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          amount: {
            currency_code: currency,
            value: parseFloat(amount).toFixed(2)
          }
        }]
      })
    });

    const orderData = await orderRes.json();
    res.json(orderData);
  } catch (err: any) {
    console.error("PayPal create order error:", err);
    res.status(500).json({ error: "Failed to create PayPal order" });
  }
});

app.post("/api/paypal/webhook-log", async (req, res) => {
  try {
    const payload = req.body;
    
    const payerEmail = payload.payer?.email_address || null;
    const amount = payload.purchase_units?.[0]?.amount?.value || null;
    const currency = payload.purchase_units?.[0]?.amount?.currency_code || "USD";
    const transactionId = payload.id || null;
    
    console.log("PayPal donation received:", transactionId);
    
    const id = cryptoRandomId();
    const now = new Date().toISOString();
    
    // Log to funding_events table
    await db.run(`
      INSERT INTO funding_events (source_key, intent, amount_cents, currency, external_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `, "paypal", "donation", Math.round(parseFloat(amount) * 100), currency, transactionId, JSON.stringify(payload));
    
    // Also log to audit_logs
    await db.run(`
      INSERT INTO audit_logs (id, timestamp, user_id, user_role, method, path, entity_type, entity_id, action, ip_address, extra)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, now, null, null, "POST", "/api/paypal/webhook-log", "donation", transactionId, "PAYPAL_DONATION", 
       req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket?.remoteAddress || null,
       JSON.stringify({
         payer_email: payerEmail,
         amount: amount,
         currency: currency,
         transaction_id: transactionId,
         intent: "donation",
         source: "paypal",
         status: payload.status
       }));
    
    res.json({ logged: true });
  } catch (err) {
    console.error("PayPal webhook log error:", err);
    res.status(500).json({ error: "Failed to log donation" });
  }
});

app.post("/api/paypal/capture-order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const isLive = process.env.PAYPAL_ENV === "live";
    
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: "PayPal not configured" });
    }

    const baseUrl = isLive 
      ? "https://api-m.paypal.com" 
      : "https://api-m.sandbox.paypal.com";

    const authRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
      },
      body: "grant_type=client_credentials"
    });
    
    const authData = await authRes.json() as { access_token?: string };
    if (!authData.access_token) {
      throw new Error("Failed to get PayPal access token");
    }

    const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authData.access_token}`
      }
    });

    const captureData = await captureRes.json();
    res.json(captureData);
  } catch (err: any) {
    console.error("PayPal capture order error:", err);
    res.status(500).json({ error: "Failed to capture PayPal order" });
  }
});

// Public booking endpoint (no auth required) - creates a booking request
app.post("/api/public/book-barbershop", async (req, res) => {
  try {
    const { firstName, lastName, phone, email, service, serviceName, date, time, notes, smsOptIn } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !phone || !service || !date || !time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const fullName = `${firstName} ${lastName}`;

    // Find or create client, storing SMS preference
    const notifyChannel = smsOptIn !== false ? 'SMS' : 'NONE';
    let client = await db.get<any>(
      `SELECT id, notify_channel FROM clients WHERE phone = ? AND phone IS NOT NULL`,
      [phone]
    );

    if (!client) {
      const clientId = cryptoRandomId();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO clients (id, full_name, phone, email, programs, notify_channel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        clientId, fullName, phone, email || null, JSON.stringify(["BARBERSHOP"]), notifyChannel, now
      );
      client = { id: clientId, notify_channel: notifyChannel };
    } else {
      // Update existing client's notification preference
      await db.run(`UPDATE clients SET notify_channel = ? WHERE id = ?`, notifyChannel, client.id);
      client.notify_channel = notifyChannel;
    }

    // Get service details from known services or use provided serviceName
    const knownService = BARBERSHOP_SERVICES.find(s => s.id === service);
    const duration = knownService?.duration || 30;
    const displayName = knownService?.name || serviceName || service;

    // Calculate end time
    const [hours, minutes] = time.split(":").map(Number);
    const startDateTime = new Date(`${date}T${time}:00`);
    const endDateTime = new Date(startDateTime.getTime() + duration * 60000);
    const endTime = `${String(endDateTime.getHours()).padStart(2, '0')}:${String(endDateTime.getMinutes()).padStart(2, '0')}`;

    const startISO = `${date}T${time}:00`;
    const endISO = `${date}T${endTime}:00`;

    // Create appointment as "pending" status (needs staff confirmation)
    const appointmentId = cryptoRandomId();
    const now = new Date().toISOString();
    const appointmentNotes = `[${displayName}] ONLINE REQUEST${notes ? ' - ' + notes : ''}`;

    // Get a default barber (first available) or use placeholder
    const defaultBarber = await db.get<any>(`SELECT id FROM users WHERE role IN ('barber', 'owner') LIMIT 1`);
    const barberId = defaultBarber?.id || "unassigned";

    await db.run(
      `INSERT INTO appointments (id, client_id, program, start_time, end_time, location, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      appointmentId, client.id, "BARBERSHOP", startISO, endISO, "IFCDC Barbershop", appointmentNotes, barberId, now
    );

    // Send SMS confirmation if client opted in, Twilio configured, and phone provided
    const shouldSendSms = client.notify_channel === 'SMS';
    if (shouldSendSms && twilioClient && phone) {
      try {
        const formattedDate = new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const smsBody = `IFCDC Barbershop: Your appointment for ${displayName} on ${formattedDate} at ${time} has been received! We'll confirm shortly. Questions? Call us!`;
        
        await twilioClient.messages.create({
          body: smsBody,
          from: TWILIO_SMS_FROM,
          to: phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`
        });
        console.log(`SMS confirmation sent to ${phone}`);
      } catch (smsErr) {
        console.error("SMS confirmation failed:", smsErr);
      }
    }

    res.status(201).json({
      success: true,
      message: "Booking request submitted",
      appointmentId,
      clientName: fullName,
      service: displayName,
      date,
      time
    });
  } catch (err) {
    console.error("Error creating public booking:", err);
    res.status(500).json({ error: "Failed to submit booking request" });
  }
});

// ----- AI Assistant Endpoints -----

app.post("/api/ai/chat", authRequired, async (req, res) => {
  try {
    const { message, context } = req.body;
    
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    const openai = getOpenAI();
    if (!openai) {
      return res.status(503).json({ error: "AI service not configured. Set OPENAI_API_KEY in .env" });
    }

    const systemPrompt = `You are an AI assistant for IFCDC (Imperial Foundation Community Development Center), a community health organization. You help staff with:
- Client care and case management insights
- Barbershop appointment scheduling
- Radio show content and community announcements
- Violence prevention program support
- General community health questions

Be helpful, professional, and culturally sensitive. Keep responses concise and actionable.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      max_tokens: 500,
    });

    const aiResponse = response.choices[0]?.message?.content || "I couldn't generate a response.";
    
    await logAudit(req, { action: "AI_CHAT", targetType: "AI", targetId: "chat", extra: { messageLength: message.length } });
    
    res.json({ response: aiResponse });
  } catch (err) {
    console.error("AI chat error:", err);
    res.status(500).json({ error: "AI service unavailable" });
  }
});

app.post("/api/ai/client-summary", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER, ROLES.ADMIN), async (req, res) => {
  try {
    const { clientId } = req.body;
    
    if (!clientId) {
      return res.status(400).json({ error: "Client ID is required" });
    }

    const client = await db.get<any>("SELECT * FROM clients WHERE id = ?", clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const encounters = await db.all<any[]>(
      "SELECT * FROM encounters WHERE client_id = ? ORDER BY visit_date DESC LIMIT 10",
      clientId
    );

    const openai = getOpenAI();
    if (!openai) {
      return res.status(503).json({ error: "AI service not configured. Set OPENAI_API_KEY in .env" });
    }

    const prompt = `Based on this client information, provide a brief care summary and recommendations:
Client: ${client.full_name}
Programs: ${client.programs || "None specified"}
Recent Encounters: ${encounters.length} visits
${encounters.slice(0, 3).map((e: any) => `- ${e.visit_date}: ${e.type} - ${e.notes?.substring(0, 100) || "No notes"}`).join("\n")}

Provide a 2-3 sentence summary and 2-3 actionable recommendations for the care team.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a healthcare case management assistant. Provide concise, actionable summaries. Never include PHI in your response beyond what was provided." },
        { role: "user", content: prompt }
      ],
      max_tokens: 300,
    });

    const summary = response.choices[0]?.message?.content || "Unable to generate summary.";
    
    await logAudit(req, { action: "AI_CLIENT_SUMMARY", targetType: "AI", targetId: clientId, extra: {} });
    
    res.json({ summary, clientName: client.full_name });
  } catch (err) {
    console.error("AI client summary error:", err);
    res.status(500).json({ error: "AI service unavailable" });
  }
});

app.post("/api/ai/radio-content", authRequired, requireRole(ROLES.ADMIN, "radio_host", "radio"), async (req, res) => {
  try {
    const { topic, contentType } = req.body;
    
    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }

    const typePrompts: Record<string, string> = {
      announcement: "Write a 30-second radio announcement",
      segment: "Create a 2-minute radio segment outline",
      talking_points: "Generate 5 talking points for a discussion"
    };

    const typePrompt = typePrompts[contentType] || typePrompts.announcement;

    const openai = getOpenAI();
    if (!openai) {
      return res.status(503).json({ error: "AI service not configured. Set OPENAI_API_KEY in .env" });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a radio content creator for IFCDC Radio, a community radio station focused on health, wellness, and community empowerment. Write engaging, culturally relevant content." },
        { role: "user", content: `${typePrompt} about: ${topic}` }
      ],
      max_tokens: 400,
    });

    const content = response.choices[0]?.message?.content || "Unable to generate content.";
    
    await logAudit(req, { action: "AI_RADIO_CONTENT", targetType: "AI", targetId: "radio", extra: { topic, contentType } });
    
    res.json({ content, contentType: contentType || "announcement" });
  } catch (err) {
    console.error("AI radio content error:", err);
    res.status(500).json({ error: "AI service unavailable" });
  }
});

app.post("/api/ai/schedule-help", authRequired, requireRole(ROLES.ADMIN, "barber", "owner"), async (req, res) => {
  try {
    const { question, appointments } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: "Question is required" });
    }

    const appointmentContext = appointments?.length 
      ? `Current appointments today: ${appointments.map((a: any) => `${a.time} - ${a.service}`).join(", ")}`
      : "No current appointments provided.";

    const openai = getOpenAI();
    if (!openai) {
      return res.status(503).json({ error: "AI service not configured. Set OPENAI_API_KEY in .env" });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You are a scheduling assistant for IFCDC Barbershop. Help with appointment scheduling, time management, and client preferences. ${appointmentContext}` },
        { role: "user", content: question }
      ],
      max_tokens: 250,
    });

    const answer = response.choices[0]?.message?.content || "Unable to help with scheduling.";
    
    await logAudit(req, { action: "AI_SCHEDULE_HELP", targetType: "AI", targetId: "schedule", extra: {} });
    
    res.json({ answer });
  } catch (err) {
    console.error("AI schedule help error:", err);
    res.status(500).json({ error: "AI service unavailable" });
  }
});

// ----- Policy Version Management -----

const POLICY_ROLES = [ROLES.ADMIN, ROLES.EXEC, "admin", "owner", "exec"];

app.get("/api/policies", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
  try {
    const policies = await db.all(`
      SELECT pv.*, u.name as created_by_name
      FROM policy_versions pv
      LEFT JOIN users u ON pv.created_by = u.id
      ORDER BY pv.policy_name, pv.created_at DESC
    `);
    res.json(policies);
  } catch (err) {
    console.error("Error fetching policies:", err);
    res.status(500).json({ error: "Failed to fetch policies" });
  }
});

app.get("/api/policies/names", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
  try {
    const names = await db.all(`
      SELECT DISTINCT policy_name FROM policy_versions ORDER BY policy_name
    `);
    res.json(names.map((n: any) => n.policy_name));
  } catch (err) {
    console.error("Error fetching policy names:", err);
    res.status(500).json({ error: "Failed to fetch policy names" });
  }
});

app.get("/api/policies/:policyName/history", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
  try {
    const { policyName } = req.params;
    const history = await db.all(`
      SELECT pv.*, u.name as created_by_name
      FROM policy_versions pv
      LEFT JOIN users u ON pv.created_by = u.id
      WHERE pv.policy_name = ?
      ORDER BY pv.created_at DESC
    `, decodeURIComponent(policyName));
    res.json(history);
  } catch (err) {
    console.error("Error fetching policy history:", err);
    res.status(500).json({ error: "Failed to fetch policy history" });
  }
});

app.get("/api/policies/version/:id", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const policy = await db.get(`
      SELECT pv.*, u.name as created_by_name
      FROM policy_versions pv
      LEFT JOIN users u ON pv.created_by = u.id
      WHERE pv.id = ?
    `, id);
    if (!policy) {
      return res.status(404).json({ error: "Policy version not found" });
    }
    res.json(policy);
  } catch (err) {
    console.error("Error fetching policy version:", err);
    res.status(500).json({ error: "Failed to fetch policy version" });
  }
});

app.post("/api/policies", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: "User not authenticated" });
    }
    
    const { policy_name, version, content, summary, effective_date, status } = req.body;
    
    if (!policy_name || !version || !content) {
      return res.status(400).json({ error: "policy_name, version, and content are required" });
    }

    const existingVersion = await db.get(
      "SELECT id FROM policy_versions WHERE policy_name = ? AND version = ?",
      policy_name, version
    );
    if (existingVersion) {
      return res.status(409).json({ error: "This version already exists for this policy" });
    }

    const id = cryptoRandomId();
    const now = new Date().toISOString();

    await db.run(`
      INSERT INTO policy_versions (id, policy_name, version, content, summary, effective_date, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, policy_name, version, content, summary || null, effective_date || null, status || 'draft', req.user.id, now, now);

    await logAudit(req, {
      action: "create_policy_version",
      targetType: "policy",
      targetId: id,
      extra: { policy_name, version }
    });

    const newPolicy = await db.get("SELECT * FROM policy_versions WHERE id = ?", id);
    res.status(201).json(newPolicy);
  } catch (err) {
    console.error("Error creating policy version:", err);
    res.status(500).json({ error: "Failed to create policy version" });
  }
});

app.patch("/api/policies/:id", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const { content, summary, effective_date, status } = req.body;

    const existing = await db.get("SELECT * FROM policy_versions WHERE id = ?", id);
    if (!existing) {
      return res.status(404).json({ error: "Policy version not found" });
    }

    const now = new Date().toISOString();
    await db.run(`
      UPDATE policy_versions
      SET content = COALESCE(?, content),
          summary = COALESCE(?, summary),
          effective_date = COALESCE(?, effective_date),
          status = COALESCE(?, status),
          updated_at = ?
      WHERE id = ?
    `, content, summary, effective_date, status, now, id);

    await logAudit(req, {
      action: "update_policy_version",
      targetType: "policy",
      targetId: id,
      extra: { policy_name: existing.policy_name, version: existing.version, status }
    });

    const updated = await db.get("SELECT * FROM policy_versions WHERE id = ?", id);
    res.json(updated);
  } catch (err) {
    console.error("Error updating policy version:", err);
    res.status(500).json({ error: "Failed to update policy version" });
  }
});

app.delete("/api/policies/:id", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    
    const existing = await db.get("SELECT * FROM policy_versions WHERE id = ?", id);
    if (!existing) {
      return res.status(404).json({ error: "Policy version not found" });
    }

    await db.run("DELETE FROM policy_versions WHERE id = ?", id);

    await logAudit(req, {
      action: "delete_policy_version",
      targetType: "policy",
      targetId: id,
      extra: { policy_name: existing.policy_name, version: existing.version }
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting policy version:", err);
    res.status(500).json({ error: "Failed to delete policy version" });
  }
});

app.patch("/api/policies/:id/publish", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.get("SELECT * FROM policy_versions WHERE id = ?", id);
    if (!existing) {
      return res.status(404).json({ error: "Policy version not found" });
    }

    const now = new Date().toISOString();
    
    await db.exec("BEGIN TRANSACTION");
    try {
      await db.run(`
        UPDATE policy_versions
        SET status = 'archived'
        WHERE policy_name = ? AND status = 'published' AND id != ?
      `, existing.policy_name, id);

      await db.run(`
        UPDATE policy_versions
        SET status = 'published', effective_date = COALESCE(effective_date, ?), updated_at = ?
        WHERE id = ?
      `, now.split('T')[0], now, id);
      
      await db.exec("COMMIT");
    } catch (txErr) {
      await db.exec("ROLLBACK");
      throw txErr;
    }

    await logAudit(req, {
      action: "publish_policy_version",
      targetType: "policy",
      targetId: id,
      extra: { policy_name: existing.policy_name, version: existing.version }
    });

    const updated = await db.get("SELECT * FROM policy_versions WHERE id = ?", id);
    res.json(updated);
  } catch (err) {
    console.error("Error publishing policy version:", err);
    res.status(500).json({ error: "Failed to publish policy version" });
  }
});

// ----- Public Chatbot (Policy Questions) -----

const chatbotLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  message: { error: "Too many requests. Please wait a moment before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/api/public/chatbot", chatbotLimiter, async (req, res) => {
  try {
    const { message, conversationHistory } = req.body;
    
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    if (message.length > 500) {
      return res.status(400).json({ error: "Message too long (max 500 characters)" });
    }

    const openai = getOpenAI();
    if (!openai) {
      return res.status(503).json({ error: "AI service not configured. Set OPENAI_API_KEY in .env" });
    }

    const systemPrompt = `You are a helpful assistant for Imperial Foundation CDC (IFCDC), a 501(c)(3) nonprofit organization in Asbury Park, NJ dedicated to community development, mentorship, and economic empowerment.

You can answer questions about:
- IFCDC programs and services (Mental Health & Wellness, Barbershop, Radio, Youth Development)
- Privacy Policy: IFCDC respects privacy, does not sell personal information, and uses data only for organizational communication
- Terms of Use: Website content is for lawful purposes only
- Records Policy: All health records are confidential, managed by Executive Director Mr. Fahreal Allah. Clients can request records or authorize sharing via Release of Information (ROI) form
- Contact: Phone (732) 743-5048, Email service@ifcdc.org, Address: 1215 Springwood Ave Suite 28, Asbury Park, NJ 07712
- Barbershop: Call (331) 316-8167 or book online at /book-barbershop.html
- Radio Shoutouts: Call (858) 758-8791

Keep responses concise, friendly, and helpful. If you don't know something specific, direct them to contact IFCDC directly.`;

    // Build messages array with conversation history
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt }
    ];

    // Add conversation history if provided (limit to last 6 messages)
    if (Array.isArray(conversationHistory)) {
      const recentHistory = conversationHistory.slice(-6);
      for (const msg of recentHistory) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role, content: String(msg.content).slice(0, 500) });
        }
      }
    }

    messages.push({ role: "user", content: message });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 300,
    });

    const aiResponse = response.choices[0]?.message?.content || "I'm sorry, I couldn't generate a response. Please contact us directly at (732) 743-5048.";
    
    res.json({ response: aiResponse });
  } catch (err) {
    console.error("Public chatbot error:", err);
    res.status(500).json({ error: "Chatbot service temporarily unavailable. Please contact us at (732) 743-5048." });
  }
});

// Start server with Vite in development or static files in production
async function startServer() {
  const server = http.createServer(app);

  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      configFile: path.join(getAppRoot(), "vite.config.ts"),
      server: {
        middlewareMode: true,
        hmr: { server, port: 24678, clientPort: 24678 },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPublic = getDistPublicDir();
    const spaIndexPath = getSpaIndexPath();
    console.log(`Production static root: ${distPublic}`);
    console.log(`SPA index exists: ${fs.existsSync(spaIndexPath)}`);

    app.use(express.static(distPublic));

    app.get("/", (_req, res) => {
      if (fs.existsSync(spaIndexPath)) {
        return res.sendFile(spaIndexPath);
      }
      return res.redirect("/hq/grants");
    });

    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/twilio")) {
        return next();
      }
      if (fs.existsSync(spaIndexPath)) {
        return res.sendFile(spaIndexPath);
      }
      const legacyIndex = path.join(publicDir, "index.html");
      if (fs.existsSync(legacyIndex)) {
        return res.sendFile(legacyIndex);
      }
      return res.status(404).send("IFCDC HQ frontend not built. Run npm run build.");
    });
  }

  attachHqRealtimeHub(server);

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\nPort ${PORT} is already in use.`);
      console.error(`Stop the existing server: lsof -ti :${PORT} | xargs kill -9`);
      console.error(`Or use a different port: PORT=5002 npm run dev\n`);
      process.exit(1);
    }
    throw err;
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`IFCDC Health System API live on port ${PORT}`);
      resolve();
    });
    server.once("error", reject);
  });

  try {
    await initDb();
    await ensureGrantTables();
    await ensurePeopleTables();
    await ensureFinanceTables();
    await ensureOperationsTables();
    await ensureDashboardTables();
    await ensureSoftwareDivisionTables();
    await ensureDeveloperAuditTables();
    await ensureExecutiveBriefingsTable();
    await ensureBoardPortalTables();
    await ensureHqAuditTables();
    await ensureWarehouseTables();
    await ensureWorkflowTables();
    await ensureProgramModuleTables();
    await ensureEnterpriseReadinessSeed();
    await ensureNotificationQueueTables();
    await ensureCommunicationsTables();
    await ensureDocumentTables();
    await ensureHqFileRegistry();
    await ensureBackupTables();
    await ensureSecuritySessionTables();
    getOrGenerateDailyBriefing().catch((e) => console.warn("Morning briefing generation skipped:", e?.message));
    await initGoogleOAuth();
    import("./hq/warehouseScheduler").then(({ startHqScheduler }) => startHqScheduler()).catch(() => undefined);
    syncGrantFeeds().then((results) => {
      const connected = results.filter((r) => r.status === "connected").length;
      console.log(`Grant feed sync complete: ${connected}/${results.length} feeds connected`);
    }).catch((e) => console.warn("Grant feed sync skipped:", e?.message));
    console.log("IFCDC HQ database and modules initialized");
  } catch (err) {
    console.error("Failed to initialize IFCDC HQ:", err);
    process.exit(1);
  }
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
