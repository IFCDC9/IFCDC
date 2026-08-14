#!/usr/bin/env node
/**
 * Phase 8A.5 production acceptance — Evidence Vault population & org readiness.
 *
 * Auth (Phase 6 pattern — no Founder password, no manual JWT paste required):
 *   1. AURA_OPS_VERIFY_TOKEN / IFCDC_AURA_OPS_VERIFY_TOKEN  → X-IFCDC-Ops-Token
 *   2. HQ_TOKEN / FOUNDER_HQ_TOKEN / IFCDC_HQ_TOKEN         → Bearer JWT
 *   3. ~/.ifcdc/hq-bearer.token or ./.hq-bearer.token
 *   4. FOUNDER_OTP_CODE after: node script/phase8a5-evidence-population-verify.mjs --start-otp
 *
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
 *   AURA_OPS_VERIFY_TOKEN='…' \
 *   node script/phase8a5-evidence-population-verify.mjs
 *
 * Does not invent documents, submit grants, or modify Twilio/SMS/voice.
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
const DEST = (process.env.PHASE8A5_OTP_TO || process.env.PHASE6_SMS_TO || "+18484694448").trim();
const START_OTP = process.argv.includes("--start-otp");
const TOKEN_FILE_CANDIDATES = [
  process.env.HQ_TOKEN_FILE,
  resolve(process.cwd(), ".hq-bearer.token"),
  join(homedir(), ".ifcdc", "hq-bearer.token"),
].filter(Boolean);

const results = [];
function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

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

async function api(path, { method = "GET", body, token, opsToken, timeoutMs = 420_000 } = {}) {
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (opsToken) headers["X-IFCDC-Ops-Token"] = opsToken;
  else if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
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

async function startOtp() {
  console.log(`\n=== Phase 8A.5 Founder OTP start (no password) ===`);
  console.log(`Phone: ${DEST}`);
  const start = await api("/api/hq/aura/ops/founder-session/start", {
    method: "POST",
    body: { phone: DEST },
  });
  console.log(`HTTP ${start.status}`, JSON.stringify(start.json, null, 2));
  if (!start.ok) process.exit(1);
  console.log(`\nCheck the Founder phone for the 6-digit code, then run:`);
  console.log(`  FOUNDER_OTP_CODE=###### node script/phase8a5-evidence-population-verify.mjs`);
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

function fmt$(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

async function main() {
  if (START_OTP) {
    await startOtp();
    return;
  }

  console.log(`\n=== Phase 8A.5 Evidence Population acceptance ===`);
  console.log(`Base: ${BASE}`);
  console.log(`Auth: ops token / Founder JWT / phone OTP — password login disabled\n`);

  const ops = (process.env.AURA_OPS_VERIFY_TOKEN || process.env.IFCDC_AURA_OPS_VERIFY_TOKEN || "").trim();
  let auth = resolveAuthMaterial();
  // Prefer ops token over possibly expired local JWT files
  if (ops) {
    auth = { kind: "ops_token", token: ops, source: "AURA_OPS_VERIFY_TOKEN" };
  } else {
    auth = await completeOtpIfNeeded(auth);
  }

  if (!auth) {
    fail(
      "auth",
      "Provide AURA_OPS_VERIFY_TOKEN (Phase 6 ops token), a live Founder JWT, or FOUNDER_OTP_CODE after --start-otp"
    );
    console.error(`\nExamples:`);
    console.error(`  AURA_OPS_VERIFY_TOKEN=… node script/phase8a5-evidence-population-verify.mjs`);
    console.error(`  node script/phase8a5-evidence-population-verify.mjs --start-otp`);
    process.exit(1);
  }

  const tokenOpts =
    auth.kind === "ops_token"
      ? { opsToken: auth.token }
      : { token: auth.token };

  const health = await api("/api/health");
  if (health.ok) pass("health", `commit=${health.json?.commit || "n/a"} auth=${auth.source}`);
  else fail("health", `HTTP ${health.status}`);

  const authCheck = await api("/api/hq/aura/ops/auth-check", { ...tokenOpts });
  if (authCheck.ok && authCheck.json?.authorized) {
    pass("ops auth", `method=${authCheck.json.authMethod || auth.kind}`);
  } else {
    fail("ops auth", `HTTP ${authCheck.status} ${JSON.stringify(authCheck.json).slice(0, 200)}`);
    process.exit(1);
  }

  const acceptance = await api("/api/hq/aura/ops/phase8a5/acceptance", {
    method: "POST",
    body: { limit: 30 },
    ...tokenOpts,
  });

  if (!acceptance.ok || acceptance.json?.phase !== "8A.5") {
    fail("population cycle", `HTTP ${acceptance.status} ${JSON.stringify(acceptance.json).slice(0, 400)}`);
    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== Phase 8A.5 summary: ${results.length - failed.length}/${results.length} passed ===\n`);
    process.exit(1);
  }

  const j = acceptance.json;

  pass(
    "1 hq evidence audit",
    `items=${j.existingEvidenceDiscovery?.itemCount ?? "n/a"} completion=${j.completionPercent}%`
  );
  pass(
    "2 existing evidence discovery",
    `verifiedOrPresent=${j.existingEvidenceDiscovery?.verifiedOrPresent ?? 0}`
  );

  if (Array.isArray(j.founderQueue)) {
    const top = j.handleFirst || j.founderQueue[0];
    pass(
      "3 founder evidence action queue",
      top
        ? `first=${top.label} status=${top.status} blocks=${top.opportunitiesBlocked} ${fmt$(top.addressableValueBlocked)} priority=${top.priority}`
        : "empty (all baseline present)"
    );
  } else fail("3 founder evidence action queue");

  if (j.orgGrantProfile?.profile && Array.isArray(j.orgGrantProfile.verifiedFields)) {
    pass(
      "4 verified-only org grant profile",
      `verified=${j.orgGrantProfile.verifiedFields.length} unknown=${(j.orgGrantProfile.unknownFields || []).length}`
    );
  } else fail("4 verified-only org grant profile");

  if (j.evidenceVerificationRematch?.documentReadinessBatch) {
    const b = j.evidenceVerificationRematch.documentReadinessBatch;
    pass(
      "5-6 verify + rematch / readiness recalc",
      `processed=${b.processed} ready=${b.readyNow} nearly=${b.nearlyReady} needsDocs=${b.needsDocuments}`
    );
  } else fail("5-6 verify + rematch / readiness recalc");

  pass(
    "7 expiration/staleness monitoring",
    `expiringOrExpired=${(j.expirations || []).length}`
  );

  const r = j.readiness || {};
  pass(
    "8 readiness recalculation",
    `READY=${r.readyNowCount}(${fmt$(r.readyNowFunding)}) NEARLY=${r.nearlyReadyCount}(${fmt$(r.nearlyReadyFunding)}) NEEDS_DOCS=${r.needsDocumentsCount} REVIEW=${r.reviewRequiredCount} hardBlockers=${r.hardBlockerOpportunities}`
  );

  const recommended = j.pilots?.recommendedFirstPilot;
  if (j.pilots?.leadSafeExcluded && recommended && !isLeadSafe(recommended.title)) {
    pass("9 Lead-Safe excluded from first pilot", `rejected=${j.pilots?.rejectedPriorPilot?.title || "recorded"}`);
  } else if (!recommended) {
    fail("9 Lead-Safe excluded from first pilot", "no recommended pilot");
  } else {
    fail("9 Lead-Safe excluded from first pilot", `recommended=${recommended?.title}`);
  }

  const top5 = j.pilots?.top5 || [];
  if (top5.length > 0 && top5.every((p) => !isLeadSafe(p.title))) {
    pass("10 Top 5 pilot candidates", top5.map((p) => p.title).join(" | ").slice(0, 220));
  } else fail("10 Top 5 pilot candidates", `count=${top5.length}`);

  if (recommended && recommended.recommendation === "recommended_first_pilot") {
    pass(
      "11 recommended first pilot",
      `"${recommended.title}" · ${recommended.readinessClass} · score=${recommended.applicationReadinessScore} · addressable=${fmt$(recommended.ifcdcAddressableAmount)} · program=${recommended.matchingProgram}`
    );
  } else fail("11 recommended first pilot");

  const asks = j.asks || [];
  if (asks.length >= 4 && asks.every((a) => a.reply && !/^ask failed/i.test(a.reply))) {
    pass("12 AURA evidence/readiness/pilot Q&A", `${asks.length} answers`);
  } else fail("12 AURA evidence/readiness/pilot Q&A", JSON.stringify(asks).slice(0, 240));

  // Human-readable deliverables
  console.log(`\n--- Founder Evidence Action Queue (handle first) ---`);
  if (j.handleFirst) {
    const h = j.handleFirst;
    console.log(
      `#1 ${h.label} [${h.status}] ${h.priority} — blocks ${h.opportunitiesBlocked} opps / ${fmt$(h.addressableValueBlocked)}\n`
        + `   why: ${h.whyNeeded}\n`
        + `   existsInHq=${h.existsElsewhereInHq} auraGenerate=${h.canAuraGenerate} founderUpload=${h.founderMustUpload} thirdParty=${h.thirdPartyRequired}`
    );
  }
  for (const item of (j.founderQueue || []).slice(0, 20)) {
    console.log(
      `${String(item.rank).padStart(2)}. ${item.label} | ${item.status} | ${item.priority} | blocks ${item.opportunitiesBlocked} | ${fmt$(item.addressableValueBlocked)} | upload=${item.founderMustUpload} gen=${item.canAuraGenerate} 3p=${item.thirdPartyRequired} hq=${item.existsElsewhereInHq}`
    );
  }

  console.log(`\n--- Core document status ---`);
  for (const d of j.coreDocumentStatus || []) {
    console.log(
      `${d.label}: ${d.status} | blockedOpps=${d.opportunitiesBlocked} | ${fmt$(d.addressableValueBlocked)} | hqHits=${(d.hqDocumentHits || []).length}`
    );
  }

  console.log(`\n--- Readiness ---`);
  console.log(
    `READY NOW ${r.readyNowCount} / ${fmt$(r.applicationReadyFunding)}\n`
      + `NEARLY READY ${r.nearlyReadyCount} / ${fmt$(r.nearlyReadyFunding)}\n`
      + `NEEDS DOCUMENTS ${r.needsDocumentsCount}\n`
      + `REVIEW REQUIRED ${r.reviewRequiredCount}\n`
      + `Hard blocker opps ${r.hardBlockerOpportunities}`
  );

  console.log(`\n--- Top 5 pilots (Lead-Safe excluded) ---`);
  for (const p of top5) {
    console.log(
      `#${p.pilotRank} ${p.title}\n`
        + `   source=${p.officialSource}\n`
        + `   program=${p.matchingProgram} addressable=${fmt$(p.ifcdcAddressableAmount)} match=${p.opportunityMatchScore} readiness=${p.applicationReadinessScore} (${p.readinessClass})\n`
        + `   deadline=${p.deadline || "n/a"} blockers=${(p.majorBlockers || []).join("; ") || "none listed"}\n`
        + `   missing=${(p.missingEvidence || []).slice(0, 6).join("; ")}\n`
        + `   recommendation=${p.recommendation}`
    );
  }

  console.log(`\n--- Recommended First Pilot ---`);
  console.log(j.pilots?.rationale || recommended?.title || "none");
  console.log(`maySubmit=${j.maySubmit === false ? "false (correct)" : j.maySubmit}`);

  const outPath = resolve(process.cwd(), "tmp-phase8a5-acceptance.json");
  try {
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          commit: health.json?.commit,
          handleFirst: j.handleFirst,
          founderQueue: j.founderQueue,
          coreDocumentStatus: j.coreDocumentStatus,
          readiness: j.readiness,
          pilots: j.pilots,
          asks: j.asks,
          securityBoundary: j.securityBoundary,
        },
        null,
        2
      )
    );
    console.log(`\nWrote ${outPath}`);
  } catch {
    /* ignore */
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Phase 8A.5 summary: ${results.length - failed.length}/${results.length} passed ===\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
