/**
 * NJ programs vs Detroit initiative tagging for the shared Grant Center store.
 * Match scores are not eligibility. Unverified fields stay Unknown.
 */

export const FUNDING_INITIATIVES = ["nj_programs", "detroit_initiative", "shared_org", "unknown"] as const;
export type FundingInitiative = (typeof FUNDING_INITIATIVES)[number];

export const FUNDING_MONEY_STATUSES = [
  "potential_funding",
  "submitted_application",
  "award",
  "received_revenue",
] as const;
export type FundingMoneyStatusLabel = (typeof FUNDING_MONEY_STATUSES)[number];

const NJ_RE = /\b(new jersey|\bnj\b|monmouth|asbury park|ocean county|jersey city)\b/i;
const DETROIT_RE = /\b(detroit|wayne county|\bdlba\b|land bank|michigan|\bmi\b)\b/i;
const NATIONAL_RE = /\b(nationwide|national|united states|\bus\b|all states)\b/i;

export function haystackFromOpportunity(opportunity: {
  title?: string | null;
  funder?: string | null;
  description?: string | null;
  geography?: string | null;
  eligibility?: string | null;
  program_areas?: string[] | string | null;
  source_type?: string | null;
  initiative_scope?: string | null;
}): string {
  const areas = Array.isArray(opportunity.program_areas)
    ? opportunity.program_areas.join(" ")
    : String(opportunity.program_areas ?? "");
  return [
    opportunity.title,
    opportunity.funder,
    opportunity.description,
    opportunity.geography,
    opportunity.eligibility,
    areas,
    opportunity.source_type,
    opportunity.initiative_scope,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function classifyFundingInitiative(opportunity: Parameters<typeof haystackFromOpportunity>[0]): {
  initiative: FundingInitiative;
  evidence: string;
  sharedOrgDocuments: boolean;
  njPrograms: boolean;
  detroitInitiative: boolean;
} {
  const stored = String(opportunity.initiative_scope ?? "").trim();
  if ((FUNDING_INITIATIVES as readonly string[]).includes(stored) && stored !== "unknown") {
    return {
      initiative: stored as FundingInitiative,
      evidence: `stored initiative_scope=${stored}`,
      sharedOrgDocuments: stored === "shared_org",
      njPrograms: stored === "nj_programs" || stored === "shared_org",
      detroitInitiative: stored === "detroit_initiative" || stored === "shared_org",
    };
  }
  const haystack = haystackFromOpportunity(opportunity);
  const nj = NJ_RE.test(haystack);
  const detroit = DETROIT_RE.test(haystack);
  if (nj && detroit) {
    return {
      initiative: "shared_org",
      evidence: "mentions both New Jersey and Detroit/Michigan",
      sharedOrgDocuments: true,
      njPrograms: true,
      detroitInitiative: true,
    };
  }
  if (detroit) {
    return {
      initiative: "detroit_initiative",
      evidence: "geography or text mentions Detroit, Wayne County, DLBA, land bank, or Michigan",
      sharedOrgDocuments: true,
      njPrograms: false,
      detroitInitiative: true,
    };
  }
  if (nj) {
    return {
      initiative: "nj_programs",
      evidence: "geography or text mentions New Jersey / Monmouth / Asbury Park",
      sharedOrgDocuments: true,
      njPrograms: true,
      detroitInitiative: false,
    };
  }
  if (NATIONAL_RE.test(haystack) || String(opportunity.geography ?? "").toUpperCase() === "US") {
    return {
      initiative: "shared_org",
      evidence: "national / US listing — cost allocation still requires Founder review",
      sharedOrgDocuments: true,
      njPrograms: true,
      detroitInitiative: true,
    };
  }
  return {
    initiative: "unknown",
    evidence: "Unknown — geography not verified",
    sharedOrgDocuments: true,
    njPrograms: false,
    detroitInitiative: false,
  };
}

export function moneyStatusFromGrantRow(row: {
  funding_status?: string | null;
  lifecycle_stage?: string | null;
  status?: string | null;
  received_revenue?: unknown;
}): FundingMoneyStatusLabel {
  const blob = [row.funding_status, row.lifecycle_stage, row.status].filter(Boolean).join(" ").toLowerCase();
  if (row.received_revenue === true || /\breceived[_\s-]?revenue\b/.test(blob)) return "received_revenue";
  if (/\bawarded\b|\baward\b/.test(blob) && !/\bnot awarded\b/.test(blob)) return "award";
  if (/\bsubmitted\b|\bunder_review\b/.test(blob)) return "submitted_application";
  return "potential_funding";
}

export function matchScoreDisclaimer(score: number | null | undefined): string {
  if (score == null || Number.isNaN(Number(score))) {
    return "Match score Unknown — not eligibility and not guaranteed money";
  }
  return `Match score ${Number(score)} — not confirmed eligibility and not guaranteed money`;
}
