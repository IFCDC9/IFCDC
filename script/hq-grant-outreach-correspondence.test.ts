import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import {
  POSTMARK_DELIVERY_TEST_BODY,
  POSTMARK_DELIVERY_TEST_STATUS,
  STONE_INQUIRY_BODY,
  STONE_INQUIRY_STATUS,
  deliverApprovedGrantOutreach,
  evaluateGrantOutreachSendGate,
  grantOutreachSendHttp,
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
        purpose: "future-grant-outreach",
        authorizedBy: "founder",
        authorizedAt: "2026-10-11",
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
        purpose: "future-grant-outreach",
        authorizedBy: "founder",
        authorizedAt: "2026-10-11",
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
      purpose: "future-grant-outreach",
      authorizedBy: "founder",
      authorizedAt: "2026-10-11",
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
  assert.equal(draft.banner, POSTMARK_DELIVERY_TEST_STATUS);
  assert.equal(draft.recipient, "service@ifcdc.org");
  assert.match(draft.subject, /internal Postmark delivery test/);
  assert.match(draft.subject, /NOT A FUNDER EMAIL/);
  assert.match(draft.body, /not a grant application/);
  assert.match(draft.body, /not a message to a funder/);
  assert.match(draft.body, /asks for no money/);
  assert.equal(draft.body, POSTMARK_DELIVERY_TEST_BODY);
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
