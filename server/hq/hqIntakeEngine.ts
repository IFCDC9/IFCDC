/**
 * Universal participant intake and service coordination.
 * Isolated tenant ifcdc-intake-medical. Synthetic only. No mail, no claims, no provider contact.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { toEnterpriseRole, hasPermission } from "./enterpriseRoles";
import { ensureIntakeMedicalTables } from "./intakeMedicalBillingEngine";
import {
  INTAKE_COORD_TENANT_ID,
  NEED_TYPES,
  WORKFLOW_STATUSES,
  SUBMITTER_KINDS,
  HIPAA_COMPLIANCE_STATUS,
  INTAKE_COORD_BANNER,
  SAFETY_COPY,
  suggestDepartmentRoutes,
  codingInferredFromIntake,
  crisisGuidance,
  assertGenericNotice,
  nextStepsForParticipant,
  type IntakeNeedType,
  type IntakeWorkflowStatus,
  type IntakeSubmitterKind,
} from "../../shared/hqIntake";
import { redactForLog } from "../../shared/intakeMedicalBilling";

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

export type IntakeActor = { id?: string; role?: string };

export function intakeCapabilities(role = "") {
  const enterprise = role === "owner" ? "founder" : toEnterpriseRole(role);
  const isFounder = enterprise === "founder";
  const isDepartmentStaff = enterprise === "department_staff";
  const isCoordinator = isFounder || enterprise === "intake_coordinator";
  return {
    isFounder,
    canCoordinate: isCoordinator,
    canCreate: isCoordinator || enterprise === "clinical_referral_staff",
    canDepartment: isFounder || isDepartmentStaff || hasPermission(role, "hq.intake.department"),
    canClinical: isFounder || hasPermission(role, "hq.intake.clinical"),
    canBilling: isFounder || hasPermission(role, "hq.intake.medical"),
    assignedOnly: isDepartmentStaff,
  };
}

export async function ensureHqIntakeTables(): Promise<void> {
  await ensureIntakeMedicalTables();
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_intake_records (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      display_label TEXT NOT NULL,
      submitter_kind TEXT NOT NULL,
      workflow_status TEXT NOT NULL DEFAULT 'intake',
      consent_services INTEGER NOT NULL DEFAULT 0,
      consent_share_outside INTEGER NOT NULL DEFAULT 0,
      contact_prefs TEXT,
      language TEXT,
      accessibility TEXT,
      goals TEXT,
      referral_source TEXT,
      requested_support TEXT,
      urgent_physical INTEGER NOT NULL DEFAULT 0,
      urgent_behavioral INTEGER NOT NULL DEFAULT 0,
      assigned_department TEXT,
      assigned_owner_id TEXT,
      assigned_owner_label TEXT,
      assigned_contact_phone TEXT,
      assigned_contact_email TEXT,
      next_action TEXT,
      follow_up_date TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hq_intake_needs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      intake_id TEXT NOT NULL,
      need_type TEXT NOT NULL,
      other_text TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hq_intake_assignments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      intake_id TEXT NOT NULL,
      department TEXT NOT NULL,
      owner_id TEXT,
      owner_label TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      next_action TEXT,
      follow_up_date TEXT,
      confirmed_by TEXT,
      confirmed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hq_intake_outside_referrals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      intake_id TEXT NOT NULL,
      provider_label TEXT NOT NULL,
      consent_share_outside INTEGER NOT NULL,
      status TEXT NOT NULL,
      blocked_reason TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hq_intake_followups (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      intake_id TEXT NOT NULL,
      summary TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hq_intake_notices (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      intake_id TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      mailed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}

async function audit(actor: IntakeActor, action: string, entityType: string, entityId?: string) {
  const db = await getDb();
  await db.run(
    `INSERT INTO hq_intake_audit (id, tenant_id, actor_id, actor_role, action, entity_type, entity_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id(),
    INTAKE_COORD_TENANT_ID,
    actor.id ?? null,
    actor.role ?? null,
    action,
    entityType,
    entityId ?? null,
    now(),
  );
}

function requireIntakeAccess(actor: IntakeActor) {
  const caps = intakeCapabilities(actor.role);
  if (!caps.canCoordinate && !caps.canDepartment && !caps.canClinical && !caps.canBilling) {
    throw Object.assign(new Error("Access denied to intake"), { status: 403 });
  }
  return caps;
}

function normalizeNeeds(raw: unknown): Array<{ needType: IntakeNeedType; otherText?: string }> {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw Object.assign(new Error("At least one need is required"), { status: 400 });
  }
  return raw.map((item) => {
    const row = (item || {}) as { needType?: string; otherText?: string };
    const needType = (NEED_TYPES as readonly string[]).includes(String(row.needType))
      ? (row.needType as IntakeNeedType)
      : "other";
    return { needType, otherText: row.otherText };
  });
}

export async function createCoordinationIntake(
  actor: IntakeActor,
  body: {
    displayLabel?: string;
    submitterKind?: string;
    consentServices?: boolean;
    consentShareOutside?: boolean;
    contactPrefs?: string;
    language?: string;
    accessibility?: string;
    goals?: string;
    referralSource?: string;
    requestedSupport?: string;
    urgentPhysical?: boolean;
    urgentBehavioral?: boolean;
    needs?: unknown;
  },
) {
  const caps = requireIntakeAccess(actor);
  if (!caps.canCreate) {
    throw Object.assign(new Error("This role cannot create intakes"), { status: 403 });
  }
  await ensureHqIntakeTables();
  const label = String(body.displayLabel || "").trim();
  if (!label || label.length > 120) {
    throw Object.assign(new Error("displayLabel of 1–120 characters is required"), { status: 400 });
  }
  if (!body.consentServices) {
    throw Object.assign(new Error("Consent for IFCDC service coordination is required"), { status: 400 });
  }
  const needs = normalizeNeeds(body.needs);
  const submitterKind: IntakeSubmitterKind = SUBMITTER_KINDS.includes(body.submitterKind as IntakeSubmitterKind)
    ? (body.submitterKind as IntakeSubmitterKind)
    : "staff";
  const intakeId = id();
  const stamp = now();
  const db = await getDb();
  await db.run(
    `INSERT INTO hq_intake_records (
      id, tenant_id, display_label, submitter_kind, workflow_status, consent_services, consent_share_outside,
      contact_prefs, language, accessibility, goals, referral_source, requested_support,
      urgent_physical, urgent_behavioral, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'intake', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    intakeId,
    INTAKE_COORD_TENANT_ID,
    label,
    submitterKind,
    body.consentShareOutside ? 1 : 0,
    body.contactPrefs ?? "",
    body.language ?? "",
    body.accessibility ?? "",
    body.goals ?? "",
    body.referralSource ?? "",
    body.requestedSupport ?? "",
    body.urgentPhysical ? 1 : 0,
    body.urgentBehavioral ? 1 : 0,
    actor.id ?? null,
    stamp,
    stamp,
  );
  for (const need of needs) {
    await db.run(
      `INSERT INTO hq_intake_needs (id, tenant_id, intake_id, need_type, other_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id(),
      INTAKE_COORD_TENANT_ID,
      intakeId,
      need.needType,
      need.otherText ?? "",
      stamp,
    );
  }
  await audit(actor, "create_coordination_intake", "hq_intake_records", intakeId);
  return getCoordinationIntake(actor, intakeId);
}

function canViewRecord(
  caps: ReturnType<typeof intakeCapabilities>,
  actor: IntakeActor,
  row: { assigned_owner_id?: string | null; created_by?: string | null },
) {
  if (caps.assignedOnly) return row.assigned_owner_id === actor.id;
  if (caps.isFounder || caps.canCoordinate || caps.canClinical || caps.canBilling) return true;
  if (caps.canDepartment) return row.assigned_owner_id === actor.id;
  return false;
}

export async function listCoordinationIntakes(actor: IntakeActor) {
  const caps = requireIntakeAccess(actor);
  await ensureHqIntakeTables();
  const db = await getDb();
  const rows = await db.all(
    `SELECT id, display_label as displayLabel, submitter_kind as submitterKind, workflow_status as workflowStatus,
            assigned_department as assignedDepartment, assigned_owner_id as assignedOwnerId,
            assigned_owner_label as assignedOwnerLabel, follow_up_date as followUpDate,
            urgent_physical as urgentPhysical, urgent_behavioral as urgentBehavioral,
            created_at as createdAt, updated_at as updatedAt, created_by as createdBy
     FROM hq_intake_records WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 200`,
    INTAKE_COORD_TENANT_ID,
  );
  const visible = rows.filter((row: { assignedOwnerId?: string; createdBy?: string }) =>
    canViewRecord(caps, actor, { assigned_owner_id: row.assignedOwnerId, created_by: row.createdBy }),
  );
  await audit(actor, "list_coordination_intakes", "hq_intake_records");
  return {
    hipaaCompliance: HIPAA_COMPLIANCE_STATUS,
    notForRealPhi: true,
    liveSensitiveIntake: false,
    banner: INTAKE_COORD_BANNER,
    safety: SAFETY_COPY,
    intakes: visible,
  };
}

export async function getCoordinationIntake(actor: IntakeActor, intakeId: string) {
  const caps = requireIntakeAccess(actor);
  await ensureHqIntakeTables();
  const db = await getDb();
  const record = await db.get(
    `SELECT * FROM hq_intake_records WHERE id = ? AND tenant_id = ?`,
    intakeId,
    INTAKE_COORD_TENANT_ID,
  );
  if (!record) throw Object.assign(new Error("Intake not found"), { status: 404 });
  if (!canViewRecord(caps, actor, record)) {
    throw Object.assign(new Error("Access denied to this intake"), { status: 403 });
  }
  const needs = await db.all(
    `SELECT need_type as needType, other_text as otherText FROM hq_intake_needs WHERE intake_id = ? AND tenant_id = ?`,
    intakeId,
    INTAKE_COORD_TENANT_ID,
  );
  const assignments = await db.all(
    `SELECT * FROM hq_intake_assignments WHERE intake_id = ? AND tenant_id = ? ORDER BY confirmed_at DESC`,
    intakeId,
    INTAKE_COORD_TENANT_ID,
  );
  const referrals = await db.all(
    `SELECT * FROM hq_intake_outside_referrals WHERE intake_id = ? AND tenant_id = ? ORDER BY created_at DESC`,
    intakeId,
    INTAKE_COORD_TENANT_ID,
  );
  const followups = await db.all(
    `SELECT * FROM hq_intake_followups WHERE intake_id = ? AND tenant_id = ? ORDER BY created_at DESC`,
    intakeId,
    INTAKE_COORD_TENANT_ID,
  );
  const suggestedRoutes = suggestDepartmentRoutes(needs);
  const crisis = crisisGuidance({
    urgentPhysical: Boolean(record.urgent_physical),
    urgentBehavioral: Boolean(record.urgent_behavioral),
  });
  const coding = codingInferredFromIntake(needs);
  const participantNextSteps = nextStepsForParticipant({
    workflowStatus: record.workflow_status,
    assignedOwnerLabel: record.assigned_owner_label,
    assignedContactPhone: record.assigned_contact_phone,
    assignedContactEmail: record.assigned_contact_email,
    nextAction: record.next_action,
    followUpDate: record.follow_up_date,
  });
  await audit(actor, "view_coordination_intake", "hq_intake_records", intakeId);
  return {
    hipaaCompliance: HIPAA_COMPLIANCE_STATUS,
    notForRealPhi: true,
    liveSensitiveIntake: false,
    readyForBilling: false,
    banner: INTAKE_COORD_BANNER,
    safety: SAFETY_COPY,
    crisis,
    autoContactedEmergency: false,
    codingFromIntake: coding,
    suggestedRoutes,
    staffMustConfirmAssignment: true,
    capabilities: {
      clinicalRestricted: !caps.canClinical,
      billingRestrictedClinical: caps.canBilling && !caps.canClinical,
    },
    intake: {
      id: record.id,
      displayLabel: record.display_label,
      submitterKind: record.submitter_kind,
      workflowStatus: record.workflow_status,
      consentServices: Boolean(record.consent_services),
      consentShareOutside: Boolean(record.consent_share_outside),
      contactPrefs: record.contact_prefs,
      language: record.language,
      accessibility: record.accessibility,
      goals: record.goals,
      referralSource: record.referral_source,
      requestedSupport: record.requested_support,
      urgentPhysical: Boolean(record.urgent_physical),
      urgentBehavioral: Boolean(record.urgent_behavioral),
    },
    needs,
    assignments,
    referrals: caps.canClinical || caps.canCoordinate || caps.isFounder ? referrals : referrals.map((row: { status: string }) => ({
      status: row.status,
      provider_label: "restricted",
    })),
    followups,
    participantNextSteps,
    clinicalArea: caps.canClinical
      ? { access: "granted", reminder: SAFETY_COPY.restrictedClinical }
      : { access: "denied", reminder: SAFETY_COPY.restrictedClinical },
  };
}

export async function confirmAssignment(
  actor: IntakeActor,
  intakeId: string,
  body: {
    department?: string;
    ownerId?: string;
    ownerLabel?: string;
    contactPhone?: string;
    contactEmail?: string;
    nextAction?: string;
    followUpDate?: string;
  },
) {
  const caps = requireIntakeAccess(actor);
  if (!caps.canCoordinate) {
    throw Object.assign(new Error("Only intake coordinators or the Founder can confirm assignment"), { status: 403 });
  }
  await getCoordinationIntake(actor, intakeId);
  const department = String(body.department || "").trim();
  const ownerLabel = String(body.ownerLabel || "").trim() || "Unknown";
  const nextAction = String(body.nextAction || "").trim();
  const followUpDate = String(body.followUpDate || "").trim();
  if (!department || !nextAction || !followUpDate) {
    throw Object.assign(new Error("Staff must confirm department, next action, and follow-up date"), { status: 400 });
  }
  const contactPhone = String(body.contactPhone || "").trim() || "Unknown";
  const contactEmail = String(body.contactEmail || "").trim() || "Unknown";
  const stamp = now();
  const db = await getDb();
  await db.run(
    `INSERT INTO hq_intake_assignments (
      id, tenant_id, intake_id, department, owner_id, owner_label, contact_phone, contact_email,
      next_action, follow_up_date, confirmed_by, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id(),
    INTAKE_COORD_TENANT_ID,
    intakeId,
    department,
    body.ownerId ?? null,
    ownerLabel,
    contactPhone,
    contactEmail,
    nextAction,
    followUpDate,
    actor.id ?? null,
    stamp,
  );
  await db.run(
    `UPDATE hq_intake_records SET workflow_status = 'assignment', assigned_department = ?, assigned_owner_id = ?,
       assigned_owner_label = ?, assigned_contact_phone = ?, assigned_contact_email = ?, next_action = ?,
       follow_up_date = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    department,
    body.ownerId ?? null,
    ownerLabel,
    contactPhone,
    contactEmail,
    nextAction,
    followUpDate,
    stamp,
    intakeId,
    INTAKE_COORD_TENANT_ID,
  );
  await audit(actor, "confirm_assignment", "hq_intake_assignments", intakeId);
  return getCoordinationIntake(actor, intakeId);
}

export async function recordOutsideReferral(
  actor: IntakeActor,
  intakeId: string,
  body: { providerLabel?: string; consentShareOutside?: boolean },
) {
  const caps = requireIntakeAccess(actor);
  if (!caps.canCoordinate && !caps.isFounder && !caps.canClinical) {
    throw Object.assign(new Error("Access denied for outside referrals"), { status: 403 });
  }
  const bundle = await getCoordinationIntake(actor, intakeId);
  const consented = Boolean(body.consentShareOutside) || bundle.intake.consentShareOutside;
  const providerLabel = String(body.providerLabel || "").trim() || "Unknown";
  const stamp = now();
  const db = await getDb();
  if (!consented) {
    const rowId = id();
    await db.run(
      `INSERT INTO hq_intake_outside_referrals (
        id, tenant_id, intake_id, provider_label, consent_share_outside, status, blocked_reason, created_by, created_at
      ) VALUES (?, ?, ?, 'Unknown', 0, 'blocked', ?, ?, ?)`,
      rowId,
      INTAKE_COORD_TENANT_ID,
      intakeId,
      "Consent to share with an outside provider is required. Referral was not sent.",
      actor.id ?? null,
      stamp,
    );
    await audit(actor, "outside_referral_blocked", "hq_intake_outside_referrals", rowId);
    throw Object.assign(
      new Error("Consent to share with an outside provider is required. Referral was not sent."),
      { status: 409, code: "consent_required" },
    );
  }
  const rowId = id();
  await db.run(
    `INSERT INTO hq_intake_outside_referrals (
      id, tenant_id, intake_id, provider_label, consent_share_outside, status, blocked_reason, created_by, created_at
    ) VALUES (?, ?, ?, ?, 1, 'recorded', NULL, ?, ?)`,
    rowId,
    INTAKE_COORD_TENANT_ID,
    intakeId,
    providerLabel,
    actor.id ?? null,
    stamp,
  );
  await db.run(
    `UPDATE hq_intake_records SET workflow_status = 'referral', updated_at = ? WHERE id = ? AND tenant_id = ?`,
    stamp,
    intakeId,
    INTAKE_COORD_TENANT_ID,
  );
  await audit(actor, "outside_referral_recorded", "hq_intake_outside_referrals", rowId);
  return getCoordinationIntake(actor, intakeId);
}

export async function completeFollowup(
  actor: IntakeActor,
  intakeId: string,
  body: { summary?: string; serviceConnected?: boolean; close?: boolean },
) {
  requireIntakeAccess(actor);
  await getCoordinationIntake(actor, intakeId);
  const stamp = now();
  const db = await getDb();
  const rowId = id();
  await db.run(
    `INSERT INTO hq_intake_followups (id, tenant_id, intake_id, summary, completed, completed_at, created_by, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    rowId,
    INTAKE_COORD_TENANT_ID,
    intakeId,
    String(body.summary || "Follow-up completed").slice(0, 240),
    stamp,
    actor.id ?? null,
    stamp,
  );
  let status: IntakeWorkflowStatus = "follow_up";
  if (body.serviceConnected) status = "service_connection";
  if (body.close) status = "closed";
  await db.run(
    `UPDATE hq_intake_records SET workflow_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    status,
    stamp,
    intakeId,
    INTAKE_COORD_TENANT_ID,
  );
  await audit(actor, "complete_followup", "hq_intake_followups", rowId);
  return getCoordinationIntake(actor, intakeId);
}

export async function queueGenericNotice(actor: IntakeActor, intakeId: string) {
  requireIntakeAccess(actor);
  await getCoordinationIntake(actor, intakeId);
  const notice = assertGenericNotice(GENERIC_SAFE);
  const db = await getDb();
  await db.run(
    `INSERT INTO hq_intake_notices (id, tenant_id, intake_id, subject, body, mailed, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    id(),
    INTAKE_COORD_TENANT_ID,
    intakeId,
    notice.subject,
    notice.body,
    now(),
  );
  await audit(actor, "queue_generic_notice", "hq_intake_notices", intakeId);
  return { ...notice, mailed: false, sent: false };
}

const GENERIC_SAFE = { subject: "IFCDC intake update", body: "You have an IFCDC intake update. Sign in to Headquarters for details." };

export async function setWorkflowStatus(actor: IntakeActor, intakeId: string, status: string) {
  const caps = requireIntakeAccess(actor);
  if (!caps.canCoordinate && !caps.isFounder) {
    throw Object.assign(new Error("Access denied"), { status: 403 });
  }
  if (!(WORKFLOW_STATUSES as readonly string[]).includes(status)) {
    throw Object.assign(new Error("Unknown workflow status"), { status: 400 });
  }
  await getCoordinationIntake(actor, intakeId);
  const db = await getDb();
  await db.run(
    `UPDATE hq_intake_records SET workflow_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    status,
    now(),
    intakeId,
    INTAKE_COORD_TENANT_ID,
  );
  await audit(actor, "set_workflow_status", "hq_intake_records", intakeId);
  return getCoordinationIntake(actor, intakeId);
}

export function coordinationMeta(role = "") {
  return {
    hipaaCompliance: HIPAA_COMPLIANCE_STATUS,
    renderHipaa: HIPAA_COMPLIANCE_STATUS,
    notForRealPhi: true,
    liveSensitiveIntake: false,
    readyForBilling: false,
    claimSubmissionEnabled: false,
    autoContact911: false,
    autoContact988: false,
    auraDiagnoses: false,
    banner: INTAKE_COORD_BANNER,
    safety: SAFETY_COPY,
    capabilities: intakeCapabilities(role),
  };
}

export { redactForLog };
