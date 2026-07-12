#!/usr/bin/env node
/**
 * IFCDC Headquarters — HQ navigation route audit.
 * Verifies every sidebar nav path resolves to the SPA shell (HTML).
 * Usage: IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com npm run hq:nav-audit
 */
import { HQ_NAV_AUDIT_PATHS } from "./hq-nav-paths.mjs";

const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const NAV_PATHS = HQ_NAV_AUDIT_PATHS;

const results = { pass: 0, fail: 0 };

function log(status, msg, detail = "") {
  console.log(`${status === "pass" ? "✓" : "✗"} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : "fail"]++;
}

async function main() {
  console.log(`\n=== IFCDC HQ Navigation Audit (${BASE}) ===\n`);

  for (const route of NAV_PATHS) {
    const res = await fetch(`${BASE}${route}`, { redirect: "follow" });
    const text = await res.text();
    const isHtml = text.includes("<!DOCTYPE") || text.includes("<html") || text.includes('<div id="root"');
    log(isHtml && res.ok ? "pass" : "fail", `SPA route ${route}`, String(res.status));
  }

  const bogus = await fetch(`${BASE}/hq/nonexistent-module-xyz`);
  const bogusText = await bogus.text();
  const bogusHtml = bogusText.includes("<!DOCTYPE") || bogusText.includes("<html");
  log(bogusHtml && bogus.ok ? "pass" : "fail", "Unknown /hq/* still serves SPA shell", String(bogus.status));

  console.log(`\n=== Navigation Audit: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
