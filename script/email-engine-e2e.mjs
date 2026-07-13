#!/usr/bin/env node
/**
 * Production Email Engine — live E2E
 *
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   FOUNDER_SEED_PASSWORD='…' \
 *   node script/email-engine-e2e.mjs
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadDotEnv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadDotEnv();

const BASE = (process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");
const EMAIL = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
const PASSWORD = (process.env.FOUNDER_SEED_PASSWORD || "").trim();

async function api(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { res, json, ok: res.ok, status: res.status };
}

function check(cond, msg, failures) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures.push(msg);
}

async function main() {
  console.log(`\n=== IFCDC Email Engine E2E ===\n${BASE}\n`);
  const failures = [];

  if (!PASSWORD) {
    console.error("Set FOUNDER_SEED_PASSWORD matching Render ifcdc-hq");
    process.exit(1);
  }

  const status = await api("/api/hq/email/status");
  check(status.ok, "GET /api/hq/email/status", failures);
  const auth = status.json?.senderAuth || {};
  console.log(`  from: ${auth.from || status.json?.fromPreview}`);
  console.log(`  domainVerified: ${auth.domainVerified}`);
  console.log(`  SPF=${auth.spf?.status} DKIM=${auth.dkim?.status} DMARC=${auth.dmarc?.status}`);
  console.log(`  trustedSender: ${auth.trustedSender}`);
  console.log(`  usedFallback: ${auth.usedFallback}`);
  if (Array.isArray(auth.guidance)) {
    for (const g of auth.guidance.slice(0, 4)) console.log(`  guidance: ${g}`);
  }
  check(Boolean(status.json?.engine?.templates?.length >= 8), "Template catalog present", failures);
  check(Boolean(status.json?.apiKeySet || status.json?.configured), "Resend API key configured", failures);

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  check(login.ok, "Founder login", failures);
  if (!login.ok) {
    console.log(login.json);
    process.exit(1);
  }
  const setCookie = login.res.headers.getSetCookie?.() || [];
  const cookie =
    setCookie.map((c) => c.split(";")[0]).join("; ")
    || (login.res.headers.get("set-cookie") || "").split(",")[0]?.split(";")[0]
    || "";

  const branded = await api("/api/hq/email/test-branded", {
    method: "POST",
    cookie,
    body: {
      to: EMAIL,
      intent: "Live production verification of the IFCDC Headquarters branded email engine",
    },
  });
  check(branded.ok && branded.json?.ok === true, "Branded AURA email accepted by Resend", failures);
  check(Boolean(branded.json?.send?.messageId), "Provider messageId returned", failures);
  check(branded.json?.send?.generatedBy === "aura" || branded.json?.send?.generatedBy === "fallback", "AURA compose path used", failures);
  const preview = String(branded.json?.send?.bodyPreview || "");
  check(!/This is a live production email from AURA confirming/i.test(preview), "Not the old placeholder body", failures);
  console.log(`  messageId: ${branded.json?.send?.messageId}`);
  console.log(`  generatedBy: ${branded.json?.send?.generatedBy}`);
  console.log(`  from: ${branded.json?.send?.from}`);
  console.log(`  preview: ${preview.slice(0, 140)}`);

  if (branded.json?.unverifiedSenderRisk) {
    console.log("\n⚠ Sender still at risk of Unverified Sender — complete DNS SPF/DKIM/DMARC in Resend.");
  } else {
    console.log("\n✓ Sender auth looks healthy (domain verified; SPF/DKIM present).");
  }

  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length} failure(s)\n`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
