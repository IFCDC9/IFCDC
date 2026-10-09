/**
 * Founder-authorized outbound mail from service@ifcdc.org.
 * Approval stays a local status change. This send path is a second request.
 * It stays off until process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED is exactly "true".
 *
 * Founder steps, not performed here:
 * 1. Add application Mail.Send only. Do not add any other mailbox permission for sending.
 * 2. Grant admin consent later. This module does not request consent.
 * 3. Restrict the Exchange application access policy to service@ifcdc.org so the app cannot send as any other mailbox.
 */
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { inboundMailSessionStatus, type MailDb } from "./inboundBusinessMail";
import { acquireGraphApplicationToken } from "./microsoftGraphMailbox";

export const SERVICE_MAILBOX = "service@ifcdc.org";
export const GRAPH_SEND_MAIL_URL = `https://graph.microsoft.com/v1.0/users/${SERVICE_MAILBOX}/sendMail`;

const ATTACHMENTS_NOT_INCLUDED = "attachments not included";
const NO_ATTACHMENTS = "no attachments";

export type OutboundDeliveryStatus = "pending" | "sent" | "failed" | "blocked";

export type OutboundSendRecord = {
  id: string;
  draftId: string;
  actorRole: string;
  timestamp: string;
  status: OutboundDeliveryStatus;
  providerMessageId: string | null;
  errorCode: string | null;
  duplicateKey: string | null;
  attachmentsNote: string;
};

export type OutboundSendResult = {
  sent: boolean;
  status: string;
  errorCode: string | null;
  changed: boolean;
  record: OutboundSendRecord | null;
};

export type OutboundDraftView = {
  inboundId: string;
  status: string;
  replyText: string;
  threadId: string | null;
  senderAddress: string;
  subject: string;
};

type DraftRow = {
  inbound_id: string;
  status: string;
  reply_text: string;
  thread_id: string | null;
  sender_address: string;
  subject: string;
};

type SendRow = {
  id: string;
  draft_id: string;
  actor_role: string;
  created_at: string;
  status: string;
  provider_message_id: string | null;
  error_code: string | null;
  duplicate_key: string | null;
  attachments_note: string;
};

export type OutboundSendPayload = {
  message: {
    subject: string;
    body: { contentType: "Text"; content: string };
    toRecipients: Array<{ emailAddress: { address: string } }>;
    conversationId: string | null;
  };
  saveToSentItems: true;
};

type SendInput = {
  draftId: string;
  actorRole: string;
  confirmSend: boolean;
  recipients?: string[];
};

export function outboundMailSendEnabled(): boolean {
  return process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED === "true";
}

export function outboundSendGateHttp(req: Request, res: Response): void {
  const status = inboundMailSessionStatus(req.hqUser);
  if (status) {
    res.status(status).json({ error: status === 401 ? "Authentication required" : "Founder session required" });
    return;
  }
  res.json({ outboundMailSendEnabled: outboundMailSendEnabled() });
}

export function replySubject(subject: string): string {
  return /^re:\s/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

export function attachmentsNoteFor(text: string): string {
  return /\battachments?\b/i.test(text) ? ATTACHMENTS_NOT_INCLUDED : NO_ATTACHMENTS;
}

export function resolveOutboundRecipients(senderAddress: string, edited?: string[]): { recipients: string[]; errorCode: string | null } {
  if (!edited) return { recipients: [senderAddress], errorCode: null };
  const recipients = edited.map((value) => value.trim()).filter(Boolean);
  if (!recipients.length) return { recipients: [], errorCode: "recipients_required" };
  if (recipients.some((address) => !/^[^\s@]+@[^\s@]+$/.test(address))) {
    return { recipients: [], errorCode: "recipient_invalid" };
  }
  return { recipients, errorCode: null };
}

export function buildOutboundSendPayload(draft: OutboundDraftView, options: { recipients?: string[] } = {}): OutboundSendPayload {
  const resolved = resolveOutboundRecipients(draft.senderAddress, options.recipients);
  return {
    message: {
      subject: replySubject(draft.subject),
      body: { contentType: "Text", content: draft.replyText },
      toRecipients: resolved.recipients.map((address) => ({ emailAddress: { address } })),
      conversationId: draft.threadId,
    },
    saveToSentItems: true,
  };
}

function duplicateKeyFor(draftId: string): string {
  return `draft-send:${draftId}`;
}

function rowToRecord(row: SendRow): OutboundSendRecord {
  const status: OutboundDeliveryStatus = row.status === "sent" || row.status === "failed" || row.status === "pending" || row.status === "blocked"
    ? row.status
    : "blocked";
  return {
    id: row.id,
    draftId: row.draft_id,
    actorRole: row.actor_role,
    timestamp: row.created_at,
    status,
    providerMessageId: row.provider_message_id,
    errorCode: row.error_code,
    duplicateKey: row.duplicate_key,
    attachmentsNote: row.attachments_note,
  };
}

function resultFrom(record: OutboundSendRecord, changed: boolean): OutboundSendResult {
  return {
    sent: record.status === "sent",
    status: record.status === "blocked" && record.errorCode === "not_enabled" ? "not_enabled" : record.status,
    errorCode: record.errorCode,
    changed,
    record,
  };
}

async function ensureSendTable(db: MailDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_inbound_outbound_sends (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_message_id TEXT,
      error_code TEXT,
      duplicate_key TEXT,
      attachments_note TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS hq_outbound_one_sent
      ON hq_inbound_outbound_sends(duplicate_key);
  `);
}

async function readDraft(db: MailDb, draftId: string): Promise<OutboundDraftView | null> {
  const row = await db.get<DraftRow>(
    "SELECT inbound_id, status, reply_text, thread_id, sender_address, subject FROM hq_inbound_reply_drafts WHERE inbound_id = ?",
    draftId,
  );
  if (!row) return null;
  return {
    inboundId: row.inbound_id,
    status: row.status,
    replyText: row.reply_text,
    threadId: row.thread_id,
    senderAddress: row.sender_address,
    subject: row.subject,
  };
}

async function readSentRecord(db: MailDb, draftId: string): Promise<OutboundSendRecord | null> {
  await ensureSendTable(db);
  const row = await db.get<SendRow>(
    "SELECT * FROM hq_inbound_outbound_sends WHERE draft_id = ? AND status = 'sent' ORDER BY created_at ASC LIMIT 1",
    draftId,
  );
  return row ? rowToRecord(row) : null;
}

async function insertRecord(
  db: MailDb,
  input: {
    draftId: string;
    actorRole: string;
    status: OutboundDeliveryStatus;
    providerMessageId?: string | null;
    errorCode?: string | null;
    duplicateKey?: string | null;
    attachmentsNote: string;
  },
): Promise<OutboundSendRecord> {
  await ensureSendTable(db);
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.run(
    `INSERT INTO hq_inbound_outbound_sends (
      id, draft_id, actor_role, created_at, updated_at, status, provider_message_id, error_code, duplicate_key, attachments_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.draftId,
    input.actorRole,
    now,
    now,
    input.status,
    input.providerMessageId ?? null,
    input.errorCode ?? null,
    input.duplicateKey ?? null,
    input.attachmentsNote,
  );
  const row = await db.get<SendRow>("SELECT * FROM hq_inbound_outbound_sends WHERE id = ?", id);
  if (!row) throw new Error("send record missing");
  return rowToRecord(row);
}

async function updateRecord(
  db: MailDb,
  id: string,
  patch: { status: OutboundDeliveryStatus; providerMessageId?: string | null; errorCode?: string | null; duplicateKey?: string | null },
): Promise<OutboundSendRecord> {
  await db.run(
    `UPDATE hq_inbound_outbound_sends
     SET status = ?, provider_message_id = ?, error_code = ?, duplicate_key = ?, updated_at = ?
     WHERE id = ?`,
    patch.status,
    patch.providerMessageId ?? null,
    patch.errorCode ?? null,
    patch.duplicateKey ?? null,
    new Date().toISOString(),
    id,
  );
  const row = await db.get<SendRow>("SELECT * FROM hq_inbound_outbound_sends WHERE id = ?", id);
  if (!row) throw new Error("send record missing");
  return rowToRecord(row);
}

export async function sendFounderApprovedDraft(db: MailDb, input: SendInput): Promise<OutboundSendResult & { httpStatus: number }> {
  let draft: OutboundDraftView | null = null;
  try {
    draft = await readDraft(db, input.draftId);
  } catch {
    draft = null;
  }
  if (!draft) {
    return { httpStatus: 404, sent: false, status: "blocked", errorCode: "draft_not_found", changed: false, record: null };
  }
  if (input.confirmSend !== true) {
    return { httpStatus: 200, sent: false, status: draft.status, errorCode: null, changed: false, record: null };
  }

  const existing = await readSentRecord(db, draft.inboundId);
  if (existing) {
    return { httpStatus: 200, ...resultFrom(existing, false) };
  }

  const attachmentsNote = attachmentsNoteFor(`${draft.subject}\n${draft.replyText}`);
  if (draft.status !== "FOUNDER APPROVED") {
    const record = await insertRecord(db, {
      draftId: draft.inboundId,
      actorRole: input.actorRole,
      status: "blocked",
      errorCode: "not_approved",
      attachmentsNote,
    });
    return { httpStatus: 200, ...resultFrom(record, false) };
  }

  const recipients = resolveOutboundRecipients(draft.senderAddress, input.recipients);
  const payload = buildOutboundSendPayload(draft, { recipients: input.recipients });
  if (recipients.errorCode) {
    const record = await insertRecord(db, {
      draftId: draft.inboundId,
      actorRole: input.actorRole,
      status: "blocked",
      errorCode: recipients.errorCode,
      attachmentsNote,
    });
    return { httpStatus: 200, ...resultFrom(record, false) };
  }

  if (!outboundMailSendEnabled()) {
    const record = await insertRecord(db, {
      draftId: draft.inboundId,
      actorRole: input.actorRole,
      status: "blocked",
      errorCode: "not_enabled",
      attachmentsNote,
    });
    void payload;
    return { httpStatus: 200, ...resultFrom(record, false) };
  }

  const token = await acquireGraphApplicationToken();
  if (!("accessToken" in token)) {
    const record = await insertRecord(db, {
      draftId: draft.inboundId,
      actorRole: input.actorRole,
      status: "failed",
      errorCode: token.errorCode,
      attachmentsNote,
    });
    return { httpStatus: 200, ...resultFrom(record, true) };
  }

  const pending = await insertRecord(db, {
    draftId: draft.inboundId,
    actorRole: input.actorRole,
    status: "pending",
    attachmentsNote,
  });

  let providerMessageId: string | null = null;
  let errorCode: string | null = null;
  let ok = false;
  try {
    const response = await fetch(GRAPH_SEND_MAIL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.accessToken}`,
      },
      body: JSON.stringify(payload),
    });
    ok = response.status === 202;
    if (ok) {
      const body = await response.json().catch(() => null) as { id?: unknown } | null;
      providerMessageId = typeof body?.id === "string" ? body.id : null;
    } else {
      const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
      errorCode = typeof body?.error?.code === "string" ? body.error.code : `http_${response.status}`;
    }
  } catch {
    errorCode = "provider_error";
  }

  const record = await updateRecord(db, pending.id, {
    status: ok ? "sent" : "failed",
    providerMessageId,
    errorCode: ok ? null : errorCode,
    duplicateKey: ok ? duplicateKeyFor(draft.inboundId) : null,
  });
  return { httpStatus: 200, ...resultFrom(record, true) };
}

export function isOutboundDraftStatusQuestion(question: string): boolean {
  return /outbound draft status|draft delivery status/i.test(question);
}

export async function answerOutboundDraftStatus(db: MailDb): Promise<string> {
  await ensureSendTable(db);
  const count = async (sql: string, ...params: unknown[]) => {
    try {
      const row = await db.get<{ c: number }>(sql, ...params);
      return row?.c ?? 0;
    } catch {
      return 0;
    }
  };
  const approved = await count("SELECT COUNT(*) as c FROM hq_inbound_reply_drafts WHERE status = 'FOUNDER APPROVED'");
  const sent = await count("SELECT COUNT(*) as c FROM hq_inbound_outbound_sends WHERE status = 'sent'");
  const failed = await count("SELECT COUNT(*) as c FROM hq_inbound_outbound_sends WHERE status = 'failed'");
  const pending = await count("SELECT COUNT(*) as c FROM hq_inbound_outbound_sends WHERE status = 'pending'");
  return `Approved drafts: ${approved}\nSent: ${sent}\nFailed: ${failed}\nPending: ${pending}`;
}

export async function answerStoredOutboundDraftStatus(): Promise<string> {
  try {
    const db = await (await import("../db")).getDb();
    return answerOutboundDraftStatus(db);
  } catch {
    return "Outbound draft status is unavailable.";
  }
}

export async function sendFounderApprovedDraftHttp(
  req: Request,
  res: Response,
  options: { db?: MailDb } = {},
): Promise<void> {
  const denied = inboundMailSessionStatus(req.hqUser);
  if (denied) {
    res.status(denied).json({ error: denied === 401 ? "Authentication required" : "Founder session required", sent: false });
    return;
  }
  const database = options.db ?? await (await import("../db")).getDb();
  const recipients = Array.isArray(req.body?.recipients)
    ? req.body.recipients.filter((value: unknown): value is string => typeof value === "string")
    : undefined;
  const result = await sendFounderApprovedDraft(database, {
    draftId: req.params.id,
    actorRole: String(req.hqUser?.role || ""),
    confirmSend: req.body?.confirmSend === true,
    recipients,
  });
  const { httpStatus, ...body } = result;
  res.status(httpStatus).json(body);
}
