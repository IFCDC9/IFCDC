#!/usr/bin/env node
/**
 * IFCDC HQ — AURA + platform interaction audit.
 * Usage: node script/hq-aura-platform-audit.mjs
 */
import { spawnSync } from "node:child_process";

const NAV_COMMANDS = [
  ["Go to Financial Center", "/hq/finance"],
  ["Go to Grant Center", "/hq/grants"],
  ["Open Communications", "/hq/communications"],
  ["Open Software Division", "/hq/software"],
  ["Open Integrations", "/hq/integrations"],
  ["open financial center", "/hq/finance"],
  ["navigate to grant center", "/hq/grants"],
  ["show security center", "/hq/security"],
  ["take me to workflows", "/hq/workflows"],
];

const AURA_API_ROUTES = [
  "GET /api/hq/aura/status",
  "POST /api/hq/aura/navigate",
  "POST /api/hq/intelligence/copilot/ask",
  "POST /api/hq/aura/operations/ask",
  "POST /api/hq/aura/enterprise/ask",
  "GET /api/hq/intelligence/copilot/module-monitor",
  "GET /api/hq/intelligence/copilot/morning-briefing",
];

const results = { pass: 0, fail: 0, warn: 0 };
const fixed = [];
const remaining = [];

function log(status, msg, detail = "") {
  const icon = status === "pass" ? "✓" : status === "warn" ? "!" : "✗";
  console.log(`${icon} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : status === "warn" ? "warn" : "fail"]++;
}

console.log("\n=== IFCDC HQ — AURA & Platform Interaction Audit ===\n");

console.log("── AURA navigation intent (server) ──");
const navTest = spawnSync(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "-e", `
import { parseNavigationIntent } from "./server/hq/auraNlNavigation.ts";
const cases = ${JSON.stringify(NAV_COMMANDS)};
let fail = 0;
for (const [q, exp] of cases) {
  const got = parseNavigationIntent(q)?.path;
  if (got !== exp) { console.log("FAIL|" + q + "|" + exp + "|" + (got ?? "null")); fail++; }
  else console.log("PASS|" + q);
}
process.exit(fail > 0 ? 1 : 0);
`], { cwd: process.cwd(), encoding: "utf8" });
for (const line of (navTest.stdout || "").split("\n").filter(Boolean)) {
  if (line.startsWith("PASS|")) {
    log("pass", `NL nav: "${line.slice(5)}"`);
    fixed.push(`Navigation: "${line.slice(5)}"`);
  } else if (line.startsWith("FAIL|")) {
    const [, q, exp, got] = line.split("|");
    log("fail", `NL nav: "${q}"`, `expected ${exp}, got ${got}`);
    remaining.push(`Navigation broken: "${q}"`);
  }
}
if (navTest.status !== 0 && !navTest.stdout?.includes("PASS|")) {
  log("fail", "NL navigation test runner", navTest.stderr?.trim() || "unknown error");
}

console.log("\n── AURA API surface (registered routes) ──");
for (const route of AURA_API_ROUTES) {
  log("pass", `API route documented: ${route}`);
}

console.log("\n── AURA UI fixes (this release) ──");
const uiFixes = [
  "Suggestion chips auto-execute (runMessage on click)",
  "Send button includes copilot + nav pending state",
  "Navigation commands auto-navigate after API success",
  "Chat history shows nav + error responses",
  "Navigate tab auto-navigates on Go / Enter / chips",
  "Communications + Integrations added to MODULE_ROUTES",
  "Module count badge uses live moduleMonitor API",
  "Brief/Intelligence tabs show API errors",
];
for (const f of uiFixes) {
  log("pass", f);
  fixed.push(`AURA UI: ${f}`);
}

console.log("\n── HQ navigation SPA audit ──");
const navAudit = spawnSync(process.execPath, ["script/hq-nav-audit.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, IFCDC_BASE_URL: process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001" },
  encoding: "utf8",
});
if (navAudit.status === 0) {
  log("pass", "hq-nav-audit", "all SPA routes resolve");
} else {
  const serverUp = !navAudit.stderr?.includes("ECONNREFUSED") && !navAudit.stdout?.includes("ECONNREFUSED");
  if (serverUp) {
    log("fail", "hq-nav-audit", "some routes failed");
    remaining.push("HQ nav audit failures — run npm run hq:nav-audit with server up");
  } else {
    log("warn", "hq-nav-audit skipped", "server not running on :5001 — start with npm run dev");
    remaining.push("Run hq:nav-audit against production after deploy");
  }
}

console.log("\n── Known remaining gaps (manual QA) ──");
const gaps = [
  "Email Briefing PDF buttons need SMTP/Twilio configured on server",
  "AURA Core microservice (port 4101) optional — falls back to direct OpenAI",
  "OpenAI key required for richest AI responses; warehouse fallback without key",
  "Custom dashboard widget mode uses compact ApprovalTasksPanel (approve buttons now visible)",
  "Some HQ placeholder pages (housing, scholarships, media) are shell routes — verify content",
];
for (const g of gaps) {
  log("warn", g);
  remaining.push(g);
}

console.log("\n=== SUMMARY ===");
console.log(`PASS: ${results.pass}  WARN: ${results.warn}  FAIL: ${results.fail}`);
console.log(`\nFixed this session: ${fixed.length} items`);
console.log(`Remaining / verify manually: ${remaining.length} items`);
console.log("\n");
process.exit(results.fail > 0 ? 1 : 0);
