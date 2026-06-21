import { createNotificationService, createTwilioSmsProvider, type NotificationPayload } from "@ifcdc/notifications";
import { Router, type Request, type Response } from "express";
import { z } from "zod";

const sendSchema = z.object({
  to: z.string(),
  body: z.string(),
  channel: z.enum(["email", "sms", "push", "in-app"]),
  subject: z.string().optional(),
});

export function createNotificationRouter() {
  const smsProvider = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
    ? createTwilioSmsProvider(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
        process.env.TWILIO_FROM_NUMBER
      )
    : undefined;

  const notifications = createNotificationService({ sms: smsProvider });
  const router = Router();

  router.post("/send", async (req: Request, res: Response) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const result = await notifications.send(parsed.data as NotificationPayload);
    res.status(result.success ? 200 : 500).json(result);
  });

  router.post("/send-bulk", async (req: Request, res: Response) => {
    const { messages } = req.body;
    if (!Array.isArray(messages)) return res.status(400).json({ error: "messages array required" });

    const results = await notifications.sendBulk(messages);
    res.json({ results, sent: results.filter((r) => r.success).length });
  });

  return { router, notifications };
}
