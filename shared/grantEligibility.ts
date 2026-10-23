/** Founder-reviewed facts are separate from imported listings and heuristic fit scores. */
export const GRANT_FACT_KEYS = ["legalName", "taxStatus", "serviceArea", "programs", "experience", "partnerships", "registrations", "financialSummary"] as const;
export type GrantFactKey = typeof GRANT_FACT_KEYS[number];
export type GrantFact = { key: GrantFactKey; value: string; sourceRef: string };
export type GrantProfile = { facts: GrantFact[]; reviewedBy: string; reviewedAt: string };
export type GrantCriterion = { requirement: string; result: "met" | "unmet" | "unknown"; evidenceRef: string };
export type GrantNoticeReview = {
  sourceUrl: string;
  sourceExcerpt: string;
  component: string;
  componentAwardLimit: number;
  deadline: string;
  applicantType: "organization" | "individual" | "school";
  criteria: GrantCriterion[];
  completeNoticeReviewed: boolean;
  requestedAmount: number | null;
  budgetSourceRef: string;
  fundingFeatures: ("multi_year" | "renewable" | "general_operating" | "admin_costs")[];
};
export type GrantEligibilityAssessment = {
  status: "eligible" | "ineligible" | "needs_review";
  reasons: string[];
  canDraft: boolean;
  profile: GrantProfile | null;
  review: (GrantNoticeReview & { reviewedBy: string; reviewedAt: string }) | null;
  opportunity: { id: string; title: string; url: string; funder?: string; description?: string } | null;
};
