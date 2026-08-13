/**
 * Phase 8A.2 — Full official opportunity enrichment + IFCDC program mission matching.
 *
 * Missing funding amounts are stored as UNKNOWN — never coerced to $0 for pipeline totals.
 * Does not submit grants or touch Twilio/SMS.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { ensureGrantTables, logGrantActivity } from "./grantsSchema";
import { fetchGrantsGovOpportunityDetail } from "./grantWriterEngine";

export type FundingAmountStatus = "verified" | "partial" | "unknown" | "conflicting";

export type FundingValueSource =
  | "award_ceiling"
  | "estimated_total_funding"
  | "award_floor"
  | "unknown"
  | "none";

function parseAmount(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === "null") return null;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function asText(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw.trim() || null;
  if (Array.isArray(raw)) return raw.map(String).join("; ") || null;
  if (typeof raw === "object") {
    try {
      return JSON.stringify(raw);
    } catch {
      return null;
    }
  }
  return String(raw);
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
}

/** Resolve nested Grants.gov fetchOpportunity payload into synopsis + root. */
export function unwrapGrantsGovDetail(detail: Record<string, unknown>): {
  root: Record<string, unknown>;
  synopsis: Record<string, unknown>;
} {
  const root = detail;
  const synopsis = (detail.synopsis && typeof detail.synopsis === "object"
    ? detail.synopsis
    : detail.oppSynopsis && typeof detail.oppSynopsis === "object"
      ? detail.oppSynopsis
      : detail) as Record<string, unknown>;
  return { root, synopsis };
}

export function resolveFundingAmountFields(opts: {
  awardCeiling: number | null;
  awardFloor: number | null;
  estimatedFunding: number | null;
}): {
  status: FundingAmountStatus;
  valueSource: FundingValueSource;
  pipelineValue: number | null;
  explanation: string;
} {
  const { awardCeiling, awardFloor, estimatedFunding } = opts;
  const present = [awardCeiling, awardFloor, estimatedFunding].filter((v) => v != null) as number[];

  if (present.length === 0) {
    return {
      status: "unknown",
      valueSource: "unknown",
      pipelineValue: null,
      explanation: "Funding Amount = UNKNOWN — official source did not publish award ceiling, floor, or estimated total",
    };
  }

  // Conflicting: ceiling < floor, or estimated wildly below floor
  if (awardCeiling != null && awardFloor != null && awardCeiling < awardFloor) {
    return {
      status: "conflicting",
      valueSource: "award_ceiling",
      pipelineValue: null,
      explanation: `Conflicting official amounts: floor ${awardFloor} > ceiling ${awardCeiling}`,
    };
  }

  if (awardCeiling != null) {
    const partial = estimatedFunding == null || awardFloor == null;
    return {
      status: partial ? "partial" : "verified",
      valueSource: "award_ceiling",
      pipelineValue: awardCeiling,
      explanation: `Pipeline value from official award ceiling ($${awardCeiling.toLocaleString()})`,
    };
  }

  if (estimatedFunding != null) {
    return {
      status: awardFloor != null ? "partial" : "partial",
      valueSource: "estimated_total_funding",
      pipelineValue: estimatedFunding,
      explanation: `Pipeline value from official estimated total funding ($${estimatedFunding.toLocaleString()}) — not award ceiling`,
    };
  }

  return {
    status: "partial",
    valueSource: "award_floor",
    pipelineValue: awardFloor,
    explanation: `Only award floor published ($${awardFloor!.toLocaleString()}) — treated as partial, not full ceiling`,
  };
}

export function extractEnrichmentFromGrantsGovDetail(detail: Record<string, unknown>): {
  awardFloor: number | null;
  awardCeiling: number | null;
  estimatedFunding: number | null;
  anticipatedAwards: number | null;
  eligibility: string | null;
  eligibleApplicantTypes: string | null;
  description: string | null;
  fundingInstrument: string | null;
  openDate: string | null;
  deadline: string | null;
  geography: string | null;
  costShare: string | null;
  assistanceListing: string | null;
  agency: string | null;
  applicationInstructions: string | null;
  requiredDocumentsJson: string | null;
  attachmentsJson: string | null;
  funding: ReturnType<typeof resolveFundingAmountFields>;
  raw: Record<string, unknown>;
} {
  const { root, synopsis } = unwrapGrantsGovDetail(detail);
  const awardFloor = parseAmount(
    pick(synopsis, ["awardFloor", "AwardFloor"]) ?? pick(root, ["awardFloor", "AwardFloor"])
  );
  const awardCeiling = parseAmount(
    pick(synopsis, ["awardCeiling", "AwardCeiling"]) ?? pick(root, ["awardCeiling", "AwardCeiling"])
  );
  const estimatedFunding = parseAmount(
    pick(synopsis, ["estimatedFunding", "EstimatedFunding", "estimatedTotalProgramFunding"])
      ?? pick(root, ["estimatedFunding", "EstimatedFunding"])
  );
  const anticipatedRaw = pick(synopsis, ["numberOfAwards", "expectedNumberOfAwards"])
    ?? pick(root, ["numberOfAwards"]);
  const anticipatedAwards = anticipatedRaw != null ? Number(String(anticipatedRaw).replace(/\D/g, "")) || null : null;

  const cfda =
    asText(pick(synopsis, ["cfdaList", "cfdaNumbers", "assistanceListings", "cfda"]))
    ?? asText(pick(root, ["cfdaList", "cfdaNumbers", "assistanceListings"]));

  const funding = resolveFundingAmountFields({ awardCeiling, awardFloor, estimatedFunding });

  return {
    awardFloor,
    awardCeiling,
    estimatedFunding,
    anticipatedAwards: Number.isFinite(anticipatedAwards as number) ? anticipatedAwards : null,
    eligibility: asText(
      pick(synopsis, ["applicantEligibilityDesc", "eligibilityDesc", "eligibility"])
        ?? pick(root, ["eligibility"])
    ),
    eligibleApplicantTypes: asText(
      pick(synopsis, ["applicantTypes", "eligibleApplicants", "applicantTypeDesc"])
    ),
    description: asText(
      pick(synopsis, ["fundingDesc", "synopsisDesc", "description", "opportunityCategoryExplanation"])
        ?? pick(root, ["description"])
    ),
    fundingInstrument: asText(pick(synopsis, ["fundingInstruments", "fundingInstrumentType"])),
    openDate: parseDate(pick(synopsis, ["postingDate", "openDate", "archiveDate"]) ?? pick(root, ["postingDate"])),
    deadline: parseDate(
      pick(synopsis, ["responseDate", "closingDate", "closeDate", "applicationDueDate"])
        ?? pick(root, ["closeDate", "closingDate"])
    ),
    geography: asText(pick(synopsis, ["applicantLocations", "eligibleLocations", "geography"])),
    costShare: asText(pick(synopsis, ["costSharing", "costSharingOrMatchingRequirement", "costShare"])),
    assistanceListing: cfda,
    agency: asText(
      pick(synopsis, ["agencyName", "owningAgencyCode", "agencyCode"])
        ?? pick(root, ["agencyName", "agency"])
    ),
    applicationInstructions: asText(
      pick(synopsis, ["fundingActivityCategories", "additionalInformationText", "applicationInstructions"])
    ),
    requiredDocumentsJson: asText(pick(synopsis, ["requiredDocuments", "documentTypes"])) ?? null,
    attachmentsJson: asText(pick(root, ["opportunityAttachments", "attachments", "files"])) ?? null,
    funding,
    raw: detail,
  };
}

export type ProgramMissionMatch = {
  slug: string;
  label: string;
  matchPct: number;
  rationale: string;
  eligibilityConcerns: string[];
  programGaps: string[];
};

export async function listIfcdcProgramProfiles(): Promise<Array<Record<string, unknown>>> {
  await ensureGrantTables();
  const db = await getDb();
  return db.all(`SELECT * FROM ifcdc_program_profiles ORDER BY label`);
}

export async function matchOpportunityToProgramProfiles(opp: Record<string, unknown>): Promise<ProgramMissionMatch[]> {
  await ensureGrantTables();
  const db = await getDb();
  const profiles = await db.all<{
    slug: string;
    label: string;
    mission_purpose: string | null;
    population_served: string | null;
    services_provided: string | null;
    keywords_json: string | null;
    geography: string | null;
    founder_completion_needed_json: string | null;
  }>(`SELECT * FROM ifcdc_program_profiles`);

  const blob = [
    opp.title,
    opp.description,
    opp.eligibility,
    opp.eligible_applicant_types,
    opp.program_areas,
    opp.division_slugs,
    opp.match_tags,
    opp.requirements,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const matches: ProgramMissionMatch[] = [];
  for (const p of profiles) {
    let keywords: string[] = [];
    try {
      keywords = JSON.parse(p.keywords_json || "[]");
    } catch {
      keywords = [];
    }
    const hitTerms: string[] = [];
    let hits = 0;
    for (const kw of keywords) {
      const k = kw.toLowerCase().replace(/_/g, " ");
      if (k && blob.includes(k)) {
        hits++;
        hitTerms.push(kw);
      }
    }
    const labelBits = p.label.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    for (const w of labelBits) {
      if (blob.includes(w)) {
        hits++;
        hitTerms.push(w);
      }
    }
    if (hits === 0) continue;

    const matchPct = Math.min(98, 40 + hits * 12);
    const gaps: string[] = [];
    try {
      const missing = JSON.parse(p.founder_completion_needed_json || "[]");
      if (Array.isArray(missing) && missing.length) {
        gaps.push(`Program profile incomplete (Founder completion needed): ${missing.slice(0, 4).join(", ")}`);
      }
    } catch {
      /* ignore */
    }
    const concerns: string[] = [];
    if (!p.mission_purpose) concerns.push("Program mission field incomplete in HQ profile");
    if (/individual|for-profit only/i.test(String(opp.eligibility || ""))) {
      concerns.push("Opportunity eligibility text may restrict applicant type");
    }

    matches.push({
      slug: p.slug,
      label: p.label,
      matchPct,
      rationale:
        `Matched official opportunity text to IFCDC profile "${p.label}" via terms: `
        + `${Array.from(new Set(hitTerms)).slice(0, 8).join(", ")}. `
        + `Profile geography: ${p.geography || "unspecified"}.`,
      eligibilityConcerns: concerns,
      programGaps: gaps,
    });
  }

  return matches.sort((a, b) => b.matchPct - a.matchPct).slice(0, 6);
}

/**
 * Enrich one HQ opportunity from official Grants.gov fetchOpportunity (when source is grants_gov).
 */
export async function enrichOpportunityFromOfficialSource(
  opportunityId: string,
  opts?: { actorEmail?: string }
): Promise<{
  opportunityId: string;
  enrichmentStatus: string;
  fundingAmountStatus: FundingAmountStatus;
  fundingValueSource: FundingValueSource;
  pipelineValue: number | null;
  explanation: string;
  officialUrl: string | null;
  programMatches: ProgramMissionMatch[];
}> {
  await ensureGrantTables();
  const db = await getDb();
  const opp = await db.get<Record<string, unknown>>(
    "SELECT * FROM grant_opportunities WHERE id = ?",
    opportunityId
  );
  if (!opp) throw new Error(`Opportunity not found: ${opportunityId}`);

  const now = new Date().toISOString();
  let enrichmentStatus = "partial_local";
  let extracted = extractEnrichmentFromGrantsGovDetail({});
  let officialUrl = String(opp.url || "") || null;

  if (String(opp.source_type) === "grants_gov" && opp.external_id) {
    const detail = await fetchGrantsGovOpportunityDetail(String(opp.external_id));
    if (detail) {
      extracted = extractEnrichmentFromGrantsGovDetail(detail);
      enrichmentStatus = "enriched_official";
      officialUrl =
        String(opp.url || "")
        || `https://www.grants.gov/search-results-detail/${opp.external_id}`;
    } else {
      enrichmentStatus = "fetch_failed";
      extracted = resolveLocalFundingFallback(opp);
    }
  } else {
    extracted = resolveLocalFundingFallback(opp);
    enrichmentStatus = String(opp.source_type) === "grants_gov" ? "missing_external_id" : "non_grants_gov_source";
  }

  const funding = extracted.funding;
  const programMatches = await matchOpportunityToProgramProfiles({
    ...opp,
    description: extracted.description || opp.description,
    eligibility: extracted.eligibility || opp.eligibility,
    eligible_applicant_types: extracted.eligibleApplicantTypes || opp.eligible_applicant_types,
  });

  const best = programMatches[0] || null;

  await db.run(
    `UPDATE grant_opportunities SET
       award_floor = COALESCE(?, award_floor),
       award_ceiling = COALESCE(?, award_ceiling),
       estimated_funding = COALESCE(?, estimated_funding),
       amount_min = COALESCE(?, amount_min),
       amount_max = COALESCE(?, amount_max),
       anticipated_awards = COALESCE(?, anticipated_awards),
       eligibility = COALESCE(?, eligibility),
       eligible_applicant_types = COALESCE(?, eligible_applicant_types),
       description = CASE WHEN ? IS NOT NULL AND LENGTH(?) > LENGTH(COALESCE(description, '')) THEN ? ELSE description END,
       funding_instrument = COALESCE(?, funding_instrument),
       open_date = COALESCE(?, open_date),
       deadline = COALESCE(?, deadline, close_date),
       close_date = COALESCE(?, close_date, deadline),
       geography = COALESCE(?, geography),
       cost_share_required = COALESCE(?, cost_share_required),
       assistance_listing = COALESCE(?, assistance_listing),
       funder = CASE WHEN ? IS NOT NULL AND (funder IS NULL OR funder = '' OR funder LIKE 'U.S. Federal%') THEN ? ELSE funder END,
       application_instructions = COALESCE(?, application_instructions),
       required_documents_json = COALESCE(?, required_documents_json),
       attachments_json = COALESCE(?, attachments_json),
       funding_amount_status = ?,
       funding_value_source = ?,
       enrichment_status = ?,
       enriched_at = ?,
       last_verified_at = ?,
       raw_source_json = COALESCE(?, raw_source_json),
       best_program_slug = ?,
       best_program_match_pct = ?,
       program_match_json = ?,
       data_confidence = ?,
       updated_at = ?
     WHERE id = ?`,
    funding.pipelineValue != null && funding.valueSource === "award_floor" ? extracted.awardFloor : extracted.awardFloor,
    extracted.awardCeiling,
    extracted.estimatedFunding,
    extracted.awardFloor,
    extracted.awardCeiling ?? extracted.estimatedFunding,
    extracted.anticipatedAwards,
    extracted.eligibility,
    extracted.eligibleApplicantTypes,
    extracted.description,
    extracted.description,
    extracted.description,
    extracted.fundingInstrument,
    extracted.openDate,
    extracted.deadline,
    extracted.deadline,
    extracted.geography,
    extracted.costShare,
    extracted.assistanceListing,
    extracted.agency,
    extracted.agency,
    extracted.applicationInstructions,
    extracted.requiredDocumentsJson,
    extracted.attachmentsJson,
    funding.status,
    funding.valueSource,
    enrichmentStatus,
    now,
    now,
    extracted.raw && Object.keys(extracted.raw).length
      ? JSON.stringify(extracted.raw).slice(0, 50_000)
      : null,
    best?.slug ?? null,
    best?.matchPct ?? null,
    JSON.stringify(programMatches),
    funding.status === "verified" ? "high" : funding.status === "partial" ? "medium" : "low",
    now,
    opportunityId
  );

  for (const m of programMatches) {
    await db.run(
      `INSERT INTO grant_matches (
         id, opportunity_id, program_slug, program_label, match_score, match_pct, rationale,
         eligibility_concerns, program_gaps, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(opportunity_id, program_slug) DO UPDATE SET
         match_score = excluded.match_score,
         match_pct = excluded.match_pct,
         rationale = excluded.rationale,
         eligibility_concerns = excluded.eligibility_concerns,
         program_gaps = excluded.program_gaps,
         program_label = excluded.program_label,
         updated_at = excluded.updated_at`,
      crypto.randomUUID(),
      opportunityId,
      m.slug,
      m.label,
      m.matchPct,
      m.matchPct,
      m.rationale,
      m.eligibilityConcerns.join("; ") || null,
      m.programGaps.join("; ") || null,
      now,
      now
    );
  }

  await logGrantActivity(
    "opportunity",
    opportunityId,
    "enrichment_8a2",
    `${enrichmentStatus} · funding=${funding.status}/${funding.valueSource} · value=${funding.pipelineValue ?? "UNKNOWN"} · best=${best?.slug || "none"}@${best?.matchPct ?? 0}%`,
    opts?.actorEmail
  );

  return {
    opportunityId,
    enrichmentStatus,
    fundingAmountStatus: funding.status,
    fundingValueSource: funding.valueSource,
    pipelineValue: funding.pipelineValue,
    explanation: funding.explanation,
    officialUrl,
    programMatches,
  };
}

function resolveLocalFundingFallback(opp: Record<string, unknown>) {
  const awardFloor = parseAmount(opp.award_floor ?? opp.amount_min);
  const awardCeiling = parseAmount(opp.award_ceiling ?? opp.amount_max);
  const estimatedFunding = parseAmount(opp.estimated_funding);
  const funding = resolveFundingAmountFields({ awardCeiling, awardFloor, estimatedFunding });
  return {
    awardFloor,
    awardCeiling,
    estimatedFunding,
    anticipatedAwards: opp.anticipated_awards != null ? Number(opp.anticipated_awards) || null : null,
    eligibility: asText(opp.eligibility),
    eligibleApplicantTypes: asText(opp.eligible_applicant_types),
    description: asText(opp.description),
    fundingInstrument: asText(opp.funding_instrument),
    openDate: asText(opp.open_date),
    deadline: asText(opp.deadline ?? opp.close_date),
    geography: asText(opp.geography),
    costShare: asText(opp.cost_share_required),
    assistanceListing: asText(opp.assistance_listing),
    agency: asText(opp.funder),
    applicationInstructions: asText(opp.application_instructions),
    requiredDocumentsJson: asText(opp.required_documents_json),
    attachmentsJson: asText(opp.attachments_json),
    funding,
    raw: {},
  };
}

export async function enrichOpportunitiesBatch(opts?: {
  limit?: number;
  actorEmail?: string;
  onlyUnenriched?: boolean;
}): Promise<{ enriched: number; unknownFunding: number; verifiedFunding: number; results: Array<Record<string, unknown>> }> {
  await ensureGrantTables();
  const db = await getDb();
  const limit = opts?.limit ?? 40;
  const rows = await db.all<{ id: string }>(
    opts?.onlyUnenriched
      ? `SELECT id FROM grant_opportunities
         WHERE (duplicate_of_id IS NULL OR duplicate_of_id = '')
           AND (enrichment_status IS NULL OR enrichment_status IN ('pending', 'fetch_failed', 'partial_local'))
         ORDER BY datetime(updated_at) DESC LIMIT ?`
      : `SELECT id FROM grant_opportunities
         WHERE (duplicate_of_id IS NULL OR duplicate_of_id = '')
         ORDER BY datetime(updated_at) DESC LIMIT ?`,
    limit
  );

  let enriched = 0;
  let unknownFunding = 0;
  let verifiedFunding = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const r = await enrichOpportunityFromOfficialSource(row.id, { actorEmail: opts?.actorEmail });
    enriched++;
    if (r.fundingAmountStatus === "unknown") unknownFunding++;
    if (r.fundingAmountStatus === "verified" || r.fundingAmountStatus === "partial") verifiedFunding++;
    results.push(r);
    // polite pacing for Grants.gov
    await new Promise((r) => setTimeout(r, 120));
  }

  return { enriched, unknownFunding, verifiedFunding, results };
}
