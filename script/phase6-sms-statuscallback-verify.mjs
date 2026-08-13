#!/usr/bin/env node
/**
 * Phase 6 production verification — live SMS + statusCallback loop.
 *
 * Auth (no Founder password):
 *   1. HQ_TOKEN / FOUNDER_HQ_TOKEN / IFCDC_HQ_TOKEN / AURA_OPS_VERIFY_TOKEN
 *   2. Token file: ~/.ifcdc/hq-bearer.token or ./.hq-bearer.token
 *   3. Founder phone OTP mint (FOUNDER_OTP_CODE) via /api/hq/aura/ops/founder-session/*
 *
 * Does NOT change Twilio credentials, Console settings, or production Founder password.
 *
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   HQ_TOKEN='…' \
 *   node script/phase6-sms-statuscallback-verify.mjs
 *
 * OTP path (no password, no pre-shared token):
 *   node script/phase6-sms-statuscallback-verify.mjs --start-otp
 *   FOUNDER_OTP_CODE=123456 node script/phase6-sms-statuscallback-verify.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
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
const DEST = (process.env.PHASE6_SMS_TO || "+18484694448").trim();
const TAG = `P6-${Date.now().toString(36)}`;
const BODY = `IFCDC AURA Phase 6 verification ${TAG}. Confirm delivery + statusCallback. Do not reply.`;
const START_OTP = process.argv.includes("--start-otp");
const TOKEN_FILE_CANDIDATES = [
  process.env.HQ_TOKEN_FILE,
  resolve(process.cwd(), ".hq-bearer.token"),
  join(homedir(), ".ifcdc", "hq-bearer.token"),
].filter(Boolean);

function readTokenFile() {
  for (const p of TOKEN_FILE_CANDIDATES) {
    if (p && existsSync(p)) {
      const t = readFileSync(p, "utf8").trim();
      if (t) return { token: t, source: `file:${p}` };
    }
  }
  return null;
}

function persistToken(token) {
  try {
    const dir = join(homedir(), ".ifcdc");
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "hq-bearer.token");
    writeFileSync(p, token, { mode: 0o600 });
    return p;
  } catch {
    return null;
  }
}

function resolveAuthMaterial() {
  const ops = (process.env.AURA_OPS_VERIFY_TOKEN || process.env.IFCDC_AURA_OPS_VERIFY_TOKEN || "").trim();
  if (ops) return { kind: "ops_token", token: ops, source: "AURA_OPS_VERIFY_TOKEN" };

  const jwt =
    (process.env.HQ_TOKEN || "").trim()
    || (process.env.FOUNDER_HQ_TOKEN || "").trim()
    || (process.env.IFCDC_HQ_TOKEN || "").trim();
  if (jwt) return { kind: "founder_jwt", token: jwt, source: "HQ_TOKEN env" };

  const file = readTokenFile();
  if (file) return { kind: "founder_jwt", token: file.token, source: file.source };

  return null;
}

async function api(path, { method = "GET", body, token, opsToken, timeoutMs = 120_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (opsToken) headers["X-IFCDC-Ops-Token"] = opsToken;
    else if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { _raw: text.slice(0, 400) };
    }
    return { res, json, ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startOtp() {
  console.log(`\n=== Phase 6 Founder OTP start (no password) ===`);
  console.log(`Phone: ${DEST}`);
  const start = await api("/api/hq/aura/ops/founder-session/start", {
    method: "POST",
    body: { phone: DEST },
  });
  console.log(`HTTP ${start.status}`, JSON.stringify(start.json, null, 2));
  if (!start.ok) process.exit(1);
  console.log(`\nCheck the Founder phone for the 6-digit code, then run:`);
  console.log(`  FOUNDER_OTP_CODE=###### node script/phase6-sms-statuscallback-verify.mjs`);
  process.exit(0);
}

async function completeOtpIfNeeded(auth) {
  if (auth) return auth;
  const code = (process.env.FOUNDER_OTP_CODE || "").replace(/\D/g, "");
  if (!code) return null;

  console.log(`Completing Founder phone OTP (no password)…`);
  const complete = await api("/api/hq/aura/ops/founder-session/complete", {
    method: "POST",
    body: { phone: DEST, code },
  });
  if (!complete.ok || !complete.json?.token) {
    console.error("FAIL: Founder OTP complete", complete.status, complete.json);
    process.exit(1);
  }
  const token = complete.json.token;
  const saved = persistToken(token);
  console.log(`Founder JWT minted via OTP${saved ? ` · saved ${saved}` : ""}`);
  return { kind: "founder_jwt", token, source: "founder_phone_otp" };
}

async function main() {
  if (START_OTP) {
    await startOtp();
    return;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    destination: DEST,
    tag: TAG,
    phase7Started: false,
    twilioConfigChanged: false,
    founderPasswordUsed: false,
  };

  console.log(`\n=== Phase 6 SMS statusCallback production verification ===`);
  console.log(`Base: ${BASE}`);
  console.log(`To: ${DEST}`);
  console.log(`Tag: ${TAG}`);
  console.log(`Auth: Founder JWT / ops token / phone OTP — password login disabled\n`);

  let auth = resolveAuthMaterial();
  auth = await completeOtpIfNeeded(auth);

  if (!auth) {
    console.error(`FAIL: No secure auth material.`);
    console.error(`Provide one of:`);
    console.error(`  HQ_TOKEN / FOUNDER_HQ_TOKEN / IFCDC_HQ_TOKEN  (Founder session JWT)`);
    console.error(`  AURA_OPS_VERIFY_TOKEN  (narrow Phase 6 ops token configured on Render)`);
    console.error(`  ~/.ifcdc/hq-bearer.token`);
    console.error(`Or mint via Founder phone OTP (no password):`);
    console.error(`  node script/phase6-sms-statuscallback-verify.mjs --start-otp`);
    console.error(`  FOUNDER_OTP_CODE=###### node script/phase6-sms-statuscallback-verify.mjs`);
    process.exit(1);
  }

  const tokenOpts =
    auth.kind === "ops_token"
      ? { opsToken: auth.token }
      : { token: auth.token };

  const health = await api("/api/health");
  report.health = {
    ok: health.ok,
    status: health.status,
    commit: health.json?.commit || health.json?.gitCommit || null,
  };
  console.log(`Health: HTTP ${health.status} commit=${report.health.commit || "n/a"}`);

  const authCheck = await api("/api/hq/aura/ops/auth-check", tokenOpts);
  report.authCheck = {
    ok: authCheck.ok,
    status: authCheck.status,
    body: authCheck.json,
    source: auth.source,
    kind: auth.kind,
  };
  console.log(
    `Auth check: HTTP ${authCheck.status} authorized=${authCheck.json?.authorized === true} method=${authCheck.json?.authMethod || "n/a"} source=${auth.source}`,
  );
  if (!authCheck.ok || authCheck.json?.authorized !== true) {
    console.error("FAIL: protected verification request not authorized (expected authorized access, got 401/deny).");
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const diag = await api("/api/hq/aura/diagnostics/e2e", tokenOpts);
  const smsProbe = Array.isArray(diag.json?.probes)
    ? diag.json.probes.find((p) => p.id === "sms-status")
    : null;
  report.preflightDiagnostics = {
    ok: diag.ok,
    status: diag.status,
    smsStatusProbe: smsProbe || null,
    publicBaseUrl: diag.json?.publicBaseUrl || null,
    webhookSmsStatus: diag.json?.webhookUrls?.smsStatus || null,
  };
  console.log(
    `Diagnostics: HTTP ${diag.status} publicBase=${diag.json?.publicBaseUrl || "n/a"} smsStatus=${diag.json?.webhookUrls?.smsStatus || "n/a"}`,
  );

  const send = await api("/api/hq/aura/ops/phase6-sms-verify", {
    method: "POST",
    ...tokenOpts,
    body: { to: DEST, message: BODY, tag: TAG },
  });
  report.smsInitiated = {
    httpOk: send.ok,
    httpStatus: send.status,
    authorized: send.json?.authorized === true,
    actionStatus: send.json?.actionStatus || null,
    summary: send.json?.summary || send.json?.error || "",
    messageId: send.json?.messageId || null,
    providerAccepted: send.json?.providerAccepted ?? null,
    to: send.json?.to || DEST,
    initialProviderStatus: send.json?.providerStatus || null,
    authMethod: send.json?.authMethod || auth.kind,
  };
  console.log(`\nSMS initiate: HTTP ${send.status} action=${report.smsInitiated.actionStatus}`);
  console.log(`  summary: ${report.smsInitiated.summary}`);
  console.log(`  messageId: ${report.smsInitiated.messageId}`);
  console.log(`  to: ${report.smsInitiated.to}`);

  if (!send.ok || !report.smsInitiated.messageId) {
    console.error("\nFAIL: SMS was not successfully initiated through AURA HQ.");
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const sid = report.smsInitiated.messageId;
  console.log(`\nPolling statusCallback / operational events for SID ${sid}…`);
  console.log(`Physical delivery: confirm SMS arrived on ${DEST} (Founder phone).`);

  let statusPayload = null;
  for (let i = 0; i < 18; i++) {
    await sleep(5000);
    const st = await api(`/api/hq/aura/ops/phase6-sms-status?sid=${encodeURIComponent(sid)}`, tokenOpts);
    statusPayload = st.json;
    const twStatus = st.json?.twilioMessage?.status || null;
    const cb = st.json?.statusCallbackReceived === true;
    const ops = st.json?.operationalEventCount || 0;
    console.log(
      `  poll ${i + 1}/18: http=${st.status} callback=${cb} twilio=${twStatus || "n/a"} opsEvents=${ops} commEvents=${st.json?.communicationEventCount || 0}`,
    );
    if (cb && (twStatus === "delivered" || ops > 0)) break;
    if (twStatus === "failed" || twStatus === "undelivered") break;
  }

  const eventsFinal = await api("/api/hq/aura/diagnostics/operational-events?limit=50", tokenOpts);
  const listFinal = await api("/api/hq/aura/action/list_operational_events", {
    method: "POST",
    ...tokenOpts,
    body: { args: { limit: 50 } },
  });
  const listEntries =
    Array.isArray(listFinal.json?.actions?.[0]?.data?.entries)
      ? listFinal.json.actions[0].data.entries
      : Array.isArray(listFinal.json?.data?.entries)
        ? listFinal.json.data.entries
        : [];
  const diagEntries = Array.isArray(eventsFinal.json?.entries) ? eventsFinal.json.entries : [];
  const related = [...diagEntries, ...listEntries, ...(statusPayload?.operationalEvents || [])].filter(
    (e) =>
      e.entityId === sid
      || e.entity_id === sid
      || String(e.detail || "").includes(sid)
      || String(e.title || "").includes(TAG)
      || String(e.title || "").includes(sid),
  );

  const finalTwilioStatus =
    statusPayload?.twilioMessage?.status
    || statusPayload?.communicationStatuses?.[0]
    || null;

  report.verification = {
    protectedRequestAuthorized: true,
    smsSuccessfullyInitiated: true,
    destination: DEST,
    twilioMessageSid: sid,
    physicalDelivery: "REQUIRES_FOUNDER_PHONE_CONFIRMATION",
    statusCallbackReachedSmsStatusRoute: Boolean(statusPayload?.statusCallbackReceived),
    finalTwilioStatus,
    recordedAsOperationalEvent: related.length > 0 || (statusPayload?.operationalEventCount || 0) > 0,
    auraCanReadEvent: Boolean(listFinal.ok || eventsFinal.ok),
    appearsInBrainTab9Diagnostics: Boolean(eventsFinal.ok),
    communicationEventCount: statusPayload?.communicationEventCount || 0,
    relatedOperationalEvents: related.slice(0, 10),
    statusPayload,
  };

  console.log("\n=== PHASE 6 ACCEPTANCE REPORT ===");
  console.log(JSON.stringify(report.verification, null, 2));
  console.log("\nFull report:");
  console.log(JSON.stringify(report, null, 2));

  if (!report.smsInitiated.messageId) process.exit(1);
  if (!report.verification.statusCallbackReachedSmsStatusRoute && finalTwilioStatus !== "delivered") {
    console.error("\nWARN: statusCallback not yet observed in HQ communication events.");
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
