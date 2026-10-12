/**
 * Founder-approved grant outreach.
 * Aura may draft. A draft is not sent until the Founder approves that exact body.
 * The global outbound flag is not set here and is not the grant-outreach send switch.
 * Approved grant mail uses the existing Postmark outbound stream. A Resend key does not
 * select Resend for this path.
 * A send may proceed only when Founder approval matches the recipient, subject,
 * message body, draft version, draft id, and each attachment checksum.
 * A draft that requires attachments is not sent as text alone.
 * The Stone inquiry already sent on 2026-10-11 is a permanent duplicate and cannot pass.
 * An accepted or uncertain Postmark attempt is reserved in the local grant store and is not retried.
 */
import type { Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { inboundMailSessionStatus, type MailDb } from "./inboundBusinessMail";
import { SERVICE_MAILBOX, outboundMailSendEnabled } from "./inboundOutboundMail";
import { sendAuraGrantViaPostmark, headquartersMailReadiness, type PostmarkPdfAttachment } from "../lib/transactionalEmail";

export const GRANT_OUTREACH_MAILBOX = SERVICE_MAILBOX;

export const STONE_INQUIRY_STATUS =
  "STATUS: ALREADY SENT ONCE VIA PERSONAL ICLOUD AT 6:19:45 PM EDT. AURA SEND: BLOCKED AS DUPLICATE. NOT A REQUEST TO SEND AGAIN.";

export const STONE_INQUIRY_RECIPIENT = "elizabeth@stonefdnnj.org";
export const STONE_INQUIRY_SUBJECT = "Introductory questions from IFCDC in Asbury Park";
export const STONE_INQUIRY_PURPOSE = "stone-foundation-eligibility-inquiry";
export const STONE_INQUIRY_SENT_AT = "2026-10-11T22:19:45.000Z";
export const STONE_INQUIRY_SENT_DISPLAY = "Sunday, October 11, 2026, 6:19:45 PM EDT";
export const STONE_INQUIRY_MESSAGE_ID = "3441E551-3FAD-4C16-AD1E-23F3F6D23FE8@icloud.com";
export const STONE_FOLLOW_UP_DATE = "2026-10-23";
export const STONE_FOLLOW_UP_PURPOSE = "stone-foundation-eligibility-inquiry-follow-up";

export const STONE_INQUIRY_BODY = `Dear Elizabeth Murphy,

I am Fahreal Allah of Imperial Foundation Community Development Center (IFCDC), a New Jersey 501(c)(3) public charity operating in Asbury Park and serving Monmouth County. Our EIN is 47-3125994. Our address is 1215 Springwood Ave, Suite 28, Asbury Park, NJ 07712. The November 6, 2025 IRS letter states 501(c)(3) and 509(a)(2) status, effective October 21, 2025.

Our existing work is in-person barber-chair mentorship. That is my own account of work already underway: conversation and guidance in the chair. We are also proposing an expansion into structured youth mentorship, workforce readiness, entrepreneurship, and online classes. The expansion is proposed.

I would welcome a brief exploratory conversation about whether these activities align with the Stone Foundation’s funding priorities.

Please tell me which application cycle is next, including the calendar year; what supporting documents a first-time nonprofit applicant must provide; and whether staffing, technology, accessibility, and administrative expenses may be included.

Thank you,

Fahreal Allah
Imperial Foundation Community Development Center (IFCDC)
1215 Springwood Ave, Suite 28
Asbury Park, NJ 07712`;

export const GRAPH_DELIVERY_TEST_RECIPIENT = "service@ifcdc.org";
export const GRAPH_DELIVERY_TEST_SUBJECT = "IFCDC HQ — Microsoft Graph delivery test — NOT A FUNDER EMAIL";
export const GRAPH_DELIVERY_TEST_PURPOSE = "graph-delivery-test";
export const GRAPH_DELIVERY_TEST_STATUS = "NOT SENT — AWAITING FOUNDER APPROVAL";
export const GRAPH_DELIVERY_TEST_BODY = `This is an internal IFCDC Headquarters delivery test.

It is not a grant application.
It is not a message to a funder.
It asks for no money and makes no commitment.

If this message arrives at service@ifcdc.org, Microsoft Graph accepted a send from the IFCDC mailbox to itself.

No reply is required.

IFCDC Headquarters
Imperial Foundation Community Development Center`;

export const POSTMARK_DELIVERY_TEST_RECIPIENT = "service@ifcdc.org";
export const POSTMARK_DELIVERY_TEST_SUBJECT = "IFCDC HQ — Internal Postmark Delivery Test — NOT A FUNDER EMAIL";
export const POSTMARK_DELIVERY_TEST_PURPOSE = "postmark-delivery-test";
export const POSTMARK_DELIVERY_TEST_STATUS = "NOT SENT";
export const POSTMARK_DELIVERY_TEST_BODY =
  "This is an internal delivery verification for IFCDC Headquarters and Aura. No grant application or funding request is being submitted.";

export const STONE_FOLLOW_UP_BODY = `Dear Elizabeth Murphy,

I wrote on Sunday, October 11, 2026, with introductory questions from Imperial Foundation Community Development Center (IFCDC) in Asbury Park. I have not yet seen a reply.

I am still hoping for a brief conversation about whether our in-person barber-chair mentorship, and a proposed expansion into structured youth mentorship, workforce readiness, entrepreneurship, and online classes, align with the Stone Foundation’s funding priorities. The expansion is proposed.

If you are able, please also tell me which application cycle is next, including the calendar year; what supporting documents a first-time nonprofit applicant must provide; and whether staffing, technology, accessibility, and administrative expenses may be included.

Thank you,

Fahreal Allah
Imperial Foundation Community Development Center (IFCDC)
1215 Springwood Ave, Suite 28
Asbury Park, NJ 07712`;

export type GrantOutreachStatus =
  | "NEEDS FOUNDER APPROVAL"
  | "FOUNDER APPROVED"
  | "ALREADY SENT OUTSIDE AURA"
  | "NEEDS FOUNDER DECISION"
  | "NOT SENT";

export type FounderExactApproval = {
  recorded: boolean;
  exactBody: string;
  recipient: string;
  subject: string;
  purpose: string;
  draftId: string;
  draftVersion: number;
  authorizedBy: string;
  authorizedAt: string;
  attachments?: GrantAttachmentSpec[];
};

export type GrantAttachmentSpec = {
  name: string;
  sha256: string;
};

export type GrantAttachmentPayload = {
  name: string;
  contentBase64: string;
};

export type PriorGrantTransmission = {
  recipient: string;
  purpose: string;
  body: string;
  subject: string;
  sentAt: string;
  channel: string;
  messageId: string | null;
};

export type GrantOutreachDraft = {
  id: string;
  version: number;
  mailbox: typeof GRANT_OUTREACH_MAILBOX;
  recipient: string;
  subject: string;
  body: string;
  purpose: string;
  status: GrantOutreachStatus;
  banner: string | null;
  founderApproval: FounderExactApproval | null;
  attachments?: GrantAttachmentSpec[];
  grantOutreachSendEnabled: boolean;
  sentByAura: false;
  applicationStatus: "NOT SUBMITTED";
  notBefore: string | null;
  deliveryResult: string | null;
};

export type GrantOutreachGateReason =
  | "allowed"
  | "unapproved"
  | "exact_text_mismatch"
  | "recipient_mismatch"
  | "subject_mismatch"
  | "version_mismatch"
  | "identity_mismatch"
  | "attachment_mismatch"
  | "attachment_missing"
  | "attachment_checksum_mismatch"
  | "attachment_encoding"
  | "attachment_corrupt"
  | "duplicate_already_sent"
  | "duplicate_in_progress"
  | "uncertain_awaiting_founder_decision"
  | "reservation_unavailable"
  | "send_switch_off"
  | "not_yet_due";

export type GrantOutreachGateResult = {
  allowed: boolean;
  sent: boolean;
  reason: GrantOutreachGateReason;
  network: boolean;
};

export type IncomingGrantReply = {
  id: string;
  relatedDraftId: string;
  from: string;
  subject: string;
  body: string;
  status: "NEEDS FOUNDER DECISION";
  sent: false;
  receivedAt: string;
};

type GateInput = {
  draft: GrantOutreachDraft;
  prior?: PriorGrantTransmission[];
  today?: string;
};

function email(value: string): string {
  return value.trim().toLowerCase();
}

function sameText(left: string, right: string): boolean {
  return left.trimEnd() === right.trimEnd();
}

export function stoneInquiryAlreadySent(): PriorGrantTransmission {
  return {
    recipient: STONE_INQUIRY_RECIPIENT,
    purpose: STONE_INQUIRY_PURPOSE,
    body: STONE_INQUIRY_BODY,
    subject: STONE_INQUIRY_SUBJECT,
    sentAt: STONE_INQUIRY_SENT_AT,
    channel: "personal-icloud-mail-app",
    messageId: STONE_INQUIRY_MESSAGE_ID,
  };
}

export function prepareStoneInquiryHeadquartersDraft(): GrantOutreachDraft {
  return {
    id: "stone-eligibility-inquiry-2026-10-11",
    version: 1,
    mailbox: GRANT_OUTREACH_MAILBOX,
    recipient: STONE_INQUIRY_RECIPIENT,
    subject: STONE_INQUIRY_SUBJECT,
    body: STONE_INQUIRY_BODY,
    purpose: STONE_INQUIRY_PURPOSE,
    status: "ALREADY SENT OUTSIDE AURA",
    banner: STONE_INQUIRY_STATUS,
    founderApproval: null,
    grantOutreachSendEnabled: false,
    sentByAura: false,
    applicationStatus: "NOT SUBMITTED",
    notBefore: null,
    deliveryResult: "Mail.app Sent on the iCloud account. Graph delivery was not observed. Acceptance beyond the Sent mailbox is unknown.",
  };
}

export function prepareGraphDeliveryTestDraft(): GrantOutreachDraft {
  return {
    id: "graph-delivery-test-2026-10-11",
    version: 1,
    mailbox: GRANT_OUTREACH_MAILBOX,
    recipient: GRAPH_DELIVERY_TEST_RECIPIENT,
    subject: GRAPH_DELIVERY_TEST_SUBJECT,
    body: GRAPH_DELIVERY_TEST_BODY,
    purpose: GRAPH_DELIVERY_TEST_PURPOSE,
    status: "NEEDS FOUNDER APPROVAL",
    banner: GRAPH_DELIVERY_TEST_STATUS,
    founderApproval: null,
    grantOutreachSendEnabled: false,
    sentByAura: false,
    applicationStatus: "NOT SUBMITTED",
    notBefore: null,
    deliveryResult: null,
  };
}

export function preparePostmarkDeliveryTestDraft(): GrantOutreachDraft {
  return {
    id: "postmark-delivery-test-2026-10-11",
    version: 1,
    mailbox: GRANT_OUTREACH_MAILBOX,
    recipient: POSTMARK_DELIVERY_TEST_RECIPIENT,
    subject: POSTMARK_DELIVERY_TEST_SUBJECT,
    body: POSTMARK_DELIVERY_TEST_BODY,
    purpose: POSTMARK_DELIVERY_TEST_PURPOSE,
    status: "NOT SENT",
    banner: POSTMARK_DELIVERY_TEST_STATUS,
    founderApproval: null,
    grantOutreachSendEnabled: false,
    sentByAura: false,
    applicationStatus: "NOT SUBMITTED",
    notBefore: null,
    deliveryResult: null,
  };
}

export function prepareStoneFollowUp(): GrantOutreachDraft {
  return {
    id: "stone-eligibility-inquiry-follow-up-2026-10-23",
    version: 1,
    mailbox: GRANT_OUTREACH_MAILBOX,
    recipient: STONE_INQUIRY_RECIPIENT,
    subject: "Following up on introductory questions from IFCDC",
    body: STONE_FOLLOW_UP_BODY,
    purpose: STONE_FOLLOW_UP_PURPOSE,
    status: "NOT SENT",
    banner: null,
    founderApproval: null,
    grantOutreachSendEnabled: false,
    sentByAura: false,
    applicationStatus: "NOT SUBMITTED",
    notBefore: STONE_FOLLOW_UP_DATE,
    deliveryResult: null,
  };
}

export function queueIncomingGrantReply(input: {
  id: string;
  relatedDraftId: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
}): IncomingGrantReply {
  return {
    id: input.id,
    relatedDraftId: input.relatedDraftId,
    from: input.from,
    subject: input.subject,
    body: input.body,
    status: "NEEDS FOUNDER DECISION",
    sent: false,
    receivedAt: input.receivedAt,
  };
}

export function headquartersCalendarDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function isDuplicate(draft: GrantOutreachDraft, prior: PriorGrantTransmission[]): boolean {
  const recipient = email(draft.recipient);
  return prior.some((sent) => {
    if (email(sent.recipient) !== recipient) return false;
    if (sent.purpose === draft.purpose) return true;
    return sameText(sent.body, draft.body);
  });
}

export function evaluateGrantOutreachSendGate(input: GateInput): GrantOutreachGateResult {
  const prior = [stoneInquiryAlreadySent(), ...(input.prior ?? [])];
  const draft = input.draft;
  const blocked = (reason: GrantOutreachGateReason): GrantOutreachGateResult => ({
    allowed: false,
    sent: false,
    reason,
    network: false,
  });

  if (draft.status === "ALREADY SENT OUTSIDE AURA" || isDuplicate(draft, prior)) {
    return blocked("duplicate_already_sent");
  }

  const deliveryTest = draft.id === "graph-delivery-test-2026-10-11"
    || draft.purpose === GRAPH_DELIVERY_TEST_PURPOSE
    || sameText(draft.body, GRAPH_DELIVERY_TEST_BODY)
    || draft.id === "postmark-delivery-test-2026-10-11"
    || draft.purpose === POSTMARK_DELIVERY_TEST_PURPOSE
    || sameText(draft.body, POSTMARK_DELIVERY_TEST_BODY);
  if (deliveryTest) {
    const postmarkTest = draft.id === "postmark-delivery-test-2026-10-11"
      || draft.purpose === POSTMARK_DELIVERY_TEST_PURPOSE
      || sameText(draft.body, POSTMARK_DELIVERY_TEST_BODY);
    const expectedRecipient = postmarkTest ? POSTMARK_DELIVERY_TEST_RECIPIENT : GRAPH_DELIVERY_TEST_RECIPIENT;
    const expectedSubject = postmarkTest ? POSTMARK_DELIVERY_TEST_SUBJECT : GRAPH_DELIVERY_TEST_SUBJECT;
    const expectedBody = postmarkTest ? POSTMARK_DELIVERY_TEST_BODY : GRAPH_DELIVERY_TEST_BODY;
    if (email(draft.recipient) !== email(expectedRecipient)) return blocked("recipient_mismatch");
    if (draft.subject !== expectedSubject || draft.body !== expectedBody) {
      return blocked("exact_text_mismatch");
    }
  }

  const approval = draft.founderApproval;
  if (!approval?.recorded || !approval.authorizedBy.trim() || !approval.authorizedAt.trim()) return blocked("unapproved");
  if (approval.exactBody !== draft.body) return blocked("exact_text_mismatch");
  if (email(approval.recipient) !== email(draft.recipient) || approval.purpose !== draft.purpose) {
    return blocked("recipient_mismatch");
  }
  if (approval.subject !== draft.subject) return blocked("subject_mismatch");
  if (approval.draftVersion !== draft.version) return blocked("version_mismatch");
  if (approval.draftId !== draft.id) return blocked("identity_mismatch");
  if (!sameAttachmentSpecs(approval.attachments ?? [], draft.attachments ?? [])) return blocked("attachment_mismatch");
  if (draft.grantOutreachSendEnabled !== true) return blocked("send_switch_off");
  if (draft.notBefore && (input.today ?? headquartersCalendarDate()) < draft.notBefore) return blocked("not_yet_due");

  return { allowed: true, sent: false, reason: "allowed", network: false };
}

export type GrantOutreachAuditRow = {
  id: string;
  action: string;
  source: string;
  eligibilityResult: string;
  detail: string;
  actorEmail: string;
  sourceVerifiedAt: string;
  createdAt: string;
  entityType: string;
  entityId: string;
};

export function stoneInquiryAuditRow(): GrantOutreachAuditRow {
  const draft = prepareStoneInquiryHeadquartersDraft();
  const detail = {
    recipient: draft.recipient,
    subject: draft.subject,
    exactMessage: draft.body,
    timestamp: STONE_INQUIRY_SENT_AT,
    timestampDisplay: STONE_INQUIRY_SENT_DISPLAY,
    messageId: STONE_INQUIRY_MESSAGE_ID,
    from: "Fahreal Allah <fahrealallah3@icloud.com>",
    deliveryResult: draft.deliveryResult,
    founderAuthorization: "Founder authorized one revised introductory inquiry on 2026-10-11. That transmission already occurred outside Aura. A second transmission is not approved.",
    auraSend: "BLOCKED AS DUPLICATE",
    applicationStatus: "NOT SUBMITTED",
    followUpStatus: "NOT SENT",
    followUpDate: STONE_FOLLOW_UP_DATE,
    banner: STONE_INQUIRY_STATUS,
    productionDbWritten: false,
  };
  return {
    id: "stone-eligibility-inquiry-2026-10-11-already-sent-outside-aura",
    action: "ALREADY_SENT_OUTSIDE_AURA_DO_NOT_RESEND",
    source: "mail.app-icloud",
    eligibilityResult: "NOT_SUBMITTED",
    detail: JSON.stringify(detail),
    actorEmail: "founder",
    sourceVerifiedAt: STONE_INQUIRY_SENT_AT,
    createdAt: STONE_INQUIRY_SENT_AT,
    entityType: "grant_outreach",
    entityId: draft.id,
  };
}

export async function recordGrantOutreachAudit(db: MailDb, row: GrantOutreachAuditRow): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_audit_events (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT,
      source TEXT,
      action TEXT NOT NULL,
      eligibility_result TEXT,
      score INTEGER,
      detail TEXT,
      actor_email TEXT,
      source_verified_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS grant_activity (
      id TEXT PRIMARY KEY,
      grant_entity_type TEXT NOT NULL,
      grant_entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await db.run(
    `INSERT INTO grant_audit_events (
      id, opportunity_id, source, action, eligibility_result, score, detail, actor_email, source_verified_at, created_at
    ) VALUES (?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    row.id,
    row.source,
    row.action,
    row.eligibilityResult,
    row.detail,
    row.actorEmail,
    row.sourceVerifiedAt,
    row.createdAt,
  );
  await db.run(
    `INSERT INTO grant_activity (
      id, grant_entity_type, grant_entity_id, action, detail, actor_email, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    `${row.id}-activity`,
    row.entityType,
    row.entityId,
    row.action,
    row.detail,
    row.actorEmail,
    row.createdAt,
  );
}

type GrantDeliveryRecord = GrantOutreachGateResult & {
  errorCode?: string | null;
  providerMessageId?: string | null;
  providerError?: string | null;
  provider: "postmark" | "none";
  contentHash?: string | null;
  messageKey?: string | null;
  deliveryStatus?: "not_sent" | "reserved" | "accepted" | "rejected" | "uncertain";
};

type ReservationHold =
  | { acquired: true; messageKey: string; contentHash: string }
  | { acquired: false; reason: GrantOutreachGateReason; messageKey: string; contentHash: string };

const NARRATIVE_ATTACHMENT = "MLK-2027-NARRATIVE-SUBMISSION.pdf";
const BUDGET_ATTACHMENT = "MLK-2027-BUDGET-FORM-SUBMISSION.pdf";

function attachmentChecksums(draft: GrantOutreachDraft): GrantAttachmentSpec[] {
  return [...(draft.attachments ?? [])]
    .map((item) => ({ name: item.name, sha256: item.sha256.trim().toLowerCase() }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function sameAttachmentSpecs(left: GrantAttachmentSpec[], right: GrantAttachmentSpec[]): boolean {
  const a = [...left].map((item) => ({ name: item.name, sha256: item.sha256.trim().toLowerCase() }))
    .sort((one, two) => one.name.localeCompare(two.name));
  const b = [...right].map((item) => ({ name: item.name, sha256: item.sha256.trim().toLowerCase() }))
    .sort((one, two) => one.name.localeCompare(two.name));
  if (a.length !== b.length) return false;
  return a.every((item, index) => item.name === b[index].name && item.sha256 === b[index].sha256);
}

export function grantAttachmentSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodePdfBase64(value: string): Buffer | null {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) return null;
  const bytes = Buffer.from(trimmed, "base64");
  if (!bytes.length || bytes.toString("base64") !== trimmed) return null;
  return bytes;
}

function extractPdfText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  const parts: string[] = [];
  for (const match of raw.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
    parts.push(match[0].slice(1, -1).replace(/\\([()\\])/g, "$1"));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function pdfPageCount(bytes: Buffer): number {
  const raw = bytes.toString("latin1");
  const declared = raw.match(/\/Count\s+(\d+)/);
  if (declared) return Number(declared[1]);
  return raw.match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
}

export function inspectGrantPdf(name: string, bytes: Buffer): GrantOutreachGateReason | null {
  if (!bytes.subarray(0, 5).toString("latin1").startsWith("%PDF")) return "attachment_corrupt";
  const text = extractPdfText(bytes);
  if (!text) return "attachment_corrupt";
  if (text.includes("DRAFT NOT SUBMITTED") || text.includes("Not a filing")) return "attachment_corrupt";
  const pages = pdfPageCount(bytes);
  if (name === NARRATIVE_ATTACHMENT) {
    if (pages !== 2) return "attachment_corrupt";
    const venue = text.includes("Asbury Park Senior Center")
      && text.includes("1201 Springwood Avenue")
      && text.includes("Suite 102")
      && text.includes("PROPOSED and NOT RESERVED");
    if (!venue) return "attachment_corrupt";
  }
  if (name === BUDGET_ATTACHMENT) {
    if (pages !== 1) return "attachment_corrupt";
    const budget = text.includes("$1,000")
      && text.includes("ESTIMATE")
      && text.includes("NOT A QUOTATION")
      && text.includes("NOT INCURRED");
    if (!budget) return "attachment_corrupt";
  }
  return null;
}

export function prepareApprovedGrantAttachments(
  specs: GrantAttachmentSpec[],
  payloads: GrantAttachmentPayload[],
): { ok: true; attachments: PostmarkPdfAttachment[] } | { ok: false; reason: GrantOutreachGateReason } {
  if (!specs.length) return { ok: true, attachments: [] };
  const prepared: PostmarkPdfAttachment[] = [];
  for (const spec of attachmentChecksums({ attachments: specs } as GrantOutreachDraft)) {
    const payload = payloads.find((item) => item.name === spec.name);
    if (!payload?.contentBase64.trim()) return { ok: false, reason: "attachment_missing" };
    const bytes = decodePdfBase64(payload.contentBase64);
    if (!bytes) return { ok: false, reason: "attachment_encoding" };
    if (grantAttachmentSha256(bytes) !== spec.sha256) return { ok: false, reason: "attachment_checksum_mismatch" };
    const problem = inspectGrantPdf(spec.name, bytes);
    if (problem) return { ok: false, reason: problem };
    prepared.push({
      Name: spec.name,
      Content: bytes.toString("base64"),
      ContentType: "application/pdf",
    });
  }
  if (prepared.length !== specs.length) return { ok: false, reason: "attachment_missing" };
  return { ok: true, attachments: prepared };
}

export function grantApprovedBodyHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function grantMessageKey(draft: GrantOutreachDraft, contentHash = grantApprovedBodyHash(draft.body)): string {
  const attachments = attachmentChecksums(draft);
  const material = attachments.length
    ? {
      draftId: draft.id,
      draftVersion: draft.version,
      recipient: email(draft.recipient),
      subject: draft.subject,
      contentHash,
      attachments,
    }
    : {
      draftId: draft.id,
      draftVersion: draft.version,
      recipient: email(draft.recipient),
      subject: draft.subject,
      contentHash,
    };
  return createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex");
}

const SECRET_ENV_NAMES = [
  "POSTMARK_SERVER_TOKEN",
  "RESEND_API_KEY",
  "EMAIL_API_KEY",
  "SMTP_API_KEY",
  "AI_INTEGRATIONS_RESEND_API_KEY",
] as const;

function scrubProviderError(value: string | null | undefined, env: NodeJS.ProcessEnv): string | null {
  if (!value) return null;
  let out = value;
  for (const name of SECRET_ENV_NAMES) {
    const secret = (env[name] || "").trim();
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out;
}

async function ensureGrantSendReservations(db: MailDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_send_reservations (
      message_key TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      draft_version INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      state TEXT NOT NULL,
      provider_message_id TEXT,
      provider_error TEXT,
      founder_identity TEXT,
      authorized_at TEXT,
      delivery_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function isUniqueConstraint(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed/i.test(message) || /SQLITE_CONSTRAINT/.test(message);
}

async function reserveGrantSend(db: MailDb, draft: GrantOutreachDraft): Promise<ReservationHold> {
  await ensureGrantSendReservations(db);
  const now = new Date().toISOString();
  const contentHash = grantApprovedBodyHash(draft.body);
  const messageKey = grantMessageKey(draft, contentHash);
  const approval = draft.founderApproval;
  try {
    await db.run(
      `INSERT INTO grant_send_reservations (
        message_key, draft_id, draft_version, content_hash, recipient, subject,
        state, provider_message_id, provider_error, founder_identity, authorized_at,
        delivery_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', NULL, NULL, ?, ?, 'reserved', ?, ?)`,
      messageKey,
      draft.id,
      draft.version,
      contentHash,
      email(draft.recipient),
      draft.subject,
      approval?.authorizedBy ?? "",
      approval?.authorizedAt ?? "",
      now,
      now,
    );
    return { acquired: true, messageKey, contentHash };
  } catch (err) {
    if (!isUniqueConstraint(err)) throw err;
  }
  const relock = await db.run(
    `UPDATE grant_send_reservations
     SET state = 'reserved', delivery_status = 'reserved', provider_error = NULL, updated_at = ?
     WHERE message_key = ? AND state = 'rejected'`,
    now,
    messageKey,
  ) as { changes?: number };
  if ((relock?.changes ?? 0) === 1) return { acquired: true, messageKey, contentHash };
  const row = await db.get<{ state: string }>(
    "SELECT state FROM grant_send_reservations WHERE message_key = ?",
    messageKey,
  );
  const reason: GrantOutreachGateReason = row?.state === "accepted"
    ? "duplicate_already_sent"
    : row?.state === "uncertain"
      ? "uncertain_awaiting_founder_decision"
      : "duplicate_in_progress";
  return { acquired: false, reason, messageKey, contentHash };
}

async function finishReservation(
  db: MailDb,
  messageKey: string,
  state: "accepted" | "rejected" | "uncertain",
  providerMessageId: string | null,
  providerError: string | null,
): Promise<void> {
  await db.run(
    `UPDATE grant_send_reservations
     SET state = ?, delivery_status = ?, provider_message_id = ?, provider_error = ?, updated_at = ?
     WHERE message_key = ? AND state = 'reserved'`,
    state,
    state,
    providerMessageId,
    providerError,
    new Date().toISOString(),
    messageKey,
  );
}

async function recordDeliveryAttempt(
  db: MailDb | undefined,
  draft: GrantOutreachDraft,
  result: GrantDeliveryRecord,
  actorEmail?: string,
): Promise<void> {
  if (!db) return;
  const now = new Date().toISOString();
  const approval = draft.founderApproval;
  const founderIdentity = (actorEmail || approval?.authorizedBy || "").trim();
  const contentHash = result.contentHash ?? grantApprovedBodyHash(draft.body);
  const messageKey = result.messageKey ?? grantMessageKey(draft, contentHash);
  const deliveryStatus = result.deliveryStatus
    ?? (result.sent ? "accepted" : "not_sent");
  const action = deliveryStatus === "accepted"
    ? "POSTMARK_GRANT_ACCEPTED"
    : deliveryStatus === "uncertain"
      ? "POSTMARK_GRANT_UNCERTAIN"
      : "POSTMARK_GRANT_NOT_SENT";
  await recordGrantOutreachAudit(db, {
    id: `${draft.id}-${randomUUID()}`,
    action,
    source: "aura-grant-postmark",
    eligibilityResult: "NOT_SUBMITTED",
    detail: JSON.stringify({
      founderIdentity: founderIdentity || null,
      authorizedAt: approval?.authorizedAt || null,
      recipient: draft.recipient,
      subject: draft.subject,
      draftVersion: draft.version,
      draftId: draft.id,
      contentHash,
      messageKey,
      purpose: draft.purpose,
      provider: result.provider,
      sent: result.sent,
      reason: result.reason,
      errorCode: result.errorCode ?? null,
      providerError: result.providerError ?? null,
      providerMessageId: result.providerMessageId ?? null,
      deliveryStatus,
      network: result.network,
      deliveryVerification: "UNVERIFIED",
      attachmentChecksums: attachmentChecksums(draft),
    }),
    actorEmail: founderIdentity || "unrecorded",
    sourceVerifiedAt: approval?.authorizedAt || now,
    createdAt: now,
    entityType: "grant_outreach",
    entityId: draft.id,
  });
}

export async function deliverApprovedGrantOutreach(
  input: GateInput,
  options: {
    fetchImpl?: typeof fetch;
    allowNetwork?: boolean;
    env?: NodeJS.ProcessEnv;
    db?: MailDb;
    actorEmail?: string;
    attachmentPayloads?: GrantAttachmentPayload[];
  } = {},
): Promise<GrantDeliveryRecord> {
  const env = options.env ?? process.env;
  const decision = evaluateGrantOutreachSendGate(input);
  if (!decision.allowed) {
    const blocked: GrantDeliveryRecord = {
      ...decision,
      errorCode: decision.reason,
      providerMessageId: null,
      providerError: null,
      provider: "none",
      deliveryStatus: "not_sent",
    };
    await recordDeliveryAttempt(options.db, input.draft, blocked, options.actorEmail);
    return blocked;
  }
  const required = input.draft.attachments ?? [];
  const prepared = prepareApprovedGrantAttachments(required, options.attachmentPayloads ?? []);
  if (!prepared.ok) {
    const refused: GrantDeliveryRecord = {
      allowed: false,
      sent: false,
      reason: prepared.reason,
      network: false,
      errorCode: prepared.reason,
      providerMessageId: null,
      providerError: null,
      provider: "none",
      deliveryStatus: "not_sent",
    };
    await recordDeliveryAttempt(options.db, input.draft, refused, options.actorEmail);
    return refused;
  }
  if (required.length > 0 && prepared.attachments.length !== required.length) {
    const missing: GrantDeliveryRecord = {
      allowed: false,
      sent: false,
      reason: "attachment_missing",
      network: false,
      errorCode: "attachment_missing",
      providerMessageId: null,
      providerError: null,
      provider: "none",
      deliveryStatus: "not_sent",
    };
    await recordDeliveryAttempt(options.db, input.draft, missing, options.actorEmail);
    return missing;
  }
  const selection = headquartersMailReadiness(env);
  if (!selection.postmarkReady) {
    const missing: GrantDeliveryRecord = {
      allowed: true,
      sent: false,
      reason: "allowed",
      network: false,
      errorCode: "postmark_not_configured",
      providerMessageId: null,
      providerError: null,
      provider: "none",
      deliveryStatus: "not_sent",
    };
    await recordDeliveryAttempt(options.db, input.draft, missing, options.actorEmail);
    return missing;
  }
  if (process.env.NODE_ENV === "test" && options.allowNetwork !== true) {
    const held: GrantDeliveryRecord = {
      ...decision,
      sent: false,
      network: false,
      errorCode: "network_disabled_in_test",
      providerMessageId: null,
      providerError: null,
      provider: "postmark",
      deliveryStatus: "not_sent",
    };
    await recordDeliveryAttempt(options.db, input.draft, held, options.actorEmail);
    return held;
  }
  if (!options.db) {
    const unavailable: GrantDeliveryRecord = {
      allowed: false,
      sent: false,
      reason: "reservation_unavailable",
      network: false,
      errorCode: "reservation_unavailable",
      providerMessageId: null,
      providerError: null,
      provider: "none",
      deliveryStatus: "not_sent",
    };
    return unavailable;
  }
  const hold = await reserveGrantSend(options.db, input.draft);
  if (!hold.acquired) {
    const refused: GrantDeliveryRecord = {
      allowed: false,
      sent: false,
      reason: hold.reason,
      network: false,
      errorCode: hold.reason,
      providerMessageId: null,
      providerError: null,
      provider: "none",
      contentHash: hold.contentHash,
      messageKey: hold.messageKey,
      deliveryStatus: hold.reason === "uncertain_awaiting_founder_decision" ? "uncertain" : "not_sent",
    };
    await recordDeliveryAttempt(options.db, input.draft, refused, options.actorEmail);
    return refused;
  }
  let transport;
  try {
    transport = await sendAuraGrantViaPostmark({
      to: input.draft.recipient,
      subject: input.draft.subject,
      text: input.draft.body,
      attachments: prepared.attachments,
      fetchImpl: options.fetchImpl,
      env,
    });
  } catch {
    await finishReservation(options.db, hold.messageKey, "uncertain", null, "provider response uncertain");
    const uncertain: GrantDeliveryRecord = {
      allowed: true,
      sent: false,
      reason: "allowed",
      network: true,
      errorCode: "postmark_uncertain",
      providerMessageId: null,
      providerError: "provider response uncertain",
      provider: "postmark",
      contentHash: hold.contentHash,
      messageKey: hold.messageKey,
      deliveryStatus: "uncertain",
    };
    await recordDeliveryAttempt(options.db, input.draft, uncertain, options.actorEmail);
    return uncertain;
  }
  const providerError = scrubProviderError(transport.providerError, env);
  const accepted = transport.success === true;
  const uncertain = !accepted && transport.errorCode === "postmark_uncertain";
  const state = accepted ? "accepted" : uncertain ? "uncertain" : "rejected";
  await finishReservation(
    options.db,
    hold.messageKey,
    state,
    accepted ? transport.messageId : null,
    providerError,
  );
  const result: GrantDeliveryRecord = {
    allowed: true,
    sent: accepted,
    reason: "allowed",
    network: true,
    errorCode: transport.errorCode,
    providerMessageId: accepted ? transport.messageId : null,
    providerError,
    provider: transport.provider,
    contentHash: hold.contentHash,
    messageKey: hold.messageKey,
    deliveryStatus: state,
  };
  await recordDeliveryAttempt(options.db, input.draft, result, options.actorEmail);
  return result;
}

export function grantOutreachQueueHttp(req: Request, res: Response): void {
  const denied = inboundMailSessionStatus(req.hqUser);
  if (denied) {
    res.status(denied).json({ error: denied === 401 ? "Authentication required" : "Founder session required", sent: false });
    return;
  }
  const inquiry = prepareStoneInquiryHeadquartersDraft();
  const followUp = prepareStoneFollowUp();
  const deliveryTest = preparePostmarkDeliveryTestDraft();
  res.json({
    sent: false,
    mailbox: GRANT_OUTREACH_MAILBOX,
    globalOutboundMailSendEnabled: outboundMailSendEnabled(),
    mailReadiness: headquartersMailReadiness(),
    applicationStatus: "NOT SUBMITTED",
    inquiry,
    followUp,
    deliveryTest,
    inquiryGate: evaluateGrantOutreachSendGate({ draft: inquiry }),
    followUpGate: evaluateGrantOutreachSendGate({ draft: followUp }),
    deliveryTestGate: evaluateGrantOutreachSendGate({ draft: deliveryTest }),
  });
}

export async function grantOutreachSendHttp(
  req: Request,
  res: Response,
  options: { db?: MailDb } = {},
): Promise<void> {
  const denied = inboundMailSessionStatus(req.hqUser);
  if (denied) {
    res.status(denied).json({ error: denied === 401 ? "Authentication required" : "Founder session required", sent: false });
    return;
  }
  if (req.body?.confirmSend !== true) {
    res.json({ sent: false, allowed: false, reason: "unapproved", network: false });
    return;
  }
  const draft = draftFromRequest(req.body);
  const db = options.db ?? await loadGrantAuditDb();
  const decision = await deliverApprovedGrantOutreach(
    { draft },
    { db, actorEmail: req.hqUser?.email, attachmentPayloads: attachmentPayloadsFrom(req.body) },
  );
  res.json(decision);
}

async function loadGrantAuditDb(): Promise<MailDb | undefined> {
  try {
    const { getDb } = await import("../db");
    return await getDb();
  } catch {
    return undefined;
  }
}

function attachmentSpecsFrom(value: unknown): GrantAttachmentSpec[] {
  if (!Array.isArray(value)) return [];
  const specs: GrantAttachmentSpec[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.name !== "string" || typeof row.sha256 !== "string") continue;
    specs.push({ name: row.name, sha256: row.sha256.trim().toLowerCase() });
  }
  return specs;
}

function attachmentPayloadsFrom(body: unknown): GrantAttachmentPayload[] {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (!Array.isArray(input.attachments)) return [];
  const payloads: GrantAttachmentPayload[] = [];
  for (const item of input.attachments) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.name !== "string") continue;
    payloads.push({
      name: row.name,
      contentBase64: typeof row.contentBase64 === "string" ? row.contentBase64 : "",
    });
  }
  return payloads;
}

function draftFromRequest(body: unknown): GrantOutreachDraft {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const approval = input.founderApproval && typeof input.founderApproval === "object"
    ? input.founderApproval as Record<string, unknown>
    : null;
  return {
    id: typeof input.id === "string" ? input.id : "grant-outreach-draft",
    version: typeof input.version === "number" ? input.version : 0,
    mailbox: GRANT_OUTREACH_MAILBOX,
    recipient: typeof input.recipient === "string" ? input.recipient : "",
    subject: typeof input.subject === "string" ? input.subject : "",
    body: typeof input.body === "string" ? input.body : "",
    purpose: typeof input.purpose === "string" ? input.purpose : "",
    status: input.status === "ALREADY SENT OUTSIDE AURA" || input.status === "FOUNDER APPROVED" || input.status === "NOT SENT" || input.status === "NEEDS FOUNDER DECISION"
      ? input.status
      : "NEEDS FOUNDER APPROVAL",
    banner: typeof input.banner === "string" ? input.banner : null,
    founderApproval: approval && approval.recorded === true && typeof approval.exactBody === "string"
      ? {
        recorded: true,
        exactBody: approval.exactBody,
        recipient: typeof approval.recipient === "string" ? approval.recipient : "",
        subject: typeof approval.subject === "string" ? approval.subject : "",
        purpose: typeof approval.purpose === "string" ? approval.purpose : "",
        draftId: typeof approval.draftId === "string" ? approval.draftId : "",
        draftVersion: typeof approval.draftVersion === "number" ? approval.draftVersion : Number.NaN,
        authorizedBy: typeof approval.authorizedBy === "string" ? approval.authorizedBy : "",
        authorizedAt: typeof approval.authorizedAt === "string" ? approval.authorizedAt : "",
        attachments: attachmentSpecsFrom(approval.attachments),
      }
      : null,
    attachments: attachmentSpecsFrom(input.attachments),
    grantOutreachSendEnabled: input.grantOutreachSendEnabled === true,
    sentByAura: false,
    applicationStatus: "NOT SUBMITTED",
    notBefore: typeof input.notBefore === "string" ? input.notBefore : null,
    deliveryResult: null,
  };
}
