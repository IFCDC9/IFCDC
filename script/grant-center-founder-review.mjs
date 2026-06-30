#!/usr/bin/env node
/**
 * Grant Center — Founder visual review checklist (API + RBAC simulation).
 * Usage:
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   MASTER_OWNER_EMAIL=813786b@gmail.com \
 *   FOUNDER_SEED_PASSWORD=<from Render> \
 *   node script/grant-center-founder-review.mjs
 */
import jwt from "jsonwebtoken";

const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com";
const FOUNDER_EMAIL = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
const FOUNDER_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "";
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "DEV_ONLY_CHANGE_ME_IFCDC";

const results = { pass: 0, fail: 0, warn: 0 };

function log(status, msg, detail = "") {
  const icon = status === "pass" ? "✓" : status === "warn" ? "⚠" : "✗";
  console.log(`${icon} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : status === "warn" ? "warn" : "fail"]++;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  let body = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text?.slice(0, 120) }; }
  return { res, body, ok: res.ok };
}

async function login(email, password) {
  const { ok, res } = await jsonFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!ok) throw new Error(`Login failed (${res.status}) for ${email}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

function boardHeaders() {
  const token = jwt.sign(
    { id: "review-board", email: "board-review@ifcdc.org", role: "board_member", name: "Board Review" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Cookie: `ifcdc_token=${token}` };
}

const REVIEW_SECTIONS = [
  { path: "/api/hq/grants/dashboard", label: "Dashboard KPIs" },
  { path: "/api/hq/grants/center/executive-summary", label: "Executive summary" },
  { path: "/api/hq/grants/center/platform", label: "Platform registry" },
  { path: "/api/hq/grants/center/opportunity-finder", label: "Opportunity finder (search/filters)" },
  { path: "/api/hq/grants/funding-engine/v5/pipeline/board", label: "Pipeline kanban" },
  { path: "/api/hq/grants/applications", label: "Applications table" },
  { path: "/api/hq/grants/funders", label: "Partner CRM" },
  { path: "/api/hq/grants/calendar", label: "Grant calendar" },
  { path: "/api/hq/grants/deadlines", label: "Deadlines" },
  { path: "/api/hq/grants/documents", label: "Documents vault" },
  { path: "/api/hq/grants/awards", label: "Awards" },
  { path: "/api/hq/grants/budgets", label: "Budget builder data" },
  { path: "/api/hq/grants/compliance", label: "Compliance tracking" },
  { path: "/api/hq/grants/funder-reports", label: "Funder reports" },
  { path: "/api/hq/grants/center/analytics", label: "Funding analytics" },
  { path: "/api/hq/grants/notifications", label: "Notifications" },
  { path: "/api/hq/grants/history", label: "Activity history" },
  { path: "/api/hq/grants/funding-engine/v5/aura-advisor", label: "AI intelligence briefing" },
];

async function main() {
  console.log("\n=== Grant Center Founder Visual Review (API) ===\n");
  console.log(`Target: ${BASE}`);
  console.log(`Founder: ${FOUNDER_EMAIL}\n`);

  if (!FOUNDER_PASSWORD) {
    log("fail", "FOUNDER_SEED_PASSWORD required", "Set from Render dashboard env vars");
    process.exit(1);
  }

  const health = await jsonFetch(`${BASE}/api/health`);
  log(health.ok && health.body?.commit ? "pass" : "fail", "Production health", `commit=${health.body?.commit ?? "?"}`);

  let cookie;
  try {
    cookie = await login(FOUNDER_EMAIL, FOUNDER_PASSWORD);
    log("pass", "Founder authentication");
  } catch (e) {
    log("fail", "Founder authentication", e.message);
    console.log("\nSet MASTER_OWNER_EMAIL=813786b@gmail.com and FOUNDER_SEED_PASSWORD from Render.\n");
    process.exit(1);
  }

  const auth = { headers: { Cookie: cookie } };

  const session = await jsonFetch(`${BASE}/api/hq/auth/session`, auth);
  log(session.ok && session.body?.user?.enterpriseRole === "founder" ? "pass" : "warn", "Founder session role", session.body?.user?.enterpriseRole ?? "?");

  const spa = await jsonFetch(`${BASE}/hq/grants`, auth);
  log(spa.ok && String(spa.body?._raw ?? "").includes("root") || spa.res.ok ? "pass" : "fail", "Grant Center SPA route", String(spa.res.status));

  console.log("\n── Founder data surfaces ──");
  for (const section of REVIEW_SECTIONS) {
    const r = await jsonFetch(`${BASE}${section.path}`, auth);
    const isJson = r.body && !String(r.body._raw ?? "").includes("<!DOCTYPE");
    log(r.ok && isJson ? "pass" : "fail", section.label, String(r.res.status));
    if (section.path.includes("funder-reports") && r.res.status === 503) {
      log("warn", "Funder reports 503", "live data unavailable — acceptable if no awards");
    }
  }

  console.log("\n── Read-only RBAC (board member) ──");
  const boardRead = await jsonFetch(`${BASE}/api/hq/grants/dashboard`, { headers: boardHeaders() });
  log(boardRead.ok ? "pass" : "fail", "Board read: dashboard");

  const boardWrite = await jsonFetch(`${BASE}/api/hq/grants/opportunities`, {
    method: "POST",
    headers: boardHeaders(),
    body: JSON.stringify({ title: "RBAC review", funder: "Test" }),
  });
  log(boardWrite.res.status === 403 ? "pass" : "fail", "Board write blocked", String(boardWrite.res.status));

  const founderWrite = await jsonFetch(`${BASE}/api/hq/grants/opportunities`, {
    ...auth,
    method: "POST",
    body: JSON.stringify({
      title: `review-${Date.now()}`,
      funder: "Review",
      geography: "local",
      status: "closed",
    }),
  });
  log(founderWrite.ok ? "pass" : "fail", "Founder write allowed", String(founderWrite.res.status));
  const reviewOppId = founderWrite.body?.opportunity?.id ?? founderWrite.body?.id;
  if (reviewOppId) {
    await jsonFetch(`${BASE}/api/hq/grants/opportunities/${reviewOppId}`, {
      ...auth,
      method: "PATCH",
      body: JSON.stringify({ status: "closed" }),
    });
  }

  console.log(`\n=== Founder Review: ${results.pass} PASS / ${results.fail} FAIL / ${results.warn} WARN ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
