# AURA Phase 8A.4 — Grant Document Readiness & Evidence Vault

**Status:** Extends Phase 8A.3  
**Constraint:** No invented documents. No auto-submit. No Twilio changes.

## Architecture

Reuses `hq_documents` (+ versions) and `grant_documents`. Adds index tables:

- `grant_evidence_records` — reusable evidence catalog (links to HQ docs / env UEI)
- `grant_opportunity_requirements` — structured checklists per opportunity
- `grant_requirement_evidence_links` — many requirements → one evidence record
- `grant_readiness_gap_reports` — gap snapshots
- `grant_pilot_capacity_audits` — deep pilot audits
- `grant_document_versions` — version history for grant packet files

## Evidence statuses

verified · needs_update · can_generate · missing · unavailable

## Readiness classes (updated)

ready_now · nearly_ready · needs_documents · needs_program_development · needs_matching_funds · review_required · not_ready

## APIs

- `POST /api/hq/grants/funding-intelligence/document-readiness`
- `GET /api/hq/grants/funding-intelligence/evidence-vault`
- `GET /api/hq/grants/funding-intelligence/opportunities/:id/requirements`
- `POST /api/hq/grants/funding-intelligence/pilot-audit`

## AURA action

`funding_intelligence_document_readiness`

## Verify

```bash
HQ_TOKEN=… node script/phase8a4-document-readiness-verify.mjs
```
