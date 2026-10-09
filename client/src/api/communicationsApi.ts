async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/communications${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export interface EnterpriseNotificationCard {
  readOnly: boolean;
  responseTimeMs: number | null;
  source: string;
  emailClaimsAvailable: boolean;
  smsLogsAvailable: boolean;
  providers: {
    postmark: { role: string; configured: boolean; recentStored: boolean; status: string };
    twilio: { role: string; configured: boolean; messagingServiceConfigured: boolean; recentStored: boolean; status: string };
    resend: { role: string; configured: boolean; recentStored: boolean; status: string };
  };
  summary: { delivered: number; pending: number; failed: number; bounced: number; retried: number; fallbackUsed: number; accepted: number };
  groups: Record<string, number>;
  filter: string | null;
  records: Array<{
    time: string | null;
    type: string | null;
    recipient: string | null;
    originatingApp: string;
    bookingId: string | null;
    provider: string | null;
    providerMessageId: string | null;
    status: string | null;
    fallbackUsed: boolean | null;
    error: string | null;
    group: string;
  }>;
}

export const communicationsApi = {
  overview: () => api<{ announcements: number; messages: number }>("/overview"),
  enterpriseNotifications: (group?: string) =>
    api<EnterpriseNotificationCard>(`/enterprise-notifications${group ? `?group=${encodeURIComponent(group)}` : ""}`),
  announcements: () => api<{ announcements: Announcement[] }>("/announcements"),
  createAnnouncement: (data: { title: string; body: string; priority?: string; expires_at?: string }) =>
    api("/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  messages: (folder?: "inbox" | "sent") =>
    api<{ messages: HQMessage[] }>(`/messages?folder=${folder ?? "inbox"}`),
  inboundMail: (view?: string) =>
    api<{ readOnly: boolean; messages: InboundBusinessMail[] }>(`/inbound-mail${view ? `?view=${encodeURIComponent(view)}` : ""}`),
  createInboundReplyDraft: (id: string) =>
    api<InboundReplyDraftResult>(`/inbound-mail/${encodeURIComponent(id)}/aura-draft`, { method: "POST" }),
  reviewInboundReplyDraft: (id: string, action: "approve" | "edit" | "reject" | "save-for-later", replyText?: string) =>
    api<InboundReplyDraftResult>(`/inbound-mail/${encodeURIComponent(id)}/aura-draft/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, replyText }),
    }),
  sendApprovedInboundReply: (id: string, confirmSend: true) =>
    api<OutboundSendResult>(`/inbound-mail/${encodeURIComponent(id)}/aura-draft/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmSend }),
    }),
  listOutboundCompositions: () =>
    api<{ sent: false; compositions: OutboundComposition[] }>("/outbound-compositions"),
  createOutboundComposition: (input: { recipient: string; subject: string; body: string }) =>
    api<OutboundCompositionResult>("/outbound-compositions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  reviewOutboundComposition: (
    id: string,
    action: "approve" | "edit" | "reject" | "save-for-later",
    content?: { recipient: string; subject: string; body: string },
  ) =>
    api<OutboundCompositionResult>(`/outbound-compositions/${encodeURIComponent(id)}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...content }),
    }),
  sendOutboundComposition: (id: string, confirmSend: true) =>
    api<OutboundSendResult>(`/outbound-compositions/${encodeURIComponent(id)}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmSend }),
    }),
  sendMessage: (data: { to_email: string; to_name?: string; subject: string; body: string }) =>
    api("/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  markRead: (id: string) =>
    api(`/messages/${id}/read`, { method: "PATCH" }),
  broadcastEmail: async (data: { to: string; subject: string; body: string; channel?: string }) => {
    const res = await fetch("/api/hq/notifications/broadcast", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Broadcast failed");
    }
    return res.json();
  },
  audiences: () => api<{ segments: { id: string; label: string; count: number }[] }>("/audiences"),
  broadcastSegment: (data: { segment: string; subject: string; body: string; channel?: string }) =>
    api<{ segment: string; sent: number; failed: number; total: number }>("/broadcast-segment", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }),
  liveCalls: () =>
    api<{ calls: LiveVoiceCall[]; jobs: LiveVoiceJob[]; generatedAt: string }>("/voice/live"),
};

export interface LiveVoiceCall {
  callSid: string | null;
  sessionId: string;
  callerPhone: string | null;
  callerIdentity: string;
  founderMode: boolean;
  startedAt: string;
  durationSec: number;
  status: string;
  currentTask: string | null;
  activeJobId: string | null;
  jobStatus: string | null;
  jobStage: string | null;
  jobProgress: number | null;
  lastSpeech: string | null;
  lastReply: string | null;
  aiLatencyMs: number | null;
  providerErrors: string[];
  transcript: Array<{ role: string; content: string; at: string }>;
  updatedAt: string;
}

export interface LiveVoiceJob {
  id: string;
  sessionId: string;
  callSid: string | null;
  callerPhone: string | null;
  speech: string;
  commandType: string;
  status: string;
  stage: string;
  stageLabel: string;
  progressPercent: number;
  latencyMs: number | null;
  founderConfirmRequired: boolean;
  founderConfirmed: boolean;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  priority: string;
  author_name: string;
  published_at: string;
}

export interface InboundBusinessMail {
  id: string;
  messageId: string;
  threadId: string | null;
  senderName: string | null;
  senderAddress: string;
  recipient: string;
  subject: string;
  textBody: string;
  receivedAt: string;
  category: string;
  unmatched: boolean;
  urgency: string;
  founderAttention: boolean;
  flags: {
    deadline: boolean;
    meeting: boolean;
    fundingOpportunity: boolean;
    payment: boolean;
    approval: boolean;
    partnershipRequest: boolean;
  };
  deadline: string | null;
  linked: { kind: string; id: string } | null;
  attachments: Array<{ filename: string; contentType: string; size: number }>;
  draftSuggestion: string | null;
  readAt: string | null;
}

export interface InboundReplyDraftSummary {
  whoSent: string;
  organization: string;
  whatTheyWant: string;
  priority: string;
  deadline: string;
  recommendedResponse: string;
  risk: string;
}

export interface InboundReplyDraft {
  inboundId: string;
  status: string;
  sent: false;
  activeApproval: boolean;
  providerMessageId: string;
  threadId: string | null;
  senderName: string | null;
  senderAddress: string;
  subject: string;
  contextSummary: string;
  linked: { kind: string; id: string } | null;
  replyText: string;
  summary: InboundReplyDraftSummary;
  hqContext: string;
}

export interface InboundReplyDraftResult {
  sent: false;
  status: string;
  activeApproval: boolean;
  draft: InboundReplyDraft;
}

export interface OutboundComposition {
  id: string;
  from: "service@ifcdc.org";
  recipient: string;
  subject: string;
  body: string;
  status: string;
  sent: false;
  activeApproval: boolean;
  conversationId: null;
  deliveryHistory: Array<{
    id: string;
    status: string;
    errorCode: string | null;
    providerMessageId: string | null;
    duplicateKey: string | null;
    timestamp: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface OutboundCompositionResult {
  sent: false;
  status: string;
  activeApproval: boolean;
  draft: OutboundComposition;
}

export interface OutboundSendResult {
  sent: boolean;
  status: string;
  errorCode: string | null;
  changed: boolean;
  record: {
    id: string;
    draftId: string;
    actorRole: string;
    timestamp: string;
    status: string;
    providerMessageId: string | null;
    errorCode: string | null;
    duplicateKey: string | null;
    attachmentsNote: string;
  } | null;
}

export interface HQMessage {
  id: string;
  from_email: string;
  from_name: string;
  to_email: string;
  to_name?: string;
  subject: string;
  body: string;
  read_at: string | null;
  created_at: string;
}
