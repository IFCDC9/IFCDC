#!/usr/bin/env node
/**
 * Compare Replit production vs Render staging for migration parity.
 *
 * Usage:
 *   REPLIT_BASE_URL=https://....replit.app \
 *   RENDER_BASE_URL=https://ifcdc-hq-staging.onrender.com \
 *   npm run deploy:parity
 */
const REPLIT = process.env.REPLIT_BASE_URL;
const RENDER = process.env.RENDER_BASE_URL;
const FOUNDER_EMAIL = process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org";
const FOUNDER_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const results = { pass: 0, fail: 0, warn: 0 };

function log(status, msg, detail = "") {
  const icon = status === "pass" ? "✓" : status === "warn" ? "!" : "✗";
  console.log(`${icon} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : status === "warn" ? "warn" : "fail"]++;
}

async function jsonFetch(base, path, opts = {}) {
  const url = `${base}${path}`;
  const start = Date.now();
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  const latencyMs = Date.now() - start;
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text?.slice(0, 200) }; }
  return { res, body, ok: res.ok, latencyMs, text };
}

async function login(base) {
  const { ok, res } = await jsonFetch(base, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: FOUNDER_EMAIL, password: FOUNDER_PASSWORD }),
  });
  if (!ok) throw new Error(`${base} login failed: ${res.status}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");
  const secure = cookies.some((c) => /;\s*Secure/i.test(c));
  return { cookieHeader, secure };
}

async function probeHost(label, base) {
  const out = { label, base, checks: {} };

  out.checks.https = base.startsWith("https://");
  const health = await jsonFetch(base, "/api/health");
  out.checks.healthOk = health.ok;
  out.checks.healthLatencyMs = health.latencyMs;
  out.checks.healthStatus = health.body?.status;

  const spa = await jsonFetch(base, "/hq/grants");
  out.checks.spaHtml = String(spa.text ?? "").includes("<!DOCTYPE") || String(spa.text ?? "").includes("<html");

  const unauth = await jsonFetch(base, "/api/hq/grants/center/platform");
  out.checks.unauthBlocked = unauth.res.status === 401;

  const { cookieHeader, secure } = await login(base);
  out.checks.cookieSecure = secure;
  const auth = { credentials: "include", headers: { Cookie: cookieHeader } };

  const platform = await jsonFetch(base, "/api/hq/grants/center/platform", auth);
  out.checks.platformVersion = platform.body?.version;
  out.checks.moduleCount = platform.body?.modules?.length ?? 0;
  out.checks.platformLatencyMs = platform.latencyMs;

  const org = await jsonFetch(base, "/api/hq/analytics/overview", auth);
  out.checks.orgHealth = org.body?.organizationHealth?.overall;

  const session = await jsonFetch(base, "/api/hq/enterprise/session", auth);
  out.checks.sessionOk = session.ok && session.body?.user?.email;

  return out;
}

function compareField(name, a, b, opts = {}) {
  const { numericTolerance, optional } = opts;
  if (a === undefined && b === undefined) return;
  if (optional && (a === undefined || b === undefined)) {
    log("warn", `${name}`, "missing on one host");
    return;
  }
  if (typeof a === "number" && typeof b === "number" && numericTolerance != null) {
    const delta = Math.abs(a - b);
    if (delta <= numericTolerance) log("pass", `${name} within tolerance`, `Replit=${a} Render=${b}`);
    else log("fail", `${name} mismatch`, `Replit=${a} Render=${b} (Δ${delta})`);
    return;
  }
  if (a === b) log("pass", `${name} match`, String(a));
  else log("fail", `${name} mismatch`, `Replit=${a} Render=${b}`);
}

async function main() {
  if (!REPLIT || !RENDER) {
    console.error("Set REPLIT_BASE_URL and RENDER_BASE_URL");
    process.exit(1);
  }

  console.log("\n=== IFCDC HQ Host Parity Verification ===\n");
  console.log(`Replit: ${REPLIT}`);
  console.log(`Render: ${RENDER}\n`);

  const [replit, render] = await Promise.all([
    probeHost("Replit", REPLIT),
    probeHost("Render", RENDER),
  ]);

  for (const host of [replit, render]) {
    log(host.checks.https ? "pass" : "fail", `${host.label}: HTTPS`);
    log(host.checks.healthOk ? "pass" : "fail", `${host.label}: health`, `${host.checks.healthLatencyMs}ms`);
    log(host.checks.spaHtml ? "pass" : "fail", `${host.label}: Grant Center SPA`);
    log(host.checks.unauthBlocked ? "pass" : "fail", `${host.label}: unauthenticated blocked`);
    log(host.checks.cookieSecure ? "pass" : "warn", `${host.label}: secure auth cookie`);
    log(host.checks.platformVersion === "grant-center-v1" ? "pass" : "fail", `${host.label}: Grant Center version`, host.checks.platformVersion ?? "?");
    log(host.checks.moduleCount === 11 ? "pass" : "fail", `${host.label}: module count`, String(host.checks.moduleCount));
    log(host.checks.orgHealth >= 90 ? "pass" : "fail", `${host.label}: org health`, `${host.checks.orgHealth ?? "?"}%`);
    log(host.checks.sessionOk ? "pass" : "fail", `${host.label}: enterprise session`);
  }

  console.log("\n--- Cross-host parity ---\n");
  compareField("Grant Center version", replit.checks.platformVersion, render.checks.platformVersion);
  compareField("Module count", replit.checks.moduleCount, render.checks.moduleCount);
  compareField("Org health score", replit.checks.orgHealth, render.checks.orgHealth, { numericTolerance: 5 });

  const perfRatio = render.checks.healthLatencyMs / Math.max(replit.checks.healthLatencyMs, 1);
  if (perfRatio <= 3) log("pass", "Health latency ratio (Render/Replit)", `${perfRatio.toFixed(2)}x`);
  else log("warn", "Health latency ratio high", `${perfRatio.toFixed(2)}x — investigate cold start or plan tier`);

  console.log(`\n=== Parity: ${results.pass} PASS / ${results.fail} FAIL / ${results.warn} WARN ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
