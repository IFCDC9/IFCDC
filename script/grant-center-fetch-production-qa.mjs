#!/usr/bin/env node
/**
 * Fetch Grant Center production QA report from Render (no credentials required).
 * Usage: IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com node script/grant-center-fetch-production-qa.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../../Documents/products/GRANT-CENTER-QA-REPORT.md");

async function pollReport(maxWaitMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
    const qa = health?.grantCenterQa;
    if (qa?.status === "pass" || qa?.status === "fail" || qa?.status === "env_missing" || qa?.status === "error") {
      const report = await fetch(`${BASE}/api/hq/grants/qa/report`).then((r) => r.json()).catch(() => null);
      return { health, report };
    }
    if (qa?.status === "running") {
      process.stdout.write(".");
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Timed out waiting for Grant Center QA on production");
}

function toMarkdown(health, report) {
  const lines = [
    "# Grant Center — Production QA Report",
    "",
    `**Generated:** ${new Date().toISOString()}`,
    `**Target:** ${BASE}`,
    `**Commit:** ${health?.commit ?? "unknown"}`,
    `**Render service:** ${report?.renderService ?? "ifcdc-hq"}`,
    "",
    "## Environment",
    "",
    `- **envReady:** ${report?.envReady === true ? "yes" : "no"}`,
    report?.missingEnv?.length ? `- **missingEnv:** ${report.missingEnv.join(", ")}` : "- **missingEnv:** none",
    "",
    "## Result",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Status | **${report?.status ?? "unknown"}** |`,
    `| PASS | ${report?.pass ?? 0} |`,
    `| FAIL | ${report?.fail ?? 0} |`,
    `| Completed | ${report?.completedAt ?? "—"} |`,
    report?.qaTag ? `| QA tag | ${report.qaTag} |` : "",
    "",
    "## Checklist",
    "",
  ].filter(Boolean);

  for (const c of report?.checks ?? []) {
    const icon = c.status === "pass" ? "PASS" : "FAIL";
    lines.push(`- [${icon}] ${c.message}${c.detail ? ` — ${c.detail}` : ""}`);
  }

  lines.push("", "---", "", report?.fail === 0 && report?.status === "pass"
    ? "**Production QA: APPROVED (automated gate)** — pending Founder visual sign-off."
    : "**Production QA: NOT APPROVED** — resolve failures before sign-off.");

  return lines.join("\n");
}

async function main() {
  console.log(`Polling production QA at ${BASE}…`);
  const { health, report } = await pollReport();
  const md = toMarkdown(health, report);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md);
  console.log(`\nReport written: ${OUT}`);
  console.log(`Result: ${report.pass} PASS / ${report.fail} FAIL (${report.status})`);
  process.exit(report.fail > 0 || report.status !== "pass" ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
