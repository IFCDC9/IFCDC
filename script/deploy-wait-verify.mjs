#!/usr/bin/env node
/**
 * Poll production /api/health until commit matches, then run smoke test.
 * Usage:
 *   IFCDC_EXPECT_COMMIT=d1ed3f4 \
 *   FOUNDER_SEED_PASSWORD=*** \
 *   node script/deploy-wait-verify.mjs
 */
import { spawnSync } from "node:child_process";

const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com";
const EXPECT = (process.env.IFCDC_EXPECT_COMMIT || "").trim();
const TIMEOUT_MS = Number(process.env.IFCDC_DEPLOY_TIMEOUT_MS || 30 * 60 * 1000);
const INTERVAL_MS = Number(process.env.IFCDC_DEPLOY_POLL_MS || 20_000);

if (!EXPECT) {
  console.error("Set IFCDC_EXPECT_COMMIT to the short or full git hash you deployed.");
  process.exit(1);
}

const started = Date.now();
console.log(`\nWaiting for ${BASE} to serve commit ${EXPECT} (timeout ${TIMEOUT_MS / 60000}m)...\n`);

while (Date.now() - started < TIMEOUT_MS) {
  try {
    const res = await fetch(`${BASE}/api/health`);
    const body = await res.json();
    const commit = body?.commit ?? "";
    const live = commit === EXPECT || commit.startsWith(EXPECT.slice(0, 7));
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`[${elapsed}s] status=${body?.status} commit=${commit} ready=${body?.ready}`);
    if (live && body?.status === "healthy" && body?.ready !== false) {
      console.log(`\n✓ Deploy live on ${commit}\n`);
      const smoke = spawnSync(process.execPath, ["script/production-smoke-test.mjs"], {
        cwd: process.cwd(),
        stdio: "inherit",
        env: { ...process.env, IFCDC_BASE_URL: BASE, IFCDC_EXPECT_COMMIT: EXPECT },
      });
      process.exit(smoke.status ?? 1);
    }
  } catch (e) {
    console.log(`poll error: ${e instanceof Error ? e.message : e}`);
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}

console.error(`\n✗ Timed out waiting for commit ${EXPECT}\n`);
process.exit(1);
