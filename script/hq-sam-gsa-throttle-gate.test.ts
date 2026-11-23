/**
 * HQ limiter vs GSA throttle, SAM auto-retry gate, Connected only after live OK.
 * No network, no production DB.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyIntegrationError,
  GSA_THROTTLE_MESSAGE,
  HQ_API_LIMITER_MESSAGE,
  isGsaThrottleMessage,
  isHqLimiterMessage,
  rememberSamLiveResult,
  resetSamGovProbeGateForTests,
  resetSamGovStatusCache,
  samHubStatusFromLive,
  shouldAutoRetrySam,
  shouldSkipLiveSamProbe,
  shouldStartupRetryCard,
} from "../server/hq/samGovProbePolicy.ts";
import { HQ_API_LIMITER_MESSAGE as HQ_LIMITER_FROM_SECURITY } from "../server/hq/samGovProbePolicy.ts";
import { probeSamGovEntityLive } from "../server/hq/grantFeedConnectors.ts";

test("HQ limiter copy is distinct from GSA Message throttled out", () => {
  assert.equal(HQ_API_LIMITER_MESSAGE, "Too many requests. Please try again shortly.");
  assert.equal(GSA_THROTTLE_MESSAGE, "Message throttled out");
  assert.notEqual(HQ_API_LIMITER_MESSAGE, GSA_THROTTLE_MESSAGE);
  assert.equal(isHqLimiterMessage(HQ_API_LIMITER_MESSAGE), true);
  assert.equal(isGsaThrottleMessage(GSA_THROTTLE_MESSAGE), true);
  assert.equal(isHqLimiterMessage(GSA_THROTTLE_MESSAGE), false);
  assert.equal(isGsaThrottleMessage(HQ_API_LIMITER_MESSAGE), false);
  assert.equal(HQ_LIMITER_FROM_SECURITY, HQ_API_LIMITER_MESSAGE);
});

test("GSA throttle maps to RATE_LIMITED not AUTH_FAILED even on 401 wrapping", () => {
  assert.equal(classifyIntegrationError("Message throttled out"), "RATE_LIMITED");
  assert.equal(
    classifyIntegrationError("SAM.gov auth failed (401) — Message throttled out"),
    "RATE_LIMITED",
  );
  assert.equal(classifyIntegrationError(HQ_API_LIMITER_MESSAGE), "HQ_RATE_LIMITED");
  assert.equal(
    classifyIntegrationError("SAM.gov auth failed (401) — check SAM_GOV_API_KEY permissions"),
    "AUTH_FAILED",
  );
  assert.notEqual(classifyIntegrationError("Message throttled out"), "AUTH_FAILED");
});

test("no auto-retry after 401/429/GSA throttle", () => {
  assert.equal(shouldAutoRetrySam({ httpStatus: 401, message: "Message throttled out" }), false);
  assert.equal(shouldAutoRetrySam({ httpStatus: 429, message: "too many" }), false);
  assert.equal(shouldAutoRetrySam({ message: GSA_THROTTLE_MESSAGE }), false);
  assert.equal(shouldAutoRetrySam({ message: HQ_API_LIMITER_MESSAGE }), false);
  assert.equal(
    shouldStartupRetryCard({
      id: "sam_gov",
      health: { message: "Message throttled out" },
      status: "degraded",
    }),
    false,
  );
  assert.equal(
    shouldStartupRetryCard({
      id: "paypal",
      health: { message: "Message throttled out" },
    }),
    true,
  );
});

test("page-load probe loop cannot hammer GSA after throttle", async () => {
  resetSamGovProbeGateForTests();
  process.env.SAM_GOV_API_KEY = "test-key-not-live";
  process.env.SAM_GOV_UEI = "TESTUEI123456";
  rememberSamLiveResult({
    ok: false,
    message: GSA_THROTTLE_MESSAGE,
    latencyMs: 12,
    uei: "TESTUEI123456",
    apiKeySet: true,
    httpStatus: 401,
  });
  assert.equal(shouldSkipLiveSamProbe(), true);

  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("network must not be called");
  };
  try {
    const first = await probeSamGovEntityLive();
    const second = await probeSamGovEntityLive();
    assert.equal(fetches, 0);
    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.match(first.message, /throttled out/i);
    assert.match(first.message, /skipped/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Connected only after successful live probe", () => {
  assert.equal(samHubStatusFromLive(null, true), "degraded");
  assert.equal(samHubStatusFromLive({ ok: false }, true), "degraded");
  assert.equal(samHubStatusFromLive({ ok: true }, true), "connected");
});

test("forced probe with GSA 401 throttle body is RATE_LIMITED and then gates auto probes", async () => {
  resetSamGovProbeGateForTests();
  process.env.SAM_GOV_API_KEY = "test-key-not-live";
  process.env.SAM_GOV_UEI = "TESTUEI123456";
  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response(JSON.stringify({ message: "Message throttled out" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const live = await probeSamGovEntityLive(undefined, { force: true });
    assert.equal(live.ok, false);
    assert.equal(live.message, "Message throttled out");
    assert.equal(classifyIntegrationError(live.message), "RATE_LIMITED");
    assert.notEqual(classifyIntegrationError(live.message), "AUTH_FAILED");
    assert.equal(samHubStatusFromLive(live, true), "degraded");
    const gated = await probeSamGovEntityLive();
    assert.equal(fetches, 1);
    assert.equal(gated.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
    resetSamGovProbeGateForTests();
  }
});

test("reset-status clears lastError without calling SAM and does not set Connected", async () => {
  resetSamGovProbeGateForTests();
  rememberSamLiveResult({
    ok: false,
    message: GSA_THROTTLE_MESSAGE,
    latencyMs: 1,
    uei: "TESTUEI123456",
    apiKeySet: true,
    httpStatus: 401,
  });
  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response("{}", { status: 200 });
  };
  try {
    const result = resetSamGovStatusCache();
    assert.equal(result.samCalled, false);
    assert.equal(result.connected, false);
    assert.equal(result.lastError, null);
    assert.equal(samHubStatusFromLive({ ok: false }, true), "degraded");
    const skipped = await probeSamGovEntityLive();
    assert.equal(fetches, 0);
    assert.equal(skipped.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
    resetSamGovProbeGateForTests();
  }
});
