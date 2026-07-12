# IFCDC HQ — Policy & Governance Center

**Status:** Implemented (July 12, 2026)  
**Route:** `/hq/policies`  
**API:** `/api/hq/policies/*`

## Purpose
Official source of truth for IFCDC policies, procedures, governance documents, and Standard Operating Procedures (SOPs). Complements Document Center (file vault) and Compliance filings (regulatory calendar) without replacing them.

## Policy record fields
Name, number, department, category, purpose, why it exists, scope, responsibilities, procedures, related documents, forms, compliance requirements, legal/regulatory references, effective / last review / next review dates, version, approval status, approved by, electronic signatures, acknowledgment tracking.

### What This Means (plain language)
- Why the policy exists
- What employees, volunteers, board members, or contractors must do
- Consequences if not followed
- Departments affected
- How it supports mission and legal compliance

## Built-in categories (30)
Board Governance, Human Resources, Finance & Accounting, Procurement, Grants Management, Community Programs, Transitional Housing, Youth Programs, Scholarship Program, Economic Development, Information Technology, Cybersecurity, Artificial Intelligence Governance, Privacy & Confidentiality, Risk Management, Health & Safety, Volunteer Management, Employee Handbook, Code of Ethics, Conflict of Interest, Whistleblower Protection, Document Retention, Records Management, Emergency Operations, Business Continuity, Media & Communications, Social Media, Branding & Marketing, Software Development Standards, SOPs.

## Capabilities
| Capability | Endpoint / UI |
|---|---|
| Dashboard KPIs | `GET /dashboard` · page header |
| Advanced search | `GET /search?q=&category=` · Policy Library |
| Categories | `GET /categories` · Categories tab |
| CRUD + full fields | `POST /` · `PATCH /:id` · create form / detail |
| Version history | `hq_policy_versions` · detail panel |
| Approval workflow | `POST /:id/submit` · `/:id/approve` · `/:id/publish` |
| E-signatures | `hq_policy_signatures` |
| Acknowledgments | `POST /:id/acknowledge` · Acknowledgments tab |
| Review reminders | `GET /reviews` + scheduled jobs |
| Audit log | `GET /activity` |
| Compliance report | `GET /report` |
| RBAC | module `policies` · route `hq.documents` |

## Seed library
13 published starter policies (ethics, COI, whistleblower, handbook, finance, grants, housing SOP, AI governance, privacy, retention, cybersecurity, volunteers, software standards).

## Key files
- `server/hq/policyGovernanceEngine.ts`
- `server/hq/policyGovernanceCategories.ts`
- `server/routes/policy.routes.ts`
- `client/src/pages/hq/PolicyGovernancePage.tsx`
- `client/src/api/policiesApi.ts`

## Deploy
1. Push `main`
2. Render Manual Deploy
3. Verify `/hq/policies` library, detail What This Means, acknowledgments, report

## Next
**Build 61 — AI Executive Intelligence (AURA Command Center)**
