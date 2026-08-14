#!/usr/bin/env node
/**
 * Phase 8A.5 acceptance — Evidence Vault population, Founder queue, next pilots.
 *
 *   HQ_TOKEN=… node script/phase8a5-evidence-population-verify.mjs
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
    signal: AbortSignal.timeout(420_000),
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

function isLeadSafe(title) {
  return /lead[- ]?safe|healthy\s*homes\s*financ/i.test(String(title || ""));
}

async function main() {
  console.log(`\n=== Phase 8A.5 Evidence Population acceptance ===\n${BASE}\n`);
  if (!token) {
    fail("auth", "HQ_TOKEN required");
    process.exit(1);
  }

  const health = await api("/api/health");
  if (health.ok) pass("health", `commit=${health.json?.commit || "n/a"}`);
  else fail("health", `HTTP ${health.status}`);

  const pop = await api("/api/hq/grants/funding-intelligence/evidence-population", {
    method: "POST",
    body: { limit: 30 },
  });
  if (pop.ok && pop.json?.phase === "8A.5") {
    pass(
      "population cycle",
      `completion=${pop.json.completionPercent}% queue=${(pop.json.founderQueue || []).length} processed=${pop.json.documentReadinessBatch?.processed}`
    );
  } else {
    fail("population cycle", `HTTP ${pop.status} ${JSON.stringify(pop.json).slice(0, 320)}`);
  }

  const audit = await api("/api/hq/grants/funding-intelligence/evidence-audit");
  if (audit.ok && Array.isArray(audit.json?.audit?.items) && audit.json.audit.items.length > 0) {
    pass("hq evidence audit", `items=${audit.json.audit.items.length} completion=${audit.json.completion?.percent}%`);
  } else fail("hq evidence audit", `HTTP ${audit.status}`);

  const queue = await api("/api/hq/grants/funding-intelligence/founder-evidence-queue");
  if (queue.ok && Array.isArray(queue.json?.queue)) {
    const top = queue.json.queue[0];
    pass(
      "founder action queue",
      top
        ? `top=${top.label} blocks=${top.opportunitiesBlocked} value=$${Number(top.addressableValueBlocked || 0).toLocaleString()} priority=${top.priority}`
        : "empty queue (all baseline evidence present)"
    );
  } else fail("founder action queue", `HTTP ${queue.status}`);

  const profile = await api("/api/hq/grants/funding-intelligence/org-grant-profile");
  if (profile.ok && profile.json?.profile && Array.isArray(profile.json.verifiedFields)) {
    pass(
      "org grant profile",
      `verified=${profile.json.verifiedFields.length} unknown=${(profile.json.unknownFields || []).length}`
    );
  } else fail("org grant profile", `HTTP ${profile.status}`);

  const pilots = await api("/api/hq/grants/funding-intelligence/select-next-pilots", {
    method: "POST",
    body: {},
  });
  const top5 = pilots.json?.top5 || [];
  const recommended = pilots.json?.recommendedPilot;
  if (pilots.ok && top5.length > 0 && recommended && !isLeadSafe(recommended.title)) {
    pass(
      "next pilots (Lead-Safe excluded)",
      `recommended="${recommended.title}" top5=${top5.length} rejectedPrior=${pilots.json?.rejectedPriorPilot?.title || "n/a"}`
    );
  } else if (pilots.ok && recommended && isLeadSafe(recommended.title)) {
    fail("next pilots (Lead-Safe excluded)", `Lead-Safe still recommended: ${recommended.title}`);
  } else {
    fail("next pilots (Lead-Safe excluded)", `HTTP ${pilots.status} ${JSON.stringify(pilots.json).slice(0, 280)}`);
  }

  const programs = await api("/api/hq/grants/funding-intelligence/program-readiness");
  if (programs.ok && Array.isArray(programs.json?.programs) && programs.json.programs.length > 0) {
    const richest = [...programs.json.programs].sort((a, b) => (b.addressableSum || 0) - (a.addressableSum || 0))[0];
    pass(
      "program readiness view",
      `programs=${programs.json.programs.length} topFunding=${richest?.programLabel} $${Number(richest?.addressableSum || 0).toLocaleString()}`
    );
  } else fail("program readiness view", `HTTP ${programs.status}`);

  const dash = await api("/api/hq/grants/funding-intelligence/dashboard");
  if (dash.ok && dash.json?.phase === "8A.5") {
    const m = dash.json.metrics || {};
    pass(
      "dashboard 8A.5",
      `READY NOW=${m.readyNowCount} NEARLY=${m.nearlyReadyCount} appReady=$${Number(m.applicationReadyFunding || 0).toLocaleString()} vault%=${dash.json.evidencePopulation?.completionPercent ?? "n/a"}`
    );
  } else fail("dashboard 8A.5", `HTTP ${dash.status} phase=${dash.json?.phase}`);

  const askMissing = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "What IFCDC documents are still missing?" },
  });
  if (askMissing.ok && askMissing.json?.reply) pass("ask missing docs", askMissing.json.reply.slice(0, 160));
  else fail("ask missing docs", `HTTP ${askMissing.status}`);

  const askUnlock = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "Which document unlocks the most grant money?" },
  });
  if (askUnlock.ok && askUnlock.json?.reply) pass("ask unlock funding", askUnlock.json.reply.slice(0, 160));
  else fail("ask unlock funding", `HTTP ${askUnlock.status}`);

  const askPilot = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "What is our next best pilot and why did you reject the previous pilot?" },
  });
  if (askPilot.ok && askPilot.json?.reply && !/recommended first pilot now:.*lead-safe/i.test(askPilot.json.reply)) {
    pass("ask next pilot", askPilot.json.reply.slice(0, 180));
  } else fail("ask next pilot", askPilot.json?.reply?.slice(0, 200) || `HTTP ${askPilot.status}`);

  const askReady = await api("/api/hq/grants/funding-intelligence/ask", {
    method: "POST",
    body: { question: "How much application-ready funding do we have?" },
  });
  if (askReady.ok && /application-ready funding/i.test(askReady.json?.reply || "")) {
    pass("ask application-ready $", askReady.json.reply.slice(0, 140));
  } else fail("ask application-ready $", askReady.json?.reply?.slice(0, 200) || `HTTP ${askReady.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Phase 8A.5 summary: ${results.length - failed.length}/${results.length} passed ===\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
