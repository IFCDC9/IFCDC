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
import { GRAPH_SEND_MAIL_URL, buildOutboundSendPayload } from "../server/hq/inboundOutboundMail";
import {
  buildOriginalSendPayload,
  createOutboundCompositionHttp,
  reviewOutboundCompositionHttp,
  sendOutboundCompositionHttp,
} from "../server/hq/outboundComposition";

const root = new URL("../", import.meta.url);
const TEST_SUBJECT = "IFCDC HQ — Aura Email System Test";
const TEST_BODY = `This is an official test of the IFCDC Headquarters Aura Communications System.

This message verifies secure Microsoft Graph outbound email transmission, Founder-controlled authorization, and external email delivery.

IFCDC Headquarters
Imperial Foundation Community Development Center`;
const TEST_RECIPIENT = "813786b@gmail.com";
const FIXTURE_GRAPH_TOKEN = "fixture-graph-token";

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
    },
  };
  return { state, res: res as unknown as Response };
}

function asRequest(hqUser: { role?: string } | null, id = "", body?: unknown): Request {
  return { hqUser: hqUser ?? undefined, params: { id }, body: body ?? {} } as Request;
}

async function create(db: MailDb, body: unknown, role: { role?: string } | null = { role: "founder" }) {
  const { state, res } = mockRes();
  await createOutboundCompositionHttp(asRequest(role, "", body), res, { db });
  return state;
}

async function review(db: MailDb, id: string, body: unknown, role: { role?: string } | null = { role: "founder" }) {
  const { state, res } = mockRes();
  await reviewOutboundCompositionHttp(asRequest(role, id, body), res, { db });
  return state;
}

async function send(db: MailDb, id: string, body: unknown, role: { role?: string } | null = { role: "founder" }) {
  const { state, res } = mockRes();
  await sendOutboundCompositionHttp(asRequest(role, id, body), res, { db });
  return state;
}

function installGraphFixture() {
  const keys = ["MICROSOFT_GRAPH_TENANT_ID", "MICROSOFT_GRAPH_CLIENT_ID", "MICROSOFT_GRAPH_CLIENT_SECRET", "INBOUND_MAILBOX_ADDRESS"] as const;
  const values = ["fixture-tenant", "fixture-client", "fixture-secret", "service@ifcdc.org"];
  const previous = keys.map((key) => process.env[key]);
  keys.forEach((key, index) => {
    process.env[key] = values[index];
  });
  return () => {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  };
}

async function withGate(value: string | undefined, run: () => Promise<void>) {
  const previousEnv = process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;
  const previousFetch = globalThis.fetch;
  const restoreGraph = installGraphFixture();
  if (value === undefined) delete process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;
  else process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED = value;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    restoreGraph();
    if (previousEnv === undefined) delete process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;
    else process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED = previousEnv;
  }
}

function mockGraphSend(onSend: (url: string, init?: RequestInit) => { status: number; json: () => Promise<unknown> }) {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/oauth2/v2.0/token")) {
      const params = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
      assert.equal(params.get("scope"), "https://graph.microsoft.com/.default");
      assert.equal((params.get("scope") || "").includes("Mail.Send"), false);
      return { ok: true, status: 200, json: async () => ({ access_token: FIXTURE_GRAPH_TOKEN }) };
    }
    return onSend(href, init);
  }) as typeof fetch;
}

test("original composition stores the exact subject and body without threading", async () => {
  const db = await memoryDb();
  const calls: string[] = [];
  await withGate(undefined, async () => {
    globalThis.fetch = (async () => {
      calls.push("fetch");
      throw new Error("network disabled");
    }) as typeof fetch;
    const created = await create(db, { recipient: TEST_RECIPIENT, subject: TEST_SUBJECT, body: TEST_BODY });
    const draft = created.body?.draft as { id: string; from: string; recipient: string; subject: string; body: string; status: string; sent: boolean; conversationId: null };
    assert.equal(created.code, 201);
    assert.equal(created.body?.sent, false);
    assert.equal(created.body?.status, "NEEDS FOUNDER APPROVAL");
    assert.equal(draft.from, "service@ifcdc.org");
    assert.equal(draft.recipient, TEST_RECIPIENT);
    assert.equal(draft.subject, TEST_SUBJECT);
    assert.equal(draft.body, TEST_BODY);
    assert.equal(draft.conversationId, null);
    assert.equal(draft.sent, false);
    assert.equal(calls.length, 0);
    const payload = buildOriginalSendPayload(draft);
    assert.equal(payload.message.subject, TEST_SUBJECT);
    assert.equal(payload.message.subject.startsWith("Re:"), false);
    assert.equal(payload.message.body.content, TEST_BODY);
    assert.equal("conversationId" in payload.message, false);
    assert.equal(JSON.stringify(payload).includes("contentBytes"), false);
  });
});

test("founder can edit an unapproved original draft and approval does not send", async () => {
  const db = await memoryDb();
  const calls: string[] = [];
  await withGate("true", async () => {
    globalThis.fetch = (async () => {
      calls.push("fetch");
      throw new Error("network disabled");
    }) as typeof fetch;
    const created = await create(db, { recipient: "first@example.com", subject: "Draft subject", body: "First body." });
    const id = (created.body?.draft as { id: string }).id;
    const edited = await review(db, id, { action: "edit", recipient: TEST_RECIPIENT, subject: TEST_SUBJECT, body: TEST_BODY });
    const draft = edited.body?.draft as { subject: string; body: string; recipient: string; status: string };
    assert.equal(draft.subject, TEST_SUBJECT);
    assert.equal(draft.body, TEST_BODY);
    assert.equal(draft.recipient, TEST_RECIPIENT);
    assert.equal(draft.status, "NEEDS FOUNDER APPROVAL");
    const approved = await review(db, id, { action: "approve" });
    assert.equal(approved.body?.sent, false);
    assert.equal(approved.body?.status, "FOUNDER APPROVED");
    assert.equal(calls.length, 0);
    const locked = await review(db, id, { action: "edit", recipient: TEST_RECIPIENT, subject: "Changed", body: TEST_BODY });
    assert.equal(locked.code, 409);
  });
});

test("send gate defaults off and does not call fetch", async () => {
  const db = await memoryDb();
  const calls: string[] = [];
  const created = await create(db, { recipient: TEST_RECIPIENT, subject: TEST_SUBJECT, body: TEST_BODY });
  const id = (created.body?.draft as { id: string }).id;
  await review(db, id, { action: "approve" });
  await withGate(undefined, async () => {
    globalThis.fetch = (async () => {
      calls.push("fetch");
      throw new Error("network disabled");
    }) as typeof fetch;
    const missing = await send(db, id, {});
    assert.equal(missing.body?.sent, false);
    assert.equal(missing.body?.changed, false);
    const blocked = await send(db, id, { confirmSend: true });
    assert.equal(blocked.body?.sent, false);
    assert.equal(blocked.body?.status, "not_enabled");
    assert.equal(calls.length, 0);
  });
});

test("approved confirmSend attaches a fixture bearer token without a conversation id", async () => {
  const db = await memoryDb();
  const created = await create(db, { recipient: TEST_RECIPIENT, subject: TEST_SUBJECT, body: TEST_BODY });
  const id = (created.body?.draft as { id: string }).id;
  await review(db, id, { action: "approve" });
  const calls: Array<{ url: string; authorization?: string; body?: string }> = [];
  await withGate("true", async () => {
    globalThis.fetch = mockGraphSend((url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get("authorization") || "", body: typeof init?.body === "string" ? init.body : "" });
      return { status: 202, json: async () => ({ id: "mock-graph-original" }) };
    });
    const result = await send(db, id, { confirmSend: true }, { role: "owner" });
    assert.equal(result.body?.sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, GRAPH_SEND_MAIL_URL);
    assert.equal(calls[0].authorization, `Bearer ${FIXTURE_GRAPH_TOKEN}`);
    const payload = JSON.parse(calls[0].body || "{}");
    assert.equal(payload.message.subject, TEST_SUBJECT);
    assert.equal(payload.message.body.content, TEST_BODY);
    assert.equal("conversationId" in payload.message, false);
    assert.deepEqual(payload.message.toRecipients, [{ emailAddress: { address: TEST_RECIPIENT } }]);
    assert.match(calls[0].url, /\/users\/service@ifcdc\.org\/sendMail$/);
  });
});

test("a second confirmSend does not call the provider again", async () => {
  const db = await memoryDb();
  const created = await create(db, { recipient: TEST_RECIPIENT, subject: TEST_SUBJECT, body: TEST_BODY });
  const id = (created.body?.draft as { id: string }).id;
  await review(db, id, { action: "approve" });
  let calls = 0;
  await withGate("true", async () => {
    globalThis.fetch = mockGraphSend(() => {
      calls += 1;
      return { status: 202, json: async () => ({ id: "mock-once" }) };
    });
    const first = await send(db, id, { confirmSend: true });
    const second = await send(db, id, { confirmSend: true });
    assert.equal(first.body?.sent, true);
    assert.equal(second.body?.sent, true);
    assert.equal(calls, 1);
    assert.equal((second.body?.record as { id?: string }).id, (first.body?.record as { id?: string }).id);
  });
});

test("original composition requires a founder or owner session", async () => {
  const db = await memoryDb();
  const missing = await create(db, { recipient: TEST_RECIPIENT, subject: TEST_SUBJECT, body: TEST_BODY }, null);
  assert.equal(missing.code, 401);
  const denied = await create(db, { recipient: TEST_RECIPIENT, subject: TEST_SUBJECT, body: TEST_BODY }, { role: "grant_manager" });
  assert.equal(denied.code, 403);
  const owner = await create(db, { recipient: TEST_RECIPIENT, subject: TEST_SUBJECT, body: TEST_BODY }, { role: "owner" });
  assert.equal(owner.code, 201);
});

test("inbound replies still thread and original mail does not use that path", async () => {
  const db = await memoryDb();
  const stored = await ingestInboundBusinessMail(db, {
    providerMessageId: "reply-still-threads",
    threadId: "thread-reply-still-threads",
    senderName: "Alex Kim",
    senderAddress: "alex@example.com",
    recipient: "service@ifcdc.org",
    subject: "Hello from Alex",
    textBody: "Can you share the next community program date?",
    receivedAt: "2026-10-08T15:00:00.000Z",
  });
  const { state, res } = mockRes();
  await generateInboundReplyDraftHttp(asRequest({ role: "founder" }, stored.row.id), res, { db });
  const { state: approvedState, res: approvedRes } = mockRes();
  await reviewInboundReplyDraftHttp(asRequest({ role: "founder" }, stored.row.id, { action: "approve" }), approvedRes, { db });
  assert.equal(approvedState.body?.sent, false);
  const replyPayload = buildOutboundSendPayload({
    inboundId: stored.row.id,
    status: "FOUNDER APPROVED",
    replyText: "Thanks.",
    threadId: "thread-reply-still-threads",
    senderAddress: "alex@example.com",
    subject: "Hello from Alex",
  });
  assert.equal(replyPayload.message.subject, "Re: Hello from Alex");
  assert.equal(replyPayload.message.conversationId, "thread-reply-still-threads");
  const composition = source("server/hq/outboundComposition.ts");
  assert.doesNotMatch(composition, /replySubject/);
  const payloadSource = composition.slice(composition.indexOf("export function buildOriginalSendPayload"), composition.indexOf("async function ensureTables"));
  assert.doesNotMatch(payloadSource, /conversationId|Re:/);
  assert.match(composition, /GRAPH_SEND_MAIL_URL/);
  assert.match(composition, /Authorization: `Bearer \$\{token\.accessToken\}`/);
  const diff = execSync(
    "git diff --name-only -- server/hq/fundingBootGate.ts server/bootstrap/initializeHqModules.ts server/hq/warehouseScheduler.ts server/hq/workflowEngine.ts server/hq/auraProactiveIntelligence.ts server/hq/auraAutonomousOperations.ts script/hq-funding-boot-isolation.test.ts server/hq/microsoftGraphMailbox.ts server/hq/inboundReplyDraft.ts",
    { cwd: fileURLToPath(root) },
  ).toString().trim();
  assert.equal(diff, "");
  const aura = source("server/hq/auraCommandLayer.ts");
  const block = aura.slice(aura.indexOf("isOriginalCompositionRequest"), aura.indexOf("tryRunExecutiveCommand"));
  assert.match(block, /actions: \[\]/);
  assert.doesNotMatch(block, /sendFounderApprovedComposition|confirmSend|GRAPH_SEND_MAIL_URL|fetch\(/);
});
