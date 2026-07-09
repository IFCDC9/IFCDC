#!/usr/bin/env node
/**
 * Production Founder OTP delivery probe — email + optional SMS with provider responses.
 *
 * Usage:
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   FOUNDER_SEED_PASSWORD=*** \
 *   node script/founder-otp-probe.mjs
 *
 * Optional SMS test to Founder phone:
 *   SMS_TO=+18484694448 node script/founder-otp-probe.mjs
 */
const BASE = (process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");
const EMAIL = process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org";
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || process.env.IFCDC_SUPER_ADMIN_PASSWORD || "";
const SMS_TO = process.env.SMS_TO || null;
const TIMEOUT_MS = 30_000;

async function timedFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const body = await res.json().catch(() => null);
    return { res, body, ok: res.ok };
  } finally {
    clearTimeout(timer);
  }
}

function log(status, msg, detail = "") {
  const icon = status === "pass" ? "✓" : status === "warn" ? "⚠" : "✗";
  console.log(`${icon} ${msg}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log(`\nIFCDC HQ — Founder OTP Delivery Probe (${BASE})\n`);

  const health = await timedFetch(`${BASE}/api/health`);
  log(health.ok ? "pass" : "fail", "GET /api/health", `commit=${health.body?.commit ?? "?"}`);
  log(health.body?.integrations?.email?.configured ? "pass" : "fail", "Resend API key present");
  log(health.body?.integrations?.twilio?.ready ? "pass" : "fail", "Twilio ready", health.body?.integrations?.twilio?.phoneNumber);

  if (!PASSWORD) {
    log("fail", "FOUNDER_SEED_PASSWORD required for authenticated probe");
    process.exit(1);
  }

  const login = await timedFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) {
    log("fail", "Login failed", String(login.res.status));
    process.exit(1);
  }
  const cookie = login.res.headers.getSetCookie?.()?.join("; ") ?? "";
  const headers = { Cookie: cookie, "Content-Type": "application/json" };

  const logs = await timedFetch(`${BASE}/api/hq/aura/founder-verification/logs`, { headers });
  log(logs.ok ? "pass" : "fail", "GET founder-verification/logs");
  if (logs.body?.resendProbe) {
    log(logs.body.resendProbe.ok ? "pass" : "fail", "Resend domain probe", logs.body.resendProbe.error || logs.body.resendProbe.from);
    if (logs.body.resendProbe.domains?.length) {
      console.log("  Resend domains:", logs.body.resendProbe.domains.map((d) => `${d.name} (${d.status})`).join(", "));
    }
  }

  const probe = await timedFetch(`${BASE}/api/hq/aura/founder-verification/probe`, {
    method: "POST",
    headers,
    body: JSON.stringify({ smsTo: SMS_TO }),
  });
  log(probe.ok ? "pass" : "fail", "POST founder-verification/probe", String(probe.res.status));

  if (probe.body?.email) {
    const e = probe.body.email;
    log(e.ok ? "pass" : "fail", "Email send", e.error || e.messageId || "");
    if (!e.ok) {
      console.log("  email providerStatus:", e.providerStatus);
      console.log("  email errorCode:", e.errorCode);
      console.log("  email providerResponse:", JSON.stringify(e.providerResponse, null, 2));
    }
  }
  if (probe.body?.sms) {
    const s = probe.body.sms;
    log(s.ok ? "pass" : "fail", `SMS send to ${s.destination}`, s.error || s.messageId || "");
    if (!s.ok) {
      console.log("  sms providerStatus:", s.providerStatus);
      console.log("  sms errorCode:", s.errorCode);
      console.log("  sms providerResponse:", JSON.stringify(s.providerResponse, null, 2));
    }
  }

  if (probe.body?.email?.resendProbe && !probe.body.email.resendProbe.ok) {
    log("fail", "Resend sender/domain issue", probe.body.email.resendProbe.error);
  }

  console.log("\nRecent delivery logs:");
  for (const row of (logs.body?.logs || []).slice(0, 5)) {
    console.log(
      `  ${row.created_at} ${row.channel} ${row.success ? "OK" : "FAIL"} → ${row.destination}`
      + (row.error_detail ? ` (${row.error_detail})` : "")
      + (row.error_code ? ` [${row.error_code}]` : "")
    );
  }

  const failed = !probe.ok || probe.body?.email?.ok === false || (SMS_TO && probe.body?.sms?.ok === false);
  console.log(failed ? "\n✗ Probe found delivery failures — check providerResponse above.\n" : "\n✓ Probe completed — check inbox/phone for test code 000000.\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
