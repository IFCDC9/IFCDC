import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import bcrypt from "bcryptjs";
import twilio from "twilio";
import cookieParser from "cookie-parser";
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
import { createTwilioSenders } from "./monolith/twilioHelpers";
import { ROLES, cryptoRandomId } from "./monolith/constants";
import { initGoogleOAuth } from "./monolith/googleOAuth";
import http from "http";

assertProductionEnv();

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
