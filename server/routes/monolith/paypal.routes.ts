import { Router } from "express";
import { getMonolithDb } from "../../monolith/dbAccess";
import { cryptoRandomId } from "../../monolith/constants";

export function createPaypalRouter(): Router {
  const router = Router();

  router.get("/paypal/client-id", async (_req, res) => {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: "PayPal not configured" });
    }
    res.json({ clientId });
  });

  router.post("/paypal/create-order", async (req, res) => {
    try {
      const { amount, currency = "USD" } = req.body;

      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      const clientId = process.env.PAYPAL_CLIENT_ID;
      const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
      const isLive = process.env.PAYPAL_ENV === "live";

      if (!clientId || !clientSecret) {
        return res.status(500).json({ error: "PayPal not configured" });
      }

      const baseUrl = isLive ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

      const authRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: "grant_type=client_credentials",
      });

      const authData = (await authRes.json()) as { access_token?: string };
      if (!authData.access_token) {
        throw new Error("Failed to get PayPal access token");
      }

      const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authData.access_token}`,
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              amount: {
                currency_code: currency,
                value: parseFloat(amount).toFixed(2),
              },
            },
          ],
        }),
      });

      const orderData = await orderRes.json();
      res.json(orderData);
    } catch (err: any) {
      console.error("PayPal create order error:", err);
      res.status(500).json({ error: "Failed to create PayPal order" });
    }
  });

  router.post("/paypal/webhook-log", async (req, res) => {
    try {
      const payload = req.body;

      const payerEmail = payload.payer?.email_address || null;
      const amount = payload.purchase_units?.[0]?.amount?.value || null;
      const currency = payload.purchase_units?.[0]?.amount?.currency_code || "USD";
      const transactionId = payload.id || null;

      console.log("PayPal donation received:", transactionId);

      const db = getMonolithDb();
      const id = cryptoRandomId();
      const now = new Date().toISOString();

      await db.run(
        `
      INSERT INTO funding_events (source_key, intent, amount_cents, currency, external_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
        "paypal",
        "donation",
        Math.round(parseFloat(amount) * 100),
        currency,
        transactionId,
        JSON.stringify(payload),
      );

      await db.run(
        `
      INSERT INTO audit_logs (id, timestamp, user_id, user_role, method, path, entity_type, entity_id, action, ip_address, extra)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        id,
        now,
        null,
        null,
        "POST",
        "/api/paypal/webhook-log",
        "donation",
        transactionId,
        "PAYPAL_DONATION",
        req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket?.remoteAddress || null,
        JSON.stringify({
          payer_email: payerEmail,
          amount: amount,
          currency: currency,
          transaction_id: transactionId,
          intent: "donation",
          source: "paypal",
          status: payload.status,
        }),
      );

      res.json({ logged: true });
    } catch (err) {
      console.error("PayPal webhook log error:", err);
      res.status(500).json({ error: "Failed to log donation" });
    }
  });

  router.post("/paypal/capture-order/:orderId", async (req, res) => {
    try {
      const { orderId } = req.params;

      const clientId = process.env.PAYPAL_CLIENT_ID;
      const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
      const isLive = process.env.PAYPAL_ENV === "live";

      if (!clientId || !clientSecret) {
        return res.status(500).json({ error: "PayPal not configured" });
      }

      const baseUrl = isLive ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

      const authRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: "grant_type=client_credentials",
      });

      const authData = (await authRes.json()) as { access_token?: string };
      if (!authData.access_token) {
        throw new Error("Failed to get PayPal access token");
      }

      const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authData.access_token}`,
        },
      });

      const captureData = await captureRes.json();
      res.json(captureData);
    } catch (err: any) {
      console.error("PayPal capture order error:", err);
      res.status(500).json({ error: "Failed to capture PayPal order" });
    }
  });

  return router;
}

export function registerPaypalRoutes(app: import("express").Express): void {
  app.use("/api", createPaypalRouter());
}
