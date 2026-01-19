import { Router } from "express";

const router = Router();

router.post("/donate", async (req, res) => {
  try {
    const { amount = 50 } = req.body;
    
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const isLive = process.env.PAYPAL_ENV === "live";
    
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: "PayPal not configured" });
    }

    const baseUrl = isLive 
      ? "https://api-m.paypal.com" 
      : "https://api-m.sandbox.paypal.com";

    const authRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
      },
      body: "grant_type=client_credentials"
    });
    
    const authData = await authRes.json() as { access_token?: string };
    if (!authData.access_token) {
      throw new Error("Failed to get PayPal access token");
    }

    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authData.access_token}`
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          description: "IFCDC Donation",
          amount: {
            currency_code: "USD",
            value: parseFloat(amount).toFixed(2)
          }
        }],
        application_context: {
          return_url: `${req.protocol}://${req.get('host')}/thank-you.html`,
          cancel_url: `${req.protocol}://${req.get('host')}/donate.html`
        }
      })
    });

    const orderData = await orderRes.json() as { id?: string; links?: { rel: string; href: string }[] };
    const approveLink = orderData.links?.find((l: any) => l.rel === "approve");

    if (approveLink) {
      res.json({ url: approveLink.href, orderId: orderData.id });
    } else {
      res.status(500).json({ error: "Failed to create donation session" });
    }
  } catch (err: any) {
    console.error("Donate error:", err);
    res.status(500).json({ error: "Failed to start donation" });
  }
});

export default router;
