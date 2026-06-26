#!/usr/bin/env node
/**
 * IFCDC Headquarters — Communications module readiness gate.
 * Usage: IFCDC_BASE_URL=https://ifcdc-hq.onrender.com npm run comms:readiness
 */
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const FOUNDER_EMAIL = process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org";
const FOUNDER_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const results = { pass: 0, fail: 0 };

function log(status, msg, detail = "") {
  console.log(`${status === "pass" ? "✓" : "✗"} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : "fail"]++;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body, ok: res.ok };
}

async function login() {
  const { ok, res } = await jsonFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email: FOUNDER_EMAIL, password: FOUNDER_PASSWORD }),
  });
  if (!ok) throw new Error(`Login failed: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  console.log(`\n=== IFCDC Communications Readiness (${BASE}) ===\n`);

  const unauth = await jsonFetch(`${BASE}/api/hq/communications/overview`);
  log(!unauth.ok ? "pass" : "fail", "Unauthenticated access blocked", String(unauth.res.status));

  const cookie = await login();
  log("pass", "Founder login");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const overview = await jsonFetch(`${BASE}/api/hq/communications/overview`, auth);
  log(overview.ok && overview.body?.announcements != null ? "pass" : "fail", "Communications overview", `${overview.body?.announcements ?? "?"} announcements`);

  const announcements = await jsonFetch(`${BASE}/api/hq/communications/announcements`, auth);
  log(announcements.ok && Array.isArray(announcements.body?.announcements) ? "pass" : "fail", "Announcements list");

  const testTitle = `Phase1 Readiness ${Date.now()}`;
  const create = await jsonFetch(`${BASE}/api/hq/communications/announcements`, {
    ...auth,
    method: "POST",
    body: JSON.stringify({ title: testTitle, body: "Automated readiness test announcement.", priority: "normal" }),
  });
  log(create.ok && create.body?.announcement?.id ? "pass" : "fail", "Create announcement", create.body?.announcement?.id ?? "?");

  const messages = await jsonFetch(`${BASE}/api/hq/communications/messages`, auth);
  log(messages.ok && Array.isArray(messages.body?.messages) ? "pass" : "fail", "Messages inbox");

  const sendMsg = await jsonFetch(`${BASE}/api/hq/communications/messages`, {
    ...auth,
    method: "POST",
    body: JSON.stringify({
      to_email: FOUNDER_EMAIL,
      subject: "Comms readiness test",
      body: "Self-test message from readiness script.",
      channel: "direct",
    }),
  });
  log(sendMsg.ok ? "pass" : "fail", "Send direct message");

  const audiences = await jsonFetch(`${BASE}/api/hq/communications/audiences`, auth);
  log(audiences.ok && Array.isArray(audiences.body?.segments) ? "pass" : "fail", "Audience segments", `${audiences.body?.segments?.length ?? 0} segments`);

  const notifs = await jsonFetch(`${BASE}/api/hq/enterprise/notifications`, auth);
  log(notifs.ok ? "pass" : "fail", "Notifications inbox integration");

  const exec = await jsonFetch(`${BASE}/api/hq/enterprise/approvals`, auth);
  log(exec.ok ? "pass" : "fail", "Executive dashboard approval tasks bridge");

  console.log(`\n=== Communications Readiness: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
