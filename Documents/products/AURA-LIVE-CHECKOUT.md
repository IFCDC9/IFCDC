# AURA HQ controlled live checkout verification

## Scope

A separate, Founder-only USD 1.00 live checkout in HQ → Software Engineering. PayPal approval and capture move real money. This limited activation path proves live connectivity and receipt recording before a wider customer rollout. It does not make AURA an unattended payment or spending agent. The sandbox and Barbers integrations are unchanged.

The fixed price and merchant are held server-side. The browser cannot override the price, currency, product or provider host. Creation and capture both require explicit ordinary approval **and** `liveAcknowledged: true`. Authentication requires the configured Founder email and existing Founder authorization, excluding Executive, staff, runner and AURA operator identities. Returning from PayPal never automatically captures or marks a payment complete.

## Review and configuration

Deploy only after reviewing the diff and passing CI. No live credentials are included in this branch or patch. Missing configuration and the absence of `AURA_CHECKOUT_LIVE_ENABLED=true` leave creates/captures disabled. Do not replace sandbox variables or Barbers credentials.

| Render IFCDC-HQ key | Value |
| --- | --- |
| `AURA_CHECKOUT_LIVE_ENABLED` | Initially `false`; set `true` only when the Founder chooses to activate this reviewed implementation |
| `AURA_CHECKOUT_LIVE_ORIGIN` | `https://ifcdc-hq-wst6.onrender.com` (exact browser origin) |
| `AURA_CHECKOUT_LIVE_CLIENT_ID` | New dedicated HQ REST app's **Live** Client ID |
| `AURA_CHECKOUT_LIVE_CLIENT_SECRET` | Same live app's secret, server environment only |
| `AURA_CHECKOUT_LIVE_MERCHANT_ID` | Actual receiving live Business account's Merchant ID; verify the intended IFCDC recipient |

Use the PayPal Developer dashboard's **Live** mode for these credentials. The sandbox Merchant ID `FWR9J2MV6E9VL` must not be reused here. Live variables never fall back to sandbox, generic `PAYPAL_*`, or Barbers variables. Known duplicated sandbox client/merchant IDs are rejected. The live adapter pins `https://api-m.paypal.com`; approval redirects allow only `https://www.paypal.com/checkoutnow` with the exact stored order token.

The five variables are managed directly in Render, without sharing secrets in chat, source files or screenshots. Keep `MASTER_OWNER_EMAIL` matching the Founder login. Keep the existing persistent `IFCDC_DATA_DIR` disk and single HQ service instance. No database replacement, data move, Mac runner restart or sandbox reconfiguration is required.

## Payment record and retry behavior

Live rows use `aura_live_checkouts`, independently of `aura_sandbox_checkouts`. Callback parameters, browser session keys, query keys, API routes, audit actions and PayPal idempotency IDs are also separate. Each row binds its owner, merchant, attempt, state hash and PayPal order. Stable create/capture request IDs make retries reuse the original attempt. A database lease serializes operations. An atomic database insertion limits this verification pilot to three new attempts per Founder per hour; retries reuse their slot.

The server verifies order identity, price, USD currency, expected merchant, product and approval before capture. Only a single final `COMPLETED` USD 1.00 capture can create a completed local receipt. A timeout or invalid response remains unconfirmed. The Founder can recheck a known record through OAuth plus GET order verification; recheck never posts a capture. The three-hour limit blocks initiating an expired capture while still allowing recovery of an already completed capture.

Set `AURA_CHECKOUT_LIVE_ENABLED=false` and redeploy to stop new creates/captures. Keep credentials configured while reconciling an uncertain transaction: authenticated, same-origin, GET-only provider reconciliation remains available even while activation is off. Existing receipts remain readable.

## Activation acceptance

1. Confirm the deployment and the real receiving IFCDC Business account, then configure the dedicated live credentials. Keep activation off until ready.
2. Activate deliberately. HQ must clearly display **USD 1.00**, **LIVE**, and **Real money will be charged**. A sandbox receipt must never appear as a live receipt.
3. Review the real amount and intended merchant before approving on PayPal. Do not share buyer passwords or card details with AURA or chat.
4. Return to HQ. Payment must still be unconfirmed until the separate real-payment approval and Complete live payment action.
5. Confirm the completed live receipt, order ID, capture ID and timestamp. Independently match the capture and amount in the receiving merchant's live PayPal activity. Provider fees may apply.
6. Refresh HQ and confirm the receipt remains. Rechecking the same order must not create an additional charge.
7. Verify a cancellation remains unconfirmed and does not automatically capture. Preserve the earlier successful receipt.
8. If a provider response is uncertain, recheck the existing record before creating another payment. Disable activation if investigation is needed; reconcile without initiating another capture.

No actual live transaction has been performed by automated validation. Enabling this path does not provide a public checkout URL or automatic customer fulfillment.

## Wider customer rollout remains separate

Before accepting general customer orders, build and test the selected product/price catalog, buyer access rules, durable customer order ownership, receipt communications, webhook authenticity and replay protection, fulfillment and reconciliation, and refund/dispute handling. This verification UI records historical successful captures; it does not assert current settlement, available balance, refund state or dispute state. Refunds and disputes remain managed through PayPal until that lifecycle integration is reviewed.

## Validation

The live HTTP/service tests exercise owner isolation, explicit live consent, same-origin protection, fixed pricing, merchant/amount mismatches, idempotent retries, uncertain captures, concurrency, expiration, activation off, atomic limits and sandbox isolation using injected provider responses. Browser-component tests cover real-payment wording, separate capture consent, cancellation and disabled activation. An independent 47-case offline live-adapter regression suite checks the underlying request/response contracts. CI runs the new tests alongside existing sandbox gates. These mocked checks do not prove live connectivity or create charges.

Provider references:
- https://developer.paypal.com/api/rest/production/
- https://developer.paypal.com/api/make-api-requests
- https://developer.paypal.com/api/orders/v2/orders-create
