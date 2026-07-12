#!/usr/bin/env node
/**
 * IFCDC HQ — Build 58 Enterprise Production Verify
 * Orchestrates static certification gates + optional live readiness.
 *
 * Usage:
 *   npm run enterprise:verify
 *   IFCDC_BASE_URL=https://… FOUNDER_SEED_PASSWORD=… npm run enterprise:verify
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const BASE = process.env.IFCDC_BASE_URL || "";

function run(label, cmd, args, opts = {}) {
  console.log(`\n── ${label} ──`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    ...opts,
  });
  if (result.status !== 0) {
    console.error(`✗ ${label} failed (exit ${result.status ?? "?"})`);
    return false;
  }
  console.log(`✓ ${label}`);
  return true;
}

console.log(`\n═══════════════════════════════════════════════════════`);
console.log(`  IFCDC HQ — BUILD 58 ENTERPRISE PRODUCTION VERIFY`);
console.log(`═══════════════════════════════════════════════════════`);

let ok = true;

ok = run("TypeScript check", "npx", ["tsc", "--noEmit"]) && ok;
ok = run("Client production build", "npm", ["run", "build:client"]) && ok;

if (BASE) {
  ok = run("HQ navigation audit", "node", ["script/hq-nav-audit.mjs"]) && ok;
  ok = run("Full production audit", "node", ["script/hq-full-production-audit.mjs"]) && ok;
  if (process.env.FOUNDER_SEED_PASSWORD) {
    ok = run("Enterprise readiness", "node", ["script/enterprise-readiness.mjs"]) && ok;
  } else {
    console.log("⚠ Skipping live enterprise-readiness (set FOUNDER_SEED_PASSWORD to enable)");
  }
} else {
  console.log("⚠ Skipping live HTTP audits (set IFCDC_BASE_URL to enable)");
}

const requiredScripts = [
  "script/hq-nav-audit.mjs",
  "script/hq-full-production-audit.mjs",
  "script/enterprise-readiness.mjs",
  "script/documents-readiness.mjs",
  "script/integrations-hub-readiness.mjs",
];
for (const rel of requiredScripts) {
  if (!existsSync(resolve(root, rel))) {
    console.error(`✗ Missing required script: ${rel}`);
    ok = false;
  } else {
    console.log(`✓ Present ${rel}`);
  }
}

console.log(`\n═══════════════════════════════════════════════════════`);
console.log(ok ? "  BUILD 58 VERIFY: PASS" : "  BUILD 58 VERIFY: FAIL");
console.log(`═══════════════════════════════════════════════════════\n`);
process.exit(ok ? 0 : 1);
