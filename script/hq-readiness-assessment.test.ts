import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isReadinessAssessmentQuestion, explainReadinessAssessment } from "../server/hq/auraReadinessAssessment.ts";
import { runReadOnlyModuleProbe, testReadOnlyIntegrationProvider, type ReadinessProbeReaders } from "../server/hq/readOnlyReadinessProbes.ts";
import { commandPaletteResults } from "../client/src/utils/commandPaletteResults.ts";
import { HQ_NAV_ITEMS } from "../client/src/config/hqNavigation.ts";

process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ifcdc-readiness-"));
process.env.DATABASE_URL = "";
for (const key of ["AURA_OPENAI_API_KEY", "OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "POSTMARK_SERVER_TOKEN", "RESEND_API_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]) delete process.env[key];

test("reported assessment prompts route to reports, not incidental diagnosis/test/deploy words", () => {
  for (const c of [
    "Aura, assess what still needs fixing before HQ is fully operational. Include engineering tools and tests. Report only; do not deploy.",
    'Aura, revise your assessment. “No issues reported” does not mean verified working. Mark areas without evidence as UNVERIFIED. If you cannot inspect a component, state the missing tool or access. Report only; make no changes.',
    "What else needs to be fixed to make HQ 100%?",
    "Show enterprise readiness status",
  ]) assert.equal(isReadinessAssessmentQuestion(c), true, c);
  for (const c of ["Run enterprise readiness certification", "Run the tests", "Fix the booking component", "Deploy HQ", "Connect QuickBooks", "Show software portfolio status"]) assert.equal(isReadinessAssessmentQuestion(c), false, c);
});

test("missing, partial, failed and dated evidence never becomes a blanket pass", () => {
  const empty = explainReadinessAssessment(null);
  assert.match(empty, /no saved readiness run/);
  assert.match(empty, /UNVERIFIED/);
  assert.doesNotMatch(empty, /no issues|100% complete|fully operational/i);
  const partial = explainReadinessAssessment({ completedAt: "2026-10-01T12:00:00Z", checks: [{ id: "db-ping", label: "Database SELECT 1", status: "pass" }, { id: "int-twilio", label: "Twilio", status: "fail" }] });
  assert.match(partial, /2026-10-01/);
  assert.match(partial, /stored evidence, not a fresh verification/);
  assert.match(partial, /Failures reported.*Twilio/);
  assert.match(partial, /Backup and restore: UNVERIFIED/);
});

test("unreviewed operational module builders are never executed, configuration checks remain unverified", async () => {
  let called = 0;
  const unsafe = await runReadOnlyModuleProbe({ id: "mod-integrations", probe: async () => { called++; throw Error("must not run"); } });
  assert.equal(called, 0);
  assert.equal(unsafe.unscored, true);
  const schema = await runReadOnlyModuleProbe({ id: "mod-notifications", probe: async () => ({ ok: true, detail: "Queue schema present" }) });
  assert.equal(schema.unscored, true);
  assert.match(schema.detail, /end-to-end.*UNVERIFIED/);
});

test("connection probes cannot request webhook repair, email sends or checkout orders", async () => {
  const calls: string[] = [];
  const read: ReadinessProbeReaders = {
    openai: async () => { calls.push("models-list"); return { ok: true }; },
    twilio: async () => { calls.push("phone-get"); return { healthy: false, phone: { found: true } }; },
    email: async () => { calls.push("email-server-get"); return { ok: true, provider: "postmark" }; },
    paypal: async () => { calls.push("oauth"); return { authenticated: true }; },
    database: async () => { calls.push("select-1"); },
  };
  const phone = await testReadOnlyIntegrationProvider("twilio", read);
  assert.equal(phone.success, false);
  assert.match(phone.message, /No webhooks changed/);
  const email = await testReadOnlyIntegrationProvider("transactional_email", read);
  assert.match(email.message, /postmark.*No email sent/);
  const paypal = await testReadOnlyIntegrationProvider("paypal", read);
  assert.equal(paypal.pending, true);
  assert.match(paypal.message, /no order created/);
  await testReadOnlyIntegrationProvider("openai_aura", read);
  await testReadOnlyIntegrationProvider("postgres", read);
  const before = calls.length;
  assert.equal((await testReadOnlyIntegrationProvider("quickbooks", read)).pending, true);
  assert.equal(calls.length, before);
  assert.deepEqual(calls, ["phone-get", "email-server-get", "oauth", "models-list", "select-1"]);
});

test("actual PayPal assessment only authenticates and never creates an order", async () => {
  const previousFetch = globalThis.fetch;
  process.env.PAYPAL_CLIENT_ID = "test-id";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  const urls: string[] = [];
  globalThis.fetch = async (url, options) => {
    urls.push(String(url));
    assert.match(String(url), /\/v1\/oauth2\/token$/);
    assert.equal(options?.method, "POST");
    return new Response(JSON.stringify({ access_token: "test-only", token_type: "Bearer" }), { status: 200 });
  };
  try {
    const { probePayPalAuthentication } = await import("../server/hq/paypalIntegrationEngine.ts");
    assert.equal((await probePayPalAuthentication()).authenticated, true);
    assert.equal(urls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
  }
});

test("Enterprise Readiness is found locally even with an empty/failing remote search, without duplicate module results", () => {
  const found = commandPaletteResults("Enterprise Readiness", HQ_NAV_ITEMS);
  assert.equal(found[0].path, "/hq/enterprise-readiness");
  assert.equal(commandPaletteResults("  readiness  ", HQ_NAV_ITEMS)[0].path, found[0].path);
  const merged = commandPaletteResults("Enterprise Readiness", HQ_NAV_ITEMS, [found[0], { type: "person", id: "p1", title: "Example", subtitle: "Person", path: "/hq/people/p1" }]);
  assert.equal(merged.filter((r) => r.path === found[0].path).length, 1);
  assert.ok(merged.some((r) => r.type === "person"));
  assert.equal(commandPaletteResults("no-match-123", HQ_NAV_ITEMS).length, 0);
});

test("configured Postmark is probed with GET only and does not require Resend or send mail", async () => {
  const oldFetch = globalThis.fetch;
  process.env.POSTMARK_SERVER_TOKEN = "test-only-postmark";
  const requests: string[] = [];
  globalThis.fetch = async (url, options) => {
    requests.push(String(url));
    assert.equal(String(url), "https://api.postmarkapp.com/server");
    assert.equal(options?.method ?? "GET", "GET");
    return new Response(JSON.stringify({ Name: "Test", DeliveryType: "Live" }), { status: 200 });
  };
  try {
    const p = await testReadOnlyIntegrationProvider("transactional_email");
    assert.equal(p.success, true);
    assert.match(p.message, /postmark.*No email sent/);
    assert.equal(requests.length, 1);
  } finally { globalThis.fetch = oldFetch; delete process.env.POSTMARK_SERVER_TOKEN; }
});

test("actual dispatcher answers the reported assessment without a model or a code diagnosis", async () => {
  const { runAuraCommand } = await import("../server/hq/auraCommandLayer.ts");
  const { resolveIdentityFromHqUser } = await import("../server/hq/auraFounderTrustEngine.ts");
  const identity = resolveIdentityFromHqUser({ user: { id: "founder-test", email: "service@ifcdc.org", role: "owner" } });
  const out = await runAuraCommand({ command: "Aura, revise your assessment. If you cannot inspect a component, state the missing tool. Assess Mac runner capabilities too; HQ needs to be fully operational. Report only; make no changes.", actorEmail: "service@ifcdc.org", identity });
  assert.equal(out.poweredBy, "AURA Readiness Assessment");
  assert.deepEqual(out.actions, []);
  assert.deepEqual(out.approvalsCreated, []);
  assert.match(out.reply, /UNVERIFIED/);
  assert.doesNotMatch(out.reply, /Code index had no strong match/);
  assert.equal(out.navigation?.path, "/hq/enterprise-readiness");
  const denied = await runAuraCommand({ command: "Show enterprise readiness status", actorEmail: "guest@example.test", identity: { ...identity, isFounder: false, founderMode: false, modules: [] } });
  assert.equal(denied.poweredBy, "AURA Trust Layer");
});

test("actual assessment run persists unknown acceptance tests and never runs operational builders", async () => {
  const oldFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (url) => { requests.push(String(url)); throw Error("external network not permitted in test"); };
  try {
    const { runEnterpriseReadinessCertification } = await import("../server/hq/enterpriseReadinessCertificationEngine.ts");
    const run = await runEnterpriseReadinessCertification({ actorEmail: "service@ifcdc.org", deepQuality: false, liveIntegrations: true });
    assert.equal(run.certified, false);
    assert.match(run.speechSummary, /not completion/);
    for (const id of ["grants", "backup", "memory", "engineering", "permissions", "notifications", "apps"]) {
      assert.equal(run.checks.find((c) => c.id === `acceptance-${id}`)?.status, "pending_manual");
      assert.ok(run.issues.some((i) => i.checkId === `acceptance-${id}`));
    }
    assert.ok(run.checks.find((c) => c.id === "int-transactional_email"));
    assert.ok(!run.checks.find((c) => c.id === "int-resend"));
    assert.equal(run.checks.find((c) => c.id === "mod-integrations")?.status, "pending_manual");
    assert.equal(run.checks.find((c) => c.id === "int-quickbooks")?.status, "pending_manual");
    assert.deepEqual(requests, []);
  } finally { globalThis.fetch = oldFetch; }
});
