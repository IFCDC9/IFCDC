import assert from "node:assert/strict";
import test from "node:test";
import { buildFounderExecutiveBriefing, buildHeadquartersGrantTracking, commissionReplyQueueItem, mlkExecutiveWatchItem, mlkHeadquartersNextAction, priorityItemsForStoredMail, scanCommissionReplies } from "../server/hq/grantApplicationTracking";
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
  const fixtures = [
    ["Please provide the additional document.", "requests_more_information", false],
    ["Your application is under review.", "confirms_review", false],
    ["The application was not selected.", "communicates_a_decision", false],
    ["The Commission awarded the request.", "communicates_a_decision", true],
    ["Action required: please respond.", "requires_founder_action", false],
    ["Thank you.", "unclassified", false],
  ] as const;
  for (const [text, classification, awarded] of fixtures) {
    const queued = commissionReplyQueueItem(text);
    assert.equal(queued.classification, classification);
    assert.equal(queued.awarded, awarded);
    assert.equal(queued.fundsReceived, false);
    assert.equal(queued.sendsMail, false);
    assert.equal(queued.item.source, "mlk-2027-fixture");
    assert.match(queued.item.detail, /Do not send/);
    assert.match(queued.item.detail, /Funds received no/);
    assert.equal(queued.writesMlkRecord, false);
  }
  const paid = commissionReplyQueueItem("The Commission awarded the request and the payment was issued.");
  assert.equal(paid.classification, "communicates_a_decision");
  assert.equal(paid.awarded, true);
  assert.equal(paid.fundsReceived, true);
  assert.equal(paid.writesMlkRecord, false);
  assert.equal(buildHeadquartersGrantTracking().items.find((item) => item.id === "mlk-2027-commemorative")?.status, "Delivered — Awaiting Funder Acknowledgment");
  const fixture = scanCommissionReplies([
    { senderAddress: "notifications@ifcdcbarbersapp.com", subject: "daily report", textBody: "Please provide a report." },
    { senderAddress: "MLKCommission@sos.nj.gov", senderName: "NJ MLK Commission", subject: "Fixture only", textBody: "Please provide one more page." },
  ]);
  assert.equal(fixture.sendsMail, false);
  assert.equal(fixture.replies.length, 1);
  assert.equal(fixture.replies[0].classification, "requests_more_information");
  const bookingOnly = priorityItemsForStoredMail([
    { senderAddress: "notifications@ifcdcbarbersapp.com", subject: "[IFCDC] New booking — Paid in Full", textBody: "Booking notice", receivedAt: "2026-10-12T13:26:35Z" },
  ]);
  assert.equal(bookingOnly.length, 1);
  assert.equal(bookingOnly[0].id, "mlk-2027-watch-reply");
  const liveReply = priorityItemsForStoredMail([
    { senderAddress: "MLKCommission@sos.nj.gov", senderName: "NJ MLK Commission", subject: "Fixture only", textBody: "Please provide one more page.", receivedAt: "2026-10-12T18:00:00.000Z" },
  ]);
  assert.equal(liveReply.length, 1);
  assert.equal(liveReply[0].source, "mlk-2027-commemorative");
  assert.match(liveReply[0].detail, /Funds received no/);
  assert.equal("evidence" in liveReply[0] ? liveReply[0].evidence.includes("MLKCommission@sos.nj.gov") : false, true);
  const briefing = buildFounderExecutiveBriefing({ generatedAt: "2026-10-12T14:00:00.000Z", mailRead: "stored", messages: [] });
  assert.equal(briefing.sendsMail, false);
  assert.equal(briefing.money.projected.label, "proposed");
  assert.equal(briefing.money.submitted.amount, "$1,000");
  assert.equal(briefing.money.awards.amount, "none");
  assert.equal(briefing.money.received.amount, "none");
  assert.equal(briefing.fundingOpportunities.actionableCount, 0);
  assert.equal(briefing.grantApplications[0].status, "Delivered — Awaiting Funder Acknowledgment");
  assert.match(briefing.systemHealth.pollGap, /8 minutes 38 seconds/);
  assert.equal(briefing.barbersActivity[0].subject, "[IFCDC] New booking — Paid in Full");
  assert.equal(JSON.stringify(briefing).includes("sk-"), false);
  assert.equal(/token|password|secret/i.test(JSON.stringify(briefing.money)), false);
});
