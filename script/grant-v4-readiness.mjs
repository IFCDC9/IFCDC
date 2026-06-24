#!/usr/bin/env node
/**
 * IFCDC Grant Center v4 — Intelligent Funding Operations readiness gate
 */
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const FOUNDER_EMAIL = "service@ifcdc.org";
const FOUNDER_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const results = { pass: 0, fail: 0 };

function log(status, msg, detail = "") {
  console.log(`${status === "pass" ? "✓" : "✗"} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : "fail"]++;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...(opts.body ? { "Content-Type": "application/json" } : {}) } });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { res, body, ok: res.ok };
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
  console.log("\n=== IFCDC Grant Center v4 Readiness ===\n");
  const cookie = await login();
  log("pass", "Founder login");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const health = await jsonFetch(`${BASE}/api/hq/analytics/overview`, auth);
  const healthScore = health.body?.organizationHealth?.overall;
  log(health.ok && healthScore >= 100 ? "pass" : "fail", "Organization Health", `${healthScore ?? "?"}%`);

  const platform = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v4/platform`, auth);
  log(platform.ok && platform.body?.version === "v4" ? "pass" : "fail", "v4 Operations platform", platform.body?.version ?? "?");

  const lifecycle = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v4/lifecycle`, auth);
  log(lifecycle.ok && lifecycle.body?.stages?.length === 11 ? "pass" : "fail", "Grant lifecycle (11 stages)", `${lifecycle.body?.stages?.length ?? 0} stages`);

  const dashboard = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v4/dashboard`, auth);
  const exec = dashboard.body?.executive;
  log(
    dashboard.ok && exec?.totalPipelineValue != null && exec?.organizationFundingForecast != null ? "pass" : "fail",
    "Executive operations dashboard",
    `$${exec?.totalPipelineValue ?? 0} pipeline`
  );

  const calendar = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v4/calendar`, auth);
  log(calendar.ok && Array.isArray(calendar.body?.events) ? "pass" : "fail", "Funding calendar", `${calendar.body?.events?.length ?? 0} events`);

  const programs = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v4/programs`, auth);
  const prog = programs.body?.programs?.[0];
  log(
    programs.ok && (programs.body?.programs?.length ?? 0) >= 10 && prog?.grantPortfolio != null ? "pass" : "fail",
    "Program integration",
    `${programs.body?.programs?.length ?? 0} programs`
  );

  const forecast = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v4/forecast`, auth);
  log(forecast.ok && forecast.body?.total12MonthProjection != null ? "pass" : "fail", "12-month forecast", `$${forecast.body?.total12MonthProjection ?? 0}`);

  const aura = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v4/aura`, {
    ...auth, method: "POST", body: JSON.stringify({ question: "What grants should we prioritize this month?" }),
  });
  log(aura.ok && typeof aura.body?.insight === "string" ? "pass" : "fail", "AURA executive advisor", `${aura.body?.insight?.length ?? 0} chars`);

  const v3 = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v3/platform`, auth);
  log(v3.ok ? "pass" : "fail", "v3 backward compatibility");

  console.log(`\n=== Grant Center v4: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
