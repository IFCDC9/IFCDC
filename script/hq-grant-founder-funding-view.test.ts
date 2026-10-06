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
