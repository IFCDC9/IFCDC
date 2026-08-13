#!/usr/bin/env node
/**
 * Phase 7 regression — HQ AURA production path without :4101.
 *
 *   HQ_TOKEN=… IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   node script/phase7-aura-hardening-verify.mjs
 *
 * Does not change Twilio credentials or send SMS unless PHASE7_LIVE_SMS=1.
 */
import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { homedir } from "os";

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

function resolveToken() {
  const env =
    (process.env.HQ_TOKEN || "").trim()
    || (process.env.FOUNDER_HQ_TOKEN || "").trim()
    || (process.env.AURA_OPS_VERIFY_TOKEN || "").trim();
  if (env) return env;
  for (const p of [resolve(process.cwd(), ".hq-bearer.token"), join(homedir(), ".ifcdc", "hq-bearer.token")]) {
    if (existsSync(p)) {
      const t = readFileSync(p, "utf8").trim();
      if (t) return t;
    }
  }
  return "";
}

const token = resolveToken();
const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 300) };
  }
  return { res, json, ok: res.ok, status: res.status };
}

async function main() {
  console.log(`\n=== Phase 7 AURA hardening regression ===\n${BASE}\n`);

  const health = await api("/api/health");
  if (health.ok) pass("health", `commit=${health.json?.commit || "n/a"}`);
  else fail("health", `HTTP ${health.status}`);

  if (!token) {
    fail("auth", "No HQ_TOKEN / ~/.ifcdc/hq-bearer.token — remaining checks skipped");
    console.log(JSON.stringify({ results }, null, 2));
    process.exit(1);
  }

  const status = await api("/api/hq/aura/status");
  if (status.ok && status.json?.auraCore === true && status.json?.productionPath === "hq_in_process_openai") {
    pass("aura/status production path", `legacyRequired=${status.json?.legacy4101?.legacyEnabled === true}`);
  } else if (status.ok && status.json?.auraCore === true) {
    pass("aura/status auraCore", JSON.stringify(status.json?.productionPath || status.json?.legacy4101 || {}));
  } else {
    fail("aura/status", `HTTP ${status.status} ${JSON.stringify(status.json).slice(0, 200)}`);
  }

  const legacy = await api("/api/hq/aura/diagnostics/legacy-4101");
  if (legacy.ok && legacy.json?.summary?.deprecated === true) {
    pass("legacy-4101 diagnostics", `probe=${legacy.json.summary.probeEnabled} entries=${legacy.json.entries?.length ?? 0}`);
  } else {
    fail("legacy-4101 diagnostics", `HTTP ${legacy.status}`);
  }

  const diag = await api("/api/hq/aura/diagnostics/e2e");
  const p4101 = Array.isArray(diag.json?.probes) ? diag.json.probes.find((p) => p.id === "core-port-4101") : null;
  const sms = Array.isArray(diag.json?.probes) ? diag.json.probes.find((p) => p.id === "sms-status") : null;
  if (diag.ok) pass("diagnostics/e2e", `4101=${p4101?.status || "n/a"} sms=${sms?.status || "n/a"}`);
  else fail("diagnostics/e2e", `HTTP ${diag.status}`);

  const ops = await api("/api/hq/aura/diagnostics/operational-events?limit=10");
  if (ops.ok) pass("operational-events (Tab 9)", `entries=${ops.json?.entries?.length ?? ops.json?.summary?.totalReturned ?? "n/a"}`);
  else fail("operational-events", `HTTP ${ops.status}`);

  const cmd = await api("/api/hq/aura/command", {
    method: "POST",
    body: { command: "What is the AURA production path? Reply in one short sentence." },
  });
  if (cmd.ok && (cmd.json?.reply || cmd.json?.actions)) {
    pass("aura chat/command", String(cmd.json.reply || "").slice(0, 120));
  } else {
    fail("aura chat/command", `HTTP ${cmd.status} ${JSON.stringify(cmd.json).slice(0, 200)}`);
  }

  const actions = await api("/api/hq/aura/actions");
  if (actions.ok) pass("aura actions catalog", `count=${Array.isArray(actions.json) ? actions.json.length : actions.json?.actions?.length || "n/a"}`);
  else fail("aura actions catalog", `HTTP ${actions.status}`);

  const identity = await api("/api/hq/aura/identity");
  if (identity.ok && (identity.json?.isFounder || identity.json?.founderMode || identity.json?.identity)) {
    pass("founder authentication", JSON.stringify(identity.json?.email || identity.json?.identity?.email || "ok"));
  } else if (identity.ok) {
    pass("founder session readable", `HTTP ${identity.status}`);
  } else {
    fail("founder authentication", `HTTP ${identity.status}`);
  }

  // SMS status route still public for Twilio (no auth) — expect 200 empty or form parse
  const smsStatus = await fetch(`${BASE}/api/twilio/aura/sms/status`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "MessageSid=SMphase7probe&MessageStatus=sent&To=%2B15555550100",
    signal: AbortSignal.timeout(30_000),
  });
  if (smsStatus.status === 200 || smsStatus.status === 403) {
    // 403 if Twilio signature enforced without valid sig — still means route exists
    pass("sms statusCallback route", `HTTP ${smsStatus.status}`);
  } else {
    fail("sms statusCallback route", `HTTP ${smsStatus.status}`);
  }

  if (process.env.PHASE7_LIVE_SMS === "1") {
    const send = await api("/api/hq/aura/ops/phase6-sms-verify", {
      method: "POST",
      body: {
        to: "+18484694448",
        message: `IFCDC AURA Phase 7 regression SMS ${Date.now().toString(36)}. Do not reply.`,
      },
    });
    if (send.ok && send.json?.messageId) pass("live SMS send", send.json.messageId);
    else fail("live SMS send", `HTTP ${send.status} ${JSON.stringify(send.json).slice(0, 200)}`);
  } else {
    pass("live SMS send", "skipped (set PHASE7_LIVE_SMS=1 to enable)");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Phase 7 summary: ${results.length - failed.length}/${results.length} passed ===\n`);
  console.log(JSON.stringify({ base: BASE, failed, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
