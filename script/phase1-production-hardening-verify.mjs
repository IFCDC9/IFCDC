#!/usr/bin/env node
/**
 * Phase 1 production hardening checklist — env vars, health endpoints, demo policy.
 * Usage: IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com node script/phase1-production-hardening-verify.mjs
 */

const base = (process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");

const REQUIRED_ENV = [
  "NODE_ENV",
  "JWT_SECRET",
  "MASTER_OWNER_EMAIL",
  "FOUNDER_SEED_PASSWORD",
  "PUBLIC_APP_URL",
  "IFCDC_DATA_DIR",
];

const RECOMMENDED_ENV = [
  "OPENAI_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "HQ_BARBERS_HEALTH_URL",
  "HQ_SELF_HEALTH_URL",
  "HQ_RADIO_HEALTH_URL",
];

async function fetchJson(path) {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

function warn(msg) {
  console.log(`  ⚠ ${msg}`);
}

function fail(msg) {
  console.log(`  ✗ ${msg}`);
}

async function main() {
  console.log(`\nPhase 1 Production Hardening Verify — ${base}\n`);

  console.log("1. HQ health");
  const health = await fetchJson("/api/health");
  if (health.ok && health.body?.ready) {
    pass(`GET /api/health → ready (${health.body.commit?.slice(0, 7) ?? "unknown commit"})`);
  } else {
    fail(`GET /api/health → ${health.status} ready=${health.body?.ready}`);
  }

  console.log("\n2. Executive overview (must not return seeded demo in production)");
  const exec = await fetchJson("/api/hq/executive/overview");
  if (exec.status === 401) {
    warn("Executive overview requires auth — verify seeded:false in browser after login");
  } else if (exec.body?.seeded === true) {
    fail("Executive overview returned seeded:true — demo fallback still active");
  } else if (exec.ok) {
    pass("Executive overview OK (no seeded flag)");
    const sd = exec.body?.softwareDivision;
    if (sd) {
      pass(`Software division: operational=${sd.operational ?? sd.healthy}/${sd.total}, polled=${sd.polledHealthy ?? "—"}`);
    }
  } else if (exec.status === 503 && exec.body?.liveDataOnly) {
    pass("Executive overview returns 503 on failure (live data only policy)");
  } else {
    warn(`Executive overview → ${exec.status}`);
  }

  console.log("\n3. Static env checklist (set on Render — cannot read secrets from here)");
  for (const key of REQUIRED_ENV) {
    pass(`${key} — required (verify in Render dashboard)`);
  }
  for (const key of RECOMMENDED_ENV) {
    warn(`${key} — recommended for full Phase 1`);
  }
  warn("Set HQ_BARBERS_HEALTH_URL to live IFCDC Barbers /api/health when deployed");

  const barbersUrl = process.env.HQ_BARBERS_HEALTH_URL?.trim();
  if (barbersUrl) {
    console.log("\n4. Barbers health probe");
    try {
      const b = await fetch(barbersUrl, { signal: AbortSignal.timeout(10000) });
      if (b.ok) pass(`Barbers health OK → ${barbersUrl}`);
      else fail(`Barbers health → HTTP ${b.status}`);
    } catch (e) {
      fail(`Barbers health unreachable: ${e instanceof Error ? e.message : e}`);
    }
  } else {
    console.log("\n4. Barbers health probe");
    warn("HQ_BARBERS_HEALTH_URL not set locally — configure on Render");
  }

  console.log("\nDone. Run: npm run hq:production-audit for full route audit.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
