import { Router } from "express";
import { getUncachableStripeClient, getStripePublishableKey } from "../stripeClient";

const router = Router();

router.get("/stripe/publishable-key", async (_req, res) => {
  try {
    const publishableKey = await getStripePublishableKey();
    res.json({ publishableKey });
  } catch (err) {
    console.error("Error getting Stripe publishable key:", err);
    res.status(500).json({ error: "Stripe not configured" });
  }
});

router.post("/donate", async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "Amount required" });
    }

    const stripe = await getUncachableStripeClient();
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "IFCDC Donation" },
          unit_amount: Math.round(amount * 100)
        },
        quantity: 1
      }],
      success_url: `${baseUrl}/thank-you.html`,
      cancel_url: `${baseUrl}/donate.html`
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("Donation error:", err);
    res.status(500).json({ error: "Donation failed" });
  }
});

export default router;
