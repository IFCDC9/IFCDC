/**
 * Read-only Founder funding view.
 * Ranks the existing local opportunity library. Reads stored rows only.
 */
import { getDb } from "../db";
import { IFCDC_FUNDING_DIVISIONS } from "./grantFundingEngine";

const MATCH_SLUGS = [
  "barbers",
  "workforce_development",
  "small_business",
  "economic_development",
  "community_programs",
  "community_development",
  "software_division",
] as const;

const DECIDED_APPROVAL = new Set(["approved", "rejected"]);

export interface FounderUnavailable {
  status: "unavailable";
  value: null;
}

export interface FounderAvailable<T> {
  status: "available";
  value: T;
}

export type FounderField<T> = FounderAvailable<T> | FounderUnavailable;

export interface FounderOpportunityInput {
  id: string;
  title?: string | null;
  funder?: string | null;
  description?: string | null;
  eligibility?: string | null;
  status?: string | null;
  deadline?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
  programAreas?: string[] | null;
  divisionSlugs?: string[] | null;
  requirements?: string | null;
}

export interface FounderApplicationInput {
  id: string;
  opportunityId?: string | null;
  status?: string | null;
  founderApprovalStatus?: string | null;
  readyToSubmit?: number | boolean | null;
  updatedAt?: string | null;
}

export interface FounderBudgetInput {
  applicationId: string;
  totalRequested?: number | null;
  hasLineItems?: boolean;
}

export interface FounderAwardInput {
  id: string;
  opportunityId?: string | null;
  applicationId?: string | null;
  amount?: number | null;
  status?: string | null;
}

export interface FounderComplianceInput {
  awardId: string;
  status?: string | null;
}

export interface FounderRenewalInput {
  originalAwardId?: string | null;
  newOpportunityId?: string | null;
  status?: string | null;
}

export interface FounderProgramProfile {
  slug: string;
  label: string;
  programs: readonly string[];
}

export interface FounderFundingSource {
  now?: string;
  opportunities: FounderOpportunityInput[];
  applications?: FounderApplicationInput[];
  budgets?: FounderBudgetInput[];
  awards?: FounderAwardInput[];
  compliance?: FounderComplianceInput[];
  renewals?: FounderRenewalInput[];
  programs?: FounderProgramProfile[];
}

export interface FounderFundingOpportunityView {
  id: string;
  title: string;
  funder: string | null;
  opportunityStatus: string | null;
  eligibility: FounderField<string>;
  programMatch: FounderField<{ slug: string; label: string; matchedTerms: string[] }>;
  barbersWorkforceRelevant: FounderField<boolean>;
  fundingAmount: FounderField<{ min: number | null; max: number | null }>;
  deadline: FounderField<string>;
  renewable: FounderField<true>;
  proposalStatus: FounderField<string>;
  budgetStatus: FounderField<{ state: "recorded"; totalRequested: number | null }>;
  founderApprovalStatus: FounderField<string>;
  submissionReadiness: FounderField<"ready">;
  awardStatus: FounderField<{ status: string; amount: number | null }>;
  complianceStatus: FounderField<string>;
  priorityScore: number;
  attentionBecause: string[];
}

export interface FounderFundingView {
  readOnly: true;
  externalFetch: "not_called";
  submissionsExecuted: false;
  approvalsExecuted: false;
  generatedAt: string;
  matchProfile: { slug: string; label: string }[];
  libraryCount: number;
  priority: FounderFundingOpportunityView[];
  opportunities: FounderFundingOpportunityView[];
}

export function founderFundingMatchPrograms(): FounderProgramProfile[] {
  return IFCDC_FUNDING_DIVISIONS.filter((division) =>
    (MATCH_SLUGS as readonly string[]).includes(division.slug),
  ).map((division) => ({
    slug: division.slug,
    label: division.label,
    programs: division.programs,
  }));
}

function unavailable<T>(): FounderField<T> {
  return { status: "unavailable", value: null };
}

function available<T>(value: T): FounderField<T> {
  return { status: "available", value };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function phrase(raw: string): string {
  return raw.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function searchable(opportunity: FounderOpportunityInput): string {
  return [
    opportunity.title,
    opportunity.funder,
    opportunity.description,
    opportunity.eligibility,
    opportunity.requirements,
    ...(opportunity.programAreas ?? []),
    ...(opportunity.divisionSlugs ?? []),
  ].map((part) => phrase(text(part))).filter(Boolean).join(" ");
}

function programTerms(program: FounderProgramProfile): string[] {
  const terms = [program.slug, program.label, ...program.programs].map(phrase).filter((term) => term.length >= 3);
  return [...new Set(terms)];
}

function deadlineValue(raw: string | null | undefined): string | null {
  const value = text(raw);
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : null;
}

function latestApplication(
  opportunityId: string,
  applications: FounderApplicationInput[],
): FounderApplicationInput | null {
  const rows = applications.filter((row) => text(row.opportunityId) === opportunityId);
  if (!rows.length) return null;
  return [...rows].sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt)))[0] ?? null;
}

export function buildFounderFundingView(source: FounderFundingSource): FounderFundingView {
  const now = source.now ? new Date(source.now) : new Date();
  const programs = source.programs?.length ? source.programs : founderFundingMatchPrograms();
  const applications = source.applications ?? [];
  const budgets = source.budgets ?? [];
  const awards = source.awards ?? [];
  const compliance = source.compliance ?? [];
  const renewals = source.renewals ?? [];
  const barbersSlugs = new Set(["barbers", "workforce_development"]);

  const opportunities = source.opportunities.map((opportunity) => {
    const id = text(opportunity.id);
    const haystack = searchable(opportunity);
    const matches = programs.map((program) => {
      const matchedTerms = haystack
        ? programTerms(program).filter((term) => haystack.includes(term))
        : [];
      return { program, matchedTerms };
    }).filter((match) => match.matchedTerms.length > 0);
    const best = [...matches].sort((a, b) => b.matchedTerms.length - a.matchedTerms.length)[0] ?? null;
    const application = latestApplication(id, applications);
    const budget = application
      ? budgets.find((row) => row.applicationId === application.id) ?? null
      : null;
    const award = awards.find((row) => text(row.opportunityId) === id || (application && text(row.applicationId) === application.id)) ?? null;
    const complianceRow = award ? compliance.find((row) => row.awardId === award.id) ?? null : null;
    const renewable = renewals.some((row) =>
      text(row.newOpportunityId) === id || (award && text(row.originalAwardId) === award.id),
    );
    const amountMin = finiteNumber(opportunity.amountMin);
    const amountMax = finiteNumber(opportunity.amountMax);
    const deadline = deadlineValue(opportunity.deadline);
    const eligibility = text(opportunity.eligibility);
    const approval = text(application?.founderApprovalStatus);
    const proposal = text(application?.status);
    const readyFlag = application?.readyToSubmit;
    const ready = readyFlag === 1 || readyFlag === true;
    const budgetAmount = finiteNumber(budget?.totalRequested);
    const budgetRecorded = Boolean(budget && (budget.hasLineItems || (budgetAmount != null && budgetAmount > 0)));
    const awardStatus = text(award?.status);
    const complianceStatus = text(complianceRow?.status);
    const workforceHit = matches.some((match) => barbersSlugs.has(match.program.slug));

    const attentionBecause: string[] = [];
    if (best) attentionBecause.push("Program match on the existing Barbers and workforce profile");
    if (workforceHit) attentionBecause.push("Barbers or workforce-development terms matched");
    if (deadline) attentionBecause.push("Deadline is stored");
    if (amountMin != null || amountMax != null) attentionBecause.push("Funding amount is stored");
    if (!application || !DECIDED_APPROVAL.has(approval)) attentionBecause.push("Founder approval is not a recorded decision");

    let priorityScore = 0;
    if (workforceHit) priorityScore += 40;
    else if (best) priorityScore += 15;
    if (!application || !DECIDED_APPROVAL.has(approval)) priorityScore += 25;
    const amount = amountMax ?? amountMin;
    if (amount != null && amount > 0) priorityScore += Math.min(30, Math.round(Math.log10(amount + 1) * 6));
    if (deadline) {
      const days = (Date.parse(deadline) - now.getTime()) / 86400000;
      if (Number.isFinite(days) && days >= 0 && days <= 180) priorityScore += Math.max(1, Math.round(30 - days / 6));
    }

    return {
      id,
      title: text(opportunity.title) || "Untitled opportunity",
      funder: text(opportunity.funder) || null,
      opportunityStatus: text(opportunity.status) || null,
      eligibility: eligibility ? available(eligibility) : unavailable<string>(),
      programMatch: best
        ? available({ slug: best.program.slug, label: best.program.label, matchedTerms: best.matchedTerms })
        : unavailable<{ slug: string; label: string; matchedTerms: string[] }>(),
      barbersWorkforceRelevant: haystack ? available(workforceHit) : unavailable<boolean>(),
      fundingAmount: amountMin == null && amountMax == null
        ? unavailable<{ min: number | null; max: number | null }>()
        : available({ min: amountMin, max: amountMax }),
      deadline: deadline ? available(deadline) : unavailable<string>(),
      renewable: renewable ? available(true as const) : unavailable<true>(),
      proposalStatus: proposal ? available(proposal) : unavailable<string>(),
      budgetStatus: budgetRecorded
        ? available({ state: "recorded" as const, totalRequested: budgetAmount != null && budgetAmount > 0 ? budgetAmount : null })
        : unavailable<{ state: "recorded"; totalRequested: number | null }>(),
      founderApprovalStatus: approval ? available(approval) : unavailable<string>(),
      submissionReadiness: ready ? available("ready" as const) : unavailable<"ready">(),
      awardStatus: awardStatus
        ? available({ status: awardStatus, amount: finiteNumber(award?.amount) })
        : unavailable<{ status: string; amount: number | null }>(),
      complianceStatus: complianceStatus ? available(complianceStatus) : unavailable<string>(),
      priorityScore,
      attentionBecause,
    } satisfies FounderFundingOpportunityView;
  });

  const ranked = [...opportunities].sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));

  return {
    readOnly: true,
    externalFetch: "not_called",
    submissionsExecuted: false,
    approvalsExecuted: false,
    generatedAt: now.toISOString(),
    matchProfile: programs.map((program) => ({ slug: program.slug, label: program.label })),
    libraryCount: ranked.length,
    priority: ranked.slice(0, 12),
    opportunities: ranked,
  };
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
}

function jsonList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  const raw = text(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => text(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function loadFounderFundingView(now = new Date()): Promise<FounderFundingView> {
  const db = await getDb();
  const [opportunityRows, applicationRows, budgetRows, awardRows, complianceRows, renewalRows] = await Promise.all([
    db.all("SELECT id, title, funder, description, amount_min, amount_max, status, deadline, requirements, division_slugs, program_areas, eligibility FROM grant_opportunities"),
    db.all("SELECT id, opportunity_id, status, founder_approval_status, ready_to_submit, updated_at FROM grant_applications"),
    db.all("SELECT application_id, total_requested, line_items FROM grant_proposal_budgets"),
    db.all("SELECT id, opportunity_id, application_id, amount, status FROM grant_awards"),
    db.all("SELECT award_id, status FROM grant_compliance"),
    db.all("SELECT original_award_id, new_opportunity_id, status FROM grant_renewals"),
  ]);

  return buildFounderFundingView({
    now: now.toISOString(),
    programs: founderFundingMatchPrograms(),
    opportunities: asRows(opportunityRows).map((row) => ({
      id: text(row.id),
      title: text(row.title),
      funder: text(row.funder),
      description: text(row.description),
      eligibility: text(row.eligibility),
      status: text(row.status),
      deadline: text(row.deadline),
      amountMin: finiteNumber(row.amount_min),
      amountMax: finiteNumber(row.amount_max),
      programAreas: jsonList(row.program_areas),
      divisionSlugs: jsonList(row.division_slugs),
      requirements: text(row.requirements),
    })),
    applications: asRows(applicationRows).map((row) => ({
      id: text(row.id),
      opportunityId: text(row.opportunity_id),
      status: text(row.status),
      founderApprovalStatus: text(row.founder_approval_status),
      readyToSubmit: finiteNumber(row.ready_to_submit),
      updatedAt: text(row.updated_at),
    })),
    budgets: asRows(budgetRows).map((row) => {
      const items = jsonList(row.line_items);
      return {
        applicationId: text(row.application_id),
        totalRequested: finiteNumber(row.total_requested),
        hasLineItems: items.length > 0 || (text(row.line_items).length > 2 && text(row.line_items) !== "[]"),
      };
    }),
    awards: asRows(awardRows).map((row) => ({
      id: text(row.id),
      opportunityId: text(row.opportunity_id),
      applicationId: text(row.application_id),
      amount: finiteNumber(row.amount),
      status: text(row.status),
    })),
    compliance: asRows(complianceRows).map((row) => ({
      awardId: text(row.award_id),
      status: text(row.status),
    })),
    renewals: asRows(renewalRows).map((row) => ({
      originalAwardId: text(row.original_award_id),
      newOpportunityId: text(row.new_opportunity_id),
      status: text(row.status),
    })),
  });
}
