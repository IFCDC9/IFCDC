import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
const data = mkdtempSync(path.join(tmpdir(), "aura-live-checkout-"));
process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = data;
process.env.MASTER_OWNER_EMAIL = "service@ifcdc.org";
const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { JWT_SECRET } = await import("../server/config/auth.ts");
const { liveCheckoutRouter } = await import("../server/routes/auraLiveCheckout.routes.ts");
const { liveConfiguration, validateApprovalUrl, createLiveCheckoutService } = await import("../server/hq/auraLiveCheckout.ts");
const { getDb } = await import("../server/db.ts");
const env = { AURA_CHECKOUT_LIVE_ENABLED: "true", AURA_CHECKOUT_LIVE_ORIGIN: "https://hq.example.test",
  AURA_CHECKOUT_LIVE_CLIENT_ID: "LIVE_ID", AURA_CHECKOUT_LIVE_CLIENT_SECRET: "LIVE_SECRET", AURA_CHECKOUT_LIVE_MERCHANT_ID: "MOCKMERCHANT" };
const calls: { url: string; options: RequestInit }[] = [];
const orders = new Map<string, any>();
const createKeys = new Map<string, string>();
let mode = "normal";
let clock = Date.now();
const completed = (order: any) => ({ ...order, status: "COMPLETED", purchase_units: [{ ...order.purchase_units[0], payments: {
  captures: [{ id: `CAP${order.id}`, status: "COMPLETED", final_capture: true, amount: { currency_code: "USD", value: "1.00" } }],
} }] });
const provider = async (input: any, options: any) => {
  const url = String(input); calls.push({ url, options });
  assert.ok(url.startsWith("https://api-m.paypal.com/"));
  assert.equal(options.redirect, "error");
  assert.ok(options.signal instanceof AbortSignal);
  if (mode === "provider_error") throw new Error("LIVE_SECRET payer@example.test");
  let body: any;
  if (url.endsWith("/oauth2/token")) body = { access_token: "TEST_TOKEN", token_type: "Bearer" };
  else if (url.endsWith("/v2/checkout/orders")) {
    const request = JSON.parse(options.body);
    assert.equal(request.payment_source.paypal.experience_context.shipping_preference, "NO_SHIPPING");
    assert.equal(request.purchase_units[0].amount.value, "1.00");
    const key = options.headers["PayPal-Request-Id"];
    let id = createKeys.get(key);
    if (!id) { id = `ORDER${orders.size + 1}`; createKeys.set(key, id); }
    body = { ...request, id, status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", method: "GET",
      href: `https://${mode === "evil_link" ? "www.sandbox.paypal.com" : "www.paypal.com"}/checkoutnow?token=${id}` }] };
    orders.set(id, body);
    if (mode === "lost_create") { mode = "normal"; throw new Error("response lost"); }
  } else {
    const id = url.split("/")[6];
    body = orders.get(id);
    assert.ok(body, `Unknown order ${id}`);
    if (url.endsWith("/capture")) {
      body = completed(body); orders.set(id, body);
      if (mode === "lost_capture") { mode = "normal"; throw new Error("response lost"); }
      if (mode === "bad_capture") body = { ...body, status: "APPROVED" };
    }
  }
  return { ok: true, json: async () => structuredClone(body) } as Response;
};
const app = express(); app.use(express.json());
app.use("/pilot", liveCheckoutRouter({ env, fetchImpl: provider, now: () => clock }));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pilot`;
const founder = jwt.sign({ id: "founder", email: "service@ifcdc.org", role: "owner" }, JWT_SECRET);
const staff = jwt.sign({ id: "staff", email: "staff@example.test", role: "employee" }, JWT_SECRET);
const request = (endpoint: string, body?: any, token: string | null = founder, origin = env.AURA_CHECKOUT_LIVE_ORIGIN) => fetch(url + endpoint, {
  method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", Origin: origin,
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
});
const attempt = () => ({ approved: true, liveAcknowledged: true, attemptId: crypto.randomUUID(), state: crypto.randomBytes(32).toString("hex") });
async function create() {
  clock += 60 * 60_000 + 1;
  const input = attempt(); const response = await request("/orders", input);
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const row = await response.json();
  return { input, row };
}
const captureInput = (value: any) => ({ approved: true, liveAcknowledged: true, state: value.input.state, orderId: value.row.orderId });
function approve(id: string) { orders.get(id).status = "APPROVED"; }
test.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); (await getDb()).close(); rmSync(data, { recursive: true, force: true }); });

test("requires live-specific opt-in, complete credentials and explicit HTTPS origin; never falls back to generic PayPal credentials", () => {
  assert.equal(liveConfiguration(env).ready, true);
  assert.equal(liveConfiguration({ PAYPAL_CLIENT_ID: "LIVE", PAYPAL_CLIENT_SECRET: "LIVE", PAYPAL_MODE: "live" }).ready, false);
  for (const key of Object.keys(env)) assert.equal(liveConfiguration({ ...env, [key]: "" }).ready, false);
  for (const origin of ["http://hq.example.test", "https://user@hq.example.test", "https://hq.example.test/path", "https://hq.example.test/?x=1"]) {
    assert.equal(liveConfiguration({ ...env, AURA_CHECKOUT_LIVE_ORIGIN: origin }).ready, false);
  }
});
test("authentication, Founder identity and same-origin JSON protect all mutations", async () => {
  const before = calls.length;
  assert.equal((await request("/status", undefined, null)).status, 401);
  assert.equal((await request("/status", undefined, staff)).status, 403);
  const imposter = jwt.sign({ id: "imposter", email: "other@ifcdc.org", role: "founder" }, JWT_SECRET);
  assert.equal((await request("/orders", attempt(), imposter)).status, 403);
  assert.equal((await request("/orders", attempt(), founder, "https://evil.test")).status, 403);
  assert.equal((await request("/orders", attempt(), founder, "")).status, 403);
  const response = await fetch(url + "/orders", { method: "POST", headers: { Authorization: `Bearer ${founder}`, Origin: env.AURA_CHECKOUT_LIVE_ORIGIN, "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(response.status, 403); assert.equal(calls.length, before);
});
test("rejects lack of approval, browser-supplied prices, credentials and malformed attempt IDs before network", async () => {
  const before = calls.length;
  for (const body of [{ ...attempt(), approved: false }, { ...attempt(), amount: "0.01" }, { ...attempt(), clientSecret: "other" }, { ...attempt(), attemptId: "bad" }, { ...attempt(), state: "bad" }]) {
    assert.equal((await request("/orders", body)).status, 400);
  }
  assert.equal(calls.length, before);
});
test("creates persisted fixed-price order, returns production-only link, and retries same attempt without another order", async () => {
  const { input, row } = await create(); const before = calls.length;
  assert.equal(row.status, "awaiting_approval"); assert.equal(row.amount, "1.00");
  assert.ok(row.approvalUrl.startsWith("https://www.paypal.com/checkoutnow?token="));
  const retry = await request("/orders", input);
  assert.equal((await retry.json()).orderId, row.orderId); assert.equal(calls.length, before);
  const stored = await (await getDb()).get("SELECT * FROM aura_live_checkouts WHERE id = ?", row.id);
  assert.equal(stored.owner_id, "founder"); assert.notEqual(stored.state_hash, input.state);
  assert.ok(!JSON.stringify(stored).includes("LIVE_SECRET"));
  const body = JSON.parse(String(calls.find(call => String(call.options.body).includes(input.state))?.options.body));
  const callback = new URL(body.payment_source.paypal.experience_context.return_url);
  assert.equal(callback.origin, env.AURA_CHECKOUT_LIVE_ORIGIN); assert.equal(callback.searchParams.get("live_checkout"), row.id);
});
test("foreign owner cannot read/capture/reconcile a known checkout; return state and exact order are bound", async () => {
  const value = await create(); const service = createLiveCheckoutService({ env, fetchImpl: provider }); const before = calls.length;
  await assert.rejects(service.capture("other", value.row.id, captureInput(value)), /not found/);
  await assert.rejects(service.reconcile("other", value.row.id), /not found/);
  assert.equal((await request(`/orders/${value.row.id}/capture`, { ...captureInput(value), state: "f".repeat(64) })).status, 400);
  assert.equal((await request(`/orders/${value.row.id}/capture`, { ...captureInput(value), orderId: "FOREIGN" })).status, 400);
  assert.equal((await request(`/orders/${value.row.id}/capture`, { ...captureInput(value), approved: false })).status, 400);
  assert.equal(calls.length, before);
});
test("buyer approval alone is not payment; captures only verified APPROVED order and persists capture receipt", async () => {
  const value = await create();
  const before = calls.filter(call => call.url.endsWith("/capture")).length;
  assert.equal((await request(`/orders/${value.row.id}/capture`, captureInput(value))).status, 502);
  assert.equal(calls.filter(call => call.url.endsWith("/capture")).length, before);
  approve(value.row.orderId);
  const paid = await request(`/orders/${value.row.id}/capture`, captureInput(value)); assert.equal(paid.status, 200);
  const receipt = await paid.json(); assert.equal(receipt.status, "completed"); assert.ok(receipt.captureId); assert.ok(receipt.verifiedAt);
  const retry = await request(`/orders/${value.row.id}/capture`, captureInput(value)); assert.equal(retry.status, 200);
  assert.equal(calls.filter(call => call.url.endsWith("/capture")).length, before + 1);
  const audit = await (await getDb()).get("SELECT metadata_json FROM hq_audit_log WHERE entity_id = ? AND action = 'aura_live_checkout_verified'", value.row.id);
  assert.equal(JSON.parse(audit.metadata_json).environment, "live");
});
test("lost create response recovers using identical PayPal request ID without creating a second order", async () => {
  const input = attempt(); mode = "lost_create"; const count = orders.size;
  assert.equal((await request("/orders", input)).status, 502);
  const response = await request("/orders", input); assert.equal(response.status, 201);
  assert.equal(orders.size, count + 1);
  const requests = calls.filter(call => call.url.endsWith("/v2/checkout/orders")).slice(-2);
  assert.equal((requests[0].options.headers as any)["PayPal-Request-Id"], (requests[1].options.headers as any)["PayPal-Request-Id"]);
});
test("lost capture response remains unconfirmed; GET-only reconciliation recovers with no duplicate capture", async () => {
  const value = await create(); approve(value.row.orderId); mode = "lost_capture";
  assert.equal((await request(`/orders/${value.row.id}/capture`, captureInput(value))).status, 502);
  const status = await (await request("/status")).json();
  assert.equal(status.records.find((row: any) => row.id === value.row.id).status, "verification_required");
  const before = calls.length;
  const response = await request(`/orders/${value.row.id}/recheck`, {}); assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "completed");
  assert.equal(calls.slice(before).filter(call => call.options.method === "POST" && !call.url.endsWith("/oauth2/token")).length, 0);
});
test("concurrent captures lock once and never send a second capture POST", async () => {
  const value = await create(); approve(value.row.orderId); const before = calls.filter(call => call.url.endsWith("/capture")).length;
  const results = await Promise.all([request(`/orders/${value.row.id}/capture`, captureInput(value)), request(`/orders/${value.row.id}/capture`, captureInput(value))]);
  assert.ok(results.some(response => response.status === 200));
  assert.ok(results.every(response => [200, 409].includes(response.status)));
  assert.equal(calls.filter(call => call.url.endsWith("/capture")).length, before + 1);
});
test("expired checkout cannot capture but can reconcile an already completed payment", async () => {
  const value = await create(); approve(value.row.orderId); orders.set(value.row.orderId, completed(orders.get(value.row.orderId)));
  const before = calls.length; clock += 4 * 60 * 60_000;
  assert.equal((await request(`/orders/${value.row.id}/capture`, captureInput(value))).status, 409); assert.equal(calls.length, before);
  assert.equal((await request(`/orders/${value.row.id}/recheck`, {})).status, 200);
});
test("rejects sandbox or hostile approval links and never leaks provider exceptions or secrets", async () => {
  for (const value of ["https://www.sandbox.paypal.com/checkoutnow?token=ORDER1", "https://www.paypal.com.evil.test/checkoutnow?token=ORDER1", "javascript:alert(1)", "https://www.paypal.com/checkoutnow?token=OTHER", "https://www.paypal.com/checkoutnow?token=ORDER1&token=ORDER1"]) {
    assert.throws(() => validateApprovalUrl(value, "ORDER1"));
  }
  mode = "evil_link"; assert.equal((await request("/orders", attempt())).status, 502);
  mode = "provider_error"; const response = await request("/orders", attempt()); const body = await response.text();
  assert.equal(response.status, 502); assert.ok(!body.includes("LIVE_SECRET")); assert.ok(!body.includes("payer@example.test")); mode = "normal";
  const status = await request("/status"); assert.equal(status.headers.get("cache-control"), "no-store");
  const text = await status.text(); assert.ok(!text.includes("state_hash")); assert.ok(!text.includes("clientSecret"));
});
test("unverified, wrong amount or wrong merchant responses never produce a completed local receipt", async () => {
  // Separate owner gives this test its own rate-limit bucket.
  const service = createLiveCheckoutService({ env, fetchImpl: provider });
  const input = attempt(); const row = await service.create("amount-test", input); approve(row.orderId!);
  orders.get(row.orderId!).purchase_units[0].amount.value = "9.00";
  await assert.rejects(service.capture("amount-test", row.id, { approved: true, liveAcknowledged: true, state: input.state, orderId: row.orderId }), /not confirmed/);
  assert.notEqual((await service.status("amount-test")).records[0].status, "completed");
  orders.get(row.orderId!).purchase_units[0].amount.value = "1.00";
  orders.get(row.orderId!).purchase_units[0].payee.merchant_id = "OTHER";
  await assert.rejects(service.capture("amount-test", row.id, { approved: true, liveAcknowledged: true, state: input.state, orderId: row.orderId }), /not confirmed/);
});
test("disabled pilot refuses creates and captures even when live PayPal credentials exist", async () => {
  const before = calls.length;
  const disabled = createLiveCheckoutService({ env: { PAYPAL_CLIENT_ID: "LIVE", PAYPAL_CLIENT_SECRET: "LIVE" }, fetchImpl: provider });
  await assert.rejects(disabled.create("disabled", attempt()), /configuration/);
  await assert.rejects(disabled.capture("disabled", crypto.randomUUID(), {}), /configuration/);
  assert.equal(calls.length, before);
});
test("adapter validates redirect URLs before network and reconciliation refuses pending orders without capture", async () => {
  const { createLiveVerificationClient } = await import("../server/hq/auraLivePayPal.mjs");
  const client = createLiveVerificationClient({ clientId: "LIVE_ID", clientSecret: "LIVE_SECRET", merchantId: "MOCKMERCHANT", fetchImpl: provider });
  const before = calls.length;
  for (const [returnUrl, cancelUrl] of [["http://hq.test/", "https://hq.test/"], ["https://hq.test/", "https://evil.test/"], ["javascript:alert(1)", "https://hq.test/"], ["https://user@hq.test/", "https://hq.test/"], ["https://hq.test/#fragment", "https://hq.test/"], ["https://hq.test/", undefined]]) {
    await assert.rejects(client.createOrder({ requestId: "url-test", returnUrl, cancelUrl }));
  }
  assert.equal(calls.length, before);
  const service = createLiveCheckoutService({ env, fetchImpl: provider });
  const row = await service.create("pending-test", attempt());
  const captureCount = calls.filter(call => call.url.endsWith("/capture")).length;
  await assert.rejects(service.reconcile("pending-test", row.id), /not verified/);
  assert.equal(calls.filter(call => call.url.endsWith("/capture")).length, captureCount);
});
test("live acknowledgement is required independently of ordinary approval", async () => {
  const before = calls.length;
  assert.equal((await request("/orders", { ...attempt(), liveAcknowledged: false })).status, 400);
  const missing: any = attempt(); delete missing.liveAcknowledged;
  assert.equal((await request("/orders", missing)).status, 400);
  assert.equal(calls.length, before);
  const value = await create(); const after = calls.length;
  assert.equal((await request(`/orders/${value.row.id}/capture`, { ...captureInput(value), liveAcknowledged: false })).status, 400);
  assert.equal(calls.length, after);
});
test("sandbox credentials cannot arm live configuration; read-only status never contacts PayPal", async () => {
  assert.equal(liveConfiguration({ ...env, AURA_CHECKOUT_SANDBOX_CLIENT_ID: env.AURA_CHECKOUT_LIVE_CLIENT_ID }).ready, false);
  assert.equal(liveConfiguration({ ...env, AURA_CHECKOUT_SANDBOX_MERCHANT_ID: env.AURA_CHECKOUT_LIVE_MERCHANT_ID }).ready, false);
  assert.equal(liveConfiguration({ AURA_CHECKOUT_SANDBOX_ENABLED: "true", AURA_CHECKOUT_SANDBOX_CLIENT_ID: "SANDBOX" }).ready, false);
  const before = calls.length;
  const response = await request("/status"); const status = await response.json();
  assert.equal(status.environment, "live"); assert.equal(status.amount, "1.00"); assert.equal(calls.length, before);
});
test("live activation switch blocks create/capture while GET-only reconciliation remains available", async () => {
  const liveEnv = { ...env };
  const service = createLiveCheckoutService({ env: liveEnv, fetchImpl: provider });
  const input = attempt(); const row = await service.create("kill-switch", input);
  approve(row.orderId!); orders.set(row.orderId!, completed(orders.get(row.orderId!)));
  liveEnv.AURA_CHECKOUT_LIVE_ENABLED = "false";
  const before = calls.length;
  await assert.rejects(service.create("kill-switch", attempt()), /disabled/);
  await assert.rejects(service.capture("kill-switch", row.id, { approved: true, liveAcknowledged: true, state: input.state, orderId: row.orderId }), /disabled/);
  assert.equal(calls.length, before);
  const result = await service.reconcile("kill-switch", row.id); assert.equal(result.status, "completed");
  assert.ok(calls.slice(before).every(call => call.options.method === "GET" || call.url.endsWith("/oauth2/token")));
});
test("live three-attempt hourly limit is atomic under concurrent requests and retries do not consume new slots", async () => {
  const service = createLiveCheckoutService({ env, fetchImpl: provider, now: () => clock });
  const inputs = Array.from({ length: 6 }, attempt);
  const results = await Promise.allSettled(inputs.map(input => service.create("rate-limit", input)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 3);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason.status === 429).length, 3);
  const index = results.findIndex(result => result.status === "fulfilled");
  assert.ok((await service.create("rate-limit", inputs[index])).orderId);
});
test("live and sandbox receipts, IDs and state remain isolated in the same HQ database", async () => {
  const { createSandboxCheckoutService } = await import("../server/hq/auraSandboxCheckout.ts");
  const sandbox = createSandboxCheckoutService({ env: {} });
  await sandbox.status("separation");
  const db = await getDb(); const id = crypto.randomUUID();
  await db.run(`INSERT INTO aura_sandbox_checkouts
    (id, owner_id, attempt_id, state_hash, status, paypal_order_id, capture_id, merchant_id, created_at)
    VALUES (?, 'separation', ?, ?, 'completed', 'SANDBOXORDER', 'SANDBOXCAPTURE', 'SANDBOXMERCHANT', ?)`,
    id, crypto.randomUUID(), crypto.createHash("sha256").update("a".repeat(64)).digest("hex"), Date.now());
  const live = createLiveCheckoutService({ env, fetchImpl: provider }); const before = calls.length;
  await assert.rejects(live.capture("separation", id, { approved: true, liveAcknowledged: true, state: "a".repeat(64), orderId: "SANDBOXORDER" }), /not found/);
  await assert.rejects(live.reconcile("separation", id), /not found/);
  assert.deepEqual((await live.status("separation")).records, []);
  assert.equal((await sandbox.status("separation")).records[0].captureId, "SANDBOXCAPTURE");
  assert.equal(calls.length, before);
});
