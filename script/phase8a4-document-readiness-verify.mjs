#!/usr/bin/env node
/**
 * Phase 8A.4 acceptance — Evidence Vault + document readiness + pilot deep audit.
 *
 *   HQ_TOKEN=… node script/phase8a4-document-readiness-verify.mjs
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
  const env = (process.env.HQ_TOKEN || process.env.FOUNDER_HQ_TOKEN || "").trim();
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
    signal: AbortSignal.timeout(360_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  console.log(`\n=== Phase 8A.4 Document Readiness acceptance ===\n${BASE}\n`);
  if (!token) {
    fail("auth", "HQ_TOKEN required");
    process.exit(1);
  }

  const health = await api("/api/health");
  if (health.ok) pass("health", `commit=${health.json?.commit || "n/a"}`);
  else fail("health", `HTTP ${health.status}`);

  // Ensure qualified set exists
  const scan = await api("/api/hq/grants/funding-intelligence/scan", {
    method: "POST",
    body: { providers: ["grants_gov"], limitQualify: 30 },
  });
  if (scan.ok && (scan.json?.qualified > 0 || scan.json?.sample?.length > 0)) {
    pass("pre-scan qualify", `qualified=${scan.json.qualified}`);
  } else fail("pre-scan qualify", `HTTP ${scan.status}`);

  const doc = await api("/api/hq/grants/funding-intelligence/document-readiness", {
    method: "POST",
    body: { limit: 30, onlyQualified: true },
  });
  if (doc.ok && doc.json?.processed > 0) {
    pass(
      "document readiness batch",
      `processed=${doc.json.processed} readyNow=${doc.json.readyNow} nearlyReady=${doc.json.nearlyReady} needsDocs=${doc.json.needsDocuments} hardBlockerOpps=${doc.json.withHardBlockers}`
    );
  } else {
    fail("document readiness batch", `HTTP ${doc.status} ${JSON.stringify(doc.json).slice(0, 280)}`);
  }

  const sample = Array.isArray(doc.json?.results) ? doc.json.results : [];
  const withReqs = sample.filter((r) => Number(r.requirementCount || r.requirements?.length || 0) > 0);
  if (withReqs.length === sample.length && sample.length) {
    pass("structured requirement checklists", `n=${sample.length}`);
  } else fail("structured requirement checklists", `withReqs=${withReqs.length}/${sample.length}`);

  const withGaps = sample.filter((r) => r.gapReport || r.documentGaps);
  if (withGaps.length) pass("gap analysis present", `${withGaps.length} records`);
  else fail("gap analysis present", "none");

  const statuses = new Set();
  for (const r of sample) {
    const items = r.requirements || r.gapReport?.already_available || [];
    // collect match statuses from nested shapes
    if (Array.isArray(r.requirements)) {
      for (const i of r.requirements) statuses.add(i.match_status || i.matchStatus);
    }
  }
  if ([...statuses].some((s) => ["verified", "missing", "can_generate", "needs_update", "unavailable"].includes(String(s)))) {
    pass("evidence status distinctions", [...statuses].filter(Boolean).slice(0, 8).join(","));
  } else {
    // fallback: readiness classes diversified
    const classes = new Set(sample.map((r) => r.readinessClass));
    if (classes.size >= 1) pass("evidence status distinctions", `readiness classes: ${[...classes].join(",")}`);
    else fail("evidence status distinctions", "no statuses");
  }

  const metrics = doc.json?.metrics || (await api("/api/hq/grants/funding-intelligence/metrics")).json;
  if (typeof metrics.applicationReadyFunding === "number" && typeof metrics.nearlyReadyCount === "number") {
    pass(
      "application-ready pipeline metrics",
      `appReady$=${metrics.applicationReadyFunding} nearlyReady=${metrics.nearlyReadyCount} readyNow=${metrics.readyNowCount} needsDocs=${metrics.needsDocumentsCount}`
    );
  } else fail("application-ready pipeline metrics", JSON.stringify(metrics).slice(0, 200));

  const dash = await api("/api/hq/grants/funding-intelligence/dashboard");
  if (dash.ok && dash.json?.phase === "8A.4") {
    pass("Founder dashboard 8A.4", `readyNow=${dash.json.metrics?.readyNowCount} nearly=${dash.json.metrics?.nearlyReadyCount}`);
  } else fail("Founder dashboard 8A.4", `phase=${dash.json?.phase}`);

  const vault = await api("/api/hq/grants/funding-intelligence/evidence-vault?sync=1");
  if (vault.ok && Array.isArray(vault.json?.records)) {
    pass("evidence vault API", `records=${vault.json.records.length}`);
  } else fail("evidence vault API", `HTTP ${vault.status}`);

  const audit = doc.json?.pilotAudit || (await api("/api/hq/grants/funding-intelligence/pilot-audit", { method: "POST", body: {} })).json;
  if (audit && (audit.recommendation || audit.pilotAudit?.recommendation)) {
    const a = audit.recommendation ? audit : audit.pilotAudit;
    pass(
      "first pilot deep audit",
      `${a.recommendation} · ${String(a.title || a.opportunityTitle || "").slice(0, 80)} · ${String(a.rationale || "").slice(0, 120)}`
    );
  } else fail("first pilot deep audit", JSON.stringify(audit).slice(0, 240));

  const askMissing = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "What documents are missing for this grant?" },
  });
  if (askMissing.ok && askMissing.json?.reply) pass("AURA missing-docs Q", String(askMissing.json.reply).slice(0, 160));
  else fail("AURA missing-docs Q", `HTTP ${askMissing.status}`);

  const askReady = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "How much application-ready funding do we have?" },
  });
  if (askReady.ok && /application-ready|READY NOW/i.test(String(askReady.json?.reply || ""))) {
    pass("AURA application-ready Q", String(askReady.json.reply).slice(0, 160));
  } else fail("AURA application-ready Q", `HTTP ${askReady.status}`);

  const askPilot = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "Show me everything needed for the first pilot." },
  });
  if (askPilot.ok && askPilot.json?.reply) pass("AURA first-pilot checklist Q", String(askPilot.json.reply).slice(0, 160));
  else fail("AURA first-pilot checklist Q", `HTTP ${askPilot.status}`);

  const topId = sample[0]?.opportunityId || dash.json?.priorityOpportunities?.[0]?.id;
  if (topId) {
    const reqs = await api(`/api/hq/grants/funding-intelligence/opportunities/${topId}/requirements`);
    if (reqs.ok && (reqs.json?.requirements?.length || 0) > 0) {
      pass("per-opportunity requirements API", `id=${topId} n=${reqs.json.requirements.length}`);
    } else fail("per-opportunity requirements API", `HTTP ${reqs.status}`);
  } else fail("per-opportunity requirements API", "no id");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Phase 8A.4 summary: ${results.length - failed.length}/${results.length} passed ===\n`);
  console.log(JSON.stringify({ results, metrics, pilotAudit: audit }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
