/**
 * One production QA opportunity stays out of the Founder view and pipeline selectors.
 * No network, no mail, no database write.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildFounderFundingView } from "../server/hq/grantFounderFundingView.ts";
import {
  QUARANTINED_QA_OPPORTUNITY_ID,
  isQuarantinedQaOpportunity,
  selectPipelineNotificationIds,
} from "../server/hq/grantQaFixtureQuarantine.ts";

const FIXTURE = QUARANTINED_QA_OPPORTUNITY_ID;
const LEGITIMATE_MANUAL = "11111111-1111-4111-8111-111111111111";
const GRANTS_GOV = "22222222-2222-4222-8222-222222222222";

test("the quarantined QA fixture is excluded and legitimate rows stay in the Founder view", () => {
  const view = buildFounderFundingView({
    now: "2026-10-06T16:00:00.000Z",
    programs: [],
    opportunities: [
      { id: FIXTURE, title: "qa-grant-1 Opportunity", funder: "QA Foundation", status: "closed" },
      { id: LEGITIMATE_MANUAL, title: "Community apprenticeship", funder: "Local Foundation", status: "open" },
      { id: GRANTS_GOV, title: "Federal community development", funder: "Department of Labor", status: "open" },
    ],
  });
  const ids = view.opportunities.map((row) => row.id);
  assert.equal(ids.includes(FIXTURE), false);
  assert.equal(ids.includes(LEGITIMATE_MANUAL), true);
  assert.equal(ids.includes(GRANTS_GOV), true);
  assert.equal(view.libraryCount, 2);
  assert.equal(view.priority.some((row) => row.id === FIXTURE), false);
  assert.equal(isQuarantinedQaOpportunity(LEGITIMATE_MANUAL), false);
  assert.equal(isQuarantinedQaOpportunity("manual"), false);
});

test("pipeline and notification selection skips only the quarantined opportunity", () => {
  const selected = selectPipelineNotificationIds([
    { id: FIXTURE },
    { id: "app-qa", opportunityId: FIXTURE },
    { id: GRANTS_GOV },
    { id: "app-real", opportunityId: LEGITIMATE_MANUAL },
  ]);
  assert.deepEqual(selected, [GRANTS_GOV, "app-real"]);

  const pipeline = readFileSync(
    fileURLToPath(new URL("../server/hq/grantFundingPipelineEngine.ts", import.meta.url)),
    "utf8",
  );
  const stageStart = pipeline.indexOf("export async function syncAllPipelineStages");
  const stageEnd = pipeline.indexOf("export interface PipelineBoardItem");
  const scanStart = pipeline.indexOf("export async function runPipelineNotificationScan");
  const scanEnd = pipeline.indexOf("export async function runLivePipelineSync");
  const stage = pipeline.slice(stageStart, stageEnd);
  const scan = pipeline.slice(scanStart, scanEnd);
  assert.equal(stage.includes("excludeQuarantinedOpportunitySql"), true);
  assert.equal(stage.includes("excludeQuarantinedLinkedOpportunitySql"), true);
  assert.equal(scan.includes("excludeQuarantinedOpportunitySql"), true);
  assert.equal(scan.includes("excludeQuarantinedLinkedOpportunitySql"), true);
  assert.match(pipeline, /4 \* 60 \* 60_000/);
  const intelligence = readFileSync(
    fileURLToPath(new URL("../server/hq/grantIntelligenceEngine.ts", import.meta.url)),
    "utf8",
  );
  assert.match(intelligence, /SYNC_INTERVAL_MS = 6 \* 60 \* 60_000/);
});
