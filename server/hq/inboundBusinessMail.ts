/**
 * Read-only inbound business mail.
 * A later Founder-approved Postmark inbound webhook or dedicated mailbox poll
 * can call ingestInboundBusinessMail. This module does not connect either provider
 * and does not send, reply, forward, or delete mail.
 */
import crypto from "crypto";
import type { Request, Response } from "express";
import { getDb } from "../db";

export const INBOUND_CATEGORIES = [
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
] as const;

export type InboundCategory = (typeof INBOUND_CATEGORIES)[number];

export type InboundAttachmentMeta = {
  filename: string;
  contentType: string;
  size: number;
};

export type InboundMailInput = {
  providerMessageId: string;
  threadId?: string | null;
  senderName?: string | null;
  senderAddress: string;
  recipient: string;
  subject: string;
  textBody: string;
  receivedAt: string;
  attachments?: Array<Record<string, unknown>>;
};

export type KnownRecord = { kind: string; id: string };

export type InboundFlags = {
  deadline: boolean;
  meeting: boolean;
  fundingOpportunity: boolean;
  payment: boolean;
  approval: boolean;
  partnershipRequest: boolean;
};

export type ClassifiedInboundMail = {
  category: InboundCategory;
  unmatched: boolean;
  urgency: "high" | "normal";
  founderAttention: boolean;
  flags: InboundFlags;
  deadline: string | null;
  linked: { kind: string; id: string } | null;
  attachments: InboundAttachmentMeta[];
  awaitingReply: boolean;
  followUp: boolean;
};

export type StoredInboundMail = ClassifiedInboundMail & {
  id: string;
  providerMessageId: string;
  threadId: string | null;
  senderName: string | null;
  senderAddress: string;
  recipient: string;
  subject: string;
  textBody: string;
  receivedAt: string;
  draftSuggestion: string | null;
  readAt: string | null;
};

export type MailDb = {
  exec(sql: string): Promise<unknown>;
  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<unknown>;
};

const CATEGORY_RULES: Array<{ category: InboundCategory; patterns: RegExp[] }> = [
  { category: "Schools", patterns: [/\bschool\b/i, /\bprincipal\b/i, /\bschool district\b/i, /\bsuperintendent\b/i] },
  { category: "Grants", patterns: [/\bgrants?\.gov\b/i, /\bgrant\b/i, /\bnofo\b/i, /\bfunding opportunity\b/i] },
  { category: "Barbers", patterns: [/\bbarber\b/i, /\bhaircut\b/i, /\bbarbershop\b/i] },
  { category: "Partnerships", patterns: [/\bpartnership\b/i, /\bpartner with\b/i] },
  { category: "Mentorship", patterns: [/\bmentorship\b/i, /\bmentor\b/i] },
  { category: "HR", patterns: [/\bhiring\b/i, /\bjob application\b/i, /\bemployee handbook\b/i] },
  { category: "Finance", patterns: [/\binvoice\b/i, /\bpayment\b/i, /\bbudget\b/i] },
  { category: "Software", patterns: [/\bsoftware\b/i, /\bbug report\b/i, /\bdeploy\b/i] },
  { category: "Media", patterns: [/\bpress\b/i, /\bmedia coverage\b/i] },
  { category: "Music", patterns: [/\bmusic\b/i, /\bsong\b/i, /\balbum\b/i] },
  { category: "Legal", patterns: [/\battorney\b/i, /\blawsuit\b/i, /\blegal\b/i] },
  { category: "Support", patterns: [/\bsupport ticket\b/i, /\bhelp desk\b/i] },
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export async function ensureInboundBusinessMailTables(db: MailDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_inbound_business_mail (
      id TEXT PRIMARY KEY,
      provider_message_id TEXT NOT NULL UNIQUE,
      thread_id TEXT,
      sender_name TEXT,
      sender_address TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      text_body TEXT NOT NULL,
      received_at TEXT NOT NULL,
      category TEXT NOT NULL,
      category_unmatched INTEGER NOT NULL DEFAULT 0,
      urgency TEXT NOT NULL,
      founder_attention INTEGER NOT NULL DEFAULT 0,
      flag_deadline INTEGER NOT NULL DEFAULT 0,
      deadline_on TEXT,
      flag_meeting INTEGER NOT NULL DEFAULT 0,
      flag_funding_opportunity INTEGER NOT NULL DEFAULT 0,
      flag_payment INTEGER NOT NULL DEFAULT 0,
      flag_approval INTEGER NOT NULL DEFAULT 0,
      flag_partnership INTEGER NOT NULL DEFAULT 0,
      awaiting_reply INTEGER NOT NULL DEFAULT 0,
      follow_up INTEGER NOT NULL DEFAULT 0,
      linked_kind TEXT,
      linked_id TEXT,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      draft_suggestion TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

export function explicitDeadline(text: string): string | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const named = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i);
  if (!named) return null;
  const month = MONTHS.indexOf(named[1].toLowerCase()) + 1;
  const day = Number(named[2]);
  if (month < 1 || day < 1 || day > 31) return null;
  return `${named[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function classifyInboundMail(input: { subject: string; textBody: string; senderAddress: string }, known: KnownRecord[] = []): ClassifiedInboundMail {
  const text = `${input.subject}\n${input.textBody}\n${input.senderAddress}`;
  const scores = new Map<InboundCategory, number>();
  for (const rule of CATEGORY_RULES) {
    const hits = rule.patterns.filter((pattern) => pattern.test(text)).length;
    if (hits > 0) scores.set(rule.category, hits);
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];
  const weak = !top || Boolean(second && second[1] === top[1]);
  const category: InboundCategory = weak ? "General" : top[0];
  const flags: InboundFlags = {
    deadline: /\bdeadline\b/i.test(text) || /\bdue on\b/i.test(text) || /\bdue by\b/i.test(text),
    meeting: /\bmeeting\b/i.test(text),
    fundingOpportunity: /\bfunding opportunity\b/i.test(text) || /\bgrant opportunity\b/i.test(text),
    payment: /\bpayment\b/i.test(text) || /\binvoice\b/i.test(text),
    approval: /\bapproval\b/i.test(text) || /\bapprove\b/i.test(text),
    partnershipRequest: /\bpartnership\b/i.test(text),
  };
  return {
    category,
    unmatched: weak,
    urgency: /\burgent\b/i.test(text) || /\basap\b/i.test(text) || /\bimmediately\b/i.test(text) ? "high" : "normal",
    founderAttention: /\bneeds founder attention\b/i.test(text) || /\bneeds your attention\b/i.test(text) || /\bfounder attention\b/i.test(text),
    flags,
    deadline: flags.deadline ? explicitDeadline(text) : null,
    linked: correlateInboundMail(text, known),
    attachments: [],
    awaitingReply: /\bplease reply\b/i.test(text) || /\bawaiting your reply\b/i.test(text),
    followUp: /\bfollow up\b/i.test(text) || /\bfollow-up\b/i.test(text),
  };
}

export function correlateInboundMail(text: string, known: KnownRecord[]): { kind: string; id: string } | null {
  const hits = known.filter((record) => record.id.length >= 4 && text.includes(record.id));
  if (hits.length !== 1) return null;
  return { kind: hits[0].kind, id: hits[0].id };
}

export function attachmentMetadata(raw: Array<Record<string, unknown>> | undefined): InboundAttachmentMeta[] {
  if (!raw?.length) return [];
  return raw.map((item) => ({
    filename: String(item.filename || item.name || "attachment"),
    contentType: String(item.contentType || item.content_type || "application/octet-stream"),
    size: Number(item.size || item.contentLength || 0) || 0,
  }));
}

type Row = {
  id: string;
  provider_message_id: string;
  thread_id: string | null;
  sender_name: string | null;
  sender_address: string;
  recipient: string;
  subject: string;
  text_body: string;
  received_at: string;
  category: string;
  category_unmatched: number;
  urgency: string;
  founder_attention: number;
  flag_deadline: number;
  deadline_on: string | null;
  flag_meeting: number;
  flag_funding_opportunity: number;
  flag_payment: number;
  flag_approval: number;
  flag_partnership: number;
  awaiting_reply: number;
  follow_up: number;
  linked_kind: string | null;
  linked_id: string | null;
  attachments_json: string;
  draft_suggestion: string | null;
  read_at: string | null;
};

function rowToStored(row: Row): StoredInboundMail {
  let attachments: InboundAttachmentMeta[] = [];
  try {
    const parsed = JSON.parse(row.attachments_json) as InboundAttachmentMeta[];
    attachments = Array.isArray(parsed) ? parsed.map((item) => ({
      filename: String(item.filename || ""),
      contentType: String(item.contentType || ""),
      size: Number(item.size) || 0,
    })) : [];
  } catch {
    attachments = [];
  }
  return {
    id: row.id,
    providerMessageId: row.provider_message_id,
    threadId: row.thread_id,
    senderName: row.sender_name,
    senderAddress: row.sender_address,
    recipient: row.recipient,
    subject: row.subject,
    textBody: row.text_body,
    receivedAt: row.received_at,
    category: row.category as InboundCategory,
    unmatched: row.category_unmatched === 1,
    urgency: row.urgency === "high" ? "high" : "normal",
    founderAttention: row.founder_attention === 1,
    flags: {
      deadline: row.flag_deadline === 1,
      meeting: row.flag_meeting === 1,
      fundingOpportunity: row.flag_funding_opportunity === 1,
      payment: row.flag_payment === 1,
      approval: row.flag_approval === 1,
      partnershipRequest: row.flag_partnership === 1,
    },
    deadline: row.deadline_on,
    linked: row.linked_id && row.linked_kind ? { kind: row.linked_kind, id: row.linked_id } : null,
    attachments,
    awaitingReply: row.awaiting_reply === 1,
    followUp: row.follow_up === 1,
    draftSuggestion: row.draft_suggestion,
    readAt: row.read_at,
  };
}

export function toPublicInboundMail(row: StoredInboundMail) {
  return {
    id: row.id,
    messageId: row.providerMessageId,
    threadId: row.threadId,
    senderName: row.senderName,
    senderAddress: row.senderAddress,
    recipient: row.recipient,
    subject: row.subject,
    textBody: row.textBody,
    receivedAt: row.receivedAt,
    category: row.category,
    unmatched: row.unmatched,
    urgency: row.urgency,
    founderAttention: row.founderAttention,
    flags: row.flags,
    deadline: row.deadline,
    linked: row.linked,
    attachments: row.attachments,
    draftSuggestion: row.draftSuggestion,
    readAt: row.readAt,
    awaitingReply: row.awaitingReply,
    followUp: row.followUp,
  };
}

export async function ingestInboundBusinessMail(
  db: MailDb,
  input: InboundMailInput,
  known: KnownRecord[] = [],
): Promise<{ created: boolean; row: StoredInboundMail }> {
  await ensureInboundBusinessMailTables(db);
  const existing = await db.get<Row>(
    "SELECT * FROM hq_inbound_business_mail WHERE provider_message_id = ?",
    input.providerMessageId,
  );
  if (existing) return { created: false, row: rowToStored(existing) };

  const classified = classifyInboundMail(input, known);
  const attachments = attachmentMetadata(input.attachments);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO hq_inbound_business_mail (
      id, provider_message_id, thread_id, sender_name, sender_address, recipient, subject, text_body, received_at,
      category, category_unmatched, urgency, founder_attention,
      flag_deadline, deadline_on, flag_meeting, flag_funding_opportunity, flag_payment, flag_approval, flag_partnership,
      awaiting_reply, follow_up, linked_kind, linked_id, attachments_json, draft_suggestion, read_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    id,
    input.providerMessageId,
    input.threadId ?? null,
    input.senderName ?? null,
    input.senderAddress,
    input.recipient,
    input.subject,
    input.textBody,
    input.receivedAt,
    classified.category,
    classified.unmatched ? 1 : 0,
    classified.urgency,
    classified.founderAttention ? 1 : 0,
    classified.flags.deadline ? 1 : 0,
    classified.deadline,
    classified.flags.meeting ? 1 : 0,
    classified.flags.fundingOpportunity ? 1 : 0,
    classified.flags.payment ? 1 : 0,
    classified.flags.approval ? 1 : 0,
    classified.flags.partnershipRequest ? 1 : 0,
    classified.awaitingReply ? 1 : 0,
    classified.followUp ? 1 : 0,
    classified.linked?.kind ?? null,
    classified.linked?.id ?? null,
    JSON.stringify(attachments),
    now,
  );
  const stored = await db.get<Row>("SELECT * FROM hq_inbound_business_mail WHERE id = ?", id);
  if (!stored) throw new Error("Inbound mail was not stored");
  return { created: true, row: rowToStored(stored) };
}

export type InboundView = "inbound" | "unread" | "urgent" | "needs-founder" | "awaiting-reply" | "drafts" | "follow-up" | "deadlines";

export function filterInboundMail(rows: StoredInboundMail[], view: InboundView): StoredInboundMail[] {
  switch (view) {
    case "unread":
      return rows.filter((row) => !row.readAt);
    case "urgent":
      return rows.filter((row) => row.urgency === "high");
    case "needs-founder":
      return rows.filter((row) => row.founderAttention);
    case "awaiting-reply":
      return rows.filter((row) => row.awaitingReply);
    case "drafts":
      return rows.filter((row) => Boolean(row.draftSuggestion));
    case "follow-up":
      return rows.filter((row) => row.followUp);
    case "deadlines":
      return rows.filter((row) => row.flags.deadline);
    default:
      return rows;
  }
}

export async function listInboundBusinessMail(db: MailDb, view: InboundView = "inbound"): Promise<StoredInboundMail[]> {
  await ensureInboundBusinessMailTables(db);
  const rows = await db.all<Row>("SELECT * FROM hq_inbound_business_mail ORDER BY received_at DESC");
  return filterInboundMail(rows.map(rowToStored), view);
}

export async function getInboundBusinessMail(db: MailDb, id: string): Promise<StoredInboundMail | null> {
  await ensureInboundBusinessMailTables(db);
  const row = await db.get<Row>("SELECT * FROM hq_inbound_business_mail WHERE id = ?", id);
  return row ? rowToStored(row) : null;
}

export async function saveInboundDraftSuggestion(db: MailDb, id: string, suggestion: string): Promise<StoredInboundMail | null> {
  await ensureInboundBusinessMailTables(db);
  const existing = await db.get<Row>("SELECT id FROM hq_inbound_business_mail WHERE id = ?", id);
  if (!existing) return null;
  await db.run("UPDATE hq_inbound_business_mail SET draft_suggestion = ? WHERE id = ?", suggestion, id);
  const stored = await db.get<Row>("SELECT * FROM hq_inbound_business_mail WHERE id = ?", id);
  return stored ? rowToStored(stored) : null;
}

export function inboundMailSessionStatus(user?: { role?: string } | null): 401 | 403 | null {
  if (!user) return 401;
  const role = String(user.role || "").toLowerCase();
  if (role === "founder" || role === "owner") return null;
  return 403;
}

function viewFromQuery(value: unknown): InboundView {
  const views: InboundView[] = ["inbound", "unread", "urgent", "needs-founder", "awaiting-reply", "drafts", "follow-up", "deadlines"];
  return views.includes(value as InboundView) ? value as InboundView : "inbound";
}

export async function listInboundMailHttp(req: Request, res: Response, db?: MailDb): Promise<void> {
  const status = inboundMailSessionStatus(req.hqUser);
  if (status) {
    res.status(status).json({ error: status === 401 ? "Authentication required" : "Founder session required" });
    return;
  }
  const database = db ?? await getDb();
  const rows = await listInboundBusinessMail(database, viewFromQuery(req.query.view));
  res.json({ readOnly: true, messages: rows.map(toPublicInboundMail) });
}

export async function ingestInboundMailHttp(req: Request, res: Response, db?: MailDb, known: KnownRecord[] = []): Promise<void> {
  const status = inboundMailSessionStatus(req.hqUser);
  if (status) {
    res.status(status).json({ error: status === 401 ? "Authentication required" : "Founder session required" });
    return;
  }
  const body = req.body ?? {};
  if (!body.providerMessageId || !body.senderAddress || !body.recipient || !body.subject || body.textBody == null || !body.receivedAt) {
    res.status(400).json({ error: "providerMessageId, senderAddress, recipient, subject, textBody, and receivedAt are required" });
    return;
  }
  const database = db ?? await getDb();
  const result = await ingestInboundBusinessMail(database, {
    providerMessageId: String(body.providerMessageId),
    threadId: body.threadId ? String(body.threadId) : null,
    senderName: body.senderName ? String(body.senderName) : null,
    senderAddress: String(body.senderAddress),
    recipient: String(body.recipient),
    subject: String(body.subject),
    textBody: String(body.textBody),
    receivedAt: String(body.receivedAt),
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
  }, known);
  res.status(result.created ? 201 : 200).json({ created: result.created, message: toPublicInboundMail(result.row) });
}

export function isInboundMailQuestion(question: string): boolean {
  const text = question.toLowerCase();
  return (
    /important email/.test(text)
    || /from a school/.test(text)
    || /school email/.test(text)
    || /grant email/.test(text)
    || /needs my attention/.test(text)
    || /summarize this email/.test(text)
  );
}

function lineFor(row: StoredInboundMail): string {
  return `${row.receivedAt} ${row.senderAddress}: ${row.subject} [${row.category}]`;
}

export function answerInboundMailQuestion(question: string, rows: StoredInboundMail[] | null, now = new Date()): string {
  if (!rows) return "Inbound mail is unavailable.";
  const text = question.toLowerCase();
  if (/summarize this email/.test(text)) {
    const idMatch = question.match(/[A-Za-z0-9][A-Za-z0-9._:-]{3,}/g) ?? [];
    const row = rows.find((item) => idMatch.some((token) => token === item.id || token === item.providerMessageId));
    if (!row) return "Unavailable. Name the stored message to summarize.";
    return `${row.subject}\nFrom ${row.senderAddress}\n${row.textBody}`;
  }
  const today = now.toISOString().slice(0, 10);
  let matched: StoredInboundMail[] = [];
  if (/important email/.test(text)) {
    matched = rows.filter((row) => row.receivedAt.slice(0, 10) === today && (row.founderAttention || row.urgency === "high"));
  } else if (/school/.test(text)) {
    matched = rows.filter((row) => row.category === "Schools");
  } else if (/grant email/.test(text)) {
    matched = rows.filter((row) => row.category === "Grants");
  } else if (/needs my attention/.test(text)) {
    matched = rows.filter((row) => row.founderAttention);
  }
  if (!matched.length) return "None.";
  return matched.slice(0, 5).map(lineFor).join("\n");
}

export async function answerStoredInboundMailQuestion(question: string, now = new Date()): Promise<string> {
  try {
    const db = await getDb();
    const rows = await listInboundBusinessMail(db, "inbound");
    return answerInboundMailQuestion(question, rows, now);
  } catch {
    return "Inbound mail is unavailable.";
  }
}
