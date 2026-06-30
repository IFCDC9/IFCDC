import type { Express } from "express";
import type { Twilio } from "twilio";
import { registerHealthRoutes } from "./health.routes";
import { registerPublicPageRoutes } from "./publicPages.routes";
import { registerLegacyAuthRoutes } from "./auth.routes";
import { registerAdminRoutes } from "./admin.routes";
import { registerClientRoutes } from "./clients.routes";
import { registerCronRoutes } from "./cron.routes";

/** Mount extracted monolith route modules (Phase 0 M0.3). */
export function registerMonolithRoutes(app: Express): void {
  registerHealthRoutes(app);
  registerPublicPageRoutes(app);
  registerLegacyAuthRoutes(app);
  registerAdminRoutes(app);
  registerClientRoutes(app);
}

export function registerMonolithCronRoutes(
  app: Express,
  deps: {
    twilioClient: Twilio | null;
    twilioSmsFrom: string | undefined;
    cronSecret: string | undefined;
    apptReminderLeadHours: string | undefined;
    sendSafeSms: (to: string, body: string) => Promise<unknown>;
  },
): void {
  registerCronRoutes(app, deps);
}

export { createAuthRouter, registerLegacyAuthRoutes } from "./auth.routes";
export { createAdminRouter, registerAdminRoutes } from "./admin.routes";
export { createClientsRouter, registerClientRoutes } from "./clients.routes";
