import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_SEED = "false";
process.env.IFCDC_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ifcdc-aura-desk-"));
process.env.DATABASE_URL = "";
process.env.IFCDC_GRANTS_QA = "1";

const {
  persistDiscoveryCardsToGrantCenter,
  buildGrantCenterDeskSnapshot,
  formatExecutiveDeskSummary,
} = await import("../server/hq/auraGrantCenterExecutiveEngine");
const { ensureGrantTables } = await import("../server/hq/grantsSchema");
const { founderApprovalAllowed, AURA_OPERATOR } = await import("../server/hq/auraActorIdentity");
const { getAuraAction } = await import("../server/hq/auraActionRegistry");

test("Aura desk persists research into Grant Center without submitting or funding payroll", async () => {
  await ensureGrantTables();
  const cards = [
    {
      source: "Grants.gov Search2 (public Applicant API)",
      dateChecked: "2026-11-20T10:00:00.000Z",
      deadline: "2026-12-31",
      eligibilityEvidence: "Unknown",
      allowableCosts: "payroll Unknown; hr Unknown",
      matchRequirements: "Unknown",
      officialLink: "https://www.grants.gov/search-results-detail/test-nj",
      verification: "Official source checked" as const,
      title: "NJ community development test notice",
      funder: "Test Federal Agency",
      initiative: "nj_programs" as const,
      moneyStatus: "potential_funding" as const,
      matchScoreDisclaimer: "Match score Unknown — not eligibility and not guaranteed money",
      liveSearchPerformed: true as const,
      notGuaranteedMoney: true as const,
      amount: "Unknown",
    },
    {
      source: "ProPublica Nonprofit Explorer (990 profiles — not an open RFP)",
      dateChecked: "2026-11-20T10:00:00.000Z",
      deadline: "Unknown",
      eligibilityEvidence: "Unknown — 990 profile is not a current grant announcement",
      allowableCosts: "payroll Unknown",
      matchRequirements: "Unknown",
      officialLink: "https://projects.propublica.org/nonprofits/organizations/123",
      verification: "Official source checked" as const,
      title: "Detroit Community Foundation — foundation profile",
      funder: "Detroit Community Foundation",
      initiative: "detroit_initiative" as const,
      moneyStatus: "potential_funding" as const,
      matchScoreDisclaimer: "Match score Unknown — not eligibility and not guaranteed money",
      liveSearchPerformed: true as const,
      notGuaranteedMoney: true as const,
      amount: "Unknown",
    },
  ];
  const first = await persistDiscoveryCardsToGrantCenter(cards, "aura");
  assert.equal(first.inserted, 2);
  const second = await persistDiscoveryCardsToGrantCenter(cards, "aura");
  assert.equal(second.updated, 2);
  assert.equal(second.inserted, 0);
  const snap = await buildGrantCenterDeskSnapshot("all");
  assert.equal(snap.secondBrowserStore, false);
  assert.ok(snap.byInitiative.nj_programs.length >= 1);
  assert.ok(snap.byInitiative.detroit_initiative.length >= 1);
  assert.equal(snap.opportunities.every((row) => row.moneyStatus === "potential_funding"), true);
  assert.equal(founderApprovalAllowed({ id: AURA_OPERATOR.id, email: null, role: "aura", isFounder: false }), false);
  assert.equal(founderApprovalAllowed({ email: "exec@ifcdc.org", role: "founder", isFounder: true }), false);
});

test("registered desk action never claims submit", () => {
  const action = getAuraAction("run_grant_center_executive_desk");
  assert.ok(action);
  assert.equal(action?.kind, "prepare");
  assert.match(action?.description ?? "", /Does not submit/);
  const summary = formatExecutiveDeskSummary({
    auraOperator: { kind: "ai_operator", role: "aura", isFounder: false, founderApprovalAllowed: false, execExcluded: true },
    mode: "search_and_store",
    writesGrantCenter: true,
    submitsGrant: false,
    contactsFunders: false,
    acceptsAwards: false,
    purchasesProperty: false,
    commitsFunds: false,
    payrollFunded: false,
    notGuaranteedMoney: true,
    matchIsNotEligibility: true,
    initiative: "all",
    checkedAt: "2026-11-20T10:00:00.000Z",
    feeds: [],
    connectedFeeds: ["grants_gov"],
    blockedFeeds: [{ id: "dlba", label: "Detroit Land Bank Authority", officialManualPath: { url: "https://buildingdetroit.org", exportWhat: "export" }, missingCredentialNames: [] }],
    discovery: { queries: [], liveCards: 0 },
    persist: { inserted: 0, updated: 0, skipped: 0, ids: [] },
    snapshot: {
      store: "grant_center",
      secondBrowserStore: false,
      byInitiative: { nj_programs: [], detroit_initiative: [], shared_org: [], unknown: [] },
      opportunities: [],
      deadlines: [],
      documents: [],
      missingDocuments: [],
      applications: [],
      followUps: [],
    },
    hr: { kpis: { coverageGaps: 0 }, payrollNote: "Payroll is not funded until a confirmed award and reviewed terms." },
    prepared: [],
    walkthrough: { steps: [], founderApprovalRequired: true, execCannotApprove: true, neverAutoSubmits: true },
  } as Parameters<typeof formatExecutiveDeskSummary>[0]);
  assert.match(summary, /did not submit/);
  assert.match(summary, /buildingdetroit\.org/);
});
