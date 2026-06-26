#!/usr/bin/env node
/**
 * IFCDC Headquarters — Documents module readiness gate.
 * Usage: IFCDC_BASE_URL=https://ifcdc-hq.onrender.com npm run docs:readiness
 */
const BASE = process.env.IFCDC_BASE_URL || "http://127.0.0.1:5001";
const FOUNDER_EMAIL = process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org";
const FOUNDER_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";

const results = { pass: 0, fail: 0 };

function log(status, msg, detail = "") {
  console.log(`${status === "pass" ? "✓" : "✗"} ${msg}${detail ? ` — ${detail}` : ""}`);
  results[status === "pass" ? "pass" : "fail"]++;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body, ok: res.ok };
}

async function login() {
  const { ok, res } = await jsonFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email: FOUNDER_EMAIL, password: FOUNDER_PASSWORD }),
  });
  if (!ok) throw new Error(`Login failed: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  console.log(`\n=== IFCDC Documents Readiness (${BASE}) ===\n`);

  const unauth = await jsonFetch(`${BASE}/api/hq/documents/overview`);
  log(!unauth.ok ? "pass" : "fail", "Unauthenticated access blocked", String(unauth.res.status));

  const unauthFunding = await jsonFetch(`${BASE}/api/admin/funding-sources`);
  log(!unauthFunding.ok ? "pass" : "fail", "Admin funding sources secured", String(unauthFunding.res.status));

  const cookie = await login();
  log("pass", "Founder login");
  const auth = { credentials: "include", headers: { Cookie: cookie } };

  const overview = await jsonFetch(`${BASE}/api/hq/documents/overview`, auth);
  log(overview.ok && overview.body?.total != null ? "pass" : "fail", "Documents overview", `${overview.body?.total ?? "?"} docs`);

  const list = await jsonFetch(`${BASE}/api/hq/documents`, auth);
  log(list.ok && Array.isArray(list.body?.documents) ? "pass" : "fail", "Document library list");

  const sampleBase64 = Buffer.from("IFCDC HQ Phase 1 document readiness test.").toString("base64");
  const upload = await jsonFetch(`${BASE}/api/hq/documents/upload`, {
    ...auth,
    method: "POST",
    body: JSON.stringify({
      fileName: "readiness-test.txt",
      base64: sampleBase64,
      mimeType: "text/plain",
      title: `Readiness Upload ${Date.now()}`,
      category: "general",
      access_level: "internal",
      requires_approval: false,
    }),
  });
  const docId = upload.body?.document?.id;
  log(upload.ok && docId ? "pass" : "fail", "File upload via /documents/upload", docId ?? "?");

  if (docId) {
    const detail = await jsonFetch(`${BASE}/api/hq/documents/${docId}`, auth);
    log(detail.ok && detail.body?.document?.file_url ? "pass" : "fail", "Document retrieval with file URL");

    const versions = detail.body?.versions ?? [];
    log(versions.length >= 1 ? "pass" : "fail", "Version history", `${versions.length} version(s)`);

    const fileUpload = await jsonFetch(`${BASE}/api/hq/files/upload`, {
      ...auth,
      method: "POST",
      body: JSON.stringify({
        fileName: "version-test.txt",
        base64: sampleBase64,
        mimeType: "text/plain",
      }),
    });
    log(fileUpload.ok && fileUpload.body?.file?.url ? "pass" : "fail", "HQ file storage upload");

    if (fileUpload.body?.file?.url) {
      const newVersion = await jsonFetch(`${BASE}/api/hq/documents/${docId}/versions`, {
        ...auth,
        method: "POST",
        body: JSON.stringify({ file_url: fileUpload.body.file.url, change_notes: "Readiness version test" }),
      });
      log(newVersion.ok ? "pass" : "fail", "Add document version");
    }

    const approve = await jsonFetch(`${BASE}/api/hq/documents/${docId}/approval`, {
      ...auth,
      method: "PATCH",
      body: JSON.stringify({ action: "approve" }),
    });
    log(approve.ok ? "pass" : "fail", "Document approval workflow");
  }

  const grants = await jsonFetch(`${BASE}/api/hq/grants/opportunities`, auth);
  log(grants.ok ? "pass" : "fail", "Grant Center integration (opportunities API)");

  const approvals = await jsonFetch(`${BASE}/api/hq/enterprise/approvals`, auth);
  log(approvals.ok ? "pass" : "fail", "Executive approval tasks (documents bridge)");

  console.log(`\n=== Documents Readiness: ${results.pass} PASS / ${results.fail} FAIL ===\n`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
