#!/usr/bin/env node
/**
 * Post-deployment smoke test for Grant Center v1
 * Usage: IFCDC_BASE_URL=https://your-production-url npm run grants:deploy-verify
 */
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const FOUNDER_EMAIL = process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org";
const FOUNDER_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const results = { pass: 0, fail: 0 };

function log(status, msg, detail = "") {
  console.log(`${status === "pass" ? "✓" : "✗"} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : "fail"]++;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  let body = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text?.slice(0, 200) }; }
  return { res, body, ok: res.ok, text };
}

async function login() {
  const { ok, res } = await jsonFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email: FOUNDER_EMAIL, password: FOUNDER_PASSWORD }),
  });
  if (!ok) throw new Error(`Login failed: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  console.log(`\n=== Grant Center Deploy Verification (${BASE}) ===\n`);

  const health = await jsonFetch(`${BASE}/api/health`);
  log(health.ok ? "pass" : "fail", "Health endpoint", String(health.res.status));

  const spa = await jsonFetch(`${BASE}/hq/grants`);
  const isHtml = String(spa.text ?? "").includes("<!DOCTYPE") || String(spa.text ?? "").includes("<html");
  log(isHtml ? "pass" : "fail", "Grant Center SPA route", isHtml ? "HTML served" : "missing SPA");

  const cookie = await login();
  log("pass", "Production authentication");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const platform = await jsonFetch(`${BASE}/api/hq/grants/center/platform`, auth);
  const isJson = platform.body?.version === "grant-center-v1";
  log(isJson ? "pass" : "fail", "Grant Center platform API", platform.body?.version ?? "invalid");

  const modules = platform.body?.modules?.length ?? 0;
  log(modules === 11 ? "pass" : "fail", "11 modules live", String(modules));

  const org = await jsonFetch(`${BASE}/api/hq/analytics/overview`, auth);
  const score = org.body?.organizationHealth?.overall;
  log(org.ok && score >= 90 ? "pass" : "fail", "Organization health", `${score ?? "?"}%`);

  console.log(`\n=== Deploy Verify: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
