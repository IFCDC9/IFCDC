#!/usr/bin/env node
/**
 * IFCDC HQ — Complete production audit (routes + chunks + health).
 * Usage: IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com npm run hq:production-audit
 */
import { spawnSync } from "node:child_process";
import fs from "fs";
import path from "path";

const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com";
const NAV_PATHS = [
  "/hq", "/hq/founder", "/hq/analytics", "/hq/reports", "/hq/calendar",
  "/hq/notifications", "/hq/communications", "/hq/phase10", "/hq/phase9",
  "/hq/intelligence", "/hq/workflows", "/hq/software", "/hq/operations",
  "/hq/sso", "/hq/aura", "/hq/integrations", "/hq/people", "/hq/clients",
  "/hq/payroll", "/hq/finance", "/hq/grants", "/hq/donations", "/hq/programs",
  "/hq/housing", "/hq/scholarships", "/hq/media", "/hq/board", "/hq/compliance",
  "/hq/assets", "/hq/fleet", "/hq/facilities", "/hq/documents", "/hq/security",
  "/hq/settings", "/hq/developer",
];

const HQ_LAZY_MODULES = [
  "HqShellRoute", "ExecutiveDashboard", "ExecutiveWidgetDashboard",
  "FounderCommandCenterPage", "OrganizationAnalyticsPage", "EnterpriseReportingPage",
  "NotificationsCenterPage", "CommunicationsCenterPage", "Phase10ExecutivePlatformPage",
  "Phase9OperatingSystemPage", "EnterpriseIntelligencePage", "WorkflowAutomationPage",
  "AuraCommandCenterPage", "SoftwareDivisionPage", "OperationsCenterPage",
  "IntegrationsHubPage", "PeopleManagementCenter", "ClientCaseManagementPage",
  "HqPayrollPage", "FinancialCenterPage", "GrantCenterPage", "HqProgramsPage",
  "EnterpriseOperationsPage", "DocumentCenterPage", "SecurityCenterPage",
  "OrganizationSettingsPage", "BoardPortalPage", "SsoGatewayPage", "DeveloperPortalPage",
  "HQLayout",
];

let fail = 0;
const log = (ok, msg, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${msg}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail++;
};

async function main() {
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  IFCDC HQ — FULL PRODUCTION AUDIT`);
  console.log(`  Target: ${BASE}`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  const health = await fetch(`${BASE}/api/health`);
  const healthBody = await health.json().catch(() => ({}));
  log(health.ok && healthBody.status === "healthy", "API health", `${health.status} commit=${healthBody.commit ?? "?"}`);

  const indexRes = await fetch(`${BASE}/hq`);
  const indexHtml = await indexRes.text();
  const mainJs = indexHtml.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  log(indexRes.ok && mainJs, "SPA index.html", mainJs ?? String(indexRes.status));

  if (mainJs) {
    const jsRes = await fetch(`${BASE}${mainJs}`);
    const mime = jsRes.headers.get("content-type") || "";
    const head = (await jsRes.text()).slice(0, 60);
    log(jsRes.ok && mime.includes("javascript") && !head.includes("<!DOCTYPE"), "Main bundle MIME", `${jsRes.status} ${mime.split(";")[0]}`);
  }

  console.log("\n── HQ navigation routes (SPA shell) ──");
  for (const route of NAV_PATHS) {
    const res = await fetch(`${BASE}${route}`, { redirect: "follow" });
    const text = await res.text();
    const ok = res.ok && (text.includes('id="root"') || text.includes("<!DOCTYPE"));
    log(ok, route, String(res.status));
  }

  console.log("\n── Lazy module chunks (from main bundle map) ──");
  if (mainJs) {
    const bundle = await (await fetch(`${BASE}${mainJs}`)).text();
    const loadedBundles = new Map([["main", bundle]]);

    async function resolveChunk(mod) {
      const re = new RegExp(`(?:assets/)?${mod}-[A-Za-z0-9_-]+\\.js`);
      let chunkMatch = bundle.match(re);
      if (!chunkMatch && mod === "ExecutiveWidgetDashboard") {
        const execMatch = bundle.match(/(?:assets\/)?ExecutiveDashboard-[A-Za-z0-9_-]+\.js/);
        if (execMatch) {
          const execFile = execMatch[0].replace(/^assets\//, "");
          const execPath = `/assets/${execFile}`;
          const execBundle = await (await fetch(`${BASE}${execPath}`)).text();
          chunkMatch = execBundle.match(/(?:assets\/)?ExecutiveWidgetDashboard-[A-Za-z0-9_-]+\.js/);
        }
      }
      return chunkMatch;
    }

    for (const mod of HQ_LAZY_MODULES) {
      const chunkMatch = await resolveChunk(mod);
      if (!chunkMatch) {
        log(false, `chunk ref ${mod}`, "not found in main bundle");
        continue;
      }
      const chunkFile = chunkMatch[0].replace(/^assets\//, "");
      const chunkPath = `/assets/${chunkFile}`;
      const cRes = await fetch(`${BASE}${chunkPath}`);
      const cMime = cRes.headers.get("content-type") || "";
      const cHead = (await cRes.text()).slice(0, 40);
      const ok = cRes.ok && cMime.includes("javascript") && !cHead.includes("<!DOCTYPE");
      log(ok, chunkPath, `${cRes.status} ${cMime.split(";")[0]}`);
    }
  }

  console.log("\n── Local chunk integrity ──");
  const chunkAudit = spawnSync("node", ["script/hq-chunk-audit.mjs"], {
    stdio: "pipe",
    env: process.env,
  });
  const chunkOut = `${chunkAudit.stdout}${chunkAudit.stderr}`.trim();
  console.log(chunkOut.split("\n").slice(-4).join("\n"));
  if (chunkAudit.status !== 0) fail++;

  const stale = await fetch(`${BASE}/assets/__stale-chunk-probe__.js`);
  const staleMime = stale.headers.get("content-type") || "";
  log(stale.status === 404 && !staleMime.includes("html"), "Stale chunk returns 404 not HTML", String(stale.status));

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  AUDIT ${fail === 0 ? "PASSED" : `FAILED (${fail} checks)`}`);
  console.log(`═══════════════════════════════════════════════════════\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
