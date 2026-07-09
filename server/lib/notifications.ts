/**
 * HQ notification dispatch — Resend email + Twilio SMS (inline).
 * Never calls a localhost microservice in production by default.
 */
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

function createResendEmailProvider() {
  const apiKey = resolveResendApiKey();
  if (!apiKey) return undefined;
  return {
    async send(payload: NotificationPayload): Promise<HqDeliveryResult> {
      const from = resolveResendFromEmail();
      const text = payload.body;
      const html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      try {
        console.log(`[email] Resend send → to=${payload.to} from=${from} subject=${payload.subject ?? "(none)"}`);
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [payload.to],
            subject: payload.subject ?? "IFCDC Headquarters",
            text,
            html,
          }),
          signal: AbortSignal.timeout(12_000),
        });
        const data = (await res.json().catch(() => ({}))) as {
          id?: string;
          message?: string;
          name?: string;
          error?: string;
          statusCode?: number;
        };
        if (!res.ok) {
          const err =
            data.message
            || data.error
            || data.name
            || `Resend error ${res.status}`;
          console.error(`[email] Resend failed status=${res.status}: ${err}`, JSON.stringify(data));
          return {
            success: false,
            error: err,
            providerCode: data.name || data.statusCode || res.status,
            providerStatus: res.status,
            providerResponse: data as Record<string, unknown>,
          };
        }
        console.log(`[email] Resend ok id=${data.id ?? "unknown"}`);
        return {
          success: true,
          messageId: data.id,
          providerStatus: res.status,
          providerResponse: data as Record<string, unknown>,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Email send failed";
        console.error(`[email] Resend exception: ${message}`);
        return { success: false, error: message, providerResponse: { exception: message } };
      }
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

/** Direct Resend path for security-critical Founder OTP (skips microservice). */
export async function sendFounderSecurityEmail(opts: {
  to: string;
  subject: string;
  body: string;
}): Promise<HqDeliveryResult> {
  const provider = createResendEmailProvider();
  if (!provider) {
    return {
      success: false,
      error: "RESEND_API_KEY is not configured on Headquarters (Render env)",
      providerCode: "missing_api_key",
    };
  }
  return provider.send({
    channel: "email",
    to: opts.to,
    subject: opts.subject,
    body: opts.body,
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
    return {
      success: false,
      error: "Twilio credentials missing (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)",
      providerCode: "missing_twilio_credentials",
    };
  }
  if (!messagingServiceSid && !from) {
    return {
      success: false,
      error: "Twilio from number missing (TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID)",
      providerCode: "missing_from_number",
    };
  }

  const to = opts.to.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(to)) {
    return {
      success: false,
      error: `Invalid E.164 destination: ${to}`,
      providerCode: "invalid_e164",
      providerResponse: { to },
    };
  }

  try {
    const twilio = await import("twilio");
    const client = twilio.default(sid, token);
    if (messagingServiceSid) {
      console.log(`[sms] Twilio send → to=${to} messagingServiceSid=${messagingServiceSid}`);
    } else {
      const fromE164 = from.startsWith("+") ? from : `+${from.replace(/\D/g, "")}`;
      console.log(`[sms] Twilio send → to=${to} from=${fromE164}`);
    }

    const message = await client.messages.create(
      messagingServiceSid
        ? { to, body: opts.body, messagingServiceSid }
        : { to, body: opts.body, from: from.startsWith("+") ? from : `+${from.replace(/\D/g, "")}` }
    );
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
    return {
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
  }
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
    const domainOk = fromDomain
      ? domains.some((d) => d.name.toLowerCase() === fromDomain && d.status === "verified")
      : false;
    return {
      ok: domainOk || domains.some((d) => d.status === "verified"),
      apiKeySet: true,
      from,
      domains,
      error: domainOk ? undefined : `Sender domain may be unverified (from=${from})`,
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
