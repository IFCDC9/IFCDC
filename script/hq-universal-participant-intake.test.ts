import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SYNTHETIC_INTAKE_FIXTURE,
  codingInferredFromIntake,
  crisisGuidance,
  noticeLooksSensitive,
  buildGenericNotice,
  suggestDepartmentRoutes,
} from "../shared/hqIntake";
import { SYNTHETIC_FIXTURE, logPayloadLooksLikePhi } from "../shared/intakeMedicalBilling";

const dir = mkdtempSync(path.join(tmpdir(), "hq-universal-intake-"));
process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = dir;
process.env.DATABASE_URL = "";
process.env.IFCDC_GRANTS_QA = "1";
process.env.ALLOW_DEMO_SEED = "false";

const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { JWT_SECRET } = await import("../server/config/auth");
const { default: router } = await import("../server/routes/intakeMedicalBilling.routes");
const { getDb } = await import("../server/db");
const { listAuditSafe } = await import("../server/hq/intakeMedicalBillingEngine");
const { ensureHqIntakeTables } = await import("../server/hq/hqIntakeEngine");

const app = express();
app.use(express.json());
app.use("/intake", router);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/intake`;

function token(role: string) {
  return jwt.sign({ id: role, role, email: `${role}@example.test` }, JWT_SECRET);
}

async function call(endpoint: string, role: string, body?: unknown, method = body ? "POST" : "GET") {
  return fetch(`${base}${endpoint}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token(role)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await (await getDb()).close();
  rmSync(dir, { recursive: true, force: true });
});

test("coding is never inferred from intake needs", () => {
  const refused = codingInferredFromIntake([{ needType: "transitional_housing" }]);
  assert.equal(refused.refused, true);
  assert.equal(refused.suggestions.length, 0);
  assert.match(refused.reason, /cannot be inferred/i);
});

test("crisis guidance displays 911/988 and never auto-contacts", () => {
  const crisis = crisisGuidance({ urgentPhysical: true, urgentBehavioral: true });
  assert.equal(crisis.display911, true);
  assert.equal(crisis.display988, true);
  assert.equal(crisis.autoContact911, false);
  assert.equal(crisis.autoContact988, false);
  assert.equal(crisis.autoDial, false);
});

test("generic notices cannot contain health content", () => {
  const notice = buildGenericNotice();
  assert.equal(notice.mailed, false);
  assert.equal(noticeLooksSensitive(notice), false);
  assert.equal(noticeLooksSensitive({ body: "PHQ diagnosis and member id 123" }), true);
});

test("department suggestions stay Unknown and require staff confirmation", () => {
  const routes = suggestDepartmentRoutes([{ needType: "youth_mentoring" }]);
  assert.equal(routes[0].contactName, "Unknown");
  assert.equal(routes[0].contactPhone, "Unknown");
  assert.equal(routes[0].staffMustConfirm, true);
});

test("mobile intake layout uses stacked 44px controls", () => {
  const css = readFileSync(path.join(process.cwd(), "client/src/styles/hq.css"), "utf8");
  assert.match(css, /hq-intake-form/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(max-width: 720px\)/);
  const page = readFileSync(path.join(process.cwd(), "client/src/pages/hq/IntakeMedicalBillingPage.tsx"), "utf8");
  assert.match(page, /hq-intake-form/);
  assert.match(page, /Staff/);
  assert.match(page, /Participant/);
});

test("universal intake workflows, RBAC, consent, follow-up, and no PHI in logs", async () => {
  await ensureHqIntakeTables();

  for (const role of ["hr", "grant_manager", "finance", "employee"]) {
    assert.equal((await call("/coordination", role, { displayLabel: SYNTHETIC_INTAKE_FIXTURE.displayLabel })).status, 403);
  }

  const housing = await call("/coordination", "intake_coordinator", {
    displayLabel: "SYNTHETIC Housing Need",
    submitterKind: "participant",
    consentServices: true,
    consentShareOutside: false,
    ...SYNTHETIC_INTAKE_FIXTURE,
    needs: [{ needType: "transitional_housing" }],
  });
  assert.equal(housing.status, 200, await housing.clone().text());
  const housingBody = (await housing.json()) as {
    intake: { id: string };
    suggestedRoutes: Array<{ departmentId: string; contactName: string }>;
    codingFromIntake: { refused: boolean };
    hipaaCompliance: string;
  };
  assert.equal(housingBody.hipaaCompliance, "Disabled");
  assert.equal(housingBody.suggestedRoutes[0].departmentId, "transitional_housing");
  assert.equal(housingBody.suggestedRoutes[0].contactName, "Unknown");
  assert.equal(housingBody.codingFromIntake.refused, true);

  const youth = await call("/coordination", "owner", {
    displayLabel: "SYNTHETIC Youth Referral",
    submitterKind: "staff",
    consentServices: true,
    needs: [{ needType: "youth_mentoring" }],
  });
  assert.equal(youth.status, 200, await youth.clone().text());

  const mental = await call("/coordination", "clinical_referral_staff", {
    displayLabel: "SYNTHETIC Mental Health Referral",
    submitterKind: "staff",
    consentServices: true,
    consentShareOutside: true,
    needs: [{ needType: "mental_health_support_case_management" }],
  });
  assert.equal(mental.status, 200, await mental.clone().text());
  const mentalBody = (await mental.json()) as {
    intake: { id: string };
    suggestedRoutes: Array<{ isReferralPathway: boolean }>;
  };
  assert.equal(mentalBody.suggestedRoutes[0].isReferralPathway, true);

  const urgent = await call("/coordination", "intake_coordinator", {
    displayLabel: "SYNTHETIC Urgent Medical",
    submitterKind: "staff",
    consentServices: true,
    urgentPhysical: true,
    urgentBehavioral: true,
    needs: [{ needType: "medical_clinical_referral" }],
  });
  assert.equal(urgent.status, 200, await urgent.clone().text());
  const urgentBody = (await urgent.json()) as {
    intake: { id: string };
    crisis: { display911: boolean; display988: boolean; autoContact911: boolean; autoContact988: boolean };
    autoContactedEmergency: boolean;
  };
  assert.equal(urgentBody.crisis.display911, true);
  assert.equal(urgentBody.crisis.display988, true);
  assert.equal(urgentBody.crisis.autoContact911, false);
  assert.equal(urgentBody.crisis.autoContact988, false);
  assert.equal(urgentBody.autoContactedEmergency, false);

  const blocked = await call(`/coordination/${housingBody.intake.id}/referrals`, "intake_coordinator", {
    providerLabel: "Unknown",
    consentShareOutside: false,
  });
  assert.equal(blocked.status, 409);

  const consented = await call(`/coordination/${mentalBody.intake.id}/referrals`, "clinical_referral_staff", {
    providerLabel: "Unknown",
    consentShareOutside: true,
  });
  assert.equal(consented.status, 200, await consented.clone().text());

  const assigned = await call(`/coordination/${housingBody.intake.id}/assignment`, "intake_coordinator", {
    department: "transitional_housing",
    ownerId: "department_staff",
    ownerLabel: "Unknown",
    contactPhone: "Unknown",
    contactEmail: "Unknown",
    nextAction: "Call participant about shelter intake packet",
    followUpDate: "2026-12-01",
  });
  assert.equal(assigned.status, 200, await assigned.clone().text());

  const deptList = await call("/coordination", "department_staff");
  assert.equal(deptList.status, 200);
  const deptBody = (await deptList.json()) as { intakes: Array<{ id: string }> };
  assert.equal(deptBody.intakes.some((row) => row.id === housingBody.intake.id), true);
  assert.equal(deptBody.intakes.some((row) => row.id === urgentBody.intake.id), false);

  const otherDenied = await call(`/coordination/${urgentBody.intake.id}`, "department_staff");
  assert.equal(otherDenied.status, 403);

  const follow = await call(`/coordination/${housingBody.intake.id}/followups`, "department_staff", {
    summary: "SYNTHETIC follow-up completed",
    serviceConnected: true,
  });
  assert.equal(follow.status, 200, await follow.clone().text());
  const followBody = (await follow.json()) as { intake: { workflowStatus: string } };
  assert.equal(followBody.intake.workflowStatus, "service_connection");

  const notice = await call(`/coordination/${housingBody.intake.id}/notice`, "intake_coordinator", {});
  assert.equal(notice.status, 200);
  const noticeBody = (await notice.json()) as { mailed: boolean; body: string; subject: string };
  assert.equal(noticeBody.mailed, false);
  assert.equal(noticeLooksSensitive(noticeBody), false);

  const billingClinical = await call(`/cases/${housingBody.intake.id}/clinical`, "billing", { noteText: SYNTHETIC_FIXTURE.noteText });
  assert.equal(billingClinical.status, 403);

  const coordinatorCases = await call("/cases", "intake_coordinator");
  assert.equal(coordinatorCases.status, 403);

  const audit = await listAuditSafe();
  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes(SYNTHETIC_INTAKE_FIXTURE.displayLabel), false);
  assert.equal(serialized.includes(SYNTHETIC_INTAKE_FIXTURE.goals), false);
  assert.equal(serialized.includes(SYNTHETIC_FIXTURE.memberId), false);
  assert.equal(logPayloadLooksLikePhi(serialized), false);
  assert.ok(audit.some((row: { action: string }) => row.action === "create_coordination_intake"));
  assert.ok(audit.some((row: { action: string }) => row.action === "confirm_assignment"));
  assert.ok(audit.some((row: { action: string }) => row.action === "complete_followup"));
});
