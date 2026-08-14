# AURA Phase 8A.5 — Evidence Vault Population & Organizational Readiness

## Goal

Populate and verify core IFCDC organizational evidence so qualified opportunities can move:

`NEEDS DOCUMENTS → NEARLY READY → READY NOW`

Operating flow:

**HQ Document Center → Evidence Vault → Verification → Expiration tracking → Requirement matching → Readiness recalculation → Next-best pilot**

## Constraints

- Extends Document Center / Evidence Vault (no fourth file store)
- Does **not** invent documents or fill unknown org-profile fields
- Does **not** autonomously submit grants
- Does **not** promote Lead-Safe / Healthy Homes Financing (`do_not_pursue`) as first pilot
- Banking evidence is status-only (present/missing) — no account numbers in AURA payloads
- Does not modify Twilio, SMS, voice, or Founder auth

## Engine

`server/hq/auraGrantEvidencePopulationEngine.ts`

| Export | Purpose |
|--------|---------|
| `auditExistingHqEvidence` | Inventory catalog types vs HQ docs / vault |
| `buildFounderEvidenceActionQueue` | Prioritized missing evidence by #/value of blocked opps |
| `buildIfcdcOrganizationalGrantProfile` | Verified-fields-only reusable org grant profile |
| `verifyEvidenceRecord` | Verify + rematch affected opportunities |
| `rematchOpportunitiesForEvidence` | Incremental readiness recalculation |
| `scanEvidenceExpirations` | Expired / expiring-soon operational events |
| `recalculateAllQualifiedReadiness` | Full qualified batch + next pilots |
| `selectNextPilotCandidates` | Top 5 + recommended first pilot |
| `buildProgramFundingReadinessView` | Per-program readiness / addressable $ |
| `runPhase8A5PopulationCycle` | Full acceptance cycle |

## Schema (`migrateGrantPhase8A5`)

- `ifcdc_org_grant_profiles`
- `grant_evidence_unlock_events`
- `grant_evidence_records.associated_opportunity_ids_json`

## APIs

- `POST /api/hq/grants/funding-intelligence/evidence-population`
- `GET /api/hq/grants/funding-intelligence/evidence-audit`
- `GET /api/hq/grants/funding-intelligence/founder-evidence-queue`
- `GET /api/hq/grants/funding-intelligence/org-grant-profile`
- `POST /api/hq/grants/funding-intelligence/evidence/verify`
- `POST /api/hq/grants/funding-intelligence/select-next-pilots`
- `GET /api/hq/grants/funding-intelligence/program-readiness`

## AURA action

`funding_intelligence_evidence_population`

## AURA questions supported

- What IFCDC documents are still missing?
- What document should I upload next?
- Which document unlocks the most grant money?
- How many opportunities become ready if I upload this document?
- Which grants are READY NOW?
- How much application-ready funding do we have?
- What is our next best pilot?
- Why did you reject the previous pilot?
- Which IFCDC program should we fund first?

## Acceptance

```bash
HQ_TOKEN=… node script/phase8a5-evidence-population-verify.mjs
```

Phase 8A.5 is complete when audit + Founder queue exist, readiness recalculated for qualified set, Lead-Safe is not first pilot, Top 5 + recommended pilot returned, and AURA can explain highest-unlock evidence. **No submissions.**
