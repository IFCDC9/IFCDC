#!/usr/bin/env node
/**
 * IFCDC HQ — Mobile readiness gate (viewport, SPA shell, touch-friendly CSS markers).
 * Run: IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com node script/hq-mobile-readiness.mjs
 */
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const JSON_REPORT = process.argv.includes("--json-report");

const MOBILE_ROUTES = [
  ["/hq", "Executive Dashboard"],
  ["/hq/grants", "Grant Center"],
  ["/hq/grants?tab=pipeline", "Funding Pipeline"],
  ["/hq/integrations", "Integrations Hub"],
  ["/hq/finance", "Financial Center"],
  ["/hq/reports", "Enterprise Reporting"],
  ["/hq/settings", "Organization Settings"],
  ["/hq/aura", "AURA Command Center"],
  ["/hq/communications", "Communications Center"],
  ["/hq/software", "Software Division"],
  ["/hq/analytics", "Organization Analytics"],
  ["/login", "HQ Login"],
];

const results = { pass: 0, fail: 0 };
const checks = [];

function log(status, msg, detail = "") {
  checks.push({ status, message: msg, detail: detail || undefined });
  if (!JSON_REPORT) console.log(`${status === "pass" ? "✓" : "✗"} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : "fail"]++;
}

async function fetchHtml(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: "follow" });
  const html = await res.text();
  return { res, html };
}

async function main() {
  if (!JSON_REPORT) console.log("\n=== IFCDC HQ Mobile Readiness ===\n");

  const { html: indexHtml } = await fetchHtml("/");
  log(indexHtml.includes("viewport-fit=cover") ? "pass" : "fail", "Viewport viewport-fit=cover");
  log(indexHtml.includes("width=device-width") ? "pass" : "fail", "Responsive viewport meta");
  log(indexHtml.includes("apple-mobile-web-app-capable") ? "pass" : "fail", "iOS web app capable meta");

  const cssPath = indexHtml.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
  if (cssPath) {
    const { html: css } = await fetchHtml(cssPath);
    log(css.includes("hq-mobile-nav") ? "pass" : "fail", "Mobile bottom nav CSS");
    log(css.includes("safe-area-inset") ? "pass" : "fail", "Safe area inset CSS");
    log(css.includes("hq-pipeline-board") ? "pass" : "fail", "Pipeline kanban mobile CSS");
    log(css.includes("hq-table-scroll") ? "pass" : "fail", "Table scroll region CSS");
    log(css.includes("font-size: 16px") ? "pass" : "fail", "iOS input zoom prevention (16px)");
  } else {
    log("fail", "HQ CSS bundle", "not found in index.html");
  }

  for (const [path, label] of MOBILE_ROUTES) {
    const { res, html } = await fetchHtml(path);
    const isSpa = res.ok && html.includes('id="root"');
    log(isSpa ? "pass" : "fail", `Mobile route shell: ${label}`, `${res.status}`);
  }

  if (JSON_REPORT) {
    console.log(`__MOBILE_QA_JSON__${JSON.stringify({ pass: results.pass, fail: results.fail, checks })}`);
  } else {
    console.log(`\n=== Mobile QA: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  }
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
