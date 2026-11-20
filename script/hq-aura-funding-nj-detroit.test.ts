import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { classifyFundingInitiative, matchScoreDisclaimer, moneyStatusFromGrantRow } from "../shared/grantInitiativeScope";
import { catalogFeedCapabilities, walkthroughFundingLifecycle } from "../server/hq/grantRegionalDiscoveryEngine";
import { analyzeRecurringFunding } from "../server/hq/grantRecurringFundingEngine";
import { isExcludedExecIdentity, founderApprovalAllowed, AURA_OPERATOR } from "../server/hq/auraActorIdentity";
import { grantCenterResearchPayload } from "../shared/detroitWorkspace";
import { isGrantCenterExecutiveDeskQuery, initiativeFromAuraContext, BUDGET_SKELETON } from "../server/hq/auraGrantCenterExecutiveEngine";

test("NJ, Detroit, and shared org stay separate without inventing eligibility", () => {
  const nj = classifyFundingInitiative({
    title: "Workforce training",
    funder: "NJ Department of Labor",
    geography: "Asbury Park, New Jersey",
  });
  const detroit = classifyFundingInitiative({
    title: "Land reuse",
    funder: "City of Detroit",
    geography: "Wayne County, Michigan",
  });
  const both = classifyFundingInitiative({
    title: "National CDC",
    description: "New Jersey and Detroit youth programs",
  });
  const unknown = classifyFundingInitiative({ title: "Private gift", funder: "Unknown" });
  assert.equal(nj.initiative, "nj_programs");
  assert.equal(detroit.initiative, "detroit_initiative");
  assert.equal(both.initiative, "shared_org");
  assert.equal(unknown.initiative, "unknown");
  assert.match(matchScoreDisclaimer(72), /not confirmed eligibility/);
  assert.equal(moneyStatusFromGrantRow({ funding_status: "identified" }), "potential_funding");
  assert.equal(moneyStatusFromGrantRow({ funding_status: "submitted" }), "submitted_application");
  assert.equal(moneyStatusFromGrantRow({ funding_status: "awarded" }), "award");
});

test("operating payroll yes is still potential_funding until award", () => {
  const profile = analyzeRecurringFunding({
    id: "ops-hr",
    title: "General operating support",
    description: "Multi-year renewable general operating grant. Personnel salaries, fringe benefits, HR, and administration allowed.",
    amount_max: 100000,
  }, 80);
  assert.equal(profile.personnelAllowed, "yes");
  assert.equal(profile.hrAllowed, "yes");
  assert.equal(profile.moneyStatus, "potential_funding");
  assert.notEqual(profile.moneyStatus, "award");
  assert.notEqual(profile.moneyStatus, "received_revenue");
});

test("exec@ifcdc.org cannot approve and walkthrough never auto-submits", () => {
  assert.equal(isExcludedExecIdentity({ email: "exec@ifcdc.org", role: "owner" }), true);
  assert.equal(founderApprovalAllowed({
    email: "exec@ifcdc.org",
    role: "founder",
    isFounder: true,
  }), false);
  const walk = walkthroughFundingLifecycle();
  assert.equal(walk.neverAutoSubmits, true);
  assert.equal(walk.execCannotApprove, true);
  assert.ok(walk.steps.some((step) => step.id === "award"));
  assert.ok(walk.steps.every((step) => step.autoSubmit === false));
});

test("Detroit research save tags the shared Grant Center store", () => {
  const research = grantCenterResearchPayload({
    title: "CDBG",
    payload: { funder: "City of Detroit", notes: "Check source" },
  });
  assert.equal(research?.initiative_scope, "detroit_initiative");
  assert.equal(research?.eligibility, "Unknown");
});

test("feed catalog names missing SAM credentials without secrets", () => {
  const feeds = catalogFeedCapabilities({
    SAM_GOV_ENABLED: "",
    SAM_GOV_API_KEY: "",
    SAM_GOV_UEI: "",
  } as NodeJS.ProcessEnv);
  const sam = feeds.find((feed) => feed.id === "sam_gov");
  assert.ok(sam);
  assert.equal(sam?.liveSearch, false);
  assert.ok(sam?.missingCredentialNames.includes("SAM_GOV_ENABLED"));
  assert.ok(sam?.missingCredentialNames.includes("SAM_GOV_API_KEY"));
  const grants = feeds.find((feed) => feed.id === "grants_gov");
  assert.equal(grants?.liveSearch, true);
  const nj = feeds.find((feed) => feed.id === "nj_state");
  assert.equal(nj?.liveSearch, false);
  assert.equal(nj?.connected, false);
  assert.match(nj?.officialManualPath.url ?? "", /sage\.nj\.gov/);
  assert.match(nj?.officialManualPath.exportWhat ?? "", /Export/);
  const listings = feeds.find((feed) => feed.id === "sam_assistance_listings");
  assert.equal(listings?.liveSearch, false);
  assert.ok(listings?.missingCredentialNames.includes("SAM_GOV_ASSISTANCE_LISTINGS_ENABLED"));
  const dlba = feeds.find((feed) => feed.id === "dlba");
  assert.equal(dlba?.connected, false);
  assert.match(dlba?.officialManualPath.url ?? "", /buildingdetroit\.org/);
});

test("HQ UI keeps Founder gates and does not claim DLBA scraping", () => {
  const discover = readFileSync(new URL("../client/src/components/hq/grants/GrantLifecycleHub.tsx", import.meta.url), "utf8");
  const detroit = readFileSync(new URL("../client/src/pages/hq/DetroitWorkspacePage.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../client/src/components/hq/grants/GrantNjDetroitFundingPanel.tsx", import.meta.url), "utf8");
  assert.match(discover, /not eligibility/);
  assert.match(detroit, /does not contact the Detroit Land Bank/);
  assert.match(panel, /exec@ifcdc.org cannot approve/);
  assert.match(panel, /Aura: search and store in Grant Center/);
  assert.equal(discover.includes("auraBrainV1ReadOnlyAsk"), false);
  const buttons = readFileSync(new URL("../client/src/components/hq/aura/AuraActionButtons.tsx", import.meta.url), "utf8");
  assert.match(buttons, /run_grant_center_executive_desk/);
  const registry = readFileSync(new URL("../server/hq/auraActionRegistry.ts", import.meta.url), "utf8");
  assert.match(registry, /id: "run_grant_center_executive_desk"/);
  assert.equal(registry.includes("auraBrainV1ReadOnlyAsk"), false);
  const command = readFileSync(new URL("../server/hq/auraCommandLayer.ts", import.meta.url), "utf8");
  assert.match(command, /NJ \/ Detroit Grant Center desk/);
  assert.equal(AURA_OPERATOR.isFounder, false);
  assert.equal(AURA_OPERATOR.kind, "ai_operator");
});

test("Aura desk query routing stays regional and never auto-submits", () => {
  assert.equal(isGrantCenterExecutiveDeskQuery("Run the NJ programs and Detroit funding desk"), true);
  assert.equal(isGrantCenterExecutiveDeskQuery("Find Detroit Land Bank grant deadlines"), true);
  assert.equal(isGrantCenterExecutiveDeskQuery("Find funding across all IFCDC programs"), false);
  assert.equal(isGrantCenterExecutiveDeskQuery("submit this grant to the funder"), false);
  assert.equal(initiativeFromAuraContext("New Jersey SAGE workforce"), "nj_programs");
  assert.equal(initiativeFromAuraContext("Detroit SIGMA notice"), "detroit_initiative");
  assert.match(BUDGET_SKELETON, /Payroll is not funded/);
  const walk = walkthroughFundingLifecycle();
  assert.equal(walk.steps[0]?.id, "discovery");
});

test("read-only Grants.gov Search2 returns current posted opportunities", async (t) => {
  let res: Response;
  try {
    res = await fetch("https://api.grants.gov/v1/api/search2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ rows: 5, keyword: "New Jersey community development", oppStatuses: "posted" }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    t.skip(`network blocked: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  assert.equal(res.ok, true, `Grants.gov Search2 HTTP ${res.status}`);
  const data = await res.json() as { oppHits?: unknown[]; data?: { oppHits?: unknown[] } };
  const hits = data.oppHits ?? data.data?.oppHits ?? [];
  assert.ok(Array.isArray(hits), "Search2 payload missing oppHits");
  assert.ok(hits.length > 0, "Search2 returned zero posted opportunities for NJ keyword");
});
