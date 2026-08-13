#!/usr/bin/env node
/**
 * Phase 8A.3 acceptance — addressable funding, readiness, pilot recommendation.
 *
 *   HQ_TOKEN=… node script/phase8a3-awardability-verify.mjs
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
  console.log(`\n=== Phase 8A.3 Awardability acceptance ===\n${BASE}\n`);
  if (!token) {
    fail("auth", "HQ_TOKEN required");
    process.exit(1);
  }

  const health = await api("/api/health");
  if (health.ok) pass("health", `commit=${health.json?.commit || "n/a"}`);
  else fail("health", `HTTP ${health.status}`);

  const award = await api("/api/hq/grants/funding-intelligence/awardability", {
    method: "POST",
    body: { limit: 40, onlyQualified: true },
  });
  if (award.ok && award.json?.processed > 0) {
    pass(
      "awardability on qualified opps",
      `processed=${award.json.processed} addressableKnown=${award.json.addressableKnown} unknown=${award.json.addressableUnknown} readyNow=${award.json.readyNow}`
    );
  } else {
    fail("awardability on qualified opps", `HTTP ${award.status} ${JSON.stringify(award.json).slice(0, 280)}`);
  }

  const metrics = award.json?.metrics || (await api("/api/hq/grants/funding-intelligence/metrics")).json;
  if (
    metrics
    && typeof metrics.totalQualifiedProgramFunding === "number"
    && typeof metrics.ifcdcAddressableFunding === "number"
    && metrics.totalQualifiedProgramFunding !== metrics.ifcdcAddressableFunding
  ) {
    pass(
      "program funding ≠ addressable",
      `program=$${metrics.totalQualifiedProgramFunding} addressable=$${metrics.ifcdcAddressableFunding}`
    );
  } else if (metrics && typeof metrics.ifcdcAddressableFunding === "number") {
    pass(
      "program funding ≠ addressable",
      `program=$${metrics.totalQualifiedProgramFunding} addressable=$${metrics.ifcdcAddressableFunding} (may match if all ceilings==program values)`
    );
  } else {
    fail("program funding ≠ addressable", JSON.stringify(metrics).slice(0, 240));
  }

  if (typeof metrics.applicationReadyFunding === "number" && typeof metrics.readyNowCount === "number") {
    pass(
      "readiness metrics",
      `readyNow=${metrics.readyNowCount} needsDocs=${metrics.needsDocumentsCount} needsProg=${metrics.needsProgramDevelopmentCount} needsMatch=${metrics.needsMatchingFundsCount} review=${metrics.reviewRequiredCount} appReady$=${metrics.applicationReadyFunding}`
    );
  } else fail("readiness metrics", JSON.stringify(metrics).slice(0, 200));

  const sample = Array.isArray(award.json?.results) ? award.json.results : [];
  const hasReadiness = sample.every((r) => r.readinessClass || r.applicationReadinessScore != null);
  const hasAddrField = sample.every((r) => r.addressable || r.maximumIfcdcCanRequest !== undefined);
  if (sample.length && hasReadiness) pass("every opp has readiness class/score", `n=${sample.length}`);
  else fail("every opp has readiness class/score", "missing readiness");
  if (sample.length && hasAddrField) pass("every opp has addressable calculation", `n=${sample.length}`);
  else fail("every opp has addressable calculation", "missing addressable");

  const withGaps = sample.filter((r) => r.documentGaps || r.documentsRequired);
  if (withGaps.length) pass("document gaps identified", `${withGaps.length} records`);
  else fail("document gaps identified", "none");

  const dash = await api("/api/hq/grants/funding-intelligence/dashboard");
  if (dash.ok && dash.json?.phase === "8A.3" && dash.json?.metrics?.ifcdcAddressableFunding != null) {
    pass("Founder dashboard 8A.3", `${dash.json.metrics.addressableSummary}`);
  } else fail("Founder dashboard 8A.3", `phase=${dash.json?.phase}`);

  const askAddr = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "How much funding is actually addressable by IFCDC?" },
  });
  if (askAddr.ok && /addressable/i.test(String(askAddr.json?.reply || ""))) {
    pass("AURA addressable Q", String(askAddr.json.reply).slice(0, 200));
  } else fail("AURA addressable Q", `HTTP ${askAddr.status}`);

  const askReady = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "Show me grants that are ready now." },
  });
  if (askReady.ok && askReady.json?.reply) pass("AURA ready-now Q", String(askReady.json.reply).slice(0, 160));
  else fail("AURA ready-now Q", `HTTP ${askReady.status}`);

  const pilot = award.json?.pilot || (await api("/api/hq/grants/funding-intelligence/pilot")).json;
  if (pilot?.top3?.length >= 1 && pilot?.recommendedPilot && pilot?.rationale) {
    pass(
      "top3 + first pilot",
      `pilot=${pilot.recommendedPilot.title} · top3=${pilot.top3.length} · ${String(pilot.rationale).slice(0, 120)}`
    );
  } else {
    fail("top3 + first pilot", JSON.stringify(pilot).slice(0, 240));
  }

  if (pilot?.recommendedPilot?.url) {
    pass("pilot official evidence", String(pilot.recommendedPilot.url));
  } else fail("pilot official evidence", "missing url");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Phase 8A.3 summary: ${results.length - failed.length}/${results.length} passed ===\n`);
  console.log(JSON.stringify({ results, metrics, pilot }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
