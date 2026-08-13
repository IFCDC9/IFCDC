#!/usr/bin/env node
/**
 * Phase 8A acceptance — live Funding Intelligence scan.
 *
 *   HQ_TOKEN=… node script/phase8a-funding-intelligence-verify.mjs
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
    signal: AbortSignal.timeout(180_000),
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
  console.log(`\n=== Phase 8A Funding Intelligence acceptance ===\n${BASE}\n`);
  if (!token) {
    fail("auth", "HQ_TOKEN or ~/.ifcdc/hq-bearer.token required");
    process.exit(1);
  }

  const health = await api("/api/health");
  if (health.ok) pass("health", `commit=${health.json?.commit || "n/a"}`);
  else fail("health", `HTTP ${health.status}`);

  const scan = await api("/api/hq/grants/funding-intelligence/scan", {
    method: "POST",
    body: { providers: ["grants_gov"], limitQualify: 60 },
  });
  if (scan.ok && (scan.json?.qualified > 0 || scan.json?.ingested > 0 || scan.json?.sample?.length > 0)) {
    pass(
      "live official scan + normalize",
      `ingested≈${scan.json.ingested} qualified=${scan.json.qualified} dupes=${scan.json.duplicatesMerged} feeds=${JSON.stringify(scan.json.feedResults?.map((f) => f.provider + ":" + f.status))}`
    );
  } else {
    fail("live official scan + normalize", `HTTP ${scan.status} ${JSON.stringify(scan.json).slice(0, 300)}`);
  }

  const sample = Array.isArray(scan.json?.sample) ? scan.json.sample : [];
  const withSource = sample.filter((s) => s.url && s.source_type);
  if (withSource.length) pass("official source traceable", `${withSource.length} sample rows with url+source_type`);
  else fail("official source traceable", "no sample with source URL");

  const metrics = scan.json?.metrics || (await api("/api/hq/grants/funding-intelligence/metrics")).json;
  if (metrics && typeof metrics.qualifiedIfcdcFunding === "number") {
    pass(
      "pipeline metrics from records",
      `discovered=${metrics.totalOpportunitiesDiscovered} qualified$=${metrics.qualifiedIfcdcFunding} priority$=${metrics.priorityPipelineValue}`
    );
  } else fail("pipeline metrics from records", JSON.stringify(metrics).slice(0, 200));

  const dash = await api("/api/hq/grants/funding-intelligence/dashboard");
  if (dash.ok && dash.json?.metrics) pass("Founder dashboard API", `priorityOpps=${dash.json.priorityOpportunities?.length ?? 0}`);
  else fail("Founder dashboard API", `HTTP ${dash.status}`);

  const ask = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "Show me our highest-value qualified funding opportunities." },
  });
  if (ask.ok && ask.json?.reply) pass("AURA answer from stored opps", String(ask.json.reply).slice(0, 160));
  else fail("AURA answer from stored opps", `HTTP ${ask.status}`);

  const action = await api("/api/hq/aura/action/funding_intelligence_ask", {
    method: "POST",
    body: { args: { question: "What grant deadlines are coming up?" } },
  });
  if (action.ok) pass("AURA action funding_intelligence_ask", action.json?.actions?.[0]?.summary?.slice(0, 120) || "ok");
  else fail("AURA action funding_intelligence_ask", `HTTP ${action.status}`);

  const elig = sample.some((s) => s.eligibility_result);
  const scored = sample.some((s) => typeof s.qualification_score === "number");
  if (elig) pass("eligibility evaluated", sample.map((s) => s.eligibility_result).slice(0, 5).join(", "));
  else fail("eligibility evaluated", "missing eligibility_result on sample");
  if (scored) pass("scores calculated", sample.map((s) => s.qualification_score).slice(0, 5).join(", "));
  else fail("scores calculated", "missing qualification_score");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Phase 8A summary: ${results.length - failed.length}/${results.length} passed ===\n`);
  console.log(JSON.stringify({ results, sample: sample.slice(0, 5), metrics }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
