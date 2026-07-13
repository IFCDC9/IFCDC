#!/usr/bin/env node
/**
 * Founder Operations Acceptance Test — natural-language path.
 * Posts the compound Founder prompt to /api/hq/aura/command and asserts
 * AURA executed a multi-step plan (not one forwarded email).
 *
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   FOUNDER_SEED_PASSWORD='…' \
 *   node script/founder-ops-acceptance-nl.mjs
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

const FOUNDER_PROMPT = `Run the Founder Operations Acceptance Test.

Step 1: verify_founder_session
Step 2: check_resend_health
Step 3: check_twilio_sms_health
Step 4: check_twilio_voice_health
Step 5: check_founder_contact_configuration
Step 6: check_action_registry
Step 7: check_communications_center
Step 8: send_email
Recipient: service@ifcdc.org
Subject: AURA Founder Test
Body: This is a live production email from AURA confirming that Founder Mode and outbound email are working.
Step 9: send_sms
Recipient: +18484694448
Message: AURA Founder Test: SMS and Founder authorization are working.
Step 10: create_founder_notification
Title: AURA Operations Test
Message: Founder Mode, email, SMS, and internal notifications were tested.
Step 11: return structured PASS/FAIL report`;

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

async function main() {
  console.log(`\n=== Founder Operations Acceptance (NL) ===\n${BASE}\n`);
  if (!PASSWORD) {
    console.error("Set FOUNDER_SEED_PASSWORD (must match Render ifcdc-hq)");
    process.exit(1);
  }

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  if (!login.ok) {
    console.error("Founder login failed:", login.status, login.json);
    process.exit(1);
  }
  const setCookie = login.res.headers.getSetCookie?.() || [];
  const cookie =
    setCookie.map((c) => c.split(";")[0]).join("; ")
    || (login.res.headers.get("set-cookie") || "").split(",")[0]?.split(";")[0] || "";

  const cmd = await api("/api/hq/aura/command", {
    method: "POST",
    cookie,
    body: { command: FOUNDER_PROMPT, module: "executive" },
  });

  if (!cmd.ok) {
    console.error("Command failed:", cmd.status, cmd.json);
    process.exit(1);
  }

  const reply = String(cmd.json?.reply || "");
  const actions = Array.isArray(cmd.json?.actions) ? cmd.json.actions : [];
  const report = cmd.json?.actions?.[0]?.data?.report
    || actions.find((a) => a.data?.report)?.data?.report
    || null;

  console.log("--- reply (first 1200 chars) ---");
  console.log(reply.slice(0, 1200));
  console.log(`\nactions=${actions.length}`);

  let fail = 0;
  function check(cond, msg) {
    console.log(`${cond ? "✓" : "✗"} ${msg}`);
    if (!cond) fail++;
  }

  check(actions.length >= 3, "Multiple actions executed (not a single dump)");
  check(!/Required fix:|Multi-step command planning/i.test(reply) || /PASS|FAIL|Step/i.test(reply), "Reply is a report, not a forwarded instruction email claim alone");
  check(/verify_founder_session|Step 1/i.test(reply) || actions.some((a) => /verify_founder/i.test(a.id)), "Includes Founder session step");
  check(
    actions.some((a) => a.id === "send_email" || /send_email/i.test(a.id))
      || /send_email/i.test(reply),
    "Includes send_email step",
  );
  check(
    actions.some((a) => a.id === "send_sms" || /send_sms/i.test(a.id))
      || /send_sms/i.test(reply),
    "Includes send_sms step",
  );
  // Must not claim the full prompt was the email body
  check(!/Body:[\s\S]*verify_founder_session/i.test(reply), "Did not forward instruction dump as email body");

  if (report) {
    console.log("\n--- structured report ---");
    for (const r of report) {
      console.log(`${r.status.padEnd(4)} ${r.step}. ${r.tool} — ${r.summary}`);
    }
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — NL acceptance (${fail} failures)\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
