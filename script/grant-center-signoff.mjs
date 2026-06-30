#!/usr/bin/env node
/**
 * Grant Center enterprise sign-off gate — QA + founder review + HQ regression smoke.
 */
import { spawnSync } from "node:child_process";

const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com";
const env = { ...process.env, IFCDC_BASE_URL: BASE };

function run(label, cmd, args) {
  console.log(`\n── ${label} ──\n`);
  const proc = spawnSync(cmd, args, { stdio: "inherit", env });
  if (proc.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${proc.status})\n`);
    process.exit(proc.status ?? 1);
  }
}

console.log("\n═══════════════════════════════════════════════════════");
console.log("  GRANT CENTER ENTERPRISE SIGN-OFF");
console.log(`  Target: ${BASE}`);
console.log("═══════════════════════════════════════════════════════");

run("Grant Center QA (33 checks)", "node", ["script/grant-center-qa.mjs"]);
run("Founder visual review (API)", "node", ["script/grant-center-founder-review.mjs"]);
run("HQ production regression", "node", ["script/hq-full-production-audit.mjs"]);

console.log("\n✓ Grant Center sign-off automation complete.\n");
console.log("Manual founder checklist: verify /hq/grants tabs, read-only banner as board, forms, tables, navigation.\n");
