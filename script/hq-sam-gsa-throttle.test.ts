/**
 * GSA SAM.gov throttle vs HQ limiter — no live api.sam.gov.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  HQ_API_RATE_LIMIT_MESSAGE,
  SAM_GOV_GSA_THROTTLE_MESSAGE,
  classifySamGovProbeError,
  clearSamGovProbeCache,
  isHqApiRateLimitMessage,
  isSamGovGsaThrottle,
  probeSamGovEntityLive,
} from "../server/hq/grantFeedConnectors.ts";

const CREDENTIALS = {
  SAM_GOV_API_KEY: "test-key",
  SAM_GOV_UEI: "TESTUEI123456",
};

function withSamEnv(run: () => Promise<void>) {
  const keys = ["SAM_GOV_API_KEY", "SAM_GOV_UEI", "IFCDC_SAM_UEI", "SAM_GOV_ENABLED"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.SAM_GOV_API_KEY = CREDENTIALS.SAM_GOV_API_KEY;
  process.env.SAM_GOV_UEI = CREDENTIALS.SAM_GOV_UEI;
  process.env.SAM_GOV_ENABLED = "true";
  clearSamGovProbeCache();
  return run().finally(() => {
    clearSamGovProbeCache();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

test("HQ limiter copy is distinct from GSA Message throttled out", () => {
  assert.equal(SAM_GOV_GSA_THROTTLE_MESSAGE, "Message throttled out");
  assert.equal(HQ_API_RATE_LIMIT_MESSAGE, "Too many requests. Please try again shortly.");
  assert.equal(isHqApiRateLimitMessage(HQ_API_RATE_LIMIT_MESSAGE), true);
  assert.equal(isHqApiRateLimitMessage(SAM_GOV_GSA_THROTTLE_MESSAGE), false);
  assert.equal(isSamGovGsaThrottle(SAM_GOV_GSA_THROTTLE_MESSAGE, 429), true);
  assert.equal(isSamGovGsaThrottle(HQ_API_RATE_LIMIT_MESSAGE), false);

  const limiterSrc = readFileSync(fileURLToPath(new URL("../server/middleware/hqSecurity.ts", import.meta.url)), "utf8");
  assert.match(limiterSrc, /max:\s*300/);
  assert.match(limiterSrc, /windowMs:\s*60 \* 1000/);
  assert.match(limiterSrc, /message: \{ error: "Too many requests\. Please try again shortly\." \}/);
});

test("GSA throttle and 429 map to RATE_LIMITED, not AUTH_FAILED", () => {
  assert.equal(classifySamGovProbeError(SAM_GOV_GSA_THROTTLE_MESSAGE, 429), "RATE_LIMITED");
  assert.equal(classifySamGovProbeError(SAM_GOV_GSA_THROTTLE_MESSAGE), "RATE_LIMITED");
  assert.equal(classifySamGovProbeError("SAM.gov auth failed (401) — check SAM_GOV_API_KEY permissions", 401), "AUTH_FAILED");
  assert.notEqual(classifySamGovProbeError(SAM_GOV_GSA_THROTTLE_MESSAGE), "AUTH_FAILED");

  const dashboard = readFileSync(
    fileURLToPath(new URL("../server/hq/integrationHealthDashboard.ts", import.meta.url)),
    "utf8",
  );
  const fn = dashboard.slice(dashboard.indexOf("export function inferErrorCode"), dashboard.indexOf("export function inferRootCause"));
  assert.equal(fn.indexOf("message throttled out") < fn.indexOf("return \"AUTH_FAILED\""), true);
  assert.match(dashboard, /GSA Entity API throttled/);
  assert.match(dashboard, /HQ \/api\/hq limiter/);
  assert.match(dashboard, /API credentials rejected by provider/);
});

test("429 lastError skips automatic SAM fetch; Founder allowNetwork still may call", async () => {
  await withSamEnv(async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls += 1;
      const url = String(input);
      assert.equal(url.includes("api.sam.gov"), true);
      return new Response(JSON.stringify({ message: SAM_GOV_GSA_THROTTLE_MESSAGE }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const first = await probeSamGovEntityLive(undefined, { allowNetwork: true });
      assert.equal(first.ok, false);
      assert.equal(first.httpStatus, 429);
      assert.equal(first.errorCode, "RATE_LIMITED");
      assert.equal(first.message, SAM_GOV_GSA_THROTTLE_MESSAGE);
      assert.equal(calls, 1);

      const auto = await probeSamGovEntityLive();
      assert.equal(auto.errorCode, "RATE_LIMITED");
      assert.equal(auto.message, SAM_GOV_GSA_THROTTLE_MESSAGE);
      assert.equal(calls, 1, "automatic callers must not replay GSA after 429");

      const hub = await probeSamGovEntityLive(undefined, { allowNetwork: false });
      assert.equal(hub.errorCode, "RATE_LIMITED");
      assert.equal(calls, 1);

      const founder = await probeSamGovEntityLive(undefined, { allowNetwork: true });
      assert.equal(calls, 2, "Founder Test Connection may call SAM after the GSA window");
      assert.equal(founder.errorCode, "RATE_LIMITED");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("clear lastError/cache does not call SAM", async () => {
  await withSamEnv(async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: SAM_GOV_GSA_THROTTLE_MESSAGE }), { status: 429 });
    }) as typeof fetch;
    try {
      await probeSamGovEntityLive(undefined, { allowNetwork: true });
      assert.equal(calls, 1);
      const cleared = clearSamGovProbeCache();
      assert.equal(cleared.calledSam, false);
      const deferred = await probeSamGovEntityLive(undefined, { allowNetwork: false });
      assert.equal(deferred.ok, false);
      assert.match(deferred.message, /deferred/);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("startup-retry source skips sam_gov; evidence engine has no throttle retry loop", () => {
  const startup = readFileSync(
    fileURLToPath(new URL("../server/hq/integrationHealthDashboard.ts", import.meta.url)),
    "utf8",
  );
  assert.match(startup, /c\.id !== "sam_gov"/);
  const evidence = readFileSync(
    fileURLToPath(new URL("../server/hq/auraGrantEvidencePopulationEngine.ts", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(evidence, /\/throttl\/i/);
  const routes = readFileSync(
    fileURLToPath(new URL("../server/routes/integrations.routes.ts", import.meta.url)),
    "utf8",
  );
  assert.match(routes, /sam_gov\/clear-error/);
  assert.match(routes, /Did not call api\.sam\.gov/);
});
