import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import type { Request, Response } from "express";
import { ingestInboundBusinessMail, type MailDb } from "../server/hq/inboundBusinessMail";
import { generateInboundReplyDraftHttp, reviewInboundReplyDraftHttp } from "../server/hq/inboundReplyDraft";
import {
  GRAPH_SEND_MAIL_URL,
  answerOutboundDraftStatus,
  buildOutboundSendPayload,
  isOutboundDraftStatusQuestion,
  outboundMailSendEnabled,
  sendFounderApprovedDraftHttp,
} from "../server/hq/inboundOutboundMail";

const root = new URL("../", import.meta.url);

function source(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

async function memoryDb(): Promise<MailDb> {
  return open({ filename: ":memory:", driver: sqlite3.Database });
}

function mockRes() {
  const state: { code?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      state.code = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      if (state.code == null) state.code = 200;
      state.body = body;
      return res;
    },
  };
  return { state, res: res as unknown as Response };
}

function asRequest(hqUser: { role?: string } | null, id: string, body?: unknown): Request {
  return { hqUser: hqUser ?? undefined, params: { id }, body: body ?? {} } as Request;
}

async function generate(db: MailDb, id: string) {
  const { state, res } = mockRes();
  await generateInboundReplyDraftHttp(asRequest({ role: "founder" }, id), res, { db });
  return state;
}

async function review(db: MailDb, id: string, body: unknown) {
  const { state, res } = mockRes();
  await reviewInboundReplyDraftHttp(asRequest({ role: "founder" }, id, body), res, { db });
  return state;
}

async function send(db: MailDb, id: string, body: unknown, role: { role?: string } | null = { role: "founder" }) {
  const { state, res } = mockRes();
  await sendFounderApprovedDraftHttp(asRequest(role, id, body), res, { db });
  return state;
}

async function approvedDraft(db: MailDb, providerMessageId: string, subject = "Hello from Alex", replyText?: string) {
  const stored = await ingestInboundBusinessMail(db, {
    providerMessageId,
    threadId: `thread-${providerMessageId}`,
    senderName: "Alex Kim",
    senderAddress: "alex@example.com",
    recipient: "service@ifcdc.org",
    subject,
    textBody: "Can you share the next community program date?",
    receivedAt: "2026-10-08T15:00:00.000Z",
  });
  await generate(db, stored.row.id);
  if (replyText) await review(db, stored.row.id, { action: "edit", replyText });
  const approved = await review(db, stored.row.id, { action: "approve" });
  assert.equal(approved.body?.sent, false);
  assert.equal(approved.body?.status, "FOUNDER APPROVED");
  return stored.row.id;
}

async function withGate(value: string | undefined, run: () => Promise<void>) {
  const previousEnv = process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;
  const previousFetch = globalThis.fetch;
  if (value === undefined) delete process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;
  else process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED = value;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnv === undefined) delete process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;
    else process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED = previousEnv;
  }
}

test("send gate defaults off and does not call fetch", async () => {
  const db = await memoryDb();
  const id = await approvedDraft(db, "msg-gate-off");
  const calls: string[] = [];
  await withGate(undefined, async () => {
    assert.equal(outboundMailSendEnabled(), false);
    globalThis.fetch = (async () => {
      calls.push("fetch");
      throw new Error("network disabled");
    }) as typeof fetch;
    const result = await send(db, id, { confirmSend: true });
    assert.equal(result.code, 200);
    assert.equal(result.body?.sent, false);
    assert.equal(result.body?.status, "not_enabled");
    assert.equal((result.body?.record as { status?: string })?.status, "blocked");
    assert.equal((result.body?.record as { errorCode?: string })?.errorCode, "not_enabled");
    assert.equal(calls.length, 0);

    process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED = "1";
    const stillOff = await send(db, id, { confirmSend: true });
    assert.equal(stillOff.body?.sent, false);
    assert.equal(calls.length, 0);
  });
});

test("unapproved draft cannot send and approve does not send", async () => {
  const db = await memoryDb();
  const stored = await ingestInboundBusinessMail(db, {
    providerMessageId: "msg-unapproved",
    threadId: "thread-unapproved",
    senderName: "Alex Kim",
    senderAddress: "alex@example.com",
    recipient: "service@ifcdc.org",
    subject: "Hello from Alex",
    textBody: "A note.",
    receivedAt: "2026-10-08T15:00:00.000Z",
  });
  await generate(db, stored.row.id);
  const calls: string[] = [];
  await withGate("true", async () => {
    globalThis.fetch = (async () => {
      calls.push("fetch");
      throw new Error("network disabled");
    }) as typeof fetch;
    const blocked = await send(db, stored.row.id, { confirmSend: true });
    assert.equal(blocked.body?.sent, false);
    assert.equal(blocked.body?.status, "blocked");
    assert.equal((blocked.body?.record as { errorCode?: string })?.errorCode, "not_approved");
    const draft = await db.get<{ status: string }>("SELECT status FROM hq_inbound_reply_drafts WHERE inbound_id = ?", stored.row.id);
    assert.equal(draft?.status, "NEEDS FOUNDER APPROVAL");

    const approved = await review(db, stored.row.id, { action: "approve" });
    assert.equal(approved.body?.sent, false);
    assert.equal(approved.body?.status, "FOUNDER APPROVED");
    assert.equal(calls.length, 0);
  });
});

test("approved confirmSend uses the service mailbox send URL once", async () => {
  const db = await memoryDb();
  const id = await approvedDraft(db, "msg-send-once", "Hello from Alex", "Thanks. Please see the attachment list later.");
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  let pendingDuring = "";
  await withGate("true", async () => {
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const row = await db.get<{ status: string }>("SELECT status FROM hq_inbound_outbound_sends WHERE draft_id = ?", id);
      pendingDuring = row?.status || "";
      calls.push({ url: String(url), method: init?.method, body: typeof init?.body === "string" ? init.body : "" });
      return { status: 202, json: async () => ({ id: "mock-graph-1" }) };
    }) as typeof fetch;
    const result = await send(db, id, { confirmSend: true }, { role: "owner" });
    assert.equal(result.body?.sent, true);
    assert.equal(result.body?.status, "sent");
    assert.equal(pendingDuring, "pending");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, GRAPH_SEND_MAIL_URL);
    assert.equal(calls[0].method, "POST");
    assert.match(calls[0].url, /\/users\/service@ifcdc\.org\/sendMail$/);
    assert.doesNotMatch(calls[0].url, /mailFolders\/inbox/);
    const payload = JSON.parse(calls[0].body || "{}");
    assert.equal(payload.message.conversationId, "thread-msg-send-once");
    assert.equal(payload.message.subject, "Re: Hello from Alex");
    assert.deepEqual(payload.message.toRecipients, [{ emailAddress: { address: "alex@example.com" } }]);
    assert.equal(payload.message.attachments, undefined);
    assert.equal(JSON.stringify(payload).includes("contentBytes"), false);
    const record = result.body?.record as { providerMessageId?: string; attachmentsNote?: string; actorRole?: string; duplicateKey?: string };
    assert.equal(record.providerMessageId, "mock-graph-1");
    assert.equal(record.attachmentsNote, "attachments not included");
    assert.equal(record.actorRole, "owner");
    assert.equal(record.duplicateKey, `draft-send:${id}`);
  });
});

test("missing confirmSend leaves the draft unchanged", async () => {
  const db = await memoryDb();
  const id = await approvedDraft(db, "msg-no-confirm");
  const calls: string[] = [];
  await withGate("true", async () => {
    globalThis.fetch = (async () => {
      calls.push("fetch");
      throw new Error("network disabled");
    }) as typeof fetch;
    const missing = await send(db, id, {});
    assert.equal(missing.body?.sent, false);
    assert.equal(missing.body?.status, "FOUNDER APPROVED");
    assert.equal(missing.body?.changed, false);
    assert.equal(missing.body?.record, null);
    const stringTrue = await send(db, id, { confirmSend: "true" });
    assert.equal(stringTrue.body?.sent, false);
    assert.equal(stringTrue.body?.changed, false);
    assert.equal(calls.length, 0);
    const draft = await db.get<{ status: string }>("SELECT status FROM hq_inbound_reply_drafts WHERE inbound_id = ?", id);
    assert.equal(draft?.status, "FOUNDER APPROVED");
  });
});

test("a second confirmSend does not call the provider again", async () => {
  const db = await memoryDb();
  const id = await approvedDraft(db, "msg-duplicate");
  let calls = 0;
  await withGate("true", async () => {
    globalThis.fetch = (async () => {
      calls += 1;
      return { status: 202, json: async () => ({ id: "mock-graph-once" }) };
    }) as typeof fetch;
    const first = await send(db, id, { confirmSend: true });
    const second = await send(db, id, { confirmSend: true });
    assert.equal(first.body?.sent, true);
    assert.equal(second.body?.sent, true);
    assert.equal(calls, 1);
    assert.equal((second.body?.record as { id?: string }).id, (first.body?.record as { id?: string }).id);
    assert.equal((second.body?.record as { duplicateKey?: string }).duplicateKey, `draft-send:${id}`);
  });
});

test("a mocked provider error is recorded once and does not retry", async () => {
  const db = await memoryDb();
  const id = await approvedDraft(db, "msg-failed");
  let calls = 0;
  await withGate("true", async () => {
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      assert.equal(String(url), GRAPH_SEND_MAIL_URL);
      assert.equal(init?.method, "POST");
      assert.doesNotMatch(String(url), /mailFolders\/inbox|isRead/);
      return { status: 503, json: async () => ({ error: { code: "ErrorSendAsDenied" } }) };
    }) as typeof fetch;
    const failed = await send(db, id, { confirmSend: true });
    assert.equal(failed.body?.sent, false);
    assert.equal(failed.body?.status, "failed");
    assert.equal((failed.body?.record as { errorCode?: string }).errorCode, "ErrorSendAsDenied");
    assert.equal(calls, 1);
    const draft = await db.get<{ status: string }>("SELECT status FROM hq_inbound_reply_drafts WHERE inbound_id = ?", id);
    assert.equal(draft?.status, "FOUNDER APPROVED");
  });
});

test("send route requires a founder or owner session", async () => {
  const db = await memoryDb();
  await withGate("true", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network disabled");
    }) as typeof fetch;
    const missing = await send(db, "missing", { confirmSend: true }, null);
    assert.equal(missing.code, 401);
    assert.match(JSON.stringify(missing.body), /Authentication required/);
    const denied = await send(db, "missing", { confirmSend: true }, { role: "grant_manager" });
    assert.equal(denied.code, 403);
    assert.match(JSON.stringify(denied.body), /Founder session required/);
  });
});

test("threading uses the stored sender unless the Founder edits recipients", () => {
  const payload = buildOutboundSendPayload({
    inboundId: "draft-1",
    status: "FOUNDER APPROVED",
    replyText: "Thanks.",
    threadId: "thread-44",
    senderAddress: "alex@example.com",
    subject: "Re: Hello from Alex",
  });
  assert.equal(payload.message.subject, "Re: Hello from Alex");
  assert.equal(payload.message.conversationId, "thread-44");
  assert.deepEqual(payload.message.toRecipients.map((item) => item.emailAddress.address), ["alex@example.com"]);
  const edited = buildOutboundSendPayload({
    inboundId: "draft-1",
    status: "FOUNDER APPROVED",
    replyText: "Thanks.",
    threadId: "thread-44",
    senderAddress: "alex@example.com",
    subject: "Hello from Alex",
  }, { recipients: ["founder-edit@example.com"] });
  assert.equal(edited.message.subject, "Re: Hello from Alex");
  assert.deepEqual(edited.message.toRecipients.map((item) => item.emailAddress.address), ["founder-edit@example.com"]);
  assert.equal(JSON.stringify(edited).includes("contentBytes"), false);
});

test("aura can read outbound draft counts and does not send", async () => {
  const db = await memoryDb();
  const approvedOnly = await approvedDraft(db, "msg-aura-approved");
  const sentId = await approvedDraft(db, "msg-aura-sent");
  const failedId = await approvedDraft(db, "msg-aura-failed");
  let calls = 0;
  await withGate("true", async () => {
    globalThis.fetch = (async () => {
      calls += 1;
      return { status: 202, json: async () => ({ id: "mock-aura-sent" }) };
    }) as typeof fetch;
    await send(db, sentId, { confirmSend: true });
    globalThis.fetch = (async () => {
      calls += 1;
      return { status: 500, json: async () => ({ error: { code: "ErrorTemporary" } }) };
    }) as typeof fetch;
    await send(db, failedId, { confirmSend: true });
  });
  await db.run(
    `INSERT INTO hq_inbound_outbound_sends (
      id, draft_id, actor_role, created_at, updated_at, status, provider_message_id, error_code, duplicate_key, attachments_note
    ) VALUES ('pending-row', ?, 'founder', '2026-10-08T16:00:00.000Z', '2026-10-08T16:00:00.000Z', 'pending', NULL, NULL, NULL, 'no attachments')`,
    approvedOnly,
  );
  const before = calls;
  await withGate(undefined, async () => {
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("network disabled");
    }) as typeof fetch;
    assert.equal(isOutboundDraftStatusQuestion("outbound draft status"), true);
    assert.equal(outboundMailSendEnabled(), false);
    const answer = await answerOutboundDraftStatus(db);
    assert.match(answer, /Approved drafts: 3/);
    assert.match(answer, /Sent: 1/);
    assert.match(answer, /Failed: 1/);
    assert.match(answer, /Pending: 1/);
    assert.equal(calls, before);
  });
  const aura = source("server/hq/auraCommandLayer.ts");
  const block = aura.slice(aura.indexOf("isOutboundDraftStatusQuestion"), aura.indexOf("tryRunExecutiveCommand"));
  assert.match(block, /actions: \[\]/);
  assert.doesNotMatch(block, /sendFounderApprovedDraft|confirmSend|GRAPH_SEND_MAIL_URL/);
});

test("outbound module leaves the read sync and Phase 4A files unchanged", () => {
  const outbound = source("server/hq/inboundOutboundMail.ts");
  const graph = source("server/hq/microsoftGraphMailbox.ts");
  const draft = source("server/hq/inboundReplyDraft.ts");
  assert.match(outbound, /IFCDC_OUTBOUND_MAIL_SEND_ENABLED === "true"/);
  assert.match(outbound, /SERVICE_MAILBOX = "service@ifcdc.org"/);
  assert.match(outbound, /\$\{SERVICE_MAILBOX\}\/sendMail/);
  assert.match(outbound, /application Mail\.Send only/);
  assert.doesNotMatch(outbound, /mailFolders\/inbox|startMicrosoftGraphMailboxSync|setInterval/);
  assert.doesNotMatch(draft, /sendMail|graph\.microsoft\.com|Mail\.Send/);
  assert.match(graph, /MAILBOX_SYNC_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.doesNotMatch(graph, /sendMail|createReply|\/\$value|setTimeout/);
  const diff = execSync(
    "git diff --name-only -- server/hq/fundingBootGate.ts server/bootstrap/initializeHqModules.ts server/hq/warehouseScheduler.ts server/hq/workflowEngine.ts server/hq/auraProactiveIntelligence.ts server/hq/auraAutonomousOperations.ts script/hq-funding-boot-isolation.test.ts server/hq/microsoftGraphMailbox.ts",
    { cwd: fileURLToPath(root) },
  ).toString().trim();
  assert.equal(diff, "");
});
