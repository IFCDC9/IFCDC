#!/usr/bin/env node
/**
 * IFCDC Headquarters — Integrations Hub readiness verification
 */
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const EMAIL = process.env.MASTER_OWNER_EMAIL || process.env.IFCDC_SUPER_ADMIN_EMAIL || "service@ifcdc.org";
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || process.env.IFCDC_SUPER_ADMIN_PASSWORD || "";
const TIMEOUT_MS = 5000;

const REQUIRED_IDS = [
  "grants_gov", "sam_gov", "paypal", "resend", "openai_aura",
  "render", "github", "postgres", "twilio", "website_apps",
];

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
    try { body = await res.json(); } catch { body = null; }
    return { res, body, ms, ok: res.ok };
  } catch (err) {
    return { res: { status: 0 }, body: null, ms: Date.now() - start, ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log("IFCDC Headquarters — Integrations Hub Readiness\n");

  if (!PASSWORD) {
    log("warn", "FOUNDER_SEED_PASSWORD not set — skipping authenticated API checks");
    process.exit(0);
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
  const headers = cookie ? { Cookie: cookie } : {};

  const hub = await timedFetch(`${BASE}/api/hq/integrations/`, { headers });
  log(hub.ok ? "pass" : "fail", "GET /api/hq/integrations", `${hub.res.status} (${hub.ms}ms)`);
  log(hub.ms < TIMEOUT_MS ? "pass" : "fail", "Hub API under 5s", `${hub.ms}ms`);

  const integrations = hub.body?.integrations ?? [];
  log(Array.isArray(integrations) ? "pass" : "fail", "integrations array present", `${integrations.length} cards`);

  for (const id of REQUIRED_IDS) {
    const card = integrations.find((i) => i.id === id);
    if (!card) {
      log("fail", `Required integration: ${id}`, "missing");
      continue;
    }
    log("pass", `Card: ${card.name}`, card.status);
    log(card.lastChecked ? "pass" : "warn", `${id} lastChecked`);
    log(card.health?.message ? "pass" : "warn", `${id} health message`);
    log(Array.isArray(card.requiredCredentials) ? "pass" : "fail", `${id} credentials list`);
    log(Array.isArray(card.actions) && card.actions.length > 0 ? "pass" : "fail", `${id} actions`);
    if (id === "paypal") {
      const pp = integrations.find((i) => i.id === "paypal");
      log(pp?.requiredCredentials?.some((c) => c.key === "PAYPAL_CLIENT_ID" && c.configured) ? "pass" : "fail", "PayPal CLIENT_ID configured");
      log(pp?.requiredCredentials?.some((c) => c.key === "PAYPAL_CLIENT_SECRET" && c.configured) ? "pass" : "fail", "PayPal CLIENT_SECRET configured");
      log(Array.isArray(pp?.details) && pp.details.length >= 5 ? "pass" : "fail", "PayPal details", `${pp?.details?.length ?? 0} rows`);
      log(pp?.status === "connected" ? "pass" : pp?.status === "degraded" ? "warn" : "fail", "PayPal status", pp?.status ?? "unknown");
    }
    if (id === "grants_gov") {
      const gg = integrations.find((i) => i.id === "grants_gov");
      log(gg?.requiredCredentials?.some((c) => c.configured) ? "pass" : "warn", "Grants.gov public API (no key required)");
      log(Array.isArray(gg?.details) && gg.details.length >= 5 ? "pass" : "fail", "Grants.gov details", `${gg?.details?.length ?? 0} rows`);
      log(gg?.status === "connected" ? "pass" : gg?.status === "degraded" ? "warn" : "fail", "Grants.gov status", gg?.status ?? "unknown");
      log(gg?.health?.healthy ? "pass" : "warn", "Grants.gov health probe", gg?.health?.message ?? "");
    }
    if (id === "github") {
      const gh = integrations.find((i) => i.id === "github");
      log(gh?.requiredCredentials?.every((c) => c.configured) ? "pass" : "fail", "GitHub GITHUB_TOKEN configured");
      log(Array.isArray(gh?.details) && gh.details.length >= 6 ? "pass" : "fail", "GitHub repository details", `${gh?.details?.length ?? 0} rows`);
      log(gh?.status === "connected" ? "pass" : gh?.status === "configured" ? "warn" : "fail", "GitHub status", gh?.status ?? "unknown");
      log(gh?.health?.healthy ? "pass" : "warn", "GitHub health probe", gh?.health?.message ?? "");
    }
    if (id === "twilio") {
      const tw = integrations.find((i) => i.id === "twilio");
      log(tw?.requiredCredentials?.some((c) => c.key === "TWILIO_ACCOUNT_SID" && c.configured) ? "pass" : "fail", "Twilio ACCOUNT_SID configured");
      log(tw?.requiredCredentials?.some((c) => c.key === "OPENAI_API_KEY" && c.configured) ? "pass" : "fail", "AURA OPENAI_API_KEY configured");
      log(Array.isArray(tw?.details) && tw.details.length >= 6 ? "pass" : "fail", "Twilio details", `${tw?.details?.length ?? 0} rows`);
      log(tw?.status === "connected" ? "pass" : tw?.status === "degraded" ? "warn" : "fail", "Twilio status", tw?.status ?? "unknown");
    }
  }

  const paypal = integrations.find((i) => i.id === "paypal");
  if (paypal) {
    const ppTest = await timedFetch(`${BASE}/api/hq/integrations/paypal/test`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    });
    log(ppTest.ok && ppTest.body?.success ? "pass" : "fail", "POST paypal/test", ppTest.body?.message ?? String(ppTest.res.status));
    log(ppTest.body?.status === "connected" ? "pass" : "warn", "PayPal test status", ppTest.body?.status ?? "");
  }

  const grantsGov = integrations.find((i) => i.id === "grants_gov");
  if (grantsGov) {
    const ggTest = await timedFetch(`${BASE}/api/hq/integrations/grants_gov/test`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    });
    log(ggTest.ok && ggTest.body?.success ? "pass" : "fail", "POST grants_gov/test", ggTest.body?.message ?? String(ggTest.res.status));
    log(ggTest.body?.status === "connected" ? "pass" : "warn", "Grants.gov test status", ggTest.body?.status ?? "");
  }

  const github = integrations.find((i) => i.id === "github");
  if (github) {
    const ghTest = await timedFetch(`${BASE}/api/hq/integrations/github/test`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    });
    log(ghTest.ok && ghTest.body?.success ? "pass" : "fail", "POST github/test", ghTest.body?.message ?? String(ghTest.res.status));
    log(ghTest.body?.status === "connected" ? "pass" : "warn", "GitHub test status", ghTest.body?.status ?? "");
  }

  const twilio = integrations.find((i) => i.id === "twilio");
  if (twilio) {
    const twTest = await timedFetch(`${BASE}/api/hq/integrations/twilio/test`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    });
    log(twTest.ok && twTest.body?.success ? "pass" : "fail", "POST twilio/test", twTest.body?.message ?? String(twTest.res.status));
    log(twTest.body?.status === "connected" ? "pass" : "warn", "Twilio test status", twTest.body?.status ?? "");
  } else if (integrations[0]) {
    const test = await timedFetch(`${BASE}/api/hq/integrations/${integrations[0].id}/test`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    });
    log(test.ok ? "pass" : "warn", `POST test ${integrations[0].id}`, test.body?.message ?? String(test.res.status));
  }

  console.log("\n═══════════════════════════════════════");
  console.log(`Integrations Hub — PASS: ${results.pass}  WARN: ${results.warn}  FAIL: ${results.fail}`);
  console.log("═══════════════════════════════════════\n");

  if (results.fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
