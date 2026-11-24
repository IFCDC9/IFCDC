import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SYNTHETIC_FIXTURE,
  insuranceCardOnly,
  logPayloadLooksLikePhi,
  redactForLog,
  suggestCoding,
  blockClaimTransmission,
} from "../shared/intakeMedicalBilling";

const dir = mkdtempSync(path.join(tmpdir(), "hq-intake-medical-"));
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
const { listAuditSafe, ensureIntakeMedicalTables } = await import("../server/hq/intakeMedicalBillingEngine");

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

test("coding assistance cannot come from an insurance card alone", () => {
  assert.equal(
    insuranceCardOnly({
      insurance: { payerName: "SYNTHETIC Test Payer", memberId: SYNTHETIC_FIXTURE.memberId, cardImagePresent: true },
    }),
    true,
  );
  const refused = suggestCoding({
    insurance: { payerName: SYNTHETIC_FIXTURE.payerName, memberId: SYNTHETIC_FIXTURE.memberId },
  });
  assert.equal(refused.refused, true);
  assert.equal(refused.suggestions.length, 0);
  assert.equal(refused.humanApprovalRequired, true);
  assert.equal(refused.eligibility, "Unknown");
  assert.match(refused.reason, /cannot be inferred from an insurance card/i);

  const allowed = suggestCoding({
    clinical: {
      noteText: SYNTHETIC_FIXTURE.noteText,
      documentedDiagnoses: SYNTHETIC_FIXTURE.documentedDiagnoses,
      documentedProcedures: SYNTHETIC_FIXTURE.documentedProcedures,
    },
  });
  assert.equal(allowed.refused, false);
  assert.ok(allowed.suggestions.length >= 1);
  assert.equal(allowed.approved, false);
  assert.equal(allowed.humanApprovalRequired, true);
  for (const suggestion of allowed.suggestions) {
    assert.match(suggestion.codeSetVersion, /Unknown/);
    assert.equal(suggestion.humanApprovalRequired, true);
  }
});

test("claim transmission is blocked", () => {
  const draft = blockClaimTransmission("draft");
  assert.equal(draft.allowed, false);
  const submitted = blockClaimTransmission("submitted");
  assert.equal(submitted.allowed, false);
  assert.equal(submitted.status, "blocked");
});

test("synthetic CRUD, RBAC, no claim submit, no PHI in audit logs", async () => {
  await ensureIntakeMedicalTables();
  assert.equal((await call("/cases", "hr", { displayLabel: SYNTHETIC_FIXTURE.displayLabel })).status, 403);
  assert.equal((await call("/cases", "grant_manager", { displayLabel: SYNTHETIC_FIXTURE.displayLabel })).status, 403);
  assert.equal((await call("/cases", "finance")).status, 403);
  assert.equal((await call("/cases", "employee")).status, 403);

  const created = await call("/cases", "owner", {
    displayLabel: SYNTHETIC_FIXTURE.displayLabel,
    serviceIntent: "Unknown",
  });
  const createdText = await created.text();
  assert.equal(created.status, 200, createdText);
  const bundle = JSON.parse(createdText) as { intake: { id: string }; eligibility: string };
  assert.equal(bundle.eligibility, "Unknown");
  const caseId = bundle.intake.id;

  const billingCreate = await call("/cases", "billing", {
    displayLabel: "SYNTHETIC Patient Beta",
    serviceIntent: "Unknown",
  });
  assert.equal(billingCreate.status, 200, await billingCreate.clone().text());

  const cardOnly = await call(`/cases/${caseId}/insurance`, "owner", {
    payerName: SYNTHETIC_FIXTURE.payerName,
    memberId: SYNTHETIC_FIXTURE.memberId,
  });
  assert.equal(cardOnly.status, 200);
  const codingFromCard = await call(`/cases/${caseId}/coding`, "owner", {});
  assert.equal(codingFromCard.status, 200);
  const codingBody = (await codingFromCard.json()) as { refused: boolean; suggestions: unknown[] };
  assert.equal(codingBody.refused, true);
  assert.equal(codingBody.suggestions.length, 0);

  const clinical = await call(`/cases/${caseId}/clinical`, "owner", {
    noteText: SYNTHETIC_FIXTURE.noteText,
    documentedDiagnoses: SYNTHETIC_FIXTURE.documentedDiagnoses,
    documentedProcedures: SYNTHETIC_FIXTURE.documentedProcedures,
  });
  assert.equal(clinical.status, 200);
  const coding = await call(`/cases/${caseId}/coding`, "owner", {});
  assert.equal(coding.status, 200);
  const codingOk = (await coding.json()) as { refused: boolean; humanApprovalRequired: boolean; id: string };
  assert.equal(codingOk.refused, false);
  assert.equal(codingOk.humanApprovalRequired, true);

  const claim = await call(`/cases/${caseId}/claims`, "owner", {
    status: "draft",
    edits: [{ field: "placeOfService", value: "Unknown" }],
    attachments: [{ name: "synthetic.txt" }],
    denials: [{ reason: "Unknown" }],
  });
  assert.equal(claim.status, 200);
  const claimBody = (await claim.json()) as { submitted: boolean; transmissionBlocked: boolean; id: string };
  assert.equal(claimBody.submitted, false);
  assert.equal(claimBody.transmissionBlocked, true);

  const submit = await call(`/claims/${claimBody.id}/submit`, "owner", {});
  assert.equal(submit.status, 409);
  const submitBody = (await submit.json()) as { submitted: boolean; transmitted: boolean };
  assert.equal(submitBody.submitted, false);
  assert.equal(submitBody.transmitted, false);

  const audit = await listAuditSafe();
  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes(SYNTHETIC_FIXTURE.memberId), false);
  assert.equal(serialized.includes(SYNTHETIC_FIXTURE.displayLabel), false);
  assert.equal(serialized.includes(SYNTHETIC_FIXTURE.noteText), false);
  assert.equal(logPayloadLooksLikePhi(serialized), false);
  assert.ok(audit.length > 0);
  assert.match(redactForLog(`member id ${SYNTHETIC_FIXTURE.memberId}`), /\[redacted/);
});
