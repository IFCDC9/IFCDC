# AURA Phase 8A.3 — Awardability & IFCDC Addressable Funding

**Status:** Extends Phase 8A.2 Funding Intelligence  
**Constraint:** No auto-submit. No Twilio/SMS changes.

## Core rule

**Total program funding ≠ IFCDC-addressable funding.**

IFCDC Addressable Funding = maximum realistic individual request from official award terms (award ceiling, or derived total ÷ anticipated awards). Full program pots are never treated as a single IFCDC request by default.

## Outputs per opportunity

- Addressable amount + status (`verified` / `partial` / `derived` / `unknown` / `conflicting`)
- Recommended request range
- Match/cost-share flags
- Application Readiness Score (0–100) — separate from Opportunity Match Score
- Readiness class: `ready_now` | `needs_documents` | `needs_program_development` | `needs_matching_funds` | `review_required` | `not_ready`
- Document gap analysis (HQ inventory only — no invented files)
- Awardability Q&A JSON + official source URL

## Dashboard metrics (kept separate)

- Total Qualified Program Funding
- IFCDC Addressable Funding
- High-Priority Addressable Pipeline
- Application-Ready Funding
- READY NOW / needs-* counts
- Pilot recommendation (top 3 + first pilot)

## APIs / AURA

- `POST /api/hq/grants/funding-intelligence/awardability`
- `GET /api/hq/grants/funding-intelligence/pilot`
- Action: `funding_intelligence_awardability`

## Verify

```bash
HQ_TOKEN=… node script/phase8a3-awardability-verify.mjs
```
