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
    async send(payload: NotificationPayload): Promise<NotificationResult> {
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
        };
        if (!res.ok) {
          const err =
            data.message
            || data.error
            || data.name
            || `Resend error ${res.status}`;
          console.error(`[email] Resend failed status=${res.status}: ${err}`);
          return { success: false, error: err };
        }
        console.log(`[email] Resend ok id=${data.id ?? "unknown"}`);
        return { success: true, messageId: data.id };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Email send failed";
        console.error(`[email] Resend exception: ${message}`);
        return { success: false, error: message };
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
}): Promise<NotificationResult> {
  const provider = createResendEmailProvider();
  if (!provider) {
    return {
      success: false,
      error: "RESEND_API_KEY is not configured on Headquarters (Render env)",
    };
  }
  return provider.send({
    channel: "email",
    to: opts.to,
    subject: opts.subject,
    body: opts.body,
  });
}
