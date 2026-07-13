# Executive Action Engine — Production Validation

**Status:** Active priority (July 2026)  
**Product:** IFCDC Headquarters / AURA  
**Success criterion:** Founder can ask AURA to find the best *live* grant, prepare a complete application from real org data, present for approval, record portal submission after approval, and monitor until award decision.

## Compound command planning (required)

AURA must **plan before tools** for multi-step Founder requests. The full natural-language prompt must **never** be inserted into `send_email.body`, `send_sms.message`, or notification fields.

### Founder Operations Acceptance Test

Say: **Run the Founder Operations Acceptance Test**

Planned steps (in order):

1. `verify_founder_session`
2. `check_resend_health`
3. `check_twilio_sms_health`
4. `check_twilio_voice_health`
5. `check_founder_contact_configuration`
6. `check_action_registry`
7. `check_communications_center`
8. `send_email` → only `{ to: service@ifcdc.org, subject: AURA Founder Test, body: <exact test sentence> }`
9. `send_sms` → only `{ to: +18484694448, message: <exact test SMS> }`
10. `create_founder_notification` → only `{ title, message, recipient }`
11. Structured PASS/FAIL report for every step (failure isolation — continue remaining safe steps)

Implementation: `server/hq/auraExecutiveCommandPlanner.ts` + `tryRunExecutiveCommand` in `auraExecutiveOperations.ts`.

### Strict tool schemas

| Tool | Allowed fields only |
|---|---|
| `send_email` | `to`, `subject`, `body` |
| `send_sms` | `to`, `message` |
| `send_notification` | `title`, `message`, `recipient?`, `role?` |

Provider verification: Resend/Twilio must accept the message (`messageId`) and notification records must be created before PASS.

## What AURA executes (not placeholders)

| Capability | Backend | Founder Mode |
|---|---|---|
| Email | Resend (`send_email`) | Required |
| SMS | Twilio (`send_sms`) | Required |
| Voice | Twilio (`place_call`) | Required |
| Calendar | HQ calendar engine | Required |
| Executive / compliance / payroll reports | Mission Control + HQ docs | Required |
| Enterprise diagnostics | Monitoring + Integration Hub | Required |
| Live grant workflow | Grants.gov sync + KB draft + Founder gate | Required |
| Portal submission confirm | Stores confirmation evidence (no Grants.gov auto-submit) | Required + prior Founder approve |
| Grant monitor | Pipeline notifications + aging alerts | Required |

## Live grant workflow (E2E)

1. **Search** — sync live Grants.gov / SAM feeds (`runGrantIntelligenceSync`)
2. **Match** — rank against every IFCDC program (`buildOrgWideGrantMatches`); demo/static/RSS excluded unless explicit env opt-in
3. **Workspace** — `startGrantApplicationWorkflow`
4. **Draft** — full proposal job from Knowledge Base / org data
5. **Gaps** — missing organizational information surfaced for Founder
6. **Founder approval** — `POST /api/hq/grants/applications/:id/founder-approval`
7. **Portal submit** — human completes Grants.gov (HQ never auto-submits)
8. **Confirm** — `POST .../confirm-portal-submission` with portal confirmation ID
9. **Monitor** — pipeline scan + leadership alerts until award/decline

### AURA tools

- `run_live_grant_workflow`
- `queue_grant_submission` (stages only)
- `confirm_grant_portal_submission`
- `monitor_grant_application`

### HTTP

- `POST /api/hq/grants/executive/live-workflow`
- `POST /api/hq/grants/applications/:id/founder-approval`
- `POST /api/hq/grants/applications/:id/confirm-portal-submission`
- `GET /api/hq/grants/applications/:id/submission-package`
- `GET /api/hq/grants/applications/:id/monitor`

## Founder security

- All `kind: "execute"` AURA actions require Founder Mode identity.
- Marking an application `submitted` via PATCH or pipeline transition requires Founder approval **and** portal confirmation ID.
- Acceptance script asserts PATCH-to-submitted without approval is blocked.

## Demo data policy

- `ALLOW_DEMO_SEED`, `ALLOW_STATIC_CSR_FEED`, `ALLOW_GRANTS_GOV_RSS_FALLBACK` must stay unset/`false` in production.
- Boot purges grant seed, HQ sample, and workflow demo rows.
- Live ranking filter: `is_live=1` or `source_type=grants_gov`; excludes seed/static/rss_fallback.

## Enterprise monitoring

- Watchdog (`scheduleEnterpriseMonitoringWatchdog`) retries degraded integrations every ~15 minutes.
- Sustained failures raise Founder leadership alerts with recovery recommendations.

## Validation commands

```bash
# Planner unit (no network)
node script/aura-exec-planner-unit.mjs

# NL Founder Operations Acceptance (after Manual Deploy)
export IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com
export FOUNDER_SEED_PASSWORD='…'   # must match Render
node script/founder-ops-acceptance-nl.mjs

# Grant lifecycle
node script/grant-lifecycle-acceptance.mjs
```
