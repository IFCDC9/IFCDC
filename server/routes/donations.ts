import express from "express";
import { stripe } from "../stripe";

const router = express.Router();

router.post("/donate", async (req, res) => {
  try {
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

export default router;
