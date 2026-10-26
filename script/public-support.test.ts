import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
const directory = mkdtempSync(tmpdir() + "/ifcdc-support-");
process.env.NODE_ENV = "test"; process.env.IFCDC_DATA_DIR = directory; process.env.MASTER_OWNER_EMAIL = "service@ifcdc.org";
const { createSupportService, supportConfiguration, amountCents, subscriptionApproval } = await import("../server/hq/publicSupport.ts");
const { publicSupportRouter } = await import("../server/routes/publicSupport.routes.ts");
const { getDb } = await import("../server/db.ts");
const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { JWT_SECRET } = await import("../server/config/auth.ts");
const env = { AURA_CHECKOUT_LIVE_ORIGIN: "https://hq.example.test", AURA_CHECKOUT_LIVE_CLIENT_ID: "LIVEAPP", AURA_CHECKOUT_LIVE_CLIENT_SECRET: "PRIVATE_SECRET", AURA_CHECKOUT_LIVE_MERCHANT_ID: "MERCHANT", IFCDC_SUPPORT_ENABLED: "true", IFCDC_SUPPORT_PAYPAL_WEBHOOK_ID: "WH-CONFIGURED" };
let clock = Date.now(); let mode = "normal"; let validSignature = true;
const calls: { path: string; options: any }[] = [];
const orders = new Map<string, any>(); const subs = new Map<string, any>(); const plans = new Map<string, any>(); const sales = new Map<string, any>();
const ids = new Map<string, string>(); let product: any;
const transaction = (order: any) => ({ ...order, status: "COMPLETED", purchase_units: [{ ...order.purchase_units[0], payments: { captures: [{ id: `CAP${order.id}`, status: "COMPLETED", final_capture: true, amount: order.purchase_units[0].amount, create_time: new Date(clock).toISOString() }] } }] });
const provider = async (input: any, options: any) => {
  const url = new URL(String(input)); const path = url.pathname; calls.push({ path, options });
  assert.equal(url.origin, "https://api-m.paypal.com"); assert.equal(options.redirect, "error"); assert.ok(options.signal instanceof AbortSignal);
  if (mode === "fail") throw new Error("PRIVATE_SECRET customer@example.test");
  const body = options.body && options.body !== "grant_type=client_credentials" ? JSON.parse(options.body) : null;
  let data: any; let status = 200;
  const generated = (prefix: string) => { const key = options.headers["PayPal-Request-Id"]; if (!ids.has(key)) ids.set(key, `${prefix}${ids.size + 1}`); return ids.get(key)!; };
  if (path.endsWith("oauth2/token")) data = { access_token: "TOKEN", token_type: "Bearer" };
  else if (path === "/v1/notifications/verify-webhook-signature") data = { verification_status: validSignature ? "SUCCESS" : "FAILURE" };
  else if (path === "/v2/checkout/orders" && options.method === "POST") {
    const id = generated("ORDER"); data = { ...body, id, status: "CREATED" }; orders.set(id, data);
    if (mode === "lost_create") { mode = "normal"; throw new Error("response lost"); }
  } else if (path.startsWith("/v2/checkout/orders/")) {
    const id = path.split("/")[4]; data = orders.get(id); assert.ok(data);
    if (path.endsWith("/capture")) {
      data = transaction(data); orders.set(id, data);
      if (mode === "lost_capture") { mode = "normal"; throw new Error("response lost"); }
    }
  } else if (path === "/v1/catalogs/products" && options.method === "POST") { product = body; data = product; }
  else if (path.startsWith("/v1/catalogs/products/")) { data = product || {}; if (!product) status = 404; }
  else if (path === "/v1/billing/plans" && options.method === "POST") { const id = generated("P-"); data = { ...body, id }; plans.set(id, data); }
  else if (path.startsWith("/v1/billing/plans/")) data = plans.get(path.split("/")[4]);
  else if (path === "/v1/billing/subscriptions" && options.method === "POST") {
    const id = generated("I-"); data = { ...body, id, status: "APPROVAL_PENDING", plan_overridden: false, quantity: "1", links: [{ rel: "approve", href: `https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-${id.replace('-', '')}` }] }; subs.set(id, data);
  } else if (path.startsWith("/v1/billing/subscriptions/")) {
    data = subs.get(path.split("/")[4]); assert.ok(data);
    if (path.endsWith("/cancel")) { data.status = "CANCELLED"; status = 204; }
  } else if (path.startsWith("/v1/payments/sale/")) data = sales.get(path.split("/")[4]);
  else throw new Error(`Unexpected provider endpoint ${path}`);
  return { ok: status < 400, status, json: async () => structuredClone(data) } as Response;
};
const service = createSupportService({ env, fetchImpl: provider, now: () => clock });
const app = express(); app.use(express.json({ limit: "100kb" })); app.use("/support", publicSupportRouter({ env, fetchImpl: provider, now: () => clock }));
const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/support`;
const input = (kind = "donation", amount = "25.00") => ({ id: crypto.randomUUID(), proof: crypto.randomBytes(32).toString("hex"), kind, amount, approved: true, ...(kind === "membership" ? { recurringApproved: true } : {}) });
let ip = 0;
const create = async (kind = "donation", amount = "25.00") => { const value = input(kind, amount); return { value, row: await service.create(value, `network-${ip++}`) }; };
const headers = { "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.paypal.com/v1/notifications/certs/ABC", "paypal-transmission-id": "ID", "paypal-transmission-sig": "SIGNATURE", "paypal-transmission-time": new Date(clock).toISOString() };
const event = (type: string, resource: object, id = crypto.randomUUID()) => ({ id, event_type: type, resource });
test.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await (await getDb()).close(); rmSync(directory, { recursive: true, force: true }); });

test("public activation is separate from Founder live verification; missing webhook and sandbox credentials fail closed", async () => {
  assert.equal(supportConfiguration({ ...env, IFCDC_SUPPORT_ENABLED: "false" }).ready, false);
  assert.equal(supportConfiguration({ ...env, IFCDC_SUPPORT_PAYPAL_WEBHOOK_ID: "" }).ready, false);
  assert.equal(supportConfiguration({ ...env, AURA_CHECKOUT_SANDBOX_CLIENT_ID: "LIVEAPP" }).ready, false);
  const before = calls.length;
  await assert.rejects(createSupportService({ env: { ...env, IFCDC_SUPPORT_ENABLED: "false" }, fetchImpl: provider }).create(input(), "ip"), /not available/);
  assert.equal(calls.length, before);
});
test("catalog exposes only public client ID, approved offerings, and validated Amazon link", async () => {
  const value = await service.catalog(); assert.equal(value.ready, true); assert.equal(value.bookUrl, null);
  assert.deepEqual(value.membershipAmounts, [10, 20, 40, 60]); assert.equal(value.services.length, 3);
  assert.ok(!JSON.stringify(value).includes("PRIVATE_SECRET")); assert.equal(supportConfiguration({ ...env, IFCDC_SUPPORT_BOOK_URL: "https://www.amazon.com.evil.test/dp/X" }).bookUrl, "");
  assert.equal(supportConfiguration({ ...env, IFCDC_SUPPORT_BOOK_URL: "https://www.amazon.com/dp/EXAMPLE" }).bookUrl, "https://www.amazon.com/dp/EXAMPLE");
});
test("money validation uses integer cents and rejects exponent, rounding, negatives, arrays and oversized custom amounts", () => {
  assert.equal(amountCents("20.01"), 2001); assert.equal(amountCents("1"), 100);
  for (const value of ["1.001", "1e2", "-20", "0.99", "NaN", "10001", "01", " 10", 10, null, []]) assert.throws(() => amountCents(value));
  assert.throws(() => amountCents("1001", 100_000));
});
test("creation rejects currency, merchant, price override and missing recurring consent before contacting PayPal", async () => {
  const before = calls.length;
  for (const value of [{ ...input(), currency: "EUR" }, { ...input(), merchant: "OTHER" }, { ...input(), approved: false }, { ...input("membership"), recurringApproved: false }, { ...input(), kind: "product" }, { ...input(), proof: "bad" }]) await assert.rejects(service.create(value, "invalid"));
  assert.equal(calls.length, before);
});
test("donation identity and amount persist; retry creates one order and prevents cross-session receipt access", async () => {
  const { value, row } = await create(); assert.equal(row.amount, "25.00"); assert.equal(row.status, "awaiting_approval");
  const before = calls.length; assert.equal((await service.create(value, "same")).providerId, row.providerId); assert.equal(calls.length, before);
  await assert.rejects(service.create({ ...value, amount: "30.00" }, "same"), /original amount/);
  await assert.rejects(service.recheck(value.id, "a".repeat(64)), /not found/);
  const stored = await (await getDb()).get("SELECT * FROM ifcdc_support_orders WHERE id = ?", value.id); assert.notEqual(stored.proof_hash, value.proof);
});
test("only APPROVED donation captures; server verifies merchant, amount, currency and local order identity first", async () => {
  for (const field of ["merchant", "amount", "currency", "custom_id", "reference_id", "unapproved"]) {
    const { value, row } = await create(); const order = orders.get(row.providerId!); order.status = "APPROVED";
    if (field === "merchant") order.purchase_units[0].payee.merchant_id = "OTHER";
    if (field === "amount") order.purchase_units[0].amount.value = "24.00";
    if (field === "currency") order.purchase_units[0].amount.currency_code = "EUR";
    if (field === "custom_id" || field === "reference_id") order.purchase_units[0][field] = "OTHER";
    if (field === "unapproved") order.status = "CREATED";
    const before = calls.filter(call => call.path.endsWith("/capture")).length;
    await assert.rejects(service.capture(value.id, value.proof, { approved: true, orderId: row.providerId }));
    assert.equal(calls.filter(call => call.path.endsWith("/capture")).length, before);
  }
});
test("completed donation receipt persists; retries never post another capture", async () => {
  const { value, row } = await create(); orders.get(row.providerId!).status = "APPROVED";
  const paid = await service.capture(value.id, value.proof, { approved: true, orderId: row.providerId }); assert.equal(paid.status, "completed"); assert.equal(paid.payments.length, 1);
  const before = calls.length; await service.capture(value.id, value.proof, { approved: true, orderId: row.providerId }); assert.equal(calls.length, before);
  assert.equal((await service.recheck(value.id, value.proof)).payments[0].id, paid.payments[0].id);
});
test("lost provider create response reuses stable PayPal idempotency key", async () => {
  const value = input(); const before = orders.size; mode = "lost_create";
  await assert.rejects(service.create(value, "lost-create"));
  assert.ok((await service.create(value, "lost-create")).providerId); assert.equal(orders.size, before + 1);
});
test("lost capture response is recoverable by GET-only recheck even with public activation off", async () => {
  const { value, row } = await create(); orders.get(row.providerId!).status = "APPROVED"; mode = "lost_capture";
  await assert.rejects(service.capture(value.id, value.proof, { approved: true, orderId: row.providerId }));
  env.IFCDC_SUPPORT_ENABLED = "false"; const before = calls.length;
  assert.equal((await service.recheck(value.id, value.proof)).status, "completed");
  assert.ok(calls.slice(before).every(call => call.options.method === "GET" || call.path.endsWith("oauth2/token")));
  await assert.rejects(service.create(input(), "kill")); env.IFCDC_SUPPORT_ENABLED = "true";
});
test("concurrent captures acquire one lease and create one provider capture", async () => {
  const { value, row } = await create(); orders.get(row.providerId!).status = "APPROVED";
  const before = calls.filter(call => call.path.endsWith("/capture")).length;
  const outcomes = await Promise.allSettled([1, 2].map(() => service.capture(value.id, value.proof, { approved: true, orderId: row.providerId })));
  assert.ok(outcomes.some(result => result.status === "fulfilled")); assert.equal(calls.filter(call => call.path.endsWith("/capture")).length, before + 1);
});
test("hourly limits are durable and atomic, and spoofed client data cannot supply a rate-limit identity", async () => {
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => service.create(input(), "limited-network")));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 8);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason.status === 429).length, 4);
});
test("custom monthly amount creates reusable exact-price monthly plan without trial or setup charge", async () => {
  const { row } = await create("membership", "23.45"); const sub = subs.get(row.providerId!); const plan = plans.get(sub.plan_id);
  assert.equal(row.amount, "23.45"); assert.equal(row.recurring, true); assert.equal(plan.billing_cycles[0].pricing_scheme.fixed_price.value, "23.45");
  assert.equal(plan.billing_cycles[0].frequency.interval_unit, "MONTH"); assert.equal(plan.payment_preferences.setup_fee.value, "0.00");
  const before = plans.size; await create("membership", "23.45"); assert.equal(plans.size, before);
});
test("subscription redirects reject sandbox, foreign hosts, duplicate tokens, userinfo and wrong paths", () => {
  const valid = "https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-123"; assert.equal(subscriptionApproval(valid), valid);
  for (const url of [valid.replace("www.paypal.com", "www.sandbox.paypal.com"), valid.replace("www.paypal.com", "evil.test"), valid + "&ba_token=BA-456", valid.replace("https://", "https://name@"), valid.replace("subscriptions", "other")]) assert.throws(() => subscriptionApproval(url));
});
test("membership activation does not invent a paid receipt, and personal email stays in Founder view", async () => {
  const { value, row } = await create("membership", "20.00"); const sub = subs.get(row.providerId!); sub.status = "ACTIVE"; sub.subscriber = { email_address: "supporter@example.test" };
  const checked = await service.recheck(value.id, value.proof); assert.equal(checked.status, "active"); assert.equal(checked.payments.length, 0);
  assert.ok(!JSON.stringify(checked).includes("supporter@example.test"));
  assert.equal((await service.admin()).records.find((item: any) => item.id === value.id).email, "supporter@example.test");
});
test("changed monthly plan price or subscription identity is rejected on reconciliation", async () => {
  const { value, row } = await create("membership", "40.00"); const sub = subs.get(row.providerId!); const plan = plans.get(sub.plan_id);
  plan.billing_cycles[0].pricing_scheme.fixed_price.value = "41.00"; await assert.rejects(service.recheck(value.id, value.proof));
  plan.billing_cycles[0].pricing_scheme.fixed_price.value = "40.00"; sub.custom_id = "OTHER"; await assert.rejects(service.recheck(value.id, value.proof));
});
test("forged webhook or certificate URL cannot update receipts or trigger external fetches", async () => {
  const ev = event("PAYMENT.SALE.COMPLETED", { id: "SALEFAKE", billing_agreement_id: "I-FAKE" });
  const before = calls.length; await assert.rejects(service.webhook({ ...headers, "paypal-cert-url": "https://evil.test/cert" }, ev)); assert.equal(calls.length, before);
  validSignature = false; await assert.rejects(service.webhook(headers, ev), /signature/); validSignature = true;
  assert.equal(await (await getDb()).get("SELECT * FROM ifcdc_support_events WHERE id = ?", ev.id), undefined);
});
test("verified recurring sale is checked against PayPal, replayed once, and reflected separately from membership status", async () => {
  const { value, row } = await create("membership", "60.00"); subs.get(row.providerId!).status = "ACTIVE";
  const sale = { id: "SALE123", billing_agreement_id: row.providerId, amount: { currency: "USD", total: "60.00" }, state: "completed", create_time: new Date(clock).toISOString() }; sales.set(sale.id, sale);
  const ev = event("PAYMENT.SALE.COMPLETED", { id: sale.id, billing_agreement_id: row.providerId });
  await service.webhook(headers, ev); await service.webhook(headers, ev);
  const record = await service.recheck(value.id, value.proof); assert.equal(record.payments.length, 1); assert.equal(record.payments[0].status, "COMPLETED");
  await assert.rejects(service.webhook(headers, { ...ev, resource: { ...ev.resource, bad: true } }), /identity mismatch/);
  sale.state = "refunded"; await service.webhook(headers, event("PAYMENT.SALE.REFUNDED", { id: "REFUND123", sale_id: sale.id }));
  assert.equal((await service.recheck(value.id, value.proof)).payments[0].status, "REFUNDED");
});
test("failed webhook processing remains retryable and never records a mismatched recurring amount", async () => {
  const { value, row } = await create("membership", "10.00"); subs.get(row.providerId!).status = "ACTIVE";
  const sale = { id: "SALEBAD", billing_agreement_id: row.providerId, amount: { currency: "USD", total: "99.00" }, state: "completed", create_time: new Date(clock).toISOString() }; sales.set(sale.id, sale);
  const ev = event("PAYMENT.SALE.COMPLETED", { id: sale.id, billing_agreement_id: row.providerId });
  await assert.rejects(service.webhook(headers, ev)); assert.equal((await service.recheck(value.id, value.proof)).payments.length, 0);
  sale.amount.total = "10.00"; await service.webhook(headers, ev); assert.equal((await service.recheck(value.id, value.proof)).payments.length, 1);
});
test("donation completed webhook independently records capture; later refund changes its status", async () => {
  const { value, row } = await create(); const order = transaction(orders.get(row.providerId!)); orders.set(row.providerId!, order);
  const capture = order.purchase_units[0].payments.captures[0]; const resource = { id: capture.id, supplementary_data: { related_ids: { order_id: row.providerId } } };
  await service.webhook(headers, event("PAYMENT.CAPTURE.COMPLETED", resource)); assert.equal((await service.recheck(value.id, value.proof)).status, "completed");
  capture.status = "REFUNDED"; await service.webhook(headers, event("PAYMENT.CAPTURE.REFUNDED", resource)); assert.equal((await service.recheck(value.id, value.proof)).status, "refunded");
});
test("cancel future renewals is explicit, owner-bound, available while activation is off, and verified with PayPal", async () => {
  const { value, row } = await create("membership", "15.00"); subs.get(row.providerId!).status = "ACTIVE";
  await assert.rejects(service.cancel(value.id, "f".repeat(64), { approved: true })); await assert.rejects(service.cancel(value.id, value.proof, { approved: false }));
  env.IFCDC_SUPPORT_ENABLED = "false";
  const canceled = await service.cancel(value.id, value.proof, { approved: true }); assert.equal(canceled.status, "cancelled");
  const before = calls.filter(call => call.path.endsWith("/cancel")).length; await service.cancel(value.id, value.proof, { approved: true }); assert.equal(calls.filter(call => call.path.endsWith("/cancel")).length, before);
  env.IFCDC_SUPPORT_ENABLED = "true";
});
test("quote requests validate category, contact consent and spam trap; no payment call occurs", async () => {
  const value = { name: "Customer", email: "customer@example.test", service: "Video editing", message: "Please quote a short community video.", consent: true, website: "" }; const before = calls.length;
  const saved = await service.inquiry(value, "quote"); assert.ok(saved.id); assert.ok((await service.admin()).inquiries.some((item: any) => item.id === saved.id)); assert.equal(calls.length, before);
  for (const change of [{ consent: false }, { email: "bad" }, { service: "Unapproved service" }, { website: "spam" }]) await assert.rejects(service.inquiry({ ...value, ...change }, "quote"));
});
test("HTTP routes reject cross-origin mutations, missing proof and foreign HQ users; public responses never reveal secrets", async () => {
  const post = (origin: string, body: any) => fetch(base + "/payments", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
  assert.equal((await post("https://evil.test", input())).status, 403); assert.equal((await post("", input())).status, 403);
  assert.equal((await fetch(base + "/admin")).status, 401);
  const staff = jwt.sign({ id: "staff", role: "employee", email: "staff@example.test" }, JWT_SECRET);
  assert.equal((await fetch(base + "/admin", { headers: { Authorization: `Bearer ${staff}` } })).status, 403);
  const founder = jwt.sign({ id: "founder", role: "owner", email: "service@ifcdc.org" }, JWT_SECRET);
  assert.equal((await fetch(base + "/admin", { headers: { Authorization: `Bearer ${founder}` } })).status, 200);
  mode = "fail"; const response = await post(env.AURA_CHECKOUT_LIVE_ORIGIN, input()); mode = "normal";
  assert.equal(response.status, 502); const text = await response.text(); assert.ok(!text.includes("PRIVATE_SECRET")); assert.ok(!text.includes("customer@example.test"));
});
test('public-domain membership returns to its original domain and retries cannot change the callback origin', async () => {
  const value = input('membership');
  const result = await service.create(value, 'domain-membership', 'https://ifcdc.org');
  const creation = calls.filter(call => call.path === "/v1/billing/subscriptions" && call.options.method === "POST").map(call => ({ body: JSON.parse(call.options.body) })).find(call => call.body.custom_id === value.id && call.body.application_context?.return_url);
  assert.ok(creation, 'subscription create call recorded');
  assert.ok(creation.body.application_context.return_url.startsWith('https://ifcdc.org/support?membership='));
  assert.ok(creation.body.application_context.cancel_url.startsWith('https://ifcdc.org/support?membership='));
  await assert.rejects(service.create(value, 'domain-membership', env.AURA_CHECKOUT_LIVE_ORIGIN), /where it was started/);
  await assert.rejects(service.create(input(), 'foreign-domain', 'https://evil.test'), /Invalid checkout origin/);
  assert.equal(result.status, 'approval_pending');
});
