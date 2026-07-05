#!/usr/bin/env node
/**
 * Production deployment alignment — publish local main to GitHub and verify Render.
 *
 * Run from your machine (requires GitHub auth):
 *   cd Apps/IMPERIAL-FOUNDATION-CDC
 *   node script/publish-production-alignment.mjs
 *
 * Optional env:
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com
 *   IFCDC_EXPECT_COMMIT=4d23e72
 *   SKIP_PUSH=1          — verify only, do not push
 *   SKIP_RENDER_WAIT=1   — skip polling after push
 */
import { spawnSync } from "node:child_process";

const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com";
const EXPECT = (process.env.IFCDC_EXPECT_COMMIT || "ef1d39a").trim();
const SKIP_PUSH = process.env.SKIP_PUSH === "1";
const SKIP_RENDER_WAIT = process.env.SKIP_RENDER_WAIT === "1";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || ""), status: r.status ?? 1 };
}

function shortSha(sha) {
  return (sha || "").slice(0, 7);
}

async function githubMainSha() {
  const res = await fetch("https://api.github.com/repos/IFCDC9/IFCDC/commits/main");
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const body = await res.json();
  return body.sha || "";
}

async function healthCommit() {
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, commit: body.commit || "?", status: body.status, ready: body.ready, body };
}

console.log("\n═══════════════════════════════════════════════════════");
console.log("  IFCDC HQ — PRODUCTION DEPLOYMENT ALIGNMENT");
console.log("═══════════════════════════════════════════════════════\n");

const local = run("git", ["rev-parse", "HEAD"]);
const localSha = local.out.trim();
console.log(`Local HEAD:     ${shortSha(localSha)} (${localSha})`);
console.log(`Expected live:  ${EXPECT}`);

let remoteSha = "";
try {
  remoteSha = await githubMainSha();
  console.log(`GitHub main:    ${shortSha(remoteSha)} (${remoteSha})`);
} catch (e) {
  console.log(`GitHub main:    ERROR — ${e.message}`);
}

const live = await healthCommit();
console.log(`Render /health: ${live.commit} (status=${live.status}, ready=${live.ready})\n`);

const localOk = shortSha(localSha) === shortSha(EXPECT) || localSha.startsWith(EXPECT);
const githubOk = shortSha(remoteSha) === shortSha(EXPECT) || remoteSha.startsWith(EXPECT);
const renderOk = live.commit === shortSha(EXPECT) || live.commit.startsWith(shortSha(EXPECT));

console.log("── Alignment checks ──");
console.log(`${localOk ? "✓" : "✗"} Local HEAD matches expected commit`);
console.log(`${githubOk ? "✓" : "✗"} GitHub origin/main matches expected commit`);
console.log(`${renderOk ? "✓" : "✗"} Render /api/health matches expected commit`);

if (!githubOk) {
  console.log("\n── ROOT CAUSE ──");
  console.log("GitHub origin/main does NOT have the latest commits.");
  console.log("Render is correctly serving whatever GitHub main contains.");
  console.log("Push local main to origin/main, then Manual Deploy on Render.\n");

  if (!SKIP_PUSH) {
    console.log("── Pushing origin main ──");
    const push = run("git", ["push", "origin", "main:main"], { stdio: "inherit" });
    if (!push.ok) {
      console.error("\n✗ git push failed. Run manually:\n");
      console.error("  cd ~/Development/IFCDC/Apps/IMPERIAL-FOUNDATION-CDC");
      console.error("  git push origin main:main\n");
      console.error("Then Render Dashboard → ifcdc-hq → Manual Deploy → main → latest commit.\n");
      process.exit(1);
    }
    remoteSha = await githubMainSha();
    console.log(`\n✓ Pushed. GitHub main is now ${shortSha(remoteSha)}\n`);
  } else {
    console.log("\nSKIP_PUSH=1 — run: git push origin main:main\n");
    process.exit(1);
  }
}

if (!renderOk) {
  console.log("\n── Render deploy required ──");
  console.log("1. Render Dashboard → ifcdc-hq");
  console.log("2. Cancel any stuck/in-progress deployment");
  console.log("3. Settings → Build & Deploy:");
  console.log("   Repository: IFCDC9/IFCDC");
  console.log("   Branch: main");
  console.log("   Root Directory: (blank)");
  console.log("   Build: npm ci --include=dev && node script/render-build.mjs");
  console.log("4. Manual Deploy → Deploy latest commit");
  console.log(`5. Confirm deploy log shows: Checking out commit ${shortSha(remoteSha || EXPECT)}...\n`);

  if (!SKIP_RENDER_WAIT) {
    console.log("── Waiting for Render Live ──");
    const wait = spawnSync(process.execPath, ["script/deploy-wait-verify.mjs"], {
      stdio: "inherit",
      env: { ...process.env, IFCDC_BASE_URL: BASE, IFCDC_EXPECT_COMMIT: EXPECT },
    });
    process.exit(wait.status ?? 1);
  }
  process.exit(1);
}

console.log("\n✓ Production aligned on", live.commit);
console.log("\nRun full smoke test:");
console.log(`  IFCDC_BASE_URL=${BASE} IFCDC_EXPECT_COMMIT=${EXPECT} FOUNDER_SEED_PASSWORD=<Render> npm run hq:production-smoke\n`);
process.exit(0);
