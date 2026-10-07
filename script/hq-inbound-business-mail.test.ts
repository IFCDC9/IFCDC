import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import type { Request, Response } from "express";
import {
  answerInboundMailQuestion,
  classifyInboundMail,
  correlateInboundMail,
  ingestInboundBusinessMail,
  isInboundMailQuestion,
  listInboundMailHttp,
  saveInboundDraftSuggestion,
  toPublicInboundMail,
  type MailDb,
} from "../server/hq/inboundBusinessMail";

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
      state.body = body;
      return res;
    },
  };
  return { state, res: res as unknown as Response };
}

test("ingestion stores one fixture and ignores a duplicate message id", async () => {
  const db = await memoryDb();
  const input = {
    providerMessageId: "msg-school-1",
    threadId: "thread-1",
    senderName: "Principal Ames",
    senderAddress: "ames@lincoln.example",
    recipient: "founder@ifcdc.org",
    subject: "Visit from the Lincoln School principal",
    textBody: "The principal invited a campus conversation.",
    receivedAt: "2026-10-07T14:00:00.000Z",
    attachments: [{ filename: "agenda.pdf", contentType: "application/pdf", size: 1200, bytes: "secret-bytes" }],
  };
  const first = await ingestInboundBusinessMail(db, input);
  const second = await ingestInboundBusinessMail(db, input);
  const count = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_inbound_business_mail");
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.row.id, first.row.id);
  assert.equal(count?.c, 1);
  assert.deepEqual(first.row.attachments, [{ filename: "agenda.pdf", contentType: "application/pdf", size: 1200 }]);
  assert.equal(JSON.stringify(first.row.attachments).includes("secret-bytes"), false);
});

test("classification, urgency, flags, and correlation stay on the evidence", async () => {
  const school = classifyInboundMail({
    subject: "Visit from the Lincoln School principal",
    textBody: "The principal invited a campus conversation.",
    senderAddress: "ames@lincoln.example",
  });
  assert.equal(school.category, "Schools");
  assert.equal(school.unmatched, false);
  assert.equal(school.urgency, "normal");
  assert.equal(school.founderAttention, false);
  assert.equal(school.flags.deadline, false);
  assert.equal(school.deadline, null);
  assert.equal(school.linked, null);

  const grant = classifyInboundMail({
    subject: "Grant application file",
    textBody: "The grant file is attached for your records.",
    senderAddress: "grants@foundation.example",
  });
  assert.equal(grant.category, "Grants");
  assert.equal(grant.flags.fundingOpportunity, false);

  const vague = classifyInboundMail({
    subject: "Hello",
    textBody: "Just checking in on things.",
    senderAddress: "person@example.com",
  });
  assert.equal(vague.category, "General");
  assert.equal(vague.unmatched, true);
  assert.equal(vague.linked, null);

  const urgent = classifyInboundMail({
    subject: "Needs founder attention",
    textBody: "This is urgent and needs founder attention.",
    senderAddress: "ops@ifcdc.org",
  });
  assert.equal(urgent.urgency, "high");
  assert.equal(urgent.founderAttention, true);

  const dated = classifyInboundMail({
    subject: "Application deadline",
    textBody: "The deadline is 2026-11-15.",
    senderAddress: "ops@ifcdc.org",
  });
  assert.equal(dated.flags.deadline, true);
  assert.equal(dated.deadline, "2026-11-15");

  const undated = classifyInboundMail({
    subject: "Deadline soon",
    textBody: "The deadline is soon.",
    senderAddress: "ops@ifcdc.org",
  });
  assert.equal(undated.flags.deadline, true);
  assert.equal(undated.deadline, null);

  const meeting = classifyInboundMail({
    subject: "Meeting",
    textBody: "Can we hold a meeting next week?",
    senderAddress: "ops@ifcdc.org",
  });
  assert.equal(meeting.flags.meeting, true);
  assert.equal(meeting.deadline, null);
  assert.equal(meeting.flags.payment, false);

  const funding = classifyInboundMail({
    subject: "Funding",
    textBody: "This is a funding opportunity for next year.",
    senderAddress: "ops@ifcdc.org",
  });
  assert.equal(funding.flags.fundingOpportunity, true);

  const payment = classifyInboundMail({
    subject: "Invoice",
    textBody: "The invoice for payment is attached.",
    senderAddress: "ops@ifcdc.org",
  });
  assert.equal(payment.flags.payment, true);

  const approval = classifyInboundMail({
    subject: "Approval",
    textBody: "Your approval is requested.",
    senderAddress: "ops@ifcdc.org",
  });
  assert.equal(approval.flags.approval, true);

  const partnership = classifyInboundMail({
    subject: "Partnership",
    textBody: "We would like to make a partnership request.",
    senderAddress: "ops@ifcdc.org",
  });
  assert.equal(partnership.flags.partnershipRequest, true);

  const linked = correlateInboundMail("See grant record grant-opp-441 for the file.", [
    { kind: "grant", id: "grant-opp-441" },
    { kind: "customer", id: "cust-100" },
  ]);
  assert.deepEqual(linked, { kind: "grant", id: "grant-opp-441" });
  const named = correlateInboundMail("Jordan Lee wrote about a haircut.", [
    { kind: "customer", id: "cust-100" },
  ]);
  assert.equal(named, null);
});

test("inbox handler returns 401 without a session and the payload has no secret", async () => {
  const { state, res } = mockRes();
  await listInboundMailHttp({ hqUser: undefined, query: {} } as Request, res);
  assert.equal(state.code, 401);
  const body = JSON.stringify(state.body);
  assert.match(body, /Authentication required/);
  assert.doesNotMatch(body, /secret|password|token|webhook/i);

  const db = await memoryDb();
  const stored = await ingestInboundBusinessMail(db, {
    providerMessageId: "msg-grant-441",
    senderName: "Foundation",
    senderAddress: "grants@foundation.example",
    recipient: "founder@ifcdc.org",
    subject: "Grant record grant-opp-441",
    textBody: "The grant file references grant-opp-441.",
    receivedAt: "2026-10-07T15:00:00.000Z",
  }, [{ kind: "grant", id: "grant-opp-441" }]);
  const named = await ingestInboundBusinessMail(db, {
    providerMessageId: "msg-name-only",
    senderName: "Jordan Lee",
    senderAddress: "jordan@example.com",
    recipient: "founder@ifcdc.org",
    subject: "Haircut question",
    textBody: "Jordan Lee wrote about a haircut.",
    receivedAt: "2026-10-07T15:05:00.000Z",
  }, [{ kind: "customer", id: "cust-100" }]);
  assert.deepEqual(stored.row.linked, { kind: "grant", id: "grant-opp-441" });
  assert.equal(named.row.linked, null);
  const publicRow = toPublicInboundMail(stored.row);
  assert.equal("secret" in publicRow, false);
  assert.equal("webhookSecret" in publicRow, false);
});

test("draft suggestion is stored locally and Aura answers do not invent a count", async () => {
  const db = await memoryDb();
  const stored = await ingestInboundBusinessMail(db, {
    providerMessageId: "msg-attn-1",
    senderName: "Ops",
    senderAddress: "ops@ifcdc.org",
    recipient: "founder@ifcdc.org",
    subject: "Needs founder attention",
    textBody: "This is urgent and needs founder attention.",
    receivedAt: "2026-10-07T16:00:00.000Z",
  });
  const draft = await saveInboundDraftSuggestion(db, stored.row.id, "Thanks, I will review this.");
  assert.equal(draft?.draftSuggestion, "Thanks, I will review this.");

  const school = await ingestInboundBusinessMail(db, {
    providerMessageId: "msg-school-2",
    senderName: "Principal Ames",
    senderAddress: "ames@lincoln.example",
    recipient: "founder@ifcdc.org",
    subject: "Lincoln School visit",
    textBody: "The school principal can visit.",
    receivedAt: "2026-10-07T16:10:00.000Z",
  });
  const rows = [stored.row, school.row];
  const today = answerInboundMailQuestion("What important email came in today?", rows, new Date("2026-10-07T18:00:00.000Z"));
  assert.match(today, /Needs founder attention/);
  assert.doesNotMatch(today, /\b0\b/);
  assert.match(answerInboundMailQuestion("Do I have anything from a school?", rows), /Lincoln School/);
  assert.equal(answerInboundMailQuestion("Any new grant emails?", rows), "None.");
  assert.match(answerInboundMailQuestion("What needs my attention?", rows), /ops@ifcdc.org/);
  const summary = answerInboundMailQuestion(`Summarize this email ${stored.row.providerMessageId}`, rows);
  assert.match(summary, /needs founder attention/);
  assert.doesNotMatch(summary, /Lincoln School/);
  assert.equal(answerInboundMailQuestion("Summarize this email", rows), "Unavailable. Name the stored message to summarize.");
  assert.equal(answerInboundMailQuestion("What important email came in today?", null), "Inbound mail is unavailable.");
  assert.equal(isInboundMailQuestion("send an email to the school"), false);
});

test("inbound module and routes do not send mail, and Phase 4A files are untouched", () => {
  const inbound = source("server/hq/inboundBusinessMail.ts");
  const routes = source("server/routes/communications.routes.ts");
  const command = source("server/hq/auraCommandLayer.ts");
  assert.doesNotMatch(inbound, /deliverTransactionalEmail|postmarkapp|resend|nodemailer|sendMail/);
  assert.doesNotMatch(inbound, /export async function (send|reply|forward|delete)/);
  assert.match(routes, /router\.use\(hqAuthRequired, requireHQModule\("notifications"\)\)/);
  assert.match(routes, /router\.get\("\/inbound-mail"/);
  const enterprise = routes.slice(routes.indexOf("router.get(\"/enterprise-notifications\""), routes.indexOf("router.get(\"/inbound-mail\""));
  assert.match(enterprise, /loadEnterpriseNotificationVisibility/);
  assert.doesNotMatch(enterprise, /sendHqNotification|deliverTransactionalEmail/);
  assert.ok(command.indexOf("isInboundMailQuestion") < command.indexOf("tryRunExecutiveCommand"));
  assert.match(command, /poweredBy: "AURA Inbound Mail"/);
  assert.match(command, /actions: \[\]/);

  const diff = execSync(
    "git diff --name-only -- server/hq/fundingBootGate.ts server/bootstrap/initializeHqModules.ts server/hq/warehouseScheduler.ts server/hq/workflowEngine.ts server/hq/auraProactiveIntelligence.ts server/hq/auraAutonomousOperations.ts script/hq-funding-boot-isolation.test.ts",
    { cwd: fileURLToPath(root) },
  ).toString().trim();
  assert.equal(diff, "");
});
