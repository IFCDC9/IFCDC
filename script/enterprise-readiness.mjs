#!/usr/bin/env node
/**
 * IFCDC Headquarters — Enterprise Readiness Pass
 * Regression, RBAC, security, integrations, stress, and performance checks.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const SLOW_MS = 2500;
const STRESS_CONCURRENCY = 12;

function loadEnv() {
  try {
    const raw = readFileSync(resolve(__dirname, "../.env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    }
  } catch { /* optional */ }
}

loadEnv();

const EMAIL = "service@ifcdc.org";
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const results = { pass: 0, fail: 0, warn: 0, slow: [] };

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

const HQ_ENDPOINTS = [
  ["GET", "/api/hq/health"],
  ["GET", "/api/hq/executive/overview"],
  ["GET", "/api/hq/analytics/overview"],
  ["GET", "/api/hq/finance/overview"],
  ["GET", "/api/hq/finance/statements"],
  ["GET", "/api/hq/grants/overview"],
  ["GET", "/api/hq/grants/funders/dashboard"],
  ["GET", "/api/hq/people/overview"],
  ["GET", "/api/hq/people/certifications"],
  ["GET", "/api/hq/enterprise/overview"],
  ["GET", "/api/hq/enterprise/search?q=grant"],
  ["GET", "/api/hq/warehouse/overview"],
  ["GET", "/api/hq/warehouse/forecasts"],
  ["GET", "/api/hq/warehouse/trends?metric=organization_health"],
  ["GET", "/api/hq/workflows/dashboard"],
  ["GET", "/api/hq/workflows/jobs"],
  ["GET", "/api/hq/security/dashboard"],
  ["GET", "/api/hq/security/backup/health"],
  ["GET", "/api/hq/security/backup/restore-points"],
  ["GET", "/api/hq/security/sessions"],
  ["GET", "/api/hq/security/login-history"],
  ["GET", "/api/hq/integrations/quickbooks"],
  ["GET", "/api/hq/aura/status"],
  ["GET", "/api/hq/aura/executive/health"],
  ["GET", "/api/hq/aura/operations/briefing"],
  ["GET", "/api/hq/aura/compliance-tracker"],
  ["GET", "/api/hq/aura/financial-risk"],
  ["GET", "/api/hq/operations/overview"],
  ["GET", "/api/hq/auth/roles"],
  ["GET", "/api/hq/auth/session"],
];

const HQ_PAGES = [
  "/hq",
  "/hq/founder",
  "/hq/finance",
  "/hq/grants",
  "/hq/people",
  "/hq/hr",
  "/hq/payroll",
  "/hq/programs",
  "/hq/operations",
  "/hq/aura",
  "/hq/notifications",
  "/hq/integrations",
  "/hq/analytics",
  "/hq/intelligence",
  "/hq/settings",
  "/hq/security",
  "/hq/workflows",
];

function honorificGreeting(user) {
  const name = (user?.name ?? "").trim();
  const last = user?.employee?.lastName?.trim();
  if (last) {
    const honorific = /^(mr|mrs|ms|dr)\.?/i.test(name.split(/\s+/)[0] ?? "") ? name.split(/\s+/)[0].replace(/\.$/, "") + "." : "Mr.";
    return `${honorific} ${last}`;
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && /^(mr|mrs|ms|dr)\.?$/i.test(parts[0])) {
    return `${parts[0].endsWith(".") ? parts[0] : parts[0] + "."} ${parts[parts.length - 1]}`;
  }
  return name || "Founder";
}

async function main() {
  console.log("IFCDC Headquarters — Enterprise Readiness Pass\n");
  console.log(`Target: ${BASE}\n`);

  // ——— Auth ———
  const login = await timedFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = login.res.headers.getSetCookie?.()?.join("; ") ?? "";
  log(login.ok ? "pass" : "fail", "Authentication login", login.body?.role ?? login.res.status);

  const session = await timedFetch(`${BASE}/api/hq/auth/session`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const user = session.body?.user;
  log(session.ok && user ? "pass" : "fail", "HQ session", user?.enterpriseRoleLabel ?? "");
  if (user) {
    const greeting = honorificGreeting(user);
    const validGreeting = greeting.includes("Allah") || greeting.includes(user.employee?.lastName ?? "___");
    log(validGreeting ? "pass" : "warn", "Founder greeting format", greeting);
    log(user.permissions?.length ? "pass" : "fail", "RBAC permissions loaded", `${user.permissions?.length ?? 0} permissions`);
    log(user.modules?.length ? "pass" : "fail", "Module access list", `${user.modules?.length ?? 0} modules`);
  }

  const authHeaders = cookie ? { Cookie: cookie } : {};

  // ——— API regression ———
  console.log("\n── API Endpoints ──");
  for (const [method, path] of HQ_ENDPOINTS) {
    const { ok, ms, res } = await timedFetch(`${BASE}${path}`, { headers: authHeaders });
    if (ms > SLOW_MS) results.slow.push({ path, ms });
    log(ok ? "pass" : "fail", `${method} ${path}`, `${res.status} (${ms}ms)`);
  }

  // ——— AURA navigate ———
  const nav = await timedFetch(`${BASE}/api/hq/aura/navigate`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "Open Financial Center" }),
  });
  log(nav.ok && nav.body?.path === "/hq/finance" ? "pass" : "warn", "AURA NL navigation", nav.body?.path ?? nav.error ?? "");

  // ——— Enterprise search ———
  const search = await timedFetch(`${BASE}/api/hq/enterprise/search?q=finance`, { headers: authHeaders });
  log(search.ok && Array.isArray(search.body?.results) ? "pass" : "fail", "Universal search", `${search.body?.results?.length ?? 0} results`);

  // ——— Backup snapshot (non-destructive) ———
  const backup = await timedFetch(`${BASE}/api/hq/security/backup/snapshot`, {
    method: "POST",
    headers: authHeaders,
  });
  log(backup.ok ? "pass" : "warn", "Backup snapshot trigger", backup.body?.status ?? backup.body?.snapshot?.id ?? backup.res.status);

  // ——— Warehouse snapshot ———
  const whSnap = await timedFetch(`${BASE}/api/hq/warehouse/snapshot`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ full: true }),
  });
  log(whSnap.ok ? "pass" : "warn", "Warehouse full snapshot", `${whSnap.body?.snapshotIds?.length ?? 0} domains`);

  // ——— Scheduled jobs ———
  const jobs = await timedFetch(`${BASE}/api/hq/workflows/jobs`, { headers: authHeaders });
  const warehouseJob = (jobs.body?.jobs ?? []).find((j) => j.job_key === "warehouse_snapshot");
  log(warehouseJob ? "pass" : "warn", "Warehouse snapshot job registered", warehouseJob?.schedule_expr ?? "missing");

  // ——— Stress test ———
  console.log("\n── Stress Test ──");
  const stressPaths = [
    "/api/hq/executive/overview",
    "/api/hq/warehouse/overview",
    "/api/hq/enterprise/search?q=people",
    "/api/hq/finance/overview",
    "/api/hq/grants/overview",
    "/api/hq/people/overview",
  ];
  const stressStart = Date.now();
  const stressResults = await Promise.all(
    Array.from({ length: STRESS_CONCURRENCY }, (_, i) =>
      timedFetch(`${BASE}${stressPaths[i % stressPaths.length]}`, { headers: authHeaders })
    )
  );
  const stressMs = Date.now() - stressStart;
  const stressOk = stressResults.filter((r) => r.ok).length;
  log(stressOk === STRESS_CONCURRENCY ? "pass" : "warn", `${STRESS_CONCURRENCY} concurrent API requests`, `${stressOk}/${STRESS_CONCURRENCY} OK in ${stressMs}ms`);

  // ——— HQ pages ———
  console.log("\n── HQ Shell Routes ──");
  for (const path of HQ_PAGES) {
    const { ok, res } = await timedFetch(`${BASE}${path}`, { headers: authHeaders });
    log(ok ? "pass" : "fail", `GET ${path}`, String(res.status));
  }

  // ——— Production lock ———
  console.log("\n── Production Lock ──");
  try {
    const sso = readFileSync(resolve(__dirname, "../server/hq/ssoGateway.ts"), "utf8");
    const barbersLocked = sso.includes('id: "barbers"') && sso.includes("production-locked");
    log(barbersLocked ? "pass" : "fail", "IFCDC Barbers App production-locked in SSO gateway");
  } catch {
    log("fail", "SSO gateway file check");
  }

  // ——— TypeScript / modules ———
  console.log("\n── Client Modules ──");
  const modules = [
    "pages/hq/ExecutiveDashboard.tsx",
    "pages/hq/FinancialCenterPage.tsx",
    "pages/hq/GrantCenterPage.tsx",
    "pages/hq/AuraCommandCenterPage.tsx",
    "pages/hq/EnterpriseIntelligencePage.tsx",
    "utils/welcomeGreeting.ts",
  ];
  for (const m of modules) {
    const r = await fetch(`${BASE}/src/${m}`);
    log(r.ok ? "pass" : "fail", `Module ${m}`, String(r.status));
  }

  // ——— Summary ———
  console.log("\n═══════════════════════════════════════");
  console.log(`PASS: ${results.pass}  WARN: ${results.warn}  FAIL: ${results.fail}`);
  if (results.slow.length) {
    console.log("\nSlow endpoints (>" + SLOW_MS + "ms):");
    for (const s of results.slow.slice(0, 8)) console.log(`  ${s.path}: ${s.ms}ms`);
  }
  console.log("═══════════════════════════════════════\n");

  if (results.fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
