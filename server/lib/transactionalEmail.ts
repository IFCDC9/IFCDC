/**
 * IFCDC Headquarters transactional email.
 * Postmark is primary when POSTMARK_SERVER_TOKEN is set.
 * Resend remains the legacy fallback and is not required for a healthy Postmark path.
 * The server token is read from the environment only and is never logged.
 */
import { createHash } from "crypto";

export type TransactionalEmailCategory =
  | "account_verification"
  | "password_reset"
  | "booking_confirmation"
  | "booking_change"
  | "booking_cancellation"
  | "receipt"
  | "system_alert"
  | "security_alert"
  | "application_notification"
  | "hq_operational";

export type TransactionalSendResult = {
  success: boolean;
  messageId?: string;
  error?: string;
  providerCode?: string | number;
  providerStatus?: string | number;
  providerResponse?: Record<string, unknown>;
  provider: "postmark" | "resend" | "none";
  /** True only when Resend accepted the message because Postmark was missing or its send failed. */
  fallbackUsed?: boolean;
  from?: string;
  usedFallback?: boolean;
  suppressed?: boolean;
  deduped?: boolean;
  rateLimited?: boolean;
  category?: TransactionalEmailCategory;
};

export type TransactionalEmailProbe = {
  ok: boolean;
  provider: "postmark" | "resend" | "none";
  from: string;
  postmark: {
    configured: boolean;
    ok: boolean;
    error?: string;
    serverName?: string;
    deliveryType?: string;
  };
  resend: {
    configured: boolean;
    ok: boolean;
    error?: string;
    role: "fallback";
  };
  error?: string;
};

export type TransactionalEmailFinding = {
  id: string;
  module: "email";
  title: string;
  status: "ok" | "warning" | "degraded" | "failed" | "unknown";
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  recommendedFix?: string;
  needsFounderApproval?: boolean;
};

const APPROVED_SENDER = "service@ifcdc.org";
const APPROVED_FROM = `IFCDC Headquarters <${APPROVED_SENDER}>`;
const WINDOW_MS = 10 * 60 * 1000;
const GENERAL_CAP_PRODUCTION = 40;
const GENERAL_CAP_DEVELOPMENT = 8;
const SECURITY_CAP = 12;

type GuardBucket = "security" | "general";

const recentAttempts: Array<{ at: number; bucket: GuardBucket }> = [];
const recentSuccessKeys = new Map<string, number>();

let testLimits: { general?: number; security?: number } | null = null;

export function readPostmarkServerToken(): string | null {
  const token = (process.env.POSTMARK_SERVER_TOKEN || "").trim();
  return token || null;
}

function readResendApiKey(): string | null {
  const key = (
    process.env.RESEND_API_KEY
    || process.env.EMAIL_API_KEY
    || process.env.SMTP_API_KEY
    || process.env.AI_INTEGRATIONS_RESEND_API_KEY
    || ""
  ).trim();
  return key || null;
}

function secretValues(): string[] {
  return [
    process.env.POSTMARK_SERVER_TOKEN,
    process.env.RESEND_API_KEY,
    process.env.EMAIL_API_KEY,
    process.env.SMTP_API_KEY,
    process.env.AI_INTEGRATIONS_RESEND_API_KEY,
  ]
    .map((value) => (value || "").trim())
    .filter((value) => value.length >= 8);
}

/** Strip provider credentials from any string that might be logged or returned. */
export function redactEmailSecrets(text: string): string {
  let out = String(text || "");
  for (const secret of secretValues()) {
    out = out.split(secret).join("[redacted]");
  }
  out = out.replace(/X-Postmark-Server-Token\s*[:=]\s*\S+/gi, "X-Postmark-Server-Token: [redacted]");
  out = out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return out;
}

function extractEmail(raw: string): string | null {
  const angled = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angled) return angled[1].toLowerCase();
  const bare = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return bare ? bare[0].toLowerCase() : null;
}

/**
 * Sender is service@ifcdc.org unless an existing From env already names another
 * verified @ifcdc.org mailbox. Non-ifcdc.org fallback domains are not used for Postmark.
 */
export function resolveTransactionalFromAddress(): string {
  const candidates = [
    process.env.RESEND_FROM_EMAIL,
    process.env.EMAIL_FROM,
    process.env.SMTP_FROM,
  ];
  for (const raw of candidates) {
    const value = (raw || "").trim();
    if (!value) continue;
    const email = extractEmail(value);
    if (!email || !email.endsWith("@ifcdc.org")) continue;
    if (/^[^<>\s]+@[^<>\s]+$/.test(value)) return `IFCDC Headquarters <${email}>`;
    return value;
  }
  return APPROVED_FROM;
}

export function transactionalSenderEmail(): string {
  return extractEmail(resolveTransactionalFromAddress()) || APPROVED_SENDER;
}

/** Record which transport accepted the message. Does not choose the provider. */
export function transportAcceptance(result: Pick<TransactionalSendResult, "provider" | "fallbackUsed" | "from">): {
  provider: "POSTMARK" | "RESEND" | "NONE";
  fallbackUsed: boolean;
  from: string | null;
} {
  const provider = result.provider === "postmark"
    ? "POSTMARK"
    : result.provider === "resend"
      ? "RESEND"
      : "NONE";
  return {
    provider,
    fallbackUsed: result.fallbackUsed === true,
    from: result.from || null,
  };
}

function recordTransport(result: TransactionalSendResult, fallbackUsed: boolean): TransactionalSendResult {
  const recorded = { ...result, fallbackUsed };
  if (recorded.success && (recorded.provider === "postmark" || recorded.provider === "resend")) {
    const acceptance = transportAcceptance(recorded);
    console.log(
      `[email] transport provider=${acceptance.provider} fallbackUsed=${acceptance.fallbackUsed ? "YES" : "NO"} id=${recorded.messageId ?? "none"}`,
    );
  }
  return recorded;
}

function liveTransportPermitted(): boolean {
  const disabled = (process.env.IFCDC_EMAIL_DISABLE_SEND || "").trim().toLowerCase();
  if (disabled === "1" || disabled === "true") return false;
  if (process.env.NODE_ENV === "test" && process.env.IFCDC_EMAIL_ALLOW_MOCK_TRANSPORT !== "1") {
    return false;
  }
  return true;
}

function bucketFor(category: TransactionalEmailCategory): GuardBucket {
  return category === "security_alert" ? "security" : "general";
}

function capFor(bucket: GuardBucket): number {
  if (process.env.NODE_ENV === "test" && testLimits) {
    if (bucket === "security" && testLimits.security) return testLimits.security;
    if (bucket === "general" && testLimits.general) return testLimits.general;
  }
  if (bucket === "security") return SECURITY_CAP;
  return process.env.NODE_ENV === "production" ? GENERAL_CAP_PRODUCTION : GENERAL_CAP_DEVELOPMENT;
}

function pruneGuards(now: number): void {
  const cutoff = now - WINDOW_MS;
  while (recentAttempts.length && recentAttempts[0].at < cutoff) recentAttempts.shift();
  for (const [key, at] of recentSuccessKeys) {
    if (at < cutoff) recentSuccessKeys.delete(key);
  }
}

function dedupeKey(input: {
  category: TransactionalEmailCategory;
  to: string[];
  subject: string;
  text: string;
}): string {
  return createHash("sha256")
    .update([input.category, input.to.join(","), input.subject, input.text].join("\n"))
    .digest("hex");
}

export function resetTransactionalEmailGuardsForTests(): void {
  recentAttempts.length = 0;
  recentSuccessKeys.clear();
  testLimits = null;
}

export function setTransactionalEmailLimitsForTests(limits: { general?: number; security?: number } | null): void {
  if (process.env.NODE_ENV !== "test") return;
  testLimits = limits;
}

function safeServerName(name: unknown, token: string): string | undefined {
  if (typeof name !== "string") return undefined;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) return undefined;
  if (trimmed === token) return undefined;
  return trimmed;
}

async function probePostmarkServer(token: string, from: string): Promise<TransactionalEmailProbe["postmark"]> {
  const domain = extractEmail(from);
  if (!domain || !domain.endsWith("@ifcdc.org")) {
    return {
      configured: true,
      ok: false,
      error: "Transactional sender must be an @ifcdc.org address",
    };
  }
  try {
    const res = await fetch("https://api.postmarkapp.com/server", {
      headers: {
        Accept: "application/json",
        "X-Postmark-Server-Token": token,
      },
      signal: AbortSignal.timeout(3_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      Name?: unknown;
      DeliveryType?: unknown;
      Message?: unknown;
      ErrorCode?: unknown;
      ApiTokens?: unknown;
    };
    delete data.ApiTokens;
    if (!res.ok) {
      const message = typeof data.Message === "string" ? data.Message : `Postmark server probe HTTP ${res.status}`;
      return { configured: true, ok: false, error: redactEmailSecrets(message) };
    }
    const deliveryType = typeof data.DeliveryType === "string" ? data.DeliveryType : undefined;
    if (deliveryType && deliveryType.toLowerCase() !== "live") {
      return {
        configured: true,
        ok: false,
        serverName: safeServerName(data.Name, token),
        deliveryType,
        error: "Postmark server is not in Live delivery mode",
      };
    }
    return {
      configured: true,
      ok: true,
      serverName: safeServerName(data.Name, token),
      deliveryType: deliveryType || "Live",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Postmark server probe failed";
    return { configured: true, ok: false, error: redactEmailSecrets(message) };
  }
}

async function probeResendFallback(): Promise<TransactionalEmailProbe["resend"]> {
  const configured = Boolean(readResendApiKey());
  if (!configured) {
    return {
      configured: false,
      ok: false,
      role: "fallback",
      error: "RESEND_API_KEY not set",
    };
  }
  try {
    const { probeResendSender } = await import("./notifications");
    const result = await Promise.race([
      probeResendSender(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
    ]);
    if (!result) {
      return { configured: true, ok: false, role: "fallback", error: "Resend probe timed out" };
    }
    return {
      configured: result.apiKeySet,
      ok: result.ok,
      role: "fallback",
      error: result.ok ? undefined : redactEmailSecrets(result.error || "Resend probe failed"),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resend probe failed";
    return { configured: true, ok: false, role: "fallback", error: redactEmailSecrets(message) };
  }
}

/** Server probe for Postmark, plus Resend only as a non-critical fallback signal. */
export async function probeTransactionalEmail(): Promise<TransactionalEmailProbe> {
  const from = resolveTransactionalFromAddress();
  const token = readPostmarkServerToken();
  const [postmark, resend] = await Promise.all([
    token
      ? probePostmarkServer(token, from)
      : Promise.resolve({
          configured: false,
          ok: false,
          error: "POSTMARK_SERVER_TOKEN not set",
        } satisfies TransactionalEmailProbe["postmark"]),
    probeResendFallback(),
  ]);

  if (postmark.ok) {
    return { ok: true, provider: "postmark", from, postmark, resend };
  }
  if (resend.ok) {
    return {
      ok: true,
      provider: "resend",
      from,
      postmark,
      resend,
    };
  }
  return {
    ok: false,
    provider: token ? "postmark" : resend.configured ? "resend" : "none",
    from,
    postmark,
    resend,
    error: redactEmailSecrets(postmark.error || resend.error || "Transactional email is not configured"),
  };
}

/**
 * Technical Command email findings.
 * A healthy Postmark probe is healthy even when Resend is absent or degraded.
 */
export function buildTransactionalEmailFindings(probe: TransactionalEmailProbe): TransactionalEmailFinding[] {
  if (probe.ok && probe.provider === "postmark") {
    const resendNote = probe.resend.ok
      ? "Resend fallback is available and is not required."
      : probe.resend.configured
        ? "Resend fallback is degraded and is not a failure of transactional email."
        : "Resend fallback is not configured and is not a failure of transactional email.";
    return [
      {
        id: "transactional-email-health",
        module: "email",
        title: "Transactional Email Health",
        status: "ok",
        severity: "low",
        detail: `Postmark primary. From ${probe.from}. ${resendNote}`,
      },
      ...(!probe.resend.ok
        ? [{
            id: "resend-fallback-note",
            module: "email" as const,
            title: "Resend fallback note",
            status: "ok" as const,
            severity: "low" as const,
            detail: resendNote,
          }]
        : []),
    ];
  }

  if (probe.ok && probe.provider === "resend") {
    return [{
      id: "transactional-email-health",
      module: "email",
      title: "Transactional Email Health",
      status: "ok",
      severity: "low",
      detail: `Resend fallback is carrying mail. From ${probe.from}. Set POSTMARK_SERVER_TOKEN on Render to make Postmark primary.`,
    }];
  }

  if (!probe.postmark.configured && !probe.resend.configured) {
    return [{
      id: "transactional-email-health",
      module: "email",
      title: "Transactional Email Health",
      status: "failed",
      severity: "critical",
      detail: "Founder OTP and HQ email cannot send. Postmark and Resend are both unconfigured.",
      recommendedFix: "Set POSTMARK_SERVER_TOKEN on Render ifcdc-hq. Resend remains an optional fallback.",
      needsFounderApproval: true,
    }];
  }

  return [{
    id: "transactional-email-health",
    module: "email",
    title: "Transactional Email Health",
    status: "degraded",
    severity: "high",
    detail: redactEmailSecrets(probe.error || probe.postmark.error || probe.resend.error || "Transactional email probe failed"),
    recommendedFix: "Check POSTMARK_SERVER_TOKEN and sender service@ifcdc.org. Resend remains the fallback.",
  }];
}

async function sendViaPostmark(input: {
  token: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}): Promise<TransactionalSendResult> {
  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": input.token,
      },
      body: JSON.stringify({
        From: input.from,
        To: input.to.join(","),
        Subject: input.subject,
        TextBody: input.text,
        HtmlBody: input.html || input.text,
        MessageStream: "outbound",
        ...(input.replyTo ? { ReplyTo: input.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      MessageID?: string;
      Message?: string;
      ErrorCode?: number;
    };
    if (!res.ok || (typeof data.ErrorCode === "number" && data.ErrorCode !== 0)) {
      const err = redactEmailSecrets(data.Message || `Postmark error ${res.status}`);
      console.error(`[email] Postmark failed status=${res.status}: ${err}`);
      return {
        success: false,
        error: err,
        provider: "postmark",
        providerCode: data.ErrorCode || res.status,
        providerStatus: res.status,
        providerResponse: {
          errorCode: data.ErrorCode ?? res.status,
          message: err,
        },
        from: input.from,
        usedFallback: false,
      };
    }
    console.log(`[email] Postmark ok id=${data.MessageID ?? "unknown"}`);
    return {
      success: true,
      messageId: data.MessageID,
      provider: "postmark",
      providerStatus: res.status,
      providerResponse: { messageId: data.MessageID ?? null, fromUsed: input.from },
      from: input.from,
      usedFallback: false,
    };
  } catch (err) {
    const message = redactEmailSecrets(err instanceof Error ? err.message : "Postmark send failed");
    console.error(`[email] Postmark exception: ${message}`);
    return {
      success: false,
      error: message,
      provider: "postmark",
      from: input.from,
      usedFallback: false,
      providerResponse: { exception: message },
    };
  }
}

async function sendViaResend(input: {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}): Promise<TransactionalSendResult> {
  const apiKey = readResendApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: "RESEND_API_KEY is not configured",
      provider: "resend",
      providerCode: "missing_api_key",
    };
  }
  const { resolveVerifiedResendFromEmail } = await import("./notifications");
  const verified = await resolveVerifiedResendFromEmail();
  try {
    console.log(
      `[email] Resend fallback → to=${input.to.join(",")} from=${verified.from}`
      + (verified.usedFallback ? " (verified-domain fallback)" : ""),
    );
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: verified.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html || input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
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
      const err = redactEmailSecrets(data.message || data.error || data.name || `Resend error ${res.status}`);
      console.error(`[email] Resend fallback failed status=${res.status}: ${err}`);
      return {
        success: false,
        error: err,
        provider: "resend",
        providerCode: data.name || res.status,
        providerStatus: res.status,
        providerResponse: { message: err, fromUsed: verified.from, usedFallback: verified.usedFallback },
        from: verified.from,
        usedFallback: verified.usedFallback,
      };
    }
    console.log(`[email] Resend fallback ok id=${data.id ?? "unknown"}`);
    return {
      success: true,
      messageId: data.id,
      provider: "resend",
      providerStatus: res.status,
      providerResponse: { messageId: data.id ?? null, fromUsed: verified.from, usedFallback: verified.usedFallback },
      from: verified.from,
      usedFallback: verified.usedFallback,
    };
  } catch (err) {
    const message = redactEmailSecrets(err instanceof Error ? err.message : "Resend send failed");
    console.error(`[email] Resend fallback exception: ${message}`);
    return {
      success: false,
      error: message,
      provider: "resend",
      from: verified.from,
      usedFallback: verified.usedFallback,
      providerResponse: { exception: message },
    };
  }
}

export async function sendTransactionalEmail(input: {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  category?: TransactionalEmailCategory;
}): Promise<TransactionalSendResult> {
  const category = input.category || "hq_operational";
  const to = (Array.isArray(input.to) ? input.to : [input.to])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.includes("@"));
  if (!to.length) {
    return { success: false, error: "No valid recipients", provider: "none", category };
  }
  const subject = (input.subject || "IFCDC Headquarters").trim();
  const text = input.text || "";
  const from = resolveTransactionalFromAddress();

  if (!liveTransportPermitted()) {
    return {
      success: false,
      error: "Live email suppressed. No message was sent.",
      provider: readPostmarkServerToken() ? "postmark" : readResendApiKey() ? "resend" : "none",
      suppressed: true,
      from,
      category,
    };
  }

  const now = Date.now();
  pruneGuards(now);
  const key = dedupeKey({ category, to, subject, text });
  if (recentSuccessKeys.has(key)) {
    return {
      success: false,
      error: "Duplicate transactional email suppressed in the current window. No additional message was sent.",
      provider: readPostmarkServerToken() ? "postmark" : "resend",
      deduped: true,
      from,
      category,
    };
  }

  const bucket = bucketFor(category);
  const used = recentAttempts.filter((item) => item.bucket === bucket).length;
  if (used >= capFor(bucket)) {
    return {
      success: false,
      error: "Transactional email rate limit reached for this window. No additional message was sent.",
      provider: readPostmarkServerToken() ? "postmark" : "resend",
      rateLimited: true,
      from,
      category,
    };
  }
  recentAttempts.push({ at: now, bucket });

  const token = readPostmarkServerToken();
  if (token) {
    console.log(`[email] Postmark primary category=${category} to=${to.join(",")} from=${from}`);
    const primary = await sendViaPostmark({
      token,
      from,
      to,
      subject,
      text,
      html: input.html,
      replyTo: input.replyTo,
    });
    primary.category = category;
    if (primary.success) {
      recentSuccessKeys.set(key, now);
      return recordTransport(primary, false);
    }
    console.error(`[email] Postmark primary failed; trying Resend fallback. ${primary.error || "send failed"}`);
    const fallback = await sendViaResend({
      to,
      subject,
      text,
      html: input.html,
      replyTo: input.replyTo,
    });
    fallback.category = category;
    if (fallback.success) {
      recentSuccessKeys.set(key, now);
      return recordTransport(fallback, true);
    }
    if (!readResendApiKey()) {
      return recordTransport({
        ...primary,
        error: redactEmailSecrets(primary.error || "Postmark send failed and Resend is not configured"),
        category,
      }, false);
    }
    return recordTransport({
      ...fallback,
      error: redactEmailSecrets(fallback.error || primary.error || "Transactional email failed"),
      category,
    }, false);
  }

  const fallback = await sendViaResend({
    to,
    subject,
    text,
    html: input.html,
    replyTo: input.replyTo,
  });
  fallback.category = category;
  if (fallback.success) recentSuccessKeys.set(key, now);
  return recordTransport(fallback, fallback.success === true);
}
