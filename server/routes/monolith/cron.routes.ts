import type { Express, Request, Response } from "express";
import type { Twilio } from "twilio";
import { runAppointmentReminderCron } from "../../monolith/appointmentReminders";

export function registerCronRoutes(
  app: Express,
  deps: {
    twilioClient: Twilio | null;
    twilioSmsFrom: string | undefined;
    cronSecret: string | undefined;
    apptReminderLeadHours: string | undefined;
    sendSafeSms: (to: string, body: string) => Promise<unknown>;
  },
): void {
  app.post("/api/cron/send-upcoming-reminders", async (req: Request, res: Response) => {
    try {
      const provided =
        req.get("X-IFCDC-CRON-TOKEN") || (req.query.token as string) || (req.body?.token as string);
      const globalFallback = parseInt(deps.apptReminderLeadHours || "24", 10);
      const result = await runAppointmentReminderCron({
        twilioClient: deps.twilioClient,
        twilioSmsFrom: deps.twilioSmsFrom,
        cronSecret: deps.cronSecret,
        globalFallbackHours: globalFallback,
        providedToken: provided,
        sendSms: deps.sendSafeSms,
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      console.error("Error in /api/cron/send-upcoming-reminders:", err);
      res.status(500).json({ error: "Cron reminder run failed." });
    }
  });
}
