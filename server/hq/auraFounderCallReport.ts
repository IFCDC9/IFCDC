/**
 * Post-call Founder follow-up report — detailed summary to HQ alert / email / SMS.
 */
import { createLeadershipAlert } from "./criticalAlerts";
import { sendFounderSecurityEmail, sendFounderSecuritySms } from "../lib/notifications";
import { getFounderEmail } from "./auraFounderTrustEngine";
import { logHqAudit } from "./hqAuditLog";
import type { ReceptionistSession } from "./auraReceptionistSession";

export async function deliverFounderCallFollowUp(opts: {
  session: ReceptionistSession;
  channel: "voice" | "sms";
  summary?: string;
  prefer?: Array<"hq" | "email" | "sms">;
  smsTo?: string | null;
}): Promise<{ ok: boolean; delivered: string[]; message: string }> {
  const prefer = opts.prefer?.length ? opts.prefer : ["hq", "email"];
  const turns = (opts.session.turns || []).slice(-12);
  const transcript = turns
    .map((t) => `${t.role === "user" ? "Founder" : "AURA"}: ${t.content}`)
    .join("\n");
  const body = [
    "IFCDC AURA — Founder Call Follow-Up Report",
    `Channel: ${opts.channel}`,
    `Session: ${opts.session.sessionId}`,
    `Time: ${new Date().toISOString()}`,
    "",
    opts.summary || "Summary of the recent Founder session:",
    "",
    transcript.slice(0, 3500) || "(no transcript turns captured)",
    "",
    "— AURA Intelligence System",
  ].join("\n");

  const delivered: string[] = [];

  if (prefer.includes("hq")) {
    await createLeadershipAlert({
      alertType: "aura_call_report",
      title: "Founder call follow-up report",
      message: (opts.summary || transcript).slice(0, 400),
      priority: "normal",
      sourceModule: "aura_voice",
      sourceId: opts.session.sessionId,
      path: "/hq/aura",
    });
    delivered.push("hq");
  }

  if (prefer.includes("email")) {
    const email = await sendFounderSecurityEmail({
      to: getFounderEmail(),
      subject: "AURA Founder call follow-up report",
      body,
    });
    if (email.success) delivered.push("email");
  }

  if (prefer.includes("sms") && opts.smsTo) {
    const sms = await sendFounderSecuritySms({
      to: opts.smsTo,
      body: `AURA follow-up: ${(opts.summary || "Founder session report ready in HQ/email.").slice(0, 280)}`,
    });
    if (sms.success) delivered.push("sms");
  }

  await logHqAudit({
    action: "aura_founder_call_followup",
    entityType: "aura_intelligence",
    entityId: opts.session.sessionId,
    detail: `delivered=${delivered.join(",")}`,
    actorEmail: getFounderEmail(),
    metadata: { channel: opts.channel, delivered },
  }).catch(() => undefined);

  return {
    ok: delivered.length > 0,
    delivered,
    message: delivered.length
      ? `I sent a follow-up report via ${delivered.join(", ")}.`
      : "I could not confirm follow-up delivery. The session remains in HQ logs.",
  };
}

export function wantsCallFollowUp(message: string): boolean {
  return /\b(send|email|text|sms)?\s*(me )?(a )?(follow[- ]?up|detailed report|recap|summary)\b/i.test(message)
    || /\bsend (this|the) (report|summary|recap)\b/i.test(message);
}
