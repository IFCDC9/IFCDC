async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hq/communications${path}`, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const communicationsApi = {
  overview: () => api<{ announcements: number; messages: number }>("/overview"),
  announcements: () => api<{ announcements: Announcement[] }>("/announcements"),
  createAnnouncement: (data: { title: string; body: string; priority?: string; expires_at?: string }) =>
    api("/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  messages: (folder?: "inbox" | "sent") =>
    api<{ messages: HQMessage[] }>(`/messages?folder=${folder ?? "inbox"}`),
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
