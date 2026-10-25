/** Founder-only USD 10.00 sandbox pilot. No production credential fallback. */
import crypto from "node:crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
// @ts-ignore Reference adapter is plain Node ESM and is bundled into the server.
import { createSandboxClient } from "../../script/ifcdc-checkout-pilot/paypal.mjs";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STATE = /^[a-f0-9]{64}$/;
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const TTL = 3 * 60 * 60_000;
export class SandboxCheckoutError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type Env = NodeJS.ProcessEnv;
type Row = {
  id: string; owner_id: string; attempt_id: string; state_hash: string; status: string;
  paypal_order_id: string | null; approval_url: string | null; capture_id: string | null;
  created_at: number; verified_at: number | null; lock_until: number;
  merchant_id: string;
};
export function sandboxConfiguration(env: Env = process.env) {
  let origin = "";
  try {
    const url = new URL(env.AURA_CHECKOUT_SANDBOX_ORIGIN || "");
    if (url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) origin = url.origin;
  } catch { /* Incomplete setup is reported without exposing secrets. */ }
  const clientId = env.AURA_CHECKOUT_SANDBOX_CLIENT_ID || "";
  const clientSecret = env.AURA_CHECKOUT_SANDBOX_CLIENT_SECRET || "";
  const merchantId = env.AURA_CHECKOUT_SANDBOX_MERCHANT_ID || "";
  const credential = (value: string) => !!value.trim() && value === value.trim() && !/[\x00-\x20\x7f]/.test(value);
  const ready = env.AURA_CHECKOUT_SANDBOX_ENABLED === "true" && !!origin &&
    credential(clientId) && credential(clientSecret) && /^[A-Z0-9]{1,64}$/.test(merchantId);
  return { ready, origin, clientId, clientSecret, merchantId };
}
export function validateApprovalUrl(value: unknown, orderId: string) {
  if (typeof value !== "string") throw new Error("Missing PayPal approval link");
  const url = new URL(value);
  if (url.origin !== "https://www.sandbox.paypal.com" || url.username || url.password || url.hash ||
      url.pathname !== "/checkoutnow" || url.searchParams.getAll("token").length !== 1 || url.searchParams.get("token") !== orderId) {
    throw new Error("Invalid PayPal sandbox approval link");
  }
  return url.href;
}
async function database() {
  const db = await getDb();
  await db.exec(`CREATE TABLE IF NOT EXISTS aura_sandbox_checkouts (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, attempt_id TEXT NOT NULL, state_hash TEXT NOT NULL,
    status TEXT NOT NULL, paypal_order_id TEXT UNIQUE, approval_url TEXT, capture_id TEXT UNIQUE,
    merchant_id TEXT NOT NULL, created_at INTEGER NOT NULL, verified_at INTEGER, lock_until INTEGER NOT NULL DEFAULT 0,
    UNIQUE(owner_id, attempt_id)
  );`);
  return db;
}
function receipt(row: Row) {
  return { id: row.id, status: row.status, environment: "sandbox", amount: "10.00", currency: "USD",
    orderId: row.paypal_order_id, captureId: row.capture_id, createdAt: row.created_at, verifiedAt: row.verified_at,
    expiresAt: row.created_at + TTL };
}
export function createSandboxCheckoutService(options: { env?: Env; fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const config = () => {
    const value = sandboxConfiguration(env);
    if (!value.ready) throw new SandboxCheckoutError(503, "Sandbox checkout needs configuration before testing.");
    return value;
  };
  const client = (merchant?: string) => {
    const cfg = config();
    if (merchant && merchant !== cfg.merchantId) throw new SandboxCheckoutError(409, "This checkout belongs to a different sandbox merchant configuration.");
    return createSandboxClient({ clientId: cfg.clientId, clientSecret: cfg.clientSecret,
      merchantId: cfg.merchantId, fetchImpl: options.fetchImpl ?? fetch });
  };
  async function owned(id: unknown, ownerId: string) {
    if (typeof id !== "string" || !UUID.test(id)) throw new SandboxCheckoutError(404, "Checkout not found.");
    const db = await database();
    const row = await db.get<Row>("SELECT * FROM aura_sandbox_checkouts WHERE id = ? AND owner_id = ?", id, ownerId);
    if (!row) throw new SandboxCheckoutError(404, "Checkout not found.");
    return row;
  }
  async function lock(row: Row, creating = false) {
    const db = await database();
    const lease = now() + 60_000;
    const permitted = creating ? "status IN ('creating', 'create_unknown')" : "status != 'completed'";
    const result = await db.run(`UPDATE aura_sandbox_checkouts SET lock_until = ? WHERE id = ? AND lock_until <= ? AND ${permitted}`, lease, row.id, now());
    if (!result.changes) throw new SandboxCheckoutError(409, "This checkout is being checked. Wait a moment, then refresh.");
    return lease;
  }
  async function audit(row: Row, action: string) {
    await logHqAudit({ action: `aura_sandbox_checkout_${action}`, entityType: "aura_sandbox_checkout", entityId: row.id,
      actorId: row.owner_id, metadata: { environment: "sandbox", amount: "10.00", currency: "USD" } });
  }
  async function saveCapture(row: Row, result: any, lease: number) {
    // Adapter validates order, merchant, amount, final capture and completion first.
    const captureId = result.purchase_units[0].payments.captures[0].id;
    const db = await database();
    const updated = await db.run(`UPDATE aura_sandbox_checkouts SET status = 'completed', capture_id = ?,
      verified_at = ?, lock_until = 0 WHERE id = ? AND lock_until = ?`, captureId, now(), row.id, lease);
    if (!updated.changes) throw new Error("Checkout lease changed");
    await audit(row, "verified");
    return receipt(await owned(row.id, row.owner_id));
  }
  return {
    async status(ownerId: string) {
      const db = await database();
      const rows = await db.all<Row[]>("SELECT * FROM aura_sandbox_checkouts WHERE owner_id = ? ORDER BY created_at DESC LIMIT 20", ownerId);
      return { ready: sandboxConfiguration(env).ready, environment: "sandbox", amount: "10.00", currency: "USD", records: rows.map(receipt) };
    },
    async create(ownerId: string, input: any) {
      const cfg = config();
      if (input?.approved !== true || typeof input.attemptId !== "string" || !UUID.test(input.attemptId) ||
          typeof input.state !== "string" || !STATE.test(input.state) || Object.keys(input).some(key => !["approved", "attemptId", "state"].includes(key))) {
        throw new SandboxCheckoutError(400, "Approve the fixed USD 10.00 sandbox checkout first.");
      }
      const db = await database();
      let row = await db.get<Row>("SELECT * FROM aura_sandbox_checkouts WHERE owner_id = ? AND attempt_id = ?", ownerId, input.attemptId);
      if (!row) {
        const recent = await db.get<{ count: number }>("SELECT COUNT(*) AS count FROM aura_sandbox_checkouts WHERE owner_id = ? AND created_at > ?", ownerId, now() - 60 * 60_000);
        if ((recent?.count ?? 0) >= 10) throw new SandboxCheckoutError(429, "Sandbox checkout limit reached. Try again in an hour.");
        const id = crypto.randomUUID();
        await db.run(`INSERT OR IGNORE INTO aura_sandbox_checkouts
          (id, owner_id, attempt_id, state_hash, status, merchant_id, created_at)
          VALUES (?, ?, ?, ?, 'creating', ?, ?)`, id, ownerId, input.attemptId, hash(input.state), cfg.merchantId, now());
        row = (await db.get<Row>("SELECT * FROM aura_sandbox_checkouts WHERE owner_id = ? AND attempt_id = ?", ownerId, input.attemptId))!;
      }
      if (row.state_hash !== hash(input.state)) throw new SandboxCheckoutError(409, "This checkout attempt has different return details.");
      if (row.merchant_id !== cfg.merchantId) throw new SandboxCheckoutError(409, "Sandbox merchant configuration changed.");
      if (row.status === "completed") return { ...receipt(row), approvalUrl: null };
      if (now() - row.created_at > TTL) throw new SandboxCheckoutError(409, "Checkout expired. Start a new sandbox test.");
      if (row.approval_url && row.paypal_order_id) return { ...receipt(row), approvalUrl: validateApprovalUrl(row.approval_url, row.paypal_order_id) };
      const lease = await lock(row, true);
      try {
        const callback = (result: string) => {
          const url = new URL("/hq/software-engineering", cfg.origin);
          url.searchParams.set("checkout", row!.id); url.searchParams.set("checkout_state", input.state);
          url.searchParams.set("checkout_result", result); return url.href;
        };
        const order = await client(row.merchant_id).createOrder({ requestId: `create-${row.id}`,
          returnUrl: callback("approved"), cancelUrl: callback("cancelled") });
        const link = order.links?.find((item: any) => ["payer-action", "approve"].includes(item.rel) && item.method === "GET");
        const approvalUrl = validateApprovalUrl(link?.href, order.id);
        await db.run(`UPDATE aura_sandbox_checkouts SET paypal_order_id = ?, approval_url = ?, status = 'awaiting_approval',
          lock_until = 0 WHERE id = ? AND lock_until = ?`, order.id, approvalUrl, row.id, lease);
        await audit(row, "created");
        return { ...receipt(await owned(row.id, ownerId)), approvalUrl };
      } catch {
        await db.run("UPDATE aura_sandbox_checkouts SET status = 'create_unknown', lock_until = 0 WHERE id = ? AND lock_until = ?", row.id, lease);
        throw new SandboxCheckoutError(502, "PayPal checkout could not be confirmed. Retry this same attempt; do not start another payment.");
      }
    },
    async capture(ownerId: string, id: unknown, input: any) {
      config();
      const row = await owned(id, ownerId);
      if (input?.approved !== true || typeof input.state !== "string" || !STATE.test(input.state) || hash(input.state) !== row.state_hash ||
          input.orderId !== row.paypal_order_id || !row.paypal_order_id || Object.keys(input).some(key => !["approved", "state", "orderId"].includes(key))) {
        throw new SandboxCheckoutError(400, "The checkout return details do not match. No payment was confirmed.");
      }
      if (row.status === "completed") return receipt(row);
      if (now() - row.created_at > TTL) throw new SandboxCheckoutError(409, "Checkout expired. Recheck the payment record before starting another test.");
      const lease = await lock(row);
      const db = await database();
      await db.run("UPDATE aura_sandbox_checkouts SET status = 'capture_pending' WHERE id = ? AND lock_until = ?", row.id, lease);
      try {
        const result = await client(row.merchant_id).captureOrder({ orderId: row.paypal_order_id, requestId: `capture-${row.id}` });
        return await saveCapture(row, result, lease);
      } catch {
        await db.run("UPDATE aura_sandbox_checkouts SET status = 'verification_required', lock_until = 0 WHERE id = ? AND lock_until = ?", row.id, lease);
        throw new SandboxCheckoutError(502, "Payment is not confirmed. Recheck this record before starting another test.");
      }
    },
    async reconcile(ownerId: string, id: unknown) {
      config();
      const row = await owned(id, ownerId);
      if (row.status === "completed") return receipt(row);
      if (!row.paypal_order_id) throw new SandboxCheckoutError(409, "Retry the original checkout attempt first.");
      const lease = await lock(row);
      try {
        // GET-only provider operation: can recover a completed capture, never moves funds.
        return await saveCapture(row, await client(row.merchant_id).reconcileOrder({ orderId: row.paypal_order_id }), lease);
      } catch {
        const db = await database();
        await db.run("UPDATE aura_sandbox_checkouts SET lock_until = 0 WHERE id = ? AND lock_until = ?", row.id, lease);
        throw new SandboxCheckoutError(502, "PayPal has not verified a completed payment for this record.");
      }
    },
  };
}
