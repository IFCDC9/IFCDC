# Executive Action Engine — Production Validation

**Status:** Active priority (July 2026)  
**Product:** IFCDC Headquarters / AURA  
**Success criterion:** Founder can ask AURA to find the best *live* grant, prepare a complete application from real org data, present for approval, record portal submission after approval, and monitor until award decision.

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

## Validation command

```bash
export IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com
export MASTER_OWNER_EMAIL=service@ifcdc.org
export FOUNDER_SEED_PASSWORD='…'
node script/grant-lifecycle-acceptance.mjs
```

After Manual Deploy on Render, run the Founder prompt in AURA:

> Find the best live grant for IFCDC, prepare the complete application using our real organizational data, present it for my approval, submit it after approval, monitor the application, and keep me informed until a final award decision.

Expected behavior: package staged for approval → you approve → you complete Grants.gov → you (or AURA) confirm confirmation ID → HQ monitors and notifies.
