import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import {
  analyzeRecurringFunding,
  buildFounderBriefingFromGrantCenter,
  buildFounderFixtureBriefing,
  buildGrantsIntelligenceBriefing,
  founderMayReadGrantsBriefing,
  GRANT_CENTER_OPPORTUNITY_SQL,
  loadLiveGrantsIntelligenceRows,
  readGrantCenterOpportunities,
  refuseProductionGrantDatabase,
  submitGrantsIntelligenceBriefing,
  RECURRING_FUNDING_ACCEPTANCE_FIXTURES,
  type FundingDimensionId,
} from "../server/hq/grantRecurringFundingEngine";

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
      source_type: "grants.gov",
      deadline: "2027-06-01",
      eligibility: "Eligible nonprofit in the service area.",
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
    source_type: "manual",
    deadline: "2027-06-01",
    eligibility: "Eligible nonprofit.",
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
  assert.equal(window.includes("getDb("), false);
  assert.match(window, /buildFounderBriefingFromGrantCenter\(null, null\)/);
  assert.match(window, /Founder Mode required/);
});

test("grant center adapter reads temp rows and refuses the production database", async () => {
  const productionDb = path.join(process.cwd(), "data", "ifcdc.db");
  let productionQueried = false;
  const productionSpy = {
    all: async () => {
      productionQueried = true;
      return [];
    },
  };
  assert.throws(() => refuseProductionGrantDatabase(productionDb), /production database/);
  assert.throws(() => refuseProductionGrantDatabase(path.join(process.cwd(), "data")), /production database/);
  await assert.rejects(() => readGrantCenterOpportunities(productionSpy, productionDb), /production database/);
  await assert.rejects(() => readGrantCenterOpportunities(productionSpy, "/var/data/ifcdc.db"), /production database/);
  assert.equal(productionQueried, false);
  assert.match(GRANT_CENTER_OPPORTUNITY_SQL, /^SELECT\b/);
  assert.doesNotMatch(GRANT_CENTER_OPPORTUNITY_SQL, /\b(INSERT|UPDATE|DELETE)\b/i);

  const empty = await buildFounderBriefingFromGrantCenter(null, null);
  assert.equal(empty.rows.every((row) => row.source === "fixture"), true);
  assert.equal(empty.liveConnected, false);
  assert.equal(founderMayReadGrantsBriefing(null), false);
  assert.equal(founderMayReadGrantsBriefing({ role: "grant_manager" }), false);
  assert.equal(founderMayReadGrantsBriefing({ role: "founder" }), true);

  const dir = fileURLToPath(new URL("../.test-data-fixture/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const sqlitePath = path.join(dir, "briefing-read.sqlite");
  rmSync(sqlitePath, { force: true });
  const db = await open({ filename: sqlitePath, driver: sqlite3.Database });
  await db.exec(`CREATE TABLE grant_opportunities (
    id TEXT, title TEXT, funder TEXT, description TEXT, amount_min REAL, amount_max REAL,
    status TEXT, deadline TEXT, requirements TEXT, source_type TEXT, funder_type TEXT,
    eligibility TEXT, funding_status TEXT, close_date TEXT, eligibility_result TEXT,
    funding_instrument TEXT, funding_period TEXT, applicant_restrictions TEXT,
    program_limitations TEXT, award_ceiling REAL, estimated_funding REAL
  )`);
  const insert = `INSERT INTO grant_opportunities
    (id, title, funder, description, amount_max, status, deadline, requirements, source_type, eligibility, applicant_restrictions, program_limitations)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  await db.run(insert, "live-payroll", "Payroll support", "County funder", "Potential funding. Personnel salaries allowed. No fringe.", 50000, "open", "2027-06-01", "", "grants.gov", "Eligible nonprofit in the service area.", "", "");
  await db.run(insert, "thin-record", "Thin record", "Unknown funder", "", null, "", "", "", "", "", "");
  await db.run(insert, "expired-gos", "Expired operating support", "State funder", "Potential funding. General operating support. Renewable.", 25000, "open", "2020-01-01", "", "grants.gov", "Eligible nonprofit.", "", "");
  await db.run(insert, "restricted-supplies", "Supply purchase", "Private funder", "Potential funding. Supplies only. Administrative costs not allowed. No fringe.", 18000, "open", "2027-08-01", "", "manual", "Restricted program supplies.", "Supplies only", "");
  await db.run(insert, "fixture-sneak", "Disguised fixture", "Fixture funder", "Potential funding. Personnel salaries allowed.", 999, "open", "2027-01-01", "", "grants.gov", "Eligible.", "", "");
  await db.run(insert, "open-ended-live", "Rolling support", "City funder", "Potential funding. HR and administration allowed.", 12000, "open", "open-ended", "", "grants.gov", "Eligible nonprofit.", "", "");
  try {
    const briefing = await buildFounderBriefingFromGrantCenter(db, sqlitePath);
    const row = (id: string) => briefing.rows.find((item) => item.id === id);
    const live = row("live-payroll");
    assert.equal(live?.source, "live");
    assert.equal(live?.eligible, true);
    assert.equal(live?.fundingStatus, "potential_funding");
    assert.match(live?.estimatedAmount ?? "", /estimated amount 50000/);
    assert.match(live?.estimatedAmount ?? "", /not received revenue/);
    assert.match(live?.allowableExpenses ?? "", /payroll yes/);
    assert.match(live?.allowableExpenses ?? "", /fringe no/);
    assert.match(live?.allowableExpenses ?? "", /indirect UNKNOWN|allowable_indirect UNKNOWN/);
    assert.match(live?.allowableExpenses ?? "", /hr UNKNOWN/);
    assert.match(live?.allowableExpenses ?? "", /administration UNKNOWN/);
    assert.match(live?.restrictions ?? "", /fringe not allowed/);
    assert.match(live?.renewal ?? "", /UNKNOWN/);
    assert.match(live?.score ?? "", /not received revenue/);

    const thin = row("thin-record");
    assert.equal(thin?.source, "incomplete");
    assert.equal(thin?.eligible, false);
    assert.match(thin?.allowableExpenses ?? "", /UNKNOWN/);
    assert.notEqual(thin?.source, "live");

    const expired = row("expired-gos");
    assert.equal(expired?.source, "live");
    assert.equal(expired?.eligible, false);
    assert.match(expired?.restrictions ?? "", /deadline passed/);
    assert.match(expired?.recommendedNextAction ?? "", /deadline passed/);
    assert.match(expired?.recommendedNextAction ?? "", /Not eligible to pursue/);

    const restricted = row("restricted-supplies");
    assert.equal(restricted?.source, "live");
    assert.match(restricted?.restrictions ?? "", /Supplies only|fringe not allowed|administration not allowed/);
    assert.match(restricted?.allowableExpenses ?? "", /fringe no/);
    assert.match(restricted?.allowableExpenses ?? "", /administration no/);

    const fixture = row("fixture-sneak");
    assert.equal(fixture?.source, "fixture");
    assert.equal(fixture?.fixtureLabel, "FIXTURE — not a live opportunity");
    assert.notEqual(fixture?.source, "live");

    const rolling = row("open-ended-live");
    assert.equal(rolling?.source, "live");
    assert.equal(rolling?.eligible, true);
    assert.doesNotMatch(rolling?.restrictions ?? "", /deadline passed/);
    assert.match(rolling?.allowableExpenses ?? "", /hr yes/);
    assert.match(rolling?.allowableExpenses ?? "", /administration yes/);
    assert.match(rolling?.allowableExpenses ?? "", /payroll UNKNOWN/);

    assert.equal(briefing.liveConnected, false);
    assert.equal(briefing.sendsMail, false);
    assert.equal(briefing.submitsGrant, false);
    assert.equal(briefing.spends, false);
    assert.equal(briefing.writesFundingRecords, false);
    assert.equal(briefing.rows.some((item) => item.id.startsWith("fixture-") && item.source === "live"), false);
  } finally {
    await db.close();
    rmSync(sqlitePath, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
