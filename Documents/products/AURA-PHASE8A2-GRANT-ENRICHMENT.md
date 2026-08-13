# AURA Phase 8A.2 — Grant Data Enrichment & IFCDC Mission Matching

**Status:** Deployed with Funding Intelligence scan/enrich  
**Scope:** Extend Phase 8A only — no auto-submit, no Twilio/SMS/Phase 6 changes

## Flow

Initial Search Hit → Full Official Opportunity Record → Data Enrichment → IFCDC Program Match → Final Eligibility → Enriched Final Score → Verified Qualified Pipeline Value

## Funding confidence

| Status | Meaning |
|--------|---------|
| verified | Ceiling + supporting official fields present |
| partial | Some official amount fields present |
| unknown | No published award amount — **not** treated as $0 |
| conflicting | Official amounts disagree |

Pipeline totals sum **only** `verified` / `partial` numeric values. Unknown-value qualified opportunities are counted separately.

## Program profiles

Table `ifcdc_program_profiles` (extensible by slug): Anti-Gang, Transitional Housing, Youth Programs, Mentorship (TAPIS), Economic Development, Community Programs, Scholarship Program.

Missing HQ facts are listed in `founder_completion_needed_json` — AURA does not invent them.

## APIs

- `GET /api/hq/grants/funding-intelligence/dashboard` (phase `8A.2`)
- `POST /api/hq/grants/funding-intelligence/scan`
- `POST /api/hq/grants/funding-intelligence/enrich`
- `GET /api/hq/grants/funding-intelligence/program-profiles`
- `POST /api/hq/grants/funding-intelligence/ask`
- `GET /api/hq/grants/funding-intelligence/opportunities/:id/explain`

## AURA actions

- `funding_intelligence_scan`
- `funding_intelligence_enrich`
- `funding_intelligence_ask`

## Acceptance

```bash
HQ_TOKEN=… node script/phase8a2-enrichment-verify.mjs
```
