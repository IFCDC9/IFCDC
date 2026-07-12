# IFCDC HQ — Build 60: Executive Operations Center

**Status:** Implemented (July 12, 2026)  
**Goal:** Unify daily IFCDC operations into one Executive Operations Center with live health scores, department command surfaces, enterprise projects/tasks, compliance filings, automation, and executive reporting.

## Delivered

### Executive Operations Dashboard (`/hq/operations`)
Live KPIs via `GET /api/hq/operations/foundation/dashboard`:
- Organization / Operational / Financial Health scores
- Grant, employee, volunteer, program, and client activity
- Open tasks, compliance status, system alerts, upcoming deadlines
- Automation pending approvals + scheduled job counts

### Department Management (13 departments)
Catalog + matrix via `GET /api/hq/operations/foundation/departments`:

| Department | Path |
|---|---|
| Executive Administration | `/hq` |
| Finance | `/hq/finance` |
| Human Resources | `/hq/people` |
| Grants | `/hq/grants` |
| Community Programs | `/hq/programs` |
| Transitional Housing | `/hq/housing` |
| Economic Development | `/hq/programs/economic-development` |
| Education & Scholarships | `/hq/scholarships` |
| Youth & Mentorship | `/hq/programs/mentorship` |
| IFCDC Productions | `/hq/media` |
| IFCDC Software Division | `/hq/software` |
| IFCDC Radio | `/hq/media` |
| IFCDC Music | `/hq/software` |

Each card links to dashboard, documents, and reports. Extra department codes seeded into `departments` when missing.

### Task & Project Management
- `ops_projects` + `ops_milestones` tables
- `ops_tasks.project_id` / `progress_pct` columns
- APIs: `/api/hq/operations/projects`, milestones, existing `/tasks`
- UI: Tasks & Projects tab — create projects, progress sliders, assign tasks to projects

### Employee & Volunteer Management
- Aggregates live People Center counts (employees, volunteers, leave, clients)
- Deep-links to `/hq/people` (profiles, training, certifications, attendance, PTO remain in People Center)

### Compliance Center
- `compliance_filings` table (IRS, state, insurance, licenses, certifications, policies, board, audits)
- Seed baseline filings when empty
- APIs: `/foundation/compliance` CRUD
- UI Compliance tab + link to `/hq/compliance` risk register

### Executive Reporting
- `GET /api/hq/operations/foundation/report` — health, workforce, programs, projects, compliance, departments, alerts
- Reports tab + link to `/hq/reports`

### Automation
- New workflow defs: task_reminder, deadline_notification, compliance_alert, approval_request, department_report_schedule
- New scheduled jobs: ops_task_reminders, ops_deadline_notifications, ops_compliance_alerts, ops_department_reporting, ops_approval_digest
- Automation tab surfaces jobs + pending approvals; links to `/hq/workflows`

## Key files
- `server/hq/executiveOperationsFoundation.ts`
- `server/hq/operationsCommandEngine.ts` (project_id on tasks)
- `server/routes/operations.routes.ts` (foundation + projects routes)
- `client/src/components/hq/operations/ExecutiveOperationsFoundation.tsx`
- `client/src/pages/hq/OperationsCenterPage.tsx`
- `client/src/api/operationsApi.ts`
- `client/src/config/hqNavigation.ts`

## Non-goals (freeze-safe)
- No new top-level packages or backend services
- Does not replace Mission Control (`/hq/phase10`) or Enterprise OS (`/hq/enterprise-os`)
- People HR deep CRUD remains in `/hq/people`

## Deploy
1. Push `main`
2. Render Manual Deploy (`autoDeploy: false`)
3. Verify `/hq/operations` tabs: Overview, Departments, Tasks & Projects, Compliance, Automation, Reports

## Next
**Policy & Governance Center** ✅ (see `POLICY-GOVERNANCE-CENTER.md`)  
**Build 61 — AI Executive Intelligence (AURA Command Center)**
