# Grant eligibility reviews and verified organization facts

Opportunity Finder's numerical score is a **research fit score**, not a qualification decision or a probability of winning. A large award, nonprofit registration, or populated eligibility field cannot establish eligibility by itself.

## Founder workflow

1. Search Opportunity Finder across IFCDC's existing program divisions. Select **Review Opportunity** to open a research workspace without automatically generating a proposal.
2. In Writer Studio, expand **Eligibility and verified organization facts**. Confirm the legal name, tax status, service area and current programs against document references. Add only supported experience, partnerships, registrations and financial summaries. Unknown fields stay blank.
3. Open the funder's complete current notice. Record the HTTPS official notice URL, relevant eligibility excerpts and page references, selected component (including its specific ceiling), official calendar deadline, recipient type and every condition. For each condition, record met, unmet, or unknown and a source document or reason. Founder confirmation is required to save.
4. Record a requested amount only after checking the budget. The imported maximum is not a funding request. Without a reviewed request and budget source, the writer must retain a verification placeholder.
5. Draft only when all recorded conditions are met for IFCDC as an organization. The server checks this for individual section assists, legacy AI writing, and full proposal jobs, not just the UI. Save/edit/research remain available while eligibility is unresolved.
6. Review narrative claims and attachments. Founder approval and ready-to-submit checks also require a reviewed amount matching the application's requested amount and no unresolved verification placeholders. Founder approval and external portal submission remain separate actions.

Individual scholarships and school-only awards stay visible for research/referrals or potential eligible partnerships, but do not qualify IFCDC itself as the recipient.

## Evidence, expiration and prioritization

Reviews are tied to the organization facts and the material opportunity fields. Changes to those facts or notice fields invalidate eligibility. Reviews expire after 30 days. A changed review during an AI request causes generation to be rejected instead of returning a draft from stale facts.

Within the matching Opportunity Finder results (the existing bounded result set), verified eligible entries sort first, then unresolved entries, then ineligible entries. Among reviewed eligible entries, more documented multi-year, renewable, general operating and administrative support features sort first; deadlines break ties. These features require review against the notice. No additional feeds or awards are fabricated.

Calendar-only deadlines display consistently across timezones. Date-only review deadlines remain open through the named Eastern calendar day; confirm any earlier funder-specific cutoff in the recorded eligibility conditions before drafting/submission.

## Deployment and first use

Two additive SQLite tables are created on demand: `grant_verified_profile` and `grant_notice_reviews`. Existing applications, narrative versions, backups, credentials, and opportunity imports remain intact. No secret or environment variable is required for this change. Existing applications start in **needs review** until facts and the notice are confirmed. Previously generated narratives are not silently rewritten; review or regenerate them.

The hard-coded legacy profile name changes from “Corporation” to “Center”; the production writer uses the Founder-confirmed legal name rather than that default. Its generation context excludes previously mixed executive context, automatically seeded profile claims and narrative excerpts. Missing data must stay explicit. The model can still make mistakes: outputs require human review.

This release implements a **Founder-reviewed evidence gate**, not autonomous official-notice extraction, document authenticity checking, or a funder's eligibility determination. Source-domain validation is not verification of a document's contents. Review every eligibility condition and any changes on the official site. Other legacy HQ dashboards may still expose heuristic numeric fields named `eligibility`; they cannot bypass the writer/approval gate.

## Validation

- `npm run check` (generate Prisma client first in a fresh checkout).
- `npm run build` (in environments blocking tsx CLI Unix IPC, equivalent build entry point: `node --import tsx script/build.ts`, after `npm run build:packages`).
- `node --import tsx --test --test-force-exit --test-timeout=30000 script/hq-grant-eligibility-review.test.ts script/hq-grant-eligibility-ui.test.ts script/hq-grant-eligibility-auth.test.ts script/hq-grant-center-tabs.test.ts script/hq-grant-feed-preserve-detail.test.ts script/hq-grant-founder-funding-view.test.ts script/hq-grant-qa-fixture-quarantine.test.ts`

Tests use isolated SQLite fixtures and mocked AI responses. They do not spend money, submit an application, access production data or independently authenticate supplied supporting documents.
