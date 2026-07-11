/**
 * AURA Founder Identity & Trust System
 *
 * Enterprise-grade security with a smooth Founder experience:
 * - Public HQ line never assumes every caller is the Founder
 * - Registered Founder candidate phones are recognized, but NEVER elevated by ANI alone
 * - Voice/SMS Founder Mode requires a short-lived OTP emailed to service@ifcdc.org
 * - After OTP success, Founder Mode persists for the call/SMS session (no repeat prompts)
 * - HQ web can bind a trusted browser device (Face ID / Touch ID when available)
 * - Non-Founder callers stay on role-based access with confidential redaction
 */
import crypto from "crypto";
import { getDb } from "../db";
import { getSuperAdminEmail } from "../config/credentials";
import {
  ENTERPRISE_ROLE_LABELS,
  getAccessibleModules,
  getPermissions,
  hasPermission,
  toEnterpriseRole,
  type EnterpriseRole,
  type Permission,
} from "./enterpriseRoles";
import { logHqAudit } from "./hqAuditLog";
import { deliverFounderOtpWithFallback, OTP_TTL_MS as DELIVERY_OTP_TTL } from "./auraFounderOtpDelivery";
import { normalizeE164 } from "./twilioIntegrationEngine";

export type AuraChannel = "hq_web" | "voice" | "sms";

export type AuraIdentityAssurance =
  | "anonymous"
  | "authenticated"
  | "mfa_verified"
  | "founder_session"
  | "founder_trusted_device"
  | "founder_phone_verified"
  | "founder_otp_verified"
  | "founder_candidate_pending";

export type AuraTrustedIdentity = {
  userId: string | null;
  email: string | null;
  displayName: string | null;
  legacyRole: string;
  enterpriseRole: EnterpriseRole;
  enterpriseRoleLabel: string;
  isFounder: boolean;
  founderMode: boolean;
  assurance: AuraIdentityAssurance;
  channel: AuraChannel;
  phoneE164: string | null;
  sessionKey: string;
  permissions: Permission[];
  modules: string[];
  verifiedAt: string | null;
  trustedDeviceId?: string | null;
  /** Recognized Founder dialer — OTP still required before Founder Mode. */
  founderCandidate?: boolean;
};

export type PhoneTrustChallenge = {
  challengeId: string;
  sessionKey: string;
  phoneE164: string;
  status: "pending" | "verified" | "expired" | "failed";
  expiresAt: string;
  attempts: number;
};

const FOUNDER_DISPLAY_NAME = "Fahreal Allah";
/** OTP lifetime — 10 minutes; session stays open for code entry entire time. */
const OTP_TTL_MS = DELIVERY_OTP_TTL;
/** After verified OTP, remember Founder Mode for this call/SMS session. */
const PHONE_FOUNDER_SESSION_TTL_MS = 8 * 60 * 60_000;
const TRUSTED_DEVICE_TTL_MS = 90 * 24 * 60 * 60_000;
const MAX_OTP_ATTEMPTS = 5;

/** Built-in Founder candidate ANIs — still require OTP (never sole auth). */
const DEFAULT_FOUNDER_CANDIDATE_PHONES = ["+18484694448", "+17327615075"];

/** Confidential domains that non-Founder sessions must never discuss. */
export const FOUNDER_ONLY_TOPIC_PATTERNS: RegExp[] = [
  /\b(founder.?only|super.?admin|owner.?password|seed.?password)\b/i,
  /\b(payroll|salary|compensation|bank.?account|routing.?number|wire.?transfer)\b/i,
  /\b(ein|tax.?id|ssn|social.?security)\b/i,
  /\b(board.?packet|board.?minutes|executive.?brief|executive.?report)\b/i,
  /\b(hr\s+(file|records?|investigation)|termination|disciplinary)\b/i,
  /\b(budget\s+variance|operating\s+budget|fund\s+allocation)\b/i,
];

/** Topics unlocked in Founder Mode (identity prompt reference). */
export const FOUNDER_CONFIDENTIAL_DOMAINS = [
  "Grants",
  "Financials",
  "HR",
  "Payroll",
  "Operations",
  "Budgets",
  "Board documents",
  "Software Division",
  "Executive reports",
] as const;

let tablesReady = false;
const phoneFounderSessions = new Map<
  string,
  { identity: AuraTrustedIdentity; expiresAt: number }
>();

export function isFounderRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return r === "owner" || r === "founder" || toEnterpriseRole(role) === "founder";
}

export function getFounderEmail(): string {
  return getSuperAdminEmail();
}

function parsePhoneList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;\n\r]+/)
    .flatMap((part) => part.split(/\s+/))
    .map((p) => normalizeE164(p.trim()))
    .filter((p): p is string => Boolean(p));
}

/** Phones recognized as Founder candidates (ANI). OTP still required before Founder Mode. */
export function getLoadedFounderCandidatePhones(): string[] {
  const fromEnv = [
    ...parsePhoneList(process.env.FOUNDER_TRUSTED_PHONES),
    ...parsePhoneList(process.env.FOUNDER_PHONE),
    ...parsePhoneList(process.env.AURA_FOUNDER_PHONES),
  ];
  const defaults = DEFAULT_FOUNDER_CANDIDATE_PHONES
    .map((p) => normalizeE164(p))
    .filter((p): p is string => Boolean(p));
  return Array.from(new Set([...defaults, ...fromEnv]));
}

function parseCandidatePhones(): string[] {
  return getLoadedFounderCandidatePhones();
}

export function getFounderPhoneEnvSources(): {
  founderTrustedPhonesSet: boolean;
  founderPhoneSet: boolean;
  auraFounderPhonesSet: boolean;
  builtInDefaults: string[];
  loadedCount: number;
} {
  const builtInDefaults = DEFAULT_FOUNDER_CANDIDATE_PHONES
    .map((p) => normalizeE164(p))
    .filter((p): p is string => Boolean(p));
  return {
    founderTrustedPhonesSet: Boolean((process.env.FOUNDER_TRUSTED_PHONES || "").trim()),
    founderPhoneSet: Boolean((process.env.FOUNDER_PHONE || "").trim()),
    auraFounderPhonesSet: Boolean((process.env.AURA_FOUNDER_PHONES || "").trim()),
    builtInDefaults,
    loadedCount: getLoadedFounderCandidatePhones().length,
  };
}

export async function getFounderPhoneReadiness(): Promise<{
  trustedPhones: string[];
  sources: ReturnType<typeof getFounderPhoneEnvSources>;
  matchTests: Record<string, boolean>;
  hqPhone: string | null;
  otpEmail: string;
}> {
  const trustedPhones = getLoadedFounderCandidatePhones();
  const tests = ["+18484694448", "+17327615075", "+13313168167", "+15555550100"];
  const matchTests: Record<string, boolean> = {};
  for (const phone of tests) {
    matchTests[phone] = await isTrustedFounderPhone(phone);
  }
  const { resolveTwilioPhoneNumber } = await import("./twilioIntegrationEngine");
  return {
    trustedPhones,
    sources: getFounderPhoneEnvSources(),
    matchTests,
    hqPhone: resolveTwilioPhoneNumber(),
    otpEmail: getFounderEmail(),
  };
}

export async function ensureAuraTrustTables(): Promise<void> {
  if (tablesReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_identity_challenges (
      id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      phone_e164 TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      actor_email TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      verified_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aura_identity_session ON aura_identity_challenges(session_key, status);

    CREATE TABLE IF NOT EXISTS aura_founder_sessions (
      session_key TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      phone_e164 TEXT,
      user_id TEXT,
      email TEXT,
      display_name TEXT,
      assurance TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS aura_trusted_devices (
      device_id TEXT PRIMARY KEY,
      user_id TEXT,
      email TEXT NOT NULL,
      display_name TEXT,
      label TEXT,
      public_key_jwk TEXT,
      biometric_bound INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aura_trusted_devices_email ON aura_trusted_devices(email);
  `);
  // Non-destructive column adds for delivery tracking (ignore if already present).
  const alters = [
    "ALTER TABLE aura_identity_challenges ADD COLUMN code_sealed TEXT",
    "ALTER TABLE aura_identity_challenges ADD COLUMN delivery_status TEXT DEFAULT 'pending'",
    "ALTER TABLE aura_identity_challenges ADD COLUMN email_sent INTEGER DEFAULT 0",
    "ALTER TABLE aura_identity_challenges ADD COLUMN sms_sent INTEGER DEFAULT 0",
    "ALTER TABLE aura_identity_challenges ADD COLUMN email_message_id TEXT",
    "ALTER TABLE aura_identity_challenges ADD COLUMN sms_message_id TEXT",
    "ALTER TABLE aura_identity_challenges ADD COLUMN preferred_channel TEXT",
    "ALTER TABLE aura_identity_challenges ADD COLUMN last_delivery_error TEXT",
  ];
  for (const sql of alters) {
    await db.run(sql).catch(() => undefined);
  }
  tablesReady = true;
}

function buildFounderIdentity(opts: {
  userId?: string | null;
  email?: string | null;
  displayName?: string | null;
  channel: AuraChannel;
  phoneE164?: string | null;
  sessionKey: string;
  assurance: AuraIdentityAssurance;
  verifiedAt?: string | null;
  trustedDeviceId?: string | null;
}): AuraTrustedIdentity {
  const now = opts.verifiedAt || new Date().toISOString();
  return {
    userId: opts.userId ?? null,
    email: (opts.email || getFounderEmail()).toLowerCase(),
    displayName: opts.displayName || FOUNDER_DISPLAY_NAME,
    legacyRole: "owner",
    enterpriseRole: "founder",
    enterpriseRoleLabel: ENTERPRISE_ROLE_LABELS.founder,
    isFounder: true,
    founderMode: true,
    assurance: opts.assurance,
    channel: opts.channel,
    phoneE164: opts.phoneE164 ?? null,
    sessionKey: opts.sessionKey,
    permissions: getPermissions("owner"),
    modules: getAccessibleModules("owner"),
    verifiedAt: now,
    trustedDeviceId: opts.trustedDeviceId ?? null,
  };
}

/**
 * SECURITY: Never elevate Founder Mode from phone ANI alone.
 * Kept for audit/call sites that previously used seamless elevation — always returns null.
 */
export async function elevateFounderFromTrustedPhone(_opts: {
  sessionKey: string;
  channel: AuraChannel;
  phoneE164: string;
}): Promise<AuraTrustedIdentity | null> {
  return null;
}

function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(`ifcdc-aura-otp:${code}`).digest("hex");
}

function sealOtp(code: string): string {
  const secret = (process.env.JWT_SECRET || "ifcdc-aura-otp-seal").slice(0, 32).padEnd(32, "0");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(secret), iv);
  const enc = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

function unsealOtp(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const [ivB64, tagB64, encB64] = sealed.split(".");
    if (!ivB64 || !tagB64 || !encB64) return null;
    const secret = (process.env.JWT_SECRET || "ifcdc-aura-otp-seal").slice(0, 32).padEnd(32, "0");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      Buffer.from(secret),
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(encB64, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}

export async function lookupUserByPhone(phoneE164: string | null): Promise<{
  id: string;
  email: string;
  role: string;
  name: string | null;
  phone: string | null;
} | null> {
  if (!phoneE164) return null;
  const db = await getDb();
  const digits = phoneE164.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  const row = await db
    .get<{ id: string; email: string; role: string; name: string | null; phone: string | null }>(
      `SELECT id, email, role, name, phone FROM users
       WHERE phone IS NOT NULL AND phone != ''
         AND (
           replace(replace(replace(replace(phone,'+',''),'-',''),' ',''),'(','') LIKE ?
           OR replace(replace(replace(replace(phone,'+',''),'-',''),' ',''),'(','') LIKE ?
         )
       ORDER BY CASE WHEN lower(role) IN ('owner','founder') THEN 0 ELSE 1 END
       LIMIT 1`,
      `%${digits}%`,
      `%${last10}%`
    )
    .catch(() => null);
  return row ?? null;
}

/** Registered Founder candidate dialer (ANI). Does NOT grant Founder Mode by itself. */
export async function isTrustedFounderPhone(phoneE164: string | null): Promise<boolean> {
  if (!phoneE164) return false;
  if (parseCandidatePhones().includes(phoneE164)) return true;
  const user = await lookupUserByPhone(phoneE164);
  if (!user) return false;
  return isFounderRole(user.role) || user.email.toLowerCase() === getFounderEmail();
}

export async function isFounderCandidatePhone(phoneE164: string | null): Promise<boolean> {
  return isTrustedFounderPhone(phoneE164);
}

export function resolveIdentityFromHqUser(opts: {
  user?: {
    id?: string;
    email?: string;
    role?: string;
    name?: string;
    mfaVerified?: boolean;
  } | null;
  channel?: AuraChannel;
  sessionKey?: string;
  /** Optional browser device binding — elevates assurance to trusted device. */
  trustedDeviceId?: string | null;
  deviceTrusted?: boolean;
}): AuraTrustedIdentity {
  const user = opts.user;
  const email = user?.email?.toLowerCase().trim() || null;
  const role = user?.role || "client";
  const enterpriseRole = toEnterpriseRole(role === "owner" ? "owner" : role);
  const founder =
    Boolean(email && email === getFounderEmail())
    || isFounderRole(role);

  let assurance: AuraIdentityAssurance = !user
    ? "anonymous"
    : founder
      ? opts.deviceTrusted
        ? "founder_trusted_device"
        : user.mfaVerified
          ? "founder_session"
          : "founder_session"
      : user.mfaVerified
        ? "mfa_verified"
        : "authenticated";

  if (founder && assurance === "authenticated") assurance = "founder_session";

  return {
    userId: user?.id ?? null,
    email,
    displayName: user?.name || (founder ? FOUNDER_DISPLAY_NAME : null),
    legacyRole: role,
    enterpriseRole,
    enterpriseRoleLabel: ENTERPRISE_ROLE_LABELS[enterpriseRole],
    isFounder: founder,
    founderMode: Boolean(founder && user),
    assurance,
    channel: opts.channel ?? "hq_web",
    phoneE164: null,
    sessionKey: opts.sessionKey || email || "anonymous",
    permissions: getPermissions(role),
    modules: getAccessibleModules(role),
    verifiedAt: founder ? new Date().toISOString() : null,
    trustedDeviceId: opts.trustedDeviceId ?? null,
  };
}

export async function getPhoneFounderSession(sessionKey: string): Promise<AuraTrustedIdentity | null> {
  const mem = phoneFounderSessions.get(sessionKey);
  if (mem && mem.expiresAt > Date.now()) return mem.identity;

  await ensureAuraTrustTables();
  const db = await getDb();
  const row = await db
    .get<{
      session_key: string;
      channel: string;
      phone_e164: string | null;
      user_id: string | null;
      email: string | null;
      display_name: string | null;
      assurance: string;
      verified_at: string;
      expires_at: string;
    }>("SELECT * FROM aura_founder_sessions WHERE session_key = ?", sessionKey)
    .catch(() => null);

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.run("DELETE FROM aura_founder_sessions WHERE session_key = ?", sessionKey).catch(() => undefined);
    phoneFounderSessions.delete(sessionKey);
    return null;
  }

  const assurance = (row.assurance || "founder_phone_verified") as AuraIdentityAssurance;
  const identity = buildFounderIdentity({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name || FOUNDER_DISPLAY_NAME,
    channel: row.channel as AuraChannel,
    phoneE164: row.phone_e164,
    sessionKey: row.session_key,
    assurance:
      assurance === "founder_trusted_device"
      || assurance === "founder_otp_verified"
      || assurance === "founder_phone_verified"
      || assurance === "founder_session"
        ? assurance
        : "founder_phone_verified",
    verifiedAt: row.verified_at,
  });
  phoneFounderSessions.set(sessionKey, {
    identity,
    expiresAt: new Date(row.expires_at).getTime(),
  });
  return identity;
}

export async function persistPhoneFounderSession(identity: AuraTrustedIdentity): Promise<void> {
  await ensureAuraTrustTables();
  const expiresAt = new Date(Date.now() + PHONE_FOUNDER_SESSION_TTL_MS).toISOString();
  const db = await getDb();
  await db.run(
    `INSERT INTO aura_founder_sessions (
      session_key, channel, phone_e164, user_id, email, display_name, assurance, verified_at, expires_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET
      channel = excluded.channel,
      phone_e164 = excluded.phone_e164,
      user_id = excluded.user_id,
      email = excluded.email,
      display_name = excluded.display_name,
      assurance = excluded.assurance,
      verified_at = excluded.verified_at,
      expires_at = excluded.expires_at,
      metadata_json = excluded.metadata_json`,
    identity.sessionKey,
    identity.channel,
    identity.phoneE164,
    identity.userId,
    identity.email,
    identity.displayName,
    identity.assurance,
    identity.verifiedAt || new Date().toISOString(),
    expiresAt,
    JSON.stringify({ founderMode: true })
  );
  phoneFounderSessions.set(identity.sessionKey, {
    identity,
    expiresAt: new Date(expiresAt).getTime(),
  });
}

export type FounderChallengeRow = {
  id: string;
  session_key: string;
  phone_e164: string;
  code_hash: string;
  code_sealed?: string | null;
  status: string;
  attempts: number;
  actor_email: string | null;
  created_at: string;
  expires_at: string;
  delivery_status?: string | null;
  email_sent?: number | null;
  sms_sent?: number | null;
  email_message_id?: string | null;
  sms_message_id?: string | null;
  preferred_channel?: string | null;
  last_delivery_error?: string | null;
};

export async function getActiveFounderChallenge(
  sessionKey: string,
  phoneE164?: string | null
): Promise<FounderChallengeRow | null> {
  await ensureAuraTrustTables();
  const db = await getDb();
  let row = await db.get<FounderChallengeRow>(
    `SELECT * FROM aura_identity_challenges
     WHERE session_key = ? AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    sessionKey
  );
  // Voice CallSid changes on callback — recover pending OTP by Founder phone.
  if (!row && phoneE164) {
    const phone = normalizeE164(phoneE164);
    if (phone) {
      row = await db.get<FounderChallengeRow>(
        `SELECT * FROM aura_identity_challenges
         WHERE phone_e164 = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`,
        phone
      );
      if (row) {
        await db.run(
          `UPDATE aura_identity_challenges SET session_key = ? WHERE id = ?`,
          sessionKey,
          row.id
        );
        row = { ...row, session_key: sessionKey };
      }
    }
  }
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.run(
      `UPDATE aura_identity_challenges SET status = 'expired', delivery_status = 'expired' WHERE id = ?`,
      row.id
    );
    return null;
  }
  return row;
}

function formatDeliverySuccessMessage(opts: {
  actorEmail: string;
  emailSent: boolean;
  smsSent: boolean;
  deliveryStatus: string;
  emailError?: string;
  smsError?: string;
}): string {
  const mins = Math.round(OTP_TTL_MS / 60_000);
  const emailErr = opts.emailError ? ` Email error: ${opts.emailError.slice(0, 160)}.` : "";
  const smsErr = opts.smsError ? ` SMS error: ${opts.smsError.slice(0, 160)}.` : "";
  if (opts.emailSent && opts.smsSent) {
    return `Provider accepted your verification code for ${opts.actorEmail} and for this phone by text. Status: sent. Please say or text the 6-digit code when you receive it. I'll keep this verification open for ${mins} minutes. Say resend code or try another method if needed.`;
  }
  if (opts.emailSent) {
    return `Email provider accepted the send to ${opts.actorEmail}. Status: partial — SMS not confirmed.${smsErr} Please say or text the 6-digit code from that email. I'll wait up to ${mins} minutes. Say resend code or try text message if you don't see it.`;
  }
  if (opts.smsSent) {
    return `SMS provider accepted the send to this phone. Status: partial — email not confirmed.${emailErr} Please say or text the 6-digit code now. I'll wait up to ${mins} minutes. Say try email or resend code if you need another copy.`;
  }
  return `I could not confirm delivery to ${opts.actorEmail} or by SMS (${opts.deliveryStatus}).${emailErr}${smsErr} Say resend code, try text message, or try email.`;
}

function formatPendingChallengeMessage(row: FounderChallengeRow): string {
  const mins = Math.max(1, Math.round((new Date(row.expires_at).getTime() - Date.now()) / 60_000));
  const emailOk = Boolean(row.email_sent);
  const smsOk = Boolean(row.sms_sent);
  if (emailOk || smsOk) {
    return `You still have an active Founder verification code${emailOk ? " emailed to service@ifcdc.org" : ""}${smsOk ? " and texted to this phone" : ""}. Please say or text the 6-digit code. It expires in about ${mins} minutes. Say resend code or try another method if you need help.`;
  }
  return `Your Founder verification is still open for about ${mins} more minutes. Say resend code and I'll try delivery again, or say try text message / try email.`;
}

async function finalizeFounderChallengeDelivery(opts: {
  challengeId: string;
  actorEmail: string;
  emailSent: boolean;
  smsSent: boolean;
  deliveryStatus: string;
  emailError?: string;
  smsError?: string;
}): Promise<{
  ok: boolean;
  challengeId: string;
  message: string;
  smsSent: boolean;
  emailSent: boolean;
}> {
  const { challengeId, actorEmail, emailSent, smsSent, deliveryStatus } = opts;

  if (!emailSent && !smsSent) {
    return {
      ok: false,
      challengeId,
      smsSent: false,
      emailSent: false,
      message:
        `I could not confirm delivery to ${actorEmail} or by SMS (${opts.emailError || "email failed"}; ${opts.smsError || "sms failed"}). Say resend code, try text message, or try email.`,
    };
  }

  return {
    ok: true,
    challengeId,
    smsSent,
    emailSent,
    message: formatDeliverySuccessMessage({
      actorEmail,
      emailSent,
      smsSent,
      deliveryStatus,
      emailError: opts.emailError,
      smsError: opts.smsError,
    }),
  };
}

export async function startFounderPhoneChallenge(opts: {
  sessionKey: string;
  phoneE164: string;
  channel: AuraChannel;
  preferSeamless?: boolean;
  /** Reuse pending challenge instead of issuing a new code. */
  skipIfPending?: boolean;
  /** email | sms | both — for resend / alternate method */
  channelPreference?: "email" | "sms" | "both";
}): Promise<{
  ok: boolean;
  challengeId?: string;
  message: string;
  smsSent: boolean;
  emailSent?: boolean;
  deliveryPending?: boolean;
  awaitingCode?: boolean;
  deliveryStatus?: string;
  identity?: AuraTrustedIdentity;
  seamless?: boolean;
}> {
  await ensureAuraTrustTables();
  const phone = normalizeE164(opts.phoneE164);
  if (!phone) return { ok: false, message: "I need a valid phone number to verify you.", smsSent: false };

  // If this session already completed OTP, reuse Founder Mode (no re-prompt).
  const existing = await getPhoneFounderSession(opts.sessionKey);
  if (existing?.founderMode) {
    return {
      ok: true,
      smsSent: false,
      emailSent: false,
      seamless: true,
      identity: existing,
      message: `Founder Mode is already active for this session, ${existing.displayName}. How may I assist you?`,
    };
  }

  const trusted = await isFounderCandidatePhone(phone);
  if (!trusted) {
    await logHqAudit({
      action: "aura_founder_verify_denied",
      entityType: "aura_identity",
      entityId: opts.sessionKey,
      detail: "Unregistered phone attempted Founder Mode",
      metadata: { phone, channel: opts.channel },
    });
    return {
      ok: false,
      message:
        "I can start Founder verification only from a registered Founder phone. Sign in to IFCDC HQ, or contact Headquarters to register this line.",
      smsSent: false,
      emailSent: false,
    };
  }

  const actorEmail = getFounderEmail();

  if (opts.skipIfPending !== false) {
    const pending = await getActiveFounderChallenge(opts.sessionKey, phone);
    if (pending) {
      const deliveryFailed =
        pending.delivery_status === "failed"
        || (!pending.email_sent && !pending.sms_sent);
      if (deliveryFailed) {
        const code = unsealOtp(pending.code_sealed);
        if (code) {
          const { email, sms, deliveryStatus, emailSent, smsSent } = await deliverFounderOtpWithFallback({
            challengeId: pending.id,
            code,
            phoneE164: phone,
            sessionKey: opts.sessionKey,
            callerChannel: opts.channel,
            actorEmail,
            channelPreference: opts.channelPreference ?? "both",
          });
          const result = await finalizeFounderChallengeDelivery({
            challengeId: pending.id,
            actorEmail,
            emailSent,
            smsSent,
            deliveryStatus,
            emailError: email.error,
            smsError: sms.error,
          });
          return {
            ...result,
            awaitingCode: result.ok,
            deliveryStatus,
          };
        }
      }
      return {
        ok: true,
        challengeId: pending.id,
        smsSent: Boolean(pending.sms_sent),
        emailSent: Boolean(pending.email_sent),
        awaitingCode: true,
        deliveryStatus: pending.delivery_status || "pending",
        message: formatPendingChallengeMessage(pending),
      };
    }
  }

  const code = generateOtp();
  const challengeId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString();
  const db = await getDb();
  await db.run(
    `INSERT INTO aura_identity_challenges (
      id, session_key, phone_e164, code_hash, code_sealed, status, attempts, actor_email,
      created_at, expires_at, delivery_status
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, 'pending')`,
    challengeId,
    opts.sessionKey,
    phone,
    hashOtp(code),
    sealOtp(code),
    actorEmail,
    now.toISOString(),
    expiresAt
  );

  const { email, sms, deliveryStatus, emailSent, smsSent } = await deliverFounderOtpWithFallback({
    challengeId,
    code,
    phoneE164: phone,
    sessionKey: opts.sessionKey,
    callerChannel: opts.channel,
    actorEmail,
    channelPreference: opts.channelPreference ?? "both",
  });

  const result = await finalizeFounderChallengeDelivery({
    challengeId,
    actorEmail,
    emailSent,
    smsSent,
    deliveryStatus,
    emailError: email.error,
    smsError: sms.error,
  });

  return {
    ...result,
    awaitingCode: result.ok,
    deliveryStatus,
  };
}

/** Resend the same active code — does not invalidate until expiry or successful verify. */
export async function resendFounderOtp(opts: {
  sessionKey: string;
  phoneE164: string;
  channel: AuraChannel;
  channelPreference?: "email" | "sms" | "both";
}): Promise<{
  ok: boolean;
  message: string;
  emailSent: boolean;
  smsSent: boolean;
  deliveryStatus?: string;
}> {
  await ensureAuraTrustTables();
  const pending = await getActiveFounderChallenge(opts.sessionKey, opts.phoneE164);
  if (!pending) {
    return {
      ok: false,
      message: 'No active verification code. Say "verify founder" to start a new one.',
      emailSent: false,
      smsSent: false,
    };
  }
  const code = unsealOtp(pending.code_sealed);
  if (!code) {
    return {
      ok: false,
      message: "I cannot resend this session's code securely. Say verify founder to start a fresh code.",
      emailSent: false,
      smsSent: false,
    };
  }
  const actorEmail = pending.actor_email || getFounderEmail();
  const phone = normalizeE164(opts.phoneE164) || pending.phone_e164;
  const { email, sms, deliveryStatus, emailSent, smsSent } = await deliverFounderOtpWithFallback({
    challengeId: pending.id,
    code,
    phoneE164: phone,
    sessionKey: opts.sessionKey,
    callerChannel: opts.channel,
    actorEmail,
    channelPreference: opts.channelPreference ?? "both",
  });
  const finalized = await finalizeFounderChallengeDelivery({
    challengeId: pending.id,
    actorEmail,
    emailSent,
    smsSent,
    deliveryStatus,
    emailError: email.error,
    smsError: sms.error,
  });
  return {
    ok: finalized.ok,
    message: finalized.ok
      ? `Resent your verification code. ${finalized.message}`
      : finalized.message,
    emailSent,
    smsSent,
    deliveryStatus,
  };
}

export async function tryAlternateFounderDelivery(opts: {
  sessionKey: string;
  phoneE164: string;
  channel: AuraChannel;
}): Promise<ReturnType<typeof resendFounderOtp>> {
  const pending = await getActiveFounderChallenge(opts.sessionKey, opts.phoneE164);
  const prefer: "email" | "sms" = pending?.preferred_channel === "email" ? "sms" : "email";
  return resendFounderOtp({ ...opts, channelPreference: prefer });
}

export async function verifyFounderPhoneChallenge(opts: {
  sessionKey: string;
  code: string;
  channel: AuraChannel;
  phoneE164?: string | null;
}): Promise<{ ok: boolean; identity?: AuraTrustedIdentity; message: string }> {
  await ensureAuraTrustTables();
  const code = opts.code.replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) {
    return { ok: false, message: "Please provide the 6-digit verification code I emailed to service@ifcdc.org." };
  }

  const db = await getDb();
  const row = await getActiveFounderChallenge(opts.sessionKey, opts.phoneE164);

  if (!row) {
    return { ok: false, message: "I don't have an active Founder verification request. Say \"verify founder\" to start one." };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.run(`UPDATE aura_identity_challenges SET status = 'expired', delivery_status = 'expired' WHERE id = ?`, row.id);
    await logHqAudit({
      action: "aura_founder_otp_expired",
      entityType: "aura_identity",
      entityId: row.id,
      detail: "Founder OTP expired before verification",
      actorEmail: row.actor_email || getFounderEmail(),
      metadata: { phone: row.phone_e164, channel: opts.channel },
    });
    return { ok: false, message: "That verification code expired. Say \"verify founder\" and I'll send a fresh code." };
  }
  if (row.attempts >= MAX_OTP_ATTEMPTS) {
    await db.run(`UPDATE aura_identity_challenges SET status = 'failed' WHERE id = ?`, row.id);
    await logHqAudit({
      action: "aura_founder_otp_locked",
      entityType: "aura_identity",
      entityId: row.id,
      detail: "Founder OTP locked after too many failed attempts",
      actorEmail: row.actor_email || getFounderEmail(),
      metadata: { phone: row.phone_e164, attempts: row.attempts },
    });
    return { ok: false, message: "Too many incorrect attempts. Starting over requires saying \"verify founder\" again." };
  }

  if (hashOtp(code) !== row.code_hash) {
    await db.run(`UPDATE aura_identity_challenges SET attempts = attempts + 1 WHERE id = ?`, row.id);
    await logHqAudit({
      action: "aura_founder_otp_failed",
      entityType: "aura_identity",
      entityId: row.id,
      detail: "Incorrect Founder OTP — privileges denied",
      actorEmail: row.actor_email || getFounderEmail(),
      metadata: { attempts: row.attempts + 1, phone: row.phone_e164, channel: opts.channel },
    });
    return { ok: false, message: "That code didn't match. Please try the 6-digit code from the email again." };
  }

  const now = new Date().toISOString();
  await db.run(
    `UPDATE aura_identity_challenges SET status = 'verified', verified_at = ?, attempts = attempts + 1, delivery_status = 'verified' WHERE id = ?`,
    now,
    row.id
  );

  const user = await lookupUserByPhone(row.phone_e164);
  const identity = buildFounderIdentity({
    userId: user?.id ?? null,
    email: getFounderEmail(),
    displayName: user?.name || FOUNDER_DISPLAY_NAME,
    channel: opts.channel,
    phoneE164: row.phone_e164,
    sessionKey: opts.sessionKey,
    assurance: "founder_otp_verified",
    verifiedAt: now,
  });

  await persistPhoneFounderSession(identity);
  await logHqAudit({
    action: "aura_founder_mode_enabled",
    entityType: "aura_identity",
    entityId: opts.sessionKey,
    detail: "Founder Mode enabled via email OTP verification",
    actorId: identity.userId || undefined,
    actorEmail: identity.email || undefined,
    metadata: {
      channel: opts.channel,
      phone: row.phone_e164,
      assurance: identity.assurance,
      delivery: "email",
      emailTo: getFounderEmail(),
    },
  });

  return {
    ok: true,
    identity,
    message: `Welcome back, ${identity.displayName}. Founder Mode is active for this call. I have full Super Admin access — finances, grants, HR, workflows, documents, and executive command — and I'll remember you for the rest of this session.`,
  };
}

export async function resolvePhoneCallerIdentity(opts: {
  sessionKey: string;
  channel: AuraChannel;
  callerPhone?: string | null;
}): Promise<AuraTrustedIdentity> {
  const elevated = await getPhoneFounderSession(opts.sessionKey);
  if (elevated) return { ...elevated, channel: opts.channel };

  const phone = normalizeE164(opts.callerPhone);
  const candidate = phone ? await isFounderCandidatePhone(phone) : false;

  // NEVER grant Founder Mode from ANI alone — candidate phones stay public until OTP.
  const user = await lookupUserByPhone(phone);
  if (user) {
    const enterpriseRole = toEnterpriseRole(user.role === "owner" ? "owner" : user.role);
    return {
      userId: user.id,
      email: user.email.toLowerCase(),
      displayName: user.name,
      legacyRole: user.role,
      enterpriseRole,
      enterpriseRoleLabel: ENTERPRISE_ROLE_LABELS[enterpriseRole],
      isFounder: false,
      founderMode: false,
      assurance: candidate ? "founder_candidate_pending" : "authenticated",
      channel: opts.channel,
      phoneE164: phone,
      sessionKey: opts.sessionKey,
      permissions: getPermissions(user.role),
      modules: getAccessibleModules(user.role),
      verifiedAt: null,
      founderCandidate: candidate,
    };
  }

  return {
    userId: null,
    email: null,
    displayName: null,
    legacyRole: "client",
    enterpriseRole: "client",
    enterpriseRoleLabel: ENTERPRISE_ROLE_LABELS.client,
    isFounder: false,
    founderMode: false,
    assurance: candidate ? "founder_candidate_pending" : "anonymous",
    channel: opts.channel,
    phoneE164: phone,
    sessionKey: opts.sessionKey,
    permissions: getPermissions("client"),
    modules: getAccessibleModules("client"),
    verifiedAt: null,
    founderCandidate: candidate,
  };
}

export function wantsFounderVerification(message: string): boolean {
  const q = message.trim().toLowerCase();
  return (
    /\b(verify|verification|authenticate|founder mode|this is (the )?founder|i am (the )?founder|i'm fahreal|this is fahreal)\b/.test(q)
    || /\b(enable|activate|enter)\s+founder\b/.test(q)
  );
}

export function wantsResendFounderCode(message: string): boolean {
  const q = message.trim().toLowerCase();
  return /\b(resend|send again|another code|new code|didn't get|did not get|never got|no code)\b/.test(q);
}

export function wantsAlternateFounderDelivery(message: string): boolean {
  const q = message.trim().toLowerCase();
  return (
    /\b(try (another|a different) method|other method|use (text|sms|email)|try (text|sms|email)|send (by|via) (text|sms|email))\b/.test(q)
    || /\btext (message|me)\b/.test(q)
    || /\bemail (instead|me)\b/.test(q)
  );
}

export function extractOtpFromMessage(message: string): string | null {
  const digits = message.replace(/\D/g, "");
  if (digits.length >= 6) {
    const match = digits.match(/(\d{6})/);
    if (match) return match[1];
  }
  const match = message.match(/\b(\d{6})\b/);
  return match?.[1] ?? null;
}

export async function hasActiveFounderVerification(sessionKey: string): Promise<boolean> {
  return Boolean(await getActiveFounderChallenge(sessionKey));
}

export function identityAllowsPermission(identity: AuraTrustedIdentity, permission: Permission): boolean {
  if (identity.founderMode) return true;
  return hasPermission(identity.legacyRole, permission);
}

export function identityAllowsModule(identity: AuraTrustedIdentity, module: string): boolean {
  if (identity.founderMode) return true;
  return identity.modules.includes(module);
}

export function redactConfidentialForIdentity(identity: AuraTrustedIdentity, text: string): string {
  if (identity.founderMode) return text;
  let out = text;
  for (const pattern of FOUNDER_ONLY_TOPIC_PATTERNS) {
    if (pattern.test(out)) {
      return "I can only share that information with the Founder or an authorized executive after they authenticate. Please sign in to IFCDC HQ or ask the Founder to review it.";
    }
  }
  // Strip obvious secret patterns for non-founder callers.
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted]");
  out = out.replace(/\bEIN[:\s]*\d[\d-]+\b/gi, "[EIN redacted]");
  return out;
}

export function buildAuraIdentitySystemBlock(identity: AuraTrustedIdentity): string {
  if (identity.founderMode) {
    return `
═══ IDENTITY: FOUNDER MODE ACTIVE ═══
You are speaking with ${identity.displayName || FOUNDER_DISPLAY_NAME}, Founder and Super Admin of IFCDC.
Email: ${identity.email || getFounderEmail()}
Assurance: ${identity.assurance}
Channel: ${identity.channel}
Trusted device: ${identity.assurance === "founder_trusted_device" ? "yes — seamless daily access" : "session verified"}

CONFIDENTIAL DOMAINS UNLOCKED
${FOUNDER_CONFIDENTIAL_DOMAINS.map((d) => `- ${d}`).join("\n")}

RULES FOR THIS SESSION
- Do NOT ask who they are again. Persist Founder awareness for the entire session.
- Discuss confidential organizational information freely within these domains when asked.
- They may issue enterprise-wide Super Admin commands and review Founder-approval items.
- Still never auto-submit grants, send money, or finalize irreversible actions without explicit confirmation — stage them for Founder approval when required.
- Address them as Founder / Fahreal when natural.
- Every material Founder action is audited automatically — do not mention audit machinery unless asked.
═══ END IDENTITY ═══`;
  }

  return `
═══ IDENTITY: ROLE-SCOPED SESSION ═══
Authenticated role: ${identity.enterpriseRoleLabel} (${identity.enterpriseRole})
Assurance: ${identity.assurance}
Channel: ${identity.channel}
Caller: ${identity.displayName || identity.email || identity.phoneE164 || "unknown public caller"}
Founder candidate phone recognized: ${identity.founderCandidate ? "YES — OTP still required before Founder Mode" : "no"}
Allowed modules: ${identity.modules.join(", ") || "public receptionist topics only"}

RULES FOR THIS SESSION
- NEVER assume this caller is the Founder. The public HQ line is shared.
- NEVER grant Founder privileges based on phone number alone.
- Stay within this role. NEVER reveal confidential HQ data beyond their authorized permissions:
  grants internals (beyond public overview), financials, HR, payroll, operations internals, budgets, board documents, Software Division internals, or executive reports.
- If Founder candidate phone is recognized OR the caller claims to be the Founder, ask them to say "verify founder". AURA will email a one-time code to ${getFounderEmail()}. Only after they provide the correct code may Founder Mode activate.
- If already in Founder Mode for this session, do not re-request verification unless the session expired.
- Do not invent elevated permissions. Prefer routing sensitive requests to a callback / Founder review.
- Public callers may ask about programs, appointments, and general IFCDC information only.
═══ END IDENTITY ═══`;
}

export async function registerTrustedFounderDevice(opts: {
  email: string;
  userId?: string | null;
  displayName?: string | null;
  deviceId: string;
  label?: string;
  biometricBound?: boolean;
  publicKeyJwk?: string | null;
}): Promise<{ ok: boolean; deviceId: string; expiresAt: string; message: string }> {
  await ensureAuraTrustTables();
  const email = opts.email.toLowerCase().trim();
  if (!email || email !== getFounderEmail()) {
    return {
      ok: false,
      deviceId: opts.deviceId,
      expiresAt: "",
      message: "Only the Founder account can register a trusted HQ device.",
    };
  }
  const deviceId = opts.deviceId.trim().slice(0, 128);
  if (deviceId.length < 16) {
    return { ok: false, deviceId, expiresAt: "", message: "Invalid device id." };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS).toISOString();
  const db = await getDb();
  await db.run(
    `INSERT INTO aura_trusted_devices (
      device_id, user_id, email, display_name, label, public_key_jwk, biometric_bound, created_at, last_seen_at, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(device_id) DO UPDATE SET
      user_id = excluded.user_id,
      email = excluded.email,
      display_name = excluded.display_name,
      label = COALESCE(excluded.label, aura_trusted_devices.label),
      public_key_jwk = COALESCE(excluded.public_key_jwk, aura_trusted_devices.public_key_jwk),
      biometric_bound = excluded.biometric_bound,
      last_seen_at = excluded.last_seen_at,
      expires_at = excluded.expires_at,
      revoked_at = NULL`,
    deviceId,
    opts.userId ?? null,
    email,
    opts.displayName || FOUNDER_DISPLAY_NAME,
    opts.label || "Founder HQ device",
    opts.publicKeyJwk ?? null,
    opts.biometricBound ? 1 : 0,
    now.toISOString(),
    now.toISOString(),
    expiresAt
  );

  await logHqAudit({
    action: "aura_founder_device_registered",
    entityType: "aura_trusted_device",
    entityId: deviceId,
    detail: "Founder trusted device registered for seamless HQ access",
    actorId: opts.userId || undefined,
    actorEmail: email,
    metadata: { biometricBound: Boolean(opts.biometricBound), label: opts.label },
  });

  return {
    ok: true,
    deviceId,
    expiresAt,
    message: "This device is now trusted. Future HQ sessions can use Face ID / Touch ID when available, without repeated OTP.",
  };
}

export async function resolveTrustedFounderDevice(opts: {
  deviceId?: string | null;
  email?: string | null;
}): Promise<{ trusted: boolean; deviceId: string | null; biometricBound: boolean; expiresAt: string | null }> {
  const deviceId = opts.deviceId?.trim() || null;
  const email = opts.email?.toLowerCase().trim() || null;
  if (!deviceId || !email) {
    return { trusted: false, deviceId, biometricBound: false, expiresAt: null };
  }
  await ensureAuraTrustTables();
  const db = await getDb();
  const row = await db
    .get<{
      device_id: string;
      email: string;
      biometric_bound: number;
      expires_at: string;
      revoked_at: string | null;
    }>(
      `SELECT device_id, email, biometric_bound, expires_at, revoked_at
       FROM aura_trusted_devices WHERE device_id = ? LIMIT 1`,
      deviceId
    )
    .catch(() => null);

  if (!row || row.revoked_at || row.email.toLowerCase() !== email) {
    return { trusted: false, deviceId, biometricBound: false, expiresAt: null };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { trusted: false, deviceId, biometricBound: false, expiresAt: row.expires_at };
  }

  await db
    .run(`UPDATE aura_trusted_devices SET last_seen_at = ? WHERE device_id = ?`, new Date().toISOString(), deviceId)
    .catch(() => undefined);

  return {
    trusted: true,
    deviceId: row.device_id,
    biometricBound: Boolean(row.biometric_bound),
    expiresAt: row.expires_at,
  };
}

export async function revokeTrustedFounderDevice(deviceId: string, email: string): Promise<{ ok: boolean }> {
  await ensureAuraTrustTables();
  const db = await getDb();
  await db.run(
    `UPDATE aura_trusted_devices SET revoked_at = ? WHERE device_id = ? AND lower(email) = lower(?)`,
    new Date().toISOString(),
    deviceId,
    email
  );
  await logHqAudit({
    action: "aura_founder_device_revoked",
    entityType: "aura_trusted_device",
    entityId: deviceId,
    detail: "Founder trusted device revoked",
    actorEmail: email,
  });
  return { ok: true };
}

export async function logAuraIdentityAction(opts: {
  identity: AuraTrustedIdentity;
  action: string;
  detail: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  await logHqAudit({
    action: opts.action,
    entityType: opts.entityType || "aura_session",
    entityId: opts.entityId || opts.identity.sessionKey,
    detail: opts.detail,
    actorId: opts.identity.userId || undefined,
    actorEmail: opts.identity.email || undefined,
    ipAddress: opts.ipAddress,
    metadata: {
      role: opts.identity.enterpriseRole,
      legacyRole: opts.identity.legacyRole,
      founderMode: opts.identity.founderMode,
      assurance: opts.identity.assurance,
      channel: opts.identity.channel,
      phone: opts.identity.phoneE164,
      timestamp: new Date().toISOString(),
      ...opts.metadata,
    },
  });
}

export function publicIdentitySummary(identity: AuraTrustedIdentity) {
  return {
    founderMode: identity.founderMode,
    isFounder: identity.isFounder,
    displayName: identity.displayName,
    email: identity.email,
    enterpriseRole: identity.enterpriseRole,
    enterpriseRoleLabel: identity.enterpriseRoleLabel,
    assurance: identity.assurance,
    channel: identity.channel,
    modules: identity.modules,
    verifiedAt: identity.verifiedAt,
    trustedDevice: Boolean(
      identity.assurance === "founder_trusted_device" || identity.trustedDeviceId
    ),
    seamless: identity.assurance === "founder_trusted_device",
  };
}
