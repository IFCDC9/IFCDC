# AURA HQ sandbox checkout pilot

Founder-only test checkout in HQ → Software Engineering. Fixed USD 10.00, PayPal sandbox only. No real money, fulfillment, public checkout, subscription, webhook, refund handling, or live-mode fallback. The Barbers production payment integration is separate and unchanged.

## Implementation

The panel calls authenticated HQ create/capture/recheck endpoints. The server holds credentials, fixes the amount and merchant, persists an owner-bound attempt before calling PayPal, and returns a validated `https://www.sandbox.paypal.com/checkoutnow` approval link. PayPal redirects back to the same HQ page. Returning never marks the payment complete and never automatically captures. The Founder separately approves completion; the adapter checks the stored order, merchant, amount, product and buyer approval before capture, then verifies a single final completed USD 10.00 capture.

Each attempt has stable create and capture idempotency IDs. A database lease prevents parallel operations. Timeouts leave an unconfirmed record; retry uses the same attempt. Recheck performs OAuth and GET order verification only; it cannot capture funds. Verified receipts retain order ID, capture ID, owner and verification time. Audit metadata excludes credentials, provider bodies and payer information.

Cookie-authenticated mutations require same-origin JSON, explicit approval, a matching stored state and order ID for capture, and the configured Founder email plus existing Founder authorization. Neither AURA's operator identity, an Executive identity, staff nor runner credentials can initiate this pilot. Sandbox order creation is capped at ten attempts per Founder per hour. New captures expire after three hours; verification of an already completed order remains available.

## Configure on IFCDC-HQ in Render

These are NEW dedicated sandbox variables. Do not reuse, overwrite or expose live Barbers credentials.

| Variable | Value |
| --- | --- |
| `AURA_CHECKOUT_SANDBOX_ENABLED` | `true` |
| `AURA_CHECKOUT_SANDBOX_ORIGIN` | `https://ifcdc-hq-wst6.onrender.com` (the exact origin used to open HQ) |
| `AURA_CHECKOUT_SANDBOX_CLIENT_ID` | Client ID from a PayPal **sandbox** REST app |
| `AURA_CHECKOUT_SANDBOX_CLIENT_SECRET` | Secret from that same sandbox app; server environment only |
| `AURA_CHECKOUT_SANDBOX_MERCHANT_ID` | Merchant ID of that app's **sandbox business** account |

`MASTER_OWNER_EMAIL` must match the actual Founder login. Keep the existing `IFCDC_DATA_DIR` on the existing persistent Render disk. Records use the HQ SQLite database at `IFCDC_DATA_DIR/ifcdc.db`; do not move or replace that database. Use one service instance with the existing disk for this pilot. Multiple instances with independent SQLite stores are not supported. Missing or invalid setup leaves the pilot disabled. Disabling the enable flag blocks new provider operations and retains existing records.

Merge and deploy this branch to **IFCDC-HQ**, following Founder approval. It does not require rebuilding/restarting the Mac runner. It does not enable live payments.

## Founder acceptance test after deployment

1. Open HQ → Software Engineering → AURA sandbox checkout. Sign in with the configured Founder account. Confirm the price is USD 10.00 and the sandbox notice is present.
2. Approve the test and select Start sandbox checkout. Sign into PayPal with a **sandbox personal buyer**, distinct from the merchant business account. Do not use a real PayPal login or real card.
3. Approve on PayPal. Returning to HQ must still show Payment not confirmed. Check the approval and select Complete sandbox payment. Confirm Verified sandbox payment, order ID, capture ID and verification time appear.
4. Check the same completed transaction and amount in the sandbox merchant's PayPal activity. Save the order and capture IDs as acceptance evidence, without payer information or credentials.
5. Refresh HQ: the receipt must remain. Recheck/repeat capture requests must not create another capture.
6. Run a separate cancellation test: cancel on PayPal; HQ must not show a verified payment or initiate capture automatically.
7. If a timeout or uncertain response occurs, use Recheck payment on that record before creating a separate test. If recheck reports no completion, continue the existing checkout attempt; do not infer that money moved from a redirect or an alert.

If browser session storage was lost, use Recheck payment to recover an already completed payment. The return state is intentionally not recoverable for initiating a fresh capture; an expired/unapproved checkout may require a separate test after reviewing the prior record.

## Validation and boundaries

Automated service/HTTP/browser-component tests inject provider responses; they do not contact PayPal. The existing trusted 47-case contract suite remains unchanged. CI runs both the pilot regression tests and the trusted contract suite. These are separate from the real sandbox acceptance steps above. Production build is required. Real provider connectivity, sandbox credentials and successful buyer approval/capture are only established by the deployed acceptance test.

Live payments require a separate reviewed implementation and approval. This pilot does not add a general payment tool to AURA chat or permit unattended spending.

## Provider references

- https://developer.paypal.com/api/orders/v2/orders-create
- https://developer.paypal.com/docs/api/orders/v2/
- https://developer.paypal.com/checkout/integrate

The integration uses Orders v2, `payment_source.paypal.experience_context` for return/cancel URLs, and server-side capture/verification. No new browser SDK dependency is required for the hosted approval redirect.
