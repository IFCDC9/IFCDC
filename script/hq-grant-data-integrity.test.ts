import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { grantOpportunityAvailability } from "../shared/grantOpportunityAvailability";
import { grantOrganizationNameWarnings } from "../server/hq/grantNarrativeIntegrity";
import { excludeQaApplicationsSql, excludeQuarantinedOpportunitySql, isQaOpportunityRecord } from "../server/hq/grantQaFixtureQuarantine";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_SEED = "false";
process.env.IFCDC_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ifcdc-grant-integrity-"));
process.env.DATABASE_URL = "";
for (const key of ["OPENAI_API_KEY", "AURA_OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]) delete process.env[key];

const now = new Date("2026-10-29T12:00:00Z");
test("expired and closed listings are unavailable regardless of stale open status", () => {
  assert.equal(grantOpportunityAvailability({ status: "open", deadline: "2024-04-24" }, now).canStart, false);
  assert.equal(grantOpportunityAvailability({ status: "closed", deadline: "2027-01-01" }, now).canStart, false);
  assert.equal(grantOpportunityAvailability({ status: "open", deadline: "invalid" }, now).canStart, false);
  assert.equal(grantOpportunityAvailability({ status: "open", deadline: "2026-10-29" }, now).canStart, true);
  assert.equal(grantOpportunityAvailability({ status: "active", deadline: "2027-01-01" }, now).canStart, true);
  assert.match(grantOpportunityAvailability({ status: "open", deadline: null }, now).reason, /Verify/);
  assert.equal(grantOpportunityAvailability({ status: "open", deadline: "2026-02-30" }, now).canStart,false);
  assert.equal(grantOpportunityAvailability({ status: "open", deadline: "2026-10-29" }, new Date("2026-10-30T02:00:00Z")).canStart,true);
  assert.equal(grantOpportunityAvailability({ status: "open", deadline: "2026-10-29" }, new Date("2026-10-30T05:00:00Z")).canStart,false);
});
test("name drift is rejected against document-backed facts without rewriting drafts", () => {
  const legalName = "Imperial Foundation Community Development Center";
  const draft = "The Imperial Foundation Community Development Corporation (IFCDC) proposes a program.";
  assert.equal(grantOrganizationNameWarnings(draft, legalName).length, 1);
  assert.deepEqual(grantOrganizationNameWarnings("Imperial Foundation Community Development Center (IFCDC)", legalName), []);
  assert.deepEqual(grantOrganizationNameWarnings("Imperial Foundation Community Development Center", "Imperial Foundation Community Development Center (IFCDC)"), []);
  assert.deepEqual(grantOrganizationNameWarnings("Other Corporation funds IFCDC.", legalName), []);
});
test("actual list and financial metrics quarantine exact QA signatures, preserve legitimate and original rows", async () => {
  const { ensureGrantTables } = await import("../server/hq/grantsSchema");
  await ensureGrantTables();
  const { getDb } = await import("../server/db"); const db = await getDb();
  const { ensureGrantCenterTables } = await import("../server/hq/grantCenterEngine");
  await ensureGrantCenterTables();
  const { ensureGrantFeedSyncTables } = await import("../server/hq/grantFeedConnectors");
  await ensureGrantFeedSyncTables();
  for (const [id, title, funder] of [
    ["qa-opp", "qa-grant-1787079090692 Opportunity", "QA Foundation"],
    ["real-opp", "Youth mentoring", "Local Foundation"],
    ["similar-opp", "qa-grant-2026 Opportunity", "Real Foundation"],
    ["nontimestamp", "qa-grant-1abc Opportunity", "QA Foundation"],
  ]) await db.run("INSERT INTO grant_opportunities (id,title,funder,status,source_type,is_live,pipeline_stage,created_at,updated_at) VALUES (?,?,?,'open','grants_gov',1,'discovered',datetime('now'),datetime('now'))", id,title,funder);
  for (const [id, title, opp, amount] of [
    ["qa-app", "qa-grant-1787079090692 Application", "qa-opp", 25000],
    ["orphan-qa", "qa-grant-1787832971336 Application", null, 25000],
    ["linked-qa", "Renamed QA draft", "qa-opp", 25000],
    ["real-app", "Mentoring proposal", "real-opp", 12000],
    ["manual-app", "Independent proposal", null, 3000],
    ["similar-app", "qa-grant-1abc Application", "real-opp", 500],
  ]) await db.run("INSERT INTO grant_applications (id,title,opportunity_id,amount_requested,status,pipeline_stage,created_at,updated_at) VALUES (?,?,?,?,'draft','drafting',datetime('now'),datetime('now'))", id,title,opp,amount);
  assert.deepEqual((await db.all(`SELECT id FROM grant_applications WHERE 1=1${excludeQaApplicationsSql()} ORDER BY id`)).map(r=>r.id), ["manual-app","real-app","similar-app"]);
  assert.deepEqual((await db.all(`SELECT id FROM grant_opportunities WHERE 1=1${excludeQuarantinedOpportunitySql("id")} ORDER BY id`)).map(r=>r.id), ["nontimestamp","real-opp","similar-opp"]);
  const { listEnrichedApplications, buildGrantIntelligenceDashboard, startGrantApplicationWorkflow } = await import("../server/hq/grantIntelligenceEngine");
  assert.equal((await listEnrichedApplications()).applications.length,3);
  const dash = await buildGrantIntelligenceDashboard();
  assert.equal(dash.summary.drafts,3); assert.equal(dash.summary.totalPipelineValue,15500);
  const { buildPipelineMetricsDashboard, buildEnterprisePipelineBoard } = await import("../server/hq/grantFundingPipelineEngine");
  const metrics = await buildPipelineMetricsDashboard();
  assert.equal(metrics.metrics.totalPipelineValue,15500); assert.equal(metrics.metrics.applicationsInProgress,3);
  const board = await buildEnterprisePipelineBoard();
  assert.equal(board.columns.find(c=>c.stageKey==="drafting")?.count,3);
  assert.equal(board.columns.find(c=>c.stageKey==="drafting")?.value,15500);
  const { buildGrantFoundationDashboard } = await import("../server/hq/grantFoundationEngine");
  const foundation = await buildGrantFoundationDashboard();
  assert.equal(foundation.totalFundingRequested,15500);
  await db.run("UPDATE grant_opportunities SET deadline='2024-04-24' WHERE id='real-opp'");
  const before = (await db.get("SELECT COUNT(*) as n FROM grant_applications")).n;
  const rejected = await startGrantApplicationWorkflow("real-opp");
  assert.equal(rejected.ok,false); assert.match(rejected.error ?? "",/Deadline has passed/);
  assert.equal((await db.get("SELECT COUNT(*) as n FROM grant_applications")).n,before);
  assert.equal((await db.get("SELECT COUNT(*) as n FROM grant_applications")).n,6, "no historical row is deleted");
  assert.equal((await startGrantApplicationWorkflow("qa-opp")).ok,false);
  assert.equal(isQaOpportunityRecord({title:"qa-grant-1abc Opportunity", funder:"QA Foundation"}),false);
  await db.run("UPDATE grant_opportunities SET deadline='2099-01-01', amount_max=900000 WHERE id='similar-opp'");
  const started = await startGrantApplicationWorkflow("similar-opp", {generateDrafts:false});
  assert.equal(started.ok,true);
  const shell = await db.get("SELECT amount_requested FROM grant_applications WHERE opportunity_id='similar-opp'");
  assert.equal(shell.amount_requested,null,"award maximum must not inflate request totals");
  assert.equal((await db.get("SELECT funding_status FROM grant_opportunities WHERE id='similar-opp'")).funding_status,"reviewing");
});
test("production QA stops before fixture writes; UI describes section coverage independently", async () => {
  const { assertQaRequestAllowed } = await import("./grant-center-qa.mjs");
  for (const route of ["applications", "opportunities", "library/templates", "funders"]) {
    for (const method of ["POST", "PATCH", "DELETE"]) assert.throws(() => assertQaRequestAllowed(`https://hq.test/api/hq/grants/${route}`, { method }, { NODE_ENV: "production" }), /blocks fixture writes/);
  }
  assert.doesNotThrow(() => assertQaRequestAllowed("https://hq.test/api/auth/login", {method:"POST"}, {NODE_ENV:"production"}));
  assert.doesNotThrow(() => assertQaRequestAllowed("https://hq.test/api/hq/grants/applications", {}, {NODE_ENV:"production"}));
  const qa = readFileSync(new URL("./grant-center-qa.mjs", import.meta.url),"utf8");
  assert.match(qa, /Production QA skips all fixture writes/);
  assert.ok(qa.indexOf("Production QA skips all fixture writes") < qa.indexOf("const createApp"));
  const ui = readFileSync(new URL("../client/src/components/hq/grants/GrantCenterEnterprisePanels.tsx", import.meta.url),"utf8");
  assert.match(ui, /% draft sections filled/); assert.doesNotMatch(ui, /% complete`/);
  assert.match(ui, /!availability.canStart/);
});
