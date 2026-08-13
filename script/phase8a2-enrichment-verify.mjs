#!/usr/bin/env node
/**
 * Phase 8A.2 acceptance — enrichment, UNKNOWN funding, program match, verified pipeline.
 *
 *   HQ_TOKEN=… node script/phase8a2-enrichment-verify.mjs
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
    signal: AbortSignal.timeout(300_000),
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
  console.log(`\n=== Phase 8A.2 Enrichment & Mission Matching acceptance ===\n${BASE}\n`);
  if (!token) {
    fail("auth", "HQ_TOKEN or ~/.ifcdc/hq-bearer.token required");
    process.exit(1);
  }

  const health = await api("/api/health");
  if (health.ok) pass("health", `commit=${health.json?.commit || "n/a"}`);
  else fail("health", `HTTP ${health.status}`);

  const profiles = await api("/api/hq/grants/funding-intelligence/program-profiles");
  if (profiles.ok && (profiles.json?.profiles?.length || 0) >= 7) {
    pass("IFCDC program profiles", profiles.json.profiles.map((p) => p.slug).join(", "));
  } else fail("IFCDC program profiles", `HTTP ${profiles.status} count=${profiles.json?.profiles?.length}`);

  const scan = await api("/api/hq/grants/funding-intelligence/scan", {
    method: "POST",
    body: { providers: ["grants_gov"], limitQualify: 25 },
  });
  if (scan.ok && (scan.json?.qualified > 0 || scan.json?.sample?.length > 0)) {
    pass(
      "live scan + enrichment path",
      `ingested≈${scan.json.ingested} qualified=${scan.json.qualified}`
    );
  } else {
    fail("live scan + enrichment path", `HTTP ${scan.status} ${JSON.stringify(scan.json).slice(0, 280)}`);
  }

  const sample = Array.isArray(scan.json?.sample) ? scan.json.sample : [];
  const statuses = sample.map((s) => s.funding_amount_status || s.fundingAmountStatus).filter(Boolean);
  const hasUnknown = statuses.some((s) => s === "unknown");
  const hasVerifiedOrPartial = statuses.some((s) => s === "verified" || s === "partial");
  const coercedZero = sample.some(
    (s) =>
      (s.funding_amount_status === "unknown" || s.fundingAmountStatus === "unknown")
      && Number(s.pipelineValue) === 0
      && s.pipelineValue !== null
      && s.pipelineValue !== undefined
  );
  if (statuses.length) {
    pass(
      "funding confidence on sample",
      `statuses=[${statuses.slice(0, 8).join(",")}] verified/partial=${hasVerifiedOrPartial} unknown=${hasUnknown}`
    );
  } else {
    fail("funding confidence on sample", "no funding_amount_status on sample");
  }
  if (!coercedZero) pass("UNKNOWN not coerced to $0 pipelineValue", "sample pipelineValue null/absent for unknown");
  else fail("UNKNOWN not coerced to $0 pipelineValue", "pipelineValue===0 on unknown rows");

  const metrics = scan.json?.metrics || (await api("/api/hq/grants/funding-intelligence/metrics")).json;
  if (
    metrics
    && typeof metrics.verifiedQualifiedPipelineValue === "number"
    && typeof metrics.unknownValueQualifiedCount === "number"
    && metrics.pipelineSummary
  ) {
    pass(
      "verified pipeline + unknown count",
      metrics.pipelineSummary
    );
  } else {
    fail("verified pipeline + unknown count", JSON.stringify(metrics).slice(0, 240));
  }

  // If scan used only enriched-new rows, force enrich on recent eligibility-tagged set
  const enrich = await api("/api/hq/grants/funding-intelligence/enrich", {
    method: "POST",
    body: { limit: 20, onlyUnenriched: false },
  });
  if (enrich.ok && enrich.json?.enriched >= 0) {
    pass(
      "enrich existing opportunities",
      `enriched=${enrich.json.enriched} verified=${enrich.json.verifiedFunding} unknown=${enrich.json.unknownFunding}`
    );
  } else {
    fail("enrich existing opportunities", `HTTP ${enrich.status} ${JSON.stringify(enrich.json).slice(0, 200)}`);
  }

  const dash = await api("/api/hq/grants/funding-intelligence/dashboard");
  if (dash.ok && dash.json?.phase === "8A.2" && dash.json?.metrics?.unknownValueQualifiedCount != null) {
    pass(
      "Founder dashboard 8A.2 metrics",
      `phase=${dash.json.phase} ${dash.json.metrics.pipelineSummary}`
    );
  } else {
    fail("Founder dashboard 8A.2 metrics", `HTTP ${dash.status} phase=${dash.json?.phase}`);
  }

  const askProgram = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "Which grants fit the Anti-Gang Program?" },
  });
  if (askProgram.ok && askProgram.json?.reply) {
    pass("AURA program match query", String(askProgram.json.reply).slice(0, 180));
  } else fail("AURA program match query", `HTTP ${askProgram.status}`);

  const askVerified = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "How much verified funding have you found?" },
  });
  if (askVerified.ok && /verified|UNKNOWN|unknown/i.test(String(askVerified.json?.reply || ""))) {
    pass("AURA verified funding query", String(askVerified.json.reply).slice(0, 180));
  } else fail("AURA verified funding query", `HTTP ${askVerified.status}`);

  const askUnknown = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "How many qualified grants have unknown award amounts?" },
  });
  if (askUnknown.ok && askUnknown.json?.reply) {
    pass("AURA unknown-value query", String(askUnknown.json.reply).slice(0, 160));
  } else fail("AURA unknown-value query", `HTTP ${askUnknown.status}`);

  const topId =
    askProgram.json?.records?.[0]?.id
    || dash.json?.priorityOpportunities?.[0]?.id
    || sample[0]?.id;
  if (topId) {
    const explain = await api(`/api/hq/grants/funding-intelligence/opportunities/${topId}/explain`);
    if (
      explain.ok
      && explain.json?.officialSource?.url
      && (explain.json?.matches?.length >= 0 || explain.json?.score)
    ) {
      pass(
        "score explanation + official source",
        `id=${topId} url=${explain.json.officialSource.url} funding=${explain.json.officialSource.fundingAmountStatus}`
      );
    } else {
      fail("score explanation + official source", `HTTP ${explain.status}`);
    }
  } else {
    fail("score explanation + official source", "no opportunity id available");
  }

  const scored = sample.some(
    (s) => typeof s.enriched_final_score === "number" || typeof s.qualification_score === "number"
  );
  const prelim = sample.some((s) => s.preliminary_score != null || s.enriched_final_score != null);
  if (scored) pass("enriched final scores present", sample.map((s) => s.enriched_final_score ?? s.qualification_score).slice(0, 5).join(", "));
  else fail("enriched final scores present", "missing scores");
  if (prelim) pass("preliminary vs enriched stored", "preliminary_score and/or enriched_final_score on sample");
  else fail("preliminary vs enriched stored", "missing preliminary/enriched fields");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Phase 8A.2 summary: ${results.length - failed.length}/${results.length} passed ===\n`);
  console.log(
    JSON.stringify(
      {
        results,
        metrics: dash.json?.metrics || metrics,
        sample: sample.slice(0, 4),
      },
      null,
      2
    )
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
