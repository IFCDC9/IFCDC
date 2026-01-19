import express from "express";
import { stripe } from "../stripe";

const router = express.Router();

router.post("/donate", async (req, res) => {
  try {
    const { amount, recurring } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid donation amount" });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    if (recurring) {
      // Create a subscription checkout session
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "IFCDC Monthly Donation",
              },
              unit_amount: Math.round(amount * 100),
              recurring: {
                interval: "month",
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/thank-you.html`,
        cancel_url: `${baseUrl}/donate.html`,
      });

      return res.json({ url: session.url });
    }

    // One-time payment
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "IFCDC Donation",
            },
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
    console.error("DONATION ERROR:", err);
    res.status(500).json({ error: "Failed to start donation" });
  }
});

export default router;
