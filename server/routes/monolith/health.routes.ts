import type { Express } from "express";
import { getBuildInfo } from "../../buildInfo";
import { isApplicationReady } from "../../bootstrap/applicationState";
import { getGrantCenterQaReport, grantCenterQaEnvReady } from "../../hq/grantCenterQaCache";
import { getPayPalEnvStatus } from "../../hq/paypalIntegrationEngine";
import { getTwilioEnvStatus, getLastTwilioWebhookSync } from "../../hq/twilioIntegrationEngine";
import {
  credentialsAreSeparated,
  getGrantsOperatorEmail,
  getSuperAdminEmail,
} from "../../config/credentials";

export function registerHealthRoutes(app: Express): void {
  app.get("/api/health", (_req, res) => {
    const build = getBuildInfo();
    const commit =
      process.env.RENDER_GIT_COMMIT?.slice(0, 7) ??
      process.env.GIT_COMMIT?.slice(0, 7) ??
      build.commit?.slice(0, 7) ??
      null;
    const qaEnv = grantCenterQaEnvReady();
    const qaReport = getGrantCenterQaReport();
    const paypalEnv = getPayPalEnvStatus();
    const twilioEnv = getTwilioEnvStatus();
    const twilioWebhookSync = getLastTwilioWebhookSync();
    res.json({
      app: "ifcdc-headquarters",
      status: "healthy",
      ready: isApplicationReady(),
      version: "1.0.0",
      platform: "IFCDC Enterprise Operating System",
      commit,
      branch: process.env.RENDER_GIT_BRANCH ?? process.env.GIT_BRANCH ?? null,
      builtAt: build.builtAt,
      environment: process.env.NODE_ENV ?? "development",
      port: Number(process.env.PORT) || 5000,
      grantCenterQa: {
        envReady: qaEnv.ready,
        missingEnv: qaEnv.missing,
        renderService: qaEnv.service,
        status: qaReport.status,
        pass: qaReport.pass,
        fail: qaReport.fail,
        completedAt: qaReport.completedAt ?? null,
        reportUrl: "/api/hq/grants/qa/report",
      },
      credentials: {
        superAdminEmail: getSuperAdminEmail(),
        grantsOperatorEmail: getGrantsOperatorEmail(),
        separated: credentialsAreSeparated(),
      },
      integrations: {
        paypal: {
          clientIdConfigured: paypalEnv.clientIdConfigured,
          clientSecretConfigured: paypalEnv.clientSecretConfigured,
          environment: paypalEnv.environment,
          envRaw: paypalEnv.envRaw,
          ready: paypalEnv.ready,
        },
        twilio: {
          accountSidConfigured: twilioEnv.accountSidConfigured,
          authTokenConfigured: twilioEnv.authTokenConfigured,
          phoneNumberConfigured: twilioEnv.phoneNumberConfigured,
          phoneNumber: twilioEnv.phoneNumber,
          auraConfigured: twilioEnv.auraConfigured,
          ready: twilioEnv.ready,
          webhookSync: twilioWebhookSync
            ? { synced: twilioWebhookSync.synced, success: twilioWebhookSync.success, message: twilioWebhookSync.message }
            : null,
          expectedWebhooks: {
            voice: "https://ifcdc-hq-wst6.onrender.com/api/twilio/aura/voice",
            sms: "https://ifcdc-hq-wst6.onrender.com/api/twilio/aura/sms",
            status: "https://ifcdc-hq-wst6.onrender.com/api/twilio/aura/voice/status",
          },
        },
      },
    });
  });
}
