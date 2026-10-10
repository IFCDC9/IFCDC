import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Request, Response } from "express";

process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ifcdc-aura-stage1-"));
process.env.DATABASE_URL = "";
delete process.env.MICROSOFT_GRAPH_TENANT_ID;
delete process.env.MICROSOFT_GRAPH_CLIENT_ID;
delete process.env.MICROSOFT_GRAPH_CLIENT_SECRET;
delete process.env.INBOUND_MAILBOX_ADDRESS;
delete process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;

const { getDb } = await import("../server/db.ts");
const { queryHqAudit } = await import("../server/hq/hqAuditLog.ts");
const { hqAuthRequired } = await import("../server/middleware/hqAuth.ts");
const { resolveIdentityFromHqUser } = await import("../server/hq/auraFounderTrustEngine.ts");
const { auraStageOneReadSurface, getAuraAction } = await import("../server/hq/auraActionRegistry.ts");
const { runAuraAction, runAuraCommand } = await import("../server/hq/auraCommandLayer.ts");
const {
  AURA_OPERATOR,
  HUMAN_EXEC_EMAIL,
  founderApprovalAllowed,
  isAuraConsequentialAction,
  recordAuraRecommendation,
  recordFounderApproval,
} = await import("../server/hq/auraActorIdentity.ts");

type AuditRow = {
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  metadata_json: string | null;
};

function mockRes() {
  const state: { code?: number; body?: Record<string, unknown>; nextCalled?: boolean } = {};
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

test("Aura operator is distinct from a human login and from exec@ifcdc.org", () => {
  const session = resolveIdentityFromHqUser({
    user: { id: "user_staff_local", email: "staff.local@example.test", role: "employee", name: "Staff" },
  });
  assert.equal(AURA_OPERATOR.id, "aura");
  assert.equal(AURA_OPERATOR.email, null);
  assert.equal(AURA_OPERATOR.role, "aura");
  assert.equal(AURA_OPERATOR.isFounder, false);
  assert.equal(AURA_OPERATOR.founderMode, false);
  assert.equal(AURA_OPERATOR.isHumanLogin, false);
  assert.notEqual(AURA_OPERATOR.id, session.userId);
  assert.notEqual(AURA_OPERATOR.email, session.email);
  assert.notEqual(AURA_OPERATOR.email, HUMAN_EXEC_EMAIL);
  assert.equal(HUMAN_EXEC_EMAIL, "exec@ifcdc.org");
  assert.equal(founderApprovalAllowed({
    id: AURA_OPERATOR.id,
    email: AURA_OPERATOR.email,
    role: "owner",
    isFounder: true,
  }), false);
});

test("a recommendation is audited as Aura, separate from the signed-in user", async () => {
  const session = resolveIdentityFromHqUser({
    user: { id: "user_staff_local", email: "staff.local@example.test", role: "employee", name: "Staff" },
  });
  const result = await runAuraCommand({
    command: "aura recommendations",
    actorEmail: session.email || "staff.local@example.test",
    actorUser: { id: session.userId || "user_staff_local", email: session.email || "", role: "employee" },
  });
  assert.equal(result.actions.length, 0);
  assert.match(result.reply, /not executions/i);
  assert.match(result.reply, /Funding opportunities/);
  assert.match(result.reply, /Recurring revenue/);
  assert.match(result.reply, /Organizational growth/);
  assert.match(result.reply, /Engineering development/);
  assert.doesNotMatch(result.reply, /send_email/);

  const rows = await queryHqAudit({ action: "aura_recommendation", entityType: "aura_actor", limit: 5 }) as AuditRow[];
  const row = rows[0];
  assert.ok(row);
  assert.equal(row.actor_id, "aura");
  assert.notEqual(row.actor_id, session.userId);
  assert.notEqual(row.actor_email, HUMAN_EXEC_EMAIL);
  const metadata = JSON.parse(row.metadata_json || "{}") as { sessionUserId?: string; attribution?: string; execution?: boolean };
  assert.equal(metadata.attribution, "aura");
  assert.equal(metadata.execution, false);
  assert.equal(metadata.sessionUserId, session.userId);

  const db = await getDb();
  const unified = await db.get<{ user_id: string | null }>(
    "SELECT user_id FROM aura_unified_action_log WHERE action_id = ? ORDER BY created_at DESC LIMIT 1",
    "aura_recommendation",
  );
  assert.equal(unified?.user_id, "aura");
  assert.notEqual(unified?.user_id, session.userId);
});

test("a Founder approval is audited as the Founder", async () => {
  await recordFounderApproval({
    founderId: "user_owner_local",
    founderEmail: "owner.local@example.test",
    founderRole: "owner",
    summary: "Approved the staged recommendation.",
  });
  const rows = await queryHqAudit({ action: "aura_founder_approval", entityType: "aura_actor", limit: 5 }) as AuditRow[];
  const row = rows[0];
  assert.ok(row);
  assert.equal(row.actor_id, "user_owner_local");
  assert.equal(row.actor_email, "owner.local@example.test");
  assert.notEqual(row.actor_id, "aura");
  assert.notEqual(row.actor_email, HUMAN_EXEC_EMAIL);
  const metadata = JSON.parse(row.metadata_json || "{}") as { attribution?: string; approverId?: string };
  assert.equal(metadata.attribution, "founder");
  assert.equal(metadata.approverId, "user_owner_local");
});

test("Aura has no send tool on the recommendation surface", () => {
  const surface = auraStageOneReadSurface();
  assert.ok(surface.length >= 4);
  assert.equal(surface.every((item) => item.kind === "read"), true);
  assert.equal(surface.some((item) => item.id === "send_email"), false);
  const send = getAuraAction("send_email");
  assert.equal(send?.kind, "execute");
  assert.match(send?.description || "", /Resend/);
  const identitySource = readFileSync(new URL("../server/hq/auraActorIdentity.ts", import.meta.url), "utf8");
  const registryTail = readFileSync(new URL("../server/hq/auraActionRegistry.ts", import.meta.url), "utf8");
  assert.doesNotMatch(identitySource, /sendMail/);
  assert.doesNotMatch(identitySource, /IFCDC_OUTBOUND_MAIL_SEND_ENABLED/);
  assert.doesNotMatch(registryTail.slice(registryTail.lastIndexOf("STAGE_ONE_READ_IDS")), /send_email/);
  assert.equal(process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED, undefined);
  assert.equal(isAuraConsequentialAction("send_email"), true);
});

test("a non-founder cannot gain Founder authority through Aura", async () => {
  const staff = resolveIdentityFromHqUser({
    user: { id: "user_staff_local", email: "staff.local@example.test", role: "employee" },
  });
  const forgedAura = {
    ...staff,
    userId: "aura",
    email: null,
    legacyRole: "owner",
    isFounder: true,
    founderMode: true,
  };
  const forgedExec = {
    ...staff,
    userId: "user_exec_existing",
    email: "exec@ifcdc.org",
    legacyRole: "executive",
    isFounder: true,
    founderMode: true,
  };
  assert.equal(founderApprovalAllowed({
    id: forgedAura.userId,
    email: forgedAura.email,
    role: forgedAura.legacyRole,
    isFounder: forgedAura.isFounder,
  }), false);
  assert.equal(founderApprovalAllowed({
    id: forgedExec.userId,
    email: forgedExec.email,
    role: forgedExec.legacyRole,
    isFounder: true,
  }), false);
  assert.equal(founderApprovalAllowed({
    id: "user_owner_local",
    email: "owner.local@example.test",
    role: "owner",
    isFounder: true,
  }), true);

  for (const identity of [forgedAura, forgedExec]) {
    const denied = await runAuraAction("send_email", { to: "nobody@example.test", subject: "no", body: "no" }, {
      actorEmail: identity.email || "aura@invalid",
      identity,
    });
    assert.equal(denied.actions.length, 0);
    assert.match(denied.reply, /Aura cannot execute/);
    assert.match(denied.reply, /Founder authorization is required/);
  }

  const before = await queryHqAudit({ action: "aura_founder_approval", limit: 20 }) as AuditRow[];
  await recordFounderApproval({
    founderId: "aura",
    founderEmail: "exec@ifcdc.org",
    founderRole: "owner",
    summary: "must not record",
  });
  const after = await queryHqAudit({ action: "aura_founder_approval", limit: 20 }) as AuditRow[];
  assert.equal(after.length, before.length);
});

test("missing session still returns 401", async () => {
  const { state, res } = mockRes();
  const req = { cookies: {}, header: () => "" } as unknown as Request;
  await hqAuthRequired(req, res, () => {
    state.nextCalled = true;
  });
  assert.equal(state.code, 401);
  assert.equal(state.body?.error, "Authentication required");
  assert.equal(state.nextCalled, undefined);
});

test("recommendation attribution does not create user accounts", async () => {
  const db = await getDb();
  const users = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM users").catch(() => null);
  await recordAuraRecommendation({
    sessionUserId: "user_staff_local",
    sessionEmail: "staff.local@example.test",
    summary: "Read-only funding note.",
    topic: "funding_opportunities",
  });
  const usersAfter = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM users").catch(() => null);
  assert.equal(usersAfter?.c ?? null, users?.c ?? null);
  const rows = await queryHqAudit({ action: "aura_recommendation", limit: 5 }) as AuditRow[];
  assert.equal(rows.some((row) => row.actor_id === "aura" && row.actor_email !== "exec@ifcdc.org"), true);
});
