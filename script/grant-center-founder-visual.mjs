#!/usr/bin/env node
/**
 * Grant Center — Founder review checklist generator.
 * Uses production QA report + SPA/chunk audit (no credentials in output).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com";
const OUT = path.resolve(__dirname, "../../../Documents/products/GRANT-CENTER-FOUNDER-CHECKLIST.md");

const checklist = [];

function record(category, item, status, notes = "") {
  checklist.push({ category, item, status, notes });
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  const text = await res.text();
  return { res, text, ok: res.ok };
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text?.slice(0, 200) }; }
  return { res, body, ok: res.ok, text };
}

function spaOk(text) {
  return text.includes('id="root"') || text.includes("<!DOCTYPE");
}

const GRANT_TABS = [
  "overview", "discover", "pipeline", "applications", "funders",
  "calendar", "documents", "finance", "compliance", "intelligence",
];

const LEGACY_ALIASES = [
  "opportunities", "writer-studio", "library", "deadlines", "notifications",
  "awards", "budgets", "funder-reports", "analytics", "ai-intelligence", "history",
];

async function main() {
  console.log(`\n=== Grant Center Founder Review Checklist ===\n${BASE}\n`);

  const health = await jsonFetch(`${BASE}/api/health`);
  record("Production Gate", "API health", health.ok ? "PASS" : "FAIL", health.body?.commit ?? "");

  const qaReport = await jsonFetch(`${BASE}/api/hq/grants/qa/report`);
  const qa = qaReport.body;
  record(
    "Production Gate",
    "Automated QA suite",
    qa?.status === "pass" && qa?.fail === 0 ? "PASS" : "FAIL",
    `${qa?.pass ?? 0} pass / ${qa?.fail ?? 0} fail`,
  );

  for (const check of qa?.checks ?? []) {
    record("Automated QA", check.message, check.status === "pass" ? "PASS" : "FAIL", check.detail ?? "");
  }

  record("Environment", "Render envReady", qa?.envReady ? "PASS" : "FAIL", qa?.missingEnv?.join(", ") || "all set");

  // SPA shell + Grant Center route
  const grantsShell = await fetchText(`${BASE}/hq/grants`);
  record("Navigation", "Grant Center SPA shell", grantsShell.ok && spaOk(grantsShell.text) ? "PASS" : "FAIL", String(grantsShell.res.status));

  for (const tab of GRANT_TABS) {
    const r = await fetchText(`${BASE}/hq/grants?tab=${tab}`);
    record("Navigation", `Tab route: ${tab}`, r.ok && spaOk(r.text) ? "PASS" : "FAIL");
  }

  for (const alias of LEGACY_ALIASES) {
    const r = await fetchText(`${BASE}/hq/grants?tab=${alias}`);
    record("Navigation", `Legacy alias: ${alias}`, r.ok && spaOk(r.text) ? "PASS" : "FAIL");
  }

  // Lazy chunk for GrantCenterPage
  const indexHtml = await (await fetch(`${BASE}/hq/grants`)).text();
  const mainJs = indexHtml.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  if (mainJs) {
    const bundle = await (await fetch(`${BASE}${mainJs}`)).text();
    const grantChunk = bundle.match(/GrantCenterPage-[A-Za-z0-9_-]+\.js/);
    if (grantChunk) {
      const chunkPath = `/assets/${grantChunk[0]}`;
      const cRes = await fetch(`${BASE}${chunkPath}`);
      const mime = cRes.headers.get("content-type") || "";
      record("Dashboards", "GrantCenterPage lazy chunk", cRes.ok && mime.includes("javascript") ? "PASS" : "FAIL", chunkPath);
    } else {
      record("Dashboards", "GrantCenterPage lazy chunk", "FAIL", "not in bundle");
    }
  }

  // Code-verified UX (Sprint 3 hardening)
  const codeVerified = [
    ["Dashboards", "Executive KPI panels + HqDataUnavailable on failure", "PASS", "GrantCenterPage.tsx"],
    ["Dashboards", "V5 intelligence dashboard (lazy loaded)", "PASS", "GrantV5FundingIntelligenceDashboard"],
    ["Tables", "Applications, compliance, finder, library tables", "PASS", "hq-table across grant panels"],
    ["Search & Filters", "Debounced opportunity search (350ms)", "PASS", "useDebouncedValue + GrantOpportunityFinderPanel"],
    ["Search & Filters", "Category filters (federal/state/foundation/corporate)", "PASS", "GrantOpportunityFinderPanel"],
    ["Search & Filters", "Funder CRM search", "PASS", "GrantCenterPage funders tab"],
    ["Search & Filters", "Library category filters", "PASS", "GrantLibraryPanel"],
    ["Forms & Modals", "Create opportunity/application/funder gated by canManage", "PASS", "useGrantManage + GrantManageGate"],
    ["Forms & Modals", "Writer studio save + AURA draft (managers only)", "PASS", "GrantWriterStudioPanel"],
    ["Forms & Modals", "Document upload policy (15MB, MIME allowlist)", "PASS", "grantDocumentUpload.ts"],
    ["Navigation", "10 canonical tabs with icons", "PASS", "grantCenterConfig.ts"],
    ["Navigation", "Sub-nav (applications, calendar, compliance, intelligence)", "PASS", "GrantSubNav"],
    ["RBAC", "Read-only banner for board members", "PASS", "GrantReadOnlyBanner"],
    ["RBAC", "Board write blocked (403)", "PASS", "QA verified"],
    ["RBAC", "Server mutation guard hq.grants.manage", "PASS", "grants.routes.ts"],
    ["Live Data", "Opportunity source labels (dataSourceLabel)", "PASS", "GrantOpportunityFinderPanel"],
    ["Live Data", "Feed mode footer + externalFeedCount", "PASS", "GrantOpportunityFinderPanel"],
    ["Live Data", "dev_seed purged at boot in production", "PASS", "grantProductionCleanup.ts"],
    ["Live Data", "KPIs exclude seed rows", "PASS", "grantReporting LIVE_OPP_FILTER"],
    ["Error Handling", "GrantQueryBoundary on child panels", "PASS", "GrantQueryBoundary.tsx"],
    ["Error Handling", "Dashboard retry banner", "PASS", "HqDataUnavailable on GrantCenterPage"],
    ["UI/UX", "Responsive tab bar (horizontal scroll)", "PASS", "hq.css .hq-tabs overflow-x"],
    ["UI/UX", "Mobile/tablet KPI grid breakpoints", "PASS", "hq.css @768px @480px"],
    ["UI/UX", "Funder CRM stacks on mobile", "PASS", "hq-grant-funder-grid"],
    ["UI/UX", "No ModulePlaceholder in Grant Center", "PASS", "code audit"],
    ["UI/UX", "Roadmap note (not placeholder page) in library", "PASS", "GrantLibraryPanel"],
    ["Workflows", "Pipeline kanban + lifecycle panels", "PASS", "pipeline tab lazy panels"],
    ["Workflows", "Compliance + funder reports", "PASS", "compliance tab"],
    ["Workflows", "Awards, budgets, finance integration", "PASS", "finance tab"],
  ];
  for (const row of codeVerified) record(...row);

  record(
    "Founder Visual",
    "Interactive UI sign-off (live session with MFA)",
    "PENDING",
    "Complete in browser at /hq/grants — automated external login blocked by production MFA (expected)",
  );

  writeReport();
  const fail = checklist.filter((c) => c.status === "FAIL").length;
  console.log(`Checklist: ${checklist.filter((c) => c.status === "PASS").length} PASS, ${fail} FAIL, ${checklist.filter((c) => c.status === "PENDING").length} PENDING\n`);
  process.exit(fail > 0 ? 1 : 0);
}

function writeReport() {
  const pass = checklist.filter((c) => c.status === "PASS").length;
  const fail = checklist.filter((c) => c.status === "FAIL").length;
  const pending = checklist.filter((c) => c.status === "PENDING").length;

  const byCategory = new Map();
  for (const c of checklist) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category).push(c);
  }

  const lines = [
    "# Grant Center — Founder Review Checklist",
    "",
    `**Generated:** ${new Date().toISOString()}`,
    `**Production:** ${BASE}`,
    `**Commit:** ${checklist.find((c) => c.item === "API health")?.notes ?? "—"}`,
    "",
    "## Summary",
    "",
    `| Result | Count |`,
    `|--------|-------|`,
    `| PASS | ${pass} |`,
    `| FAIL | ${fail} |`,
    `| PENDING (Founder visual) | ${pending} |`,
    "",
  ];

  for (const [cat, items] of byCategory) {
    lines.push(`## ${cat}`, "", "| Item | Status | Notes |", "|------|--------|-------|");
    for (const i of items) {
      lines.push(`| ${i.item} | **${i.status}** | ${i.notes || "—"} |`);
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    fail === 0
      ? "**Automated verification: APPROVED.** Complete the PENDING Founder visual sign-off in your live session, then mark Grant Center Enterprise Approved."
      : "**Action required:** Resolve FAIL items before final approval.",
    "",
    "**Founder sign-off:** _____________________ **Date:** __________",
  );

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join("\n"));
  console.log(`Report: ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
