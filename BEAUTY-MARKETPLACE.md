# IFCDC Beauty Supply — initial foundation

Entry: HQ Barbers workspace `/app/barbershop` → Beauty Supply.
This checkout is IFCDC HQ, not the separate released mobile Barbers application.

Implemented: database-backed product catalog, category/search/fulfillment filters, session bag, stock quantity caps, Founder-only product API, unpublished supplier drafts, explicit agreed commission basis points versus resale pricing, pickup location validation. No supplier brands or prices are fabricated or preapproved.

Founder APIs: GET /api/beauty/manage and PUT /api/beauty/manage (complete product document). Product fields are defined in server/beauty/catalog.ts. Values are integer USD cents; commission is basis points (1500 = 15%). Commission calculations apply only to product subtotal after any future discounts, excluding shipping/tax. This is a calculation primitive, not a payout ledger. Resale products must have null commissionBps. PUT upserts by UUID. Set approved and published only after supplier rights/pricing are confirmed. The database uses the existing IFCDC database path and backup arrangements.

Public GET /api/beauty/catalog returns only approved, published products. Checkout is deliberately disabled: there is no order acceptance, payment charge, stock reservation, supplier fulfillment connection, tax calculation, refund handling or commission payout yet. Bag is memory-only and clears on reload. No chain or distributor is connected.

Next release: native Barbers repository integration; seller onboarding/review and catalog management UI; per-shop inventory; signed supplier terms and inventory feeds; server-priced orders with atomic reservations/idempotency; pickup/shipping validation; payment webhooks; discount/tax/shipping handling; refund reconciliation and seller commission ledger. Add persistent order records before opening checkout. Validate actual deployment storage and restart survival before accepting inventory.

Validation: node --import tsx --test script/beauty-catalog.test.ts; npm run build:client.
