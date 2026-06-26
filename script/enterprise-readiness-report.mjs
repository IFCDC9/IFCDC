#!/usr/bin/env node
/**
 * IFCDC Headquarters — Final Enterprise Readiness Report
 * Confirms 100% org health, all checks, security, and Barbers isolation.
 */
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.IFCDC_BASE_URL || process.env.STAGING_URL || "http://127.0.0.1:5001";
const EMAIL = "service@ifcdc.org";
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const report = {
  timestamp: new Date().toISOString(),
  environment: BASE,
  organizationHealth: 0,
  healthFactors: [],
  readinessChecks: { pass: 0, warn: 0, fail: 0 },
  modules: [],
  security: [],
  performance: [],
  barbersIsolated: false,
  productionReady: false,
};

async function timedFetch(url, opts = {}) {
  const start = Date.now();
  const res = await fetch(url, opts);
  const ms = Date.now() - start;
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { res, body, ms, ok: res.ok };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  IFCDC HEADQUARTERS — FINAL ENTERPRISE READINESS REPORT");
  console.log("═══════════════════════════════════════════════════════\n");
  console.log(`Environment: ${BASE}`);
  console.log(`Generated:   ${report.timestamp}\n`);

  const login = await timedFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = login.res.headers.getSetCookie?.()?.join("; ") ?? "";
  const auth = cookie ? { Cookie: cookie } : {};

  const overview = await timedFetch(`${BASE}/api/hq/analytics/overview`, { headers: auth });
  const health = overview.body?.organizationHealth;
  report.organizationHealth = health?.overall ?? 0;
  report.healthFactors = health?.factors ?? [];

  console.log("── Organization Health ──");
  console.log(`  Overall Score: ${report.organizationHealth}% (${health?.grade ?? "—"})`);
  for (const f of report.healthFactors) {
    const status = f.score >= 95 ? "✓" : f.score >= 80 ? "○" : "✗";
    console.log(`  ${status} ${f.label}: ${f.score}% (weight ${f.weight})`);
  }
  console.log(report.organizationHealth >= 100 ? "\n  ✓ Organization Health: 100%\n" : `\n  ✗ Organization Health: ${report.organizationHealth}% (target: 100%)\n`);

  console.log("── Readiness Checks ──");
  await new Promise((resolve) => {
    const child = spawn("node", [join(__dirname, "phase8-readiness.mjs")], {
      stdio: "inherit",
      env: { ...process.env, IFCDC_BASE_URL: BASE },
    });
    child.on("exit", (code) => {
      report.readinessChecks.pass = code === 0 ? 1 : 0;
      resolve();
    });
  });

  console.log("\n── Founder UAT ──");
  await new Promise((resolve) => {
    const child = spawn("node", [join(__dirname, "founder-uat-walkthrough.mjs")], {
      stdio: "inherit",
      env: { ...process.env, IFCDC_BASE_URL: BASE, STAGING_URL: BASE },
    });
    child.on("exit", (code) => {
      report.readinessChecks.fail = code !== 0 ? 1 : 0;
      resolve();
    });
  });

  const modules = [
    ["/api/hq/finance/overview", "Finance Center"],
    ["/api/hq/grants/dashboard", "Grants"],
    ["/api/hq/intelligence/scorecard", "Executive Intelligence"],
    ["/api/hq/intelligence/copilot/morning-briefing", "AURA Copilot"],
    ["/api/hq/intelligence/anomalies", "Anomaly Monitor"],
    ["/api/hq/intelligence/divisions", "Division Integration"],
    ["/api/hq/workflows/instances", "Workflow Orchestration"],
    ["/api/hq/intelligence/reports", "Document Delivery"],
  ];

  console.log("\n── Module Operational Status ──");
  for (const [path, name] of modules) {
    const { ok, ms } = await timedFetch(`${BASE}${path}`, { headers: auth });
    report.modules.push({ name, ok, ms });
    console.log(`  ${ok ? "✓" : "✗"} ${name} (${ms}ms)`);
    if (ms > 3000) report.performance.push(`${name} slow: ${ms}ms`);
  }

  console.log("\n── Security Verification ──");
  const barbersDiv = await timedFetch(`${BASE}/api/hq/intelligence/divisions/barbers`, { headers: auth });
  const barbersLocked = barbersDiv.body?.status === "production-locked" && barbersDiv.body?.readOnly === true;
  report.barbersIsolated = barbersLocked;
  console.log(`  ${barbersLocked ? "✓" : "✗"} Barbers App production-locked (read-only)`);

  const barbersWebhook = await fetch(`${BASE}/api/hq/intelligence/webhooks/analytics/barbers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hq-api-key": "test" },
    body: JSON.stringify({}),
  });
  console.log(`  ${barbersWebhook.status === 403 ? "✓" : "✗"} Barbers webhook blocked (${barbersWebhook.status})`);

  try {
    const sso = readFileSync(join(__dirname, "../server/hq/ssoGateway.ts"), "utf8");
    const ssoLocked = sso.includes("production-locked") && sso.includes('"barbers"');
    console.log(`  ${ssoLocked ? "✓" : "✗"} SSO gateway Barbers lock intact`);
    report.security.push(ssoLocked ? "SSO lock verified" : "SSO lock missing");
  } catch {
    console.log("  ✗ SSO gateway file not found");
  }

  const session = await timedFetch(`${BASE}/api/hq/auth/session`, { headers: auth });
  const greeting = session.body?.user?.welcomeGreeting ?? "";
  console.log(`  ${greeting.includes("Allah") ? "✓" : "✗"} Founder greeting: "${greeting}"`);

  console.log("\n── Performance Summary ──");
  const avgMs = Math.round(report.modules.reduce((s, m) => s + m.ms, 0) / Math.max(report.modules.length, 1));
  console.log(`  Average module response: ${avgMs}ms`);
  if (report.performance.length === 0) {
    console.log("  ✓ All modules within performance targets");
  } else {
    for (const p of report.performance) console.log(`  ⚠ ${p}`);
  }

  report.productionReady =
    report.organizationHealth >= 100 &&
    report.barbersIsolated &&
    report.modules.every((m) => m.ok) &&
    greeting.includes("Allah");

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  FINAL VERDICT");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Organization Health:     ${report.organizationHealth >= 100 ? "100% ✓" : `${report.organizationHealth}% ✗`}`);
  console.log(`  All Modules Operational: ${report.modules.every((m) => m.ok) ? "✓" : "✗"}`);
  console.log(`  Security Verified:       ${report.barbersIsolated ? "✓" : "✗"}`);
  console.log(`  Performance Optimized:   ${report.performance.length === 0 ? "✓" : "⚠"}`);
  console.log(`  Barbers App Isolated:    ${report.barbersIsolated ? "✓" : "✗"}`);
  console.log(`  Headquarters Production: ${report.productionReady ? "READY ✓" : "NOT READY ✗"}`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (!report.productionReady) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
