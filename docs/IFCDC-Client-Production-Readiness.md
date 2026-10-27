# IFCDC multi-user client portal release

## Implemented

- `/client`: email-code signup/sign-in, private saved-project list, sign-out.
- `/design-app`: authenticated account saves, draft reopening, optimistic version conflict protection, submission to the Founder review queue. Anonymous concept enquiries remain available.
- Independent opaque client session cookie: HTTP-only, Secure in production, SameSite Strict, path `/api/client`, seven-day expiry, server-side revocation. Client tokens are hashed in storage and cannot authenticate to HQ.
- Codes expire after ten minutes, are HMAC-hashed, are single-use, and permit five attempts. Login delivery uses existing Postmark credentials and fixed business sender. No passwords are introduced.
- Server-enforced ownership on every project read/write. Client-provided roles are never granted. Submitted projects lock against further client edits.
- HQ → Software Engineering → Client project production queue: submitted designs, workflow status, version conflict checks, client-visible progress messages, event history. Updating a stage creates no charge and starts no paid generation.
- Production `hqAuthRequired` now admits only the configured `MASTER_OWNER_EMAIL` with owner/founder role. Existing staff/grants-operator human accounts lose access to HQ-protected routes in production. AURA internal service operations remain separate from human logins. Non-Founder HQ UI routes redirect to `/client`.
- All public CDC page footer sign-in links now target `/client`, not HQ.
- Database startup is single-flight with a five-second busy timeout. No journal-mode change, existing-table deletion, or backup replacement occurs.
- HQ public-site monitoring checks the actual client API storage and email configuration in addition to homepage and content feed. This configuration check is not proof of email delivery.

## Verification

205 automated checks passed in total: 41 website/client/creative checks and 164 existing payment regression checks. The full server TypeScript check and production build passed.

Automated tests cover codes, expiry, brute-force limits, cookie separation, ownership attacks, version conflicts, idempotent retry, queue progress, logout revocation, and Founder-only protection. Existing public-site, creative-studio, live-payment, and sandbox-payment regressions run with mocked providers.

An isolated client-database snapshot was restored and passed SQLite integrity and record-count checks. This does not verify the existing live production backup schedule.

A real browser test of the isolated local service completed email-code sign-in, account draft save, submission, project reopening, submitted-project lock, and logout. Desktop and 390px phone layouts had no horizontal overflow or page errors. Postmark was mocked: no real email, payment, or paid AI generation occurred.

Local load test, constrained to one CPU and a 384 MB Node heap limit:

- 100 simultaneous client workflows, 100 verified fixture accounts, 100 durable submitted designs.
- 2,500 HTTP requests: 200 onboarding and 2,300 project operations.
- Zero HTTP errors or ownership/version mismatches.
- Project p95: 373 ms; p99: 567 ms.
- Onboarding request p95: 1,183 ms, using a mocked email provider.
- Peak process RSS: 206 MiB. Runtime: Node 24.22.1. Duration: 6.78 seconds.

Reproduce with `node --import tsx script/client-portal-load.mjs`. It uses a temporary database and local HTTP server, never the live deployment. Raw results are in `IFCDC-Client-Load-Result.json`.

These measurements are not a Render production capacity certificate. They exclude actual email delivery latency, real AI generation, payment calls, long-duration soak, all concurrent HQ background work, and network/storage characteristics of the production service. Do not advertise a maximum number of users based on this single test.

## Deployment and live acceptance

Deploy after CI passes on the existing IFCDC-HQ service. Preserve the persistent disk, database path, Postmark, PayPal, Runway settings, and existing encrypted/external backups. This release creates only new prefixed tables and indexes. No new paid service is provisioned.

Required existing configuration:

- `NODE_ENV=production` for Secure cookies and Founder-only production protection.
- `MASTER_OWNER_EMAIL` must match the Founder's current login, normally `service@ifcdc.org`. Verify this before deploy to avoid locking out the Founder.
- `POSTMARK_SERVER_TOKEN` must be the existing valid private Postmark token; `service@ifcdc.org` must be authorized as sender. A token-present status alone does not prove delivery.
- `IFCDC_DATA_DIR` must point at the existing persistent data directory. Preserve existing backup schedules and independent recovery copies.

After deployment, the release still needs:

1. One real email-code sign-in on `https://ifcdc.org/client`; verify save/reopen, submit, progress update, and logout.
2. Founder login and review-queue access; confirm a non-Founder human account cannot access protected HQ routes.
3. Production observation/load verification under actual Render resources and background workload. Do not run fixture signups or email blasts against production.
4. Existing payment flow smoke check and monitoring after deploy, without gratuitous repeat charges.
5. Current backup success and an isolated restore verification before making a full production-readiness claim.

## Capacity and limits

The current Render service has a persistent disk. Render does not support scaling a disk-attached service to multiple instances. SQLite and local media therefore remain a single-instance architecture. To scale horizontally, move client state to a shared managed database, move media to object storage, separate public workload from private HQ, and introduce shared rate limits and durable background workers before enabling replicas. Do not add replicas around the local SQLite file.

References: https://render.com/docs/disks and https://render.com/docs/scaling

Current account safeguards: five code emails per address/hour, 100 per source IP/hour, 500 globally/hour; five guesses per challenge, 100 verification requests per source IP/hour; 300 project saves per account/hour; 100 saved projects per account; latest 100 submitted queue records displayed. These protect service and email costs and are not a contractual capacity guarantee. Large onboarding campaigns need rate-limit/provider-capacity review.

## Scope not completed by this release

The designer produces concepts and project requests, not arbitrary finished apps. Finished builds, QA, delivery, and maintenance still require production work. The client engagement extension adds project quotes, explicit client approval, private conversations, external preview/handoff links, revision requests, and handoff acceptance. See IFCDC-Client-Workflow.md. Service subscriptions, project payment collection, direct private file hosting, separate staff/admin/applicant portals, and fully automated AURA project fulfilment remain incomplete. Existing donor memberships are not reused for client billing. Proposed commercial prices remain unpublished and unactivated.
