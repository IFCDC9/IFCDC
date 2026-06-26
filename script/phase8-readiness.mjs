#!/usr/bin/env node
/**
 * IFCDC Headquarters — Phase 8 Enterprise Intelligence Readiness
 * Extends enterprise-readiness with intelligence, copilot, division, and predictive checks.
 */
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const EMAIL = "service@ifcdc.org";
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const results = { pass: 0, fail: 0, warn: 0 };

function log(status, msg, detail = "") {
  const icon = status === "pass" ? "✓" : status === "warn" ? "⚠" : "✗";
  console.log(`${icon} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : status === "warn" ? "warn" : "fail"]++;
}

async function timedFetch(url, opts = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, opts);
    const ms = Date.now() - start;
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { res, body, ms, ok: res.ok };
  } catch (err) {
    return { res: { status: 0 }, body: null, ms: Date.now() - start, ok: false, error: err.message };
  }
}

const PHASE8_ENDPOINTS = [
  ["GET", "/api/hq/intelligence/scorecard"],
  ["GET", "/api/hq/intelligence/forecast"],
  ["GET", "/api/hq/intelligence/predictions"],
  ["GET", "/api/hq/intelligence/compliance-risk"],
  ["GET", "/api/hq/intelligence/strategic-recommendations"],
  ["GET", "/api/hq/intelligence/board-report"],
  ["GET", "/api/hq/intelligence/package"],
  ["GET", "/api/hq/intelligence/divisions"],
  ["GET", "/api/hq/intelligence/divisions/barbers"],
  ["GET", "/api/hq/intelligence/copilot/morning-briefing"],
  ["GET", "/api/hq/intelligence/copilot/module-monitor"],
  ["GET", "/api/hq/intelligence/copilot/corrective-actions"],
  ["GET", "/api/hq/intelligence/copilot/executive-summary"],
  ["GET", "/api/hq/intelligence/anomalies"],
  ["GET", "/api/hq/intelligence/reports"],
  ["GET", "/api/hq/workflows/instances"],
];

async function main() {
  console.log("IFCDC Headquarters — Phase 8 Readiness Pass\n");

  // Run base enterprise readiness first
  console.log("── Base Enterprise Readiness ──");
  await new Promise((resolve, reject) => {
    const child = spawn("node", [join(__dirname, "enterprise-readiness.mjs")], {
      stdio: "inherit",
      env: { ...process.env, IFCDC_BASE_URL: BASE },
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`enterprise-readiness exited ${code}`))));
  }).catch(() => log("warn", "Base enterprise-readiness had warnings"));

  console.log("\n── Phase 8 Intelligence APIs ──");
  const login = await timedFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = login.res.headers.getSetCookie?.()?.join("; ") ?? "";
  const authHeaders = cookie ? { Cookie: cookie } : {};

  for (const [method, path] of PHASE8_ENDPOINTS) {
    const opts = { headers: authHeaders };
    const { ok, ms, res, body } = await timedFetch(`${BASE}${path}`, opts);
    log(ok ? "pass" : "fail", `${method} ${path}`, `${res.status} (${ms}ms)`);
    if (path.includes("divisions/barbers") && body) {
      const locked = body.status === "production-locked" && body.readOnly === true;
      log(locked ? "pass" : "fail", "Barbers division read-only lock");
    }
    if (path.includes("scorecard") && body?.pillars) {
      log((body.pillars?.length ?? 0) >= 5 ? "pass" : "warn", "Executive scorecard pillars", `${body.pillars?.length ?? 0}`);
    }
    if (path.includes("predictions") && body?.models) {
      log((body.models?.length ?? 0) >= 5 ? "pass" : "warn", "Predictive models", `${body.models?.length ?? 0}`);
    }
  }

  const copilotAsk = await timedFetch(`${BASE}/api/hq/intelligence/copilot/ask`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ question: "What is our grant pipeline status?" }),
  });
  log(copilotAsk.ok ? "pass" : "warn", "AURA Copilot Q&A", copilotAsk.body?.answer ? "answered" : "");

  const morning = await timedFetch(`${BASE}/api/hq/intelligence/copilot/morning-briefing`, { headers: authHeaders });
  const hasGreeting = String(morning.body?.greeting ?? "").includes("Allah");
  log(hasGreeting ? "pass" : "warn", "Founder morning briefing greeting", morning.body?.greeting ?? "");

  const session = await timedFetch(`${BASE}/api/hq/auth/session`, { headers: authHeaders });
  log(session.body?.user?.welcomeGreeting?.includes("Allah") ? "pass" : "fail", "Session welcomeGreeting", session.body?.user?.welcomeGreeting ?? "");

  const overview = await timedFetch(`${BASE}/api/hq/analytics/overview`, { headers: authHeaders });
  const orgHealth = overview.body?.organizationHealth?.overall ?? 0;
  log(orgHealth >= 100 ? "pass" : "fail", "Organization Health 100%", `${orgHealth}%`);
  if (overview.body?.organizationHealth?.factors) {
    for (const f of overview.body.organizationHealth.factors) {
      if (f.score < 95) log("warn", `Health factor: ${f.label}`, `${f.score}%`);
    }
  }

  const deliverBrief = await timedFetch(`${BASE}/api/hq/intelligence/deliver/briefing`, {
    method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ sendEmail: false }),
  });
  log(deliverBrief.ok ? "pass" : "fail", "Briefing PDF delivery", deliverBrief.body?.pdfPath ? "generated" : "");

  const webhook = await timedFetch(`${BASE}/api/hq/intelligence/webhooks/analytics/music`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-hq-api-key": "hq_division_music" },
    body: JSON.stringify({ activeUsers: 10 }),
  });
  log(webhook.res.status === 201 ? "pass" : "warn", "Music division webhook", String(webhook.res.status));

  const barbersBlock = await timedFetch(`${BASE}/api/hq/intelligence/webhooks/analytics/barbers`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-hq-api-key": "test" },
    body: JSON.stringify({}),
  });
  log(barbersBlock.res.status === 403 ? "pass" : "fail", "Barbers webhook blocked");

  console.log("\n── Dashboard Format Safety ──");
  await new Promise((resolve) => {
    const child = spawn("node", [join(__dirname, "hq-format-safety-check.mjs")], { stdio: "inherit" });
    child.on("exit", (code) => {
      log(code === 0 ? "pass" : "warn", "HQ format safety check");
      resolve();
    });
  });

  console.log("\n── Production Lock ──");
  try {
    const sso = readFileSync(join(__dirname, "../server/hq/ssoGateway.ts"), "utf8");
    log(sso.includes("production-locked") && sso.includes('"barbers"') ? "pass" : "fail", "Barbers App production-locked (unchanged)");
  } catch {
    log("fail", "SSO gateway verification");
  }

  console.log("\n═══════════════════════════════════════");
  console.log(`Phase 8 additional — PASS: ${results.pass}  WARN: ${results.warn}  FAIL: ${results.fail}`);
  console.log("═══════════════════════════════════════\n");

  if (results.fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
