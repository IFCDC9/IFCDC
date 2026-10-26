import crypto from "node:crypto";
import { getDb } from "../db";
import { liveConfiguration } from "./auraLiveCheckout";
import { publicPayPal, ProviderError } from "./publicSupportPayPal";

export class SupportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const digest = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SECRET = /^[a-f0-9]{64}$/;
const ID = /^[A-Z0-9-]{1,64}$/;
const PRODUCT = "IFCDC-COMMUNITY-SUPPORTER-V1";
const TTL = 24 * 60 * 60_000;
export const services = ["Custom software development", "Music mixing and mastering", "Video editing"];
export function amountCents(value: unknown, maximum = 1_000_000) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(value)) throw new SupportError(400, "Enter a USD amount using at most two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents < 100 || cents > maximum) throw new SupportError(400, `Choose an amount from $1.00 to $${(maximum / 100).toFixed(2)}.`);
  return cents;
}
const dollars = (cents: number) => (cents / 100).toFixed(2);
function exact(input: any, keys: string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw new SupportError(400, "Invalid request details.");
}
export function supportConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const live = liveConfiguration(env);
  const webhookId = env.IFCDC_SUPPORT_PAYPAL_WEBHOOK_ID || "";
  let bookUrl = "";
  try {
    const url = new URL(env.IFCDC_SUPPORT_BOOK_URL || "");
    if (url.protocol === "https:" && ["www.amazon.com", "amazon.com", "a.co"].includes(url.hostname) && !url.username && !url.password && !url.hash && url.pathname !== "/") bookUrl = url.href;
  } catch { /* No invented listing or fallback search URL. */ }
  const enabled = env.IFCDC_SUPPORT_ENABLED === "true";
  return { ...live, enabled, ready: enabled && live.configured && /^[A-Z0-9-]{1,100}$/.test(webhookId), webhookId, bookUrl };
}
type Row = { id: string; proof_hash: string; kind: string; cents: number; status: string; merchant: string; app_hash: string;
  provider_id: string | null; plan_id: string | null; approval_url: string | null; created_at: number; lock_until: number; verified_at: number | null };
async function dbReady() {
  const db = await getDb();
  await db.exec(`CREATE TABLE IF NOT EXISTS ifcdc_support_orders (
    id TEXT PRIMARY KEY, proof_hash TEXT NOT NULL, kind TEXT NOT NULL, cents INTEGER NOT NULL, status TEXT NOT NULL,
    merchant TEXT NOT NULL, app_hash TEXT NOT NULL, provider_id TEXT UNIQUE, plan_id TEXT, approval_url TEXT,
    created_at INTEGER NOT NULL, verified_at INTEGER, lock_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS ifcdc_support_ledger (
    provider_id TEXT PRIMARY KEY, checkout_id TEXT NOT NULL, cents INTEGER NOT NULL, currency TEXT NOT NULL,
    status TEXT NOT NULL, paid_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ifcdc_support_plans (
    cache_key TEXT PRIMARY KEY, plan_id TEXT, created_at INTEGER NOT NULL, lock_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS ifcdc_support_limits (
    key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ifcdc_support_events (
    id TEXT PRIMARY KEY, digest TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, lock_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS ifcdc_support_inquiries (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, service TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ifcdc_support_members (
    checkout_id TEXT PRIMARY KEY, email TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
  return db;
}
export function subscriptionApproval(value: unknown) {
  if (typeof value !== "string") throw new Error("Missing approval URL");
  const url = new URL(value);
  if (url.origin !== "https://www.paypal.com" || url.username || url.password || url.hash || url.pathname !== "/webapps/billing/subscriptions" ||
      url.searchParams.getAll("ba_token").length !== 1 || !/^BA-[A-Z0-9]+$/.test(url.searchParams.get("ba_token") || "")) throw new Error("Invalid subscription approval URL");
  return url.href;
}
function receipt(row: Row, payments: any[] = []) {
  return { id: row.id, kind: row.kind, amount: dollars(row.cents), currency: "USD", status: row.status,
    providerId: row.provider_id, verifiedAt: row.verified_at, payments,
    recurring: row.kind === "membership", interval: row.kind === "membership" ? "MONTH" : null };
}
export function createSupportService(options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const config = (enabled = true) => {
    const cfg = supportConfiguration(env);
    if (!cfg.configured || (enabled && !cfg.ready)) throw new SupportError(503, "Public payments are not available yet. Please try again later.");
    return cfg;
  };
  const provider = (enabled = true) => publicPayPal(config(enabled), options.fetchImpl);
  async function bounded(key: string, maximum: number, duration: number) {
    const db = await dbReady();
    await db.run("DELETE FROM ifcdc_support_limits WHERE expires_at < ?", now());
    const result = await db.run(`INSERT INTO ifcdc_support_limits(key, count, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ?`, key, now() + duration, maximum);
    if (!result.changes) throw new SupportError(429, "Too many requests. Please wait before trying again.");
  }
  async function rate(ip: string, action: string, limit = 8) {
    const hour = Math.floor(now() / 3_600_000);
    // Network-derived address only; callers must never pass a browser-supplied IP header.
    await bounded(digest(`${ip}:${hour}:${action}`), limit, 3_600_000);
    await bounded(`global:${hour}:${action}`, 1000, 3_600_000);
  }
  async function owned(id: string, proof: unknown) {
    if (!UUID.test(id) || typeof proof !== "string" || !SECRET.test(proof)) throw new SupportError(404, "Payment record not found in this browser session.");
    const row = await (await dbReady()).get<Row>("SELECT * FROM ifcdc_support_orders WHERE id = ? AND proof_hash = ?", id, digest(proof));
    if (!row) throw new SupportError(404, "Payment record not found in this browser session.");
    const cfg = config(false);
    if (row.merchant !== cfg.merchantId || row.app_hash !== digest(cfg.clientId)) throw new SupportError(409, "This payment uses a different merchant configuration. Contact IFCDC.");
    return row;
  }
  async function view(row: Row) {
    const payments = await (await dbReady()).all("SELECT provider_id AS id, cents, currency, status, paid_at AS paidAt FROM ifcdc_support_ledger WHERE checkout_id = ? ORDER BY paid_at DESC LIMIT 100", row.id);
    return receipt(row, payments);
  }
  async function lease(row: Row) {
    const stamp = now() + 120_000;
    const result = await (await dbReady()).run("UPDATE ifcdc_support_orders SET lock_until = ? WHERE id = ? AND lock_until <= ?", stamp, row.id, now());
    if (!result.changes) throw new SupportError(409, "This payment is being checked. Wait a moment, then recheck it.");
    return stamp;
  }
  async function update(row: Row, values: { status: string; verified?: boolean }) {
    await (await dbReady()).run("UPDATE ifcdc_support_orders SET status = ?, verified_at = CASE WHEN ? THEN ? ELSE verified_at END WHERE id = ?", values.status, values.verified ? 1 : 0, now(), row.id);
  }
  function checkUnit(row: Row, order: any) {
    const cfg = config(false);
    const unit = order?.purchase_units?.[0];
    if (order?.id !== row.provider_id || order.intent !== "CAPTURE" || order.purchase_units.length !== 1 ||
        unit?.custom_id !== row.id || unit?.reference_id !== "ifcdc-donation" || unit.payee?.merchant_id !== cfg.merchantId ||
        unit.amount?.currency_code !== "USD" || unit.amount?.value !== dollars(row.cents)) throw new Error("Order details do not match");
    return unit;
  }
  async function recordOrder(row: Row, order: any) {
    const unit = checkUnit(row, order);
    const captures = unit.payments?.captures;
    if (!Array.isArray(captures) || captures.length !== 1) throw new Error("Capture missing");
    const capture = captures[0];
    if (!ID.test(capture.id) || capture.final_capture !== true || capture.amount?.currency_code !== "USD" || capture.amount?.value !== dollars(row.cents) ||
        !["COMPLETED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(capture.status) || !Number.isFinite(Date.parse(capture.create_time))) throw new Error("Capture mismatch");
    const db = await dbReady();
    const existing = await db.get("SELECT checkout_id FROM ifcdc_support_ledger WHERE provider_id = ?", capture.id);
    if (existing && existing.checkout_id !== row.id) throw new Error("Capture belongs to another payment");
    await db.run(`INSERT INTO ifcdc_support_ledger VALUES (?, ?, ?, 'USD', ?, ?)
      ON CONFLICT(provider_id) DO UPDATE SET status = excluded.status`, capture.id, row.id, row.cents, capture.status, capture.create_time);
    await update(row, { status: capture.status === "COMPLETED" ? "completed" : capture.status.toLowerCase(), verified: true });
  }
  function checkPlan(plan: any, cents: number) {
    const cycle = plan?.billing_cycles?.[0];
    if (!ID.test(plan?.id || "") || plan.product_id !== PRODUCT || plan.status !== "ACTIVE" || plan.billing_cycles.length !== 1 ||
        cycle.tenure_type !== "REGULAR" || cycle.sequence !== 1 || cycle.frequency?.interval_unit !== "MONTH" || cycle.frequency?.interval_count !== 1 || cycle.total_cycles !== 0 ||
        cycle.pricing_scheme?.fixed_price?.currency_code !== "USD" || amountCents(cycle.pricing_scheme.fixed_price.value, 100_000) !== cents ||
        plan.payment_preferences?.auto_bill_outstanding !== false ||
        (plan.payment_preferences?.setup_fee && amountOrZero(plan.payment_preferences.setup_fee) !== 0) ||
        (plan.taxes && Number(plan.taxes.percentage) !== 0) || plan.quantity_supported === true) throw new Error("Monthly plan terms changed");
  }
  function amountOrZero(value: any) {
    if (value?.currency_code !== "USD") throw new Error("Wrong currency");
    return /^(0|0\.0{1,2})$/.test(value?.value) ? 0 : amountCents(value?.value, 100_000);
  }
  async function planFor(cents: number) {
    const cfg = config(); const api = provider(); const db = await dbReady();
    const key = digest(`${cfg.clientId}:${cfg.merchantId}:${cents}:v1`);
    await db.run("INSERT OR IGNORE INTO ifcdc_support_plans(cache_key, created_at) VALUES (?, ?)", key, now());
    const cached = await db.get("SELECT * FROM ifcdc_support_plans WHERE cache_key = ?", key);
    if (cached.plan_id) { const plan = await api(`/v1/billing/plans/${cached.plan_id}`); checkPlan(plan, cents); return plan.id; }
    if (now() - cached.created_at > TTL) throw new SupportError(409, "This membership amount needs an IFCDC configuration check.");
    const lock = await db.run("UPDATE ifcdc_support_plans SET lock_until = ? WHERE cache_key = ? AND lock_until <= ?", now() + 120_000, key, now());
    if (!lock.changes) throw new SupportError(409, "This membership amount is being prepared. Please retry shortly.");
    try {
      let product;
      try { product = await api(`/v1/catalogs/products/${PRODUCT}`); }
      catch (error) {
        if (!(error instanceof ProviderError) || error.status !== 404) throw error;
        product = await api("/v1/catalogs/products", "POST", { id: PRODUCT, name: "IFCDC Community Supporter", type: "SERVICE", category: "NONPROFIT", description: "Community support with project updates and a monthly newsletter." }, `support-product-${digest(cfg.clientId).slice(0, 30)}`);
      }
      if (product?.id !== PRODUCT || product.type !== "SERVICE") throw new Error("Wrong membership product");
      const plan = await api("/v1/billing/plans", "POST", {
        product_id: PRODUCT, name: `IFCDC Community Supporter USD ${dollars(cents)} monthly`, status: "ACTIVE", quantity_supported: false,
        billing_cycles: [{ frequency: { interval_unit: "MONTH", interval_count: 1 }, tenure_type: "REGULAR", sequence: 1, total_cycles: 0,
          pricing_scheme: { fixed_price: { value: dollars(cents), currency_code: "USD" } } }],
        payment_preferences: { auto_bill_outstanding: false, setup_fee: { value: "0.00", currency_code: "USD" }, setup_fee_failure_action: "CANCEL", payment_failure_threshold: 1 },
      }, `support-plan-${key.slice(0, 50)}`);
      checkPlan(plan, cents);
      await db.run("UPDATE ifcdc_support_plans SET plan_id = ? WHERE cache_key = ?", plan.id, key);
      return plan.id;
    } finally { await db.run("UPDATE ifcdc_support_plans SET lock_until = 0 WHERE cache_key = ?", key); }
  }
  async function syncMember(row: Row) {
    const api = provider(false);
    const sub = await api(`/v1/billing/subscriptions/${row.provider_id}`);
    if (sub.id !== row.provider_id || sub.custom_id !== row.id || sub.plan_id !== row.plan_id || sub.plan_overridden === true ||
        (sub.quantity !== undefined && sub.quantity !== "1") || !["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED"].includes(sub.status)) throw new Error("Subscription identity mismatch");
    if (["APPROVAL_PENDING", "APPROVED", "ACTIVE"].includes(sub.status)) {
      const plan = await api(`/v1/billing/plans/${row.plan_id}`); checkPlan(plan, row.cents);
    }
    // Activation is not proof of payment. Individual sales are verified separately.
    await update(row, { status: sub.status.toLowerCase(), verified: sub.status === "ACTIVE" });
    const email = sub.subscriber?.email_address;
    if (typeof email === "string" && email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
      await (await dbReady()).run(`INSERT INTO ifcdc_support_members VALUES (?, ?, ?)
        ON CONFLICT(checkout_id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at`, row.id, email, now());
    }
    return sub;
  }
  return {
    async throttle(ip: string) { await rate(ip, "request", 100); },
    async catalog() {
      const cfg = supportConfiguration(env);
      return { ready: cfg.ready, clientId: cfg.ready ? cfg.clientId : null, currency: "USD", donationAmounts: [10, 25, 50, 100],
        membershipAmounts: [10, 20, 40, 60], services, bookUrl: cfg.bookUrl || null, contact: "service@ifcdc.org" };
    },
    async create(input: any, ip: string) {
      const cfg = config(); exact(input, ["id", "proof", "kind", "amount", "approved", "recurringApproved"]);
      if (!UUID.test(input.id) || !SECRET.test(input.proof) || !["donation", "membership"].includes(input.kind) || input.approved !== true ||
          (input.kind === "membership" && input.recurringApproved !== true)) throw new SupportError(400, "Approve the payment amount and any monthly renewal first.");
      const cents = amountCents(input.amount, input.kind === "membership" ? 100_000 : 1_000_000);
      const db = await dbReady();
      let row = await db.get<Row>("SELECT * FROM ifcdc_support_orders WHERE id = ?", input.id);
      if (!row) {
        await rate(ip, "create");
        await db.run(`INSERT OR IGNORE INTO ifcdc_support_orders (id, proof_hash, kind, cents, status, merchant, app_hash, created_at)
          VALUES (?, ?, ?, ?, 'creating', ?, ?, ?)`, input.id, digest(input.proof), input.kind, cents, cfg.merchantId, digest(cfg.clientId), now());
      }
      row = await owned(input.id, input.proof);
      if (row.kind !== input.kind || row.cents !== cents) throw new SupportError(409, "Keep the original amount for this payment attempt.");
      if (row.provider_id) return { ...await view(row), approvalUrl: row.approval_url };
      if (now() - row.created_at > TTL) throw new SupportError(409, "This attempt expired. Contact IFCDC before making another payment.");
      const lock = await lease(row);
      try {
        const api = provider();
        if (row.kind === "donation") {
          const order = await api("/v2/checkout/orders", "POST", { intent: "CAPTURE", application_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", brand_name: "IFCDC" }, purchase_units: [{ reference_id: "ifcdc-donation", custom_id: row.id,
            description: "Voluntary IFCDC donation supporting community work and mission-driven software", amount: { currency_code: "USD", value: dollars(cents) }, payee: { merchant_id: cfg.merchantId } }] }, `support-create-${row.id}`);
          row.provider_id = order.id; checkUnit(row, order);
          if (!ID.test(order.id) || !["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED"].includes(order.status)) throw new Error("Invalid order");
          await db.run("UPDATE ifcdc_support_orders SET provider_id = ?, status = 'awaiting_approval' WHERE id = ?", order.id, row.id);
        } else {
          const planId = await planFor(cents);
          await db.run("UPDATE ifcdc_support_orders SET plan_id = ? WHERE id = ?", planId, row.id);
          const callback = (result: string) => `${cfg.origin}/support?membership=${row!.id}&result=${result}`;
          const sub = await api("/v1/billing/subscriptions", "POST", { plan_id: planId, custom_id: row.id,
            application_context: { brand_name: "IFCDC", shipping_preference: "NO_SHIPPING", user_action: "SUBSCRIBE_NOW", return_url: callback("approved"), cancel_url: callback("cancelled") } }, `support-sub-${row.id}`);
          if (!/^I-[A-Z0-9]+$/.test(sub.id) || sub.plan_id !== planId || sub.custom_id !== row.id || sub.status !== "APPROVAL_PENDING") throw new Error("Invalid subscription");
          const approval = subscriptionApproval(sub.links?.find((link: any) => link.rel === "approve")?.href);
          await db.run("UPDATE ifcdc_support_orders SET provider_id = ?, status = 'approval_pending', approval_url = ? WHERE id = ?", sub.id, approval, row.id);
        }
        return { ...await view(await owned(row.id, input.proof)), approvalUrl: (await owned(row.id, input.proof)).approval_url };
      } catch (error) {
        if (error instanceof SupportError) throw error;
        throw new SupportError(502, "PayPal has not confirmed this attempt. Retry this same payment; do not start another.");
      } finally { await db.run("UPDATE ifcdc_support_orders SET lock_until = 0 WHERE id = ? AND lock_until = ?", row.id, lock); }
    },
    async capture(id: string, proof: unknown, input: any) {
      config(); exact(input, ["approved", "orderId"]);
      const row = await owned(id, proof);
      if (input.approved !== true || row.kind !== "donation" || input.orderId !== row.provider_id || !row.provider_id) throw new SupportError(400, "Payment approval does not match this donation.");
      if (row.status === "completed") return view(row);
      if (now() - row.created_at > TTL) throw new SupportError(409, "This attempt expired. Recheck before making another payment.");
      const lock = await lease(row);
      try {
        const api = provider(); let order = await api(`/v2/checkout/orders/${row.provider_id}`); checkUnit(row, order);
        if (order.status === "APPROVED") {
          await api(`/v2/checkout/orders/${row.provider_id}/capture`, "POST", {}, `support-capture-${row.id}`);
          // GET returns authoritative purchase unit identity, including optional fields omitted in POST response.
          order = await api(`/v2/checkout/orders/${row.provider_id}`);
        }
        if (order.status !== "COMPLETED") throw new Error("Not completed");
        await recordOrder(row, order);
        return view(await owned(id, proof));
      } catch { throw new SupportError(502, "Payment is not confirmed. Recheck this record before making another donation."); }
      finally { await (await dbReady()).run("UPDATE ifcdc_support_orders SET lock_until = 0 WHERE id = ? AND lock_until = ?", id, lock); }
    },
    async recheck(id: string, proof: unknown) {
      const row = await owned(id, proof);
      if (!row.provider_id) return view(row);
      const lock = await lease(row);
      try {
        if (row.kind === "membership") await syncMember(row);
        else {
          const order = await provider(false)(`/v2/checkout/orders/${row.provider_id}`); checkUnit(row, order);
          if (order.status === "COMPLETED") await recordOrder(row, order);
        }
        return view(await owned(id, proof));
      } catch { throw new SupportError(502, "PayPal could not verify this record yet. Keep this receipt and try rechecking later."); }
      finally { await (await dbReady()).run("UPDATE ifcdc_support_orders SET lock_until = 0 WHERE id = ? AND lock_until = ?", id, lock); }
    },
    async cancel(id: string, proof: unknown, input: any) {
      exact(input, ["approved"]); const row = await owned(id, proof);
      if (row.kind !== "membership" || input.approved !== true || !row.provider_id) throw new SupportError(400, "Confirm cancellation of this membership.");
      const lock = await lease(row);
      try {
        // Cancellation must remain possible even if a merchant has edited or deactivated a plan.
        const api = provider(false);
        const sub = await api(`/v1/billing/subscriptions/${row.provider_id}`);
        if (sub.id !== row.provider_id || sub.custom_id !== row.id || sub.plan_id !== row.plan_id) throw new Error("Membership identity mismatch");
        if (!["CANCELLED", "EXPIRED"].includes(sub.status)) await provider(false)(`/v1/billing/subscriptions/${row.provider_id}/cancel`, "POST", { reason: "Supporter requested cancellation of future renewals." });
        const checked = await api(`/v1/billing/subscriptions/${row.provider_id}`);
        if (checked.id !== row.provider_id || checked.custom_id !== row.id || !["CANCELLED", "EXPIRED"].includes(checked.status)) throw new Error("Cancellation not verified");
        await update(row, { status: checked.status.toLowerCase() }); return view(await owned(id, proof));
      } catch { throw new SupportError(502, "Cancellation is not confirmed. Recheck or cancel through PayPal Automatic Payments."); }
      finally { await (await dbReady()).run("UPDATE ifcdc_support_orders SET lock_until = 0 WHERE id = ? AND lock_until = ?", id, lock); }
    },
    async inquiry(input: any, ip: string) {
      exact(input, ["name", "email", "service", "message", "consent", "website"]);
      const clean = (value: unknown, min: number, max: number) => typeof value === "string" && value.trim().length >= min && value.length <= max && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value);
      if (input.website || input.consent !== true || !services.includes(input.service) || !clean(input.name, 2, 100) || !clean(input.message, 10, 3000) ||
          typeof input.email !== "string" || input.email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.email)) throw new SupportError(400, "Enter your name, email, service, and project details, then approve contact about your request.");
      await rate(ip, "inquiry", 3);
      const id = crypto.randomUUID();
      await (await dbReady()).run("INSERT INTO ifcdc_support_inquiries VALUES (?, ?, ?, ?, ?, ?)", id, input.name.trim(), input.email.trim(), input.service, input.message.trim(), now());
      return { id, message: "Your request is saved for IFCDC review. No payment was taken and no work has been booked." };
    },
    async admin() {
      const db = await dbReady(); const cfg = supportConfiguration(env);
      return { ready: cfg.ready, configured: cfg.configured, enabled: cfg.enabled, webhookConfigured: !!cfg.webhookId, bookConfigured: !!cfg.bookUrl,
        inquiries: await db.all("SELECT * FROM ifcdc_support_inquiries ORDER BY created_at DESC LIMIT 50"),
        records: await db.all(`SELECT o.id, o.kind, o.cents, o.status, o.provider_id, o.created_at, m.email
          FROM ifcdc_support_orders o LEFT JOIN ifcdc_support_members m ON m.checkout_id = o.id ORDER BY o.created_at DESC LIMIT 50`),
        ledger: await db.all("SELECT * FROM ifcdc_support_ledger ORDER BY paid_at DESC LIMIT 50") };
    },
    async webhook(headers: Record<string, string | undefined>, event: any) {
      const cfg = config(false);
      if (!/^[A-Z0-9-]{1,100}$/.test(cfg.webhookId)) throw new SupportError(503, "Webhook is not configured.");
      if (!event || typeof event.id !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(event.id) || typeof event.event_type !== "string" || !event.resource || JSON.stringify(event).length > 100_000) throw new SupportError(400, "Invalid webhook.");
      for (const key of ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"]) {
        if (!headers[key] || headers[key]!.length > 2500) throw new SupportError(400, "Missing signature.");
      }
      const cert = new URL(headers["paypal-cert-url"]!);
      if (cert.origin !== "https://api.paypal.com" || !cert.pathname.startsWith("/v1/notifications/certs/") || cert.username || cert.password || cert.search || cert.hash) throw new SupportError(400, "Invalid certificate URL.");
      const api = provider(false);
      const verified = await api("/v1/notifications/verify-webhook-signature", "POST", {
        auth_algo: headers["paypal-auth-algo"], cert_url: headers["paypal-cert-url"], transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"], transmission_time: headers["paypal-transmission-time"], webhook_id: cfg.webhookId, webhook_event: event,
      });
      if (verified.verification_status !== "SUCCESS") throw new SupportError(400, "Webhook signature was not verified.");
      const db = await dbReady(); const eventDigest = digest(JSON.stringify(event));
      await db.run("INSERT OR IGNORE INTO ifcdc_support_events(id, digest, type, status) VALUES (?, ?, ?, 'pending')", event.id, eventDigest, event.event_type);
      const prior = await db.get("SELECT * FROM ifcdc_support_events WHERE id = ?", event.id);
      if (prior.digest !== eventDigest) throw new SupportError(409, "Event identity mismatch.");
      if (prior.status === "done") return { received: true };
      const stamp = now() + 120_000;
      if (!(await db.run("UPDATE ifcdc_support_events SET lock_until = ? WHERE id = ? AND lock_until <= ?", stamp, event.id, now())).changes) throw new SupportError(409, "Event is being processed.");
      try {
        const resource = event.resource; let row: Row | undefined;
        if (event.event_type.startsWith("BILLING.SUBSCRIPTION.")) row = await db.get<Row>("SELECT * FROM ifcdc_support_orders WHERE provider_id = ? AND kind = 'membership'", resource.id);
        if (event.event_type.startsWith("PAYMENT.SALE.")) row = await db.get<Row>(`SELECT * FROM ifcdc_support_orders WHERE kind = 'membership' AND
          (provider_id = ? OR id IN (SELECT checkout_id FROM ifcdc_support_ledger WHERE provider_id = ?))`, resource.billing_agreement_id || "", resource.sale_id || resource.id);
        if (event.event_type.startsWith("PAYMENT.CAPTURE.")) row = await db.get<Row>(`SELECT * FROM ifcdc_support_orders WHERE kind = 'donation' AND (provider_id = ? OR id IN (SELECT checkout_id FROM ifcdc_support_ledger WHERE provider_id = ?))`, resource.supplementary_data?.related_ids?.order_id || "", resource.id);
        if (row) {
          if (row.merchant !== cfg.merchantId || row.app_hash !== digest(cfg.clientId)) throw new Error("Merchant changed");
          const lock = await lease(row);
          try {
            if (row.kind === "membership") {
              await syncMember(row);
              if (event.event_type.startsWith("PAYMENT.SALE.")) {
                const saleId = resource.sale_id || resource.id;
                if (typeof saleId !== "string" || !ID.test(saleId)) throw new Error("Invalid sale");
                const sale = await api(`/v1/payments/sale/${saleId}`);
                if (sale.id !== saleId || sale.billing_agreement_id !== row.provider_id || sale.amount?.currency !== "USD" ||
                    amountCents(sale.amount?.total, 100_000) !== row.cents || !["completed", "refunded", "partially_refunded", "reversed", "denied", "pending"].includes(sale.state) || !Number.isFinite(Date.parse(sale.create_time))) throw new Error("Sale mismatch");
                const existing = await db.get("SELECT checkout_id FROM ifcdc_support_ledger WHERE provider_id = ?", sale.id);
                if (existing && existing.checkout_id !== row.id) throw new Error("Sale belongs to another member");
                await db.run(`INSERT INTO ifcdc_support_ledger VALUES (?, ?, ?, 'USD', ?, ?) ON CONFLICT(provider_id) DO UPDATE SET status = excluded.status`, sale.id, row.id, row.cents, sale.state.toUpperCase(), sale.create_time);
              }
            } else await recordOrder(row, await api(`/v2/checkout/orders/${row.provider_id}`));
          } finally { await db.run("UPDATE ifcdc_support_orders SET lock_until = 0 WHERE id = ? AND lock_until = ?", row.id, lock); }
        }
        await db.run("UPDATE ifcdc_support_events SET status = 'done' WHERE id = ?", event.id);
        return { received: true };
      } finally { await db.run("UPDATE ifcdc_support_events SET lock_until = 0 WHERE id = ? AND lock_until = ?", event.id, stamp); }
    },
  };
}
