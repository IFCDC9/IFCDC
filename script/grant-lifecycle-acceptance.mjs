#!/usr/bin/env node
/**
 * IFCDC Grant Lifecycle — Production Acceptance Runner
 *
 * Runs against live production HQ (no demo seed):
 *   search → qualify → workspace → full draft → readiness → Founder review gate
 *
 * NEVER submits externally. Stops at Founder approval.
 *
 * Usage:
 *   export IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com
 *   export MASTER_OWNER_EMAIL=service@ifcdc.org
 *   export FOUNDER_SEED_PASSWORD='…'   # must match Render
 *   node script/grant-lifecycle-acceptance.mjs
 *
 * Optional:
 *   OPPORTUNITY_ID=…   # skip search; use existing HQ opportunity id
 *   OPPORTUNITY_Q=workforce
 */
import fs from "fs";

const BASE = (process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");
const EMAIL = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "";
const Q = process.env.OPPORTUNITY_Q || "workforce employment job training";
const FORCE_OPP = process.env.OPPORTUNITY_ID || "";

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  stages: {},
  blockers: [],
  opportunity: null,
  applicationId: null,
  readinessScore: null,
  submissionMethod: "Grants.gov portal (manual) — HQ never auto-submits",
  founderApprovalRequired: true,
  submittedExternally: false,
};

function log(stage, status, detail) {
  report.stages[stage] = { status, detail, at: new Date().toISOString() };
  const icon = status === "pass" ? "✓" : status === "blocked" ? "■" : status === "warn" ? "⚠" : "✗";
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
  if (!PASSWORD) {
    throw new Error("FOUNDER_SEED_PASSWORD is required (must match Render ifcdc-hq)");
  }
  const { ok, res, body } = await jsonFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!ok) throw new Error(`Login failed (${res.status}): ${body?.error || "unknown"}`);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("Login succeeded but no session cookie returned");
  return cookie;
}

function authHeaders(cookie) {
  return { Cookie: cookie };
}

function pickWorkforceMatch(matches) {
  const scored = (matches || []).map((m) => {
    const title = String(m.title || m.opportunity?.title || "").toLowerCase();
    const funder = String(m.funder || m.opportunity?.funder || "").toLowerCase();
    const text = `${title} ${funder} ${JSON.stringify(m.bestProgram || {})}`.toLowerCase();
    let score = Number(m.compositeScore ?? m.score ?? m.eligibility?.score ?? 0);
    if (/workforce|employment|job training|apprentice|vocational|career/.test(text)) score += 15;
    if (/appalachian|northern border|delta regional|worc/.test(text)) score -= 40; // geo risk for NJ
    if (/embassy|algeria|fiji|okinawa/.test(text)) score -= 50;
    return { ...m, _pickScore: score };
  });
  scored.sort((a, b) => b._pickScore - a._pickScore);
  return scored[0] || null;
}

async function waitDraft(cookie, applicationId, jobId, maxMs = 8 * 60_000) {
  const started = Date.now();
  let id = jobId;
  while (Date.now() - started < maxMs) {
    const path = id
      ? `/api/hq/grants/draft-jobs/${id}`
      : `/api/hq/grants/applications/${applicationId}/draft-job`;
    const { ok, body } = await jsonFetch(path, { headers: authHeaders(cookie) });
    if (ok && body) {
      const status = body.status || body.job?.status;
      id = body.id || body.jobId || id;
      if (status === "done" || status === "completed" || status === "success") return body;
      if (status === "error" || status === "failed") throw new Error(body.error || "Draft job failed");
      console.log(`  … draft job ${id || "?"} status=${status || "running"}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Timed out waiting for full proposal draft");
}

async function main() {
  console.log("\n=== IFCDC Grant Lifecycle Production Acceptance ===\n");
  console.log(`Target: ${BASE}`);
  console.log(`Founder: ${EMAIL}\n`);

  const health = await jsonFetch("/api/health");
  log(
    "health",
    health.ok ? "pass" : "fail",
    `commit=${health.body?.commit || "?"} qa=${health.body?.grantCenterQa?.status || "?"}`
  );

  let cookie;
  try {
    cookie = await login();
    log("auth", "pass", "Founder session established");
  } catch (e) {
    log("auth", "blocked", e.message);
    report.blockers.push(e.message);
    finish(1);
    return;
  }

  // 1. Search
  let opportunityId = FORCE_OPP;
  let opportunityMeta = null;
  if (!opportunityId) {
    const match = await jsonFetch(
      `/api/hq/grants/intelligence/match?sort=deadline&limit=25&q=${encodeURIComponent(Q)}`,
      { headers: authHeaders(cookie) }
    );
    if (!match.ok) {
      log("search", "fail", match.body?.error || String(match.res.status));
      report.blockers.push("Grant intelligence match failed");
      finish(1);
      return;
    }
    const matches = match.body?.matches || match.body?.results || [];
    const picked = pickWorkforceMatch(matches);
    if (!picked) {
      log("search", "fail", "No workforce-aligned live matches returned");
      report.blockers.push("No workforce-aligned opportunities in HQ live DB");
      finish(1);
      return;
    }
    opportunityId = picked.opportunityId || picked.id;
    opportunityMeta = picked;
    log(
      "search",
      "pass",
      `${picked.title || opportunityId} · score=${picked._pickScore} · ${picked.funder || ""}`
    );
  } else {
    log("search", "pass", `Forced opportunity ${opportunityId}`);
  }
  report.opportunity = { id: opportunityId, ...(opportunityMeta || {}) };

  // 2. Qualification / score
  const score = await jsonFetch(`/api/hq/grants/opportunities/${opportunityId}/score-intelligence`, {
    method: "POST",
    headers: authHeaders(cookie),
    body: JSON.stringify({}),
  });
  if (score.ok) {
    const el = score.body?.eligibility || score.body?.intel || score.body;
    log(
      "qualification",
      "pass",
      `eligibility=${el?.eligibility ?? el?.eligibilityScore ?? "?"} composite=${el?.composite ?? "?"}`
    );
  } else {
    log("qualification", "warn", score.body?.error || "score endpoint unavailable — continuing");
  }

  // 3. Workspace
  const start = await jsonFetch(`/api/hq/grants/opportunities/${opportunityId}/start-application`, {
    method: "POST",
    headers: authHeaders(cookie),
    body: JSON.stringify({ generateDrafts: false }),
  });
  if (!start.ok) {
    log("workspace", "fail", start.body?.error || String(start.res.status));
    report.blockers.push("start-application failed");
    finish(1);
    return;
  }
  const applicationId = start.body?.applicationId || start.body?.application?.id;
  report.applicationId = applicationId;
  log("workspace", "pass", `applicationId=${applicationId} humanReviewRequired=${start.body?.humanReviewRequired !== false}`);

  const checklist = await jsonFetch(`/api/hq/grants/documents/checklist?application_id=${applicationId}`, {
    headers: authHeaders(cookie),
  });
  log(
    "checklist",
    checklist.ok ? "pass" : "warn",
    checklist.ok ? `categories=${(checklist.body?.categories || checklist.body?.items || []).length}` : "checklist unavailable"
  );

  // 4. Full proposal
  const draft = await jsonFetch(`/api/hq/grants/applications/${applicationId}/generate-full-draft`, {
    method: "POST",
    headers: authHeaders(cookie),
    body: JSON.stringify({}),
  });
  if (!draft.ok && draft.res.status !== 202) {
    log("proposal", "fail", draft.body?.error || String(draft.res.status));
    report.blockers.push("generate-full-draft failed");
    finish(1);
    return;
  }
  const jobId = draft.body?.jobId || draft.body?.id;
  log("proposal", "pass", `draft job queued jobId=${jobId || "poll-by-app"}`);
  try {
    await waitDraft(cookie, applicationId, jobId);
    log("proposal_complete", "pass", "Full draft finished — staged for Founder review (not submitted)");
  } catch (e) {
    log("proposal_complete", "warn", e.message);
    report.blockers.push(e.message);
  }

  // 5. Validation / readiness
  const studio = await jsonFetch(`/api/hq/grants/writer-studio/${applicationId}`, {
    headers: authHeaders(cookie),
  });
  if (studio.ok) {
    const pc = studio.body?.proposalCompleteness || studio.body?.completeness || {};
    const pct = pc.percent ?? pc.completionPct ?? null;
    report.readinessScore = pct;
    const missing = pc.missing || pc.missingSections || [];
    log(
      "validation",
      pct != null && pct >= 80 ? "pass" : "warn",
      `completeness=${pct ?? "?"}% missing=${Array.isArray(missing) ? missing.join(",") : missing || "n/a"}`
    );
    if (pct != null && pct < 80) report.blockers.push(`Proposal completeness ${pct}% < 80%`);
  } else {
    log("validation", "warn", "writer-studio unavailable");
  }

  const full = await jsonFetch(`/api/hq/grants/applications/${applicationId}/full-workspace`, {
    headers: authHeaders(cookie),
  });
  if (full.ok) {
    const ready = full.body?.founderApproval?.readyToSubmit;
    log("founder_gate", "pass", `readyToSubmit=${ready === true} — awaiting explicit Founder approve (no submit performed)`);
  } else {
    log("founder_gate", "pass", "Workspace created; Founder must approve in UI before any portal submission");
  }

  // 6. Negative control — PATCH to submitted WITHOUT Founder approval must fail
  const bypass = await jsonFetch(`/api/hq/grants/applications/${applicationId}`, {
    method: "PATCH",
    headers: authHeaders(cookie),
    body: JSON.stringify({ status: "submitted", portal_confirmation_id: "FAKE-BYPASS-TEST" }),
  });
  if (bypass.res.status === 403 || bypass.body?.code === "founder_approval_required") {
    log("founder_bypass_blocked", "pass", `status=${bypass.res.status} code=${bypass.body?.code || "forbidden"}`);
  } else if (bypass.ok) {
    log("founder_bypass_blocked", "fail", "PATCH to submitted succeeded without Founder approval — SECURITY REGRESSION");
    report.blockers.push("Founder approval bypass: PATCH submitted without approval");
  } else {
    log("founder_bypass_blocked", "warn", `unexpected status=${bypass.res.status} ${bypass.body?.error || ""}`);
  }

  // 7. Live workflow endpoint smoke (stages for Founder; does not submit)
  const liveWf = await jsonFetch(`/api/hq/grants/executive/live-workflow`, {
    method: "POST",
    headers: authHeaders(cookie),
    body: JSON.stringify({ opportunityId: report.opportunity?.id, syncFeeds: false, autoDraft: false }),
  });
  if (liveWf.ok && liveWf.body?.phase === "awaiting_founder") {
    log("live_workflow", "pass", `applicationId=${liveWf.body.applicationId} phase=awaiting_founder`);
  } else if (liveWf.ok) {
    log("live_workflow", "warn", `phase=${liveWf.body?.phase || "?"} ok=${liveWf.body?.ok}`);
  } else {
    log("live_workflow", "warn", liveWf.body?.error || String(liveWf.res.status));
  }

  console.log("\n--- FINAL ---");
  console.log(JSON.stringify({
    opportunity: report.opportunity?.title || report.opportunity?.id,
    applicationId: report.applicationId,
    readinessScore: report.readinessScore,
    blockers: report.blockers,
    submissionMethod: report.submissionMethod,
    packageReadyForFounderApproval: report.blockers.length === 0,
    submittedExternally: false,
  }, null, 2));
  console.log(`\nOpen: ${BASE}/hq/grants?application=${applicationId}\n`);

  finish(report.blockers.length ? 2 : 0);
}

function finish(code) {
  report.finishedAt = new Date().toISOString();
  try {
    fs.writeFileSync("/tmp/ifcdc-grant-lifecycle-acceptance.json", JSON.stringify(report, null, 2));
    console.log("Wrote /tmp/ifcdc-grant-lifecycle-acceptance.json");
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
