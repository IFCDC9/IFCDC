import { createHash } from "node:crypto";
import { getDb } from "../db";
import { GRANT_FACT_KEYS, type GrantProfile, type GrantNoticeReview, type GrantEligibilityAssessment } from "../../shared/grantEligibility";
import { logHqAudit } from "./hqAuditLog";

const REQUIRED_FACTS = ["legalName", "taxStatus", "serviceArea", "programs"];
const FEATURES = ["multi_year", "renewable", "general_operating", "admin_costs"];
const MAX_REVIEW_AGE = 30 * 86400000;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function text(value: unknown, label: string, max = 6000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} is required (maximum ${max} characters).`);
  return value.trim();
}
function httpsUrl(value: unknown): string {
  const url = new URL(text(value, "Official notice URL", 2000));
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use an HTTPS official notice URL without credentials.");
  return url.href;
}
export function validateGrantProfile(input: unknown): Pick<GrantProfile, "facts"> {
  const data = input as Partial<GrantProfile>;
  if (!data || !Array.isArray(data.facts) || data.facts.length > GRANT_FACT_KEYS.length) throw new Error("Provide organization facts and their document references.");
  const seen = new Set<string>();
  const facts = data.facts.map((f) => {
    if (!f || !GRANT_FACT_KEYS.includes(f.key) || seen.has(f.key)) throw new Error("Unknown or duplicate organization fact.");
    seen.add(f.key);
    return { key: f.key, value: text(f.value, f.key), sourceRef: text(f.sourceRef, `${f.key} document reference`, 1000) };
  }).sort((a, b) => a.key.localeCompare(b.key));
  for (const key of REQUIRED_FACTS) if (!seen.has(key)) throw new Error(`Verify ${key} with a document reference first.`);
  return { facts };
}
export function validateNoticeReview(input: unknown, opportunity: Record<string, unknown>): GrantNoticeReview {
  const data = input as GrantNoticeReview;
  if (!data || data.completeNoticeReviewed !== true) throw new Error("Confirm review of the complete official notice, including all eligibility conditions.");
  const sourceUrl = httpsUrl(data.sourceUrl);
  const host = new URL(sourceUrl).hostname;
  const listingHost = (() => { try { return new URL(String(opportunity.url)).hostname; } catch { return ""; } })();
  const governmentHost = /(^|\.)(gov|mil)$/.test(host);
  if (String(opportunity.source_type) === "grants_gov" ? !governmentHost : host !== listingHost && !governmentHost) {
    throw new Error("Use the funder's listing domain or an official government notice URL.");
  }
  if (!["organization", "individual", "school"].includes(data.applicantType)) throw new Error("Choose who can receive this award.");
  if (!Array.isArray(data.criteria) || !data.criteria.length || data.criteria.length > 40) throw new Error("Record every eligibility condition (1–40 criteria).");
  const criteria = data.criteria.map((c) => {
    if (!c || !["met", "unmet", "unknown"].includes(c.result)) throw new Error("Choose met, unmet, or unknown for each condition.");
    return { requirement: text(c.requirement, "Eligibility condition", 2000), result: c.result,
      evidenceRef: c.result === "unknown" ? String(c.evidenceRef ?? "").slice(0, 1000) : text(c.evidenceRef, "Evidence or reason", 1000) };
  });
  const deadline = text(data.deadline, "Official deadline (YYYY-MM-DD or rolling)", 10);
  if (deadline !== "rolling" && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || new Date(`${deadline}T00:00:00Z`).toISOString().slice(0, 10) !== deadline)) throw new Error("Use a valid calendar deadline or rolling.");
  if (typeof data.componentAwardLimit !== "number" || !Number.isFinite(data.componentAwardLimit) || data.componentAwardLimit <= 0) throw new Error("Record a positive component-specific award limit from the official notice.");
  const amount = data.requestedAmount == null ? null : data.requestedAmount;
  if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)) throw new Error("Requested amount must be a positive number or blank.");
  if (amount !== null && amount > data.componentAwardLimit) throw new Error("Request exceeds the reviewed component-specific award limit.");
  if (amount !== null && Number(opportunity.amount_max) > 0 && amount > Number(opportunity.amount_max)) throw new Error("Request exceeds the listing maximum; verify the component-specific limit.");
  const features = data.fundingFeatures ?? [];
  if (!Array.isArray(features) || features.some((f) => !FEATURES.includes(f))) throw new Error("Unknown funding feature.");
  return { sourceUrl, sourceExcerpt: text(data.sourceExcerpt, "Official eligibility excerpt", 15000),
    component: text(data.component, "Funding component", 500), componentAwardLimit: data.componentAwardLimit, deadline, applicantType: data.applicantType,
    criteria, completeNoticeReviewed: true, requestedAmount: amount,
    budgetSourceRef: amount === null ? "" : text(data.budgetSourceRef, "Budget document reference", 1000),
    fundingFeatures: [...new Set(features)] };
}
export function opportunityFingerprint(opp: Record<string, unknown>): string {
  return hash([opp.id, opp.external_id, opp.title, opp.funder, opp.source_type, opp.url, opp.eligibility, opp.requirements, opp.description, opp.deadline, opp.amount_min, opp.amount_max, opp.geography, opp.status]);
}
export function assessEligibility(profile: GrantProfile | null, review: GrantEligibilityAssessment["review"], current: boolean, now = Date.now()): Pick<GrantEligibilityAssessment, "status" | "reasons" | "canDraft"> {
  const reasons: string[] = [];
  if (!profile) reasons.push("Confirm IFCDC's organization facts with supporting documents.");
  if (!review) reasons.push("Review the complete official notice and record all eligibility conditions.");
  if (review && !current) reasons.push("The opportunity or organization profile changed. Review eligibility again.");
  if (review && (!Number.isFinite(Date.parse(review.reviewedAt)) || now - Date.parse(review.reviewedAt) > MAX_REVIEW_AGE)) reasons.push("Eligibility review is older than 30 days; reconfirm the current notice.");
  if (review?.criteria.some((c) => c.result === "unknown")) reasons.push("Some eligibility conditions still need evidence.");
  const missed = review?.criteria.filter((c) => c.result === "unmet") ?? [];
  if (review && review.applicantType !== "organization") reasons.push("This award is for individuals or schools; research a student referral or eligible school partnership instead.");
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  if (review && review.deadline !== "rolling" && review.deadline < today) reasons.push("The reviewed application deadline has passed.");
  for (const c of missed) reasons.push(`Not met: ${c.requirement}`);
  const ineligible = current && review && (missed.length > 0 || review.applicantType !== "organization" || (review.deadline !== "rolling" && review.deadline < today));
  return { status: ineligible ? "ineligible" : reasons.length ? "needs_review" : "eligible", reasons,
    canDraft: !ineligible && reasons.length === 0 };
}
export async function ensureGrantEligibilityTables() {
  const db = await getDb();
  await db.exec(`CREATE TABLE IF NOT EXISTS grant_verified_profile (
    id TEXT PRIMARY KEY, profile_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS grant_notice_reviews (
    opportunity_id TEXT PRIMARY KEY, review_json TEXT NOT NULL, profile_hash TEXT NOT NULL, opportunity_hash TEXT NOT NULL);`);
  return db;
}
export async function getVerifiedGrantProfile(): Promise<GrantProfile | null> {
  const db = await ensureGrantEligibilityTables();
  const row = await db.get<{ profile_json: string }>("SELECT profile_json FROM grant_verified_profile WHERE id = 'ifcdc'");
  return row ? JSON.parse(row.profile_json) : null;
}
export async function saveVerifiedGrantProfile(input: unknown, actorEmail: string) {
  const data = validateGrantProfile(input);
  const profile: GrantProfile = { ...data, reviewedBy: actorEmail, reviewedAt: new Date().toISOString() };
  const db = await ensureGrantEligibilityTables();
  await db.run("INSERT INTO grant_verified_profile (id, profile_json) VALUES ('ifcdc', ?) ON CONFLICT(id) DO UPDATE SET profile_json = excluded.profile_json", JSON.stringify(profile));
  await logHqAudit({ action: "grant_profile_verified", entityType: "organization", entityId: "ifcdc", detail: `Document-backed facts: ${data.facts.map((f) => f.key).join(', ')}`, actorEmail });
  return profile;
}
export async function getOpportunityEligibility(opportunityId: string): Promise<GrantEligibilityAssessment> {
  const db = await ensureGrantEligibilityTables();
  const opp = await db.get<Record<string, unknown>>("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId);
  const profile = await getVerifiedGrantProfile();
  const row = await db.get<{ review_json: string; profile_hash: string; opportunity_hash: string }>("SELECT * FROM grant_notice_reviews WHERE opportunity_id = ?", opportunityId);
  const review = row ? JSON.parse(row.review_json) as GrantEligibilityAssessment["review"] : null;
  const current = Boolean(opp && row && row.profile_hash === hash(profile?.facts) && row.opportunity_hash === opportunityFingerprint(opp));
  const assessed = assessEligibility(profile, review, current);
  if (!opp) { assessed.status = "needs_review"; assessed.canDraft = false; assessed.reasons.push("Opportunity not found."); }
  if (opp && !["open", "active", "researching"].includes(String(opp.status))) { assessed.canDraft = false; assessed.status = "ineligible"; assessed.reasons.push("Opportunity is not open for applications."); }
  return { ...assessed, profile, review, opportunity: opp ? { id: opportunityId, title: String(opp.title), url: String(opp.url ?? ""), funder: String(opp.funder ?? ""), description: String(opp.description ?? "").slice(0, 15000) } : null };
}
export async function saveGrantNoticeReview(opportunityId: string, input: unknown, actorEmail: string) {
  const db = await ensureGrantEligibilityTables();
  const opp = await db.get<Record<string, unknown>>("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId);
  if (!opp) throw new Error("Opportunity not found.");
  const profile = await getVerifiedGrantProfile();
  if (!profile) throw new Error("Confirm the organization profile before reviewing eligibility.");
  const review = { ...validateNoticeReview(input, opp), reviewedBy: actorEmail, reviewedAt: new Date().toISOString() };
  await db.run(`INSERT INTO grant_notice_reviews (opportunity_id, review_json, profile_hash, opportunity_hash) VALUES (?, ?, ?, ?)
    ON CONFLICT(opportunity_id) DO UPDATE SET review_json = excluded.review_json, profile_hash = excluded.profile_hash, opportunity_hash = excluded.opportunity_hash`, opportunityId, JSON.stringify(review), hash(profile.facts), opportunityFingerprint(opp));
  await logHqAudit({ action: "grant_notice_reviewed", entityType: "grant_opportunity", entityId: opportunityId, detail: `${review.component}: ${review.criteria.length} criteria; ${review.sourceUrl}`, actorEmail });
  return getOpportunityEligibility(opportunityId);
}
export async function getApplicationEligibility(applicationId: string) {
  const db = await getDb();
  const app = await db.get<{ opportunity_id: string }>("SELECT opportunity_id FROM grant_applications WHERE id = ?", applicationId);
  if (!app?.opportunity_id) throw new Error("Link this application to a funding opportunity before drafting.");
  return getOpportunityEligibility(app.opportunity_id);
}
export async function assertGrantDraftEligibility(applicationId: string) {
  const assessment = await getApplicationEligibility(applicationId);
  if (!assessment.canDraft) throw new Error(`Eligibility review required: ${assessment.reasons.join(" ")}`);
  return assessment;
}

/** Approval needs a supported budget and resolved verification placeholders, beyond drafting eligibility. */
export async function grantApprovalEvidenceBlockers(applicationId: string): Promise<string[]> {
  const assessment = await getApplicationEligibility(applicationId);
  if (!assessment.canDraft) return assessment.reasons;
  const reasons: string[] = [];
  if (assessment.review?.requestedAmount == null) reasons.push("Verify a requested amount against the program budget before approval.");
  const db = await getDb();
  const app = await db.get<{ amount_requested: number | null }>("SELECT amount_requested FROM grant_applications WHERE id = ?", applicationId);
  if (assessment.review?.requestedAmount != null && Number(app?.amount_requested) !== assessment.review.requestedAmount) reasons.push("Application request must match the reviewed budget amount.");
  const sections = await db.all<{ content: string }[]>("SELECT content FROM grant_writer_sections WHERE application_id = ?", applicationId);
  if (!sections.length) reasons.push("Prepare and review the application narrative before approval.");
  if (sections.some((s) => /\[VERIFICATION NEEDED\b/i.test(s.content))) reasons.push("Resolve all verification placeholders before approval.");
  return reasons;
}

export function compareReviewedFunding(
  a: { eligibilityReview: GrantEligibilityAssessment; deadline?: unknown },
  b: { eligibilityReview: GrantEligibilityAssessment; deadline?: unknown },
): number {
  const rank = { eligible: 0, needs_review: 1, ineligible: 2 };
  const status = rank[a.eligibilityReview.status] - rank[b.eligibilityReview.status];
  if (status) return status;
  const features = (entry: typeof a) => entry.eligibilityReview.canDraft ? entry.eligibilityReview.review?.fundingFeatures.length ?? 0 : 0;
  return features(b) - features(a) || String(a.deadline ?? "9999").localeCompare(String(b.deadline ?? "9999"));
}
