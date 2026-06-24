#!/usr/bin/env node
/**
 * IFCDC Grant Center v5 — Funding Intelligence Engine readiness gate
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
  console.log("\n=== IFCDC Grant Center v5 Readiness ===\n");
  const cookie = await login();
  log("pass", "Founder login");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const health = await jsonFetch(`${BASE}/api/hq/analytics/overview`, auth);
  const healthScore = health.body?.organizationHealth?.overall;
  log(health.ok && healthScore >= 100 ? "pass" : "fail", "Organization Health", `${healthScore ?? "?"}%`);

  const platform = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v5/platform`, auth);
  log(platform.ok && platform.body?.version === "v5" ? "pass" : "fail", "v5 Intelligence platform", platform.body?.version ?? "?");

  const national = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v5/national?limit=20`, auth);
  log(national.ok && Array.isArray(national.body?.opportunities) ? "pass" : "fail", "National grant database", `${national.body?.opportunities?.length ?? 0} opps`);

  const matchAll = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v5/match-all?limit=3`, auth);
  log(matchAll.ok && (matchAll.body?.divisions?.length ?? 0) >= 10 ? "pass" : "fail", "Division matching", `${matchAll.body?.totalMatches ?? 0} matches`);

  const intelligence = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v5/intelligence`, auth);
  log(
    intelligence.ok && intelligence.body?.organizationSustainabilityIndex != null ? "pass" : "fail",
    "Executive intelligence",
    `sustainability ${intelligence.body?.organizationSustainabilityIndex ?? "?"}`
  );

  const compliance = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v5/compliance`, auth);
  log(compliance.ok && compliance.body?.summary?.healthScore != null ? "pass" : "fail", "Compliance dashboard", compliance.body?.summary?.status ?? "?");

  const projections = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v5/projections?years=5`, auth);
  log(projections.ok && projections.body?.fiveYearTotal != null ? "pass" : "fail", "Multi-year projections", `$${projections.body?.fiveYearTotal ?? 0}`);

  const tracker = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v5/renewal-reporting`, auth);
  log(tracker.ok && Array.isArray(tracker.body?.reporting) ? "pass" : "fail", "Renewal & reporting tracker");

  const performance = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v5/performance`, auth);
  log(performance.ok && performance.body?.activeAwards != null ? "pass" : "fail", "Performance metrics", `${performance.body?.activeAwards ?? 0} awards`);

  const apps = await jsonFetch(`${BASE}/api/hq/grants/applications`, auth);
  const firstApp = apps.body?.applications?.[0];
  if (firstApp?.id) {
    const workspace = await jsonFetch(`${BASE}/api/hq/grants/applications/${firstApp.id}/workspace`, auth);
    log(workspace.ok && workspace.body?.documentChecklist != null ? "pass" : "fail", "Application workspace", `${workspace.body?.completionPct ?? 0}% complete`);
    const score = await jsonFetch(`${BASE}/api/hq/grants/opportunities/${firstApp.opportunity_id || "x"}/score-v5`, {
      ...auth, method: "POST", body: JSON.stringify({ divisionSlug: "community_programs" }),
    });
    if (firstApp.opportunity_id) {
      log(score.ok && score.body?.scores?.composite != null ? "pass" : "fail", "Grant scoring v5", `composite ${score.body?.scores?.composite ?? "?"}`);
    } else {
      log("pass", "Grant scoring v5", "skipped (no linked opportunity)");
    }
  } else {
    log("pass", "Application workspace", "skipped (no applications)");
    log("pass", "Grant scoring v5", "skipped (no applications)");
  }

  const aura = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v5/aura`, {
    ...auth, method: "POST", body: JSON.stringify({ question: "What is our projected funding over the next 12 months?" }),
  });
  log(aura.ok && typeof aura.body?.insight === "string" ? "pass" : "fail", "AURA funding advisor", `${aura.body?.insight?.length ?? 0} chars`);

  const v4 = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v4/platform`, auth);
  log(v4.ok ? "pass" : "fail", "v4 backward compatibility");

  console.log(`\n=== Grant Center v5: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
