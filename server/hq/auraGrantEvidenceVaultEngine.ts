/**
 * Phase 8A.4 — Grant Document Readiness & Evidence Vault.
 *
 * Matches opportunity requirements to verified HQ evidence only.
 * Does not invent documents, submit grants, or touch Twilio/SMS.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { ensureGrantTables, logGrantActivity } from "./grantsSchema";
import { IFCDC_ORG_PROFILE } from "./grantWriterEngine";
import type { ReadinessClass } from "./auraFundingAwardabilityEngine";

export type EvidenceMatchStatus =
  | "verified"
  | "needs_update"
  | "can_generate"
  | "missing"
  | "unavailable";

export type GapBucket =
  | "already_available"
  | "needs_updating"
  | "can_be_generated"
  | "founder_input_required"
  | "third_party_input_required"
  | "hard_blocker";

export type PilotRecommendation =
  | "pursue"
  | "pursue_with_conditions"
  | "founder_review"
  | "do_not_pursue";

type EvidenceCatalogEntry = {
  key: string;
  label: string;
  category: string;
  patterns: RegExp[];
  /** Always track for federal nonprofit applications (requirement to track — not a claim docs exist). */
  federalBaseline?: boolean;
  /** AURA/Application Factory can draft from verified HQ org data. */
  generatable?: boolean;
  /** Needs external party (auditor, partner, insurer, etc.). */
  thirdParty?: boolean;
  /** Env UEI counts as verified evidence when set. */
  envUei?: boolean;
};

export const EVIDENCE_TYPE_CATALOG: EvidenceCatalogEntry[] = [
  { key: "irs_501c3", label: "IRS 501(c)(3) determination letter", category: "registration", patterns: [/501\s*\(c\)\s*\(3\)/, /irs\s*determination/, /tax.?exempt/, /determination\s*letter/, /letter\s*947/, /public\s*charity/, /509\s*\(a\)/], federalBaseline: true },
  { key: "state_incorporation", label: "State nonprofit incorporation documents", category: "registration", patterns: [/incorporation/, /articles\s*of\s*incorporation/, /certificate\s*of\s*incorporation/, /state\s*nonprofit/, /cert\s*of\s*incor/], federalBaseline: true },
  { key: "sam_registration", label: "SAM.gov registration", category: "registration", patterns: [/sam\.?gov/, /sam\s*registration/, /system\s*for\s*award/], federalBaseline: true, envUei: true },
  { key: "uei", label: "UEI", category: "registration", patterns: [/\buei\b/, /unique\s*entity\s*identifier/], federalBaseline: true, envUei: true },
  { key: "cage", label: "CAGE information", category: "registration", patterns: [/\bcage\b/, /commercial\s*and\s*government\s*entity/], federalBaseline: true },
  { key: "grants_gov_account", label: "Grants.gov organization connectivity", category: "registration", patterns: [/grants\.gov/, /grants\s*gov\s*(account|workspace|registration)/], federalBaseline: false },
  { key: "bylaws", label: "Organizational bylaws", category: "governance", patterns: [/bylaws/, /by-laws/], federalBaseline: true },
  { key: "board_info", label: "Board information", category: "governance", patterns: [/board\s*(list|roster|members|of\s*directors)/], federalBaseline: true },
  { key: "org_chart", label: "Organizational chart", category: "governance", patterns: [/org(anizational)?\s*chart/], federalBaseline: true, generatable: true },
  { key: "insurance", label: "Insurance documentation", category: "compliance", patterns: [/insurance/, /certificate\s*of\s*liability/, /\bcoi\b/], federalBaseline: true, thirdParty: true },
  { key: "org_budget", label: "Organizational budget", category: "finance", patterns: [/organizational\s*budget/, /agency\s*budget/, /operating\s*budget/], federalBaseline: true },
  { key: "program_budget", label: "Program / project budget", category: "finance", patterns: [/program\s*budget/, /project\s*budget/, /budget\s*narrative/, /budget\s*justification/], federalBaseline: true, generatable: true },
  { key: "financial_statements", label: "Financial statements", category: "finance", patterns: [/financial\s*statement/, /profit\s*and\s*loss|\bp&l\b/, /balance\s*sheet/], federalBaseline: true },
  { key: "audit", label: "Audits / reviews", category: "finance", patterns: [/audit(ed)?\s*financial/, /single\s*audit/, /\ba-?133\b/, /independent\s*review/], thirdParty: true },
  { key: "banking", label: "Banking / payment information", category: "finance", patterns: [/bank(ing)?/, /ach\b/, /payment\s*info/, /w-?9\b/], federalBaseline: true, thirdParty: true },
  { key: "program_description", label: "Program descriptions", category: "program", patterns: [/program\s*description/, /project\s*description/, /program\s*narrative/], federalBaseline: true, generatable: true },
  { key: "needs_statement", label: "Needs statements", category: "program", patterns: [/need(s)?\s*statement/, /statement\s*of\s*need/], federalBaseline: true, generatable: true },
  { key: "logic_model", label: "Logic models", category: "program", patterns: [/logic\s*model/], generatable: true },
  { key: "outcomes", label: "Outcomes / performance measures", category: "program", patterns: [/outcome/, /evaluation\s*plan/, /performance\s*measure/], generatable: true },
  { key: "staffing_plan", label: "Staffing plans", category: "capacity", patterns: [/staffing/, /key\s*personnel/], generatable: true },
  { key: "resumes", label: "Employee resumes / bios", category: "capacity", patterns: [/resume/, /curriculum\s*vitae|\bcv\b/, /\bbios?\b/], thirdParty: true },
  { key: "policies", label: "Policies / procedures", category: "compliance", patterns: [/polic(y|ies)/, /procedures/], federalBaseline: true },
  { key: "conflict_of_interest", label: "Conflict-of-interest policy", category: "compliance", patterns: [/conflict\s*of\s*interest/], federalBaseline: true },
  { key: "procurement_policy", label: "Procurement policy", category: "compliance", patterns: [/procurement\s*polic/], federalBaseline: true },
  { key: "financial_controls", label: "Financial controls", category: "compliance", patterns: [/financial\s*control/, /fiscal\s*polic/, /internal\s*control/], federalBaseline: true },
  { key: "civil_rights", label: "Civil rights / equal opportunity", category: "compliance", patterns: [/civil\s*rights/, /equal\s*opportunity/, /\beeo\b/, /non-?discrimination/], federalBaseline: true },
  { key: "letters_of_support", label: "Letters of support", category: "partnership", patterns: [/letter(s)?\s*of\s*support/, /\blos\b/], thirdParty: true },
  { key: "partnership_agreements", label: "Partnership agreements", category: "partnership", patterns: [/partnership\s*agreement/], thirdParty: true },
  { key: "mou", label: "MOUs", category: "partnership", patterns: [/\bmou\b/, /memorandum\s*of\s*understanding/], thirdParty: true },
  { key: "matching_funds", label: "Matching-fund evidence", category: "finance", patterns: [/match(ing)?\s*fund/, /cost\s*share/, /in-?kind\s*commit/] },
  { key: "past_performance", label: "Past-performance evidence", category: "capacity", patterns: [/past\s*performance/, /prior\s*experience/, /track\s*record/] },
  { key: "previous_applications", label: "Previous grant applications", category: "capacity", patterns: [/previous\s*(grant\s*)?application/, /prior\s*proposal/] },
  { key: "previous_awards", label: "Previous grant awards", category: "capacity", patterns: [/previous\s*(grant\s*)?award/, /prior\s*award/] },
  { key: "certifications", label: "Certifications", category: "compliance", patterns: [/certification/, /assurances?/], thirdParty: true },
  { key: "sf424", label: "SF-424 / federal application forms", category: "forms", patterns: [/sf-?\s*424/, /application\s*for\s*federal\s*assistance/], generatable: true },
  { key: "lead_housing_capacity", label: "Lead-safe / healthy homes financing capacity", category: "capacity", patterns: [/lead[- ]?safe/, /healthy\s*homes/, /lead\s*abatement/, /housing\s*financ/] },
  { key: "other_grant_evidence", label: "Other grant-specific evidence", category: "other", patterns: [/attachment|supporting\s*document|required\s*document/] },
];

type VaultRow = {
  id: string;
  evidence_type: string;
  title: string;
  hq_document_id: string | null;
  grant_document_id: string | null;
  file_url: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  verification_status: string;
  source: string | null;
  program_slug: string | null;
  opportunity_id: string | null;
  last_reviewed_at: string | null;
  aura_confidence: number;
  founder_approved: number;
  notes: string | null;
  reusable: number;
  created_at: string;
  updated_at: string;
};

type RequirementDraft = {
  requirementKey: string;
  label: string;
  category: string;
  mandatory: boolean;
  sourceExcerpt: string | null;
  extractionSource: string;
  pageLimit: string | null;
  fileFormat: string | null;
  catalogKey?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

async function safeAll<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const db = await getDb();
  try {
    return ((await db.all(sql, ...params)) as T[]) || [];
  } catch {
    return [];
  }
}

async function safeGet<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  const db = await getDb();
  try {
    return (await db.get(sql, ...params)) as T | undefined;
  } catch {
    return undefined;
  }
}

function hasFileUrl(url: unknown): boolean {
  return typeof url === "string" && url.trim().length > 0;
}

function isExpired(expiration: string | null | undefined, asOf = Date.now()): boolean {
  if (!expiration) return false;
  const t = new Date(expiration).getTime();
  return Number.isFinite(t) && t < asOf;
}

function daysUntilDeadline(deadline: string | null | undefined): number | null {
  if (!deadline) return null;
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

function emitGrantDocEvent(opts: {
  title: string;
  detail: string;
  opportunityId?: string | null;
  severity?: "info" | "watch" | "high";
  grantDocEvent: string;
  metadata?: Record<string, unknown>;
}): void {
  void import("./auraOperationalEvents").then(({ emitAuraOperationalEventAsync }) =>
    emitAuraOperationalEventAsync({
      type: "grant_opportunity_updated",
      title: opts.title,
      detail: opts.detail,
      entityType: "grant_opportunity",
      entityId: opts.opportunityId ?? null,
      severity: opts.severity ?? "info",
      metadata: {
        phase8a4: true,
        grantDocEvent: opts.grantDocEvent,
        ...(opts.metadata || {}),
      },
    })
  );
}

function catalogByKey(key: string): EvidenceCatalogEntry | undefined {
  return EVIDENCE_TYPE_CATALOG.find((c) => c.key === key);
}

function inferEvidenceType(title: string, category: string): string {
  const blob = `${title} ${category}`.toLowerCase();
  for (const c of EVIDENCE_TYPE_CATALOG) {
    if (c.patterns.some((p) => p.test(blob))) return c.key;
  }
  return "other_grant_evidence";
}

function matchStatusToGap(
  status: EvidenceMatchStatus,
  catalog?: EvidenceCatalogEntry,
  mandatory = true
): GapBucket {
  if (status === "verified") return "already_available";
  if (status === "needs_update") return "needs_updating";
  if (status === "can_generate") return "can_be_generated";
  if (status === "unavailable" && mandatory) return "hard_blocker";
  if (catalog?.thirdParty) return "third_party_input_required";
  if (status === "missing") return "founder_input_required";
  return "hard_blocker";
}

function isIntegrationVerifiedSource(source: unknown): boolean {
  return (
    source === "env_uei"
    || source === "sam_gov_integration"
    || source === "grants_gov_integration"
  );
}

/** Authoritative HQ sources that may verify without a PDF file_url. */
function isAuthoritativeNonFileSource(source: unknown): boolean {
  return (
    isIntegrationVerifiedSource(source)
    || source === "knowledge_base"
    || source === "founder_verified_structured"
    || source === "hq_structured"
  );
}

function classifyEvidenceRow(
  row: Pick<VaultRow, "file_url" | "expiration_date" | "verification_status" | "evidence_type" | "source">
): EvidenceMatchStatus {
  const cat = catalogByKey(row.evidence_type);
  if (isAuthoritativeNonFileSource(row.source) && row.verification_status === "verified") {
    if (isExpired(row.expiration_date)) return "needs_update";
    return "verified";
  }
  if (cat?.envUei && IFCDC_ORG_PROFILE.samUei && row.source === "env_uei") {
    return "verified";
  }
  if (!hasFileUrl(row.file_url) && !isAuthoritativeNonFileSource(row.source)) {
    return "missing";
  }
  if (isExpired(row.expiration_date)) return "needs_update";
  if (row.verification_status === "needs_update") return "needs_update";
  return "verified";
}

async function upsertEvidence(record: {
  evidenceType: string;
  title: string;
  hqDocumentId?: string | null;
  grantDocumentId?: string | null;
  fileUrl?: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  verificationStatus: EvidenceMatchStatus;
  source: string;
  programSlug?: string | null;
  opportunityId?: string | null;
  notes?: string | null;
  auraConfidence?: number;
  reusable?: boolean;
}): Promise<string> {
  const db = await getDb();
  const now = nowIso();
  let existing: { id: string } | undefined;
  if (record.hqDocumentId) {
    existing = await db.get<{ id: string }>(
      `SELECT id FROM grant_evidence_records WHERE hq_document_id = ?`,
      record.hqDocumentId
    );
  } else if (record.grantDocumentId) {
    existing = await db.get<{ id: string }>(
      `SELECT id FROM grant_evidence_records WHERE grant_document_id = ?`,
      record.grantDocumentId
    );
  } else if (
    record.source === "env_uei"
    || record.source === "sam_gov_integration"
    || record.source === "grants_gov_integration"
    || record.source === "knowledge_base"
    || record.source === "founder_verified_structured"
    || record.source === "hq_structured"
  ) {
    existing = await db.get<{ id: string }>(
      `SELECT id FROM grant_evidence_records
       WHERE evidence_type = ?
         AND source IN (
           'env_uei', 'sam_gov_integration', 'grants_gov_integration',
           'knowledge_base', 'founder_verified_structured', 'hq_structured'
         )
       ORDER BY datetime(updated_at) DESC LIMIT 1`,
      record.evidenceType
    );
    if (!existing) {
      existing = await db.get<{ id: string }>(
        `SELECT id FROM grant_evidence_records WHERE evidence_type = ? AND reusable = 1
         ORDER BY datetime(updated_at) DESC LIMIT 1`,
        record.evidenceType
      );
    }
  }

  const id = existing?.id || newId();
  if (existing) {
    await db.run(
      `UPDATE grant_evidence_records SET
         evidence_type = ?, title = ?, file_url = ?, effective_date = ?, expiration_date = ?,
         verification_status = ?, source = ?, program_slug = COALESCE(?, program_slug),
         opportunity_id = COALESCE(?, opportunity_id), last_reviewed_at = ?,
         aura_confidence = ?, notes = COALESCE(?, notes), reusable = ?, updated_at = ?
       WHERE id = ?`,
      record.evidenceType,
      record.title,
      record.fileUrl ?? null,
      record.effectiveDate ?? null,
      record.expirationDate ?? null,
      record.verificationStatus,
      record.source,
      record.programSlug ?? null,
      record.opportunityId ?? null,
      now,
      record.auraConfidence ?? 0.85,
      record.notes ?? null,
      record.reusable === false ? 0 : 1,
      now,
      id
    );
  } else {
    await db.run(
      `INSERT INTO grant_evidence_records (
         id, evidence_type, title, hq_document_id, grant_document_id, file_url,
         effective_date, expiration_date, verification_status, source, program_slug,
         opportunity_id, last_reviewed_at, aura_confidence, founder_approved, notes,
         reusable, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      id,
      record.evidenceType,
      record.title,
      record.hqDocumentId ?? null,
      record.grantDocumentId ?? null,
      record.fileUrl ?? null,
      record.effectiveDate ?? null,
      record.expirationDate ?? null,
      record.verificationStatus,
      record.source,
      record.programSlug ?? null,
      record.opportunityId ?? null,
      now,
      record.auraConfidence ?? 0.85,
      record.notes ?? null,
      record.reusable === false ? 0 : 1,
      now,
      now
    );
  }
  return id;
}

/** Public upsert for integration-sourced reusable evidence (SAM.gov / Grants.gov). */
export async function upsertReusableIntegrationEvidence(record: {
  evidenceType: string;
  title: string;
  verificationStatus: EvidenceMatchStatus;
  source: "sam_gov_integration" | "grants_gov_integration" | "env_uei";
  effectiveDate?: string | null;
  expirationDate?: string | null;
  notes?: string | null;
  auraConfidence?: number;
}): Promise<string> {
  return upsertEvidence({
    evidenceType: record.evidenceType,
    title: record.title,
    verificationStatus: record.verificationStatus,
    source: record.source,
    effectiveDate: record.effectiveDate,
    expirationDate: record.expirationDate,
    notes: record.notes,
    auraConfidence: record.auraConfidence ?? 0.97,
    reusable: true,
  });
}

/** Upsert authoritative org evidence from Knowledge Base / Founder-verified structured facts. */
export async function upsertAuthoritativeOrgEvidence(record: {
  evidenceType: string;
  title: string;
  verificationStatus: EvidenceMatchStatus;
  source: "knowledge_base" | "founder_verified_structured" | "hq_structured";
  hqDocumentId?: string | null;
  fileUrl?: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  notes?: string | null;
  auraConfidence?: number;
}): Promise<string> {
  return upsertEvidence({
    evidenceType: record.evidenceType,
    title: record.title,
    hqDocumentId: record.hqDocumentId,
    fileUrl: record.fileUrl,
    verificationStatus: record.verificationStatus,
    source: record.source,
    effectiveDate: record.effectiveDate,
    expirationDate: record.expirationDate,
    notes: record.notes,
    auraConfidence: record.auraConfidence ?? 0.92,
    reusable: true,
  });
}

/** Sync Evidence Vault from hq_documents + grant_documents + SAM UEI env. Never invents files. */
export async function syncGrantEvidenceVault(opts?: {
  actorEmail?: string;
}): Promise<{ synced: number; verified: number; missingOnlySkipped: number; ueiSynced: boolean }> {
  await ensureGrantTables();
  let synced = 0;
  let verified = 0;
  let missingOnlySkipped = 0;
  let ueiSynced = false;

  const hqRows = await safeAll<{
    id: string;
    title: string;
    category: string;
    file_url: string | null;
    evidence_type: string | null;
    effective_date: string | null;
    expiration_date: string | null;
    verification_status: string | null;
  }>(
    `SELECT id, title, category, file_url, evidence_type, effective_date, expiration_date, verification_status
     FROM hq_documents ORDER BY datetime(updated_at) DESC LIMIT 500`
  );

  for (const doc of hqRows) {
    if (!hasFileUrl(doc.file_url)) {
      missingOnlySkipped++;
      continue;
    }
    const evidenceType = doc.evidence_type || inferEvidenceType(doc.title, doc.category || "");
    const status: EvidenceMatchStatus = isExpired(doc.expiration_date)
      ? "needs_update"
      : "verified";
    await upsertEvidence({
      evidenceType,
      title: doc.title,
      hqDocumentId: doc.id,
      fileUrl: doc.file_url,
      effectiveDate: doc.effective_date,
      expirationDate: doc.expiration_date,
      verificationStatus: status,
      source: "hq_documents",
      auraConfidence: 0.9,
    });
    synced++;
    if (status === "verified") verified++;
    if (status === "needs_update") {
      emitGrantDocEvent({
        title: "Document needs update",
        detail: `"${doc.title}" is expired or marked for refresh`,
        grantDocEvent: "document_needs_update",
        severity: "watch",
        metadata: { evidenceType, hqDocumentId: doc.id },
      });
    }
  }

  const grantDocs = await safeAll<{
    id: string;
    name: string;
    doc_type: string | null;
    doc_category: string | null;
    file_url: string | null;
    opportunity_id: string | null;
    effective_date: string | null;
    expiration_date: string | null;
  }>(
    `SELECT id, name, doc_type, doc_category, file_url, opportunity_id, effective_date, expiration_date
     FROM grant_documents
     WHERE file_url IS NOT NULL AND TRIM(file_url) != ''
     ORDER BY datetime(COALESCE(uploaded_at, created_at)) DESC LIMIT 500`
  );

  for (const doc of grantDocs) {
    if (!hasFileUrl(doc.file_url)) {
      missingOnlySkipped++;
      continue;
    }
    const evidenceType = inferEvidenceType(
      doc.name || "",
      `${doc.doc_category || ""} ${doc.doc_type || ""}`
    );
    const status: EvidenceMatchStatus = isExpired(doc.expiration_date) ? "needs_update" : "verified";
    await upsertEvidence({
      evidenceType,
      title: doc.name || doc.doc_type || "grant_document",
      grantDocumentId: doc.id,
      fileUrl: doc.file_url,
      effectiveDate: doc.effective_date,
      expirationDate: doc.expiration_date,
      verificationStatus: status,
      source: "grant_documents",
      opportunityId: doc.opportunity_id,
      auraConfidence: 0.88,
      reusable: !doc.opportunity_id,
    });
    synced++;
    if (status === "verified") verified++;
  }

  const uei = IFCDC_ORG_PROFILE.samUei;
  if (uei) {
    for (const key of ["sam_registration", "uei"] as const) {
      await upsertEvidence({
        evidenceType: key,
        title: key === "uei" ? `SAM.gov UEI ${uei}` : `SAM.gov registration (UEI ${uei})`,
        verificationStatus: "verified",
        source: "env_uei",
        notes: "Verified via SAM_GOV_UEI / IFCDC_SAM_UEI env — not a fabricated file",
        auraConfidence: 0.95,
        reusable: true,
      });
      synced++;
      verified++;
    }
    ueiSynced = true;
  }

  await logGrantActivity(
    "evidence_vault",
    "sync",
    "evidence_vault_synced",
    `synced=${synced} verified=${verified} skippedNoUrl=${missingOnlySkipped} uei=${ueiSynced}`,
    opts?.actorEmail
  );

  emitGrantDocEvent({
    title: "Evidence vault synced",
    detail: `Indexed ${synced} verified evidence records from HQ (no invented files)`,
    grantDocEvent: "document_uploaded_verified",
    metadata: { synced, verified, ueiSynced },
  });

  return { synced, verified, missingOnlySkipped, ueiSynced };
}

function extractPageLimit(text: string): string | null {
  const m = text.match(/(\d+)\s*(?:page|pages|word|words)\s*(?:limit|maximum|max)?/i);
  return m ? m[0] : null;
}

function extractFileFormat(text: string): string | null {
  const m = text.match(/\b(pdf|docx?|xlsx?|csv)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractRequirementsFromOpportunity(opp: Record<string, unknown>): RequirementDraft[] {
  const text = [
    opp.requirements,
    opp.required_documents_json,
    opp.application_instructions,
    opp.description,
    opp.eligibility,
  ]
    .filter(Boolean)
    .map(String)
    .join("\n");

  const lower = text.toLowerCase();
  const pageLimit = extractPageLimit(text);
  const fileFormat = extractFileFormat(text);
  const drafts: RequirementDraft[] = [];
  const seen = new Set<string>();

  const push = (d: RequirementDraft) => {
    if (seen.has(d.requirementKey)) return;
    seen.add(d.requirementKey);
    drafts.push(d);
  };

  // Federal nonprofit baseline — requirements to track, not claims that docs exist.
  for (const c of EVIDENCE_TYPE_CATALOG.filter((x) => x.federalBaseline)) {
    push({
      requirementKey: `baseline_${c.key}`,
      label: c.label,
      category: c.category,
      mandatory: true,
      sourceExcerpt: "Federal nonprofit baseline checklist (Phase 8A.4)",
      extractionSource: "federal_nonprofit_baseline",
      pageLimit: null,
      fileFormat: null,
      catalogKey: c.key,
    });
  }

  for (const c of EVIDENCE_TYPE_CATALOG) {
    if (c.federalBaseline) continue;
    const mentioned = c.patterns.some((p) => p.test(lower));
    if (!mentioned) continue;
    const excerpt =
      text.split(/[\n.;]/).find((line) => c.patterns.some((p) => p.test(line.toLowerCase())))
      || c.label;
    push({
      requirementKey: `opp_${c.key}`,
      label: c.label,
      category: c.category,
      mandatory: true,
      sourceExcerpt: String(excerpt).slice(0, 280),
      extractionSource: "opportunity_text",
      pageLimit,
      fileFormat,
      catalogKey: c.key,
    });
  }

  // Structural application components often named without matching a catalog key.
  const structural: Array<{ key: string; label: string; category: string; re: RegExp }> = [
    { key: "narrative", label: "Required narrative / proposal narrative", category: "forms", re: /narrative|project\s*description|proposal/i },
    { key: "submission_portal", label: "Submission portal requirements", category: "forms", re: /grants\.gov|workspace|submission\s*portal|apply\s*online/i },
    { key: "deadline", label: "Application deadline", category: "forms", re: /deadline|close\s*date|due\s*date/i },
    { key: "cost_share", label: "Match / cost-share evidence", category: "finance", re: /cost\s*shar|matching\s*fund|match\s*required/i },
  ];
  for (const s of structural) {
    if (!s.re.test(lower) && s.key !== "deadline") continue;
    if (s.key === "deadline" && !(opp.deadline || opp.close_date)) continue;
    push({
      requirementKey: `struct_${s.key}`,
      label: s.label,
      category: s.category,
      mandatory: true,
      sourceExcerpt: s.key === "deadline"
        ? String(opp.deadline || opp.close_date || "")
        : null,
      extractionSource: s.key === "deadline" ? "opportunity_fields" : "opportunity_text",
      pageLimit: s.key === "narrative" ? pageLimit : null,
      fileFormat,
      catalogKey:
        s.key === "narrative"
          ? "program_description"
          : s.key === "cost_share"
            ? "matching_funds"
            : undefined,
    });
  }

  return drafts;
}

async function loadVaultIndex(): Promise<VaultRow[]> {
  return safeAll<VaultRow>(
    `SELECT * FROM grant_evidence_records ORDER BY datetime(updated_at) DESC`
  );
}

function findBestEvidence(
  catalogKey: string | undefined,
  label: string,
  vault: VaultRow[]
): { row: VaultRow | null; status: EvidenceMatchStatus } {
  const cat = catalogKey ? catalogByKey(catalogKey) : undefined;
  const patterns = cat?.patterns?.length
    ? cat.patterns
    : [new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")];

  const candidates = vault.filter((v) => {
    if (catalogKey && v.evidence_type === catalogKey) return true;
    const blob = `${v.title} ${v.evidence_type} ${v.notes || ""}`.toLowerCase();
    return patterns.some((p) => p.test(blob));
  });

  // Prefer verified rows with real file_url or env UEI.
  const ranked = candidates
    .map((row) => ({ row, status: classifyEvidenceRow(row) }))
    .sort((a, b) => {
      const rank = (s: EvidenceMatchStatus) =>
        s === "verified" ? 0 : s === "needs_update" ? 1 : s === "can_generate" ? 2 : 3;
      return rank(a.status) - rank(b.status);
    });

  if (ranked[0] && (ranked[0].status === "verified" || ranked[0].status === "needs_update")) {
    return ranked[0];
  }

  if (cat?.envUei && IFCDC_ORG_PROFILE.samUei) {
    return { row: ranked[0]?.row ?? null, status: "verified" };
  }

  if (cat?.generatable) {
    return { row: ranked[0]?.row ?? null, status: "can_generate" };
  }

  // Structural narrative/deadline without catalog — generatable or informational.
  if (!catalogKey && /narrative|deadline|submission/i.test(label)) {
    if (/deadline|submission/i.test(label)) {
      return { row: null, status: "verified" }; // tracked field, not a missing file
    }
    return { row: null, status: "can_generate" };
  }

  if (cat?.thirdParty) {
    return { row: null, status: "missing" };
  }

  // Capacity specialties without evidence → unavailable (potential hard blocker).
  if (catalogKey === "lead_housing_capacity") {
    return { row: null, status: "unavailable" };
  }

  return { row: null, status: "missing" };
}

function computeEvidenceReadiness(opts: {
  eligibility: string;
  addressableStatus: string | null;
  matchRequired: boolean;
  deadline: string | null;
  hardBlockers: number;
  verifiedCore: number;
  coreRequired: number;
  needsUpdate: number;
  canGenerate: number;
  founderInput: number;
  thirdParty: number;
  missingMandatory: number;
  programMatchPct: number;
  priorReadinessScore?: number | null;
}): { readinessClass: ReadinessClass; readinessScore: number } {
  const days = daysUntilDeadline(opts.deadline);
  const deadlineOk = days == null || days >= 14;
  const deadlineFeasible = days == null || days >= 0;
  const eligOk =
    opts.eligibility === "eligible" || opts.eligibility === "possibly_eligible";
  const addressableOk =
    opts.addressableStatus === "verified"
    || opts.addressableStatus === "derived"
    || opts.addressableStatus === "partial";
  const registrationsOk = Boolean(IFCDC_ORG_PROFILE.samUei);
  const coreRatio = opts.coreRequired > 0 ? opts.verifiedCore / opts.coreRequired : 0;

  let score = Math.min(100, Math.round(
    (eligOk ? 18 : 4)
    + (addressableOk ? 14 : 4)
    + (registrationsOk ? 12 : 0)
    + Math.round(coreRatio * 28)
    + (opts.hardBlockers === 0 ? 10 : 0)
    + (deadlineOk ? 8 : deadlineFeasible ? 3 : 0)
    + Math.min(10, Math.round((opts.programMatchPct || 0) * 0.1))
  ));

  // Soft penalties
  score -= Math.min(15, opts.hardBlockers * 8);
  score -= Math.min(10, opts.missingMandatory * 2);
  score -= Math.min(6, opts.needsUpdate);
  score = Math.max(0, Math.min(100, score));

  let readinessClass: ReadinessClass = "review_required";

  if (opts.eligibility === "not_eligible" || !deadlineFeasible || opts.hardBlockers >= 3) {
    readinessClass = "not_ready";
  } else if (opts.matchRequired && opts.hardBlockers > 0) {
    readinessClass = "needs_matching_funds";
  } else if (
    eligOk
    && addressableOk
    && registrationsOk
    && opts.hardBlockers === 0
    && coreRatio >= 0.7
    && deadlineFeasible
    && opts.missingMandatory === 0
    && opts.founderInput === 0
    && opts.thirdParty === 0
  ) {
    // READY NOW: missing grant-specific materials only if can_generate.
    readinessClass = "ready_now";
  } else if (
    eligOk
    && addressableOk
    && registrationsOk
    && opts.hardBlockers === 0
    && coreRatio >= 0.5
    && deadlineFeasible
    && opts.missingMandatory <= 2
    && (opts.canGenerate > 0 || opts.needsUpdate > 0 || opts.founderInput <= 2)
  ) {
    readinessClass = "nearly_ready";
  } else if (opts.missingMandatory >= 2 || opts.founderInput + opts.thirdParty >= 3) {
    readinessClass = "needs_documents";
  } else if (opts.programMatchPct > 0 && opts.programMatchPct < 50) {
    readinessClass = "needs_program_development";
  } else if (opts.matchRequired) {
    readinessClass = "needs_matching_funds";
  } else if (!eligOk || !addressableOk) {
    readinessClass = "review_required";
  } else if (score < 40) {
    readinessClass = "not_ready";
  }

  if (opts.priorReadinessScore != null && Math.abs(opts.priorReadinessScore - score) > 40) {
    // Keep score grounded; prefer evidence-derived value.
  }

  return { readinessClass, readinessScore: score };
}

export async function runOpportunityDocumentReadiness(
  opportunityId: string,
  opts?: { actorEmail?: string; syncFirst?: boolean }
): Promise<Record<string, unknown>> {
  await ensureGrantTables();
  if (opts?.syncFirst !== false) {
    await syncGrantEvidenceVault({ actorEmail: opts?.actorEmail });
  }

  const db = await getDb();
  const opp = await db.get<Record<string, unknown>>(
    "SELECT * FROM grant_opportunities WHERE id = ?",
    opportunityId
  );
  if (!opp) throw new Error(`Opportunity not found: ${opportunityId}`);

  const vault = await loadVaultIndex();
  const requirements = extractRequirementsFromOpportunity(opp);
  const now = nowIso();

  const alreadyAvailable: Array<Record<string, unknown>> = [];
  const needsUpdating: Array<Record<string, unknown>> = [];
  const canGenerate: Array<Record<string, unknown>> = [];
  const founderInput: Array<Record<string, unknown>> = [];
  const thirdParty: Array<Record<string, unknown>> = [];
  const hardBlockers: Array<Record<string, unknown>> = [];

  let requirementsMet = 0;
  let hardBlockerCount = 0;
  let verifiedCore = 0;
  const coreKeys = new Set(
    EVIDENCE_TYPE_CATALOG.filter((c) => c.federalBaseline).map((c) => c.key)
  );

  for (const req of requirements) {
    const cat = req.catalogKey ? catalogByKey(req.catalogKey) : undefined;
    const match = findBestEvidence(req.catalogKey, req.label, vault);
    let status = match.status;
    // Env UEI only verifies registration keys — never invent other docs.
    if (
      status === "verified"
      && cat?.envUei
      && !IFCDC_ORG_PROFILE.samUei
      && !hasFileUrl(match.row?.file_url)
    ) {
      status = "missing";
    }
    if (
      status === "verified"
      && match.row
      && !hasFileUrl(match.row.file_url)
      && match.row.source !== "env_uei"
    ) {
      status = "missing";
    }

    const gap = matchStatusToGap(status, cat, req.mandatory);
    const reqId = newId();
    const evidenceId = match.row?.id ?? null;

    await db.run(
      `INSERT INTO grant_opportunity_requirements (
         id, opportunity_id, requirement_key, label, category, mandatory,
         source_excerpt, extraction_source, page_limit, file_format,
         match_status, evidence_record_id, gap_bucket, hard_blocker, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(opportunity_id, requirement_key) DO UPDATE SET
         label = excluded.label,
         category = excluded.category,
         mandatory = excluded.mandatory,
         source_excerpt = excluded.source_excerpt,
         extraction_source = excluded.extraction_source,
         page_limit = excluded.page_limit,
         file_format = excluded.file_format,
         match_status = excluded.match_status,
         evidence_record_id = excluded.evidence_record_id,
         gap_bucket = excluded.gap_bucket,
         hard_blocker = excluded.hard_blocker,
         notes = excluded.notes,
         updated_at = excluded.updated_at`,
      reqId,
      opportunityId,
      req.requirementKey,
      req.label,
      req.category,
      req.mandatory ? 1 : 0,
      req.sourceExcerpt,
      req.extractionSource,
      req.pageLimit,
      req.fileFormat,
      status,
      evidenceId,
      gap,
      gap === "hard_blocker" ? 1 : 0,
      null,
      now,
      now
    );

    const stored = await db.get<{ id: string }>(
      `SELECT id FROM grant_opportunity_requirements WHERE opportunity_id = ? AND requirement_key = ?`,
      opportunityId,
      req.requirementKey
    );
    const requirementId = stored?.id || reqId;

    if (evidenceId) {
      await db.run(
        `INSERT OR IGNORE INTO grant_requirement_evidence_links (
           id, requirement_id, evidence_record_id, opportunity_id, link_note, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        newId(),
        requirementId,
        evidenceId,
        opportunityId,
        `auto-match:${status}`,
        now
      );
    }

    const item = {
      requirementKey: req.requirementKey,
      label: req.label,
      status,
      gap,
      evidenceRecordId: evidenceId,
      evidenceTitle: match.row?.title ?? null,
    };

    if (gap === "already_available") {
      alreadyAvailable.push(item);
      requirementsMet++;
      if (req.catalogKey && coreKeys.has(req.catalogKey)) verifiedCore++;
    } else if (gap === "needs_updating") {
      needsUpdating.push(item);
    } else if (gap === "can_be_generated") {
      canGenerate.push(item);
      // Generatable materials count toward readiness path, not "met" until produced.
    } else if (gap === "founder_input_required") {
      founderInput.push(item);
    } else if (gap === "third_party_input_required") {
      thirdParty.push(item);
    } else if (gap === "hard_blocker") {
      hardBlockers.push(item);
      hardBlockerCount++;
    }
  }

  const coreRequired = requirements.filter(
    (r) => r.catalogKey && coreKeys.has(r.catalogKey)
  ).length;

  const { readinessClass, readinessScore } = computeEvidenceReadiness({
    eligibility: String(opp.eligibility_result || "insufficient_information"),
    addressableStatus: opp.addressable_status ? String(opp.addressable_status) : null,
    matchRequired: Number(opp.match_required || 0) === 1,
    deadline: opp.deadline ? String(opp.deadline) : opp.close_date ? String(opp.close_date) : null,
    hardBlockers: hardBlockerCount,
    verifiedCore,
    coreRequired: Math.max(1, coreRequired),
    needsUpdate: needsUpdating.length,
    canGenerate: canGenerate.length,
    founderInput: founderInput.length,
    thirdParty: thirdParty.length,
    missingMandatory: founderInput.length + thirdParty.length + hardBlockerCount,
    programMatchPct: Number(opp.best_program_match_pct || 0),
    priorReadinessScore: opp.application_readiness_score != null
      ? Number(opp.application_readiness_score)
      : null,
  });

  const gapReport = {
    already_available: alreadyAvailable,
    needs_updating: needsUpdating,
    can_be_generated: canGenerate,
    founder_input_required: founderInput,
    third_party_input_required: thirdParty,
    hard_blocker: hardBlockers,
    summary: {
      requirementCount: requirements.length,
      requirementsMet,
      hardBlockerCount,
      readinessClass,
      readinessScore,
    },
  };

  await db.run(
    `INSERT INTO grant_readiness_gap_reports (
       id, opportunity_id, available_json, needs_update_json, can_generate_json,
       founder_input_json, third_party_json, hard_blockers_json, summary_json,
       readiness_class, readiness_score, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    opportunityId,
    JSON.stringify(alreadyAvailable),
    JSON.stringify(needsUpdating),
    JSON.stringify(canGenerate),
    JSON.stringify(founderInput),
    JSON.stringify(thirdParty),
    JSON.stringify(hardBlockers),
    JSON.stringify(gapReport.summary),
    readinessClass,
    readinessScore,
    now
  );

  await db.run(
    `UPDATE grant_opportunities SET
       gap_report_json = ?,
       hard_blocker_count = ?,
       requirement_count = ?,
       requirements_met_count = ?,
       evidence_readiness_at = ?,
       application_readiness_score = ?,
       readiness_class = ?,
       document_gaps_json = ?,
       updated_at = ?
     WHERE id = ?`,
    JSON.stringify(gapReport),
    hardBlockerCount,
    requirements.length,
    requirementsMet,
    now,
    readinessScore,
    readinessClass,
    JSON.stringify({
      availableCount: alreadyAvailable.length,
      missingCount: founderInput.length + thirdParty.length + hardBlockers.length,
      canGenerateCount: canGenerate.length,
      needsUpdateCount: needsUpdating.length,
    }),
    now,
    opportunityId
  );

  await logGrantActivity(
    "opportunity",
    opportunityId,
    "document_readiness_8a4",
    `readiness=${readinessScore}/${readinessClass} met=${requirementsMet}/${requirements.length} blockers=${hardBlockerCount}`,
    opts?.actorEmail
  );

  if (hardBlockerCount > 0) {
    emitGrantDocEvent({
      title: "Hard blocker detected",
      detail: `${hardBlockerCount} hard blocker(s) on "${opp.title}"`,
      opportunityId,
      severity: "high",
      grantDocEvent: "hard_blocker_detected",
      metadata: { hardBlockerCount, readinessClass },
    });
  }
  if (founderInput.length > 0) {
    emitGrantDocEvent({
      title: "Founder input required",
      detail: `${founderInput.length} item(s) need Founder input for "${opp.title}"`,
      opportunityId,
      severity: "watch",
      grantDocEvent: "founder_input_required",
    });
  }
  if (readinessClass === "nearly_ready") {
    emitGrantDocEvent({
      title: "Grant nearly ready",
      detail: `"${opp.title}" moved to NEARLY READY (${readinessScore})`,
      opportunityId,
      grantDocEvent: "grant_nearly_ready",
      metadata: { readinessScore },
    });
  }
  if (readinessClass === "ready_now") {
    emitGrantDocEvent({
      title: "Grant ready now",
      detail: `"${opp.title}" is READY NOW (${readinessScore})`,
      opportunityId,
      grantDocEvent: "grant_ready_now",
      metadata: { readinessScore },
    });
  }

  return {
    opportunityId,
    title: opp.title,
    readinessClass,
    readinessScore,
    requirementCount: requirements.length,
    requirementsMet,
    hardBlockerCount,
    gapReport,
    officialSourceUrl: opp.url || null,
  };
}

export async function runDocumentReadinessBatch(opts?: {
  limit?: number;
  actorEmail?: string;
  onlyQualified?: boolean;
}): Promise<{
  processed: number;
  readyNow: number;
  nearlyReady: number;
  needsDocuments: number;
  hardBlockers: number;
  withHardBlockers: number;
  results: Array<Record<string, unknown>>;
  pilotAudit: Record<string, unknown>;
}> {
  await ensureGrantTables();
  await syncGrantEvidenceVault({ actorEmail: opts?.actorEmail });

  const limit = opts?.limit ?? 40;
  const onlyQualified = opts?.onlyQualified !== false;

  const rows = await safeAll<{ id: string }>(
    onlyQualified
      ? `SELECT id FROM grant_opportunities
         WHERE eligibility_result IN ('eligible', 'possibly_eligible')
           AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
         ORDER BY COALESCE(pilot_rank, 99), COALESCE(enriched_final_score, qualification_score, 0) DESC
         LIMIT ?`
      : `SELECT id FROM grant_opportunities
         WHERE (duplicate_of_id IS NULL OR duplicate_of_id = '')
         ORDER BY datetime(updated_at) DESC LIMIT ?`,
    limit
  );

  const results: Array<Record<string, unknown>> = [];
  let readyNow = 0;
  let nearlyReady = 0;
  let needsDocuments = 0;
  let hardBlockers = 0;
  let withHardBlockers = 0;

  for (const row of rows) {
    const r = await runOpportunityDocumentReadiness(row.id, {
      actorEmail: opts?.actorEmail,
      syncFirst: false,
    });
    results.push(r);
    if (r.readinessClass === "ready_now") readyNow++;
    else if (r.readinessClass === "nearly_ready") nearlyReady++;
    else if (r.readinessClass === "needs_documents") needsDocuments++;
    const hb = Number(r.hardBlockerCount || 0);
    hardBlockers += hb;
    if (hb > 0) withHardBlockers++;
  }

  let pilotAudit: Record<string, unknown> = {};
  try {
    pilotAudit = await deepAuditFirstPilot({
      actorEmail: opts?.actorEmail || "aura",
    });
  } catch (err) {
    pilotAudit = {
      skipped: true,
      error: err instanceof Error ? err.message : "pilot audit failed",
      maySubmit: false,
    };
  }

  await logGrantActivity(
    "system",
    "evidence_vault",
    "document_readiness_batch_8a4",
    `processed=${results.length} ready=${readyNow} nearly=${nearlyReady} needsDocs=${needsDocuments}`,
    opts?.actorEmail
  );

  return {
    processed: results.length,
    readyNow,
    nearlyReady,
    needsDocuments,
    hardBlockers,
    withHardBlockers,
    results,
    pilotAudit,
  };
}

function isLeadSafeTitle(title: string): boolean {
  return /lead[- ]?safe|healthy\s*homes\s*financ/i.test(title);
}

export async function deepAuditFirstPilot(opts: {
  actorEmail: string;
  opportunityId?: string;
}): Promise<Record<string, unknown>> {
  await ensureGrantTables();
  const db = await getDb();

  let opp: Record<string, unknown> | undefined;
  if (opts.opportunityId) {
    opp = await db.get<Record<string, unknown>>(
      "SELECT * FROM grant_opportunities WHERE id = ?",
      opts.opportunityId
    );
  } else {
    opp = await db.get<Record<string, unknown>>(
      `SELECT * FROM grant_opportunities
       WHERE eligibility_result IN ('eligible', 'possibly_eligible')
         AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
         AND COALESCE(pilot_audit_recommendation, '') != 'do_not_pursue'
         AND title NOT LIKE '%Lead-Safe%'
         AND title NOT LIKE '%Healthy Homes Financ%'
       ORDER BY
         CASE WHEN pilot_rank IS NOT NULL THEN pilot_rank ELSE 999 END,
         COALESCE(application_readiness_score, 0) DESC,
         COALESCE(enriched_final_score, qualification_score, 0) DESC
       LIMIT 1`
    );
  }
  if (!opp) {
    return {
      skipped: true,
      recommendation: "founder_review",
      rationale:
        "No eligible non-Lead-Safe / non-do_not_pursue opportunity available for pilot audit. "
        + "Run funding scan/awardability or selectNextPilotCandidates.",
      maySubmit: false,
    };
  }

  const opportunityId = String(opp.id);
  const title = String(opp.title || "");
  const readiness = await runOpportunityDocumentReadiness(opportunityId, {
    actorEmail: opts.actorEmail,
    syncFirst: true,
  });

  const blob = [
    opp.title,
    opp.description,
    opp.eligibility,
    opp.requirements,
    opp.application_instructions,
  ]
    .filter(Boolean)
    .map(String)
    .join(" ")
    .toLowerCase();

  const vault = await loadVaultIndex();
  const hasLeadEvidence = vault.some(
    (v) =>
      v.evidence_type === "lead_housing_capacity"
      && classifyEvidenceRow(v) === "verified"
      && (hasFileUrl(v.file_url) || v.source === "env_uei")
  );
  const leadMentioned = isLeadSafeTitle(title) || /lead[- ]?safe|healthy\s*homes|lead\s*abatement|housing\s*financ/i.test(blob);

  const findings: string[] = [
    `Applicant eligibility on file: ${opp.eligibility_result || "unknown"}`,
    `Addressable status: ${opp.addressable_status || "unknown"} (amount=${opp.ifcdc_addressable_amount ?? "n/a"})`,
    `Document readiness: ${readiness.readinessClass} (${readiness.readinessScore})`,
    `Hard blockers: ${readiness.hardBlockerCount}`,
    `Official source: ${opp.url || "n/a"}`,
  ];
  const riskFactors: string[] = [];

  if (Number(opp.match_required || 0) === 1) {
    riskFactors.push("Cost-share / matching funds required");
  }
  if (Number(readiness.hardBlockerCount || 0) > 0) {
    riskFactors.push("Unresolved hard document/capacity blockers");
  }

  let recommendation: PilotRecommendation = "founder_review";

  if (leadMentioned && !hasLeadEvidence) {
    findings.push(
      "IFCDC lacks verified lead-safe / healthy-homes financing capacity evidence in the Evidence Vault"
    );
    riskFactors.push(
      "Lead-safe / housing-finance demonstration capacity not evidenced — general 501(c)(3) eligibility is insufficient"
    );
    recommendation = "do_not_pursue";
  } else if (opp.eligibility_result === "not_eligible") {
    recommendation = "do_not_pursue";
    findings.push("Eligibility result is not_eligible");
  } else if (readiness.readinessClass === "ready_now") {
    recommendation = "pursue";
  } else if (readiness.readinessClass === "nearly_ready") {
    recommendation = "pursue_with_conditions";
  } else if (Number(readiness.hardBlockerCount || 0) >= 2) {
    recommendation = "do_not_pursue";
  } else {
    recommendation = "founder_review";
  }

  const now = nowIso();
  await db.run(
    `INSERT INTO grant_pilot_capacity_audits (
       id, opportunity_id, recommendation, findings_json, risk_factors_json,
       official_source_url, actor_email, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    opportunityId,
    recommendation,
    JSON.stringify(findings),
    JSON.stringify(riskFactors),
    opp.url ? String(opp.url) : null,
    opts.actorEmail,
    now
  );

  await db.run(
    `UPDATE grant_opportunities SET pilot_audit_recommendation = ?, updated_at = ? WHERE id = ?`,
    recommendation,
    now,
    opportunityId
  );

  let alternate: Record<string, unknown> | null = null;
  if (recommendation === "do_not_pursue") {
    const next = await db.get<Record<string, unknown>>(
      `SELECT id, title, funder, url, eligibility_result, application_readiness_score,
              readiness_class, ifcdc_addressable_amount, enriched_final_score, qualification_score
       FROM grant_opportunities
       WHERE id != ?
         AND eligibility_result IN ('eligible', 'possibly_eligible')
         AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
         AND LOWER(COALESCE(title, '')) NOT LIKE '%lead-safe%'
         AND LOWER(COALESCE(title, '')) NOT LIKE '%lead safe%'
         AND LOWER(COALESCE(title, '')) NOT LIKE '%healthy homes financ%'
       ORDER BY
         CASE readiness_class
           WHEN 'ready_now' THEN 0
           WHEN 'nearly_ready' THEN 1
           WHEN 'needs_documents' THEN 2
           ELSE 3
         END,
         COALESCE(application_readiness_score, 0) DESC,
         COALESCE(enriched_final_score, qualification_score, 0) DESC
       LIMIT 1`,
      opportunityId
    );
    if (next) {
      alternate = next;
      await db.run(`UPDATE grant_opportunities SET pilot_rank = NULL WHERE pilot_rank IS NOT NULL`);
      await db.run(`UPDATE grant_opportunities SET pilot_rank = 1 WHERE id = ?`, next.id);
      await db.run(`UPDATE grant_opportunities SET pilot_rank = 99 WHERE id = ?`, opportunityId);
    }
  }

  emitGrantDocEvent({
    title:
      recommendation === "do_not_pursue"
        ? "Pilot opportunity rejected internally"
        : "Pilot opportunity audited",
    detail: `"${title}" → ${recommendation}${alternate ? `; promote alternate "${alternate.title}"` : ""}`,
    opportunityId,
    severity: recommendation === "do_not_pursue" ? "watch" : "info",
    grantDocEvent:
      recommendation === "do_not_pursue" ? "pilot_rejected_internally" : "pilot_audited",
    metadata: { recommendation, alternateId: alternate?.id ?? null },
  });

  await logGrantActivity(
    "opportunity",
    opportunityId,
    "pilot_capacity_audit_8a4",
    `${recommendation}${alternate ? ` → alternate=${alternate.id}` : ""}`,
    opts.actorEmail
  );

  return {
    opportunityId,
    title,
    recommendation,
    findings,
    riskFactors,
    readiness,
    officialSourceUrl: opp.url || null,
    alternatePilot: alternate,
    note: "Audit only — no submission. Founder approval still required before Application Factory.",
  };
}

export async function listEvidenceVault(opts?: {
  evidenceType?: string;
  verificationStatus?: string;
  limit?: number;
}): Promise<VaultRow[]> {
  await ensureGrantTables();
  const limit = opts?.limit ?? 200;
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts?.evidenceType) {
    clauses.push("evidence_type = ?");
    params.push(opts.evidenceType);
  }
  if (opts?.verificationStatus) {
    clauses.push("verification_status = ?");
    params.push(opts.verificationStatus);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  return safeAll<VaultRow>(
    `SELECT * FROM grant_evidence_records ${where}
     ORDER BY datetime(updated_at) DESC LIMIT ?`,
    ...params
  );
}

export async function getOpportunityRequirementChecklist(
  opportunityId: string
): Promise<{
  opportunityId: string;
  requirements: Array<Record<string, unknown>>;
  gapReport: Record<string, unknown> | null;
}> {
  await ensureGrantTables();
  const requirements = await safeAll<Record<string, unknown>>(
    `SELECT * FROM grant_opportunity_requirements
     WHERE opportunity_id = ?
     ORDER BY hard_blocker DESC, category, label`,
    opportunityId
  );

  const opp = await safeGet<{ gap_report_json: string | null }>(
    `SELECT gap_report_json FROM grant_opportunities WHERE id = ?`,
    opportunityId
  );
  let gapReport: Record<string, unknown> | null = null;
  try {
    gapReport = opp?.gap_report_json ? JSON.parse(opp.gap_report_json) : null;
  } catch {
    gapReport = null;
  }

  return { opportunityId, requirements, gapReport };
}

export async function buildEvidenceVaultMetrics(): Promise<Record<string, unknown>> {
  await ensureGrantTables();

  const counts = await safeGet<{
    ready_now: number;
    nearly_ready: number;
    needs_documents: number;
    hard_blocker_opps: number;
    ready_now_funding: number;
    nearly_ready_funding: number;
    needs_docs_funding: number;
  }>(
    `SELECT
       SUM(CASE WHEN readiness_class = 'ready_now' THEN 1 ELSE 0 END) as ready_now,
       SUM(CASE WHEN readiness_class = 'nearly_ready' THEN 1 ELSE 0 END) as nearly_ready,
       SUM(CASE WHEN readiness_class = 'needs_documents' THEN 1 ELSE 0 END) as needs_documents,
       SUM(CASE WHEN COALESCE(hard_blocker_count, 0) > 0 THEN 1 ELSE 0 END) as hard_blocker_opps,
       SUM(CASE WHEN readiness_class = 'ready_now' THEN COALESCE(ifcdc_addressable_amount, 0) ELSE 0 END) as ready_now_funding,
       SUM(CASE WHEN readiness_class = 'nearly_ready' THEN COALESCE(ifcdc_addressable_amount, 0) ELSE 0 END) as nearly_ready_funding,
       SUM(CASE WHEN readiness_class = 'needs_documents' THEN COALESCE(ifcdc_addressable_amount, 0) ELSE 0 END) as needs_docs_funding
     FROM grant_opportunities
     WHERE eligibility_result IN ('eligible', 'possibly_eligible')
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')`
  );

  const vaultStats = await safeGet<{ total: number; verified: number; expiring: number }>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified,
       SUM(CASE WHEN expiration_date IS NOT NULL AND date(expiration_date) <= date('now', '+60 days') THEN 1 ELSE 0 END) as expiring
     FROM grant_evidence_records`
  );

  const topBlockers = await safeAll<{ requirement_key: string; label: string; c: number }>(
    `SELECT requirement_key, label, COUNT(*) as c
     FROM grant_opportunity_requirements
     WHERE gap_bucket IN ('hard_blocker', 'founder_input_required', 'third_party_input_required')
        OR match_status IN ('missing', 'unavailable')
     GROUP BY requirement_key, label
     ORDER BY c DESC
     LIMIT 10`
  );

  const founderActions = await safeAll<Record<string, unknown>>(
    `SELECT opportunity_id, requirement_key, label, gap_bucket, match_status
     FROM grant_opportunity_requirements
     WHERE gap_bucket = 'founder_input_required'
     ORDER BY updated_at DESC LIMIT 25`
  );

  const pilot = await safeGet<Record<string, unknown>>(
    `SELECT id, title, readiness_class, application_readiness_score, pilot_audit_recommendation,
            ifcdc_addressable_amount, url, hard_blocker_count
     FROM grant_opportunities
     WHERE pilot_rank = 1
     LIMIT 1`
  );

  const next3 = await safeAll<Record<string, unknown>>(
    `SELECT id, title, readiness_class, application_readiness_score, ifcdc_addressable_amount, url
     FROM grant_opportunities
     WHERE eligibility_result IN ('eligible', 'possibly_eligible')
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
       AND COALESCE(readiness_class, '') NOT IN ('not_ready')
     ORDER BY
       CASE readiness_class
         WHEN 'ready_now' THEN 0
         WHEN 'nearly_ready' THEN 1
         WHEN 'needs_documents' THEN 2
         ELSE 3
       END,
       COALESCE(application_readiness_score, 0) DESC
     LIMIT 3`
  );

  return {
    phase: "8A.4",
    readyNowCount: counts?.ready_now ?? 0,
    nearlyReadyCount: counts?.nearly_ready ?? 0,
    needsDocumentsCount: counts?.needs_documents ?? 0,
    opportunitiesWithHardBlockers: counts?.hard_blocker_opps ?? 0,
    applicationReadyFunding: counts?.ready_now_funding ?? 0,
    nearlyReadyFunding: counts?.nearly_ready_funding ?? 0,
    missingDocumentFunding: counts?.needs_docs_funding ?? 0,
    evidenceRecords: vaultStats?.total ?? 0,
    verifiedEvidence: vaultStats?.verified ?? 0,
    documentsApproachingExpiration: vaultStats?.expiring ?? 0,
    mostCommonBlockers: topBlockers,
    founderActionItems: founderActions,
    firstPilot: pilot || null,
    nextApplicationCandidates: next3,
    samUeiConfigured: Boolean(IFCDC_ORG_PROFILE.samUei),
  };
}
