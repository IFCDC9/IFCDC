#!/usr/bin/env node
/**
 * IFCDC Headquarters — Phase 9 Enterprise Intelligence & Automation Readiness
 * Extends Phase 8 with operating system APIs, notification queue, universal search, and workflows.
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

const PHASE9_ENDPOINTS = [
  ["GET", "/api/hq/phase9/package"],
  ["GET", "/api/hq/phase9/command-center"],
  ["GET", "/api/hq/phase9/login-briefing"],
  ["GET", "/api/hq/phase9/predictive"],
  ["GET", "/api/hq/phase9/grant-probability"],
  ["GET", "/api/hq/phase9/divisions"],
  ["GET", "/api/hq/phase9/workflows"],
  ["GET", "/api/hq/phase9/reporting"],
  ["GET", "/api/hq/phase9/notifications"],
  ["GET", "/api/hq/phase9/search?q=grant"],
];

async function main() {
  console.log("IFCDC Headquarters — Phase 9 Readiness Pass\n");

  console.log("── Phase 8 Baseline ──");
  await new Promise((resolve, reject) => {
    const child = spawn("node", [join(__dirname, "phase8-readiness.mjs")], {
      stdio: "inherit",
      env: { ...process.env, IFCDC_BASE_URL: BASE },
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`phase8-readiness exited ${code}`))));
  }).catch(() => log("warn", "Phase 8 baseline had warnings or failures"));

  console.log("\n── Phase 9 Operating System APIs ──");
  const login = await timedFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = login.res.headers.getSetCookie?.()?.join("; ") ?? "";
  const authHeaders = cookie ? { Cookie: cookie } : {};

  for (const [method, path] of PHASE9_ENDPOINTS) {
    const { ok, ms, res, body } = await timedFetch(`${BASE}${path}`, { headers: authHeaders });
    log(ok ? "pass" : "fail", `${method} ${path}`, `${res.status} (${ms}ms)`);

    if (path.includes("login-briefing") && body) {
      log(body.greeting?.includes("Allah") ? "pass" : "warn", "Login briefing greeting", body.greeting ?? "");
      log((body.highlights?.length ?? 0) > 0 ? "pass" : "warn", "Login briefing highlights");
    }
    if (path.includes("command-center") && body) {
      log(body.organizationHealth?.overall >= 95 ? "pass" : "fail", "Command center org health", `${body.organizationHealth?.overall ?? 0}%`);
      log((body.recommendations?.length ?? 0) > 0 ? "pass" : "warn", "AI recommendations");
    }
    if (path.includes("predictive") && body) {
      log((body.models?.length ?? 0) >= 5 ? "pass" : "warn", "Predictive models", `${body.models?.length ?? 0}`);
    }
    if (path.includes("divisions") && body) {
      const barbers = body.dataLayer?.divisions?.find((d) => /barber/i.test(d.name));
      log(barbers?.dataSource === "health_poll_readonly" || barbers?.status === "production-locked" ? "pass" : "warn", "Barbers read-only in data layer");
    }
    if (path.includes("notifications") && body) {
      log(Array.isArray(body.notifications) ? "pass" : "fail", "Notification priority queue");
      log(typeof body.highPriorityCount === "number" ? "pass" : "warn", "High-priority count");
    }
    if (path.includes("search") && body) {
      log(Array.isArray(body.results) ? "pass" : "fail", "Universal search results");
    }
  }

  const instances = await timedFetch(`${BASE}/api/hq/workflows/instances`, { headers: authHeaders });
  const firstId = instances.body?.instances?.[0]?.id;
  if (firstId) {
    const steps = await timedFetch(`${BASE}/api/hq/workflows/instances/${firstId}/steps`, { headers: authHeaders });
    log(steps.ok ? "pass" : "warn", "Workflow multi-step API", `${steps.body?.steps?.length ?? 0} steps`);
  } else {
    log("warn", "Workflow multi-step API", "no instances to test");
  }

  const deliverBoard = await timedFetch(`${BASE}/api/hq/phase9/reporting/board-report`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ sendEmail: false }),
  });
  log(deliverBoard.ok && (deliverBoard.body?.pdfPath || deliverBoard.body?.htmlPath) ? "pass" : "warn", "One-click board report PDF", deliverBoard.body?.pdfPath ? "generated" : deliverBoard.body?.error ?? String(deliverBoard.res.status));

  const overview = await timedFetch(`${BASE}/api/hq/analytics/overview`, { headers: authHeaders });
  const orgHealth = overview.body?.organizationHealth?.overall ?? 0;
  log(orgHealth >= 100 ? "pass" : "fail", "Organization Health 100%", `${orgHealth}%`);

  console.log("\n═══════════════════════════════════════");
  console.log(`Phase 9 additional — PASS: ${results.pass}  WARN: ${results.warn}  FAIL: ${results.fail}`);
  console.log("═══════════════════════════════════════\n");

  if (results.fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
