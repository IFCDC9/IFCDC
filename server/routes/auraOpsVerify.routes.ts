/**
 * Narrow AURA ops routes for Phase 6 SMS statusCallback production acceptance.
 *
 * Auth: Founder JWT session OR AURA_OPS_VERIFY_TOKEN (see auraOpsVerifyAuth).
 * Founder phone OTP mint: existing trust engine — no Founder password.
 *
 * Does not expose public SMS send. Destination allowlisted to Founder trusted phones.
 */
import { Router } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/auth";
import { auraOpsVerifyAuth } from "../middleware/auraOpsVerifyAuth";
import { requireHQModule } from "../middleware/hqAuth";
import {
  getFounderEmail,
  getLoadedFounderCandidatePhones,
  isFounderCandidatePhone,
  resolveIdentityFromHqUser,
  startFounderPhoneChallenge,
  verifyFounderPhoneChallenge,
} from "../hq/auraFounderTrustEngine";
import { normalizeE164 } from "../hq/twilioIntegrationEngine";
import { getDb } from "../db";
import { getMonolithDb } from "../monolith/dbAccess";

const router = Router();

const PHASE6_SESSION_PREFIX = "phase6-ops:";
const startRateByIp = new Map<string, { count: number; resetAt: number }>();
const sendRateByActor = new Map<string, { count: number; resetAt: number }>();

function rateLimit(
  map: Map<string, { count: number; resetAt: number }>,
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const cur = map.get(key);
  if (!cur || cur.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (cur.count >= max) return false;
  cur.count += 1;
  return true;
}

function allowlistedDestination(to: string): boolean {
  const normalized = normalizeE164(to);
  if (!normalized) return false;
  const allowed = new Set(getLoadedFounderCandidatePhones());
  // Explicit Phase 6 acceptance destination
  allowed.add("+18484694448");
  return allowed.has(normalized);
}

async function mintFounderJwt(opts: {
  userId: string | null;
  email: string;
  name?: string | null;
}): Promise<string> {
  let userId = opts.userId;
  let name = opts.name || "Founder";
  if (!userId) {
    try {
      const db = getMonolithDb();
      const row = await db.get<{ id: string; name?: string }>(
        "SELECT id, name FROM users WHERE lower(email) = lower(?) LIMIT 1",
        opts.email,
      );
      if (row) {
        userId = row.id;
        name = row.name || name;
      }
    } catch {
      /* ignore */
    }
  }
  return jwt.sign(
    {
      id: userId || "founder-ops",
      email: opts.email,
      role: "owner",
      name,
      mfaVerified: true,
      purpose: "aura_ops_phase6",
    },
    JWT_SECRET,
    { expiresIn: "2h" },
  );
}

/**
 * Start Founder phone OTP for Phase 6 verification auth (no password).
 * Only trusted Founder candidate phones may request a code.
 */
router.post("/founder-session/start", async (req, res) => {
  try {
    const ip = req.ip || "unknown";
    if (!rateLimit(startRateByIp, ip, 3, 15 * 60_000)) {
      return res.status(429).json({ error: "Too many OTP start attempts. Try again later." });
    }

    const phone = normalizeE164(String(req.body?.phone || req.body?.phoneE164 || ""));
    if (!phone) {
      return res.status(400).json({ error: "Valid E.164 phone required" });
    }
    if (!(await isFounderCandidatePhone(phone))) {
      return res.status(403).json({
        error: "Phone is not a registered Founder candidate line",
        code: "founder_phone_not_trusted",
      });
    }

    const sessionKey = `${PHASE6_SESSION_PREFIX}${phone}`;
    const result = await startFounderPhoneChallenge({
      sessionKey,
      phoneE164: phone,
      channel: "sms",
      channelPreference: "sms",
    });

    return res.json({
      ok: Boolean(result.ok),
      awaitingCode: Boolean(result.awaitingCode || result.ok),
      smsSent: Boolean(result.smsSent),
      emailSent: Boolean(result.emailSent),
      message: result.message,
      sessionKey,
      authHint:
        "Complete with POST /api/hq/aura/ops/founder-session/complete { phone, code } to receive a Founder JWT. No password used.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OTP start failed";
    console.error("Phase6 founder-session start error:", message);
    return res.status(500).json({ error: message });
  }
});

/**
 * Complete Founder phone OTP → short-lived Founder HQ JWT (no password).
 */
router.post("/founder-session/complete", async (req, res) => {
  try {
    const phone = normalizeE164(String(req.body?.phone || req.body?.phoneE164 || ""));
    const code = String(req.body?.code || req.body?.otp || "").replace(/\D/g, "");
    if (!phone || code.length < 4) {
      return res.status(400).json({ error: "phone and code are required" });
    }
    if (!(await isFounderCandidatePhone(phone))) {
      return res.status(403).json({ error: "Phone is not a registered Founder candidate line" });
    }

    const sessionKey = String(req.body?.sessionKey || `${PHASE6_SESSION_PREFIX}${phone}`);
    const verified = await verifyFounderPhoneChallenge({
      sessionKey,
      phoneE164: phone,
      code,
      channel: "sms",
    });

    if (!verified.ok || !verified.identity) {
      return res.status(401).json({
        error: verified.message || "Invalid or expired Founder verification code",
        code: "founder_otp_invalid",
      });
    }

    const email = verified.identity.email || getFounderEmail();
    const token = await mintFounderJwt({
      userId: verified.identity.userId,
      email,
      name: verified.identity.displayName,
    });

    res.cookie("ifcdc_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 2 * 60 * 60 * 1000,
    });

    return res.json({
      ok: true,
      token,
      role: "owner",
      email,
      expiresIn: "2h",
      message: "Founder session minted via phone OTP for Phase 6 verification. Password was not used.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OTP complete failed";
    console.error("Phase6 founder-session complete error:", message);
    return res.status(500).json({ error: message });
  }
});

/**
 * Protected Phase 6 live SMS send through AURA action layer → sendFounderSecuritySms.
 */
router.post("/phase6-sms-verify", auraOpsVerifyAuth, requireHQModule("aura"), async (req, res) => {
  try {
    const actorKey = req.hqUser?.email || req.ip || "actor";
    if (!rateLimit(sendRateByActor, actorKey, 3, 10 * 60_000)) {
      return res.status(429).json({ error: "Phase 6 SMS verify rate limit exceeded" });
    }

    const identity = resolveIdentityFromHqUser({
      user: req.hqUser,
      channel: "hq_web",
      sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
    });
    if (!identity.founderMode && !identity.isFounder) {
      return res.status(403).json({ error: "Phase 6 SMS verify requires Founder authorization" });
    }

    const toRaw = String(req.body?.to || req.body?.phone || "+18484694448").trim();
    const to = normalizeE164(toRaw) || toRaw;
    if (!allowlistedDestination(to)) {
      return res.status(403).json({
        error: "Destination not allowlisted for Phase 6 verification",
        code: "destination_not_allowlisted",
      });
    }

    const tag = String(req.body?.tag || `P6-${Date.now().toString(36)}`);
    const message =
      String(req.body?.message || "").trim()
      || `IFCDC AURA Phase 6 verification ${tag}. Confirm delivery + statusCallback. Do not reply.`;

    const { runAuraAction } = await import("../hq/auraCommandLayer");
    const result = await runAuraAction(
      "send_sms",
      { to, message },
      {
        actorEmail: identity.email || req.hqUser?.email || getFounderEmail(),
        module: "communications",
        contextRef: { phase: "phase6_sms_statuscallback_verify", tag },
        identity,
      },
    );

    const executed = Array.isArray(result.actions) ? result.actions[0] : null;
    const data = (executed?.data || {}) as Record<string, unknown>;
    const messageId = typeof data.messageId === "string" ? data.messageId : null;

    return res.status(executed?.status === "done" && messageId ? 200 : 502).json({
      ok: executed?.status === "done" && Boolean(messageId),
      authorized: true,
      authMethod: (req as { auraOpsTokenAuth?: boolean }).auraOpsTokenAuth ? "ops_token" : "founder_jwt",
      tag,
      to,
      actionStatus: executed?.status || "error",
      summary: executed?.summary || result.reply || "",
      messageId,
      providerAccepted: data.providerAccepted ?? null,
      providerStatus: data.providerStatus || data.status || null,
      statusCallbackRoute: "/api/twilio/aura/sms/status",
      twilioConfigUntouched: true,
      phase7Started: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Phase 6 SMS verify failed";
    console.error("Phase6 SMS verify error:", message);
    return res.status(500).json({ error: message });
  }
});

/**
 * Read Phase 6 delivery evidence: Twilio callback rows, operational events, live Twilio status.
 */
router.get("/phase6-sms-status", auraOpsVerifyAuth, requireHQModule("aura"), async (req, res) => {
  try {
    const identity = resolveIdentityFromHqUser({
      user: req.hqUser,
      channel: "hq_web",
      sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
    });
    if (!identity.founderMode && !identity.isFounder) {
      return res.status(403).json({ error: "Founder access required" });
    }

    const sid = String(req.query.sid || "").trim();
    if (!sid) return res.status(400).json({ error: "sid query param required" });

    const db = await getDb();
    const communicationEvents = await db
      .all<{
        id: string;
        status: string | null;
        message_sid: string | null;
        to_number: string | null;
        body: string | null;
        created_at: string;
      }>(
        `SELECT id, status, message_sid, to_number, body, created_at
         FROM twilio_communication_events
         WHERE message_sid = ?
         ORDER BY created_at DESC
         LIMIT 40`,
        sid,
      )
      .catch(() => []);

    const operationalEvents = await db
      .all<{
        id: string;
        event_type: string;
        title: string;
        detail: string | null;
        entity_id: string | null;
        severity: string | null;
        created_at: string;
        metadata_json: string | null;
      }>(
        `SELECT id, event_type, title, detail, entity_id, severity, created_at, metadata_json
         FROM aura_operational_events
         WHERE entity_id = ?
            OR detail LIKE ?
            OR title LIKE ?
         ORDER BY created_at DESC
         LIMIT 40`,
        sid,
        `%${sid}%`,
        `%${sid}%`,
      )
      .catch(() => []);

    let twilioMessage: Record<string, unknown> | null = null;
    let twilioError: string | null = null;
    try {
      const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
      const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
      if (accountSid && authToken) {
        const twilio = await import("twilio");
        const client = twilio.default(accountSid, authToken);
        const msg = await client.messages(sid).fetch();
        twilioMessage = {
          sid: msg.sid,
          status: msg.status,
          to: msg.to,
          from: msg.from,
          errorCode: msg.errorCode,
          errorMessage: msg.errorMessage,
          dateUpdated: msg.dateUpdated,
        };
      } else {
        twilioError = "Twilio credentials not available in process env";
      }
    } catch (err) {
      twilioError = err instanceof Error ? err.message : "Twilio fetch failed";
    }

    const statuses = communicationEvents.map((e) => e.status).filter(Boolean);
    const statusCallbackReceived = communicationEvents.some((e) => e.body === "sms_status" || Boolean(e.status));

    return res.json({
      ok: true,
      authorized: true,
      messageSid: sid,
      statusCallbackReceived,
      communicationEventCount: communicationEvents.length,
      communicationStatuses: statuses,
      communicationEvents,
      operationalEventCount: operationalEvents.length,
      operationalEvents,
      twilioMessage,
      twilioError,
      brainTab9: {
        diagnosticsRoute: "/api/hq/aura/diagnostics/e2e",
        operationalEventsRoute: "/api/hq/aura/diagnostics/operational-events",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Phase 6 status read failed";
    console.error("Phase6 SMS status error:", message);
    return res.status(500).json({ error: message });
  }
});

/** Auth probe — confirms protected access without sending SMS. */
router.get("/auth-check", auraOpsVerifyAuth, requireHQModule("aura"), async (req, res) => {
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  return res.json({
    ok: true,
    authorized: true,
    authMethod: (req as { auraOpsTokenAuth?: boolean }).auraOpsTokenAuth ? "ops_token" : "founder_jwt",
    founder: Boolean(identity.founderMode || identity.isFounder),
    email: identity.email,
    role: req.hqUser?.role,
  });
});

export default router;
