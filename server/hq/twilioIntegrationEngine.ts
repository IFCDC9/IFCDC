/**
 * Twilio integration — account probe, phone number status, Integrations Hub monitoring.
 */
import { getDb } from "../db";
import { resolveOpenAiCredentials } from "../lib/openaiConfig";

const PROBE_TIMEOUT_MS = 12_000;

/** IFCDC HQ primary line — AURA voice + SMS. */
export const IFCDC_HQ_PHONE_E164 = "+13313168167";

export type TwilioIntegrationDetail = {
  label: string;
  value: string;
  status?: "success" | "warning" | "muted" | "danger";
};

export type TwilioEnvStatus = {
  accountSidConfigured: boolean;
  authTokenConfigured: boolean;
  phoneNumberConfigured: boolean;
  messagingServiceConfigured: boolean;
  auraConfigured: boolean;
  phoneNumber: string | null;
  phoneNumberRaw: string | null;
  ready: boolean;
};

export type TwilioPhoneProbe = {
  found: boolean;
  phoneNumber: string | null;
  friendlyName: string | null;
  voiceCapable: boolean;
  smsCapable: boolean;
  status: string | null;
  voiceWebhook: string | null;
  smsWebhook: string | null;
};

export type TwilioProbeResult = {
  healthy: boolean;
  accountStatus: string | null;
  accountFriendlyName: string | null;
  phone: TwilioPhoneProbe;
  auraReady: boolean;
  latencyMs: number;
  message: string;
  webhookUrls: ReturnType<typeof getTwilioWebhookUrls>;
};

export function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw.trim().startsWith("+") ? raw.trim() : `+${digits}`;
}

/** Resolve canonical HQ phone from env (supports aliases). */
export function resolveTwilioPhoneNumber(): string | null {
  const candidates = [
    process.env.TWILIO_PHONE_NUMBER,
    process.env.TWILIO_SMS_FROM,
    process.env.TWILIO_VOICE_FROM,
    process.env.TWILIO_FROM_NUMBER,
    IFCDC_HQ_PHONE_E164,
  ];
  for (const c of candidates) {
    const n = normalizeE164(c);
    if (n) return n;
  }
  return null;
}

export function getTwilioEnvStatus(): TwilioEnvStatus {
  const accountSidConfigured = Boolean((process.env.TWILIO_ACCOUNT_SID || "").trim());
  const authTokenConfigured = Boolean((process.env.TWILIO_AUTH_TOKEN || "").trim());
  const phoneNumberRaw =
    (process.env.TWILIO_PHONE_NUMBER || "").trim() ||
    (process.env.TWILIO_SMS_FROM || "").trim() ||
    (process.env.TWILIO_VOICE_FROM || "").trim() ||
    (process.env.TWILIO_FROM_NUMBER || "").trim() ||
    null;
  const phoneNumber = resolveTwilioPhoneNumber();
  const messagingServiceConfigured = Boolean((process.env.TWILIO_MESSAGING_SERVICE_SID || "").trim());
  const auraConfigured = Boolean(resolveOpenAiCredentials());
  const phoneNumberConfigured = Boolean(phoneNumber);
  return {
    accountSidConfigured,
    authTokenConfigured,
    phoneNumberConfigured,
    messagingServiceConfigured,
    auraConfigured,
    phoneNumber,
    phoneNumberRaw,
    ready: accountSidConfigured && authTokenConfigured && phoneNumberConfigured && auraConfigured,
  };
}

export function getPublicBaseUrl(): string {
  // RENDER_EXTERNAL_URL is the authoritative public URL for this Render service.
  const renderExternal = (process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/$/, "");
  if (renderExternal.startsWith("https://")) return renderExternal;
  const publicBase = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  const publicApp = (process.env.PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  // Prefer PUBLIC_APP_URL when PUBLIC_BASE_URL points at a stale/custom domain.
  if (publicApp.startsWith("https://")) return publicApp;
  if (publicBase.startsWith("https://")) return publicBase;
  return "";
}

export function getTwilioWebhookUrls() {
  const base = getPublicBaseUrl();
  const prefix = base ? base : "";
  return {
    incomingVoice: `${prefix}/api/twilio/aura/voice`,
    voiceRespond: `${prefix}/api/twilio/aura/voice/respond`,
    voiceStatus: `${prefix}/api/twilio/aura/voice/status`,
    incomingSms: `${prefix}/api/twilio/aura/sms`,
    smsStatus: `${prefix}/api/twilio/aura/sms/status`,
    legacyVoice: `${prefix}/twiml/voice`,
    legacySms: `${prefix}/twiml/sms`,
    reminderVoice: `${prefix}/twilio/voice/reminder`,
    reminderStatus: `${prefix}/twilio/voice-status`,
  };
}

async function getTwilioClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (!sid || !token || !sid.startsWith("AC")) return null;
  const twilio = await import("twilio");
  return twilio.default(sid, token);
}

/** Detect dev tunnel URLs that must not remain on production Twilio numbers. */
export function isTemporaryWebhookUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /ngrok|loca\.lt|trycloudflare|serveo|localhost|127\.0\.0\.1|\.loca\.lt/i.test(url);
}

function normalizeWebhookUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.trim().replace(/\/$/, "");
}

function webhookHostMatchesProduction(url: string | null | undefined): boolean {
  const expectedBase = getPublicBaseUrl();
  if (!url || !expectedBase) return false;
  try {
    return new URL(url).origin === new URL(expectedBase).origin;
  } catch {
    return false;
  }
}

/** HQ accepts canonical Render AURA endpoints or legacy /twiml aliases on the production host. */
export function isAcceptedVoiceWebhook(
  url: string | null | undefined,
  expected: string
): boolean {
  const actual = normalizeWebhookUrl(url);
  if (!actual || isTemporaryWebhookUrl(actual)) return false;
  if (!webhookHostMatchesProduction(actual)) return false;
  const exp = normalizeWebhookUrl(expected);
  if (actual === exp) return true;
  return actual.endsWith("/twiml/voice") || actual.endsWith("/api/twilio/aura/voice");
}

export function isAcceptedSmsWebhook(url: string | null | undefined, expected: string): boolean {
  const actual = normalizeWebhookUrl(url);
  if (!actual || isTemporaryWebhookUrl(actual)) return false;
  if (!webhookHostMatchesProduction(actual)) return false;
  const exp = normalizeWebhookUrl(expected);
  if (actual === exp) return true;
  return actual.endsWith("/twiml/sms") || actual.endsWith("/api/twilio/aura/sms");
}

export type TwilioWebhookSyncResult = {
  success: boolean;
  message: string;
  synced: boolean;
  previous?: { voice: string | null; sms: string | null; status: string | null };
  updated?: { voice: string; sms: string; status: string };
};

let lastWebhookSync: TwilioWebhookSyncResult | null = null;

export function getLastTwilioWebhookSync(): TwilioWebhookSyncResult | null {
  return lastWebhookSync;
}

/** Push production Render webhook URLs to the Twilio incoming phone number (removes ngrok/dev URLs). */
export async function syncTwilioWebhooksToProduction(): Promise<TwilioWebhookSyncResult> {
  const envStatus = getTwilioEnvStatus();
  const urls = getTwilioWebhookUrls();
  const targetPhone = envStatus.phoneNumber || IFCDC_HQ_PHONE_E164;

  if (!envStatus.accountSidConfigured || !envStatus.authTokenConfigured) {
    const result: TwilioWebhookSyncResult = {
      success: false,
      synced: false,
      message: "Twilio credentials missing — cannot sync webhooks",
    };
    lastWebhookSync = result;
    return result;
  }

  if (!urls.incomingVoice.startsWith("https://")) {
    const result: TwilioWebhookSyncResult = {
      success: false,
      synced: false,
      message: "PUBLIC_BASE_URL not set — cannot determine production webhook URLs",
    };
    lastWebhookSync = result;
    return result;
  }

  try {
    const client = await getTwilioClient();
    if (!client) {
      const result: TwilioWebhookSyncResult = {
        success: false,
        synced: false,
        message: "Twilio client unavailable",
      };
      lastWebhookSync = result;
      return result;
    }

    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: targetPhone, limit: 1 });
    const num = numbers[0];
    if (!num) {
      const result: TwilioWebhookSyncResult = {
        success: false,
        synced: false,
        message: `Phone number ${targetPhone} not found in Twilio account`,
      };
      lastWebhookSync = result;
      return result;
    }

    const previous = {
      voice: num.voiceUrl ?? null,
      sms: num.smsUrl ?? null,
      status: num.statusCallback ?? null,
    };

    const voiceOk = isAcceptedVoiceWebhook(previous.voice, urls.incomingVoice);
    const smsOk = isAcceptedSmsWebhook(previous.sms, urls.incomingSms);
    const statusOk =
      !previous.status ||
      normalizeWebhookUrl(previous.status) === normalizeWebhookUrl(urls.voiceStatus);

    if (voiceOk && smsOk && statusOk && !isTemporaryWebhookUrl(previous.voice) && !isTemporaryWebhookUrl(previous.sms)) {
      const result: TwilioWebhookSyncResult = {
        success: true,
        synced: false,
        message: "Twilio webhooks already point to production Render endpoints",
        previous,
        updated: {
          voice: urls.incomingVoice,
          sms: urls.incomingSms,
          status: urls.voiceStatus,
        },
      };
      lastWebhookSync = result;
      return result;
    }

    await client.incomingPhoneNumbers(num.sid).update({
      voiceUrl: urls.incomingVoice,
      voiceMethod: "POST",
      voiceFallbackUrl: urls.incomingVoice,
      voiceFallbackMethod: "POST",
      statusCallback: urls.voiceStatus,
      statusCallbackMethod: "POST",
      smsUrl: urls.incomingSms,
      smsMethod: "POST",
      smsFallbackUrl: urls.incomingSms,
      smsFallbackMethod: "POST",
    });

    const result: TwilioWebhookSyncResult = {
      success: true,
      synced: true,
      message: `Webhooks synced to production · voice ${urls.incomingVoice} · SMS ${urls.incomingSms}`,
      previous,
      updated: {
        voice: urls.incomingVoice,
        sms: urls.incomingSms,
        status: urls.voiceStatus,
      },
    };
    lastWebhookSync = result;
    console.log(`Twilio webhook sync: ${result.message}`);
    if (previous.voice && isTemporaryWebhookUrl(previous.voice)) {
      console.log(`  Removed temporary voice URL: ${previous.voice}`);
    }
    if (previous.sms && isTemporaryWebhookUrl(previous.sms)) {
      console.log(`  Removed temporary SMS URL: ${previous.sms}`);
    }
    return result;
  } catch (err) {
    const result: TwilioWebhookSyncResult = {
      success: false,
      synced: false,
      message: err instanceof Error ? err.message : "Twilio webhook sync failed",
    };
    lastWebhookSync = result;
    return result;
  }
}

/** Sync webhooks on startup when misconfigured (ngrok or wrong host). */
export async function syncTwilioWebhooksIfNeeded(): Promise<TwilioWebhookSyncResult | null> {
  const envStatus = getTwilioEnvStatus();
  if (!envStatus.ready) return null;
  const probe = await probeTwilioApi();
  const urls = getTwilioWebhookUrls();
  const voiceOk = isAcceptedVoiceWebhook(probe.phone.voiceWebhook, urls.incomingVoice);
  const smsOk = isAcceptedSmsWebhook(probe.phone.smsWebhook, urls.incomingSms);
  const hasTemp =
    isTemporaryWebhookUrl(probe.phone.voiceWebhook) || isTemporaryWebhookUrl(probe.phone.smsWebhook);
  if (voiceOk && smsOk && !hasTemp) return null;
  return syncTwilioWebhooksToProduction();
}

/** Live Twilio REST probe — account + incoming phone number lookup. */
export async function probeTwilioApi(): Promise<TwilioProbeResult> {
  const envStatus = getTwilioEnvStatus();
  const webhookUrls = getTwilioWebhookUrls();
  const targetPhone = envStatus.phoneNumber || IFCDC_HQ_PHONE_E164;
  const started = Date.now();

  const emptyPhone: TwilioPhoneProbe = {
    found: false,
    phoneNumber: targetPhone,
    friendlyName: null,
    voiceCapable: false,
    smsCapable: false,
    status: null,
    voiceWebhook: null,
    smsWebhook: null,
  };

  if (!envStatus.accountSidConfigured || !envStatus.authTokenConfigured) {
    return {
      healthy: false,
      accountStatus: null,
      accountFriendlyName: null,
      phone: emptyPhone,
      auraReady: envStatus.auraConfigured,
      latencyMs: 0,
      message: "Twilio credentials missing — set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN on Render",
      webhookUrls,
    };
  }

  try {
    const client = await getTwilioClient();
    if (!client) {
      return {
        healthy: false,
        accountStatus: null,
        accountFriendlyName: null,
        phone: emptyPhone,
        auraReady: envStatus.auraConfigured,
        latencyMs: Date.now() - started,
        message: "Invalid TWILIO_ACCOUNT_SID — must start with AC",
        webhookUrls,
      };
    }

    const sid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
    const account = await client.api.accounts(sid).fetch();
    const accountStatus = account.status ?? null;
    const accountSuspended = accountStatus === "suspended" || accountStatus === "closed";

    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: targetPhone, limit: 1 });
    const num = numbers[0];
    const phone: TwilioPhoneProbe = num
      ? {
          found: true,
          phoneNumber: normalizeE164(num.phoneNumber) || targetPhone,
          friendlyName: num.friendlyName ?? null,
          voiceCapable: Boolean(num.capabilities?.voice),
          smsCapable: Boolean(num.capabilities?.sms),
          status: "active",
          voiceWebhook: num.voiceUrl ?? null,
          smsWebhook: num.smsUrl ?? null,
        }
      : { ...emptyPhone, status: "not_found" };

    const voiceWebhookOk = isAcceptedVoiceWebhook(phone.voiceWebhook, webhookUrls.incomingVoice);
    const smsWebhookOk = isAcceptedSmsWebhook(phone.smsWebhook, webhookUrls.incomingSms);

    const healthy =
      !accountSuspended &&
      phone.found &&
      phone.voiceCapable &&
      phone.smsCapable &&
      envStatus.auraConfigured &&
      voiceWebhookOk &&
      smsWebhookOk;

    const parts: string[] = [];
    if (accountSuspended) parts.push(`Account ${accountStatus}`);
    else parts.push(`Account ${accountStatus ?? "active"}`);
    if (phone.found) {
      parts.push(`${phone.phoneNumber} voice+SMS`);
    } else {
      parts.push(`${targetPhone} not found in Twilio account`);
    }
    if (!envStatus.auraConfigured) parts.push("AURA_OPENAI_API_KEY missing for AURA voice");
    if (phone.found && !voiceWebhookOk) {
      const v = phone.voiceWebhook ?? "(not set)";
      parts.push(
        isTemporaryWebhookUrl(phone.voiceWebhook)
          ? `voice webhook uses temporary URL (${v}) — sync to ${webhookUrls.incomingVoice}`
          : `voice webhook mismatch (${v})`
      );
    }
    if (phone.found && !smsWebhookOk) {
      const s = phone.smsWebhook ?? "(not set)";
      parts.push(
        isTemporaryWebhookUrl(phone.smsWebhook)
          ? `SMS webhook uses temporary URL (${s}) — sync to ${webhookUrls.incomingSms}`
          : `SMS webhook mismatch (${s})`
      );
    }

    return {
      healthy,
      accountStatus,
      accountFriendlyName: account.friendlyName ?? null,
      phone,
      auraReady: envStatus.auraConfigured,
      latencyMs: Date.now() - started,
      message: healthy ? parts.join(" · ") : parts.join(" · "),
      webhookUrls,
    };
  } catch (err) {
    return {
      healthy: false,
      accountStatus: null,
      accountFriendlyName: null,
      phone: emptyPhone,
      auraReady: envStatus.auraConfigured,
      latencyMs: Date.now() - started,
      message: err instanceof Error ? err.message : "Twilio probe failed",
      webhookUrls,
    };
  }
}

export function resolveTwilioHubStatus(
  probe: TwilioProbeResult,
  envReady: boolean
): "connected" | "degraded" | "not_configured" {
  if (!envReady) return "not_configured";
  if (probe.healthy) return "connected";
  if (probe.phone.found || probe.accountStatus) return "degraded";
  return "not_configured";
}

export async function countTwilioCommunicationEvents(): Promise<number> {
  try {
    const db = await getDb();
    const row = await db.get<{ c: number }>(
      "SELECT COUNT(*) as c FROM twilio_communication_events"
    );
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export async function getLastTwilioEventAt(): Promise<string | null> {
  try {
    const db = await getDb();
    const row = await db.get<{ created_at: string }>(
      "SELECT created_at FROM twilio_communication_events ORDER BY created_at DESC LIMIT 1"
    );
    return row?.created_at ?? null;
  } catch {
    return null;
  }
}

export function buildTwilioDetails(
  probe: TwilioProbeResult,
  envStatus: TwilioEnvStatus,
  eventCount: number,
  lastEventAt: string | null,
  lastTestAt: string | null
): TwilioIntegrationDetail[] {
  const urls = probe.webhookUrls;
  return [
    {
      label: "Account status",
      value: probe.accountStatus ?? "unknown",
      status:
        probe.accountStatus === "active"
          ? "success"
          : probe.accountStatus === "suspended"
            ? "danger"
            : "warning",
    },
    {
      label: "HQ phone number",
      value: probe.phone.phoneNumber ?? envStatus.phoneNumber ?? IFCDC_HQ_PHONE_E164,
      status: probe.phone.found ? "success" : "danger",
    },
    {
      label: "Voice capability",
      value: probe.phone.voiceCapable ? "Enabled" : probe.phone.found ? "Disabled" : "Unknown",
      status: probe.phone.voiceCapable ? "success" : "warning",
    },
    {
      label: "SMS capability",
      value: probe.phone.smsCapable ? "Enabled" : probe.phone.found ? "Disabled" : "Unknown",
      status: probe.phone.smsCapable ? "success" : "warning",
    },
    {
      label: "AURA voice AI",
      value: envStatus.auraConfigured ? "Ready (OpenAI)" : "AURA_OPENAI_API_KEY not set",
      status: envStatus.auraConfigured ? "success" : "danger",
    },
    {
      label: "Voice webhook",
      value: probe.phone.voiceWebhook ?? urls.incomingVoice,
      status: isAcceptedVoiceWebhook(probe.phone.voiceWebhook, urls.incomingVoice)
        ? "success"
        : isTemporaryWebhookUrl(probe.phone.voiceWebhook)
          ? "danger"
          : "warning",
    },
    {
      label: "SMS webhook",
      value: probe.phone.smsWebhook ?? urls.incomingSms,
      status: isAcceptedSmsWebhook(probe.phone.smsWebhook, urls.incomingSms)
        ? "success"
        : isTemporaryWebhookUrl(probe.phone.smsWebhook)
          ? "danger"
          : "warning",
    },
    {
      label: "Communication events",
      value: `${eventCount} logged${lastEventAt ? ` · last ${lastEventAt.slice(0, 10)}` : ""}`,
      status: eventCount > 0 ? "success" : "muted",
    },
    {
      label: "Last successful test",
      value: lastTestAt ?? "Not yet tested",
      status: lastTestAt ? "success" : "muted",
    },
  ];
}

let lastSuccessfulTestAt: string | null = null;

export function getLastTwilioSuccessfulTestAt(): string | null {
  return lastSuccessfulTestAt;
}

export async function testTwilioIntegrationLive() {
  const envStatus = getTwilioEnvStatus();
  let syncResult: TwilioWebhookSyncResult | null = null;

  let probe = await probeTwilioApi();
  const urls = probe.webhookUrls;
  const needsSync =
    envStatus.ready &&
    probe.phone.found &&
    (!isAcceptedVoiceWebhook(probe.phone.voiceWebhook, urls.incomingVoice) ||
      !isAcceptedSmsWebhook(probe.phone.smsWebhook, urls.incomingSms) ||
      isTemporaryWebhookUrl(probe.phone.voiceWebhook) ||
      isTemporaryWebhookUrl(probe.phone.smsWebhook));

  if (needsSync) {
    syncResult = await syncTwilioWebhooksToProduction();
    probe = await probeTwilioApi();
  }

  const eventCount = await countTwilioCommunicationEvents();
  const lastEventAt = await getLastTwilioEventAt();
  const status = resolveTwilioHubStatus(probe, envStatus.ready);
  const testedAt = new Date().toISOString();
  const details = buildTwilioDetails(probe, envStatus, eventCount, lastEventAt, testedAt);

  const { invalidateIntegrationsHubCache } = await import("./integrationsHubEngine");
  invalidateIntegrationsHubCache();

  const success = status === "connected";
  if (success) lastSuccessfulTestAt = testedAt;

  const messageParts = [probe.message];
  if (syncResult?.synced) messageParts.unshift(syncResult.message);
  else if (syncResult && !syncResult.success) messageParts.push(`Webhook sync: ${syncResult.message}`);

  return {
    success,
    message: messageParts.join(" · "),
    provider: "twilio",
    status,
    testedAt,
    details,
    snapshot: {
      accountStatus: probe.accountStatus,
      phoneFound: probe.phone.found,
      voiceCapable: probe.phone.voiceCapable,
      smsCapable: probe.phone.smsCapable,
      auraReady: probe.auraReady,
      eventCount,
      latencyMs: probe.latencyMs,
      webhookUrls: probe.webhookUrls,
      voiceWebhook: probe.phone.voiceWebhook,
      smsWebhook: probe.phone.smsWebhook,
      webhookSync: syncResult,
    },
  };
}

/** Ensure twilio_communication_events table exists (idempotent). */
export async function ensureTwilioCommunicationTable(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS twilio_communication_events (
      id TEXT PRIMARY KEY,
      direction TEXT NOT NULL,
      channel TEXT NOT NULL,
      from_number TEXT,
      to_number TEXT,
      body TEXT,
      call_sid TEXT,
      message_sid TEXT,
      status TEXT,
      aura_response TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_twilio_comm_events_created ON twilio_communication_events(created_at DESC);`
  );
}

export async function logTwilioCommunicationEvent(event: {
  id: string;
  direction: "inbound" | "outbound";
  channel: "voice" | "sms";
  fromNumber?: string | null;
  toNumber?: string | null;
  body?: string | null;
  callSid?: string | null;
  messageSid?: string | null;
  status?: string | null;
  auraResponse?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await ensureTwilioCommunicationTable();
    const db = await getDb();
    await db.run(
      `INSERT INTO twilio_communication_events
       (id, direction, channel, from_number, to_number, body, call_sid, message_sid, status, aura_response, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event.id,
      event.direction,
      event.channel,
      event.fromNumber ?? null,
      event.toNumber ?? null,
      event.body ?? null,
      event.callSid ?? null,
      event.messageSid ?? null,
      event.status ?? null,
      event.auraResponse ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error("Twilio communication log error:", err);
  }
}
