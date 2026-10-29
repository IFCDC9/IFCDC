# HQ readiness assessment

The assessment screen previously called operational integration tests: the Twilio
test could sync production voice/SMS webhooks, and the PayPal test created an
uncaptured checkout order. Its email check also required Resend instead of
recognizing the configured Postmark transport. This change gives assessment its
own reviewed connection probes rather than invoking those operational tests.

## Behavior

- `Run Read-only Assessment` checks OpenAI model-list access, Twilio account and
  phone configuration, the configured transactional email server, PayPal OAuth,
  and database connectivity. It does not repair webhooks, send mail/SMS, place
  calls, create checkout orders, capture/refund funds, or deploy changes.
- It saves its run and findings to HQ audit tables. "Read-only" refers to live
  operations and connections, not to those internal assessment records.
- Reviewed configuration/schema module reads can run. Combined operational
  builders are explicitly UNVERIFIED, never silently executed. Providers without
  a reviewed read-only probe (including SAM.gov/QuickBooks here) are UNVERIFIED.
  They need a separate scoped check; this does not establish that they failed.
- Grants, backup/restore, memory, engineering, permissions, notifications, and
  application flows each have an explicit pending acceptance test. Connection
  and configuration evidence cannot certify these flows. No actual recovery,
  submission, send, booking, or payment is performed by this assessment.
- Numeric results describe only scored checks, not implementation completion.
  Missing runs show `Not assessed`, categories with no scored checks show
  `Unscored`, and dashboard request failures show `Unavailable` with the error.
- Aura handles broad HQ assessment and assessment-revision questions before
  keyword action routing. It explains saved evidence and its timestamp without
  creating a code diagnosis or claiming new probes ran. Software Division access
  is checked before reading readiness records. Explicit run commands retain the
  existing Founder restriction and invoke the new non-mutating assessment path.
- Command search combines local HQ navigation with remote results, so Enterprise
  Readiness is available even when the remote search index is empty or offline.
  Existing route/API authorization remains enforced.

## Validation and release

Tests cover the user's original misrouted prompt through the actual dispatcher,
role denial, unknown/stale evidence, a real isolated assessment run, the PayPal
authentication-only path, Postmark GET-only probing, and offline navigation search.
Provider responses are mocked and the database is isolated: no live operational
requests, financial transactions, sends, or setting changes are used in testing.

After Founder review, merge into IFCDC9/IFCDC and deploy IFCDC-HQ. First verify
search finds Enterprise Readiness; ask Aura what remains before HQ is fully
operational, then open the assessment page. Run one assessment and inspect the
checklist, timestamps, failed probes, and pending acceptance evidence. Perform
end-to-end acceptance tests separately, with explicit authorization for any
transaction, send, restore, or production change. A successful deployment alone
does not establish HQ completion. Revert this commit to roll back the change.
