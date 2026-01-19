import { Router } from "express";
import { getUncachableStripeClient } from "../stripeClient";

const router = Router();

router.post("/donate", async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "Amount required" });
    }

    const stripe = await getUncachableStripeClient();
    const host = req.get('host') || 'localhost:5000';
    const protocol = req.protocol;

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
      success_url: `${protocol}://${host}/thank-you.html`,
      cancel_url: `${protocol}://${host}/donate.html`
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("Donation error:", err);
    res.status(500).json({ error: "Donation failed" });
  }
});

export default router;
