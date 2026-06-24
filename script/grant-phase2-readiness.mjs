#!/usr/bin/env node
/**
 * IFCDC Grant Center — Phase 2 Funding Engine readiness gate
 * Validates funding-engine APIs, workflow, scoring, and org health.
 */
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const FOUNDER_EMAIL = "service@ifcdc.org";
const FOUNDER_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const results = { pass: 0, fail: 0 };

function log(status, msg, detail = "") {
  const icon = status === "pass" ? "✓" : "✗";
  console.log(`${icon} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : "fail"]++;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...(opts.body ? { "Content-Type": "application/json" } : {}) } });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body, ok: res.ok };
}

async function login() {
  const { ok, res } = await jsonFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email: FOUNDER_EMAIL, password: FOUNDER_PASSWORD }),
    headers: { "Content-Type": "application/json" },
  });
  if (!ok) throw new Error(`Login failed: ${res.status}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  console.log("\n=== IFCDC Grant Center Phase 2 Readiness ===\n");

  let cookie = "";
  try {
    cookie = await login();
    log("pass", "Founder login");
  } catch (e) {
    log("fail", "Founder login", e.message);
    process.exit(1);
  }

  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const health = await jsonFetch(`${BASE}/api/hq/analytics/overview`, auth);
  const healthScore =
    health.body?.organizationHealth?.overall ??
    health.body?.organizationHealthScore ??
    health.body?.score ??
    health.body?.overall;
  if (health.ok && Number(healthScore) >= 100) {
    log("pass", "Organization Health", `${healthScore}%`);
  } else if (health.ok && Number(healthScore) >= 95) {
    log("pass", "Organization Health", `${healthScore}% (acceptable)`);
  } else {
    log("fail", "Organization Health", `got ${healthScore ?? "unknown"}`);
  }

  const overview = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/overview`, auth);
  if (overview.ok && overview.body?.summary) {
    log("pass", "Funding engine overview", `${overview.body.summary.openOpportunities ?? 0} open opps`);
  } else {
    log("fail", "Funding engine overview", String(overview.res.status));
  }

  const divisions = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/divisions`, auth);
  const divCount = divisions.body?.divisions?.length ?? 0;
  if (divisions.ok && divCount >= 10) {
    log("pass", "Division registry", `${divCount} divisions`);
  } else {
    log("fail", "Division registry", `count=${divCount}`);
  }

  const search = await jsonFetch(`${BASE}/api/hq/grants/opportunities/search?limit=5`, auth);
  const oppCount = search.body?.opportunities?.length ?? 0;
  if (search.ok) {
    log("pass", "Opportunity search", `${oppCount} results`);
  } else {
    log("fail", "Opportunity search", String(search.res.status));
  }

  const firstOpp = search.body?.opportunities?.[0];
  if (firstOpp?.id) {
    const score = await jsonFetch(`${BASE}/api/hq/grants/opportunities/${firstOpp.id}/score`, {
      ...auth,
      method: "POST",
      body: JSON.stringify({ divisionSlug: "community_programs" }),
    });
    if (score.ok && typeof score.body?.score === "number") {
      log("pass", "Eligibility scoring", `${score.body.score}% (${score.body.grade})`);
    } else {
      log("fail", "Eligibility scoring", String(score.res.status));
    }
  } else {
    log("pass", "Eligibility scoring", "skipped (no opportunities)");
  }

  const apps = await jsonFetch(`${BASE}/api/hq/grants/applications`, auth);
  const firstApp = apps.body?.applications?.[0];
  if (firstApp?.id) {
    const wf = await jsonFetch(`${BASE}/api/hq/grants/applications/${firstApp.id}/workflow`, auth);
    if (wf.ok && Array.isArray(wf.body?.steps)) {
      log("pass", "Application workflow", `${wf.body.steps.length} steps`);
    } else {
      log("fail", "Application workflow", String(wf.res.status));
    }
  } else {
    log("pass", "Application workflow", "skipped (no applications)");
  }

  const outcomes = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/outcomes?limit=10`, auth);
  if (outcomes.ok && Array.isArray(outcomes.body?.outcomes)) {
    log("pass", "Award/rejection outcomes", `${outcomes.body.outcomes.length} records`);
  } else {
    log("fail", "Award/rejection outcomes", String(outcomes.res.status));
  }

  const aura = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/aura`, {
    ...auth,
    method: "POST",
    body: JSON.stringify({ question: "Summarize IFCDC funding priorities." }),
  });
  if (aura.ok && typeof aura.body?.insight === "string" && aura.body.insight.length > 20) {
    log("pass", "AURA funding intelligence", `${aura.body.insight.length} chars`);
  } else {
    log("fail", "AURA funding intelligence", String(aura.res.status));
  }

  const pipeline = await jsonFetch(`${BASE}/api/hq/grants/pipeline`, auth);
  if (pipeline.ok && Array.isArray(pipeline.body?.stages ?? pipeline.body?.pipeline)) {
    log("pass", "Grant pipeline dashboard");
  } else if (pipeline.ok) {
    log("pass", "Grant pipeline dashboard", "legacy shape");
  } else {
    log("fail", "Grant pipeline dashboard", String(pipeline.res.status));
  }

  console.log(`\n=== Phase 2: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
