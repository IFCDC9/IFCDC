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
