#!/usr/bin/env node
/**
 * PayPal integration readiness — production verification
 * Usage:
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   FOUNDER_SEED_PASSWORD=*** \
 *   node script/paypal-readiness.mjs
 */
const BASE = (process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");
const EMAIL = process.env.MASTER_OWNER_EMAIL || process.env.IFCDC_SUPER_ADMIN_EMAIL || "service@ifcdc.org";
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || process.env.IFCDC_SUPER_ADMIN_PASSWORD || "";
const TIMEOUT_MS = 15_000;

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
  console.log(`\nIFCDC HQ — PayPal Readiness (${BASE})\n`);

  const health = await timedFetch(`${BASE}/api/health`);
  log(health.ok ? "pass" : "fail", "GET /api/health", `${health.res.status} (${health.ms}ms)`);

  const pp = health.body?.integrations?.paypal;
  if (pp) {
    log(pp.clientIdConfigured ? "pass" : "fail", "PAYPAL_CLIENT_ID on Render");
    log(pp.clientSecretConfigured ? "pass" : "fail", "PAYPAL_CLIENT_SECRET on Render");
    log(pp.environment === "live" ? "pass" : "warn", "PAYPAL_ENV", pp.envRaw ?? pp.environment);
    log(pp.ready ? "pass" : "fail", "PayPal env ready");
  } else {
    log("warn", "PayPal block missing from /api/health — deploy latest commit");
  }

  const clientId = await timedFetch(`${BASE}/api/paypal/client-id`);
  log(clientId.ok ? "pass" : "fail", "GET /api/paypal/client-id", clientId.body?.environment ?? String(clientId.res.status));

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
  const paypalCard = hub.body?.integrations?.find((i) => i.id === "paypal");
  log(paypalCard ? "pass" : "fail", "PayPal Integrations Hub card");
  if (paypalCard) {
    log(paypalCard.status === "connected" ? "pass" : "warn", "PayPal card status", paypalCard.status);
    log(paypalCard.health?.healthy ? "pass" : "warn", "PayPal health", paypalCard.health?.message ?? "");
  }

  const test = await timedFetch(`${BASE}/api/hq/integrations/paypal/test`, {
    method: "POST",
    headers,
    body: "{}",
  });
  log(test.ok && test.body?.success ? "pass" : "fail", "POST paypal/test", test.body?.message ?? String(test.res.status));
  log(test.body?.status === "connected" ? "pass" : "warn", "Test status", test.body?.status ?? "");

  const payments = await timedFetch(`${BASE}/api/hq/finance/payment-sources`, { headers });
  log(payments.ok ? "pass" : "fail", "GET /api/hq/finance/payment-sources", `${(payments.body?.sources ?? []).length} sources`);

  console.log("\n═══════════════════════════════════════");
  console.log(`PayPal Readiness — PASS: ${results.pass}  WARN: ${results.warn}  FAIL: ${results.fail}`);
  console.log("═══════════════════════════════════════\n");

  if (results.fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
