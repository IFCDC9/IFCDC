import { Router } from "express";
import { getMonolithDb } from "../../monolith/dbAccess";
import { cryptoRandomId } from "../../monolith/constants";
import {
  getPayPalAccessTokenForRoutes,
  getPayPalBaseUrl,
  getPayPalEnvStatus,
  resolvePayPalEnvironment,
} from "../../hq/paypalIntegrationEngine";

export function createPaypalRouter(): Router {
  const router = Router();

  router.get("/paypal/client-id", async (_req, res) => {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: "PayPal not configured" });
    }
    res.json({
      clientId,
      environment: resolvePayPalEnvironment(),
    });
  });

  router.post("/paypal/create-order", async (req, res) => {
    try {
      const { amount, currency = "USD" } = req.body;

      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      const envStatus = getPayPalEnvStatus();
      if (!envStatus.ready) {
        return res.status(500).json({ error: "PayPal not configured" });
      }

      const baseUrl = getPayPalBaseUrl();
      const accessToken = await getPayPalAccessTokenForRoutes();

      const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
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
      if (!orderRes.ok) {
        return res.status(orderRes.status).json(orderData);
      }
      res.json(orderData);
    } catch (err: unknown) {
      console.error("PayPal create order error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create PayPal order" });
    }
  });

  router.post("/paypal/webhook-log", async (req, res) => {
    try {
      const payload = req.body;

      const payerEmail = payload.payer?.email_address || null;
      const amount = payload.purchase_units?.[0]?.amount?.value || null;
      const currency = payload.purchase_units?.[0]?.amount?.currency_code || "USD";
      const transactionId = payload.id || null;

      if (!transactionId || amount == null) {
        return res.status(400).json({ error: "Invalid PayPal webhook payload" });
      }

      console.log("PayPal donation received:", transactionId);

      const db = getMonolithDb();
      const id = cryptoRandomId();
      const now = new Date().toISOString();

      await db.run(
        `
      INSERT INTO funding_events (id, source_key, intent, amount_cents, currency, external_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
        cryptoRandomId(),
        "paypal",
        "donation",
        Math.round(parseFloat(String(amount)) * 100),
        currency,
        transactionId,
        JSON.stringify(payload),
        now,
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

      const envStatus = getPayPalEnvStatus();
      if (!envStatus.ready) {
        return res.status(500).json({ error: "PayPal not configured" });
      }

      const baseUrl = getPayPalBaseUrl();
      const accessToken = await getPayPalAccessTokenForRoutes();

      const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const captureData = await captureRes.json();
      if (!captureRes.ok) {
        return res.status(captureRes.status).json(captureData);
      }
      res.json(captureData);
    } catch (err: unknown) {
      console.error("PayPal capture order error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to capture PayPal order" });
    }
  });

  return router;
}

export function registerPaypalRoutes(app: import("express").Express): void {
  app.use("/api", createPaypalRouter());
}
