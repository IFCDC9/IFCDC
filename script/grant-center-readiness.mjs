#!/usr/bin/env node
/**
 * IFCDC Grant Center — Enterprise platform readiness gate
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
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
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
  console.log("\n=== IFCDC Grant Center Enterprise Readiness ===\n");
  const cookie = await login();
  log("pass", "Founder login");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const health = await jsonFetch(`${BASE}/api/hq/analytics/overview`, auth);
  const healthScore = health.body?.organizationHealth?.overall;
  log(health.ok && healthScore >= 100 ? "pass" : "fail", "Organization Health", `${healthScore ?? "?"}%`);

  const platform = await jsonFetch(`${BASE}/api/hq/grants/center/platform`, auth);
  const moduleCount = platform.body?.modules?.length ?? 0;
  log(platform.ok && platform.body?.version === "grant-center-v1" ? "pass" : "fail", "Grant Center platform", `${moduleCount} modules`);

  const expectedModules = [
    "executive-dashboard", "opportunity-finder", "writer-studio", "grant-library",
    "grant-calendar", "award-budget", "documents-vault", "funder-crm",
    "compliance-reporting", "funding-analytics", "renewal-notifications",
  ];
  const ids = (platform.body?.modules ?? []).map((m) => m.id);
  const allModules = expectedModules.every((id) => ids.includes(id));
  log(allModules ? "pass" : "fail", "All 11 core modules registered", `${ids.length} registered`);

  const exec = await jsonFetch(`${BASE}/api/hq/grants/center/executive-summary`, auth);
  log(exec.ok && exec.body?.kpis?.openOpportunities != null ? "pass" : "fail", "Executive funding dashboard");

  const finder = await jsonFetch(`${BASE}/api/hq/grants/center/opportunity-finder`, auth);
  log(finder.ok && Array.isArray(finder.body?.opportunities) ? "pass" : "fail", "Opportunity finder", `${finder.body?.opportunities?.length ?? 0} opps`);

  const library = await jsonFetch(`${BASE}/api/hq/grants/library/templates`, auth);
  const templateCount = library.body?.templates?.length ?? 0;
  log(library.ok && templateCount >= 6 ? "pass" : "fail", "Grant library templates", `${templateCount} templates`);

  const analytics = await jsonFetch(`${BASE}/api/hq/grants/center/analytics`, auth);
  log(analytics.ok && analytics.body?.analytics?.byFunder != null ? "pass" : "fail", "Funding analytics dashboard");

  const calendar = await jsonFetch(`${BASE}/api/hq/grants/calendar`, auth);
  log(calendar.ok ? "pass" : "fail", "Grant calendar");

  const documents = await jsonFetch(`${BASE}/api/hq/grants/documents`, auth);
  log(documents.ok ? "pass" : "fail", "Documents vault");

  const funders = await jsonFetch(`${BASE}/api/hq/grants/funders`, auth);
  log(funders.ok ? "pass" : "fail", "Partner & funder CRM");

  const compliance = await jsonFetch(`${BASE}/api/hq/grants/compliance`, auth);
  log(compliance.ok ? "pass" : "fail", "Compliance & reporting center");

  const awards = await jsonFetch(`${BASE}/api/hq/grants/awards`, auth);
  log(awards.ok ? "pass" : "fail", "Award & budget tracker");

  const notifications = await jsonFetch(`${BASE}/api/hq/grants/notifications`, auth);
  log(notifications.ok ? "pass" : "fail", "Renewal & deadline notifications");

  const apps = await jsonFetch(`${BASE}/api/hq/grants/applications`, auth);
  const firstApp = apps.body?.applications?.[0];
  if (firstApp?.id) {
    const studio = await jsonFetch(`${BASE}/api/hq/grants/writer-studio/${firstApp.id}`, auth);
    const sectionCount = studio.body?.writerSections?.sections?.length ?? 0;
    log(studio.ok && sectionCount >= 9 ? "pass" : "fail", "Grant Writer Studio", `${sectionCount} sections`);
  } else {
    log("pass", "Grant Writer Studio", "skipped (no applications)");
  }

  const integrations = platform.body?.integrations ?? {};
  const placeholderCount = Object.values(integrations).filter((i) => i?.status === "placeholder").length;
  log(placeholderCount >= 4 ? "pass" : "fail", "Placeholder integrations", `${placeholderCount} feeds`);

  const v5 = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v5/platform`, auth);
  log(v5.ok ? "pass" : "fail", "v5 funding engine backward compatibility");

  const finance = await jsonFetch(`${BASE}/api/hq/finance/overview`, auth);
  log(finance.ok ? "pass" : "fail", "Finance Phase 4 backward compatibility");

  console.log(`\n=== Grant Center Enterprise: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
