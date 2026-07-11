/**
 * Twilio AURA voice + SMS — executive receptionist for +1 (331) 316-8167.
 *
 * Voice session rule: never block the Twilio webhook on long HQ/AI work.
 * Acknowledge quickly, process in background, keep the caller engaged via wait-loop,
 * or offer email/SMS delivery if the task cannot finish during the call.
 */
import type { Express, Request, Response } from "express";
import express from "express";
import twilio from "twilio";
import { cryptoRandomId } from "../monolith/constants";
import {
  initializeReceptionistGreeting,
  processReceptionistTurn,
  resolveVoiceGreeting,
  type ReceptionistTurnResult,
} from "../hq/auraReceptionistEngine";
import { getReceptionistSession } from "../hq/auraReceptionistSession";
import {
  IFCDC_HQ_PHONE_E164,
  logTwilioCommunicationEvent,
  normalizeE164,
} from "../hq/twilioIntegrationEngine";
import {
  VOICE_ACK_BUDGET_MS,
  ackPhrase,
  bumpAuraVoiceJobPoll,
  createAuraVoiceJob,
  getAuraVoiceJob,
  markAuraVoiceJobDone,
  markAuraVoiceJobError,
  markDeferredOfferSent,
  progressPhrase,
  raceVoiceTurn,
  shouldDeferAuraVoiceJob,
} from "../hq/auraVoiceJobQueue";

const VoiceResponse = twilio.twiml.VoiceResponse;
const MessagingResponse = twilio.twiml.MessagingResponse;
const twilioForm = express.urlencoded({ extended: false });

/** Raised so 5–10 minute Founder sessions are not cut off by turn caps. */
const MAX_VOICE_TURNS = 48;
const RADIO_NUMBER = "+18587588791";
const VOICE = "Polly.Joanna" as const;

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

function sayNatural(twiml: InstanceType<typeof VoiceResponse>, text: string): void {
  twiml.say({ voice: VOICE, language: "en-US" }, truncateForSpeech(text));
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

function buildGatherUrl(turn: number, callSid?: string, founderVerify = false): string {
  const base = publicBaseUrl();
  const qs = new URLSearchParams({ turn: String(turn) });
  if (callSid) qs.set("CallSid", callSid);
  if (founderVerify) qs.set("founderVerify", "1");
  return `${base}/api/twilio/aura/voice/respond?${qs.toString()}`;
}

function buildFounderDeliverUrl(callSid?: string): string {
  const base = publicBaseUrl();
  const qs = new URLSearchParams();
  if (callSid) qs.set("CallSid", callSid);
  return `${base}/api/twilio/aura/voice/founder-deliver?${qs.toString()}`;
}

function buildWaitUrl(jobId: string, turn: number, callSid?: string, founderVerify = false): string {
  const base = publicBaseUrl();
  const qs = new URLSearchParams({ jobId, turn: String(turn) });
  if (callSid) qs.set("CallSid", callSid);
  if (founderVerify) qs.set("founderVerify", "1");
  return `${base}/api/twilio/aura/voice/wait?${qs.toString()}`;
}

function appendGather(twiml: InstanceType<typeof VoiceResponse>, turn: number, callSid?: string, founderVerify = false): void {
  twiml.gather({
    input: ["speech"],
    speechTimeout: founderVerify ? "5" : "auto",
    timeout: founderVerify ? 30 : 8,
    speechModel: "phone_call",
    enhanced: true,
    action: buildGatherUrl(turn, callSid, founderVerify),
    method: "POST",
    language: "en-US",
    bargeIn: true,
  });
}

function appendContinueListening(
  twiml: InstanceType<typeof VoiceResponse>,
  turn: number,
  callSid?: string,
  keepVerifying = false
): void {
  if (turn < MAX_VOICE_TURNS) {
    appendGather(twiml, turn + 1, callSid, keepVerifying);
    if (!keepVerifying) {
      // Played only if gather times out (silence) — keep session open longer for Founder work.
      twiml.say({ voice: VOICE }, "I'm still here if you need anything else. Or say goodbye when you're done.");
      appendGather(twiml, turn + 2, callSid, false);
      twiml.say({ voice: VOICE }, "Thank you for calling IFCDC. Goodbye.");
    } else {
      twiml.say({ voice: VOICE }, "I'm still here when you're ready with your code.");
    }
  } else if (keepVerifying) {
    twiml.say({
      voice: VOICE,
    }, "Your verification code remains valid for the rest of the ten minute window if you call back. Goodbye for now.");
  } else {
    twiml.say({ voice: VOICE }, "Thank you for calling IFCDC. Goodbye.");
    twiml.hangup();
  }
}

function sessionKey(callSid?: string, from?: string | null): string {
  const phone = normalizeE164(from || "");
  if (phone) return `voice-${phone}`;
  return callSid || `sms-${from || "unknown"}`;
}

function startBackgroundTurn(jobId: string, work: Promise<ReceptionistTurnResult>): void {
  void work
    .then((result) => {
      markAuraVoiceJobDone(jobId, result);
    })
    .catch((err) => {
      console.error("AURA voice background turn failed:", err);
      markAuraVoiceJobError(jobId, err instanceof Error ? err.message : "Processing failed");
    });
}

async function offerDeferredDelivery(jobId: string): Promise<string> {
  const job = getAuraVoiceJob(jobId);
  if (!job) {
    return "I wasn't able to finish that during this call. I can email or text the report when it's ready if you'd like.";
  }
  if (job.deferredOfferSent) {
    return "I'm still preparing that report. I'll send it by email or text when it's ready. What else can I help with while we wait, or you can end the call whenever you like.";
  }

  markDeferredOfferSent(jobId);

  // Continue work in background; when done, try SMS/email follow-up.
  const finishAndNotify = async () => {
    const latest = getAuraVoiceJob(jobId);
    if (!latest) return;
    // Wait up to 3 more minutes for completion
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const j = getAuraVoiceJob(jobId);
      if (!j) return;
      if (j.status === "done" && j.result) {
        try {
          const { deliverFounderCallFollowUp } = await import("../hq/auraFounderCallReport");
          const session = await getReceptionistSession(j.sessionId, "voice", j.callerPhone);
          await deliverFounderCallFollowUp({
            session,
            channel: "voice",
            summary: [
              `Deferred voice report for: ${j.speech.slice(0, 240)}`,
              j.result.reply.slice(0, 1200),
            ].join("\n\n"),
            prefer: ["hq", "email", "sms"],
            smsTo: j.callerPhone || session.callerPhone,
          });
        } catch (err) {
          console.error("Deferred voice follow-up delivery failed:", err);
        }
        return;
      }
      if (j.status === "error") return;
      await new Promise((r) => setTimeout(r, 2000));
    }
  };
  void finishAndNotify();

  return "This is taking longer than expected. I'll keep preparing it and send the completed report by email and text when it's ready. You can stay on the line for something else, or end the call whenever you like.";
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
  const { greeting, founderMode, identityAssurance, founderVerifyRedirect, awaitingFounderCode } =
    await resolveVoiceGreeting(session, calledNumber || IFCDC_HQ_PHONE_E164, from);

  void logTwilioCommunicationEvent({
    id: cryptoRandomId(),
    direction: "inbound",
    channel: "voice",
    fromNumber: from,
    toNumber: calledNumber,
    callSid,
    status: "ringing",
    body: "incoming_call",
    metadata: { founderMode, identityAssurance },
  });

  await initializeReceptionistGreeting(sid, "voice", from);

  const twiml = new VoiceResponse();
  if (founderVerifyRedirect) {
    sayNatural(twiml, greeting);
    twiml.redirect({ method: "POST" }, buildFounderDeliverUrl(callSid));
    return respondXml(res, twiml.toString());
  }
  sayNatural(twiml, greeting);
  appendGather(twiml, 1, callSid, awaitingFounderCode);
  if (!awaitingFounderCode) {
    twiml.say({ voice: VOICE }, "I didn't hear anything. I'm still here if you'd like to try again.");
    appendGather(twiml, 2, callSid, false);
    twiml.say({ voice: VOICE }, "Thank you for calling IFCDC. Goodbye.");
  } else {
    twiml.say({ voice: VOICE }, "I'm still here whenever you're ready with your six digit code.");
  }
  respondXml(res, twiml.toString());
}

async function handleFounderDeliver(req: Request, res: Response): Promise<void> {
  const from = normalizeE164(req.body.From);
  const callSid = (req.body.CallSid || req.query.CallSid) as string | undefined;
  const sid = sessionKey(callSid, from);
  const twiml = new VoiceResponse();

  const { startFounderPhoneChallenge } = await import("../hq/auraFounderTrustEngine");
  const challenge = await startFounderPhoneChallenge({
    sessionKey: sid,
    phoneE164: from || "",
    channel: "voice",
    skipIfPending: true,
  });

  sayNatural(twiml, challenge.message);
  if (challenge.ok && (challenge.awaitingCode || challenge.emailSent || challenge.smsSent)) {
    appendGather(twiml, 1, callSid, true);
    twiml.say({ voice: VOICE }, "Take your time. I'm waiting for your six digit code. You can also say resend code or try another method.");
  } else {
    appendGather(twiml, 1, callSid, true);
    twiml.say({
      voice: VOICE,
    }, "Delivery was not confirmed. Say resend code, try text message, or try email, and I'll try again.");
  }
  respondXml(res, twiml.toString());
}

function speakTurnResult(
  twiml: InstanceType<typeof VoiceResponse>,
  result: ReceptionistTurnResult,
  turn: number,
  callSid: string | undefined,
  founderVerify: boolean
): void {
  if (result.transferTo) {
    sayNatural(twiml, "One moment — connecting you now.");
    twiml.dial({ timeout: 30 }, result.transferTo);
    twiml.say({ voice: VOICE }, "We couldn't reach someone right now. I'll make sure our team calls you back. You can stay on the line or hang up.");
    appendContinueListening(twiml, turn, callSid, false);
    return;
  }

  sayNatural(twiml, result.reply);
  const keepVerifying = founderVerify || Boolean(result.awaitingFounderCode);
  appendContinueListening(twiml, turn, callSid, keepVerifying);
}

async function handleVoiceRespond(req: Request, res: Response): Promise<void> {
  const speech = (req.body.SpeechResult || req.body.UnstableSpeechResult || "").trim();
  const from = normalizeE164(req.body.From);
  const calledNumber = normalizeE164(req.body.To);
  const callSid = (req.body.CallSid || req.query.CallSid) as string | undefined;
  const turn = Math.min(parseInt(String(req.query.turn || "1"), 10) || 1, MAX_VOICE_TURNS);
  const founderVerify = req.query.founderVerify === "1";
  const sid = sessionKey(callSid, from);

  const twiml = new VoiceResponse();

  if (!speech) {
    if (founderVerify) {
      sayNatural(twiml, "I'm still waiting for your six digit Founder verification code. Say the code when you have it, or say resend code.");
      if (turn < MAX_VOICE_TURNS) appendGather(twiml, turn + 1, callSid, true);
      else twiml.say({ voice: VOICE }, "Your verification window is still open if you call back within ten minutes. Goodbye for now.");
      return respondXml(res, twiml.toString());
    }
    sayNatural(twiml, "I didn't catch that — go ahead, I'm listening.");
    appendContinueListening(twiml, turn, callSid, false);
    return respondXml(res, twiml.toString());
  }

  // Soft goodbye intents — end cleanly without hanging up abruptly mid-session.
  if (/^(goodbye|good bye|bye|hang up|end (the )?call|that's all|that is all)\b/i.test(speech)) {
    sayNatural(twiml, "Thank you for calling IFCDC. Goodbye.");
    twiml.hangup();
    return respondXml(res, twiml.toString());
  }

  const work = processReceptionistTurn({
    sessionId: sid,
    userMessage: speech,
    channel: "voice",
    callerPhone: from,
  });

  const raced = await raceVoiceTurn(work, VOICE_ACK_BUDGET_MS);

  if (!raced.timedOut) {
    const result = raced.value;
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
      metadata: { turn, action: result.action, bookingConfirmed: result.bookingConfirmed, mode: "sync" },
    });
    speakTurnResult(twiml, result, turn, callSid, founderVerify);
    return respondXml(res, twiml.toString());
  }

  // Long-running path — acknowledge immediately and keep the webhook under Twilio's timeout.
  const job = createAuraVoiceJob({
    sessionId: sid,
    callSid,
    callerPhone: from,
    speech,
  });
  startBackgroundTurn(job.id, raced.pending);

  void logTwilioCommunicationEvent({
    id: cryptoRandomId(),
    direction: "inbound",
    channel: "voice",
    fromNumber: from,
    toNumber: calledNumber,
    callSid,
    status: "processing",
    body: speech,
    metadata: { turn, jobId: job.id, mode: "async_ack" },
  });

  sayNatural(twiml, ackPhrase(speech));
  twiml.pause({ length: 1 });
  twiml.redirect({ method: "POST" }, buildWaitUrl(job.id, turn, callSid, founderVerify));
  respondXml(res, twiml.toString());
}

async function handleVoiceWait(req: Request, res: Response): Promise<void> {
  const jobId = String(req.query.jobId || req.body.jobId || "").trim();
  const from = normalizeE164(req.body.From);
  const callSid = (req.body.CallSid || req.query.CallSid) as string | undefined;
  const turn = Math.min(parseInt(String(req.query.turn || "1"), 10) || 1, MAX_VOICE_TURNS);
  const founderVerify = req.query.founderVerify === "1";
  const twiml = new VoiceResponse();

  const job = getAuraVoiceJob(jobId);
  if (!job) {
    sayNatural(
      twiml,
      "I lost track of that lookup. I can try again, or I can email and text the report when it's ready. What would you like to do?"
    );
    appendContinueListening(twiml, turn, callSid, founderVerify);
    return respondXml(res, twiml.toString());
  }

  if (job.status === "done" && job.result) {
    void logTwilioCommunicationEvent({
      id: cryptoRandomId(),
      direction: "inbound",
      channel: "voice",
      fromNumber: from || job.callerPhone,
      toNumber: normalizeE164(req.body.To),
      callSid: callSid || job.callSid || undefined,
      status: job.result.transferTo ? "transfer" : "answered",
      body: job.speech,
      auraResponse: job.result.reply,
      metadata: { turn, jobId, mode: "async_complete", polls: job.polls },
    });
    speakTurnResult(twiml, job.result, turn, callSid || job.callSid || undefined, founderVerify);
    return respondXml(res, twiml.toString());
  }

  if (job.status === "error") {
    sayNatural(
      twiml,
      "I ran into a problem gathering that information. I can email or text you the report when Headquarters is available again. Would you like me to keep working on something else?"
    );
    appendContinueListening(twiml, turn, callSid || job.callSid || undefined, founderVerify);
    return respondXml(res, twiml.toString());
  }

  const polls = bumpAuraVoiceJobPoll(jobId);
  if (shouldDeferAuraVoiceJob(job) || polls >= 24) {
    const deferMsg = await offerDeferredDelivery(jobId);
    sayNatural(twiml, deferMsg);
    appendContinueListening(twiml, turn, callSid || job.callSid || undefined, founderVerify);
    return respondXml(res, twiml.toString());
  }

  // Keep the live session warm — brief progress, short pause, redirect (valid TwiML within timeout).
  sayNatural(twiml, progressPhrase(polls));
  twiml.pause({ length: 2 });
  twiml.redirect(
    { method: "POST" },
    buildWaitUrl(jobId, turn, callSid || job.callSid || undefined, founderVerify)
  );
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
    metadata: {
      duration: req.body.CallDuration,
      sipResponseCode: req.body.SipResponseCode,
      errorCode: req.body.ErrorCode,
      errorMessage: req.body.ErrorMessage,
    },
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
      twiml.say({ voice: VOICE }, "We're experiencing a brief technical issue. Please stay on the line or call back in a moment.");
      appendGather(twiml, 1, req.body.CallSid as string | undefined, false);
      twiml.say({ voice: VOICE }, "Thank you for calling IFCDC. Goodbye.");
      respondXml(res, twiml.toString());
    });
  });

  app.post("/api/twilio/aura/voice/founder-deliver", twilioForm, (req, res) => {
    void handleFounderDeliver(req, res).catch((err) => {
      console.error("Twilio AURA founder-deliver error:", err);
      const twiml = new VoiceResponse();
      twiml.say({ voice: VOICE }, "Sorry, I could not send the verification code right now. Please stay on the line and say resend code, or try again shortly.");
      appendGather(twiml, 1, (req.body.CallSid || req.query.CallSid) as string | undefined, true);
      respondXml(res, twiml.toString());
    });
  });

  app.post("/api/twilio/aura/voice/respond", twilioForm, (req, res) => {
    void handleVoiceRespond(req, res).catch((err) => {
      console.error("Twilio AURA voice respond error:", err);
      const twiml = new VoiceResponse();
      twiml.say({
        voice: VOICE,
      }, "Sorry, something went wrong on my side. I can email or text a report when it's ready. Would you like to try another question?");
      appendGather(twiml, 1, (req.body.CallSid || req.query.CallSid) as string | undefined, false);
      twiml.say({ voice: VOICE }, "Thank you for calling IFCDC. Goodbye.");
      respondXml(res, twiml.toString());
    });
  });

  app.post("/api/twilio/aura/voice/wait", twilioForm, (req, res) => {
    void handleVoiceWait(req, res).catch((err) => {
      console.error("Twilio AURA voice wait error:", err);
      const twiml = new VoiceResponse();
      twiml.say({
        voice: VOICE,
      }, "I hit a snag while holding that request. I can send the completed report by email or text. What else can I help with?");
      appendGather(twiml, 1, (req.body.CallSid || req.query.CallSid) as string | undefined, false);
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
