# Project payments and transactional notifications

## Client and Founder workflow

1. Founder issues a complete project quote. Client accepts its exact build fee, monthly fee, scope, service start terms, cancellation terms and additional costs. Quote acceptance collects no money.
2. In HQ → Software Engineering → Client project production queue → Review / update progress → Project payments & maintenance, Founder confirms release of the accepted build fee. This is a payment request, not a charge. Zero-dollar fees remain waived.
3. In the private client workspace, open **Scope, costs, messages & delivery**. Review the amount, check the one-time payment consent, choose **Prepare build payment**, then **Open PayPal to approve**. After PayPal approval, return and confirm **Complete approved build payment**. Only a provider-verified `COMPLETED` capture establishes payment. A callback URL, quote acceptance, order approval or subscription activation does not establish payment.
4. Both client and Founder can recheck provider status and read transaction references. Client can download a plain-text payment record. The outbox prepares separate service-payment record emails for the client and Founder. These are not donation receipts.
5. After client-approved delivery and a verified build payment (or waived build fee), Founder releases maintenance authorization with a first-charge date consistent with the accepted quote. It must be between one hour and 90 days in the future. An unstarted maintenance release may be rescheduled; the client's authorization request must match the displayed date. A provider attempt's date and amount cannot be changed through this interface.
6. Client separately consents to the monthly amount, first-charge date and renewal terms, then authorizes the subscription in PayPal. Verified recurring transactions appear separately from subscription status. Client can cancel future renewals with a separate confirmation, even if new checkout has been disabled. Cancellation does not refund prior payments or silently cancel a different project's subscription.

The build payment covers the full accepted build price; this release does not split deposits or milestones. No additional taxes or third-party costs are calculated or charged automatically. Include required charges in the accepted build/monthly amounts or obtain a separate agreement. Existing quotes remain unchanged.

## Deployment configuration

Preserve the current live PayPal credentials, merchant, return-origin and support webhook configuration. No new secrets are required. Set these two Render variables only after deploying the reviewed update:

```text
IFCDC_PROJECT_PAYMENTS_ENABLED=true
IFCDC_PROJECT_NOTIFICATIONS_ENABLED=true
```

The existing support configuration (`IFCDC_SUPPORT_ENABLED`, `AURA_CHECKOUT_LIVE_CLIENT_ID`, `AURA_CHECKOUT_LIVE_CLIENT_SECRET`, `AURA_CHECKOUT_LIVE_MERCHANT_ID`, `AURA_CHECKOUT_LIVE_ORIGIN`, `IFCDC_SUPPORT_PAYPAL_WEBHOOK_ID`) must remain valid. Notifications use the existing `POSTMARK_SERVER_TOKEN` and verified `service@ifcdc.org` sender. Never paste secrets into a client project, email, screenshot or public quote.

Reuse the existing registered PayPal webhook URL ending in `/api/public/support/webhook`. Keep its existing subscriptions and add/confirm these supported events:

- `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`
- `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.UPDATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
- `PAYMENT.SALE.COMPLETED`, `PAYMENT.SALE.REFUNDED`, `PAYMENT.SALE.REVERSED`

Do not replace the existing webhook ID with a different webhook's ID or disable the Render hostname used by that webhook. The shared handler verifies PayPal's signature before dispatching an event to either the support ledger or project ledger. Existing donations and memberships retain their original storage and behavior.

## Notifications and recovery

A production worker discovers durable project events every 30 seconds. Notices cover submission, quotes and decisions, messages, progress, delivery, released payments, verified transaction records and maintenance status. The email contains a workspace link and project reference, not private message content. Recipients come from verified client accounts or the configured Founder address; the browser cannot choose a recipient.

Notification states shown in HQ:

- `QUEUED`: saved for sending, including while sending is disabled.
- `ACCEPTED`: Postmark accepted the message and returned a message ID. Inbox delivery is not established by this state.
- `FAILED`: definite provider rejection; bounded delayed retries, maximum five attempts.
- `UNCERTAIN`: timeout, lost response or interrupted sending. Automatic retries stop to prevent duplicate emails. Inspect Postmark activity and resolve with an operator before any manual retry.
- `INVALID_RECIPIENT`: malformed recipient; no send attempted.

The worker sends at most five queued notices per cycle, 100 per hour globally and 20 per recipient per hour. This bounds bursts but does not promise a monthly email allowance or inbox delivery. Sign-in codes keep their separate existing rate limits. Grant and other system emails retain their existing workflows. Notification discovery begins at installation and does not mass-email historical project conversations.

Payment operations use per-record SQLite leases, stable provider request IDs, an immutable accepted-quote fingerprint, merchant/app binding and unique transaction IDs. A lost create response can retry the same request only inside a conservative provider-retention window (three hours for an order, 48 hours for a subscription). After that, the record requires reconciliation; the application does not create a replacement payment that might duplicate a charge. A cancelled subscription is not automatically restarted. Do not delete billing rows or change PayPal plans manually to work around these guards.

Webhooks provide prompt reconciliation. The production worker also checks up to three older provider records every five minutes; a client or Founder may recheck on demand. Subscription rechecks inspect recent transaction history. This bounded fallback does not replace working webhooks. Failed reconciliation retains the last verified state; it does not invent a paid result. Refunds and disputes must be handled in PayPal; verified refunded/reversed transactions update when supported provider events or rechecks arrive. This release does not automate refunds, dispute responses, tax filings or accounting exports.

All new tables share the existing application SQLite database and persistent disk. Preserve its backup and restore process; this release does not alter backup destinations.

## Validation and launch check

Automated tests use isolated databases and fake PayPal/Postmark transports. They cover owner/Founder boundaries, origins, tampered amounts, consent, stable checkout, concurrent leases, provider mismatch, unknown responses, capture idempotency, refund status, zero fees, maintenance gating, subscription activation versus actual payment, verified recurring transactions, cancellation, signature verification, recipient resolution and outbox retries. Browser testing covers the client journey on desktop and mobile without real charges or real emails.

Local validation: 115 website/client/support/revenue tests passed, 131 existing checkout tests passed, and the final type check and production build passed. A separate Grant Center QA run passed 35 checks but could not pass its live-feed readiness check because this isolated environment reported zero connected grant feeds. This update does not change grant feed code; GitHub CI must still pass before merging.

After deployment and configuration, verify one genuine low-value project payment with an authorized buyer, confirm its completed capture in PayPal and both workspaces, and verify its Postmark record and inbox receipt. Separately verify monthly authorization, first-charge scheduling and cancellation with the buyer. Review the provider dashboard for webhook delivery errors. Do not announce automatic production billing as verified until these checks succeed. This change does not establish multi-user capacity or automatic finished-app delivery.

Official references:

- https://developer.paypal.com/api/orders/v2
- https://developer.paypal.com/api/subscriptions/v1/subscriptions-create
- https://developer.paypal.com/api/subscriptions/v1/subscriptions-transactions
- https://developer.paypal.com/api/rest/webhooks/rest/
- https://postmarkapp.com/developer/api/email-api
