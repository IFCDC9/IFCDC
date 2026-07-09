import type { Express } from "express";
import { getBuildInfo } from "../../buildInfo";
import { isApplicationReady } from "../../bootstrap/applicationState";
import { getGrantCenterQaReport, grantCenterQaEnvReady } from "../../hq/grantCenterQaCache";
import { getPayPalEnvStatus } from "../../hq/paypalIntegrationEngine";
import { getTwilioEnvStatus, getLastTwilioWebhookSync, getTwilioWebhookUrls, getTwilioPhoneEnvSources } from "../../hq/twilioIntegrationEngine";
import { getFounderPhoneReadiness } from "../../hq/auraFounderTrustEngine";
import {
  credentialsAreSeparated,
  getGrantsOperatorEmail,
  getSuperAdminEmail,
} from "../../config/credentials";
import { openAiConfigStatus } from "../../lib/openaiConfig";
import { getEmailDeliveryStatus, resolveResendFromEmail } from "../../lib/notifications";

export function registerHealthRoutes(app: Express): void {
  app.get("/api/health", async (_req, res) => {
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
    const twilioWebhooks = getTwilioWebhookUrls();
    const openai = openAiConfigStatus();
    const email = getEmailDeliveryStatus();
    const twilioPhoneSources = getTwilioPhoneEnvSources();
    let founderReadiness: Awaited<ReturnType<typeof getFounderPhoneReadiness>> | null = null;
    try {
      founderReadiness = await getFounderPhoneReadiness();
    } catch {
      founderReadiness = null;
    }

    let knowledgeBase: {
      total: number;
      embedded: number;
      chunks: number;
      embeddingsConfigured: boolean;
      bySource: { source_type: string; count: number }[];
      lastSync: { finished_at: string; status: string; ingested: number; skipped: number } | null;
    } | null = null;
    try {
      const { getKnowledgeBaseStatus } = await import("../../hq/knowledgeBaseEngine");
      const kb = await getKnowledgeBaseStatus();
      knowledgeBase = {
        total: kb.total,
        embedded: kb.embedded,
        chunks: kb.chunks,
        embeddingsConfigured: kb.embeddingsConfigured,
        bySource: kb.bySource ?? [],
        lastSync: kb.lastSync
          ? {
              finished_at: kb.lastSync.finished_at,
              status: kb.lastSync.status,
              ingested: kb.lastSync.ingested,
              skipped: kb.lastSync.skipped,
            }
          : null,
      };
    } catch {
      knowledgeBase = null;
    }

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
      knowledgeBase,
      credentials: {
        superAdminEmail: getSuperAdminEmail(),
        grantsOperatorEmail: getGrantsOperatorEmail(),
        separated: credentialsAreSeparated(),
      },
      integrations: {
        openai: {
          configured: openai.configured,
          source: openai.source,
          keyPrefix: openai.keyPrefix,
          keyLength: openai.keyLength,
          keyIntegrityOk: openai.keyIntegrityOk,
          baseURL: openai.baseURL,
          auraKeySet: openai.auraKeySet,
          primarySet: openai.primarySet,
          alternateSet: openai.alternateSet,
          integrationsBaseSet: openai.integrationsBaseSet,
          candidateCount: openai.candidateCount,
        },
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
          phoneNumberRaw: twilioEnv.phoneNumberRaw,
          resolvedFrom: twilioPhoneSources.resolvedFrom,
          auraConfigured: twilioEnv.auraConfigured,
          ready: twilioEnv.ready,
          webhookSync: twilioWebhookSync
            ? { synced: twilioWebhookSync.synced, success: twilioWebhookSync.success, message: twilioWebhookSync.message }
            : null,
          expectedWebhooks: {
            voice: twilioWebhooks.incomingVoice,
            sms: twilioWebhooks.incomingSms,
            status: twilioWebhooks.voiceStatus,
          },
          envSources: {
            TWILIO_PHONE_NUMBER: twilioPhoneSources.twilioPhoneNumberSet,
            HQ_PHONE_NUMBER: twilioPhoneSources.hqPhoneNumberSet,
            TWILIO_SMS_FROM: twilioPhoneSources.twilioSmsFromSet,
            TWILIO_VOICE_FROM: twilioPhoneSources.twilioVoiceFromSet,
            TWILIO_FROM_NUMBER: twilioPhoneSources.twilioFromNumberSet,
            PUBLIC_IFCDC_PHONE: twilioPhoneSources.publicIfcdcPhoneSet,
          },
        },
        email: {
          configured: email.configured,
          provider: email.provider,
          apiKeySet: email.apiKeySet,
          from: email.apiKeySet ? resolveResendFromEmail() : null,
          founderOtpTo: process.env.MASTER_OWNER_EMAIL || process.env.FOUNDER_EMAIL || "service@ifcdc.org",
          inlineOnly: email.inlineOnly,
          notificationsUrlSet: Boolean(email.notificationsUrl),
        },
        founder: founderReadiness
          ? {
              trustedPhones: founderReadiness.trustedPhones,
              otpEmail: founderReadiness.otpEmail,
              hqPhone: founderReadiness.hqPhone,
              envSources: founderReadiness.sources,
              matchTests: founderReadiness.matchTests,
            }
          : null,
      },
    });
  });
}
