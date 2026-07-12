/**
 * IFCDC Policy & Governance — comprehensive foundational library definitions.
 * Used by gap-fill seeding so every category has a full set of templates.
 */
import type { PolicyCategoryId } from "./policyGovernanceCategories";
import { policyCategoryLabel } from "./policyGovernanceCategories";

export type LibrarySeedPolicy = {
  title: string;
  number: string;
  department: string;
  category: PolicyCategoryId;
  purpose: string;
  why: string;
  scope: string;
  responsibilities: string;
  procedures: string;
  compliance: string;
  legal?: string;
  meansWhy: string;
  meansExpect: string;
  meansConsequences: string;
  meansDepts: string;
  meansMission: string;
  related?: string;
  forms?: string;
};

type Topic = { code: string; title: string; department: string; focus: string };

const TOPICS: Record<PolicyCategoryId, Topic[]> = {
  board_governance: [
    { code: "BD-001", title: "Board Bylaws Governance Policy", department: "Board of Directors", focus: "bylaws adherence and board authority" },
    { code: "BD-002", title: "Board Meeting & Minutes Policy", department: "Board of Directors", focus: "quorum, agendas, and official minutes" },
    { code: "BD-003", title: "Board Fiduciary Duty Policy", department: "Board of Directors", focus: "duty of care, loyalty, and obedience" },
    { code: "BD-004", title: "Board Committee Charter Policy", department: "Board of Directors", focus: "committee roles and reporting" },
    { code: "BD-005", title: "Board Orientation & Onboarding Policy", department: "Board of Directors", focus: "new director orientation" },
  ],
  human_resources: [
    { code: "HR-001", title: "Equal Employment Opportunity Policy", department: "Human Resources", focus: "non-discrimination in employment" },
    { code: "HR-002", title: "Recruitment & Selection Policy", department: "Human Resources", focus: "fair hiring and requisitions" },
    { code: "HR-003", title: "Workplace Conduct & Anti-Harassment Policy", department: "Human Resources", focus: "respectful workplace standards" },
    { code: "HR-004", title: "Performance Management Policy", department: "Human Resources", focus: "reviews, coaching, and improvement plans" },
    { code: "HR-005", title: "Leave & Attendance Policy", department: "Human Resources", focus: "PTO, sick leave, and attendance" },
    { code: "HR-006", title: "Compensation & Benefits Administration Policy", department: "Human Resources", focus: "pay practices and benefits eligibility" },
  ],
  finance_accounting: [
    { code: "FIN-001", title: "Finance & Accounting Controls Policy", department: "Finance", focus: "internal controls and segregation of duties" },
    { code: "FIN-002", title: "Cash Handling & Disbursement Policy", department: "Finance", focus: "cash, checks, and payment approvals" },
    { code: "FIN-003", title: "Budget Development & Monitoring Policy", department: "Finance", focus: "annual budgets and variance review" },
    { code: "FIN-004", title: "Chart of Accounts & Financial Reporting Policy", department: "Finance", focus: "GAAP nonprofit reporting" },
    { code: "FIN-005", title: "Restricted Funds & Donor Intent Policy", department: "Finance", focus: "restricted and temporarily restricted funds" },
  ],
  procurement: [
    { code: "PRC-001", title: "Procurement & Purchasing Policy", department: "Finance", focus: "authorized purchasing and competitive quotes" },
    { code: "PRC-002", title: "Vendor Selection & Due Diligence Policy", department: "Finance", focus: "vendor screening and contracts" },
    { code: "PRC-003", title: "Purchase Order & Invoice Approval Policy", department: "Finance", focus: "PO thresholds and invoice matching" },
    { code: "PRC-004", title: "Conflict-Free Procurement Policy", department: "Finance", focus: "avoiding vendor conflicts of interest" },
  ],
  grants_management: [
    { code: "GRT-001", title: "Grants Management Policy", department: "Grants", focus: "full grant lifecycle governance" },
    { code: "GRT-002", title: "Grant Proposal Development Policy", department: "Grants", focus: "proposal review and Founder approval gates" },
    { code: "GRT-003", title: "Award Setup & Compliance Calendar Policy", department: "Grants", focus: "award kickoff and deadline tracking" },
    { code: "GRT-004", title: "Grant Reporting & Closeout Policy", department: "Grants", focus: "narrative, fiscal, and closeout packages" },
    { code: "GRT-005", title: "Subrecipient Monitoring Policy", department: "Grants", focus: "oversight of subawards when used" },
  ],
  community_programs: [
    { code: "PRG-001", title: "Community Programs Delivery Policy", department: "Community Programs", focus: "program design and service standards" },
    { code: "PRG-002", title: "Participant Intake & Eligibility Policy", department: "Community Programs", focus: "fair intake and eligibility documentation" },
    { code: "PRG-003", title: "Program Outcomes & Data Quality Policy", department: "Community Programs", focus: "outcomes measurement and data integrity" },
    { code: "PRG-004", title: "Community Partnerships Policy", department: "Community Programs", focus: "partner MOUs and shared services" },
  ],
  transitional_housing: [
    { code: "HOU-001", title: "Transitional Housing Program SOP", department: "Transitional Housing", focus: "intake, placement, and exit" },
    { code: "HOU-002", title: "Housing Unit Safety & Habitability Policy", department: "Transitional Housing", focus: "unit inspections and maintenance" },
    { code: "HOU-003", title: "Resident Rights & Responsibilities Policy", department: "Transitional Housing", focus: "resident agreements and due process" },
    { code: "HOU-004", title: "Housing Case Management Documentation Policy", department: "Transitional Housing", focus: "case notes and confidentiality" },
  ],
  youth_programs: [
    { code: "YTH-001", title: "Youth Protection & Safeguarding Policy", department: "Youth & Mentorship", focus: "youth safety and mandated reporting" },
    { code: "YTH-002", title: "Youth Mentorship Program Policy", department: "Youth & Mentorship", focus: "mentor screening and supervision" },
    { code: "YTH-003", title: "Youth Program Supervision Ratios Policy", department: "Youth & Mentorship", focus: "staffing ratios and activity oversight" },
    { code: "YTH-004", title: "Youth Media Consent & Privacy Policy", department: "Youth & Mentorship", focus: "photos, stories, and parental consent" },
  ],
  scholarship_program: [
    { code: "SCH-001", title: "Scholarship Award Governance Policy", department: "Education & Scholarships", focus: "fair award criteria and scoring" },
    { code: "SCH-002", title: "Scholarship Application & Selection Policy", department: "Education & Scholarships", focus: "application windows and panel review" },
    { code: "SCH-003", title: "Scholarship Disbursement & Verification Policy", department: "Education & Scholarships", focus: "payment verification to institutions" },
    { code: "SCH-004", title: "Scholarship Appeals Policy", department: "Education & Scholarships", focus: "appeal process for applicants" },
  ],
  economic_development: [
    { code: "ECO-001", title: "Economic Development Program Policy", department: "Economic Development", focus: "workforce and entrepreneurship support" },
    { code: "ECO-002", title: "Small Business Assistance Standards Policy", department: "Economic Development", focus: "coaching, referrals, and documentation" },
    { code: "ECO-003", title: "Economic Opportunity Equity Policy", department: "Economic Development", focus: "equitable access to economic programs" },
    { code: "ECO-004", title: "Workforce Development Partnership Policy", department: "Economic Development", focus: "employer and training partners" },
  ],
  information_technology: [
    { code: "IT-001", title: "Information Technology Acceptable Use Policy", department: "Technology", focus: "systems, email, and device use" },
    { code: "IT-002", title: "Access Control & Identity Management Policy", department: "Technology", focus: "SSO, roles, and least privilege" },
    { code: "IT-003", title: "Change Management & Systems Change Policy", department: "Technology", focus: "approved changes to production systems" },
    { code: "IT-004", title: "Asset & Endpoint Management Policy", department: "Technology", focus: "laptops, phones, and HQ equipment" },
    { code: "IT-005", title: "Backup & Recovery Policy", department: "Technology", focus: "data backups and restore testing" },
  ],
  cybersecurity: [
    { code: "CYB-001", title: "Cybersecurity Acceptable Use Policy", department: "Technology", focus: "passwords, MFA, and phishing response" },
    { code: "CYB-002", title: "Incident Response Policy", department: "Technology", focus: "detect, contain, and report incidents" },
    { code: "CYB-003", title: "Vulnerability Management Policy", department: "Technology", focus: "patching and vulnerability remediation" },
    { code: "CYB-004", title: "Third-Party Security Assessment Policy", department: "Technology", focus: "vendor security diligence" },
  ],
  ai_governance: [
    { code: "AI-001", title: "Artificial Intelligence Governance Policy", department: "Technology / AURA", focus: "responsible AURA and AI use" },
    { code: "AI-002", title: "AI Data Minimization & Privacy Policy", department: "Technology / AURA", focus: "keeping PII out of unapproved AI tools" },
    { code: "AI-003", title: "Human Oversight of Automated Decisions Policy", department: "Technology / AURA", focus: "human review of AI recommendations" },
    { code: "AI-004", title: "AI Model & Tool Approval Policy", department: "Technology / AURA", focus: "approved AI tools inventory" },
  ],
  privacy_confidentiality: [
    { code: "PRI-001", title: "Privacy & Confidentiality Policy", department: "Compliance", focus: "protecting personal and client data" },
    { code: "PRI-002", title: "Data Classification Policy", department: "Compliance", focus: "public, internal, confidential, restricted" },
    { code: "PRI-003", title: "Breach Notification Policy", department: "Compliance", focus: "incident notification timelines" },
    { code: "PRI-004", title: "Client Confidentiality in Case Management Policy", department: "Compliance", focus: "case file access rules" },
  ],
  risk_management: [
    { code: "RSK-001", title: "Enterprise Risk Management Policy", department: "Compliance", focus: "risk identification and mitigation" },
    { code: "RSK-002", title: "Insurance & Liability Coverage Policy", department: "Compliance", focus: "coverage reviews and claims" },
    { code: "RSK-003", title: "Incident & Near-Miss Reporting Policy", department: "Compliance", focus: "reporting operational incidents" },
    { code: "RSK-004", title: "Risk Register Review Policy", department: "Compliance", focus: "periodic risk register updates" },
  ],
  health_safety: [
    { code: "HSE-001", title: "Workplace Health & Safety Policy", department: "Operations", focus: "safe workplace expectations" },
    { code: "HSE-002", title: "Facility Safety Inspection Policy", department: "Facilities", focus: "inspections and corrective actions" },
    { code: "HSE-003", title: "Injury Reporting & First Aid Policy", department: "Operations", focus: "injury response and documentation" },
    { code: "HSE-004", title: "Vehicle & Fleet Safety Policy", department: "Operations", focus: "authorized drivers and vehicle checks" },
  ],
  volunteer_management: [
    { code: "VOL-001", title: "Volunteer Management Policy", department: "Human Resources", focus: "recruitment, screening, and supervision" },
    { code: "VOL-002", title: "Volunteer Orientation & Training Policy", department: "Human Resources", focus: "required volunteer training" },
    { code: "VOL-003", title: "Volunteer Hours & Recognition Policy", department: "Human Resources", focus: "hours tracking and awards" },
    { code: "VOL-004", title: "Volunteer Background Screening Policy", department: "Human Resources", focus: "role-based background checks" },
  ],
  employee_handbook: [
    { code: "HB-001", title: "Employee Handbook Acknowledgment Policy", department: "Human Resources", focus: "handbook issuance and signatures" },
    { code: "HB-002", title: "Employee Handbook Revision Policy", department: "Human Resources", focus: "how handbook updates are communicated" },
    { code: "HB-003", title: "At-Will Employment & Workplace Expectations Policy", department: "Human Resources", focus: "employment relationship clarity" },
    { code: "HB-004", title: "Remote & Hybrid Work Handbook Policy", department: "Human Resources", focus: "remote work rules when authorized" },
  ],
  code_of_ethics: [
    { code: "ETH-001", title: "Code of Ethics", department: "Executive Administration", focus: "honesty, integrity, and public trust" },
    { code: "ETH-002", title: "Professional Conduct Standards Policy", department: "Executive Administration", focus: "professional behavior with clients and partners" },
    { code: "ETH-003", title: "Gifts & Gratuities Policy", department: "Executive Administration", focus: "accepting and declining gifts" },
    { code: "ETH-004", title: "Ethical Fundraising Practices Policy", department: "Executive Administration", focus: "donor respect and truthful solicitation" },
  ],
  conflict_of_interest: [
    { code: "COI-001", title: "Conflict of Interest Policy", department: "Board of Directors", focus: "disclosure and recusal" },
    { code: "COI-002", title: "Related-Party Transaction Policy", department: "Board of Directors", focus: "related-party approvals" },
    { code: "COI-003", title: "Annual Conflict Disclosure Policy", department: "Board of Directors", focus: "annual disclosure certificates" },
    { code: "COI-004", title: "Staff Outside Employment Disclosure Policy", department: "Human Resources", focus: "outside work disclosures" },
  ],
  whistleblower: [
    { code: "WBP-001", title: "Whistleblower Protection Policy", department: "Human Resources", focus: "good-faith reporting without retaliation" },
    { code: "WBP-002", title: "Misconduct Reporting Channels Policy", department: "Human Resources", focus: "how and where to report concerns" },
    { code: "WBP-003", title: "Investigation Integrity Policy", department: "Human Resources", focus: "fair, confidential investigations" },
    { code: "WBP-004", title: "Anti-Retaliation Enforcement Policy", department: "Human Resources", focus: "discipline for retaliation" },
  ],
  document_retention: [
    { code: "DOC-001", title: "Document Retention Policy", department: "Executive Administration", focus: "retention schedules by record type" },
    { code: "DOC-002", title: "Legal Hold Policy", department: "Executive Administration", focus: "suspending destruction under legal hold" },
    { code: "DOC-003", title: "Secure Document Destruction Policy", department: "Executive Administration", focus: "approved destruction methods" },
    { code: "DOC-004", title: "Official Records Custody Policy", department: "Executive Administration", focus: "custodianship in Document Center" },
  ],
  records_management: [
    { code: "REC-001", title: "Records Management Policy", department: "Executive Administration", focus: "classify, store, retrieve, dispose" },
    { code: "REC-002", title: "Electronic Records Integrity Policy", department: "Technology", focus: "integrity of digital records" },
    { code: "REC-003", title: "Program Case File Standards Policy", department: "Programs", focus: "case file completeness" },
    { code: "REC-004", title: "Board & Corporate Records Policy", department: "Board of Directors", focus: "corporate minute books and filings" },
  ],
  emergency_operations: [
    { code: "EMG-001", title: "Emergency Operations Policy", department: "Operations", focus: "incident command during emergencies" },
    { code: "EMG-002", title: "Facility Evacuation Policy", department: "Facilities", focus: "evacuation routes and drills" },
    { code: "EMG-003", title: "Severe Weather & Facility Closure Policy", department: "Operations", focus: "closure decisions and notifications" },
    { code: "EMG-004", title: "Emergency Communications Policy", department: "Communications", focus: "staff and public emergency messaging" },
  ],
  business_continuity: [
    { code: "BCP-001", title: "Business Continuity Policy", department: "Executive Administration", focus: "keeping critical services running" },
    { code: "BCP-002", title: "Disaster Recovery Policy", department: "Technology", focus: "IT recovery after outages" },
    { code: "BCP-003", title: "Critical Function Prioritization Policy", department: "Executive Administration", focus: "which services restore first" },
    { code: "BCP-004", title: "Continuity Testing & Drill Policy", department: "Operations", focus: "tabletops and recovery drills" },
  ],
  media_communications: [
    { code: "MED-001", title: "Media & Public Communications Policy", department: "Communications", focus: "authorized spokespeople" },
    { code: "MED-002", title: "Press Release & Media Inquiry Policy", department: "Communications", focus: "responding to press" },
    { code: "MED-003", title: "Crisis Communications Policy", department: "Communications", focus: "messaging during crises" },
    { code: "MED-004", title: "Internal Communications Standards Policy", department: "Communications", focus: "staff announcements and channels" },
  ],
  social_media: [
    { code: "SOC-001", title: "Organizational Social Media Policy", department: "Communications", focus: "official IFCDC accounts" },
    { code: "SOC-002", title: "Personal Social Media Conduct Policy", department: "Communications", focus: "personal posts referencing IFCDC" },
    { code: "SOC-003", title: "Social Media Content Approval Policy", department: "Communications", focus: "content review before posting" },
    { code: "SOC-004", title: "Social Media Incident Escalation Policy", department: "Communications", focus: "escalating harmful online incidents" },
  ],
  branding_marketing: [
    { code: "BRD-001", title: "Brand Identity & Logo Use Policy", department: "Communications", focus: "logo and brand marks" },
    { code: "BRD-002", title: "Marketing Materials Approval Policy", department: "Communications", focus: "approving flyers and campaigns" },
    { code: "BRD-003", title: "Donor & Partner Branding Acknowledgment Policy", department: "Communications", focus: "funder recognition requirements" },
    { code: "BRD-004", title: "Co-Branding & Partnership Marks Policy", department: "Communications", focus: "joint branding with partners" },
  ],
  software_standards: [
    { code: "SW-001", title: "Software Development Standards", department: "IFCDC Software Division", focus: "centralized services and review gates" },
    { code: "SW-002", title: "Code Review & Pull Request Policy", department: "IFCDC Software Division", focus: "mandatory peer review" },
    { code: "SW-003", title: "Release & Production Deploy Policy", department: "IFCDC Software Division", focus: "stable production deploys" },
    { code: "SW-004", title: "Secure Coding & Secrets Management Policy", department: "IFCDC Software Division", focus: "no secrets in source; secure coding" },
    { code: "SW-005", title: "Architecture Freeze Compliance Policy", department: "IFCDC Software Division", focus: "respecting HQ architecture freeze" },
  ],
  sops: [
    { code: "SOP-001", title: "Standard Operating Procedure Framework", department: "Operations", focus: "how SOPs are written and approved" },
    { code: "SOP-002", title: "Department SOP Maintenance Policy", department: "Operations", focus: "owners keep SOPs current" },
    { code: "SOP-003", title: "SOP Training & Competency Policy", department: "Human Resources", focus: "staff trained on required SOPs" },
    { code: "SOP-004", title: "SOP Deviation & Exception Policy", department: "Operations", focus: "documented exceptions to SOPs" },
    { code: "SOP-005", title: "Cross-Department SOP Coordination Policy", department: "Operations", focus: "shared workflows across departments" },
  ],
};

function buildPolicy(category: PolicyCategoryId, topic: Topic): LibrarySeedPolicy {
  const catLabel = policyCategoryLabel(category);
  const number = `IFCDC-${topic.code}`;
  return {
    title: topic.title,
    number,
    department: topic.department,
    category,
    purpose: `Establish IFCDC standards for ${topic.focus} under the ${catLabel} framework.`,
    why: `IFCDC requires clear ${catLabel.toLowerCase()} rules so staff, volunteers, board members, and partners act consistently, protect the people we serve, and remain grant- and audit-ready.`,
    scope: `Applies to employees, volunteers, contractors, interns, board members, and affiliates whose duties involve ${topic.focus}. Department owners of ${topic.department} lead implementation; all personnel must comply where applicable.`,
    responsibilities: [
      `${topic.department} owns day-to-day administration of this policy.`,
      "Supervisors ensure team members are trained and acknowledge requirements.",
      "Executive leadership resolves escalations and resource gaps.",
      "Compliance / Policy Center tracks reviews, acknowledgments, and version history.",
      "All covered persons follow procedures and report concerns in good faith.",
    ].join(" "),
    procedures: [
      `1) Review this ${topic.title} during onboarding and annual refresher.`,
      "2) Complete required acknowledgments or related training in the Learning & Development Center.",
      `3) Execute day-to-day controls for ${topic.focus} using HQ modules and approved forms.`,
      "4) Document exceptions with supervisor approval and retain evidence in Document Center.",
      "5) Escalate incidents, near-misses, or compliance gaps within one business day.",
      "6) Review this policy at least annually or after material regulatory/operational change.",
    ].join(" "),
    compliance: `Published policies require acknowledgment when designated. Completion is tracked in Policy & Governance and Learning & Development. Noncompliance is reportable to HR/Compliance and may affect grant-funded professional development eligibility.`,
    legal: categoryLegal(category),
    meansWhy: `This policy is important because ${topic.focus} directly affects safety, integrity, funding eligibility, and community trust. Without it, IFCDC risks inconsistent decisions and compliance failures.`,
    meansExpect: `Staff, volunteers, and board members are expected to understand ${topic.title}, follow the listed procedures, ask questions when unsure, and complete related training or acknowledgments on time.`,
    meansConsequences: "If the policy is not followed, IFCDC may require coaching or retraining, restrict system or program access, pause related activities, and apply progressive discipline up to removal from duties or termination. Serious violations may be reported to funders, regulators, or law enforcement when required.",
    meansDepts: `${topic.department}; Executive Administration; Compliance; Human Resources; and any department whose work involves ${topic.focus}.`,
    meansMission: `Following this policy supports IFCDC’s mission by protecting people, strengthening governance, and keeping programs, grants, and technology trustworthy as the organization grows.`,
    related: `Policy & Governance Center › ${catLabel}; Document Center (category=policies); Learning & Development Center course links; related SOPs in Operations.`,
    forms: `${topic.title} Acknowledgment; related checklist/forms in Document Center; training certificate when Learning path assigned.`,
  };
}

function categoryLegal(category: PolicyCategoryId): string {
  switch (category) {
    case "finance_accounting":
    case "procurement":
      return "IRS Form 990 expectations; GAAP for nonprofits; state charity reporting; applicable grant fiscal conditions.";
    case "grants_management":
      return "2 CFR 200 (Uniform Guidance) when applicable; individual award agreements; funder-specific terms.";
    case "privacy_confidentiality":
    case "cybersecurity":
    case "ai_governance":
      return "Applicable privacy and data-security laws; grantor confidentiality clauses; organizational security standards.";
    case "whistleblower":
    case "conflict_of_interest":
    case "code_of_ethics":
    case "board_governance":
      return "IRS nonprofit governance expectations; state nonprofit corporation law; fiduciary duties.";
    case "human_resources":
    case "employee_handbook":
    case "volunteer_management":
      return "Federal/state employment and anti-discrimination laws; youth-protection requirements when applicable.";
    case "youth_programs":
      return "Mandated reporter obligations; youth protection standards; applicable state child-safety requirements.";
    case "health_safety":
    case "emergency_operations":
      return "OSHA where applicable; local fire/safety codes; organizational insurance requirements.";
    case "document_retention":
    case "records_management":
      return "IRS, employment, and grant record-retention minimums; litigation hold duties.";
    default:
      return "Applicable federal/state nonprofit, employment, and program requirements; funder terms when grant-funded.";
  }
}

/** Full foundational library: every category has multiple professionally structured templates. */
export function buildFoundationalPolicyLibrary(): LibrarySeedPolicy[] {
  const out: LibrarySeedPolicy[] = [];
  for (const category of Object.keys(TOPICS) as PolicyCategoryId[]) {
    for (const topic of TOPICS[category]) {
      out.push(buildPolicy(category, topic));
    }
  }
  return out;
}

export function libraryCoverageSummary() {
  return (Object.keys(TOPICS) as PolicyCategoryId[]).map((id) => ({
    id,
    label: policyCategoryLabel(id),
    planned: TOPICS[id].length,
  }));
}
