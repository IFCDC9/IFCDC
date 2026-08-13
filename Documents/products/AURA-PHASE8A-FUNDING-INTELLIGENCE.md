# AURA Funding Intelligence — Phase 8A

**Status:** SHIPPED (incremental)  
**Date:** August 13, 2026  
**Constraint:** Extends existing Grant Center. Does not touch Twilio/SMS/Phase 6–7 AURA core. No autonomous submit.

## Audit reuse (before build)

| Need | Reuse |
|------|--------|
| Opportunities store | `grant_opportunities` |
| Applications / awards / deadlines / documents | Existing tables |
| Grants.gov live ingest | `grantFeedConnectors` + `grantsGovIntegrationEngine` Search2 |
| Program catalog | `IFCDC_FUNDING_DIVISIONS` |
| Audit trail | `grant_activity` + new `grant_audit_events` |
| Dashboard shell | `/hq/grants` overview + Foundation dashboard |

**Added (8A.3):** Awardability verification, IFCDC addressable funding (separated from total program funding), application readiness scores/classes, document gaps, pilot recommendation. See `AURA-PHASE8A3-AWARDABILITY.md`.

## Pipeline

Official sources → ingest → eligibility → program match → 0–100 score → dedupe → HQ records → Founder dashboard → AURA ask/tools → ops events

## Scoring weights

Mission 25 · Eligibility 25 · Program fit 15 · Geography 10 · Award 10 · Deadline 5 · Org readiness 5 · Compliance 5

## APIs

- `GET /api/hq/grants/funding-intelligence/dashboard`
- `POST /api/hq/grants/funding-intelligence/scan`
- `POST /api/hq/grants/funding-intelligence/ask`
- `GET /api/hq/grants/funding-intelligence/opportunities/:id/explain`

## AURA actions

- `funding_intelligence_scan` (prepare)
- `funding_intelligence_ask` (read)

## Security boundary

May search/ingest/analyze/verify/match/rank/store/monitor/recommend.  
May **not** submit, sign, accept awards, move money, or payroll.

## Verify

```bash
HQ_TOKEN=… node script/phase8a-funding-intelligence-verify.mjs
```
