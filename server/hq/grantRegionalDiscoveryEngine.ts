/**
 * Read-only official-feed discovery for NJ programs and the Detroit initiative.
 * Does not submit, contact funders, or write Grant Center unless persist=false path is used.
 */
import { classifyFundingInitiative, matchScoreDisclaimer, moneyStatusFromGrantRow, type FundingInitiative } from "../../shared/grantInitiativeScope";
import { isSamGovSyncEnabled } from "./grantFeedConnectors";
import { searchGrantsGovLive } from "./grantsGovIntegrationEngine";
import { analyzeRecurringFunding } from "./grantRecurringFundingEngine";

export type DiscoveryVerification = "Unknown" | "Official source checked";

export type DiscoveryCard = {
  source: string;
  dateChecked: string;
  deadline: string;
  eligibilityEvidence: string;
  allowableCosts: string;
  matchRequirements: string;
  officialLink: string;
  verification: DiscoveryVerification;
  title: string;
  funder: string;
  initiative: FundingInitiative;
  moneyStatus: "potential_funding";
  matchScoreDisclaimer: string;
  liveSearchPerformed: true;
  notGuaranteedMoney: true;
  amount: string;
};

export type FeedCapability = {
  id: string;
  label: string;
  connected: boolean;
  liveSearch: boolean;
  note: string;
  missingCredentialNames: string[];
  officialHome: string;
};

function unknown(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text || "Unknown";
}

function cardFromGovOpp(opp: Record<string, unknown>, dateChecked: string, queryInitiative: FundingInitiative): DiscoveryCard {
  const classified = classifyFundingInitiative({
    title: String(opp.title ?? ""),
    funder: String(opp.funder ?? ""),
    description: String(opp.description ?? ""),
    geography: String(opp.geography ?? ""),
    eligibility: String(opp.eligibility ?? ""),
    source_type: String(opp.source_type ?? "grants_gov"),
  });
  const profile = analyzeRecurringFunding(opp, 0);
  const allowable = ["payroll", "hr", "administration", "allowable_indirect"]
    .map((id) => {
      const dim = profile.dimensions.find((item) => item.id === id);
      const status = dim?.status ?? "unknown";
      return `${id} ${status === "unknown" ? "Unknown" : status}`;
    })
    .join("; ");
  return {
    source: "Grants.gov Search2 (public Applicant API)",
    dateChecked,
    deadline: unknown(typeof opp.deadline === "string" ? opp.deadline : null),
    eligibilityEvidence: unknown(typeof opp.eligibility === "string" ? opp.eligibility : null),
    allowableCosts: allowable,
    matchRequirements: unknown(typeof opp.requirements === "string" ? opp.requirements : null),
    officialLink: unknown(typeof opp.url === "string" ? opp.url : null),
    verification: opp.deadline || opp.eligibility ? "Official source checked" : "Unknown",
    title: String(opp.title ?? "Unknown"),
    funder: String(opp.funder ?? "Unknown"),
    initiative: classified.initiative === "unknown" ? queryInitiative : classified.initiative,
    moneyStatus: "potential_funding",
    matchScoreDisclaimer: matchScoreDisclaimer(null),
    liveSearchPerformed: true,
    notGuaranteedMoney: true,
    amount: opp.amount_max != null ? `estimated amount ${opp.amount_max} — not guaranteed money` : "Unknown",
  };
}

async function searchKeyword(keyword: string, initiative: FundingInitiative, dateChecked: string): Promise<{ cards: DiscoveryCard[]; error?: string }> {
  try {
    const { opps } = await searchGrantsGovLive(12, keyword);
    return { cards: opps.map((opp) => cardFromGovOpp(opp as Record<string, unknown>, dateChecked, initiative)) };
  } catch (error) {
    return { cards: [], error: error instanceof Error ? error.message : "Grants.gov Search2 failed" };
  }
}

async function foundationProfiles(query: string, initiative: FundingInitiative, dateChecked: string): Promise<{ cards: DiscoveryCard[]; error?: string }> {
  try {
    const res = await fetch(
      `https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(query)}&page=0`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return { cards: [], error: `ProPublica ${res.status}` };
    const data = (await res.json()) as { organizations?: Record<string, unknown>[] };
    const cards = (data.organizations ?? []).slice(0, 8).map((org) => {
      const ein = String(org.ein ?? "");
      const name = String(org.name ?? "Unknown foundation");
      return {
        source: "ProPublica Nonprofit Explorer (990 profiles — not an open RFP)",
        dateChecked,
        deadline: "Unknown",
        eligibilityEvidence: "Unknown — 990 profile is not a current grant announcement",
        allowableCosts: "payroll Unknown; hr Unknown; administration Unknown",
        matchRequirements: "Unknown — contact the foundation for current guidelines (Founder approval required before outreach)",
        officialLink: ein ? `https://projects.propublica.org/nonprofits/organizations/${ein}` : "Unknown",
        verification: "Official source checked" as const,
        title: `${name} — foundation profile`,
        funder: name,
        initiative,
        moneyStatus: "potential_funding" as const,
        matchScoreDisclaimer: matchScoreDisclaimer(null),
        liveSearchPerformed: true as const,
        notGuaranteedMoney: true as const,
        amount: "Unknown",
      };
    });
    return { cards };
  } catch (error) {
    return { cards: [], error: error instanceof Error ? error.message : "ProPublica search failed" };
  }
}

export function catalogFeedCapabilities(env: NodeJS.ProcessEnv = process.env): FeedCapability[] {
  const samEnabled = isSamGovSyncEnabled(env);
  const samKey = Boolean(String(env.SAM_GOV_API_KEY ?? "").trim());
  const samUei = Boolean(String(env.SAM_GOV_UEI ?? env.IFCDC_SAM_UEI ?? "").trim());
  return [
    {
      id: "grants_gov",
      label: "Grants.gov Search2",
      connected: true,
      liveSearch: true,
      note: "Public Applicant API — no API key required. This branch queries posted opportunities.",
      missingCredentialNames: [],
      officialHome: "https://www.grants.gov",
    },
    {
      id: "sam_gov",
      label: "SAM.gov entity status",
      connected: samEnabled && samKey && samUei,
      liveSearch: false,
      note: "Entity registration probe only. This branch does not search SAM.gov assistance listings as opportunities.",
      missingCredentialNames: [
        ...(!samEnabled ? ["SAM_GOV_ENABLED"] : []),
        ...(!samKey ? ["SAM_GOV_API_KEY"] : []),
        ...(!samUei ? ["SAM_GOV_UEI"] : []),
      ],
      officialHome: "https://sam.gov",
    },
    {
      id: "foundation_directory",
      label: "ProPublica 990 profiles",
      connected: true,
      liveSearch: true,
      note: "Foundation identities only. Not current RFPs. Grant programs remain Unknown until the funder listing is checked.",
      missingCredentialNames: [],
      officialHome: "https://projects.propublica.org/nonprofits/",
    },
    {
      id: "corporate_csr",
      label: "Corporate CSR reference",
      connected: false,
      liveSearch: false,
      note: "Static curated links in Grant Center. Not a live corporate grant search on this branch.",
      missingCredentialNames: [],
      officialHome: "https://www.grants.gov",
    },
    {
      id: "nj_state",
      label: "New Jersey state grant portals",
      connected: false,
      liveSearch: false,
      note: "No official NJ SAGE / DOL API connector on this branch. NJ hits below come from Grants.gov keywords only.",
      missingCredentialNames: [],
      officialHome: "https://www.nj.gov",
    },
    {
      id: "mi_state",
      label: "Michigan / Detroit municipal portals",
      connected: false,
      liveSearch: false,
      note: "No Detroit Land Bank or Michigan SIGMA connector. Detroit hits below come from Grants.gov keywords only. Aura is not scraping DLBA.",
      missingCredentialNames: [],
      officialHome: "https://www.michigan.gov",
    },
  ];
}

export async function previewRegionalDiscovery(opts?: { initiative?: FundingInitiative | "all" }): Promise<{
  mode: "read_only";
  writesGrantCenter: false;
  submitsGrant: false;
  contactsFunders: false;
  checkedAt: string;
  feeds: FeedCapability[];
  queries: { keyword: string; initiative: FundingInitiative; source: string; error?: string; count: number }[];
  opportunities: DiscoveryCard[];
  notGuaranteedMoney: true;
}> {
  const checkedAt = new Date().toISOString();
  const initiative = opts?.initiative && opts.initiative !== "unknown" ? opts.initiative : "all";
  const queries = (
    [
      { keyword: "New Jersey community development nonprofit", initiative: "nj_programs", source: "grants_gov" },
      { keyword: "Detroit Michigan community development", initiative: "detroit_initiative", source: "grants_gov" },
      { keyword: "community development nonprofit", initiative: "shared_org", source: "grants_gov" },
    ] as const
  ).filter((item) => initiative === "all" || item.initiative === initiative || item.initiative === "shared_org");

  const queryReports: { keyword: string; initiative: FundingInitiative; source: string; error?: string; count: number }[] = [];
  const opportunities: DiscoveryCard[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const result = await searchKeyword(query.keyword, query.initiative, checkedAt);
    queryReports.push({ ...query, error: result.error, count: result.cards.length });
    for (const card of result.cards) {
      const key = `${card.officialLink}|${card.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      opportunities.push(card);
    }
  }

  const foundationQueries = [
    { query: "New Jersey community foundation", initiative: "nj_programs" as const },
    { query: "Detroit community foundation", initiative: "detroit_initiative" as const },
  ].filter((item) => initiative === "all" || item.initiative === initiative);

  for (const item of foundationQueries) {
    const result = await foundationProfiles(item.query, item.initiative, checkedAt);
    queryReports.push({
      keyword: item.query,
      initiative: item.initiative,
      source: "foundation_directory",
      error: result.error,
      count: result.cards.length,
    });
    opportunities.push(...result.cards);
  }

  return {
    mode: "read_only",
    writesGrantCenter: false,
    submitsGrant: false,
    contactsFunders: false,
    checkedAt,
    feeds: catalogFeedCapabilities(),
    queries: queryReports,
    opportunities,
    notGuaranteedMoney: true,
  };
}

export function walkthroughFundingLifecycle(): {
  steps: { id: string; label: string; moneyStatus: string; autoSubmit: false }[];
  founderApprovalRequired: true;
  execCannotApprove: true;
  neverAutoSubmits: true;
} {
  return {
    steps: [
      { id: "discovery", label: "Read-only official feed preview", moneyStatus: "potential_funding", autoSubmit: false },
      { id: "match", label: "Aura / Grant Center match (not eligibility)", moneyStatus: "potential_funding", autoSubmit: false },
      { id: "documents", label: "Shared org documents + checklist", moneyStatus: "potential_funding", autoSubmit: false },
      { id: "budget", label: "Budget prep with Unknown amounts until verified", moneyStatus: "potential_funding", autoSubmit: false },
      { id: "draft", label: "Proposal draft in Grant Center", moneyStatus: "potential_funding", autoSubmit: false },
      { id: "founder", label: "Founder review (exec@ifcdc.org cannot approve)", moneyStatus: "potential_funding", autoSubmit: false },
      { id: "portal", label: "Human portal submit outside HQ — confirm ID after", moneyStatus: "submitted_application", autoSubmit: false },
      { id: "award", label: "Award tracking after notice", moneyStatus: "award", autoSubmit: false },
      { id: "revenue", label: "Received revenue only after funds land", moneyStatus: "received_revenue", autoSubmit: false },
      { id: "renewal", label: "Renewal / reporting follow-up", moneyStatus: "award", autoSubmit: false },
    ],
    founderApprovalRequired: true,
    execCannotApprove: true,
    neverAutoSubmits: true,
  };
}

export function tagStoredOpportunity(row: Record<string, unknown>) {
  const classified = classifyFundingInitiative(row);
  return {
    ...row,
    initiative: classified.initiative,
    initiativeEvidence: classified.evidence,
    moneyStatus: moneyStatusFromGrantRow(row),
    matchScoreDisclaimer: matchScoreDisclaimer(row.composite_score != null ? Number(row.composite_score) : row.qualification_score != null ? Number(row.qualification_score) : null),
    sharedOrgDocuments: classified.sharedOrgDocuments,
    notGuaranteedMoney: true as const,
  };
}
