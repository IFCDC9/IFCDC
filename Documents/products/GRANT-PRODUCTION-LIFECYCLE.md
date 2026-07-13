# Grant Production Lifecycle

**Status:** Phase 1 wired (July 2026)  
**Product:** IFCDC Headquarters / AURA Grants  
**Engine:** `server/hq/grantProductionLifecycleEngine.ts`  
**API:** `/api/hq/grants/production-lifecycle/run`  
**Policy:** HQ never auto-submits to Grants.gov — Founder approve → human portal submit → confirm confirmation ID

## Mission

Prove IFCDC Headquarters and AURA can execute the full enterprise grant lifecycle from opportunity discovery through a submission-ready package using live production data.

## Priorities addressed

| Priority | Capability | Implementation |
|---|---|---|
| 1 | Founder authentication | Founder Mode required on `founder-approval`, `confirm-portal-submission`, pipeline founder decision, `executive/live-workflow` |
| 2 | Grant Workspace | `ensureGrantWorkspaceForOpportunity` + auto-workspace on score/select (composite ≥ 60) |
| 3 | Grant Writer Studio | Existing section endpoints + readiness attached to `buildWriterStudio` |
| 4 | Knowledge Base | Validation checks live KB grounding via `buildGrantGroundingContext` |
| 5 | Validation engine | `computeGrantReadinessReport` → readiness score + gap items |
| 6 | Founder review | `buildFounderGrantReviewPackage` + Approve / Request Changes / Reject / Save Draft |
| 7 | Submission readiness | `buildGrantSubmissionPackage` checklist for Grants.gov portal upload |

## Key endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/api/hq/grants/production-lifecycle/run` | E2E stage report |
| GET | `/api/hq/grants/applications/:id/readiness` | Readiness score |
| GET | `/api/hq/grants/applications/:id/founder-review` | One-click review package |
| POST | `/api/hq/grants/applications/:id/founder-approval` | Founder Mode required |
| GET | `/api/hq/grants/applications/:id/submission-package` | Portal checklist + readiness |
| POST | `/api/hq/grants/applications/:id/confirm-portal-submission` | Founder Mode required |

## Acceptance stages (E2E)

Run as Founder against production (or local with live DB):

```bash
POST /api/hq/grants/production-lifecycle/run
{ "autoDraft": false }
# or pin: { "opportunityId": "<id>", "autoDraft": true }
```

| Stage | Expected |
|---|---|
| Discover grant | PASS — live opportunity selected |
| Analyze eligibility | PASS/WARN — intelligence score |
| Create Grant Workspace | PASS — unique `applicationId` |
| Generate applicationId | PASS — UUID threaded |
| Draft proposal sections | PASS — Writer Studio sections seeded |
| Validate proposal | PASS/WARN — readiness computed |
| Generate Readiness Report | PASS |
| Present for Founder approval | PASS if Founder Mode; else BLOCKED |
| Prepare submission package | PASS after Founder approve; else WARN |

## Production Readiness Report (code-level)

| Stage | Status | Notes |
|---|---|---|
| Founder Mode gates | PASS | Approve / portal confirm / live workflow / pipeline decision |
| Auto workspace + applicationId | PASS | Lifecycle + score-intelligence select path |
| Writer Studio sections | PASS | Existing endpoints; readiness on studio payload |
| Knowledge Base grounding check | PASS | Included in readiness score |
| Validation / readiness score | PASS | `computeGrantReadinessReport` |
| Founder review package + actions | PASS | approve / request_changes / reject / save_draft |
| Submission package (no auto-submit) | PASS | Checklist + confirm endpoint |
| Live E2E on real opportunity | PENDING | Requires Founder run on production after Manual Deploy |

### Remaining blockers for a live PASS on all stages

1. **Production Founder session** — run lifecycle as verified Founder (`role=founder|owner` or master owner email).
2. **Knowledge Base content** — approved IFCDC docs (budget, 501(c)(3), UEI, SAM, programs, etc.) must be synced for high readiness.
3. **Narrative quality** — run `autoDraft: true` (OpenAI configured) or generate full proposal, then Founder approve.
4. **Manual Deploy** — Render `autoDeploy: false`; deploy after push.
5. **Portal submit** — human Grants.gov upload + `confirm-portal-submission` (by design).

## UI

Application Workspace shows Readiness Score, validation chips, Founder Review Package summary, and actions: Approve, Request Changes, Save Draft, Reject.
