/**
 * Twilio AURA voice + SMS — executive receptionist for +1 (331) 316-8167.
 *
 * Voice Reliability:
 * - Fast ack / streaming partials (do not block webhook on long HQ work)
 * - Background jobs with stages + progress
 * - Barge-in during progress updates
 * - Multi-channel deferred delivery (SMS, email, HQ, workspace report)
 * - Reconnect / resume incomplete tasks by phone-stable session
 * - Founder confirmation gate for high-impact actions
 * - Live call monitoring for Communications Center
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
  appendCallTranscript,
  bumpAuraVoiceJobPoll,
  classifyVoiceCommand,
  confirmFounderVoiceAction,
  createAuraVoiceJob,
  deliverVoiceJobResult,
  findResumableVoiceContext,
  getAuraVoiceJob,
  markAuraVoiceJobDone,
  markAuraVoiceJobError,
  markDeferredOfferSent,
  markStreamPartialSpoken,
  progressPhrase,
  raceVoiceTurn,
  shouldDeferAuraVoiceJob,
  upsertLiveCallMonitor,
  wantsConfirmIntent,
  wantsContinueIntent,
  wantsDeliveryIntent,
  type DeliveryChannel,
} from "../hq/auraVoiceJobQueue";

const VoiceResponse = twilio.twiml.VoiceResponse;
const MessagingResponse = twilio.twiml.MessagingResponse;
const twilioForm = express.urlencoded({ extended: false });

/** Raised so 5–10 minute Founder sessions are not cut off by turn caps. */
const MAX_VOICE_TURNS = 48;
const RADIO_NUMBER = "+18587588791";
const VOICE = "Polly.Joanna" as const;

/** Session → pending high-impact job awaiting Founder "confirm". */
const pendingFounderConfirms = new Map<string, string>();

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

function buildGatherUrl(turn: number, callSid?: string, founderVerify = false, interruptJob?: string): string {
  const base = publicBaseUrl();
  const qs = new URLSearchParams({ turn: String(turn) });
  if (callSid) qs.set("CallSid", callSid);
  if (founderVerify) qs.set("founderVerify", "1");
  if (interruptJob) qs.set("interruptJob", interruptJob);
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

function appendGather(
  twiml: InstanceType<typeof VoiceResponse>,
  turn: number,
  callSid?: string,
  founderVerify = false,
  interruptJob?: string
): void {
  twiml.gather({
    input: ["speech"],
    speechTimeout: founderVerify ? "5" : "auto",
    timeout: founderVerify ? 30 : 8,
    speechModel: "phone_call",
    enhanced: true,
    action: buildGatherUrl(turn, callSid, founderVerify, interruptJob),
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
      twiml.say({ voice: VOICE }, "I'm still here if you need anything else. Or say goodbye when you're done.");
      appendGather(twiml, turn + 2, callSid, false);
      twiml.say({ voice: VOICE }, "Thank you for calling IFCDC. Goodbye.");
    } else {
      twiml.say({ voice: VOICE }, "I'm still here when you're ready with your code.");
    }
  } else if (keepVerifying) {
    twiml.say(
      { voice: VOICE },
      "Your verification code remains valid for the rest of the ten minute window if you call back. Goodbye for now."
    );
  } else {
    twiml.say({ voice: VOICE }, "Thank you for calling IFCDC. Goodbye.");
    twiml.hangup();
  }
}

/** Progress update with barge-in so the Founder can redirect mid-speech. */
function appendProgressWithBargeIn(
  twiml: InstanceType<typeof VoiceResponse>,
  jobId: string,
  phrase: string,
  turn: number,
  callSid?: string,
  founderVerify = false
): void {
  const gather = twiml.gather({
    input: ["speech"],
    speechTimeout: "auto",
    timeout: 4,
    speechModel: "phone_call",
    enhanced: true,
    action: buildGatherUrl(turn, callSid, founderVerify, jobId),
    method: "POST",
    language: "en-US",
    bargeIn: true,
  });
  gather.say({ voice: VOICE, language: "en-US" }, truncateForSpeech(phrase, 280));
  twiml.redirect({ method: "POST" }, buildWaitUrl(jobId, turn, callSid, founderVerify));
}

function sessionKey(callSid?: string, from?: string | null): string {
  const phone = normalizeE164(from || "");
  if (phone) return `voice-${phone}`;
  return callSid || `sms-${from || "unknown"}`;
}

function enrichSecureVoiceCommand(speech: string): string {
  const { commandType, highImpact } = classifyVoiceCommand(speech);
  if (commandType === "general" && !highImpact) return speech;
  const gate = highImpact
    ? " HIGH_IMPACT: prepare only; do not execute submit/send/pay/deploy/delete/security changes without explicit Founder confirmation."
    : "";
  return `[SECURE_VOICE_COMMAND:${commandType}]${gate} ${speech}`;
}

function startBackgroundTurn(jobId: string, work: Promise<ReceptionistTurnResult>): void {
  void work
    .then((result) => {
      markAuraVoiceJobDone(jobId, result);
      const job = getAuraVoiceJob(jobId);
      if (job?.founderConfirmRequired && !job.founderConfirmed) {
        pendingFounderConfirms.set(job.sessionId, jobId);
      }
    })
    .catch((err) => {
      console.error("AURA voice background turn failed:", err);
      markAuraVoiceJobError(jobId, err instanceof Error ? err.message : "Processing failed");
    });
}

async function offerDeferredDelivery(jobId: string): Promise<string> {
  const job = getAuraVoiceJob(jobId);
  if (!job) {
    return "I wasn't able to finish that during this call. I can email, text, notify Headquarters, or save a workspace report when it's ready. Which would you prefer?";
  }
  if (job.deferredOfferSent) {
    return "I'm still preparing that report. Say send by text, send by email, HQ notification, or save report — or ask something else while we wait.";
  }

  markDeferredOfferSent(jobId);

  const finishAndNotify = async () => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const j = getAuraVoiceJob(jobId);
      if (!j) return;
      if (j.status === "done" && j.result) {
        try {
          await deliverVoiceJobResult(jobId, ["hq", "email", "sms", "workspace_report"]);
        } catch (err) {
          console.error("Deferred voice multi-channel delivery failed:", err);
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
          } catch (fallbackErr) {
            console.error("Deferred voice follow-up fallback failed:", fallbackErr);
          }
        }
        return;
      }
      if (j.status === "error") return;
      await new Promise((r) => setTimeout(r, 2000));
    }
  };
  void finishAndNotify();

  return "This is taking longer than expected. I'll keep preparing it. I can send the completed result by SMS, email, Headquarters notification, or a saved workspace report. Stay on the line for something else, or end the call whenever you like.";
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

  const resume = await findResumableVoiceContext(from);
  let openLine = greeting;
  if (resume.message && !awaitingFounderCode && !founderVerifyRedirect) {
    openLine = `${greeting} ${resume.message}`;
  }

  upsertLiveCallMonitor({
    callSid,
    sessionId: sid,
    callerPhone: from,
    callerIdentity: founderMode ? "Founder (verified)" : from || "Caller",
    founderMode,
    status: "in_progress",
  });
  appendCallTranscript(callSid || sid, "assistant", openLine);

  void logTwilioCommunicationEvent({
    id: cryptoRandomId(),
    direction: "inbound",
    channel: "voice",
    fromNumber: from,
    toNumber: calledNumber,
    callSid,
    status: "ringing",
    body: "incoming_call",
    metadata: { founderMode, identityAssurance, resumeJobId: resume.job?.id || null },
  });

  await initializeReceptionistGreeting(sid, "voice", from);

  const twiml = new VoiceResponse();
  if (founderVerifyRedirect) {
    sayNatural(twiml, greeting);
    twiml.redirect({ method: "POST" }, buildFounderDeliverUrl(callSid));
    return respondXml(res, twiml.toString());
  }
  sayNatural(twiml, openLine);
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

  upsertLiveCallMonitor({
    callSid,
    sessionId: sid,
    callerPhone: from,
    callerIdentity: "Founder (verifying)",
    founderMode: false,
    status: "in_progress",
  });

  sayNatural(twiml, challenge.message);
  if (challenge.ok && (challenge.awaitingCode || challenge.emailSent || challenge.smsSent)) {
    appendGather(twiml, 1, callSid, true);
    twiml.say(
      { voice: VOICE },
      "Take your time. I'm waiting for your six digit code. You can also say resend code or try another method."
    );
  } else {
    appendGather(twiml, 1, callSid, true);
    twiml.say(
      { voice: VOICE },
      "Delivery was not confirmed. Say resend code, try text message, or try email, and I'll try again."
    );
  }
  respondXml(res, twiml.toString());
}

function speakTurnResult(
  twiml: InstanceType<typeof VoiceResponse>,
  result: ReceptionistTurnResult,
  turn: number,
  callSid: string | undefined,
  founderVerify: boolean,
  opts?: { founderConfirmRequired?: boolean; jobId?: string; sessionId?: string }
): void {
  if (result.transferTo) {
    sayNatural(twiml, "One moment — connecting you now.");
    twiml.dial({ timeout: 30 }, result.transferTo);
    twiml.say(
      { voice: VOICE },
      "We couldn't reach someone right now. I'll make sure our team calls you back. You can stay on the line or hang up."
    );
    appendContinueListening(twiml, turn, callSid, false);
    return;
  }

  let reply = result.reply;
  if (opts?.founderConfirmRequired && opts.jobId && opts.sessionId) {
    pendingFounderConfirms.set(opts.sessionId, opts.jobId);
    reply = `${reply} This is a high-impact action. Say confirm to authorize execution, or cancel to keep it as a draft only.`;
  }

  sayNatural(twiml, reply);
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
  const interruptJob = String(req.query.interruptJob || "").trim() || undefined;
  const sid = sessionKey(callSid, from);

  const twiml = new VoiceResponse();

  upsertLiveCallMonitor({
    callSid,
    sessionId: sid,
    callerPhone: from,
    status: "in_progress",
  });

  if (!speech) {
    if (interruptJob) {
      // Barge-in gather timed out — resume wait loop
      twiml.redirect({ method: "POST" }, buildWaitUrl(interruptJob, turn, callSid, founderVerify));
      return respondXml(res, twiml.toString());
    }
    if (founderVerify) {
      sayNatural(
        twiml,
        "I'm still waiting for your six digit Founder verification code. Say the code when you have it, or say resend code."
      );
      if (turn < MAX_VOICE_TURNS) appendGather(twiml, turn + 1, callSid, true);
      else
        twiml.say(
          { voice: VOICE },
          "Your verification window is still open if you call back within ten minutes. Goodbye for now."
        );
      return respondXml(res, twiml.toString());
    }
    sayNatural(twiml, "I didn't catch that — go ahead, I'm listening.");
    appendContinueListening(twiml, turn, callSid, false);
    return respondXml(res, twiml.toString());
  }

  appendCallTranscript(callSid || sid, "user", speech);

  if (/^(goodbye|good bye|bye|hang up|end (the )?call|that's all|that is all)\b/i.test(speech)) {
    upsertLiveCallMonitor({ callSid, sessionId: sid, status: "completed" });
    sayNatural(twiml, "Thank you for calling IFCDC. Goodbye.");
    twiml.hangup();
    return respondXml(res, twiml.toString());
  }

  // Delivery channel selection for an active / deferred job
  const deliveryChannels = wantsDeliveryIntent(speech);
  if (deliveryChannels) {
    const jobId =
      interruptJob ||
      pendingFounderConfirms.get(sid) ||
      (await findResumableVoiceContext(from)).job?.id;
    if (jobId) {
      const delivery = await deliverVoiceJobResult(jobId, deliveryChannels);
      appendCallTranscript(callSid || sid, "assistant", delivery.message);
      sayNatural(twiml, delivery.message);
      appendContinueListening(twiml, turn, callSid, founderVerify);
      return respondXml(res, twiml.toString());
    }
  }

  // Founder confirmation for high-impact actions
  if (wantsConfirmIntent(speech)) {
    const jobId = pendingFounderConfirms.get(sid) || interruptJob;
    if (jobId) {
      confirmFounderVoiceAction(jobId);
      pendingFounderConfirms.delete(sid);
      const msg =
        "Confirmed. High-impact authorization recorded for this session. I will proceed only on prepared actions that were waiting on your approval.";
      appendCallTranscript(callSid || sid, "assistant", msg);
      sayNatural(twiml, msg);
      const job = getAuraVoiceJob(jobId);
      if (job?.result) {
        speakTurnResult(twiml, job.result, turn, callSid, founderVerify);
      } else {
        appendContinueListening(twiml, turn, callSid, founderVerify);
      }
      return respondXml(res, twiml.toString());
    }
  }

  // Resume unfinished work from a prior disconnect
  if (wantsContinueIntent(speech)) {
    const resume = await findResumableVoiceContext(from);
    if (resume.job?.status === "done" && resume.job.result) {
      speakTurnResult(twiml, resume.job.result, turn, callSid, founderVerify, {
        founderConfirmRequired: resume.job.founderConfirmRequired && !resume.job.founderConfirmed,
        jobId: resume.job.id,
        sessionId: sid,
      });
      return respondXml(res, twiml.toString());
    }
    if (resume.job && (resume.job.status === "running" || resume.job.status === "deferred")) {
      sayNatural(twiml, resume.message || progressPhrase(resume.job));
      twiml.redirect(
        { method: "POST" },
        buildWaitUrl(resume.job.id, turn, callSid, founderVerify)
      );
      return respondXml(res, twiml.toString());
    }
    if (resume.message) {
      sayNatural(twiml, resume.message);
      appendContinueListening(twiml, turn, callSid, founderVerify);
      return respondXml(res, twiml.toString());
    }
  }

  // Barge-in with a new direction — acknowledge interruption; prior job keeps running
  if (interruptJob) {
    sayNatural(twiml, "Understood — redirecting.");
  }

  const classified = classifyVoiceCommand(speech);
  const userMessage = enrichSecureVoiceCommand(speech);

  // High-impact: prepare via job, but gate execution language
  const work = processReceptionistTurn({
    sessionId: sid,
    userMessage,
    channel: "voice",
    callerPhone: from,
  });

  const raced = await raceVoiceTurn(work, VOICE_ACK_BUDGET_MS);

  if (!raced.timedOut) {
    const result = raced.value;
    if (classified.highImpact) {
      const job = createAuraVoiceJob({
        sessionId: sid,
        callSid,
        callerPhone: from,
        speech,
      });
      markAuraVoiceJobDone(job.id, result);
      pendingFounderConfirms.set(sid, job.id);
    }
    appendCallTranscript(callSid || sid, "assistant", result.reply);
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
      metadata: {
        turn,
        action: result.action,
        bookingConfirmed: result.bookingConfirmed,
        mode: "sync",
        commandType: classified.commandType,
        highImpact: classified.highImpact,
      },
    });
    upsertLiveCallMonitor({
      callSid,
      sessionId: sid,
      callerPhone: from,
      status: "in_progress",
    });
    speakTurnResult(twiml, result, turn, callSid, founderVerify, {
      founderConfirmRequired: classified.highImpact,
      jobId: pendingFounderConfirms.get(sid),
      sessionId: sid,
    });
    return respondXml(res, twiml.toString());
  }

  // Long-running path — stream ack immediately, keep webhook under Twilio timeout.
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
    metadata: { turn, jobId: job.id, mode: "async_ack", commandType: job.commandType },
  });

  const streamAck = job.streamPartial || ackPhrase(speech);
  appendCallTranscript(callSid || sid, "assistant", streamAck);
  sayNatural(twiml, streamAck);
  markStreamPartialSpoken(job.id);
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
      "I lost track of that lookup. I can try again, or I can email, text, notify Headquarters, or save a workspace report when it's ready. What would you like to do?"
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
      metadata: {
        turn,
        jobId,
        mode: "async_complete",
        polls: job.polls,
        latencyMs: job.latencyMs,
        commandType: job.commandType,
      },
    });
    appendCallTranscript(callSid || job.sessionId, "assistant", job.result.reply);
    speakTurnResult(twiml, job.result, turn, callSid || job.callSid || undefined, founderVerify, {
      founderConfirmRequired: job.founderConfirmRequired && !job.founderConfirmed,
      jobId: job.id,
      sessionId: job.sessionId,
    });
    markStreamPartialSpoken(job.id);
    return respondXml(res, twiml.toString());
  }

  if (job.status === "error") {
    const errMsg =
      "I ran into a problem gathering that information. I can email, text, notify Headquarters, or save a workspace report when Headquarters is available again. Would you like me to keep working on something else?";
    appendCallTranscript(callSid || job.sessionId, "assistant", errMsg);
    sayNatural(twiml, errMsg);
    appendContinueListening(twiml, turn, callSid || job.callSid || undefined, founderVerify);
    return respondXml(res, twiml.toString());
  }

  const polls = bumpAuraVoiceJobPoll(jobId);
  if (shouldDeferAuraVoiceJob(job) || polls >= 24) {
    const deferMsg = await offerDeferredDelivery(jobId);
    appendCallTranscript(callSid || job.sessionId, "assistant", deferMsg);
    sayNatural(twiml, deferMsg);
    appendContinueListening(twiml, turn, callSid || job.callSid || undefined, founderVerify);
    return respondXml(res, twiml.toString());
  }

  // Streaming partial: speak new stage info once, then barge-in progress loop
  let phrase = progressPhrase(job);
  if (job.streamPartial && !job.streamPartialSpoken && job.status === "running") {
    phrase = `${truncateForSpeech(job.streamPartial, 200)} ${progressPhrase(job)}`;
    markStreamPartialSpoken(job.id);
  }

  appendProgressWithBargeIn(
    twiml,
    jobId,
    phrase,
    turn,
    callSid || job.callSid || undefined,
    founderVerify
  );
  respondXml(res, twiml.toString());
}

async function handleVoiceStatus(req: Request, res: Response): Promise<void> {
  const callSid = req.body.CallSid as string | undefined;
  const from = normalizeE164(req.body.From);
  const status = String(req.body.CallStatus || "unknown");
  const sid = sessionKey(callSid, from);

  if (callSid || from) {
    const mapped =
      status === "completed" || status === "busy" || status === "no-answer" || status === "canceled"
        ? "completed"
        : status === "failed"
          ? "failed"
          : "in_progress";
    upsertLiveCallMonitor({
      callSid,
      sessionId: sid,
      callerPhone: from,
      status: mapped,
    });
  }

  void logTwilioCommunicationEvent({
    id: cryptoRandomId(),
    direction: "inbound",
    channel: "voice",
    fromNumber: from,
    toNumber: normalizeE164(req.body.To),
    callSid,
    status,
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

  // SMS delivery preference for a deferred voice job
  const channels = wantsDeliveryIntent(body);
  if (channels) {
    const resume = await findResumableVoiceContext(from);
    if (resume.job?.id) {
      const delivery = await deliverVoiceJobResult(resume.job.id, channels as DeliveryChannel[]);
      twiml.message(truncateForSms(delivery.message));
      return respondXml(res, twiml.toString());
    }
  }

  const result = await processReceptionistTurn({
    sessionId: sid,
    userMessage: enrichSecureVoiceCommand(body),
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
      twiml.say(
        { voice: VOICE },
        "We're experiencing a brief technical issue. Please stay on the line or call back in a moment."
      );
      appendGather(twiml, 1, req.body.CallSid as string | undefined, false);
      twiml.say({ voice: VOICE }, "Thank you for calling IFCDC. Goodbye.");
      respondXml(res, twiml.toString());
    });
  });

  app.post("/api/twilio/aura/voice/founder-deliver", twilioForm, (req, res) => {
    void handleFounderDeliver(req, res).catch((err) => {
      console.error("Twilio AURA founder-deliver error:", err);
      const twiml = new VoiceResponse();
      twiml.say(
        { voice: VOICE },
        "Sorry, I could not send the verification code right now. Please stay on the line and say resend code, or try again shortly."
      );
      appendGather(twiml, 1, (req.body.CallSid || req.query.CallSid) as string | undefined, true);
      respondXml(res, twiml.toString());
    });
  });

  app.post("/api/twilio/aura/voice/respond", twilioForm, (req, res) => {
    void handleVoiceRespond(req, res).catch((err) => {
      console.error("Twilio AURA voice respond error:", err);
      const twiml = new VoiceResponse();
      twiml.say(
        { voice: VOICE },
        "Sorry, something went wrong on my side. I can email or text a report when it's ready. Would you like to try another question?"
      );
      appendGather(twiml, 1, (req.body.CallSid || req.query.CallSid) as string | undefined, false);
      twiml.say({ voice: VOICE }, "Thank you for calling IFCDC. Goodbye.");
      respondXml(res, twiml.toString());
    });
  });

  app.post("/api/twilio/aura/voice/wait", twilioForm, (req, res) => {
    void handleVoiceWait(req, res).catch((err) => {
      console.error("Twilio AURA voice wait error:", err);
      const twiml = new VoiceResponse();
      twiml.say(
        { voice: VOICE },
        "I hit a snag while holding that request. I can send the completed report by email or text. What else can I help with?"
      );
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
