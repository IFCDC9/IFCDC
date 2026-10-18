import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import {
  analyzeRecurringFunding,
  buildFounderFixtureBriefing,
  buildGrantsIntelligenceBriefing,
  founderMayReadGrantsBriefing,
  loadLiveGrantsIntelligenceRows,
  readAuthorizedGrantOpportunities,
  submitGrantsIntelligenceBriefing,
  RECURRING_FUNDING_ACCEPTANCE_FIXTURES,
  type FundingDimensionId,
} from "../server/hq/grantRecurringFundingEngine";
import { getDbPath } from "../server/config/dataPaths";

function dimension(id: FundingDimensionId, rowId: string) {
  const item = fixture(rowId).dimensions.find((entry) => entry.id === id);
  if (!item) throw new Error(`missing dimension ${id}`);
  return item;
}

function fixture(id: string) {
  const row = RECURRING_FUNDING_ACCEPTANCE_FIXTURES.find((item) => item.id === id);
  if (!row) throw new Error(`missing fixture ${id}`);
  return analyzeRecurringFunding(row, 80);
}

test("explicit exclusions are not allowable, including No fringe", () => {
  const supplies = fixture("fixture-private-supplies");
  assert.equal(supplies.fringeAllowed, "no");
  assert.equal(supplies.personnelAllowed, "no");
  assert.equal(supplies.administrativeAllowed, "no");
  assert.equal(supplies.indirectAllowed, "no");
  assert.equal(supplies.generalOperatingAllowed, "no");
  assert.equal(supplies.fundingCategory, "restricted_expenses");
  assert.notEqual(supplies.moneyStatus, "award");
  assert.notEqual(supplies.moneyStatus, "received_revenue");

  const shapes = ["No fringe", "fringe not allowed", "without fringe"];
  for (const phrase of shapes) {
    const profile = analyzeRecurringFunding({
      id: `neg-${phrase}`,
      description: `${phrase}. Personnel salaries allowed.`,
    }, 10);
    assert.equal(profile.fringeAllowed, "no", phrase);
  }

  const unknown = analyzeRecurringFunding({ id: "unknown-allow", description: "A listing with no expense language." }, 10);
  assert.equal(unknown.fringeAllowed, "unknown");
  assert.equal(unknown.personnelAllowed, "unknown");
  assert.notEqual(unknown.fringeAllowed, "yes");
});

test("a government contract ranks in its own category and is not an award or received revenue", () => {
  const contract = fixture("fixture-gov-contract-ops");
  assert.equal(contract.fundingCategory, "government_contract");
  assert.notEqual(contract.fundingCategory, "grant_opportunity");
  assert.notEqual(contract.fundingCategory, "recurring_operating_support");
  assert.notEqual(contract.fundingCategory, "restricted_capital");
  assert.equal(contract.moneyStatus, "potential_funding");
  assert.notEqual(contract.moneyStatus, "award");
  assert.notEqual(contract.moneyStatus, "received_revenue");
  assert.notEqual(contract.moneyStatus, "submitted_application");
  assert.equal(contract.personnelAllowed, "yes");
  assert.equal(contract.evidence.find((item) => item.field === "fundingCategory")?.phrase, "government contract");
});

test("fixtures keep programs, payroll, HR, administration, restricted expenses, and operating support apart", () => {
  const operating = fixture("fixture-samhsa-ccbhc");
  const grant = fixture("fixture-cdbg-ops");
  const capital = fixture("fixture-capital-equipment");
  const restricted = fixture("fixture-private-supplies");

  assert.equal(operating.fundingCategory, "recurring_operating_support");
  assert.equal(operating.recurringOperatingSupport, true);
  assert.equal(operating.personnelAllowed, "yes");
  assert.equal(operating.hrAllowed, "yes");
  assert.equal(operating.administrativeAllowed, "yes");
  assert.equal(operating.programAlignmentScore, 80);
  assert.match(operating.evidence.find((item) => item.field === "programs")?.phrase ?? "", /program/);

  assert.equal(grant.fundingCategory, "grant_opportunity");
  assert.equal(grant.personnelAllowed, "yes");
  assert.equal(grant.administrativeAllowed, "yes");
  assert.equal(grant.moneyStatus, "potential_funding");

  assert.equal(capital.fundingCategory, "restricted_capital");
  assert.equal(restricted.fundingCategory, "restricted_expenses");
  assert.equal(restricted.restrictedExpenses, true);
  assert.notEqual(restricted.fundingCategory, operating.fundingCategory);
});

test("potential funding, submitted applications, awards, and received revenue stay separate labels", () => {
  const potential = analyzeRecurringFunding({
    id: "label-potential",
    description: "Potential funding. Formula grant. Personnel salaries allowed.",
  }, 10);
  const submitted = analyzeRecurringFunding({
    id: "label-submitted",
    description: "Submitted application. Formula grant. Personnel salaries allowed.",
  }, 10);
  const award = analyzeRecurringFunding({
    id: "label-award",
    description: "Grant award notice. Personnel salaries allowed.",
  }, 10);
  const received = analyzeRecurringFunding({
    id: "label-received",
    description: "Received revenue. Funds received. Personnel salaries allowed.",
  }, 10);

  assert.deepEqual(
    [potential.moneyStatus, submitted.moneyStatus, award.moneyStatus, received.moneyStatus],
    ["potential_funding", "submitted_application", "award", "received_revenue"],
  );
  assert.equal(new Set([potential.moneyStatus, submitted.moneyStatus, award.moneyStatus, received.moneyStatus]).size, 4);
});

test("founder fixture briefing explains rankings without calling them live awards", () => {
  const briefing = buildFounderFixtureBriefing();
  assert.match(briefing, /local fixture/);
  assert.match(briefing, /not guaranteed money/);
  assert.match(briefing, /fixture-gov-contract-ops: category government_contract; money status potential_funding/);
  assert.match(briefing, /fixture-private-supplies: category restricted_expenses/);
  assert.match(briefing, /fringe matched "no fringe" => no/);
  assert.match(briefing, /fixture score \d+/);
  assert.equal(/guaranteed revenue/i.test(briefing), false);
  console.log(briefing);
});

test("classifications stay distinct and missing evidence stays unknown", () => {
  const operating = dimension("general_operating_grant", "fixture-samhsa-ccbhc");
  const multiyear = dimension("multiyear_award", "fixture-samhsa-ccbhc");
  const renewable = dimension("renewable_grant", "fixture-samhsa-ccbhc");
  const contract = dimension("government_contract", "fixture-gov-contract-ops");
  const contractAsGrant = dimension("general_operating_grant", "fixture-gov-contract-ops");
  const contractRenewable = dimension("renewable_grant", "fixture-gov-contract-ops");
  const contractDuration = dimension("multiyear_award", "fixture-gov-contract-ops");
  const blank = analyzeRecurringFunding({ id: "blank-evidence", description: "Listing without expense evidence." }, 0);

  assert.equal(operating.status, "yes");
  assert.equal(multiyear.status, "yes");
  assert.match(multiyear.note, /Duration only/);
  assert.equal(fixture("fixture-samhsa-ccbhc").moneyStatus, "potential_funding");
  assert.equal(renewable.status, "yes");
  assert.equal(dimension("payroll", "fixture-samhsa-ccbhc").status, "yes");
  assert.equal(dimension("hr", "fixture-samhsa-ccbhc").status, "yes");
  assert.equal(dimension("administration", "fixture-samhsa-ccbhc").status, "yes");
  assert.equal(dimension("allowable_indirect", "fixture-samhsa-ccbhc").status, "yes");
  assert.equal(dimension("government_contract", "fixture-samhsa-ccbhc").status, "unknown");

  assert.equal(contract.status, "yes");
  assert.equal(contractAsGrant.status, "no");
  assert.equal(contractRenewable.status, "no");
  assert.equal(contractDuration.status, "no");
  assert.match(contractDuration.note, /Not received money/);
  assert.equal(fixture("fixture-gov-contract-ops").moneyStatus, "potential_funding");
  assert.equal(dimension("hr", "fixture-cdbg-ops").status, "unknown");
  for (const item of blank.dimensions) assert.notEqual(item.status, "yes");
});

test("founder briefing separates fixture rows from live rows and does not open a database", () => {
  const briefing = buildGrantsIntelligenceBriefing();
  assert.equal(briefing.sendsMail, false);
  assert.equal(briefing.submitsGrant, false);
  assert.equal(briefing.spends, false);
  assert.equal(briefing.writesFundingRecords, false);
  assert.equal(briefing.liveConnected, false);
  assert.equal(briefing.rows.some((row) => row.source === "live"), false);
  for (const row of briefing.rows) {
    assert.equal(row.source, "fixture");
    assert.equal(row.fixtureLabel, "FIXTURE — not a live opportunity");
    assert.match(row.fundingSource, /FIXTURE — not a live opportunity/);
    assert.match(row.estimatedAmount, /fixture amount/);
    assert.match(row.score, /fixture score/);
    assert.equal(row.notGuaranteedMoney, true);
    assert.ok(row.eligibilityEvidence.length > 0);
    assert.ok(row.deadline.length > 0);
    assert.ok(row.allowableExpenses.length > 0);
    assert.ok(row.recommendedNextAction.includes("Do not submit"));
  }

  assert.deepEqual(loadLiveGrantsIntelligenceRows(), []);
  assert.deepEqual(loadLiveGrantsIntelligenceRows(null), []);
  const withMemory = buildGrantsIntelligenceBriefing({
    liveRows: [{
      id: "memory-only",
      funder: "Caller memory",
      title: "Already loaded row",
      description: "Potential funding. Personnel salaries allowed.",
    }],
  });
  const live = withMemory.rows.filter((row) => row.source === "live");
  assert.equal(live.length, 1);
  assert.equal(live[0]?.fixtureLabel, null);
  assert.equal(withMemory.liveConnected, false);

  const disguised = loadLiveGrantsIntelligenceRows([{ id: "fixture-disguised", title: "Nope", description: "Potential funding." }]);
  assert.equal(disguised[0]?.source, "fixture");

  assert.equal(founderMayReadGrantsBriefing(null), false);
  assert.equal(founderMayReadGrantsBriefing({ role: "grant_manager", email: "operator@example.com" }), false);
  assert.equal(founderMayReadGrantsBriefing({ role: "founder", email: "exec@ifcdc.org" }), true);
  assert.throws(() => submitGrantsIntelligenceBriefing(), /cannot submit/);

  const incomplete = loadLiveGrantsIntelligenceRows([{ id: "memory-incomplete", title: "Thin record", funder: "Caller memory" }]);
  assert.equal(incomplete[0]?.source, "incomplete");
  assert.equal(incomplete[0]?.eligible, false);
  assert.match(incomplete[0]?.recommendedNextAction ?? "", /not eligibility/);
  assert.match(incomplete[0]?.allowableExpenses ?? "", /UNKNOWN/);

  const evidenced = loadLiveGrantsIntelligenceRows([{
    id: "memory-evidenced",
    title: "Payroll support",
    funder: "Caller memory",
    description: "Potential funding. Personnel salaries allowed. No fringe.",
  }]);
  assert.equal(evidenced[0]?.source, "live");
  assert.equal(evidenced[0]?.fundingStatus, "potential_funding");
  assert.match(evidenced[0]?.allowableExpenses ?? "", /payroll yes/);
  assert.match(evidenced[0]?.allowableExpenses ?? "", /fringe no/);
  assert.match(evidenced[0]?.restrictions ?? "", /fringe not allowed/);
  assert.equal(evidenced[0]?.estimatedAmount, "UNKNOWN");

  const route = readFileSync(fileURLToPath(new URL("../server/routes/grants.routes.ts", import.meta.url)), "utf8");
  const at = route.indexOf('router.get("/intelligence/founder-briefing"');
  assert.equal(at > 0, true);
  const next = route.indexOf("router.", at + 20);
  const window = route.slice(at, next > at ? next : at + 900);
  assert.match(window, /founderMayReadGrantsBriefing/);
  assert.match(window, /grants_intelligence\.briefing\.read/);
  assert.match(window, /mode: "read_only"/);
  assert.equal(window.includes("persistRecurringFundingProfile"), false);
  assert.equal(window.includes("scoreOpenOpportunitiesRecurring"), false);
  assert.equal(window.includes("buildRecurringFundingPayrollCoverage"), false);
  assert.equal(window.includes("persistRecurringFundingProfile"), false);
});

test("authorized read uses a temp database and refuses the production path", async () => {
  const dir = fileURLToPath(new URL("../.test-data-fixture/", import.meta.url));
  process.env.IFCDC_DATA_DIR = dir;
  mkdirSync(dir, { recursive: true });
  const sqlitePath = `${dir}briefing-read.sqlite`;
  rmSync(sqlitePath, { force: true });
  const db = await open({ filename: sqlitePath, driver: sqlite3.Database });
  await db.exec(`CREATE TABLE grant_opportunities (
    id TEXT, title TEXT, funder TEXT, description TEXT, requirements TEXT, eligibility TEXT,
    deadline TEXT, amount_max INTEGER, funding_period TEXT, funder_type TEXT
  )`);
  await db.run(
    "INSERT INTO grant_opportunities (id, title, funder, description, deadline, amount_max) VALUES (?, ?, ?, ?, ?, ?)",
    "temp-live-1",
    "Temp operating support",
    "Temp funder",
    "Potential funding. General operating support. Administrative costs allowed. No fringe.",
    "UNKNOWN",
    1000,
  );
  await db.close();
  try {
    await assert.rejects(() => readAuthorizedGrantOpportunities({ sqlitePath: getDbPath() }), /production database/);
    const rows = await readAuthorizedGrantOpportunities({ sqlitePath });
    assert.equal(rows.length, 1);
    const briefing = buildGrantsIntelligenceBriefing({ liveRows: rows });
    const live = briefing.rows.find((row) => row.id === "temp-live-1");
    assert.equal(live?.source, "live");
    assert.match(live?.estimatedAmount ?? "", /not guaranteed money/);
    assert.match(live?.allowableExpenses ?? "", /fringe no/);
    assert.equal(briefing.liveConnected, false);
    assert.equal(briefing.writesFundingRecords, false);
  } finally {
    rmSync(sqlitePath, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
