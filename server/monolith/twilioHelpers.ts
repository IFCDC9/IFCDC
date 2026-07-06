import type { Twilio } from "twilio";
import { normalizePhone } from "./phoneUtils";

export interface TwilioSenderDeps {
  twilioClient: Twilio | null;
  smsFrom: string | undefined;
  voiceFrom: string | undefined;
  publicAppUrl: string | undefined;
}

export function createTwilioSenders(deps: TwilioSenderDeps) {
  function ensureTwilioConfigured() {
    if (!deps.twilioClient || !deps.smsFrom || !deps.voiceFrom) {
      throw new Error("Twilio is not configured. Check env vars.");
    }
  }

  async function sendSafeSms(to: string, body: string) {
    ensureTwilioConfigured();
    const toNorm = normalizePhone(to);
    if (!toNorm) throw new Error("Invalid phone number");
    return deps.twilioClient!.messages.create({
      to: toNorm,
      from: deps.smsFrom!,
      body,
    });
  }

  async function sendVoiceReminderCall(to: string, appointmentId: string) {
    ensureTwilioConfigured();
    const toNorm = normalizePhone(to);
    if (!toNorm) throw new Error("Invalid phone number");
    const baseUrl = (deps.publicAppUrl || "https://your-app-url.example.com").replace(/\/$/, "");
    return deps.twilioClient!.calls.create({
      to: toNorm,
      from: deps.voiceFrom!,
      url: `${baseUrl}/twilio/voice/reminder?appointmentId=${encodeURIComponent(appointmentId)}`,
      statusCallback: `${baseUrl}/twilio/voice-status`,
      statusCallbackMethod: "POST",
    });
  }

  return { sendSafeSms, sendVoiceReminderCall, ensureTwilioConfigured };
}
