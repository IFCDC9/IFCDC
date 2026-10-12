import {
  MLK_2027_RECIPIENT,
  MLK_2027_SUBJECT,
  STONE_FOLLOW_UP_DATE,
  STONE_INQUIRY_RECIPIENT,
  STONE_INQUIRY_SUBJECT,
} from "./grantOutreachCorrespondence";

export type GrantStage = {
  postmarkAccepted: boolean;
  delivered: "delivered" | "bounced" | "unverified";
  acknowledged: false;
  underReview: false;
  awarded: false;
  fundsReceived: false;
};

export type GrantTrackingItem = {
  id: string;
  kind: "application" | "inquiry" | "follow-up";
  recipient: string;
  subject: string;
  stage: GrantStage;
  history: string;
  correspondence: string;
  deadline: string | null;
  deadlineNote: string | null;
  followUpDate: string | null;
  reportingRequirements: "unknown";
  participantCount: "unknown";
  outcomes: "unknown";
  status: string;
  nextAction: string;
  sendsMail: false;
};

const MLK_MESSAGE_ID = "8a057c7e-df5d-4393-b973-ea7b0500e87d";

/** Local Headquarters view of records already on file. It does not send mail. */
export function buildHeadquartersGrantTracking(): { sendsMail: false; items: GrantTrackingItem[] } {
  return {
    sendsMail: false,
    items: [
      {
        id: "mlk-2027-commemorative",
        kind: "application",
        recipient: MLK_2027_RECIPIENT,
        subject: MLK_2027_SUBJECT,
        stage: {
          postmarkAccepted: true,
          delivered: "delivered",
          acknowledged: false,
          underReview: false,
          awarded: false,
          fundsReceived: false,
        },
        history: `Postmark accepted message ${MLK_MESSAGE_ID} at 2026-10-12T12:26:19.727Z. Narrative and budget checksums match the approved files. A later activity read classified the message as delivered. The event time was not returned. This is not an award.`,
        correspondence: "No reply from MLKCommission@sos.nj.gov is on record. The earlier clarification b40d4029-9c88-4125-8a00-91b3a105f0b6 has no reply on record. No additional documents have been requested.",
        deadline: "2026-10-26T15:00:00-04:00",
        deadlineNote: "Working deadline is 3:00 p.m. Monday, October 26, 2026. The registration confirmation also prints 3:00 p.m. October 30, 2026. October 30 is not the planning date.",
        followUpDate: null,
        reportingRequirements: "unknown",
        participantCount: "unknown",
        outcomes: "unknown",
        status: "Delivered — Awaiting Funder Acknowledgment",
        nextAction: "Watch for a Commission reply. Do not send.",
        sendsMail: false,
      },
      {
        id: "stone-eligibility-inquiry-2026-10-11",
        kind: "inquiry",
        recipient: STONE_INQUIRY_RECIPIENT,
        subject: STONE_INQUIRY_SUBJECT,
        stage: {
          postmarkAccepted: false,
          delivered: "unverified",
          acknowledged: false,
          underReview: false,
          awarded: false,
          fundsReceived: false,
        },
        history: "The introductory inquiry was already sent outside Headquarters. It is not this MLK application.",
        correspondence: "No reply is on record.",
        deadline: null,
        deadlineNote: null,
        followUpDate: STONE_FOLLOW_UP_DATE,
        reportingRequirements: "unknown",
        participantCount: "unknown",
        outcomes: "unknown",
        status: "NOT SENT",
        nextAction: "Leave the October 23 follow-up unsent until the Founder approves that separate message.",
        sendsMail: false,
      },
    ],
  };
}

export function mlkHeadquartersNextAction(): {
  id: string;
  sendsMail: false;
  text: string;
  acknowledged: false;
  underReview: false;
  awarded: false;
  fundsReceived: false;
} {
  const mlk = buildHeadquartersGrantTracking().items.find((item) => item.id === "mlk-2027-commemorative");
  return {
    id: "mlk-2027-commemorative",
    sendsMail: false,
    text: mlk?.nextAction ?? "Watch for a Commission reply. Do not send.",
    acknowledged: false,
    underReview: false,
    awarded: false,
    fundsReceived: false,
  };
}

export const MLK_COMMISSION_REPLY_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export type CommissionReplyClass =
  | "requests_more_information"
  | "confirms_review"
  | "communicates_a_decision"
  | "requires_founder_action"
  | "unclassified";

export type StoredMailLike = {
  senderAddress?: string | null;
  senderName?: string | null;
  subject?: string | null;
  textBody?: string | null;
  receivedAt?: string | null;
};

export function isMlkCommissionCorrespondent(senderAddress?: string | null, senderName?: string | null): boolean {
  const address = (senderAddress || "").trim().toLowerCase();
  const name = (senderName || "").trim().toLowerCase();
  if (address === "mlkcommission@sos.nj.gov") return true;
  return name.includes("nj mlk commission") || name.includes("mlk commission");
}

export function classifyCommissionReplyText(text: string): CommissionReplyClass {
  const body = text.toLowerCase();
  if (/\b(more information|additional document|additional information|please provide|please submit|please send)\b/.test(body)) {
    return "requests_more_information";
  }
  if (/\b(under review|being reviewed|we are reviewing|review has begun)\b/.test(body)) return "confirms_review";
  if (/\b(awarded|not selected|declined|funding decision|application decision)\b/.test(body)) return "communicates_a_decision";
  if (/\b(action required|please respond|your response is needed)\b/.test(body)) return "requires_founder_action";
  return "unclassified";
}

export function scanCommissionReplies(messages: StoredMailLike[]): {
  found: boolean;
  sendsMail: false;
  replies: Array<{
    classification: CommissionReplyClass;
    receivedAt: string | null;
    subject: string;
    senderAddress: string;
    senderName: string;
  }>;
} {
  const replies = [];
  for (const message of messages) {
    if (!isMlkCommissionCorrespondent(message.senderAddress, message.senderName)) continue;
    replies.push({
      classification: classifyCommissionReplyText(`${message.subject || ""}\n${message.textBody || ""}`),
      receivedAt: message.receivedAt || null,
      subject: message.subject || "",
      senderAddress: message.senderAddress || "",
      senderName: message.senderName || "",
    });
  }
  return { found: replies.length > 0, sendsMail: false, replies };
}

export function textIndicatesAward(text: string): boolean {
  return /\bawarded\b/i.test(text) && !/\bnot awarded\b/i.test(text);
}

export function textIndicatesFundsReceived(text: string): boolean {
  return /\b(funds (have been |were )?received|payment (has been |was )?issued|money (was|has been) paid)\b/i.test(text);
}

export type CommissionAttention = {
  classification: CommissionReplyClass;
  awarded: boolean;
  fundsReceived: boolean;
  sendsMail: false;
  writesMlkRecord: false;
  item: {
    id: string;
    severity: "watch" | "high";
    title: string;
    detail: string;
    evidence: string;
    timestamp: string;
    path: string;
    source: string;
  };
};

/** Classify one message. A fixture is labeled fixture and is not a write to the MLK record. */
export function commissionReplyAlert(message: StoredMailLike, fixture: boolean): CommissionAttention {
  const text = `${message.subject || ""}\n${message.textBody || ""}`;
  const classification = classifyCommissionReplyText(text);
  const awarded = classification === "communicates_a_decision" && textIndicatesAward(text);
  const fundsReceived = textIndicatesFundsReceived(text);
  const who = (message.senderAddress || message.senderName || "unknown sender").trim();
  const subject = message.subject || (fixture ? "Fixture only" : "subject not stored");
  const timestamp = message.receivedAt || "timestamp not stored";
  const money = fundsReceived ? "Funds received is indicated by the text." : "Funds received no.";
  const award = awarded ? "Awarded is indicated by the text." : "Not awarded.";
  const label = classification.split("_").join(" ");
  return {
    classification,
    awarded,
    fundsReceived,
    sendsMail: false,
    writesMlkRecord: false,
    item: {
      id: fixture ? `mlk-2027-fixture-${classification}` : `mlk-2027-reply-${classification}-${timestamp}`,
      severity: classification === "unclassified" ? "watch" : "high",
      title: fixture ? `Fixture only: ${label}` : `Commission reply: ${label}`,
      detail: `${award} ${money} Do not send.`,
      evidence: `${fixture ? "Fixture" : "Stored mail"} from ${who}. Subject: ${subject}. Class: ${label}.`,
      timestamp,
      path: "/api/hq/aura/brain-v1/priority-queue",
      source: fixture ? "mlk-2027-fixture" : "mlk-2027-commemorative",
    },
  };
}

export function commissionReplyQueueItem(text: string): CommissionAttention {
  return commissionReplyAlert({
    senderAddress: "MLKCommission@sos.nj.gov",
    senderName: "NJ MLK Commission",
    subject: "Fixture only",
    textBody: text,
    receivedAt: null,
  }, true);
}

export function priorityItemsForStoredMail(messages: StoredMailLike[]): Array<CommissionAttention["item"] | ReturnType<typeof mlkExecutiveWatchItem>> {
  const replies = messages.filter((message) => isMlkCommissionCorrespondent(message.senderAddress, message.senderName));
  if (!replies.length) return [mlkExecutiveWatchItem()];
  return replies.map((message) => commissionReplyAlert(message, false).item);
}

export function mlkExecutiveWatchItem(): {
  id: string;
  severity: "watch";
  title: string;
  detail: string;
  path: string;
  source: string;
} {
  return {
    id: "mlk-2027-watch-reply",
    severity: "watch",
    title: "MLK application delivered",
    detail: "Watch for a Commission reply. Do not send. No reply is on record. Not acknowledged, not under review, not awarded, and no funds received. Working deadline 3:00 p.m. October 26, 2026.",
    path: "/api/hq/communications/grant-outreach/queue",
    source: "mlk-2027-commemorative",
  };
}

const VERIFIED_BOOKING = {
  who: "notifications@ifcdcbarbersapp.com",
  subject: "[IFCDC] New booking — Paid in Full",
  timestamp: "2026-10-12T13:26:35Z",
  evidence: "Stored Headquarters mail. Booking notification. Not verified revenue. No dollar amount is known.",
};

export type FounderExecutiveBriefing = {
  sendsMail: false;
  generatedAt: string;
  grantApplications: Array<{ id: string; status: string; evidence: string; timestamp: string; nextAction: string }>;
  fundingOpportunities: { actionableCount: 0; items: Array<{ name: string; deadline: string; evidence: string }> };
  deadlines: Array<{ label: string; timestamp: string; evidence: string }>;
  importantEmails: Array<{ who: string; subject: string; timestamp: string; evidence: string; classification: string }>;
  founderDecisions: Array<{ text: string; timestamp: string; evidence: string }>;
  barbersActivity: Array<{ who: string; subject: string; timestamp: string; evidence: string }>;
  systemHealth: {
    intervalMs: number;
    automaticPolling: boolean;
    lastPollAt: string | null;
    lastPollStatus: string | null;
    recordedPolls: Array<{ at: string; result: string }>;
    pollGap: string;
  };
  money: {
    projected: { lane: "projected"; label: "proposed"; amount: "not stated"; evidence: string };
    submitted: { lane: "submitted"; label: "submitted estimate"; amount: "$1,000"; evidence: string };
    awards: { lane: "awards"; label: "none"; amount: "none"; evidence: string };
    received: { lane: "received"; label: "none"; amount: "none"; evidence: string };
  };
  alerts: Array<{ id: string; severity: "watch" | "info"; title: string; detail: string; evidence: string; timestamp: string }>;
};

export function buildFounderExecutiveBriefing(input: {
  generatedAt: string;
  messages?: StoredMailLike[];
  mailRead?: "stored" | "not_read";
  lastPollAt?: string | null;
  lastPollStatus?: string | null;
  intervalMs?: number;
  automaticPolling?: boolean;
}): FounderExecutiveBriefing {
  const messages = input.messages ?? [];
  const mailRead = input.mailRead ?? "not_read";
  const commission = scanCommissionReplies(messages);
  const bookingSeen = messages.some((message) =>
    (message.senderAddress || "").toLowerCase() === VERIFIED_BOOKING.who
    && message.subject === VERIFIED_BOOKING.subject
  );
  const barbers = messages
    .filter((message) => (message.senderAddress || "").toLowerCase() === VERIFIED_BOOKING.who || /booking/i.test(message.subject || ""))
    .map((message) => ({
      who: message.senderAddress || "unknown sender",
      subject: message.subject || "subject not stored",
      timestamp: message.receivedAt || "timestamp not stored",
      evidence: "Stored Headquarters mail. Booking notification. Not verified revenue. No dollar amount is known.",
    }));
  if (!bookingSeen) barbers.unshift(VERIFIED_BOOKING);
  return {
    sendsMail: false,
    generatedAt: input.generatedAt,
    grantApplications: [{
      id: "mlk-2027-commemorative",
      status: "Delivered — Awaiting Funder Acknowledgment",
      evidence: "Postmark message 8a057c7e-df5d-4393-b973-ea7b0500e87d. Activity delivered. No event time. Acknowledged no. Under review no. Awarded no. Funds received no.",
      timestamp: "2026-10-12T12:26:19.727Z",
      nextAction: "Watch for a Commission reply. Do not send.",
    }],
    fundingOpportunities: {
      actionableCount: 0,
      items: [
        { name: "NJ Arts FY2028 General Operating Support", deadline: "2026-11-19T12:00:00-05:00", evidence: "Not an IFCDC fit. Requires an exclusively arts mission. Actual expenses are unknown." },
        { name: "NJ Historical Commission General Operating Support", deadline: "2026-04-13T15:00:00-04:00", evidence: "Deadline has passed." },
        { name: "NJ Cultural Trust stabilization cycles reviewed", deadline: "unknown", evidence: "The cycles reviewed were closed." },
      ],
    },
    deadlines: [
      { label: "Working deadline", timestamp: "2026-10-26T15:00:00-04:00", evidence: "3:00 p.m. Monday, October 26, 2026. This remains the planning date." },
      { label: "Registration confirmation print", timestamp: "2026-10-30T15:00:00-04:00", evidence: "The registration confirmation also prints 3:00 p.m. October 30, 2026. That does not change the planning date." },
    ],
    importantEmails: commission.found
      ? commission.replies.map((reply) => ({
        who: reply.senderAddress || reply.senderName || "unknown sender",
        subject: reply.subject || "subject not stored",
        timestamp: reply.receivedAt || "timestamp not stored",
        evidence: "Classified from stored text only. This does not change the MLK status string by itself.",
        classification: reply.classification,
      }))
      : [{
        who: "none",
        subject: "No Commission reply in the stored set",
        timestamp: input.generatedAt,
        evidence: mailRead === "stored"
          ? "The messages read for this briefing contain no Commission reply. Mail outside that set is unverified."
          : "Stored mail was not read for this copy. The last verification found no Commission reply. Mail outside the stored set is unverified.",
        classification: "none",
      }],
    founderDecisions: [{
      text: "Watch for a Commission reply. Do not send.",
      timestamp: "2026-10-12T12:26:19.727Z",
      evidence: "No additional Commission documents have been requested.",
    }],
    barbersActivity: barbers,
    systemHealth: {
      intervalMs: input.intervalMs ?? 300000,
      automaticPolling: input.automaticPolling ?? false,
      lastPollAt: input.lastPollAt ?? null,
      lastPollStatus: input.lastPollStatus ?? null,
      recordedPolls: [
        { at: "2026-10-12T13:44:17.065Z", result: "ok" },
        { at: "2026-10-12T13:52:55.227Z", result: "ok" },
        { at: "2026-10-12T13:57:53.750Z", result: "ok" },
      ],
      pollGap: "The gap from 2026-10-12T13:44:17.065Z to 2026-10-12T13:52:55.227Z was 8 minutes 38 seconds, longer than 300000 ms. Production was not restarted to chase it.",
    },
    money: {
      projected: { lane: "projected", label: "proposed", amount: "not stated", evidence: "2027 figures are proposed, not actuals. Actual Headquarters expenses are unknown." },
      submitted: { lane: "submitted", label: "submitted estimate", amount: "$1,000", evidence: "MLK request. Estimates, not incurred, not an award, and not revenue." },
      awards: { lane: "awards", label: "none", amount: "none", evidence: "Awards received: none." },
      received: { lane: "received", label: "none", amount: "none", evidence: "Actual received grant revenue: none. The booking notice is not money received." },
    },
    alerts: [{
      id: "mlk-2027-watch-reply",
      severity: "watch",
      title: "MLK application delivered",
      detail: "Watch for a Commission reply. Do not send.",
      evidence: "Message 8a057c7e-df5d-4393-b973-ea7b0500e87d. No Commission reply is in the stored set.",
      timestamp: "2026-10-12T12:26:19.727Z",
    }],
  };
}

/** Read stored Headquarters mail. It does not send and does not invent a Commission message. */
export async function runMlkCommissionReplyCheck(db: { all: Function; get: Function; run: Function; exec: Function }): Promise<{
  found: boolean;
  sendsMail: false;
  live: boolean;
  intervalMs: number;
  replies: Array<{
    classification: CommissionReplyClass;
    receivedAt: string | null;
    subject: string;
    senderAddress: string;
    senderName: string;
  }>;
}> {
  const { listInboundBusinessMail } = await import("./inboundBusinessMail");
  let messages: StoredMailLike[] = [];
  try {
    messages = await listInboundBusinessMail(db as never);
  } catch {
    messages = [];
  }
  const scan = scanCommissionReplies(messages);
  let scheduled = false;
  try {
    const mailbox = await import("./microsoftGraphMailbox");
    scheduled = mailbox.mailboxSyncScheduled();
  } catch {
    scheduled = false;
  }
  return { ...scan, live: scheduled, intervalMs: MLK_COMMISSION_REPLY_CHECK_INTERVAL_MS };
}
