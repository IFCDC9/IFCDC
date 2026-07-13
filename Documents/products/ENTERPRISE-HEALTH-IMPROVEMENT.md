# Enterprise Health Improvement

**Status:** Phase 1 shipped (July 2026)  
**Product:** IFCDC Headquarters  
**Route:** `/hq/enterprise-health`  
**API:** `/api/hq/enterprise-health/*`  
**Engine:** `server/hq/enterpriseHealthImprovementEngine.ts`

## Mandate

- No placeholder scores  
- No manual inflation  
- Unverified categories do **not** count as 50% — they stay unverified and **block 100%**  
- Score rises only when live probes improve after verified repairs  

## 12 categories (equal weight)

1. Infrastructure  
2. Application  
3. API  
4. Database  
5. Communications  
6. AI  
7. Security  
8. Grant System  
9. Workflow  
10. Mobile  
11. Performance  
12. Integration  

Overall = average of categories that have **live** probes.  
`verifiedCoveragePct` = share of categories with live probes.  
`certifiedReady` requires all 12 at 100% with no open critical/high issues.

## Continuous monitoring

Enterprise Monitoring watchdog (~15m) now also runs `runEnterpriseHealthWatchdogTick()`, persists snapshots, and raises leadership alerts on critical failures.

## Production certification path

1. Repair issue in production  
2. Founder Deep Refresh (`POST /api/hq/enterprise-health/refresh`) with live integration tests  
3. Re-probe must pass — only then does the category score rise  
4. Cross-check with Enterprise Readiness Certification (`/hq/enterprise-readiness`) and `npm run enterprise:verify` on Founder Mac / CI  

## Known structural blockers to 100%

| Blocker | Category | Why |
|---|---|---|
| Mobile UAT not recorded | Mobile | No `hq_mobile_readiness_runs` row → category unverified |
| Unhealthy app health URLs | Application | Localhost / missing `HQ_*_HEALTH_URL` fail live polls |
| Missing Twilio / Resend | Communications | Env not set → 0 |
| Missing OpenAI | AI | AURA drafting blocked |
| Empty / failed Grant QA cache | Grants | No completed QA report |
| Degraded integrations | Integration | Hub cards not healthy |
| Failed background jobs | Workflow | Job `lastError` / fail status |

## Improvement plan (priority order)

1. **P0 — Credentials & secrets:** JWT, Resend, Twilio, OpenAI, Founder email  
2. **P0 — App health URLs:** production URLs for Software Division apps (esp. Barbers)  
3. **P1 — Integrations Hub:** repair Render/GitHub/Grants.gov/SAM/PayPal live tests  
4. **P1 — Grant QA:** run production grant center QA; keep Knowledge Base synced  
5. **P2 — Workflows:** clear failed jobs; ensure autonomous / monitoring cadences enabled  
6. **P2 — Performance:** Founder Workspace / dashboard latency (already timed; fix slow sources)  
7. **P3 — Mobile UAT:** Founder device matrix → persist passing run (unlocks Mobile category)  

Every percentage point must be re-earned on a live refresh after the fix.
