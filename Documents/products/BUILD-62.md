# IFCDC HQ — Build 62: Enterprise Human Resources & Workforce Management

**Status:** Implemented (July 12, 2026)  
**Goal:** Unify employees, volunteers, contractors, interns, recruitment, onboarding, performance, training, and workforce analytics into one Enterprise Workforce command surface on People Management Center.

## Delivered

### Workforce HQ (`/hq/people?tab=workforce`)
Build 62 command tabs:
- **Workforce Dashboard** — employees, volunteers, contractors, interns, open positions, recruitments, new hires, training, reviews, attendance, time-off, certifications, org capacity
- **Recruitment** — job requisitions, candidate pipeline, interview/offer/background fields
- **Onboarding** — expanded checklist (welcome → manager approval) with progress
- **Volunteers** — profiles, hours logging, recognition, programs, background/training
- **Performance** — goals/objectives, reviews, improvement signals
- **Training** — required training, cert expiry, compliance/safety/cyber/AI focus
- **Analytics** — staffing, vacancy, retention/turnover proxies, volunteer engagement, capacity

### APIs (`/api/hq/people/foundation/*`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/foundation/dashboard` | Live workforce KPIs |
| GET | `/foundation/recruitment` | Requisitions + pipeline |
| POST/PATCH | `/foundation/requisitions` | Create/update job openings |
| PATCH | `/foundation/applicants/:id` | Interview/offer/background fields |
| GET | `/foundation/onboarding` | Onboarding progress center |
| GET | `/foundation/volunteers` | Volunteer management |
| POST | `/foundation/volunteer-hours` | Log hours |
| POST | `/foundation/volunteer-recognition` | Awards |
| GET | `/foundation/performance` | Goals + reviews |
| POST/PATCH | `/foundation/goals` | Goal CRUD |
| GET | `/foundation/training` | Training & certs |
| GET | `/foundation/analytics` | Executive analytics |
| GET | `/foundation/report` | Workforce executive report |
| POST | `/foundation/ask` | AURA workforce advisor |

### Schema (Build 62 tables)
- `job_requisitions`
- `volunteer_hours`, `volunteer_recognition`
- `people_goals`, `people_equipment`
- Extended `job_applicants` (interview, offer, background, approval, requisition_id)
- Person type: `intern`
- Expanded default onboarding checklist (11 stages)

### Integration
Deep-links to Executive Dashboard, Policies, Documents, Grants, Operations, Compliance, Calendar, Notifications, Payroll. Executive Dashboard Workforce panel points to Workforce HQ.

## Key files
- `server/hq/workforceFoundation.ts`
- `server/hq/peopleSchema.ts` (Build 62 tables + onboarding)
- `server/routes/people.routes.ts` (`/foundation/*`)
- `client/src/components/hq/people/WorkforceFoundation.tsx`
- `client/src/pages/hq/PeopleManagementCenter.tsx`
- `client/src/api/peopleApi.ts`

## Non-goals (freeze-safe)
- No new `@ifcdc/*` packages or microservices
- Does not replace Phase 3 People tabs — Workforce HQ aggregates and extends them
- Deep employee CRUD remains in People profiles
- Legacy Prisma `/api/hr` remains deprecated

## Deploy
1. Push `main`
2. Render Manual Deploy (`autoDeploy: false`)
3. Verify `/hq/people?tab=workforce` tabs + create a requisition

## Next
**Build 63 — Enterprise Finance, Budgeting & Accounting**
