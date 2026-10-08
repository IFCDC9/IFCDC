import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import type { Request, Response } from "express";
import { ingestInboundBusinessMail, type MailDb } from "../server/hq/inboundBusinessMail";
import {
  generateInboundReplyDraftHttp,
  reviewInboundReplyDraftHttp,
  type InboundReplyDraft,
} from "../server/hq/inboundReplyDraft";

const root = new URL("../", import.meta.url);

function source(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

async function memoryDb(): Promise<MailDb> {
  return open({ filename: ":memory:", driver: sqlite3.Database });
}

function mockRes() {
  const state: { code?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      state.code = code;
      return res;
    },
    json(body: unknown) {
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

type DraftBody = {
  sent?: boolean;
  status?: string;
  activeApproval?: boolean;
  draft?: InboundReplyDraft;
  error?: string;
};

async function generate(db: MailDb, id: string, role: { role?: string } | null = { role: "founder" }, readContext?: (input: { category: string; linked: { kind: string; id: string } | null }) => Promise<string | null>) {
  const { state, res } = mockRes();
  await generateInboundReplyDraftHttp(asRequest(role, id), res, { db, readContext });
  return state as { code?: number; body?: DraftBody };
}

async function review(db: MailDb, id: string, body: unknown, role: { role?: string } | null = { role: "founder" }) {
  const { state, res } = mockRes();
  await reviewInboundReplyDraftHttp(asRequest(role, id, body), res, { db });
  return state as { code?: number; body?: DraftBody };
}

test("aura draft needs founder approval and does not send", async () => {
  const db = await memoryDb();
  const stored = await ingestInboundBusinessMail(db, {
    providerMessageId: "msg-plain-1",
    threadId: "thread-44",
    senderName: "Alex Kim",
    senderAddress: "alex@example.com",
    recipient: "service@ifcdc.org",
    subject: "Hello from Alex",
    textBody: "Can you share the next community program date?",
    receivedAt: "2026-10-08T15:00:00.000Z",
  });
  let contextReads = 0;
  const previousFetch = globalThis.fetch;
  const fetchCalls: string[] = [];
  globalThis.fetch = (async () => {
    fetchCalls.push("fetch");
    throw new Error("network disabled");
  }) as typeof fetch;
  try {
    const created = await generate(db, stored.row.id, { role: "founder" }, async () => {
      contextReads += 1;
      return null;
    });
    assert.equal(created.code, 200);
    assert.equal(created.body?.sent, false);
    assert.equal(created.body?.status, "NEEDS FOUNDER APPROVAL");
    assert.equal(created.body?.activeApproval, true);
    assert.equal(created.body?.draft?.threadId, "thread-44");
    assert.equal(created.body?.draft?.providerMessageId, "msg-plain-1");
    assert.equal(created.body?.draft?.senderName, "Alex Kim");
    assert.equal(created.body?.draft?.senderAddress, "alex@example.com");
    assert.equal(created.body?.draft?.subject, "Hello from Alex");
    assert.equal(created.body?.draft?.linked, null);
    assert.equal(created.body?.draft?.summary.organization, "unavailable");
    assert.equal(created.body?.draft?.summary.deadline, "unavailable");
    assert.equal(created.body?.draft?.summary.whoSent.includes("Alex Kim"), true);
    assert.equal(created.body?.draft?.summary.whatTheyWant.includes("community program"), true);
    assert.equal(created.body?.draft?.summary.priority, "normal");
    assert.equal(created.body?.draft?.summary.recommendedResponse, created.body?.draft?.replyText.slice(0, 180));
    assert.match(created.body?.draft?.replyText || "", /has not been sent/);
    assert.match(created.body?.draft?.summary.risk || "", /commitment/i);
    assert.equal(created.body?.draft?.hqContext, "HQ context is unavailable.");
    assert.doesNotMatch(JSON.stringify(created.body), /\$\d/);
    assert.equal(contextReads, 1);
    assert.equal(fetchCalls.length, 0);

    const edited = await review(db, stored.row.id, { action: "edit", replyText: "Thanks, Alex. I will review this with the Founder." });
    assert.equal(edited.body?.sent, false);
    assert.equal(edited.body?.status, "NEEDS FOUNDER APPROVAL");
    assert.equal(edited.body?.draft?.replyText, "Thanks, Alex. I will review this with the Founder.");
    assert.equal(fetchCalls.length, 0);

    const approved = await review(db, stored.row.id, { action: "approve" });
    assert.equal(approved.code, 200);
    assert.equal(approved.body?.sent, false);
    assert.equal(approved.body?.status, "FOUNDER APPROVED");
    assert.equal(approved.body?.activeApproval, false);
    assert.equal(contextReads, 1);
    assert.equal(fetchCalls.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("reject and save-for-later keep the reply unsent", async () => {
  const db = await memoryDb();
  const rejected = await ingestInboundBusinessMail(db, {
    providerMessageId: "msg-reject-1",
    threadId: "thread-reject",
    senderName: "Sam",
    senderAddress: "sam@example.com",
    recipient: "service@ifcdc.org",
    subject: "A question",
    textBody: "Please look at this note.",
    receivedAt: "2026-10-08T15:10:00.000Z",
  });
  const later = await ingestInboundBusinessMail(db, {
    providerMessageId: "msg-later-1",
    threadId: "thread-later",
    senderName: "Sam",
    senderAddress: "sam@example.com",
    recipient: "service@ifcdc.org",
    subject: "Another question",
    textBody: "Please look at this other note.",
    receivedAt: "2026-10-08T15:20:00.000Z",
  });
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("network disabled");
  }) as typeof fetch;
  try {
    await generate(db, rejected.row.id);
    const rejectResult = await review(db, rejected.row.id, { action: "reject" });
    assert.equal(rejectResult.body?.sent, false);
    assert.equal(rejectResult.body?.status, "REJECTED");
    assert.equal(rejectResult.body?.activeApproval, false);
    assert.equal(rejectResult.body?.draft?.threadId, "thread-reject");

    await generate(db, later.row.id, { role: "owner" });
    const saved = await review(db, later.row.id, { action: "save-for-later" }, { role: "owner" });
    assert.equal(saved.body?.sent, false);
    assert.equal(saved.body?.status, "SAVED FOR LATER");
    assert.equal(saved.body?.activeApproval, false);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("draft keeps a proven link and evidenced organization without inventing figures", async () => {
  const db = await memoryDb();
  const stored = await ingestInboundBusinessMail(db, {
    providerMessageId: "msg-grant-link",
    threadId: "thread-grant",
    senderName: "North Clinic",
    senderAddress: "grants@foundation.example",
    recipient: "service@ifcdc.org",
    subject: "Grant record grant-opp-441",
    textBody: "organization: North Clinic. The grant file references grant-opp-441. The deadline is 2026-11-01.",
    receivedAt: "2026-10-08T16:00:00.000Z",
  }, [{ kind: "grant", id: "grant-opp-441" }]);
  const created = await generate(db, stored.row.id, { role: "founder" }, async () => "One stored grant link is already on the message.");
  assert.deepEqual(created.body?.draft?.linked, { kind: "grant", id: "grant-opp-441" });
  assert.equal(created.body?.draft?.summary.organization, "North Clinic");
  assert.equal(created.body?.draft?.summary.deadline, "2026-11-01");
  assert.match(created.body?.draft?.hqContext || "", /already on the message/);
  assert.equal(created.body?.sent, false);
  const secret = await generate(db, stored.row.id, { role: "founder" }, async () => "bearer token sk-secret");
  assert.equal(secret.body?.draft?.hqContext, "HQ context is unavailable.");
  assert.equal(secret.body?.draft?.linked?.id, "grant-opp-441");
});

test("draft routes require a founder or owner session", async () => {
  const db = await memoryDb();
  const missing = await generate(db, "missing", null);
  assert.equal(missing.code, 401);
  assert.match(JSON.stringify(missing.body), /Authentication required/);
  const denied = await review(db, "missing", { action: "approve" }, { role: "grant_manager" });
  assert.equal(denied.code, 403);
  assert.match(JSON.stringify(denied.body), /Founder session required/);
  const other = await generate(db, "missing", { role: "user" });
  assert.equal(other.code, 403);
});

test("draft module does not send and Phase 4A files stay unchanged", () => {
  const draft = source("server/hq/inboundReplyDraft.ts");
  const graph = source("server/hq/microsoftGraphMailbox.ts");
  assert.doesNotMatch(draft, /sendMail|postmark|graph\.microsoft\.com|Mail\.Send|Mail\.ReadWrite|deliverTransactionalEmail|fetch\(/);
  assert.match(draft, /NEEDS FOUNDER APPROVAL/);
  assert.match(draft, /sent: false/);
  assert.match(graph, /MAILBOX_SYNC_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.doesNotMatch(graph, /sendMail|createReply|\/\$value|setTimeout/);
  const diff = execSync(
    "git diff --name-only -- server/hq/fundingBootGate.ts server/bootstrap/initializeHqModules.ts server/hq/warehouseScheduler.ts server/hq/workflowEngine.ts server/hq/auraProactiveIntelligence.ts server/hq/auraAutonomousOperations.ts script/hq-funding-boot-isolation.test.ts server/hq/microsoftGraphMailbox.ts",
    { cwd: fileURLToPath(root) },
  ).toString().trim();
  assert.equal(diff, "");
});
