#!/usr/bin/env node
/**
 * Authenticated HQ module API verification for Mission Control → AURA blockers.
 * Usage:
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   IFCDC_SUPER_ADMIN_EMAIL=service@ifcdc.org \
 *   IFCDC_SUPER_ADMIN_PASSWORD=*** \
 *   node script/hq-module-api-verify.mjs
 */
const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com";
const EMAIL = process.env.IFCDC_SUPER_ADMIN_EMAIL || process.env.MASTER_OWNER_EMAIL;
const PASSWORD = process.env.IFCDC_SUPER_ADMIN_PASSWORD || process.env.FOUNDER_SEED_PASSWORD;

const MODULE_APIS = [
  ["Mission Control", "GET", "/api/hq/phase10/mission-control", 45000],
  ["Mission Control Package", "GET", "/api/hq/phase10/package", 45000],
  ["Intelligent OS", "GET", "/api/hq/phase9/package", 45000],
  ["Enterprise Intelligence", "GET", "/api/hq/warehouse/overview", 20000],
  ["Workflow Automation", "GET", "/api/hq/workflows/dashboard", 20000],
  ["AURA Status", "GET", "/api/hq/aura/status", 20000],
  ["AURA Executive Health", "GET", "/api/hq/aura/executive/health", 20000],
  ["Intelligence Scorecard", "GET", "/api/hq/intelligence/scorecard", 20000],
];

let fail = 0;
const log = (ok, msg, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${msg}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail++;
};

async function login() {
  if (!EMAIL || !PASSWORD) {
    console.error("Set IFCDC_SUPER_ADMIN_EMAIL and IFCDC_SUPER_ADMIN_PASSWORD (or FOUNDER_SEED_PASSWORD).");
    process.exit(1);
  }
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!res.ok || !cookie) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return cookie;
}

async function timedFetch(path, cookie, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Cookie: cookie },
      signal: ctrl.signal,
    });
    const ms = Date.now() - start;
    const body = await res.json().catch(() => ({}));
    return { res, body, ms };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`\nHQ Module API Verify — ${BASE}\n`);
  const cookie = await login();
  log(true, "Super Admin login", EMAIL);

  for (const [label, method, path, timeout] of MODULE_APIS) {
    if (method !== "GET") continue;
    try {
      const { res, body, ms } = await timedFetch(path, cookie, timeout);
      const ok = res.ok && body && typeof body === "object";
      log(ok, label, `${res.status} ${ms}ms`);
      if (!ok && body?.error) console.log(`    ${body.error}`);
    } catch (e) {
      log(false, label, e instanceof Error ? e.message : String(e));
    }
  }

  console.log(`\nResult: ${fail === 0 ? "ALL MODULE APIS OK" : `${fail} FAILED`}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
