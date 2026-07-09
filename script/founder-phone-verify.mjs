#!/usr/bin/env node
/**
 * Production Founder phone + Twilio verification (no mock data).
 *
 * Usage:
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com node script/founder-phone-verify.mjs
 *
 * Optional (Integrations Hub + comm events):
 *   FOUNDER_SEED_PASSWORD=*** node script/founder-phone-verify.mjs
 */
const BASE = (process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || process.env.IFCDC_SUPER_ADMIN_PASSWORD || "";
const EMAIL = process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org";
const TIMEOUT_MS = 25_000;

const EXPECTED_FOUNDER = ["+18484694448", "+17327615075", "+13313168167"];
const EXPECTED_HQ = "+13313168167";
const UNTRUSTED = "+15555550100";

const results = { pass: 0, fail: 0, warn: 0 };

function log(status, msg, detail = "") {
  const icon = status === "pass" ? "✓" : status === "warn" ? "⚠" : "✗";
  console.log(`${icon} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : status === "warn" ? "warn" : "fail"]++;
}

async function timedFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { res, body, ok: res.ok };
  } finally {
    clearTimeout(timer);
  }
}

function twimlText(xml) {
  return String(xml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function probeTwilioWebhook(path, from, channel) {
  const params = new URLSearchParams({
    To: EXPECTED_HQ,
    From: from,
  });
  if (channel === "voice") params.set("CallSid", `verify-${from.replace(/\D/g, "")}`);
  else {
    params.set("Body", "verify founder");
    params.set("MessageSid", `verify-sms-${from.replace(/\D/g, "")}`);
  }
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  return { status: res.status, text, ok: res.ok };
}

async function main() {
  console.log(`\nIFCDC HQ — Founder Phone Production Verification (${BASE})\n`);

  const health = await timedFetch(`${BASE}/api/health`);
  log(health.ok ? "pass" : "fail", "GET /api/health", String(health.res.status));

  const commit = health.body?.commit ?? "?";
  const tw = health.body?.integrations?.twilio;
  const founder = health.body?.integrations?.founder;
  const email = health.body?.integrations?.email;

  log(tw?.phoneNumber === EXPECTED_HQ ? "pass" : "fail", "HQ/Twilio line", tw?.phoneNumber ?? "missing");
  log(tw?.resolvedFrom === "TWILIO_PHONE_NUMBER" || tw?.resolvedFrom === "HQ_PHONE_NUMBER" ? "pass" : "warn", "Phone resolved from env", tw?.resolvedFrom ?? "built_in_default");
  log(tw?.ready ? "pass" : "fail", "Twilio production ready");
  log(email?.configured ? "pass" : "fail", "Resend email for Founder OTP", email?.founderOtpTo ?? "");

  if (!founder) {
    log("warn", "integrations.founder missing — deploy latest commit with founder health block");
  } else {
    log(founder.envSources?.founderTrustedPhonesSet ? "pass" : "warn", "FOUNDER_TRUSTED_PHONES set on Render");
    log(founder.envSources?.founderPhoneSet ? "pass" : "warn", "FOUNDER_PHONE set on Render");
    for (const phone of EXPECTED_FOUNDER) {
      const matched = founder.matchTests?.[phone];
      const loaded = founder.trustedPhones?.includes(phone);
      log(matched ? "pass" : "fail", `Founder match ${phone}`, `loaded=${loaded}`);
    }
    log(founder.matchTests?.[UNTRUSTED] === false ? "pass" : "fail", `Non-founder blocked ${UNTRUSTED}`);
    log(founder.hqPhone === EXPECTED_HQ ? "pass" : "fail", "Founder config HQ phone", founder.hqPhone ?? "");
  }

  for (const from of EXPECTED_FOUNDER) {
    const voice = await probeTwilioWebhook("/api/twilio/aura/voice", from, "voice");
    const greeting = twimlText(voice.text).toLowerCase();
    const recognized =
      voice.ok
      && voice.status === 200
      && (greeting.includes("founder") || greeting.includes("one-time") || greeting.includes("verification"));
    log(recognized ? "pass" : "fail", `Inbound voice webhook ${from}`, `${voice.status}`);
  }

  for (const from of EXPECTED_FOUNDER) {
    const sms = await probeTwilioWebhook("/api/twilio/aura/sms", from, "sms");
    const body = twimlText(sms.text).toLowerCase();
    const recognized = sms.ok && sms.status === 200 && body.length > 10;
    log(recognized ? "pass" : "fail", `Inbound SMS webhook ${from}`, `${sms.status}`);
  }

  if (PASSWORD) {
    const login = await timedFetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (login.ok) {
      const cookie = login.res.headers.getSetCookie?.()?.join("; ") ?? "";
      const headers = { Cookie: cookie };
      const hub = await timedFetch(`${BASE}/api/hq/integrations/`, { headers });
      const twilioCard = hub.body?.integrations?.find((i) => i.id === "twilio");
      if (twilioCard) {
        const events = twilioCard.details?.find((d) => d.label?.includes("Communication events"));
        log(events?.value ? "pass" : "warn", "Twilio communication events logged", events?.value ?? "0");
        log(twilioCard.health?.healthy ? "pass" : "warn", "Twilio Integrations Hub health", twilioCard.health?.message ?? "");
      }
      const comms = await timedFetch(`${BASE}/api/hq/communications/overview`, { headers });
      log(comms.ok ? "pass" : "warn", "Communications Center overview", comms.ok ? "reachable" : String(comms.res.status));
    } else {
      log("warn", "HQ login skipped — invalid FOUNDER_SEED_PASSWORD");
    }
  } else {
    log("warn", "FOUNDER_SEED_PASSWORD not set — skipping Communications Center authenticated checks");
  }

  console.log("\n═══════════════════════════════════════");
  console.log(`Founder Phone Verify — commit ${commit}`);
  console.log(`PASS: ${results.pass}  WARN: ${results.warn}  FAIL: ${results.fail}`);
  console.log("═══════════════════════════════════════\n");

  if (results.fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
