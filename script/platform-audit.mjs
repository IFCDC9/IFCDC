#!/usr/bin/env node
/**
 * IFCDC Headquarters — Phase 2 end-to-end platform audit.
 * Usage: IFCDC_BASE_URL=https://ifcdc-hq.onrender.com npm run platform:audit
 */
import { spawnSync } from "node:child_process";

const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const FOUNDER_EMAIL = process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org";
const FOUNDER_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const results = { pass: 0, fail: 0, skip: 0 };

function log(status, msg, detail = "") {
  const icon = status === "pass" ? "✓" : status === "skip" ? "○" : "✗";
  console.log(`${icon} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status]++;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { res, body, ok: res.ok, text };
}

function runScript(script) {
  const proc = spawnSync("node", [script], {
    stdio: "pipe",
    env: { ...process.env, IFCDC_BASE_URL: BASE, MASTER_OWNER_EMAIL: FOUNDER_EMAIL, FOUNDER_SEED_PASSWORD: FOUNDER_PASSWORD },
  });
  return { status: proc.status ?? 1, out: `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim() };
}

async function main() {
  console.log(`\n=== IFCDC HQ Platform Audit (${BASE}) ===\n`);

  const health = await jsonFetch(`${BASE}/api/health`);
  log(health.ok && health.body?.status === "healthy" ? "pass" : "fail", "Health check", String(health.res.status));

  const login = await jsonFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email: FOUNDER_EMAIL, password: FOUNDER_PASSWORD }),
  });
  log(login.ok ? "pass" : "fail", "Authentication");
  if (!login.ok) process.exit(1);

  const cookie = (login.res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const unauthAdmin = await jsonFetch(`${BASE}/api/admin/funding-sources`);
  log(!unauthAdmin.ok ? "pass" : "fail", "RBAC: admin funding secured", String(unauthAdmin.res.status));

  const unauthEnterprise = await jsonFetch(`${BASE}/api/hq/enterprise/search?q=test`);
  log(!unauthEnterprise.ok ? "pass" : "fail", "RBAC: enterprise search secured", String(unauthEnterprise.res.status));

  const grantPlatform = await jsonFetch(`${BASE}/api/hq/grants/center/platform`, auth);
  const connectedFeeds = Object.values(grantPlatform.body?.integrations ?? {}).filter((i) => i?.status === "connected").length;
  log(grantPlatform.ok && connectedFeeds >= 1 ? "pass" : "fail", "Grant Center live feeds", `${connectedFeeds} connected`);

  const ssoApps = await jsonFetch(`${BASE}/api/hq/auth/sso/apps`, auth);
  const launchable = (ssoApps.body?.apps ?? []).filter((a) => a.status !== "production-locked").length;
  log(ssoApps.ok && launchable > 0 ? "pass" : "fail", "SSO Gateway apps", `${launchable} launchable`);

  const feedsSync = await jsonFetch(`${BASE}/api/hq/grants/feeds/sync`, { ...auth, method: "POST", body: JSON.stringify({}) });
  log(feedsSync.ok ? "pass" : "fail", "Grant feed sync endpoint");

  const suites = [
    ["hq-nav-audit.mjs", "Navigation audit"],
    ["communications-readiness.mjs", "Communications"],
    ["documents-readiness.mjs", "Documents"],
    ["grant-center-readiness.mjs", "Grant Center"],
    ["people-phase3-readiness.mjs", "People & HR"],
  ];

  for (const [script, label] of suites) {
    console.log(`\n--- ${label} ---\n`);
    const run = runScript(`script/${script}`);
    if (run.out) console.log(run.out);
    log(run.status === 0 ? "pass" : "fail", `${label} suite`);
  }

  console.log(`\n=== Platform Audit: ${results.pass} PASS / ${results.fail} FAIL / ${results.skip} SKIP ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
