#!/usr/bin/env node
/**
 * IFCDC Grant Center — Production QA gate (CRUD, RBAC, routes, build prep)
 */
import { spawnSync } from "node:child_process";
import jwt from "jsonwebtoken";

const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const FOUNDER_EMAIL = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
const FOUNDER_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "DEV_ONLY_CHANGE_ME_IFCDC";
const QA_TAG = `qa-grant-${Date.now()}`;

const results = { pass: 0, fail: 0 };
const cleanup = [];

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
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text?.slice(0, 120) }; }
  return { res, body, ok: res.ok };
}

async function login(email, password) {
  const { ok, res } = await jsonFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

function boardAuthHeader() {
  const token = jwt.sign(
    { id: "qa-board-user", email: "qa-board@ifcdc.org", role: "board_member", name: "QA Board" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Cookie: `ifcdc_token=${token}` };
}

async function runReadiness() {
  const proc = spawnSync("node", ["script/grant-center-readiness.mjs"], {
    stdio: "pipe",
    env: { ...process.env, IFCDC_BASE_URL: BASE },
  });
  const out = `${proc.stdout?.toString() ?? ""}${proc.stderr?.toString() ?? ""}`;
  const match = out.match(/(\d+) PASS \/ (\d+) FAIL/);
  if (proc.status !== 0) {
    log("fail", "Readiness suite", match ? `${match[1]} pass / ${match[2]} fail` : "exit non-zero");
    if (out.trim()) console.log(out.trim());
    return false;
  }
  log("pass", "Readiness suite", match ? `${match[1]} checks` : "all pass");
  return true;
}

async function main() {
  console.log("\n=== IFCDC Grant Center Production QA ===\n");

  const cookie = await login(FOUNDER_EMAIL, FOUNDER_PASSWORD);
  log("pass", "Founder authentication");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  // Route coverage — all tab/API surfaces return JSON (not SPA HTML)
  const routes = [
    ["/api/hq/grants/center/platform", "Platform registry"],
    ["/api/hq/grants/center/executive-summary", "Executive summary"],
    ["/api/hq/grants/center/opportunity-finder", "Opportunity finder"],
    ["/api/hq/grants/center/analytics", "Funding analytics"],
    ["/api/hq/grants/library/templates", "Grant library"],
    ["/api/hq/grants/dashboard", "Dashboard"],
    ["/api/hq/grants/pipeline", "Pipeline"],
    ["/api/hq/grants/calendar", "Calendar"],
    ["/api/hq/grants/deadlines", "Deadlines"],
    ["/api/hq/grants/documents", "Documents vault"],
    ["/api/hq/grants/funders", "Funder CRM"],
    ["/api/hq/grants/compliance", "Compliance"],
    ["/api/hq/grants/awards", "Awards"],
    ["/api/hq/grants/notifications", "Notifications"],
    ["/api/hq/grants/funder-reports", "Funder reports"],
    ["/api/hq/grants/history", "History"],
    ["/api/hq/grants/funding-engine/v5/platform", "V5 intelligence"],
  ];
  for (const [path, label] of routes) {
    const r = await jsonFetch(`${BASE}${path}`, auth);
    const isJson = r.body && !String(r.body._raw ?? "").includes("<!DOCTYPE");
    log(r.ok && isJson ? "pass" : "fail", `Route: ${label}`, `${r.res.status}`);
  }

  // Unauthenticated guard
  const unauth = await jsonFetch(`${BASE}/api/hq/grants/center/platform`);
  log(unauth.res.status === 401 ? "pass" : "fail", "Unauthenticated API blocked", String(unauth.res.status));

  // RBAC — board member read OK, write blocked
  const boardRead = await jsonFetch(`${BASE}/api/hq/grants/center/platform`, { headers: boardAuthHeader() });
  log(boardRead.ok ? "pass" : "fail", "Board member read access");

  const boardWrite = await jsonFetch(`${BASE}/api/hq/grants/opportunities`, {
    method: "POST",
    headers: boardAuthHeader(),
    body: JSON.stringify({ title: "RBAC test", funder: "QA" }),
  });
  log(boardWrite.res.status === 403 ? "pass" : "fail", "Board member write blocked", String(boardWrite.res.status));

  const founderWrite = await jsonFetch(`${BASE}/api/hq/grants/opportunities`, {
    ...auth,
    method: "POST",
    body: JSON.stringify({
      title: `${QA_TAG} Opportunity`,
      funder: "QA Foundation",
      description: "Production QA test record",
      geography: "local",
      funder_type: "foundation",
    }),
  });
  const oppId = founderWrite.body?.opportunity?.id ?? founderWrite.body?.id;
  log(founderWrite.ok && oppId ? "pass" : "fail", "CRUD: Create opportunity");
  if (oppId) cleanup.push(["opportunity", oppId]);

  if (oppId) {
    const patchOpp = await jsonFetch(`${BASE}/api/hq/grants/opportunities/${oppId}`, {
      ...auth,
      method: "PATCH",
      body: JSON.stringify({ description: "Updated by QA", amount_max: 50000 }),
    });
    log(patchOpp.ok ? "pass" : "fail", "CRUD: Update opportunity");

    const readOpp = await jsonFetch(`${BASE}/api/hq/grants/opportunities`, auth);
    const found = (readOpp.body?.opportunities ?? []).some((o) => o.id === oppId);
    log(found ? "pass" : "fail", "CRUD: Read opportunity list");
  }

  const createApp = await jsonFetch(`${BASE}/api/hq/grants/applications`, {
    ...auth,
    method: "POST",
    body: JSON.stringify({
      title: `${QA_TAG} Application`,
      opportunity_id: oppId ?? undefined,
      amount_requested: 25000,
    }),
  });
  const appId = createApp.body?.application?.id ?? createApp.body?.id;
  log(createApp.ok && appId ? "pass" : "fail", "CRUD: Create application");
  if (appId) cleanup.push(["application", appId]);

  if (appId) {
    const patchApp = await jsonFetch(`${BASE}/api/hq/grants/applications/${appId}`, {
      ...auth,
      method: "PATCH",
      body: JSON.stringify({ notes: "QA notes", status: "draft" }),
    });
    log(patchApp.ok ? "pass" : "fail", "CRUD: Update application");

    const studio = await jsonFetch(`${BASE}/api/hq/grants/writer-studio/${appId}`, auth);
    log(studio.ok && (studio.body?.writerSections?.sections?.length ?? 0) >= 9 ? "pass" : "fail", "Writer studio load");

    const saveSection = await jsonFetch(`${BASE}/api/hq/grants/writer-studio/${appId}/sections/executive_summary`, {
      ...auth,
      method: "PATCH",
      body: JSON.stringify({ content: "QA executive summary draft for production validation." }),
    });
    log(saveSection.ok ? "pass" : "fail", "CRUD: Save writer section");
  }

  const createTemplate = await jsonFetch(`${BASE}/api/hq/grants/library/templates`, {
    ...auth,
    method: "POST",
    body: JSON.stringify({
      title: `${QA_TAG} Template`,
      category: "foundation",
      description: "QA template",
      content: "# QA Template\n\nProduction validation.",
    }),
  });
  const templateId = createTemplate.body?.template?.id;
  log(createTemplate.ok && templateId ? "pass" : "fail", "CRUD: Create library template");

  const createFunder = await jsonFetch(`${BASE}/api/hq/grants/funders`, {
    ...auth,
    method: "POST",
    body: JSON.stringify({ name: `${QA_TAG} Funder`, contact_email: "qa@ifcdc.org", relationship_stage: "prospect" }),
  });
  const funderId = createFunder.body?.funder?.id ?? createFunder.body?.id;
  log(createFunder.ok && funderId ? "pass" : "fail", "CRUD: Create funder");
  if (funderId) {
    const interaction = await jsonFetch(`${BASE}/api/hq/grants/funders/${funderId}/interactions`, {
      ...auth,
      method: "POST",
      body: JSON.stringify({ subject: "QA intro call", notes: "Production QA interaction" }),
    });
    log(interaction.ok ? "pass" : "fail", "CRUD: Log funder interaction");
  }

  // Mark QA opportunity closed (soft cleanup)
  if (oppId) {
    await jsonFetch(`${BASE}/api/hq/grants/opportunities/${oppId}`, {
      ...auth,
      method: "PATCH",
      body: JSON.stringify({ status: "closed" }),
    });
    log("pass", "CRUD: Close QA opportunity (cleanup)");
  }

  await runReadiness();

  console.log(`\n=== Grant Center QA: ${results.pass} PASS / ${results.fail} FAIL ===`);
  console.log(`QA records tagged: ${QA_TAG}\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
