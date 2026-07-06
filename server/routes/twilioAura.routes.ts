/**
 * Twilio AURA voice + SMS — executive receptionist for +1 (331) 316-8167.
 */
import type { Express, Request, Response } from "express";
import express from "express";
import twilio from "twilio";
import { cryptoRandomId } from "../monolith/constants";
import {
  getVoiceGreeting,
  initializeReceptionistGreeting,
  processReceptionistTurn,
} from "../hq/auraReceptionistEngine";
import { getReceptionistSession } from "../hq/auraReceptionistSession";
import {
  IFCDC_HQ_PHONE_E164,
  logTwilioCommunicationEvent,
  normalizeE164,
} from "../hq/twilioIntegrationEngine";

const VoiceResponse = twilio.twiml.VoiceResponse;
const MessagingResponse = twilio.twiml.MessagingResponse;
const twilioForm = express.urlencoded({ extended: false });

const MAX_VOICE_TURNS = 12;
const RADIO_NUMBER = "+18587588791";
const VOICE = "Polly.Joanna" as const;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateForSpeech(text: string, max = 520): string {
  const plain = text
    .replace(/[*_#`[\]]/g, "")
    .replace(/\[ACTION:[^\]]+\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastPeriod = cut.lastIndexOf(".");
  return lastPeriod > max * 0.45 ? cut.slice(0, lastPeriod + 1) : `${cut}.`;
}

function truncateForSms(text: string, max = 1500): string {
  return text
    .replace(/\[ACTION:[^\]]+\]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function respondXml(res: Response, twiml: string): void {
  res.type("text/xml").set("Cache-Control", "no-store").send(twiml);
}

function publicBaseUrl(): string {
  return (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || "")
    .replace(/\/$/, "");
}

function buildGatherUrl(turn: number, callSid?: string): string {
  const base = publicBaseUrl();
  const qs = new URLSearchParams({ turn: String(turn) });
  if (callSid) qs.set("CallSid", callSid);
  return `${base}/api/twilio/aura/voice/respond?${qs.toString()}`;
}

function sayNatural(twiml: InstanceType<typeof VoiceResponse>, text: string): void {
  const spoken = truncateForSpeech(text);
  twiml.say(
    {
      voice: VOICE,
      language: "en-US",
    },
    `<speak><prosody rate="95%" volume="medium"><break time="200ms"/>${escapeXml(spoken)}</prosody></speak>`
  );
}

function appendGather(twiml: InstanceType<typeof VoiceResponse>, turn: number, callSid?: string): void {
  twiml.gather({
    input: ["speech"],
    speechTimeout: "auto",
    speechModel: "phone_call",
    enhanced: true,
    action: buildGatherUrl(turn, callSid),
    method: "POST",
    language: "en-US",
    bargeIn: true,
  });
}

function sessionKey(callSid?: string, from?: string | null): string {
  return callSid || `sms-${from || "unknown"}`;
}

function handleRadioVoicemail(_req: Request, res: Response): void {
  const twiml = new VoiceResponse();
  twiml.say({ voice: VOICE }, "Thank you for calling IFCDC Radio. Please leave your shoutout after the tone.");
  twiml.record({ maxLength: 60, action: "/twiml/voicemail-complete", playBeep: true });
  respondXml(res, twiml.toString());
}

function handleVoicemailComplete(_req: Request, res: Response): void {
  const twiml = new VoiceResponse();
  twiml.say({ voice: VOICE }, "Thank you for your message. Goodbye!");
  twiml.hangup();
  respondXml(res, twiml.toString());
}

async function handleIncomingVoice(req: Request, res: Response): Promise<void> {
  const calledNumber = normalizeE164(req.body.To) || "";
  const from = normalizeE164(req.body.From);
  const callSid = req.body.CallSid as string | undefined;

  if (calledNumber === RADIO_NUMBER) {
    return handleRadioVoicemail(req, res);
  }

  const sid = sessionKey(callSid, from);
  const session = await getReceptionistSession(sid, "voice", from);
  const greeting = getVoiceGreeting(session, calledNumber || IFCDC_HQ_PHONE_E164);

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

  await initializeReceptionistGreeting(sid, "voice", from);

  const twiml = new VoiceResponse();
  sayNatural(twiml, greeting);
  appendGather(twiml, 1, callSid);
  twiml.say({ voice: VOICE }, "I didn't hear anything. Goodbye.");
  respondXml(res, twiml.toString());
}

async function handleVoiceRespond(req: Request, res: Response): Promise<void> {
  const speech = (req.body.SpeechResult || req.body.UnstableSpeechResult || "").trim();
  const from = normalizeE164(req.body.From);
  const calledNumber = normalizeE164(req.body.To);
  const callSid = (req.body.CallSid || req.query.CallSid) as string | undefined;
  const turn = Math.min(parseInt(String(req.query.turn || "1"), 10) || 1, MAX_VOICE_TURNS);
  const sid = sessionKey(callSid, from);

  const twiml = new VoiceResponse();

  if (!speech) {
    sayNatural(twiml, "I didn't catch that — go ahead, I'm listening.");
    if (turn < MAX_VOICE_TURNS) appendGather(twiml, turn + 1, callSid);
    else {
      twiml.say({ voice: VOICE }, "Thank you for calling IFCDC. Goodbye.");
      twiml.hangup();
    }
    return respondXml(res, twiml.toString());
  }

  const result = await processReceptionistTurn({
    sessionId: sid,
    userMessage: speech,
    channel: "voice",
    callerPhone: from,
  });

  void logTwilioCommunicationEvent({
    id: cryptoRandomId(),
    direction: "inbound",
    channel: "voice",
    fromNumber: from,
    toNumber: calledNumber,
    callSid,
    status: result.transferTo ? "transfer" : "answered",
    body: speech,
    auraResponse: result.reply,
    metadata: { turn, action: result.action, bookingConfirmed: result.bookingConfirmed },
  });

  if (result.transferTo) {
    sayNatural(twiml, "One moment — connecting you now.");
    twiml.dial({ timeout: 30 }, result.transferTo);
    twiml.say({ voice: VOICE }, "We couldn't reach someone right now. I'll make sure our team calls you back. Goodbye.");
    return respondXml(res, twiml.toString());
  }

  sayNatural(twiml, result.reply);

  if (turn < MAX_VOICE_TURNS) {
    appendGather(twiml, turn + 1, callSid);
    twiml.say({ voice: VOICE }, "Thank you for calling IFCDC. Goodbye.");
  } else {
    twiml.say({ voice: VOICE }, "Thank you for calling IFCDC. Goodbye.");
    twiml.hangup();
  }

  respondXml(res, twiml.toString());
}

async function handleVoiceStatus(req: Request, res: Response): Promise<void> {
  void logTwilioCommunicationEvent({
    id: cryptoRandomId(),
    direction: "inbound",
    channel: "voice",
    fromNumber: normalizeE164(req.body.From),
    toNumber: normalizeE164(req.body.To),
    callSid: req.body.CallSid,
    status: req.body.CallStatus ?? "unknown",
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
  const sid = sessionKey(undefined, from);

  if (calledNumber === RADIO_NUMBER) {
    twiml.message("IFCDC Radio: Thanks for your shoutout or song request. We received your text.");
    return respondXml(res, twiml.toString());
  }

  if (!body) {
    twiml.message("IFCDC: Send your question and AURA will reply. Text BOOK to schedule a barbershop appointment.");
    return respondXml(res, twiml.toString());
  }

  const result = await processReceptionistTurn({
    sessionId: sid,
    userMessage: body,
    channel: "sms",
    callerPhone: from,
  });

  twiml.message(truncateForSms(result.reply));

  void logTwilioCommunicationEvent({
    id: cryptoRandomId(),
    direction: "inbound",
    channel: "sms",
    fromNumber: from,
    toNumber: calledNumber,
    messageSid,
    status: "replied",
    body,
    auraResponse: result.reply,
    metadata: { action: result.action, bookingConfirmed: result.bookingConfirmed },
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
      twiml.say({ voice: VOICE }, "We're experiencing technical difficulties. Please try again later.");
      respondXml(res, twiml.toString());
    });
  });

  app.post("/api/twilio/aura/voice/respond", twilioForm, (req, res) => {
    void handleVoiceRespond(req, res).catch((err) => {
      console.error("Twilio AURA voice respond error:", err);
      const twiml = new VoiceResponse();
      twiml.say({ voice: VOICE }, "Sorry, something went wrong. Goodbye.");
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

  app.post("/twiml/voice", twilioForm, (req, res) => {
    void handleIncomingVoice(req, res);
  });
  app.post("/twiml/sms", twilioForm, (req, res) => {
    void handleIncomingSms(req, res);
  });
  app.post("/twiml/voicemail-complete", twilioForm, handleVoicemailComplete);
}
