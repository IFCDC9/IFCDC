#!/usr/bin/env node
/**
 * Phase 8A.5 — reuse-first IRS 501(c)(3) determination letter verification.
 *
 * Locates the letter in HQ Document Center first. Uploads the local PDF only
 * if it is genuinely absent, then verifies into the Evidence Vault and rematches.
 *
 * Auth: AURA_OPS_VERIFY_TOKEN / Founder JWT (Phase 6 pattern). No Founder password.
 *
 *   node script/phase8a5-verify-irs-determination.mjs \
 *     "/Users/fahrealallah/Downloads/CERT of INCOR 2(2).pdf"
 */
import { readFileSync, existsSync } from "fs";
import { resolve, join, basename } from "path";
import { homedir } from "os";

function loadDotEnv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadDotEnv();

const BASE = (process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");
const pdfPath =
  process.argv[2]
  || "/Users/fahrealallah/Downloads/CERT of INCOR 2(2).pdf";

function resolveAuth() {
  const ops = (process.env.AURA_OPS_VERIFY_TOKEN || process.env.IFCDC_AURA_OPS_VERIFY_TOKEN || "").trim();
  if (ops) return { kind: "ops", token: ops };
  const jwt =
    (process.env.HQ_TOKEN || "").trim()
    || (process.env.FOUNDER_HQ_TOKEN || "").trim()
    || (process.env.IFCDC_HQ_TOKEN || "").trim();
  if (jwt) return { kind: "jwt", token: jwt };
  for (const p of [resolve(process.cwd(), ".hq-bearer.token"), join(homedir(), ".ifcdc", "hq-bearer.token")]) {
    if (existsSync(p)) {
      const t = readFileSync(p, "utf8").trim();
      if (t) return { kind: "jwt", token: t };
    }
  }
  return null;
}

async function api(path, { method = "GET", body, auth } = {}) {
  const headers = { Accept: "application/json" };
  if (auth?.kind === "ops") headers["X-IFCDC-Ops-Token"] = auth.token;
  else if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(420_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  console.log(`\n=== Phase 8A.5 IRS determination reuse-first verify ===\n${BASE}\n`);
  const auth = resolveAuth();
  if (!auth) {
    console.error("FAIL auth — need AURA_OPS_VERIFY_TOKEN or Founder JWT");
    process.exit(1);
  }
  if (!existsSync(pdfPath)) {
    console.error("FAIL file missing:", pdfPath);
    process.exit(1);
  }

  // Step 1: locate-only (no upload)
  const locateOnly = await api("/api/hq/aura/ops/phase8a5/verify-org-evidence", {
    method: "POST",
    auth,
    body: {
      evidenceType: "irs_501c3",
      title: "IRS 501(c)(3) Determination Letter",
      founderApproved: true,
      effectiveDate: "2025-10-21",
      metadata: {
        determinationDate: "2025-11-06",
        effectiveDateOfExemption: "2025-10-21",
        publicCharityStatus: "509(a)(2)",
        contributionDeductibility: true,
        ein: "47-3125994",
        letterCode: "947",
        sourceFileName: basename(pdfPath),
      },
    },
  });

  let result = locateOnly;
  if (locateOnly.status === 404 || locateOnly.json?.action === "missing") {
    console.log("Not found in HQ Document Center — ingesting Founder-provided PDF once (no duplicate).");
    const base64 = readFileSync(pdfPath).toString("base64");
    result = await api("/api/hq/aura/ops/phase8a5/verify-org-evidence", {
      method: "POST",
      auth,
      body: {
        evidenceType: "irs_501c3",
        title: "IRS 501(c)(3) Determination Letter",
        founderApproved: true,
        effectiveDate: "2025-10-21",
        fileName: "IFCDC-IRS-501c3-Determination-Letter.pdf",
        mimeType: "application/pdf",
        base64,
        metadata: {
          determinationDate: "2025-11-06",
          effectiveDateOfExemption: "2025-10-21",
          publicCharityStatus: "509(a)(2)",
          contributionDeductibility: true,
          ein: "47-3125994",
          letterCode: "947",
          sourceFileName: basename(pdfPath),
        },
      },
    });
  } else {
    console.log("Located existing HQ document — reused (no re-upload).");
  }

  console.log(`HTTP ${result.status}`);
  console.log(JSON.stringify({
    ok: result.json?.ok,
    action: result.json?.action,
    verificationStatus: result.json?.verificationStatus,
    hqDocumentId: result.json?.hqDocumentId,
    reusedExisting: result.json?.reusedExisting,
    uploadedNew: result.json?.uploadedNew,
    rematch: result.json?.rematch,
    unlockedCount: (result.json?.unlockedOpportunities || []).length,
    readinessIncreasedCount: (result.json?.readinessIncreased || []).length,
    founderQueueStillListsItem: result.json?.founderQueueStillListsItem,
    nextFounderQueueItem: result.json?.nextFounderQueueItem,
    orgProfileSummary: result.json?.orgProfileSummary,
    unlockedOpportunities: result.json?.unlockedOpportunities,
    readinessIncreased: (result.json?.readinessIncreased || []).slice(0, 15),
    founderQueueTop5: result.json?.founderQueueTop5,
  }, null, 2));

  if (!result.ok || !result.json?.ok) process.exit(1);
  if (result.json.founderQueueStillListsItem) {
    console.error("WARN: IRS item still on Founder queue after verify");
    process.exit(2);
  }
  console.log("\nPASS — IRS 501(c)(3) determination verified in Evidence Vault\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
