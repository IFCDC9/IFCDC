/**
 * Recurring / renewable funding intelligence — HR & payroll sustainability.
 * Extends Grant Center scoring. Does not submit applications.
 */
import { getDb } from "../db";
import { ensureGrantTables, logGrantActivity } from "./grantsSchema";
import { evaluateGrantAllowableCostRecovery } from "./grantAllowableCostRecovery";
import { productionGrantOpportunitySqlFilter } from "./grantProductionPolicy";

export type AllowFlag = "yes" | "no" | "unknown";
export type FundingCadence = "recurring" | "one_time" | "unknown";
export type PaymentTiming = "reimbursement" | "advance" | "mixed" | "unknown";
export type SustainabilityRisk = "low" | "medium" | "high";
export type FundingCategory =
  | "government_contract"
  | "recurring_operating_support"
  | "restricted_capital"
  | "restricted_expenses"
  | "grant_opportunity";
export type FundingMoneyStatus =
  | "potential_funding"
  | "submitted_application"
  | "award"
  | "received_revenue";

export type FundingEvidence = {
  field: string;
  phrase: string;
  value: string;
};

export type FundingDimensionId =
  | "general_operating_grant"
  | "multiyear_award"
  | "renewable_grant"
  | "government_contract"
  | "payroll"
  | "hr"
  | "administration"
  | "allowable_indirect";

export type FundingDimension = {
  id: FundingDimensionId;
  status: AllowFlag;
  phrase: string;
  note: string;
};

export type RecurringFundingProfile = {
  opportunityId: string;
  cadence: FundingCadence;
  renewable: AllowFlag;
  awardTermMonths: number | null;
  renewalCycleDate: string | null;
  multiYearAvailable: AllowFlag;
  generalOperatingAllowed: AllowFlag;
  personnelAllowed: AllowFlag;
  fringeAllowed: AllowFlag;
  administrativeAllowed: AllowFlag;
  indirectAllowed: AllowFlag;
  indirectRateCap: string | null;
  paymentTiming: PaymentTiming;
  expectedAnnualValue: number | null;
  lifetimeValue: number | null;
  sustainabilityRisk: SustainabilityRisk;
  restrictedProgramOnly: boolean;
  restrictedWarning: string | null;
  recurringFundingScore: number;
  scoreBreakdown: Record<string, { points: number; max: number; note: string }>;
  programAlignmentScore: number;
  evidenceNotes: string[];
  fundingCategory: FundingCategory;
  moneyStatus: FundingMoneyStatus;
  hrAllowed: AllowFlag;
  restrictedExpenses: boolean;
  recurringOperatingSupport: boolean;
  evidence: FundingEvidence[];
  dimensions: FundingDimension[];
};

function blobOf(opp: Record<string, unknown>): string {
  return [
    opp.title,
    opp.funder,
    opp.description,
    opp.requirements,
    opp.eligibility,
    opp.funding_period,
    opp.program_limitations,
    opp.applicant_restrictions,
    opp.addressable_explanation,
  ]
    .filter(Boolean)
    .map(String)
    .join("\n")
    .toLowerCase();
}

function explicitExclusionPhrase(blob: string, terms: string[]): string | null {
  for (const term of terms) {
    const token = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const hit = blob.match(
      new RegExp(
        `\\bno\\s+${token}\\b|\\bwithout\\s+${token}\\b|\\bnot\\s+${token}\\b|\\b${token}\\s+not\\s+allow(?:ed)?\\b|\\b${token}\\s+unallow(?:able|ed)?\\b`,
        "i",
      ),
    );
    if (hit) return hit[0];
  }
  return null;
}

function flagYes(blob: string, yes: RegExp, no: RegExp, terms: string[] = []): AllowFlag {
  if (explicitExclusionPhrase(blob, terms) || no.test(blob)) return "no";
  if (yes.test(blob)) return "yes";
  return "unknown";
}

function matchedPhrase(blob: string, pattern: RegExp): string | null {
  return blob.match(pattern)?.[0] ?? null;
}

function parseTermMonths(blob: string, opp: Record<string, unknown>): number | null {
  const explicit = String(opp.funding_period ?? "");
  const text = `${explicit} ${blob}`;
  const years = text.match(/(\d+(?:\.\d+)?)\s*[- ]*(year|yr)s?\b/i);
  if (years) return Math.round(Number(years[1]) * 12);
  const months = text.match(/(\d+)\s*[- ]*months?\b/i);
  if (months) return Number(months[1]);
  if (/\bmulti-?year\b|\b36[- ]month\b/.test(text)) return 36;
  if (/\bannual\b|\bone[- ]year\b|\b12[- ]month\b/.test(text)) return 12;
  if (/\bfive[- ]year\b/.test(text)) return 60;
  if (/\bthree[- ]year\b/.test(text)) return 36;
  if (/\btwo[- ]year\b/.test(text)) return 24;
  return null;
}

function parseIndirectCap(blob: string): string | null {
  const deMinimis = blob.match(/de\s*minimis[^\d%]{0,20}(\d{1,2}(?:\.\d+)?)\s*%/i);
  if (deMinimis) return `${deMinimis[1]}% de minimis`;
  if (/10\s*%\s*de\s*minimis|de\s*minimis/.test(blob)) return "10% de minimis (2 CFR 200)";
  const cap = blob.match(/indirect[^\d%]{0,24}(\d{1,2}(?:\.\d+)?)\s*%/i);
  if (cap) return `${cap[1]}% cap`;
  if (/nicra|negotiated\s*indirect/.test(blob)) return "NICRA / negotiated rate";
  return null;
}

function parseCadence(blob: string, renewable: AllowFlag, termMonths: number | null): FundingCadence {
  if (/one[- ]time|single\s*award|non[- ]renewable|not\s*renewable|planning\s*grant\s*only/.test(blob)) {
    return "one_time";
  }
  if (
    renewable === "yes"
    || /recurring|formula\s*grant|block\s*grant|annual\s*(cycle|appropriation)|continuation\s*award|renewable/.test(blob)
    || (termMonths != null && termMonths >= 24)
  ) {
    return "recurring";
  }
  return "unknown";
}

function awardAmount(opp: Record<string, unknown>): number | null {
  const max = Number(opp.ifcdc_recommended_request_max ?? opp.ifcdc_max_eligible_request ?? opp.amount_max ?? 0);
  if (Number.isFinite(max) && max > 0) return max;
  const min = Number(opp.amount_min ?? 0);
  return Number.isFinite(min) && min > 0 ? min : null;
}

export function analyzeRecurringFunding(
  opp: Record<string, unknown>,
  programAlignmentScore = 50
): RecurringFundingProfile {
  const blob = blobOf(opp);
  const cost = evaluateGrantAllowableCostRecovery({
    funderType: opp.funder_type ? String(opp.funder_type) : null,
    title: opp.title ? String(opp.title) : null,
    description: opp.description ? String(opp.description) : null,
    requirements: opp.requirements ? String(opp.requirements) : null,
  });

  const personnelAllowed = flagYes(
    blob,
    /personnel|salary|salaries|staffing|wages|payroll|fte\b|key\s*personnel/,
    /personnel\s*not\s*allow|no\s*personnel|salaries\s*not\s*allow|equipment\s*only|capital\s*only|construction\s*only|supplies\s*only/,
    ["personnel", "salaries", "salary", "payroll"],
  );
  const fringeAllowed = flagYes(
    blob,
    /fringe|benefits|payroll\s*tax/,
    /fringe\s*not\s*allow|benefits\s*not\s*allow/,
    ["fringe benefits", "fringe", "benefits"],
  );
  const hrAllowed = flagYes(
    blob,
    /\bhr\b|human\s*resources/,
    /no\s+hr\b|human\s*resources\s*not\s*allow/,
    ["human resources", "hr"],
  );
  const administrativeAllowed = flagYes(
    blob,
    /administrative\s*cost|admin\s*cost|grant\s*administration|management\s*and\s*general|\badministration\b/,
    /no\s*admin|administrative\s*costs?\s*not\s*allow|admin\s*not\s*allow/,
    ["administrative costs", "administrative cost", "administration", "admin"],
  );
  const generalOperatingAllowed = flagYes(
    blob,
    /general\s*operating|unrestricted|core\s*support|operating\s*support|overhead\s*support/,
    /restricted\s*to\s*program|no\s*general\s*operating|program\s*costs?\s*only|not\s*for\s*overhead/,
    ["general operating support", "general operating", "operating support"],
  );
  let indirectAllowed: AllowFlag = flagYes(
    blob,
    /indirect\s*cost|facilities\s*and\s*administrative|f&a\b|de\s*minimis|nicra/,
    /no\s*indirect|indirect\s*costs?\s*not\s*allow|indirect\s*unallow/,
    ["indirect costs", "indirect cost", "indirect"],
  );
  if (cost.restrictionsDetected.includes("indirect_costs_restricted")) indirectAllowed = "no";

  const renewable = flagYes(
    blob,
    /renewable|renewal\s*option|continuation\s*award|may\s*be\s*renewed|subject\s*to\s*renewal/,
    /non[- ]renewable|not\s*renewable|no\s*renewal|one[- ]time\s*only/
  );
  const awardTermMonths = parseTermMonths(blob, opp);
  const multiYearAvailable: AllowFlag =
    awardTermMonths != null && awardTermMonths >= 24
      ? "yes"
      : flagYes(blob, /multi-?year|years\s*2[-–]?\s*5|option\s*years/, /single\s*year\s*only|one[- ]year\s*only/);

  const cadence = parseCadence(blob, renewable, awardTermMonths);
  const paymentTiming: PaymentTiming = /advance\s*payment|drawdown|working\s*capital/.test(blob)
    ? /reimburs/.test(blob)
      ? "mixed"
      : "advance"
    : /reimburs/.test(blob)
      ? "reimbursement"
      : "unknown";

  const amount = awardAmount(opp);
  const years = awardTermMonths ? Math.max(awardTermMonths / 12, 1) : cadence === "recurring" ? 3 : 1;
  let expectedAnnualValue: number | null = null;
  let lifetimeValue: number | null = null;
  if (amount != null) {
    if (cadence === "one_time" && renewable !== "yes") {
      expectedAnnualValue = 0;
      lifetimeValue = amount;
    } else if (cadence === "recurring" || renewable === "yes" || (awardTermMonths != null && awardTermMonths >= 24)) {
      expectedAnnualValue = Math.round(amount / years);
      lifetimeValue = Math.round(expectedAnnualValue * Math.max(years, renewable === "yes" ? 4 : years));
    } else {
      expectedAnnualValue = null;
      lifetimeValue = amount;
    }
  }

  const personnelYes = personnelAllowed === "yes" || fringeAllowed === "yes";
  const opsYes = generalOperatingAllowed === "yes" || administrativeAllowed === "yes" || indirectAllowed === "yes";
  const restrictedProgramOnly = Boolean(
    amount != null
    && amount >= 100000
    && personnelAllowed !== "yes"
    && generalOperatingAllowed !== "yes"
    && administrativeAllowed !== "yes"
    && (personnelAllowed === "no" || /restricted|program\s*only|capital|equipment|construction|supplies\s*only/.test(blob))
  );

  const evidenceNotes: string[] = [];
  if (restrictedProgramOnly) {
    evidenceNotes.push(
      "Looks large but does not show personnel/ops allowability — treat as restricted program money, not sustainable operating revenue."
    );
  }
  if (cadence === "one_time") evidenceNotes.push("Classified as one-time / non-recurring from listing language.");
  if (indirectAllowed === "no") evidenceNotes.push("Indirect cost recovery appears disallowed.");
  if (personnelAllowed === "unknown") evidenceNotes.push("Personnel allowability not explicit in HQ record.");

  let sustainabilityRisk: SustainabilityRisk = "medium";
  if (restrictedProgramOnly || (cadence === "one_time" && !personnelYes && !opsYes)) sustainabilityRisk = "high";
  else if ((cadence === "recurring" || renewable === "yes") && personnelYes && (opsYes || indirectAllowed === "yes")) {
    sustainabilityRisk = "low";
  } else if (cadence === "one_time") sustainabilityRisk = "high";

  const align = Math.max(0, Math.min(100, programAlignmentScore));
  const categoryEarly = classifyFundingCategory(blob);
  const isContract = categoryEarly.category === "government_contract";
  const renewableGrantYes = !isContract && renewable === "yes";
  const gosYes = !isContract && generalOperatingAllowed === "yes";
  const multiYes = multiYearAvailable === "yes" || (awardTermMonths != null && awardTermMonths >= 24);
  const breakdown = {
    renewableGrant: {
      max: 15,
      points: renewableGrantYes ? 15 : 0,
      note: `renewable grant ${renewableGrantYes ? "yes" : renewable}. Unknown is not yes.`,
    },
    multiYear: {
      max: 15,
      points: multiYes ? 15 : 0,
      note: awardTermMonths ? `${awardTermMonths} months` : `multi-year ${multiYearAvailable}`,
    },
    generalOperatingSupport: {
      max: 15,
      points: gosYes ? 15 : 0,
      note: `general operating support ${generalOperatingAllowed}`,
    },
    governmentContract: {
      max: 10,
      points: isContract ? 10 : 0,
      note: "Government contract. Not a grant award and not received revenue.",
    },
    hr: {
      max: 10,
      points: hrAllowed === "yes" ? 10 : 0,
      note: `hr ${hrAllowed}`,
    },
    payroll: {
      max: 20,
      points: personnelAllowed === "yes" ? 20 : 0,
      note: `payroll ${personnelAllowed}`,
    },
    administration: {
      max: 15,
      points: administrativeAllowed === "yes" ? 15 : 0,
      note: `administration ${administrativeAllowed}`,
    },
  };
  if (restrictedProgramOnly) {
    breakdown.payroll.points = Math.min(breakdown.payroll.points, 4);
    breakdown.administration.points = Math.min(breakdown.administration.points, 3);
    breakdown.generalOperatingSupport.points = 0;
  }

  const recurringFundingScore = Math.max(
    0,
    Math.min(
      100,
      Object.values(breakdown).reduce((s, b) => s + b.points, 0)
    )
  );

  const renewalMatch = blob.match(/renew(?:al)?[^\n]{0,40}(\d{4}-\d{2}-\d{2}|\w+\s+\d{1,2},\s*\d{4})/);
  const periodEnd = opp.period_end ? String(opp.period_end) : opp.deadline ? String(opp.deadline) : null;
  const category = categoryEarly;
  const money = classifyMoneyStatus(blob);
  const recurringOperatingSupport = category.category === "recurring_operating_support";
  const restrictedExpenses = category.category === "restricted_expenses";
  const programPhrase = matchedPhrase(blob, /\bprogram staff\b|\bprograms\b|\bprogram\b/);
  const evidence: FundingEvidence[] = [
    { field: "fundingCategory", phrase: category.phrase, value: category.category },
    { field: "moneyStatus", phrase: money.phrase, value: money.status },
    {
      field: "payroll",
      phrase: explicitExclusionPhrase(blob, ["personnel", "salaries", "salary", "payroll"])
        || matchedPhrase(blob, /personnel|salary|salaries|payroll/)
        || "no payroll phrase",
      value: personnelAllowed,
    },
    {
      field: "hr",
      phrase: explicitExclusionPhrase(blob, ["human resources", "hr"])
        || matchedPhrase(blob, /\bhr\b|human\s*resources/)
        || "no hr phrase",
      value: hrAllowed,
    },
    {
      field: "administration",
      phrase: explicitExclusionPhrase(blob, ["administrative costs", "administrative cost", "administration", "admin"])
        || matchedPhrase(blob, /administrative\s*costs?|\badministration\b|\badmin\b/)
        || "no administration phrase",
      value: administrativeAllowed,
    },
    {
      field: "fringe",
      phrase: explicitExclusionPhrase(blob, ["fringe benefits", "fringe", "benefits"])
        || matchedPhrase(blob, /fringe|benefits/)
        || "no fringe phrase",
      value: fringeAllowed,
    },
    {
      field: "programs",
      phrase: programPhrase || "no program phrase",
      value: programPhrase ? `alignment ${align}` : "unknown",
    },
    {
      field: "recurringOperatingSupport",
      phrase: category.category === "recurring_operating_support" ? category.phrase : "not recurring operating support",
      value: recurringOperatingSupport ? "yes" : "no",
    },
    {
      field: "restrictedExpenses",
      phrase: restrictedExpenses ? category.phrase : "not restricted expenses",
      value: restrictedExpenses ? "yes" : "no",
    },
  ];

  return {
    opportunityId: String(opp.id ?? ""),
    cadence,
    renewable,
    awardTermMonths,
    renewalCycleDate: renewalMatch ? renewalMatch[1] : periodEnd,
    multiYearAvailable,
    generalOperatingAllowed,
    personnelAllowed,
    fringeAllowed,
    administrativeAllowed,
    indirectAllowed,
    indirectRateCap: parseIndirectCap(blob),
    paymentTiming,
    expectedAnnualValue,
    lifetimeValue,
    sustainabilityRisk,
    restrictedProgramOnly,
    restrictedWarning: restrictedProgramOnly
      ? "Large award appears restricted — cannot treat as payroll/HR operating revenue without explicit personnel/admin allowability."
      : null,
    recurringFundingScore,
    scoreBreakdown: breakdown,
    programAlignmentScore: align,
    evidenceNotes,
    fundingCategory: category.category,
    moneyStatus: money.status,
    hrAllowed,
    restrictedExpenses,
    recurringOperatingSupport,
    evidence,
    dimensions: classifyFundingDimensions({
      blob,
      awardTermMonths,
      renewable,
      personnelAllowed,
      hrAllowed,
      administrativeAllowed,
      indirectAllowed,
      generalOperatingAllowed,
      isContract: category.category === "government_contract",
      isGrantLike: category.category === "grant_opportunity" || category.category === "recurring_operating_support",
    }),
  };
}

function classifyFundingCategory(blob: string): { category: FundingCategory; phrase: string } {
  const contract = blob.match(/\b(?:government|federal|county|state)\s+contract\b|\bcontract\s+vehicle\b/);
  if (contract) return { category: "government_contract", phrase: contract[0] };

  const capital = blob.match(/\b(?:capital|equipment|construction)\b/);
  if (capital && /\bonly\b|\bnon[- ]renewable\b|\bone[- ]time\b|\brestricted\b/.test(blob)) {
    return { category: "restricted_capital", phrase: capital[0] };
  }

  const operating = blob.match(/\bgeneral\s+operating(?:\s+support)?\b|\brecurring\s+operating\s+support\b/);
  const operatingExcluded = explicitExclusionPhrase(blob, ["general operating support", "general operating", "operating support"]);
  if (operating && !operatingExcluded) return { category: "recurring_operating_support", phrase: operating[0] };

  const restrictedExpense = blob.match(/\brestricted\s+(?:award|expense|expenses)\b|\bsupplies\s+only\b|\brestricted program supplies\b/);
  if (restrictedExpense) return { category: "restricted_expenses", phrase: restrictedExpense[0] };

  const grant = blob.match(/\b(?:formula\s+grant|block\s+grant|grant)\b/);
  if (grant) return { category: "grant_opportunity", phrase: grant[0] };
  return { category: "grant_opportunity", phrase: "no instrument phrase" };
}

function classifyMoneyStatus(blob: string): { status: FundingMoneyStatus; phrase: string } {
  const received = blob.match(/\b(?:received revenue|funds received|cash received)\b/);
  const receivedNegated = /\bnot\s+(?:received revenue|funds received|cash received)\b/.test(blob);
  if (received && !receivedNegated) return { status: "received_revenue", phrase: received[0] };

  const submitted = blob.match(/\b(?:submitted application|application submitted)\b/);
  const submittedNegated = /\bnot\s+a\s+submitted application\b|\bnot\s+submitted\b/.test(blob);
  if (submitted && !submittedNegated) return { status: "submitted_application", phrase: submitted[0] };

  const award = blob.match(/\b(?:grant award|awarded|award notice)\b/);
  const awardNegated = /\bnot\s+a\s+grant award\b|\bnot\s+an\s+award\b|\bnot\s+awarded\b/.test(blob);
  if (award && !awardNegated) return { status: "award", phrase: award[0] };

  const potential = blob.match(/\bpotential funding\b/);
  return { status: "potential_funding", phrase: potential?.[0] ?? "no award or received-revenue language" };
}

function classifyFundingDimensions(input: {
  blob: string;
  awardTermMonths: number | null;
  renewable: AllowFlag;
  personnelAllowed: AllowFlag;
  hrAllowed: AllowFlag;
  administrativeAllowed: AllowFlag;
  indirectAllowed: AllowFlag;
  generalOperatingAllowed: AllowFlag;
  isContract: boolean;
  isGrantLike: boolean;
}): FundingDimension[] {
  const contractPhrase = input.blob.match(/\b(?:government|federal|county|state)\s+contract\b|\bcontract\s+vehicle\b/)?.[0]
    ?? explicitExclusionPhrase(input.blob, ["government contract", "federal contract", "contract vehicle"])
    ?? "UNKNOWN";
  const contractStatus: AllowFlag = input.isContract
    ? "yes"
    : explicitExclusionPhrase(input.blob, ["government contract", "federal contract", "contract vehicle"])
      ? "no"
      : "unknown";

  const gosPhrase = explicitExclusionPhrase(input.blob, ["general operating support", "general operating", "operating support"])
    ?? matchedPhrase(input.blob, /\bgeneral\s+operating(?:\s+support)?\b/)
    ?? "UNKNOWN";
  const generalOperatingGrant: AllowFlag = input.isContract
    ? "no"
    : input.generalOperatingAllowed;

  const renewablePhrase = explicitExclusionPhrase(input.blob, ["renewable grant", "renewal"])
    ?? matchedPhrase(input.blob, /\brenewable\b|\brenewal\s*option\b|\bcontinuation\s*award\b/)
    ?? "UNKNOWN";
  const renewableGrant: AllowFlag = input.isContract
    ? "no"
    : input.renewable === "yes" && input.isGrantLike
      ? "yes"
      : input.renewable;

  const multiPhrase = input.awardTermMonths != null ? `${input.awardTermMonths} months` : "UNKNOWN";
  const multiStatus: AllowFlag = input.awardTermMonths == null
    ? "unknown"
    : input.awardTermMonths >= 24
      ? "yes"
      : "no";

  const payrollPhrase = explicitExclusionPhrase(input.blob, ["personnel", "salaries", "salary", "payroll"])
    ?? matchedPhrase(input.blob, /personnel|salary|salaries|payroll/)
    ?? "UNKNOWN";
  const hrPhrase = explicitExclusionPhrase(input.blob, ["human resources", "hr"])
    ?? matchedPhrase(input.blob, /\bhr\b|human\s*resources/)
    ?? "UNKNOWN";
  const adminPhrase = explicitExclusionPhrase(input.blob, ["administrative costs", "administrative cost", "administration", "admin"])
    ?? matchedPhrase(input.blob, /administrative\s*costs?|\badministration\b/)
    ?? "UNKNOWN";
  const indirectPhrase = explicitExclusionPhrase(input.blob, ["indirect costs", "indirect cost", "indirect"])
    ?? matchedPhrase(input.blob, /indirect\s*costs?|de\s*minimis|nicra/)
    ?? "UNKNOWN";

  return [
    {
      id: "general_operating_grant",
      status: generalOperatingGrant,
      phrase: input.isContract ? contractPhrase : gosPhrase,
      note: "General operating grant. Not a government contract and not received revenue.",
    },
    {
      id: "multiyear_award",
      status: multiStatus,
      phrase: multiPhrase,
      note: "Duration only. Not received money and not an award by itself.",
    },
    {
      id: "renewable_grant",
      status: renewableGrant,
      phrase: input.isContract ? contractPhrase : renewablePhrase,
      note: input.isContract
        ? "A renewable contract is not a renewable grant."
        : "Renewable grant. Separate from received revenue.",
    },
    {
      id: "government_contract",
      status: contractStatus,
      phrase: contractPhrase,
      note: "Government contract. Not a grant award and not received revenue.",
    },
    { id: "payroll", status: input.personnelAllowed, phrase: payrollPhrase, note: "Payroll allowability. Unknown is not yes." },
    { id: "hr", status: input.hrAllowed, phrase: hrPhrase, note: "HR allowability. Unknown is not yes." },
    { id: "administration", status: input.administrativeAllowed, phrase: adminPhrase, note: "Administration allowability. Unknown is not yes." },
    { id: "allowable_indirect", status: input.indirectAllowed, phrase: indirectPhrase, note: "Indirect-cost allowability. Unknown is not yes." },
  ];
}

export async function persistRecurringFundingProfile(
  opportunityId: string,
  profile: RecurringFundingProfile,
  actorEmail?: string
): Promise<void> {
  await ensureGrantTables();
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `UPDATE grant_opportunities SET
       funding_cadence = ?, renewable = ?, award_term_months = ?, renewal_cycle_date = ?,
       multi_year_available = ?, general_operating_allowed = ?, personnel_costs_allowed = ?,
       fringe_benefits_allowed = ?, administrative_costs_allowed = ?, indirect_costs_allowed = ?,
       indirect_rate_cap = ?, payment_timing = ?, expected_annual_value = ?, lifetime_value = ?,
       sustainability_risk = ?, restricted_ops_flag = ?, restricted_program_only = ?, restricted_warning = ?,
       recurring_funding_score = ?, recurring_analysis_json = ?, recurring_analyzed_at = ?, updated_at = ?
     WHERE id = ?`,
    profile.cadence,
    profile.renewable,
    profile.awardTermMonths,
    profile.renewalCycleDate,
    profile.multiYearAvailable,
    profile.generalOperatingAllowed,
    profile.personnelAllowed,
    profile.fringeAllowed,
    profile.administrativeAllowed,
    profile.indirectAllowed,
    profile.indirectRateCap,
    profile.paymentTiming,
    profile.expectedAnnualValue,
    profile.lifetimeValue,
    profile.sustainabilityRisk,
    profile.restrictedProgramOnly ? 1 : 0,
    profile.restrictedProgramOnly ? 1 : 0,
    profile.restrictedWarning,
    profile.recurringFundingScore,
    JSON.stringify(profile),
    now,
    now,
    opportunityId
  );
  const scoreRow = await db.get<{ id: string }>(
    `SELECT id FROM grant_opportunity_scores WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1`,
    opportunityId
  );
  if (scoreRow?.id) {
    await db.run(
      `UPDATE grant_opportunity_scores SET recurring_funding_score = ? WHERE id = ?`,
      profile.recurringFundingScore,
      scoreRow.id
    );
  }
  await logGrantActivity(
    "opportunity",
    opportunityId,
    "recurring_funding_scored",
    `Recurring score ${profile.recurringFundingScore} · ${profile.cadence} · personnel ${profile.personnelAllowed} · risk ${profile.sustainabilityRisk}`,
    actorEmail
  );
}

export async function scoreOpportunityRecurringFunding(
  opportunityId: string,
  opts?: { programAlignmentScore?: number; actorEmail?: string }
): Promise<RecurringFundingProfile | null> {
  await ensureGrantTables();
  const db = await getDb();
  const opp = await db.get<Record<string, unknown>>("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId);
  if (!opp) return null;
  const profile = analyzeRecurringFunding(opp, opts?.programAlignmentScore ?? Number(opp.composite_score ?? 50));
  profile.opportunityId = opportunityId;
  await persistRecurringFundingProfile(opportunityId, profile, opts?.actorEmail);
  return profile;
}

export async function scoreOpenOpportunitiesRecurring(limit = 80, actorEmail?: string): Promise<number> {
  const db = await getDb();
  const rows = (await db.all(
    `SELECT id FROM grant_opportunities
     WHERE status IN ('open','active','researching')${productionGrantOpportunitySqlFilter()}
     ORDER BY updated_at DESC LIMIT ?`,
    limit
  )) as { id: string }[];
  let n = 0;
  for (const row of rows) {
    try {
      const { scoreGrantOpportunityV5 } = await import("./grantFundingEngineV5");
      const v5 = await scoreGrantOpportunityV5(row.id, { actorEmail });
      if (!v5) await scoreOpportunityRecurringFunding(row.id, { actorEmail });
    } catch {
      await scoreOpportunityRecurringFunding(row.id, { actorEmail });
    }
    n += 1;
  }
  return n;
}

export async function buildRecurringFundingPayrollCoverage() {
  await ensureGrantTables();
  const db = await getDb();
  let monthlyPayroll = 0;
  try {
    const { buildPayrollForecast } = await import("./peopleOperationsEngine");
    const forecast = await buildPayrollForecast();
    monthlyPayroll = Number(forecast.monthlyLabor) || 0;
  } catch {
    monthlyPayroll = 0;
  }

  const filter = productionGrantOpportunitySqlFilter();
  const open = (await db.all(
    `SELECT * FROM grant_opportunities
     WHERE status IN ('open','active','researching')${filter}`
  )) as Record<string, unknown>[];

  let annualRecurring = 0;
  let personnelEligible = 0;
  let adminHrEligible = 0;
  let indirectRecovery = 0;
  let oneTimeRestricted = 0;
  const ranked: RecurringFundingProfile[] = [];
  const restrictedFlags: RecurringFundingProfile[] = [];

  for (const opp of open) {
    const stored = opp.recurring_analysis_json
      ? (() => {
          try {
            return JSON.parse(String(opp.recurring_analysis_json)) as RecurringFundingProfile;
          } catch {
            return null;
          }
        })()
      : null;
    const profile = stored?.recurringFundingScore != null
      ? stored
      : analyzeRecurringFunding(opp, Number(opp.composite_score ?? 50));
    if (!stored) {
      try {
        await persistRecurringFundingProfile(String(opp.id), { ...profile, opportunityId: String(opp.id) });
      } catch {
        /* persist best-effort */
      }
    }
    ranked.push({ ...profile, opportunityId: String(opp.id), title: opp.title } as RecurringFundingProfile & { title?: string });
    const annual = Number(profile.expectedAnnualValue) || 0;
    if (profile.cadence === "recurring" || profile.renewable === "yes") annualRecurring += annual;
    if (profile.personnelAllowed === "yes") personnelEligible += annual || Number(opp.amount_max) || 0;
    if (profile.administrativeAllowed === "yes" || profile.generalOperatingAllowed === "yes") {
      adminHrEligible += annual || Number(opp.amount_max) || 0;
    }
    if (profile.indirectAllowed === "yes") {
      const cap = profile.indirectRateCap?.match(/(\d+(?:\.\d+)?)/);
      const rate = cap ? Number(cap[1]) / 100 : 0.1;
      indirectRecovery += Math.round((annual || Number(opp.amount_max) || 0) * rate);
    }
    if (profile.cadence === "one_time" || profile.restrictedProgramOnly) {
      oneTimeRestricted += Number(profile.lifetimeValue ?? opp.amount_max) || 0;
    }
    if (profile.restrictedProgramOnly) restrictedFlags.push(profile);
  }

  ranked.sort((a, b) => b.recurringFundingScore - a.recurringFundingScore);

  const upcomingRenewals = open
    .filter((o) => o.renewal_cycle_date || o.renewable === "yes")
    .map((o) => ({
      id: String(o.id),
      title: String(o.title ?? ""),
      funder: String(o.funder ?? ""),
      renewalCycleDate: o.renewal_cycle_date ? String(o.renewal_cycle_date) : null,
      renewable: o.renewable,
      expectedAnnualValue: o.expected_annual_value != null ? Number(o.expected_annual_value) : null,
    }))
    .slice(0, 12);

  const expirationRisk = open
    .filter((o) => String(o.sustainability_risk) === "high" || Number(o.restricted_program_only) === 1)
    .map((o) => ({
      id: String(o.id),
      title: String(o.title ?? ""),
      amount: Number(o.amount_max ?? 0),
      risk: String(o.sustainability_risk ?? "high"),
      warning: o.restricted_warning ? String(o.restricted_warning) : "High sustainability risk when award expires",
    }))
    .slice(0, 12);

  const monthsOfPayrollCoverage =
    monthlyPayroll > 0 ? Math.round((personnelEligible / monthlyPayroll) * 10) / 10 : null;

  return {
    title: "Recurring Funding & Payroll Coverage",
    kpis: {
      annualRecurringFunding: Math.round(annualRecurring),
      personnelEligibleFunding: Math.round(personnelEligible),
      adminHrEligibleFunding: Math.round(adminHrEligible),
      indirectCostRecovery: Math.round(indirectRecovery),
      oneTimeRestrictedFunding: Math.round(oneTimeRestricted),
      upcomingRenewals: upcomingRenewals.length,
      fundingExpirationRisk: expirationRisk.length,
      monthsOfPayrollCoverage,
      monthlyPayrollBasis: monthlyPayroll,
    },
    upcomingRenewals,
    expirationRisk,
    restrictedLookalikes: restrictedFlags.slice(0, 10).map((p) => ({
      opportunityId: p.opportunityId,
      score: p.recurringFundingScore,
      warning: p.restrictedWarning,
      amount: p.lifetimeValue,
    })),
    ranked: ranked.slice(0, 15).map((p) => ({
      opportunityId: p.opportunityId,
      title: (p as { title?: string }).title,
      recurringFundingScore: p.recurringFundingScore,
      cadence: p.cadence,
      personnelAllowed: p.personnelAllowed,
      expectedAnnualValue: p.expectedAnnualValue,
      sustainabilityRisk: p.sustainabilityRisk,
      restrictedProgramOnly: p.restrictedProgramOnly,
    })),
    founderAuthorizationRequired: true,
    generatedAt: new Date().toISOString(),
  };
}

/** Representative real-world NOFO patterns used to verify ranking even when the live feed is thin. */
export const RECURRING_FUNDING_ACCEPTANCE_FIXTURES: Record<string, unknown>[] = [
  {
    id: "fixture-samhsa-ccbhc",
    title: "SAMHSA Certified Community Behavioral Health Clinic Expansion",
    funder: "Substance Abuse and Mental Health Services Administration",
    funder_type: "federal",
    amount_max: 400000,
    funding_period: "4 years",
    description:
      "Continuation award, renewable annually. Personnel salaries, fringe benefits, administrative costs, and 10% de minimis indirect cost recovery allowed. Multi-year staffing for program staff and HR administration.",
    requirements: "Key personnel, payroll, fringe, NICRA or de minimis, general operating support for clinic administration.",
  },
  {
    id: "fixture-cdbg-ops",
    title: "CDBG Public Services — Community Development Block Grant",
    funder: "U.S. Department of Housing and Urban Development",
    funder_type: "federal",
    amount_max: 250000,
    funding_period: "12 months",
    description:
      "Annual formula grant, renewable subject to appropriation. Salaries for program staff allowed. Administrative costs capped. Indirect costs allowed under 2 CFR 200. Reimbursement payment.",
  },
  {
    id: "fixture-capital-equipment",
    title: "One-Time Capital Equipment and Construction Award",
    funder: "State Capital Improvement Fund",
    funder_type: "state",
    amount_max: 750000,
    funding_period: "18 months",
    description:
      "Non-renewable one-time capital grant. Equipment and construction only. Personnel costs not allowed. Salaries not allowed. No general operating. Indirect costs not allowed. Restricted to program capital purchases.",
  },
  {
    id: "fixture-private-supplies",
    title: "Corporate Supplies-Only Youth Program Gift",
    funder: "Regional Corporate Foundation",
    funder_type: "foundation",
    amount_max: 180000,
    description:
      "One-time restricted program supplies grant. Supplies only. No personnel. No fringe. Administrative costs not allowed. Indirect unallowable. Not for overhead.",
  },
  {
    id: "fixture-gov-contract-ops",
    title: "County Government Contract for Community Operations",
    funder: "County operations office",
    funder_type: "government_contract",
    amount_max: 120000,
    funding_period: "12 months",
    description:
      "Government contract. Potential funding only. Not a grant award. Not received revenue. Not a submitted application. Not general operating support. Not restricted capital. Renewable annual contract. Personnel salaries allowed. Fringe benefits allowed. HR and administration allowed. Administrative costs allowed. Indirect costs allowed.",
  },
];

export function rankAcceptanceFixtures() {
  const ranked = RECURRING_FUNDING_ACCEPTANCE_FIXTURES.map((opp) => analyzeRecurringFunding(opp, 80)).sort(
    (a, b) => b.recurringFundingScore - a.recurringFundingScore
  );
  const staffSustainable = ranked.filter(
    (p) => (p.cadence === "recurring" || p.renewable === "yes") && p.personnelAllowed === "yes"
  );
  const oneTimeRestricted = ranked.filter((p) => p.cadence === "one_time" || p.restrictedProgramOnly);
  const projectedAnnual = staffSustainable.reduce((s, p) => s + (p.expectedAnnualValue || 0), 0);
  const largeRestrictedFlagged = ranked.filter((p) => p.restrictedProgramOnly);
  const topIsStaff =
    ranked[0]?.personnelAllowed === "yes"
    && (ranked[0]?.cadence === "recurring" || ranked[0]?.renewable === "yes");
  const capitalBelowStaff =
    (ranked.find((p) => p.opportunityId === "fixture-samhsa-ccbhc")?.recurringFundingScore ?? 0)
    > (ranked.find((p) => p.opportunityId === "fixture-capital-equipment")?.recurringFundingScore ?? 0);

  return {
    ranking: ranked.map((p) => ({
      opportunityId: p.opportunityId,
      recurringFundingScore: p.recurringFundingScore,
      cadence: p.cadence,
      personnelAllowed: p.personnelAllowed,
      expectedAnnualValue: p.expectedAnnualValue,
      lifetimeValue: p.lifetimeValue,
      sustainabilityRisk: p.sustainabilityRisk,
      restrictedProgramOnly: p.restrictedProgramOnly,
      warning: p.restrictedWarning,
    })),
    staffSustainableIds: staffSustainable.map((p) => p.opportunityId),
    oneTimeRestrictedIds: oneTimeRestricted.map((p) => p.opportunityId),
    projectedAnnualRecurringFunding: projectedAnnual,
    largeRestrictedFlagged: largeRestrictedFlagged.map((p) => p.opportunityId),
    ranksStaffAboveRestrictedCapital: topIsStaff && capitalBelowStaff,
  };
}

export function buildFounderFixtureBriefing(): string {
  const rows = RECURRING_FUNDING_ACCEPTANCE_FIXTURES
    .map((opp) => analyzeRecurringFunding(opp, 80))
    .sort((a, b) => b.recurringFundingScore - a.recurringFundingScore);
  const lines = [
    "Founder fixture briefing. Every score is a local fixture. These figures are not live awards, not received revenue, and not guaranteed money.",
  ];
  for (const row of rows) {
    const evidence = row.evidence
      .map((item) => `${item.field} matched "${item.phrase}" => ${item.value}`)
      .join("; ");
    lines.push(
      `${row.opportunityId}: category ${row.fundingCategory}; money status ${row.moneyStatus}; fixture score ${row.recurringFundingScore}. ${evidence}.`,
    );
  }
  return lines.join("\n");
}

export type GrantsIntelligenceSource = "fixture" | "live" | "incomplete";

export type GrantsIntelligenceBriefingRow = {
  id: string;
  fundingSource: string;
  estimatedAmount: string;
  eligibilityEvidence: string;
  deadline: string;
  restrictions: string;
  allowableExpenses: string;
  renewal: string;
  fundingStatus: FundingMoneyStatus;
  score: string;
  recommendedNextAction: string;
  source: GrantsIntelligenceSource;
  fixtureLabel: string | null;
  eligible: boolean;
  notGuaranteedMoney: true;
};

export type GrantCenterReader = {
  all: (sql: string, ...params: unknown[]) => Promise<unknown[]>;
};

export const GRANT_CENTER_OPPORTUNITY_SQL = `SELECT
  id, title, funder, description, amount_min, amount_max, status, deadline,
  requirements, source_type, funder_type, eligibility, funding_status,
  close_date, eligibility_result, funding_instrument, funding_period,
  applicant_restrictions, program_limitations, award_ceiling, estimated_funding
FROM grant_opportunities`;

export type GrantsIntelligenceBriefing = {
  audience: "founder";
  mode: "read_only";
  sendsMail: false;
  submitsGrant: false;
  spends: false;
  writesFundingRecords: false;
  notGuaranteedMoney: true;
  liveConnected: boolean;
  liveReadFailed: boolean;
  liveReadError: string | null;
  rows: GrantsIntelligenceBriefingRow[];
};

const FIXTURE_LABEL = "FIXTURE — not a live opportunity";

export function founderMayReadGrantsBriefing(
  user: { role?: string; email?: string } | null | undefined,
  founderEmail = "",
): boolean {
  if (!user) return false;
  const role = String(user.role || "").toLowerCase();
  if (role === "owner" || role === "founder") return true;
  const email = String(user.email || "").toLowerCase();
  return Boolean(founderEmail && email === founderEmail.toLowerCase());
}

function fieldText(opp: Record<string, unknown>, key: string): string {
  const value = opp[key];
  return typeof value === "string" ? value.trim() : "";
}

function isOpenEndedRecord(opp: Record<string, unknown>): boolean {
  const blob = [opp.deadline, opp.close_date, opp.funding_period, opp.status]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return /\bopen[- ]ended\b|\brolling\b|\bno deadline\b/.test(blob);
}

function recordHasDeadlineEvidence(opp: Record<string, unknown>): boolean {
  if (isOpenEndedRecord(opp)) return true;
  const deadline = fieldText(opp, "deadline") || fieldText(opp, "close_date");
  if (!deadline || deadline.toUpperCase() === "UNKNOWN") return false;
  return !Number.isNaN(Date.parse(deadline));
}

function recordHasEligibilityText(opp: Record<string, unknown>): boolean {
  return [opp.eligibility, opp.eligibility_result, opp.description, opp.requirements]
    .some((value) => typeof value === "string" && value.trim().length > 0);
}

function meetsLiveEvidenceMinimum(opp: Record<string, unknown>): boolean {
  const source = fieldText(opp, "source_type") || fieldText(opp, "source");
  return source.length > 0 && source.toLowerCase() !== "fixture" && recordHasDeadlineEvidence(opp) && recordHasEligibilityText(opp);
}

function deadlineHasPassed(opp: Record<string, unknown>): boolean {
  if (isOpenEndedRecord(opp)) return false;
  const deadline = fieldText(opp, "deadline") || fieldText(opp, "close_date");
  const parsed = Date.parse(deadline);
  if (!deadline || Number.isNaN(parsed)) return false;
  return parsed < Date.now();
}

function isFixtureRecord(opp: Record<string, unknown>, requested: "fixture" | "live"): boolean {
  const source = (fieldText(opp, "source_type") || fieldText(opp, "source")).toLowerCase();
  return requested === "fixture" || String(opp.id ?? "").startsWith("fixture-") || source === "fixture";
}

function briefingRowFromOpportunity(
  opp: Record<string, unknown>,
  requested: "fixture" | "live",
): GrantsIntelligenceBriefingRow {
  const profile = analyzeRecurringFunding(opp, requested === "fixture" ? 80 : 0);
  const forcedFixture = isFixtureRecord(opp, requested);
  const source: GrantsIntelligenceSource = forcedFixture
    ? "fixture"
    : meetsLiveEvidenceMinimum(opp)
      ? "live"
      : "incomplete";
  const deadline = fieldText(opp, "deadline") || fieldText(opp, "close_date") || "UNKNOWN";
  const expired = source !== "fixture" && deadlineHasPassed(opp);
  const amount = awardAmount(opp);
  const estimatedAmount = amount == null
    ? "UNKNOWN"
    : source === "fixture"
      ? `fixture amount ${amount} — not guaranteed money`
      : `estimated amount ${amount} — not guaranteed money and not received revenue`;
  const renewalDimension = profile.dimensions.find((item) => item.id === "renewable_grant");
  const renewal = `renewable ${renewalDimension?.status === "unknown" ? "UNKNOWN" : renewalDimension?.status ?? "UNKNOWN"}`;
  const restrictions = [
    expired ? "deadline passed" : null,
    fieldText(opp, "applicant_restrictions") || null,
    fieldText(opp, "program_limitations") || null,
    profile.restrictedWarning,
    profile.fringeAllowed === "no" ? "fringe not allowed" : null,
    profile.personnelAllowed === "no" ? "payroll not allowed" : null,
    profile.indirectAllowed === "no" ? "indirect costs not allowed" : null,
    profile.administrativeAllowed === "no" ? "administration not allowed" : null,
  ].filter(Boolean).join("; ") || "none stated";
  const allowable = ["payroll", "hr", "administration", "allowable_indirect"]
    .map((id) => {
      const item = profile.dimensions.find((entry) => entry.id === id);
      const status = item?.status ?? "unknown";
      return `${id} ${status === "unknown" ? "UNKNOWN" : status}`;
    })
    .concat([`fringe ${profile.fringeAllowed === "unknown" ? "UNKNOWN" : profile.fringeAllowed}`])
    .join("; ");
  const eligibility = profile.dimensions
    .map((item) => `${item.id} ${item.status === "unknown" ? "UNKNOWN" : item.status}: ${item.phrase}`)
    .join("; ");
  const funder = String(opp.funder ?? "UNKNOWN");
  const title = String(opp.title ?? profile.opportunityId);
  const score = source === "fixture"
    ? `fixture score ${profile.recurringFundingScore} — not guaranteed money`
    : `score ${profile.recurringFundingScore} — not guaranteed money and not received revenue`;
  const recommendedNextAction = source === "fixture"
    ? "Fixture only. Founder review. Do not submit, spend, or treat the fixture score as money."
    : expired
      ? "deadline passed. Not eligible to pursue. Do not submit, spend, or treat the estimate as received revenue."
      : source === "incomplete"
        ? "Incomplete. Not recommended. Missing evidence is not eligibility. Do not submit, spend, or treat this as a live award."
        : "Estimate only. Not received revenue. Do not submit or spend.";
  return {
    id: profile.opportunityId,
    fundingSource: source === "fixture" ? `${FIXTURE_LABEL}: ${funder} — ${title}` : `${funder} — ${title}`,
    estimatedAmount,
    eligibilityEvidence: eligibility,
    deadline,
    restrictions,
    allowableExpenses: allowable,
    renewal,
    fundingStatus: profile.moneyStatus,
    score,
    recommendedNextAction,
    source,
    fixtureLabel: source === "fixture" ? FIXTURE_LABEL : null,
    eligible: source === "live" && !expired,
    notGuaranteedMoney: true,
  };
}

export function loadLiveGrantsIntelligenceRows(
  alreadyLoaded?: readonly Record<string, unknown>[] | null,
): GrantsIntelligenceBriefingRow[] {
  if (!alreadyLoaded?.length) return [];
  return alreadyLoaded.map((row) => briefingRowFromOpportunity(row, "live"));
}

const LIVE_READ_ERROR = "Grant Center records could not be read.";

export async function readGrantCenterOpportunities(db: GrantCenterReader): Promise<Record<string, unknown>[]> {
  const info = await db.all("SELECT name FROM pragma_table_info('grant_opportunities')");
  const names = new Set(
    (info as Array<{ name?: unknown }>).map((row) => String(row.name ?? "")).filter(Boolean),
  );
  if (!names.has("id")) throw new Error("grant_opportunities is not available");
  const columns = GRANT_CENTER_OPPORTUNITY_SQL
    .replace(/^SELECT\s+/i, "")
    .replace(/\s+FROM\s+grant_opportunities\s*$/i, "")
    .split(",")
    .map((column) => column.trim())
    .filter((column) => names.has(column));
  const statement = `SELECT ${columns.join(", ")} FROM grant_opportunities`;
  if (!/^SELECT\b/i.test(statement) || /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER)\b/i.test(statement)) {
    throw new Error("Grants intelligence briefing is SELECT only");
  }
  const rows = await db.all(statement);
  return rows as Record<string, unknown>[];
}

export function buildGrantsIntelligenceBriefing(input?: {
  liveRows?: readonly Record<string, unknown>[] | null;
}): GrantsIntelligenceBriefing {
  const fixtures = RECURRING_FUNDING_ACCEPTANCE_FIXTURES.map((row) => briefingRowFromOpportunity(row, "fixture"));
  const loaded = loadLiveGrantsIntelligenceRows(input?.liveRows);
  return {
    audience: "founder",
    mode: "read_only",
    sendsMail: false,
    submitsGrant: false,
    spends: false,
    writesFundingRecords: false,
    notGuaranteedMoney: true,
    liveConnected: false,
    liveReadFailed: false,
    liveReadError: null,
    rows: [...fixtures, ...loaded],
  };
}

export async function readFounderGrantsBriefing(db: GrantCenterReader | null): Promise<GrantsIntelligenceBriefing> {
  if (!db) {
    return { ...buildGrantsIntelligenceBriefing(), liveConnected: false, liveReadFailed: true, liveReadError: LIVE_READ_ERROR };
  }
  try {
    const rows = await readGrantCenterOpportunities(db);
    return {
      ...buildGrantsIntelligenceBriefing({ liveRows: rows }),
      liveConnected: true,
      liveReadFailed: false,
      liveReadError: null,
    };
  } catch {
    return { ...buildGrantsIntelligenceBriefing(), liveConnected: false, liveReadFailed: true, liveReadError: LIVE_READ_ERROR };
  }
}

export function submitGrantsIntelligenceBriefing(): never {
  throw new Error("Grants intelligence briefing cannot submit, send, or spend.");
}

export async function runRecurringFundingAcceptance(opts?: { actorEmail?: string }) {
  const fixtures = rankAcceptanceFixtures();
  let scored = 0;
  try {
    scored = await scoreOpenOpportunitiesRecurring(12, opts?.actorEmail);
  } catch {
    scored = 0;
  }
  let coverage: Awaited<ReturnType<typeof buildRecurringFundingPayrollCoverage>> | null = null;
  try {
    coverage = await buildRecurringFundingPayrollCoverage();
  } catch {
    coverage = null;
  }
  const distinguishes = fixtures.staffSustainableIds.length > 0 && fixtures.oneTimeRestrictedIds.length > 0;
  const ok = distinguishes && fixtures.ranksStaffAboveRestrictedCapital && fixtures.largeRestrictedFlagged.length > 0;

  return {
    ok,
    opportunitiesScored: scored,
    annualRecurringFunding: coverage?.kpis.annualRecurringFunding ?? 0,
    liveAnnualRecurringFunding: coverage?.kpis.annualRecurringFunding ?? 0,
    testFixtureProof: { ...fixtures, classifiedAs: "TEST", neverIncludedInProductionTotals: true },
    fixtureProof: fixtures,
    liveRanking: coverage?.ranked ?? [],
    restrictedLookalikes: coverage?.restrictedLookalikes ?? [],
    distinguishesOneTimeFromRecurring: distinguishes,
    founderApprovalRequired: true,
    neverAutoSubmits: true,
    generatedAt: new Date().toISOString(),
  };
}
