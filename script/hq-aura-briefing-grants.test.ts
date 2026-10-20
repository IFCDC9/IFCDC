/**
 * Executive Daily Briefing grants section.
 * Temp database only. Does not open data/ifcdc.db, send mail, submit, or spend.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { hqAuthRequired } from "../server/middleware/hqAuth.ts";
import { resolveIdentityFromHqUser } from "../server/hq/auraFounderTrustEngine.ts";
import {
  founderMayReadGrantsBriefing,
  presentDailyBriefingGrants,
  readFounderGrantsBriefing,
  submitGrantsIntelligenceBriefing,
} from "../server/hq/grantRecurringFundingEngine.ts";

const FIXTURE_LABEL = "FIXTURE — not a live opportunity";

function refuseProductionGrantDatabase(databasePath: string): void {
  const resolved = path.resolve(databasePath);
  const productionDir = path.resolve(process.cwd(), "data");
  const base = path.basename(resolved);
  if (base === "ifcdc.db" || resolved === productionDir || resolved.startsWith(`${productionDir}${path.sep}`)) {
    throw new Error("Refusing to open the production database");
  }
}

async function openTempGrantDatabase(databasePath: string) {
  refuseProductionGrantDatabase(databasePath);
  return open({ filename: databasePath, driver: sqlite3.Database });
}

function sourceScore(score: string): number {
  const match = /score\s+(\d+)/.exec(score);
  return match ? Number(match[1]) : 0;
}

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("executive daily briefing includes the grants section on the founder path only", () => {
  const brain = readSource("../server/hq/auraEnterpriseBrainV1.ts");
  const start = brain.indexOf("export async function buildExecutiveDailyBriefingV1");
  const end = brain.indexOf("export type ProjectStatusMonitorV1");
  assert.equal(start > 0 && end > start, true);
  const daily = brain.slice(start, end);
  assert.match(daily, /readFounderGrantsBriefing\(await getDb\(\)\)/);
  assert.match(daily, /readFounderGrantsBriefing\(null\)/);
  assert.match(daily, /presentDailyBriefingGrants/);
  assert.match(daily, /grantsIntelligence/);
  assert.match(daily, /operatingFundingList/);
  assert.equal(daily.includes("logAuraBrainV1Action"), false);
  assert.doesNotMatch(daily, /\bfetch\(|https?:\/\//);
  assert.equal(brain.replace(daily, "").includes("readFounderGrantsBriefing"), false);
  assert.equal(readSource("../server/hq/executiveBriefings.ts").includes("readFounderGrantsBriefing"), false);

  const page = readSource("../client/src/pages/hq/AuraEnterpriseBrainV1Page.tsx");
  assert.match(page, /grantsIntelligence/);
  assert.match(page, /operatingFundingList/);
  assert.match(page, /Operating funding list/);
  assert.match(page, /Supporting source/);
  assert.match(page, /Next action/);
  assert.match(page, /Open-ended/);
  assert.match(page, /FIXTURE — not a live opportunity/);
  assert.match(page, /liveReadError/);
  assert.match(page, /Funding classification/);
  assert.match(page, /Eligibility evidence/);
  assert.match(page, /Payroll \/ HR \/ administration/);
  assert.match(page, /Recommended Founder action/);
  assert.match(page, /Funding status/);
  assert.match(page, /Estimated amount, not received income/);
  assert.match(page, /verifiedOpportunityCount/);
  assert.match(page, /stay separate/);
  assert.equal(page.includes("estimatedTotal"), false);

  const routes = readSource("../server/routes/hq.routes.ts");
  const at = routes.indexOf('"/aura/brain-v1/daily-briefing"');
  const next = routes.indexOf('"/aura/brain-v1/projects"');
  const window = routes.slice(at - 120, next);
  assert.match(window, /hqAuthRequired/);
  assert.match(window, /brain_v1\.daily_briefing\.read/);
  assert.match(window, /grants_intelligence\.briefing\.read/);
  assert.equal((window.match(/await logAuraBrainV1Action\(/g) || []).length, 1);
  assert.equal((window.match(/command:/g) || []).length, 1);
  const founderGate = window.indexOf("if (!identity.founderMode && !identity.isFounder)");
  const buildCall = window.indexOf("buildExecutiveDailyBriefingV1()");
  assert.equal(founderGate > 0 && buildCall > founderGate, true);
});

test("fixture labels stay, a live temp row is not a fixture, and incomplete or expired rows are not recommended", async () => {
  const failed = presentDailyBriefingGrants(await readFounderGrantsBriefing(null));
  assert.equal(failed.liveReadFailed, true);
  assert.equal(failed.liveReadError, "Grant Center records could not be read.");
  assert.equal(failed.verifiedOpportunityCount, 0);
  assert.equal(failed.operatingFundingList.label, "potential_funding");
  assert.equal(failed.operatingFundingList.readOnly, true);
  assert.equal(failed.operatingFundingList.items.length, 0);
  assert.equal(failed.rows.length > 0, true);
  assert.equal(failed.rows.every((row) => row.source === "fixture"), true);
  assert.equal(failed.rows.every((row) => row.fixtureLabel === FIXTURE_LABEL), true);

  const dir = mkdtempSync(path.join(os.tmpdir(), "ifcdc-briefing-grants-"));
  const sqlitePath = path.join(dir, "briefing-grants.sqlite");
  assert.throws(() => refuseProductionGrantDatabase(path.join(process.cwd(), "data", "ifcdc.db")), /production database/);
  const db = await openTempGrantDatabase(sqlitePath);
  await db.exec(`CREATE TABLE grant_opportunities (
    id TEXT, title TEXT, funder TEXT, description TEXT, amount_min REAL, amount_max REAL,
    status TEXT, deadline TEXT, requirements TEXT, source_type TEXT, funder_type TEXT,
    eligibility TEXT, funding_status TEXT, close_date TEXT, eligibility_result TEXT,
    funding_instrument TEXT, funding_period TEXT, applicant_restrictions TEXT,
    program_limitations TEXT, award_ceiling REAL, estimated_funding REAL
  )`);
  const insert = `INSERT INTO grant_opportunities
    (id, title, funder, description, amount_max, status, deadline, source_type, eligibility)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`;
  await db.run(insert, "live-county-payroll", "Payroll support", "County funder", "Potential funding. Personnel salaries allowed. HR and administration allowed. General operating support. Renewable.", 50000, "2027-06-01", "grants.gov", "Eligible nonprofit.");
  await db.run(insert, "live-supplies", "Supply purchase", "Private funder", "Potential funding. Supplies only. Administrative costs not allowed. No fringe.", 8000, "2027-08-01", "manual", "Restricted program supplies.");
  await db.run(insert, "thin-record", "Thin record", "Unknown funder", "", null, "", "", "");
  await db.run(insert, "expired-gos", "Expired operating support", "State funder", "Potential funding. General operating support. Renewable.", 25000, "2020-01-01", "grants.gov", "Eligible nonprofit.");
  await db.run(insert, "fixture-sneak", "Disguised fixture", "Fixture funder", "Potential funding. Personnel salaries allowed.", 999, "2027-01-01", "grants.gov", "Eligible.");
  await db.run(insert, "lane-submitted", "Submitted request", "County funder", "Submitted application. Personnel salaries allowed.", 1000, "2027-06-01", "grants.gov", "Eligible nonprofit.");
  await db.run(insert, "lane-award", "Award notice", "County funder", "Grant award. Personnel salaries allowed.", 2000, "2027-06-01", "grants.gov", "Eligible nonprofit.");
  await db.run(insert, "lane-received", "Cash posted", "County funder", "Received revenue. Personnel salaries allowed.", 3000, "2027-06-01", "grants.gov", "Eligible nonprofit.");
  await db.run(insert, "live-unknown-uses", "Neighborhood arts program", "City funder", "Potential funding. Eligibility unknown. Neighborhood arts program.", 4000, "2027-09-01", "manual", "Eligible nonprofit.");
  await db.run(insert, "live-open-ended-payroll", "Seasonal wages", "City funder", "Potential funding. Personnel salaries allowed.", 12000, "open-ended", "foundation", "Eligible nonprofit.");
  try {
    const section = presentDailyBriefingGrants(await readFounderGrantsBriefing(db));
    assert.equal(section.liveReadFailed, false);
    assert.equal(section.sendsMail, false);
    assert.equal(section.submitsGrant, false);
    assert.equal(section.spends, false);
    assert.equal(section.writesFundingRecords, false);
    assert.equal("estimatedTotal" in section, false);
    assert.equal("combinedAmount" in section, false);

    const live = section.rows.find((row) => row.id === "live-county-payroll");
    assert.equal(live?.source, "live");
    assert.equal(live?.fixtureLabel, null);
    assert.equal(live?.fundingSource.includes("FIXTURE"), false);
    assert.equal(live?.fundingClassification, "recurring_operating_support");
    assert.match(live?.eligibilityEvidence ?? "", /payroll/);
    assert.match(live?.allowableExpenses ?? "", /payroll yes/);
    assert.match(live?.allowableExpenses ?? "", /hr yes/);
    assert.match(live?.allowableExpenses ?? "", /administration yes/);
    assert.equal(live?.deadline, "2027-06-01");
    assert.match(live?.recommendedNextAction ?? "", /Not received revenue|not received revenue|Estimate only/);
    assert.equal(live?.fundingStatus, "potential_funding");
    assert.match(live?.estimatedAmount ?? "", /not received revenue/);

    for (const row of section.rows.filter((item) => item.source === "fixture")) {
      assert.equal(row.fixtureLabel, FIXTURE_LABEL);
      assert.match(row.fundingSource, /FIXTURE — not a live opportunity/);
    }
    const disguised = section.rows.find((row) => row.id === "fixture-sneak");
    assert.equal(disguised?.source, "fixture");
    assert.equal(disguised?.fixtureLabel, FIXTURE_LABEL);

    const thin = section.rows.find((row) => row.id === "thin-record");
    assert.equal(thin?.source, "incomplete");
    assert.equal(thin?.eligible, false);
    assert.match(thin?.recommendedNextAction ?? "", /Not recommended/);
    assert.match(thin?.allowableExpenses ?? "", /UNKNOWN/);

    const expired = section.rows.find((row) => row.id === "expired-gos");
    assert.equal(expired?.eligible, false);
    assert.match(expired?.recommendedNextAction ?? "", /Not eligible to pursue/);
    assert.match(expired?.recommendedNextAction ?? "", /deadline passed/);

    const verified = section.rows.filter((row) => row.source === "live" && row.eligible && row.fixtureLabel == null);
    assert.equal(section.verifiedOpportunityCount, verified.length);
    assert.equal(verified.some((row) => row.source === "fixture" || row.fixtureLabel != null), false);
    assert.equal(verified.some((row) => row.id === "thin-record" || row.id === "expired-gos" || row.id === "fixture-sneak"), false);

    const statuses = new Set(section.rows.map((row) => row.fundingStatus));
    for (const status of ["potential_funding", "submitted_application", "award", "received_revenue"]) {
      assert.equal(statuses.has(status as "potential_funding"), true, status);
    }
    assert.equal(section.rows.find((row) => row.id === "lane-submitted")?.fundingStatus, "submitted_application");
    assert.equal(section.rows.find((row) => row.id === "lane-award")?.fundingStatus, "award");
    assert.equal(section.rows.find((row) => row.id === "lane-received")?.fundingStatus, "received_revenue");

    const operating = section.operatingFundingList;
    assert.equal(operating.label, "potential_funding");
    assert.equal(operating.readOnly, true);
    const payrollItem = operating.items.find((item) => item.id === "live-county-payroll");
    const payrollEvidence = live?.eligibilityEvidence.split(";").map((part) => part.trim()).find((part) => part.startsWith("payroll "));
    const payrollPhrase = payrollEvidence?.slice(payrollEvidence.indexOf(":") + 1).trim();
    assert.equal(payrollItem?.source, "live");
    assert.equal(payrollItem?.fixtureLabel, null);
    assert.equal(payrollItem?.fundingStatus, "potential_funding");
    assert.equal(payrollItem?.payroll, "yes");
    assert.equal(payrollItem?.yesDimensions.includes("payroll"), true);
    assert.equal(payrollItem?.deadline, "2027-06-01");
    assert.equal(payrollItem?.openEnded, false);
    assert.equal(payrollItem?.nextAction, live?.recommendedNextAction);
    assert.equal(payrollItem?.supportingSource.includes(`payroll: ${payrollPhrase}`), true);
    assert.equal("estimatedAmount" in (payrollItem ?? {}), false);
    assert.equal("award" in (payrollItem ?? {}), false);
    assert.equal("endorsement" in (payrollItem ?? {}), false);

    const openEnded = operating.items.find((item) => item.id === "live-open-ended-payroll");
    const openEndedRow = section.rows.find((row) => row.id === "live-open-ended-payroll");
    assert.equal(openEnded?.source, "live");
    assert.equal(openEnded?.openEnded, true);
    assert.equal(openEnded?.deadline, "open-ended");
    assert.equal(openEnded?.nextAction, openEndedRow?.recommendedNextAction);
    assert.equal(openEnded?.payroll, "yes");

    assert.equal(operating.items.some((item) => item.id.startsWith("fixture-") || item.fixtureLabel != null), false);
    assert.equal(section.rows.some((row) => row.source === "fixture" && /payroll yes/.test(row.allowableExpenses)), true);
    assert.equal(operating.items.some((item) => item.id === "fixture-sneak"), false);

    const unknown = section.rows.find((row) => row.id === "live-unknown-uses");
    assert.equal(unknown?.source, "live");
    assert.equal(unknown?.fundingStatus, "potential_funding");
    assert.match(unknown?.allowableExpenses ?? "", /payroll UNKNOWN/);
    assert.match(unknown?.allowableExpenses ?? "", /hr UNKNOWN/);
    assert.match(unknown?.allowableExpenses ?? "", /administration UNKNOWN/);
    assert.equal(operating.items.some((item) => item.id === "live-unknown-uses"), false);
    for (const item of operating.items) {
      for (const dimension of ["payroll", "hr", "administration"] as const) {
        assert.equal(item[dimension] === "yes" || item[dimension] === "no" || item[dimension] === "unknown", true);
        if (item[dimension] === "unknown") assert.equal(item.yesDimensions.includes(dimension), false);
        assert.equal(String(item[dimension]) === "allowed", false);
      }
    }
    assert.equal(operating.items.some((item) => item.payroll === "unknown" && item.hr === "unknown" && item.administration === "unknown"), false);

    assert.equal(operating.items.some((item) => item.id === "lane-award" || item.id === "lane-received" || item.id === "lane-submitted"), false);
    assert.equal(section.rows.find((row) => row.id === "lane-award")?.fundingStatus, "award");
    assert.equal(section.rows.find((row) => row.id === "lane-received")?.fundingStatus, "received_revenue");
    assert.equal(section.rows.find((row) => row.id === "lane-submitted")?.fundingStatus, "submitted_application");

    const operatingAt = section.rows.findIndex((row) => row.id === "live-county-payroll");
    const suppliesAt = section.rows.findIndex((row) => row.id === "live-supplies");
    assert.equal(operatingAt >= 0 && suppliesAt > operatingAt, true);
    for (let i = 1; i < section.rows.length; i += 1) {
      assert.equal(sourceScore(section.rows[i - 1].score) >= sourceScore(section.rows[i].score), true);
    }
    assert.throws(() => submitGrantsIntelligenceBriefing(), /cannot submit/);
  } finally {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("logged-out and non-founder briefing access is rejected", () => {
  const state: { statusCode: number; body: unknown; nextCalled: boolean } = {
    statusCode: 0,
    body: undefined,
    nextCalled: false,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
      return this;
    },
  };
  hqAuthRequired(
    { cookies: {}, header: () => undefined } as unknown as Request,
    res as unknown as Response,
    (() => {
      state.nextCalled = true;
    }) as NextFunction,
  );
  assert.equal(state.statusCode, 401);
  assert.deepEqual(state.body, { error: "Authentication required" });
  assert.equal(state.nextCalled, false);

  assert.equal(founderMayReadGrantsBriefing(null), false);
  assert.equal(founderMayReadGrantsBriefing({ role: "grant_manager", email: "not-founder@example.test" }), false);
  const identity = resolveIdentityFromHqUser({
    user: { id: "operator", role: "grant_manager", email: "not-founder@example.test" },
    channel: "hq_web",
    sessionKey: "not-founder",
  });
  assert.equal(identity.founderMode, false);
  assert.equal(identity.isFounder, false);
  const anonymous = resolveIdentityFromHqUser({ user: null, channel: "hq_web", sessionKey: "anonymous" });
  assert.equal(anonymous.founderMode, false);
  assert.equal(anonymous.isFounder, false);
});

test("the briefing suite does not open production ifcdc.db", async () => {
  const productionDb = path.resolve(process.cwd(), "data", "ifcdc.db");
  assert.throws(() => refuseProductionGrantDatabase(productionDb), /production database/);
  assert.throws(() => refuseProductionGrantDatabase(path.resolve(process.cwd(), "data")), /production database/);
  await assert.rejects(() => openTempGrantDatabase(productionDb), /production database/);
  const self = readSource("./hq-aura-briefing-grants.test.ts");
  const helper = self.slice(self.indexOf("async function openTempGrantDatabase"), self.indexOf("function sourceScore"));
  const refuseAt = helper.indexOf("refuseProductionGrantDatabase(databasePath)");
  const openAt = helper.indexOf("return open(");
  assert.equal(refuseAt >= 0 && openAt > refuseAt, true);
  assert.match(self, /briefing-grants\.sqlite/);
  assert.doesNotMatch(helper, /ifcdc\.db/);
});
