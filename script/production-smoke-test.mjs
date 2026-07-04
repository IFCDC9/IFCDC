#!/usr/bin/env node
/**
 * Full IFCDC HQ production smoke test — login, APIs, SPA routes.
 * Usage:
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   IFCDC_EXPECT_COMMIT=0dc4244 \
 *   IFCDC_SUPER_ADMIN_EMAIL=service@ifcdc.org \
 *   IFCDC_SUPER_ADMIN_PASSWORD=*** \
 *   node script/production-smoke-test.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function loadDotEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadDotEnv();

const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com";
const EXPECT_COMMIT = (process.env.IFCDC_EXPECT_COMMIT || "").trim();
const EMAIL = process.env.IFCDC_SUPER_ADMIN_EMAIL || process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org";
const PASSWORD = process.env.IFCDC_SUPER_ADMIN_PASSWORD || process.env.FOUNDER_SEED_PASSWORD || "";

const SPA_ROUTES = [
  ["Dashboard", "/hq"],
  ["Founder Command Center", "/hq/founder"],
  ["Navigation Shell", "/hq/analytics"],
  ["Mission Control", "/hq/phase10"],
  ["Intelligent OS", "/hq/phase9"],
  ["Enterprise Intelligence", "/hq/intelligence"],
  ["Workflow Automation", "/hq/workflows"],
  ["AURA AI Command Center", "/hq/aura"],
  ["Grant Center", "/hq/grants"],
];

const MODULE_APIS = [
  ["Dashboard API", "/api/hq/workspace/dashboard", 20000],
  ["Mission Control", "/api/hq/phase10/mission-control", 45000],
  ["Intelligent OS", "/api/hq/phase9/package", 45000],
  ["Enterprise Intelligence", "/api/hq/warehouse/overview", 20000],
  ["Workflow Automation", "/api/hq/workflows/dashboard", 20000],
  ["AURA Status", "/api/hq/aura/status", 20000],
  ["AURA Executive Health", "/api/hq/aura/executive/health", 20000],
  ["Grant Center", "/api/hq/grants/dashboard", 20000],
  ["HQ Session", "/api/hq/auth/session", 10000],
];

const results = [];

function record(module, ok, detail = "") {
  results.push({ module, status: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "✓" : "✗"} ${module}${detail ? ` — ${detail}` : ""}`);
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text?.slice(0, 120) }; }
  return { res, body };
}

async function login() {
  const { res, body } = await jsonFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!res.ok || !cookie) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
  return { cookie, body };
}

async function timedGet(path, cookie, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    return { res, body, ms: timeoutMs };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  IFCDC HQ — PRODUCTION SMOKE TEST`);
  console.log(`  Target: ${BASE}`);
  if (EXPECT_COMMIT) console.log(`  Expected commit: ${EXPECT_COMMIT}`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  const health = await jsonFetch(`${BASE}/api/health`);
  const commit = health.body?.commit ?? "?";
  record(
    "Production Health",
    health.ok && (health.body?.status === "healthy" || health.body?.ready === true),
    `commit=${commit}`,
  );
  if (EXPECT_COMMIT) {
    record("Commit Match", commit === EXPECT_COMMIT || commit.startsWith(EXPECT_COMMIT.slice(0, 7)), `expected ${EXPECT_COMMIT}`);
  }
  record(
    "Credential Separation",
    health.body?.credentials?.separated === true,
    `${health.body?.credentials?.superAdminEmail ?? "?"} / ${health.body?.credentials?.grantsOperatorEmail ?? "?"}`,
  );
  const qa = health.body?.grantCenterQa;
  record("Grant Center QA", qa?.status === "pass" && qa?.fail === 0, `${qa?.pass ?? 0}/${(qa?.pass ?? 0) + (qa?.fail ?? 0)}`);

  let cookie = null;
  if (!PASSWORD) {
    record("Login", false, "Set FOUNDER_SEED_PASSWORD or IFCDC_SUPER_ADMIN_PASSWORD");
  } else {
    try {
      const loginResult = await login();
      cookie = loginResult.cookie;
      record("Login", true, `${EMAIL} → ${loginResult.body?.role ?? "?"}`);
    } catch (e) {
      record("Login", false, e.message);
    }
  }

  for (const [label, route] of SPA_ROUTES) {
    const res = await fetch(`${BASE}${route}`, { redirect: "follow" });
    const text = await res.text();
    const ok = res.ok && (text.includes('id="root"') || text.includes("<!DOCTYPE"));
    const placeholder = /coming soon|under construction|placeholder module/i.test(text);
    record(`${label} (SPA)`, ok && !placeholder, `${res.status}${placeholder ? " placeholder detected" : ""}`);
  }

  if (cookie) {
    for (const [label, apiPath, timeout] of MODULE_APIS) {
      try {
        const { res, body } = await timedGet(apiPath, cookie, timeout);
        const ok = res.ok && body && typeof body === "object" && !body.error;
        record(`${label} (API)`, ok, `${res.status}${body?.error ? ` ${body.error}` : ""}`);
      } catch (e) {
        record(`${label} (API)`, false, e instanceof Error ? e.message : String(e));
      }
    }
  } else {
    for (const [label] of MODULE_APIS) {
      record(`${label} (API)`, false, "Skipped — no login cookie");
    }
  }

  const fail = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n── SUMMARY (${results.length - fail} PASS / ${fail} FAIL) ──`);
  console.log("Module".padEnd(36), "Status", "Detail");
  console.log("-".repeat(72));
  for (const r of results) {
    console.log(r.module.padEnd(36), r.status.padEnd(6), r.detail);
  }
  console.log(`\nDeployment URL: ${BASE}`);
  console.log(`Live commit: ${commit}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
