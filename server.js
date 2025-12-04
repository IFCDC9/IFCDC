import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
const PORT = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new Database(path.join(__dirname, "data", "ifcdc.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    api_key TEXT UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    date_of_birth TEXT,
    contact_info TEXT,
    programs TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS encounters (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    program TEXT NOT NULL,
    type TEXT NOT NULL,
    summary TEXT,
    note TEXT,
    created_by_id TEXT NOT NULL,
    created_by_role TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (created_by_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
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

const ROLES = {
  EXEC: "EXEC",
  CLINICIAN: "CLINICIAN",
  CASE_MANAGER: "CASE_MANAGER",
  CHW: "CHW",
  ADMIN: "ADMIN",
};

let execUser = db.prepare("SELECT * FROM users WHERE role = ?").get(ROLES.EXEC);
if (!execUser) {
  const EXEC_API_KEY = crypto.randomBytes(24).toString("hex");
  db.prepare(`
    INSERT INTO users (id, name, role, api_key)
    VALUES (?, ?, ?, ?)
  `).run(crypto.randomUUID(), "Mr. Fahreal Allah", ROLES.EXEC, EXEC_API_KEY);

  console.log("========================================");
  console.log("IFCDC EXEC API KEY (use in x-api-key):");
  console.log(EXEC_API_KEY);
  console.log("========================================");
} else {
  console.log("========================================");
  console.log("IFCDC EXEC API KEY (use in x-api-key):");
  console.log(execUser.api_key);
  console.log("========================================");
}

function auth(req, res, next) {
  const apiKey = req.header("x-api-key");
  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }
  const user = db.prepare("SELECT * FROM users WHERE api_key = ?").get(apiKey);
  if (!user) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  req.user = user;
  next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

function logAudit(req, entityType, entityId, action, extra = {}) {
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, user_role, method, path, entity_type, entity_id, action, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    req.user?.id || null,
    req.user?.role || null,
    req.method,
    req.originalUrl,
    entityType,
    entityId,
    action,
    JSON.stringify(extra)
  );
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/mental-health", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "mental-health.html"));
});

app.get("/records-policy", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "records-policy.html"));
});

app.get("/roi", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "roi.html"));
});

app.post("/api/users", auth, requireRole(ROLES.EXEC), (req, res) => {
  const { name, role } = req.body;

  if (!name || !role) {
    return res.status(400).json({ error: "name and role are required" });
  }
  if (!Object.values(ROLES).includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  const apiKey = crypto.randomBytes(24).toString("hex");
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO users (id, name, role, api_key)
    VALUES (?, ?, ?, ?)
  `).run(id, name, role, apiKey);

  logAudit(req, "USER", id, "CREATE_USER", { createdRole: role });

  res.status(201).json({ id, name, role, apiKey });
});

app.get("/api/users", auth, requireRole(ROLES.EXEC), (req, res) => {
  const users = db.prepare("SELECT id, name, role, created_at FROM users").all();
  logAudit(req, "USER", null, "LIST_USERS");
  res.json(users);
});

app.post("/api/clients", auth, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), (req, res) => {
  const { fullName, dateOfBirth, contactInfo, programs } = req.body;

  if (!fullName) {
    return res.status(400).json({ error: "fullName is required" });
  }

  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO clients (id, full_name, date_of_birth, contact_info, programs)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    fullName,
    dateOfBirth || null,
    JSON.stringify(contactInfo || {}),
    JSON.stringify(Array.isArray(programs) ? programs : [])
  );

  logAudit(req, "CLIENT", id, "CREATE_CLIENT");

  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
  res.status(201).json({
    ...client,
    contactInfo: JSON.parse(client.contact_info || "{}"),
    programs: JSON.parse(client.programs || "[]"),
  });
});

app.get("/api/clients/:id", auth, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), (req, res) => {
  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }
  logAudit(req, "CLIENT", client.id, "VIEW_CLIENT");
  res.json({
    ...client,
    contactInfo: JSON.parse(client.contact_info || "{}"),
    programs: JSON.parse(client.programs || "[]"),
  });
});

app.get("/api/clients", auth, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), (req, res) => {
  const clients = db.prepare("SELECT * FROM clients").all();
  logAudit(req, "CLIENT", null, "LIST_CLIENTS");
  res.json(clients.map(c => ({
    ...c,
    contactInfo: JSON.parse(c.contact_info || "{}"),
    programs: JSON.parse(c.programs || "[]"),
  })));
});

app.post("/api/clients/:id/encounters", auth, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER, ROLES.CHW), (req, res) => {
  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  const { program, type, summary, note } = req.body;

  if (!program || !type) {
    return res.status(400).json({
      error: "program and type are required (e.g. 'MentalHealth', 'Screening')",
    });
  }

  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO encounters (id, client_id, program, type, summary, note, created_by_id, created_by_role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, client.id, program, type, summary || "", note || "", req.user.id, req.user.role);

  logAudit(req, "ENCOUNTER", id, "CREATE_ENCOUNTER", {
    clientId: client.id,
    program,
    type,
  });

  const encounter = db.prepare("SELECT * FROM encounters WHERE id = ?").get(id);
  res.status(201).json(encounter);
});

app.get("/api/clients/:id/encounters", auth, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), (req, res) => {
  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  const encounters = db.prepare("SELECT * FROM encounters WHERE client_id = ? ORDER BY created_at DESC").all(client.id);

  logAudit(req, "ENCOUNTER", null, "LIST_ENCOUNTERS", {
    clientId: client.id,
    count: encounters.length,
  });

  res.json(encounters);
});

app.get("/api/audit-logs", auth, requireRole(ROLES.EXEC), (req, res) => {
  const logs = db.prepare("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500").all();
  res.json(logs.map(log => ({
    ...log,
    extra: JSON.parse(log.extra || "{}"),
  })));
});

app.post("/api/generate-exec-key", (req, res) => {
  const { secret } = req.body;

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Invalid secret" });
  }

  const execUser = db.prepare("SELECT * FROM users WHERE role = ?").get(ROLES.EXEC);
  if (!execUser) {
    return res.status(404).json({ error: "No EXEC user found" });
  }

  const apiKey = crypto.randomBytes(24).toString("hex");
  db.prepare("UPDATE users SET api_key = ? WHERE id = ?").run(apiKey, execUser.id);

  res.json({
    message: "API key generated for EXEC user",
    userId: execUser.id,
    name: execUser.name,
    apiKey,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`IFCDC Health System API live on port ${PORT}`);
});
