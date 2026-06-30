import type { Express } from "express";
import type { Twilio } from "twilio";
import type { createTwilioSenders } from "../../monolith/twilioHelpers";
import { registerHealthRoutes } from "./health.routes";
import { registerPublicPageRoutes } from "./publicPages.routes";
import { registerLegacyAuthRoutes } from "./auth.routes";
import { registerAdminRoutes } from "./admin.routes";
import { registerClientRoutes } from "./clients.routes";
import { registerCronRoutes } from "./cron.routes";
import { registerProgramsRoutes } from "./programs.routes";
import { registerUsersRoutes } from "./users.routes";
import { registerBookingsRoutes } from "./bookings.routes";
import { registerDashboardRoutes } from "./dashboard.routes";
import { registerReportsRoutes } from "./reports.routes";
import { registerOutreachRoutes } from "./outreach.routes";
import { registerTwilioRoutes } from "./twilio.routes";
import { registerLegacyHrRoutes } from "./legacy-hr.routes";
import { registerBarbershopRoutes } from "./barbershop.routes";
import { registerPaypalRoutes } from "./paypal.routes";
import { registerAiRoutes } from "./ai.routes";
import { registerPoliciesRoutes } from "./policies.routes";
import { registerPublicChatbotRoutes } from "./publicChatbot.routes";

type TwilioSenders = ReturnType<typeof createTwilioSenders>;

export interface MonolithRouteDeps {
  twilio: TwilioSenders;
  twilioClient: Twilio | null;
  twilioSmsFrom: string | undefined;
  cronSecret: string | undefined;
  apptReminderLeadHours: string | undefined;
  publicIfcdcPhone?: string;
}

/** Mount extracted monolith route modules (Phase 0 M0.3). */
export function registerMonolithRoutes(app: Express, deps: MonolithRouteDeps): void {
  registerHealthRoutes(app);
  registerPublicPageRoutes(app);
  registerLegacyAuthRoutes(app);
  registerAdminRoutes(app);
  registerClientRoutes(app);
  registerProgramsRoutes(app);
  registerUsersRoutes(app);
  registerBookingsRoutes(app, deps.twilio);
  registerDashboardRoutes(app);
  registerReportsRoutes(app);
  registerOutreachRoutes(app);
  registerTwilioRoutes(app, deps.publicIfcdcPhone);
  registerLegacyHrRoutes(app);
  registerBarbershopRoutes(app, {
    twilioClient: deps.twilioClient,
    twilioSmsFrom: deps.twilioSmsFrom,
  });
  registerPaypalRoutes(app);
  registerAiRoutes(app);
  registerPoliciesRoutes(app);
  registerPublicChatbotRoutes(app);
}

export function registerMonolithCronRoutes(app: Express, deps: MonolithRouteDeps): void {
  registerCronRoutes(app, {
    twilioClient: deps.twilioClient,
    twilioSmsFrom: deps.twilioSmsFrom,
    cronSecret: deps.cronSecret,
    apptReminderLeadHours: deps.apptReminderLeadHours,
    sendSafeSms: deps.twilio.sendSafeSms,
  });
}

export { createAuthRouter, registerLegacyAuthRoutes } from "./auth.routes";
export { createAdminRouter, registerAdminRoutes } from "./admin.routes";
export { createClientsRouter, registerClientRoutes } from "./clients.routes";
