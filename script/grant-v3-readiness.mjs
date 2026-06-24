#!/usr/bin/env node
/**
 * IFCDC Grant Center v3 — Intelligent Funding Engine readiness gate
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
  console.log("\n=== IFCDC Grant Center v3 Readiness ===\n");
  const cookie = await login();
  log("pass", "Founder login");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const health = await jsonFetch(`${BASE}/api/hq/analytics/overview`, auth);
  const healthScore = health.body?.organizationHealth?.overall;
  log(health.ok && healthScore >= 100 ? "pass" : "fail", "Organization Health", `${healthScore ?? "?"}%`);

  const platform = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v3/platform`, auth);
  log(platform.ok && platform.body?.version === "v3" ? "pass" : "fail", "v3 Intelligent platform", platform.body?.version ?? "?");

  const dashboard = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v3/dashboard`, auth);
  const exec = dashboard.body?.executive;
  log(
    dashboard.ok && exec?.totalOpportunities != null && exec?.estimatedAnnualPipeline != null ? "pass" : "fail",
    "Executive dashboard",
    `$${exec?.estimatedAnnualPipeline ?? 0} annual pipeline`
  );

  const discovery = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v3/discovery?limit=10`, auth);
  log(discovery.ok && Array.isArray(discovery.body?.ranked) ? "pass" : "fail", "AI grant discovery", `${discovery.body?.totalScored ?? 0} scored`);

  const profiles = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v3/profiles`, auth);
  const first = profiles.body?.profiles?.[0];
  log(
    profiles.ok && (profiles.body?.profiles?.length ?? 0) >= 10 && first?.outcomeMetrics != null ? "pass" : "fail",
    "Program funding profiles",
    `${profiles.body?.profiles?.length ?? 0} programs`
  );

  const renewals = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v3/renewals`, auth);
  log(renewals.ok && Array.isArray(renewals.body?.events) ? "pass" : "fail", "Renewal calendar", `${renewals.body?.upcoming90Days ?? 0} in 90d`);

  const docs = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v3/documents`, auth);
  log(docs.ok && Array.isArray(docs.body?.byCategory) ? "pass" : "fail", "Document center", `${docs.body?.totalDocuments ?? 0} docs`);

  const questions = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v3/aura/questions`, auth);
  log(questions.ok && (questions.body?.questions?.length ?? 0) >= 5 ? "pass" : "fail", "AURA executive questions", `${questions.body?.questions?.length ?? 0} prompts`);

  const aura = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v3/aura`, {
    ...auth, method: "POST", body: JSON.stringify({ question: "Which grants should we apply for next?" }),
  });
  log(aura.ok && typeof aura.body?.insight === "string" && aura.body?.staffingAffordability != null ? "pass" : "fail", "AURA executive intelligence", `${aura.body?.insight?.length ?? 0} chars`);

  const v2 = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v2/dashboard`, auth);
  log(v2.ok ? "pass" : "fail", "v2 backward compatibility");

  console.log(`\n=== Grant Center v3: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
