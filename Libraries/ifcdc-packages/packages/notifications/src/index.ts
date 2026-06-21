export type NotificationChannel = "email" | "sms" | "push" | "in-app";

export interface NotificationPayload {
  to: string;
  subject?: string;
  body: string;
  channel: NotificationChannel;
  metadata?: Record<string, unknown>;
}

export interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailProvider {
  send(payload: NotificationPayload): Promise<NotificationResult>;
}

export interface SmsProvider {
  send(payload: NotificationPayload): Promise<NotificationResult>;
}

export interface NotificationConfig {
  email?: EmailProvider;
  sms?: SmsProvider;
}

export function createNotificationService(config: NotificationConfig) {
  return {
    async send(payload: NotificationPayload): Promise<NotificationResult> {
      switch (payload.channel) {
        case "email":
          if (!config.email) {
            return { success: false, error: "Email provider not configured" };
          }
          return config.email.send(payload);

        case "sms":
          if (!config.sms) {
            return { success: false, error: "SMS provider not configured" };
          }
          return config.sms.send(payload);

        case "push":
        case "in-app":
          return { success: true, messageId: `local-${Date.now()}` };

        default:
          return { success: false, error: `Unknown channel: ${payload.channel}` };
      }
    },

    async sendBulk(payloads: NotificationPayload[]): Promise<NotificationResult[]> {
      return Promise.all(payloads.map((p) => this.send(p)));
    },
  };
}

export function createTwilioSmsProvider(
  accountSid: string,
  authToken: string,
  fromNumber: string
): SmsProvider {
  return {
    async send(payload: NotificationPayload): Promise<NotificationResult> {
      try {
        const twilio = await import("twilio");
        const client = twilio.default(accountSid, authToken);
        const message = await client.messages.create({
          body: payload.body,
          from: fromNumber,
          to: payload.to,
        });
        return { success: true, messageId: message.sid };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "SMS send failed",
        };
      }
    },
  };
}
