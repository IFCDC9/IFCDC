# IFCDC client engagement workflow

## Release behavior

A submitted design can now move through a private scope and delivery workflow without granting the client HQ access.

Founder workflow: HQ → Software Engineering → Client project production queue → Review / update progress. The new scope panel offers a project-specific USD quote, a private project conversation, preview/handoff sharing, and a decision history.

Client workflow: https://ifcdc.org/client → sign in → project → Scope, costs, messages & delivery. Clients can review and accept or decline a quote, send project messages, open delivery links, request changes, and explicitly approve the handoff.

A quote contains:

- One-time build cost and monthly maintenance cost, stored as integer cents. No preset commercial prices are activated by this release.
- Specific deliverables, maintenance allowance, monthly-service start, cancellation terms, excluded costs/taxes, schedule, and expiry.
- Expiry within 90 days; maximum supported build cost $100,000 and monthly cost $10,000. A zero fee is allowed when explicitly quoted.

An acceptance is tied to the current stored revision and requires a client confirmation checkbox. Stale, withdrawn, declined, or expired quotes cannot be accepted. Founder cannot replace or withdraw accepted terms; a separate change-agreement workflow is not implemented. Accepted terms remain visible to the client.

Delivery requires an accepted quote. Founder shares a summary, at least one HTTPS preview/handoff link, and completed checks/known limitations. Client can request changes with a useful description; Founder can share a revised delivery. Explicit handoff approval preserves the accepted delivery. Progress-stage controls remain separate from these client decisions; manually changing a queue stage is not client approval, a payment receipt, or deployment proof.

## Boundary and durability

- Existing independent client sessions, same-origin checks, and server-side project ownership apply to every new client route.
- Founder endpoints require the configured Founder identity and owner/founder role. No new HQ users, staff roles, or credentials are created.
- New tables: `ifcdc_client_engagements`, `ifcdc_client_engagement_history`, `ifcdc_client_messages`. Existing project/HR/payment tables are not migrated or deleted.
- Revision comparisons and a SQLite audit trigger save each quote/delivery change and its history entry atomically. Conflicting requests return 409.
- Messages use client-generated UUID request references. Retrying the same message is idempotent; another actor cannot reuse its reference. Message body limit: 2,000 characters; 100 sends per actor per hour; 1,000 messages per project; cursor pagination in batches of 100. Messages are rendered as text.
- Decision attempts are limited to 100 per client per hour. Both new API surfaces use a 16 KB JSON request limit.
- No quote, message, decision, or delivery link is placed in the public content feed.
- The website retains quote/delivery history and conversations. Privacy/terms pages describe this behavior.

## External providers and billing

Accepting a quote does not charge the client, activate monthly billing, send email, reserve paid AI credits, or automatically deploy code. A price shown in a quote is not a payment receipt. The existing donor/supporter checkout is not reused for client services.

Project payment collection, recurring service authorization, invoices/refunds, direct private file storage, separate applicant/staff/admin portals, and autonomous finished-product generation remain unfinished. These are distinct launch requirements, not hidden functionality implied by the new buttons.

Project conversations are in-portal only. This release sends no message notification emails. Existing code-email sign-in is unchanged. No new provider credentials or paid services are required for this workflow.

Preview/handoff links are stored privately and opened only by the client. The server never fetches them. The external hosting/file service controls actual access and retention; do not share private source or credentials through a publicly accessible URL. HTTPS and public-hostname validation is not a malware or availability check.

## Verification

Automated checks cover exact money handling, consent, quote expiry/replacement, concurrent decisions, immutable accepted terms, ownership attacks, foreign-origin requests, Founder access, message idempotency/pagination, revision requests, delivery approval, and safe DOM rendering. The real React Founder panel is exercised with a fixture API and browser DOM; the client portal DOM tests exercise the corresponding client controls. All providers in tests are mocked.

Production build and server type checking are required before packaging. Existing website/designer/Runway and payment regression suites must remain green. A real headless-browser run was attempted in the authoring environment, but Chromium was unavailable and its download returned an invalid archive; desktop/phone rendering of this extension is therefore still a required browser acceptance check. DOM tests are not a substitute for that check.

## Deploy and verify

Apply this patch to main after merged PR #49 (`5f26556811125aa66609a0a6bf6979d70d261810`), create a new PR, and wait for both CI jobs to pass. Manually deploy the existing IFCDC-HQ service, preserving its persistent data directory, existing environment, business email, payment configuration, and backups. Keep the Render subdomain enabled for existing payment callbacks/webhooks.

1. Sign in as a real client and submit a design. Verify the code actually reaches the mailbox.
2. As Founder, issue a complete test quote with explicit costs and exclusions. Client checks displayed terms and accepts it.
3. Exchange a project message in each direction; reload and verify persistence and account isolation.
4. Share an authorized preview/handoff. Client requests a change; share a revision; client approves the handoff. Confirm decision history and accepted-term preservation.
5. Check desktop and phone layouts, keyboard navigation, error recovery, and logout clearing private content.
6. Confirm Founder-only HQ access, current independent backup/restore evidence, and live Render resource behavior. Local fixture performance is not a production capacity guarantee.

This release completes the quoted-scope/conversation/delivery-review workflow. It does not certify the entire IFCDC business platform as production-ready.
