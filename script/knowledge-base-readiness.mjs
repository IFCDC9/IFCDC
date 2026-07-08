#!/usr/bin/env node
/**
 * AURA Knowledge Base — production readiness verification.
 *
 * Usage:
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   FOUNDER_SEED_PASSWORD=*** \
 *   node script/knowledge-base-readiness.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function loadDotEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadDotEnv();

const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com";
const EMAIL = process.env.IFCDC_SUPER_ADMIN_EMAIL || process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org";
const PASSWORD = process.env.IFCDC_SUPER_ADMIN_PASSWORD || process.env.FOUNDER_SEED_PASSWORD || "";
const EXPECT_COMMIT = (process.env.IFCDC_EXPECT_COMMIT || "4707457").trim();

const results = [];

function record(name, ok, detail = "", statusOverride) {
  const status = statusOverride ?? (ok ? "PASS" : "FAIL");
  results.push({ name, status, detail });
  const mark = status === "PASS" ? "✓" : status === "SKIP" ? "○" : "✗";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text?.slice(0, 200) };
  }
  return { res, body };
}

async function login() {
  const { res, body } = await jsonFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!res.ok || !cookie) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
  return cookie;
}

const DEMO_PATTERNS = [
  /lorem ipsum/i,
  /sample grant/i,
  /demo (data|record|workflow|approval)/i,
  /placeholder module/i,
  /enterprise readiness demo/i,
  /fake (deadline|expense|approval)/i,
];

function hasDemoText(text) {
  return DEMO_PATTERNS.some((re) => re.test(String(text ?? "")));
}

async function main() {
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  AURA Knowledge Base — Production Readiness`);
  console.log(`  Target: ${BASE}`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  const health = await jsonFetch(`${BASE}/api/health`);
  const commit = health.body?.commit ?? "?";
  record(
    "Production health",
    health.res.ok && health.body?.status === "healthy",
    `commit=${commit}, ready=${health.body?.ready}`,
  );
  record(
    "Commit deployed",
    commit === EXPECT_COMMIT || commit.startsWith(EXPECT_COMMIT.slice(0, 7)),
    `expected ${EXPECT_COMMIT}`,
  );
  record(
    "OpenAI configured",
    health.body?.integrations?.openai?.configured === true,
    health.body?.integrations?.openai?.source ?? "unknown",
  );

  if (!PASSWORD) {
    record("Auth", false, "Set FOUNDER_SEED_PASSWORD", "SKIP");
    console.log("\n✗ Cannot continue without FOUNDER_SEED_PASSWORD\n");
    process.exit(1);
  }

  let cookie;
  try {
    cookie = await login();
    record("Founder login", true, EMAIL);
  } catch (e) {
    record("Founder login", false, e.message);
    process.exit(1);
  }

  const headers = { Cookie: cookie, "Content-Type": "application/json" };

  // Knowledge routes exist (404 = old deploy)
  const statusRes = await jsonFetch(`${BASE}/api/hq/knowledge/status`, { headers });
  record("KB status endpoint", statusRes.res.ok, `HTTP ${statusRes.res.status}`);
  if (!statusRes.res.ok) {
    console.log("\n✗ Knowledge Base API not available — deploy commit 4707457 first.\n");
    process.exit(1);
  }

  const st = statusRes.body ?? {};
  record("KB has indexed sources", (st.total ?? 0) > 0, `${st.total ?? 0} documents`);
  record("Embeddings configured", st.embeddingsConfigured === true, `${st.embedded ?? 0}/${st.total ?? 0} embedded`);
  record("KB has chunks", (st.chunks ?? 0) > 0, `${st.chunks ?? 0} chunks`);

  const requiredSources = ["org_profile", "program_description", "operating_budget", "registration"];
  const present = new Set((st.bySource ?? []).map((s) => s.source_type));
  for (const src of requiredSources) {
    record(`Source: ${src}`, present.has(src), present.has(src) ? "indexed" : "missing — run Reindex");
  }

  // Reindex from HQ
  console.log("\n── Running knowledge sync (Reindex from HQ) ──");
  const syncRes = await jsonFetch(`${BASE}/api/hq/knowledge/sync`, {
    method: "POST",
    headers,
    body: JSON.stringify({ embed: true }),
  });
  const sync = syncRes.body ?? {};
  record(
    "Reindex completes",
    syncRes.res.ok && typeof sync.ingested === "number",
    syncRes.res.ok ? `ingested ${sync.ingested}, skipped ${sync.skipped}` : `HTTP ${syncRes.res.status}`,
  );

  // Re-check status after sync
  const statusAfter = await jsonFetch(`${BASE}/api/hq/knowledge/status`, { headers });
  const after = statusAfter.body ?? {};
  record("Post-sync total sources", (after.total ?? 0) >= (st.total ?? 0), `${after.total ?? 0} documents`);

  // Semantic search
  const searchRes = await jsonFetch(`${BASE}/api/hq/knowledge/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: "IFCDC organizational mission programs budget SAM.gov registration", topK: 5 }),
  });
  const hits = searchRes.body?.results ?? [];
  record("Semantic search returns results", searchRes.res.ok && hits.length > 0, `${hits.length} hits`);
  if (hits.length) {
    const grounded = hits.some((h) =>
      /ifcdc|mission|program|budget|sam|501|nonprofit|asbury/i.test(`${h.title} ${h.content}`)
    );
    record("Search results are IFCDC-grounded", grounded, hits[0]?.title ?? "");
    record("No demo text in search hits", !hits.some((h) => hasDemoText(h.content)), "");
  }

  // List documents — no demo
  const listRes = await jsonFetch(`${BASE}/api/hq/knowledge/documents`, { headers });
  const docs = listRes.body?.documents ?? [];
  record("Knowledge list API", listRes.res.ok, `${docs.length} rows`);
  record("No demo knowledge records", !docs.some((d) => hasDemoText(d.title) || hasDemoText(d.summary)), "");

  // Workflow dashboard — no demo approvals
  const wfRes = await jsonFetch(`${BASE}/api/hq/workflows/dashboard`, { headers });
  const approvals = wfRes.body?.approvalQueue ?? wfRes.body?.approvals ?? [];
  const approvalText = JSON.stringify(approvals);
  record("Workflow: no demo approvals", !hasDemoText(approvalText), `${Array.isArray(approvals) ? approvals.length : 0} items`);

  // Grant writer context check via AURA command
  const auraRes = await jsonFetch(`${BASE}/api/hq/aura/action/knowledge_lookup`, {
    method: "POST",
    headers,
    body: JSON.stringify({ args: { query: "What is IFCDC mission and operating budget?" }, module: "grants" }),
  });
  const auraReply = auraRes.body?.reply ?? "";
  record("AURA knowledge_lookup", auraRes.res.ok && auraReply.length > 40, `${auraReply.length} chars`);
  record(
    "AURA references real org data",
    /ifcdc|mission|program|budget|nonprofit|community development/i.test(auraReply),
    "",
  );
  record("AURA reply has no demo placeholders", !hasDemoText(auraReply), "");

  // AURA actions catalog includes knowledge_lookup
  const actionsRes = await jsonFetch(`${BASE}/api/hq/aura/actions`, { headers });
  const actions = actionsRes.body?.actions ?? [];
  record(
    "AURA actions catalog",
    actionsRes.res.ok && actions.some((a) => a.id === "knowledge_lookup"),
    `${actions.length} actions`,
  );

  // SPA route
  const spaRes = await fetch(`${BASE}/hq/knowledge`, { redirect: "follow" });
  const spaText = await spaRes.text();
  record(
    "Knowledge Base SPA route",
    spaRes.ok && spaText.includes('id="root"') && !/coming soon|placeholder module/i.test(spaText),
    String(spaRes.status),
  );

  // Document auto-index: ingest test record then verify
  const testTitle = `KB Auto-Index Verification ${Date.now()}`;
  const ingestRes = await jsonFetch(`${BASE}/api/hq/knowledge/documents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sourceType: "annual_report",
      title: testTitle,
      content: `IFCDC annual report verification excerpt. Operating budget alignment test ${Date.now()}.`,
      effectiveDate: new Date().toISOString().slice(0, 10),
    }),
  });
  record("Manual KB ingest API", ingestRes.res.ok, ingestRes.body?.status ?? `HTTP ${ingestRes.res.status}`);

  const searchNew = await jsonFetch(`${BASE}/api/hq/knowledge/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: testTitle, topK: 3 }),
  });
  const foundNew = (searchNew.body?.results ?? []).some((r) => r.title === testTitle);
  record("Uploaded content retrievable", foundNew, foundNew ? "found in search" : "not found yet");

  const fail = results.filter((r) => r.status === "FAIL").length;
  const pass = results.filter((r) => r.status === "PASS").length;
  const skip = results.filter((r) => r.status === "SKIP").length;

  console.log(`\n── SUMMARY (${pass} PASS / ${fail} FAIL / ${skip} SKIP) ──`);
  for (const r of results) {
    console.log(`${r.status.padEnd(6)} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\nLive commit: ${commit}`);
  console.log(`Deployment URL: ${BASE}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
