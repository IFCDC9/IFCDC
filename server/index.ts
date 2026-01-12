import express from "express";
import path from "path";
import fs from "fs";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import twilio from "twilio";
import cookieParser from "cookie-parser";
import { createServer as createViteServer } from "vite";
import OpenAI from "openai";
import rateLimit from "express-rate-limit";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);
const isDev = process.env.NODE_ENV !== "production";

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

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

function ensureTwilioConfigured() {
  if (!twilioClient || !TWILIO_SMS_FROM || !TWILIO_VOICE_FROM) {
    throw new Error("Twilio is not configured. Check env vars.");
  }
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  return digits || null;
}

function normalizeChannel(value: string | null | undefined): string {
  if (!value) return "SMS";
  const v = value.toString().toUpperCase();
  if (["SMS", "VOICE", "BOTH", "NONE"].includes(v)) return v;
  return "SMS";
}

function isSmsAllowedForChannel(channel: string | null | undefined): boolean {
  const v = normalizeChannel(channel);
  return v === "SMS" || v === "BOTH";
}

function isVoiceAllowedForChannel(channel: string | null | undefined): boolean {
  const v = normalizeChannel(channel);
  return v === "VOICE" || v === "BOTH";
}

function buildSafeAppointmentReminderText(client: any, appointment: any): string {
  const when = new Date(appointment.start_time || appointment.startTime);
  const dateStr = when.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = when.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    `Reminder from IFCDC: You have an upcoming appointment on ${dateStr} at ${timeStr}. ` +
    `If you need to cancel or reschedule, please call us.`
  );
}

async function sendSafeSms(to: string, body: string) {
  ensureTwilioConfigured();
  const toNorm = normalizePhone(to);
  if (!toNorm) {
    throw new Error("Invalid phone number");
  }

  return twilioClient!.messages.create({
    to: toNorm,
    from: TWILIO_SMS_FROM!,
    body,
  });
}

async function sendVoiceReminderCall(to: string, appointmentId: string) {
  ensureTwilioConfigured();
  const toNorm = normalizePhone(to);
  if (!toNorm) {
    throw new Error("Invalid phone number");
  }

  const baseUrl = PUBLIC_APP_URL || "https://your-app-url.example.com";

  return twilioClient!.calls.create({
    to: toNorm,
    from: TWILIO_VOICE_FROM!,
    url: `${baseUrl}/twilio/voice/reminder?appointmentId=${encodeURIComponent(appointmentId)}`,
  });
}

app.use(express.json());
app.use(cookieParser());

const publicDir = path.join(import.meta.dirname, "..", "public");
// Serve static assets from public/ but don't serve index.html (let Vite handle SPA)
app.use(express.static(publicDir, { index: false }));

// Explicit routes for public HTML pages
app.get("/book-barbershop", (_req, res) => {
  res.sendFile(path.join(publicDir, "book-barbershop.html"));
});
app.get("/mental-health", (_req, res) => {
  res.sendFile(path.join(publicDir, "mental-health.html"));
});
app.get("/programs", (_req, res) => {
  res.sendFile(path.join(publicDir, "programs.html"));
});
app.get("/contact", (_req, res) => {
  res.sendFile(path.join(publicDir, "contact.html"));
});
app.get("/records-policy", (_req, res) => {
  res.sendFile(path.join(publicDir, "records-policy.html"));
});
app.get("/roi", (_req, res) => {
  res.sendFile(path.join(publicDir, "roi.html"));
});
app.get("/privacy-policy", (_req, res) => {
  res.sendFile(path.join(publicDir, "privacy-policy.html"));
});
app.get("/terms-of-use", (_req, res) => {
  res.sendFile(path.join(publicDir, "terms-of-use.html"));
});

const ROLES = {
  EXEC: "EXEC",
  CLINICIAN: "CLINICIAN",
  CASE_MANAGER: "CASE_MANAGER",
  CHW: "CHW",
  ADMIN: "ADMIN",
} as const;

const ROLE_VALUES = Object.values(ROLES);

const JWT_SECRET = process.env.JWT_SECRET || "DEV_ONLY_CHANGE_ME_IFCDC";
const JWT_EXPIRES_IN = "30d";

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
      id?: string;
      name?: string;
      email?: string;
      role?: string;
      claims?: {
        sub: string;
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

function cryptoRandomId() {
  return "id_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now().toString(36);
}

async function initDb() {
  const dataDir = path.join(import.meta.dirname, "..", "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = await open({
    filename: path.join(dataDir, "ifcdc.db"),
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT,
      created_at TEXT NOT NULL,
      replit_id TEXT UNIQUE,
      profile_image_url TEXT
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
      extra TEXT
    );
  `);

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
}

async function logAudit(req: express.Request, entityType: string, entityId: string | null, action: string, extra: Record<string, unknown> = {}) {
  const id = cryptoRandomId();
  const timestamp = new Date().toISOString();

  await db.run(
    `INSERT INTO audit_logs (id, timestamp, user_id, user_role, method, path, entity_type, entity_id, action, extra)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, timestamp, req.user?.id || null, req.user?.role || null,
    req.method, req.originalUrl, entityType, entityId, action, JSON.stringify(extra)
  );
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

async function authRequired(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Check cookie first, then Authorization header, then query string
  let token = req.cookies?.ifcdc_token || null;
  
  if (!token) {
    const authHeader = req.header("Authorization") || "";
    token = authHeader.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : null;
  }

  // Also support token via query string (for CSV downloads)
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; role: string; name: string };
    const user = await db.get<User>("SELECT * FROM users WHERE id = ?", payload.sub);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    // Use JWT role (which may have owner override) instead of database role
    req.user = { id: user.id, name: user.name, email: user.email, role: payload.role || user.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...roles: (string | string[])[]) {
  const allowedRoles = roles.flat();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    // Owner has access to everything
    if (req.user.role === "owner") {
      return next();
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

async function hasClientAccess(user: { id: string; role: string } | undefined, clientId: string): Promise<boolean> {
  if (!user) return false;
  if (user.role === "owner" || user.role === ROLES.EXEC) return true;
  const assignment = await db.get(
    "SELECT 1 FROM client_assignments WHERE client_id = ? AND user_id = ?",
    clientId, user.id
  );
  return !!assignment;
}

// Legacy static pages (served before Vite takes over)
app.get("/mental-health", (req, res) => res.sendFile(path.join(publicDir, "mental-health.html")));
app.get("/records-policy", (req, res) => res.sendFile(path.join(publicDir, "records-policy.html")));
app.get("/roi", (req, res) => res.sendFile(path.join(publicDir, "roi.html")));
app.get("/contact", (req, res) => res.sendFile(path.join(publicDir, "contact.html")));
app.get("/intake", (req, res) => res.sendFile(path.join(publicDir, "intake.html")));


// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const lowerEmail = email.toLowerCase();

    const existing = await db.get("SELECT 1 FROM users WHERE email = ?", lowerEmail);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const allowedRoles = ['client', 'barber', 'radio', 'admin'];
    const finalRole = allowedRoles.includes(role) ? role : 'client';

    const id = cryptoRandomId();
    const password_hash = await bcrypt.hash(password, 10);
    const created_at = new Date().toISOString();

    await db.run(
      `INSERT INTO users (id, name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      id, name, lowerEmail, finalRole, password_hash, created_at
    );

    await logAudit(
      { method: "POST", originalUrl: "/api/auth/register" } as express.Request,
      "USER", id, "REGISTER", { role: finalRole }
    );

    return res.status(201).json({ message: 'User created', role: finalRole });
  } catch (err) {
    console.error('Register error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const lowerEmail = (email || '').toLowerCase();

    const user = await db.get<User>("SELECT * FROM users WHERE email = ?", lowerEmail);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // If user has no password_hash, set this password for them (migrate from Replit Auth)
    if (!user.password_hash) {
      const newHash = await bcrypt.hash(password, 10);
      await db.run("UPDATE users SET password_hash = ? WHERE id = ?", newHash, user.id);
      // Continue with login
    } else {
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

    // Override role to "owner" if email matches MASTER_OWNER_EMAIL
    let effectiveRole = user.role;
    if (MASTER_OWNER_EMAIL && lowerEmail === MASTER_OWNER_EMAIL.toLowerCase()) {
      effectiveRole = "owner";
    }

    const token = jwt.sign({ sub: user.id, role: effectiveRole, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    res.cookie('ifcdc_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    await logAudit(
      { method: "POST", originalUrl: "/api/auth/login", user: { id: user.id, name: user.name, email: user.email, role: effectiveRole } } as express.Request,
      "USER", user.id, "LOGIN", {}
    );

    return res.json({ message: 'Logged in', role: effectiveRole, user: { id: user.id, name: user.name, email: user.email, role: effectiveRole } });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// LOGOUT
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('ifcdc_token');
  return res.json({ message: 'Logged out' });
});

// GET CURRENT USER
app.get('/api/auth/me', authRequired, (req, res) => {
  return res.json({ user: req.user });
});

// ----- Programs -----
app.get("/api/programs", authRequired, async (req, res) => {
  const rows = await db.all<{ id: string; code: string; name: string; description: string }[]>(
    "SELECT id, code, name, description FROM programs ORDER BY name ASC"
  );
  res.json(rows.map((p) => ({ id: p.id, code: p.code, name: p.name, description: p.description })));
});

// Logic Models API
app.get("/api/logic-models", authRequired, async (req, res) => {
  const rows = await db.all<any[]>("SELECT * FROM logic_models ORDER BY program_name ASC");
  res.json(rows.map((m) => ({
    id: m.id,
    programCode: m.program_code,
    programName: m.program_name,
    inputs: JSON.parse(m.inputs),
    activities: JSON.parse(m.activities),
    outputs: JSON.parse(m.outputs),
    shortTermOutcomes: JSON.parse(m.short_term_outcomes),
    midTermOutcomes: JSON.parse(m.mid_term_outcomes),
    longTermImpact: JSON.parse(m.long_term_impact),
    createdAt: m.created_at,
    updatedAt: m.updated_at
  })));
});

app.get("/api/logic-models/:programCode", authRequired, async (req, res) => {
  const { programCode } = req.params;
  const row = await db.get<any>("SELECT * FROM logic_models WHERE program_code = ?", programCode);
  if (!row) {
    return res.status(404).json({ error: "Logic model not found" });
  }
  res.json({
    id: row.id,
    programCode: row.program_code,
    programName: row.program_name,
    inputs: JSON.parse(row.inputs),
    activities: JSON.parse(row.activities),
    outputs: JSON.parse(row.outputs),
    shortTermOutcomes: JSON.parse(row.short_term_outcomes),
    midTermOutcomes: JSON.parse(row.mid_term_outcomes),
    longTermImpact: JSON.parse(row.long_term_impact),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
});

// ----- Users -----
app.post("/api/users", authRequired, requireRole(ROLES.EXEC), async (req, res) => {
  const { name, email, role, password } = req.body || {};
  if (!name || !email || !role || !password) {
    return res.status(400).json({ error: "name, email, role, password are required" });
  }
  if (!ROLE_VALUES.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  const existing = await db.get("SELECT 1 FROM users WHERE email = ?", email);
  if (existing) {
    return res.status(409).json({ error: "Email already in use" });
  }

  const id = cryptoRandomId();
  const password_hash = await bcrypt.hash(password, 10);
  const created_at = new Date().toISOString();

  await db.run(
    `INSERT INTO users (id, name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    id, name, email, role, password_hash, created_at
  );

  await logAudit(req, "USER", id, "CREATE_USER", { createdRole: role });

  res.status(201).json({ id, name, email, role, created_at });
});

app.get("/api/users", authRequired, requireRole(ROLES.EXEC), async (req, res) => {
  const rows = await db.all("SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC");
  await logAudit(req, "USER", null, "LIST_USERS", { count: rows.length });
  res.json(rows);
});

app.post("/api/clients", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const { fullName, dateOfBirth, contactInfo, programs } = req.body || {};
  if (!fullName) {
    return res.status(400).json({ error: "fullName is required" });
  }

  const id = cryptoRandomId();
  const created_at = new Date().toISOString();
  const phone = contactInfo?.phone || null;
  const email = contactInfo?.email || null;
  const programsJson = JSON.stringify(Array.isArray(programs) ? programs : []);

  await db.run(
    `INSERT INTO clients (id, full_name, date_of_birth, phone, email, programs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, fullName, dateOfBirth || null, phone, email, programsJson, created_at
  );

  await db.run(
    `INSERT INTO client_assignments (id, client_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
    cryptoRandomId(), id, req.user!.id, req.user!.role, created_at
  );

  await logAudit(req, "CLIENT", id, "CREATE_CLIENT", { fullName });

  res.status(201).json({
    id, fullName, dateOfBirth,
    contactInfo: { phone, email },
    programs: JSON.parse(programsJson),
    createdAt: created_at,
  });
});

app.get("/api/clients", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  let rows;
  if (req.user!.role === ROLES.EXEC) {
    rows = await db.all<any[]>(
      "SELECT id, full_name, date_of_birth, phone, email, programs, created_at FROM clients ORDER BY created_at DESC"
    );
  } else {
    rows = await db.all<any[]>(
      `SELECT DISTINCT c.id, c.full_name, c.date_of_birth, c.phone, c.email,
                       c.programs, c.created_at
       FROM clients c
       JOIN client_assignments ca ON ca.client_id = c.id
       WHERE ca.user_id = ?
       ORDER BY c.created_at DESC`,
      req.user!.id
    );
  }

  const list = rows.map((c) => ({
    id: c.id,
    fullName: c.full_name,
    dateOfBirth: c.date_of_birth,
    contactInfo: { phone: c.phone, email: c.email },
    programs: JSON.parse(c.programs || "[]"),
    createdAt: c.created_at,
  }));

  await logAudit(req, "CLIENT", null, "LIST_CLIENTS", { count: list.length });
  res.json(list);
});

app.get("/api/clients/:id", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const c = await db.get<any>("SELECT id, full_name, date_of_birth, phone, email, programs, created_at FROM clients WHERE id = ?", req.params.id);
  if (!c) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (!(await hasClientAccess(req.user, c.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await logAudit(req, "CLIENT", c.id, "VIEW_CLIENT");

  res.json({
    id: c.id,
    fullName: c.full_name,
    dateOfBirth: c.date_of_birth,
    contactInfo: { phone: c.phone, email: c.email },
    programs: JSON.parse(c.programs || "[]"),
    createdAt: c.created_at,
  });
});

app.post("/api/clients/:id/encounters", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER, ROLES.CHW), async (req, res) => {
  const { program, type, summary, note } = req.body || {};

  const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", req.params.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (!(await hasClientAccess(req.user, client.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!program || !type) {
    return res.status(400).json({ error: "program and type are required (e.g. 'MentalHealth', 'Screening')" });
  }

  const id = cryptoRandomId();
  const created_at = new Date().toISOString();

  await db.run(
    `INSERT INTO encounters (id, client_id, program, type, summary, note, created_by, created_by_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, client.id, program, type, summary || "", note || "", req.user!.id, req.user!.role, created_at
  );

  await logAudit(req, "ENCOUNTER", id, "CREATE_ENCOUNTER", { clientId: client.id, program, type });

  res.status(201).json({
    id,
    clientId: client.id,
    program, type, summary, note,
    createdBy: req.user!.id,
    createdByRole: req.user!.role,
    createdAt: created_at,
  });
});

app.get("/api/clients/:id/encounters", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", req.params.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (!(await hasClientAccess(req.user, client.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const rows = await db.all<any[]>(
    "SELECT id, client_id, program, type, summary, note, created_by, created_by_role, created_at FROM encounters WHERE client_id = ? ORDER BY created_at DESC",
    client.id
  );

  await logAudit(req, "ENCOUNTER", null, "LIST_ENCOUNTERS", { clientId: client.id, count: rows.length });

  res.json(rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    program: r.program,
    type: r.type,
    summary: r.summary,
    note: r.note,
    createdBy: r.created_by,
    createdByRole: r.created_by_role,
    createdAt: r.created_at,
  })));
});

// ----- Client 360 Summary -----
app.get(
  "/api/clients/:id/summary",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    const clientId = req.params.id;

    try {
      const client = await db.get<{ id: string; full_name: string; date_of_birth: string; programs: string }>(
        "SELECT id, full_name, date_of_birth, programs FROM clients WHERE id = ?",
        clientId
      );
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      if (!(await hasClientAccess(req.user, client.id))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // ---- Latest RISK assessment ----
      const riskRow = await db.get<{ data: string; created_at: string }>(
        `SELECT data, created_at
         FROM assessments
         WHERE client_id = ? AND type = 'RISK'
         ORDER BY created_at DESC
         LIMIT 1`,
        clientId
      );

      let riskSummary: { suicideRisk: string | null; violenceRisk: string | null; safetyPlanNeeded: boolean; createdAt: string } | null = null;
      if (riskRow) {
        try {
          const data = JSON.parse(riskRow.data || "{}");
          riskSummary = {
            suicideRisk: data.suicideRisk || null,
            violenceRisk: data.violenceRisk || null,
            safetyPlanNeeded: !!data.safetyPlanNeeded,
            createdAt: riskRow.created_at,
          };
        } catch (_) {
          riskSummary = null;
        }
      }

      // ---- Next appointment ----
      const nowIso = new Date().toISOString();
      const nextAppt = await db.get<{ id: string; program: string; start_time: string; end_time: string; location: string }>(
        `SELECT id, program, start_time, end_time, location
         FROM appointments
         WHERE client_id = ? AND start_time >= ?
         ORDER BY start_time ASC
         LIMIT 1`,
        clientId,
        nowIso
      );

      let nextAppointment: { id: string; program: string; startTime: string; endTime: string; location: string } | null = null;
      if (nextAppt) {
        nextAppointment = {
          id: nextAppt.id,
          program: nextAppt.program,
          startTime: nextAppt.start_time,
          endTime: nextAppt.end_time,
          location: nextAppt.location,
        };
      }

      // ---- Last encounter ----
      const lastEnc = await db.get<{ id: string; type: string; program: string; note: string; created_at: string }>(
        `SELECT id, type, program, note, created_at
         FROM encounters
         WHERE client_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        clientId
      );

      let lastEncounter: { id: string; type: string; program: string; notePreview: string; createdAt: string } | null = null;
      if (lastEnc) {
        lastEncounter = {
          id: lastEnc.id,
          type: lastEnc.type,
          program: lastEnc.program,
          notePreview: (lastEnc.note || "").slice(0, 120),
          createdAt: lastEnc.created_at,
        };
      }

      // ---- Active goals by program ----
      const goalsRows = await db.all<{ program: string; count: number }[]>(
        `SELECT program, COUNT(*) as count
         FROM goals
         WHERE client_id = ? AND status = 'ACTIVE'
         GROUP BY program`,
        clientId
      );

      const activeGoalsByProgram = goalsRows.map((g) => ({
        program: g.program,
        count: g.count,
      }));

      await logAudit(req, "CLIENT_SUMMARY", clientId, "VIEW_CLIENT_SUMMARY", {
        hasRisk: !!riskSummary,
        hasNextAppt: !!nextAppointment,
        hasLastEnc: !!lastEncounter,
      });

      res.json({
        clientId: client.id,
        fullName: client.full_name,
        dateOfBirth: client.date_of_birth,
        programs: (() => {
          try {
            return JSON.parse(client.programs || "[]");
          } catch {
            return [];
          }
        })(),
        risk: riskSummary,
        nextAppointment,
        lastEncounter,
        activeGoalsByProgram,
      });
    } catch (err) {
      console.error("Error in /api/clients/:id/summary:", err);
      res.status(500).json({ error: "Failed to build client summary" });
    }
  }
);

// ----- Goals (per client, per program) -----

// List goals for a client
app.get("/api/clients/:id/goals", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const clientId = req.params.id;
  const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }
  if (!(await hasClientAccess(req.user, client.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const rows = await db.all<any[]>(
    `SELECT id, program, title, status, notes, target_date, created_by, created_at, completed_at
     FROM goals WHERE client_id = ? ORDER BY status ASC, created_at DESC`,
    clientId
  );

  await logAudit(req, "GOAL", null, "LIST_GOALS", { clientId, count: rows.length });

  res.json(rows.map((g) => ({
    id: g.id,
    clientId,
    program: g.program,
    title: g.title,
    status: g.status,
    notes: g.notes,
    targetDate: g.target_date,
    createdBy: g.created_by,
    createdAt: g.created_at,
    completedAt: g.completed_at,
  })));
});

// Create a goal for a client
app.post("/api/clients/:id/goals", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const clientId = req.params.id;
  const { program, title, notes, targetDate } = req.body || {};

  const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }
  if (!(await hasClientAccess(req.user, client.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!program || !title) {
    return res.status(400).json({ error: "program and title are required" });
  }

  const id = cryptoRandomId();
  const created_at = new Date().toISOString();

  await db.run(
    `INSERT INTO goals (id, client_id, program, title, status, notes, target_date, created_by, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    id, clientId, program, title, "ACTIVE", notes || "", targetDate || null, req.user!.id, created_at
  );

  await logAudit(req, "GOAL", id, "CREATE_GOAL", { clientId, program });

  res.status(201).json({
    id,
    clientId,
    program,
    title,
    status: "ACTIVE",
    notes: notes || "",
    targetDate: targetDate || null,
    createdBy: req.user!.id,
    createdAt: created_at,
    completedAt: null,
  });
});

// ----- Client notification preferences -----
app.patch(
  "/api/clients/:id/notification-preferences",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    const clientId = req.params.id;
    const { notifyChannel } = req.body || {};

    const client = await db.get<{ id: string }>(
      "SELECT id FROM clients WHERE id = ?",
      clientId
    );
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }
    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let value: string | null = notifyChannel;
    if (value != null) {
      value = normalizeChannel(value);
    }

    await db.run(
      `
      UPDATE clients
      SET notify_channel = ?
      WHERE id = ?
      `,
      value,
      clientId
    );

    await logAudit(req, "CLIENT", clientId, "UPDATE_NOTIFY_CHANNEL", {
      notifyChannel: value,
    });

    res.json({ ok: true, notifyChannel: value });
  }
);

// Update goal status / notes
app.patch("/api/clients/:clientId/goals/:goalId", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const { clientId, goalId } = req.params;
  const { status, title, notes, targetDate } = req.body || {};

  const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }
  if (!(await hasClientAccess(req.user, client.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const goal = await db.get<{ id: string; status: string; completed_at: string | null }>(
    "SELECT id, status, completed_at FROM goals WHERE id = ? AND client_id = ?",
    goalId, clientId
  );
  if (!goal) {
    return res.status(404).json({ error: "Goal not found" });
  }

  const newStatus = status || goal.status;
  const allowedStatuses = ["ACTIVE", "COMPLETED", "ON_HOLD"];
  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const completed_at = newStatus === "COMPLETED" && goal.status !== "COMPLETED"
    ? new Date().toISOString()
    : goal.completed_at || null;

  await db.run(
    `UPDATE goals
     SET status = COALESCE(?, status),
         title = COALESCE(?, title),
         notes = COALESCE(?, notes),
         target_date = COALESCE(?, target_date),
         completed_at = ?
     WHERE id = ? AND client_id = ?`,
    newStatus, title || null, notes || null, targetDate || null, completed_at, goalId, clientId
  );

  await logAudit(req, "GOAL", goalId, "UPDATE_GOAL", { clientId, status: newStatus });

  const updated = await db.get<any>(
    `SELECT id, program, title, status, notes, target_date, created_by, created_at, completed_at
     FROM goals WHERE id = ?`,
    goalId
  );

  res.json({
    id: updated.id,
    clientId,
    program: updated.program,
    title: updated.title,
    status: updated.status,
    notes: updated.notes,
    targetDate: updated.target_date,
    createdBy: updated.created_by,
    createdAt: updated.created_at,
    completedAt: updated.completed_at,
  });
});

// ----- Assessments (structured intake / risk) -----
app.post(
  "/api/clients/:id/assessments",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    const clientId = req.params.id;
    const { type, data } = req.body || {};

    const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!type || !data) {
      return res.status(400).json({ error: "type and data are required" });
    }

    const id = cryptoRandomId();
    const created_at = new Date().toISOString();

    await db.run(
      `INSERT INTO assessments (id, client_id, type, data, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, clientId, type, JSON.stringify(data), req.user!.id, created_at
    );

    await logAudit(req, "ASSESSMENT", id, "CREATE_ASSESSMENT", { type });

    res.status(201).json({
      id,
      clientId,
      type,
      data,
      createdBy: req.user!.id,
      createdAt: created_at,
    });
  }
);

app.get(
  "/api/clients/:id/assessments",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    const clientId = req.params.id;
    const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rows = await db.all<any[]>(
      `SELECT id, type, data, created_by, created_at
       FROM assessments
       WHERE client_id = ?
       ORDER BY created_at DESC`,
      clientId
    );

    await logAudit(req, "ASSESSMENT", null, "LIST_ASSESSMENTS", {
      clientId,
      count: rows.length,
    });

    res.json(
      rows.map((a) => ({
        id: a.id,
        clientId,
        type: a.type,
        data: JSON.parse(a.data || "{}"),
        createdBy: a.created_by,
        createdAt: a.created_at,
      }))
    );
  }
);

app.post("/api/clients/:id/assignments", authRequired, requireRole(ROLES.EXEC), async (req, res) => {
  const clientId = req.params.id;
  const { userId, role } = req.body || {};

  if (!userId || !role) {
    return res.status(400).json({ error: "userId and role are required" });
  }

  const client = await db.get("SELECT id FROM clients WHERE id = ?", clientId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  const user = await db.get("SELECT id, role FROM users WHERE id = ?", userId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (user.role === ROLES.EXEC) {
    return res.status(400).json({ error: "Cannot assign EXEC as owner" });
  }

  const id = cryptoRandomId();
  const created_at = new Date().toISOString();

  await db.run(
    `INSERT INTO client_assignments (id, client_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
    id, clientId, userId, role, created_at
  );

  await logAudit(req, "CLIENT_ASSIGNMENT", id, "CREATE_ASSIGNMENT", { clientId, userId, role });

  res.status(201).json({
    id,
    clientId,
    userId,
    role,
    createdAt: created_at,
  });
});

app.get("/api/clients/:id/assignments", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const clientId = req.params.id;

  const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (!(await hasClientAccess(req.user, client.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const rows = await db.all<any[]>(`
    SELECT ca.id, ca.client_id, ca.user_id, ca.role, ca.created_at,
           u.name as user_name, u.email as user_email
    FROM client_assignments ca
    JOIN users u ON ca.user_id = u.id
    WHERE ca.client_id = ?
    ORDER BY ca.created_at DESC
  `, clientId);

  await logAudit(req, "CLIENT_ASSIGNMENT", null, "LIST_ASSIGNMENTS", { clientId, count: rows.length });

  res.json(rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    userId: r.user_id,
    userName: r.user_name,
    userEmail: r.user_email,
    role: r.role,
    createdAt: r.created_at,
  })));
});

app.delete("/api/clients/:id/assignments/:assignmentId", authRequired, requireRole(ROLES.EXEC), async (req, res) => {
  const client = await db.get("SELECT id FROM clients WHERE id = ?", req.params.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  const assignment = await db.get(
    "SELECT id, user_id FROM client_assignments WHERE id = ? AND client_id = ?",
    req.params.assignmentId, client.id
  );
  if (!assignment) {
    return res.status(404).json({ error: "Assignment not found" });
  }

  await db.run("DELETE FROM client_assignments WHERE id = ?", assignment.id);

  await logAudit(req, "CLIENT_ASSIGNMENT", assignment.id, "REMOVE_ASSIGNMENT", { clientId: client.id, userId: assignment.user_id });

  res.json({ message: "Assignment removed" });
});

app.post(
  "/api/clients/:id/appointments",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    const clientId = req.params.id;
    const { program, startTime, endTime, location, notes } = req.body || {};

    const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!program || !startTime) {
      return res.status(400).json({ error: "program and startTime are required" });
    }

    const id = cryptoRandomId();
    const created_at = new Date().toISOString();

    await db.run(
      `INSERT INTO appointments (id, client_id, program, start_time, end_time, location, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, clientId, program, startTime, endTime || null, location || null, notes || "", req.user!.id, created_at
    );

    await logAudit(req, "APPOINTMENT", id, "CREATE_APPOINTMENT", { clientId, program, startTime });

    res.status(201).json({
      id,
      clientId,
      program,
      startTime,
      endTime: endTime || null,
      location: location || null,
      notes: notes || "",
      createdBy: req.user!.id,
      createdAt: created_at,
    });
  }
);

app.get(
  "/api/clients/:id/appointments",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    const clientId = req.params.id;

    const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rows = await db.all<any[]>(
      `SELECT id, client_id, program, start_time, end_time, location, notes, created_by, created_at
       FROM appointments WHERE client_id = ? ORDER BY start_time ASC`,
      clientId
    );

    await logAudit(req, "APPOINTMENT", null, "LIST_APPOINTMENTS", { clientId, count: rows.length });

    res.json(rows.map((a) => ({
      id: a.id,
      clientId: a.client_id,
      program: a.program,
      startTime: a.start_time,
      endTime: a.end_time,
      location: a.location,
      notes: a.notes,
      createdBy: a.created_by,
      createdAt: a.created_at,
    })));
  }
);

app.get(
  "/api/appointments",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    let { from, to } = req.query as { from?: string; to?: string };

    const now = new Date();
    if (!from) {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      from = start.toISOString();
    }
    if (!to) {
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      to = end.toISOString();
    }

    try {
      let rows;
      if (req.user!.role === ROLES.EXEC) {
        rows = await db.all<any[]>(
          `SELECT a.id, a.client_id, a.program, a.start_time, a.end_time,
                  a.location, a.notes, a.created_by, a.created_at,
                  c.full_name as client_name, c.phone as client_phone
           FROM appointments a
           JOIN clients c ON a.client_id = c.id
           WHERE a.start_time >= ? AND a.start_time <= ?
           ORDER BY a.start_time ASC`,
          from, to
        );
      } else {
        rows = await db.all<any[]>(
          `SELECT DISTINCT a.id, a.client_id, a.program, a.start_time, a.end_time,
                           a.location, a.notes, a.created_by, a.created_at,
                           c.full_name as client_name, c.phone as client_phone
           FROM appointments a
           JOIN clients c ON a.client_id = c.id
           JOIN client_assignments ca ON ca.client_id = c.id
           WHERE ca.user_id = ?
             AND a.start_time >= ?
             AND a.start_time <= ?
           ORDER BY a.start_time ASC`,
          req.user!.id, from, to
        );
      }

      await logAudit(req, "APPOINTMENT", null, "LIST_APPOINTMENTS_BY_RANGE", { from, to, count: rows.length });

      res.json(rows.map((a) => ({
        id: a.id,
        clientId: a.client_id,
        clientName: a.client_name,
        clientPhone: a.client_phone,
        program: a.program,
        startTime: a.start_time,
        endTime: a.end_time,
        location: a.location,
        notes: a.notes,
        createdBy: a.created_by,
        createdAt: a.created_at,
      })));
    } catch (err) {
      console.error("Error listing appointments by range:", err);
      res.status(500).json({ error: "Failed to load appointments" });
    }
  }
);


// ADMIN: Get all bookings/appointments
app.get('/api/bookings/admin', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const rows = await db.all<any[]>(
      `SELECT a.id, a.client_id, a.program, a.start_time, a.end_time,
              a.location, a.notes, a.created_by, a.created_at,
              c.full_name as client_name, c.phone as client_phone, c.email as client_email
       FROM appointments a
       LEFT JOIN clients c ON a.client_id = c.id
       ORDER BY a.start_time DESC`
    );

    await logAudit(req, "APPOINTMENT", null, "ADMIN_LIST_ALL_BOOKINGS", { count: rows.length });

    res.json(rows.map((a) => ({
      id: a.id,
      clientId: a.client_id,
      clientName: a.client_name,
      clientPhone: a.client_phone,
      clientEmail: a.client_email,
      program: a.program,
      startTime: a.start_time,
      endTime: a.end_time,
      location: a.location,
      notes: a.notes,
      createdBy: a.created_by,
      createdAt: a.created_at,
    })));
  } catch (err) {
    console.error("Error fetching admin bookings:", err);
    res.status(500).json({ error: "Failed to load bookings" });
  }
});

// BARBER: Get barber bookings (barber + admin access)
app.get('/api/bookings/barber', authRequired, requireRole(['barber', 'admin']), async (req, res) => {
  try {
    const rows = await db.all<any[]>(
      `SELECT a.id, a.client_id, a.program, a.start_time, a.end_time,
              a.location, a.notes, a.created_by, a.created_at,
              c.full_name as client_name, c.phone as client_phone, c.email as client_email
       FROM appointments a
       LEFT JOIN clients c ON a.client_id = c.id
       WHERE a.program = 'BARBERSHOP' OR a.program = 'barbershop'
       ORDER BY a.start_time DESC`
    );

    await logAudit(req, "APPOINTMENT", null, "BARBER_LIST_BOOKINGS", { count: rows.length });

    res.json(rows.map((a) => ({
      id: a.id,
      clientId: a.client_id,
      clientName: a.client_name,
      clientPhone: a.client_phone,
      clientEmail: a.client_email,
      program: a.program,
      startTime: a.start_time,
      endTime: a.end_time,
      location: a.location,
      notes: a.notes,
      createdBy: a.created_by,
      createdAt: a.created_at,
    })));
  } catch (err) {
    console.error("Error fetching barber bookings:", err);
    res.status(500).json({ error: "Failed to load bookings" });
  }
});

// RADIO: Get radio board data (radio + admin access)
app.get('/api/radio/board', authRequired, requireRole(['radio', 'admin']), async (req, res) => {
  try {
    // Return radio schedule/board data
    res.json({
      schedule: [],
      onAir: null,
      upcoming: []
    });
  } catch (err) {
    console.error("Error fetching radio board:", err);
    res.status(500).json({ error: "Failed to load radio board" });
  }
});

app.post(
  "/api/clients/:clientId/appointments/:apptId/remind",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CASE_MANAGER, ROLES.ADMIN),
  async (req, res) => {
    const { clientId, apptId } = req.params;

    const client = await db.get<{ id: string; full_name: string; phone: string }>(
      "SELECT id, full_name, phone FROM clients WHERE id = ?",
      clientId
    );
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const appt = await db.get<{ id: string; start_time: string; location: string; program: string }>(
      `SELECT id, start_time, location, program FROM appointments WHERE id = ? AND client_id = ?`,
      apptId, clientId
    );
    if (!appt) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const to = client.phone;
    if (!to) {
      return res.status(400).json({ error: "No phone number on file for client" });
    }

    const when = new Date(appt.start_time).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    const body =
      `Reminder: You have an upcoming IFCDC appointment on ${when}. ` +
      `If you have questions, please contact us. Reply STOP to opt out.`;

    try {
      await sendSafeSms(to, body);
      await logAudit(req, "APPOINTMENT", appt.id, "SEND_APPT_REMINDER", { clientId, phone: to });
      res.json({ ok: true });
    } catch (err) {
      console.error("Twilio error:", err);
      res.status(500).json({ error: "Failed to send reminder" });
    }
  }
);

// ----- Appointment Notifications: SMS Reminder (by appointment ID) -----
app.post(
  "/api/appointments/:id/remind-sms",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      if (!twilioClient) {
        return res.status(500).json({ error: "Twilio not configured on this server." });
      }

      const apptId = req.params.id;

      const appt = await db.get<{
        id: string;
        client_id: string;
        program: string;
        start_time: string;
        full_name: string;
        phone: string;
        notify_channel: string | null;
      }>(
        `
        SELECT a.id, a.client_id, a.program, a.start_time,
               c.full_name, c.phone, c.notify_channel
        FROM appointments a
        JOIN clients c ON c.id = a.client_id
        WHERE a.id = ?
        `,
        apptId
      );

      if (!appt) {
        return res.status(404).json({ error: "Appointment not found" });
      }

      if (!(await hasClientAccess(req.user, appt.client_id))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const chan = normalizeChannel(appt.notify_channel);
      if (!isSmsAllowedForChannel(chan)) {
        return res.status(400).json({
          error: "Client is not configured to receive SMS reminders.",
        });
      }

      if (!appt.phone) {
        return res.status(400).json({ error: "Client does not have a phone number on file" });
      }

      const body = buildSafeAppointmentReminderText(
        { fullName: appt.full_name },
        appt
      );

      const now = new Date();
      const apptTime = new Date(appt.start_time);
      const leadHour = Math.max(0, Math.round((apptTime.getTime() - now.getTime()) / (1000 * 60 * 60)));

      let notifStatus = "SENT";
      let notifError: string | null = null;

      try {
        const sms = await sendSafeSms(appt.phone, body);

        await logAudit(req, "APPOINTMENT", apptId, "SEND_SMS_REMINDER", {
          to: normalizePhone(appt.phone),
          sid: sms.sid,
        });
      } catch (smsErr: any) {
        notifStatus = "FAILED";
        notifError = smsErr?.message || "Unknown SMS error";
      }

      await db.run(
        `INSERT INTO appointment_notifications (id, appointment_id, channel, lead_hour, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        cryptoRandomId(),
        apptId,
        "SMS",
        leadHour,
        notifStatus,
        notifError,
        now.toISOString()
      );

      if (notifStatus === "FAILED") {
        return res.status(500).json({ error: notifError || "Failed to send SMS reminder" });
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("Error sending SMS reminder:", err);
      res.status(500).json({ error: "Failed to send SMS reminder" });
    }
  }
);

// ----- Appointment Notifications: Voice Reminder (initiate call) -----
app.post(
  "/api/appointments/:id/remind-voice",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      if (!twilioClient) {
        return res.status(500).json({ error: "Twilio not configured on this server." });
      }

      const apptId = req.params.id;

      const appt = await db.get<{
        id: string;
        client_id: string;
        program: string;
        start_time: string;
        full_name: string;
        phone: string;
        notify_channel: string | null;
      }>(
        `
        SELECT a.id, a.client_id, a.program, a.start_time,
               c.full_name, c.phone, c.notify_channel
        FROM appointments a
        JOIN clients c ON c.id = a.client_id
        WHERE a.id = ?
        `,
        apptId
      );

      if (!appt) {
        return res.status(404).json({ error: "Appointment not found" });
      }

      if (!(await hasClientAccess(req.user, appt.client_id))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const chan = normalizeChannel(appt.notify_channel);
      if (!isVoiceAllowedForChannel(chan)) {
        return res.status(400).json({
          error: "Client is not configured to receive voice reminders.",
        });
      }

      if (!appt.phone) {
        return res.status(400).json({ error: "Client does not have a phone number on file" });
      }

      const now = new Date();
      const apptTime = new Date(appt.start_time);
      const leadHour = Math.max(0, Math.round((apptTime.getTime() - now.getTime()) / (1000 * 60 * 60)));

      let notifStatus = "SENT";
      let notifError: string | null = null;

      try {
        const call = await sendVoiceReminderCall(appt.phone, appt.id);

        await logAudit(req, "APPOINTMENT", apptId, "SEND_VOICE_REMINDER", {
          to: normalizePhone(appt.phone),
          sid: call.sid,
        });
      } catch (callErr: any) {
        notifStatus = "FAILED";
        notifError = callErr?.message || "Unknown voice call error";
      }

      await db.run(
        `INSERT INTO appointment_notifications (id, appointment_id, channel, lead_hour, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        cryptoRandomId(),
        apptId,
        "VOICE",
        leadHour,
        notifStatus,
        notifError,
        now.toISOString()
      );

      if (notifStatus === "FAILED") {
        return res.status(500).json({ error: notifError || "Failed to start voice reminder call" });
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("Error sending voice reminder:", err);
      res.status(500).json({ error: "Failed to start voice reminder call" });
    }
  }
);

app.post(
  "/api/clients/:id/notify",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CASE_MANAGER, ROLES.ADMIN),
  async (req, res) => {
    const clientId = req.params.id;
    const { message, phoneOverride } = req.body || {};

    const client = await db.get<{ id: string; full_name: string; phone: string }>(
      "SELECT id, full_name, phone FROM clients WHERE id = ?",
      clientId
    );
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const to = phoneOverride || client.phone;
    if (!to) {
      return res.status(400).json({ error: "No phone number available" });
    }

    const safeBody =
      message ||
      "You have an upcoming IFCDC appointment. If you have any questions, please call us. Reply STOP to opt out.";

    try {
      await sendSafeSms(to, safeBody);
      await logAudit(req, "NOTIFICATION", clientId, "SEND_SMS", { to });
      res.json({ ok: true });
    } catch (err) {
      console.error("Twilio error:", err);
      res.status(500).json({ error: "Failed to send SMS" });
    }
  }
);

app.get("/api/audit-logs", authRequired, requireRole(ROLES.EXEC), async (req, res) => {
  const logs = await db.all<any[]>("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500");
  res.json(logs.map((log) => ({
    ...log,
    extra: JSON.parse(log.extra || "{}"),
  })));
});

// ----- Dashboard Widgets -----
const WIDGET_TYPES = [
  "client_stats",
  "recent_encounters",
  "upcoming_appointments",
  "audit_log_summary",
  "program_enrollment",
] as const;

const DEFAULT_WIDGET_CONFIGS: Record<string, { title: string; w: number; h: number }> = {
  client_stats: { title: "Client Statistics", w: 4, h: 2 },
  recent_encounters: { title: "Recent Encounters", w: 4, h: 3 },
  upcoming_appointments: { title: "Upcoming Appointments", w: 4, h: 3 },
  audit_log_summary: { title: "Recent Activity", w: 6, h: 3 },
  program_enrollment: { title: "Program Enrollment", w: 6, h: 2 },
};

// Get user's dashboard widgets
app.get("/api/dashboard/widgets", authRequired, async (req, res) => {
  try {
    const widgets = await db.all<any[]>(
      `SELECT * FROM dashboard_widgets WHERE user_id = ? ORDER BY created_at ASC`,
      req.user!.id
    );
    res.json(widgets.map((w) => ({
      id: w.id,
      userId: w.user_id,
      widgetType: w.widget_type,
      title: w.title,
      layout: JSON.parse(w.layout),
      settings: w.settings ? JSON.parse(w.settings) : null,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    })));
  } catch (err) {
    console.error("Error fetching widgets:", err);
    res.status(500).json({ error: "Failed to fetch widgets" });
  }
});

// Add a new widget
app.post("/api/dashboard/widgets", authRequired, async (req, res) => {
  try {
    const { widgetType, title, layout, settings } = req.body;

    if (!widgetType || !WIDGET_TYPES.includes(widgetType)) {
      return res.status(400).json({ error: "Invalid widget type" });
    }

    const config = DEFAULT_WIDGET_CONFIGS[widgetType];
    const finalLayout = layout || { x: 0, y: 0, w: config.w, h: config.h };
    const finalTitle = title || config.title;

    const id = cryptoRandomId();
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO dashboard_widgets (id, user_id, widget_type, title, layout, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, req.user!.id, widgetType, finalTitle, JSON.stringify(finalLayout),
      settings ? JSON.stringify(settings) : null, now, now
    );

    await logAudit(req, "DASHBOARD_WIDGET", id, "CREATE", { widgetType });

    res.status(201).json({
      id,
      userId: req.user!.id,
      widgetType,
      title: finalTitle,
      layout: finalLayout,
      settings: settings || null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    console.error("Error creating widget:", err);
    res.status(500).json({ error: "Failed to create widget" });
  }
});

// Update a widget (layout, title, settings)
app.patch("/api/dashboard/widgets/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, layout, settings } = req.body;

    const widget = await db.get<any>(
      `SELECT * FROM dashboard_widgets WHERE id = ? AND user_id = ?`,
      id, req.user!.id
    );

    if (!widget) {
      return res.status(404).json({ error: "Widget not found" });
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (title !== undefined) {
      updates.push("title = ?");
      params.push(title);
    }
    if (layout !== undefined) {
      updates.push("layout = ?");
      params.push(JSON.stringify(layout));
    }
    if (settings !== undefined) {
      updates.push("settings = ?");
      params.push(JSON.stringify(settings));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    updates.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(id);
    params.push(req.user!.id);

    await db.run(
      `UPDATE dashboard_widgets SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
      ...params
    );

    await logAudit(req, "DASHBOARD_WIDGET", id, "UPDATE", { title, layout, settings });

    const updated = await db.get<any>(
      `SELECT * FROM dashboard_widgets WHERE id = ?`,
      id
    );

    res.json({
      id: updated.id,
      userId: updated.user_id,
      widgetType: updated.widget_type,
      title: updated.title,
      layout: JSON.parse(updated.layout),
      settings: updated.settings ? JSON.parse(updated.settings) : null,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    });
  } catch (err) {
    console.error("Error updating widget:", err);
    res.status(500).json({ error: "Failed to update widget" });
  }
});

// Batch update widget layouts (for drag-and-drop reordering)
app.patch("/api/dashboard/widgets/batch-layout", authRequired, async (req, res) => {
  try {
    const updates = req.body;

    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: "Expected array of updates" });
    }

    const now = new Date().toISOString();

    for (const { id, layout } of updates) {
      if (!id || !layout) continue;
      await db.run(
        `UPDATE dashboard_widgets SET layout = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        JSON.stringify(layout), now, id, req.user!.id
      );
    }

    await logAudit(req, "DASHBOARD_WIDGET", null, "BATCH_UPDATE_LAYOUT", { count: updates.length });

    res.json({ ok: true, updated: updates.length });
  } catch (err) {
    console.error("Error batch updating layouts:", err);
    res.status(500).json({ error: "Failed to batch update layouts" });
  }
});

// Delete a widget
app.delete("/api/dashboard/widgets/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;

    const widget = await db.get<any>(
      `SELECT * FROM dashboard_widgets WHERE id = ? AND user_id = ?`,
      id, req.user!.id
    );

    if (!widget) {
      return res.status(404).json({ error: "Widget not found" });
    }

    await db.run(
      `DELETE FROM dashboard_widgets WHERE id = ? AND user_id = ?`,
      id, req.user!.id
    );

    await logAudit(req, "DASHBOARD_WIDGET", id, "DELETE", { widgetType: widget.widget_type });

    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting widget:", err);
    res.status(500).json({ error: "Failed to delete widget" });
  }
});

// Get widget data (stats for different widget types)
app.get("/api/dashboard/widget-data/:type", authRequired, async (req, res) => {
  try {
    const { type } = req.params;
    const userId = req.user!.id;
    const isExec = req.user!.role === ROLES.EXEC;

    switch (type) {
      case "client_stats": {
        let totalClients, activePrograms;
        if (isExec) {
          totalClients = (await db.get<{ count: number }>("SELECT COUNT(*) as count FROM clients"))?.count || 0;
        } else {
          totalClients = (await db.get<{ count: number }>(
            `SELECT COUNT(DISTINCT client_id) as count FROM client_assignments WHERE user_id = ?`,
            userId
          ))?.count || 0;
        }
        activePrograms = (await db.get<{ count: number }>("SELECT COUNT(*) as count FROM programs"))?.count || 0;
        res.json({ totalClients, activePrograms });
        break;
      }

      case "recent_encounters": {
        let encounters;
        if (isExec) {
          encounters = await db.all<any[]>(
            `SELECT e.*, c.full_name as client_name
             FROM encounters e
             JOIN clients c ON c.id = e.client_id
             ORDER BY e.created_at DESC LIMIT 10`
          );
        } else {
          encounters = await db.all<any[]>(
            `SELECT e.*, c.full_name as client_name
             FROM encounters e
             JOIN clients c ON c.id = e.client_id
             JOIN client_assignments ca ON ca.client_id = e.client_id
             WHERE ca.user_id = ?
             ORDER BY e.created_at DESC LIMIT 10`,
            userId
          );
        }
        res.json(encounters);
        break;
      }

      case "upcoming_appointments": {
        const now = new Date().toISOString();
        let appointments;
        if (isExec) {
          appointments = await db.all<any[]>(
            `SELECT a.*, c.full_name as client_name
             FROM appointments a
             JOIN clients c ON c.id = a.client_id
             WHERE a.start_time >= ?
             ORDER BY a.start_time ASC LIMIT 10`,
            now
          );
        } else {
          appointments = await db.all<any[]>(
            `SELECT a.*, c.full_name as client_name
             FROM appointments a
             JOIN clients c ON c.id = a.client_id
             JOIN client_assignments ca ON ca.client_id = a.client_id
             WHERE ca.user_id = ? AND a.start_time >= ?
             ORDER BY a.start_time ASC LIMIT 10`,
            userId, now
          );
        }
        res.json(appointments);
        break;
      }

      case "audit_log_summary": {
        if (!isExec) {
          return res.status(403).json({ error: "Forbidden" });
        }
        const logs = await db.all<any[]>(
          `SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 15`
        );
        res.json(logs.map((log) => ({
          ...log,
          extra: JSON.parse(log.extra || "{}"),
        })));
        break;
      }

      case "program_enrollment": {
        const programs = await db.all<any[]>(
          `SELECT p.code, p.name, COUNT(DISTINCT e.client_id) as client_count
           FROM programs p
           LEFT JOIN encounters e ON e.program = p.code
           GROUP BY p.id, p.code, p.name`
        );
        res.json(programs);
        break;
      }

      default:
        res.status(400).json({ error: "Unknown widget type" });
    }
  } catch (err) {
    console.error("Error fetching widget data:", err);
    res.status(500).json({ error: "Failed to fetch widget data" });
  }
});

// ----- Stats Overview -----
app.get("/api/stats/overview", authRequired, async (req, res) => {
  try {
    const isExec = req.user!.role === ROLES.EXEC;
    const userId = req.user!.id;

    // Total clients (global vs assigned)
    let totalClientsRow;
    if (isExec) {
      totalClientsRow = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM clients");
    } else {
      totalClientsRow = await db.get<{ count: number }>(
        `SELECT COUNT(DISTINCT client_id) as count FROM client_assignments WHERE user_id = ?`,
        userId
      );
    }
    const totalClients = totalClientsRow?.count || 0;

    // Appointments this week
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun,...6=Sat
    const diffToMonday = (day + 6) % 7; // days since Monday
    const weekStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday, 0, 0, 0)
    );
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekStartIso = weekStart.toISOString();
    const weekEndIso = weekEnd.toISOString();

    let apptRow;
    if (isExec) {
      apptRow = await db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM appointments WHERE start_time >= ? AND start_time < ?`,
        weekStartIso, weekEndIso
      );
    } else {
      apptRow = await db.get<{ count: number }>(
        `SELECT COUNT(DISTINCT a.id) as count
         FROM appointments a
         JOIN client_assignments ca ON ca.client_id = a.client_id
         WHERE ca.user_id = ? AND a.start_time >= ? AND a.start_time < ?`,
        userId, weekStartIso, weekEndIso
      );
    }
    const appointmentsThisWeek = apptRow?.count || 0;

    // Open outreach tasks
    let outreachRow;
    if (isExec || req.user!.role === ROLES.ADMIN || req.user!.role === ROLES.CHW) {
      outreachRow = await db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM outreach_tasks WHERE status = 'OPEN'"
      );
    } else if (req.user!.role === ROLES.CASE_MANAGER) {
      outreachRow = await db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM outreach_tasks
         WHERE status = 'OPEN'
           AND (client_id IS NULL OR client_id IN (
             SELECT client_id FROM client_assignments WHERE user_id = ?
           ))`,
        userId
      );
    } else {
      outreachRow = await db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM outreach_tasks
         WHERE status = 'OPEN'
           AND client_id IN (SELECT client_id FROM client_assignments WHERE user_id = ?)`,
        userId
      );
    }
    const openOutreachTasks = outreachRow?.count || 0;

    await logAudit(req, "STATS", null, "VIEW_STATS_OVERVIEW", {
      totalClients,
      appointmentsThisWeek,
      openOutreachTasks,
    });

    res.json({
      totalClients,
      appointmentsThisWeek,
      openOutreachTasks,
      weekStart: weekStartIso,
      weekEnd: weekEndIso,
    });
  } catch (err) {
    console.error("Error building stats overview:", err);
    res.status(500).json({ error: "Failed to load stats overview" });
  }
});

// ----- Report Helper Functions -----
async function buildVolumeReportForUser(user: { id: string; role: string }, from: string, to: string, programFilter: string | null) {
  const isExec = user.role === ROLES.EXEC;
  const userId = user.id;

  // ---- Clients served ----
  let clientsServedRow;
  if (isExec) {
    const params: any[] = [from, to, from, to];
    const whereProgramClauseAppt = programFilter ? " AND a.program = ?" : "";
    const whereProgramClauseEnc = programFilter ? " AND e.program = ?" : "";

    const clientsQuery = `
      SELECT COUNT(DISTINCT client_id) as count FROM (
        SELECT a.client_id
        FROM appointments a
        WHERE a.start_time >= ? AND a.start_time < ?${whereProgramClauseAppt}
        UNION ALL
        SELECT e.client_id
        FROM encounters e
        WHERE e.created_at >= ? AND e.created_at < ?${whereProgramClauseEnc}
      )
    `;

    if (programFilter) {
      params.push(programFilter, programFilter);
    }

    clientsServedRow = await db.get<{ count: number }>(clientsQuery, ...params);
  } else {
    const params: any[] = [userId, from, to, userId, from, to];
    const whereProgramClauseAppt = programFilter ? " AND a.program = ?" : "";
    const whereProgramClauseEnc = programFilter ? " AND e.program = ?" : "";
    if (programFilter) {
      params.push(programFilter, programFilter);
    }

    const clientsQuery = `
      SELECT COUNT(DISTINCT client_id) as count FROM (
        SELECT a.client_id
        FROM appointments a
        JOIN client_assignments ca ON ca.client_id = a.client_id
        WHERE ca.user_id = ?
          AND a.start_time >= ? AND a.start_time < ?${whereProgramClauseAppt}
        UNION ALL
        SELECT e.client_id
        FROM encounters e
        JOIN client_assignments ca2 ON ca2.client_id = e.client_id
        WHERE ca2.user_id = ?
          AND e.created_at >= ? AND e.created_at < ?${whereProgramClauseEnc}
      )
    `;
    clientsServedRow = await db.get<{ count: number }>(clientsQuery, ...params);
  }
  const totalClientsServed = clientsServedRow?.count || 0;

  // ---- Appointments ----
  let totalAppointmentsRow;
  let apptsByProgramRows;

  if (isExec) {
    const baseParams: any[] = [from, to];
    const whereProgram = programFilter ? " AND program = ?" : "";
    const params = programFilter ? [...baseParams, programFilter] : baseParams;

    totalAppointmentsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM appointments WHERE start_time >= ? AND start_time < ?${whereProgram}`,
      ...params
    );

    apptsByProgramRows = await db.all<{ program: string; count: number }[]>(
      `SELECT program, COUNT(*) as count FROM appointments WHERE start_time >= ? AND start_time < ?${whereProgram} GROUP BY program`,
      ...params
    );
  } else {
    const baseParams: any[] = [userId, from, to];
    const whereProgram = programFilter ? " AND a.program = ?" : "";
    const params = programFilter ? [...baseParams, programFilter] : baseParams;

    totalAppointmentsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM appointments a JOIN client_assignments ca ON ca.client_id = a.client_id WHERE ca.user_id = ? AND a.start_time >= ? AND a.start_time < ?${whereProgram}`,
      ...params
    );

    apptsByProgramRows = await db.all<{ program: string; count: number }[]>(
      `SELECT a.program, COUNT(*) as count FROM appointments a JOIN client_assignments ca ON ca.client_id = a.client_id WHERE ca.user_id = ? AND a.start_time >= ? AND a.start_time < ?${whereProgram} GROUP BY a.program`,
      ...params
    );
  }

  const totalAppointments = totalAppointmentsRow?.count || 0;
  const appointmentsByProgram = (apptsByProgramRows || []).map((r) => ({
    program: r.program,
    count: r.count,
  }));

  // ---- Encounters ----
  let totalEncountersRow;
  let encountersByTypeRows;

  if (isExec) {
    const baseParams: any[] = [from, to];
    const whereProgram = programFilter ? " AND program = ?" : "";
    const params = programFilter ? [...baseParams, programFilter] : baseParams;

    totalEncountersRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM encounters WHERE created_at >= ? AND created_at < ?${whereProgram}`,
      ...params
    );

    encountersByTypeRows = await db.all<{ type: string; count: number }[]>(
      `SELECT type, COUNT(*) as count FROM encounters WHERE created_at >= ? AND created_at < ?${whereProgram} GROUP BY type`,
      ...params
    );
  } else {
    const baseParams: any[] = [userId, from, to];
    const whereProgram = programFilter ? " AND e.program = ?" : "";
    const params = programFilter ? [...baseParams, programFilter] : baseParams;

    totalEncountersRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM encounters e JOIN client_assignments ca ON ca.client_id = e.client_id WHERE ca.user_id = ? AND e.created_at >= ? AND e.created_at < ?${whereProgram}`,
      ...params
    );

    encountersByTypeRows = await db.all<{ type: string; count: number }[]>(
      `SELECT e.type, COUNT(*) as count FROM encounters e JOIN client_assignments ca ON ca.client_id = e.client_id WHERE ca.user_id = ? AND e.created_at >= ? AND e.created_at < ?${whereProgram} GROUP BY e.type`,
      ...params
    );
  }

  const totalEncounters = totalEncountersRow?.count || 0;
  const encountersByType = (encountersByTypeRows || []).map((r) => ({
    type: r.type,
    count: r.count,
  }));

  return {
    from,
    to,
    program: programFilter,
    totalClientsServed,
    totalAppointments,
    totalEncounters,
    appointmentsByProgram,
    encountersByType,
  };
}

async function buildRiskMixReportForUser(user: { id: string; role: string }) {
  const isExec = user.role === ROLES.EXEC;
  const userId = user.id;

  let rows;
  if (isExec) {
    rows = await db.all<{ client_id: string; data: string }[]>(`
      SELECT a.client_id, a.data
      FROM assessments a
      JOIN (
        SELECT client_id, MAX(created_at) AS max_created_at
        FROM assessments
        WHERE type = 'RISK'
        GROUP BY client_id
      ) latest
        ON a.client_id = latest.client_id
       AND a.created_at = latest.max_created_at
      WHERE a.type = 'RISK'
    `);
  } else {
    rows = await db.all<{ client_id: string; data: string }[]>(
      `
      SELECT a.client_id, a.data
      FROM assessments a
      JOIN (
        SELECT client_id, MAX(created_at) AS max_created_at
        FROM assessments
        WHERE type = 'RISK'
        GROUP BY client_id
      ) latest
        ON a.client_id = latest.client_id
       AND a.created_at = latest.max_created_at
      JOIN client_assignments ca ON ca.client_id = a.client_id
      WHERE a.type = 'RISK'
        AND ca.user_id = ?
    `,
      userId
    );
  }

  const suicideCounts: Record<string, number> = { LOW: 0, MODERATE: 0, HIGH: 0, UNKNOWN: 0 };
  const violenceCounts: Record<string, number> = { LOW: 0, MODERATE: 0, HIGH: 0, UNKNOWN: 0 };

  let totalWithRisk = 0;

  for (const row of rows || []) {
    try {
      const data = JSON.parse(row.data || "{}");

      let s = (data.suicideRisk || "UNKNOWN").toString().toUpperCase();
      let v = (data.violenceRisk || "UNKNOWN").toString().toUpperCase();

      if (!["LOW", "MODERATE", "HIGH"].includes(s)) s = "UNKNOWN";
      if (!["LOW", "MODERATE", "HIGH"].includes(v)) v = "UNKNOWN";

      suicideCounts[s] = (suicideCounts[s] || 0) + 1;
      violenceCounts[v] = (violenceCounts[v] || 0) + 1;
      totalWithRisk++;
    } catch (_) {
      // ignore bad JSON
    }
  }

  return {
    totalWithRisk,
    suicideRisk: suicideCounts,
    violenceRisk: violenceCounts,
  };
}

async function buildProgramDashboardForUser(user: { id: string; role: string }, programCode: string, from: string, to: string) {
  const isExec = user.role === ROLES.EXEC;
  const userId = user.id;

  // ---- Clients in this program ----
  let clientsRow;
  if (isExec) {
    clientsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM clients WHERE programs LIKE ?`,
      `%"${programCode}"%`
    );
  } else {
    clientsRow = await db.get<{ count: number }>(
      `SELECT COUNT(DISTINCT c.id) as count
       FROM clients c
       JOIN client_assignments ca ON ca.client_id = c.id
       WHERE ca.user_id = ? AND c.programs LIKE ?`,
      userId,
      `%"${programCode}"%`
    );
  }
  const totalClientsInProgram = clientsRow?.count || 0;

  // ---- Goals (all time: active; in range: completed) ----
  let activeGoalsRow;
  let completedGoalsRow;

  if (isExec) {
    activeGoalsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM goals WHERE program = ? AND status = 'ACTIVE'`,
      programCode
    );
    completedGoalsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM goals
       WHERE program = ? AND status = 'COMPLETED' AND completed_at >= ? AND completed_at < ?`,
      programCode, from, to
    );
  } else {
    activeGoalsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM goals g
       JOIN client_assignments ca ON ca.client_id = g.client_id
       WHERE g.program = ? AND g.status = 'ACTIVE' AND ca.user_id = ?`,
      programCode, userId
    );
    completedGoalsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM goals g
       JOIN client_assignments ca ON ca.client_id = g.client_id
       WHERE g.program = ? AND g.status = 'COMPLETED' AND g.completed_at >= ? AND g.completed_at < ? AND ca.user_id = ?`,
      programCode, from, to, userId
    );
  }
  const activeGoals = activeGoalsRow?.count || 0;
  const completedGoalsInRange = completedGoalsRow?.count || 0;

  // ---- Appointments & encounters in this program (in range) ----
  let apptRow;
  let encRow;
  let moveInRow;

  if (isExec) {
    apptRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM appointments WHERE program = ? AND start_time >= ? AND start_time < ?`,
      programCode, from, to
    );
    encRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM encounters WHERE program = ? AND created_at >= ? AND created_at < ?`,
      programCode, from, to
    );
    moveInRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM encounters WHERE program = ? AND type = 'MOVE_IN' AND created_at >= ? AND created_at < ?`,
      programCode, from, to
    );
  } else {
    apptRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM appointments a
       JOIN client_assignments ca ON ca.client_id = a.client_id
       WHERE a.program = ? AND a.start_time >= ? AND a.start_time < ? AND ca.user_id = ?`,
      programCode, from, to, userId
    );
    encRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM encounters e
       JOIN client_assignments ca ON ca.client_id = e.client_id
       WHERE e.program = ? AND e.created_at >= ? AND e.created_at < ? AND ca.user_id = ?`,
      programCode, from, to, userId
    );
    moveInRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM encounters e
       JOIN client_assignments ca ON ca.client_id = e.client_id
       WHERE e.program = ? AND e.type = 'MOVE_IN' AND e.created_at >= ? AND e.created_at < ? AND ca.user_id = ?`,
      programCode, from, to, userId
    );
  }

  const appointmentsInRange = apptRow?.count || 0;
  const encountersInRange = encRow?.count || 0;
  const moveInsInRange = moveInRow?.count || 0;

  return {
    program: programCode,
    from,
    to,
    totalClientsInProgram,
    activeGoals,
    completedGoalsInRange,
    appointmentsInRange,
    encountersInRange,
    moveInsInRange,
  };
}

async function buildGoalsSummaryForUser(user: { id: string; role: string }, from: string, to: string) {
  const isExec = user.role === ROLES.EXEC;
  const userId = user.id;

  let rows;
  if (isExec) {
    rows = await db.all<{ program: string; total_goals: number; completed_in_range: number }[]>(
      `SELECT program,
              COUNT(*) as total_goals,
              SUM(CASE WHEN status = 'COMPLETED' AND completed_at >= ? AND completed_at < ? THEN 1 ELSE 0 END) as completed_in_range
       FROM goals
       GROUP BY program`,
      from, to
    );
  } else {
    rows = await db.all<{ program: string; total_goals: number; completed_in_range: number }[]>(
      `SELECT g.program,
              COUNT(*) as total_goals,
              SUM(CASE WHEN g.status = 'COMPLETED' AND g.completed_at >= ? AND g.completed_at < ? THEN 1 ELSE 0 END) as completed_in_range
       FROM goals g
       JOIN client_assignments ca ON ca.client_id = g.client_id
       WHERE ca.user_id = ?
       GROUP BY g.program`,
      from, to, userId
    );
  }

  return (rows || []).map((r) => ({
    program: r.program,
    totalGoals: r.total_goals || 0,
    completedInRange: r.completed_in_range || 0,
  }));
}

// ----- Reports: Goals Summary (JSON) -----
app.get(
  "/api/reports/goals-summary",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      let { from, to } = req.query as { from?: string; to?: string };

      const now = new Date();
      if (!from || !to) {
        const end = now;
        const start = new Date(now);
        start.setDate(start.getDate() - 90);
        from = from || start.toISOString();
        to = to || end.toISOString();
      }

      const summary = await buildGoalsSummaryForUser(req.user!, from, to);

      await logAudit(req, "REPORT", null, "REPORT_GOALS_SUMMARY_JSON", { from, to });

      res.json({ from, to, programs: summary });
    } catch (err) {
      console.error("Error in /api/reports/goals-summary:", err);
      res.status(500).json({ error: "Failed to build goals summary report" });
    }
  }
);

// ----- Reports: Goals Summary (CSV) -----
app.get(
  "/api/reports/goals-summary.csv",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      let { from, to } = req.query as { from?: string; to?: string };
      const now = new Date();

      if (!from || !to) {
        const end = now;
        const start = new Date(now);
        start.setDate(start.getDate() - 90);
        from = from || start.toISOString();
        to = to || end.toISOString();
      }

      const summary = await buildGoalsSummaryForUser(req.user!, from, to);

      await logAudit(req, "REPORT", null, "REPORT_GOALS_SUMMARY_CSV", { from, to });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="ifcdc_goals_summary.csv"');

      const rows: string[] = [];
      rows.push("program,total_goals,completed_in_range,from,to");

      for (const p of summary) {
        rows.push([p.program || "", p.totalGoals, p.completedInRange, from, to].join(","));
      }

      res.send(rows.join("\n"));
    } catch (err) {
      console.error("Error in /api/reports/goals-summary.csv:", err);
      res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8").send("Failed to build goals summary CSV");
    }
  }
);

// ----- Reports: Program Dashboard (JSON) -----
app.get(
  "/api/reports/program-dashboard",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      let { program, from, to } = req.query as { program?: string; from?: string; to?: string };

      if (!program) {
        return res.status(400).json({ error: "program is required" });
      }

      const now = new Date();
      if (!from || !to) {
        const end = now;
        const start = new Date(now);
        start.setDate(start.getDate() - 90);
        from = from || start.toISOString();
        to = to || end.toISOString();
      }

      const report = await buildProgramDashboardForUser(req.user!, program, from, to);

      await logAudit(req, "REPORT", null, "REPORT_PROGRAM_DASHBOARD_JSON", { program, from, to });

      res.json(report);
    } catch (err) {
      console.error("Error in /api/reports/program-dashboard:", err);
      res.status(500).json({ error: "Failed to build program dashboard report" });
    }
  }
);

// ----- Reports: Volume (JSON) -----
app.get(
  "/api/reports/volume",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      let { from, to, program } = req.query as { from?: string; to?: string; program?: string };
      const now = new Date();

      if (!from || !to) {
        const end = now;
        const start = new Date(now);
        start.setDate(start.getDate() - 30);
        from = from || start.toISOString();
        to = to || end.toISOString();
      }

      const report = await buildVolumeReportForUser(
        req.user!,
        from,
        to,
        program || null
      );

      await logAudit(req, "REPORT", null, "REPORT_VOLUME_JSON", {
        from,
        to,
        program,
      });

      res.json(report);
    } catch (err) {
      console.error("Error in /api/reports/volume:", err);
      res.status(500).json({ error: "Failed to build volume report" });
    }
  }
);

// ----- Reports: Volume (CSV) -----
app.get(
  "/api/reports/volume.csv",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      let { from, to, program } = req.query as { from?: string; to?: string; program?: string };
      const now = new Date();

      if (!from || !to) {
        const end = now;
        const start = new Date(now);
        start.setDate(start.getDate() - 30);
        from = from || start.toISOString();
        to = to || end.toISOString();
      }

      const report = await buildVolumeReportForUser(
        req.user!,
        from,
        to,
        program || null
      );

      await logAudit(req, "REPORT", null, "REPORT_VOLUME_CSV", {
        from,
        to,
        program,
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="ifcdc_volume_report.csv"'
      );

      const rows: string[] = [];
      rows.push("section,metric,category,value,from,to,program");

      // Summary
      rows.push(
        [
          "summary",
          "clients_served",
          "",
          report.totalClientsServed,
          report.from,
          report.to,
          report.program || "",
        ].join(",")
      );
      rows.push(
        [
          "summary",
          "appointments_total",
          "",
          report.totalAppointments,
          report.from,
          report.to,
          report.program || "",
        ].join(",")
      );
      rows.push(
        [
          "summary",
          "encounters_total",
          "",
          report.totalEncounters,
          report.from,
          report.to,
          report.program || "",
        ].join(",")
      );

      // Appointments by program
      for (const p of report.appointmentsByProgram || []) {
        rows.push(
          [
            "appointments_by_program",
            "appointments",
            p.program || "Unspecified",
            p.count,
            report.from,
            report.to,
            report.program || "",
          ].join(",")
        );
      }

      // Encounters by type
      for (const e of report.encountersByType || []) {
        rows.push(
          [
            "encounters_by_type",
            "encounters",
            e.type || "Unspecified",
            e.count,
            report.from,
            report.to,
            report.program || "",
          ].join(",")
        );
      }

      res.send(rows.join("\n"));
    } catch (err) {
      console.error("Error in /api/reports/volume.csv:", err);
      res.status(500)
        .setHeader("Content-Type", "text/plain; charset=utf-8")
        .send("Failed to build volume CSV");
    }
  }
);

// ----- Reports: Risk Mix (JSON) -----
app.get(
  "/api/reports/risk-mix",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      const report = await buildRiskMixReportForUser(req.user!);

      await logAudit(req, "REPORT", null, "REPORT_RISK_MIX_JSON", {
        totalWithRisk: report.totalWithRisk,
      });

      res.json(report);
    } catch (err) {
      console.error("Error in /api/reports/risk-mix:", err);
      res.status(500).json({ error: "Failed to build risk-mix report" });
    }
  }
);

// ----- Reports: Risk Mix (CSV) -----
app.get(
  "/api/reports/risk-mix.csv",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      const report = await buildRiskMixReportForUser(req.user!);

      await logAudit(req, "REPORT", null, "REPORT_RISK_MIX_CSV", {
        totalWithRisk: report.totalWithRisk,
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="ifcdc_risk_mix_report.csv"'
      );

      const rows: string[] = [];
      rows.push("category,level,count,total_with_risk");

      const s = report.suicideRisk || {};
      const v = report.violenceRisk || {};

      rows.push(["suicideRisk", "LOW", s.LOW || 0, report.totalWithRisk || 0].join(","));
      rows.push(["suicideRisk", "MODERATE", s.MODERATE || 0, report.totalWithRisk || 0].join(","));
      rows.push(["suicideRisk", "HIGH", s.HIGH || 0, report.totalWithRisk || 0].join(","));
      rows.push(["suicideRisk", "UNKNOWN", s.UNKNOWN || 0, report.totalWithRisk || 0].join(","));

      rows.push(["violenceRisk", "LOW", v.LOW || 0, report.totalWithRisk || 0].join(","));
      rows.push(["violenceRisk", "MODERATE", v.MODERATE || 0, report.totalWithRisk || 0].join(","));
      rows.push(["violenceRisk", "HIGH", v.HIGH || 0, report.totalWithRisk || 0].join(","));
      rows.push(["violenceRisk", "UNKNOWN", v.UNKNOWN || 0, report.totalWithRisk || 0].join(","));

      res.send(rows.join("\n"));
    } catch (err) {
      console.error("Error in /api/reports/risk-mix.csv:", err);
      res.status(500)
        .setHeader("Content-Type", "text/plain; charset=utf-8")
        .send("Failed to build risk-mix CSV");
    }
  }
);

// ----- Cron: send upcoming appointment reminders (SMS) -----
app.post("/api/cron/send-upcoming-reminders", async (req, res) => {
  try {
    const provided =
      req.get("X-IFCDC-CRON-TOKEN") || req.query.token || (req.body?.token as string);
    if (!CRON_SECRET_TOKEN || provided !== CRON_SECRET_TOKEN) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!twilioClient) {
      return res
        .status(500)
        .json({ error: "Twilio not configured on this server." });
    }

    const globalFallback = parseInt(APPT_REMINDER_LEAD_HOURS || "24", 10);
    if (!Number.isFinite(globalFallback) || globalFallback <= 0) {
      return res
        .status(500)
        .json({ error: "Invalid APPT_REMINDER_LEAD_HOURS configuration." });
    }

    const programMap = await getProgramLeadHoursMap();
    const upcoming = await findSmsReminderCandidates(programMap, globalFallback);

    let attempted = 0;
    let sent = 0;
    const failures: Array<{ appointmentId: string; error: string }> = [];

    for (const appt of upcoming) {
      attempted++;
      const body = buildSafeAppointmentReminderText(
        { fullName: appt.full_name },
        appt
      );

      try {
        await sendSafeSms(appt.phone, body);

        await recordAppointmentNotification(
          appt.id,
          "SMS",
          appt.leadHours,
          "SENT",
          null
        );

        await db.run(
          `
          INSERT INTO outreach_tasks (id, client_id, phone, channel, reason, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'OPEN', ?)
          `,
          cryptoRandomId(),
          appt.client_id,
          normalizePhone(appt.phone),
          "SMS",
          "Automated appointment reminder sent",
          new Date().toISOString()
        );

        sent++;
      } catch (err: any) {
        console.error("Auto reminder SMS failed for", appt.id, err.message);

        await recordAppointmentNotification(
          appt.id,
          "SMS",
          appt.leadHours,
          "FAILED",
          err.message
        );

        failures.push({ appointmentId: appt.id, error: err.message });
      }
    }

    try {
      await logAudit(
        { user: { id: "cron", role: "SYSTEM" }, method: "POST", originalUrl: "/api/cron/send-upcoming-reminders" } as any,
        "CRON",
        null,
        "AUTO_SEND_APPOINTMENT_REMINDERS",
        {
          globalFallbackHours: globalFallback,
          totalCandidates: upcoming.length,
          attempted,
          sent,
          failures: failures.length,
        }
      );
    } catch (e: any) {
      console.error("Failed to log cron audit:", e.message);
    }

    res.json({
      globalFallbackHours: globalFallback,
      totalCandidates: upcoming.length,
      attempted,
      sent,
      failures,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error in /api/cron/send-upcoming-reminders:", err);
    res.status(500).json({ error: "Cron reminder run failed." });
  }
});

// ----- Twilio Voice Webhook: Reminder Message (no PHI) -----
app.post("/twilio/voice/reminder", async (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const mainPhone = PUBLIC_IFCDC_PHONE || "our main office number";

  const msg =
    "Hello. This is a reminder from I. F. C. D. C. " +
    "You have an upcoming appointment scheduled with our organization. " +
    "If you need to cancel or reschedule, please call " +
    mainPhone +
    ". Thank you.";

  twiml.say({ voice: "alice", language: "en-US" }, msg);

  res.type("text/xml");
  res.send(twiml.toString());
});

// ----- Twilio Voice Status Webhook -> Outreach tasks (NO AUTH) -----
app.post(
  "/twilio/voice-status",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const callStatus = req.body.CallStatus;
      const from = req.body.From;
      const to = req.body.To;

      const missedStatuses = ["no-answer", "busy", "failed", "canceled"];
      if (!missedStatuses.includes((callStatus || "").toLowerCase())) {
        return res.type("text/xml").send("<Response></Response>");
      }

      const phone = from;
      const client = await db.get<{ id: string }>(
        "SELECT id FROM clients WHERE phone = ? LIMIT 1",
        phone
      );

      const id = cryptoRandomId();
      const created_at = new Date().toISOString();

      await db.run(
        `INSERT INTO outreach_tasks (id, client_id, phone, channel, reason, status, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id, client ? client.id : null, phone, "VOICE", "MISSED_CALL", "OPEN", created_at, null
      );

      res.type("text/xml").send("<Response></Response>");
    } catch (err) {
      console.error("Error in /twilio/voice-status:", err);
      res.type("text/xml").send("<Response></Response>");
    }
  }
);

// ----- Outreach Tasks CRUD -----
app.get(
  "/api/outreach-tasks",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CASE_MANAGER, ROLES.CHW, ROLES.ADMIN),
  async (req, res) => {
    const status = (req.query.status as string) || "OPEN";
    try {
      let rows;
      if (req.user!.role === ROLES.EXEC || req.user!.role === ROLES.ADMIN || req.user!.role === ROLES.CHW) {
        rows = await db.all<any[]>(
          `SELECT ot.id, ot.client_id, ot.phone, ot.channel, ot.reason,
                  ot.status, ot.created_at, ot.completed_at,
                  c.full_name as client_name
           FROM outreach_tasks ot
           LEFT JOIN clients c ON ot.client_id = c.id
           WHERE ot.status = ?
           ORDER BY ot.created_at DESC`,
          status
        );
      } else {
        rows = await db.all<any[]>(
          `SELECT ot.id, ot.client_id, ot.phone, ot.channel, ot.reason,
                  ot.status, ot.created_at, ot.completed_at,
                  c.full_name as client_name
           FROM outreach_tasks ot
           LEFT JOIN clients c ON ot.client_id = c.id
           WHERE ot.status = ?
             AND (
               ot.client_id IS NULL OR
               ot.client_id IN (
                 SELECT client_id FROM client_assignments WHERE user_id = ?
               )
             )
           ORDER BY ot.created_at DESC`,
          status, req.user!.id
        );
      }

      await logAudit(req, "OUTREACH_TASK", null, "LIST_OUTREACH_TASKS", { status, count: rows.length });

      const list = rows.map((t) => ({
        id: t.id,
        clientId: t.client_id,
        clientName: t.client_name,
        phone: t.phone,
        channel: t.channel,
        reason: t.reason,
        status: t.status,
        createdAt: t.created_at,
        completedAt: t.completed_at,
      }));

      res.json(list);
    } catch (err) {
      console.error("Error listing outreach tasks:", err);
      res.status(500).json({ error: "Failed to load outreach tasks" });
    }
  }
);

app.post(
  "/api/outreach-tasks/:id/complete",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CASE_MANAGER, ROLES.CHW, ROLES.ADMIN),
  async (req, res) => {
    const id = req.params.id;
    const now = new Date().toISOString();

    const task = await db.get<{ id: string; status: string }>(
      "SELECT id, status FROM outreach_tasks WHERE id = ?",
      id
    );
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }
    if (task.status === "DONE") {
      return res.status(400).json({ error: "Task already completed" });
    }

    await db.run(
      `UPDATE outreach_tasks SET status = 'DONE', completed_at = ? WHERE id = ?`,
      now, id
    );

    await logAudit(req, "OUTREACH_TASK", id, "COMPLETE_OUTREACH_TASK", {});

    res.json({ ok: true });
  }
);

// ----- HR Employee Endpoints -----

app.get("/api/hr/employees", authRequired, requireRole(ROLES.ADMIN, "owner"), async (_req, res) => {
  try {
    const employees = await db.all<any[]>(
      "SELECT * FROM employees ORDER BY created_at DESC"
    );
    res.json(employees.map(e => ({
      id: e.id,
      firstName: e.first_name,
      lastName: e.last_name,
      email: e.email,
      phone: e.phone,
      role: e.role,
      location: e.location,
      startDate: e.start_date,
      status: e.status,
      notes: e.notes,
      payRate: e.pay_rate,
      payCurrency: e.pay_currency,
      payType: e.pay_type,
    })));
  } catch (err) {
    console.error("Error fetching employees", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/hr/employees", authRequired, requireRole(ROLES.ADMIN, "owner"), async (req, res) => {
  try {
    const { firstName, lastName, email, phone, role, location, startDate, status, notes, payRate, payCurrency, payType } = req.body;

    if (!firstName || !lastName || !email || !role) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const existing = await db.get("SELECT 1 FROM employees WHERE email = ?", email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: "Email already exists for another employee" });
    }

    const id = cryptoRandomId();
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO employees (id, first_name, last_name, email, phone, role, location, start_date, status, notes, pay_rate, pay_currency, pay_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, firstName, lastName, email.toLowerCase(), phone || null, role, location || null, 
      startDate || null, status || "onboarding", notes || null, 
      payRate ? Number(payRate) : null, payCurrency || "USD", payType || "hourly", now, now
    );

    await logAudit(req, "EMPLOYEE", id, "CREATE_EMPLOYEE", { firstName, lastName, role });

    res.status(201).json({
      id, firstName, lastName, email: email.toLowerCase(), phone, role, location, startDate, status: status || "onboarding", notes
    });
  } catch (err) {
    console.error("Error creating employee", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/hr/staffing-overview", authRequired, requireRole(ROLES.ADMIN, "admin", "owner", ROLES.EXEC), async (_req, res) => {
  try {
    const staffingPlan = await db.all<any[]>(
      "SELECT * FROM staffing_plan ORDER BY priority ASC"
    );

    const employees = await db.all<any[]>(
      "SELECT role, status, COUNT(*) as cnt FROM employees GROUP BY role, status"
    );

    const overview = staffingPlan.map((plan) => {
      const activeCount = employees
        .filter((e) => e.role === plan.role_key && e.status === "active")
        .reduce((sum, e) => sum + e.cnt, 0);
      const onboardingCount = employees
        .filter((e) => e.role === plan.role_key && e.status === "onboarding")
        .reduce((sum, e) => sum + e.cnt, 0);
      const openCount = Math.max(0, plan.target_count - activeCount);

      return {
        id: plan.id,
        roleKey: plan.role_key,
        roleName: plan.role_name,
        targetCount: plan.target_count,
        activeCount,
        onboardingCount,
        openCount,
        priority: plan.priority,
        notes: plan.notes,
      };
    });

    const summary = {
      totalTarget: overview.reduce((sum, o) => sum + o.targetCount, 0),
      totalActive: overview.reduce((sum, o) => sum + o.activeCount, 0),
      totalOnboarding: overview.reduce((sum, o) => sum + o.onboardingCount, 0),
      totalOpen: overview.reduce((sum, o) => sum + o.openCount, 0),
    };

    res.json({ overview, summary });
  } catch (err) {
    console.error("Error fetching staffing overview", err);
    res.status(500).json({ error: "Internal server error" });
  }
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
      `SELECT id FROM clients WHERE LOWER(full_name) = LOWER(?) OR (phone = ? AND phone IS NOT NULL AND phone != '')`,
      [fullName, clientPhone || null]
    );

    if (!client) {
      const clientId = cryptoRandomId();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO clients (id, full_name, phone, email, programs, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        clientId, fullName, clientPhone || null, clientEmail || null, JSON.stringify(["BARBERSHOP"]), now
      );
      client = { id: clientId };
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

    await logAudit(req, "APPOINTMENT", appointmentId, "CREATE_BARBERSHOP_BOOKING", { 
      clientName: fullName, 
      service: service.name,
      date, 
      startTime,
      barberId 
    });

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

// Public booking endpoint (no auth required) - creates a booking request
app.post("/api/public/book-barbershop", async (req, res) => {
  try {
    const { firstName, lastName, phone, email, service, serviceName, date, time, notes } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !phone || !service || !date || !time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const fullName = `${firstName} ${lastName}`;

    // Find or create client
    let client = await db.get<any>(
      `SELECT id FROM clients WHERE phone = ? AND phone IS NOT NULL`,
      [phone]
    );

    if (!client) {
      const clientId = cryptoRandomId();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO clients (id, full_name, phone, email, programs, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        clientId, fullName, phone, email || null, JSON.stringify(["BARBERSHOP"]), now
      );
      client = { id: clientId };
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
    
    await logAudit(req, "AI", "chat", "AI_CHAT", { messageLength: message.length });
    
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
    
    await logAudit(req, "AI", clientId, "AI_CLIENT_SUMMARY", {});
    
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

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a radio content creator for IFCDC Radio, a community radio station focused on health, wellness, and community empowerment. Write engaging, culturally relevant content." },
        { role: "user", content: `${typePrompt} about: ${topic}` }
      ],
      max_tokens: 400,
    });

    const content = response.choices[0]?.message?.content || "Unable to generate content.";
    
    await logAudit(req, "AI", "radio", "AI_RADIO_CONTENT", { topic, contentType });
    
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

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You are a scheduling assistant for IFCDC Barbershop. Help with appointment scheduling, time management, and client preferences. ${appointmentContext}` },
        { role: "user", content: question }
      ],
      max_tokens: 250,
    });

    const answer = response.choices[0]?.message?.content || "Unable to help with scheduling.";
    
    await logAudit(req, "AI", "schedule", "AI_SCHEDULE_HELP", {});
    
    res.json({ answer });
  } catch (err) {
    console.error("AI schedule help error:", err);
    res.status(500).json({ error: "AI service unavailable" });
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
  await initDb();

  if (isDev) {
    // In development, use Vite middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve built static files
    const spaIndexPath = path.join(import.meta.dirname, "..", "dist", "public", "index.html");
    app.use(express.static(path.join(import.meta.dirname, "..", "dist", "public")));

    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/twilio")) {
        return next();
      }
      if (fs.existsSync(spaIndexPath)) {
        return res.sendFile(spaIndexPath);
      }
      return res.sendFile(path.join(publicDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`IFCDC Health System API live on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
