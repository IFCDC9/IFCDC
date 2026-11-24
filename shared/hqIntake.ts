/**
 * IFCDC universal participant intake and service-coordination helpers.
 * Synthetic records only. HIPAA Compliance Disabled. Not for real PHI.
 * Medical/mental-health needs are referral pathways — not diagnoses.
 * Coding/billing are separate future workflows and are never inferred here.
 */

export const INTAKE_COORD_TENANT_ID = "ifcdc-intake-medical";

export const HIPAA_COMPLIANCE_STATUS = "Disabled" as const;

export const INTAKE_COORD_BANNER =
  "HIPAA Compliance Disabled. SYNTHETIC RECORDS ONLY. Not for real PHI. Not ready for live sensitive intake. Staff and Aura organize needs and coordinate referrals. They must not diagnose, recommend treatment, or replace a licensed clinician.";

export const SAFETY_COPY = {
  notAClinician:
    "Staff and Aura organize needs and coordinate referrals. They must not diagnose, recommend treatment, or replace a licensed clinician.",
  urgentPhysical:
    "If there is immediate physical danger or a medical emergency, call 911 or go to the nearest emergency department. IFCDC does not auto-contact 911.",
  urgentBehavioral:
    "If this is a behavioral-health crisis, call or text 988. IFCDC does not auto-contact 988.",
  restrictedClinical:
    "Clinical notes, diagnoses, insurance, and medical documents stay in a separately restricted area. Share the minimum needed for a referral, and only with documented consent.",
  noCodingFromIntake:
    "Medical coding and claims are a separate future workflow. Diagnoses and codes are never inferred from intake answers or insurance cards.",
} as const;

export const WORKFLOW_STATUSES = [
  "intake",
  "assignment",
  "referral",
  "follow_up",
  "service_connection",
  "closed",
] as const;
export type IntakeWorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const NEED_TYPES = [
  "youth_mentoring",
  "transitional_housing",
  "economic_development_employment",
  "scholarships_education",
  "community_arts_media_radio",
  "mental_health_support_case_management",
  "medical_clinical_referral",
  "other",
] as const;
export type IntakeNeedType = (typeof NEED_TYPES)[number];

export const SUBMITTER_KINDS = ["staff", "participant"] as const;
export type IntakeSubmitterKind = (typeof SUBMITTER_KINDS)[number];

/** Catalog contacts are Unknown until the Founder documents a real person. Do not invent names or phones. */
export type DepartmentContact = {
  departmentId: string;
  label: string;
  contactName: "Unknown" | string;
  contactPhone: "Unknown" | string;
  contactEmail: "Unknown" | string;
  isReferralPathway: boolean;
};

export const DEPARTMENT_CATALOG: Record<Exclude<IntakeNeedType, "other"> | "other", DepartmentContact> = {
  youth_mentoring: {
    departmentId: "youth_mentoring",
    label: "Youth mentoring",
    contactName: "Unknown",
    contactPhone: "Unknown",
    contactEmail: "Unknown",
    isReferralPathway: false,
  },
  transitional_housing: {
    departmentId: "transitional_housing",
    label: "Transitional housing",
    contactName: "Unknown",
    contactPhone: "Unknown",
    contactEmail: "Unknown",
    isReferralPathway: false,
  },
  economic_development_employment: {
    departmentId: "economic_development_employment",
    label: "Economic development / employment",
    contactName: "Unknown",
    contactPhone: "Unknown",
    contactEmail: "Unknown",
    isReferralPathway: false,
  },
  scholarships_education: {
    departmentId: "scholarships_education",
    label: "Scholarships / education",
    contactName: "Unknown",
    contactPhone: "Unknown",
    contactEmail: "Unknown",
    isReferralPathway: false,
  },
  community_arts_media_radio: {
    departmentId: "community_arts_media_radio",
    label: "Community arts / media / radio",
    contactName: "Unknown",
    contactPhone: "Unknown",
    contactEmail: "Unknown",
    isReferralPathway: false,
  },
  mental_health_support_case_management: {
    departmentId: "mental_health_support_case_management",
    label: "Mental-health support and case management (referral pathway)",
    contactName: "Unknown",
    contactPhone: "Unknown",
    contactEmail: "Unknown",
    isReferralPathway: true,
  },
  medical_clinical_referral: {
    departmentId: "medical_clinical_referral",
    label: "Medical / clinical referrals (referral pathway)",
    contactName: "Unknown",
    contactPhone: "Unknown",
    contactEmail: "Unknown",
    isReferralPathway: true,
  },
  other: {
    departmentId: "other",
    label: "Other (participant-identified)",
    contactName: "Unknown",
    contactPhone: "Unknown",
    contactEmail: "Unknown",
    isReferralPathway: false,
  },
};

export type SuggestedRoute = {
  needType: IntakeNeedType;
  departmentId: string;
  departmentLabel: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  staffMustConfirm: true;
  isReferralPathway: boolean;
  notes: string;
};

export function suggestDepartmentRoutes(
  needs: Array<{ needType: string; otherText?: string }>,
): SuggestedRoute[] {
  return needs.map((need) => {
    const type = (NEED_TYPES as readonly string[]).includes(need.needType)
      ? (need.needType as IntakeNeedType)
      : "other";
    const dept = DEPARTMENT_CATALOG[type];
    return {
      needType: type,
      departmentId: dept.departmentId,
      departmentLabel: dept.label,
      contactName: dept.contactName,
      contactPhone: dept.contactPhone,
      contactEmail: dept.contactEmail,
      staffMustConfirm: true,
      isReferralPathway: dept.isReferralPathway,
      notes:
        type === "other"
          ? `Participant-identified: ${String(need.otherText || "Unknown").slice(0, 200)}`
          : "Suggested for staff review only. Do not treat as an assignment until a human confirms owner, next action, and follow-up date.",
    };
  });
}

export function codingInferredFromIntake(_needs: unknown): { refused: true; suggestions: []; reason: string } {
  return {
    refused: true,
    suggestions: [],
    reason:
      "Coding cannot be inferred from participant intake, needs, or insurance cards. Medical coding remains a separate future workflow.",
  };
}

export type CrisisGuidance = {
  display911: boolean;
  display988: boolean;
  autoContact911: false;
  autoContact988: false;
  autoDial: false;
  physicalDangerCopy: string;
  behavioralHealthCopy: string;
};

export function crisisGuidance(input: { urgentPhysical?: boolean; urgentBehavioral?: boolean }): CrisisGuidance {
  return {
    display911: Boolean(input.urgentPhysical),
    display988: Boolean(input.urgentBehavioral),
    autoContact911: false,
    autoContact988: false,
    autoDial: false,
    physicalDangerCopy: SAFETY_COPY.urgentPhysical,
    behavioralHealthCopy: SAFETY_COPY.urgentBehavioral,
  };
}

export const GENERIC_NOTICE = {
  subject: "IFCDC intake update",
  body: "You have an IFCDC intake update. Sign in to Headquarters for details.",
  mailed: false,
  providerContacted: false,
} as const;

const HEALTH_CONTENT =
  /\b(?:diagnos|icd|cpt|hcpcs|hipaa|phq|gad-7|suicid|psychiatr|prescription|insurance card|member id|medicaid|mental health|clinical note)\b/i;

export function noticeLooksSensitive(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return HEALTH_CONTENT.test(text);
}

export function buildGenericNotice(): typeof GENERIC_NOTICE {
  return { ...GENERIC_NOTICE };
}

export function assertGenericNotice(payload: unknown): typeof GENERIC_NOTICE {
  if (noticeLooksSensitive(payload)) {
    throw Object.assign(new Error("Notifications may be generic only. Health content is blocked."), {
      status: 400,
      code: "notice_health_blocked",
    });
  }
  return buildGenericNotice();
}

export function nextStepsForParticipant(input: {
  workflowStatus: string;
  assignedOwnerLabel?: string | null;
  assignedContactPhone?: string | null;
  assignedContactEmail?: string | null;
  nextAction?: string | null;
  followUpDate?: string | null;
}): {
  workflowStatus: string;
  assignedContactName: string;
  assignedContactPhone: string;
  assignedContactEmail: string;
  nextAction: string;
  followUpDate: string;
} {
  return {
    workflowStatus: input.workflowStatus,
    assignedContactName: input.assignedOwnerLabel?.trim() || "Unknown",
    assignedContactPhone: input.assignedContactPhone?.trim() || "Unknown",
    assignedContactEmail: input.assignedContactEmail?.trim() || "Unknown",
    nextAction: input.nextAction?.trim() || "Unknown",
    followUpDate: input.followUpDate?.trim() || "Unknown",
  };
}

export const SYNTHETIC_INTAKE_FIXTURE = {
  displayLabel: "SYNTHETIC Participant River",
  language: "en",
  accessibility: "large text",
  goals: "SYNTHETIC goal: stable housing and youth program connection (test only).",
  referralSource: "SYNTHETIC walk-in",
  requestedSupport: "SYNTHETIC requested support for housing and mentoring.",
  contactPrefs: "sms",
};
