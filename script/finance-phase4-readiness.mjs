#!/usr/bin/env node
/**
 * IFCDC Headquarters — Finance Phase 4 readiness gate
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
  console.log("\n=== IFCDC Finance Phase 4 Readiness ===\n");
  const cookie = await login();
  log("pass", "Founder login");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const health = await jsonFetch(`${BASE}/api/hq/analytics/overview`, auth);
  const healthScore = health.body?.organizationHealth?.overall;
  log(health.ok && healthScore >= 100 ? "pass" : "fail", "Organization Health", `${healthScore ?? "?"}%`);

  const platform = await jsonFetch(`${BASE}/api/hq/finance/operations/v4/platform`, auth);
  log(platform.ok && platform.body?.version === "phase4" ? "pass" : "fail", "Finance Command Center platform", platform.body?.version ?? "?");
  log((platform.body?.modules?.length ?? 0) >= 10 ? "pass" : "fail", "Finance modules", `${platform.body?.modules?.length ?? 0} modules`);

  const overview = await jsonFetch(`${BASE}/api/hq/finance/overview`, auth);
  log(overview.ok && overview.body?.financialHealthScore != null ? "pass" : "fail", "Finance overview", `${overview.body?.financialHealthScore ?? "?"} health`);

  const execBudget = await jsonFetch(`${BASE}/api/hq/finance/operations/v4/executive-budget`, auth);
  log(execBudget.ok && execBudget.body?.totalOrganizationalBudget != null ? "pass" : "fail", "Executive budget dashboard");

  const revenue = await jsonFetch(`${BASE}/api/hq/finance/operations/v4/revenue`, auth);
  log(revenue.ok && revenue.body?.summary != null ? "pass" : "fail", "Revenue tracking");

  const grantPortfolio = await jsonFetch(`${BASE}/api/hq/finance/operations/v4/grant-portfolio`, auth);
  log(grantPortfolio.ok && grantPortfolio.body?.totals != null ? "pass" : "fail", "Grant financial integration", `${grantPortfolio.body?.grants?.length ?? 0} grants`);

  const accounts = await jsonFetch(`${BASE}/api/hq/finance/accounts`, auth);
  log(accounts.ok && (accounts.body?.accounts?.length ?? 0) > 0 ? "pass" : "fail", "Chart of Accounts", `${accounts.body?.accounts?.length ?? 0} accounts`);

  const budgets = await jsonFetch(`${BASE}/api/hq/finance/budgets`, auth);
  log(budgets.ok && Array.isArray(budgets.body?.budgets) ? "pass" : "fail", "Budget management", `${budgets.body?.budgets?.length ?? 0} budgets`);

  const expenses = await jsonFetch(`${BASE}/api/hq/finance/expenses`, auth);
  log(expenses.ok && Array.isArray(expenses.body?.expenses) ? "pass" : "fail", "Expense tracking");

  const ap = await jsonFetch(`${BASE}/api/hq/finance/accounts-payable`, auth);
  log(ap.ok ? "pass" : "fail", "Accounts payable");

  const ar = await jsonFetch(`${BASE}/api/hq/finance/accounts-receivable`, auth);
  log(ar.ok ? "pass" : "fail", "Accounts receivable");

  const statements = await jsonFetch(`${BASE}/api/hq/finance/statements`, auth);
  log(statements.ok && statements.body?.balanceSheet != null ? "pass" : "fail", "Financial statements");

  const bank = await jsonFetch(`${BASE}/api/hq/finance/bank/accounts`, auth);
  log(bank.ok && Array.isArray(bank.body?.accounts) ? "pass" : "fail", "Bank account management", `${bank.body?.accounts?.length ?? 0} accounts`);

  const audit = await jsonFetch(`${BASE}/api/hq/finance/audit`, auth);
  log(audit.ok && Array.isArray(audit.body?.audit) ? "pass" : "fail", "Finance audit log", `${audit.body?.audit?.length ?? 0} entries`);

  const payroll = await jsonFetch(`${BASE}/api/hq/finance/payroll/overview`, auth);
  log(payroll.ok ? "pass" : "fail", "Payroll integration");

  const anomalies = await jsonFetch(`${BASE}/api/hq/finance/operations/v4/anomalies`, auth);
  log(anomalies.ok && Array.isArray(anomalies.body?.anomalies) ? "pass" : "fail", "Spending anomaly detection");

  const briefing = await jsonFetch(`${BASE}/api/hq/finance/operations/v4/aura-briefing`, auth);
  log(briefing.ok && (briefing.body?.auraInsight || briefing.body?.insight) ? "pass" : "fail", "AURA executive financial briefing");

  const forecast = await jsonFetch(`${BASE}/api/hq/finance/intelligence/forecast`, auth);
  log(forecast.ok ? "pass" : "fail", "Cash flow forecasting");

  const grantsV5 = await jsonFetch(`${BASE}/api/hq/grants/funding-engine/v5/platform`, auth);
  log(grantsV5.ok ? "pass" : "fail", "Grant Center v5 backward compatibility");

  const peopleReadiness = await jsonFetch(`${BASE}/api/hq/people/operations/v3/platform`, auth);
  log(peopleReadiness.ok ? "pass" : "fail", "People Phase 3 backward compatibility");

  const writeGuard = await jsonFetch(`${BASE}/api/hq/finance/expenses`, {
    ...auth, method: "POST", body: JSON.stringify({ category: "operations", description: "Phase 4 readiness test expense", amount: 1 }),
  });
  log(writeGuard.ok ? "pass" : "fail", "Finance write API (founder)");

  console.log(`\n=== Finance Phase 4: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
