/**
 * AURA Receptionist → Command Layer adapter (E2E Phase 3).
 * Routes Founder voice/SMS into runAuraCommand so tools/memory match HQ text.
 * Does NOT change Twilio webhook URLs or credentials.
 */
import type { AuraTrustedIdentity } from "./auraFounderTrustEngine";
import { runAuraCommand, type AuraCommandResponse } from "./auraCommandLayer";

export type ReceptionistChannel = "voice" | "sms";

function stripMarkdownLite(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Channel-appropriate reply shaping for Twilio voice/SMS. */
export function formatCommandReplyForChannel(
  response: AuraCommandResponse,
  channel: ReceptionistChannel
): string {
  let reply = stripMarkdownLite(response.reply || "");
  if (!reply && response.actions.length) {
    reply = response.actions.map((a) => a.summary).join(" ");
  }
  if (!reply) {
    reply =
      channel === "voice"
        ? "I understood you, but I need a clearer command. Try saying what you want me to do."
        : "Got it — send a clearer command (e.g. send SMS, status, grants).";
  }

  if (channel === "sms") {
    // Keep SMS under a safe Twilio body size with room for branding.
    if (reply.length > 420) reply = `${reply.slice(0, 400).trim()}…`;
    return reply;
  }

  // Voice: shorter spoken answers; avoid reading long URLs/paths.
  reply = reply.replace(/\/hq\/[a-z0-9\-_/]+/gi, "Headquarters");
  if (reply.length > 500) reply = `${reply.slice(0, 480).trim()}. Say continue if you need more.`;
  return reply;
}

export async function runFounderVoiceSmsViaCommandLayer(opts: {
  message: string;
  identity: AuraTrustedIdentity;
  channel: ReceptionistChannel;
  sessionKey?: string | null;
}): Promise<{
  reply: string;
  response: AuraCommandResponse;
  poweredBy: string;
}> {
  const response = await runAuraCommand({
    command: opts.message,
    module: "communications",
    actorEmail: opts.identity.email || "service@ifcdc.org",
    identity: opts.identity,
    actorUser: {
      id: opts.identity.userId || undefined,
      email: opts.identity.email || undefined,
      role: opts.identity.isFounder || opts.identity.founderMode ? "owner" : undefined,
      name: opts.identity.displayName || undefined,
    },
    contextRef: {
      channel: opts.channel,
      entry: "receptionist_command_adapter",
      sessionKey: opts.sessionKey || null,
      twilioConfigUntouched: true,
    },
  });

  void import("./auraUnifiedAudit").then(({ mirrorAuraUnifiedActionAsync }) =>
    mirrorAuraUnifiedActionAsync({
      source: "receptionist",
      channel: opts.channel,
      kind: response.actions.some((a) => a.status === "error") ? "execute" : "system",
      actionId: "command_adapter",
      command: `voice_sms→runAuraCommand`,
      result: response.reply.slice(0, 400),
      ok: !response.actions.some((a) => a.status === "error"),
      userId: opts.identity.userId,
      userEmail: opts.identity.email,
      metadata: {
        poweredBy: response.poweredBy,
        actionIds: response.actions.map((a) => a.id),
        twilioConfigUntouched: true,
      },
    })
  );

  return {
    reply: formatCommandReplyForChannel(response, opts.channel),
    response,
    poweredBy: response.poweredBy || "AURA Command Layer",
  };
}
