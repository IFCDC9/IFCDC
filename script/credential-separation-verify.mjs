#!/usr/bin/env node
/**
 * Verify HQ Super Admin vs Grants Operator credential separation.
 * Uses env vars only — never logs passwords.
 */
import jwt from "jsonwebtoken";

const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com";
const SUPER_ADMIN = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
const GRANTS_OP = (process.env.GRANTS_OPERATOR_EMAIL || "813786b@gmail.com").toLowerCase();
const SUPER_PW = process.env.FOUNDER_SEED_PASSWORD || "";
const GRANTS_PW = process.env.GRANTS_OPERATOR_PASSWORD || "";
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "";
const DEV_JWT = "DEV_ONLY_CHANGE_ME_IFCDC";
const CAN_SIGN_TOKENS = JWT_SECRET && JWT_SECRET !== DEV_JWT;

let pass = 0;
let fail = 0;
let skip = 0;

function log(ok, msg, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${msg}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++;
  else fail++;
}

function logSkip(msg, detail = "") {
  console.log(`○ ${msg}${detail ? ` — ${detail}` : ""}`);
  skip++;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text?.slice(0, 120) }; }
  return { res, body, ok: res.ok };
}

async function login(email, password) {
  const { ok, res, body } = await jsonFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!ok) throw new Error(`${email}: ${body?.message || body?.error || res.status}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { cookie, body };
}

function boardHeaders() {
  const token = jwt.sign(
    { id: "sep-board", email: "board-sep@ifcdc.org", role: "board_member", name: "Board" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
  return { Cookie: `ifcdc_token=${token}` };
}

async function main() {
  console.log(`\n=== IFCDC Credential Separation Verify ===\n${BASE}\n`);

  log(SUPER_ADMIN === "service@ifcdc.org", "Super Admin email is service@ifcdc.org", SUPER_ADMIN);
  log(GRANTS_OP === "813786b@gmail.com", "Grants operator email is 813786b@gmail.com", GRANTS_OP);
  log(SUPER_ADMIN !== GRANTS_OP, "Accounts are distinct");

  const health = await jsonFetch(`${BASE}/api/health`);
  log(health.ok, "Production health", health.body?.commit ?? "?");

  if (health.body?.credentials) {
    log(health.body.credentials.separated === true, "Health reports credentials separated");
    log(
      (health.body.credentials.superAdminEmail || "").toLowerCase() === SUPER_ADMIN,
      "Health superAdminEmail matches env",
      health.body.credentials.superAdminEmail ?? "?",
    );
    log(
      (health.body.credentials.grantsOperatorEmail || "").toLowerCase() === GRANTS_OP,
      "Health grantsOperatorEmail matches env",
      health.body.credentials.grantsOperatorEmail ?? "?",
    );
  }

  if (!SUPER_PW) {
    logSkip("Super Admin login/session", "Set FOUNDER_SEED_PASSWORD to test");
  } else {
    try {
      const { cookie, body } = await login(SUPER_ADMIN, SUPER_PW);
      log(body?.role === "owner", "Super Admin login → owner role", body?.role ?? "?");
      const session = await jsonFetch(`${BASE}/api/hq/auth/session`, { headers: { Cookie: cookie } });
      log(session.body?.user?.enterpriseRole === "founder", "Super Admin enterprise role", session.body?.user?.enterpriseRole ?? "?");
      const perms = session.body?.user?.permissions ?? [];
      log(perms.includes("hq.settings.manage"), "Super Admin has hq.settings.manage");
      const logout = await jsonFetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
      log(logout.ok, "Super Admin logout");
    } catch (e) {
      log(false, "Super Admin login/session", e.message);
    }
  }

  if (!GRANTS_PW) {
    logSkip("Grants operator login", "Set GRANTS_OPERATOR_PASSWORD to test");
  } else {
    try {
      const { cookie, body } = await login(GRANTS_OP, GRANTS_PW);
      const role = body?.role ?? "?";
      log(role === "grant_manager", "Grants operator login → grant_manager (not owner)", role);
      const session = await jsonFetch(`${BASE}/api/hq/auth/session`, { headers: { Cookie: cookie } });
      const perms = session.body?.user?.permissions ?? [];
      log(!perms.includes("hq.settings.manage"), "Grants operator lacks hq.settings.manage");
      log(perms.includes("hq.grants.manage"), "Grants operator has hq.grants.manage");
      const settingsTry = await jsonFetch(`${BASE}/api/hq/settings/organization`, { headers: { Cookie: cookie } });
      log(
        settingsTry.res.status === 403 || settingsTry.res.status === 401,
        "Grants operator restricted from org settings",
        String(settingsTry.res.status),
      );
    } catch (e) {
      log(false, "Grants operator login", e.message);
    }
  }

  if (!CAN_SIGN_TOKENS) {
    logSkip("Board member write blocked", "Set JWT_SECRET to match production for RBAC token tests");
    logSkip("MFA required for Super Admin role", "Set JWT_SECRET to match production for MFA token tests");
  } else {
    const boardWrite = await jsonFetch(`${BASE}/api/hq/grants/opportunities`, {
      method: "POST",
      headers: { ...boardHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "sep-test", funder: "Test" }),
    });
    log(boardWrite.res.status === 403, "Board member write still blocked", String(boardWrite.res.status));

    const mfaStatus = await jsonFetch(`${BASE}/api/auth/2fa/status`, {
      headers: {
        Cookie: `ifcdc_token=${jwt.sign({ id: "x", email: SUPER_ADMIN, role: "owner" }, JWT_SECRET, { expiresIn: "5m" })}`,
      },
    });
    log(mfaStatus.body?.required === true, "MFA required for Super Admin role", String(mfaStatus.body?.required));
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
