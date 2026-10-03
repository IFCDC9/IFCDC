/**
 * HQ notification dispatch — Postmark primary, Resend legacy fallback, Twilio SMS.
 * Never calls a localhost microservice in production by default.
 * POSTMARK_SERVER_TOKEN is read from the environment and is never logged.
 */
import { sendTransactionalEmail, type TransactionalEmailCategory } from "./transactionalEmail";
import {
  createNotificationService,
  createTwilioSmsProvider,
  type NotificationPayload,
  type NotificationResult,
} from "@ifcdc/notifications";
import { IFCDC_SERVICE_URLS } from "./ifcdc";

/** Extended provider result for Founder OTP audit logging. */
export type HqDeliveryResult = NotificationResult & {
  providerCode?: string | number;
  providerStatus?: string | number;
  providerResponse?: Record<string, unknown>;
};

function resolveResendApiKey(): string | null {
  const key = (
    process.env.RESEND_API_KEY
    || process.env.EMAIL_API_KEY
    || process.env.SMTP_API_KEY
    || ""
  ).trim();
  return key || null;
}

/** Prefer verified domain addresses; fall back safely. */
export function resolveResendFromEmail(): string {
  const raw = (
    process.env.RESEND_FROM_EMAIL
    || process.env.EMAIL_FROM
    || process.env.SMTP_FROM
    || process.env.FOUNDER_EMAIL
    || process.env.MASTER_OWNER_EMAIL
    || "IFCDC Headquarters <service@ifcdc.org>"
  ).trim();
  // Resend accepts "Name <email@domain>" or bare email.
  if (/^[^<>\s]+@[^<>\s]+$/.test(raw)) {
    return `IFCDC Headquarters <${raw}>`;
  }
  return raw;
}

export function getEmailDeliveryStatus(): {
  configured: boolean;
  provider: "resend" | "none";
  from: string | null;
  apiKeySet: boolean;
  notificationsUrl: string | null;
  inlineOnly: boolean;
} {
  const apiKeySet = Boolean(resolveResendApiKey());
  const notificationsUrl = (process.env.IFCDC_NOTIFICATIONS_URL || "").trim() || null;
  const inlineOnly =
    process.env.IFCDC_NOTIFICATIONS_INLINE === "true"
    || (process.env.NODE_ENV === "production" && !notificationsUrl);
  return {
    configured: apiKeySet,
    provider: apiKeySet ? "resend" : "none",
    from: apiKeySet ? resolveResendFromEmail() : null,
    apiKeySet,
    notificationsUrl,
    inlineOnly,
  };
}

function emailCategoryFromMetadata(metadata: NotificationPayload["metadata"]): TransactionalEmailCategory {
  const raw = typeof metadata?.emailCategory === "string" ? metadata.emailCategory : "";
  const allowed: TransactionalEmailCategory[] = [
    "account_verification",
    "password_reset",
    "booking_confirmation",
    "booking_change",
    "booking_cancellation",
    "receipt",
    "system_alert",
    "security_alert",
    "application_notification",
    "hq_operational",
  ];
  return (allowed as string[]).includes(raw) ? raw as TransactionalEmailCategory : "hq_operational";
}

/** Legacy name kept. Transport is Postmark first, then the existing Resend path. */
function createResendEmailProvider() {
  return {
    async send(payload: NotificationPayload): Promise<HqDeliveryResult> {
      const text = payload.body;
      let html =
        typeof payload.metadata?.html === "string" && payload.metadata.html.trim()
          ? String(payload.metadata.html)
          : "";
      if (!html) {
        try {
          const { renderEmailTemplate } = await import("../hq/emailTemplates");
          html = renderEmailTemplate("generic", {
            message: text,
            subjectOverride: payload.subject || "IFCDC Headquarters",
            fields: { headline: payload.subject || "IFCDC Headquarters" },
          }).html;
        } catch {
          html = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>");
        }
      }
      return sendTransactionalEmail({
        to: payload.to,
        subject: payload.subject ?? "IFCDC Headquarters",
        text,
        html,
        category: emailCategoryFromMetadata(payload.metadata),
      });
    },
  };
}

function createLocalNotificationService() {
  const sms =
    process.env.TWILIO_ACCOUNT_SID
    && process.env.TWILIO_AUTH_TOKEN
    && (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_SMS_FROM)
      ? createTwilioSmsProvider(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN,
          process.env.TWILIO_FROM_NUMBER
            || process.env.TWILIO_PHONE_NUMBER
            || process.env.TWILIO_SMS_FROM
            || ""
        )
      : undefined;

  return createNotificationService({
    email: createResendEmailProvider(),
    sms,
  });
}

/** Only call remote notifications when an explicit production URL is set. */
function remoteNotificationsBase(): string | null {
  if (process.env.IFCDC_NOTIFICATIONS_INLINE === "true") return null;
  const explicit = (process.env.IFCDC_NOTIFICATIONS_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  // Never use the localhost:4102 default from IFCDC_SERVICE_URLS in production/deployed HQ —
  // that host has no notifications microservice and only wastes the voice webhook timeout.
  const fallback = IFCDC_SERVICE_URLS.notifications;
  if (!fallback || /localhost|127\.0\.0\.1/.test(fallback)) return null;
  return fallback.replace(/\/$/, "");
}

async function sendViaMicroservice(payload: NotificationPayload): Promise<NotificationResult | null> {
  const base = remoteNotificationsBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/notifications/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as NotificationResult;
  } catch {
    return null;
  }
}

export async function sendHqNotification(payload: NotificationPayload): Promise<NotificationResult> {
  // Email stays on the HQ transactional path (Postmark, then Resend). SMS may still use the remote service.
  if (payload.channel === "email") {
    const local = await createLocalNotificationService().send(payload);
    if (local.success) return local;
    const noProvider = /not configured|no transactional email provider/i.test(local.error || "");
    if (noProvider) {
      const remote = await sendViaMicroservice(payload);
      if (remote?.success) return remote;
    }
    return local;
  }
  const remote = await sendViaMicroservice(payload);
  if (remote?.success) return remote;
  // Rebuild each send so runtime env (Render) is always current.
  return createLocalNotificationService().send(payload);
}

export async function sendHqNotificationBulk(payloads: NotificationPayload[]): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];
  for (const payload of payloads) {
    results.push(await sendHqNotification(payload));
  }
  return results;
}

/** Prefer configured From; if its domain is unverified, fall back to a verified Resend domain. */
export async function resolveVerifiedResendFromEmail(): Promise<{
  from: string;
  configuredFrom: string;
  usedFallback: boolean;
  probe: Awaited<ReturnType<typeof probeResendSender>>;
}> {
  const configuredFrom = resolveResendFromEmail();

  // Probe first — when ifcdc.org (or configured domain) is already verified, do not
  // touch the emergency domain (avoids Resend rate limits + false fallback reporting).
  let probe = await probeResendSender();
  if (probe.ok) {
    return { from: configuredFrom, configuredFrom, usedFallback: false, probe };
  }

  // Configured domain not verified yet — ensure last-known working sender exists, then re-probe.
  try {
    const { restoreEmergencyResendSender, RESEND_EMERGENCY_FALLBACK_DOMAIN } =
      await import("../hq/resendDomainEngine");
    const restored = await restoreEmergencyResendSender();
    if (!restored.verified) {
      console.warn(
        `[email] Emergency Resend domain ${RESEND_EMERGENCY_FALLBACK_DOMAIN} status=${restored.status || "unknown"} — ${restored.error || restored.verifyMessage || "pending"}`,
      );
    }
    probe = await probeResendSender();
    if (probe.ok) {
      return { from: configuredFrom, configuredFrom, usedFallback: false, probe };
    }
  } catch (err) {
    console.error(
      "[email] Emergency Resend domain restore failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const verified = (probe.domains || []).find((d) => d.status === "verified");
  if (verified) {
    const local =
      configuredFrom.match(/<([^@>]+)@/)?.[1]
      || configuredFrom.match(/^([^@\s]+)@/)?.[1]
      || "service";
    const from = `IFCDC Headquarters <${local}@${verified.name}>`;
    console.warn(
      `[email] RESEND_FROM_EMAIL domain unverified (${configuredFrom}). Falling back to verified domain: ${from}`,
    );
    return { from, configuredFrom, usedFallback: true, probe };
  }

  // Last-known working From when Resend has no verified domains yet (DNS re-verify in progress).
  const { RESEND_EMERGENCY_FROM } = await import("../hq/resendDomainEngine");
  console.error(
    `[email] No verified Resend domain available. Using emergency From ${RESEND_EMERGENCY_FROM}. Probe: ${probe.error || "unknown"}`,
  );
  return {
    from: RESEND_EMERGENCY_FROM,
    configuredFrom,
    usedFallback: true,
    probe,
  };
}

/** Security-critical Founder OTP. Postmark first; Resend fallback if Postmark is down or unset. */
export async function sendFounderSecurityEmail(opts: {
  to: string;
  subject: string;
  body: string;
  html?: string;
}): Promise<HqDeliveryResult> {
  const text = opts.body;
  let html = opts.html || "";
  if (!html) {
    try {
      const { renderEmailTemplate } = await import("../hq/emailTemplates");
      html = renderEmailTemplate("executive_alert", {
        message: text,
        fields: { alertTitle: opts.subject, priority: "High", source: "AURA" },
      }).html;
    } catch {
      html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
    }
  }

  return sendTransactionalEmail({
    to: opts.to,
    subject: opts.subject,
    text,
    html,
    category: "security_alert",
  });
}

function twilioErrorFields(err: unknown): {
  message: string;
  code?: number;
  status?: number;
  moreInfo?: string;
} {
  if (err && typeof err === "object") {
    const e = err as { message?: string; code?: number; status?: number; moreInfo?: string };
    return {
      message: e.message || "SMS send failed",
      code: e.code,
      status: e.status,
      moreInfo: e.moreInfo,
    };
  }
  return { message: err instanceof Error ? err.message : "SMS send failed" };
}

/** Direct Twilio SMS for Founder OTP with full error capture. */
export async function sendFounderSecuritySms(opts: {
  to: string;
  body: string;
}): Promise<HqDeliveryResult> {
  const sid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || "").trim();
  const from = (
    process.env.TWILIO_PHONE_NUMBER
    || process.env.HQ_PHONE_NUMBER
    || process.env.TWILIO_SMS_FROM
    || process.env.TWILIO_FROM_NUMBER
    || ""
  ).trim();

  if (!sid || !token) {
    const failResult: HqDeliveryResult = {
      success: false,
      error: "Twilio credentials missing (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)",
      providerCode: "missing_twilio_credentials",
    };
    emitSmsSendFailed(opts.to.trim(), failResult);
    return failResult;
  }
  if (!messagingServiceSid && !from) {
    const failResult: HqDeliveryResult = {
      success: false,
      error: "Twilio from number missing (TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID)",
      providerCode: "missing_from_number",
    };
    emitSmsSendFailed(opts.to.trim(), failResult);
    return failResult;
  }

  const to = opts.to.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(to)) {
    const failResult: HqDeliveryResult = {
      success: false,
      error: `Invalid E.164 destination: ${to}`,
      providerCode: "invalid_e164",
      providerResponse: { to },
    };
    emitSmsSendFailed(to, failResult);
    return failResult;
  }

  try {
    const twilio = await import("twilio");
    const client = twilio.default(sid, token);
    const { resolveAuraSmsStatusCallbackUrl } = await import("../hq/twilioIntegrationEngine");
    const statusCallback = resolveAuraSmsStatusCallbackUrl();
    if (messagingServiceSid) {
      console.log(
        `[sms] Twilio send → to=${to} messagingServiceSid=${messagingServiceSid}`
        + (statusCallback ? ` statusCallback=${statusCallback}` : " statusCallback=omitted")
      );
    } else {
      const fromE164 = from.startsWith("+") ? from : `+${from.replace(/\D/g, "")}`;
      console.log(
        `[sms] Twilio send → to=${to} from=${fromE164}`
        + (statusCallback ? ` statusCallback=${statusCallback}` : " statusCallback=omitted")
      );
    }

    const statusFields = statusCallback
      ? { statusCallback, statusCallbackMethod: "POST" as const }
      : {};

    const message = await client.messages.create(
      messagingServiceSid
        ? { to, body: opts.body, messagingServiceSid, ...statusFields }
        : {
            to,
            body: opts.body,
            from: from.startsWith("+") ? from : `+${from.replace(/\D/g, "")}`,
            ...statusFields,
          }
    );
    if (message.errorCode) {
      console.error(
        `[sms] Twilio accepted with error sid=${message.sid} status=${message.status}`
        + ` errorCode=${message.errorCode} errorMessage=${message.errorMessage || ""}`
      );
      const failResult: HqDeliveryResult = {
        success: false,
        error: message.errorMessage || `Twilio error ${message.errorCode}`,
        messageId: message.sid,
        providerCode: message.errorCode,
        providerStatus: message.status,
        providerResponse: {
          sid: message.sid,
          status: message.status,
          to: message.to,
          from: message.from,
          errorCode: message.errorCode,
          errorMessage: message.errorMessage,
        },
      };
      emitSmsSendFailed(to, failResult);
      return failResult;
    }
    console.log(`[sms] Twilio ok sid=${message.sid} status=${message.status}`);
    return {
      success: true,
      messageId: message.sid,
      providerStatus: message.status,
      providerResponse: {
        sid: message.sid,
        status: message.status,
        to: message.to,
        from: message.from,
        errorCode: message.errorCode,
        errorMessage: message.errorMessage,
      },
    };
  } catch (err) {
    const detail = twilioErrorFields(err);
    console.error(
      `[sms] Twilio failed code=${detail.code ?? "n/a"} status=${detail.status ?? "n/a"}: ${detail.message}`
      + (detail.moreInfo ? ` moreInfo=${detail.moreInfo}` : "")
    );
    const failResult: HqDeliveryResult = {
      success: false,
      error: detail.message,
      providerCode: detail.code,
      providerStatus: detail.status,
      providerResponse: {
        code: detail.code,
        status: detail.status,
        moreInfo: detail.moreInfo,
        message: detail.message,
      },
    };
    emitSmsSendFailed(to, failResult);
    return failResult;
  }
}

function emitSmsSendFailed(to: string, result: HqDeliveryResult): void {
  void import("../hq/auraOperationalEvents").then(({ emitAuraOperationalEventAsync }) =>
    emitAuraOperationalEventAsync({
      type: "sms_send_failed",
      title: "AURA SMS send failed",
      detail: result.error || "Twilio send failed",
      entityType: "sms",
      entityId: result.messageId || null,
      severity: "high",
      alertFounder: true,
      metadata: {
        to,
        providerCode: result.providerCode ?? null,
        providerStatus: result.providerStatus ?? null,
        twilioConfigUntouched: true,
      },
    })
  );
}

/** Probe Resend sender/domain authorization without sending email. */
export async function probeResendSender(): Promise<{
  ok: boolean;
  apiKeySet: boolean;
  from: string;
  domains?: { name: string; status: string }[];
  error?: string;
  providerStatus?: number;
}> {
  const apiKey = resolveResendApiKey();
  const from = resolveResendFromEmail();
  if (!apiKey) {
    return { ok: false, apiKeySet: false, from, error: "RESEND_API_KEY not set" };
  }
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      data?: { name: string; status: string }[];
      message?: string;
      error?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        apiKeySet: true,
        from,
        error: data.message || data.error || `Resend domains API ${res.status}`,
        providerStatus: res.status,
      };
    }
    const domains = (data.data || []).map((d) => ({ name: d.name, status: d.status }));
    const fromDomain = from.match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase();
    const matched = fromDomain
      ? domains.find((d) => d.name.toLowerCase() === fromDomain)
      : undefined;
    const domainOk = Boolean(matched && matched.status === "verified");
    // Fail closed: the From domain itself must be verified — not just any domain on the account.
    return {
      ok: domainOk,
      apiKeySet: true,
      from,
      domains,
      error: domainOk
        ? undefined
        : fromDomain
          ? matched
            ? `Sender domain ${fromDomain} status=${matched.status} (must be verified)`
            : `Sender domain ${fromDomain} is not registered in Resend`
          : `Could not parse domain from RESEND_FROM_EMAIL (${from})`,
      providerStatus: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      apiKeySet: true,
      from,
      error: err instanceof Error ? err.message : "Resend probe failed",
    };
  }
}
