/**
 * Founder-reviewed original email composition.
 * This is not an inbound reply: the subject is stored as written, and send does not
 * add a Re: prefix or a conversation id. Sending stays behind the existing outbound gate.
 */
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { inboundMailSessionStatus, type MailDb } from "./inboundBusinessMail";
import { acquireGraphApplicationToken } from "./microsoftGraphMailbox";
import {
  GRAPH_SEND_MAIL_URL,
  SERVICE_MAILBOX,
  attachmentsNoteFor,
  outboundMailSendEnabled,
  type OutboundDeliveryStatus,
  type OutboundSendRecord,
} from "./inboundOutboundMail";

const EMAIL = /^[^\s@]+@[^\s@]+$/;

export type CompositionStatus = "NEEDS FOUNDER APPROVAL" | "FOUNDER APPROVED" | "REJECTED" | "SAVED FOR LATER";

export type CompositionDelivery = {
  id: string;
  status: OutboundDeliveryStatus;
  errorCode: string | null;
  providerMessageId: string | null;
  duplicateKey: string | null;
  timestamp: string;
};

export type OutboundComposition = {
  id: string;
  from: typeof SERVICE_MAILBOX;
  recipient: string;
  subject: string;
  body: string;
  status: CompositionStatus;
  sent: false;
  activeApproval: boolean;
  conversationId: null;
  deliveryHistory: CompositionDelivery[];
  createdAt: string;
  updatedAt: string;
};

type CompositionRow = {
  id: string;
  status: string;
  recipient: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
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

export type OriginalSendPayload = {
  message: {
    subject: string;
    body: { contentType: "Text"; content: string };
    toRecipients: Array<{ emailAddress: { address: string } }>;
  };
  saveToSentItems: true;
};

type CompositionInput = { recipient: string; subject: string; body: string };

function asStatus(value: string): CompositionStatus | null {
  if (value === "NEEDS FOUNDER APPROVAL" || value === "FOUNDER APPROVED" || value === "REJECTED" || value === "SAVED FOR LATER") {
    return value;
  }
  return null;
}

function activeApproval(status: CompositionStatus): boolean {
  return status === "NEEDS FOUNDER APPROVAL";
}

export function validateComposition(input: CompositionInput): { value: CompositionInput; errorCode: string | null } {
  const recipient = input.recipient.trim();
  const subject = input.subject;
  const body = input.body;
  if (!EMAIL.test(recipient)) return { value: input, errorCode: "recipient_invalid" };
  if (!subject.trim()) return { value: input, errorCode: "subject_required" };
  if (!body.trim()) return { value: input, errorCode: "body_required" };
  return { value: { recipient, subject, body }, errorCode: null };
}

export function buildOriginalSendPayload(draft: Pick<OutboundComposition, "recipient" | "subject" | "body">): OriginalSendPayload {
  return {
    message: {
      subject: draft.subject,
      body: { contentType: "Text", content: draft.body },
      toRecipients: [{ emailAddress: { address: draft.recipient } }],
    },
    saveToSentItems: true,
  };
}

async function ensureTables(db: MailDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_outbound_compositions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
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

async function deliveryHistory(db: MailDb, draftId: string): Promise<CompositionDelivery[]> {
  const rows = await db.all<SendRow>(
    "SELECT * FROM hq_inbound_outbound_sends WHERE draft_id = ? ORDER BY created_at ASC",
    draftId,
  );
  return rows.map((row) => ({
    id: row.id,
    status: (row.status === "sent" || row.status === "failed" || row.status === "pending" || row.status === "blocked" ? row.status : "blocked"),
    errorCode: row.error_code,
    providerMessageId: row.provider_message_id,
    duplicateKey: row.duplicate_key,
    timestamp: row.created_at,
  }));
}

async function toComposition(db: MailDb, row: CompositionRow): Promise<OutboundComposition | null> {
  const status = asStatus(row.status);
  if (!status) return null;
  return {
    id: row.id,
    from: SERVICE_MAILBOX,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status,
    sent: false,
    activeApproval: activeApproval(status),
    conversationId: null,
    deliveryHistory: await deliveryHistory(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readComposition(db: MailDb, id: string): Promise<OutboundComposition | null> {
  await ensureTables(db);
  const row = await db.get<CompositionRow>("SELECT * FROM hq_outbound_compositions WHERE id = ?", id);
  return row ? toComposition(db, row) : null;
}

function decision(draft: OutboundComposition) {
  return { sent: false as const, status: draft.status, activeApproval: draft.activeApproval, draft };
}

function sessionDenied(req: Request, res: Response): boolean {
  const status = inboundMailSessionStatus(req.hqUser);
  if (!status) return false;
  res.status(status).json({ error: status === 401 ? "Authentication required" : "Founder session required", sent: false });
  return true;
}

export async function createOutboundComposition(db: MailDb, input: CompositionInput): Promise<{ draft: OutboundComposition | null; errorCode: string | null }> {
  const validated = validateComposition(input);
  if (validated.errorCode || !validated.value) return { draft: null, errorCode: validated.errorCode };
  await ensureTables(db);
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.run(
    `INSERT INTO hq_outbound_compositions (id, status, recipient, subject, body, created_at, updated_at)
     VALUES (?, 'NEEDS FOUNDER APPROVAL', ?, ?, ?, ?, ?)`,
    id,
    validated.value.recipient,
    validated.value.subject,
    validated.value.body,
    now,
    now,
  );
  return { draft: await readComposition(db, id), errorCode: null };
}

export async function listOutboundCompositions(db: MailDb): Promise<OutboundComposition[]> {
  await ensureTables(db);
  const rows = await db.all<CompositionRow>("SELECT * FROM hq_outbound_compositions ORDER BY created_at ASC");
  const drafts: OutboundComposition[] = [];
  for (const row of rows) {
    const draft = await toComposition(db, row);
    if (draft) drafts.push(draft);
  }
  return drafts;
}

async function updateComposition(db: MailDb, id: string, status: CompositionStatus, content?: CompositionInput): Promise<OutboundComposition | null> {
  const current = await readComposition(db, id);
  if (!current) return null;
  const next = content ?? { recipient: current.recipient, subject: current.subject, body: current.body };
  await db.run(
    `UPDATE hq_outbound_compositions
     SET status = ?, recipient = ?, subject = ?, body = ?, updated_at = ?
     WHERE id = ?`,
    status,
    next.recipient,
    next.subject,
    next.body,
    new Date().toISOString(),
    id,
  );
  return readComposition(db, id);
}

export async function editOutboundComposition(db: MailDb, id: string, input: CompositionInput): Promise<{ draft: OutboundComposition | null; errorCode: string | null; httpStatus: number }> {
  const current = await readComposition(db, id);
  if (!current) return { draft: null, errorCode: "draft_not_found", httpStatus: 404 };
  if (!current.activeApproval) return { draft: current, errorCode: "not_editable", httpStatus: 409 };
  const validated = validateComposition(input);
  if (validated.errorCode) return { draft: current, errorCode: validated.errorCode, httpStatus: 400 };
  const draft = await updateComposition(db, id, current.status, validated.value);
  return { draft, errorCode: null, httpStatus: 200 };
}

async function readSentRecord(db: MailDb, draftId: string): Promise<SendRow | null> {
  await ensureTables(db);
  return (await db.get<SendRow>(
    "SELECT * FROM hq_inbound_outbound_sends WHERE draft_id = ? AND status = 'sent' ORDER BY created_at ASC LIMIT 1",
    draftId,
  )) ?? null;
}

async function insertSend(
  db: MailDb,
  input: { draftId: string; actorRole: string; status: OutboundDeliveryStatus; errorCode?: string | null; attachmentsNote: string },
): Promise<SendRow> {
  await ensureTables(db);
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.run(
    `INSERT INTO hq_inbound_outbound_sends (
      id, draft_id, actor_role, created_at, updated_at, status, provider_message_id, error_code, duplicate_key, attachments_note
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
    id,
    input.draftId,
    input.actorRole,
    now,
    now,
    input.status,
    input.errorCode ?? null,
    input.attachmentsNote,
  );
  const row = await db.get<SendRow>("SELECT * FROM hq_inbound_outbound_sends WHERE id = ?", id);
  if (!row) throw new Error("send record missing");
  return row;
}

function recordResult(row: SendRow, changed: boolean) {
  const status = row.status === "blocked" && row.error_code === "not_enabled" ? "not_enabled" : row.status;
  return {
    sent: row.status === "sent",
    status,
    errorCode: row.error_code,
    changed,
    record: {
      id: row.id,
      draftId: row.draft_id,
      actorRole: row.actor_role,
      timestamp: row.created_at,
      status: row.status,
      providerMessageId: row.provider_message_id,
      errorCode: row.error_code,
      duplicateKey: row.duplicate_key,
      attachmentsNote: row.attachments_note,
    } satisfies OutboundSendRecord,
  };
}

export async function sendFounderApprovedComposition(
  db: MailDb,
  input: { draftId: string; actorRole: string; confirmSend: boolean },
): Promise<{ httpStatus: number; sent: boolean; status: string; errorCode: string | null; changed: boolean; record: OutboundSendRecord | null }> {
  const draft = await readComposition(db, input.draftId);
  if (!draft) {
    return { httpStatus: 404, sent: false, status: "blocked", errorCode: "draft_not_found", changed: false, record: null };
  }
  if (input.confirmSend !== true) {
    return { httpStatus: 200, sent: false, status: draft.status, errorCode: null, changed: false, record: null };
  }
  const existing = await readSentRecord(db, draft.id);
  if (existing) return { httpStatus: 200, ...recordResult(existing, false) };

  const attachmentsNote = attachmentsNoteFor(`${draft.subject}\n${draft.body}`);
  if (draft.status !== "FOUNDER APPROVED") {
    const row = await insertSend(db, { draftId: draft.id, actorRole: input.actorRole, status: "blocked", errorCode: "not_approved", attachmentsNote });
    return { httpStatus: 200, ...recordResult(row, false) };
  }
  if (!outboundMailSendEnabled()) {
    const row = await insertSend(db, { draftId: draft.id, actorRole: input.actorRole, status: "blocked", errorCode: "not_enabled", attachmentsNote });
    return { httpStatus: 200, ...recordResult(row, false) };
  }

  const payload = buildOriginalSendPayload(draft);
  const token = await acquireGraphApplicationToken();
  if (!("accessToken" in token)) {
    const row = await insertSend(db, { draftId: draft.id, actorRole: input.actorRole, status: "failed", errorCode: token.errorCode, attachmentsNote });
    return { httpStatus: 200, ...recordResult(row, true) };
  }

  const pending = await insertSend(db, { draftId: draft.id, actorRole: input.actorRole, status: "pending", attachmentsNote });
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
  await db.run(
    `UPDATE hq_inbound_outbound_sends
     SET status = ?, provider_message_id = ?, error_code = ?, duplicate_key = ?, updated_at = ?
     WHERE id = ?`,
    ok ? "sent" : "failed",
    providerMessageId,
    ok ? null : errorCode,
    ok ? `draft-send:${draft.id}` : null,
    new Date().toISOString(),
    pending.id,
  );
  const updated = await db.get<SendRow>("SELECT * FROM hq_inbound_outbound_sends WHERE id = ?", pending.id);
  if (!updated) throw new Error("send record missing");
  return { httpStatus: 200, ...recordResult(updated, true) };
}

export async function listOutboundCompositionsHttp(req: Request, res: Response, options: { db?: MailDb } = {}): Promise<void> {
  if (sessionDenied(req, res)) return;
  const db = options.db ?? await (await import("../db")).getDb();
  const compositions = await listOutboundCompositions(db);
  res.json({ sent: false, compositions });
}

export async function createOutboundCompositionHttp(req: Request, res: Response, options: { db?: MailDb } = {}): Promise<void> {
  if (sessionDenied(req, res)) return;
  const db = options.db ?? await (await import("../db")).getDb();
  const created = await createOutboundComposition(db, {
    recipient: typeof req.body?.recipient === "string" ? req.body.recipient : "",
    subject: typeof req.body?.subject === "string" ? req.body.subject : "",
    body: typeof req.body?.body === "string" ? req.body.body : "",
  });
  if (!created.draft) {
    res.status(400).json({ error: created.errorCode, sent: false });
    return;
  }
  res.status(201).json(decision(created.draft));
}

export async function reviewOutboundCompositionHttp(req: Request, res: Response, options: { db?: MailDb } = {}): Promise<void> {
  if (sessionDenied(req, res)) return;
  const action = typeof req.body?.action === "string" ? req.body.action : "";
  const db = options.db ?? await (await import("../db")).getDb();
  const id = req.params.id;
  if (action === "edit") {
    const edited = await editOutboundComposition(db, id, {
      recipient: typeof req.body?.recipient === "string" ? req.body.recipient : "",
      subject: typeof req.body?.subject === "string" ? req.body.subject : "",
      body: typeof req.body?.body === "string" ? req.body.body : "",
    });
    if (edited.httpStatus === 404) {
      res.status(404).json({ error: "Draft not found", sent: false });
      return;
    }
    if (edited.httpStatus === 409) {
      res.status(409).json({ error: "Draft is not open for editing", sent: false, status: edited.draft?.status });
      return;
    }
    if (!edited.draft || edited.errorCode) {
      res.status(edited.httpStatus).json({ error: edited.errorCode, sent: false });
      return;
    }
    res.json(decision(edited.draft));
    return;
  }
  const current = await readComposition(db, id);
  if (!current && (action === "approve" || action === "reject" || action === "save-for-later")) {
    res.status(404).json({ error: "Draft not found", sent: false });
    return;
  }
  const nextStatus: CompositionStatus | null = action === "approve"
    ? "FOUNDER APPROVED"
    : action === "reject"
      ? "REJECTED"
      : action === "save-for-later"
        ? "SAVED FOR LATER"
        : null;
  if (!nextStatus || !current) {
    res.status(400).json({ error: "action must be approve, edit, reject, or save-for-later", sent: false });
    return;
  }
  const draft = await updateComposition(db, id, nextStatus);
  if (!draft) {
    res.status(404).json({ error: "Draft not found", sent: false });
    return;
  }
  res.json(decision(draft));
}

export async function sendOutboundCompositionHttp(req: Request, res: Response, options: { db?: MailDb } = {}): Promise<void> {
  if (sessionDenied(req, res)) return;
  const db = options.db ?? await (await import("../db")).getDb();
  const result = await sendFounderApprovedComposition(db, {
    draftId: req.params.id,
    actorRole: String(req.hqUser?.role || ""),
    confirmSend: req.body?.confirmSend === true,
  });
  const { httpStatus, ...body } = result;
  res.status(httpStatus).json(body);
}

export function isOriginalCompositionRequest(command: string): boolean {
  return /^compose original email\b/i.test(command.trim());
}

export function parseOriginalComposition(command: string): CompositionInput | { errorCode: string } | null {
  if (!isOriginalCompositionRequest(command)) return null;
  const recipient = command.match(/^recipient:\s*(.+)$/im)?.[1] ?? "";
  const subject = command.match(/^subject:\s*(.+)$/im)?.[1] ?? "";
  const bodyMatch = command.match(/^body:\n([\s\S]*)$/im);
  if (!bodyMatch) return { errorCode: "body_required" };
  return { recipient, subject, body: bodyMatch[1] };
}

export async function prepareStoredOriginalComposition(command: string): Promise<string> {
  const parsed = parseOriginalComposition(command);
  if (!parsed) return "Original email composition was not requested.";
  if ("errorCode" in parsed) return "Original email needs recipient, subject, and body. Nothing was sent.";
  try {
    const db = await (await import("../db")).getDb();
    const created = await createOutboundComposition(db, parsed);
    if (!created.draft) return "Original email was not saved. Nothing was sent.";
    return `Original email saved for Founder review.\nDraft: ${created.draft.id}\nStatus: ${created.draft.status}\nSent: false`;
  } catch {
    return "Original email composition is unavailable. Nothing was sent.";
  }
}
