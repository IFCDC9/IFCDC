/**
 * Phase 8A.5 — Grant cost-recovery guidance.
 *
 * Maps legitimate IFCDC operating/program expenses to direct / admin / indirect
 * categories only when the funder's rules appear to allow them.
 * Never forces an unallowable expense into a budget.
 */

export type CostCategory =
  | "insurance"
  | "compliance"
  | "program_staffing"
  | "payroll"
  | "payroll_related"
  | "administrative"
  | "technology"
  | "software"
  | "communications"
  | "program_supplies"
  | "facilities_occupancy"
  | "transportation"
  | "professional_services"
  | "grant_administration"
  | "reporting"
  | "other_program_operating";

export type CostRecoveryLane = "direct" | "administrative" | "indirect" | "unallowable_unless_approved";

export type CostRecoveryItem = {
  category: CostCategory;
  lane: CostRecoveryLane;
  includeWhenPermitted: boolean;
  justification: string;
  caution?: string;
};

const FEDERAL_DEFAULT: CostRecoveryItem[] = [
  {
    category: "program_staffing",
    lane: "direct",
    includeWhenPermitted: true,
    justification: "Program personnel delivering award activities are typically direct costs.",
  },
  {
    category: "payroll",
    lane: "direct",
    includeWhenPermitted: true,
    justification: "Salary/wages for effort on the award, with timekeeping documentation.",
  },
  {
    category: "payroll_related",
    lane: "direct",
    includeWhenPermitted: true,
    justification: "Fringe benefits allocable to grant effort when the budget allows fringe.",
  },
  {
    category: "program_supplies",
    lane: "direct",
    includeWhenPermitted: true,
    justification: "Supplies consumed by program delivery under the scope of work.",
  },
  {
    category: "transportation",
    lane: "direct",
    includeWhenPermitted: true,
    justification: "Participant/staff travel required for program activities when travel is allowed.",
    caution: "Exclude entertainment and unapproved out-of-scope travel.",
  },
  {
    category: "professional_services",
    lane: "direct",
    includeWhenPermitted: true,
    justification: "Contractors/consultants delivering program tasks when procurement rules are met.",
  },
  {
    category: "insurance",
    lane: "indirect",
    includeWhenPermitted: true,
    justification:
      "Professional liability / general insurance may be recovered via indirect cost rate or as allocated admin when the NOFO allows; do not invent limits or force into direct if disallowed.",
    caution: "Confirm NOFO/budget narrative rules before placing Hiscox premium as direct.",
  },
  {
    category: "compliance",
    lane: "administrative",
    includeWhenPermitted: true,
    justification: "Compliance activities required to administer the award may be admin/indirect.",
  },
  {
    category: "administrative",
    lane: "administrative",
    includeWhenPermitted: true,
    justification: "Allocable grant admin under de minimis or negotiated indirect when permitted.",
  },
  {
    category: "grant_administration",
    lane: "administrative",
    includeWhenPermitted: true,
    justification: "Award management, fiscal controls, and coordination needed to run the program.",
  },
  {
    category: "reporting",
    lane: "administrative",
    includeWhenPermitted: true,
    justification: "Required progress/financial reporting is a legitimate admin cost of the award.",
  },
  {
    category: "technology",
    lane: "direct",
    includeWhenPermitted: true,
    justification: "Technology used primarily for program delivery may be direct; shared IT often indirect.",
    caution: "Capital equipment thresholds and prior approval may apply.",
  },
  {
    category: "software",
    lane: "direct",
    includeWhenPermitted: true,
    justification: "Software licenses required for program or grant reporting when allocable.",
  },
  {
    category: "communications",
    lane: "direct",
    includeWhenPermitted: true,
    justification: "Outreach/communications tied to funded program activities.",
  },
  {
    category: "facilities_occupancy",
    lane: "indirect",
    includeWhenPermitted: true,
    justification: "Facilities/occupancy usually recovered through indirect unless NOFO allows direct space costs.",
  },
  {
    category: "other_program_operating",
    lane: "direct",
    includeWhenPermitted: true,
    justification: "Other operating costs only when clearly allocable, allowable, and reasonable.",
  },
];

function textSignalsUnallowable(blob: string): string[] {
  const hits: string[] = [];
  if (/no\s*indirect|indirect\s*costs?\s*not\s*allow/i.test(blob)) hits.push("indirect_costs_restricted");
  if (/matching\s*funds?\s*required|cost\s*share/i.test(blob)) hits.push("cost_share_required");
  if (/construction\s*not\s*allow|no\s*construction/i.test(blob)) hits.push("construction_restricted");
  if (/lobbying/i.test(blob)) hits.push("lobbying_restricted");
  return hits;
}

/**
 * Evaluate which IFCDC cost categories AURA should try to include for a funder/opportunity.
 */
export function evaluateGrantAllowableCostRecovery(opts: {
  funderType?: string | null;
  title?: string | null;
  description?: string | null;
  requirements?: string | null;
}): {
  strategy: string;
  restrictionsDetected: string[];
  recommended: CostRecoveryItem[];
  excludedUnlessFunderApproves: CostCategory[];
} {
  const blob = [opts.title, opts.description, opts.requirements, opts.funderType]
    .filter(Boolean)
    .map(String)
    .join("\n");
  const restrictionsDetected = textSignalsUnallowable(blob);
  const indirectBlocked = restrictionsDetected.includes("indirect_costs_restricted");

  const recommended = FEDERAL_DEFAULT.map((item) => {
    if (indirectBlocked && (item.lane === "indirect" || item.category === "insurance")) {
      return {
        ...item,
        includeWhenPermitted: false,
        lane: "unallowable_unless_approved" as const,
        caution:
          (item.caution ? item.caution + " " : "")
          + "NOFO signals restrict indirect — do not force this cost without written allowability.",
      };
    }
    return item;
  });

  return {
    strategy:
      "Include only legitimate IFCDC program and infrastructure costs the funder allows. "
      + "Prefer direct for program delivery; use administrative/indirect for insurance, compliance, and shared overhead when permitted. "
      + "Never force an expense the funder disallows.",
    restrictionsDetected,
    recommended: recommended.filter((r) => r.includeWhenPermitted),
    excludedUnlessFunderApproves: recommended
      .filter((r) => !r.includeWhenPermitted)
      .map((r) => r.category),
  };
}
