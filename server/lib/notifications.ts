/**
 * HQ notification dispatch — routes through @ifcdc/notifications microservice when available,
 * with in-process Resend/Twilio fallback.
 */
import {
  createNotificationService,
  createTwilioSmsProvider,
  type NotificationPayload,
  type NotificationResult,
} from "@ifcdc/notifications";
import { IFCDC_SERVICE_URLS } from "./ifcdc";

function createResendEmailProvider() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || process.env.FOUNDER_EMAIL || "hq@ifcdc.org";
  if (!apiKey) return undefined;
  return {
    async send(payload: NotificationPayload): Promise<NotificationResult> {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: payload.to,
            subject: payload.subject ?? "IFCDC Headquarters",
            html: payload.body.replace(/\n/g, "<br>"),
          }),
          signal: AbortSignal.timeout(20000),
        });
        const data = (await res.json()) as { id?: string; message?: string };
        if (!res.ok) {
          return { success: false, error: data.message ?? `Resend error ${res.status}` };
        }
        return { success: true, messageId: data.id };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Email send failed" };
      }
    },
  };
}

const smsProvider =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
    ? createTwilioSmsProvider(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
        process.env.TWILIO_FROM_NUMBER
      )
    : undefined;

const localNotifications = createNotificationService({
  email: createResendEmailProvider(),
  sms: smsProvider,
});

async function sendViaMicroservice(payload: NotificationPayload): Promise<NotificationResult | null> {
  const base = IFCDC_SERVICE_URLS.notifications;
  if (!base || process.env.IFCDC_NOTIFICATIONS_INLINE === "true") return null;
  try {
    const res = await fetch(`${base}/api/notifications/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
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
  return localNotifications.send(payload);
}

export async function sendHqNotificationBulk(payloads: NotificationPayload[]): Promise<NotificationResult[]> {
  const base = IFCDC_SERVICE_URLS.notifications;
  if (base && process.env.IFCDC_NOTIFICATIONS_INLINE !== "true") {
    try {
      const res = await fetch(`${base}/api/notifications/send-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloads }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const data = (await res.json()) as { results?: NotificationResult[] };
        if (Array.isArray(data.results)) return data.results;
      }
    } catch {
      /* fall through */
    }
  }
  return localNotifications.sendBulk(payloads);
}
