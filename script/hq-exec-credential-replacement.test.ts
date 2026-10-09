import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";

process.env.JWT_SECRET = "fixture-exec-credential-secret";
process.env.NODE_ENV = "test";

const { COOKIE_NAME } = await import("../server/config/auth.ts");
const { setMonolithDb } = await import("../server/monolith/dbAccess.ts");
const { registerExecCredentialReplacement } = await import("../server/hq/execCredentialReplacement.ts");

function token(role: string): string {
  return jwt.sign({ id: "actor-1", email: "service@ifcdc.org", role }, process.env.JWT_SECRET!);
}

function mockRes() {
  const state = { code: 200, body: "", type: "" };
  const res = {
    status(code: number) {
      state.code = code;
      return res;
    },
    setHeader() {
      return res;
    },
    type(value: string) {
      state.type = value;
      return res;
    },
    send(body: string) {
      state.body = body;
    },
  };
  return { state, res: res as unknown as Response };
}

async function memoryDb() {
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT,
      role TEXT,
      status TEXT,
      password_hash TEXT
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT,
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
  await db.run(
    "INSERT INTO users (id, email, role, status, password_hash) VALUES (?, ?, ?, ?, ?)",
    "exec-1",
    "exec@ifcdc.org",
    "EXEC",
    "active",
    "old-exec-hash",
  );
  await db.run(
    "INSERT INTO users (id, email, role, status, password_hash) VALUES (?, ?, ?, ?, ?)",
    "grant-1",
    "813786b@gmail.com",
    "grant_manager",
    "active",
    "old-grant-hash",
  );
  setMonolithDb(db);
  return db;
}

function appHandlers() {
  const routes = new Map<string, (req: Request, res: Response) => unknown>();
  const app = {
    get(path: string, handler: (req: Request, res: Response) => unknown) {
      routes.set(`GET ${path}`, handler);
    },
    post(path: string, handler: (req: Request, res: Response) => unknown) {
      routes.set(`POST ${path}`, handler);
    },
  };
  registerExecCredentialReplacement(app as never);
  return routes;
}

test("founder can replace only the existing executive credential", async () => {
  const db = await memoryDb();
  const routes = appHandlers();
  const replacement = crypto.randomBytes(18).toString("base64url");
  const { state, res } = mockRes();
  const req = {
    cookies: { [COOKIE_NAME]: token("owner") },
    body: { replacement, confirm: replacement },
    method: "POST",
    originalUrl: "/hq/exec-credential",
    headers: {},
    socket: {},
  } as unknown as Request;

  await routes.get("POST /hq/exec-credential")!(req, res);

  const exec = await db.get<{ role: string; email: string; password_hash: string }>(
    "SELECT role, email, password_hash FROM users WHERE id = ?",
    "exec-1",
  );
  const grant = await db.get<{ password_hash: string; role: string }>(
    "SELECT password_hash, role FROM users WHERE id = ?",
    "grant-1",
  );
  const audit = await db.get<{ action: string; extra: string; entity_id: string }>(
    "SELECT action, extra, entity_id FROM audit_logs",
  );
  const leaked =
    state.body.includes(replacement) ||
    (audit?.extra || "").includes(replacement) ||
    JSON.stringify(req.body).includes(replacement);

  assert.equal(state.code, 200);
  assert.equal(exec?.role, "EXEC");
  assert.equal(exec?.email, "exec@ifcdc.org");
  assert.equal(exec?.password_hash === replacement, false);
  assert.equal(await bcrypt.compare(replacement, exec!.password_hash), true);
  assert.equal(grant?.password_hash, "old-grant-hash");
  assert.equal(grant?.role, "grant_manager");
  assert.equal(audit?.action, "EXEC_CREDENTIAL_REPLACED");
  assert.equal(audit?.entity_id, "exec-1");
  assert.equal(audit?.extra, "{}");
  assert.equal(leaked, false);
  assert.equal(state.body.includes("Sign Out"), false);
});

test("anonymous and non-founder sessions cannot replace the credential", async () => {
  const db = await memoryDb();
  const routes = appHandlers();
  const secret = crypto.randomBytes(18).toString("base64url");

  const anon = mockRes();
  await routes.get("POST /hq/exec-credential")!(
    { cookies: {}, body: { replacement: secret, confirm: secret }, headers: {}, socket: {} } as unknown as Request,
    anon.res,
  );
  const execRole = mockRes();
  await routes.get("GET /hq/exec-credential")!(
    { cookies: { [COOKIE_NAME]: token("EXEC") }, body: {}, headers: {}, socket: {} } as unknown as Request,
    execRole.res,
  );

  const exec = await db.get<{ password_hash: string; role: string }>(
    "SELECT password_hash, role FROM users WHERE id = ?",
    "exec-1",
  );
  assert.equal(anon.state.code, 401);
  assert.equal(execRole.state.code, 403);
  assert.equal(exec?.password_hash, "old-exec-hash");
  assert.equal(exec?.role, "EXEC");
  assert.equal(anon.state.body.includes(secret) || execRole.state.body.includes(secret), false);
});
