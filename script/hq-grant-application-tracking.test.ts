import assert from "node:assert/strict";
import test from "node:test";
import { buildHeadquartersGrantTracking, classifyCommissionReplyText, mlkExecutiveWatchItem, mlkHeadquartersNextAction, scanCommissionReplies } from "../server/hq/grantApplicationTracking";
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
  const watch = mlkExecutiveWatchItem();
  assert.equal(watch.severity, "watch");
  assert.match(watch.detail, /Do not send/);
  assert.match(watch.detail, /not under review/);
  assert.match(watch.detail, /not awarded/);
  assert.equal(watch.detail.includes("is under review"), false);
  assert.equal(classifyCommissionReplyText("Please provide the additional document."), "requests_more_information");
  assert.equal(classifyCommissionReplyText("Your application is under review."), "confirms_review");
  assert.equal(classifyCommissionReplyText("The application was not selected."), "communicates_a_decision");
  assert.equal(classifyCommissionReplyText("Action required: please respond."), "requires_founder_action");
  assert.equal(classifyCommissionReplyText("Thank you."), "unclassified");
  const fixture = scanCommissionReplies([
    { senderAddress: "notifications@ifcdcbarbersapp.com", subject: "daily report", textBody: "Please provide a report." },
    { senderAddress: "MLKCommission@sos.nj.gov", senderName: "NJ MLK Commission", subject: "Fixture only", textBody: "Please provide one more page." },
  ]);
  assert.equal(fixture.sendsMail, false);
  assert.equal(fixture.replies.length, 1);
  assert.equal(fixture.replies[0].classification, "requests_more_information");
});
