# Grant data integrity correction

This change targets IFCDC-HQ (IFCDC9/IFCDC), following the October 29 Founder review.
It does not update the Barbers backend, submit grants, move money, delete records,
or attest organization facts on the Founder's behalf.

## Behavior

- Production grant QA stops before application, narrative, template and funder
  fixture writes. A request-level guard rejects non-read requests except login.
- Working application lists, Grant Intelligence dashboard, core dashboard,
  Foundation reports and enterprise pipeline metrics/boards exclude the known
  quarantined opportunity and exact timestamp-tagged QA applications. Links to
  QA opportunities are also excluded. Null-linked legitimate applications remain.
- QA opportunity matching uses both the generated title and `QA Foundation`.
  Manual opportunities, ordinary closed records, and similarly named legitimate
  records remain stored and are not broadly hidden by funder or substring alone.
- Historical rows and narratives remain intact. Direct inspection is preserved;
  this is a read-time exclusion, not a destructive cleanup migration.
- Writer coverage says `draft sections filled`; neutral coverage badges and an
  explanation distinguish text presence from factual accuracy, eligibility,
  budget verification and Founder approval. Failed readiness loading no longer
  falls back to section completion as a readiness score.
- Current Finder and lifecycle buttons use listing availability. Both the start
  workflow and linked manual application endpoint reject closed/expired or
  malformed-deadline listings. Eligibility is rechecked against listing status
  and deadline for drafting and approval. Date-only dates are inclusive in
  America/New_York; callers still must check the official notice's cutoff time.
- Missing/rolling deadlines permit an intake shell only and explicitly require
  official-notice review before drafting. A shell no longer copies a listing's
  maximum award into its requested budget or marks an opportunity eligible.
  Research scoring and score-based schema backfill also leave eligibility pending;
  only a current document-backed review permits the eligible status.
- Newly generated IFCDC narratives are checked against the verified organization
  name. A conflicting Center/Corporation expansion rejects the output before it
  is saved. Approval also blocks conflicting older drafts. Existing text is never
  silently rewritten, and this does not validate other factual claims.

## Validation and limits

Regression tests use temporary SQLite databases and mocked model output. They
exercise actual application lists, funding dashboard totals, Foundation totals,
enterprise pipeline metrics/board, expired-start refusal and name-drift gates.
There is no authenticated access to production data in this environment. The
live 70-draft/$2,950,000 figures must be reloaded after deployment; no corrected
production count or amount is claimed here. Test-shaped records manually renamed
without a QA opportunity link cannot be inferred safely and need separate review.
Existing QA library templates and contacts remain stored; this patch prevents
new production QA creation rather than silently deleting historical artifacts.

## Release acceptance

1. Merge the reviewed change into IFCDC9/IFCDC and deploy IFCDC-HQ.
2. Reload Grant Center and confirm the reviewed `qa-grant-<timestamp> Application`
   rows no longer appear in working applications or contribute to displayed totals.
3. Confirm Writer Studio labels section coverage separately from readiness.
4. Confirm the expired 2024 listing displays an unavailable action.
5. Use a current real opportunity to review document-backed organization facts,
   official eligibility, a supported budget and narrative through Founder review.
   Do not submit during verification.

Local regression suite: hq-grant-data-integrity, hq-grant-eligibility-review,
hq-grant-qa-fixture-quarantine, hq-grant-founder-funding-view and hq-grant-center-tabs.

Validation commands: `node --import tsx --test` for the four server/data suites and the Founder UI integrity suite;
`node --import tsx --test --test-force-exit script/hq-grant-center-tabs.test.ts`
for the two existing DOM tests (their shared UI timer keeps the process alive).
TypeScript: `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
Production build: `node --import tsx script/build.ts`.
