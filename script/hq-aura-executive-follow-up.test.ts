/**
 * Founder internal follow-up. Temp database only.
 * Does not open the production data directory, send mail, submit, or spend.
 * The live Grant Center list is not read here.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "ifcdc-exec-follow-up-"));
process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = tempDir;
process.env.DATABASE_URL = "";
process.env.MASTER_OWNER_EMAIL = "service@ifcdc.org";
delete process.env.IFCDC_OUTBOUND_MAIL_SEND_ENABLED;

const FOUNDER = {
  userId: "founder-1",
  email: "service@ifcdc.org",
  role: "owner",
  isFounder: true,
};

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("unsigned HQ auth is 401 and grant submit still requires MFA enrollment", async () => {
  const { hqAuthRequired } = await import("../server/middleware/hqAuth.ts");
  const { hqMutationRequiresMfaEnrollment } = await import("../server/hq/mfaRoutePolicy.ts");
  await new Promise<void>((resolve, reject) => {
    const res = {
      status(code: number) {
        assert.equal(code, 401);
        return this;
      },
      json(body: { error?: string }) {
        assert.equal(body.error, "Authentication required");
        resolve();
      },
    };
    const req = { cookies: {}, header: () => "" } as unknown as Request;
    const result = hqAuthRequired(req, res as unknown as Response, () => {
      reject(new Error("unsigned request was allowed"));
    });
    if (result && typeof (result as Promise<unknown>).then === "function") {
      void (result as Promise<unknown>).then(() => undefined, reject);
    }
  });

  assert.equal(hqMutationRequiresMfaEnrollment({
    method: "POST",
    originalUrl: "/api/hq/grants/applications/app-1/workflow",
    url: "/api/hq/grants/applications/app-1/workflow",
    path: "/api/hq/grants/applications/app-1/workflow",
    body: { action: "submit" },
  } as Request), true);
  assert.equal(hqMutationRequiresMfaEnrollment({
    method: "GET",
    originalUrl: "/api/hq/aura/brain-v1/daily-briefing",
    url: "/api/hq/aura/brain-v1/daily-briefing",
    path: "/api/hq/aura/brain-v1/daily-briefing",
    body: {},
  } as Request), false);

  const ops = readSource("../server/hq/auraExecutiveOperations.ts");
  const start = ops.indexOf("async function recordFollowUpAudit");
  const end = ops.indexOf("export function detectHighImpactBlockedIntent");
  assert.equal(start > 0 && end > start, true);
  const handler = ops.slice(start, end);
  assert.match(handler, /export async function createInternalExecutiveFollowUp/);
  assert.match(handler, /presentDailyBriefingGrants/);
  assert.match(handler, /readFounderGrantsBriefing/);
  assert.match(handler, /founderApprovalAllowed/);
  assert.match(handler, /logHqAudit/);
  assert.doesNotMatch(handler, /sendFounderSecurityEmail|sendFounderSecuritySms|sendHqNotification|executeQueueGrantSubmission|executeSendEmail|place_call/);
  const daily = readSource("../server/hq/auraEnterpriseBrainV1.ts");
  assert.match(daily, /presentDailyBriefingGrants\(await readFounderGrantsBriefing\(await getDb\(\)\)\)/);
  const registry = readSource("../server/hq/auraActionRegistry.ts");
  assert.match(registry, /createInternalExecutiveFollowUp/);
  assert.match(registry, /id: "create_internal_follow_up"/);
});

test("internal follow-up allows the Founder, denies everyone else, and audits the result", async () => {
  const { getDbPath } = await import("../server/config/dataPaths.ts");
  const dbPath = getDbPath();
  assert.equal(dbPath.startsWith(tempDir), true);
  assert.equal(dbPath.includes(`${path.resolve(process.cwd(), "data")}${path.sep}`), false);

  const { resolveIdentityFromHqUser } = await import("../server/hq/auraFounderTrustEngine.ts");
  const { founderApprovalAllowed } = await import("../server/hq/auraActorIdentity.ts");
  const { founderMayReadGrantsBriefing } = await import("../server/hq/grantRecurringFundingEngine.ts");
  const { createInternalExecutiveFollowUp } = await import("../server/hq/auraExecutiveOperations.ts");
  const { getDb } = await import("../server/db.ts");

  const founderSession = resolveIdentityFromHqUser({
    user: { id: FOUNDER.userId, email: FOUNDER.email, role: "owner", name: "Founder" },
    channel: "hq_web",
    sessionKey: FOUNDER.email,
  });
  assert.equal(founderSession.isFounder, true);
  assert.equal(founderSession.founderMode, true);
  assert.equal(founderSession.email, "service@ifcdc.org");

  const execSession = resolveIdentityFromHqUser({
    user: { id: "exec-1", email: "exec@ifcdc.org", role: "EXEC" },
    channel: "hq_web",
    sessionKey: "exec@ifcdc.org",
  });
  assert.equal(execSession.isFounder, false);
  assert.equal(execSession.founderMode, false);
  assert.equal(execSession.enterpriseRole, "executive");
  assert.equal(founderMayReadGrantsBriefing({ role: "EXEC", email: "exec@ifcdc.org" }, "service@ifcdc.org"), false);
  assert.equal(founderApprovalAllowed({
    id: "exec-1",
    email: "exec@ifcdc.org",
    role: "founder",
    isFounder: true,
  }), false);

  const staffSession = resolveIdentityFromHqUser({
    user: { id: "staff-1", email: "staff@example.test", role: "employee" },
    channel: "hq_web",
    sessionKey: "staff@example.test",
  });
  assert.equal(staffSession.isFounder, false);

  const deniedStaff = await createInternalExecutiveFollowUp({
    identity: { userId: staffSession.userId, email: staffSession.email, role: staffSession.legacyRole, isFounder: staffSession.isFounder },
    linkOperatingFunding: true,
  });
  assert.equal(deniedStaff.outcome, "missing_access");
  assert.equal(deniedStaff.status, "error");
  assert.equal(deniedStaff.code, "missing_access");
  assert.equal(deniedStaff.taskId, null);
  assert.equal(deniedStaff.sendsMail, false);
  assert.equal(deniedStaff.submitsGrant, false);
  assert.equal(deniedStaff.spends, false);

  const deniedExec = await createInternalExecutiveFollowUp({
    identity: { userId: "exec-1", email: "exec@ifcdc.org", role: "founder", isFounder: true },
    linkOperatingFunding: true,
  });
  assert.equal(deniedExec.outcome, "missing_access");
  assert.equal(deniedExec.taskId, null);

  const db = await getDb();
  const unreadable = await createInternalExecutiveFollowUp({
    identity: FOUNDER,
    linkOperatingFunding: true,
  });
  assert.equal(unreadable.outcome, "failure");
  assert.equal(unreadable.code, "grant_center_unreadable");
  assert.equal(unreadable.taskId, null);
  assert.equal(unreadable.linkedOpportunityId, null);
  assert.match(unreadable.summary, /could not be read/i);

  await db.exec(`CREATE TABLE grant_opportunities (
    id TEXT, title TEXT, funder TEXT, description TEXT, amount_min REAL, amount_max REAL,
    status TEXT, deadline TEXT, requirements TEXT, source_type TEXT, funder_type TEXT,
    eligibility TEXT, funding_status TEXT, close_date TEXT, eligibility_result TEXT,
    funding_instrument TEXT, funding_period TEXT, applicant_restrictions TEXT,
    program_limitations TEXT, award_ceiling REAL, estimated_funding REAL
  )`);
  const insert = `INSERT INTO grant_opportunities
    (id, title, funder, description, status, deadline, source_type, eligibility)
    VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`;

  const none = await createInternalExecutiveFollowUp({
    identity: FOUNDER,
    linkOperatingFunding: true,
  });
  assert.equal(none.outcome, "success");
  assert.equal(none.code, "no_qualifying_opportunity");
  assert.equal(none.taskId, null);
  assert.equal(none.linkedOpportunityId, null);
  assert.match(none.summary, /No qualifying operating-funding opportunity/);
  assert.match(none.summary, /no opportunity was invented/);

  await db.run(
    insert,
    "temp-supplies-only",
    "Supply purchase",
    "Private funder",
    "Potential funding. Supplies only. Administrative costs not allowed. No fringe.",
    "2027-08-01",
    "manual",
    "Restricted program supplies.",
  );
  const supplies = await createInternalExecutiveFollowUp({
    identity: FOUNDER,
    linkOperatingFunding: true,
  });
  assert.equal(supplies.code, "no_qualifying_opportunity");
  assert.equal(supplies.linkedOpportunityId, null);

  const internal = await createInternalExecutiveFollowUp({
    identity: FOUNDER,
    title: "Internal HQ follow-up for the Founder",
    linkOperatingFunding: false,
  });
  assert.equal(internal.outcome, "success");
  assert.equal(internal.code, "created");
  assert.equal(internal.status, "done");
  assert.equal(internal.linkedOpportunityId, null);
  assert.equal(internal.assignedTo, "service@ifcdc.org");
  assert.equal(internal.externalRecipient, null);
  assert.equal(internal.sendsMail, false);
  assert.equal(internal.submitsGrant, false);
  assert.equal(internal.spends, false);

  await db.run(
    insert,
    "temp-operating-payroll",
    "Payroll support",
    "County funder",
    "Potential funding. Personnel salaries allowed. HR and administration allowed. General operating support. Renewable.",
    "2027-06-01",
    "grants.gov",
    "Eligible nonprofit.",
  );
  const linked = await createInternalExecutiveFollowUp({
    identity: FOUNDER,
    linkOperatingFunding: true,
  });
  assert.equal(linked.outcome, "success");
  assert.equal(linked.code, "created");
  assert.equal(linked.linkedOpportunityId, "temp-operating-payroll");
  assert.equal(linked.assignedTo, "service@ifcdc.org");
  assert.equal(linked.externalRecipient, null);
  assert.equal(linked.qualifyingOpportunityCount >= 1, true);
  assert.equal(String(linked.linkedOpportunityId).startsWith("fixture-"), false);
  assert.equal(linked.sendsMail, false);
  assert.equal(linked.submitsGrant, false);
  assert.equal(linked.spends, false);

  const { getAuraAction } = await import("../server/hq/auraActionRegistry.ts");
  const action = getAuraAction("create_internal_follow_up");
  assert.ok(action);
  const viaAction = await action.run({ linkOperatingFunding: false, title: "Action path internal follow-up" }, {
    actorEmail: "staff@example.test",
    identity: {
      ...founderSession,
      userId: "staff-1",
      email: "staff@example.test",
      legacyRole: "employee",
      isFounder: false,
      founderMode: false,
    },
  });
  assert.equal(viaAction.status, "error");
  assert.equal((viaAction.data as { outcome?: string }).outcome, "missing_access");

  const viaFounder = await action.run({ linkOperatingFunding: true }, {
    actorEmail: FOUNDER.email,
    identity: founderSession,
  });
  assert.equal(viaFounder.status, "prepared");
  assert.equal((viaFounder.data as { code?: string }).code, "created");
  assert.equal((viaFounder.data as { linkedOpportunityId?: string }).linkedOpportunityId, "temp-operating-payroll");

  const tasks = await db.all<{
    id: string;
    assigned_to: string | null;
    entity_id: string | null;
    entity_type: string | null;
    workflow_key: string;
    payload_json: string | null;
  }>("SELECT id, assigned_to, entity_id, entity_type, workflow_key, payload_json FROM hq_workflow_instances");
  assert.equal(tasks.length, 3);
  assert.equal(tasks.every((row) => row.assigned_to === "service@ifcdc.org"), true);
  assert.equal(tasks.every((row) => row.workflow_key === "internal_follow_up"), true);
  assert.equal(tasks.every((row) => row.entity_type === "internal_executive_follow_up"), true);
  assert.equal(tasks.some((row) => row.entity_id === "temp-operating-payroll"), true);
  assert.equal(tasks.some((row) => row.entity_id == null), true);
  assert.equal(tasks.some((row) => row.entity_id === "temp-supplies-only" || String(row.entity_id || "").startsWith("fixture-")), false);
  for (const row of tasks) {
    const payload = JSON.parse(row.payload_json || "{}") as {
      sendsMail?: boolean;
      submitsGrant?: boolean;
      spends?: boolean;
      externalRecipient?: unknown;
    };
    assert.equal(payload.sendsMail, false);
    assert.equal(payload.submitsGrant, false);
    assert.equal(payload.spends, false);
    assert.equal(payload.externalRecipient, null);
  }

  const audits = await db.all<{ action: string; metadata_json: string | null }>(
    "SELECT action, metadata_json FROM hq_audit_log WHERE entity_type = ?",
    "internal_executive_follow_up",
  );
  const actions = new Set(audits.map((row) => row.action));
  assert.equal(actions.has("aura_internal_follow_up_denied"), true);
  assert.equal(actions.has("aura_internal_follow_up_failed"), true);
  assert.equal(actions.has("aura_internal_follow_up_none"), true);
  assert.equal(actions.has("aura_internal_follow_up_created"), true);
  const outcomes = new Set(audits.map((row) => {
    const metadata = JSON.parse(row.metadata_json || "{}") as { outcome?: string };
    return metadata.outcome;
  }));
  assert.equal(outcomes.has("missing_access"), true);
  assert.equal(outcomes.has("failure"), true);
  assert.equal(outcomes.has("success"), true);
  assert.equal(audits.some((row) => /send_email|submit|payment/i.test(row.action)), false);
});
