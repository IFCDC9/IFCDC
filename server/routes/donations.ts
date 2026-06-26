import express from "express";
import { getStripe } from "../stripe";
import { getDb } from "../db";

const router = express.Router();

router.post("/donate", async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: "Donations are not configured. Set STRIPE_SECRET_KEY in .env" });
    }

    const { amount, recurring } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      mode: recurring ? "subscription" : "payment",
      payment_method_types: ["card"],
      line_items: [
        recurring
          ? {
              price_data: {
                currency: "usd",
                product_data: { name: "IFCDC Monthly Donation" },
                recurring: { interval: "month" },
                unit_amount: Math.round(amount * 100),
              },
              quantity: 1,
            }
          : {
              price_data: {
                currency: "usd",
                product_data: { name: "IFCDC Donation" },
                unit_amount: Math.round(amount * 100),
              },
              quantity: 1,
            },
      ],
      success_url: `${baseUrl}/thank-you.html`,
      cancel_url: `${baseUrl}/donate.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Donation failed" });
  }
});

// Stripe webhook - must use raw body for signature verification
router.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.error("STRIPE_WEBHOOK_SECRET not configured");
      return res.status(500).json({ error: "Webhook not configured" });
    }

    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: "Stripe is not configured" });
    }

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as any;
        const database = await getDb();

        await database.run(`
          INSERT INTO funding_events (source_key, intent, amount_cents, currency, external_id, metadata)
          VALUES (?, ?, ?, ?, ?, ?)
        `, "stripe", "donation", session.amount_total, session.currency || "usd", session.id, JSON.stringify(session));

        console.log("Stripe donation logged:", session.id);
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error("Stripe webhook error:", err.message);
      res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }
  }
);

export default router;
