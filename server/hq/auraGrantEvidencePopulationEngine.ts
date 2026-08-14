/**
 * Phase 8A.5 — Grant Evidence Population & Next-Pilot Selection.
 *
 * Audits HQ evidence, builds Founder action queues, snapshots verified org
 * grant profile fields, rematches readiness after verification, and selects
 * the next Top-5 pilots (Lead-Safe / Healthy Homes Financing excluded).
 *
 * Does not invent documents, submit grants, or touch Twilio/SMS.
 * Banking evidence is status-only (present/missing) — never file contents or account numbers.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { ensureGrantTables, logGrantActivity } from "./grantsSchema";
import { IFCDC_ORG_PROFILE } from "./grantWriterEngine";
import { IFCDC_FUNDING_DIVISIONS } from "./grantFundingEngine";
import {
  EVIDENCE_TYPE_CATALOG,
  syncGrantEvidenceVault,
  runOpportunityDocumentReadiness,
  runDocumentReadinessBatch,
  listEvidenceVault,
  buildEvidenceVaultMetrics,
  type EvidenceMatchStatus,
} from "./auraGrantEvidenceVaultEngine";

const LEAD_SAFE_TITLE_RE = /lead[- ]?safe|healthy\s*homes\s*financ/i;
const ORG_PROFILE_ROW_ID = "current";
const EXPIRING_WITHIN_DAYS = 90;
const REMATCH_LIMIT = 40;

type Priority = "critical" | "high" | "medium" | "low";

type HqDocHit = { id: string; title: string; category: string };

type SafeVaultView = {
  id: string;
  evidence_type: string;
  title: string;
  hq_document_id: string | null;
  grant_document_id: string | null;
  verification_status: string;
  source: string | null;
  expiration_date: string | null;
  effective_date: string | null;
  program_slug: string | null;
  opportunity_id: string | null;
  bankingStatus?: "present" | "missing";
  filePresent?: boolean;
};

type EvidenceAuditItem = {
  evidenceType: string;
  label: string;
  category: string;
  status: EvidenceMatchStatus;
  hqDocuments: HqDocHit[];
  vaultRecord: SafeVaultView | null;
  existsElsewhereInHq: boolean;
  canAuraGenerate: boolean;
  thirdPartyRequired: boolean;
  federalBaseline: boolean;
};

type FounderQueueItem = {
  evidenceType: string;
  label: string;
  whyNeeded: string;
  opportunitiesBlocked: number;
  addressableValueBlocked: number;
  existsElsewhereInHq: boolean;
  canAuraGenerate: boolean;
  founderMustUpload: boolean;
  thirdPartyRequired: boolean;
  priority: Priority;
};

type PilotCandidate = {
  id: string;
  title: string;
  funder: string | null;
  url: string | null;
  eligibility_result: string | null;
  readiness_class: string | null;
  application_readiness_score: number | null;
  ifcdc_addressable_amount: number | null;
  best_program_slug: string | null;
  best_program_match_pct: number | null;
  enriched_final_score: number | null;
  qualification_score: number | null;
  deadline: string | null;
  hard_blocker_count: number | null;
  pilot_audit_recommendation: string | null;
  pilotScore: number;
  pilot_rank: number;
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

async function safeRun(sql: string, ...params: unknown[]): Promise<void> {
  const db = await getDb();
  try {
    await db.run(sql, ...params);
  } catch {
    /* column/table race or missing — ignore */
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

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

function isLeadSafeTitle(title: string): boolean {
  return LEAD_SAFE_TITLE_RE.test(title);
}

function catalogEntry(key: string) {
  return EVIDENCE_TYPE_CATALOG.find((c) => c.key === key);
}

function emitPhase8A5Event(opts: {
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
        phase8a5: true,
        grantDocEvent: opts.grantDocEvent,
        ...(opts.metadata || {}),
      },
    })
  );
}

/** Strip secrets / banking payloads from vault rows exposed to APIs. */
function sanitizeVaultRecord(row: Record<string, unknown> | null | undefined): SafeVaultView | null {
  if (!row) return null;
  const evidenceType = String(row.evidence_type || "");
  const base: SafeVaultView = {
    id: String(row.id),
    evidence_type: evidenceType,
    title: String(row.title || ""),
    hq_document_id: row.hq_document_id ? String(row.hq_document_id) : null,
    grant_document_id: row.grant_document_id ? String(row.grant_document_id) : null,
    verification_status: String(row.verification_status || "missing"),
    source: row.source ? String(row.source) : null,
    expiration_date: row.expiration_date ? String(row.expiration_date) : null,
    effective_date: row.effective_date ? String(row.effective_date) : null,
    program_slug: row.program_slug ? String(row.program_slug) : null,
    opportunity_id: row.opportunity_id ? String(row.opportunity_id) : null,
    filePresent: hasFileUrl(row.file_url),
  };
  if (evidenceType === "banking") {
    return {
      ...base,
      bankingStatus: hasFileUrl(row.file_url) || base.verification_status === "verified"
        ? "present"
        : "missing",
      filePresent: undefined,
    };
  }
  return base;
}

function classifyCatalogStatus(opts: {
  vault: Record<string, unknown> | null;
  hqHitsWithFile: number;
  catalog: (typeof EVIDENCE_TYPE_CATALOG)[number];
}): EvidenceMatchStatus {
  const { vault, hqHitsWithFile, catalog } = opts;
  if (catalog.envUei && IFCDC_ORG_PROFILE.samUei) return "verified";
  if (vault) {
    const status = String(vault.verification_status || "");
    if (status === "needs_update" || isExpired(vault.expiration_date as string | null)) {
      return "needs_update";
    }
    if (status === "verified" && (hasFileUrl(vault.file_url) || vault.source === "env_uei")) {
      return "verified";
    }
    if (hasFileUrl(vault.file_url) && isExpired(vault.expiration_date as string | null)) {
      return "needs_update";
    }
    if (hasFileUrl(vault.file_url)) return "verified";
  }
  if (hqHitsWithFile > 0) return "needs_update";
  if (catalog.generatable) return "can_generate";
  if (catalog.key === "lead_housing_capacity") return "unavailable";
  return "missing";
}

function priorityFromImpact(blocked: number, addressable: number): Priority {
  if (blocked >= 8 || addressable >= 500_000) return "critical";
  if (blocked >= 4 || addressable >= 150_000) return "high";
  if (blocked >= 2 || addressable >= 50_000) return "medium";
  return "low";
}

function scorePilot(opp: Record<string, unknown>): number {
  const eligibility =
    opp.eligibility_result === "eligible"
      ? 30
      : opp.eligibility_result === "possibly_eligible"
        ? 18
        : 0;
  const programFit = Math.min(25, Number(opp.best_program_match_pct || 0) * 0.25);
  const addr = Number(opp.ifcdc_addressable_amount || 0);
  const addressable = addr > 0 ? Math.min(20, Math.log10(addr + 1) * 4) : 0;
  const readinessMap: Record<string, number> = {
    ready_now: 20,
    nearly_ready: 14,
    needs_documents: 8,
    needs_program_development: 4,
    needs_matching_funds: 4,
    review_required: 3,
    not_ready: 0,
  };
  const readiness = readinessMap[String(opp.readiness_class || "")] ?? 2;
  const docsScore = Math.min(
    10,
    Math.max(0, Number(opp.application_readiness_score || 0) / 10)
  );
  const days = daysUntil((opp.deadline || opp.close_date) as string | null);
  let deadline = 5;
  if (days != null) {
    if (days < 0) deadline = 0;
    else if (days <= 21) deadline = 10;
    else if (days <= 60) deadline = 8;
    else if (days <= 120) deadline = 6;
    else deadline = 4;
  }
  const match = Math.min(10, Number(opp.enriched_final_score || opp.qualification_score || 0) / 10);
  const hard = Number(opp.hard_blocker_count || 0);
  const capacityRealism = hard >= 3 ? 0 : hard === 2 ? 2 : hard === 1 ? 5 : 8;
  const auditPenalty =
    String(opp.pilot_audit_recommendation || "") === "do_not_pursue" ? -100 : 0;
  return (
    eligibility
    + programFit
    + addressable
    + readiness
    + docsScore
    + deadline
    + match
    + capacityRealism
    + auditPenalty
  );
}

function requirementKeysForEvidence(evidenceType: string): string[] {
  return [
    evidenceType,
    `baseline_${evidenceType}`,
    `opp_${evidenceType}`,
    `%${evidenceType}%`,
  ];
}

/** Verified federal-baseline catalog types / federalBaseline count. */
export async function getEvidenceCompletionPercent(): Promise<{
  verifiedBaseline: number;
  federalBaseline: number;
  percent: number;
}> {
  await ensureGrantTables();
  const baseline = EVIDENCE_TYPE_CATALOG.filter((c) => c.federalBaseline);
  const vault = await listEvidenceVault({ limit: 500 });
  let verifiedBaseline = 0;
  for (const c of baseline) {
    if (c.envUei && IFCDC_ORG_PROFILE.samUei) {
      verifiedBaseline++;
      continue;
    }
    const row = vault.find((v) => v.evidence_type === c.key);
    if (
      row
      && row.verification_status === "verified"
      && (hasFileUrl(row.file_url) || row.source === "env_uei")
      && !isExpired(row.expiration_date)
    ) {
      verifiedBaseline++;
    }
  }
  const federalBaseline = baseline.length || 1;
  return {
    verifiedBaseline,
    federalBaseline,
    percent: Math.round((verifiedBaseline / federalBaseline) * 100),
  };
}

export async function auditExistingHqEvidence(opts?: {
  actorEmail?: string;
}): Promise<{
  synced: Record<string, unknown>;
  items: EvidenceAuditItem[];
  completion: Awaited<ReturnType<typeof getEvidenceCompletionPercent>>;
}> {
  await ensureGrantTables();
  const synced = await syncGrantEvidenceVault({ actorEmail: opts?.actorEmail });
  const vault = await listEvidenceVault({ limit: 500 });

  const hqDocs = await safeAll<{
    id: string;
    title: string;
    category: string;
    file_url: string | null;
    evidence_type: string | null;
  }>(
    `SELECT id, title, category, file_url, evidence_type
     FROM hq_documents ORDER BY datetime(updated_at) DESC LIMIT 500`
  );

  const items: EvidenceAuditItem[] = [];
  for (const cat of EVIDENCE_TYPE_CATALOG) {
    const patterns = cat.patterns;
    const hqHits: HqDocHit[] = [];
    let hqHitsWithFile = 0;
    for (const doc of hqDocs) {
      const blob = `${doc.title} ${doc.category || ""} ${doc.evidence_type || ""}`.toLowerCase();
      const typed = doc.evidence_type === cat.key;
      const matched = typed || patterns.some((p) => p.test(blob));
      if (!matched) continue;
      hqHits.push({ id: doc.id, title: doc.title, category: doc.category || "" });
      if (hasFileUrl(doc.file_url)) hqHitsWithFile++;
    }

    const vaultRow =
      vault.find((v) => v.evidence_type === cat.key && v.verification_status === "verified")
      || vault.find((v) => v.evidence_type === cat.key)
      || null;

    const status = classifyCatalogStatus({
      vault: vaultRow as unknown as Record<string, unknown> | null,
      hqHitsWithFile,
      catalog: cat,
    });

    items.push({
      evidenceType: cat.key,
      label: cat.label,
      category: cat.category,
      status,
      hqDocuments: hqHits.slice(0, 20),
      vaultRecord: sanitizeVaultRecord(vaultRow as unknown as Record<string, unknown>),
      existsElsewhereInHq: hqHits.length > 0,
      canAuraGenerate: Boolean(cat.generatable),
      thirdPartyRequired: Boolean(cat.thirdParty),
      federalBaseline: Boolean(cat.federalBaseline),
    });
  }

  const completion = await getEvidenceCompletionPercent();
  await logGrantActivity(
    "system",
    "evidence_population",
    "hq_evidence_audit_8a5",
    `catalog=${items.length} verified=${items.filter((i) => i.status === "verified").length} completion=${completion.percent}%`,
    opts?.actorEmail
  );

  return { synced, items, completion };
}

export async function buildFounderEvidenceActionQueue(opts?: {
  audit?: EvidenceAuditItem[];
}): Promise<FounderQueueItem[]> {
  await ensureGrantTables();
  const audit =
    opts?.audit
    ?? (await auditExistingHqEvidence()).items;

  const actionable = audit.filter((a) =>
    a.status === "missing"
    || a.status === "unavailable"
    || a.status === "needs_update"
  );

  const queue: FounderQueueItem[] = [];
  for (const item of actionable) {
    const blocked = await safeAll<{
      opportunity_id: string;
      ifcdc_addressable_amount: number | null;
    }>(
      `SELECT DISTINCT r.opportunity_id, o.ifcdc_addressable_amount
       FROM grant_opportunity_requirements r
       JOIN grant_opportunities o ON o.id = r.opportunity_id
       WHERE (
         r.requirement_key LIKE ?
         OR r.requirement_key = ?
         OR r.requirement_key = ?
         OR r.label LIKE ?
       )
       AND (
         r.match_status IN ('missing', 'unavailable', 'needs_update')
         OR r.gap_bucket IN (
           'founder_input_required', 'hard_blocker', 'third_party_input_required', 'needs_updating'
         )
       )
       AND o.eligibility_result IN ('eligible', 'possibly_eligible')
       AND (o.duplicate_of_id IS NULL OR o.duplicate_of_id = '')`,
      `%${item.evidenceType}%`,
      `baseline_${item.evidenceType}`,
      `opp_${item.evidenceType}`,
      `%${item.label.slice(0, 40)}%`
    );

    const opportunitiesBlocked = blocked.length;
    const addressableValueBlocked = blocked.reduce(
      (sum, b) => sum + (Number(b.ifcdc_addressable_amount) || 0),
      0
    );

    const whyNeeded =
      opportunitiesBlocked > 0
        ? `Blocks ${opportunitiesBlocked} qualified opportunity requirement(s); ~$${Math.round(addressableValueBlocked).toLocaleString()} addressable impacted`
        : item.status === "needs_update"
          ? "Existing HQ evidence is expired or marked needs_update"
          : item.federalBaseline
            ? "Federal nonprofit baseline evidence still missing from the vault"
            : "Required for grant document readiness checklists";

    queue.push({
      evidenceType: item.evidenceType,
      label: item.label,
      whyNeeded,
      opportunitiesBlocked,
      addressableValueBlocked: Math.round(addressableValueBlocked),
      existsElsewhereInHq: item.existsElsewhereInHq,
      canAuraGenerate: item.canAuraGenerate,
      founderMustUpload: !item.canAuraGenerate && !item.thirdPartyRequired,
      thirdPartyRequired: item.thirdPartyRequired,
      priority: priorityFromImpact(opportunitiesBlocked, addressableValueBlocked),
    });
  }

  const rank: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  queue.sort((a, b) => {
    const pr = rank[a.priority] - rank[b.priority];
    if (pr !== 0) return pr;
    if (b.addressableValueBlocked !== a.addressableValueBlocked) {
      return b.addressableValueBlocked - a.addressableValueBlocked;
    }
    return b.opportunitiesBlocked - a.opportunitiesBlocked;
  });

  return queue;
}

/**
 * Verified org grant profile only — unknown fields are null + listed in unknownFields.
 * Never invents EIN/mission; UEI only when env is set; no banking details.
 */
export async function buildIfcdcOrganizationalGrantProfile(opts?: {
  actorEmail?: string;
}): Promise<{
  profile: Record<string, unknown>;
  verifiedFields: string[];
  unknownFields: string[];
  storedId: string;
}> {
  await ensureGrantTables();
  const vault = await listEvidenceVault({ limit: 500 });
  const verifiedEvidenceTypes = vault
    .filter(
      (v) =>
        v.verification_status === "verified"
        && (hasFileUrl(v.file_url) || v.source === "env_uei")
        && !isExpired(v.expiration_date)
    )
    .map((v) => v.evidence_type);

  const einEnv = process.env.IFCDC_EIN?.trim() || null;
  const einLooksReal = Boolean(einEnv && /^\d{2}-?\d{7}$/.test(einEnv));
  const uei = IFCDC_ORG_PROFILE.samUei || null;

  const verifiedFields: string[] = [];
  const unknownFields: string[] = [];
  const profile: Record<string, unknown> = {};

  const setVerified = (key: string, value: unknown) => {
    if (value == null || value === "") {
      profile[key] = null;
      unknownFields.push(key);
      return;
    }
    profile[key] = value;
    verifiedFields.push(key);
  };

  setVerified("legalName", IFCDC_ORG_PROFILE.legalName || null);
  setVerified("mission", IFCDC_ORG_PROFILE.mission || null);
  setVerified("vision", IFCDC_ORG_PROFILE.vision || null);
  setVerified("location", IFCDC_ORG_PROFILE.location || null);
  setVerified("divisions", IFCDC_ORG_PROFILE.divisions?.length ? IFCDC_ORG_PROFILE.divisions : null);

  // EIN only when env provides a real EIN — never the placeholder string.
  if (einLooksReal) {
    setVerified("ein", einEnv);
  } else {
    profile.ein = null;
    unknownFields.push("ein");
  }

  if (uei) {
    setVerified("samUei", uei);
  } else {
    profile.samUei = null;
    unknownFields.push("samUei");
  }

  // Tax-exempt fields only when IRS determination is verified in the vault (never invented).
  if (verifiedEvidenceTypes.includes("irs_501c3")) {
    setVerified("organizationType", "nonprofit");
    setVerified("taxExemptStatus", "501(c)(3)");
    const metaRow = vault.find((v) => v.evidence_type === "irs_501c3" && v.verification_status === "verified");
    let meta: Record<string, unknown> = {};
    try {
      const raw = (metaRow as { notes?: string | null } | undefined)?.notes;
      if (raw && raw.trim().startsWith("{")) meta = JSON.parse(raw);
    } catch {
      meta = {};
    }
    if (meta.publicCharityStatus) setVerified("publicCharityStatus", meta.publicCharityStatus);
    else {
      profile.publicCharityStatus = null;
      unknownFields.push("publicCharityStatus");
    }
    if (meta.determinationDate) setVerified("irsDeterminationDate", meta.determinationDate);
    if (meta.effectiveDateOfExemption) setVerified("exemptionEffectiveDate", meta.effectiveDateOfExemption);
    if (meta.ein && /^\d{2}-?\d{7}$/.test(String(meta.ein))) setVerified("ein", String(meta.ein));
    else if (einLooksReal) {
      /* already set above */
    }
  } else {
    profile.organizationType = null;
    profile.taxExemptStatus = null;
    profile.publicCharityStatus = null;
    unknownFields.push("organizationType", "taxExemptStatus", "publicCharityStatus");
  }

  // Evidence status map — banking is present/missing only.
  const evidenceStatus: Record<string, string> = {};
  for (const cat of EVIDENCE_TYPE_CATALOG) {
    if (cat.key === "banking") {
      evidenceStatus.banking = verifiedEvidenceTypes.includes("banking") ? "present" : "missing";
      continue;
    }
    if (verifiedEvidenceTypes.includes(cat.key) || (cat.envUei && uei)) {
      evidenceStatus[cat.key] = "verified";
    }
  }
  profile.verifiedEvidenceTypes = verifiedEvidenceTypes.filter((t) => t !== "banking");
  profile.evidenceStatus = evidenceStatus;
  verifiedFields.push("verifiedEvidenceTypes", "evidenceStatus");

  // Explicitly omit secrets
  delete (profile as { bankingDetails?: unknown }).bankingDetails;
  delete (profile as { accountNumber?: unknown }).accountNumber;
  delete (profile as { password?: unknown }).password;

  const now = nowIso();
  const existing = await safeGet<{ created_at: string }>(
    `SELECT created_at FROM ifcdc_org_grant_profiles WHERE id = ?`,
    ORG_PROFILE_ROW_ID
  );
  const createdAt = existing?.created_at || now;

  await safeRun(
    `INSERT INTO ifcdc_org_grant_profiles (
       id, profile_json, verified_fields_json, unknown_fields_json, source_note, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       profile_json = excluded.profile_json,
       verified_fields_json = excluded.verified_fields_json,
       unknown_fields_json = excluded.unknown_fields_json,
       source_note = excluded.source_note,
       updated_at = excluded.updated_at`,
    ORG_PROFILE_ROW_ID,
    JSON.stringify(profile),
    JSON.stringify(verifiedFields),
    JSON.stringify(unknownFields),
    "Phase 8A.5 verified HQ facts + vault evidence only; unknown fields await Founder",
    createdAt,
    now
  );

  await logGrantActivity(
    "system",
    "org_grant_profile",
    "org_grant_profile_snapshot_8a5",
    `verified=${verifiedFields.length} unknown=${unknownFields.length}`,
    opts?.actorEmail
  );

  emitPhase8A5Event({
    title: "IFCDC organizational grant profile refreshed",
    detail: `${verifiedFields.length} verified fields · ${unknownFields.length} unknown`,
    grantDocEvent: "org_grant_profile_updated",
  });

  return { profile, verifiedFields, unknownFields, storedId: ORG_PROFILE_ROW_ID };
}

export async function rematchOpportunitiesForEvidence(
  evidenceType: string
): Promise<{ unlockedOpportunityIds: string[]; recalculated: number }> {
  await ensureGrantTables();
  const keys = requirementKeysForEvidence(evidenceType);
  const like = `%${evidenceType}%`;

  const rows = await safeAll<{
    opportunity_id: string;
    readiness_class: string | null;
    ifcdc_addressable_amount: number | null;
  }>(
    `SELECT DISTINCT r.opportunity_id, o.readiness_class, o.ifcdc_addressable_amount
     FROM grant_opportunity_requirements r
     JOIN grant_opportunities o ON o.id = r.opportunity_id
     WHERE r.requirement_key LIKE ?
        OR r.requirement_key IN (?, ?, ?)
        OR r.evidence_record_id IN (
          SELECT id FROM grant_evidence_records WHERE evidence_type = ?
        )
     LIMIT ?`,
    like,
    keys[0],
    keys[1],
    keys[2],
    evidenceType,
    REMATCH_LIMIT
  );

  const unlockedOpportunityIds: string[] = [];
  let recalculated = 0;

  for (const row of rows) {
    const before = row.readiness_class;
    try {
      const result = await runOpportunityDocumentReadiness(row.opportunity_id, {
        syncFirst: false,
      });
      recalculated++;
      const after = String(result.readinessClass || "");
      if (
        before !== after
        && (after === "ready_now" || after === "nearly_ready")
        && before !== "ready_now"
      ) {
        unlockedOpportunityIds.push(row.opportunity_id);
        await safeRun(
          `INSERT INTO grant_evidence_unlock_events (
             id, evidence_type, opportunity_id, addressable_amount,
             readiness_class_before, readiness_class_after, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          newId(),
          evidenceType,
          row.opportunity_id,
          row.ifcdc_addressable_amount,
          before,
          after,
          nowIso()
        );
        emitPhase8A5Event({
          title: "Opportunity unlocked by evidence",
          detail: `${evidenceType}: ${before || "n/a"} → ${after}`,
          opportunityId: row.opportunity_id,
          grantDocEvent: "evidence_unlocked_opportunity",
          metadata: { evidenceType, before, after },
        });
      }
    } catch {
      /* skip bad opportunity */
    }
  }

  return { unlockedOpportunityIds, recalculated };
}

export async function verifyEvidenceRecord(opts: {
  evidenceRecordId?: string;
  evidenceType?: string;
  hqDocumentId?: string;
  actorEmail?: string;
  founderApproved?: boolean;
}): Promise<{
  verified: boolean;
  evidenceType: string | null;
  reason: string;
  rematch: { unlockedOpportunityIds: string[]; recalculated: number } | null;
}> {
  await ensureGrantTables();
  const db = await getDb();
  const now = nowIso();

  let row = opts.evidenceRecordId
    ? await safeGet<Record<string, unknown>>(
      `SELECT * FROM grant_evidence_records WHERE id = ?`,
      opts.evidenceRecordId
    )
    : undefined;

  if (!row && opts.evidenceType) {
    row = await safeGet<Record<string, unknown>>(
      `SELECT * FROM grant_evidence_records WHERE evidence_type = ?
       ORDER BY datetime(updated_at) DESC LIMIT 1`,
      opts.evidenceType
    );
  }

  if (!row && opts.hqDocumentId) {
    row = await safeGet<Record<string, unknown>>(
      `SELECT * FROM grant_evidence_records WHERE hq_document_id = ? LIMIT 1`,
      opts.hqDocumentId
    );
  }

  const hqDocId = opts.hqDocumentId || (row?.hq_document_id ? String(row.hq_document_id) : null);
  const hqDoc = hqDocId
    ? await safeGet<{ id: string; file_url: string | null; title: string }>(
      `SELECT id, file_url, title FROM hq_documents WHERE id = ?`,
      hqDocId
    )
    : undefined;

  const evidenceType =
    opts.evidenceType
    || (row?.evidence_type ? String(row.evidence_type) : null)
    || null;
  const cat = evidenceType ? catalogEntry(evidenceType) : undefined;

  const ueiOk = Boolean(cat?.envUei && IFCDC_ORG_PROFILE.samUei);
  const fileOk = hasFileUrl(hqDoc?.file_url) || hasFileUrl(row?.file_url);

  if (!ueiOk && !fileOk) {
    return {
      verified: false,
      evidenceType,
      reason: "Cannot verify: linked hq_document has no file_url and UEI env not set for this type",
      rematch: null,
    };
  }

  if (!row && evidenceType) {
    const id = newId();
    await safeRun(
      `INSERT INTO grant_evidence_records (
         id, evidence_type, title, hq_document_id, file_url, verification_status,
         source, last_reviewed_at, aura_confidence, founder_approved, reusable, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?, 1, ?, ?)`,
      id,
      evidenceType,
      hqDoc?.title || cat?.label || evidenceType,
      hqDocId,
      hqDoc?.file_url ?? null,
      ueiOk ? "env_uei" : "hq_documents",
      now,
      0.95,
      opts.founderApproved ? 1 : 0,
      now,
      now
    );
    row = { id, evidence_type: evidenceType };
  } else if (row) {
    await safeRun(
      `UPDATE grant_evidence_records SET
         verification_status = 'verified',
         file_url = COALESCE(?, file_url),
         hq_document_id = COALESCE(?, hq_document_id),
         last_reviewed_at = ?,
         founder_approved = CASE WHEN ? = 1 THEN 1 ELSE founder_approved END,
         source = COALESCE(source, ?),
         updated_at = ?
       WHERE id = ?`,
      hqDoc?.file_url ?? null,
      hqDocId,
      now,
      opts.founderApproved ? 1 : 0,
      ueiOk ? "env_uei" : "hq_documents",
      now,
      String(row.id)
    );
  }

  if (hqDocId) {
    await safeRun(
      `UPDATE hq_documents SET verification_status = 'verified', updated_at = ? WHERE id = ?`,
      now,
      hqDocId
    );
  }

  emitPhase8A5Event({
    title: "Evidence record verified",
    detail: `${evidenceType || "unknown"} verified (${ueiOk ? "env UEI" : "hq_document file"})`,
    grantDocEvent: "evidence_verified",
    metadata: {
      evidenceType,
      evidenceRecordId: row?.id ? String(row.id) : null,
      hqDocumentId: hqDocId,
    },
  });

  await logGrantActivity(
    "evidence",
    String(row?.id || evidenceType || "unknown"),
    "evidence_verified_8a5",
    `type=${evidenceType}`,
    opts?.actorEmail
  );

  const rematch = evidenceType
    ? await rematchOpportunitiesForEvidence(evidenceType)
    : null;

  return {
    verified: true,
    evidenceType,
    reason: ueiOk ? "Verified via SAM UEI env" : "Verified via linked hq_document file_url",
    rematch,
  };
}

/**
 * Reuse-first org evidence: locate existing HQ Document Center file → verify into
 * Evidence Vault → rematch grants. Upload only when genuinely absent from HQ and
 * the Founder supplied the file bytes for this call.
 */
export async function locateOrIngestVerifiedOrgEvidence(opts: {
  evidenceType: string;
  title?: string;
  actorEmail?: string;
  founderApproved?: boolean;
  effectiveDate?: string;
  expirationDate?: string;
  fileName?: string;
  base64?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  await ensureGrantTables();
  const { ensureDocumentTables, docId } = await import("./documentsSchema");
  await ensureDocumentTables();

  const evidenceType = opts.evidenceType;
  const cat = catalogEntry(evidenceType);
  if (!cat) {
    return { ok: false, error: `Unknown evidence type: ${evidenceType}` };
  }

  const title = opts.title || cat.label;
  const db = await getDb();
  const now = nowIso();

  // Snapshot readiness before rematch for unlock reporting
  const beforeRows = await safeAll<{
    id: string;
    title: string;
    readiness_class: string | null;
    application_readiness_score: number | null;
    ifcdc_addressable_amount: number | null;
  }>(
    `SELECT DISTINCT o.id, o.title, o.readiness_class, o.application_readiness_score, o.ifcdc_addressable_amount
     FROM grant_opportunity_requirements r
     JOIN grant_opportunities o ON o.id = r.opportunity_id
     WHERE (
       r.requirement_key LIKE ?
       OR r.requirement_key IN (?, ?, ?)
       OR r.label LIKE ?
     )
     AND o.eligibility_result IN ('eligible', 'possibly_eligible')
     AND (o.duplicate_of_id IS NULL OR o.duplicate_of_id = '')`,
    `%${evidenceType}%`,
    `baseline_${evidenceType}`,
    `opp_${evidenceType}`,
    `req_${evidenceType}`,
    `%${cat.label.slice(0, 32)}%`
  );
  const beforeMap = new Map(beforeRows.map((r) => [r.id, r]));

  // 1) Locate existing HQ document (no duplicate upload)
  const hqDocs = await safeAll<{
    id: string;
    title: string;
    category: string | null;
    file_url: string | null;
    evidence_type: string | null;
    file_name: string | null;
    verification_status: string | null;
  }>(
    `SELECT id, title, category, file_url, evidence_type, file_name, verification_status
     FROM hq_documents
     WHERE COALESCE(lifecycle_status, 'active') != 'archived'
     ORDER BY datetime(updated_at) DESC LIMIT 800`
  );

  let located = hqDocs.find(
    (d) => d.evidence_type === evidenceType && hasFileUrl(d.file_url)
  );
  if (!located) {
    located = hqDocs.find((d) => {
      if (!hasFileUrl(d.file_url)) return false;
      const blob = `${d.title || ""} ${d.category || ""} ${d.file_name || ""} ${d.evidence_type || ""}`;
      return cat.patterns.some((p) => p.test(blob));
    });
  }

  let hqDocumentId = located?.id || null;
  let action: "reused_existing_hq_document" | "uploaded_new_hq_document" | "missing" =
    located ? "reused_existing_hq_document" : "missing";

  // 2) Upload only if genuinely absent and Founder supplied file bytes
  if (!hqDocumentId && opts.base64 && opts.fileName) {
    const { validateHqDocumentUpload } = await import("./grantDocumentUpload");
    const { saveHqFileBase64 } = await import("./hqFileStorage");
    const validated = validateHqDocumentUpload(
      String(opts.fileName),
      String(opts.base64),
      opts.mimeType ? String(opts.mimeType) : undefined
    );
    if (!validated.ok) {
      return { ok: false, error: validated.error, action: "missing" };
    }
    const saved = await saveHqFileBase64(
      String(opts.fileName),
      String(opts.base64),
      validated.mime,
      opts.actorEmail || "",
      "confidential"
    );
    hqDocumentId = docId();
    const metaJson = JSON.stringify({
      ...(opts.metadata || {}),
      evidenceType,
      phase8a5: true,
      reuseFirst: true,
    });
    await db.run(
      `INSERT INTO hq_documents (
         id, title, category, file_url, version, access_level, approval_status,
         submitted_by, created_at, updated_at, mime_type, file_type, owner_email,
         visibility, source_module, file_name, file_size_bytes, evidence_type,
         verification_status, effective_date, custom_metadata_json
       ) VALUES (?, ?, 'legal', ?, 1, 'confidential', 'approved', ?, ?, ?, ?, 'pdf', ?, 'organization', 'grants_evidence', ?, ?, ?, 'verified', ?, ?)`,
      hqDocumentId,
      title,
      saved.url,
      opts.actorEmail || null,
      now,
      now,
      validated.mime,
      opts.actorEmail || null,
      String(opts.fileName),
      validated.sizeBytes,
      evidenceType,
      opts.effectiveDate || null,
      metaJson
    );
    action = "uploaded_new_hq_document";
    emitPhase8A5Event({
      title: "Evidence uploaded to Document Center",
      detail: `${title} (${evidenceType}) stored once — reuse-first path`,
      grantDocEvent: "evidence_uploaded",
      metadata: { evidenceType, hqDocumentId },
    });
  }

  if (!hqDocumentId) {
    return {
      ok: false,
      action: "missing",
      evidenceType,
      label: cat.label,
      error:
        "Document not found in HQ Document Center and no file bytes were provided. Founder upload required once.",
      founderMustUpload: true,
    };
  }

  // Tag existing doc with evidence_type / verified without duplicating the file
  await safeRun(
    `UPDATE hq_documents SET
       evidence_type = COALESCE(evidence_type, ?),
       verification_status = 'verified',
       effective_date = COALESCE(?, effective_date),
       updated_at = ?
     WHERE id = ?`,
    evidenceType,
    opts.effectiveDate || null,
    now,
    hqDocumentId
  );

  const notes = JSON.stringify({
    ...(opts.metadata || {}),
    verifiedAt: now,
    sourceDocumentTitle: title,
  });

  const verify = await verifyEvidenceRecord({
    evidenceType,
    hqDocumentId,
    actorEmail: opts.actorEmail,
    founderApproved: opts.founderApproved !== false,
  });

  // Stamp dates / notes / reusable on vault row
  await safeRun(
    `UPDATE grant_evidence_records SET
       title = ?,
       effective_date = COALESCE(?, effective_date),
       expiration_date = COALESCE(?, expiration_date),
       notes = ?,
       reusable = 1,
       founder_approved = 1,
       verification_status = 'verified',
       updated_at = ?
     WHERE evidence_type = ? AND hq_document_id = ?`,
    title,
    opts.effectiveDate || null,
    opts.expirationDate || null,
    notes,
    now,
    evidenceType,
    hqDocumentId
  );

  const orgProfile = await buildIfcdcOrganizationalGrantProfile({
    actorEmail: opts.actorEmail,
  });

  // After rematch, compute unlocked / score increases
  const afterRows =
    beforeRows.length === 0
      ? []
      : await safeAll<{
        id: string;
        title: string;
        readiness_class: string | null;
        application_readiness_score: number | null;
        ifcdc_addressable_amount: number | null;
      }>(
        `SELECT id, title, readiness_class, application_readiness_score, ifcdc_addressable_amount
         FROM grant_opportunities WHERE id IN (${beforeRows.map(() => "?").join(",")})`,
        ...beforeRows.map((r) => r.id)
      );

  const readinessIncreased: Array<Record<string, unknown>> = [];
  const unlocked: Array<Record<string, unknown>> = [];
  for (const after of afterRows) {
    const before = beforeMap.get(after.id);
    if (!before) continue;
    const beforeScore = Number(before.application_readiness_score || 0);
    const afterScore = Number(after.application_readiness_score || 0);
    if (afterScore > beforeScore) {
      readinessIncreased.push({
        id: after.id,
        title: after.title,
        scoreBefore: beforeScore,
        scoreAfter: afterScore,
        classBefore: before.readiness_class,
        classAfter: after.readiness_class,
        addressable: after.ifcdc_addressable_amount,
      });
    }
    if (
      before.readiness_class !== after.readiness_class
      && (after.readiness_class === "ready_now" || after.readiness_class === "nearly_ready")
    ) {
      unlocked.push({
        id: after.id,
        title: after.title,
        classBefore: before.readiness_class,
        classAfter: after.readiness_class,
        addressable: after.ifcdc_addressable_amount,
      });
    }
  }

  const founderQueue = await buildFounderEvidenceActionQueue();
  const stillMissing = founderQueue.some((q) => q.evidenceType === evidenceType);

  emitPhase8A5Event({
    title: "Organizational evidence verified (reuse-first)",
    detail: `${cat.label}: ${action}; rematched ${verify.rematch?.recalculated ?? 0}; unlocked ${unlocked.length}; score↑ ${readinessIncreased.length}`,
    grantDocEvent: "evidence_verified",
    metadata: {
      evidenceType,
      hqDocumentId,
      action,
      unlockedCount: unlocked.length,
      readinessIncreasedCount: readinessIncreased.length,
    },
  });

  return {
    ok: true,
    phase: "8A.5",
    maySubmit: false,
    action,
    evidenceType,
    label: cat.label,
    verificationStatus: "verified",
    hqDocumentId,
    reusedExisting: action === "reused_existing_hq_document",
    uploadedNew: action === "uploaded_new_hq_document",
    verify,
    orgProfileSummary: {
      verifiedFieldCount: orgProfile.verifiedFields.length,
      unknownFieldCount: orgProfile.unknownFields.length,
      taxExemptStatus: (orgProfile.profile as Record<string, unknown>).taxExemptStatus ?? null,
      publicCharityStatus: (orgProfile.profile as Record<string, unknown>).publicCharityStatus ?? null,
      ein: (orgProfile.profile as Record<string, unknown>).ein ?? null,
    },
    rematch: verify.rematch,
    unlockedOpportunities: unlocked,
    readinessIncreased,
    founderQueueStillListsItem: stillMissing,
    nextFounderQueueItem: founderQueue[0] || null,
    founderQueueTop5: founderQueue.slice(0, 5),
  };
}

export async function scanEvidenceExpirations(): Promise<
  Array<{
    id: string;
    evidence_type: string;
    title: string;
    expiration_date: string | null;
    daysUntilExpiration: number | null;
    state: "expired" | "expiring_soon";
  }>
> {
  await ensureGrantTables();
  const vault = await listEvidenceVault({ limit: 500 });
  const out: Array<{
    id: string;
    evidence_type: string;
    title: string;
    expiration_date: string | null;
    daysUntilExpiration: number | null;
    state: "expired" | "expiring_soon";
  }> = [];

  for (const row of vault) {
    if (!row.expiration_date) continue;
    const days = daysUntil(row.expiration_date);
    if (days == null) continue;
    if (days > EXPIRING_WITHIN_DAYS) continue;
    const state = days < 0 ? "expired" : "expiring_soon";
    out.push({
      id: row.id,
      evidence_type: row.evidence_type,
      title: row.title,
      expiration_date: row.expiration_date,
      daysUntilExpiration: days,
      state,
    });
    emitPhase8A5Event({
      title: state === "expired" ? "Evidence expired" : "Evidence expiring soon",
      detail: `"${row.title}" (${row.evidence_type}) expires ${row.expiration_date}`,
      opportunityId: row.opportunity_id,
      severity: "watch",
      grantDocEvent: "evidence_expiring",
      metadata: {
        evidenceRecordId: row.id,
        evidenceType: row.evidence_type,
        expirationDate: row.expiration_date,
        daysUntilExpiration: days,
      },
    });
  }

  return out;
}

export async function selectNextPilotCandidates(): Promise<{
  top5: PilotCandidate[];
  recommendedPilot: PilotCandidate | null;
  rationale: string;
  rejectedPriorPilot: Record<string, unknown> | null;
}> {
  await ensureGrantTables();

  const prior = await safeGet<Record<string, unknown>>(
    `SELECT id, title, pilot_rank, pilot_audit_recommendation, readiness_class, ifcdc_addressable_amount
     FROM grant_opportunities WHERE pilot_rank = 1 LIMIT 1`
  );

  let rejectedPriorPilot: Record<string, unknown> | null = null;
  if (prior) {
    const title = String(prior.title || "");
    const rejected =
      isLeadSafeTitle(title)
      || String(prior.pilot_audit_recommendation || "") === "do_not_pursue";
    if (rejected) {
      rejectedPriorPilot = {
        id: prior.id,
        title: prior.title,
        reason: isLeadSafeTitle(title)
          ? "Lead-Safe / Healthy Homes Financing excluded from pilot promotion"
          : "pilot_audit_recommendation = do_not_pursue",
      };
    }
  }

  const candidates = await safeAll<Record<string, unknown>>(
    `SELECT id, title, funder, url, eligibility_result, readiness_class,
            application_readiness_score, ifcdc_addressable_amount, best_program_slug,
            best_program_match_pct, enriched_final_score, qualification_score,
            deadline, hard_blocker_count, pilot_audit_recommendation, close_date
     FROM grant_opportunities
     WHERE eligibility_result IN ('eligible', 'possibly_eligible')
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
       AND COALESCE(pilot_audit_recommendation, '') != 'do_not_pursue'
     ORDER BY COALESCE(enriched_final_score, qualification_score, 0) DESC
     LIMIT 80`
  );

  const scored: Array<Record<string, unknown> & { pilotScore: number }> = candidates
    .filter((c) => !isLeadSafeTitle(String(c.title || "")))
    .map((c) => Object.assign({}, c, { pilotScore: scorePilot(c) }))
    .sort((a, b) => b.pilotScore - a.pilotScore)
    .slice(0, 5);

  await safeRun(`UPDATE grant_opportunities SET pilot_rank = NULL WHERE pilot_rank IS NOT NULL`);

  const top5: PilotCandidate[] = [];
  for (let i = 0; i < scored.length; i++) {
    const c = scored[i];
    const rank = i + 1;
    await safeRun(
      `UPDATE grant_opportunities SET pilot_rank = ?, updated_at = ? WHERE id = ?`,
      rank,
      nowIso(),
      String(c.id)
    );
    const str = (k: string) => (c[k] != null && c[k] !== "" ? String(c[k]) : null);
    const num = (k: string) => (c[k] != null ? Number(c[k]) : null);
    top5.push({
      id: String(c.id),
      title: String(c.title || ""),
      funder: str("funder"),
      url: str("url"),
      eligibility_result: str("eligibility_result"),
      readiness_class: str("readiness_class"),
      application_readiness_score: num("application_readiness_score"),
      ifcdc_addressable_amount: num("ifcdc_addressable_amount"),
      best_program_slug: str("best_program_slug"),
      best_program_match_pct: num("best_program_match_pct"),
      enriched_final_score: num("enriched_final_score"),
      qualification_score: num("qualification_score"),
      deadline: str("deadline"),
      hard_blocker_count: num("hard_blocker_count"),
      pilot_audit_recommendation: str("pilot_audit_recommendation"),
      pilotScore: c.pilotScore,
      pilot_rank: rank,
    });
  }

  const recommendedPilot = top5[0] || null;
  const rationale = recommendedPilot
    ? `Selected "${recommendedPilot.title}" as pilot #1 (score ${recommendedPilot.pilotScore.toFixed(1)}) using eligibility, program fit, addressable value, readiness, docs, deadline, match, and capacity realism. Lead-Safe / do_not_pursue excluded.`
    : "No eligible non-Lead-Safe pilot candidates available.";

  if (recommendedPilot) {
    emitPhase8A5Event({
      title: "New first pilot candidate",
      detail: rationale,
      opportunityId: recommendedPilot.id,
      grantDocEvent: "new_first_pilot_candidate",
      metadata: {
        top5Ids: top5.map((t) => t.id),
        rejectedPriorPilot,
      },
    });
  }

  return { top5, recommendedPilot, rationale, rejectedPriorPilot };
}

export async function recalculateAllQualifiedReadiness(opts?: {
  limit?: number;
  actorEmail?: string;
}): Promise<{
  batch: Awaited<ReturnType<typeof runDocumentReadinessBatch>>;
  readinessMovement: Record<string, number>;
  pilots: Awaited<ReturnType<typeof selectNextPilotCandidates>>;
}> {
  await ensureGrantTables();

  const beforeRows = await safeAll<{ readiness_class: string | null; c: number }>(
    `SELECT readiness_class, COUNT(*) as c FROM grant_opportunities
     WHERE eligibility_result IN ('eligible', 'possibly_eligible')
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
     GROUP BY readiness_class`
  );
  const beforeMap: Record<string, number> = {};
  for (const r of beforeRows) {
    beforeMap[String(r.readiness_class || "null")] = Number(r.c) || 0;
  }

  const batch = await runDocumentReadinessBatch({
    limit: opts?.limit ?? 40,
    actorEmail: opts?.actorEmail,
    onlyQualified: true,
  });

  const afterRows = await safeAll<{ readiness_class: string | null; c: number }>(
    `SELECT readiness_class, COUNT(*) as c FROM grant_opportunities
     WHERE eligibility_result IN ('eligible', 'possibly_eligible')
       AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
     GROUP BY readiness_class`
  );
  const readinessMovement: Record<string, number> = {};
  for (const r of afterRows) {
    const key = String(r.readiness_class || "null");
    readinessMovement[key] = (Number(r.c) || 0) - (beforeMap[key] || 0);
  }
  for (const key of Object.keys(beforeMap)) {
    if (!(key in readinessMovement)) {
      readinessMovement[key] = -(beforeMap[key] || 0);
    }
  }

  const pilots = await selectNextPilotCandidates();

  await logGrantActivity(
    "system",
    "evidence_population",
    "recalculate_qualified_readiness_8a5",
    `processed=${batch.processed} ready=${batch.readyNow} nearly=${batch.nearlyReady}`,
    opts?.actorEmail
  );

  return { batch, readinessMovement, pilots };
}

export async function buildProgramFundingReadinessView(opts?: {
  auditItems?: EvidenceAuditItem[];
}): Promise<
  Array<{
    programSlug: string;
    programLabel: string;
    qualifiedCount: number;
    addressableSum: number;
    readyNow: number;
    nearlyReady: number;
    missingOrgEvidenceTypes: string[];
    missingProgramEvidence: string[];
    highestPriorityOpportunity: Record<string, unknown> | null;
  }>
> {
  await ensureGrantTables();

  const profiles = await safeAll<{ slug: string; label: string }>(
    `SELECT slug, label FROM ifcdc_program_profiles ORDER BY label`
  );
  const programList =
    profiles.length > 0
      ? profiles
      : IFCDC_FUNDING_DIVISIONS.map((d) => ({ slug: d.slug, label: d.label }));

  const auditItems = opts?.auditItems ?? (await auditExistingHqEvidence()).items;
  const missingOrg = auditItems
    .filter(
      (i) =>
        i.federalBaseline
        && (i.status === "missing" || i.status === "unavailable" || i.status === "needs_update")
    )
    .map((i) => i.evidenceType);

  const views = [];
  for (const prog of programList) {
    const stats = await safeGet<{
      qualified_count: number;
      addressable_sum: number;
      ready_now: number;
      nearly_ready: number;
    }>(
      `SELECT
         COUNT(*) as qualified_count,
         SUM(COALESCE(ifcdc_addressable_amount, 0)) as addressable_sum,
         SUM(CASE WHEN readiness_class = 'ready_now' THEN 1 ELSE 0 END) as ready_now,
         SUM(CASE WHEN readiness_class = 'nearly_ready' THEN 1 ELSE 0 END) as nearly_ready
       FROM grant_opportunities
       WHERE eligibility_result IN ('eligible', 'possibly_eligible')
         AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
         AND (
           best_program_slug = ?
           OR program_area LIKE ?
           OR match_tags LIKE ?
         )`,
      prog.slug,
      `%${prog.slug}%`,
      `%${prog.slug}%`
    );

    const top = await safeGet<Record<string, unknown>>(
      `SELECT id, title, readiness_class, application_readiness_score,
              ifcdc_addressable_amount, deadline, url, pilot_rank
       FROM grant_opportunities
       WHERE eligibility_result IN ('eligible', 'possibly_eligible')
         AND (duplicate_of_id IS NULL OR duplicate_of_id = '')
         AND COALESCE(pilot_audit_recommendation, '') != 'do_not_pursue'
         AND (
           best_program_slug = ?
           OR program_area LIKE ?
           OR match_tags LIKE ?
         )
       ORDER BY
         CASE readiness_class
           WHEN 'ready_now' THEN 0
           WHEN 'nearly_ready' THEN 1
           WHEN 'needs_documents' THEN 2
           ELSE 3
         END,
         COALESCE(ifcdc_addressable_amount, 0) DESC,
         COALESCE(application_readiness_score, 0) DESC
       LIMIT 1`,
      prog.slug,
      `%${prog.slug}%`,
      `%${prog.slug}%`
    );

    const programEvidenceMissing = await safeAll<{ evidence_type: string }>(
      `SELECT DISTINCT evidence_type FROM grant_evidence_records
       WHERE program_slug = ?
         AND verification_status IN ('missing', 'unavailable', 'needs_update')`,
      prog.slug
    );

    const reqGaps = await safeAll<{ requirement_key: string }>(
      `SELECT DISTINCT r.requirement_key
       FROM grant_opportunity_requirements r
       JOIN grant_opportunities o ON o.id = r.opportunity_id
       WHERE o.best_program_slug = ?
         AND (
           r.match_status IN ('missing', 'unavailable')
           OR r.gap_bucket IN ('founder_input_required', 'hard_blocker', 'third_party_input_required')
         )
       LIMIT 15`,
      prog.slug
    );

    views.push({
      programSlug: prog.slug,
      programLabel: prog.label,
      qualifiedCount: Number(stats?.qualified_count || 0),
      addressableSum: Math.round(Number(stats?.addressable_sum || 0)),
      readyNow: Number(stats?.ready_now || 0),
      nearlyReady: Number(stats?.nearly_ready || 0),
      missingOrgEvidenceTypes: missingOrg,
      missingProgramEvidence: Array.from(
        new Set([
          ...programEvidenceMissing.map((r) => r.evidence_type),
          ...reqGaps.map((r) => r.requirement_key),
        ])
      ).slice(0, 20),
      highestPriorityOpportunity: top
        ? {
            id: top.id,
            title: top.title,
            readiness_class: top.readiness_class,
            application_readiness_score: top.application_readiness_score,
            ifcdc_addressable_amount: top.ifcdc_addressable_amount,
            deadline: top.deadline,
            url: top.url,
            pilot_rank: top.pilot_rank,
          }
        : null,
    });
  }

  return views;
}

export async function runPhase8A5PopulationCycle(opts?: {
  actorEmail?: string;
  limit?: number;
}): Promise<Record<string, unknown>> {
  await ensureGrantTables();
  const actorEmail = opts?.actorEmail;

  const audit = await auditExistingHqEvidence({ actorEmail });
  const founderQueue = await buildFounderEvidenceActionQueue({ audit: audit.items });
  const orgProfile = await buildIfcdcOrganizationalGrantProfile({ actorEmail });
  const expirations = await scanEvidenceExpirations();
  const readiness = await recalculateAllQualifiedReadiness({
    limit: opts?.limit ?? 40,
    actorEmail,
  });
  const vaultMetrics = await buildEvidenceVaultMetrics();
  const programViews = await buildProgramFundingReadinessView({ auditItems: audit.items });
  const completion = audit.completion;

  const payload = {
    phase: "8A.5",
    generatedAt: nowIso(),
    completionPercent: completion.percent,
    completion,
    auditSummary: {
      synced: audit.synced,
      byStatus: audit.items.reduce(
        (acc, i) => {
          acc[i.status] = (acc[i.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
      itemCount: audit.items.length,
    },
    auditItems: audit.items,
    founderQueue,
    orgProfile,
    expirations,
    readinessMovement: readiness.readinessMovement,
    documentReadinessBatch: {
      processed: readiness.batch.processed,
      readyNow: readiness.batch.readyNow,
      nearlyReady: readiness.batch.nearlyReady,
      needsDocuments: readiness.batch.needsDocuments,
      withHardBlockers: readiness.batch.withHardBlockers,
    },
    pilots: readiness.pilots,
    programFundingReadiness: programViews,
    vaultMetrics,
    notes: [
      "No documents invented",
      "No grant submissions",
      "No Twilio/SMS",
      "Lead-Safe / Healthy Homes Financing excluded from pilot promotion",
      "Banking evidence status-only",
    ],
  };

  await logGrantActivity(
    "system",
    "evidence_population",
    "phase8a5_population_cycle",
    `queue=${founderQueue.length} completion=${completion.percent}% pilots=${readiness.pilots.top5.length}`,
    actorEmail
  );

  emitPhase8A5Event({
    title: "Phase 8A.5 population cycle complete",
    detail: `Evidence completion ${completion.percent}% · founder queue ${founderQueue.length} · pilot ${readiness.pilots.recommendedPilot?.title || "none"}`,
    opportunityId: readiness.pilots.recommendedPilot?.id ?? null,
    grantDocEvent: "population_cycle_complete",
    metadata: {
      completionPercent: completion.percent,
      queueLength: founderQueue.length,
    },
  });

  return payload;
}
