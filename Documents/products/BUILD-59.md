# IFCDC HQ — Build 59: Enterprise Grant Center Foundation

**Status:** Implemented (July 12, 2026)  
**Goal:** Establish Grant Center as the funding engine of IFCDC HQ with a unified executive dashboard, lifecycle pipeline, workspace, document links, calendar, and executive reporting.

## Delivered

### Executive Grant Dashboard (`/hq/grants` overview)
Live KPIs via `GET /api/hq/grants/foundation/dashboard`:
- Total Active Grants, Grants Awarded, Pending Applications
- Total Funding Requested / Awarded
- Upcoming Deadlines, Submission Status, Success Rate, Compliance Status
- Product-stage pipeline counts + funder-type breakdown + funding forecast

### Grant Pipeline (10 product stages)
Canonical Build 59 vocabulary mapped onto the existing 12-stage engine:

| Product stage | Internal keys |
|---|---|
| Opportunity Identified | discovered |
| Under Review | matched |
| Eligibility Verified | qualified |
| Application In Progress | drafting, ready_for_submission |
| Internal Review | internal_review, founder_approval |
| Submitted | submitted |
| Under Evaluation | under_review |
| Awarded / Declined / Closed | same |

Board: `GET /api/hq/grants/foundation/pipeline`  
Transitions continue through existing `pipeline/enterprise/transition` with audit activity.

### Opportunity Database Taxonomy
Funder types: **Federal · State · County · Municipal · Foundation · Corporate · Private**  
- Taxonomy API: `/foundation/taxonomy`  
- Filtered list: `/foundation/opportunities`  
- Create Opportunity form requires funder type

### Grant Workspace
`GET /api/hq/grants/foundation/workspace/:applicationId` + UI enrichment in Application Workspace:
- Opportunity summary, eligibility, funding, deadlines
- Required-document checklist (IRS, SAM, UEI, CAGE, board, financials, budgets, policies, resumes, letters, narratives)
- Linked `grant_documents` + `hq_documents` + `grant_links`
- Activity audit trail

### Document Integration
- Documents tab deep-links to `/hq/documents?category=grants`
- `POST /foundation/links` uses `grant_links` for formal entity↔document linking
- Existing Document Center → grant_documents bridge retained

### Calendar Integration
`GET /api/hq/grants/foundation/calendar` aggregates:
- Submission deadlines, reporting deadlines, renewals, internal review / compliance milestones

### Executive Reporting
`GET /api/hq/grants/foundation/report` — funding forecast, active opportunities, upcoming deadlines, award pipeline, funding by program/department, performance metrics

## Key files
- `server/hq/grantFoundationEngine.ts`
- `server/routes/grants.routes.ts` (foundation routes)
- `server/hq/grantFundingPipelineEngine.ts` (product labels)
- `client/src/components/hq/grants/GrantFoundationDashboard.tsx`
- `client/src/pages/hq/GrantCenterPage.tsx`
- `client/src/api/grantsApi.ts`

## Deploy
1. Push `main`
2. Render Manual Deploy
3. Verify `/hq/grants` overview foundation KPIs, pipeline board, calendar milestones, documents vault link

## Next
**Build 60 — Executive Operations Center**
