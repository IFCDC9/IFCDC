import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import type { Request, Response } from "express";
import {
  answerInboundMailQuestion,
  listInboundBusinessMail,
  saveInboundDraftSuggestion,
  type MailDb,
} from "../server/hq/inboundBusinessMail";
import {
  GRAPH_SCOPE,
  graphMailboxHealth,
  graphMailboxHealthHttp,
  pollMicrosoftGraphMailbox,
  resetGraphMailboxPollStateForTests,
} from "../server/hq/microsoftGraphMailbox";

const root = new URL("../", import.meta.url);
const FIXTURE_SECRET = "fixture-graph-secret-not-real";
const FIXTURE_TENANT = "fixture-tenant";
const FIXTURE_CLIENT = "fixture-client";
const FIXTURE_MAILBOX = "service@ifcdc.org";

const configuredEnv = {
  MICROSOFT_GRAPH_TENANT_ID: FIXTURE_TENANT,
  MICROSOFT_GRAPH_CLIENT_ID: FIXTURE_CLIENT,
  MICROSOFT_GRAPH_CLIENT_SECRET: FIXTURE_SECRET,
  INBOUND_MAILBOX_ADDRESS: FIXTURE_MAILBOX,
};

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

function graphMessage() {
  return {
    id: "graph-msg-1",
    conversationId: "thread-grant-1",
    subject: "Grant NOFO",
    from: { emailAddress: { name: "Grants Office", address: "grants@foundation.example" } },
    toRecipients: [{ emailAddress: { name: "IFCDC", address: FIXTURE_MAILBOX } }],
    receivedDateTime: "2026-10-07T18:00:00.000Z",
    body: {
      contentType: "html",
      content: "<p>This grant NOFO needs founder attention. The deadline is 2026-11-01. There is a meeting. Please reply. This is urgent.</p>",
    },
    hasAttachments: true,
    attachments: [{
      name: "nofo.pdf",
      contentType: "application/pdf",
      size: 1200,
      contentBytes: "SHOULD-NOT-STORE",
    }],
  };
}

function unmatchedMessage() {
  return {
    id: "graph-msg-unmatched",
    conversationId: "thread-hello",
    subject: "Hello",
    from: { emailAddress: { name: "Visitor", address: "visitor@example.com" } },
    toRecipients: [{ emailAddress: { address: FIXTURE_MAILBOX } }],
    receivedDateTime: "2026-10-07T18:05:00.000Z",
    body: { contentType: "text", content: "Just saying hello." },
    hasAttachments: false,
  };
}

function financeMessage() {
  return {
    id: "graph-msg-invoice",
    conversationId: "thread-invoice",
    subject: "Invoice",
    from: { emailAddress: { name: "Finance", address: "billing@example.com" } },
    toRecipients: [{ emailAddress: { address: FIXTURE_MAILBOX } }],
    receivedDateTime: "2026-10-07T18:06:00.000Z",
    body: { contentType: "text", content: "The invoice for payment is attached." },
    hasAttachments: false,
  };
}

function fundingMessage() {
  return {
    id: "graph-msg-funding",
    conversationId: "thread-funding",
    subject: "Funding opportunity",
    from: { emailAddress: { name: "Programs", address: "programs@example.com" } },
    toRecipients: [{ emailAddress: { address: FIXTURE_MAILBOX } }],
    receivedDateTime: "2026-10-07T18:07:00.000Z",
    body: { contentType: "text", content: "A funding opportunity is open." },
    hasAttachments: false,
  };
}

function mockFetch(messages = [graphMessage(), unmatchedMessage(), financeMessage(), fundingMessage()]) {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body });
    if (url.includes("/oauth2/v2.0/token")) {
      return new Response(JSON.stringify({ access_token: "fixture-access-token", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/mailFolders/inbox/messages")) {
      return new Response(JSON.stringify({ value: messages }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("unexpected", { status: 500 });
  };
  return { calls, fetchImpl };
}

function assertNoSecret(value: unknown) {
  const encoded = JSON.stringify(value);
  const hash = createHash("sha256").update(FIXTURE_SECRET).digest("hex");
  assert.equal(encoded.includes(FIXTURE_SECRET), false);
  assert.equal(encoded.includes(FIXTURE_SECRET.slice(0, 12)), false);
  assert.equal(encoded.includes(hash), false);
  assert.equal(encoded.includes(FIXTURE_TENANT), false);
  assert.equal(encoded.includes(FIXTURE_CLIENT), false);
  assert.equal(encoded.includes("fixture-access-token"), false);
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === "object") {
      for (const item of Object.values(node as Record<string, unknown>)) walk(item);
      return;
    }
    assert.notEqual(node, FIXTURE_SECRET.length);
    assert.notEqual(node, String(FIXTURE_SECRET.length));
  };
  walk(value);
}

test("missing Graph env does not call the network", async () => {
  resetGraphMailboxPollStateForTests();
  const db = await memoryDb();
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error(FIXTURE_SECRET);
  };
  const result = await pollMicrosoftGraphMailbox({
    db,
    fetchImpl,
    env: {
      MICROSOFT_GRAPH_TENANT_ID: " ",
      MICROSOFT_GRAPH_CLIENT_ID: FIXTURE_CLIENT,
      MICROSOFT_GRAPH_CLIENT_SECRET: "",
      INBOUND_MAILBOX_ADDRESS: FIXTURE_MAILBOX,
    },
  });
  assert.equal(called, false);
  assert.equal(result.status, "not_configured");
  assert.equal(JSON.stringify(result).includes(FIXTURE_SECRET), false);
  const health = graphMailboxHealth({
    MICROSOFT_GRAPH_TENANT_ID: "",
    MICROSOFT_GRAPH_CLIENT_ID: "",
    MICROSOFT_GRAPH_CLIENT_SECRET: "",
    INBOUND_MAILBOX_ADDRESS: "",
  });
  assert.equal(health.microsoftGraphConfigured, false);
  assert.equal(health.inboundMailboxConfigured, false);
  assert.equal(health.graphReadReady, false);
  assert.equal(health.lastMailboxPollStatus, "not_configured");
  assertNoSecret(health);
});

test("fixture Graph mail is stored once and a second poll does not duplicate it", async () => {
  resetGraphMailboxPollStateForTests();
  const db = await memoryDb();
  const firstFetch = mockFetch();
  const first = await pollMicrosoftGraphMailbox({ db, fetchImpl: firstFetch.fetchImpl, env: configuredEnv });
  assert.equal(first.status, "ok");
  assert.equal(first.created, 4);
  assert.equal(first.alreadyStored, 0);

  const secondFetch = mockFetch();
  const second = await pollMicrosoftGraphMailbox({ db, fetchImpl: secondFetch.fetchImpl, env: configuredEnv });
  assert.equal(second.status, "ok");
  assert.equal(second.created, 0);
  assert.equal(second.alreadyStored, 4);

  const rows = await listInboundBusinessMail(db);
  assert.equal(rows.length, 4);
  const grant = rows.find((row) => row.providerMessageId === "graph-msg-1");
  assert.ok(grant);
  assert.equal(grant?.category, "Grants");
  assert.equal(grant?.unmatched, false);
  assert.equal(grant?.founderAttention, true);
  assert.equal(grant?.urgency, "high");
  assert.equal(grant?.flags.deadline, true);
  assert.equal(grant?.deadline, "2026-11-01");
  assert.equal(grant?.flags.meeting, true);
  assert.equal(grant?.awaitingReply, true);
  assert.equal(grant?.senderName, "Grants Office");
  assert.equal(grant?.senderAddress, "grants@foundation.example");
  assert.equal(grant?.recipient, FIXTURE_MAILBOX);
  assert.equal(grant?.threadId, "thread-grant-1");
  assert.equal(grant?.textBody.includes("<p>"), false);
  assert.match(grant?.textBody || "", /grant NOFO/i);
  assert.deepEqual(grant?.attachments, [{ filename: "nofo.pdf", contentType: "application/pdf", size: 1200 }]);
  assert.equal(JSON.stringify(grant).includes("SHOULD-NOT-STORE"), false);

  const unmatched = rows.find((row) => row.providerMessageId === "graph-msg-unmatched");
  assert.equal(unmatched?.category, "General");
  assert.equal(unmatched?.unmatched, true);
  const invoice = rows.find((row) => row.providerMessageId === "graph-msg-invoice");
  assert.equal(invoice?.category, "Finance");
  assert.equal(invoice?.flags.payment, true);
  const funding = rows.find((row) => row.providerMessageId === "graph-msg-funding");
  assert.equal(funding?.flags.fundingOpportunity, true);

  const summary = answerInboundMailQuestion(`Summarize this email ${grant?.id}`, rows);
  assert.match(summary, /Grant NOFO/);
  assert.match(summary, /grants@foundation.example/);
  assert.equal(summary.includes("SHOULD-NOT-STORE"), false);

  const draft = await saveInboundDraftSuggestion(db, grant!.id, "Thanks, I will review the NOFO.");
  assert.equal(draft?.draftSuggestion, "Thanks, I will review the NOFO.");
  assert.equal(firstFetch.calls.length, 2);
  assert.equal(secondFetch.calls.length, 2);
});

test("Graph calls are Mail.Read GETs and do not request attachment bytes", async () => {
  resetGraphMailboxPollStateForTests();
  const db = await memoryDb();
  const { calls, fetchImpl } = mockFetch();
  await pollMicrosoftGraphMailbox({ db, fetchImpl, env: configuredEnv });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/oauth2\/v2\.0\/token$/);
  assert.match(calls[0].body, new RegExp(`scope=${encodeURIComponent(GRAPH_SCOPE)}`));
  assert.equal(calls[0].body.includes("Mail.Send"), false);
  assert.equal(calls[1].method, "GET");
  assert.match(calls[1].url, /\/mailFolders\/inbox\/messages/);
  assert.match(calls[1].url, /\$select=id,conversationId,subject,from,toRecipients,receivedDateTime,body,hasAttachments/);
  assert.match(calls[1].url, /attachments\(\$select=name,contentType,size\)/);
  for (const call of calls) {
    assert.equal(call.method === "POST" || call.method === "GET", true);
    assert.doesNotMatch(call.url, /sendMail|createReply|\/move|\/\$value|Mail\.Send|isRead/i);
    assert.doesNotMatch(call.body, /Mail\.Send|isRead|sendMail/i);
  }
});

test("mailbox health hides secrets and allows only founder or owner", async () => {
  resetGraphMailboxPollStateForTests();
  const db = await memoryDb();
  const { fetchImpl } = mockFetch();
  await pollMicrosoftGraphMailbox({ db, fetchImpl, env: configuredEnv });
  const health = graphMailboxHealth(configuredEnv);
  assert.equal(health.microsoftGraphConfigured, true);
  assert.equal(health.inboundMailboxConfigured, true);
  assert.equal(health.graphReadReady, true);
  assert.equal(health.lastMailboxPollStatus, "ok");
  assert.match(health.lastSuccessfulMailboxPoll || "", /^\d{4}-\d{2}-\d{2}T/);
  assertNoSecret(health);

  const call = async (hqUser: { role?: string } | undefined) => {
    const { state, res } = mockRes();
    await graphMailboxHealthHttp({ hqUser } as Request, res, configuredEnv);
    return state;
  };
  const missing = await call(undefined);
  assert.equal(missing.code, 401);
  assert.match(JSON.stringify(missing.body), /Authentication required/);
  for (const role of ["grant_manager", "user"]) {
    const denied = await call({ role });
    assert.equal(denied.code, 403);
    assert.match(JSON.stringify(denied.body), /Founder session required/);
    assertNoSecret(denied.body);
  }
  for (const role of ["founder", "owner"]) {
    const allowed = await call({ role });
    assert.equal(allowed.code, 200);
    assertNoSecret(allowed.body);
    const body = allowed.body as GraphHealth;
    assert.equal(body.graphReadReady, true);
  }
});

type GraphHealth = {
  graphReadReady: boolean;
};

test("connector source does not send, poll on boot, or change Phase 4A", () => {
  const connector = source("server/hq/microsoftGraphMailbox.ts");
  const routes = source("server/routes/communications.routes.ts");
  const boot = source("server/bootstrap/initializeHqModules.ts");
  assert.equal(GRAPH_SCOPE, "https://graph.microsoft.com/.default");
  assert.doesNotMatch(connector, /sendMail|Mail\.Send|createReply|\/\$value|setInterval|setTimeout/);
  assert.match(routes, /router\.get\("\/inbound-mail\/mailbox-health"/);
  assert.match(routes, /sent: false/);
  assert.doesNotMatch(boot, /microsoftGraphMailbox|pollMicrosoftGraphMailbox/);
  const diff = execSync(
    "git diff --name-only -- server/hq/fundingBootGate.ts server/bootstrap/initializeHqModules.ts server/hq/warehouseScheduler.ts server/hq/workflowEngine.ts server/hq/auraProactiveIntelligence.ts server/hq/auraAutonomousOperations.ts script/hq-funding-boot-isolation.test.ts",
    { cwd: fileURLToPath(root) },
  ).toString().trim();
  assert.equal(diff, "");
});
