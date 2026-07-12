#!/usr/bin/env node
/**
 * AURA Software Engineering — Phase 1 acceptance
 *
 * Low-risk trail (no auth/payments/grants/DB destruction):
 *   portfolio → diagnose UI gap → prepare fix package → tests (or blocked_no_workspace)
 *   → Founder approval request → reject path (no push) → audit-friendly report
 *
 * Usage:
 *   export IFCDC_BASE_URL=http://localhost:5000
 *   export MASTER_OWNER_EMAIL=service@ifcdc.org
 *   export FOUNDER_SEED_PASSWORD='…'
 *   node script/aura-se-acceptance.mjs
 */
import fs from "fs";

const BASE = (process.env.IFCDC_BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const EMAIL = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "";

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  stages: {},
  blockers: [],
  acceptanceBug: "HQ Software Engineering dashboard/nav missing — non-destructive ops surface",
  submittedToProduction: false,
};

function log(stage, status, detail) {
  report.stages[stage] = { status, detail, at: new Date().toISOString() };
  const icon = status === "pass" ? "✓" : status === "warn" ? "⚠" : "✗";
  console.log(`${icon} [${stage}] ${status}${detail ? ` — ${detail}` : ""}`);
}

async function jsonFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text?.slice(0, 200) };
  }
  return { res, body, ok: res.ok };
}

async function login() {
  if (!PASSWORD) throw new Error("FOUNDER_SEED_PASSWORD is required");
  const { ok, res, body } = await jsonFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!ok) throw new Error(`Login failed (${res.status}): ${body?.error || "unknown"}`);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("No session cookie");
  return cookie;
}

function auth(cookie) {
  return { Cookie: cookie };
}

async function main() {
  const cookie = await login();
  log("login", "pass", EMAIL);

  const dash = await jsonFetch("/api/hq/aura/software-engineering/dashboard", { headers: auth(cookie) });
  if (!dash.ok) {
    log("dashboard", "fail", dash.body?.error || String(dash.res.status));
    report.blockers.push("dashboard unavailable");
    finish(1);
    return;
  }
  log(
    "dashboard",
    "pass",
    `apps=${dash.body?.apps?.length ?? 0} indexFiles=${dash.body?.index?.totalFiles ?? 0} deploy=${dash.body?.github?.deploymentStatus}`
  );

  const diag = await jsonFetch("/api/hq/aura/software-engineering/diagnose", {
    method: "POST",
    headers: auth(cookie),
    body: JSON.stringify({
      symptom:
        "Software Engineering dashboard route /hq/software-engineering was missing from HQ navigation — low-risk UI/ops gap",
    }),
  });
  if (!diag.ok) {
    log("diagnose", "fail", diag.body?.error || String(diag.res.status));
    report.blockers.push("diagnose failed");
    finish(1);
    return;
  }
  log("diagnose", "pass", `id=${diag.body?.id} severity=${diag.body?.severity}`);

  const pkg = await jsonFetch("/api/hq/aura/software-engineering/change-packages", {
    method: "POST",
    headers: auth(cookie),
    body: JSON.stringify({
      title: "Add AURA Software Engineering dashboard and nav",
      diagnosisId: diag.body?.id,
      proposedOps: [
        { path: "client/src/pages/hq/AuraSoftwareEngineeringPage.tsx", action: "create", note: "SE dashboard" },
        { path: "client/src/config/hqNavigation.ts", action: "patch", note: "nav entry" },
      ],
    }),
  });
  if (!pkg.ok) {
    log("change_package", "fail", pkg.body?.error || String(pkg.res.status));
    report.blockers.push("change package failed");
    finish(1);
    return;
  }
  log("change_package", "pass", `id=${pkg.body?.id} branch=${pkg.body?.branch}`);

  const tests = await jsonFetch("/api/hq/aura/software-engineering/tests", {
    method: "POST",
    headers: auth(cookie),
    body: JSON.stringify({ changePackageId: pkg.body?.id }),
  });
  if (!tests.ok) {
    log("tests", "fail", tests.body?.error || String(tests.res.status));
    report.blockers.push("tests endpoint failed");
  } else if (tests.body?.status === "blocked_no_workspace") {
    log("tests", "pass", "honest blocked_no_workspace (no fake pass)");
  } else if (tests.body?.status === "passed") {
    log("tests", "pass", `real commands passed run=${tests.body?.testRunId}`);
  } else {
    log("tests", "warn", tests.body?.message || tests.body?.status);
  }

  const approval = await jsonFetch("/api/hq/aura/software-engineering/approvals", {
    method: "POST",
    headers: auth(cookie),
    body: JSON.stringify({
      changePackageId: pkg.body?.id,
      repository: "IFCDC9/IFCDC",
      branch: pkg.body?.branch || "aura/se-acceptance",
      service: "ifcdc-hq",
      action: "push",
      riskSummary: "Low-risk UI/nav addition for Software Engineering dashboard. No auth/payments/DB.",
    }),
  });
  if (!approval.ok) {
    log("approval_request", "fail", approval.body?.error || String(approval.res.status));
    report.blockers.push("approval request failed");
    finish(1);
    return;
  }
  log("approval_request", "pass", `id=${approval.body?.id} status=pending`);

  // Reject in acceptance so we do not push from CI accidentally
  const decide = await jsonFetch(`/api/hq/aura/software-engineering/approvals/${approval.body.id}/decide`, {
    method: "POST",
    headers: auth(cookie),
    body: JSON.stringify({ decision: "reject", note: "Acceptance run — reject to avoid auto-push; Founder will approve real ship separately." }),
  });
  if (!decide.ok) {
    log("approval_decide", "fail", decide.body?.error || String(decide.res.status));
    report.blockers.push("approval decide failed");
  } else {
    log("approval_decide", "pass", "reject recorded — no production push");
  }

  const cmp = await jsonFetch("/api/hq/aura/software-engineering/deploy/compare", { headers: auth(cookie) });
  log("deploy_compare", cmp.ok ? "pass" : "warn", cmp.body?.recommendation || cmp.body?.error || "");

  console.log("\n--- FINAL ---");
  console.log(
    JSON.stringify(
      {
        acceptanceBug: report.acceptanceBug,
        blockers: report.blockers,
        submittedToProduction: false,
        open: `${BASE}/hq/software-engineering`,
      },
      null,
      2
    )
  );
  finish(report.blockers.length ? 2 : 0);
}

function finish(code) {
  report.finishedAt = new Date().toISOString();
  try {
    fs.writeFileSync("/tmp/ifcdc-aura-se-acceptance.json", JSON.stringify(report, null, 2));
    console.log("Wrote /tmp/ifcdc-aura-se-acceptance.json");
  } catch {
    /* ignore */
  }
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  report.blockers.push(String(err?.message || err));
  finish(1);
});
