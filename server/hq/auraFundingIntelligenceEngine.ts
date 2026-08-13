/**
 * AURA Funding Intelligence Engine — Phase 8A.
 *
 * Pipeline: Official sources → ingest → eligibility → program match → score →
 * dedupe → HQ grant_opportunities → Founder dashboard → AURA query access.
 *
 * Does NOT submit applications, sign certifications, accept awards, or move funds.
 * Does NOT touch Twilio / SMS / Phase 6–7 AURA core paths.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { ensureGrantTables, logGrantActivity } from "./grantsSchema";
import { IFCDC_FUNDING_DIVISIONS } from "./grantFundingEngine";
import { syncGrantFeeds } from "./grantFeedConnectors";

export type EligibilityResult =
  | "eligible"
  | "possibly_eligible"
  | "not_eligible"
  | "insufficient_information";

export type QualificationClass =
  | "priority"
  | "strong"
  | "review"
  | "watch";

const SCORE_WEIGHTS = {
  missionAlignment: 25,
  eligibility: 25,
  programFit: 15,
  geographicFit: 10,
  awardPotential: 10,
  deadlineFeasibility: 5,
  organizationalReadiness: 5,
  complianceReadiness: 5,
} as const;

const IFCDC_ORG = {
  legalName: "Imperial Foundation Community Development Corporation",
  type: "501(c)(3)",
  geography: ["NJ", "New Jersey", "Monmouth", "US", "United States", "National"],
  applicantTypes: ["nonprofit", "501(c)(3)", "community development", "cdc", "organization"],
  missionKeywords: [
    "community", "youth", "violence", "gang", "workforce", "barber", "housing",
    "mentorship", "education", "economic", "nonprofit", "outreach", "prevention",
    "scholarship", "inclusive", "reentry", "training",
  ],
};

function fingerprintOpportunity(opts: {
  title: string;
  funder: string;
  externalId?: string | null;
  assistanceListing?: string | null;
  deadline?: string | null;
}): string {
  const base = [
    (opts.externalId || "").trim().toLowerCase(),
    (opts.assistanceListing || "").trim().toLowerCase(),
    (opts.title || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").slice(0, 120),
    (opts.funder || "").trim().toLowerCase().slice(0, 80),
    (opts.deadline || "").trim().slice(0, 10),
  ].join("|");
  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 40);
}

async function writeAudit(opts: {
  opportunityId?: string | null;
  source?: string | null;
  action: string;
  eligibilityResult?: string | null;
  score?: number | null;
  detail?: string;
  actorEmail?: string | null;
  sourceVerifiedAt?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO grant_audit_events
     (id, opportunity_id, source, action, eligibility_result, score, detail, actor_email, source_verified_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    opts.opportunityId ?? null,
    opts.source ?? null,
    opts.action,
    opts.eligibilityResult ?? null,
    opts.score ?? null,
    opts.detail ?? null,
    opts.actorEmail ?? null,
    opts.sourceVerifiedAt ?? null,
    new Date().toISOString()
  );
}

function emitGrantOpsEvent(opts: {
  type:
    | "grant_priority_discovered"
    | "grant_opportunity_updated"
    | "grant_deadline_approaching"
    | "grant_eligibility_changed"
    | "system";
  title: string;
  detail: string;
  opportunityId?: string | null;
  severity?: "info" | "watch" | "high";
  metadata?: Record<string, unknown>;
  alertFounder?: boolean;
}): void {
  void import("./auraOperationalEvents").then(({ emitAuraOperationalEventAsync }) =>
    emitAuraOperationalEventAsync({
      type: opts.type,
      title: opts.title,
      detail: opts.detail,
      entityType: "grant_opportunity",
      entityId: opts.opportunityId ?? null,
      severity: opts.severity ?? "info",
      alertFounder: opts.alertFounder === true,
      metadata: {
        phase8a: true,
        grantEvent: opts.type,
        ...(opts.metadata || {}),
      },
    })
  );
}

export function evaluateIfcdcEligibility(opp: {
  title?: string | null;
  description?: string | null;
  eligibility?: string | null;
  eligible_applicant_types?: string | null;
  geography?: string | null;
  funder_type?: string | null;
}): { result: EligibilityResult; reasons: string[] } {
  const blob = [
    opp.title,
    opp.description,
    opp.eligibility,
    opp.eligible_applicant_types,
    opp.geography,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const reasons: string[] = [];
  if (!blob.trim()) {
    return { result: "insufficient_information", reasons: ["No eligibility or description text available from source"] };
  }

  const forProfitOnly = /\b(for-profit only|for profit only|individuals only|individual applicants only)\b/i.test(blob)
    && !/nonprofit|501\s*\(c\)\s*\(3\)|non-profit|community development/i.test(blob);
  const individualsOnly = /\bindividuals?\s+only\b/i.test(blob) && !/organization|nonprofit|501/i.test(blob);
  const stateAgencyOnly = /\b(state agencies? only|units? of local government only|tribal governments? only)\b/i.test(blob)
    && !/nonprofit|501|community-based|cbo/i.test(blob);

  if (forProfitOnly || individualsOnly || stateAgencyOnly) {
    reasons.push("Applicant type appears to exclude 501(c)(3) community development corporations");
    return { result: "not_eligible", reasons };
  }

  const nonprofitOk = /nonprofit|non-profit|501\s*\(c\)\s*\(3\)|community.based|cbo|cdc|charitable|organization/i.test(blob);
  const geo = (opp.geography || "").toLowerCase();
  const geoOk =
    !geo
    || /us|united states|national|nationwide|all states|nj|new jersey|monmouth/i.test(geo + " " + blob)
    || geo === "us";
  const geoBlocked = /\b(california only|texas only|ny only|new york city only)\b/i.test(blob)
    && !/nj|new jersey|national|all states|nationwide/i.test(blob);

  if (geoBlocked) {
    reasons.push("Geographic restriction appears to exclude New Jersey / IFCDC service area");
    return { result: "not_eligible", reasons };
  }

  if (nonprofitOk && geoOk) {
    reasons.push("Applicant language compatible with 501(c)(3) CDC");
    if (geo) reasons.push(`Geography "${opp.geography}" compatible with IFCDC NJ / national federal awards`);
    return { result: "eligible", reasons };
  }

  if (nonprofitOk || geoOk) {
    reasons.push("Partial signals only — Founder/legal review required before pursuit");
    return { result: "possibly_eligible", reasons };
  }

  reasons.push("Eligibility text present but insufficient to confirm IFCDC qualification");
  return { result: "insufficient_information", reasons };
}

function matchPrograms(opp: {
  title?: string | null;
  description?: string | null;
  program_areas?: string | null;
  division_slugs?: string | null;
  match_tags?: string | null;
}): Array<{ slug: string; label: string; matchScore: number; rationale: string }> {
  const blob = [
    opp.title,
    opp.description,
    opp.program_areas,
    opp.division_slugs,
    opp.match_tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const matches: Array<{ slug: string; label: string; matchScore: number; rationale: string }> = [];
  for (const div of IFCDC_FUNDING_DIVISIONS) {
    let hits = 0;
    const hitTerms: string[] = [];
    for (const term of div.programs) {
      if (blob.includes(term.replace(/_/g, " ")) || blob.includes(term)) {
        hits++;
        hitTerms.push(term);
      }
    }
    if (blob.includes(div.slug.replace(/_/g, " ")) || blob.includes(div.slug)) {
      hits += 2;
      hitTerms.push(div.slug);
    }
    if (hits > 0) {
      const matchScore = Math.min(100, 40 + hits * 15);
      matches.push({
        slug: div.slug,
        label: div.label,
        matchScore,
        rationale: `Matched terms: ${Array.from(new Set(hitTerms)).slice(0, 6).join(", ")}`,
      });
    }
  }
  return matches.sort((a, b) => b.matchScore - a.matchScore).slice(0, 5);
}

function scoreOpportunity8A(opts: {
  opp: Record<string, unknown>;
  eligibility: EligibilityResult;
  programMatches: Array<{ matchScore: number; slug: string }>;
}): {
  total: number;
  classification: QualificationClass;
  breakdown: Record<string, { points: number; max: number; note: string }>;
} {
  const blob = `${opts.opp.title || ""} ${opts.opp.description || ""} ${opts.opp.program_areas || ""}`.toLowerCase();
  let missionHits = 0;
  for (const k of IFCDC_ORG.missionKeywords) {
    if (blob.includes(k)) missionHits++;
  }
  const missionAlignment = Math.min(
    SCORE_WEIGHTS.missionAlignment,
    Math.round((missionHits / 6) * SCORE_WEIGHTS.missionAlignment)
  );

  const eligibilityPoints =
    opts.eligibility === "eligible"
      ? SCORE_WEIGHTS.eligibility
      : opts.eligibility === "possibly_eligible"
        ? Math.round(SCORE_WEIGHTS.eligibility * 0.55)
        : opts.eligibility === "insufficient_information"
          ? Math.round(SCORE_WEIGHTS.eligibility * 0.25)
          : 0;

  const bestProgram = opts.programMatches[0]?.matchScore ?? 0;
  const programFit = Math.round((bestProgram / 100) * SCORE_WEIGHTS.programFit);

  const geoBlob = `${opts.opp.geography || ""} ${blob}`.toLowerCase();
  const geographicFit = /nj|new jersey|monmouth|national|nationwide|us\b|united states|all states/.test(geoBlob)
    ? SCORE_WEIGHTS.geographicFit
    : Math.round(SCORE_WEIGHTS.geographicFit * 0.4);

  const fundingStatus = String(opts.opp.funding_amount_status || "unknown");
  const valueSource = String(opts.opp.funding_value_source || "");
  const ceiling =
    valueSource === "estimated_total_funding"
      ? Number(opts.opp.estimated_funding ?? opts.opp.amount_max ?? 0) || 0
      : valueSource === "award_floor"
        ? Number(opts.opp.award_floor ?? opts.opp.amount_min ?? 0) || 0
        : Number(opts.opp.award_ceiling ?? opts.opp.amount_max ?? 0) || 0;
  const awardPotential =
    fundingStatus === "unknown" || fundingStatus === "conflicting" || !ceiling
      ? Math.round(SCORE_WEIGHTS.awardPotential * 0.35) // unknown ≠ zero dollars; neutral-low points only
      : ceiling >= 1_000_000
        ? SCORE_WEIGHTS.awardPotential
        : ceiling >= 250_000
          ? Math.round(SCORE_WEIGHTS.awardPotential * 0.8)
          : ceiling >= 50_000
            ? Math.round(SCORE_WEIGHTS.awardPotential * 0.55)
            : Math.round(SCORE_WEIGHTS.awardPotential * 0.4);

  const deadline = String(opts.opp.deadline || opts.opp.close_date || "");
  let deadlineFeasibility = Math.round(SCORE_WEIGHTS.deadlineFeasibility * 0.5);
  let deadlineNote = "Deadline unknown or distant";
  if (deadline) {
    const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
    if (Number.isFinite(days)) {
      if (days < 0) {
        deadlineFeasibility = 0;
        deadlineNote = "Deadline passed";
      } else if (days < 14) {
        deadlineFeasibility = Math.round(SCORE_WEIGHTS.deadlineFeasibility * 0.4);
        deadlineNote = `${days} days remaining — tight`;
      } else if (days <= 90) {
        deadlineFeasibility = SCORE_WEIGHTS.deadlineFeasibility;
        deadlineNote = `${days} days — feasible window`;
      } else {
        deadlineFeasibility = Math.round(SCORE_WEIGHTS.deadlineFeasibility * 0.7);
        deadlineNote = `${days} days — planning horizon`;
      }
    }
  }

  const organizationalReadiness = SCORE_WEIGHTS.organizationalReadiness;
  const complianceReadiness = SCORE_WEIGHTS.complianceReadiness;

  const breakdown = {
    missionAlignment: {
      points: missionAlignment,
      max: SCORE_WEIGHTS.missionAlignment,
      note: `${missionHits} mission keyword hits`,
    },
    eligibility: {
      points: eligibilityPoints,
      max: SCORE_WEIGHTS.eligibility,
      note: `Eligibility result: ${opts.eligibility}`,
    },
    programFit: {
      points: programFit,
      max: SCORE_WEIGHTS.programFit,
      note: opts.programMatches[0]
        ? `Best program ${opts.programMatches[0].slug} (${opts.programMatches[0].matchScore})`
        : "No strong program match",
    },
    geographicFit: {
      points: geographicFit,
      max: SCORE_WEIGHTS.geographicFit,
      note: String(opts.opp.geography || "unspecified"),
    },
    awardPotential: {
      points: awardPotential,
      max: SCORE_WEIGHTS.awardPotential,
      note:
        fundingStatus === "unknown"
          ? "Funding Amount = UNKNOWN (not scored as $0)"
          : ceiling
            ? `Ceiling $${ceiling.toLocaleString()} (${fundingStatus}/${opts.opp.funding_value_source || "n/a"})`
            : `Funding status ${fundingStatus}`,
    },
    deadlineFeasibility: {
      points: deadlineFeasibility,
      max: SCORE_WEIGHTS.deadlineFeasibility,
      note: deadlineNote,
    },
    organizationalReadiness: {
      points: organizationalReadiness,
      max: SCORE_WEIGHTS.organizationalReadiness,
      note: "IFCDC Grant Center + Writer Studio available",
    },
    complianceReadiness: {
      points: complianceReadiness,
      max: SCORE_WEIGHTS.complianceReadiness,
      note: "Compliance / reporting modules present in HQ",
    },
  };

  const total = Object.values(breakdown).reduce((s, b) => s + b.points, 0);
  const classification: QualificationClass =
    total >= 90 ? "priority" : total >= 75 ? "strong" : total >= 60 ? "review" : "watch";

  return { total, classification, breakdown };
}

async function findDuplicate(opts: {
  fingerprint: string;
  sourceType: string;
  externalId: string;
}): Promise<{ id: string; reason: string } | null> {
  const db = await getDb();
  const byExt = await db.get<{ id: string }>(
    "SELECT id FROM grant_opportunities WHERE source_type = ? AND external_id = ? LIMIT 1",
    opts.sourceType,
    opts.externalId
  );
  if (byExt) return { id: byExt.id, reason: "source_external_id" };

  const byFp = await db.get<{ id: string }>(
    "SELECT id FROM grant_opportunities WHERE fingerprint = ? LIMIT 1",
    opts.fingerprint
  );
  if (byFp) return { id: byFp.id, reason: "fingerprint" };
  return null;
}

export async function enrichAndQualifyOpportunity(
  opportunityId: string,
  opts?: { actorEmail?: string; emitEvents?: boolean; stage?: "preliminary" | "enriched" }
): Promise<{
  opportunityId: string;
  eligibility: EligibilityResult;
  score: number;
  classification: QualificationClass;
  programs: string[];
  fundingAmountStatus?: string;
  pipelineValue?: number | null;
}> {
  const db = await getDb();

  // Phase 8A.2: capture preliminary Search2 score before official enrichment
  const oppPre = await db.get<Record<string, unknown>>(
    "SELECT * FROM grant_opportunities WHERE id = ?",
    opportunityId
  );
  if (!oppPre) throw new Error(`Opportunity not found: ${opportunityId}`);

  if (oppPre.preliminary_score == null) {
    const preElig = evaluateIfcdcEligibility({
      title: String(oppPre.title || ""),
      description: String(oppPre.description || ""),
      eligibility: String(oppPre.eligibility || ""),
      eligible_applicant_types: String(oppPre.eligible_applicant_types || ""),
      geography: String(oppPre.geography || ""),
      funder_type: String(oppPre.funder_type || ""),
    });
    const prePrograms = matchPrograms({
      title: String(oppPre.title || ""),
      description: String(oppPre.description || ""),
      program_areas: String(oppPre.program_areas || ""),
      division_slugs: String(oppPre.division_slugs || ""),
      match_tags: String(oppPre.match_tags || ""),
    });
    const preScored = scoreOpportunity8A({
      opp: { ...oppPre, funding_amount_status: oppPre.funding_amount_status || "unknown" },
      eligibility: preElig.result,
      programMatches: prePrograms,
    });
    await db.run(
      `UPDATE grant_opportunities SET preliminary_score = ?, updated_at = ? WHERE id = ?`,
      preScored.total,
      new Date().toISOString(),
      opportunityId
    );
    await db.run(
      `INSERT INTO grant_qualification_scores (id, opportunity_id, total_score, classification, breakdown_json, model, created_at)
       VALUES (?, ?, ?, ?, ?, 'ifcdc-qualification-8a-preliminary', ?)`,
      crypto.randomUUID(),
      opportunityId,
      preScored.total,
      preScored.classification,
      JSON.stringify(preScored.breakdown),
      new Date().toISOString()
    );
  }

  // Full official opportunity enrichment → then rescore
  let enrichmentMeta: Awaited<ReturnType<typeof import("./auraFundingEnrichmentEngine").enrichOpportunityFromOfficialSource>> | null = null;
  try {
    const { enrichOpportunityFromOfficialSource } = await import("./auraFundingEnrichmentEngine");
    enrichmentMeta = await enrichOpportunityFromOfficialSource(opportunityId, {
      actorEmail: opts?.actorEmail,
    });
  } catch (err) {
    console.warn(
      "[funding-intel] enrichment skipped:",
      err instanceof Error ? err.message : err
    );
  }

  const opp = await db.get<Record<string, unknown>>(
    "SELECT * FROM grant_opportunities WHERE id = ?",
    opportunityId
  );
  if (!opp) throw new Error(`Opportunity not found: ${opportunityId}`);

  const eligibility = evaluateIfcdcEligibility({
    title: String(opp.title || ""),
    description: String(opp.description || ""),
    eligibility: String(opp.eligibility || ""),
    eligible_applicant_types: String(opp.eligible_applicant_types || ""),
    geography: String(opp.geography || ""),
    funder_type: String(opp.funder_type || ""),
  });

  const programsFromEnrichment = enrichmentMeta?.programMatches?.length
    ? enrichmentMeta.programMatches.map((m) => ({
        slug: m.slug,
        label: m.label,
        matchScore: m.matchPct,
        rationale: m.rationale,
      }))
    : matchPrograms({
        title: String(opp.title || ""),
        description: String(opp.description || ""),
        program_areas: String(opp.program_areas || ""),
        division_slugs: String(opp.division_slugs || ""),
        match_tags: String(opp.match_tags || ""),
      });

  const programs = programsFromEnrichment;

  const scored = scoreOpportunity8A({
    opp,
    eligibility: eligibility.result,
    programMatches: programs,
  });

  const now = new Date().toISOString();
  const fp = fingerprintOpportunity({
    title: String(opp.title || ""),
    funder: String(opp.funder || ""),
    externalId: String(opp.external_id || ""),
    assistanceListing: String(opp.assistance_listing || ""),
    deadline: String(opp.deadline || opp.close_date || ""),
  });

  await db.run(
    `INSERT INTO grant_eligibility_checks (id, opportunity_id, result, reasons_json, checked_at, model, actor)
     VALUES (?, ?, ?, ?, ?, 'ifcdc-eligibility-8a', ?)`,
    crypto.randomUUID(),
    opportunityId,
    eligibility.result,
    JSON.stringify(eligibility.reasons),
    now,
    opts?.actorEmail ?? "aura"
  );

  for (const m of programs) {
    await db.run(
      `INSERT INTO grant_matches (id, opportunity_id, program_slug, program_label, match_score, match_pct, rationale, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(opportunity_id, program_slug) DO UPDATE SET
         match_score = excluded.match_score,
         match_pct = COALESCE(excluded.match_pct, grant_matches.match_pct),
         rationale = excluded.rationale,
         program_label = excluded.program_label,
         updated_at = excluded.updated_at`,
      crypto.randomUUID(),
      opportunityId,
      m.slug,
      m.label,
      m.matchScore,
      m.matchScore,
      m.rationale,
      now,
      now
    );
  }

  await db.run(
    `INSERT INTO grant_qualification_scores (id, opportunity_id, total_score, classification, breakdown_json, model, created_at)
     VALUES (?, ?, ?, ?, ?, 'ifcdc-qualification-8a2-enriched', ?)`,
    crypto.randomUUID(),
    opportunityId,
    scored.total,
    scored.classification,
    JSON.stringify(scored.breakdown),
    now
  );

  const divisionSlugs = JSON.stringify(programs.map((p) => p.slug));
  const programAreas = JSON.stringify(programs.flatMap((p) => [p.slug]));
  const prevEligibility = String(opp.eligibility_result || "");

  await db.run(
    `UPDATE grant_opportunities SET
       fingerprint = ?,
       eligibility_result = ?,
       qualification_score = ?,
       qualification_class = ?,
       enriched_final_score = ?,
       division_slugs = CASE WHEN ? != '[]' THEN ? ELSE division_slugs END,
       program_areas = CASE WHEN ? != '[]' THEN ? ELSE program_areas END,
       last_verified_at = ?,
       pipeline_stage = CASE
         WHEN ? = 'not_eligible' THEN 'archived'
         WHEN ? = 'priority' THEN 'priority_review'
         WHEN pipeline_stage IS NULL OR pipeline_stage = 'discovered' THEN 'qualified_review'
         ELSE pipeline_stage
       END,
       updated_at = ?
     WHERE id = ?`,
    fp,
    eligibility.result,
    scored.total,
    scored.classification,
    scored.total,
    divisionSlugs,
    divisionSlugs,
    programAreas,
    programAreas,
    now,
    eligibility.result,
    scored.classification,
    now,
    opportunityId
  );

  await writeAudit({
    opportunityId,
    source: String(opp.source_type || ""),
    action: opts?.stage === "preliminary" ? "qualify_8a_preliminary" : "qualify_8a2_enriched",
    eligibilityResult: eligibility.result,
    score: scored.total,
    detail:
      `${scored.classification} · ${eligibility.result} · funding=${opp.funding_amount_status || enrichmentMeta?.fundingAmountStatus || "n/a"}`
      + ` · value=${enrichmentMeta?.pipelineValue ?? "UNKNOWN"} · programs=${programs.map((p) => p.slug).join(",") || "none"}`,
    actorEmail: opts?.actorEmail ?? "aura",
    sourceVerifiedAt: now,
  });

  await logGrantActivity(
    "opportunity",
    opportunityId,
    "funding_intelligence_8a2",
    `score=${scored.total} class=${scored.classification} eligibility=${eligibility.result} funding=${opp.funding_amount_status || "n/a"}`,
    opts?.actorEmail
  );

  if (opts?.emitEvents !== false) {
    if (scored.classification === "priority" && eligibility.result !== "not_eligible") {
      emitGrantOpsEvent({
        type: "grant_priority_discovered",
        title: `Priority grant: ${String(opp.title || "").slice(0, 80)}`,
        detail: `Score ${scored.total} · ${eligibility.result} · source ${opp.source_type || "unknown"}`,
        opportunityId,
        severity: "high",
        alertFounder: true,
        metadata: { score: scored.total, classification: scored.classification, url: opp.url },
      });
    } else if (prevEligibility && prevEligibility !== eligibility.result) {
      emitGrantOpsEvent({
        type: "grant_eligibility_changed",
        title: `Eligibility changed: ${String(opp.title || "").slice(0, 80)}`,
        detail: `${prevEligibility} → ${eligibility.result}`,
        opportunityId,
        severity: "watch",
      });
    }
  }

  return {
    opportunityId,
    eligibility: eligibility.result,
    score: scored.total,
    classification: scored.classification,
    programs: programs.map((p) => p.slug),
    fundingAmountStatus: String(opp.funding_amount_status || enrichmentMeta?.fundingAmountStatus || "unknown"),
    pipelineValue: enrichmentMeta?.pipelineValue ?? null,
  };
}

/**
 * Live Funding Intelligence scan: ingest official feeds, qualify, dedupe, metrics.
 */
export async function runFundingIntelligenceScan(opts?: {
  actorEmail?: string;
  providers?: Array<"grants_gov" | "foundation_directory" | "corporate_csr" | "sam_gov">;
  limitQualify?: number;
}): Promise<{
  scannedAt: string;
  feedResults: unknown[];
  ingested: number;
  qualified: number;
  duplicatesMerged: number;
  metrics: Awaited<ReturnType<typeof buildFundingIntelligenceMetrics>>;
  sample: Array<Record<string, unknown>>;
}> {
  await ensureGrantTables();
  const scannedAt = new Date().toISOString();
  const providers = opts?.providers ?? ["grants_gov"];

  const feedResults = await syncGrantFeeds({ providers });
  const db = await getDb();

  // Mark source sync times
  for (const fr of feedResults) {
    await db.run(
      `UPDATE grant_sources SET last_sync_at = ?, updated_at = ? WHERE provider_key = ?`,
      scannedAt,
      scannedAt,
      fr.provider
    ).catch(() => undefined);
  }

  const recent = await db.all<Record<string, unknown>>(
    `SELECT id, title, funder, source_type, external_id, assistance_listing, deadline, close_date, url,
            amount_min, amount_max, eligibility_result, qualification_score, fingerprint
     FROM grant_opportunities
     WHERE is_live = 1 OR source_type IN ('grants_gov', 'foundation_directory', 'corporate_csr')
     ORDER BY datetime(updated_at) DESC
     LIMIT ?`,
    opts?.limitQualify ?? 80
  );

  let qualified = 0;
  let duplicatesMerged = 0;
  const sample: Array<Record<string, unknown>> = [];

  for (const row of recent) {
    const fp = fingerprintOpportunity({
      title: String(row.title || ""),
      funder: String(row.funder || ""),
      externalId: String(row.external_id || ""),
      assistanceListing: String(row.assistance_listing || ""),
      deadline: String(row.deadline || row.close_date || ""),
    });

    // Cross-source duplicate: same fingerprint, different row
    const dup = await db.get<{ id: string }>(
      `SELECT id FROM grant_opportunities WHERE fingerprint = ? AND id != ? LIMIT 1`,
      fp,
      row.id
    );
    if (dup) {
      await db.run(
        `UPDATE grant_opportunities SET duplicate_of_id = ?, updated_at = ? WHERE id = ?`,
        dup.id,
        scannedAt,
        row.id
      );
      duplicatesMerged++;
      await writeAudit({
        opportunityId: String(row.id),
        source: String(row.source_type || ""),
        action: "dedupe_8a",
        detail: `Merged as duplicate of ${dup.id}`,
        actorEmail: opts?.actorEmail ?? "aura",
      });
      continue;
    }

    const result = await enrichAndQualifyOpportunity(String(row.id), {
      actorEmail: opts?.actorEmail,
      emitEvents: true,
    });
    qualified++;
    if (sample.length < 12) {
      const refreshed = await db.get<Record<string, unknown>>(
        `SELECT id, title, funder, url, source_type, external_id, eligibility_result,
                qualification_score, qualification_class, preliminary_score, enriched_final_score,
                amount_max, award_ceiling, estimated_funding, funding_amount_status, funding_value_source,
                best_program_slug, best_program_match_pct, deadline, fingerprint, enrichment_status
         FROM grant_opportunities WHERE id = ?`,
        result.opportunityId
      );
      if (refreshed) {
        sample.push({
          ...refreshed,
          programs: result.programs,
          fundingAmountStatus: result.fundingAmountStatus,
          pipelineValue: result.pipelineValue,
          officialSourceUrl: refreshed.url,
          sourceOpportunityId: refreshed.external_id,
        });
      }
    }
  }

  const ingested = feedResults.reduce((s, r) => s + (r.imported || 0) + (r.updated || 0), 0);
  const metrics = await buildFundingIntelligenceMetrics();

  await writeAudit({
    action: "scan_8a_complete",
    detail: `providers=${providers.join(",")} ingested≈${ingested} qualified=${qualified} dupes=${duplicatesMerged}`,
    actorEmail: opts?.actorEmail ?? "aura",
    sourceVerifiedAt: scannedAt,
  });

  return {
    scannedAt,
    feedResults,
    ingested,
    qualified,
    duplicatesMerged,
    metrics,
    sample,
  };
}

export async function buildFundingIntelligenceMetrics(): Promise<{
  totalOpportunitiesDiscovered: number;
  potentiallyEligibleCount: number;
  fullyQualifiedCount: number;
  totalPotentialFundingDiscovered: number;
  /** Verified/partial numeric award values only — never treats UNKNOWN as $0 */
  qualifiedIfcdcFunding: number;
  verifiedQualifiedPipelineValue: number;
  unknownValueQualifiedCount: number;
  priorityPipelineValue: number;
  applicationsInPreparation: number;
  submittedApplicationValue: number;
  awardedValue: number;
  availableForAllocationValue: number;
  qualifiedCount: number;
  priorityCount: number;
  upcomingDeadlines: number;
  needingFounderReview: number;
  dataConfidence: "high" | "medium" | "low";
  pipelineSummary: string;
}> {
  await ensureGrantTables();
  const db = await getDb();

  /** Only sum published numeric award fields when funding status is verified or partial. */
  const verifiedSumExpr = `
    CASE
      WHEN COALESCE(funding_amount_status, 'unknown') IN ('verified', 'partial') THEN
        CASE
          WHEN funding_value_source = 'estimated_total_funding' AND estimated_funding IS NOT NULL AND estimated_funding > 0
            THEN estimated_funding
          WHEN funding_value_source = 'award_floor' AND COALESCE(award_floor, amount_min) IS NOT NULL AND COALESCE(award_floor, amount_min) > 0
            THEN COALESCE(award_floor, amount_min)
          WHEN COALESCE(award_ceiling, amount_max) IS NOT NULL AND COALESCE(award_ceiling, amount_max) > 0
            THEN COALESCE(award_ceiling, amount_max)
          WHEN estimated_funding IS NOT NULL AND estimated_funding > 0 THEN estimated_funding
          ELSE 0
        END
      ELSE 0
    END`;

  const total = await db.get<{ c: number; pot: number }>(
    `SELECT COUNT(*) as c,
            COALESCE(SUM(${verifiedSumExpr}), 0) as pot
     FROM grant_opportunities
     WHERE (duplicate_of_id IS NULL OR duplicate_of_id = '')`
  );

  const qualified = await db.get<{ c: number; pot: number; unknown_c: number }>(
    `SELECT COUNT(*) as c,
            COALESCE(SUM(${verifiedSumExpr}), 0) as pot,
            SUM(CASE
              WHEN COALESCE(funding_amount_status, 'unknown') IN ('unknown', 'conflicting')
                OR (
                  COALESCE(funding_amount_status, 'unknown') NOT IN ('verified', 'partial')
                  AND COALESCE(award_ceiling, amount_max, estimated_funding) IS NULL
                )
              THEN 1 ELSE 0
            END) as unknown_c
     FROM grant_opportunities
     WHERE eligibility_result IN ('eligible', 'possibly_eligible')
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')`
  );

  const potentiallyEligible = await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_opportunities
     WHERE eligibility_result = 'possibly_eligible'
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')`
  );

  const fullyQualified = await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_opportunities
     WHERE eligibility_result = 'eligible'
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')`
  );

  const priority = await db.get<{ c: number; pot: number }>(
    `SELECT COUNT(*) as c,
            COALESCE(SUM(${verifiedSumExpr}), 0) as pot
     FROM grant_opportunities
     WHERE qualification_class = 'priority'
       AND eligibility_result != 'not_eligible'
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')`
  );

  const appsPrep = await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_applications
     WHERE status IN ('draft', 'in_progress', 'under_review')
       AND COALESCE(founder_approval_status, 'pending') != 'rejected'`
  );

  const submitted = await db.get<{ pot: number }>(
    `SELECT COALESCE(SUM(COALESCE(amount_requested, 0)), 0) as pot
     FROM grant_applications WHERE status IN ('submitted', 'under_review', 'pending_decision')`
  );

  const awarded = await db.get<{ pot: number }>(
    `SELECT COALESCE(SUM(amount), 0) as pot FROM grant_awards WHERE status IN ('active', 'closed', 'completed') OR status IS NOT NULL`
  );

  const available = await db.get<{ pot: number }>(
    `SELECT COALESCE(SUM(amount), 0) as pot FROM grant_awards WHERE status = 'active'`
  );

  const upcoming = await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_opportunities
     WHERE deadline IS NOT NULL
       AND date(deadline) >= date('now')
       AND date(deadline) <= date('now', '+30 days')
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')`
  );

  const review = await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_opportunities
     WHERE qualification_class IN ('priority', 'strong')
       AND eligibility_result IN ('eligible', 'possibly_eligible')
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')`
  );

  const liveShare = await db.get<{ live: number; all_count: number; enriched: number }>(
    `SELECT
       SUM(CASE WHEN is_live = 1 THEN 1 ELSE 0 END) as live,
       COUNT(*) as all_count,
       SUM(CASE WHEN enrichment_status = 'enriched_official' THEN 1 ELSE 0 END) as enriched
     FROM grant_opportunities
     WHERE (duplicate_of_id IS NULL OR duplicate_of_id = '')`
  );

  const liveRatio = (liveShare?.all_count || 0) > 0 ? (liveShare?.live || 0) / (liveShare?.all_count || 1) : 0;
  const enrichRatio = (liveShare?.all_count || 0) > 0 ? (liveShare?.enriched || 0) / (liveShare?.all_count || 1) : 0;
  const dataConfidence: "high" | "medium" | "low" =
    enrichRatio >= 0.4 || liveRatio >= 0.5 ? "high" : liveRatio >= 0.15 || enrichRatio >= 0.15 ? "medium" : "low";

  const verifiedQualified = Math.round(qualified?.pot ?? 0);
  const unknownQualified = Math.round(qualified?.unknown_c ?? 0);
  const pipelineSummary =
    `Qualified Pipeline: $${verifiedQualified.toLocaleString()} verified`
    + (unknownQualified > 0
      ? ` + ${unknownQualified} qualified opportunities with unpublished award values`
      : "");

  return {
    totalOpportunitiesDiscovered: total?.c ?? 0,
    potentiallyEligibleCount: potentiallyEligible?.c ?? 0,
    fullyQualifiedCount: fullyQualified?.c ?? 0,
    totalPotentialFundingDiscovered: Math.round(total?.pot ?? 0),
    qualifiedIfcdcFunding: verifiedQualified,
    verifiedQualifiedPipelineValue: verifiedQualified,
    unknownValueQualifiedCount: unknownQualified,
    priorityPipelineValue: Math.round(priority?.pot ?? 0),
    applicationsInPreparation: appsPrep?.c ?? 0,
    submittedApplicationValue: Math.round(submitted?.pot ?? 0),
    awardedValue: Math.round(awarded?.pot ?? 0),
    availableForAllocationValue: Math.round(available?.pot ?? 0),
    qualifiedCount: qualified?.c ?? 0,
    priorityCount: priority?.c ?? 0,
    upcomingDeadlines: upcoming?.c ?? 0,
    needingFounderReview: review?.c ?? 0,
    dataConfidence,
    pipelineSummary,
  };
}

export async function buildFundingIntelligenceDashboard() {
  const metrics = await buildFundingIntelligenceMetrics();
  const db = await getDb();
  const sources = await db.all(
    `SELECT provider_key, label, category, status, base_url, api_url, last_sync_at, notes
     FROM grant_sources ORDER BY category, label`
  );
  const priority = await db.all(
    `SELECT id, title, funder, url, source_type, external_id, eligibility_result,
            qualification_score, qualification_class, preliminary_score, enriched_final_score,
            amount_max, award_ceiling, estimated_funding, funding_amount_status, funding_value_source,
            best_program_slug, best_program_match_pct, deadline
     FROM grant_opportunities
     WHERE qualification_class = 'priority'
       AND eligibility_result != 'not_eligible'
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
     ORDER BY COALESCE(enriched_final_score, qualification_score) DESC
     LIMIT 25`
  );
  const upcoming = await db.all(
    `SELECT id, title, funder, url, deadline, qualification_score, eligibility_result, source_type, external_id,
            funding_amount_status, best_program_slug, best_program_match_pct
     FROM grant_opportunities
     WHERE deadline IS NOT NULL
       AND date(deadline) >= date('now')
       AND date(deadline) <= date('now', '+45 days')
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
     ORDER BY date(deadline) ASC
     LIMIT 25`
  );
  let programProfiles: Array<Record<string, unknown>> = [];
  try {
    const { listIfcdcProgramProfiles } = await import("./auraFundingEnrichmentEngine");
    programProfiles = await listIfcdcProgramProfiles();
  } catch {
    programProfiles = [];
  }
  return {
    generatedAt: new Date().toISOString(),
    phase: "8A.2",
    metrics,
    sources,
    priorityOpportunities: priority,
    upcomingDeadlines: upcoming,
    programProfiles,
    securityBoundary: {
      maySubmit: false,
      maySignCertifications: false,
      mayAcceptAwards: false,
      mayMoveFunds: false,
    },
  };
}

export async function answerFundingIntelligenceQuery(opts: {
  question: string;
  actorEmail?: string;
}): Promise<{
  reply: string;
  records: Array<Record<string, unknown>>;
  metrics: Awaited<ReturnType<typeof buildFundingIntelligenceMetrics>>;
}> {
  const q = opts.question.toLowerCase();
  const db = await getDb();
  const metrics = await buildFundingIntelligenceMetrics();

  if (/how much verified|verified funding|pipeline value|verified \$/.test(q)) {
    return {
      reply:
        `${metrics.pipelineSummary}. `
        + `Priority verified value: $${metrics.priorityPipelineValue.toLocaleString()} `
        + `(${metrics.priorityCount} priority). Unknown-value qualified: ${metrics.unknownValueQualifiedCount}. `
        + `Missing award amounts are stored as UNKNOWN — never counted as $0.`,
      records: [],
      metrics,
    };
  }

  if (/unknown.?value|unpublished|unknown award|unknown amount/.test(q)) {
    const unknownRows = await db.all<Record<string, unknown>>(
      `SELECT id, title, funder, url, source_type, external_id, eligibility_result,
              qualification_score, funding_amount_status, best_program_slug, best_program_match_pct
       FROM grant_opportunities
       WHERE eligibility_result IN ('eligible', 'possibly_eligible')
         AND COALESCE(funding_amount_status, 'unknown') IN ('unknown', 'conflicting')
         AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
       ORDER BY COALESCE(enriched_final_score, qualification_score, 0) DESC
       LIMIT 25`
    );
    return {
      reply:
        `${metrics.unknownValueQualifiedCount} qualified opportunities have unpublished award amounts (Funding Amount = UNKNOWN). `
        + `Verified qualified pipeline remains $${metrics.verifiedQualifiedPipelineValue.toLocaleString()}.`,
      records: unknownRows,
      metrics,
    };
  }

  if (/official evidence|source evidence|traceabilit|why is this grant|why.*strong match|explain.*match/.test(q)) {
    const top = await db.get<Record<string, unknown>>(
      `SELECT id, title, url, source_type, external_id, eligibility_result,
              qualification_score, enriched_final_score, preliminary_score,
              funding_amount_status, funding_value_source, award_ceiling, estimated_funding,
              best_program_slug, best_program_match_pct, program_match_json, enrichment_status
       FROM grant_opportunities
       WHERE eligibility_result IN ('eligible', 'possibly_eligible')
         AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
       ORDER BY COALESCE(enriched_final_score, qualification_score, 0) DESC
       LIMIT 1`
    );
    if (top) {
      const explained = await explainOpportunityScore(String(top.id));
      return {
        reply:
          `"${top.title}" · enriched score ${top.enriched_final_score ?? top.qualification_score} `
          + `(preliminary ${top.preliminary_score ?? "n/a"}) · funding ${top.funding_amount_status}`
          + (top.funding_value_source ? ` from ${top.funding_value_source}` : "")
          + ` · best program ${top.best_program_slug || "n/a"} @ ${top.best_program_match_pct ?? "n/a"}%. `
          + `Official source: ${top.url} (${top.source_type}/${top.external_id}). `
          + `Enrichment: ${top.enrichment_status}. Matches: ${JSON.stringify(explained.matches).slice(0, 400)}.`,
        records: [{ ...top, ...explained }],
        metrics,
      };
    }
  }

  let sql =
    `SELECT id, title, funder, url, source_type, external_id, eligibility_result,
            qualification_score, enriched_final_score, preliminary_score, qualification_class,
            amount_max, award_ceiling, estimated_funding, funding_amount_status, funding_value_source,
            best_program_slug, best_program_match_pct, deadline, division_slugs, program_match_json
     FROM grant_opportunities
     WHERE (duplicate_of_id IS NULL OR duplicate_of_id = '')`;
  const params: unknown[] = [];

  if (/qualif|eligible|we qualify|best fit/.test(q)) {
    sql += ` AND eligibility_result IN ('eligible', 'possibly_eligible')`;
  }
  if (/priority|highest|top|92|score|best fit/.test(q)) {
    sql += ` AND qualification_class IN ('priority', 'strong')`;
  }
  if (/deadline|due|upcoming/.test(q)) {
    sql += ` AND deadline IS NOT NULL AND date(deadline) >= date('now') AND date(deadline) <= date('now', '+60 days')`;
  }
  if (/anti.?gang|violence/.test(q)) {
    sql += ` AND (best_program_slug = 'anti_gang' OR division_slugs LIKE ? OR title LIKE ? OR description LIKE ? OR program_match_json LIKE ?)`;
    params.push("%anti_gang%", "%violence%", "%gang%", "%anti_gang%");
  }
  if (/youth/.test(q) && !/anti.?gang/.test(q)) {
    sql += ` AND (best_program_slug IN ('youth_development', 'tapis') OR division_slugs LIKE ? OR program_match_json LIKE ?)`;
    params.push("%youth%", "%youth%");
  }
  if (/housing|transitional/.test(q)) {
    sql += ` AND (best_program_slug = 'housing' OR division_slugs LIKE ? OR program_match_json LIKE ?)`;
    params.push("%housing%", "%housing%");
  }
  if (/mentor|tapis/.test(q)) {
    sql += ` AND (best_program_slug = 'tapis' OR division_slugs LIKE ? OR program_match_json LIKE ?)`;
    params.push("%tapis%", "%mentor%");
  }
  if (/500,?000|\$500|over \$500|>=\s*500/.test(q)) {
    sql += ` AND eligibility_result IN ('eligible', 'possibly_eligible')`;
    sql += ` AND COALESCE(funding_amount_status, 'unknown') IN ('verified', 'partial')`;
    sql += ` AND COALESCE(
      CASE WHEN funding_value_source = 'estimated_total_funding' THEN estimated_funding ELSE NULL END,
      award_ceiling, amount_max, 0
    ) >= 500000`;
  }
  if (/5\s*million|\$5|5000000/.test(q)) {
    sql += ` AND COALESCE(funding_amount_status, 'unknown') IN ('verified', 'partial')`;
    sql += ` AND COALESCE(award_ceiling, amount_max, estimated_funding, 0) >= 100000`;
    sql += ` AND eligibility_result IN ('eligible', 'possibly_eligible')`;
  }

  sql += ` ORDER BY COALESCE(enriched_final_score, qualification_score, 0) DESC,
                    CASE WHEN funding_amount_status IN ('verified','partial') THEN COALESCE(award_ceiling, amount_max, estimated_funding, 0) ELSE 0 END DESC
           LIMIT 20`;
  const records = await db.all<Record<string, unknown>>(sql, ...params);

  const whyMatch = q.match(/why.*score.*?(\d{2,3})|score.*?(\d{2,3})/i);
  if (whyMatch) {
    const target = Number(whyMatch[1] || whyMatch[2]);
    const scored = await db.get<Record<string, unknown>>(
      `SELECT o.id, o.title, o.url, o.source_type, o.external_id, o.funding_amount_status, o.funding_value_source,
              o.best_program_slug, o.best_program_match_pct, q.total_score, q.classification, q.breakdown_json, q.model
       FROM grant_qualification_scores q
       JOIN grant_opportunities o ON o.id = q.opportunity_id
       WHERE q.total_score = ?
       ORDER BY q.created_at DESC LIMIT 1`,
      target
    );
    if (scored) {
      return {
        reply:
          `Opportunity "${scored.title}" scored ${scored.total_score} (${scored.classification}, model ${scored.model}). `
          + `Program match: ${scored.best_program_slug || "n/a"} @ ${scored.best_program_match_pct ?? "n/a"}%. `
          + `Funding: ${scored.funding_amount_status}${scored.funding_value_source ? ` (${scored.funding_value_source})` : ""}. `
          + `Breakdown: ${scored.breakdown_json}. Official source: ${scored.url} (${scored.source_type}/${scored.external_id}).`,
        records: [scored],
        metrics,
      };
    }
  }

  const reply = [
    `Found ${records.length} stored opportunit${records.length === 1 ? "y" : "ies"} matching your question.`,
    metrics.pipelineSummary + ".",
    `Priority verified value: $${metrics.priorityPipelineValue.toLocaleString()} (${metrics.priorityCount} opportunities).`,
    `Unknown-value qualified: ${metrics.unknownValueQualifiedCount}. Data confidence: ${metrics.dataConfidence}.`,
    records[0]
      ? `Top result: ${records[0].title} · enriched ${records[0].enriched_final_score ?? records[0].qualification_score ?? "n/a"}`
        + ` (prelim ${records[0].preliminary_score ?? "n/a"}) · ${records[0].eligibility_result}`
        + ` · funding ${records[0].funding_amount_status || "unknown"}`
        + ` · program ${records[0].best_program_slug || "n/a"}@${records[0].best_program_match_pct ?? "n/a"}%`
        + ` · ${records[0].url}`
      : "No matching stored opportunities yet — run a Funding Intelligence scan.",
  ].join(" ");

  return { reply, records, metrics };
}

export async function explainOpportunityScore(opportunityId: string) {
  const db = await getDb();
  const opp = await db.get(
    `SELECT id, title, funder, url, source_type, external_id, eligibility_result,
            qualification_score, qualification_class, preliminary_score, enriched_final_score,
            funding_amount_status, funding_value_source, award_ceiling, award_floor, estimated_funding,
            best_program_slug, best_program_match_pct, program_match_json, enrichment_status,
            last_verified_at, fingerprint
     FROM grant_opportunities WHERE id = ?`,
    opportunityId
  );
  const score = await db.get(
    `SELECT * FROM grant_qualification_scores WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1`,
    opportunityId
  );
  const preliminaryScore = await db.get(
    `SELECT * FROM grant_qualification_scores
     WHERE opportunity_id = ? AND model LIKE '%preliminary%'
     ORDER BY created_at DESC LIMIT 1`,
    opportunityId
  );
  const eligibility = await db.get(
    `SELECT * FROM grant_eligibility_checks WHERE opportunity_id = ? ORDER BY checked_at DESC LIMIT 1`,
    opportunityId
  );
  const matches = await db.all(
    `SELECT program_slug, program_label, match_score, match_pct, rationale, eligibility_concerns, program_gaps
     FROM grant_matches WHERE opportunity_id = ? ORDER BY COALESCE(match_pct, match_score) DESC`,
    opportunityId
  );
  return {
    opportunity: opp,
    score,
    preliminaryScore,
    eligibility,
    matches,
    officialSource: opp
      ? {
          url: (opp as { url?: string }).url,
          sourceType: (opp as { source_type?: string }).source_type,
          externalId: (opp as { external_id?: string }).external_id,
          lastVerifiedAt: (opp as { last_verified_at?: string }).last_verified_at,
          enrichmentStatus: (opp as { enrichment_status?: string }).enrichment_status,
          fundingAmountStatus: (opp as { funding_amount_status?: string }).funding_amount_status,
          fundingValueSource: (opp as { funding_value_source?: string }).funding_value_source,
        }
      : null,
  };
}

/** Exported for unit-style reuse / tests */
export const __test = { fingerprintOpportunity, findDuplicate, SCORE_WEIGHTS };
