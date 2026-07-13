/**
 * AURA Executive Operations — Founder Mode execute engine.
 *
 * Turns authenticated Founder commands into real HQ actions
 * (email, SMS, calls, calendar, documents, notifications, diagnostics).
 * High-impact irreversible actions still require explicit confirmation / approval staging.
 */
import crypto from "crypto";
import { getDb } from "../db";
import {
  sendFounderSecurityEmail,
  sendFounderSecuritySms,
  sendHqNotification,
} from "../lib/notifications";
import { getFounderEmail, type AuraTrustedIdentity } from "./auraFounderTrustEngine";
import { createLeadershipAlert } from "./criticalAlerts";
import { logHqAudit } from "./hqAuditLog";
import { normalizeE164, IFCDC_HQ_PHONE_E164 } from "./twilioIntegrationEngine";

/** Compatible with AuraActionContext — kept local to avoid circular imports. */
export interface ExecutiveActionContext {
  actorEmail: string;
  module?: string;
  contextRef?: Record<string, unknown>;
  identity?: AuraTrustedIdentity;
}

export type ExecutiveActionResult = {
  status: "done" | "prepared" | "pending_approval" | "error";
  summary: string;
  data?: unknown;
  navigation?: { path: string; label: string };
  approval?: { path: string; label: string };
};

export type ExecutiveOpId =
  | "send_email"
  | "send_sms"
  | "place_call"
  | "send_notification"
  | "broadcast_announcement"
  | "schedule_reminder"
  | "create_calendar_event"
  | "update_calendar_event"
  | "cancel_calendar_event"
  | "create_document"
  | "save_report"
  | "generate_executive_report"
  | "queue_grant_submission"
  | "run_live_grant_workflow"
  | "confirm_grant_portal_submission"
  | "monitor_grant_application"
  | "enterprise_diagnostics"
  | "prepare_payroll_summary"
  | "generate_compliance_report"
  | "notify_when_finished";

export type ParsedExecutiveIntent = {
  op: ExecutiveOpId;
  args: Record<string, unknown>;
  highImpact: boolean;
  confidence: "high" | "medium";
};

function founderPhones(): string[] {
  const fromEnv = (process.env.FOUNDER_TRUSTED_PHONES || process.env.AURA_FOUNDER_PHONES || "")
    .split(",")
    .map((p) => normalizeE164(p.trim()))
    .filter(Boolean) as string[];
  const defaults = ["+18484694448", "+17327615075"].map((p) => normalizeE164(p)!);
  return Array.from(new Set([...fromEnv, ...defaults]));
}

export function resolveFounderMobile(preferred?: string | null): string | null {
  const n = normalizeE164(preferred || "");
  if (n) return n;
  return founderPhones()[0] || null;
}

function requireFounder(ctx: ExecutiveActionContext): ExecutiveActionResult | null {
  if (ctx.identity?.founderMode || ctx.identity?.isFounder) return null;
  return {
    status: "error",
    summary: "That executive action requires Founder Mode. Verify your Founder identity first.",
  };
}

/** High-impact verbs that still require staging / explicit confirm — not casual Founder ops. */
export function detectHighImpactBlockedIntent(command: string): string | null {
  const patterns: { re: RegExp; verb: string }[] = [
    { re: /\b(submit|file)\b.*\b(grant|application|proposal|federal)\b/i, verb: "submit grant" },
    { re: /\b(delete|purge|erase|wipe)\b.*\b(production|database|record|all)\b/i, verb: "delete production data" },
    { re: /\b(approve|authorize)\b.*\b(payment|payroll|wire|disbursement)\b/i, verb: "approve payment" },
    { re: /\b(pay|spend|wire|disburse|issue payment)\b/i, verb: "spend" },
    { re: /\b(deploy|force[- ]?push)\b.*\b(production|main|render)\b/i, verb: "deploy production" },
    { re: /\b(change|rotate)\b.*\b(secret|api.?key|credential|password)\b/i, verb: "change secrets" },
    { re: /\b(restart|reboot|kill)\b.*\b(production|database|cluster)\b/i, verb: "restart critical production" },
    { re: /\bbroadcast\b.*\b(all staff|entire organization|everyone|org.?wide)\b/i, verb: "org-wide broadcast" },
  ];
  for (const { re, verb } of patterns) {
    if (re.test(command)) return verb;
  }
  return null;
}

function extractEmail(text: string): string | null {
  const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

function extractPhone(text: string): string | null {
  const m = text.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (!m) return null;
  return normalizeE164(m[0]);
}

/** Extract a short content clause — never return the full command as content. */
function extractQuotedOrLabeledContent(command: string, labels: string[]): string | null {
  const c = command.trim();
  for (const label of labels) {
    const re = new RegExp(
      `\\b(?:${label})[:\\s]+["']([^"']{2,800})["']`,
      "i",
    );
    const m = c.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  for (const label of labels) {
    const re = new RegExp(
      `\\b(?:${label})[:\\s]+(.+?)(?:\\n|$)`,
      "i",
    );
    const m = c.match(re);
    const v = m?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (v && v.length >= 2 && v.length <= 800) return v;
  }
  // "email X that …" / "text me that …"
  const that = c.match(/\bthat\s+["']([^"']{2,800})["']/i)
    || c.match(/\bthat\s+([^.!?\n]{2,400})[.!?]?$/i);
  if (that?.[1]?.trim()) return that[1].trim();
  return null;
}

function isUnsafeToolContent(value: string, fullCommand: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v.length > 1000) return true;
  // Exact dump of the user prompt
  if (v === fullCommand.trim()) return true;
  if (v.includes(fullCommand.trim()) && fullCommand.trim().length > 80) return true;
  // Multi-step instruction markers
  if (
    /verify_founder_session|check_resend_health|Required fix:|Acceptance criteria|execution plan|Step\s+\d+\s*:/i.test(v)
  ) {
    return true;
  }
  return false;
}

/** Strict allow-lists — never pass the raw NL prompt into tool fields. */
export function pickEmailArgs(args: Record<string, unknown>): { to: string; subject: string; body: string } | null {
  const to = String(args.to ?? "").trim();
  const subject = String(args.subject ?? "").trim();
  const body = String(args.body ?? "").trim();
  if (!to || !subject || !body) return null;
  if (/verify_founder_session|check_resend_health|Required fix:|Acceptance criteria|Step\s+\d+\s*:/i.test(body)) {
    return null;
  }
  return { to, subject, body };
}

export function pickSmsArgs(args: Record<string, unknown>): { to: string; message: string } | null {
  const to = String(args.to ?? "").trim();
  const message = String(args.message ?? args.body ?? "").trim();
  if (!to || !message) return null;
  if (/verify_founder_session|check_resend_health|Step\s+\d+\s*:/i.test(message) && message.length > 200) {
    return null;
  }
  return { to, message };
}

export function pickNotificationArgs(
  args: Record<string, unknown>,
): { title: string; message: string; recipient?: string; role?: string } | null {
  const title = String(args.title ?? "").trim();
  const message = String(args.message ?? "").trim();
  if (!title || !message) return null;
  if (/verify_founder_session|Required fix:|Acceptance criteria/i.test(message) && message.length > 200) {
    return null;
  }
  const out: { title: string; message: string; recipient?: string; role?: string } = { title, message };
  if (args.recipient) out.recipient = String(args.recipient).trim();
  if (args.role) out.role = String(args.role).trim();
  return out;
}

/**
 * Deterministic parser for Founder executive commands.
 * Prefer this over LLM for "send email / text me / call me / schedule meeting".
 * Never uses the full user prompt as email/SMS content.
 */
export function parseExecutiveIntent(command: string): ParsedExecutiveIntent | null {
  const c = command.trim();
  if (!c) return null;

  // Email
  if (/\b(email|e-mail|send (an? )?email|mail)\b/i.test(c) && !/\bsubmit\b.*\bgrant\b/i.test(c)) {
    const toBoard = /\b(the )?board\b/i.test(c);
    const to = toBoard ? "board" : extractEmail(c) || (/\b(me|myself|my inbox)\b/i.test(c) ? getFounderEmail() : null);
    if (to) {
      const subjectMatch = c.match(/\b(?:subject|about|re)[:\s]+["']?([^"'\n.]{2,120})["']?/i);
      const bodyRaw = extractQuotedOrLabeledContent(c, ["saying", "body", "message", "tell them"]);
      const subject =
        subjectMatch?.[1]?.trim()
        || (toBoard ? "IFCDC Board Update from AURA" : "Message from IFCDC AURA");
      let body =
        bodyRaw
        || (toBoard
          ? "The Founder asked AURA to email the Board from Headquarters. Please check HQ for the full executive context."
          : null);
      if (body && isUnsafeToolContent(body, c)) body = null;
      if (!body) {
        // Refuse to dump the prompt — require an explicit content clause
        return null;
      }
      return {
        op: "send_email",
        args: { to, subject, body },
        highImpact: toBoard || /\bbroadcast\b/i.test(c),
        confidence: "high",
      };
    }
  }

  // SMS
  if (/\b(text|sms|send (a )?text)\b/i.test(c)) {
    const toMe = /\b(my phone|me|myself|founder)\b/i.test(c);
    const to = toMe ? "founder" : extractPhone(c);
    if (to) {
      const messageRaw = extractQuotedOrLabeledContent(c, ["saying", "message", "tell me", "text"]);
      let message = messageRaw;
      if (message && isUnsafeToolContent(message, c)) message = null;
      if (!message) {
        // Short remnant after stripping verbs — only if it stays small and clean
        const remnant = c
          .replace(/\b(text|sms|send a text|send text|my phone|me|myself|founder)\b/gi, "")
          .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "")
          .replace(/[:\s]+/g, " ")
          .trim()
          .slice(0, 280);
        message = remnant && !isUnsafeToolContent(remnant, c) ? remnant : null;
      }
      if (!message) return null;
      return {
        op: "send_sms",
        args: { to, message, body: message },
        highImpact: false,
        confidence: "high",
      };
    }
  }

  // Call
  if (/\b(call me|phone me|ring me|place a call|make a (phone )?call)\b/i.test(c)) {
    const to = extractPhone(c) || "founder";
    return {
      op: "place_call",
      args: {
        to,
        message: "This is AURA calling from IFCDC Headquarters on behalf of the Founder.",
      },
      highImpact: false,
      confidence: "high",
    };
  }

  // Calendar
  if (/\b(schedule|create|set up|book)\b.*\b(meeting|event|appointment|call)\b/i.test(c)
    || /\b(calendar event|add to (my )?calendar)\b/i.test(c)) {
    const titleMatch = c.match(/(?:meeting|event|appointment)(?:\s+(?:called|titled|named|about))?\s+["']?([^"'\n.]+)["']?/i);
    return {
      op: "create_calendar_event",
      args: {
        title: titleMatch?.[1]?.trim() || "IFCDC Executive Meeting",
        description: "Scheduled by AURA on behalf of the Founder.",
        startAt: null,
      },
      highImpact: false,
      confidence: "medium",
    };
  }

  if (/\b(cancel|delete)\b.*\b(meeting|event)\b/i.test(c)) {
    return {
      op: "cancel_calendar_event",
      args: { query: c.slice(0, 200) },
      highImpact: false,
      confidence: "medium",
    };
  }

  // Notifications / announcements
  if (/\b(notify me|send (me )?(a )?notification|alert me)\b/i.test(c)) {
    const messageRaw = extractQuotedOrLabeledContent(c, ["saying", "message", "that"])
      || c.replace(/\b(notify me|send me a notification|alert me)\b/gi, "").trim();
    const message = messageRaw && !isUnsafeToolContent(messageRaw, c)
      ? messageRaw.slice(0, 400)
      : "AURA Founder notification";
    return {
      op: "send_notification",
      args: {
        title: "AURA Alert",
        message,
        recipient: "founder",
      },
      highImpact: false,
      confidence: "high",
    };
  }

  if (/\b(broadcast|post)\b.*\b(announcement|to (all )?staff)\b/i.test(c) || /\bannouncement\b.*\b(board|staff)\b/i.test(c)) {
    return {
      op: "broadcast_announcement",
      args: {
        title: "HQ Announcement",
        body: "HQ announcement from AURA (Founder requested).",
        priority: "normal",
      },
      highImpact: true,
      confidence: "medium",
    };
  }

  if (/\bschedule\b.*\b(reminder|follow[- ]?up)\b/i.test(c) || /\bremind me\b/i.test(c)) {
    return {
      op: "schedule_reminder",
      args: { title: "AURA Reminder", message: "Reminder from AURA." },
      highImpact: false,
      confidence: "high",
    };
  }

  // Documents / reports
  if (/\b(create|save|write)\b.*\b(document|report)\b/i.test(c) || /\bsave (this )?report\b/i.test(c)) {
    return {
      op: "save_report",
      args: {
        title: c.match(/["']([^"']+)["']/)?.[1] || "AURA Executive Report",
        body: "Executive report saved by AURA.",
      },
      highImpact: false,
      confidence: "high",
    };
  }

  if (/\b(create|generate|prepare)\b.*\b(today'?s )?executive report\b/i.test(c) || /\bexecutive (daily )?brief(ing)?\b/i.test(c)) {
    return {
      op: "generate_executive_report",
      args: { request: "executive report" },
      highImpact: false,
      confidence: "high",
    };
  }

  if (/\b(compliance report|generate compliance)\b/i.test(c)) {
    return {
      op: "generate_compliance_report",
      args: {},
      highImpact: false,
      confidence: "high",
    };
  }

  if (/\b(prepare payroll|payroll (prep|summary|run))\b/i.test(c)) {
    return {
      op: "prepare_payroll_summary",
      args: {},
      highImpact: false,
      confidence: "high",
    };
  }

  // Monitoring
  if (/\b(enterprise diagnostics|run diagnostics|system diagnostics|monitor (every|all) (hq )?module)\b/i.test(c)
    || /\b(check (all )?(apis|databases|deployments)|detect (failures|offline))\b/i.test(c)) {
    return {
      op: "enterprise_diagnostics",
      args: { request: "enterprise diagnostics" },
      highImpact: false,
      confidence: "high",
    };
  }

  if (/\bnotify me when (finished|done|complete)\b/i.test(c)) {
    return {
      op: "notify_when_finished",
      args: { message: "Notify when finished" },
      highImpact: false,
      confidence: "high",
    };
  }

  // Live grant executive workflow (search → match → draft → Founder gate)
  if (
    /\b(find|search|locate)\b.*\b(best|live)\b.*\bgrant\b/i.test(c)
    || /\b(prepare|build|run)\b.*\b(complete|full)\b.*\b(grant )?(application|proposal|workflow)\b/i.test(c)
    || /\blive grant workflow\b/i.test(c)
    || /\bgrant workflow\b.*\b(live|production|end.?to.?end)\b/i.test(c)
    || /\bfind the best live grant\b/i.test(c)
  ) {
    return {
      op: "run_live_grant_workflow",
      args: { query: c.slice(0, 500), note: "live grant workflow" },
      highImpact: false,
      confidence: "high",
    };
  }

  // Confirm portal submission (after Founder approval + external Grants.gov submit)
  if (
    /\b(confirm|record)\b.*\b(portal|grants\.gov)\b.*\b(submission|confirmation)\b/i.test(c)
    || /\bportal confirmation (id|number)\b/i.test(c)
  ) {
    const idMatch = c.match(/\b(GA[A-Z0-9-]+|GRANT-[A-Z0-9-]+|[A-Z0-9]{8,})\b/i);
    const appMatch = c.match(/\b(?:application|app)[:\s]+([a-z0-9-]{8,})\b/i);
    return {
      op: "confirm_grant_portal_submission",
      args: {
        portalConfirmationId: idMatch?.[1] ?? "",
        applicationId: appMatch?.[1] ?? "",
        note: "portal confirmation",
      },
      highImpact: true,
      confidence: "medium",
    };
  }

  if (/\b(monitor|track|status of)\b.*\b(grant|application)\b/i.test(c)) {
    const appMatch = c.match(/\b(?:application|app)[:\s]+([a-z0-9-]{8,})\b/i);
    return {
      op: "monitor_grant_application",
      args: { applicationId: appMatch?.[1] ?? "", note: "monitor grant" },
      highImpact: false,
      confidence: "medium",
    };
  }

  // Grant submission queue (never auto-submit)
  if (/\b(queue|prepare)\b.*\b(submission|submit)\b/i.test(c) && /\bgrant\b/i.test(c)) {
    return {
      op: "queue_grant_submission",
      args: { note: "queue grant submission" },
      highImpact: true,
      confidence: "medium",
    };
  }

  return null;
}

export function wantsExecutiveOperation(command: string): boolean {
  if (/founder\s+operations?\s+acceptance\s+test/i.test(command)) return true;
  if (
    /verify_founder_session/i.test(command)
    && /send_email/i.test(command)
    && /send_sms/i.test(command)
  ) {
    return true;
  }
  return Boolean(parseExecutiveIntent(command));
}

async function resolveBoardEmails(): Promise<string[]> {
  const db = await getDb();
  const rows = (await db.all(
    `SELECT email FROM people
     WHERE status = 'active' AND email IS NOT NULL AND email != ''
       AND LOWER(COALESCE(person_type,'')) LIKE '%board%'
     LIMIT 50`
  ).catch(() => [])) as { email: string }[];
  const emails = rows.map((r) => r.email.toLowerCase()).filter(Boolean);
  if (emails.length) return emails;
  return [getFounderEmail()];
}

export async function executeSendEmail(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;

  const toRaw = String(args.to || "").trim();
  if (!toRaw) {
    return { status: "error", summary: "send_email requires a recipient (to)." };
  }

  const recipients =
    toRaw === "board" || /board@/i.test(toRaw)
      ? await resolveBoardEmails()
      : toRaw.split(/[,;]/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));

  if (!recipients.length) {
    return { status: "error", summary: "I could not resolve any email recipients." };
  }

  const {
    isPlaceholderEmailBody,
    sendAuraGeneratedEmail,
    sendBrandedEmail,
  } = await import("./emailEngine");

  const subjectIn = String(args.subject || "").trim();
  const bodyIn = String(args.body || "").trim();
  const moduleHint = String(args.module || ctx.module || "aura");
  const intent = String(args.intent || args.context || args._rawCommand || subjectIn || "Headquarters update").slice(0, 800);
  const forceGenerate = args.generate === true || args.generate === "true";
  const wantsAura =
    forceGenerate
    || !bodyIn
    || isPlaceholderEmailBody(bodyIn)
    || isUnsafeToolContent(bodyIn, String(args._rawCommand || ""));

  if (bodyIn && isUnsafeToolContent(bodyIn, String(args._rawCommand || "")) && !forceGenerate) {
    // Instruction dump without explicit generate → refuse rather than email the dump
    if (!wantsAura || isUnsafeToolContent(bodyIn, bodyIn)) {
      return {
        status: "error",
        summary:
          "Refused to send email — body looks like a multi-step instruction dump. "
          + "Provide a real message or ask AURA to compose one.",
      };
    }
  }

  const results: Array<{
    to: string;
    ok: boolean;
    error?: string;
    messageId?: string;
    generatedBy?: string;
    from?: string;
  }> = [];

  for (const to of recipients) {
    if (wantsAura) {
      const send = await sendAuraGeneratedEmail({
        to,
        intent,
        context: String(args.context || args._rawCommand || "").slice(0, 4000),
        module: moduleHint,
        recipientName: String(args.recipientName || ""),
        fallbackBody: bodyIn && !isPlaceholderEmailBody(bodyIn) && !isUnsafeToolContent(bodyIn, "")
          ? bodyIn
          : undefined,
        subjectHint: subjectIn || undefined,
      });
      results.push({
        to,
        ok: send.success,
        error: send.error,
        messageId: send.messageId,
        generatedBy: send.generatedBy,
        from: send.from,
      });
    } else {
      const pickedOk = pickEmailArgs({ to, subject: subjectIn, body: bodyIn });
      if (!pickedOk) {
        results.push({ to, ok: false, error: "Invalid subject/body" });
        continue;
      }
      const send = await sendBrandedEmail({
        to,
        templateId: "aura_message",
        subjectOverride: pickedOk.subject,
        template: {
          message: pickedOk.body,
          fields: { headline: pickedOk.subject, subjectHint: pickedOk.subject },
        },
      });
      results.push({
        to,
        ok: send.success,
        error: send.error,
        messageId: send.messageId,
        generatedBy: "template",
        from: send.from,
      });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const acceptedIds = results.filter((r) => r.ok && r.messageId).map((r) => r.messageId);
  const subjectOut = subjectIn || results[0]?.generatedBy || "AURA Headquarters email";
  await logHqAudit({
    action: "aura_exec_send_email",
    entityType: "aura_executive_op",
    entityId: crypto.randomUUID(),
    detail: `sent ${ok}/${results.length}`,
    metadata: {
      recipients,
      actor: ctx.actorEmail,
      messageIds: acceptedIds,
      branded: true,
      auraGenerated: wantsAura,
    },
  }).catch(() => undefined);

  if (!ok) {
    return {
      status: "error",
      summary: `Email failed: ${results.map((r) => r.error || "unknown").join("; ")}. Check Resend + sender domain verification.`,
      data: { results, providerAccepted: false },
    };
  }

  return {
    status: "done",
    summary:
      `Branded email sent to ${results.filter((r) => r.ok).map((r) => r.to).join(", ")} via Resend`
      + (wantsAura ? " (AURA-composed)" : " (template)")
      + `. From: ${results.find((r) => r.from)?.from || "verified sender"}.`,
    data: {
      results,
      subject: subjectOut,
      providerAccepted: true,
      messageId: acceptedIds[0] || null,
      branded: true,
      auraGenerated: wantsAura,
    },
    navigation: { path: "/hq/communications", label: "Open Communications Center" },
  };
}

export async function executeSendSms(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;

  const picked = pickSmsArgs(args);
  if (!picked) {
    return {
      status: "error",
      summary:
        "send_sms requires exact fields { to, message }. "
        + "I will not forward a multi-step instruction dump as SMS content.",
    };
  }

  let to = picked.to;
  if (to === "founder" || to === "me") {
    to = resolveFounderMobile(ctx.identity?.phoneE164) || "";
  } else {
    to = normalizeE164(to) || to;
  }
  const body = picked.message.slice(0, 400);
  if (!to || !body) {
    return { status: "error", summary: "I need a phone number and message to send SMS." };
  }
  if (isUnsafeToolContent(body, String(args._rawCommand || ""))) {
    return {
      status: "error",
      summary: "Refused to send SMS — message looks like a multi-step instruction dump.",
    };
  }

  const send = await sendFounderSecuritySms({ to, body });
  await logHqAudit({
    action: "aura_exec_send_sms",
    entityType: "aura_executive_op",
    entityId: crypto.randomUUID(),
    detail: send.success ? "sent" : send.error || "failed",
    metadata: { to, actor: ctx.actorEmail, messageId: send.messageId },
  }).catch(() => undefined);

  if (!send.success || !send.messageId) {
    return {
      status: "error",
      summary: `SMS failed: ${send.error || "Twilio did not accept the message"}. Check Twilio configuration.`,
      data: { ...send, providerAccepted: false },
    };
  }

  return {
    status: "done",
    summary: `SMS sent to ${to} via Twilio.`,
    data: { to, messageId: send.messageId, providerAccepted: true, messagePreview: body.slice(0, 80) },
    navigation: { path: "/hq/communications", label: "Open Communications Center" },
  };
}

export async function executePlaceCall(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;

  let to = String(args.to || "").trim();
  if (to === "founder" || to === "me") {
    to = resolveFounderMobile(ctx.identity?.phoneE164) || "";
  } else {
    to = normalizeE164(to) || to;
  }
  const message = String(args.message || "This is AURA from IFCDC Headquarters.").slice(0, 400);
  if (!to) {
    return { status: "error", summary: "I need a phone number to place the call." };
  }

  const sid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const from = (
    process.env.TWILIO_PHONE_NUMBER
    || process.env.HQ_PHONE_NUMBER
    || IFCDC_HQ_PHONE_E164
    || ""
  ).trim();

  if (!sid || !token || !from) {
    return {
      status: "error",
      summary: "Twilio voice is not fully configured (need Account SID, Auth Token, and HQ phone).",
    };
  }

  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(sid, token);
    const say = message.replace(/[<>&]/g, " ");
    const call = await client.calls.create({
      to,
      from,
      twiml: `<Response><Say voice="Polly.Joanna">${say}</Say><Pause length="1"/><Say voice="Polly.Joanna">Goodbye.</Say></Response>`,
    });
    await logHqAudit({
      action: "aura_exec_place_call",
      entityType: "aura_executive_op",
      entityId: call.sid,
      detail: `call to ${to}`,
      metadata: { actor: ctx.actorEmail },
    }).catch(() => undefined);
    return {
      status: "done",
      summary: `Calling ${to} now via Twilio (SID ${call.sid}).`,
      data: { callSid: call.sid, to, from },
      navigation: { path: "/hq/communications", label: "Open Communications Center" },
    };
  } catch (err) {
    return {
      status: "error",
      summary: `Call failed: ${err instanceof Error ? err.message : "Twilio error"}`,
    };
  }
}

export async function executeSendNotification(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;
  const picked = pickNotificationArgs(args);
  if (!picked) {
    return {
      status: "error",
      summary:
        "send_notification / create_founder_notification requires { title, message } "
        + "(optional recipient/role). Instruction dumps are rejected.",
    };
  }
  const { title, message } = picked;

  const id = await createLeadershipAlert({
    alertType: "aura_executive",
    title,
    message: message.slice(0, 800),
    priority: "high",
    sourceModule: "aura",
    path: "/hq/communications",
  });

  if (!id) {
    return {
      status: "error",
      summary: "Notification record was not created.",
      data: { providerAccepted: false },
    };
  }

  // Also push email to Founder for visibility (strict short fields only)
  await sendFounderSecurityEmail({
    to: getFounderEmail(),
    subject: title.slice(0, 120),
    body: message.slice(0, 800),
  }).catch(() => undefined);

  return {
    status: "done",
    summary: `Notification posted to Headquarters (alert ${id}) and emailed to ${getFounderEmail()}.`,
    data: { alertId: id, providerAccepted: true, recipient: picked.recipient || "founder", role: picked.role },
    navigation: { path: "/hq/communications", label: "Open Notification Center" },
  };
}

export async function executeBroadcastAnnouncement(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;

  const title = String(args.title || "HQ Announcement").trim();
  const body = String(args.body || "").trim();
  const priority = String(args.priority || "normal");
  if (!body) return { status: "error", summary: "Announcement body is required." };

  // High-impact: stage unless confirmed
  if (!args.confirmed) {
    const { createWorkflowInstance } = await import("./workflowEngine");
    const instance = await createWorkflowInstance({
      workflowKey: "board_approval",
      title: `Announcement: ${title}`,
      entityType: "aura_announcement",
      assignedTo: getFounderEmail(),
      priority: "high",
      payload: { title, body, priority, stagedBy: "aura", actor: ctx.actorEmail },
    });
    return {
      status: "pending_approval",
      summary: `Org announcement "${title}" is staged for your confirmation before publish. Say confirm announcement or approve in Workflows.`,
      data: instance,
      approval: { path: "/hq/workflows", label: "Review announcement" },
    };
  }

  const { commId } = await import("./communicationsSchema");
  const db = await getDb();
  const id = commId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO hq_announcements (id, title, body, priority, author_email, author_name, published_at, expires_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'published', ?)`,
    id,
    title,
    body,
    priority,
    ctx.actorEmail,
    "AURA (Founder Mode)",
    now,
    now
  );
  await createLeadershipAlert({
    alertType: "announcement",
    title: `Announcement: ${title}`,
    message: body.slice(0, 500),
    priority: priority === "high" ? "high" : "normal",
    sourceModule: "communications",
    sourceId: id,
    path: "/hq/communications",
  });

  return {
    status: "done",
    summary: `Announcement "${title}" published in Communications Center.`,
    data: { id },
    navigation: { path: "/hq/communications", label: "Open Announcements" },
  };
}

export async function executeScheduleReminder(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;
  const title = String(args.title || "AURA Reminder").trim();
  const message = String(args.message || title).trim();
  const { createWorkflowInstance } = await import("./workflowEngine");
  const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const instance = await createWorkflowInstance({
    workflowKey: "board_approval",
    title,
    entityType: "aura_reminder",
    assignedTo: getFounderEmail(),
    priority: "normal",
    dueAt: due,
    payload: { message, stagedBy: "aura", actor: ctx.actorEmail },
  });
  await createLeadershipAlert({
    alertType: "aura_reminder",
    title,
    message: message.slice(0, 500),
    priority: "normal",
    sourceModule: "aura",
    path: "/hq/workflows",
  });
  return {
    status: "done",
    summary: `Reminder scheduled for the Founder (due within 24 hours): ${title}.`,
    data: instance,
    navigation: { path: "/hq/workflows", label: "Open Workflows" },
  };
}

export async function executeCreateCalendarEvent(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;
  const title = String(args.title || "IFCDC Meeting").trim();
  const description = String(args.description || "").trim();
  const startAt = String(args.startAt || "").trim() || new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const endAt = String(args.endAt || "").trim() || new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString();
  const location = String(args.location || "IFCDC HQ").trim();

  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO org_events (id, title, event_type, start_at, end_at, location, status, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    title,
    "meeting",
    startAt,
    endAt,
    location,
    "scheduled",
    description || `Created by AURA for ${ctx.actorEmail}`,
    now
  );

  return {
    status: "done",
    summary: `Calendar event created: "${title}" starting ${new Date(startAt).toLocaleString()}.`,
    data: { id, title, startAt, endAt, location },
    navigation: { path: "/hq/calendar", label: "Open Calendar" },
  };
}

export async function executeCancelCalendarEvent(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;
  const query = String(args.query || args.title || "").trim();
  const db = await getDb();
  const row = await db.get<{ id: string; title: string }>(
    `SELECT id, title FROM org_events
     WHERE status != 'cancelled'
       AND (title LIKE ? OR description LIKE ?)
     ORDER BY start_at DESC LIMIT 1`,
    `%${query.slice(0, 40)}%`,
    `%${query.slice(0, 40)}%`
  );
  if (!row) {
    return { status: "error", summary: "I could not find a matching calendar event to cancel." };
  }
  await db.run(`UPDATE org_events SET status = 'cancelled' WHERE id = ?`, row.id);
  return {
    status: "done",
    summary: `Cancelled calendar event: "${row.title}".`,
    data: row,
    navigation: { path: "/hq/calendar", label: "Open Calendar" },
  };
}

export async function executeSaveReport(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;
  const title = String(args.title || "AURA Report").trim();
  const body = String(args.body || "").trim();
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO hq_documents (id, title, category, file_url, version, access_level, approval_status, submitted_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    title,
    "executive_report",
    null,
    1,
    "confidential",
    "approved",
    ctx.actorEmail,
    now,
    now
  );
  // Persist body as OCR/text if column exists — best effort via notes-style update
  try {
    await db.run(`UPDATE hq_documents SET ocr_text = ? WHERE id = ?`, body.slice(0, 50000), id);
  } catch {
    /* optional column */
  }

  return {
    status: "done",
    summary: `Report saved to Document Center: "${title}".`,
    data: { id, title },
    navigation: { path: "/hq/documents", label: "Open Documents" },
  };
}

export async function executeGenerateExecutiveReport(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;
  const { runEnterpriseBrain } = await import("./auraEnterpriseBrain");
  const brain = await runEnterpriseBrain({
    request: String(args.request || "Create today's executive report"),
    channel: "hq_web",
    actorEmail: ctx.actorEmail,
    founderMode: true,
  });
  const saved = await executeSaveReport(
    {
      title: `Executive Report — ${new Date().toISOString().slice(0, 10)}`,
      body: brain.unifiedBriefing || brain.speechSummary,
    },
    ctx
  );
  return {
    status: "done",
    summary: `${brain.speechSummary}\n\n${saved.summary}`,
    data: { brain, document: saved.data },
    navigation: saved.navigation,
  };
}

export async function executeEnterpriseDiagnostics(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;
  const { handleTechnicalCommand } = await import("./auraTechnicalCommandEngine");
  const result = await handleTechnicalCommand({
    command: String(args.request || "Check the entire system and run enterprise diagnostics"),
    channel: "hq_web",
    actorEmail: ctx.actorEmail,
    founderMode: true,
  });
  return {
    status: result.ok ? "done" : "error",
    summary: result.reply,
    data: result.briefing,
    navigation: { path: "/hq/aura", label: "Open AURA Command" },
  };
}

export async function executePreparePayrollSummary(
  _args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;
  const { answerDecisionSupportQuestion } = await import("./auraDecisionSupport");
  const result = await answerDecisionSupportQuestion(
    "Prepare a payroll preparation summary using live HQ HR and finance data. Do not run payroll or issue payments."
  );
  const { createWorkflowInstance } = await import("./workflowEngine");
  await createWorkflowInstance({
    workflowKey: "board_approval",
    title: "Payroll preparation summary — Founder review",
    entityType: "payroll_prep",
    assignedTo: getFounderEmail(),
    priority: "high",
    payload: { summary: result.speechSummary, stagedBy: "aura" },
  });
  return {
    status: "prepared",
    summary: `${result.speechSummary}\n\nPayroll execution is staged for Founder approval — AURA did not run payroll or issue payments.`,
    data: result,
    approval: { path: "/hq/workflows", label: "Review payroll prep" },
    navigation: { path: "/hq/hr", label: "Open HR" },
  };
}

export async function executeComplianceReport(
  _args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;
  const { runEnterpriseOs } = await import("./auraEnterpriseOs4");
  const os = await runEnterpriseOs({
    request: "Generate compliance report and outstanding compliance items",
    channel: "hq_web",
    founderMode: true,
    actorEmail: ctx.actorEmail,
  });
  await executeSaveReport(
    {
      title: `Compliance Report — ${new Date().toISOString().slice(0, 10)}`,
      body: os.speechSummary,
    },
    ctx
  );
  return {
    status: "done",
    summary: os.speechSummary,
    data: os,
    navigation: { path: "/hq/enterprise-os", label: "Open Mission Control" },
  };
}

export async function executeQueueGrantSubmission(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;

  const applicationId =
    typeof args.applicationId === "string" && args.applicationId.trim()
      ? args.applicationId.trim()
      : null;

  if (applicationId) {
    const { buildGrantSubmissionPackage } = await import("./executiveGrantWorkflowEngine");
    // Stage only — do not approve on queue. Surface the portal checklist.
    const pkg = await buildGrantSubmissionPackage(applicationId);
    const { createWorkflowInstance } = await import("./workflowEngine");
    const instance = await createWorkflowInstance({
      workflowKey: "board_approval",
      title: "Grant submission queue — awaiting Founder approval",
      entityType: "grant_submission",
      entityId: applicationId,
      assignedTo: getFounderEmail(),
      priority: "high",
      payload: { note: args.note, stagedBy: "aura", actor: ctx.actorEmail },
    });
    return {
      status: "pending_approval",
      summary: pkg.founderGate.ready
        ? "Founder approval is already on file. Complete Grants.gov in the portal, then confirm the confirmation ID in HQ. AURA will not auto-submit."
        : "Grant submission is staged for your explicit Founder approval. After you approve, complete Grants.gov portal submission and confirm the ID — AURA never submits externally.",
      data: { workflow: instance, package: pkg },
      approval: {
        path: `/hq/grants?application=${applicationId}`,
        label: "Review & approve grant package",
      },
      navigation: { path: "/hq/grants", label: "Open Grant Center" },
    };
  }

  const { createWorkflowInstance } = await import("./workflowEngine");
  const instance = await createWorkflowInstance({
    workflowKey: "board_approval",
    title: "Grant submission queue — awaiting Founder approval",
    entityType: "grant_submission",
    entityId: undefined,
    assignedTo: getFounderEmail(),
    priority: "high",
    payload: { note: args.note, stagedBy: "aura", actor: ctx.actorEmail },
  });
  return {
    status: "pending_approval",
    summary:
      "Grant submission is queued for your explicit approval. AURA will not submit to Grants.gov or any funder until you approve.",
    data: instance,
    approval: { path: "/hq/workflows", label: "Approve grant submission" },
    navigation: { path: "/hq/grants", label: "Open Grant Center" },
  };
}

export async function executeRunLiveGrantWorkflow(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;

  const { runLiveGrantExecutiveWorkflow } = await import("./executiveGrantWorkflowEngine");
  const result = await runLiveGrantExecutiveWorkflow({
    actorEmail: ctx.actorEmail,
    programSlug: typeof args.program === "string" ? args.program : undefined,
    query: typeof args.query === "string" ? args.query : undefined,
    opportunityId: typeof args.opportunityId === "string" ? args.opportunityId : undefined,
    syncFeeds: args.syncFeeds !== false,
    autoDraft: args.autoDraft !== false,
  });

  if (!result.ok) {
    return {
      status: "error",
      summary: result.error ?? "Live grant workflow could not complete.",
      data: result,
      navigation: { path: "/hq/grants", label: "Open Grant Center" },
    };
  }

  return {
    status: "pending_approval",
    summary: result.summary ?? "Live grant package staged for Founder approval.",
    data: result,
    approval: {
      path: result.founderActions?.openWorkspace ?? `/hq/grants?application=${result.applicationId}`,
      label: "Approve grant package (Founder)",
    },
    navigation: {
      path: result.founderActions?.openWorkspace ?? "/hq/grants",
      label: "Open application workspace",
    },
  };
}

export async function executeConfirmGrantPortalSubmission(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;

  const applicationId =
    (typeof args.applicationId === "string" && args.applicationId.trim())
    || (typeof ctx.contextRef?.applicationId === "string" ? ctx.contextRef.applicationId : "");
  const portalConfirmationId =
    (typeof args.portalConfirmationId === "string" && args.portalConfirmationId.trim())
    || (typeof args.portal_confirmation_id === "string" && args.portal_confirmation_id.trim())
    || "";

  if (!applicationId || !portalConfirmationId) {
    return {
      status: "error",
      summary:
        "I need the application ID and Grants.gov portal confirmation ID. After you submit in the portal, say: confirm portal submission for application <id> confirmation <id>.",
    };
  }

  const { confirmPortalSubmission } = await import("./executiveGrantWorkflowEngine");
  const result = await confirmPortalSubmission(applicationId, {
    actorEmail: ctx.actorEmail,
    portalConfirmationId,
    portalUrl: typeof args.portalUrl === "string" ? args.portalUrl : undefined,
    notes: typeof args.note === "string" ? args.note : undefined,
  });

  if (!result.ok) {
    return {
      status: "error",
      summary: "error" in result ? result.error : "Could not confirm portal submission",
      data: result,
    };
  }

  return {
    status: "done",
    summary:
      "Portal submission confirmed and tracked. I will monitor this application and notify you of status changes until a final award decision.",
    data: result,
    navigation: { path: `/hq/grants?application=${applicationId}`, label: "Track application" },
  };
}

export async function executeMonitorGrantApplication(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;

  const applicationId =
    (typeof args.applicationId === "string" && args.applicationId.trim())
    || (typeof ctx.contextRef?.applicationId === "string" ? ctx.contextRef.applicationId : "");

  if (!applicationId) {
    return {
      status: "error",
      summary: "Specify which grant application to monitor (application ID).",
    };
  }

  const { monitorGrantApplication } = await import("./executiveGrantWorkflowEngine");
  const result = await monitorGrantApplication(applicationId);
  if (!result.ok) {
    return { status: "error", summary: result.error ?? "Monitor failed", data: result };
  }

  return {
    status: "done",
    summary: `${result.opportunityTitle ?? result.title}: ${result.nextAction}`,
    data: result,
    navigation: { path: `/hq/grants?application=${applicationId}`, label: "Open Grant Center" },
  };
}

export async function executeNotifyWhenFinished(
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const denied = requireFounder(ctx);
  if (denied) return denied;
  const message = String(args.message || "AURA will notify you when the current task finishes.");
  await createLeadershipAlert({
    alertType: "aura_watch",
    title: "Notify when finished",
    message: message.slice(0, 500),
    priority: "normal",
    sourceModule: "aura",
    path: "/hq/aura",
  });
  const phone = resolveFounderMobile(ctx.identity?.phoneE164);
  if (phone) {
    await sendFounderSecuritySms({
      to: phone,
      body: "AURA: I'll notify you when the Headquarters task finishes.",
    }).catch(() => undefined);
  }
  return {
    status: "done",
    summary: "Understood. I'll notify you in HQ (and SMS if available) when the task completes.",
  };
}

const EXECUTORS: Record<
  ExecutiveOpId,
  (args: Record<string, unknown>, ctx: ExecutiveActionContext) => Promise<ExecutiveActionResult>
> = {
  send_email: executeSendEmail,
  send_sms: executeSendSms,
  place_call: executePlaceCall,
  send_notification: executeSendNotification,
  broadcast_announcement: executeBroadcastAnnouncement,
  schedule_reminder: executeScheduleReminder,
  create_calendar_event: executeCreateCalendarEvent,
  update_calendar_event: executeCreateCalendarEvent,
  cancel_calendar_event: executeCancelCalendarEvent,
  create_document: executeSaveReport,
  save_report: executeSaveReport,
  generate_executive_report: executeGenerateExecutiveReport,
  queue_grant_submission: executeQueueGrantSubmission,
  run_live_grant_workflow: executeRunLiveGrantWorkflow,
  confirm_grant_portal_submission: executeConfirmGrantPortalSubmission,
  monitor_grant_application: executeMonitorGrantApplication,
  enterprise_diagnostics: executeEnterpriseDiagnostics,
  prepare_payroll_summary: executePreparePayrollSummary,
  generate_compliance_report: executeComplianceReport,
  notify_when_finished: executeNotifyWhenFinished,
};

export async function runExecutiveOperation(
  op: ExecutiveOpId,
  args: Record<string, unknown>,
  ctx: ExecutiveActionContext
): Promise<ExecutiveActionResult> {
  const fn = EXECUTORS[op];
  if (!fn) return { status: "error", summary: `Unknown executive operation: ${op}` };
  return fn(args, ctx);
}

/** Fast-path: plan + execute Founder command (compound or single) without waiting for LLM tools. */
export async function tryRunExecutiveCommand(
  command: string,
  ctx: ExecutiveActionContext
): Promise<
  | { handled: false }
  | {
      handled: true;
      result: ExecutiveActionResult;
      op: ExecutiveOpId | "founder_operations_acceptance" | "compound_executive_plan";
      plan?: import("./auraExecutiveCommandPlanner").ExecutivePlanningPreview;
      stepReports?: import("./auraExecutiveCommandPlanner").ExecutiveStepReport[];
    }
> {
  if (!ctx.identity?.founderMode && !ctx.identity?.isFounder) {
    return { handled: false };
  }

  const {
    planExecutiveCommand,
    executeExecutivePlan,
    wantsFounderOperationsAcceptanceTest,
    looksLikeInstructionDump,
  } = await import("./auraExecutiveCommandPlanner");

  // Guard: if the command is a multi-step instruction dump that also mentions email,
  // never treat the whole prompt as a single send_email body.
  const planned = planExecutiveCommand(command);
  if (planned) {
    const execution = await executeExecutivePlan(planned, ctx);
    return {
      handled: true,
      result: execution.result,
      op: wantsFounderOperationsAcceptanceTest(command)
        ? "founder_operations_acceptance"
        : "compound_executive_plan",
      plan: execution.preview,
      stepReports: execution.steps,
    };
  }

  // If the prompt looks like an instruction dump but didn't match the acceptance
  // detector, refuse emailing it — surface a clear error instead.
  if (looksLikeInstructionDump(command) && /\b(email|sms|text|notification)\b/i.test(command)) {
    return {
      handled: true,
      result: {
        status: "error",
        summary:
          "This looks like a multi-step operations test. "
          + "Say \"Run the Founder Operations Acceptance Test\" and I will execute each registered action separately "
          + "instead of forwarding the instructions as email.",
      },
      op: "send_email",
    };
  }

  const parsed = parseExecutiveIntent(command);
  if (!parsed) return { handled: false };

  const result = await runExecutiveOperation(parsed.op, { ...parsed.args, _rawCommand: command }, ctx);
  return { handled: true, result, op: parsed.op };
}
