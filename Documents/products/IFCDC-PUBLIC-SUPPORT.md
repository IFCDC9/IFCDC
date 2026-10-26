# IFCDC public support, services, and membership

Public page: `/support` on the existing HQ host, separate from the private HQ login. This is a new public route, not a replacement for the main IFCDC website. No AURA tool can initiate payments or enroll customers without buyer approval.

## Approved offering

- Donations: suggested USD $10, $25, $50, $100, or a custom one-time amount ($1–$10,000).
- Community Supporter membership: USD $10, $20, $40, $60, or a custom amount ($1–$1,000), every month until canceled. Project updates and a monthly newsletter are the stated benefits. The Founder must deliver these benefits; this change does not automate a newsletter campaign.
- Services: software development, music mixing/mastering, and video editing. Quote requests save to HQ; no price, booking, delivery date, or service payment is invented. Agree scope, price, and terms separately.
- Product: Bars & Clippers – Study Edition, reference price $25. The actual Amazon listing controls price, availability, shipping, returns, and fulfillment. The exact listing URL is still required. No purchase link is displayed until configured. No IFCDC payment is collected for the Amazon purchase.

Public mission copy: “Your giving helps IFCDC serve the community and enables us to design, build, and maintain software systems that advance our mission.” Donation and membership terms are distinct; no blanket tax deduction claim.

## Before activation

Merge the reviewed change and deploy IFCDC-HQ. The new public payment switch defaults OFF, independently of the Founder USD $1 verification switch. Preserve existing live credentials, sandbox settings, Barbers settings, persistent disk, and database. No Mac runner update is needed.

Existing live credentials used by this implementation:

- `AURA_CHECKOUT_LIVE_CLIENT_ID`
- `AURA_CHECKOUT_LIVE_CLIENT_SECRET`
- `AURA_CHECKOUT_LIVE_MERCHANT_ID`
- `AURA_CHECKOUT_LIVE_ORIGIN` — `https://ifcdc-hq-wst6.onrender.com`

New Render IFCDC-HQ variables:

| Variable | Value |
| --- | --- |
| `IFCDC_SUPPORT_ENABLED` | Initially `false`; explicitly set `true` after configuring and reviewing the public page and webhook |
| `IFCDC_SUPPORT_PAYPAL_WEBHOOK_ID` | Webhook ID from the SAME live IFCDC HQ AURA Live REST app |
| `IFCDC_SUPPORT_BOOK_URL` | Exact approved HTTPS Amazon.com or a.co listing URL; omit until supplied |

In PayPal Developer → Live → IFCDC HQ AURA Live, add the webhook listener:

`https://ifcdc-hq-wst6.onrender.com/api/public/support/webhook`

Subscribe to:

- `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`
- `BILLING.SUBSCRIPTION.CREATED`, `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.UPDATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
- `PAYMENT.SALE.COMPLETED`, `PAYMENT.SALE.REFUNDED`, `PAYMENT.SALE.REVERSED`

Review the PayPal app's Subscriptions availability before activation. The first approved membership request creates a catalog product with stable ID `IFCDC-COMMUNITY-SUPPORTER-V1` and an exact-price monthly plan for the chosen amount. Subsequent requests reuse that plan. There is no trial, setup fee, extra quantity, tax add-on, or automatic billing of outstanding amounts in the created plans. Do not edit their terms in PayPal while supporters are enrolled. Existing stale plan creation attempts fail closed after 24 hours and require inspection instead of automatically creating another plan.

## Payment methods and limits

One-time checkout uses PayPal's supported v5 JavaScript SDK Buttons with eligible PayPal, card, Venmo, and Pay Later funding. PayPal determines eligibility by merchant, payer, location, browser, and payment type. Recurring membership uses PayPal-hosted subscription approval, whose methods can differ. Do not advertise every funding method as universally available.

Apple Pay, Google Pay, bank transfers, Cash App, Zelle, and offline payments are not implemented by this change. Wallet integrations require their own merchant eligibility, provider setup, and acceptance checks. Stripe is not added. No card numbers or buyer passwords are collected by IFCDC.

## Data, verification, and operational behavior

- SQLite tables prefixed `ifcdc_support_` are separate from the existing Founder and sandbox checkout tables. No schema drops or data moves.
- A random 256-bit browser receipt proof is hashed server-side. Receipt and cancel endpoints require this proof; no receipt is readable by UUID alone. Proofs are never put in callback URLs, external links, HQ records, or logs. Browser session storage survives refresh; closing the session may lose self-service access. Supporters can still manage the subscription in PayPal and contact IFCDC with their PayPal receipt.
- All mutation requests other than signed webhooks require exact configured Origin and JSON. The public parser caps bodies at 100KB. Durable network/global hourly limits bound API activity and quote spam; client body fields cannot supply a rate-limit identity. Hosting proxy settings must preserve the real client address. These bounds do not replace merchant fraud review.
- Create/capture request IDs are stable and attempts expire within 24 hours. Leases serialize mutations. Reconciliation never captures a donation; a lost capture response remains unconfirmed until a provider GET verifies it. No new payment is automatically started after errors.
- Donation amount, USD currency, merchant, custom/local identity, one purchase unit, and single final capture are checked server-side. PayPal approval alone is not a completed donation. Only a verified capture creates a paid receipt.
- Monthly approval is clearly disclosed before redirect. Provider subscription identity, local custom ID, plan, exact monthly price, and lifecycle state are verified. Activation is shown separately from paid recurring transactions; only a signature-verified webhook plus authoritative sale GET creates a recurring payment ledger record.
- Webhook signatures are verified through PayPal's production endpoint with the configured webhook ID and allowed certificate host. Events are deduplicated, and failed processing is retryable; payload prices alone never create a receipt. Unrecognized events are acknowledged without creating records. No server follows caller-provided URLs.
- Each webhook refreshes authoritative current state, so older lifecycle events do not roll state backward solely from their payload. Cancellation remains possible even if an administrator has changed or deactivated a plan.
- Public activation OFF prevents new donation creation/capture and membership enrollment. Existing receipt rechecks, cancellation, and verified webhook reconciliation continue using configured credentials. Turning the switch off DOES NOT cancel existing recurring subscriptions. Cancel those explicitly in PayPal or using the receipt control if desired.
- Founder-only HQ → Software Engineering → IFCDC public support & services lists quote requests, membership contact emails, records, and verified transaction references. No executive/staff/runner identity gains access. AURA is not given a charge/refund action.
- Membership updates/newsletter and quote replies remain Founder-managed. Quote requests do not trigger email or SMS. PayPal handles its own payer payment communications. The public receipt can be printed/saved. Keep the persistent disk and current backup procedures.
- Refunds and disputes remain managed in PayPal. The ledger records gross historical transactions and provider status, not settlement, available balance, fee-adjusted income, or a complete dispute accounting system. Refund/reversal events that cannot be mapped to a known payment require merchant review. Do not promise automatic fulfillment or tax receipts.

## Required acceptance before sharing widely

1. Preview desktop and mobile `/support`, approved terms, contact address, service form, Amazon listing, and active-member newsletter process.
2. Configure the real webhook and confirm successful signed event delivery in the correct live app. Save the webhook ID in Render; never paste secrets in chat or source.
3. Deliberately enable public payments and redeploy. Confirm missing settings fail closed, and unsupported payment methods are not advertised.
4. A consenting buyer reviews a one-time amount and completes checkout. Match the provider capture and amount in merchant activity; refresh the private browser receipt and HQ record. Do not repeatedly create test charges.
5. A consenting supporter explicitly approves a monthly amount. Match subscription plan and first sale in PayPal, verify the signed sale webhook creates a ledger transaction, and distinguish subscription activation from payment success. Test custom amount with injected provider responses before any deliberate real enrollment.
6. Cancel a deliberately enrolled membership. Verify PayPal status and that future renewals stop; cancellation is not a refund. Test missed-callback recovery and duplicate delivery using provider-supported test facilities.
7. Verify that no other browser can read or cancel a receipt without its proof; no HQ login is needed for the public page. Confirm service requests are visible only to the Founder.
8. Complete wallet-specific setup and tests separately before advertising Apple Pay or Google Pay. This branch does not enable those wallets.

## Validation

Automated tests inject provider responses and cover amounts, privacy/ownership, explicit recurring consent, duplicate creation/capture, uncertain capture recovery, limits, monthly plan reuse, cancellation, forged/replayed/failed webhooks, recurring sale amounts and refunds, quote consent, HQ authorization, and browser DOM behavior. No automated test contacts real PayPal, enrolls a real subscriber, or charges funds. Existing Founder and sandbox regression suites remain required.

Provider references:
- https://developer.paypal.com/studio/checkout/standard
- https://developer.paypal.com/subscriptions/integrate
- https://developer.paypal.com/subscriptions/webhooks/
- https://developer.paypal.com/api/rest/webhooks/rest/
