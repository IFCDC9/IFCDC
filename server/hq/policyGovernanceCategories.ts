/** Built-in Policy & Governance categories for IFCDC HQ. */
export const POLICY_CATEGORIES = [
  { id: "board_governance", label: "Board Governance" },
  { id: "human_resources", label: "Human Resources" },
  { id: "finance_accounting", label: "Finance & Accounting" },
  { id: "procurement", label: "Procurement" },
  { id: "grants_management", label: "Grants Management" },
  { id: "community_programs", label: "Community Programs" },
  { id: "transitional_housing", label: "Transitional Housing" },
  { id: "youth_programs", label: "Youth Programs" },
  { id: "scholarship_program", label: "Scholarship Program" },
  { id: "economic_development", label: "Economic Development" },
  { id: "information_technology", label: "Information Technology" },
  { id: "cybersecurity", label: "Cybersecurity" },
  { id: "ai_governance", label: "Artificial Intelligence Governance" },
  { id: "privacy_confidentiality", label: "Privacy & Confidentiality" },
  { id: "risk_management", label: "Risk Management" },
  { id: "health_safety", label: "Health & Safety" },
  { id: "volunteer_management", label: "Volunteer Management" },
  { id: "employee_handbook", label: "Employee Handbook" },
  { id: "code_of_ethics", label: "Code of Ethics" },
  { id: "conflict_of_interest", label: "Conflict of Interest" },
  { id: "whistleblower", label: "Whistleblower Protection" },
  { id: "document_retention", label: "Document Retention" },
  { id: "records_management", label: "Records Management" },
  { id: "emergency_operations", label: "Emergency Operations" },
  { id: "business_continuity", label: "Business Continuity" },
  { id: "media_communications", label: "Media & Communications" },
  { id: "social_media", label: "Social Media" },
  { id: "branding_marketing", label: "Branding & Marketing" },
  { id: "software_standards", label: "Software Development Standards" },
  { id: "sops", label: "Standard Operating Procedures (SOPs)" },
] as const;

export type PolicyCategoryId = (typeof POLICY_CATEGORIES)[number]["id"];

export const POLICY_APPROVAL_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "published",
  "archived",
] as const;

export type PolicyApprovalStatus = (typeof POLICY_APPROVAL_STATUSES)[number];

export function policyCategoryLabel(id: string): string {
  return POLICY_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}
