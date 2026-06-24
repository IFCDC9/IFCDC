#!/usr/bin/env node
/**
 * IFCDC Headquarters — Version 1.0 Production Readiness Pass
 * Validates pages, RBAC, APIs, backups, monitoring, performance, and security.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const FOUNDER_EMAIL = "service@ifcdc.org";
const FOUNDER_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";
const SLOW_MS = 3000;

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
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { res, body, ms, ok: res.ok };
  } catch (err) {
    return { res: { status: 0 }, body: null, ms: Date.now() - start, ok: false, error: err.message };
  }
}

/** Every registered HQ shell route (App.tsx) */
const HQ_PAGES = [
  "/hq",
  "/hq/founder",
  "/hq/reports",
  "/hq/operations",
  "/hq/sso",
  "/hq/developer",
  "/hq/aura",
  "/hq/people",
  "/hq/hr",
  "/hq/payroll",
  "/hq/programs",
  "/hq/finance",
  "/hq/grants",
  "/hq/analytics",
  "/hq/notifications",
  "/hq/integrations",
  "/hq/intelligence",
  "/hq/phase10",
  "/hq/phase9",
  "/hq/workflows",
  "/hq/security",
  "/hq/documents",
  "/hq/board",
  "/hq/compliance",
  "/hq/calendar",
  "/hq/settings",
  "/hq/housing",
  "/hq/scholarships",
  "/hq/media",
  "/hq/communications",
  "/hq/assets",
  "/hq/fleet",
  "/hq/facilities",
  "/admin",
];

const MONITORING_ENDPOINTS = [
  ["GET", "/api/hq/security/audit?limit=10"],
  ["GET", "/api/hq/security/threats"],
  ["GET", "/api/hq/security/activity?limit=10"],
  ["GET", "/api/hq/intelligence/anomalies"],
  ["GET", "/api/hq/workflows/jobs"],
];

async function login(email, password) {
  const res = await timedFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = res.res.headers.getSetCookie?.()?.join("; ") ?? "";
  return { ok: res.ok, cookie, body: res.body };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  IFCDC HEADQUARTERS — VERSION 1.0 PRODUCTION READINESS");
  console.log("═══════════════════════════════════════════════════════\n");
  console.log(`Environment: ${BASE}`);
  console.log(`Generated:   ${new Date().toISOString()}\n`);

  // ─── 1. Authentication & RBAC ───
  console.log("── 1. Founder & Admin Permissions ──");
  const founder = await login(FOUNDER_EMAIL, FOUNDER_PASSWORD);
  log(founder.ok ? "pass" : "fail", "Founder authentication");

  const roles = await timedFetch(`${BASE}/api/hq/auth/roles`);
  const founderRole = roles.body?.roles?.find((r) => r.id === "founder");
  const adminRole = roles.body?.roles?.find((r) => r.id === "administrator");
  log(roles.ok ? "pass" : "fail", "Role definitions API");
  log(
    founderRole?.permissions?.includes("hq.executive") && founderRole?.permissions?.includes("hq.settings.manage")
      ? "pass"
      : "fail",
    "Founder role permissions",
    `${founderRole?.permissions?.length ?? 0} permissions`
  );
  log(
    adminRole?.permissions?.includes("hq.executive") && adminRole?.permissions?.includes("hq.settings.manage")
      ? "pass"
      : "fail",
    "Administrator role permissions",
    `${adminRole?.permissions?.length ?? 0} permissions`
  );

  const authHeaders = founder.cookie ? { Cookie: founder.cookie } : {};
  const session = await timedFetch(`${BASE}/api/hq/auth/session`, { headers: authHeaders });
  log(session.ok && session.body?.user?.enterpriseRoleLabel === "Founder" ? "pass" : "fail", "Founder session role", session.body?.user?.enterpriseRoleLabel ?? "");
  log((session.body?.user?.permissions?.length ?? 0) >= 20 ? "pass" : "fail", "Founder session permission count", `${session.body?.user?.permissions?.length ?? 0}`);
  log((session.body?.user?.modules?.length ?? 0) >= 10 ? "pass" : "fail", "Founder module access", `${session.body?.user?.modules?.length ?? 0} modules`);

  const unauth = await timedFetch(`${BASE}/api/hq/executive/overview`);
  log(unauth.res.status === 401 ? "pass" : "fail", "Unauthenticated API blocked", String(unauth.res.status));

  // ─── 2. All HQ pages ───
  console.log("\n── 2. Headquarters Pages (shell routes) ──");
  for (const path of HQ_PAGES) {
    const { ok, res } = await timedFetch(`${BASE}${path}`, { headers: authHeaders });
    log(ok ? "pass" : "fail", `GET ${path}`, String(res.status));
  }

  // ─── 3. Core HQ APIs ───
  console.log("\n── 3. HQ API Endpoints ──");
  const coreApis = [
    "/api/hq/health",
    "/api/hq/executive/overview",
    "/api/hq/analytics/overview",
    "/api/hq/analytics/command-center",
    "/api/hq/finance/overview",
    "/api/hq/grants/overview",
    "/api/hq/people/overview",
    "/api/hq/operations/overview",
    "/api/hq/enterprise/overview",
    "/api/hq/warehouse/overview",
    "/api/hq/intelligence/scorecard",
    "/api/hq/intelligence/package",
    "/api/hq/aura/executive/health",
    "/api/hq/integrations/quickbooks",
    "/api/hq/reporting/templates",
  ];
  const slow = [];
  for (const path of coreApis) {
    const { ok, ms, res } = await timedFetch(`${BASE}${path}`, { headers: authHeaders });
    if (ms > SLOW_MS) slow.push({ path, ms });
    log(ok ? "pass" : "fail", `GET ${path}`, `${res.status} (${ms}ms)`);
  }

  const overview = await timedFetch(`${BASE}/api/hq/analytics/overview`, { headers: authHeaders });
  const orgHealth = overview.body?.organizationHealth?.overall ?? 0;
  log(orgHealth >= 100 ? "pass" : "fail", "Organization Health 100%", `${orgHealth}%`);

  // ─── 4. Backups & recovery ───
  console.log("\n── 4. Database Backups & Recovery ──");
  const backupHealth = await timedFetch(`${BASE}/api/hq/security/backup/health`, { headers: authHeaders });
  log(backupHealth.ok ? "pass" : "fail", "Backup health endpoint", backupHealth.body?.status ?? "");
  log(backupHealth.body?.dbSizeBytes > 0 ? "pass" : "fail", "Database file present", `${backupHealth.body?.dbSizeBytes ?? 0} bytes`);

  const restorePoints = await timedFetch(`${BASE}/api/hq/security/backup/restore-points`, { headers: authHeaders });
  log(restorePoints.ok ? "pass" : "fail", "Restore points listed", `${restorePoints.body?.restorePoints?.length ?? 0} points`);

  const snapshot = await timedFetch(`${BASE}/api/hq/security/backup/snapshot`, { method: "POST", headers: authHeaders });
  log(snapshot.ok ? "pass" : "fail", "Manual backup snapshot", snapshot.body?.snapshot?.id ?? snapshot.res.status);

  log(
    (restorePoints.body?.restorePoints?.length ?? 0) > 0 || snapshot.ok ? "pass" : "warn",
    "Recovery capability (restore points available)"
  );

  // ─── 5. Error logging & monitoring ───
  console.log("\n── 5. Error Logging & Monitoring ──");
  for (const [method, path] of MONITORING_ENDPOINTS) {
    const { ok, res } = await timedFetch(`${BASE}${path}`, { headers: authHeaders });
    log(ok ? "pass" : "fail", `${method} ${path}`, String(res.status));
  }
  const audit = await timedFetch(`${BASE}/api/hq/security/audit?limit=5`, { headers: authHeaders });
  log(Array.isArray(audit.body?.audit) ? "pass" : "fail", "HQ audit log active", `${audit.body?.audit?.length ?? 0} entries`);
  const anomalies = await timedFetch(`${BASE}/api/hq/intelligence/anomalies`, { headers: authHeaders });
  log(anomalies.ok && Array.isArray(anomalies.body?.alerts ?? anomalies.body?.anomalies) ? "pass" : "fail", "Anomaly monitor active");

  // ─── 6. Performance ───
  console.log("\n── 6. Performance ──");
  const stressPaths = ["/api/hq/executive/overview", "/api/hq/analytics/overview", "/api/hq/finance/overview"];
  const stressStart = Date.now();
  const stress = await Promise.all(stressPaths.map((p) => timedFetch(`${BASE}${p}`, { headers: authHeaders })));
  const stressMs = Date.now() - stressStart;
  const stressOk = stress.filter((r) => r.ok).length;
  log(stressOk === stressPaths.length ? "pass" : "warn", "Concurrent core API load", `${stressOk}/${stressPaths.length} in ${stressMs}ms`);
  log(slow.length === 0 ? "pass" : "warn", "Response time targets", slow.length ? `${slow.length} slow (>${SLOW_MS}ms)` : "all under target");

  // ─── 7. Security ───
  console.log("\n── 7. Security ──");
  try {
    const sso = readFileSync(join(__dirname, "../server/hq/ssoGateway.ts"), "utf8");
    log(sso.includes("production-locked") && sso.includes('"barbers"') ? "pass" : "fail", "Barbers App production-locked (SSO)");
  } catch {
    log("fail", "SSO gateway file check");
  }

  const barbersDiv = await timedFetch(`${BASE}/api/hq/intelligence/divisions/barbers`, { headers: authHeaders });
  log(
    barbersDiv.body?.status === "production-locked" && barbersDiv.body?.readOnly === true ? "pass" : "fail",
    "Barbers division read-only"
  );

  const barbersWebhook = await fetch(`${BASE}/api/hq/intelligence/webhooks/analytics/barbers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hq-api-key": "blocked-test" },
    body: JSON.stringify({}),
  });
  log(barbersWebhook.status === 403 ? "pass" : "fail", "Barbers webhook blocked", String(barbersWebhook.status));

  const threats = await timedFetch(`${BASE}/api/hq/security/threats`, { headers: authHeaders });
  log(threats.ok ? "pass" : "fail", "Threat monitor endpoint");

  // ─── 8. TypeScript & format safety ───
  console.log("\n── 8. Client Safety ──");
  await new Promise((resolve) => {
    const child = spawn("node", [join(__dirname, "hq-format-safety-check.mjs")], { stdio: "inherit" });
    child.on("exit", (code) => {
      log(code === 0 ? "pass" : "warn", "HQ format safety check");
      resolve();
    });
  });

  // ─── Summary ───
  const productionReady =
    results.fail === 0 &&
    orgHealth >= 100 &&
    founder.ok &&
    barbersDiv.body?.readOnly === true;

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  VERSION 1.0 SIGN-OFF");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  PASS: ${results.pass}   WARN: ${results.warn}   FAIL: ${results.fail}`);
  console.log(`  Organization Health:        ${orgHealth >= 100 ? "100% ✓" : `${orgHealth}% ✗`}`);
  console.log(`  HQ Pages:                   ${HQ_PAGES.length} routes checked`);
  console.log(`  Backups:                    ${backupHealth.body?.status ?? "—"}`);
  console.log(`  Monitoring:                 ${audit.ok && anomalies.ok ? "active ✓" : "check ✗"}`);
  console.log(`  Security:                   ${barbersWebhook.status === 403 ? "verified ✓" : "review ✗"}`);
  console.log(`  IFCDC Headquarters v1.0:    ${productionReady ? "PRODUCTION READY ✓" : "NOT READY ✗"}`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (results.fail > 0 || !productionReady) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
