/**
 * Founder OTP delivery — Resend + Twilio with fallback, audit logging, and challenge status updates.
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

export const OTP_TTL_MS = 10 * 60_000;

export type OtpDeliveryChannel = "email" | "sms";
export type ChallengeDeliveryStatus = "pending" | "sent" | "partial" | "failed" | "verified" | "expired";

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
  console[level](
    `[founder-otp] ${result.channel.toUpperCase()} ${result.ok ? "OK" : "FAIL"}`
    + ` dest=${result.destination} provider=${result.provider}`
    + ` durationMs=${result.durationMs}`
    + (result.messageId ? ` messageId=${result.messageId}` : "")
    + (result.error ? ` error=${result.error}` : "")
    + (result.errorCode != null ? ` code=${result.errorCode}` : "")
  );
}

export async function updateChallengeDeliveryRecord(
  challengeId: string,
  patch: {
    deliveryStatus: ChallengeDeliveryStatus;
    emailSent?: boolean;
    smsSent?: boolean;
    emailMessageId?: string | null;
    smsMessageId?: string | null;
    preferredChannel?: OtpDeliveryChannel | null;
    lastDeliveryError?: string | null;
  }
): Promise<void> {
  const db = await getDb();
  await db.run(
    `UPDATE aura_identity_challenges SET
      delivery_status = ?,
      email_sent = COALESCE(?, email_sent),
      sms_sent = COALESCE(?, sms_sent),
      email_message_id = COALESCE(?, email_message_id),
      sms_message_id = COALESCE(?, sms_message_id),
      preferred_channel = COALESCE(?, preferred_channel),
      last_delivery_error = ?
     WHERE id = ?`,
    patch.deliveryStatus,
    patch.emailSent === undefined ? null : patch.emailSent ? 1 : 0,
    patch.smsSent === undefined ? null : patch.smsSent ? 1 : 0,
    patch.emailMessageId ?? null,
    patch.smsMessageId ?? null,
    patch.preferredChannel ?? null,
    patch.lastDeliveryError ?? null,
    challengeId
  );
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

  const resendProbe = await probeResendSender();
  if (!resendProbe.ok) {
    const result: OtpDeliveryResult = {
      ok: false,
      channel: "email",
      destination: to,
      provider: "resend",
      error: resendProbe.error || "Resend sender/domain not verified",
      errorCode: "resend_domain_unverified",
      providerStatus: resendProbe.providerStatus,
      providerResponse: { resendProbe, from: resendProbe.from },
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
    ok: send.success && Boolean(send.messageId),
    channel: "email",
    destination: to,
    provider: "resend",
    messageId: send.messageId,
    error: send.success && !send.messageId ? "Resend accepted but no message id returned" : send.error,
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

  if (!/^\+[1-9]\d{7,14}$/.test(destination)) {
    const result: OtpDeliveryResult = {
      ok: false,
      channel: "sms",
      destination,
      provider: "none",
      error: `Invalid E.164 phone: ${destination}`,
      errorCode: "invalid_e164",
      durationMs: Date.now() - started,
      timestamp,
    };
    await logOtpDeliveryAttempt({ challengeId, ...opts, result });
    return result;
  }

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
    ok: send.success && Boolean(send.messageId),
    channel: "sms",
    destination,
    provider: "twilio",
    messageId: send.messageId,
    error: send.success && !send.messageId ? "Twilio accepted but no message sid returned" : send.error,
    errorCode: send.providerCode,
    providerStatus: send.providerStatus,
    providerResponse: send.providerResponse,
    durationMs: Date.now() - started,
    timestamp,
  };
  await logOtpDeliveryAttempt({ challengeId, ...opts, result });
  return result;
}

/**
 * Deliver Founder OTP.
 * - "both": send email AND SMS in parallel (acceptance requires both channels).
 * - "email": email first; SMS fallback if email fails.
 * - "sms": SMS first; email fallback if SMS fails.
 * Only reports success when a provider returns a message id.
 */
export async function deliverFounderOtpWithFallback(opts: {
  challengeId: string;
  code: string;
  phoneE164: string;
  sessionKey: string;
  callerChannel: string;
  actorEmail: string;
  /** Force a single channel (resend / alternate method). */
  channelPreference?: OtpDeliveryChannel | "both";
}): Promise<{
  email: OtpDeliveryResult;
  sms: OtpDeliveryResult;
  deliveryStatus: ChallengeDeliveryStatus;
  emailSent: boolean;
  smsSent: boolean;
}> {
  const deliveryOpts = {
    sessionKey: opts.sessionKey,
    callerChannel: opts.callerChannel,
  };

  let email: OtpDeliveryResult = {
    ok: false,
    channel: "email",
    destination: opts.actorEmail,
    provider: "none",
    durationMs: 0,
    timestamp: new Date().toISOString(),
    error: "skipped",
  };
  let sms: OtpDeliveryResult = {
    ok: false,
    channel: "sms",
    destination: opts.phoneE164,
    provider: "none",
    durationMs: 0,
    timestamp: new Date().toISOString(),
    error: "skipped",
  };

  const pref = opts.channelPreference ?? "both";

  if (pref === "both") {
    // Always attempt both channels so Founder has email + SMS copies.
    const [emailResult, smsResult] = await Promise.all([
      sendFounderOtpEmailDelivery(opts.code, opts.challengeId, deliveryOpts),
      sendFounderOtpSmsDelivery(opts.phoneE164, opts.code, opts.challengeId, deliveryOpts),
    ]);
    email = emailResult;
    sms = smsResult;
  } else if (pref === "email") {
    email = await sendFounderOtpEmailDelivery(opts.code, opts.challengeId, deliveryOpts);
    if (!email.ok) {
      sms = await sendFounderOtpSmsDelivery(opts.phoneE164, opts.code, opts.challengeId, deliveryOpts);
    }
  } else {
    sms = await sendFounderOtpSmsDelivery(opts.phoneE164, opts.code, opts.challengeId, deliveryOpts);
    if (!sms.ok) {
      email = await sendFounderOtpEmailDelivery(opts.code, opts.challengeId, deliveryOpts);
    }
  }

  const emailSent = email.ok;
  const smsSent = sms.ok;
  let deliveryStatus: ChallengeDeliveryStatus = "failed";
  if (emailSent && smsSent) deliveryStatus = "sent";
  else if (emailSent || smsSent) deliveryStatus = "partial";
  else deliveryStatus = "failed";

  const lastError = !emailSent && !smsSent
    ? `email=${email.error || "failed"}; sms=${sms.error || "failed"}`
    : !emailSent
      ? email.error || null
      : !smsSent
        ? sms.error || null
        : null;

  await updateChallengeDeliveryRecord(opts.challengeId, {
    deliveryStatus,
    emailSent,
    smsSent,
    emailMessageId: email.messageId ?? null,
    smsMessageId: sms.messageId ?? null,
    preferredChannel: pref === "sms" ? "sms" : pref === "email" ? "email" : emailSent ? "email" : smsSent ? "sms" : null,
    lastDeliveryError: lastError,
  });

  await logHqAudit({
    action: emailSent || smsSent ? "aura_founder_otp_sent" : "aura_founder_otp_send_failed",
    entityType: "aura_identity",
    entityId: opts.challengeId,
    detail: emailSent && smsSent
      ? `Founder OTP accepted by Resend (${opts.actorEmail}) and Twilio (${opts.phoneE164})`
      : emailSent
        ? `Founder OTP email accepted for ${opts.actorEmail} (SMS: ${sms.error || "not sent"})`
        : smsSent
          ? `Founder OTP SMS accepted for ${opts.phoneE164} (email: ${email.error || "not sent"})`
          : `Founder OTP delivery failed email=${email.error}; sms=${sms.error}`,
    actorEmail: opts.actorEmail,
    metadata: {
      phone: opts.phoneE164,
      channel: opts.callerChannel,
      channelPreference: pref,
      deliveryStatus,
      emailSent,
      emailTo: opts.actorEmail,
      emailMessageId: email.messageId,
      emailError: emailSent ? undefined : email.error,
      emailProviderStatus: email.providerStatus,
      emailProviderCode: email.errorCode,
      emailProviderResponse: email.providerResponse,
      smsSent,
      smsTo: opts.phoneE164,
      smsMessageId: sms.messageId,
      smsError: smsSent ? undefined : sms.error,
      smsProviderStatus: sms.providerStatus,
      smsProviderCode: sms.errorCode,
      smsProviderResponse: sms.providerResponse,
      emailStatus: getEmailDeliveryStatus(),
      otpTtlMinutes: Math.round(OTP_TTL_MS / 60_000),
      timestamp: new Date().toISOString(),
    },
  });

  return { email, sms, deliveryStatus, emailSent, smsSent };
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
