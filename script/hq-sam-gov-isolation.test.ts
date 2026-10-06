/**
 * SAM.gov stays off unless SAM_GOV_ENABLED is explicit.
 * No network, no mail, no database write.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  defaultGrantFeedProviders,
  probeSamGovEntityLive,
  resolveGrantFeedProviders,
  samGovStatusProbe,
  syncSamGovStatus,
} from "../server/hq/grantFeedConnectors.ts";

const CREDENTIALS = {
  SAM_GOV_API_KEY: "test-key",
  SAM_GOV_UEI: "TESTUEI123456",
};

function withEnv(extra: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const keys = ["SAM_GOV_API_KEY", "SAM_GOV_UEI", "IFCDC_SAM_UEI", "SAM_GOV_ENABLED"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network");
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = originalFetch;
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      assert.equal(calls, 0);
    });
}

function assertSamSkipped() {
  assert.equal(samGovStatusProbe(), null);
  assert.equal(resolveGrantFeedProviders().includes("sam_gov"), false);
  assert.equal(resolveGrantFeedProviders().includes("grants_gov"), true);
  assert.equal(resolveGrantFeedProviders().includes("foundation_directory"), true);
  assert.deepEqual(resolveGrantFeedProviders(["grants_gov", "sam_gov"]), ["grants_gov"]);
  assert.deepEqual(
    resolveGrantFeedProviders(["grants_gov", "sam_gov", "foundation_directory"]),
    ["grants_gov", "foundation_directory"],
  );
}

test("credentials without SAM_GOV_ENABLED do not call the SAM probe", async () => {
  await withEnv(CREDENTIALS, async () => {
    assertSamSkipped();
    const result = await syncSamGovStatus();
    assert.equal(result.provider, "sam_gov");
    assert.equal(result.status, "skipped");
    assert.equal(result.imported, 0);
    assert.equal(result.updated, 0);
  });
  await withEnv({ ...CREDENTIALS, SAM_GOV_ENABLED: "false" }, async () => {
    assertSamSkipped();
    const result = await syncSamGovStatus();
    assert.equal(result.status, "skipped");
    assert.equal(result.imported, 0);
  });
  await withEnv({ SAM_GOV_ENABLED: "true" }, async () => {
    assert.equal(samGovStatusProbe(), null);
    const result = await syncSamGovStatus();
    assert.equal(result.status, "skipped");
  });
});

test("SAM_GOV_ENABLED selects the existing probe and leaves Grants.gov in the feed list", async () => {
  for (const flag of ["true", "1", "yes"]) {
    await withEnv({ ...CREDENTIALS, SAM_GOV_ENABLED: flag }, () => {
      assert.equal(samGovStatusProbe(), probeSamGovEntityLive);
      const providers = defaultGrantFeedProviders();
      assert.deepEqual(providers.slice(0, 2), ["grants_gov", "foundation_directory"]);
      assert.equal(providers.includes("sam_gov"), true);
      assert.deepEqual(resolveGrantFeedProviders(["grants_gov", "sam_gov"]), ["grants_gov", "sam_gov"]);
    });
  }
  await withEnv({ ...CREDENTIALS, SAM_GOV_ENABLED: "on" }, () => {
    assertSamSkipped();
  });
  await withEnv(CREDENTIALS, () => {
    const providers = resolveGrantFeedProviders();
    assert.equal(providers[0], "grants_gov");
    assert.equal(providers.includes("foundation_directory"), true);
    assert.equal(providers.includes("sam_gov"), false);
  });

  const intelligence = readFileSync(
    fileURLToPath(new URL("../server/hq/grantIntelligenceEngine.ts", import.meta.url)),
    "utf8",
  );
  const pipeline = readFileSync(
    fileURLToPath(new URL("../server/hq/grantFundingPipelineEngine.ts", import.meta.url)),
    "utf8",
  );
  assert.match(intelligence, /SYNC_INTERVAL_MS = 6 \* 60 \* 60_000/);
  assert.match(intelligence, /syncGrantFeeds\(\{ providers: \["grants_gov", "sam_gov"\] \}\)/);
  assert.match(pipeline, /4 \* 60 \* 60_000/);
  assert.match(pipeline, /syncGrantFeeds\(\{ providers: \["grants_gov", "sam_gov", "foundation_directory"\] \}\)/);
});
