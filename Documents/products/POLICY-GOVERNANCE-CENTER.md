# IFCDC HQ — Policy & Governance Center

**Status:** Expanded (July 12, 2026)  
**Route:** `/hq/policies`  
**API:** `/api/hq/policies/*`  
**Related:** Learning & Development `/hq/learning`

## Purpose
Official source of truth for IFCDC policies, procedures, governance documents, and Standard Operating Procedures (SOPs). Complements Document Center (file vault) and Compliance filings (regulatory calendar) without replacing them.

## Foundational library
Gap-fill seeding via `policyGovernanceLibrary.ts` ensures **every category** has a comprehensive set of professionally structured templates (typically 4–6 each), including:

- Policy Title, Number, Purpose, Why Exists, Scope, Roles & Responsibilities  
- Policy Statement (via purpose/procedures), Procedures, Compliance, Legal References  
- Related Forms/Documents, Effective/Review dates, Version History, Approval Status  
- **What This Means** (why important, who it applies to / expectations, consequences, departments, mission)

Seeding is **idempotent by `policy_number`** so existing databases receive new categories without wiping founder edits.

## Governance Progress Dashboard
`GET /api/hq/policies/dashboard` (and UI tab **Governance Progress**):

- Total Policy Categories  
- Total Policies  
- Completed Policies (published + approved)  
- Policies Awaiting Review / Approval  
- Policies Due for Review  
- Overall Governance Completion Percentage  
- Per-category coverage map (ready when ≥3 policies)

## Learning & Development
See `LEARNING-DEVELOPMENT-CENTER.md` — courses link to policies; role paths; quizzes; certificates; grant-funded PD costs.

## Built-in categories (30)
Board Governance, Human Resources, Finance & Accounting, Procurement, Grants Management, Community Programs, Transitional Housing, Youth Programs, Scholarship Program, Economic Development, Information Technology, Cybersecurity, Artificial Intelligence Governance, Privacy & Confidentiality, Risk Management, Health & Safety, Volunteer Management, Employee Handbook, Code of Ethics, Conflict of Interest, Whistleblower Protection, Document Retention, Records Management, Emergency Operations, Business Continuity, Media & Communications, Social Media, Branding & Marketing, Software Development Standards, SOPs.

## Key files
- `server/hq/policyGovernanceEngine.ts`
- `server/hq/policyGovernanceLibrary.ts`
- `server/hq/policyGovernanceCategories.ts`
- `server/hq/learningDevelopmentEngine.ts`
- `client/src/pages/hq/PolicyGovernancePage.tsx`
- `client/src/pages/hq/LearningDevelopmentPage.tsx`
