/**
 * Grants.gov identity and fingerprint dedupe.
 * No network, no mail, no SAM.gov, no database write.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  identifyFeedOpportunity,
  planFeedUpserts,
  reliableExternalId,
} from "../server/hq/grantFeedConnectors.ts";
import { normalizeGrantsGovHits } from "../server/hq/grantsGovIntegrationEngine.ts";

const sourceUrl = "https://www.grants.gov/search-results-detail/EXAMPLE";

test("a missing Grants.gov id does not become a timestamp and estimated funding stays separate", () => {
  const engine = readFileSync(fileURLToPath(new URL("../server/hq/grantsGovIntegrationEngine.ts", import.meta.url)), "utf8");
  const start = engine.indexOf("export function normalizeGrantsGovHits");
  const end = engine.indexOf("function parseGrantAmount");
  const body = engine.slice(start, end);
  assert.equal(body.includes("gg-"), false);
  assert.equal(body.includes("Date.now"), false);
  assert.equal(/sam\.gov/i.test(body), false);

  assert.equal(reliableExternalId("gg-1710000000000"), null);
  assert.equal(reliableExternalId("12345"), "12345");

  const [untimed] = normalizeGrantsGovHits([{
    title: "Community apprenticeship",
    agencyName: "Department of Labor",
    opportunityUrl: sourceUrl,
    awardFloor: "10000",
    awardCeiling: "50000",
    estimatedFunding: "9000000",
    closeDate: "12/01/2026",
  }]);
  assert.ok(untimed);
  assert.equal(untimed.external_id, "");
  assert.equal(/^gg-\d+$/.test(untimed.external_id), false);
  assert.equal(typeof untimed.fingerprint, "string");
  assert.equal(untimed.amount_min, 10000);
  assert.equal(untimed.amount_max, 50000);
  assert.equal(untimed.estimated_funding, 9000000);
  assert.notEqual(untimed.amount_max, untimed.estimated_funding);
  assert.equal(untimed.deadline, "2026-12-01");
  assert.equal(untimed.close_date, "2026-12-01");

  const [identified] = normalizeGrantsGovHits([{ id: "12345", title: "Named opportunity", closeDate: "2026-11-02" }]);
  assert.equal(identified?.external_id, "12345");
  assert.equal(identified?.deadline, "2026-11-02");

  assert.deepEqual(normalizeGrantsGovHits([{ description: "no title and no id" }]), []);
  assert.deepEqual(normalizeGrantsGovHits([{ id: "gg-1710000000000", title: "Placeholder id only" }]), []);
});

test("the same fingerprint does not insert twice and different titles do not merge", () => {
  const shared = {
    source_type: "grants_gov",
    external_id: "",
    funder: "Department of Labor",
    url: sourceUrl,
  };
  const first = { ...shared, title: "Community apprenticeship" };
  const same = { ...shared, title: "Community apprenticeship" };
  const otherTitle = { ...shared, title: "Youth transportation" };
  const identity = identifyFeedOpportunity(first);
  assert.equal(identity.action, "ready");
  assert.equal(identity.externalId, null);
  assert.equal(identifyFeedOpportunity(same).fingerprint, identity.fingerprint);

  const repeated = planFeedUpserts([], [first, same]);
  assert.equal(repeated.insert, 1);
  assert.equal(repeated.duplicatesPrevented, 1);
  assert.equal(repeated.update, 0);

  const stored = planFeedUpserts(
    [{ source_type: "grants_gov", external_id: identity.fingerprint, fingerprint: identity.fingerprint }],
    [same],
  );
  assert.equal(stored.insert, 0);
  assert.equal(stored.update, 1);
  assert.equal(stored.duplicatesPrevented, 1);

  const distinct = planFeedUpserts([], [first, otherTitle]);
  assert.equal(distinct.insert, 2);
  assert.equal(distinct.duplicatesPrevented, 0);

  const numbered = planFeedUpserts([], [
    { source_type: "grants_gov", external_id: "111", title: "Youth jobs", funder: "DOL", url: "https://www.grants.gov/search-results-detail/111" },
    { source_type: "grants_gov", external_id: "222", title: "Youth jobs program", funder: "DOL", url: "https://www.grants.gov/search-results-detail/222" },
  ]);
  assert.equal(numbered.insert, 2);
  assert.equal(numbered.duplicatesPrevented, 0);

  const skipped = planFeedUpserts([], [
    { source_type: "grants_gov", external_id: "gg-1710000000000", title: "No stable url", funder: "DOL", url: "https://www.grants.gov" },
  ]);
  assert.equal(skipped.insert, 0);
  assert.equal(skipped.skipped, 1);
});
