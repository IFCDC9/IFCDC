/**
 * HQ Intake Center — Medical & Billing Readiness (prototype helpers).
 * Synthetic records only. Not ready for billing. Not for real PHI.
 */

export const INTAKE_TENANT_ID = "ifcdc-intake-medical";
export const INTAKE_WORKSPACE_BANNER =
  "NOT READY FOR BILLING. NOT FOR REAL PHI. Synthetic prototype only. Eligibility is Unknown until a payer responds. Aura is not a licensed coder or biller and is not a SAM Entity Administrator.";

export const FOREIGN_WORKSPACE_TENANTS = ["grants", "hr", "detroit", "people", "finance"] as const;

export const INTAKE_CASE_STATUSES = ["open", "in_review", "closed"] as const;
export type IntakeCaseStatus = (typeof INTAKE_CASE_STATUSES)[number];

export const CLAIM_PREP_STATUSES = ["draft", "needs_edit", "denied_tracked"] as const;
export type ClaimPrepStatus = (typeof CLAIM_PREP_STATUSES)[number];

export const TRANSMITTED_CLAIM_STATUSES = ["submitted", "transmitted", "accepted", "paid"] as const;

export const CODE_SET_VERSION = {
  icd10cm: "Unknown — no licensed ICD-10-CM codebook on file in HQ",
  cpt: "Unknown — no licensed CPT codebook on file in HQ",
  hcpcs: "Unknown — no licensed HCPCS codebook on file in HQ",
} as const;

export type EligibilityStatus = "Unknown";

export type CodingSuggestion = {
  code: string;
  system: "ICD-10-CM" | "CPT" | "HCPCS";
  codeSetVersion: string;
  rationale: string;
  source: "documented_clinical_text";
  humanApprovalRequired: true;
};

export type CodingAssistResult = {
  suggestions: CodingSuggestion[];
  refused: boolean;
  reason: string;
  missingFlags: string[];
  humanApprovalRequired: true;
  eligibility: EligibilityStatus;
  codeSetVersion: typeof CODE_SET_VERSION;
  approved: false;
};

export type InsuranceCardFields = {
  payerName?: string;
  memberId?: string;
  groupNumber?: string;
  subscriberName?: string;
  cardImagePresent?: boolean;
};

export type ClinicalDocumentationFields = {
  noteText?: string;
  documentedDiagnoses?: string;
  documentedProcedures?: string;
};

const EMPTY_CLINICAL = (value?: string) => !String(value ?? "").trim();

export function insuranceCardOnly(input: {
  insurance?: InsuranceCardFields;
  clinical?: ClinicalDocumentationFields;
}): boolean {
  const clinicalEmpty =
    EMPTY_CLINICAL(input.clinical?.noteText) &&
    EMPTY_CLINICAL(input.clinical?.documentedDiagnoses) &&
    EMPTY_CLINICAL(input.clinical?.documentedProcedures);
  const hasCard = Boolean(
    input.insurance &&
      (input.insurance.payerName ||
        input.insurance.memberId ||
        input.insurance.groupNumber ||
        input.insurance.subscriberName ||
        input.insurance.cardImagePresent),
  );
  return clinicalEmpty && hasCard;
}

export function suggestCoding(input: {
  insurance?: InsuranceCardFields;
  clinical?: ClinicalDocumentationFields;
}): CodingAssistResult {
  const missing: string[] = [];
  if (EMPTY_CLINICAL(input.clinical?.noteText) && EMPTY_CLINICAL(input.clinical?.documentedDiagnoses)) {
    missing.push("documented_diagnosis");
  }
  if (EMPTY_CLINICAL(input.clinical?.documentedProcedures) && EMPTY_CLINICAL(input.clinical?.noteText)) {
    missing.push("documented_procedure");
  }

  if (insuranceCardOnly(input) || missing.length === 2) {
    return {
      suggestions: [],
      refused: true,
      reason:
        "Coding cannot be inferred from an insurance card. Human-authored clinical documentation is required. Never invent diagnoses or procedures.",
      missingFlags: missing.length ? missing : ["clinical_documentation"],
      humanApprovalRequired: true,
      eligibility: "Unknown",
      codeSetVersion: CODE_SET_VERSION,
      approved: false,
    };
  }

  const suggestions: CodingSuggestion[] = [];
  const dx = String(input.clinical?.documentedDiagnoses || input.clinical?.noteText || "").trim();
  const px = String(input.clinical?.documentedProcedures || input.clinical?.noteText || "").trim();

  if (dx) {
    suggestions.push({
      code: "UNCODED-DX",
      system: "ICD-10-CM",
      codeSetVersion: CODE_SET_VERSION.icd10cm,
      rationale:
        "Suggestion placeholder only. A licensed coder must map the documented diagnosis text to an official code. This prototype does not select ICD codes.",
      source: "documented_clinical_text",
      humanApprovalRequired: true,
    });
  }
  if (px) {
    suggestions.push({
      code: "UNCODED-PX",
      system: "CPT",
      codeSetVersion: CODE_SET_VERSION.cpt,
      rationale:
        "Suggestion placeholder only. A licensed coder must map the documented procedure text to an official code. This prototype does not select CPT codes.",
      source: "documented_clinical_text",
      humanApprovalRequired: true,
    });
  }

  return {
    suggestions,
    refused: false,
    reason: "Suggestions require human approval. They are not billed codes and do not establish coverage.",
    missingFlags: missing,
    humanApprovalRequired: true,
    eligibility: "Unknown",
    codeSetVersion: CODE_SET_VERSION,
    approved: false,
  };
}

export function isTransmittedClaimStatus(status: string): boolean {
  return (TRANSMITTED_CLAIM_STATUSES as readonly string[]).includes(status);
}

export function blockClaimTransmission(status: string): { allowed: false; status: ClaimPrepStatus | "blocked"; reason: string } {
  if (isTransmittedClaimStatus(status)) {
    return {
      allowed: false,
      status: "blocked",
      reason: "Claim submission and payer transmission are disabled. Prototype is not ready for billing.",
    };
  }
  const next = (CLAIM_PREP_STATUSES as readonly string[]).includes(status) ? (status as ClaimPrepStatus) : "draft";
  return {
    allowed: false,
    status: next,
    reason: "Draft claim preparation only. No clearinghouse connection. Do not guarantee coverage or payment.",
  };
}

const PHI_LIKE =
  /\b(?:member\s*id|subscriber|ssn|social security|date of birth|\bdob\b|mrn|medicaid id|policy number)\b/i;

export function redactForLog(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted]")
    .replace(/\b[A-Z]{2,4}\d{6,}\b/g, "[redacted]")
    .replace(/\b\d{9,}\b/g, "[redacted]")
    .replace(PHI_LIKE, "[redacted-field]");
}

export function logPayloadLooksLikePhi(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (PHI_LIKE.test(text) && /\b\d{3,}\b/.test(text)) return true;
  if (/\bSYNTHETIC Patient\b/i.test(text) && /\bmember/i.test(text)) return true;
  return false;
}

export const SYNTHETIC_FIXTURE = {
  displayLabel: "SYNTHETIC Patient Alpha",
  dateOfBirth: "1990-01-01",
  memberId: "SYNTHMEM0001",
  groupNumber: "SYNTHGRP01",
  payerName: "SYNTHETIC Test Payer",
  noteText: "SYNTHETIC note: patient reports routine follow-up. No real clinical data.",
  documentedDiagnoses: "SYNTHETIC documented finding: unspecified counseling encounter (test only).",
  documentedProcedures: "SYNTHETIC documented service: office visit counseling (test only).",
  tenantId: INTAKE_TENANT_ID,
};
