import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import {
  POSTMARK_DELIVERY_TEST_BODY,
  POSTMARK_DELIVERY_TEST_STATUS,
  POSTMARK_DELIVERY_TEST_SUBJECT,
  STONE_INQUIRY_BODY,
  STONE_INQUIRY_STATUS,
  deliverApprovedGrantOutreach,
  evaluateGrantOutreachSendGate,
  grantApprovedBodyHash,
  grantAttachmentSha256,
  grantOutreachSendHttp,
  prepareApprovedGrantAttachments,
  prepareGraphDeliveryTestDraft,
  preparePostmarkDeliveryTestDraft,
  prepareStoneFollowUp,
  prepareStoneInquiryHeadquartersDraft,
  queueIncomingGrantReply,
  recordGrantOutreachAudit,
  stoneInquiryAuditRow,
  type GrantOutreachDraft,
} from "../server/hq/grantOutreachCorrespondence";
import type { MailDb } from "../server/hq/inboundBusinessMail";
import { headquartersMailReadiness } from "../server/lib/transactionalEmail";

process.env.NODE_ENV = "test";
delete process.env.MICROSOFT_GRAPH_TENANT_ID;
delete process.env.MICROSOFT_GRAPH_CLIENT_ID;
delete process.env.MICROSOFT_GRAPH_CLIENT_SECRET;
delete process.env.INBOUND_MAILBOX_ADDRESS;
delete process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;

const governanceBody = readFileSync(
  new URL("../../IMPERIAL-FOUNDATION-CDC/Documents/products/governance-drafts/STONE-FOUNDATION-ELIGIBILITY-INQUIRY-BODY.txt", import.meta.url),
  "utf8",
).trimEnd();

function futureDraft(patch: Partial<GrantOutreachDraft> = {}): GrantOutreachDraft {
  const body = "This is a different grant outreach draft for a later Founder decision.";
  return {
    id: "future-grant-outreach",
    version: 1,
    mailbox: "service@ifcdc.org",
    recipient: "grants-review@example.com",
    subject: "A later question",
    body,
    purpose: "future-grant-outreach",
    status: "NEEDS FOUNDER APPROVAL",
    banner: null,
    founderApproval: null,
    grantOutreachSendEnabled: false,
    sentByAura: false,
    applicationStatus: "NOT SUBMITTED",
    notBefore: null,
    deliveryResult: null,
    ...patch,
  };
}

test("an unapproved grant outreach draft does not send", () => {
  const calls: string[] = [];
  globalThis.fetch = (() => {
    calls.push("fetch");
    throw new Error("network disabled");
  }) as typeof fetch;
  const decision = evaluateGrantOutreachSendGate({
    draft: futureDraft({ grantOutreachSendEnabled: true }),
    today: "2026-10-11",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.sent, false);
  assert.equal(decision.network, false);
  assert.equal(decision.reason, "unapproved");
  assert.equal(calls.length, 0);
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
});

test("approved exact text passes the gate without a network send", () => {
  const calls: string[] = [];
  globalThis.fetch = (() => {
    calls.push("fetch");
    throw new Error("network disabled");
  }) as typeof fetch;
  const body = "This is a different grant outreach draft for a later Founder decision.";
  const decision = evaluateGrantOutreachSendGate({
    draft: futureDraft({
      status: "FOUNDER APPROVED",
      grantOutreachSendEnabled: true,
      founderApproval: {
        recorded: true,
        exactBody: body,
        recipient: "grants-review@example.com",
        subject: "A later question",
        purpose: "future-grant-outreach",
        draftId: "future-grant-outreach",
        draftVersion: 1,
        authorizedBy: "founder@ifcdc.org",
        authorizedAt: "2026-10-11T20:15:00.000Z",
      },
    }),
    today: "2026-10-11",
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.sent, false);
  assert.equal(decision.network, false);
  assert.equal(decision.reason, "allowed");
  assert.equal(calls.length, 0);
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
});

test("a later edit of an approved body does not pass the gate", () => {
  const approved = "This is a different grant outreach draft for a later Founder decision.";
  const decision = evaluateGrantOutreachSendGate({
    draft: futureDraft({
      body: `${approved}\nOne added sentence.`,
      status: "FOUNDER APPROVED",
      grantOutreachSendEnabled: true,
      founderApproval: {
        recorded: true,
        exactBody: approved,
        recipient: "grants-review@example.com",
        subject: "A later question",
        purpose: "future-grant-outreach",
        draftId: "future-grant-outreach",
        draftVersion: 1,
        authorizedBy: "founder@ifcdc.org",
        authorizedAt: "2026-10-11T20:15:00.000Z",
      },
    }),
    today: "2026-10-11",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "exact_text_mismatch");
  assert.equal(decision.sent, false);
});

test("the already-sent Stone inquiry is refused as a duplicate", () => {
  const calls: string[] = [];
  globalThis.fetch = (() => {
    calls.push("fetch");
    throw new Error("network disabled");
  }) as typeof fetch;
  const stored = prepareStoneInquiryHeadquartersDraft();
  assert.equal(stored.body, governanceBody);
  assert.equal(stored.body, STONE_INQUIRY_BODY);
  assert.equal(stored.banner, STONE_INQUIRY_STATUS);
  assert.equal(stored.status, "ALREADY SENT OUTSIDE AURA");
  assert.equal(stored.grantOutreachSendEnabled, false);
  assert.equal(stored.sentByAura, false);
  assert.equal(stored.applicationStatus, "NOT SUBMITTED");
  const prepared = evaluateGrantOutreachSendGate({ draft: stored, today: "2026-10-11" });
  assert.equal(prepared.allowed, false);
  assert.equal(prepared.reason, "duplicate_already_sent");
  const forged = evaluateGrantOutreachSendGate({
    draft: futureDraft({
      id: "stone-resend-attempt",
      recipient: "elizabeth@stonefdnnj.org",
      subject: stored.subject,
      body: stored.body,
      purpose: stored.purpose,
      status: "FOUNDER APPROVED",
      grantOutreachSendEnabled: true,
      founderApproval: {
        recorded: true,
        exactBody: stored.body,
        recipient: "elizabeth@stonefdnnj.org",
        purpose: stored.purpose,
        authorizedBy: "founder",
        authorizedAt: "2026-10-11",
      },
    }),
    today: "2026-10-11",
  });
  assert.equal(forged.allowed, false);
  assert.equal(forged.sent, false);
  assert.equal(forged.network, false);
  assert.equal(forged.reason, "duplicate_already_sent");
  assert.equal(calls.length, 0);
});

test("the October 23 Stone follow-up stays unsent and a reply waits for the Founder", async () => {
  const followUp = prepareStoneFollowUp();
  assert.equal(followUp.status, "NOT SENT");
  assert.equal(followUp.notBefore, "2026-10-23");
  assert.equal(followUp.grantOutreachSendEnabled, false);
  assert.equal(followUp.founderApproval, null);
  const blocked = evaluateGrantOutreachSendGate({ draft: followUp, today: "2026-10-11" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.sent, false);
  const reply = queueIncomingGrantReply({
    id: "stone-reply-placeholder",
    relatedDraftId: "stone-eligibility-inquiry-2026-10-11",
    from: "elizabeth@stonefdnnj.org",
    subject: "Re: Introductory questions from IFCDC in Asbury Park",
    body: "",
    receivedAt: "",
  });
  assert.equal(reply.status, "NEEDS FOUNDER DECISION");
  assert.equal(reply.sent, false);

  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const row = stoneInquiryAuditRow();
  await recordGrantOutreachAudit(db, row);
  const stored = await db.get<{ action: string; detail: string; actor_email: string }>(
    "SELECT action, detail, actor_email FROM grant_audit_events WHERE id = ?",
    row.id,
  );
  assert.equal(stored?.action, "ALREADY_SENT_OUTSIDE_AURA_DO_NOT_RESEND");
  assert.equal(stored?.actor_email, "founder");
  const detail = JSON.parse(stored?.detail || "{}") as {
    recipient: string;
    exactMessage: string;
    timestampDisplay: string;
    deliveryResult: string;
    founderAuthorization: string;
    productionDbWritten: boolean;
  };
  assert.equal(detail.recipient, "elizabeth@stonefdnnj.org");
  assert.equal(detail.exactMessage, STONE_INQUIRY_BODY);
  assert.equal(detail.timestampDisplay, "Sunday, October 11, 2026, 6:19:45 PM EDT");
  assert.match(detail.deliveryResult, /Mail\.app Sent/);
  assert.match(detail.founderAuthorization, /second transmission is not approved/);
  assert.equal(detail.productionDbWritten, false);
});

test("the internal Graph delivery test stays unsent until the Founder approves that exact text", () => {
  const calls: string[] = [];
  globalThis.fetch = (() => {
    calls.push("fetch");
    throw new Error("network disabled");
  }) as typeof fetch;
  const draft = prepareGraphDeliveryTestDraft();
  assert.equal(draft.banner, "NOT SENT — AWAITING FOUNDER APPROVAL");
  assert.equal(draft.recipient, "service@ifcdc.org");
  assert.equal(draft.grantOutreachSendEnabled, false);
  assert.equal(draft.founderApproval, null);
  assert.equal(draft.body.includes("not a grant application"), true);
  assert.equal(draft.body.includes("elizabeth@stonefdnnj.org"), false);
  const decision = evaluateGrantOutreachSendGate({ draft, today: "2026-10-11" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.sent, false);
  assert.equal(decision.network, false);
  assert.equal(decision.reason, "unapproved");
  assert.equal(calls.length, 0);
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
  const callsAfter: string[] = [];
  globalThis.fetch = (() => {
    callsAfter.push("fetch");
    throw new Error("network disabled");
  }) as typeof fetch;
  const redirected = evaluateGrantOutreachSendGate({
    draft: {
      ...draft,
      recipient: "elizabeth@stonefdnnj.org",
      status: "FOUNDER APPROVED",
      grantOutreachSendEnabled: true,
      founderApproval: {
        recorded: true,
        exactBody: draft.body,
        recipient: "elizabeth@stonefdnnj.org",
        purpose: draft.purpose,
        authorizedBy: "founder",
        authorizedAt: "2026-10-11",
      },
    },
    today: "2026-10-11",
  });
  assert.equal(redirected.allowed, false);
  assert.equal(redirected.sent, false);
  assert.equal(redirected.network, false);
  assert.equal(redirected.reason, "recipient_mismatch");
  assert.equal(callsAfter.length, 0);
});

test("the grant outreach gate does not turn on global outbound mail", () => {
  const source = readFileSync(new URL("../server/hq/grantOutreachCorrespondence.ts", import.meta.url), "utf8");
  const start = source.indexOf("export function evaluateGrantOutreachSendGate");
  const end = source.indexOf("export type GrantOutreachAuditRow");
  const gate = source.slice(start, end);
  assert.equal(gate.includes("fetch("), false);
  assert.doesNotMatch(source, /process\.env\.IFCDC_OUTBOUND_MAIL_SEND_ENABLED/);
  assert.doesNotMatch(source, /IFCDC_OUTBOUND_MAIL_SEND_ENABLED\s*=/);
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
});

const FIXTURE_POSTMARK = "fixture-postmark-token-not-real";
const FIXTURE_RESEND = "fixture-resend-key-not-real";

function approvedFutureDraft(): GrantOutreachDraft {
  const body = "This is a different grant outreach draft for a later Founder decision.";
  return futureDraft({
    status: "FOUNDER APPROVED",
    grantOutreachSendEnabled: true,
    founderApproval: {
      recorded: true,
      exactBody: body,
      recipient: "grants-review@example.com",
      subject: "A later question",
      purpose: "future-grant-outreach",
      draftId: "future-grant-outreach",
      draftVersion: 1,
      authorizedBy: "founder@ifcdc.org",
      authorizedAt: "2026-10-11T20:15:00.000Z",
    },
  });
}

test("Aura grant mail selects Postmark when a Resend key is also present", async () => {
  const env = {
    POSTMARK_SERVER_TOKEN: FIXTURE_POSTMARK,
    RESEND_API_KEY: FIXTURE_RESEND,
  } as NodeJS.ProcessEnv;
  const selection = headquartersMailReadiness(env);
  assert.equal(selection.healthReportedProvider, "resend");
  assert.equal(selection.configuredProvider, "postmark");
  assert.equal(selection.actualDeliveryProvider, "UNVERIFIED");
  assert.equal(selection.auraGrantProvider, "postmark");
  assert.equal(selection.postmarkReady, true);
  assert.equal(selection.deliveryVerification, "UNVERIFIED");
  assert.equal(selection.fallbackProvider, "resend");
  assert.equal(JSON.stringify(selection).includes(FIXTURE_POSTMARK), false);
  assert.equal(JSON.stringify(selection).includes(FIXTURE_RESEND), false);

  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("resend") || url.includes("graph.microsoft.com")) {
      throw new Error("wrong provider");
    }
    const header = new Headers(init?.headers).get("X-Postmark-Server-Token");
    if (header !== FIXTURE_POSTMARK) throw new Error("Postmark token header did not match the fixture");
    const body = JSON.parse(String(init?.body)) as { MessageStream?: string; From?: string };
    assert.equal(body.MessageStream, "outbound");
    assert.match(body.From || "", /@ifcdc\.org/);
    return new Response(JSON.stringify({ MessageID: "fixture-message", ErrorCode: 0 }), { status: 200 });
  };
  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const result = await deliverApprovedGrantOutreach(
    { draft: approvedFutureDraft(), today: "2026-10-11" },
    { allowNetwork: true, env, fetchImpl, db },
  );
  assert.equal(result.sent, true);
  assert.equal(result.provider, "postmark");
  assert.equal(result.network, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /api\.postmarkapp\.com\/email$/);
  const stored = await db.get<{ action: string; detail: string }>(
    "SELECT action, detail FROM grant_audit_events ORDER BY created_at DESC LIMIT 1",
  );
  assert.equal(stored?.action, "POSTMARK_GRANT_ACCEPTED");
  assert.equal((stored?.detail || "").includes(FIXTURE_POSTMARK), false);
  assert.equal((stored?.detail || "").includes(FIXTURE_RESEND), false);
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
});

test("a Postmark API failure does not send the grant message through Resend", async () => {
  const env = {
    POSTMARK_SERVER_TOKEN: FIXTURE_POSTMARK,
    RESEND_API_KEY: FIXTURE_RESEND,
  } as NodeJS.ProcessEnv;
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("resend") || url.includes("graph.microsoft.com")) {
      throw new Error("wrong provider");
    }
    return new Response(JSON.stringify({ ErrorCode: 406, Message: "fixture inactive recipient" }), { status: 422 });
  };
  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const result = await deliverApprovedGrantOutreach(
    { draft: approvedFutureDraft(), today: "2026-10-11" },
    { allowNetwork: true, env, fetchImpl, db },
  );
  assert.equal(result.sent, false);
  assert.equal(result.provider, "postmark");
  assert.equal(result.errorCode, "postmark_rejected");
  assert.equal(result.network, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /api\.postmarkapp\.com\/email$/);
  const stored = await db.get<{ action: string; detail: string }>(
    "SELECT action, detail FROM grant_audit_events ORDER BY created_at DESC LIMIT 1",
  );
  assert.equal(stored?.action, "POSTMARK_GRANT_NOT_SENT");
  const detail = JSON.parse(stored?.detail || "{}") as { errorCode: string; provider: string; sent: boolean };
  assert.equal(detail.errorCode, "postmark_rejected");
  assert.equal(detail.provider, "postmark");
  assert.equal(detail.sent, false);
  assert.equal((stored?.detail || "").includes(FIXTURE_POSTMARK), false);
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
});

test("ordinary transactional mail still keeps its Resend fallback", () => {
  const mailSource = readFileSync(new URL("../server/lib/transactionalEmail.ts", import.meta.url), "utf8");
  const start = mailSource.indexOf("export async function sendTransactionalEmail");
  assert.notEqual(start, -1);
  const ordinary = mailSource.slice(start);
  assert.match(ordinary, /Postmark primary failed; trying Resend fallback/);
  assert.match(ordinary, /sendViaResend\(/);
  const grantStart = mailSource.indexOf("export async function sendAuraGrantViaPostmark");
  const grantEnd = mailSource.indexOf("/** Record which transport", grantStart);
  const grantFn = mailSource.slice(grantStart, grantEnd);
  assert.equal(grantFn.includes("sendViaResend"), false);
  assert.equal(process.env.IFCDC_EMAIL_DISABLE_SEND, undefined);
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
});

test("a missing Postmark token does not send Aura grant mail through Resend", async () => {
  const env = { RESEND_API_KEY: FIXTURE_RESEND } as NodeJS.ProcessEnv;
  const selection = headquartersMailReadiness(env);
  assert.equal(selection.auraGrantProvider, "none");
  assert.equal(selection.actualDeliveryProvider, "UNVERIFIED");
  assert.equal(selection.fallbackProvider, "resend");
  assert.equal(selection.postmarkReady, false);
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error("network disabled");
  };
  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const result = await deliverApprovedGrantOutreach(
    { draft: approvedFutureDraft(), today: "2026-10-11" },
    { allowNetwork: true, env, fetchImpl, db },
  );
  assert.equal(called, false);
  assert.equal(result.allowed, true);
  assert.equal(result.sent, false);
  assert.equal(result.network, false);
  assert.equal(result.provider, "none");
  assert.equal(result.errorCode, "postmark_not_configured");
  const stored = await db.get<{ action: string; detail: string }>(
    "SELECT action, detail FROM grant_audit_events ORDER BY created_at DESC LIMIT 1",
  );
  assert.equal(stored?.action, "POSTMARK_GRANT_NOT_SENT");
  const detail = JSON.parse(stored?.detail || "{}") as { errorCode: string; provider: string };
  assert.equal(detail.errorCode, "postmark_not_configured");
  assert.equal(detail.provider, "none");
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
});

test("the internal Postmark delivery test stays unsent", () => {
  const calls: string[] = [];
  globalThis.fetch = (() => {
    calls.push("fetch");
    throw new Error("network disabled");
  }) as typeof fetch;
  const draft = preparePostmarkDeliveryTestDraft();
  assert.equal(draft.status, "NOT SENT");
  assert.equal(draft.banner, POSTMARK_DELIVERY_TEST_STATUS);
  assert.equal(POSTMARK_DELIVERY_TEST_STATUS, "NOT SENT");
  assert.equal(draft.recipient, "service@ifcdc.org");
  assert.equal(draft.subject, "IFCDC HQ — Internal Postmark Delivery Test — NOT A FUNDER EMAIL");
  assert.equal(draft.subject, POSTMARK_DELIVERY_TEST_SUBJECT);
  assert.equal(draft.body, "This is an internal delivery verification for IFCDC Headquarters and Aura. No grant application or funding request is being submitted.");
  assert.equal(draft.body, POSTMARK_DELIVERY_TEST_BODY);
  assert.equal(draft.body.includes("not a grant application"), false);
  assert.equal(draft.grantOutreachSendEnabled, false);
  assert.equal(draft.founderApproval, null);
  const decision = evaluateGrantOutreachSendGate({ draft, today: "2026-10-11" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.sent, false);
  assert.equal(decision.network, false);
  assert.equal(decision.reason, "unapproved");
  assert.equal(calls.length, 0);
  const redirected = evaluateGrantOutreachSendGate({
    draft: {
      ...draft,
      recipient: "elizabeth@stonefdnnj.org",
      status: "FOUNDER APPROVED",
      grantOutreachSendEnabled: true,
      founderApproval: {
        recorded: true,
        exactBody: draft.body,
        recipient: "elizabeth@stonefdnnj.org",
        purpose: draft.purpose,
        authorizedBy: "founder",
        authorizedAt: "2026-10-11",
      },
    },
    today: "2026-10-11",
  });
  assert.equal(redirected.reason, "recipient_mismatch");
  assert.equal(redirected.sent, false);
  assert.equal(calls.length, 0);

  const mailSource = readFileSync(new URL("../server/lib/transactionalEmail.ts", import.meta.url), "utf8");
  const start = mailSource.indexOf("export async function sendAuraGrantViaPostmark");
  const next = mailSource.indexOf("\n/** Record which transport", start);
  const fn = mailSource.slice(start, next === -1 ? undefined : next);
  assert.equal(fn.includes("sendViaResend"), false);
  assert.equal(fn.includes("api.resend.com"), false);
  assert.equal(fn.includes("postmark_not_configured"), true);
  const grantSource = readFileSync(new URL("../server/hq/grantOutreachCorrespondence.ts", import.meta.url), "utf8");
  assert.equal(grantSource.includes("graph.microsoft.com"), false);
  assert.equal(grantSource.includes("sendViaResend"), false);
});

test("the send route writes an audit row and still refuses the Stone duplicate", async () => {
  const calls: string[] = [];
  globalThis.fetch = (() => {
    calls.push("fetch");
    throw new Error("network disabled");
  }) as typeof fetch;
  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const stored = prepareStoneInquiryHeadquartersDraft();
  const state: { code: number; body: { sent?: boolean; reason?: string } | null } = { code: 200, body: null };
  const res = {
    status(code: number) {
      state.code = code;
      return this;
    },
    json(body: { sent?: boolean; reason?: string }) {
      state.body = body;
      return this;
    },
  };
  await grantOutreachSendHttp({
    hqUser: { role: "founder" },
    body: {
      confirmSend: true,
      id: "stone-resend-attempt",
      recipient: "elizabeth@stonefdnnj.org",
      subject: stored.subject,
      body: stored.body,
      purpose: stored.purpose,
      status: "FOUNDER APPROVED",
      grantOutreachSendEnabled: true,
      founderApproval: {
        recorded: true,
        exactBody: stored.body,
        recipient: "elizabeth@stonefdnnj.org",
        purpose: stored.purpose,
        authorizedBy: "founder",
        authorizedAt: "2026-10-11",
      },
    },
  } as unknown as import("express").Request, res as unknown as import("express").Response, { db });
  assert.equal(state.body?.sent, false);
  assert.equal(state.body?.reason, "duplicate_already_sent");
  assert.equal(calls.length, 0);
  const row = await db.get<{ action: string; detail: string }>(
    "SELECT action, detail FROM grant_audit_events ORDER BY created_at DESC LIMIT 1",
  );
  assert.equal(row?.action, "POSTMARK_GRANT_NOT_SENT");
  assert.match(row?.detail || "", /duplicate_already_sent/);
  assert.equal((row?.detail || "").includes("POSTMARK_SERVER_TOKEN"), false);
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
});

test("a changed subject, recipient, version, or draft id invalidates approval", () => {
  const approved = approvedFutureDraft();
  assert.equal(evaluateGrantOutreachSendGate({ draft: approved, today: "2026-10-11" }).reason, "allowed");
  assert.equal(evaluateGrantOutreachSendGate({
    draft: { ...approved, subject: "A different subject line" },
    today: "2026-10-11",
  }).reason, "subject_mismatch");
  assert.equal(evaluateGrantOutreachSendGate({
    draft: { ...approved, recipient: "other@example.com" },
    today: "2026-10-11",
  }).reason, "recipient_mismatch");
  assert.equal(evaluateGrantOutreachSendGate({
    draft: { ...approved, body: `${approved.body}\nEdited.` },
    today: "2026-10-11",
  }).reason, "exact_text_mismatch");
  assert.equal(evaluateGrantOutreachSendGate({
    draft: { ...approved, version: 2 },
    today: "2026-10-11",
  }).reason, "version_mismatch");
  assert.equal(evaluateGrantOutreachSendGate({
    draft: { ...approved, id: "future-grant-outreach-edited" },
    today: "2026-10-11",
  }).reason, "identity_mismatch");
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
});

test("two concurrent reservations allow only one send", async () => {
  const env = {
    POSTMARK_SERVER_TOKEN: FIXTURE_POSTMARK,
    RESEND_API_KEY: FIXTURE_RESEND,
  } as NodeJS.ProcessEnv;
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (String(input).includes("resend")) throw new Error("wrong provider");
    return new Response(JSON.stringify({ MessageID: "fixture-concurrent", ErrorCode: 0 }), { status: 200 });
  };
  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const draft = approvedFutureDraft();
  const [first, second] = await Promise.all([
    deliverApprovedGrantOutreach({ draft, today: "2026-10-11" }, { allowNetwork: true, env, fetchImpl, db }),
    deliverApprovedGrantOutreach({ draft, today: "2026-10-11" }, { allowNetwork: true, env, fetchImpl, db }),
  ]);
  const sent = [first, second].filter((result) => result.sent);
  const refused = [first, second].filter((result) => !result.sent);
  assert.equal(sent.length, 1);
  assert.equal(refused.length, 1);
  assert.equal(calls.length, 1);
  assert.ok(refused[0].reason === "duplicate_in_progress" || refused[0].reason === "duplicate_already_sent");
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
});

test("an accepted Postmark message id blocks a retry of the same approval", async () => {
  const env = { POSTMARK_SERVER_TOKEN: FIXTURE_POSTMARK } as NodeJS.ProcessEnv;
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ MessageID: "fixture-accepted-id", ErrorCode: 0 }), { status: 200 });
  };
  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const draft = approvedFutureDraft();
  const first = await deliverApprovedGrantOutreach({ draft, today: "2026-10-11" }, { allowNetwork: true, env, fetchImpl, db, actorEmail: "founder@ifcdc.org" });
  const second = await deliverApprovedGrantOutreach({ draft, today: "2026-10-11" }, { allowNetwork: true, env, fetchImpl, db, actorEmail: "founder@ifcdc.org" });
  assert.equal(first.sent, true);
  assert.equal(first.providerMessageId, "fixture-accepted-id");
  assert.equal(second.sent, false);
  assert.equal(second.reason, "duplicate_already_sent");
  assert.equal(second.network, false);
  assert.equal(calls, 1);
  const reserved = await db.get<{ state: string; provider_message_id: string }>(
    "SELECT state, provider_message_id FROM grant_send_reservations",
  );
  assert.equal(reserved?.state, "accepted");
  assert.equal(reserved?.provider_message_id, "fixture-accepted-id");
});

test("an uncertain provider response does not send again", async () => {
  const env = { POSTMARK_SERVER_TOKEN: FIXTURE_POSTMARK } as NodeJS.ProcessEnv;
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw new Error("timeout before a provider message id");
  };
  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const draft = approvedFutureDraft();
  const first = await deliverApprovedGrantOutreach({ draft, today: "2026-10-11" }, { allowNetwork: true, env, fetchImpl, db });
  const second = await deliverApprovedGrantOutreach({ draft, today: "2026-10-11" }, { allowNetwork: true, env, fetchImpl, db });
  assert.equal(first.sent, false);
  assert.equal(first.errorCode, "postmark_uncertain");
  assert.equal(first.deliveryStatus, "uncertain");
  assert.equal(second.sent, false);
  assert.equal(second.reason, "uncertain_awaiting_founder_decision");
  assert.equal(second.network, false);
  assert.equal(calls, 1);
  const reserved = await db.get<{ state: string }>("SELECT state FROM grant_send_reservations");
  assert.equal(reserved?.state, "uncertain");
});

test("the audit row records founder identity, hash, and provider result without a credential", async () => {
  const fakeKey = "fixture-postmark-token-not-real";
  const env = { POSTMARK_SERVER_TOKEN: fakeKey, RESEND_API_KEY: FIXTURE_RESEND } as NodeJS.ProcessEnv;
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    MessageID: "fixture-audit-id",
    ErrorCode: 0,
    Message: `accepted near ${fakeKey}`,
  }), { status: 200 });
  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const draft = approvedFutureDraft();
  const result = await deliverApprovedGrantOutreach(
    { draft, today: "2026-10-11" },
    { allowNetwork: true, env, fetchImpl, db, actorEmail: "founder@ifcdc.org" },
  );
  assert.equal(result.sent, true);
  const stored = await db.get<{ action: string; actor_email: string; detail: string; source_verified_at: string }>(
    "SELECT action, actor_email, detail, source_verified_at FROM grant_audit_events ORDER BY created_at DESC LIMIT 1",
  );
  assert.equal(stored?.action, "POSTMARK_GRANT_ACCEPTED");
  assert.equal(stored?.actor_email, "founder@ifcdc.org");
  assert.equal(stored?.source_verified_at, "2026-10-11T20:15:00.000Z");
  const detail = JSON.parse(stored?.detail || "{}") as {
    founderIdentity: string;
    authorizedAt: string;
    recipient: string;
    subject: string;
    draftVersion: number;
    draftId: string;
    contentHash: string;
    messageKey: string;
    providerMessageId: string;
    deliveryStatus: string;
    deliveryVerification: string;
    providerError: string | null;
  };
  assert.equal(detail.founderIdentity, "founder@ifcdc.org");
  assert.equal(detail.authorizedAt, "2026-10-11T20:15:00.000Z");
  assert.equal(detail.recipient, draft.recipient);
  assert.equal(detail.subject, draft.subject);
  assert.equal(detail.draftVersion, 1);
  assert.equal(detail.draftId, draft.id);
  assert.equal(detail.contentHash, grantApprovedBodyHash(draft.body));
  assert.equal(detail.contentHash.length, 64);
  assert.equal(typeof detail.messageKey, "string");
  assert.equal(detail.providerMessageId, "fixture-audit-id");
  assert.equal(detail.deliveryStatus, "accepted");
  assert.equal(detail.deliveryVerification, "UNVERIFIED");
  assert.equal(JSON.stringify(detail).includes(fakeKey), false);
  assert.equal(JSON.stringify(detail).includes(FIXTURE_RESEND), false);
  assert.equal(JSON.stringify(detail).includes("X-Postmark-Server-Token"), false);
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
});

function tinyPdf(text: string): Buffer {
  const stream = `BT\n(${text}) Tj\nET\n`;
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`
    + `2 0 obj\n<< /Type /Page /Parent 3 0 R /Contents 1 0 R >>\nendobj\n`
    + `3 0 obj\n<< /Type /Pages /Count 1 /Kids [2 0 R] >>\nendobj\n`
    + `4 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n`
    + `trailer << /Root 4 0 R >>\n%%EOF\n`,
    "latin1",
  );
}

const MLK_BODY = `Imperial Foundation Community Development Center (IFCDC) submits the attached narrative and one-page budget for a local commemorative program, The Chair Is a Classroom — From the Barber Chair to the Classroom, proposed for January 18, 2027, in Asbury Park.

The request is $1,000, the published local maximum. The figures are estimates. They are not expenses already incurred and they are not quotations. No direct gifts or gift cards are included.

IFCDC
EIN 47-3125994
1215 Springwood Ave, Suite 28
Asbury Park, NJ 07712
service@ifcdc.org
(732) 743-5048

Fahreal Allah`;

function realSubmissionPdfs(): Array<{ name: string; bytes: Buffer; sha256: string; contentBase64: string }> {
  const folder = new URL("../../IMPERIAL-FOUNDATION-CDC/Documents/products/governance-drafts/", import.meta.url);
  return [
    "MLK-2027-NARRATIVE-SUBMISSION.pdf",
    "MLK-2027-BUDGET-FORM-SUBMISSION.pdf",
  ].map((name) => {
    const bytes = readFileSync(new URL(name, folder));
    return { name, bytes, sha256: grantAttachmentSha256(bytes), contentBase64: bytes.toString("base64") };
  });
}

function mlkDraft(files = realSubmissionPdfs()): GrantOutreachDraft {
  const specs = files.map((file) => ({ name: file.name, sha256: file.sha256 }));
  return {
    id: "mlk-2027-commemorative",
    version: 1,
    mailbox: "service@ifcdc.org",
    recipient: "MLKCommission@sos.nj.gov",
    subject: "MLK27 Commemorative",
    body: MLK_BODY,
    purpose: "mlk-2027-commemorative-mini-grant",
    status: "FOUNDER APPROVED",
    banner: null,
    attachments: specs,
    founderApproval: {
      recorded: true,
      exactBody: MLK_BODY,
      recipient: "MLKCommission@sos.nj.gov",
      subject: "MLK27 Commemorative",
      purpose: "mlk-2027-commemorative-mini-grant",
      draftId: "mlk-2027-commemorative",
      draftVersion: 1,
      authorizedBy: "founder@ifcdc.org",
      authorizedAt: "2026-10-12T11:48:00.000Z",
      attachments: specs,
    },
    grantOutreachSendEnabled: true,
    sentByAura: false,
    applicationStatus: "NOT SUBMITTED",
    notBefore: null,
    deliveryResult: null,
  };
}

test("approved PDFs become Postmark attachments and round-trip to the original bytes", async () => {
  const files = realSubmissionPdfs();
  const built = prepareApprovedGrantAttachments(
    files.map((file) => ({ name: file.name, sha256: file.sha256 })),
    files.map((file) => ({ name: file.name, contentBase64: file.contentBase64 })),
  );
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.attachments.length, 2);
  for (const file of files) {
    const attached = built.attachments.find((item) => item.Name === file.name);
    assert.ok(attached);
    assert.equal(attached?.ContentType, "application/pdf");
    assert.deepEqual(Buffer.from(attached?.Content || "", "base64"), file.bytes);
  }
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("resend")) throw new Error("wrong provider");
    const body = JSON.parse(String(init?.body)) as {
      TextBody?: string;
      Attachments?: Array<{ Name: string; Content: string; ContentType: string }>;
    };
    assert.equal(body.TextBody, MLK_BODY);
    assert.equal(body.Attachments?.length, 2);
    assert.deepEqual(
      body.Attachments?.map((item) => item.Name).sort(),
      files.map((file) => file.name).sort(),
    );
    for (const item of body.Attachments || []) {
      assert.equal(item.ContentType, "application/pdf");
      const original = files.find((file) => file.name === item.Name);
      assert.deepEqual(Buffer.from(item.Content, "base64"), original?.bytes);
    }
    return new Response(JSON.stringify({ MessageID: "fixture-mlk-attached", ErrorCode: 0 }), { status: 200 });
  };
  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const draft = mlkDraft(files);
  const env = { POSTMARK_SERVER_TOKEN: FIXTURE_POSTMARK, RESEND_API_KEY: FIXTURE_RESEND } as NodeJS.ProcessEnv;
  const first = await deliverApprovedGrantOutreach(
    { draft, today: "2026-10-12" },
    { allowNetwork: true, env, fetchImpl, db, actorEmail: "founder@ifcdc.org", attachmentPayloads: files },
  );
  const second = await deliverApprovedGrantOutreach(
    { draft, today: "2026-10-12" },
    { allowNetwork: true, env, fetchImpl, db, actorEmail: "founder@ifcdc.org", attachmentPayloads: files },
  );
  assert.equal(first.sent, true);
  assert.equal(first.providerMessageId, "fixture-mlk-attached");
  assert.equal(second.sent, false);
  assert.equal(second.reason, "duplicate_already_sent");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /api\.postmarkapp\.com\/email$/);
  const stored = await db.get<{ detail: string }>("SELECT detail FROM grant_audit_events ORDER BY created_at DESC LIMIT 1");
  const detail = JSON.parse(stored?.detail || "{}") as { attachmentChecksums?: Array<{ sha256: string }>; deliveryVerification: string };
  assert.equal(detail.deliveryVerification, "UNVERIFIED");
  assert.deepEqual(
    (detail.attachmentChecksums || []).map((item) => item.sha256).sort(),
    files.map((file) => file.sha256).sort(),
  );
  assert.equal(JSON.stringify(detail).includes(FIXTURE_POSTMARK), false);
});

test("a changed attachment checksum invalidates approval and bad bytes never reach Postmark", async () => {
  const files = realSubmissionPdfs();
  const draft = mlkDraft(files);
  const changed = {
    ...draft,
    attachments: draft.attachments?.map((item, index) => index === 0 ? { ...item, sha256: "a".repeat(64) } : item),
  };
  assert.equal(evaluateGrantOutreachSendGate({ draft: changed, today: "2026-10-12" }).reason, "attachment_mismatch");
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    throw new Error("network disabled");
  };
  const env = { POSTMARK_SERVER_TOKEN: FIXTURE_POSTMARK, RESEND_API_KEY: FIXTURE_RESEND } as NodeJS.ProcessEnv;
  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const missing = await deliverApprovedGrantOutreach(
    { draft, today: "2026-10-12" },
    { allowNetwork: true, env, fetchImpl, db, attachmentPayloads: [files[0]] },
  );
  assert.equal(missing.sent, false);
  assert.equal(missing.reason, "attachment_missing");
  const mismatched = await deliverApprovedGrantOutreach(
    { draft, today: "2026-10-12" },
    {
      allowNetwork: true,
      env,
      fetchImpl,
      db,
      attachmentPayloads: files.map((file, index) => ({
        name: file.name,
        contentBase64: index === 0 ? tinyPdf("Other text").toString("base64") : file.contentBase64,
      })),
    },
  );
  assert.equal(mismatched.reason, "attachment_checksum_mismatch");
  const encoded = await deliverApprovedGrantOutreach(
    { draft, today: "2026-10-12" },
    {
      allowNetwork: true,
      env,
      fetchImpl,
      db,
      attachmentPayloads: files.map((file, index) => ({
        name: file.name,
        contentBase64: index === 0 ? "not base64!!!" : file.contentBase64,
      })),
    },
  );
  assert.equal(encoded.reason, "attachment_encoding");
  const corrupt = tinyPdf("DRAFT NOT SUBMITTED");
  const corruptDraft = mlkDraft([{ ...files[0], bytes: corrupt, sha256: grantAttachmentSha256(corrupt), contentBase64: corrupt.toString("base64") }, files[1]]);
  const corrupted = await deliverApprovedGrantOutreach(
    { draft: corruptDraft, today: "2026-10-12" },
    {
      allowNetwork: true,
      env,
      fetchImpl,
      db,
      attachmentPayloads: [
        { name: files[0].name, contentBase64: corrupt.toString("base64") },
        files[1],
      ],
    },
  );
  assert.equal(corrupted.reason, "attachment_corrupt");
  const edited = evaluateGrantOutreachSendGate({
    draft: { ...draft, body: `${draft.body}\nEdited.` },
    today: "2026-10-12",
  });
  assert.equal(edited.reason, "exact_text_mismatch");
  assert.equal(calls.length, 0);
});

test("a text-only grant is still refused when the approval requires the two PDFs", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    throw new Error("network disabled");
  };
  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const result = await deliverApprovedGrantOutreach(
    { draft: mlkDraft(), today: "2026-10-12" },
    { allowNetwork: true, env: { POSTMARK_SERVER_TOKEN: FIXTURE_POSTMARK } as NodeJS.ProcessEnv, fetchImpl, db },
  );
  assert.equal(result.sent, false);
  assert.equal(result.reason, "attachment_missing");
  assert.equal(calls.length, 0);
});

test("an unsigned grant send stays unauthorized", async () => {
  const calls: string[] = [];
  globalThis.fetch = (() => {
    calls.push("fetch");
    throw new Error("network disabled");
  }) as typeof fetch;
  const state: { code: number; body: { sent?: boolean } | null } = { code: 200, body: null };
  const res = {
    status(code: number) { state.code = code; return this; },
    json(body: { sent?: boolean }) { state.body = body; return this; },
  };
  await grantOutreachSendHttp(
    { body: { confirmSend: true } } as unknown as import("express").Request,
    res as unknown as import("express").Response,
  );
  assert.equal(state.code, 401);
  assert.equal(state.body?.sent, false);
  assert.equal(calls.length, 0);
});

test("a generic attachment checksum still blocks a second send without using Resend", async () => {
  const bytes = tinyPdf("Hello grant packet");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256, grantAttachmentSha256(bytes));
  const spec = [{ name: "packet.pdf", sha256 }];
  const draft = approvedFutureDraft();
  draft.attachments = spec;
  draft.founderApproval = { ...draft.founderApproval!, attachments: spec };
  const payload = [{ name: "packet.pdf", contentBase64: bytes.toString("base64") }];
  let calls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls += 1;
    if (String(input).includes("resend")) throw new Error("wrong provider");
    const body = JSON.parse(String(init?.body)) as { Attachments?: Array<{ Content: string }> };
    assert.equal(Buffer.from(body.Attachments?.[0].Content || "", "base64").toString("latin1").includes("Hello grant packet"), true);
    return new Response(JSON.stringify({ MessageID: "fixture-packet", ErrorCode: 0 }), { status: 200 });
  };
  const db = await open({ filename: ":memory:", driver: sqlite3.Database }) as MailDb;
  const env = { POSTMARK_SERVER_TOKEN: FIXTURE_POSTMARK, RESEND_API_KEY: FIXTURE_RESEND } as NodeJS.ProcessEnv;
  const first = await deliverApprovedGrantOutreach({ draft, today: "2026-10-11" }, { allowNetwork: true, env, fetchImpl, db, attachmentPayloads: payload });
  const second = await deliverApprovedGrantOutreach({ draft, today: "2026-10-11" }, { allowNetwork: true, env, fetchImpl, db, attachmentPayloads: payload });
  assert.equal(first.sent, true);
  assert.equal(second.reason, "duplicate_already_sent");
  assert.equal(calls, 1);
});

