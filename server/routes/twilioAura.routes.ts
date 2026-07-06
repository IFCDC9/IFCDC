/**
 * Twilio AURA voice + SMS — incoming webhooks for +1 (331) 316-8167 and legacy /twiml aliases.
 */
import type { Express, Request, Response } from "express";
import express from "express";
import twilio from "twilio";
import { cryptoRandomId } from "../monolith/constants";
import { auraExecutiveChat, HQ_AURA_PROMPT } from "../lib/ifcdc";
import {
  IFCDC_HQ_PHONE_E164,
  logTwilioCommunicationEvent,
  normalizeE164,
} from "../hq/twilioIntegrationEngine";

const VoiceResponse = twilio.twiml.VoiceResponse;
const MessagingResponse = twilio.twiml.MessagingResponse;
const twilioForm = express.urlencoded({ extended: false });

const MAX_VOICE_TURNS = 6;
const BARBERSHOP_FORWARD = "+17327435048";
const RADIO_NUMBER = "+18587588791";

const AURA_PHONE_CONTEXT = `${HQ_AURA_PROMPT}

You are answering a live phone call or SMS to IFCDC Headquarters at +1 (331) 316-8167.
Respond naturally and concisely — 1 to 3 short sentences per turn (optimized for text-to-speech).
Help with appointments, barbershop bookings, grants, programs, donations, and general IFCDC questions.
If the caller asks for a human, barber, or representative, acknowledge and offer transfer or callback.
Do not use markdown, bullet points, or URLs in voice responses.`;

function truncateForSpeech(text: string, max = 480): string {
  const plain = text
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastPeriod = cut.lastIndexOf(".");
  return lastPeriod > max * 0.5 ? cut.slice(0, lastPeriod + 1) : `${cut}…`;
}

function truncateForSms(text: string, max = 1500): string {
  const plain = text.replace(/\s+/g, " ").trim();
  return plain.length <= max ? plain : `${plain.slice(0, max - 1)}…`;
}

function wantsHumanTransfer(speech: string): boolean {
  const s = speech.toLowerCase();
  return (
    /\b(human|person|representative|agent|barber|barbershop|operator|real person)\b/.test(s) ||
    /\b(transfer|connect me|speak to someone)\b/.test(s)
  );
}

function respondXml(res: Response, twiml: string): void {
  res.type("text/xml").set("Cache-Control", "no-store").send(twiml);
}

function buildGatherUrl(turn: number, callSid?: string): string {
  const base = (process.env.PUBLIC_BASE_URL || process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
  const qs = new URLSearchParams({ turn: String(turn) });
  if (callSid) qs.set("CallSid", callSid);
  return `${base}/api/twilio/aura/voice/respond?${qs.toString()}`;
}

async function auraPhoneReply(userMessage: string, from?: string): Promise<string> {
  const context = `${AURA_PHONE_CONTEXT}\nCaller phone: ${from ?? "unknown"}`;
  try {
    const reply = await auraExecutiveChat(userMessage, context);
    return reply;
  } catch (err) {
    console.error("AURA phone reply error:", err);
    return "I'm having a brief technical issue. Please try again in a moment, or say transfer to reach our team.";
  }
}

function handleRadioVoicemail(_req: Request, res: Response): void {
  const twiml = new VoiceResponse();
  twiml.say({ voice: "Polly.Joanna" }, "Thank you for calling IFCDC Radio. Please leave your shoutout after the tone.");
  twiml.record({ maxLength: 60, action: "/twiml/voicemail-complete", playBeep: true });
  respondXml(res, twiml.toString());
}

function handleVoicemailComplete(_req: Request, res: Response): void {
  const twiml = new VoiceResponse();
  twiml.say({ voice: "Polly.Joanna" }, "Thank you for your message. Goodbye!");
  twiml.hangup();
  respondXml(res, twiml.toString());
}

async function handleIncomingVoice(req: Request, res: Response): Promise<void> {
  const calledNumber = normalizeE164(req.body.To);
  const from = normalizeE164(req.body.From);
  const callSid = req.body.CallSid as string | undefined;

  if (calledNumber === RADIO_NUMBER) {
    return handleRadioVoicemail(req, res);
  }

  const twiml = new VoiceResponse();
  const greeting =
    calledNumber === IFCDC_HQ_PHONE_E164
      ? "Hello, and thank you for calling Imperial Foundation Community Development Center. I'm AURA, your IFCDC assistant. How can I help you today?"
      : "Thank you for calling Imperial Foundation Community Development Center. I'm AURA. How may I assist you?";

  void logTwilioCommunicationEvent({
    id: cryptoRandomId(),
    direction: "inbound",
    channel: "voice",
    fromNumber: from,
    toNumber: calledNumber,
    callSid,
    status: "ringing",
    body: "incoming_call",
  });

  twiml.say({ voice: "Polly.Joanna", language: "en-US" }, greeting);
  twiml.gather({
    input: ["speech"],
    speechTimeout: "auto",
    action: buildGatherUrl(1, callSid),
    method: "POST",
    language: "en-US",
    hints: "appointment, barbershop, grant, hours, transfer, human, booking",
  });
  twiml.say({ voice: "Polly.Joanna" }, "I didn't hear anything. Goodbye.");
  respondXml(res, twiml.toString());
}

async function handleVoiceRespond(req: Request, res: Response): Promise<void> {
  const speech = (req.body.SpeechResult || req.body.UnstableSpeechResult || "").trim();
  const from = normalizeE164(req.body.From);
  const calledNumber = normalizeE164(req.body.To);
  const callSid = (req.body.CallSid || req.query.CallSid) as string | undefined;
  const turn = Math.min(parseInt(String(req.query.turn || "1"), 10) || 1, MAX_VOICE_TURNS);

  const twiml = new VoiceResponse();

  if (!speech) {
    twiml.say({ voice: "Polly.Joanna" }, "I'm sorry, I didn't catch that. Please tell me how I can help.");
    if (turn < MAX_VOICE_TURNS) {
      twiml.gather({
        input: ["speech"],
        speechTimeout: "auto",
        action: buildGatherUrl(turn + 1, callSid),
        method: "POST",
        language: "en-US",
      });
    } else {
      twiml.say({ voice: "Polly.Joanna" }, "Thank you for calling IFCDC. Goodbye.");
      twiml.hangup();
    }
    return respondXml(res, twiml.toString());
  }

  if (wantsHumanTransfer(speech)) {
    void logTwilioCommunicationEvent({
      id: cryptoRandomId(),
      direction: "inbound",
      channel: "voice",
      fromNumber: from,
      toNumber: calledNumber,
      callSid,
      status: "transfer",
      body: speech,
      auraResponse: "Transferring to team",
    });
    twiml.say({ voice: "Polly.Joanna" }, "One moment while I connect you with our team.");
    twiml.dial({ timeout: 30 }, BARBERSHOP_FORWARD);
    twiml.say({ voice: "Polly.Joanna" }, "We couldn't reach someone right now. Please call back or visit ifcdc.org. Goodbye.");
    return respondXml(res, twiml.toString());
  }

  const auraReply = await auraPhoneReply(speech, from ?? undefined);
  const spoken = truncateForSpeech(auraReply);

  void logTwilioCommunicationEvent({
    id: cryptoRandomId(),
    direction: "inbound",
    channel: "voice",
    fromNumber: from,
    toNumber: calledNumber,
    callSid,
    status: "answered",
    body: speech,
    auraResponse: spoken,
    metadata: { turn },
  });

  twiml.say({ voice: "Polly.Joanna", language: "en-US" }, spoken);

  if (turn < MAX_VOICE_TURNS) {
    twiml.gather({
      input: ["speech"],
      speechTimeout: "auto",
      action: buildGatherUrl(turn + 1, callSid),
      method: "POST",
      language: "en-US",
      hints: "appointment, barbershop, grant, hours, transfer, human, booking, goodbye",
    });
    twiml.say({ voice: "Polly.Joanna" }, "Thank you for calling IFCDC. Goodbye.");
  } else {
    twiml.say({ voice: "Polly.Joanna" }, "Thank you for calling IFCDC. Goodbye.");
    twiml.hangup();
  }

  respondXml(res, twiml.toString());
}

async function handleVoiceStatus(req: Request, res: Response): Promise<void> {
  const callStatus = req.body.CallStatus as string | undefined;
  const from = normalizeE164(req.body.From);
  const to = normalizeE164(req.body.To);
  const callSid = req.body.CallSid as string | undefined;

  void logTwilioCommunicationEvent({
    id: cryptoRandomId(),
    direction: "inbound",
    channel: "voice",
    fromNumber: from,
    toNumber: to,
    callSid,
    status: callStatus ?? "unknown",
    body: "status_callback",
    metadata: { duration: req.body.CallDuration },
  });

  respondXml(res, "<Response></Response>");
}

async function handleIncomingSms(req: Request, res: Response): Promise<void> {
  const calledNumber = normalizeE164(req.body.To);
  const from = normalizeE164(req.body.From);
  const body = (req.body.Body || "").trim();
  const messageSid = req.body.MessageSid as string | undefined;
  const twiml = new MessagingResponse();

  if (calledNumber === RADIO_NUMBER) {
    twiml.message("IFCDC Radio: Thanks for your shoutout or song request. We received your text.");
    return respondXml(res, twiml.toString());
  }

  if (!body) {
    twiml.message("IFCDC: Send us your question and AURA will reply shortly.");
    return respondXml(res, twiml.toString());
  }

  const bookMatch = /^book$/i.test(body);
  if (bookMatch) {
    twiml.message(
      "IFCDC Barbers: Book online at ifcdc-hq-wst6.onrender.com/book-barbershop.html or call (331) 316-8167."
    );
    void logTwilioCommunicationEvent({
      id: cryptoRandomId(),
      direction: "inbound",
      channel: "sms",
      fromNumber: from,
      toNumber: calledNumber,
      messageSid,
      status: "replied",
      body,
      auraResponse: "BOOK auto-reply",
    });
    return respondXml(res, twiml.toString());
  }

  const auraReply = truncateForSms(await auraPhoneReply(body, from ?? undefined));
  twiml.message(auraReply);

  void logTwilioCommunicationEvent({
    id: cryptoRandomId(),
    direction: "inbound",
    channel: "sms",
    fromNumber: from,
    toNumber: calledNumber,
    messageSid,
    status: "replied",
    body,
    auraResponse: auraReply,
  });

  respondXml(res, twiml.toString());
}

async function handleSmsStatus(req: Request, res: Response): Promise<void> {
  void logTwilioCommunicationEvent({
    id: cryptoRandomId(),
    direction: "outbound",
    channel: "sms",
    fromNumber: normalizeE164(req.body.From),
    toNumber: normalizeE164(req.body.To),
    messageSid: req.body.MessageSid,
    status: req.body.MessageStatus ?? req.body.SmsStatus ?? "unknown",
    body: "sms_status",
  });
  res.status(200).send("");
}

export function registerTwilioAuraRoutes(app: Express): void {
  app.post("/api/twilio/aura/voice", twilioForm, (req, res) => {
    void handleIncomingVoice(req, res).catch((err) => {
      console.error("Twilio AURA voice error:", err);
      const twiml = new VoiceResponse();
      twiml.say({ voice: "Polly.Joanna" }, "We're experiencing technical difficulties. Please try again later.");
      respondXml(res, twiml.toString());
    });
  });

  app.post("/api/twilio/aura/voice/respond", twilioForm, (req, res) => {
    void handleVoiceRespond(req, res).catch((err) => {
      console.error("Twilio AURA voice respond error:", err);
      const twiml = new VoiceResponse();
      twiml.say({ voice: "Polly.Joanna" }, "Sorry, something went wrong. Goodbye.");
      respondXml(res, twiml.toString());
    });
  });

  app.post("/api/twilio/aura/voice/status", twilioForm, (req, res) => {
    void handleVoiceStatus(req, res);
  });

  app.post("/api/twilio/aura/sms", twilioForm, (req, res) => {
    void handleIncomingSms(req, res).catch((err) => {
      console.error("Twilio AURA SMS error:", err);
      const twiml = new MessagingResponse();
      twiml.message("IFCDC: We received your message. A team member will follow up.");
      respondXml(res, twiml.toString());
    });
  });

  app.post("/api/twilio/aura/sms/status", twilioForm, (req, res) => {
    void handleSmsStatus(req, res);
  });

  // Legacy Twilio Console URLs (backward compatible)
  app.post("/twiml/voice", twilioForm, (req, res) => {
    void handleIncomingVoice(req, res);
  });
  app.post("/twiml/sms", twilioForm, (req, res) => {
    void handleIncomingSms(req, res);
  });
  app.post("/twiml/voicemail-complete", twilioForm, handleVoicemailComplete);
}
