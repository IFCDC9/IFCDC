/**
 * Phase 8A.3 — Awardability & IFCDC Addressable Funding Verification.
 *
 * Total program funding ≠ IFCDC-addressable funding.
 * Does not submit applications or touch Twilio/SMS.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { ensureGrantTables, logGrantActivity } from "./grantsSchema";
import { IFCDC_ORG_PROFILE } from "./grantWriterEngine";

export type AddressableStatus =
  | "verified"
  | "derived"
  | "partial"
  | "unknown"
  | "conflicting";

export type ReadinessClass =
  | "ready_now"
  | "nearly_ready"
  | "needs_documents"
  | "needs_program_development"
  | "needs_matching_funds"
  | "review_required"
  | "not_ready";

export type DocGapItem = {
  id: string;
  label: string;
  status: "available" | "missing" | "unknown";
  evidence?: string;
};

const READINESS_WEIGHTS = {
  eligibilityConfirmed: 20,
  programFit: 15,
  organizationalQualification: 15,
  requiredDocuments: 15,
  budgetReadiness: 10,
  programDesignReadiness: 10,
  deadlineFeasibility: 5,
  matchCostShareReadiness: 5,
  complianceReadiness: 5,
} as const;

function parseAmount(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseCostShare(raw: unknown): {
  matchRequired: boolean;
  matchType: string | null;
  matchPercentage: string | null;
  matchAmount: number | null;
} {
  const text = String(raw || "").trim();
  if (!text) {
    return { matchRequired: false, matchType: null, matchPercentage: null, matchAmount: null };
  }
  const lower = text.toLowerCase();
  const noMatch =
    /no\s*(cost\s*shar|match)|cost\s*sharing\s*or\s*matching\s*requirement\s*:\s*no|matching\s*:\s*no/.test(lower)
    || lower === "no"
    || lower === "false"
    || lower === "n";
  if (noMatch) {
    return { matchRequired: false, matchType: "none", matchPercentage: null, matchAmount: null };
  }
  const yes = /yes|required|must\s*match|cost\s*shar|in-?kind|cash\s*match|\d+\s*%/.test(lower);
  if (!yes) {
    return { matchRequired: false, matchType: null, matchPercentage: null, matchAmount: null };
  }
  const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const amt = parseAmount(text);
  let matchType: string | null = null;
  if (/cash/.test(lower) && /in-?kind/.test(lower)) matchType = "cash_or_inkind";
  else if (/in-?kind/.test(lower)) matchType = "inkind";
  else if (/cash/.test(lower)) matchType = "cash";
  else matchType = "unspecified";
  return {
    matchRequired: true,
    matchType,
    matchPercentage: pct ? `${pct[1]}%` : null,
    matchAmount: amt,
  };
}

/**
 * IFCDC Addressable = max realistic individual request from official award terms.
 * Never equals total program funding solely because that figure exists.
 */
export function calculateAddressableFunding(opp: Record<string, unknown>): {
  totalProgramFunding: number | null;
  awardFloor: number | null;
  awardCeiling: number | null;
  maxIndividualAward: number | null;
  typicalIndividualAward: number | null;
  anticipatedAwards: number | null;
  multipleAwardsExpected: boolean | null;
  ifcdcMaxEligibleRequest: number | null;
  recommendedMin: number | null;
  recommendedMax: number | null;
  addressableAmount: number | null;
  addressableStatus: AddressableStatus;
  explanation: string;
} {
  const awardFloor = parseAmount(opp.award_floor ?? opp.amount_min);
  const awardCeiling = parseAmount(opp.award_ceiling ?? opp.amount_max);
  const estimated = parseAmount(opp.estimated_funding ?? opp.total_program_funding);
  const anticipatedRaw = opp.anticipated_awards != null ? Number(opp.anticipated_awards) : NaN;
  const anticipatedAwards = Number.isFinite(anticipatedRaw) && anticipatedRaw > 0 ? anticipatedRaw : null;
  const multipleAwardsExpected =
    anticipatedAwards != null
      ? anticipatedAwards > 1
      : estimated != null && awardCeiling != null && estimated > awardCeiling
        ? true
        : anticipatedAwards === 1
          ? false
          : null;

  const totalProgramFunding = estimated;
  const maxIndividualAward = awardCeiling;
  const typicalIndividualAward = parseAmount(opp.typical_individual_award);

  if (awardCeiling != null && awardFloor != null && awardCeiling < awardFloor) {
    return {
      totalProgramFunding,
      awardFloor,
      awardCeiling,
      maxIndividualAward,
      typicalIndividualAward,
      anticipatedAwards,
      multipleAwardsExpected,
      ifcdcMaxEligibleRequest: null,
      recommendedMin: null,
      recommendedMax: null,
      addressableAmount: null,
      addressableStatus: "conflicting",
      explanation: `Conflicting official amounts: floor $${awardFloor.toLocaleString()} > ceiling $${awardCeiling.toLocaleString()}`,
    };
  }

  if (awardCeiling != null) {
    const recommendedMin = awardFloor ?? Math.round(awardCeiling * 0.5);
    return {
      totalProgramFunding,
      awardFloor,
      awardCeiling,
      maxIndividualAward,
      typicalIndividualAward,
      anticipatedAwards,
      multipleAwardsExpected,
      ifcdcMaxEligibleRequest: awardCeiling,
      recommendedMin,
      recommendedMax: awardCeiling,
      addressableAmount: awardCeiling,
      addressableStatus: awardFloor != null || typicalIndividualAward != null ? "verified" : "partial",
      explanation:
        `IFCDC Addressable Funding = official award ceiling ($${awardCeiling.toLocaleString()}). `
        + (totalProgramFunding
          ? `Total program funding ($${totalProgramFunding.toLocaleString()}) is NOT treated as IFCDC-requestable.`
          : "Total program funding unpublished."),
    };
  }

  if (estimated != null && anticipatedAwards != null) {
    const derived = Math.floor(estimated / anticipatedAwards);
    const recommendedMin = awardFloor && awardFloor <= derived ? awardFloor : Math.round(derived * 0.5);
    return {
      totalProgramFunding,
      awardFloor,
      awardCeiling,
      maxIndividualAward: null,
      typicalIndividualAward,
      anticipatedAwards,
      multipleAwardsExpected,
      ifcdcMaxEligibleRequest: derived,
      recommendedMin,
      recommendedMax: derived,
      addressableAmount: derived,
      addressableStatus: "derived",
      explanation:
        `No award ceiling published. Derived IFCDC addressable ≈ estimated total / anticipated awards `
        + `($${estimated.toLocaleString()} / ${anticipatedAwards} = $${derived.toLocaleString()}). `
        + `Total program funding is not counted as a single IFCDC request.`,
    };
  }

  return {
    totalProgramFunding,
    awardFloor,
    awardCeiling,
    maxIndividualAward: null,
    typicalIndividualAward,
    anticipatedAwards,
    multipleAwardsExpected,
    ifcdcMaxEligibleRequest: null,
    recommendedMin: awardFloor,
    recommendedMax: null,
    addressableAmount: null,
    addressableStatus: "unknown",
    explanation:
      "IFCDC Addressable Funding = UNKNOWN. Official source did not publish an individual award ceiling "
      + "(and could not derive ceiling from total ÷ anticipated awards). "
      + "Total program funding is not treated as money IFCDC can request.",
  };
}

async function inventoryHqDocuments(): Promise<Array<{ id: string; title: string; category: string }>> {
  const db = await getDb();
  const rows: Array<{ id: string; title: string; category: string }> = [];
  try {
    const hq = await db.all<{ id: string; title: string; category: string }>(
      `SELECT id, title, category FROM hq_documents ORDER BY datetime(updated_at) DESC LIMIT 200`
    );
    rows.push(...(hq || []));
  } catch {
    /* table may not exist */
  }
  try {
    const gd = await db.all<{ id: string; name: string; doc_type: string; doc_category: string }>(
      `SELECT id, name, doc_type, doc_category FROM grant_documents
       WHERE file_url IS NOT NULL AND file_url != ''
       ORDER BY datetime(COALESCE(uploaded_at, created_at)) DESC LIMIT 200`
    );
    for (const d of gd || []) {
      rows.push({
        id: d.id,
        title: d.name || d.doc_type || "grant_document",
        category: d.doc_category || d.doc_type || "attachment",
      });
    }
  } catch {
    /* ignore */
  }
  return rows;
}

function matchDoc(
  inventory: Array<{ title: string; category: string }>,
  patterns: RegExp[]
): { available: boolean; evidence?: string } {
  for (const doc of inventory) {
    const blob = `${doc.title} ${doc.category}`.toLowerCase();
    if (patterns.some((p) => p.test(blob))) {
      return { available: true, evidence: doc.title };
    }
  }
  return { available: false };
}

export async function analyzeDocumentGaps(opp: Record<string, unknown>): Promise<{
  items: DocGapItem[];
  availableCount: number;
  missingCount: number;
  unknownCount: number;
}> {
  const inventory = await inventoryHqDocuments();
  const uei = IFCDC_ORG_PROFILE.samUei;
  const requiredText = `${opp.required_documents_json || ""} ${opp.requirements || ""} ${opp.application_instructions || ""}`.toLowerCase();

  const catalog: Array<{
    id: string;
    label: string;
    patterns: RegExp[];
    alwaysRelevant?: boolean;
    envAvailable?: boolean;
    envEvidence?: string;
  }> = [
    {
      id: "irs_501c3",
      label: "IRS 501(c)(3) determination",
      patterns: [/501\s*\(c\)\s*\(3\)/, /irs\s*determination/, /tax.?exempt/, /determination\s*letter/],
      alwaysRelevant: true,
    },
    {
      id: "sam_registration",
      label: "SAM.gov registration",
      patterns: [/sam\.?gov/, /sam\s*registration/, /system\s*for\s*award/],
      alwaysRelevant: true,
      envAvailable: Boolean(uei),
      envEvidence: uei ? `UEI configured: ${uei}` : undefined,
    },
    {
      id: "uei",
      label: "UEI / CAGE information",
      patterns: [/\buei\b/, /cage/, /unique\s*entity/],
      alwaysRelevant: true,
      envAvailable: Boolean(uei),
      envEvidence: uei ? `UEI configured: ${uei}` : undefined,
    },
    {
      id: "org_budget",
      label: "Organizational budget",
      patterns: [/organizational\s*budget/, /agency\s*budget/, /operating\s*budget/],
      alwaysRelevant: true,
    },
    {
      id: "program_budget",
      label: "Program / project budget",
      patterns: [/program\s*budget/, /project\s*budget/, /budget\s*narrative/, /budget\s*justification/],
      alwaysRelevant: true,
    },
    {
      id: "board_info",
      label: "Board information",
      patterns: [/board\s*(list|roster|members|of\s*directors)/],
      alwaysRelevant: true,
    },
    { id: "program_narrative", label: "Program narrative", patterns: [/narrative/, /project\s*description/, /proposal\s*narrative/] },
    { id: "needs_statement", label: "Needs statement", patterns: [/need(s)?\s*statement/, /statement\s*of\s*need/] },
    { id: "logic_model", label: "Logic model", patterns: [/logic\s*model/] },
    { id: "outcomes", label: "Outcomes / evaluation plan", patterns: [/outcome/, /evaluation\s*plan/, /performance\s*measure/] },
    { id: "staffing_plan", label: "Staffing plan", patterns: [/staffing/, /key\s*personnel/, /org(anizational)?\s*chart/] },
    { id: "resumes", label: "Resumes", patterns: [/resume/, /curriculum\s*vitae|\bcv\b/] },
    {
      id: "financial_statements",
      label: "Financial statements",
      patterns: [/financial\s*statement/, /profit\s*and\s*loss|\bp&l\b/, /balance\s*sheet/],
      alwaysRelevant: true,
    },
    { id: "audit", label: "Audit information", patterns: [/audit(ed)?\s*financial/, /single\s*audit/, /\ba-?133\b/] },
    { id: "policies", label: "Policies", patterns: [/policy|policies/, /conflict\s*of\s*interest/, /fiscal\s*policy/] },
    { id: "letters_of_support", label: "Letters of support", patterns: [/letter(s)?\s*of\s*support/, /los\b/] },
    {
      id: "partnership_agreements",
      label: "Partnership agreements",
      patterns: [/partnership\s*agreement/, /mou\b/, /memorandum\s*of\s*understanding/],
    },
    {
      id: "matching_funds_docs",
      label: "Matching-fund documentation",
      patterns: [/match(ing)?\s*fund/, /cost\s*share\s*doc/, /in-?kind\s*commit/],
    },
  ];

  const items: DocGapItem[] = [];
  for (const c of catalog) {
    const mentioned =
      c.alwaysRelevant
      || c.patterns.some((p) => p.test(requiredText))
      || /attachment|document|required/.test(requiredText);
    if (!mentioned && !c.alwaysRelevant) continue;

    if (c.envAvailable) {
      items.push({ id: c.id, label: c.label, status: "available", evidence: c.envEvidence });
      continue;
    }
    const hit = matchDoc(inventory, c.patterns);
    if (hit.available) {
      items.push({ id: c.id, label: c.label, status: "available", evidence: hit.evidence });
    } else if (c.alwaysRelevant || c.patterns.some((p) => p.test(requiredText))) {
      items.push({ id: c.id, label: c.label, status: "missing" });
    } else {
      items.push({ id: c.id, label: c.label, status: "unknown" });
    }
  }

  if (opp.required_documents_json && String(opp.required_documents_json).length > 8) {
    items.push({
      id: "funder_specific_attachments",
      label: "Funder-specific required documents (see official listing)",
      status: "unknown",
      evidence: String(opp.required_documents_json).slice(0, 240),
    });
  }

  return {
    items,
    availableCount: items.filter((i) => i.status === "available").length,
    missingCount: items.filter((i) => i.status === "missing").length,
    unknownCount: items.filter((i) => i.status === "unknown").length,
  };
}

export function scoreApplicationReadiness(opts: {
  eligibility: string;
  programMatchPct: number;
  addressableStatus: AddressableStatus;
  matchRequired: boolean;
  docGaps: { availableCount: number; missingCount: number; items: DocGapItem[] };
  deadline: string | null;
  bestProgramSlug: string | null;
  founderProgramGaps: string[];
}): {
  total: number;
  breakdown: Record<string, { points: number; max: number; note: string }>;
  readinessClass: ReadinessClass;
  isRealistic: boolean;
  missingInfo: string[];
} {
  const missingInfo: string[] = [];

  const eligibilityConfirmed =
    opts.eligibility === "eligible"
      ? READINESS_WEIGHTS.eligibilityConfirmed
      : opts.eligibility === "possibly_eligible"
        ? Math.round(READINESS_WEIGHTS.eligibilityConfirmed * 0.55)
        : opts.eligibility === "insufficient_information"
          ? Math.round(READINESS_WEIGHTS.eligibilityConfirmed * 0.25)
          : 0;
  if (opts.eligibility !== "eligible") missingInfo.push("Eligibility not fully confirmed for IFCDC");

  const programFit = Math.round((Math.min(100, opts.programMatchPct) / 100) * READINESS_WEIGHTS.programFit);
  if (opts.programMatchPct < 50) missingInfo.push("Program fit below 50% — Founder review recommended");

  const hasUei = Boolean(IFCDC_ORG_PROFILE.samUei);
  const orgPts =
    (hasUei ? Math.round(READINESS_WEIGHTS.organizationalQualification * 0.5) : 0)
    + Math.round(READINESS_WEIGHTS.organizationalQualification * 0.5);
  if (!hasUei) missingInfo.push("SAM.gov UEI not configured in HQ env");

  const docRelevant = opts.docGaps.items.filter((i) => i.status !== "unknown");
  const docDenom = Math.max(1, docRelevant.length);
  const docAvail = docRelevant.filter((i) => i.status === "available").length;
  const requiredDocuments = Math.round((docAvail / docDenom) * READINESS_WEIGHTS.requiredDocuments);
  if (opts.docGaps.missingCount > 0) {
    missingInfo.push(`${opts.docGaps.missingCount} required/org documents missing in HQ`);
  }

  const hasBudget = opts.docGaps.items.some((i) => i.id.includes("budget") && i.status === "available");
  const budgetReadiness = hasBudget
    ? READINESS_WEIGHTS.budgetReadiness
    : Math.round(READINESS_WEIGHTS.budgetReadiness * 0.2);
  if (!hasBudget) missingInfo.push("Organizational/program budget not found in HQ documents");

  const programDesignReady = opts.founderProgramGaps.length === 0 && opts.programMatchPct >= 60;
  const programDesignReadiness = programDesignReady
    ? READINESS_WEIGHTS.programDesignReadiness
    : opts.programMatchPct >= 40
      ? Math.round(READINESS_WEIGHTS.programDesignReadiness * 0.45)
      : Math.round(READINESS_WEIGHTS.programDesignReadiness * 0.2);
  if (opts.founderProgramGaps.length) {
    missingInfo.push(`Program profile gaps: ${opts.founderProgramGaps.slice(0, 3).join(", ")}`);
  }

  let deadlineFeasibility = Math.round(READINESS_WEIGHTS.deadlineFeasibility * 0.5);
  if (opts.deadline) {
    const days = Math.ceil((new Date(opts.deadline).getTime() - Date.now()) / 86_400_000);
    if (!Number.isFinite(days) || days < 0) {
      deadlineFeasibility = 0;
      missingInfo.push("Deadline passed or invalid");
    } else if (days < 14) {
      deadlineFeasibility = Math.round(READINESS_WEIGHTS.deadlineFeasibility * 0.35);
      missingInfo.push(`Tight deadline (${days} days)`);
    } else if (days <= 120) {
      deadlineFeasibility = READINESS_WEIGHTS.deadlineFeasibility;
    } else {
      deadlineFeasibility = Math.round(READINESS_WEIGHTS.deadlineFeasibility * 0.75);
    }
  } else {
    missingInfo.push("Deadline unknown");
  }

  const matchCostShareReadiness = opts.matchRequired ? 0 : READINESS_WEIGHTS.matchCostShareReadiness;
  if (opts.matchRequired) missingInfo.push("Cost-share / matching funds required — unresolved");

  const complianceReadiness = hasUei
    ? READINESS_WEIGHTS.complianceReadiness
    : Math.round(READINESS_WEIGHTS.complianceReadiness * 0.4);

  if (opts.addressableStatus === "unknown" || opts.addressableStatus === "conflicting") {
    missingInfo.push("IFCDC addressable award amount UNKNOWN or conflicting");
  }

  const breakdown = {
    eligibilityConfirmed: {
      points: eligibilityConfirmed,
      max: READINESS_WEIGHTS.eligibilityConfirmed,
      note: opts.eligibility,
    },
    programFit: {
      points: programFit,
      max: READINESS_WEIGHTS.programFit,
      note: `${opts.programMatchPct}% · ${opts.bestProgramSlug || "n/a"}`,
    },
    organizationalQualification: {
      points: orgPts,
      max: READINESS_WEIGHTS.organizationalQualification,
      note: hasUei ? "501(c)(3) CDC + UEI configured" : "501(c)(3) CDC known; UEI missing",
    },
    requiredDocuments: {
      points: requiredDocuments,
      max: READINESS_WEIGHTS.requiredDocuments,
      note: `${docAvail}/${docDenom} catalog docs available in HQ`,
    },
    budgetReadiness: {
      points: budgetReadiness,
      max: READINESS_WEIGHTS.budgetReadiness,
      note: hasBudget ? "budget artifact found" : "budget missing",
    },
    programDesignReadiness: {
      points: programDesignReadiness,
      max: READINESS_WEIGHTS.programDesignReadiness,
      note: programDesignReady ? "profile sufficient" : "program development needed",
    },
    deadlineFeasibility: {
      points: deadlineFeasibility,
      max: READINESS_WEIGHTS.deadlineFeasibility,
      note: opts.deadline || "unknown",
    },
    matchCostShareReadiness: {
      points: matchCostShareReadiness,
      max: READINESS_WEIGHTS.matchCostShareReadiness,
      note: opts.matchRequired ? "match required" : "no match required / not indicated",
    },
    complianceReadiness: {
      points: complianceReadiness,
      max: READINESS_WEIGHTS.complianceReadiness,
      note: hasUei ? "UEI present" : "UEI incomplete",
    },
  };

  const total = Object.values(breakdown).reduce((s, b) => s + b.points, 0);

  let readinessClass: ReadinessClass = "review_required";
  if (opts.eligibility === "not_eligible") {
    readinessClass = "not_ready";
  } else if (opts.matchRequired && total < 75) {
    readinessClass = "needs_matching_funds";
  } else if (opts.docGaps.missingCount >= 3 && requiredDocuments < READINESS_WEIGHTS.requiredDocuments * 0.6) {
    readinessClass = "needs_documents";
  } else if (!programDesignReady && opts.programMatchPct >= 40) {
    readinessClass = "needs_program_development";
  } else if (
    total >= 70
    && opts.eligibility !== "not_eligible"
    && opts.addressableStatus !== "conflicting"
    && deadlineFeasibility > 0
  ) {
    readinessClass = "ready_now";
  } else if (opts.eligibility === "insufficient_information" || opts.addressableStatus === "unknown") {
    readinessClass = "review_required";
  } else if (total < 40) {
    readinessClass = "not_ready";
  }

  const isRealistic =
    readinessClass !== "not_ready"
    && opts.eligibility !== "not_eligible"
    && deadlineFeasibility > 0;

  return { total, breakdown, readinessClass, isRealistic, missingInfo };
}

export async function verifyOpportunityAwardability(
  opportunityId: string,
  opts?: { actorEmail?: string }
): Promise<Record<string, unknown>> {
  await ensureGrantTables();
  const db = await getDb();
  const opp = await db.get<Record<string, unknown>>(
    "SELECT * FROM grant_opportunities WHERE id = ?",
    opportunityId
  );
  if (!opp) throw new Error(`Opportunity not found: ${opportunityId}`);

  const addressable = calculateAddressableFunding(opp);
  const costShare = parseCostShare(opp.cost_share_required);
  const docGaps = await analyzeDocumentGaps(opp);

  let founderProgramGaps: string[] = [];
  if (opp.best_program_slug) {
    const profile = await db.get<{ founder_completion_needed_json: string | null }>(
      `SELECT founder_completion_needed_json FROM ifcdc_program_profiles WHERE slug = ?`,
      String(opp.best_program_slug)
    );
    try {
      founderProgramGaps = JSON.parse(profile?.founder_completion_needed_json || "[]");
    } catch {
      founderProgramGaps = [];
    }
  }

  const readiness = scoreApplicationReadiness({
    eligibility: String(opp.eligibility_result || "insufficient_information"),
    programMatchPct: Number(opp.best_program_match_pct || 0),
    addressableStatus: addressable.addressableStatus,
    matchRequired: costShare.matchRequired,
    docGaps,
    deadline: opp.deadline ? String(opp.deadline) : opp.close_date ? String(opp.close_date) : null,
    bestProgramSlug: opp.best_program_slug ? String(opp.best_program_slug) : null,
    founderProgramGaps,
  });

  const canApply =
    opp.eligibility_result === "eligible"
      ? "yes"
      : opp.eligibility_result === "possibly_eligible"
        ? "possibly"
        : opp.eligibility_result === "not_eligible"
          ? "no"
          : "unknown";

  const orgRequirementsMet =
    IFCDC_ORG_PROFILE.samUei && canApply !== "no"
      ? "partial"
      : canApply === "no"
        ? "no"
        : "unknown";

  const answers = {
    canIfcdcLegallyApply: canApply,
    bestProgram: {
      slug: opp.best_program_slug || null,
      matchPct: opp.best_program_match_pct || null,
      matches: opp.program_match_json || null,
    },
    maximumIfcdcCanRequest: addressable.ifcdcMaxEligibleRequest,
    realisticTargetRange: {
      min: addressable.recommendedMin,
      max: addressable.recommendedMax,
    },
    matchingRequired: costShare.matchRequired,
    matching: costShare,
    deadline: opp.deadline || opp.close_date || null,
    documentsRequired: docGaps.items,
    registrationsCertifications: {
      samUeiConfigured: Boolean(IFCDC_ORG_PROFILE.samUei),
      uei: IFCDC_ORG_PROFILE.samUei,
      nonprofitStatusKnown: true,
      note: "Do not invent certifications; Founder must confirm current SAM/IRS filings",
    },
    priorApprovalRequirements: /prior\s*approval|pre-?award|approval\s*required/i.test(
      `${opp.application_instructions || ""} ${opp.description || ""} ${opp.eligibility || ""}`
    )
      ? "possible — review official NOFO"
      : "not clearly indicated in stored official text",
    organizationalRequirementsSatisfied: orgRequirementsMet,
    informationStillMissing: readiness.missingInfo,
    realisticToPursue: readiness.isRealistic,
    opportunityMatchScore: opp.enriched_final_score ?? opp.qualification_score ?? null,
    applicationReadinessScore: readiness.total,
    readinessClass: readiness.readinessClass,
    addressableExplanation: addressable.explanation,
    officialSourceUrl: opp.url || null,
    officialSourceType: opp.source_type || null,
    officialExternalId: opp.external_id || null,
  };

  const now = new Date().toISOString();
  await db.run(
    `UPDATE grant_opportunities SET
       total_program_funding = ?,
       max_individual_award = ?,
       typical_individual_award = ?,
       multiple_awards_expected = ?,
       ifcdc_max_eligible_request = ?,
       ifcdc_recommended_request_min = ?,
       ifcdc_recommended_request_max = ?,
       ifcdc_addressable_amount = ?,
       addressable_status = ?,
       addressable_explanation = ?,
       match_required = ?,
       match_type = ?,
       match_percentage = ?,
       match_amount = ?,
       funding_period = COALESCE(funding_period, ?),
       applicant_restrictions = COALESCE(?, applicant_restrictions),
       program_limitations = COALESCE(?, program_limitations),
       can_ifcdc_apply = ?,
       org_requirements_met = ?,
       awardability_json = ?,
       application_readiness_score = ?,
       readiness_class = ?,
       readiness_breakdown_json = ?,
       document_gaps_json = ?,
       missing_info_json = ?,
       is_realistic_to_pursue = ?,
       awardability_verified_at = ?,
       updated_at = ?
     WHERE id = ?`,
    addressable.totalProgramFunding,
    addressable.maxIndividualAward,
    addressable.typicalIndividualAward,
    addressable.multipleAwardsExpected == null ? null : addressable.multipleAwardsExpected ? 1 : 0,
    addressable.ifcdcMaxEligibleRequest,
    addressable.recommendedMin,
    addressable.recommendedMax,
    addressable.addressableAmount,
    addressable.addressableStatus,
    addressable.explanation,
    costShare.matchRequired ? 1 : 0,
    costShare.matchType,
    costShare.matchPercentage,
    costShare.matchAmount,
    opp.open_date && opp.deadline ? `${opp.open_date} → ${opp.deadline}` : opp.deadline || null,
    String(opp.eligible_applicant_types || opp.eligibility || "").slice(0, 2000) || null,
    String(opp.geography || "").slice(0, 1000) || null,
    canApply,
    orgRequirementsMet,
    JSON.stringify(answers),
    readiness.total,
    readiness.readinessClass,
    JSON.stringify(readiness.breakdown),
    JSON.stringify(docGaps),
    JSON.stringify(readiness.missingInfo),
    readiness.isRealistic ? 1 : 0,
    now,
    now,
    opportunityId
  );

  await db.run(
    `INSERT INTO grant_awardability_checks (
       id, opportunity_id, can_apply, best_program_slug, addressable_amount, recommended_min, recommended_max,
       match_required, readiness_class, readiness_score, missing_docs_json, answers_json, official_source_url, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    opportunityId,
    canApply,
    opp.best_program_slug || null,
    addressable.addressableAmount,
    addressable.recommendedMin,
    addressable.recommendedMax,
    costShare.matchRequired ? 1 : 0,
    readiness.readinessClass,
    readiness.total,
    JSON.stringify(docGaps.items.filter((i) => i.status === "missing")),
    JSON.stringify(answers),
    opp.url || null,
    now
  );

  await logGrantActivity(
    "opportunity",
    opportunityId,
    "awardability_8a3",
    `addressable=${addressable.addressableAmount ?? "UNKNOWN"} (${addressable.addressableStatus}) · readiness=${readiness.total}/${readiness.readinessClass} · canApply=${canApply}`,
    opts?.actorEmail
  );

  return {
    opportunityId,
    ...answers,
    addressable,
    readinessClass: readiness.readinessClass,
    applicationReadinessScore: readiness.total,
    documentGaps: docGaps,
  };
}

export async function runAwardabilityVerificationBatch(opts?: {
  limit?: number;
  actorEmail?: string;
  onlyQualified?: boolean;
  requalifyIfEmpty?: boolean;
}): Promise<{
  processed: number;
  addressableKnown: number;
  addressableUnknown: number;
  readyNow: number;
  requalified: number;
  results: Array<Record<string, unknown>>;
  pilot: Awaited<ReturnType<typeof selectFirstPilotRecommendation>>;
}> {
  await ensureGrantTables();
  const db = await getDb();
  const limit = opts?.limit ?? 40;
  const onlyQualified = opts?.onlyQualified !== false;
  let requalified = 0;

  let rows = await db.all<{ id: string }>(
    onlyQualified
      ? `SELECT id FROM grant_opportunities
         WHERE eligibility_result IN ('eligible', 'possibly_eligible')
           AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
         ORDER BY COALESCE(enriched_final_score, qualification_score, 0) DESC
         LIMIT ?`
      : `SELECT id FROM grant_opportunities
         WHERE (duplicate_of_id IS NULL OR duplicate_of_id = '')
         ORDER BY datetime(updated_at) DESC LIMIT ?`,
    limit
  );

  // Production may lose Phase 8A qualification fields after redeploy — re-qualify recent live rows.
  if (onlyQualified && rows.length === 0 && opts?.requalifyIfEmpty !== false) {
    const { enrichAndQualifyOpportunity } = await import("./auraFundingIntelligenceEngine");
    const candidates = await db.all<{ id: string }>(
      `SELECT id FROM grant_opportunities
       WHERE (duplicate_of_id IS NULL OR duplicate_of_id = '')
         AND (is_live = 1 OR source_type = 'grants_gov')
       ORDER BY datetime(updated_at) DESC
       LIMIT ?`,
      limit
    );
    for (const c of candidates) {
      await enrichAndQualifyOpportunity(c.id, {
        actorEmail: opts?.actorEmail,
        emitEvents: false,
      });
      requalified++;
      await new Promise((r) => setTimeout(r, 120));
    }
    rows = await db.all<{ id: string }>(
      `SELECT id FROM grant_opportunities
       WHERE eligibility_result IN ('eligible', 'possibly_eligible')
         AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
       ORDER BY COALESCE(enriched_final_score, qualification_score, 0) DESC
       LIMIT ?`,
      limit
    );
  }

  const results: Array<Record<string, unknown>> = [];
  let addressableKnown = 0;
  let addressableUnknown = 0;
  let readyNow = 0;

  for (const row of rows) {
    // If we just requalified via enrichAndQualify, awardability already ran inside that path.
    // Re-run verify to ensure 8A.3 fields are current even when eligibility already existed.
    const r = await verifyOpportunityAwardability(row.id, { actorEmail: opts?.actorEmail });
    results.push(r);
    const addr = r.addressable as { addressableAmount: number | null } | undefined;
    if (addr?.addressableAmount != null) addressableKnown++;
    else addressableUnknown++;
    if (r.readinessClass === "ready_now") readyNow++;
  }

  const pilot = await selectFirstPilotRecommendation();
  return {
    processed: results.length,
    addressableKnown,
    addressableUnknown,
    readyNow,
    requalified,
    results,
    pilot,
  };
}

export async function selectFirstPilotRecommendation(): Promise<{
  top3: Array<Record<string, unknown>>;
  recommendedPilot: Record<string, unknown> | null;
  rationale: string;
}> {
  await ensureGrantTables();
  const db = await getDb();
  const rows = await db.all<Record<string, unknown>>(
    `SELECT id, title, funder, url, source_type, external_id, eligibility_result,
            qualification_score, enriched_final_score, best_program_slug, best_program_match_pct,
            ifcdc_addressable_amount, addressable_status, addressable_explanation,
            application_readiness_score, readiness_class, match_required, deadline,
            can_ifcdc_apply, is_realistic_to_pursue, awardability_json
     FROM grant_opportunities
     WHERE eligibility_result IN ('eligible', 'possibly_eligible')
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
       AND COALESCE(readiness_class, '') != 'not_ready'
     ORDER BY
       CASE readiness_class
         WHEN 'ready_now' THEN 0
         WHEN 'needs_documents' THEN 1
         WHEN 'needs_program_development' THEN 2
         WHEN 'needs_matching_funds' THEN 3
         WHEN 'review_required' THEN 4
         ELSE 5
       END,
       COALESCE(application_readiness_score, 0) DESC,
       COALESCE(best_program_match_pct, 0) DESC,
       COALESCE(ifcdc_addressable_amount, 0) DESC,
       COALESCE(enriched_final_score, qualification_score, 0) DESC
     LIMIT 25`
  );

  const scored = rows.map((r) => {
    const elig =
      r.eligibility_result === "eligible" ? 30 : r.eligibility_result === "possibly_eligible" ? 18 : 0;
    const fit = Math.min(25, Number(r.best_program_match_pct || 0) * 0.25);
    const addr =
      r.ifcdc_addressable_amount != null
        ? Math.min(20, Math.log10(Number(r.ifcdc_addressable_amount) + 1) * 4)
        : 0;
    const ready = Math.min(15, Number(r.application_readiness_score || 0) * 0.15);
    let deadlinePts = 5;
    if (r.deadline) {
      const days = Math.ceil((new Date(String(r.deadline)).getTime() - Date.now()) / 86_400_000);
      if (!Number.isFinite(days) || days < 0) deadlinePts = 0;
      else if (days < 14) deadlinePts = 2;
      else if (days <= 90) deadlinePts = 10;
      else deadlinePts = 7;
    } else deadlinePts = 3;
    const compliance = r.can_ifcdc_apply === "yes" ? 10 : r.can_ifcdc_apply === "possibly" ? 6 : 2;
    const composite = elig + fit + addr + ready + deadlinePts + compliance;
    return { ...r, pilotComposite: Math.round(composite) };
  });

  scored.sort((a, b) => Number(b.pilotComposite) - Number(a.pilotComposite));
  const top3 = scored.slice(0, 3);

  await db.run(`UPDATE grant_opportunities SET pilot_rank = NULL WHERE pilot_rank IS NOT NULL`);
  for (let i = 0; i < top3.length; i++) {
    await db.run(`UPDATE grant_opportunities SET pilot_rank = ? WHERE id = ?`, i + 1, top3[i].id);
  }

  const recommendedPilot = top3[0] || null;
  const rationale = recommendedPilot
    ? `Recommended first pilot: "${recommendedPilot.title}" — composite ${recommendedPilot.pilotComposite}, `
      + `readiness ${recommendedPilot.application_readiness_score} (${recommendedPilot.readiness_class}), `
      + `program ${recommendedPilot.best_program_slug}@${recommendedPilot.best_program_match_pct ?? "n/a"}%, `
      + `addressable ${
        recommendedPilot.ifcdc_addressable_amount != null
          ? `$${Number(recommendedPilot.ifcdc_addressable_amount).toLocaleString()} (${recommendedPilot.addressable_status})`
          : "UNKNOWN"
      }, `
      + `eligibility ${recommendedPilot.eligibility_result}. Official source: ${recommendedPilot.url}. `
      + `No submission — Founder approval required before Application Factory.`
    : "No qualified opportunities available for pilot recommendation.";

  return { top3, recommendedPilot, rationale };
}
