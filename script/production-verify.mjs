#!/usr/bin/env node
/**
 * IFCDC Headquarters — Phase 1 production verification gate.
 * Usage: IFCDC_BASE_URL=https://ifcdc-hq.onrender.com npm run production:verify
 */
import { spawnSync } from "node:child_process";

const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq.onrender.com";
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
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text?.slice(0, 200) };
  }
  return { res, body, ok: res.ok, text };
}

function runNodeScript(script) {
  const proc = spawnSync("node", [script], {
    stdio: "pipe",
    env: {
      ...process.env,
      IFCDC_BASE_URL: BASE,
      MASTER_OWNER_EMAIL: FOUNDER_EMAIL,
      FOUNDER_SEED_PASSWORD: FOUNDER_PASSWORD,
    },
  });
  const out = `${proc.stdout?.toString() ?? ""}${proc.stderr?.toString() ?? ""}`.trim();
  return { status: proc.status ?? 1, out };
}

async function main() {
  console.log(`\n=== IFCDC Headquarters Production Verification (${BASE}) ===\n`);

  const health = await jsonFetch(`${BASE}/api/health`);
  const healthy =
    health.ok &&
    health.body?.app === "ifcdc-headquarters" &&
    health.body?.status === "healthy";
  log(healthy ? "pass" : "fail", "Health check /api/health", String(health.res.status));
  if (!healthy) {
    const suspended = String(health.text ?? "").includes("suspended");
    if (suspended) {
      console.error("\nService appears suspended on Render. Resume IFCDC-HQ for public verification.\n");
    }
    process.exit(1);
  }

  const spaRoutes = [
    ["/hq", "Executive Dashboard"],
    ["/hq/people", "People & HR"],
    ["/hq/grants", "Grant Center"],
    ["/hq/finance", "Finance Command Center"],
    ["/hq/communications", "Communications Center"],
    ["/hq/documents", "Document Center"],
    ["/hq/software", "Software Division"],
  ];
  for (const [route, label] of spaRoutes) {
    const page = await jsonFetch(`${BASE}${route}`);
    const isHtml = String(page.text ?? "").includes("<!DOCTYPE") || String(page.text ?? "").includes("<html");
    log(isHtml ? "pass" : "fail", `SPA route: ${label}`, route);
  }

  const login = await jsonFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email: FOUNDER_EMAIL, password: FOUNDER_PASSWORD }),
  });
  log(login.ok ? "pass" : "fail", "Authentication login", String(login.res.status));
  if (!login.ok) process.exit(1);

  const cookie = (login.res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const dbProbe = await jsonFetch(`${BASE}/api/hq/analytics/overview`, auth);
  log(dbProbe.ok && dbProbe.body?.organizationHealth ? "pass" : "fail", "Database connectivity (SQLite)", dbProbe.ok ? "overview OK" : String(dbProbe.res.status));

  const envProbe = await jsonFetch(`${BASE}/api/hq/developer/env-validation`, auth);
  const envOk = envProbe.ok && Array.isArray(envProbe.body?.checks);
  log(envOk ? "pass" : "skip", "Environment validation panel", envOk ? "checks returned" : "route unavailable");

  console.log("\n--- Grant Center deploy verify ---\n");
  const deployVerify = runNodeScript("script/grant-center-deploy-verify.mjs");
  if (deployVerify.out) console.log(deployVerify.out);
  log(deployVerify.status === 0 ? "pass" : "fail", "Grant Center deploy verify suite");

  console.log("\n--- Grant Center QA (33 checks) ---\n");
  const grantsQa = runNodeScript("script/grant-center-qa.mjs");
  if (grantsQa.out) console.log(grantsQa.out);
  log(grantsQa.status === 0 ? "pass" : "fail", "Grant Center QA suite");

  console.log("\n--- People & HR readiness ---\n");
  const people = runNodeScript("script/people-phase3-readiness.mjs");
  if (people.out) console.log(people.out);
  log(people.status === 0 ? "pass" : "fail", "People & HR readiness suite");

  console.log("\n--- HQ navigation audit ---\n");
  const navAudit = runNodeScript("script/hq-nav-audit.mjs");
  if (navAudit.out) console.log(navAudit.out);
  log(navAudit.status === 0 ? "pass" : "fail", "HQ navigation audit");

  console.log("\n--- Communications readiness ---\n");
  const comms = runNodeScript("script/communications-readiness.mjs");
  if (comms.out) console.log(comms.out);
  log(comms.status === 0 ? "pass" : "fail", "Communications readiness suite");

  console.log("\n--- Documents readiness ---\n");
  const docs = runNodeScript("script/documents-readiness.mjs");
  if (docs.out) console.log(docs.out);
  log(docs.status === 0 ? "pass" : "fail", "Documents readiness suite");

  console.log(`\n=== Production Verification: ${results.pass} PASS / ${results.fail} FAIL / ${results.skip} SKIP ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
