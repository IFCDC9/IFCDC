/**
 * Founder OTP delivery — Resend email + Twilio SMS with full provider audit logging.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { getSuperAdminEmail } from "../config/credentials";
import {
  getEmailDeliveryStatus,
  probeResendSender,
  sendFounderSecurityEmail,
  sendFounderSecuritySms,
} from "../lib/notifications";
import { logHqAudit } from "./hqAuditLog";
import { normalizeE164 } from "./twilioIntegrationEngine";

const OTP_TTL_MS = 10 * 60_000;

export type OtpDeliveryChannel = "email" | "sms";

export type OtpDeliveryResult = {
  ok: boolean;
  channel: OtpDeliveryChannel;
  destination: string;
  provider: "resend" | "twilio" | "none";
  messageId?: string;
  error?: string;
  errorCode?: string | number;
  providerStatus?: string | number;
  providerResponse?: Record<string, unknown>;
  durationMs: number;
  timestamp: string;
};

let deliveryTableReady = false;

export async function ensureOtpDeliveryLogTable(): Promise<void> {
  if (deliveryTableReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_otp_delivery_log (
      id TEXT PRIMARY KEY,
      challenge_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      destination TEXT NOT NULL,
      provider TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 0,
      message_id TEXT,
      error_code TEXT,
      error_detail TEXT,
      provider_status TEXT,
      provider_response_json TEXT,
      duration_ms INTEGER,
      session_key TEXT,
      caller_channel TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_otp_delivery_challenge ON aura_otp_delivery_log(challenge_id);
    CREATE INDEX IF NOT EXISTS idx_aura_otp_delivery_created ON aura_otp_delivery_log(created_at DESC);
  `);
  deliveryTableReady = true;
}

export async function logOtpDeliveryAttempt(opts: {
  challengeId: string;
  sessionKey?: string;
  callerChannel?: string;
  result: OtpDeliveryResult;
}): Promise<void> {
  await ensureOtpDeliveryLogTable();
  const db = await getDb();
  const { result } = opts;
  await db.run(
    `INSERT INTO aura_otp_delivery_log (
      id, challenge_id, channel, destination, provider, success, message_id,
      error_code, error_detail, provider_status, provider_response_json,
      duration_ms, session_key, caller_channel, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    opts.challengeId,
    result.channel,
    result.destination,
    result.provider,
    result.ok ? 1 : 0,
    result.messageId ?? null,
    result.errorCode != null ? String(result.errorCode) : null,
    result.error ?? null,
    result.providerStatus != null ? String(result.providerStatus) : null,
    result.providerResponse ? JSON.stringify(result.providerResponse) : null,
    result.durationMs,
    opts.sessionKey ?? null,
    opts.callerChannel ?? null,
    result.timestamp
  );

  const level = result.ok ? "log" : "error";
  const msg =
    `[founder-otp] ${result.channel.toUpperCase()} ${result.ok ? "OK" : "FAIL"}`
    + ` dest=${result.destination} provider=${result.provider}`
    + ` durationMs=${result.durationMs}`
    + (result.messageId ? ` messageId=${result.messageId}` : "")
    + (result.error ? ` error=${result.error}` : "")
    + (result.errorCode != null ? ` code=${result.errorCode}` : "");
  console[level](msg);
}

export async function sendFounderOtpEmailDelivery(
  code: string,
  challengeId: string,
  opts?: { sessionKey?: string; callerChannel?: string }
): Promise<OtpDeliveryResult> {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  const to = getSuperAdminEmail();
  const minutes = Math.round(OTP_TTL_MS / 60_000);
  const status = getEmailDeliveryStatus();

  if (!status.configured) {
    const result: OtpDeliveryResult = {
      ok: false,
      channel: "email",
      destination: to,
      provider: "none",
      error: "RESEND_API_KEY is not configured on Headquarters",
      durationMs: Date.now() - started,
      timestamp,
    };
    await logOtpDeliveryAttempt({ challengeId, ...opts, result });
    return result;
  }

  const send = await sendFounderSecurityEmail({
    to,
    subject: "IFCDC AURA Founder verification code",
    body: [
      "AURA detected a call or SMS from your registered Founder phone.",
      "",
      `Your one-time Founder verification code is: ${code}`,
      "",
      `This code expires in ${minutes} minutes.`,
      "Say or text this code to AURA to unlock Founder Mode for this session.",
      "If you did not initiate this call, ignore this email — Founder privileges will not be granted.",
      "",
      "— IFCDC Headquarters · AURA Security",
    ].join("\n"),
  });

  const result: OtpDeliveryResult = {
    ok: send.success,
    channel: "email",
    destination: to,
    provider: "resend",
    messageId: send.messageId,
    error: send.error,
    errorCode: send.providerCode,
    providerStatus: send.providerStatus,
    providerResponse: send.providerResponse,
    durationMs: Date.now() - started,
    timestamp,
  };
  await logOtpDeliveryAttempt({ challengeId, ...opts, result });
  return result;
}

export async function sendFounderOtpSmsDelivery(
  toPhone: string,
  code: string,
  challengeId: string,
  opts?: { sessionKey?: string; callerChannel?: string }
): Promise<OtpDeliveryResult> {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  const destination = normalizeE164(toPhone) || toPhone;

  if (process.env.AURA_FOUNDER_OTP_SMS === "false") {
    const result: OtpDeliveryResult = {
      ok: false,
      channel: "sms",
      destination,
      provider: "none",
      error: "SMS OTP disabled by AURA_FOUNDER_OTP_SMS=false",
      durationMs: Date.now() - started,
      timestamp,
    };
    await logOtpDeliveryAttempt({ challengeId, ...opts, result });
    return result;
  }

  const send = await sendFounderSecuritySms({
    to: destination,
    body: `IFCDC AURA Founder verification code: ${code}. Valid ${Math.round(OTP_TTL_MS / 60_000)} minutes. Do not share.`,
  });

  const result: OtpDeliveryResult = {
    ok: send.success,
    channel: "sms",
    destination,
    provider: "twilio",
    messageId: send.messageId,
    error: send.error,
    errorCode: send.providerCode,
    providerStatus: send.providerStatus,
    providerResponse: send.providerResponse,
    durationMs: Date.now() - started,
    timestamp,
  };
  await logOtpDeliveryAttempt({ challengeId, ...opts, result });
  return result;
}

export async function deliverFounderOtpChannels(opts: {
  challengeId: string;
  code: string;
  phoneE164: string;
  sessionKey: string;
  callerChannel: string;
  actorEmail: string;
}): Promise<{ email: OtpDeliveryResult; sms: OtpDeliveryResult }> {
  const deliveryOpts = {
    sessionKey: opts.sessionKey,
    callerChannel: opts.callerChannel,
  };
  const [email, sms] = await Promise.all([
    sendFounderOtpEmailDelivery(opts.code, opts.challengeId, deliveryOpts),
    sendFounderOtpSmsDelivery(opts.phoneE164, opts.code, opts.challengeId, deliveryOpts),
  ]);

  await logHqAudit({
    action: email.ok || sms.ok ? "aura_founder_otp_sent" : "aura_founder_otp_send_failed",
    entityType: "aura_identity",
    entityId: opts.challengeId,
    detail: email.ok
      ? `Founder OTP emailed to ${opts.actorEmail}${sms.ok ? " (+ SMS backup)" : ""}`
      : sms.ok
        ? `Founder OTP SMS sent to ${opts.phoneE164} (email failed: ${email.error})`
        : `Founder OTP delivery failed email=${email.error}; sms=${sms.error}`,
    actorEmail: opts.actorEmail,
    metadata: {
      phone: opts.phoneE164,
      channel: opts.callerChannel,
      emailSent: email.ok,
      emailTo: opts.actorEmail,
      emailError: email.ok ? undefined : email.error,
      emailProviderStatus: email.providerStatus,
      emailProviderCode: email.errorCode,
      smsSent: sms.ok,
      smsTo: opts.phoneE164,
      smsError: sms.ok ? undefined : sms.error,
      smsProviderStatus: sms.providerStatus,
      smsProviderCode: sms.errorCode,
      emailStatus: getEmailDeliveryStatus(),
      otpTtlMinutes: Math.round(OTP_TTL_MS / 60_000),
      stepUp: true,
      candidatePhone: true,
    },
  });

  return { email, sms };
}

export async function getRecentOtpDeliveryLogs(limit = 20): Promise<unknown[]> {
  await ensureOtpDeliveryLogTable();
  const db = await getDb();
  return db.all(
    `SELECT id, challenge_id, channel, destination, provider, success, message_id,
            error_code, error_detail, provider_status, duration_ms, session_key,
            caller_channel, created_at
     FROM aura_otp_delivery_log ORDER BY created_at DESC LIMIT ?`,
    limit
  );
}

/** Production probe — sends real test messages and returns provider responses (no OTP code in response). */
export async function probeFounderVerificationDelivery(opts?: {
  smsTo?: string | null;
}): Promise<{
  email: OtpDeliveryResult & { resendProbe?: Awaited<ReturnType<typeof probeResendSender>> };
  sms?: OtpDeliveryResult;
  timestamp: string;
}> {
  const probeId = `probe-${crypto.randomUUID()}`;
  const testCode = "000000";
  const email = await sendFounderOtpEmailDelivery(testCode, probeId, { callerChannel: "probe" });
  const resendProbe = await probeResendSender();
  let sms: OtpDeliveryResult | undefined;
  if (opts?.smsTo) {
    sms = await sendFounderOtpSmsDelivery(opts.smsTo, testCode, probeId, { callerChannel: "probe" });
  }
  return {
    email: { ...email, resendProbe },
    sms,
    timestamp: new Date().toISOString(),
  };
}
