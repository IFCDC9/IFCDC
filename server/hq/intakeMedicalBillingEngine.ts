/**
 * Isolated HQ SQLite store for the Intake / Medical Billing Readiness prototype.
 * Tenant-scoped to ifcdc-intake-medical. No production seed. No claim transmission.
 */
import crypto from "crypto";
import { getDb } from "../db";
import {
  INTAKE_TENANT_ID,
  CLAIM_PREP_STATUSES,
  blockClaimTransmission,
  suggestCoding,
  redactForLog,
  type ClaimPrepStatus,
  type ClinicalDocumentationFields,
  type InsuranceCardFields,
} from "../../shared/intakeMedicalBilling";

export const INTAKE_READY_FOR_BILLING = false;

export async function ensureIntakeMedicalTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_intake_cases (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      display_label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      service_intent TEXT NOT NULL DEFAULT 'Unknown',
      location_unknown TEXT NOT NULL DEFAULT 'Unknown',
      notes TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hq_intake_insurance (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      payer_name TEXT,
      member_id TEXT,
      group_number TEXT,
      program_name TEXT NOT NULL DEFAULT 'Unknown',
      eligibility_status TEXT NOT NULL DEFAULT 'Unknown',
      enrollment_status TEXT NOT NULL DEFAULT 'Unknown',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hq_intake_clinical (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      note_text TEXT,
      documented_diagnoses TEXT,
      documented_procedures TEXT,
      invented INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hq_intake_coding (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      result_json TEXT NOT NULL,
      human_approved INTEGER NOT NULL DEFAULT 0,
      approved_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hq_intake_claims (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      submitted INTEGER NOT NULL DEFAULT 0,
      transmission_blocked INTEGER NOT NULL DEFAULT 1,
      edits_json TEXT NOT NULL DEFAULT '[]',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      denials_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hq_intake_audit (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      actor_id TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function requireTenant(tenantId: string) {
  if (tenantId !== INTAKE_TENANT_ID) {
    throw Object.assign(new Error("Tenant mismatch"), { status: 403, code: "tenant_denied" });
  }
}

async function audit(actor: { id?: string; role?: string }, action: string, entityType: string, entityId?: string) {
  const db = await getDb();
  await db.run(
    `INSERT INTO hq_intake_audit (id, tenant_id, actor_id, actor_role, action, entity_type, entity_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id(),
    INTAKE_TENANT_ID,
    actor.id ?? null,
    actor.role ?? null,
    action,
    entityType,
    entityId ?? null,
    now(),
  );
}

export async function listIntakeCases(actor: { id?: string; role?: string }) {
  await ensureIntakeMedicalTables();
  const db = await getDb();
  const rows = await db.all(
    `SELECT id, tenant_id as tenantId, display_label as displayLabel, status, service_intent as serviceIntent,
            location_unknown as serviceLocation, notes, created_at as createdAt, updated_at as updatedAt
     FROM hq_intake_cases WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 200`,
    INTAKE_TENANT_ID,
  );
  await audit(actor, "list_cases", "hq_intake_cases");
  return { readyForBilling: false, banner: true, cases: rows };
}

export async function upsertIntakeCase(
  actor: { id?: string; role?: string },
  body: { id?: string; displayLabel?: string; status?: string; serviceIntent?: string; notes?: string },
) {
  await ensureIntakeMedicalTables();
  const db = await getDb();
  const caseId = body.id || id();
  const existing = body.id
    ? await db.get<{ tenant_id: string }>("SELECT tenant_id FROM hq_intake_cases WHERE id = ?", body.id)
    : null;
  if (existing) requireTenant(existing.tenant_id);
  const label = String(body.displayLabel || "").trim();
  if (!label || label.length > 120) throw Object.assign(new Error("displayLabel of 1–120 characters is required"), { status: 400 });
  const stamp = now();
  await db.run(
    `INSERT INTO hq_intake_cases (id, tenant_id, display_label, status, service_intent, location_unknown, notes, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'Unknown', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET display_label=excluded.display_label, status=excluded.status,
       service_intent=excluded.service_intent, notes=excluded.notes, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
    caseId,
    INTAKE_TENANT_ID,
    label,
    body.status === "closed" || body.status === "in_review" ? body.status : "open",
    body.serviceIntent?.trim() || "Unknown",
    body.notes ?? "",
    actor.id ?? null,
    actor.id ?? null,
    stamp,
    stamp,
  );
  await audit(actor, existing ? "update_case" : "create_case", "hq_intake_cases", caseId);
  return getIntakeBundle(actor, caseId);
}

export async function getIntakeBundle(actor: { id?: string; role?: string }, caseId: string) {
  await ensureIntakeMedicalTables();
  const db = await getDb();
  const intake = await db.get(
    `SELECT id, tenant_id as tenantId, display_label as displayLabel, status, service_intent as serviceIntent,
            location_unknown as serviceLocation, notes, created_at as createdAt, updated_at as updatedAt
     FROM hq_intake_cases WHERE id = ?`,
    caseId,
  );
  if (!intake) throw Object.assign(new Error("Intake case not found"), { status: 404 });
  requireTenant(String((intake as { tenantId: string }).tenantId));
  const insurance = await db.all(`SELECT * FROM hq_intake_insurance WHERE case_id = ? AND tenant_id = ?`, caseId, INTAKE_TENANT_ID);
  const clinical = await db.all(`SELECT * FROM hq_intake_clinical WHERE case_id = ? AND tenant_id = ?`, caseId, INTAKE_TENANT_ID);
  const coding = await db.all(`SELECT * FROM hq_intake_coding WHERE case_id = ? AND tenant_id = ? ORDER BY created_at DESC`, caseId, INTAKE_TENANT_ID);
  const claims = await db.all(`SELECT * FROM hq_intake_claims WHERE case_id = ? AND tenant_id = ?`, caseId, INTAKE_TENANT_ID);
  await audit(actor, "view_case", "hq_intake_cases", caseId);
  return {
    readyForBilling: false,
    eligibility: "Unknown",
    enrolledToBill: "Unknown",
    intake,
    insurance,
    clinical,
    coding: coding.map((row: { result_json: string }) => ({ ...row, result: JSON.parse(row.result_json) })),
    claims,
  };
}

export async function upsertInsurance(
  actor: { id?: string; role?: string },
  caseId: string,
  body: InsuranceCardFields & { programName?: string },
) {
  await getIntakeBundle(actor, caseId);
  const db = await getDb();
  const rowId = id();
  const stamp = now();
  await db.run(
    `INSERT INTO hq_intake_insurance (id, tenant_id, case_id, payer_name, member_id, group_number, program_name, eligibility_status, enrollment_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Unknown', 'Unknown', ?, ?)`,
    rowId,
    INTAKE_TENANT_ID,
    caseId,
    body.payerName ?? "",
    body.memberId ?? "",
    body.groupNumber ?? "",
    body.programName?.trim() || "Unknown",
    stamp,
    stamp,
  );
  await audit(actor, "update_insurance", "hq_intake_insurance", rowId);
  return getIntakeBundle(actor, caseId);
}

export async function upsertClinical(
  actor: { id?: string; role?: string },
  caseId: string,
  body: ClinicalDocumentationFields,
) {
  await getIntakeBundle(actor, caseId);
  const db = await getDb();
  const rowId = id();
  const stamp = now();
  await db.run(
    `INSERT INTO hq_intake_clinical (id, tenant_id, case_id, note_text, documented_diagnoses, documented_procedures, invented, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    rowId,
    INTAKE_TENANT_ID,
    caseId,
    body.noteText ?? "",
    body.documentedDiagnoses ?? "",
    body.documentedProcedures ?? "",
    stamp,
    stamp,
  );
  await audit(actor, "update_clinical", "hq_intake_clinical", rowId);
  return getIntakeBundle(actor, caseId);
}

export async function runCodingAssist(actor: { id?: string; role?: string }, caseId: string) {
  const bundle = await getIntakeBundle(actor, caseId);
  const insuranceRow = bundle.insurance[0] as
    | { payer_name?: string; member_id?: string; group_number?: string }
    | undefined;
  const clinicalRow = bundle.clinical[0] as
    | { note_text?: string; documented_diagnoses?: string; documented_procedures?: string }
    | undefined;
  const result = suggestCoding({
    insurance: insuranceRow
      ? {
          payerName: insuranceRow.payer_name,
          memberId: insuranceRow.member_id,
          groupNumber: insuranceRow.group_number,
        }
      : undefined,
    clinical: clinicalRow
      ? {
          noteText: clinicalRow.note_text,
          documentedDiagnoses: clinicalRow.documented_diagnoses,
          documentedProcedures: clinicalRow.documented_procedures,
        }
      : undefined,
  });
  const db = await getDb();
  const rowId = id();
  await db.run(
    `INSERT INTO hq_intake_coding (id, tenant_id, case_id, result_json, human_approved, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    rowId,
    INTAKE_TENANT_ID,
    caseId,
    JSON.stringify(result),
    now(),
  );
  await audit(actor, "coding_assist", "hq_intake_coding", rowId);
  return { ...result, id: rowId, humanApproved: false };
}

export async function approveCoding(actor: { id?: string; role?: string }, codingId: string, approved: boolean) {
  await ensureIntakeMedicalTables();
  const db = await getDb();
  const row = await db.get<{ tenant_id: string; case_id: string }>(
    "SELECT tenant_id, case_id FROM hq_intake_coding WHERE id = ?",
    codingId,
  );
  if (!row) throw Object.assign(new Error("Coding record not found"), { status: 404 });
  requireTenant(row.tenant_id);
  if (!approved) throw Object.assign(new Error("Human approval is required before any billing use"), { status: 400 });
  await db.run("UPDATE hq_intake_coding SET human_approved = 1, approved_by = ? WHERE id = ?", actor.id ?? null, codingId);
  await audit(actor, "approve_coding", "hq_intake_coding", codingId);
  return { humanApproved: true, stillNotReadyForBilling: true };
}

export async function upsertDraftClaim(
  actor: { id?: string; role?: string },
  caseId: string,
  body: { status?: string; edits?: unknown[]; attachments?: unknown[]; denials?: unknown[] },
) {
  await getIntakeBundle(actor, caseId);
  const blocked = blockClaimTransmission(body.status || "draft");
  const status: ClaimPrepStatus = (CLAIM_PREP_STATUSES as readonly string[]).includes(blocked.status)
    ? (blocked.status as ClaimPrepStatus)
    : "draft";
  const db = await getDb();
  const rowId = id();
  const stamp = now();
  await db.run(
    `INSERT INTO hq_intake_claims (id, tenant_id, case_id, status, submitted, transmission_blocked, edits_json, attachments_json, denials_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)`,
    rowId,
    INTAKE_TENANT_ID,
    caseId,
    status,
    JSON.stringify(body.edits ?? []),
    JSON.stringify(body.attachments ?? []),
    JSON.stringify(body.denials ?? []),
    stamp,
    stamp,
  );
  await audit(actor, "prepare_claim", "hq_intake_claims", rowId);
  return {
    id: rowId,
    status,
    submitted: false,
    transmissionBlocked: true,
    reason: blocked.reason,
    readyForBilling: false,
  };
}

export async function submitClaim(_actor: { id?: string; role?: string }, _claimId: string) {
  return {
    submitted: false,
    transmitted: false,
    readyForBilling: false,
    error: "Claim submission is disabled. Prototype is not ready for billing and has no clearinghouse.",
  };
}

export async function listAuditSafe() {
  await ensureIntakeMedicalTables();
  const db = await getDb();
  const rows = await db.all(
    `SELECT id, tenant_id as tenantId, actor_id as actorId, actor_role as actorRole, action, entity_type as entityType, entity_id as entityId, created_at as createdAt
     FROM hq_intake_audit WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`,
    INTAKE_TENANT_ID,
  );
  return rows.map((row) => ({ ...row, detail: redactForLog({ action: row.action, entityId: row.entityId }) }));
}

export function safeIntakeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Intake workspace error";
  return { error: redactForLog(message), readyForBilling: false };
}
