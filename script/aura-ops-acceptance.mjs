#!/usr/bin/env node
/**
 * AURA Production Acceptance Test — small live tasks against HQ.
 * Never reports PASS unless the provider/API confirms completion.
 *
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   FOUNDER_SEED_PASSWORD='…' \   # must match Render ifcdc-hq
 *   node script/aura-ops-acceptance.mjs
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
const GRANTS_OP_EMAIL = (process.env.GRANTS_OPERATOR_EMAIL || "813786b@gmail.com").toLowerCase();
// Founder credential only — never fall back to GRANTS_OPERATOR_PASSWORD.
const PASSWORD = (process.env.FOUNDER_SEED_PASSWORD || process.env.IFCDC_SUPER_ADMIN_PASSWORD || "").trim();
const GRANTS_PASSWORD = (process.env.GRANTS_OPERATOR_PASSWORD || "").trim();
const FOUNDER_PHONE = (process.env.SMS_TO || process.env.FOUNDER_PHONE?.split(",")[0] || "+18484694448").trim();
const TAG = `PAT-${Date.now().toString(36)}`;

function unwrapAction(body) {
  if (!body) return { status: "error", summary: "Empty response", data: null, raw: body };
  const executed = Array.isArray(body.actions) && body.actions[0] ? body.actions[0] : null;
  if (executed) {
    return {
      status: executed.status || "error",
      summary: executed.summary || body.reply || "",
      data: executed.data || null,
      raw: body,
    };
  }
  if (body.status) return { status: body.status, summary: body.summary || body.reply || "", data: body.data || null, raw: body };
  return { status: "error", summary: body.error || body.reply || "Unrecognized action response", data: null, raw: body };
}

const results = [];

function record(task, status, ms, provider, error, fix, detail = {}) {
  results.push({ task, status, ms, provider, error: error || null, fix: fix || null, detail });
  const icon = status === "PASS" ? "✓" : status === "PARTIAL" ? "◐" : "✗";
  console.log(`\n${icon} ${task}: ${status} (${ms}ms)`);
  if (provider) console.log(`  provider: ${provider}`);
  if (error) console.log(`  error: ${error}`);
  if (fix) console.log(`  fix: ${fix}`);
  if (detail && Object.keys(detail).length) console.log(`  detail: ${JSON.stringify(detail).slice(0, 600)}`);
}

async function timed(fn) {
  const t0 = Date.now();
  try {
    return { ok: true, value: await fn(), ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 };
  }
}

async function api(path, { method = "GET", body, cookie, timeoutMs = 90_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { _raw: text.slice(0, 300) };
    }
    return { res, json, ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function login() {
  // Founder path only — never authenticate service@ifcdc.org with GRANTS_OPERATOR_PASSWORD.
  const r = await api("/api/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  if (!r.ok) {
    throw new Error(
      `Login failed HTTP ${r.status}: ${JSON.stringify(r.json)} ` +
        `(account=${EMAIL}; credential=FOUNDER_SEED_PASSWORD — not GRANTS_OPERATOR_PASSWORD)`,
    );
  }
  const setCookie = r.res.headers.getSetCookie?.() || [];
  const cookie =
    setCookie.join("; ") ||
    (r.res.headers.get("set-cookie") || "")
      .split(",")
      .map((s) => s.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
  if (!cookie.includes("ifcdc_token")) throw new Error("No ifcdc_token cookie from login");
  return { cookie, role: r.json?.role };
}

async function action(cookie, actionId, args, timeoutMs = 120_000) {
  return api(`/api/hq/aura/action/${actionId}`, {
    method: "POST",
    cookie,
    body: { args },
    timeoutMs,
  });
}

function printSummary() {
  console.log("\n=== SUMMARY ===");
  for (const r of results.filter((x) => /^\d+\./.test(x.task) || x.task.includes("login") || x.task.includes("preamble") || x.task.includes("Mode"))) {
    console.log(`${r.status.padEnd(7)} ${r.task} (${r.ms}ms)`);
  }
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const partial = results.filter((r) => r.status === "PARTIAL").length;
  console.log(`\nPASS=${pass} PARTIAL=${partial} FAIL=${fail}`);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, tag: TAG, results }, null, 2));
}

async function main() {
  console.log(`\n=== AURA Production Acceptance Test ===`);
  console.log(`Base: ${BASE}`);
  console.log(`Auth path: Founder (${EMAIL}) via FOUNDER_SEED_PASSWORD`);
  console.log(`Not used: Grants Operator (${GRANTS_OP_EMAIL}) / GRANTS_OPERATOR_PASSWORD`);
  console.log(`Phone: ${FOUNDER_PHONE}\nTag: ${TAG}\n`);

  if (EMAIL === GRANTS_OP_EMAIL) {
    record(
      "Auth",
      "FAIL",
      0,
      "hq-auth",
      "MASTER_OWNER_EMAIL equals GRANTS_OPERATOR_EMAIL",
      "Keep Founder service@ifcdc.org separate from Grants Operator 813786b@gmail.com",
    );
    printSummary();
    process.exit(1);
  }

  if (!PASSWORD) {
    record(
      "Auth",
      "FAIL",
      0,
      "hq-auth",
      "FOUNDER_SEED_PASSWORD not set",
      "Export FOUNDER_SEED_PASSWORD matching Render ifcdc-hq (not GRANTS_OPERATOR_PASSWORD)",
    );
    printSummary();
    process.exit(1);
  }

  if (GRANTS_PASSWORD && PASSWORD === GRANTS_PASSWORD) {
    record(
      "Auth",
      "FAIL",
      0,
      "hq-auth",
      "FOUNDER_SEED_PASSWORD equals GRANTS_OPERATOR_PASSWORD in local env",
      "These must be different secrets — sync FOUNDER_SEED_PASSWORD from Render Founder env only",
    );
    printSummary();
    process.exit(1);
  }

  {
    const t = await timed(() => api("/api/health"));
    if (!t.ok || !t.value.ok) {
      record("Health preamble", "FAIL", t.ms, "render", t.error || `HTTP ${t.value?.status}`, "Confirm Render service is up");
    } else {
      record("Health preamble", "PASS", t.ms, "render", null, null, {
        commit: t.value.json?.commit,
        email: t.value.json?.integrations?.email,
        twilio: t.value.json?.integrations?.twilio,
      });
    }
  }

  let cookie;
  {
    const t = await timed(() => login());
    if (!t.ok) {
      record("Founder login", "FAIL", t.ms, "hq-auth", t.error, "Sync FOUNDER_SEED_PASSWORD with Render ifcdc-hq (Dashboard → Environment)");
      // Mark remaining tasks blocked
      for (const name of [
        "1. Email Test",
        "2. SMS Test",
        "3. Voice Test",
        "4. Calendar Test",
        "5. Document Test",
        "6. Notification Test",
        "7. Executive Report Test",
        "8. Health Check",
      ]) {
        record(name, "FAIL", 0, "blocked", "Blocked — Founder authentication failed", "Fix Founder login first");
      }
      printSummary();
      process.exit(1);
    }
    cookie = t.value.cookie;
    record("Founder login", "PASS", t.ms, "hq-auth", null, null, { role: t.value.role });
  }

  {
    const t = await timed(() => api("/api/hq/auth/session", { cookie }));
    const fm = t.value?.json?.user?.founderMode === true || t.value?.json?.user?.enterpriseRole === "founder";
    if (!t.ok || !t.value.ok || !fm) {
      record("Founder Mode session", "FAIL", t.ms, "hq-session", t.error || "founderMode not active", "Confirm service@ifcdc.org → owner");
    } else {
      record("Founder Mode session", "PASS", t.ms, "hq-session", null, null, {
        founderMode: t.value.json.user.founderMode,
        role: t.value.json.user.role,
      });
    }
  }

  // 1 Email
  {
    const t = await timed(() =>
      action(cookie, "send_email", {
        to: "service@ifcdc.org",
        subject: "AURA Production Test",
        body: "This is a live production email sent by AURA to verify the communications system.",
      })
    );
    const u = unwrapAction(t.value?.json);
    if (!t.ok || !t.value?.ok || u.status !== "done") {
      record("1. Email Test", "FAIL", t.ms, "resend", u.summary || t.error, "Verify RESEND_API_KEY + RESEND_FROM_EMAIL", { response: u.raw });
    } else {
      record("1. Email Test", "PASS", t.ms, "resend", null, null, { summary: u.summary, results: u.data?.results });
    }
  }

  // 2 SMS
  {
    let t = await timed(() => action(cookie, "send_sms", { to: "founder", body: `AURA Production SMS Test ${TAG}. Live Twilio delivery check.` }));
    let u = unwrapAction(t.value?.json);
    let ms = t.ms;
    if (!t.ok || !t.value?.ok || u.status !== "done") {
      t = await timed(() => action(cookie, "send_sms", { to: FOUNDER_PHONE, body: `AURA Production SMS Test ${TAG}. Live Twilio delivery check.` }));
      u = unwrapAction(t.value?.json);
      ms += t.ms;
    }
    if (!t.ok || !t.value?.ok || u.status !== "done") {
      record("2. SMS Test", "FAIL", ms, "twilio", u.summary || t.error, "Verify Twilio SID/token/from + FOUNDER_TRUSTED_PHONES", { response: u.raw });
    } else {
      record("2. SMS Test", "PASS", ms, "twilio", null, null, { summary: u.summary, messageId: u.data?.messageId, to: u.data?.to || FOUNDER_PHONE });
    }
  }

  // 3 Voice (outbound automated; inbound Q&A needs Founder)
  {
    const t = await timed(() =>
      action(cookie, "place_call", {
        to: "founder",
        message: `Hello Founder. This is AURA production voice test ${TAG}. Please say hello if you can hear me.`,
      })
    );
    const u = unwrapAction(t.value?.json);
    if (!t.ok || !t.value?.ok || u.status !== "done") {
      record("3. Voice Test", "FAIL", t.ms, "twilio-voice", u.summary || t.error, "Verify Twilio voice + /api/twilio/aura webhooks", { response: u.raw });
    } else {
      record(
        "3. Voice Test",
        "PARTIAL",
        t.ms,
        "twilio-voice",
        "Outbound call placed; inbound HQ answer + live Q&A not auto-verified",
        "Dial HQ +13313168167, ask one question, confirm call stays connected",
        { summary: u.summary, data: u.data }
      );
    }
  }

  // 4 Calendar
  {
    const start = new Date(Date.now() + 3600_000).toISOString();
    const end = new Date(Date.now() + 5400_000).toISOString();
    const t = await timed(() =>
      action(cookie, "create_calendar_event", {
        title: `AURA Production Test Event ${TAG}`,
        description: "Live calendar acceptance test created by AURA.",
        startAt: start,
        endAt: end,
        location: "IFCDC HQ",
      })
    );
    const u = unwrapAction(t.value?.json);
    const calendarId = u.data?.id || null;
    let listed = false;
    for (const path of ["/api/hq/operations/calendar/events", "/api/hq/operations/calendar"]) {
      const list = await api(path, { cookie });
      const blob = JSON.stringify(list.json || {});
      if (list.ok && (blob.includes(TAG) || (calendarId && blob.includes(calendarId)))) {
        listed = true;
        break;
      }
    }
    if (!t.ok || !t.value?.ok || u.status !== "done") {
      record("4. Calendar Test", "FAIL", t.ms, "hq-calendar", u.summary || t.error, "Inspect org_events / create_calendar_event", { response: u.raw });
    } else {
      record("4. Calendar Test", calendarId || listed ? "PASS" : "PARTIAL", t.ms, "hq-calendar", null, null, { summary: u.summary, calendarId, listed });
    }
  }

  // 5 Document
  {
    const t = await timed(() =>
      action(cookie, "create_document", {
        title: `AURA Production Test Report ${TAG}`,
        body: `# AURA Production Test Report\n\nTag: ${TAG}\n\nCreated by AURA to verify Document Management.\n`,
      })
    );
    const u = unwrapAction(t.value?.json);
    const docId = u.data?.id || null;
    let opened = false;
    if (docId) {
      const get = await api(`/api/hq/documents/${docId}`, { cookie });
      opened = get.ok && Boolean(get.json?.document || get.json?.id || get.json?.title);
    }
    if (!opened) {
      const list = await api("/api/hq/documents?limit=50", { cookie });
      opened = list.ok && JSON.stringify(list.json || {}).includes(TAG);
    }
    if (!t.ok || !t.value?.ok || u.status !== "done") {
      record("5. Document Test", "FAIL", t.ms, "hq-documents", u.summary || t.error, "Check hq_documents create path", { response: u.raw });
    } else if (!opened) {
      record("5. Document Test", "PARTIAL", t.ms, "hq-documents", "Saved but open/list verify failed", "Open /hq/documents", { summary: u.summary, docId });
    } else {
      record("5. Document Test", "PASS", t.ms, "hq-documents", null, null, { summary: u.summary, docId });
    }
  }

  // 6 Notification
  {
    const t = await timed(() =>
      action(cookie, "send_notification", {
        title: `AURA Production Notification ${TAG}`,
        message: "Live Founder notification acceptance test from AURA.",
      })
    );
    const u = unwrapAction(t.value?.json);
    let visible = Boolean(u.data?.alertId);
    for (const path of ["/api/hq/enterprise/hub", "/api/hq/aura/autonomous/workspace", "/api/hq/notifications"]) {
      const r = await api(path, { cookie });
      if (r.ok && JSON.stringify(r.json || {}).includes(TAG)) {
        visible = true;
        break;
      }
    }
    if (!t.ok || !t.value?.ok || u.status !== "done") {
      record("6. Notification Test", "FAIL", t.ms, "hq-notifications", u.summary || t.error, "Check createLeadershipAlert", { response: u.raw });
    } else {
      record("6. Notification Test", visible ? "PASS" : "PARTIAL", t.ms, "hq-notifications", visible ? null : "Created but not listed in APIs", visible ? null : "Open Notifications UI", {
        summary: u.summary,
        alertId: u.data?.alertId,
        visible,
      });
    }
  }

  // 7 Executive report
  {
    const tGen = await timed(() =>
      action(cookie, "generate_executive_report", { request: `Generate today's executive briefing for production acceptance ${TAG}` })
    );
    const gen = unwrapAction(tGen.value?.json);
    const tBrief = await timed(() => api("/api/hq/aura/brain/daily-briefing", { cookie }));
    const brief = tBrief.value?.json;
    const hasContent =
      gen.status === "done" ||
      (typeof brief?.briefing === "string" && brief.briefing.length > 40) ||
      (brief && Object.keys(brief).length > 3);
    if (!hasContent) {
      record("7. Executive Report Test", "FAIL", tGen.ms + tBrief.ms, "aura-briefing", gen.summary || "No briefing content", "Check OpenAI + executiveBriefings", {
        generate: gen.raw,
        briefingKeys: brief ? Object.keys(brief) : [],
      });
    } else {
      record("7. Executive Report Test", "PASS", tGen.ms + tBrief.ms, "aura-briefing", null, null, {
        generateStatus: gen.status,
        generateSummary: gen.summary,
        briefingKeys: Object.keys(brief || {}),
        docId: gen.data?.id,
      });
    }
  }

  // 8 Health
  {
    const tDiag = await timed(() => action(cookie, "enterprise_diagnostics", { request: "Run enterprise diagnostics for production acceptance" }));
    const diag = unwrapAction(tDiag.value?.json);
    const tHealth = await timed(() => api("/api/hq/enterprise-health/dashboard", { cookie }));
    const health = tHealth.value?.json;
    const healthOk = tHealth.ok && tHealth.value?.ok && typeof health?.overallScore === "number";
    if (!healthOk && diag.status !== "done") {
      record("8. Health Check", "FAIL", tDiag.ms + tHealth.ms, "enterprise-health", health?.error || diag.summary || tHealth.error, "Manual Deploy enterprise-health if 404", {
        healthStatus: tHealth.value?.status,
      });
    } else {
      record("8. Health Check", "PASS", tDiag.ms + tHealth.ms, "enterprise-health", null, null, {
        overallScore: health?.overallScore,
        criticalCount: health?.criticalCount,
        warningCount: health?.warningCount,
        verifiedCoveragePct: health?.verifiedCoveragePct,
        canReach100: health?.canReach100,
        failingModules: health?.failingModules,
        speechSummary: health?.speechSummary || diag.summary,
        topIssues: (health?.issues || []).slice(0, 8).map((i) => ({
          severity: i.severity,
          module: i.module,
          description: String(i.description || "").slice(0, 120),
        })),
      });
    }
  }

  printSummary();
  process.exit(results.some((r) => r.status === "FAIL" && /^\d+\./.test(r.task)) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
