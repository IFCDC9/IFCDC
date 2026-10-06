/**
 * Read-only Founder funding view.
 * No network, no mail, no SAM.gov, no grant submit, no approval write.
 * HTTP auth is the existing grants router gate; this file boots only hqAuthRequired.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";
import { hqAuthRequired } from "../server/middleware/hqAuth.ts";
import {
  buildFounderFundingView,
  founderFundingMatchPrograms,
  type FounderFundingSource,
} from "../server/hq/grantFounderFundingView.ts";
import { IFCDC_FUNDING_DIVISIONS } from "../server/hq/grantFundingEngine.ts";

const now = "2026-10-05T16:00:00.000Z";

function mockRes() {
  const state: { statusCode: number; body: unknown } = { statusCode: 0, body: undefined };
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
  return { state, res: res as unknown as Response };
}

const programs = founderFundingMatchPrograms();

function source(extra: Partial<FounderFundingSource> = {}): FounderFundingSource {
  return {
    now,
    programs,
    opportunities: [],
    applications: [],
    budgets: [],
    awards: [],
    compliance: [],
    renewals: [],
    ...extra,
  };
}

test("unauthenticated HQ middleware stays 401 and the funding view route sits behind it", () => {
  const unauthenticated = mockRes();
  hqAuthRequired(
    { cookies: {}, header: () => undefined } as unknown as Request,
    unauthenticated.res,
    (() => { throw new Error("next should not run"); }) as NextFunction,
  );
  assert.equal(unauthenticated.state.statusCode, 401);
  assert.deepEqual(unauthenticated.state.body, { error: "Authentication required" });

  const routes = readFileSync(fileURLToPath(new URL("../server/routes/grants.routes.ts", import.meta.url)), "utf8");
  const authAt = routes.indexOf("router.use(hqAuthRequired, requireHQModule(\"grants\"))");
  const viewAt = routes.indexOf("router.get(\"/founder-funding-view\"");
  assert.equal(authAt >= 0 && viewAt > authAt, true);
});

test("fixture opportunities produce a Founder view without calling submit, approve, or insert", () => {
  const builder = readFileSync(fileURLToPath(new URL("../server/hq/grantFounderFundingView.ts", import.meta.url)), "utf8");
  assert.equal(/\bINSERT INTO\b|\bUPDATE\s|\bDELETE FROM\b|setFounderApproval|confirmPortalSubmission|sam\.gov|grants\.gov/i.test(builder), false);

  const barbers = IFCDC_FUNDING_DIVISIONS.find((division) => division.slug === "barbers");
  assert.ok(barbers);
  assert.equal(barbers.programs.includes("workforce"), true);
  assert.equal(barbers.programs.includes("vocational_training"), true);
  assert.equal(programs.some((program) => program.slug === "barbers"), true);
  assert.equal(programs.some((program) => program.slug === "small_business"), true);
  assert.equal(programs.some((program) => program.slug === "software_division"), true);

  const view = buildFounderFundingView(source({
    opportunities: [
      {
        id: "workforce-1",
        title: "Barber vocational training and workforce apprenticeship",
        funder: "NJ Department of Labor",
        description: "Vocational training for community workforce placement.",
        eligibility: "501(c)(3) workforce providers",
        status: "open",
        deadline: "2026-11-15",
        amountMin: 50000,
        amountMax: 125000,
        programAreas: ["workforce", "vocational_training"],
        divisionSlugs: ["barbers"],
      },
      {
        id: "decided-1",
        title: "Already decided operating grant",
        funder: "Example Foundation",
        status: "open",
        amountMax: 10000,
      },
    ],
    applications: [
      {
        id: "app-workforce",
        opportunityId: "workforce-1",
        status: "draft",
        founderApprovalStatus: "pending",
        readyToSubmit: 0,
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "app-decided",
        opportunityId: "decided-1",
        status: "submitted",
        founderApprovalStatus: "approved",
        readyToSubmit: 1,
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    budgets: [{ applicationId: "app-workforce", totalRequested: 90000, hasLineItems: true }],
    awards: [{ id: "award-1", opportunityId: "workforce-1", applicationId: "app-workforce", amount: 80000, status: "active" }],
    compliance: [{ awardId: "award-1", status: "pending" }],
    renewals: [{ originalAwardId: "award-1", newOpportunityId: null, status: "planned" }],
  }));

  assert.equal(view.readOnly, true);
  assert.equal(view.externalFetch, "not_called");
  assert.equal(view.submissionsExecuted, false);
  assert.equal(view.approvalsExecuted, false);
  assert.equal(view.libraryCount, 2);
  assert.equal(view.priority[0]?.id, "workforce-1");

  const match = view.opportunities.find((row) => row.id === "workforce-1");
  assert.ok(match);
  assert.equal(match.programMatch.status, "available");
  assert.equal(match.programMatch.status === "available" && match.programMatch.value.slug, "barbers");
  assert.equal(match.barbersWorkforceRelevant.status, "available");
  assert.equal(match.barbersWorkforceRelevant.status === "available" && match.barbersWorkforceRelevant.value, true);
  assert.deepEqual(match.fundingAmount, { status: "available", value: { min: 50000, max: 125000 } });
  assert.equal(match.deadline.status, "available");
  assert.equal(match.renewable.status, "available");
  assert.equal(match.renewable.status === "available" && match.renewable.value, true);
  assert.equal(match.proposalStatus.status === "available" && match.proposalStatus.value, "draft");
  assert.equal(match.budgetStatus.status, "available");
  assert.equal(match.founderApprovalStatus.status === "available" && match.founderApprovalStatus.value, "pending");
  assert.equal(match.submissionReadiness.status, "unavailable");
  assert.equal(match.awardStatus.status === "available" && match.awardStatus.value.status, "active");
  assert.equal(match.complianceStatus.status === "available" && match.complianceStatus.value, "pending");
  assert.equal(JSON.stringify(view).includes("approved") && view.opportunities.some((row) => row.id === "workforce-1" && row.founderApprovalStatus.value === "approved"), false);
});

test("missing stored fields stay unavailable instead of a decided zero or false", () => {
  const view = buildFounderFundingView(source({
    opportunities: [
      { id: "bare-1", title: "General operating support", funder: "Unspecified" },
      { id: "empty-1", title: "", funder: "" },
    ],
  }));
  const row = view.opportunities.find((item) => item.id === "bare-1");
  const empty = view.opportunities.find((item) => item.id === "empty-1");
  assert.ok(row);
  assert.ok(empty);
  assert.equal(row.eligibility.status, "unavailable");
  assert.equal(row.fundingAmount.status, "unavailable");
  assert.equal(row.fundingAmount.value, null);
  assert.equal(row.deadline.status, "unavailable");
  assert.equal(row.renewable.status, "unavailable");
  assert.equal(row.renewable.value, null);
  assert.equal(row.proposalStatus.status, "unavailable");
  assert.equal(row.budgetStatus.status, "unavailable");
  assert.equal(row.founderApprovalStatus.status, "unavailable");
  assert.equal(row.founderApprovalStatus.value, null);
  assert.equal(row.submissionReadiness.status, "unavailable");
  assert.equal(row.submissionReadiness.value, null);
  assert.equal(row.awardStatus.status, "unavailable");
  assert.equal(row.complianceStatus.status, "unavailable");
  assert.equal(empty.barbersWorkforceRelevant.status, "unavailable");
  assert.equal(empty.barbersWorkforceRelevant.value, null);
  const stored = JSON.stringify({
    eligibility: row.eligibility,
    fundingAmount: row.fundingAmount,
    deadline: row.deadline,
    renewable: row.renewable,
    proposalStatus: row.proposalStatus,
    budgetStatus: row.budgetStatus,
    founderApprovalStatus: row.founderApprovalStatus,
    submissionReadiness: row.submissionReadiness,
    awardStatus: row.awardStatus,
    complianceStatus: row.complianceStatus,
  });
  assert.equal(stored.includes("\"value\":0"), false);
  assert.equal(stored.includes("\"value\":false"), false);
});

test("amount labels stay separate and a missing deadline stays unavailable", () => {
  const builder = readFileSync(fileURLToPath(new URL("../server/hq/grantFounderFundingView.ts", import.meta.url)), "utf8");
  assert.equal(/\bINSERT INTO\b|\bUPDATE\s|\bDELETE FROM\b|setFounderApproval|confirmPortalSubmission|sam\.gov|grants\.gov/i.test(builder), false);

  const view = buildFounderFundingView(source({
    opportunities: [
      {
        id: "range-1",
        title: "Floor and ceiling only",
        awardFloor: 25000,
        awardCeiling: 100000,
        totalProgramFunding: 5000000,
      },
      {
        id: "individual-1",
        title: "Individual cap",
        maxIndividualAward: 15000,
        totalProgramFunding: 900000,
      },
      {
        id: "program-1",
        title: "Program estimate",
        estimatedFunding: 750000,
        totalProgramFunding: 750000,
      },
      {
        id: "normalized-1",
        title: "Normalized pair",
        amountMin: 10000,
        amountMax: 40000,
        estimatedFunding: 400000,
      },
      { id: "none-1", title: "No amounts and no date" },
      { id: "close-1", title: "Close date only", closeDate: "2026-12-01" },
      { id: "stored-1", title: "Stored deadline", deadline: "2026-11-02", closeDate: "2026-12-31" },
    ],
  }));

  const range = view.opportunities.find((row) => row.id === "range-1");
  const individual = view.opportunities.find((row) => row.id === "individual-1");
  const program = view.opportunities.find((row) => row.id === "program-1");
  const normalized = view.opportunities.find((row) => row.id === "normalized-1");
  const none = view.opportunities.find((row) => row.id === "none-1");
  const closeOnly = view.opportunities.find((row) => row.id === "close-1");
  const stored = view.opportunities.find((row) => row.id === "stored-1");
  assert.ok(range && individual && program && normalized && none && closeOnly && stored);

  assert.equal(range.awardRange.status, "available");
  assert.deepEqual(range.awardRange.status === "available" && range.awardRange.value, {
    label: "Award Range",
    min: 25000,
    max: 100000,
  });
  assert.equal(range.maximumIndividualAward.status, "unavailable");
  assert.equal(range.estimatedProgramFunding.status, "available");
  assert.equal(range.estimatedProgramFunding.status === "available" && range.estimatedProgramFunding.value.totalProgram, 5000000);
  assert.equal(range.maximumIndividualAward.value, null);

  assert.equal(individual.maximumIndividualAward.status, "available");
  assert.equal(individual.maximumIndividualAward.status === "available" && individual.maximumIndividualAward.value.amount, 15000);
  assert.equal(individual.maximumIndividualAward.status === "available" && individual.maximumIndividualAward.value.label, "Maximum Individual Award");
  assert.equal(individual.awardRange.status, "unavailable");
  assert.notEqual(individual.maximumIndividualAward.status === "available" && individual.maximumIndividualAward.value.amount, 900000);

  assert.equal(program.awardRange.status, "unavailable");
  assert.equal(program.maximumIndividualAward.status, "unavailable");
  assert.deepEqual(program.estimatedProgramFunding.status === "available" && program.estimatedProgramFunding.value, {
    label: "Estimated/Total Program Funding",
    estimated: 750000,
    totalProgram: 750000,
  });

  assert.deepEqual(normalized.awardRange.status === "available" && normalized.awardRange.value, {
    label: "Award Range",
    min: 10000,
    max: 40000,
  });
  assert.equal(normalized.estimatedProgramFunding.status, "available");
  assert.equal(normalized.maximumIndividualAward.status, "unavailable");

  assert.equal(none.fundingAmount.status, "unavailable");
  assert.equal(none.awardRange.status, "unavailable");
  assert.equal(none.maximumIndividualAward.status, "unavailable");
  assert.equal(none.estimatedProgramFunding.status, "unavailable");
  assert.equal(none.deadline.status, "unavailable");
  assert.equal(none.deadlineSource, null);

  assert.equal(closeOnly.deadline.status, "available");
  assert.equal(closeOnly.deadline.status === "available" && closeOnly.deadline.value, "2026-12-01");
  assert.equal(closeOnly.deadlineSource, "close_date");
  assert.equal(stored.deadline.status === "available" && stored.deadline.value, "2026-11-02");
  assert.equal(stored.deadlineSource, "deadline");
});

test("freshness labels follow stored dates and renewable evidence", () => {
  const view = buildFounderFundingView(source({
    opportunities: [
      { id: "new-1", title: "Posted this week", postedDate: "2026-09-25", deadline: "2026-12-20" },
      { id: "updated-1", title: "Changed this week", postedDate: "2026-01-01", updatedAt: "2026-10-01", deadline: "2026-12-20" },
      { id: "active-1", title: "Open later", status: "open", deadline: "2026-12-20" },
      { id: "soon-1", title: "Due next week", deadline: "2026-10-15" },
      { id: "expired-1", title: "Already closed", deadline: "2026-10-01" },
      { id: "word-1", title: "Renew the community workforce grant", deadline: "2026-12-20" },
      { id: "row-1", title: "Linked renewal record", deadline: "2026-12-20" },
      { id: "flag-1", title: "Stored renewal flag", deadline: "2026-12-20", renewalFlag: true },
      { id: "edge-new", title: "Posted on the window edge", postedDate: "2026-09-21", deadline: "2026-12-20" },
      { id: "edge-old", title: "Posted outside the window", postedDate: "2026-09-20", deadline: "2026-12-20" },
      { id: "edge-soon", title: "Closes on day 14", deadline: "2026-10-19" },
      { id: "edge-active", title: "Closes on day 15", deadline: "2026-10-20" },
    ],
    renewals: [{ newOpportunityId: "row-1", status: "planned" }],
  }));
  const labels = (id: string) => {
    const row = view.opportunities.find((item) => item.id === id);
    assert.ok(row);
    assert.equal(row.freshness.status, "available");
    return row.freshness.status === "available" ? row.freshness.value : [];
  };
  assert.deepEqual(labels("new-1"), ["NEW"]);
  assert.deepEqual(labels("updated-1"), ["UPDATED"]);
  assert.deepEqual(labels("active-1"), ["ACTIVE"]);
  assert.deepEqual(labels("soon-1"), ["CLOSING SOON"]);
  assert.deepEqual(labels("expired-1"), ["EXPIRED"]);
  assert.deepEqual(labels("word-1"), ["ACTIVE"]);
  assert.equal(view.opportunities.find((row) => row.id === "word-1")?.renewable.status, "unavailable");
  assert.ok(labels("row-1").includes("RENEWABLE"));
  assert.equal(view.opportunities.find((row) => row.id === "row-1")?.renewable.status, "available");
  assert.ok(labels("flag-1").includes("RENEWABLE"));
  assert.equal(view.opportunities.find((row) => row.id === "flag-1")?.renewable.status, "available");
  assert.ok(labels("edge-new").includes("NEW"));
  assert.equal(labels("edge-old").includes("NEW"), false);
  assert.deepEqual(labels("edge-soon"), ["CLOSING SOON"]);
  assert.deepEqual(labels("edge-active"), ["ACTIVE"]);
});
