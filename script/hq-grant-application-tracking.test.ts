import assert from "node:assert/strict";
import test from "node:test";
import { buildHeadquartersGrantTracking, mlkHeadquartersNextAction } from "../server/hq/grantApplicationTracking";
import { currentMlkExecutiveAction } from "../server/hq/executiveGrantWorkflowEngine";

test("the headquarters grant tracker keeps MLK stages apart and does not send", () => {
  const board = buildHeadquartersGrantTracking();
  assert.equal(board.sendsMail, false);
  const mlk = board.items.find((item) => item.id === "mlk-2027-commemorative");
  assert.equal(mlk?.stage.postmarkAccepted, true);
  assert.equal(mlk?.stage.delivered, "delivered");
  assert.equal(mlk?.status, "Delivered — Awaiting Funder Acknowledgment");
  assert.equal(mlk?.stage.acknowledged, false);
  assert.equal(mlk?.stage.underReview, false);
  assert.equal(mlk?.stage.awarded, false);
  assert.equal(mlk?.stage.fundsReceived, false);
  assert.equal(mlk?.reportingRequirements, "unknown");
  assert.equal(mlk?.participantCount, "unknown");
  assert.match(mlk?.deadlineNote || "", /October 26, 2026/);
  assert.match(mlk?.deadlineNote || "", /October 30, 2026/);
  const action = mlkHeadquartersNextAction();
  assert.equal(action.sendsMail, false);
  assert.equal(action.text, "Watch for a Commission reply. Do not send.");
  assert.deepEqual(currentMlkExecutiveAction(), action);
});
