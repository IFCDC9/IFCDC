#!/usr/bin/env node
/**
 * IFCDC Headquarters — Founder UAT Walkthrough
 * Simulates the founder login experience and validates Phase 8 polish items.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.IFCDC_BASE_URL || process.env.STAGING_URL || "http://127.0.0.1:5001";
const EMAIL = process.env.FOUNDER_EMAIL || "service@ifcdc.org";
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const results = { pass: 0, fail: 0, warn: 0 };

function log(status, msg, detail = "") {
  console.log(`${status === "pass" ? "✓" : status === "warn" ? "⚠" : "✗"} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : status === "warn" ? "warn" : "fail"]++;
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { res, body, ok: res.ok };
}

async function main() {
  console.log("IFCDC Founder UAT Walkthrough\n");
  console.log(`Environment: ${BASE}\n`);

  const login = await fetchJson("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = login.res.headers.getSetCookie?.()?.join("; ") ?? "";
  log(login.ok ? "pass" : "fail", "Founder login");

  const headers = cookie ? { Cookie: cookie } : {};
  const session = await fetchJson("/api/hq/auth/session", { headers });
  const user = session.body?.user;
  log(session.ok ? "pass" : "fail", "Session loaded", user?.enterpriseRoleLabel ?? "");

  const greeting = user?.welcomeGreeting ?? "";
  log(greeting.includes("Allah") ? "pass" : "fail", "Welcome greeting", greeting);
  log(greeting === "Mr. Allah" || greeting.includes("Allah") ? "pass" : "warn", "Personalized name present");

  const founderPages = ["/hq", "/hq/intelligence", "/hq/aura", "/hq/finance", "/hq/grants", "/hq/workflows"];
  for (const p of founderPages) {
    const { ok, res } = await fetchJson(p, { headers });
    log(ok ? "pass" : "fail", `Founder page ${p}`, String(res.status));
  }

  const morning = await fetchJson("/api/hq/intelligence/copilot/morning-briefing", { headers });
  log(morning.ok ? "pass" : "fail", "Morning briefing available");

  const scorecard = await fetchJson("/api/hq/intelligence/scorecard", { headers });
  log(scorecard.ok && scorecard.body?.pillars?.length >= 5 ? "pass" : "fail", "Executive scorecard");

  const overview = await fetchJson("/api/hq/analytics/overview", { headers });
  const orgHealth = overview.body?.organizationHealth?.overall ?? 0;
  log(orgHealth >= 100 ? "pass" : "fail", "Organization Health 100%", `${orgHealth}%`);

  const deliver = await fetchJson("/api/hq/intelligence/deliver/briefing", {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ sendEmail: false }),
  });
  log(deliver.ok && deliver.body?.pdfPath ? "pass" : "fail", "Briefing PDF generated", deliver.body?.emailStatus ?? "");

  const board = await fetchJson("/api/hq/intelligence/deliver/board-report", {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ sendEmail: false }),
  });
  log(board.ok ? "pass" : "fail", "Board report PDF generated");

  const anomalies = await fetchJson("/api/hq/intelligence/anomalies", { headers });
  log(anomalies.ok ? "pass" : "fail", "Anomaly scan", `${anomalies.body?.alerts?.length ?? 0} alerts`);

  const webhook = await fetch(`${BASE}/api/hq/intelligence/webhooks/analytics/music`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hq-api-key": "hq_division_music" },
    body: JSON.stringify({ activeUsers: 42, metrics: { sessions: 120 } }),
  });
  log(webhook.status === 201 ? "pass" : "warn", "Division webhook ingest (Music)", String(webhook.status));

  const barbersWebhook = await fetch(`${BASE}/api/hq/intelligence/webhooks/analytics/barbers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hq-api-key": "hq_division_barbers" },
    body: JSON.stringify({}),
  });
  log(barbersWebhook.status === 403 ? "pass" : "fail", "Barbers webhook blocked (production lock)", String(barbersWebhook.status));

  const wf = await fetchJson("/api/hq/workflows/instances", { headers });
  log(wf.ok ? "pass" : "fail", "Workflow instances");

  if (wf.body?.instances?.[0]?.id) {
    const steps = await fetchJson(`/api/hq/workflows/instances/${wf.body.instances[0].id}/steps`, { headers });
    log(steps.ok && (steps.body?.steps?.length ?? 0) > 0 ? "pass" : "warn", "Multi-step workflow", `${steps.body?.steps?.length ?? 0} steps`);
  } else {
    log("warn", "Multi-step workflow", "no instances — run enterprise seed");
  }

  try {
    const sso = readFileSync(join(__dirname, "../server/hq/ssoGateway.ts"), "utf8");
    log(sso.includes("production-locked") ? "pass" : "fail", "Barbers SSO production lock");
  } catch { log("fail", "SSO verification"); }

  console.log(`\nUAT Result: PASS ${results.pass}  WARN ${results.warn}  FAIL ${results.fail}\n`);
  if (results.fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
