/**
 * AURA Executive Receptionist — intelligent multi-turn voice/SMS orchestration.
 */
import { auraReceptionistChat } from "../lib/ifcdc";
import { retrieveReceptionistKnowledge } from "./auraReceptionistKnowledge";
import {
  appendSessionTurn,
  getReceptionistSession,
  markSessionGreeted,
  sessionMessagesForLlm,
  updateSessionBooking,
  type ReceptionistSession,
  type SessionChannel,
} from "./auraReceptionistSession";
import {
  bookBarbershopAppointment,
  createReceptionistFollowUp,
  mergeBookingData,
  missingBookingFields,
  parseActionMarker,
  type ParsedReceptionistAction,
  type ReceptionistActionType,
} from "./auraReceptionistActions";

export type ReceptionistChannel = SessionChannel;

export type ReceptionistTurnResult = {
  reply: string;
  action: ReceptionistActionType;
  transferTo: string | null;
  session: ReceptionistSession;
  bookingConfirmed: boolean;
  founderMode?: boolean;
  identityAssurance?: string;
  /** Keep call open — waiting for Founder OTP digits. */
  awaitingFounderCode?: boolean;
};

const RECEPTIONIST_PERSONALITY = `
You are AURA — the executive AI receptionist for IFCDC Headquarters (Imperial Foundation Community Development Corporation).

PERSONALITY
- Confident, warm, and professional — like a senior executive assistant who knows the organization deeply.
- Speak naturally with human pacing. Vary your phrasing; never sound scripted or robotic.
- Never say "I'm just an AI", "As an AI", or "I don't have access". You represent IFCDC directly.
- Be concise: 1–3 sentences for voice, slightly longer for SMS when helpful.
- Ask one smart follow-up question when information is missing — don't interrogate.
- Remember what was already discussed in this conversation; don't repeat greetings or re-ask known facts.

IDENTITY & TRUST (CRITICAL)
- Never assume every caller is the Founder. The official HQ line (+1 331-316-8167) is shared and must stay secure.
- Never grant Founder privileges based on phone number alone.
- If IDENTITY says Founder Mode is active (OTP already completed for this session), address Fahreal Allah as Founder, unlock confidential domains, and do not ask for another code.
- If IDENTITY shows a recognized Founder candidate phone but Founder Mode is NOT active, greet them warmly and invite them to say "verify founder" so a one-time code can be emailed to service@ifcdc.org.
- If Founder Mode is NOT active and someone claims to be the Founder, ask them to say "verify founder".
- For non-founder callers, enforce role-based access: public programs, appointments, and general IFCDC info only. Never disclose grants internals, financials, HR, payroll, operations internals, budgets, board documents, Software Division internals, or executive reports.

CAPABILITIES YOU CAN EXECUTE (signal with action marker at end — caller never sees the marker)
- Answer questions about IFCDC programs, grants (public overview only unless Founder Mode), housing, youth, barbershop, radio, software division, donations, and community services using the KNOWLEDGE provided.
- Collect barbershop booking details across multiple turns (name, date, time, service). When you have ALL required fields, confirm and use [ACTION:book:{"firstName":"...","lastName":"...","date":"YYYY-MM-DD","time":"HH:MM","service":"haircut","phone":"..."}]
- Transfer to barbershop team when caller insists on a person for grooming: [ACTION:transfer_barbershop]
- Create executive callback when caller needs founder/executive/grants specialist and can't wait: [ACTION:create_followup] or [ACTION:followup:brief reason]
- Transfer to executive line for urgent executive matters: [ACTION:transfer_executive]

ACTION MARKERS (append exactly one on its own line at the very end — invisible to caller)
[ACTION:none] — default, no system action
[ACTION:transfer_barbershop] — connect to barbershop team
[ACTION:transfer_executive] — connect to executive team
[ACTION:create_followup] — log callback task for HQ staff
[ACTION:followup:reason text] — log specific callback reason
[ACTION:book:{"firstName":"Jane","lastName":"Doe","date":"2026-07-15","time":"14:00","service":"haircut","phone":"+13305551234"}]

BOOKING FLOW
- If caller wants an appointment, gather missing details conversationally.
- Services: haircut, beard trim, haircut and beard, lineup, kids cut, full shave.
- Use caller's phone number if they don't provide another.
- Only emit [ACTION:book:...] when firstName, lastName, date, time, and phone are all confirmed.

VOICE RULES
- No markdown, bullets, URLs, or special characters.
- Don't read phone numbers digit-by-digit unless confirming.
- Offer transfer only when appropriate — try to help first.
- If the user message starts with [SECURE_VOICE_COMMAND:...], treat it as a Founder Mode headquarters command (grant search, grant drafting, executive reports, system health, funding pipeline, approval review, communications, workflow creation, Mission Control). Answer using available HQ knowledge and keep the spoken reply concise.
- HIGH-IMPACT gate: never claim you submitted a grant, approved payment, deployed production, deleted records, or changed security unless IDENTITY shows Founder Mode AND the caller has explicitly confirmed. Ordinary Founder email/SMS/calls may execute when the system runs those tools.

SMS RULES
- Plain text only. Links okay when useful (ifcdc.org, book-barbershop page).
`.trim();

function buildSystemPrompt(
  knowledge: string,
  channel: ReceptionistChannel,
  session: ReceptionistSession,
  identityBlock: string
): string {
  const pending = session.pendingBooking;
  const pendingNote = pending
    ? `\nIN-PROGRESS BOOKING: ${JSON.stringify(pending)}\nMissing: ${missingBookingFields(pending).join(", ") || "none — ready to confirm"}`
    : "";

  return `${RECEPTIONIST_PERSONALITY}

CHANNEL: ${channel === "voice" ? "live phone call" : "SMS text message"}
CALLER PHONE: ${session.callerPhone ?? "unknown"}
${pendingNote}

${identityBlock}

═══ IFCDC KNOWLEDGE (use this — do not guess) ═══
${knowledge}
═══ END KNOWLEDGE ═══`;
}

async function executeAction(
  action: ParsedReceptionistAction,
  session: ReceptionistSession,
  channel: ReceptionistChannel
): Promise<{ replySuffix: string; transferTo: string | null; bookingConfirmed: boolean; session: ReceptionistSession }> {
  let transferTo: string | null = null;
  let replySuffix = "";
  let bookingConfirmed = false;
  let updatedSession = session;

  if (action.type === "book_barbershop") {
    const merged = mergeBookingData(session.pendingBooking, action.data, session.callerPhone);
    updatedSession = await updateSessionBooking(session, merged);
    if (missingBookingFields(merged).length === 0) {
      const result = await bookBarbershopAppointment(merged);
      if (result.ok) {
        bookingConfirmed = true;
        replySuffix = result.message;
        updatedSession = await updateSessionBooking(updatedSession, null);
      } else {
        replySuffix = result.message;
      }
    }
  }

  if (action.type === "transfer_barbershop") {
    transferTo = "+17327435048";
  }

  if (action.type === "transfer_executive") {
    transferTo = "+17327435048";
    await createReceptionistFollowUp(session.callerPhone, "Executive transfer requested", channel);
  }

  if (action.type === "create_followup") {
    const reason = action.data?.reason || "Caller requested callback via AURA";
    await createReceptionistFollowUp(session.callerPhone, reason, channel);
    if (!replySuffix) replySuffix = "I've logged this for our team — someone will follow up with you shortly.";
  }

  return { replySuffix, transferTo, bookingConfirmed, session: updatedSession };
}

export async function processReceptionistTurn(opts: {
  sessionId: string;
  userMessage: string;
  channel: ReceptionistChannel;
  callerPhone?: string | null;
}): Promise<ReceptionistTurnResult> {
  const { sessionId, userMessage, channel, callerPhone } = opts;
  let session = await getReceptionistSession(sessionId, channel, callerPhone);

  const {
    resolvePhoneCallerIdentity,
    startFounderPhoneChallenge,
    verifyFounderPhoneChallenge,
    resendFounderOtp,
    tryAlternateFounderDelivery,
    getActiveFounderChallenge,
    wantsFounderVerification,
    wantsResendFounderCode,
    wantsAlternateFounderDelivery,
    extractOtpFromMessage,
    buildAuraIdentitySystemBlock,
    redactConfidentialForIdentity,
    logAuraIdentityAction,
  } = await import("./auraFounderTrustEngine");

  let identity = await resolvePhoneCallerIdentity({
    sessionKey: sessionId,
    channel,
    callerPhone: callerPhone ?? session.callerPhone,
  });

  const message = userMessage.trim();
  const pendingChallenge = !identity.founderMode
    ? await getActiveFounderChallenge(sessionId, callerPhone ?? session.callerPhone)
    : null;

  if (message) {
    session = await appendSessionTurn(session, "user", message);

    if (!identity.founderMode && wantsResendFounderCode(message)) {
      const resent = await resendFounderOtp({
        sessionKey: sessionId,
        phoneE164: callerPhone || session.callerPhone || "",
        channel,
      });
      const updated = await appendSessionTurn(session, "assistant", resent.message);
      return {
        reply: resent.message,
        action: "none",
        transferTo: null,
        session: updated,
        bookingConfirmed: false,
        founderMode: false,
        identityAssurance: identity.assurance,
        awaitingFounderCode: resent.ok,
      };
    }

    if (!identity.founderMode && wantsAlternateFounderDelivery(message)) {
      const alt = await tryAlternateFounderDelivery({
        sessionKey: sessionId,
        phoneE164: callerPhone || session.callerPhone || "",
        channel,
      });
      const updated = await appendSessionTurn(session, "assistant", alt.message);
      return {
        reply: alt.message,
        action: "none",
        transferTo: null,
        session: updated,
        bookingConfirmed: false,
        founderMode: false,
        identityAssurance: identity.assurance,
        awaitingFounderCode: alt.ok,
      };
    }

    if (!identity.founderMode) {
      const otp = extractOtpFromMessage(message);
      if (otp || pendingChallenge) {
        if (otp) {
          const verified = await verifyFounderPhoneChallenge({
            sessionKey: sessionId,
            code: otp,
            channel,
            phoneE164: callerPhone ?? session.callerPhone,
          });
          const updated = await appendSessionTurn(session, "assistant", verified.message);
          if (verified.ok && verified.identity) {
            identity = verified.identity;
            return {
              reply: verified.message,
              action: "none",
              transferTo: null,
              session: updated,
              bookingConfirmed: false,
              founderMode: true,
              identityAssurance: identity.assurance,
            };
          }
          return {
            reply: verified.message,
            action: "none",
            transferTo: null,
            session: updated,
            bookingConfirmed: false,
            founderMode: false,
            identityAssurance: identity.assurance,
            awaitingFounderCode: Boolean(pendingChallenge),
          };
        }
      }
    }

    // Founder verification: candidate phone recognized, but OTP to service@ifcdc.org is always required.
    if (!identity.founderMode && wantsFounderVerification(message)) {
      const challenge = await startFounderPhoneChallenge({
        sessionKey: sessionId,
        phoneE164: callerPhone || session.callerPhone || "",
        channel,
        skipIfPending: true,
      });
      if (challenge.ok && challenge.identity) {
        identity = challenge.identity;
        const updated = await appendSessionTurn(session, "assistant", challenge.message);
        await logAuraIdentityAction({
          identity,
          action: "aura_phone_founder_session_reuse",
          detail: challenge.message.slice(0, 240),
          metadata: { seamless: true },
        });
        return {
          reply: challenge.message,
          action: "none",
          transferTo: null,
          session: updated,
          bookingConfirmed: false,
          founderMode: true,
          identityAssurance: identity.assurance,
        };
      }
      const updated = await appendSessionTurn(session, "assistant", challenge.message);
      await logAuraIdentityAction({
        identity,
        action: "aura_phone_founder_challenge",
        detail: challenge.message.slice(0, 240),
        metadata: { smsSent: challenge.smsSent, emailSent: challenge.emailSent },
      });
      return {
        reply: challenge.message,
        action: "none",
        transferTo: null,
        session: updated,
        bookingConfirmed: false,
        founderMode: false,
        identityAssurance: identity.assurance,
        awaitingFounderCode: challenge.ok && (challenge.awaitingCode || challenge.emailSent || challenge.smsSent),
      };
    }

    if (!identity.founderMode && pendingChallenge) {
      const reminder =
        "I'm still waiting for your 6-digit Founder verification code. Please say or text the code from your email or text message. You can also say resend code or try another method.";
      const updated = await appendSessionTurn(session, "assistant", reminder);
      return {
        reply: reminder,
        action: "none",
        transferTo: null,
        session: updated,
        bookingConfirmed: false,
        founderMode: false,
        identityAssurance: identity.assurance,
        awaitingFounderCode: true,
      };
    }
  }

  // Founder Technical Command Mode — live ops briefing / repair tickets (no LLM guesswork).
  if (identity.founderMode && message) {
    // Executive Operations — real email/SMS/call/calendar/docs (not explanations).
    const { tryRunExecutiveCommand } = await import("./auraExecutiveOperations");
    const exec = await tryRunExecutiveCommand(message, {
      actorEmail: identity.email || "service@ifcdc.org",
      identity,
      module: "communications",
    });
    if (exec.handled) {
      await logAuraIdentityAction({
        identity,
        action: `aura_exec_${exec.op}`,
        detail: exec.result.summary.slice(0, 240),
        metadata: { status: exec.result.status, channel },
      });
      const updated = await appendSessionTurn(session, "assistant", exec.result.summary);
      return {
        reply: exec.result.summary,
        action: "none",
        transferTo: null,
        session: updated,
        bookingConfirmed: false,
        founderMode: true,
        identityAssurance: identity.assurance,
      };
    }

    const { wantsTechnicalCommand, handleTechnicalCommand } = await import("./auraTechnicalCommandEngine");
    if (wantsTechnicalCommand(message)) {
      const tech = await handleTechnicalCommand({
        command: message,
        channel,
        actorEmail: identity.email || null,
        founderMode: true,
      });
      await logAuraIdentityAction({
        identity,
        action: "aura_technical_command",
        detail: tech.reply.slice(0, 240),
        metadata: { action: tech.action, ticketId: tech.ticketId, blocked: tech.blocked },
      });
      const updated = await appendSessionTurn(session, "assistant", tech.reply);
      return {
        reply: tech.reply,
        action: "none",
        transferTo: null,
        session: updated,
        bookingConfirmed: false,
        founderMode: true,
        identityAssurance: identity.assurance,
      };
    }

    const { wantsEnterpriseBrain, runEnterpriseBrain } = await import("./auraEnterpriseBrain");
    const { wantsMultiAgentOrchestration } = await import("./auraExecutiveAgentOrchestrator");
    if (wantsEnterpriseBrain(message) || wantsMultiAgentOrchestration(message)) {
      const brain = await runEnterpriseBrain({
        request: message,
        channel,
        actorEmail: identity.email || null,
        founderMode: true,
      });
      const reply = channel === "sms" ? brain.smsSummary : brain.speechSummary;
      await logAuraIdentityAction({
        identity,
        action: "aura_enterprise_brain",
        detail: reply.slice(0, 240),
        metadata: {
          intent: brain.intent,
          orchestrationId: brain.orchestrationId,
          agentsDelegated: brain.agentsDelegated,
        },
      });
      const updated = await appendSessionTurn(session, "assistant", reply);
      return {
        reply,
        action: "none",
        transferTo: null,
        session: updated,
        bookingConfirmed: false,
        founderMode: true,
        identityAssurance: identity.assurance,
      };
    }

    const { wantsCallFollowUp, deliverFounderCallFollowUp } = await import("./auraFounderCallReport");
    if (wantsCallFollowUp(message)) {
      const follow = await deliverFounderCallFollowUp({
        session,
        channel,
        summary: "Founder requested a detailed follow-up report from this AURA session.",
        prefer: /\bsms|text\b/i.test(message)
          ? ["hq", "email", "sms"]
          : /\bemail\b/i.test(message)
            ? ["hq", "email"]
            : ["hq", "email"],
        smsTo: callerPhone || session.callerPhone,
      });
      const updated = await appendSessionTurn(session, "assistant", follow.message);
      return {
        reply: follow.message,
        action: "none",
        transferTo: null,
        session: updated,
        bookingConfirmed: false,
        founderMode: true,
        identityAssurance: identity.assurance,
      };
    }

    const { wantsDecisionSupport, answerDecisionSupportQuestion } = await import("./auraDecisionSupport");
    if (wantsDecisionSupport(message)) {
      const decision = await answerDecisionSupportQuestion(message);
      const reply = channel === "sms" ? decision.smsSummary : decision.speechSummary;
      await logAuraIdentityAction({
        identity,
        action: "aura_decision_support",
        detail: reply.slice(0, 240),
        metadata: { founderApprovalRequired: decision.founderApprovalRequired, gaps: decision.gaps.length },
      });
      const updated = await appendSessionTurn(session, "assistant", reply);
      return {
        reply,
        action: "none",
        transferTo: null,
        session: updated,
        bookingConfirmed: false,
        founderMode: true,
        identityAssurance: identity.assurance,
      };
    }

    if (/\b(mission|vision|organizational memory|what do we know|knowledge base|our programs|our budget)\b/i.test(message)) {
      const { retrieveOrganizationalMemory } = await import("./auraOrganizationalMemory");
      const memory = await retrieveOrganizationalMemory(message, { topK: 6 });
      const reply = channel === "sms" ? memory.smsSummary : memory.speechSummary;
      const updated = await appendSessionTurn(session, "assistant", reply);
      return {
        reply,
        action: "none",
        transferTo: null,
        session: updated,
        bookingConfirmed: false,
        founderMode: true,
        identityAssurance: identity.assurance,
      };
    }
  }

  const knowledge = await retrieveReceptionistKnowledge(message || "IFCDC services overview");
  const identityBlock = buildAuraIdentitySystemBlock(identity);
  const systemPrompt = buildSystemPrompt(knowledge, channel, session, identityBlock);
  const history = sessionMessagesForLlm(session);

  const maxTokens = channel === "voice" ? 220 : 400;
  let rawReply: string;
  try {
    rawReply = await auraReceptionistChat(history, systemPrompt, { maxTokens, temperature: 0.72 });
  } catch (err) {
    console.error("AURA receptionist LLM error:", err);
    rawReply =
      channel === "voice"
        ? "I'm having a brief connection issue. Say transfer if you'd like to speak with someone now."
        : "I'm having a brief connection issue. Text CALL or call us at (331) 316-8167.";
  }

  const { speech, action } = parseActionMarker(rawReply);
  const { replySuffix, transferTo, bookingConfirmed, session: afterAction } = await executeAction(
    action,
    session,
    channel
  );

  let finalReply = speech;
  if (replySuffix && !speech.toLowerCase().includes(replySuffix.slice(0, 20).toLowerCase())) {
    finalReply = replySuffix;
  } else if (replySuffix && bookingConfirmed) {
    finalReply = replySuffix;
  }

  if (!finalReply.trim()) {
    finalReply =
      channel === "voice"
        ? "How else can I help you with IFCDC today?"
        : "How can I help you with IFCDC today?";
  }

  finalReply = redactConfidentialForIdentity(identity, finalReply);
  const updated = await appendSessionTurn(afterAction, "assistant", finalReply);
  await logAuraIdentityAction({
    identity,
    action: "aura_phone_turn",
    detail: message.slice(0, 200) || "empty",
    metadata: { receptionistAction: action.type, founderMode: identity.founderMode },
  });

  return {
    reply: finalReply,
    action: action.type,
    transferTo,
    session: updated,
    bookingConfirmed,
    founderMode: identity.founderMode,
    identityAssurance: identity.assurance,
  };
}

export function getVoiceGreeting(
  session: ReceptionistSession,
  calledNumber: string,
  opts?: { founderMode?: boolean; displayName?: string | null; founderCandidate?: boolean }
): string {
  if (session.greeted || session.turns.length > 0) {
    return opts?.founderMode
      ? "I'm still here, Founder — what else can I help you with?"
      : "I'm still here — what else can I help you with?";
  }
  if (opts?.founderMode) {
    const name = opts.displayName || "Fahreal";
    return `Welcome back, ${name}. Founder Mode is active. This is AURA — full Super Admin access is unlocked for this call. How may I assist you?`;
  }
  if (opts?.founderCandidate) {
    return "Welcome. I recognize this as your Founder phone. For security, please say verify founder and I'll email a one-time code to service at I F C D C dot org. How else may I help you today?";
  }
  if (calledNumber.includes("3313168167") || calledNumber.endsWith("13313168167")) {
    return "Thank you for calling Imperial Foundation Community Development Center. This is AURA — how may I help you today?";
  }
  return "Thank you for calling IFCDC. This is AURA — how may I assist you?";
}

export async function resolveVoiceGreeting(
  session: ReceptionistSession,
  calledNumber: string,
  callerPhone?: string | null
): Promise<{
  greeting: string;
  founderMode: boolean;
  identityAssurance?: string;
  founderCandidate?: boolean;
  founderVerifyRedirect?: boolean;
  awaitingFounderCode?: boolean;
}> {
  const {
    resolvePhoneCallerIdentity,
    getPhoneFounderSession,
    getActiveFounderChallenge,
  } = await import("./auraFounderTrustEngine");

  let identity = await resolvePhoneCallerIdentity({
    sessionKey: session.sessionId,
    channel: "voice",
    callerPhone: callerPhone ?? session.callerPhone,
  });

  const pending = await getActiveFounderChallenge(session.sessionId, callerPhone ?? session.callerPhone);
  if (!identity.founderMode && pending) {
    return {
      greeting:
        "Welcome back. You still have an active Founder verification. Please say or text your six digit code when ready. I'll stay on the line for up to ten minutes. You can also say resend code or try another method.",
      founderMode: false,
      identityAssurance: identity.assurance,
      founderCandidate: true,
      awaitingFounderCode: true,
    };
  }

  if (
    !identity.founderMode
    && identity.founderCandidate
    && !(session.greeted || session.turns.length > 0)
    && (callerPhone || session.callerPhone)
  ) {
    const existing = await getPhoneFounderSession(session.sessionId);
    if (!existing?.founderMode) {
      return {
        greeting:
          "Welcome. I recognize this as your Founder phone. One moment while I start secure verification — I will only confirm a channel after the provider accepts the send.",
        founderMode: false,
        identityAssurance: identity.assurance,
        founderCandidate: true,
        founderVerifyRedirect: true,
      };
    }
  }

  return {
    greeting: getVoiceGreeting(session, calledNumber, {
      founderMode: identity.founderMode,
      displayName: identity.displayName,
      founderCandidate: Boolean(identity.founderCandidate),
    }),
    founderMode: identity.founderMode,
    identityAssurance: identity.assurance,
    founderCandidate: Boolean(identity.founderCandidate),
  };
}

export async function initializeReceptionistGreeting(
  sessionId: string,
  channel: SessionChannel,
  callerPhone?: string | null
): Promise<ReceptionistSession> {
  const session = await getReceptionistSession(sessionId, channel, callerPhone);
  await markSessionGreeted(session);
  return session;
}
