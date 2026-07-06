#!/usr/bin/env node
/**
 * Twilio + AURA readiness — production verification
 * Usage:
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   FOUNDER_SEED_PASSWORD=*** \
 *   node script/twilio-readiness.mjs
 */
const BASE = (process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");
const EMAIL = process.env.MASTER_OWNER_EMAIL || process.env.IFCDC_SUPER_ADMIN_EMAIL || "service@ifcdc.org";
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || process.env.IFCDC_SUPER_ADMIN_PASSWORD || "";
const TIMEOUT_MS = 20_000;

const results = { pass: 0, fail: 0, warn: 0 };

function log(status, msg, detail = "") {
  const icon = status === "pass" ? "✓" : status === "warn" ? "⚠" : "✗";
  console.log(`${icon} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : status === "warn" ? "warn" : "fail"]++;
}

async function timedFetch(url, opts = {}) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
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
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`\nIFCDC HQ — Twilio + AURA Readiness (${BASE})\n`);

  const health = await timedFetch(`${BASE}/api/health`);
  log(health.ok ? "pass" : "fail", "GET /api/health", `${health.res.status} (${health.ms}ms)`);

  const tw = health.body?.integrations?.twilio;
  if (tw) {
    log(tw.accountSidConfigured ? "pass" : "fail", "TWILIO_ACCOUNT_SID on Render");
    log(tw.authTokenConfigured ? "pass" : "fail", "TWILIO_AUTH_TOKEN on Render");
    log(tw.phoneNumberConfigured ? "pass" : "fail", "TWILIO_PHONE_NUMBER", tw.phoneNumber ?? "");
    log(tw.auraConfigured ? "pass" : "fail", "OPENAI_API_KEY for AURA");
    log(tw.ready ? "pass" : "fail", "Twilio env ready");
  } else {
    log("warn", "Twilio block missing from /api/health — deploy latest commit");
  }

  const voiceWebhook = await timedFetch(`${BASE}/api/twilio/aura/voice`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "To=%2B13313168167&From=%2B15555550100&CallSid=readiness-probe",
  });
  log(
    voiceWebhook.res.status === 200 && String(voiceWebhook.res.headers.get("content-type") || "").includes("xml")
      ? "pass"
      : "fail",
    "POST /api/twilio/aura/voice (TwiML)",
    String(voiceWebhook.res.status)
  );

  if (!PASSWORD) {
    log("warn", "FOUNDER_SEED_PASSWORD not set — skipping authenticated hub tests");
    console.log("\nSet FOUNDER_SEED_PASSWORD to run Integrations Hub Test Connection.\n");
    process.exit(results.fail > 0 ? 1 : 0);
  }

  const login = await timedFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) {
    log("fail", "Login", String(login.res.status));
    process.exit(1);
  }
  const cookie = login.res.headers.getSetCookie?.()?.join("; ") ?? "";
  const headers = { Cookie: cookie, "Content-Type": "application/json" };

  const hub = await timedFetch(`${BASE}/api/hq/integrations/`, { headers });
  const twilioCard = hub.body?.integrations?.find((i) => i.id === "twilio");
  log(twilioCard ? "pass" : "fail", "Twilio Integrations Hub card");
  if (twilioCard) {
    log(twilioCard.status === "connected" ? "pass" : "warn", "Twilio card status", twilioCard.status);
    log(twilioCard.health?.healthy ? "pass" : "warn", "Twilio health", twilioCard.health?.message ?? "");
  }

  const test = await timedFetch(`${BASE}/api/hq/integrations/twilio/test`, {
    method: "POST",
    headers,
    body: "{}",
  });
  log(test.ok && test.body?.success ? "pass" : "fail", "POST twilio/test", test.body?.message ?? String(test.res.status));
  log(test.body?.status === "connected" ? "pass" : "warn", "Test status", test.body?.status ?? "");

  console.log("\n═══════════════════════════════════════");
  console.log(`Twilio Readiness — PASS: ${results.pass}  WARN: ${results.warn}  FAIL: ${results.fail}`);
  console.log("═══════════════════════════════════════\n");

  if (results.fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
