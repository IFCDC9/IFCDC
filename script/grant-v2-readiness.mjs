#!/usr/bin/env node
/**
 * IFCDC Grant Center v2 readiness gate — Funding Engine Buildout
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
  console.log("\n=== IFCDC Grant Center v2 Readiness ===\n");
  const cookie = await login();
  log("pass", "Founder login");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const health = await jsonFetch(`${BASE}/api/hq/analytics/overview`, auth);
  const healthScore = health.body?.organizationHealth?.overall;
  log(health.ok && healthScore >= 100 ? "pass" : "fail", "Organization Health", `${healthScore ?? "?"}%`);

  const dashboard = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v2/dashboard`, auth);
  const totals = dashboard.body?.totals;
  log(
    dashboard.ok && totals?.totalOpportunities != null && totals?.totalRequested != null ? "pass" : "fail",
    "Funding Engine dashboard",
    `${totals?.totalOpportunities ?? 0} opps · $${totals?.totalAwarded ?? 0} awarded`
  );

  const pipeline = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v2/pipeline`, auth);
  log(pipeline.ok && Array.isArray(pipeline.body?.stages) && pipeline.body.stages.length === 8 ? "pass" : "fail", "v2 Pipeline (8 statuses)", `${pipeline.body?.stages?.length ?? 0} stages`);

  const analytics = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v2/analytics`, auth);
  log(analytics.ok && analytics.body?.totalAwarded != null ? "pass" : "fail", "Executive analytics", `projected $${analytics.body?.projectedRevenue ?? 0}`);

  const finance = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v2/finance`, auth);
  log(finance.ok && finance.body?.linkedBudgets != null ? "pass" : "fail", "Finance connection", `${finance.body?.linkedBudgets ?? 0} linked budgets`);

  const recommendations = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v2/recommendations`, auth);
  log(recommendations.ok && Array.isArray(recommendations.body?.actions) ? "pass" : "fail", "AURA recommendations", `${recommendations.body?.actions?.length ?? 0} actions`);

  const profiles = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v2/divisions/profiles`, auth);
  log(profiles.ok && (profiles.body?.profiles?.length ?? 0) >= 10 ? "pass" : "fail", "Division profiles", `${profiles.body?.profiles?.length ?? 0} divisions`);

  const live = await jsonFetch(`${BASE}/api/hq/grants/opportunities/live?limit=10`, auth);
  log(live.ok && Array.isArray(live.body?.opportunities) ? "pass" : "fail", "Live opportunity DB", `${live.body?.opportunities?.length ?? 0} live`);

  const match = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v2/match`, {
    ...auth, method: "POST", body: JSON.stringify({ divisionSlug: "barbers" }),
  });
  log(match.ok && Array.isArray(match.body?.matches) ? "pass" : "fail", "AI division matching", `${match.body?.matches?.length ?? 0} matches`);

  const checklist = await jsonFetch(`${BASE}/api/hq/grants/documents/checklist`, auth);
  log(checklist.ok && Array.isArray(checklist.body?.byCategory) ? "pass" : "fail", "Document checklist", `${checklist.body?.byCategory?.length ?? 0} categories`);

  const aura = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v2/aura`, {
    ...auth, method: "POST", body: JSON.stringify({}),
  });
  log(aura.ok && typeof aura.body?.insight === "string" && aura.body?.capacityEstimate != null ? "pass" : "fail", "AURA v2 intelligence", `capacity $${aura.body?.capacityEstimate ?? 0}`);

  console.log(`\n=== Grant Center v2: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
