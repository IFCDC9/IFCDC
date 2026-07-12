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

/**
 * Deterministic parser for Founder executive commands.
 * Prefer this over LLM for "send email / text me / call me / schedule meeting".
 */
export function parseExecutiveIntent(command: string): ParsedExecutiveIntent | null {
  const c = command.trim();
  if (!c) return null;

  // Email
  if (/\b(email|e-mail|send (an? )?email|mail)\b/i.test(c) && !/\bsubmit\b.*\bgrant\b/i.test(c)) {
    const toBoard = /\b(the )?board\b/i.test(c);
    const to = toBoard ? "board" : extractEmail(c) || (/\b(me|myself|my inbox)\b/i.test(c) ? getFounderEmail() : null);
    if (to) {
      const subjectMatch = c.match(/\b(?:subject|about|re)[:\s]+["']?([^"'\n.]+)["']?/i);
      const bodyMatch = c.match(/\b(?:saying|body|message|tell them)[:\s]+["']?(.+?)["']?\s*$/i);
      return {
        op: "send_email",
        args: {
          to,
          subject: subjectMatch?.[1]?.trim() || (toBoard ? "IFCDC Board Update from AURA" : "Message from IFCDC AURA"),
          body:
            bodyMatch?.[1]?.trim()
            || (toBoard
              ? "The Founder asked AURA to email the Board from Headquarters. Please check HQ for the full executive context."
              : `Message from IFCDC Headquarters (AURA):\n\n${c}`),
        },
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
      const bodyMatch = c.match(/\b(?:saying|message|tell me)[:\s]+["']?(.+?)["']?\s*$/i);
      return {
        op: "send_sms",
        args: {
          to,
          body: bodyMatch?.[1]?.trim() || `AURA (IFCDC HQ): ${c.replace(/\b(text|sms|send a text|send text)\b/gi, "").trim().slice(0, 280) || "Founder notification"}`,
        },
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
        description: c,
        startAt: null,
      },
      highImpact: false,
      confidence: "medium",
    };
  }

  if (/\b(cancel|delete)\b.*\b(meeting|event)\b/i.test(c)) {
    return {
      op: "cancel_calendar_event",
      args: { query: c },
      highImpact: false,
      confidence: "medium",
    };
  }

  // Notifications / announcements
  if (/\b(notify me|send (me )?(a )?notification|alert me)\b/i.test(c)) {
    return {
      op: "send_notification",
      args: {
        title: "AURA Alert",
        message: c.replace(/\b(notify me|send me a notification|alert me)\b/gi, "").trim() || c,
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
        body: c,
        priority: "normal",
      },
      highImpact: true,
      confidence: "medium",
    };
  }

  if (/\bschedule\b.*\b(reminder|follow[- ]?up)\b/i.test(c) || /\bremind me\b/i.test(c)) {
    return {
      op: "schedule_reminder",
      args: { title: "AURA Reminder", message: c },
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
        body: c,
      },
      highImpact: false,
      confidence: "high",
    };
  }

  if (/\b(create|generate|prepare)\b.*\b(today'?s )?executive report\b/i.test(c) || /\bexecutive (daily )?brief(ing)?\b/i.test(c)) {
    return {
      op: "generate_executive_report",
      args: { request: c },
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
      args: { request: c },
      highImpact: false,
      confidence: "high",
    };
  }

  if (/\bnotify me when (finished|done|complete)\b/i.test(c)) {
    return {
      op: "notify_when_finished",
      args: { message: c },
      highImpact: false,
      confidence: "high",
    };
  }

  // Grant submission queue (never auto-submit)
  if (/\b(queue|prepare)\b.*\b(submission|submit)\b/i.test(c) && /\bgrant\b/i.test(c)) {
    return {
      op: "queue_grant_submission",
      args: { note: c },
      highImpact: true,
      confidence: "medium",
    };
  }

  return null;
}

export function wantsExecutiveOperation(command: string): boolean {
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
  const subject = String(args.subject || "Message from IFCDC AURA").trim();
  const body = String(args.body || "").trim();
  if (!toRaw || !body) {
    return { status: "error", summary: "I need a recipient and a message body to send email." };
  }

  const recipients =
    toRaw === "board" || /board@/i.test(toRaw)
      ? await resolveBoardEmails()
      : toRaw.split(/[,;]/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));

  if (!recipients.length) {
    return { status: "error", summary: "I could not resolve any email recipients." };
  }

  // Org-wide / board still allowed for Founder, but log as high-visibility.
  const results: Array<{ to: string; ok: boolean; error?: string }> = [];
  for (const to of recipients) {
    const send = await sendFounderSecurityEmail({ to, subject, body });
    results.push({ to, ok: send.success, error: send.error });
    if (!send.success) {
      // Fallback through HQ notification path
      const fallback = await sendHqNotification({
        to,
        subject,
        body,
        channel: "email",
      });
      results[results.length - 1] = { to, ok: fallback.success, error: fallback.error };
    }
  }

  const ok = results.filter((r) => r.ok).length;
  await logHqAudit({
    action: "aura_exec_send_email",
    entityType: "aura_executive_op",
    entityId: crypto.randomUUID(),
    detail: `sent ${ok}/${results.length}`,
    metadata: { recipients, subject, actor: ctx.actorEmail },
  }).catch(() => undefined);

  if (!ok) {
    return {
      status: "error",
      summary: `Email failed: ${results.map((r) => r.error || "unknown").join("; ")}. Check Resend configuration.`,
      data: { results },
    };
  }

  return {
    status: "done",
    summary: `Email sent to ${results.filter((r) => r.ok).map((r) => r.to).join(", ")} via Resend. Subject: ${subject}.`,
    data: { results, subject },
    navigation: { path: "/hq/communications", label: "Open Communications Center" },
  };
}

export async function executeSendSms(
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
  const body = String(args.body || "").trim().slice(0, 400);
  if (!to || !body) {
    return { status: "error", summary: "I need a phone number and message to send SMS." };
  }

  const send = await sendFounderSecuritySms({ to, body });
  await logHqAudit({
    action: "aura_exec_send_sms",
    entityType: "aura_executive_op",
    entityId: crypto.randomUUID(),
    detail: send.success ? "sent" : send.error || "failed",
    metadata: { to, actor: ctx.actorEmail },
  }).catch(() => undefined);

  if (!send.success) {
    return {
      status: "error",
      summary: `SMS failed: ${send.error || "Twilio error"}. Check Twilio configuration.`,
      data: send,
    };
  }

  return {
    status: "done",
    summary: `SMS sent to ${to} via Twilio.`,
    data: { to, messageId: send.messageId },
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
  const title = String(args.title || "AURA Notification").trim();
  const message = String(args.message || "").trim();
  if (!message) return { status: "error", summary: "What should the notification say?" };

  const id = await createLeadershipAlert({
    alertType: "aura_executive",
    title,
    message: message.slice(0, 800),
    priority: "high",
    sourceModule: "aura",
    path: "/hq/communications",
  });

  // Also push email/SMS to Founder for visibility
  await sendFounderSecurityEmail({
    to: getFounderEmail(),
    subject: title,
    body: message,
  }).catch(() => undefined);

  return {
    status: "done",
    summary: `Notification posted to Headquarters (alert ${id}) and emailed to ${getFounderEmail()}.`,
    data: { alertId: id },
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
  const { createWorkflowInstance } = await import("./workflowEngine");
  const instance = await createWorkflowInstance({
    workflowKey: "board_approval",
    title: "Grant submission queue — awaiting Founder approval",
    entityType: "grant_submission",
    entityId: typeof args.applicationId === "string" ? args.applicationId : undefined,
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

/** Fast-path: parse + execute Founder command without waiting for LLM tools. */
export async function tryRunExecutiveCommand(
  command: string,
  ctx: ExecutiveActionContext
): Promise<{ handled: false } | { handled: true; result: ExecutiveActionResult; op: ExecutiveOpId }> {
  if (!ctx.identity?.founderMode && !ctx.identity?.isFounder) {
    return { handled: false };
  }
  const parsed = parseExecutiveIntent(command);
  if (!parsed) return { handled: false };

  // High-impact without confirm → stage via executor's own pending_approval path
  const result = await runExecutiveOperation(parsed.op, parsed.args, ctx);
  return { handled: true, result, op: parsed.op };
}
