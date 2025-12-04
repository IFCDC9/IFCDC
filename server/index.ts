import express from "express";
import path from "path";
import fs from "fs";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import twilio from "twilio";

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER,
} = process.env;

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

async function sendReminderSms(to: string, body: string) {
  if (!twilioClient) {
    console.warn("Twilio not configured; skipping SMS send.");
    return;
  }
  await twilioClient.messages.create({
    to,
    from: TWILIO_FROM_NUMBER,
    body,
  });
}

app.use(express.json());

const publicDir = path.join(import.meta.dirname, "..", "public");
app.use(express.static(publicDir));

const ROLES = {
  EXEC: "EXEC",
  CLINICIAN: "CLINICIAN",
  CASE_MANAGER: "CASE_MANAGER",
  CHW: "CHW",
  ADMIN: "ADMIN",
} as const;

const ROLE_VALUES = Object.values(ROLES);

const JWT_SECRET = process.env.JWT_SECRET || "DEV_ONLY_CHANGE_ME_IFCDC";
const JWT_EXPIRES_IN = "8h";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  password_hash: string;
  created_at: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        email: string;
        role: string;
      };
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
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
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
    console.log("Password:", rawPassword);
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

async function authRequired(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.header("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : null;

  if (!token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; role: string; name: string };
    const user = await db.get<User>("SELECT * FROM users WHERE id = ?", payload.sub);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...allowedRoles: string[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get("/mental-health", (req, res) => res.sendFile(path.join(publicDir, "mental-health.html")));
app.get("/records-policy", (req, res) => res.sendFile(path.join(publicDir, "records-policy.html")));
app.get("/roi", (req, res) => res.sendFile(path.join(publicDir, "roi.html")));
app.get("/programs", (req, res) => res.sendFile(path.join(publicDir, "programs.html")));
app.get("/contact", (req, res) => res.sendFile(path.join(publicDir, "contact.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(publicDir, "admin.html")));

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }

  const user = await db.get<User>("SELECT * FROM users WHERE email = ?", email);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ sub: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  await logAudit(
    { method: "POST", originalUrl: "/auth/login", user: { id: user.id, name: user.name, email: user.email, role: user.role } } as express.Request,
    "USER", user.id, "LOGIN", {}
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

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
  const rows = await db.all("SELECT id, full_name, date_of_birth, phone, email, programs, created_at FROM clients ORDER BY created_at DESC");

  const list = rows.map((r: any) => ({
    id: r.id,
    fullName: r.full_name,
    dateOfBirth: r.date_of_birth,
    contactInfo: { phone: r.phone, email: r.email },
    programs: JSON.parse(r.programs || "[]"),
    createdAt: r.created_at,
  }));

  await logAudit(req, "CLIENT", null, "LIST_CLIENTS", { count: list.length });
  res.json(list);
});

app.get("/api/clients/:id", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const c = await db.get<any>("SELECT id, full_name, date_of_birth, phone, email, programs, created_at FROM clients WHERE id = ?", req.params.id);
  if (!c) {
    return res.status(404).json({ error: "Client not found" });
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

  const client = await db.get("SELECT id FROM clients WHERE id = ?", req.params.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
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
  const client = await db.get("SELECT id FROM clients WHERE id = ?", req.params.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
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

  const client = await db.get("SELECT id FROM clients WHERE id = ?", clientId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
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

    const client = await db.get("SELECT id FROM clients WHERE id = ?", clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
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

    const client = await db.get("SELECT id FROM clients WHERE id = ?", clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
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

async function getAgendaHandler(req: express.Request, res: express.Response) {
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
    const rows = await db.all<any[]>(
      `SELECT a.id, a.client_id, a.program, a.start_time, a.end_time,
              a.location, a.notes, a.created_by, a.created_at,
              c.full_name as client_name, c.phone as client_phone
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       WHERE a.start_time >= ? AND a.start_time <= ?
       ORDER BY a.start_time ASC`,
      from, to
    );

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

app.get("/api/appointments", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), getAgendaHandler);
app.get("/api/agenda", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), getAgendaHandler);

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
      await sendReminderSms(to, body);
      await logAudit(req, "APPOINTMENT", appt.id, "SEND_APPT_REMINDER", { clientId, phone: to });
      res.json({ ok: true });
    } catch (err) {
      console.error("Twilio error:", err);
      res.status(500).json({ error: "Failed to send reminder" });
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

    const to = phoneOverride || client.phone;
    if (!to) {
      return res.status(400).json({ error: "No phone number available" });
    }

    const safeBody =
      message ||
      "You have an upcoming IFCDC appointment. If you have any questions, please call us. Reply STOP to opt out.";

    try {
      await sendReminderSms(to, safeBody);
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
      const rows = await db.all<any[]>(
        `SELECT ot.id, ot.client_id, ot.phone, ot.channel, ot.reason,
                ot.status, ot.created_at, ot.completed_at,
                c.full_name as client_name
         FROM outreach_tasks ot
         LEFT JOIN clients c ON ot.client_id = c.id
         WHERE ot.status = ?
         ORDER BY ot.created_at DESC`,
        status
      );

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

initDb().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`IFCDC Health System API live on port ${PORT}`);
  });
}).catch((err) => {
  console.error("Failed to initialize database:", err);
  process.exit(1);
});
