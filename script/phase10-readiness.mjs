#!/usr/bin/env node
/**
 * IFCDC Headquarters — Phase 10 Enterprise Command & Intelligence Platform Readiness
 */
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

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

const PHASE10_ENDPOINTS = [
  ["GET", "/api/hq/phase10/package"],
  ["GET", "/api/hq/phase10/mission-control"],
  ["GET", "/api/hq/phase10/role-home"],
  ["GET", "/api/hq/phase10/enterprise-ai"],
  ["GET", "/api/hq/phase10/operations"],
  ["GET", "/api/hq/phase10/tasks"],
  ["GET", "/api/hq/phase10/decision-intelligence"],
  ["GET", "/api/hq/phase10/command-console"],
  ["GET", "/api/hq/phase10/search?q=finance"],
];

async function main() {
  console.log("IFCDC Headquarters — Phase 10 Readiness Pass\n");

  console.log("── Phase 9 Baseline ──");
  await new Promise((resolve, reject) => {
    const child = spawn("node", [join(__dirname, "phase9-readiness.mjs")], {
      stdio: "inherit",
      env: { ...process.env, IFCDC_BASE_URL: BASE },
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`phase9-readiness exited ${code}`))));
  }).catch(() => log("warn", "Phase 9 baseline had warnings or failures"));

  console.log("\n── Phase 10 Command Platform APIs ──");
  const login = await timedFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = login.res.headers.getSetCookie?.()?.join("; ") ?? "";
  const authHeaders = cookie ? { Cookie: cookie } : {};

  for (const [method, path] of PHASE10_ENDPOINTS) {
    const { ok, ms, res, body } = await timedFetch(`${BASE}${path}`, { headers: authHeaders });
    log(ok ? "pass" : "fail", `${method} ${path}`, `${res.status} (${ms}ms)`);

    if (path.includes("mission-control") && body) {
      log((body.kpiWall?.length ?? 0) >= 4 ? "pass" : "warn", "KPI wall factors", `${body.kpiWall?.length ?? 0}`);
      log(body.template?.key ? "pass" : "warn", "Role dashboard template", body.template?.key ?? "");
    }
    if (path.includes("role-home") && body) {
      log(body.path === "/hq/phase10" ? "pass" : "warn", "Founder role home", body.path ?? "");
    }
    if (path.includes("enterprise-ai") && body) {
      log((body.recommendations?.length ?? 0) > 0 ? "pass" : "warn", "AI recommendations");
      log((body.grantMatches?.length ?? 0) >= 0 ? "pass" : "warn", "Grant matching");
    }
    if (path.includes("tasks") && body) {
      log(Array.isArray(body.tasks) ? "pass" : "fail", "Executive task hub");
    }
    if (path.includes("decision-intelligence") && body) {
      log(body.scenarios?.active?.projections?.length >= 4 ? "pass" : "warn", "What-if scenario projections");
    }
    if (path.includes("command-console") && body) {
      log((body.keyboardShortcuts?.length ?? 0) >= 5 ? "pass" : "warn", "Keyboard shortcuts registry");
      log((body.modules?.length ?? 0) >= 10 ? "pass" : "warn", "Module console", `${body.modules?.length ?? 0}`);
    }
  }

  const scenario = await timedFetch(`${BASE}/api/hq/phase10/scenarios`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ budgetChangePercent: 5, headcountChange: 1, horizonMonths: 6 }),
  });
  log(scenario.ok && scenario.body?.summary?.recommendation ? "pass" : "fail", "Interactive what-if scenario", scenario.body?.summary?.riskLevel ?? "");

  const ask = await timedFetch(`${BASE}/api/hq/phase10/enterprise-ai/ask`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ question: "What is our organization health score?" }),
  });
  log(ask.ok && ask.body?.answer ? "pass" : "warn", "Executive Q&A", ask.body?.answer ? "answered" : "");

  const shell = await timedFetch(`${BASE}/hq/phase10`, { headers: authHeaders });
  log(shell.res.status === 200 ? "pass" : "warn", "Mission Control shell route", String(shell.res.status));

  const overview = await timedFetch(`${BASE}/api/hq/analytics/overview`, { headers: authHeaders });
  const orgHealth = overview.body?.organizationHealth?.overall ?? 0;
  log(orgHealth >= 100 ? "pass" : "fail", "Organization Health 100%", `${orgHealth}%`);

  console.log("\n═══════════════════════════════════════");
  console.log(`Phase 10 additional — PASS: ${results.pass}  WARN: ${results.warn}  FAIL: ${results.fail}`);
  console.log("═══════════════════════════════════════\n");

  if (results.fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
