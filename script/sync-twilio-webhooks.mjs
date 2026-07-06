#!/usr/bin/env node
/**
 * Sync Twilio phone webhooks to production Render URLs (removes ngrok/dev tunnels).
 * Runs against production via authenticated HQ API.
 *
 * Usage:
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   FOUNDER_SEED_PASSWORD=*** \
 *   node script/sync-twilio-webhooks.mjs
 */
const BASE = (process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");
const EMAIL = process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org";
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "";

async function main() {
  if (!PASSWORD) {
    console.error("Set FOUNDER_SEED_PASSWORD");
    process.exit(1);
  }

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) {
    console.error("Login failed:", login.status);
    process.exit(1);
  }
  const cookie = login.headers.getSetCookie?.()?.join("; ") ?? "";
  const headers = { Cookie: cookie, "Content-Type": "application/json" };

  console.log("Syncing Twilio webhooks via HQ Test Connection (auto-sync)…");
  const test = await fetch(`${BASE}/api/hq/integrations/twilio/test`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const body = await test.json();
  console.log(JSON.stringify(body, null, 2));
  process.exit(body.success ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
