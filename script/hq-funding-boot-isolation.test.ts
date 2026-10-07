import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  fundingJobDeferredAfterRestart,
  isFundingWarehouseJob,
  noteFundingRestartDeferral,
  resetFundingRestartDeferral,
  selectStartupSafeProactiveAlerts,
  shouldRunFundingBootSync,
  shouldRunScheduledJobNow,
  startScheduledFundingJobs,
} from "../server/hq/fundingBootGate";

const root = new URL("../", import.meta.url);

function source(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

test("startup schedules funding timers and does not mutate feeds, scores, or pipeline", async () => {
  assert.equal(shouldRunFundingBootSync(), false);
  const calls: string[] = [];
  const result = startScheduledFundingJobs({
    syncGrantFeeds: async () => {
      calls.push("syncGrantFeeds");
      return [];
    },
    scheduleGrantIntelligenceSync: () => calls.push("scheduleGrantIntelligenceSync"),
    runGrantIntelligenceSync: async () => {
      calls.push("runGrantIntelligenceSync");
      return {};
    },
    enrichAllOpportunities: async () => {
      calls.push("enrichAllOpportunities");
      return 0;
    },
    scheduleLivePipelineSync: () => calls.push("scheduleLivePipelineSync"),
    runLivePipelineSync: async () => {
      calls.push("runLivePipelineSync");
      return {};
    },
    setTimeoutFn: (() => {
      calls.push("bootPipelineTimer");
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
  });
  assert.equal(result.bootSyncStarted, false);
  assert.deepEqual(calls, ["scheduleGrantIntelligenceSync", "scheduleLivePipelineSync"]);
});

test("approved scheduled jobs and the explicit sync route stay in place", () => {
  const intelligence = source("server/hq/grantIntelligenceEngine.ts");
  const pipeline = source("server/hq/grantFundingPipelineEngine.ts");
  const routes = source("server/routes/grants.routes.ts");
  const boot = source("server/bootstrap/initializeHqModules.ts");
  const scheduler = source("server/hq/warehouseScheduler.ts");

  assert.match(intelligence, /const SYNC_INTERVAL_MS = 6 \* 60 \* 60_000/);
  assert.match(intelligence, /export async function runGrantIntelligenceSync/);
  assert.match(intelligence, /syncGrantFeeds\(\{ providers: \["grants_gov", "sam_gov"\] \}\)/);
  assert.match(intelligence, /enrichAllOpportunities\(150\)/);
  assert.match(intelligence, /export function scheduleGrantIntelligenceSync/);
  assert.match(intelligence, /void runGrantIntelligenceSync\(\)/);

  assert.match(pipeline, /export async function runLivePipelineSync/);
  assert.match(pipeline, /syncGrantFeeds\(\{ providers: \["grants_gov", "sam_gov", "foundation_directory"\] \}\)/);
  assert.match(pipeline, /syncAllPipelineStages\(\)/);
  assert.match(pipeline, /runPipelineNotificationScan\(\)/);
  assert.match(pipeline, /export function scheduleLivePipelineSync/);
  assert.match(pipeline, /4 \* 60 \* 60_000/);
  assert.match(pipeline, /void runLivePipelineSync\(\)/);

  assert.match(routes, /router\.post\("\/feeds\/sync", async \(req, res\) => \{/);
  assert.match(routes, /const results = await syncGrantFeeds\(Array\.isArray\(providers\) \? \{ providers \} : undefined\)/);

  assert.match(boot, /startScheduledFundingJobs\(/);
  assert.match(boot, /syncGrantFeeds: \(\) => feeds\.syncGrantFeeds\(\)/);
  assert.match(boot, /includeFundingAlerts: false/);
  assert.doesNotMatch(boot, /syncGrantFeeds\(\)\.then/);
  assert.doesNotMatch(boot, /return runGrantIntelligenceSync\(\)/);
  assert.doesNotMatch(boot, /void runLivePipelineSync\(\)/);
  assert.match(scheduler, /if \(shouldRunFundingBootSync\(\)\)/);
  assert.match(scheduler, /runPipelineDeadlineScan\(\)/);
  assert.match(scheduler, /runDueScheduledJobs\("system-scheduler", \{ catchUp: true \}\)/);
  assert.match(scheduler, /setInterval\(\(\) => \{\s*runDueScheduledJobs\("system-scheduler"\)/);
});

test("startup proactive scan drops grant and compliance alerts and keeps non-funding alerts", () => {
  const kept = selectStartupSafeProactiveAlerts(
    [
      { dedupeKey: "grants:deadline7:2", sourceModule: "grants", title: "grant deadline" },
      { dedupeKey: "compliance:overdue:1", sourceModule: "compliance", title: "grant compliance" },
      { dedupeKey: "tech:disk", sourceModule: "aura_technical", title: "disk" },
      { dedupeKey: "deploy:misaligned", sourceModule: "render", title: "deploy" },
      { dedupeKey: "approvals:pending:4", sourceModule: "workflows", title: "approvals waiting" },
    ],
    false,
  );
  assert.deepEqual(kept.map((row) => row.dedupeKey), ["tech:disk", "deploy:misaligned", "approvals:pending:4"]);

  const proactive = source("server/hq/auraProactiveIntelligence.ts");
  assert.match(proactive, /selectStartupSafeProactiveAlerts\(/);
  assert.match(proactive, /includeFundingAlerts/);
  assert.match(proactive, /buildOrgWideGrantMatches/);
  assert.doesNotMatch(
    source("server/bootstrap/initializeHqModules.ts"),
    /evaluateAndEmitProactiveAlerts\(\{ notifyFounderChannels: false \}\)/,
  );
});

test("restart catch-up skips overdue funding jobs and later cadence can run them", () => {
  resetFundingRestartDeferral();
  const now = 1_700_000_000_000;
  const overdue = [
    "grant_deadlines",
    "compliance_reminders",
    "warehouse_snapshot",
    "db_backup",
    "executive_report_daily",
    "onboarding_check",
    "aura_autonomous_ops",
  ];
  const catchUpRan = overdue.filter((jobKey) =>
    shouldRunScheduledJobNow({ jobKey, due: true, catchUp: true, now }),
  );
  assert.deepEqual(catchUpRan, [
    "warehouse_snapshot",
    "db_backup",
    "executive_report_daily",
    "onboarding_check",
    "aura_autonomous_ops",
  ]);
  assert.equal(isFundingWarehouseJob("grant_deadlines"), true);
  assert.equal(isFundingWarehouseJob("compliance_reminders"), true);
  assert.equal(isFundingWarehouseJob("warehouse_snapshot"), false);

  noteFundingRestartDeferral("grant_deadlines", now);
  noteFundingRestartDeferral("compliance_reminders", now);
  assert.equal(
    shouldRunScheduledJobNow({ jobKey: "grant_deadlines", due: true, catchUp: false, now: now + 60_000 }),
    false,
  );
  assert.equal(fundingJobDeferredAfterRestart("compliance_reminders", now + 60_000), true);
  const day = 24 * 60 * 60 * 1000;
  assert.equal(
    shouldRunScheduledJobNow({ jobKey: "grant_deadlines", due: true, catchUp: false, now: now + day }),
    true,
  );
  assert.equal(
    shouldRunScheduledJobNow({ jobKey: "compliance_reminders", due: true, catchUp: false, now: now + day }),
    true,
  );

  const engine = source("server/hq/workflowEngine.ts");
  assert.match(engine, /case "grant_deadlines"/);
  assert.match(engine, /case "compliance_reminders"/);
  assert.match(engine, /await generateGrantNotifications\(\)/);
  assert.match(engine, /skipGrantApprovals: opts\?\.catchUp === true/);
  assert.match(engine, /includeFundingAlerts: opts\?\.catchUp !== true/);
  assert.match(engine, /noteFundingRestartDeferral\(job\.job_key, now\)/);
  resetFundingRestartDeferral();
});
