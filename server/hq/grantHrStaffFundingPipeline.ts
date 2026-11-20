/**
 * Recurring HR / payroll coverage against the shared Grant Center store.
 * Payroll is not funded until an award is confirmed and terms are reviewed.
 */
import { getDb } from "../db";
import { ensureGrantTables } from "./grantsSchema";
import { analyzeRecurringFunding, type FundingMoneyStatus } from "./grantRecurringFundingEngine";
import { classifyFundingInitiative, moneyStatusFromGrantRow } from "../../shared/grantInitiativeScope";
import { productionGrantOpportunitySqlFilter } from "./grantProductionPolicy";

export type StaffCostRow = {
  personId: string;
  name: string;
  role: string;
  location: string;
  costPeriod: string;
  payType: string;
  payrollStatus: string;
  fundedByAward: boolean;
  coverage: "unfunded" | "potential_only" | "award_terms_pending" | "award_confirmed";
  initiativeHint: string;
  allowableSalary: "yes" | "no" | "unknown";
  allowableBenefits: "yes" | "no" | "unknown";
  restrictions: string;
  renewalDate: string;
  reportingDue: string;
};

function asText(value: unknown, fallback = "Unknown"): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export async function buildHrStaffFundingPipeline() {
  await ensureGrantTables();
  const db = await getDb();
  let people: Record<string, unknown>[] = [];
  try {
    people = (await db.all(
      `SELECT id, full_name, first_name, last_name, title, role, location, pay_rate, pay_type, payroll_status, status
       FROM people WHERE status = 'active' LIMIT 200`,
    )) as Record<string, unknown>[];
  } catch {
    people = [];
  }

  const awards = (await db.all(
    `SELECT a.*, o.title as opportunity_title, o.funder, o.description, o.requirements, o.eligibility,
            o.geography, o.source_type, o.funding_status, o.renewal_cycle_date, o.recurring_analysis_json
     FROM grant_awards a
     LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
     WHERE a.status IN ('active','reporting')`,
  ).catch(() => [])) as Record<string, unknown>[];

  const open = (await db.all(
    `SELECT * FROM grant_opportunities WHERE status IN ('open','active','researching')${productionGrantOpportunitySqlFilter()}`,
  ).catch(() => [])) as Record<string, unknown>[];

  const awardProfiles = awards.map((award) => {
    const profile = analyzeRecurringFunding(award, 50);
    return {
      award,
      profile,
      moneyStatus: "award" as FundingMoneyStatus,
      initiative: classifyFundingInitiative(award).initiative,
    };
  });

  const potential = open
    .map((opp) => ({ opp, profile: analyzeRecurringFunding(opp, Number(opp.composite_score ?? 50)) }))
    .filter((item) => item.profile.moneyStatus === "potential_funding")
    .filter((item) => item.profile.personnelAllowed === "yes" || item.profile.hrAllowed === "yes" || item.profile.administrativeAllowed === "yes");

  let allocations: { person_id: string; award_id: string }[] = [];
  try {
    allocations = (await db.all(
      "SELECT person_id, award_id FROM grant_labor_allocations LIMIT 500",
    )) as { person_id: string; award_id: string }[];
  } catch {
    allocations = [];
  }

  const staff: StaffCostRow[] = people.map((person) => {
    const personId = String(person.id);
    const linked = allocations.filter((row) => row.person_id === personId);
    const linkedAwards = awardProfiles.filter((item) => linked.some((row) => row.award_id === String(item.award.id)));
    const personnelYes = linkedAwards.some((item) => item.profile.personnelAllowed === "yes");
    const fringeYes = linkedAwards.some((item) => item.profile.fringeAllowed === "yes");
    const coverage: StaffCostRow["coverage"] = linkedAwards.length === 0
      ? (potential.length > 0 ? "potential_only" : "unfunded")
      : personnelYes
        ? "award_confirmed"
        : "award_terms_pending";
    const renewal = linkedAwards.map((item) => asText(item.award.renewal_cycle_date, "")).filter(Boolean)[0] || "Unknown";
    return {
      personId,
      name: asText(person.full_name || [person.first_name, person.last_name].filter(Boolean).join(" ")),
      role: asText(person.title || person.role),
      location: asText(person.location),
      costPeriod: "current payroll period — Unknown until HR confirms",
      payType: asText(person.pay_type),
      payrollStatus: asText(person.payroll_status),
      fundedByAward: coverage === "award_confirmed",
      coverage,
      initiativeHint: linkedAwards[0]?.initiative ?? "unknown",
      allowableSalary: personnelYes ? "yes" : linkedAwards.length ? "unknown" : "unknown",
      allowableBenefits: fringeYes ? "yes" : "unknown",
      restrictions: linkedAwards.map((item) => item.profile.restrictedWarning).filter(Boolean).join("; ") || "Unknown",
      renewalDate: renewal,
      reportingDue: "Unknown",
    };
  });

  const gaps = staff.filter((row) => row.coverage !== "award_confirmed");
  const upcomingRenewals = awardProfiles
    .map((item) => ({
      awardId: String(item.award.id),
      title: asText(item.award.opportunity_title || item.award.title),
      funder: asText(item.award.funder),
      renewalDate: asText(item.award.renewal_cycle_date),
      periodEnd: asText(item.award.period_end),
      initiative: item.initiative,
      moneyStatus: moneyStatusFromGrantRow(item.award),
    }))
    .filter((item) => item.renewalDate !== "Unknown" || item.periodEnd !== "Unknown")
    .slice(0, 20);

  return {
    title: "HR / payroll funding coverage",
    payrollIsFunded: false,
    payrollFundedUntilAwardConfirmed: true,
    founderApprovalRequired: true,
    submitsGrant: false,
    moneyStatusLegend: ["potential_funding", "submitted_application", "award", "received_revenue"],
    kpis: {
      activeStaff: staff.length,
      awardConfirmedCoverage: staff.filter((row) => row.coverage === "award_confirmed").length,
      coverageGaps: gaps.length,
      potentialOperatingSources: potential.length,
      upcomingRenewals: upcomingRenewals.length,
    },
    staff,
    coverageGaps: gaps,
    potentialOperatingSources: potential.slice(0, 20).map((item) => ({
      id: String(item.opp.id),
      title: asText(item.opp.title),
      funder: asText(item.opp.funder),
      moneyStatus: "potential_funding" as const,
      payroll: item.profile.personnelAllowed,
      hr: item.profile.hrAllowed,
      administration: item.profile.administrativeAllowed,
      deadline: asText(item.opp.deadline),
      renewal: asText(item.opp.renewal_cycle_date),
      notGuaranteedMoney: true,
      notPayrollUntilAward: true,
    })),
    upcomingRenewals,
    generatedAt: new Date().toISOString(),
  };
}
