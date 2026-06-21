import express, { Router, type Request, type Response } from "express";
import { createStripePayments, formatCurrency } from "@ifcdc/payments";
import { z } from "zod";

const intentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default("usd"),
  description: z.string().optional(),
  customerId: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

export function createPaymentRouter(secretKey: string, webhookSecret?: string) {
  const payments = createStripePayments({ secretKey, webhookSecret });
  const router = Router();

  router.post("/create-intent", async (req: Request, res: Response) => {
    const parsed = intentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const result = await payments.createPaymentIntent(parsed.data);
    res.status(result.success ? 200 : 500).json(result);
  });

  router.post("/webhook", express.raw({ type: "application/json" }), async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"] as string;
    const event = await payments.verifyWebhook(req.body, signature);
    if (!event) return res.status(400).json({ error: "Invalid webhook signature" });
    res.json({ received: true, event });
  });

  router.get("/format", (req: Request, res: Response) => {
    const amount = parseFloat(req.query.amount as string);
    const currency = (req.query.currency as string) || "USD";
    res.json({ formatted: formatCurrency(amount, currency) });
  });

  return { router, payments };
}
