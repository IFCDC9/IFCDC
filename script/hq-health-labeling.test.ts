import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  commandCenterHealthyValue,
  credentialOrRegistryDisposition,
  pendingRenderDeployCount,
  resendProbeDisposition,
  summarizeProbeStatuses,
} from "../server/hq/auraE2eDiagnosticsEngine";
import { labelPlatformService, labelRegistryApp } from "../server/hq/auraEnterpriseBrainV1";
import {
  emptyEnterpriseMonitoring,
  formatMonitorCardValue,
  integrationDisposition,
  labelAuthProbe,
  mailboxPollCard,
  overallFromComponents,
  presentCheckedRatio,
} from "../server/hq/enterpriseMonitoringEngine";

const at = "2026-10-14T03:47:34.380Z";

test("a configured credential is not healthy until a live call succeeds", () => {
  assert.equal(credentialOrRegistryDisposition(true, null), "configured");
  assert.notEqual(credentialOrRegistryDisposition(true, null), "healthy");
  assert.equal(credentialOrRegistryDisposition(true, true), "healthy");
  assert.equal(credentialOrRegistryDisposition(false, null), "not configured");
  assert.equal(integrationDisposition({ status: "connected", liveHealthy: null }), "configured");
  assert.notEqual(integrationDisposition({ status: "connected", liveHealthy: null }), "healthy");
});

test("a timeout is not a health score of 0 out of 1", () => {
  const ratio = presentCheckedRatio({
    timedOut: true,
    healthy: 0,
    checked: 0,
    notDeployed: 0,
    at,
    noun: "platform services",
  });
  assert.equal(ratio.status, "timed out");
  assert.equal(ratio.counted, false);
  assert.equal(ratio.detail.includes("0/1"), false);
  assert.match(ratio.detail, /timed out at 2026-10-14T03:47:34.380Z/);
  assert.equal(commandCenterHealthyValue({ healthyCount: 0, probesIncomplete: true, realFailureCount: 0 }), "timed out");
  const empty = emptyEnterpriseMonitoring();
  assert.equal(empty.overallStatus, "timed out");
  assert.equal(empty.degraded, false);
  assert.match(empty.warning || "", /not an outage/);
});

test("a localhost sidecar miss is not a Headquarters database outage", () => {
  const sidecar = labelPlatformService({
    id: "database",
    ok: false,
    url: "http://localhost:4104",
    probeSkipped: false,
    at,
  });
  assert.equal(sidecar.status, "not deployed");
  assert.match(sidecar.detail, /not the Headquarters database/);
  assert.equal(sidecar.detail.includes("SELECT 1"), false);
  const auth = labelAuthProbe({
    jwtConfigured: true,
    authService: false,
    authUrl: "http://localhost:4100",
    sidecarTimedOut: false,
    sessionCount: 1,
    at,
  });
  assert.equal(auth.status, "not deployed");
  assert.equal(auth.counted, false);
  assert.match(auth.detail, /not the Founder session/);
  assert.equal(auth.detail.includes("auth service down"), false);
});

test("registry development, mvp, and planned are not pending Render deploys", () => {
  assert.equal(pendingRenderDeployCount(["development", "mvp", "planned", "locked", "production"]), 0);
  const planned = labelRegistryApp({
    registryStatus: "planned",
    health: null,
    pollTimedOut: false,
    at,
  });
  assert.equal(planned.status, "configured");
  assert.match(planned.detail, /Not a pending Render deployment/);
  const shortcut = labelRegistryApp({
    registryStatus: "locked",
    health: { healthy: true, latencyMs: 0, deployment: "production-locked" },
    pollTimedOut: false,
    at,
  });
  assert.equal(shortcut.status, "configured");
  assert.match(shortcut.detail, /Not a timed live probe/);
  assert.equal(shortcut.detail.includes("Healthy · 0ms"), false);
});

test("a Resend-style partial probe stays degraded with its evidence", () => {
  assert.equal(resendProbeDisposition({ configured: true, probeRan: true, probeOk: false }), "degraded");
  assert.equal(
    integrationDisposition({ status: "degraded", liveHealthy: false }),
    "degraded"
  );
  assert.equal(integrationDisposition({ status: "not_configured", liveHealthy: null }), "not configured");
  assert.equal(resendProbeDisposition({ configured: true, probeRan: false, probeOk: null }), "configured");
});

test("summary counts configured and healthy separately", () => {
  const summary = summarizeProbeStatuses([
    "configured",
    "configured",
    "healthy",
    "degraded",
    "unknown",
    "timed out",
    "not deployed",
  ]);
  assert.equal(summary.configured, 2);
  assert.equal(summary.healthy, 1);
  assert.notEqual(summary.configured, summary.healthy);
  assert.equal(summary.degraded, 1);
  assert.equal(summary.partial, 1);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.unavailable, 2);
  assert.equal(summary.connected, summary.configured + summary.healthy);
  assert.ok(summary.connected > 0);
});

test("a timed-out card is not a zero health score", () => {
  const ratio = presentCheckedRatio({
    timedOut: true,
    healthy: 0,
    checked: 0,
    notDeployed: 0,
    at,
    noun: "platform services",
  });
  assert.equal(ratio.score, null);
  assert.equal(formatMonitorCardValue(ratio), "timed out");
  assert.equal(formatMonitorCardValue(ratio).includes("0/100"), false);
  assert.equal(formatMonitorCardValue({ status: "unknown", score: null, counted: false }), "unknown");
});

test("unknown and not-deployed services are excluded from the average", () => {
  const overall = overallFromComponents([
    { status: "healthy", score: 100, counted: true },
    { status: "degraded", score: 40, counted: true },
    { status: "unknown", score: 0, counted: false },
    { status: "not deployed", score: null, counted: false },
  ]);
  assert.equal(overall.overallScore, 70);
  assert.equal(overall.overallStatus, "degraded");
});

test("a degraded Resend-style result still flags health", () => {
  assert.equal(resendProbeDisposition({ configured: true, probeRan: true, probeOk: false }), "degraded");
  const overall = overallFromComponents([
    { status: "healthy", score: 100, counted: true },
    { status: "degraded", score: 50, counted: true },
    { status: "not configured", score: null, counted: false },
  ]);
  assert.equal(overall.overallScore, 75);
  assert.equal(overall.overallStatus, "degraded");
  assert.equal(integrationDisposition({ status: "not_configured", liveHealthy: null }), "not configured");
});

test("mailbox poll is shown only when a verified poll exists", () => {
  const missing = mailboxPollCard(null);
  assert.equal(missing.status, "unknown");
  assert.equal(missing.detail, "Mailbox poll is unavailable.");
  assert.equal(missing.detail.includes("2026-10-14T03:45:46.022Z"), false);
  const shown = mailboxPollCard({
    lastSuccessfulMailboxPoll: "2026-01-01T00:00:00.000Z",
    lastMailboxPollStatus: "ok",
  });
  assert.equal(shown.status, "healthy");
  assert.match(shown.detail, /2026-01-01T00:00:00.000Z/);
  assert.match(shown.detail, /No mail sent/);
});

test("unsigned monitoring stays behind Headquarters auth", () => {
  const routes = readFileSync(
    fileURLToPath(new URL("../server/routes/monitoring.routes.ts", import.meta.url)),
    "utf8"
  );
  const authAt = routes.indexOf("router.use(hqAuthRequired, requireHQModule(\"software_division\"))");
  const overviewAt = routes.indexOf("router.get(\"/overview\"");
  assert.equal(authAt >= 0 && overviewAt > authAt, true);
});
