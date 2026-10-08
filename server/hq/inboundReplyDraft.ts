/**
 * Founder approval drafts for one stored inbound message.
 * Approval, edit, reject, and save change local status only.
 * This module does not send mail or contact a mailbox provider.
 */
import type { Request, Response } from "express";
import {
  getInboundBusinessMail,
  inboundMailSessionStatus,
  type MailDb,
  type StoredInboundMail,
} from "./inboundBusinessMail";

export const DRAFT_STATUSES = [
  "DRAFT",
  "NEEDS FOUNDER APPROVAL",
  "FOUNDER APPROVED",
  "REJECTED",
  "SAVED FOR LATER",
] as const;

export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export type ReplyDraftSummary = {
  whoSent: string;
  organization: string;
  whatTheyWant: string;
  priority: string;
  deadline: string;
  recommendedResponse: string;
  risk: string;
};

export type InboundReplyDraft = {
  inboundId: string;
  status: DraftStatus;
  sent: false;
  activeApproval: boolean;
  providerMessageId: string;
  threadId: string | null;
  senderName: string | null;
  senderAddress: string;
  subject: string;
  contextSummary: string;
  linked: { kind: string; id: string } | null;
  replyText: string;
  summary: ReplyDraftSummary;
  hqContext: string;
};

export type DraftContextInput = {
  category: string;
  linked: { kind: string; id: string } | null;
};

export type DraftContextReader = (input: DraftContextInput) => Promise<string | null>;

const UNAVAILABLE = "HQ context is unavailable.";

const KNOWN_CATEGORIES = new Set([
  "Grants",
  "Barbers",
  "Partnerships",
  "Schools",
  "Mentorship",
  "HR",
  "Finance",
  "Software",
  "Media",
  "Music",
  "Legal",
  "Support",
  "General",
]);

type DraftRow = {
  inbound_id: string;
  status: string;
  reply_text: string;
  summary_json: string;
  provider_message_id: string;
  thread_id: string | null;
  sender_name: string | null;
  sender_address: string;
  subject: string;
  context_summary: string;
  linked_kind: string | null;
  linked_id: string | null;
  hq_context: string;
};

export async function defaultInboundDraftContext(input: DraftContextInput): Promise<string | null> {
  if (!KNOWN_CATEGORIES.has(input.category)) return null;
  return null;
}

function activeApproval(status: DraftStatus): boolean {
  return status === "DRAFT" || status === "NEEDS FOUNDER APPROVAL";
}

function asStatus(value: string): DraftStatus | null {
  return DRAFT_STATUSES.includes(value as DraftStatus) ? value as DraftStatus : null;
}

function evidencedOrganization(row: StoredInboundMail): string {
  const match = `${row.subject}\n${row.textBody}`.match(/\borganization:\s*([A-Za-z0-9][A-Za-z0-9&' -]{0,80})/i);
  const name = match?.[1]?.trim();
  return name || "unavailable";
}

function whatTheyWant(row: StoredInboundMail): string {
  const compact = row.textBody.replace(/\s+/g, " ").trim();
  return (compact || row.subject).slice(0, 180);
}

function contextSummary(row: StoredInboundMail): string {
  const body = row.textBody.replace(/\s+/g, " ").trim().slice(0, 240);
  return body ? `${row.subject} — ${body}` : row.subject;
}

function riskLine(row: StoredInboundMail): string {
  if (row.flags.payment || row.flags.approval || row.flags.fundingOpportunity) {
    return "Risk: the stored message concerns funds, payment, or approval. This draft makes no commitment.";
  }
  if (row.flags.deadline || row.flags.meeting || row.flags.partnershipRequest) {
    return "Risk: the stored message concerns a date, meeting, or partnership. This draft makes no commitment.";
  }
  return "No new commitment is included in this draft.";
}

function safeContextNote(note: string | null): string {
  const text = (note || "").replace(/\s+/g, " ").trim();
  if (!text) return UNAVAILABLE;
  if (/secret|password|token|api[_-]?key|bearer\s/i.test(text)) return UNAVAILABLE;
  return text.slice(0, 400);
}

function proposedReply(row: StoredInboundMail, hqContext: string): string {
  const who = row.senderName || row.senderAddress;
  const deadlineLine = row.deadline
    ? `The stored deadline is ${row.deadline}.`
    : "No deadline is stored on this message.";
  return [
    `Hello ${who},`,
    `Thank you for your message about "${row.subject}".`,
    "I will review it with the Founder before any commitment.",
    deadlineLine,
    hqContext,
    "This reply is a draft and has not been sent.",
  ].join("\n");
}

function buildSummary(row: StoredInboundMail, replyText: string): ReplyDraftSummary {
  const who = row.senderName ? `${row.senderName} <${row.senderAddress}>` : row.senderAddress;
  return {
    whoSent: who,
    organization: evidencedOrganization(row),
    whatTheyWant: whatTheyWant(row),
    priority: row.urgency === "high" || row.founderAttention ? "high" : "normal",
    deadline: row.deadline || "unavailable",
    recommendedResponse: replyText.slice(0, 180),
    risk: riskLine(row),
  };
}

function rowToDraft(row: DraftRow): InboundReplyDraft | null {
  const status = asStatus(row.status);
  if (!status) return null;
  let summary: ReplyDraftSummary;
  try {
    summary = JSON.parse(row.summary_json) as ReplyDraftSummary;
  } catch {
    return null;
  }
  return {
    inboundId: row.inbound_id,
    status,
    sent: false,
    activeApproval: activeApproval(status),
    providerMessageId: row.provider_message_id,
    threadId: row.thread_id,
    senderName: row.sender_name,
    senderAddress: row.sender_address,
    subject: row.subject,
    contextSummary: row.context_summary,
    linked: row.linked_id && row.linked_kind ? { kind: row.linked_kind, id: row.linked_id } : null,
    replyText: row.reply_text,
    summary,
    hqContext: row.hq_context,
  };
}

async function ensureDraftTable(db: MailDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_inbound_reply_drafts (
      inbound_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      reply_text TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      provider_message_id TEXT NOT NULL,
      thread_id TEXT,
      sender_name TEXT,
      sender_address TEXT NOT NULL,
      subject TEXT NOT NULL,
      context_summary TEXT NOT NULL,
      linked_kind TEXT,
      linked_id TEXT,
      hq_context TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

async function readDraft(db: MailDb, inboundId: string): Promise<InboundReplyDraft | null> {
  await ensureDraftTable(db);
  const row = await db.get<DraftRow>("SELECT * FROM hq_inbound_reply_drafts WHERE inbound_id = ?", inboundId);
  return row ? rowToDraft(row) : null;
}

function decision(draft: InboundReplyDraft) {
  return { sent: false as const, status: draft.status, activeApproval: draft.activeApproval, draft };
}

export async function generateInboundReplyDraft(
  db: MailDb,
  inboundId: string,
  readContext: DraftContextReader = defaultInboundDraftContext,
): Promise<InboundReplyDraft | null> {
  const row = await getInboundBusinessMail(db, inboundId);
  if (!row) return null;
  let note: string | null = null;
  try {
    note = await readContext({ category: row.category, linked: row.linked });
  } catch {
    note = null;
  }
  const hqContext = safeContextNote(note);
  const replyText = proposedReply(row, hqContext);
  const summary = buildSummary(row, replyText);
  const now = new Date().toISOString();
  await ensureDraftTable(db);
  await db.run(
    `INSERT INTO hq_inbound_reply_drafts (
      inbound_id, status, reply_text, summary_json, provider_message_id, thread_id, sender_name, sender_address,
      subject, context_summary, linked_kind, linked_id, hq_context, created_at, updated_at
    ) VALUES (?, 'NEEDS FOUNDER APPROVAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(inbound_id) DO UPDATE SET
      status = 'NEEDS FOUNDER APPROVAL',
      reply_text = excluded.reply_text,
      summary_json = excluded.summary_json,
      provider_message_id = excluded.provider_message_id,
      thread_id = excluded.thread_id,
      sender_name = excluded.sender_name,
      sender_address = excluded.sender_address,
      subject = excluded.subject,
      context_summary = excluded.context_summary,
      linked_kind = excluded.linked_kind,
      linked_id = excluded.linked_id,
      hq_context = excluded.hq_context,
      updated_at = excluded.updated_at`,
    row.id,
    replyText,
    JSON.stringify(summary),
    row.providerMessageId,
    row.threadId,
    row.senderName,
    row.senderAddress,
    row.subject,
    contextSummary(row),
    row.linked?.kind ?? null,
    row.linked?.id ?? null,
    hqContext,
    now,
    now,
  );
  return readDraft(db, row.id);
}

async function updateDraft(
  db: MailDb,
  inboundId: string,
  status: DraftStatus,
  replyText?: string,
): Promise<InboundReplyDraft | null> {
  const current = await readDraft(db, inboundId);
  if (!current) return null;
  const nextText = replyText ?? current.replyText;
  const summary = { ...current.summary, recommendedResponse: nextText.slice(0, 180) };
  await db.run(
    `UPDATE hq_inbound_reply_drafts
     SET status = ?, reply_text = ?, summary_json = ?, updated_at = ?
     WHERE inbound_id = ?`,
    status,
    nextText,
    JSON.stringify(summary),
    new Date().toISOString(),
    inboundId,
  );
  return readDraft(db, inboundId);
}

export async function approveInboundReplyDraft(db: MailDb, inboundId: string): Promise<InboundReplyDraft | null> {
  return updateDraft(db, inboundId, "FOUNDER APPROVED");
}

export async function editInboundReplyDraft(db: MailDb, inboundId: string, replyText: string): Promise<InboundReplyDraft | null> {
  const current = await readDraft(db, inboundId);
  if (!current) return null;
  if (!activeApproval(current.status)) return current;
  return updateDraft(db, inboundId, current.status, replyText);
}

export async function rejectInboundReplyDraft(db: MailDb, inboundId: string): Promise<InboundReplyDraft | null> {
  return updateDraft(db, inboundId, "REJECTED");
}

export async function saveInboundReplyDraftForLater(db: MailDb, inboundId: string): Promise<InboundReplyDraft | null> {
  return updateDraft(db, inboundId, "SAVED FOR LATER");
}

function sessionDenied(req: Request, res: Response): boolean {
  const status = inboundMailSessionStatus(req.hqUser);
  if (!status) return false;
  res.status(status).json({ error: status === 401 ? "Authentication required" : "Founder session required", sent: false });
  return true;
}

export async function generateInboundReplyDraftHttp(
  req: Request,
  res: Response,
  options: { db?: MailDb; readContext?: DraftContextReader } = {},
): Promise<void> {
  if (sessionDenied(req, res)) return;
  const database = options.db ?? await (await import("../db")).getDb();
  const draft = await generateInboundReplyDraft(database, req.params.id, options.readContext);
  if (!draft) {
    res.status(404).json({ error: "Inbound message not found", sent: false });
    return;
  }
  res.json(decision(draft));
}

export async function reviewInboundReplyDraftHttp(
  req: Request,
  res: Response,
  options: { db?: MailDb } = {},
): Promise<void> {
  if (sessionDenied(req, res)) return;
  const action = typeof req.body?.action === "string" ? req.body.action : "";
  const database = options.db ?? await (await import("../db")).getDb();
  const inboundId = req.params.id;
  if (action === "edit") {
    const replyText = typeof req.body?.replyText === "string" ? req.body.replyText.trim() : "";
    if (!replyText) {
      res.status(400).json({ error: "replyText is required", sent: false });
      return;
    }
    const current = await readDraft(database, inboundId);
    if (!current) {
      res.status(404).json({ error: "Draft not found", sent: false });
      return;
    }
    if (!activeApproval(current.status)) {
      res.status(409).json({ error: "Draft is not open for editing", sent: false, status: current.status });
      return;
    }
    const draft = await editInboundReplyDraft(database, inboundId, replyText);
    if (!draft) {
      res.status(404).json({ error: "Draft not found", sent: false });
      return;
    }
    res.json(decision(draft));
    return;
  }
  const next = action === "approve"
    ? await approveInboundReplyDraft(database, inboundId)
    : action === "reject"
      ? await rejectInboundReplyDraft(database, inboundId)
      : action === "save-for-later"
        ? await saveInboundReplyDraftForLater(database, inboundId)
        : undefined;
  if (next === undefined) {
    res.status(400).json({ error: "action must be approve, edit, reject, or save-for-later", sent: false });
    return;
  }
  if (!next) {
    res.status(404).json({ error: "Draft not found", sent: false });
    return;
  }
  res.json(decision(next));
}
