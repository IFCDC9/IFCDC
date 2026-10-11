/**
 * Founder-approved grant outreach.
 * Aura may draft. A draft is not sent until the Founder approves that exact body.
 * The global outbound flag is not set here and is not the grant-outreach send switch.
 * Approved grant mail uses the existing Postmark outbound stream. A Resend key does not
 * select Resend for this path.
 * A send may proceed only when exact-text approval, the approved recipient, a clear
 * duplicate check, and that draft's own send switch are all true. The Stone inquiry
 * already sent on 2026-10-11 is a permanent duplicate and cannot pass.
 */
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { inboundMailSessionStatus, type MailDb } from "./inboundBusinessMail";
import { SERVICE_MAILBOX, outboundMailSendEnabled } from "./inboundOutboundMail";
import { sendAuraGrantViaPostmark, headquartersMailReadiness } from "../lib/transactionalEmail";

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
export const POSTMARK_DELIVERY_TEST_SUBJECT = "IFCDC HQ — internal Postmark delivery test — NOT A FUNDER EMAIL";
export const POSTMARK_DELIVERY_TEST_PURPOSE = "postmark-delivery-test";
export const POSTMARK_DELIVERY_TEST_STATUS =
  "NOT SENT — AWAITING FOUNDER APPROVAL TO DEPLOY THE GUARDED PATH AND THEN TO SEND ONE TEST";
export const POSTMARK_DELIVERY_TEST_BODY = `This is an internal IFCDC Headquarters Postmark delivery test.

It is not a grant application.
It is not a message to a funder.
It asks for no money and makes no commitment.

If this message arrives at service@ifcdc.org, Postmark accepted a send from IFCDC Headquarters to its own mailbox.

No reply is required.

IFCDC Headquarters
Imperial Foundation Community Development Center`;

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
  purpose: string;
  authorizedBy: string;
  authorizedAt: string;
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
  mailbox: typeof GRANT_OUTREACH_MAILBOX;
  recipient: string;
  subject: string;
  body: string;
  purpose: string;
  status: GrantOutreachStatus;
  banner: string | null;
  founderApproval: FounderExactApproval | null;
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
  | "duplicate_already_sent"
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
    mailbox: GRANT_OUTREACH_MAILBOX,
    recipient: POSTMARK_DELIVERY_TEST_RECIPIENT,
    subject: POSTMARK_DELIVERY_TEST_SUBJECT,
    body: POSTMARK_DELIVERY_TEST_BODY,
    purpose: POSTMARK_DELIVERY_TEST_PURPOSE,
    status: "NEEDS FOUNDER APPROVAL",
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
  if (!approval?.recorded) return blocked("unapproved");
  if (approval.exactBody !== draft.body) return blocked("exact_text_mismatch");
  if (email(approval.recipient) !== email(draft.recipient) || approval.purpose !== draft.purpose) {
    return blocked("recipient_mismatch");
  }
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
  provider: "postmark" | "none";
};

async function recordDeliveryAttempt(
  db: MailDb | undefined,
  draft: GrantOutreachDraft,
  result: GrantDeliveryRecord,
): Promise<void> {
  if (!db) return;
  const now = new Date().toISOString();
  await recordGrantOutreachAudit(db, {
    id: `${draft.id}-${randomUUID()}`,
    action: result.sent ? "POSTMARK_GRANT_ACCEPTED" : "POSTMARK_GRANT_NOT_SENT",
    source: "aura-grant-postmark",
    eligibilityResult: "NOT_SUBMITTED",
    detail: JSON.stringify({
      recipient: draft.recipient,
      subject: draft.subject,
      purpose: draft.purpose,
      provider: result.provider,
      sent: result.sent,
      reason: result.reason,
      errorCode: result.errorCode ?? null,
      network: result.network,
      deliveryVerification: "UNVERIFIED",
    }),
    actorEmail: "founder",
    sourceVerifiedAt: now,
    createdAt: now,
    entityType: "grant_outreach",
    entityId: draft.id,
  });
}

export async function deliverApprovedGrantOutreach(
  input: GateInput,
  options: { fetchImpl?: typeof fetch; allowNetwork?: boolean; env?: NodeJS.ProcessEnv; db?: MailDb } = {},
): Promise<GrantDeliveryRecord> {
  const decision = evaluateGrantOutreachSendGate(input);
  if (!decision.allowed) {
    const blocked: GrantDeliveryRecord = { ...decision, errorCode: decision.reason, providerMessageId: null, provider: "none" };
    await recordDeliveryAttempt(options.db, input.draft, blocked);
    return blocked;
  }
  const selection = headquartersMailReadiness(options.env ?? process.env);
  if (!selection.postmarkReady) {
    const missing: GrantDeliveryRecord = {
      allowed: true,
      sent: false,
      reason: "allowed",
      network: false,
      errorCode: "postmark_not_configured",
      providerMessageId: null,
      provider: "none",
    };
    await recordDeliveryAttempt(options.db, input.draft, missing);
    return missing;
  }
  if (process.env.NODE_ENV === "test" && options.allowNetwork !== true) {
    const held: GrantDeliveryRecord = {
      ...decision,
      sent: false,
      network: false,
      errorCode: "network_disabled_in_test",
      providerMessageId: null,
      provider: "postmark",
    };
    await recordDeliveryAttempt(options.db, input.draft, held);
    return held;
  }
  const transport = await sendAuraGrantViaPostmark({
    to: input.draft.recipient,
    subject: input.draft.subject,
    text: input.draft.body,
    fetchImpl: options.fetchImpl,
    env: options.env,
  });
  const result: GrantDeliveryRecord = {
    allowed: true,
    sent: transport.success,
    reason: "allowed",
    network: true,
    errorCode: transport.errorCode,
    providerMessageId: transport.messageId,
    provider: transport.provider,
  };
  await recordDeliveryAttempt(options.db, input.draft, result);
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
  const decision = await deliverApprovedGrantOutreach({ draft }, { db });
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

function draftFromRequest(body: unknown): GrantOutreachDraft {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const approval = input.founderApproval && typeof input.founderApproval === "object"
    ? input.founderApproval as Record<string, unknown>
    : null;
  return {
    id: typeof input.id === "string" ? input.id : "grant-outreach-draft",
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
        purpose: typeof approval.purpose === "string" ? approval.purpose : "",
        authorizedBy: typeof approval.authorizedBy === "string" ? approval.authorizedBy : "founder",
        authorizedAt: typeof approval.authorizedAt === "string" ? approval.authorizedAt : "",
      }
      : null,
    grantOutreachSendEnabled: input.grantOutreachSendEnabled === true,
    sentByAura: false,
    applicationStatus: "NOT SUBMITTED",
    notBefore: typeof input.notBefore === "string" ? input.notBefore : null,
    deliveryResult: null,
  };
}
