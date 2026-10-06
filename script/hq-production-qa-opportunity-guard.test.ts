/**
 * Production Grant Center QA must not write live opportunities.
 * No network, no mail, no database write.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { productionOpportunityQaRequests } from "../script/grant-center-qa.mjs";
import { getGrantCenterQaReport } from "../server/hq/grantCenterQaCache.ts";
import {
  mutatingQaLaunchCount,
  productionGrantOpportunityWritesAllowed,
  runGrantCenterProductionQa,
  scheduleGrantCenterProductionQa,
} from "../server/hq/grantCenterProductionQaRunner.ts";

test("production startup does not create or update grant opportunities", async () => {
  const previous = process.env.NODE_ENV;
  const before = mutatingQaLaunchCount();
  process.env.NODE_ENV = "production";
  try {
    assert.equal(productionGrantOpportunityWritesAllowed(), false);
    assert.deepEqual(productionOpportunityQaRequests(), []);
    scheduleGrantCenterProductionQa(5001);
    const scheduled = getGrantCenterQaReport();
    assert.equal(scheduled.checks.some((check) => check.message.includes("does not create or update")), true);
    const report = await runGrantCenterProductionQa(5001);
    assert.equal(report.status, "pass");
    assert.equal(report.checks.some((check) => check.message.includes("does not create or update")), true);
    assert.equal(mutatingQaLaunchCount(), before);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("non-production QA can still describe opportunity writes", () => {
  assert.equal(productionGrantOpportunityWritesAllowed({ NODE_ENV: "test" }), true);
  const requests = productionOpportunityQaRequests({ NODE_ENV: "development" });
  assert.equal(requests.some((request) => request.method === "POST" && request.path === "/api/hq/grants/opportunities"), true);
  assert.equal(requests.some((request) => request.method === "PATCH" && request.path === "/api/hq/grants/opportunities"), true);
});
