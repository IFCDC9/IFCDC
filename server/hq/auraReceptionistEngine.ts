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

CAPABILITIES YOU CAN EXECUTE (signal with action marker at end — caller never sees the marker)
- Answer questions about IFCDC programs, grants, housing, youth, barbershop, radio, software division, donations, and community services using the KNOWLEDGE provided.
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

SMS RULES
- Plain text only. Links okay when useful (ifcdc.org, book-barbershop page).
`.trim();

function buildSystemPrompt(knowledge: string, channel: ReceptionistChannel, session: ReceptionistSession): string {
  const pending = session.pendingBooking;
  const pendingNote = pending
    ? `\nIN-PROGRESS BOOKING: ${JSON.stringify(pending)}\nMissing: ${missingBookingFields(pending).join(", ") || "none — ready to confirm"}`
    : "";

  return `${RECEPTIONIST_PERSONALITY}

CHANNEL: ${channel === "voice" ? "live phone call" : "SMS text message"}
CALLER PHONE: ${session.callerPhone ?? "unknown"}
${pendingNote}

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

  if (userMessage.trim()) {
    session = await appendSessionTurn(session, "user", userMessage.trim());
  }

  const knowledge = await retrieveReceptionistKnowledge(userMessage || "IFCDC services overview");
  const systemPrompt = buildSystemPrompt(knowledge, channel, session);
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

  const updated = await appendSessionTurn(afterAction, "assistant", finalReply);

  return {
    reply: finalReply,
    action: action.type,
    transferTo,
    session: updated,
    bookingConfirmed,
  };
}

export function getVoiceGreeting(session: ReceptionistSession, calledNumber: string): string {
  if (session.greeted || session.turns.length > 0) {
    return "I'm still here — what else can I help you with?";
  }
  if (calledNumber.includes("3313168167") || calledNumber.endsWith("13313168167")) {
    return "Thank you for calling Imperial Foundation Community Development Center. This is AURA — how may I help you today?";
  }
  return "Thank you for calling IFCDC. This is AURA — how may I assist you?";
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
