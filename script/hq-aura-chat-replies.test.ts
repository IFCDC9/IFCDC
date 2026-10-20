import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { answerWithToolEvidence, isMacEngineeringCapabilityQuestion } from "../server/hq/auraCommandReplies.ts";

process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ifcdc-chat-replies-"));
process.env.DATABASE_URL = "";
delete process.env.AURA_OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

test("Mac capability prompts are recognized; direct work and portfolio requests are not", () => {
  for (const command of [
    "Aura, focus specifically on the Founder Mac engineering connection. Can you currently send a code-editing or test-execution job to that Mac?",
    "Our next milestone is controlled code editing and testing through HQ without Cursor. First assess your actual capabilities.",
    "What can you do with the Mac runner?",
  ]) assert.equal(isMacEngineeringCapabilityQuestion(command), true, command);
  for (const command of ["Run the tests", "Create a pull request", "Inspect repository", "Show software portfolio status", "What can you tell me about the software portfolio?", "What are the grant program capabilities?"])
    assert.equal(isMacEngineeringCapabilityQuestion(command), false, command);
});

test("real dispatcher answers capability questions without keys or executing actions", async () => {
  const { runAuraCommand } = await import("../server/hq/auraCommandLayer.ts");
  const { resolveIdentityFromHqUser } = await import("../server/hq/auraFounderTrustEngine.ts");
  const identity = resolveIdentityFromHqUser({ user: { id: "founder-test", email: "service@ifcdc.org", role: "owner" } });
  for (const command of [
    "Can you currently send a code-editing or test-execution job to that Mac? Identify the available tool or job type and provide execution evidence.",
    "Aura, assess your actual engineering capabilities, prepare a pull request if possible, and explain what implementation is missing.",
  ]) {
    const result = await runAuraCommand({ command, actorEmail: "service@ifcdc.org", identity });
    assert.equal(result.poweredBy, "AURA Engineering Capabilities");
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.approvalsCreated, []);
    assert.match(result.reply, /only inspect_repository/);
    assert.match(result.reply, /cannot send code-editing or test-execution jobs/);
    assert.doesNotMatch(result.reply, /Portfolio:|approvals waiting|tests passed/);
  }
});

test("reply step receives the original question and actual results, excluding arbitrary data", async () => {
  const evidence = [{ id: "se_portfolio_status", status: "done", summary: "Portfolio: 8 apps", data: { secret: "DO_NOT_SEND" } }];
  let calls = 0;
  const reply = await answerWithToolEvidence("Why are you repeating the portfolio summary?", evidence, async (messages) => {
    calls++;
    const input = JSON.parse(messages[1].content);
    assert.equal(input.originalRequest, "Why are you repeating the portfolio summary?");
    assert.deepEqual(input.actionResults, [{ id: "se_portfolio_status", status: "done", summary: "Portfolio: 8 apps" }]);
    assert.doesNotMatch(JSON.stringify(messages), /DO_NOT_SEND/);
    assert.match(messages[0].content, /do not answer the question/i);
    return "The portfolio result does not explain the repeating response.";
  });
  assert.equal(calls, 1);
  assert.equal(reply, "The portfolio result does not explain the repeating response.");
});

test("failed explanation preserves errors and approval status without retrying execution", async () => {
  let calls = 0;
  const reply = await answerWithToolEvidence("Deploy the fix", [
    { id: "prepare_for_approval", status: "pending_approval", summary: "Founder approval required" },
    { id: "run_tests", status: "error", summary: "Tests failed" },
  ], async () => { calls++; throw new Error("offline"); });
  assert.equal(calls, 1);
  assert.match(reply, /could not finish explaining/);
  assert.match(reply, /\[pending_approval\]/);
  assert.match(reply, /\[error\].*Tests failed/);
});

test("empty model response gets an explicit fallback and oversized evidence is bounded", async () => {
  const reply = await answerWithToolEvidence("Explain the result", [{ id: "read", status: "done", summary: "x".repeat(5000) }], async (messages) => {
    assert.equal(JSON.parse(messages[1].content).actionResults[0].summary.length, 4000);
    return " ";
  });
  assert.match(reply, /may not fully answer your question/);
});
