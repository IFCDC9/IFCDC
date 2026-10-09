import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Mail, Send, Plus, Inbox, Bell, Users, PhoneCall } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { communicationsApi, type InboundReplyDraft, type OutboundComposition, type OutboundSendResult } from "../../api/communicationsApi";
import { enterpriseApi } from "../../api/enterpriseApi";
import { useAuth } from "../../auth/AuthContext";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";

type Tab = "announcements" | "inbox" | "founder-inbox" | "original" | "sent" | "compose" | "email" | "campaigns" | "notifications" | "voice";

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const CommunicationsCenterPage: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("announcements");
  const [noticeGroup, setNoticeGroup] = useState("");
  const [inboundView, setInboundView] = useState("inbound");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, InboundReplyDraft>>({});
  const [replyEdits, setReplyEdits] = useState<Record<string, string>>({});
  const [sendConfirmed, setSendConfirmed] = useState<Record<string, boolean>>({});
  const [sendResults, setSendResults] = useState<Record<string, OutboundSendResult>>({});
  const [originalForm, setOriginalForm] = useState({ recipient: "", subject: "", body: "" });
  const [originalEdits, setOriginalEdits] = useState<Record<string, { recipient: string; subject: string; body: string }>>({});
  const [originalConfirmed, setOriginalConfirmed] = useState<Record<string, boolean>>({});
  const [originalResults, setOriginalResults] = useState<Record<string, OutboundSendResult>>({});
  const [showAnnounce, setShowAnnounce] = useState(false);
  const [announceForm, setAnnounceForm] = useState({ title: "", body: "", priority: "normal" });
  const [msgForm, setMsgForm] = useState({ to_email: "", to_name: "", subject: "", body: "" });
  const [emailForm, setEmailForm] = useState({ to: "", subject: "", body: "" });
  const [campaignForm, setCampaignForm] = useState({ segment: "employees", subject: "", body: "", channel: "email" });
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (window.location.hash === "#enterprise-notifications") setTab("notifications");
    if (window.location.hash === "#founder-inbox") setTab("founder-inbox");
    if (window.location.hash === "#original-email") setTab("original");
  }, []);

  const overview = useQuery({ queryKey: ["comms-overview"], queryFn: communicationsApi.overview });
  const enterpriseVisibility = useQuery({
    queryKey: ["enterprise-notifications", noticeGroup],
    queryFn: () => communicationsApi.enterpriseNotifications(noticeGroup || undefined),
    enabled: tab === "notifications",
  });
  const announcements = useQuery({ queryKey: ["comms-announcements"], queryFn: communicationsApi.announcements });
  const inbox = useQuery({ queryKey: ["comms-inbox"], queryFn: () => communicationsApi.messages("inbox"), enabled: tab === "inbox" });
  const founderInbox = useQuery({
    queryKey: ["comms-founder-inbox", inboundView],
    queryFn: () => communicationsApi.inboundMail(inboundView),
    enabled: tab === "founder-inbox",
  });
  const originalEmails = useQuery({
    queryKey: ["comms-original-email"],
    queryFn: communicationsApi.listOutboundCompositions,
    enabled: tab === "original" && (user?.role === "founder" || user?.role === "owner"),
  });
  const sent = useQuery({ queryKey: ["comms-sent"], queryFn: () => communicationsApi.messages("sent"), enabled: tab === "sent" });
  const enterpriseNotifs = useQuery({ queryKey: ["comms-notifications"], queryFn: enterpriseApi.notifications, enabled: tab === "notifications" });
  const audiences = useQuery({ queryKey: ["comms-audiences"], queryFn: communicationsApi.audiences, enabled: tab === "campaigns" || tab === "email" });
  const liveVoice = useQuery({
    queryKey: ["comms-voice-live"],
    queryFn: communicationsApi.liveCalls,
    enabled: tab === "voice",
    refetchInterval: tab === "voice" ? 4000 : false,
  });

  const createAnnounce = useMutation({
    mutationFn: communicationsApi.createAnnouncement,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comms-announcements"] });
      qc.invalidateQueries({ queryKey: ["comms-overview"] });
      setShowAnnounce(false);
      setAnnounceForm({ title: "", body: "", priority: "normal" });
    },
  });

  const sendMsg = useMutation({
    mutationFn: communicationsApi.sendMessage,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comms-sent"] });
      setMsgForm({ to_email: "", to_name: "", subject: "", body: "" });
      setTab("sent");
    },
  });

  const broadcastEmail = useMutation({
    mutationFn: communicationsApi.broadcastEmail,
    onSuccess: () => {
      setEmailForm({ to: "", subject: "", body: "" });
      setTab("announcements");
    },
  });

  const broadcastSegment = useMutation({
    mutationFn: communicationsApi.broadcastSegment,
    onSuccess: () => setCampaignForm({ segment: "employees", subject: "", body: "", channel: "email" }),
  });

  const canReviewDrafts = user?.role === "founder" || user?.role === "owner";
  const rememberDraft = (draft: InboundReplyDraft) => {
    setReplyDrafts((current) => ({ ...current, [draft.inboundId]: draft }));
    setReplyEdits((current) => ({ ...current, [draft.inboundId]: draft.replyText }));
  };
  const generateReplyDraft = useMutation({
    mutationFn: (id: string) => communicationsApi.createInboundReplyDraft(id),
    onSuccess: (result) => rememberDraft(result.draft),
  });
  const reviewReplyDraft = useMutation({
    mutationFn: (input: { id: string; action: "approve" | "edit" | "reject" | "save-for-later"; replyText?: string }) =>
      communicationsApi.reviewInboundReplyDraft(input.id, input.action, input.replyText),
    onSuccess: (result) => rememberDraft(result.draft),
  });
  const sendApprovedReply = useMutation({
    retry: false,
    mutationFn: (id: string) => communicationsApi.sendApprovedInboundReply(id, true),
    onSuccess: (result, id) => setSendResults((current) => ({ ...current, [id]: result })),
  });
  const saveOriginalEmail = useMutation({
    mutationFn: communicationsApi.createOutboundComposition,
    onSuccess: () => {
      setOriginalForm({ recipient: "", subject: "", body: "" });
      qc.invalidateQueries({ queryKey: ["comms-original-email"] });
    },
  });
  const reviewOriginalEmail = useMutation({
    mutationFn: (input: { id: string; action: "approve" | "edit" | "reject" | "save-for-later"; recipient?: string; subject?: string; body?: string }) =>
      communicationsApi.reviewOutboundComposition(input.id, input.action, input.recipient && input.subject && input.body ? { recipient: input.recipient, subject: input.subject, body: input.body } : undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comms-original-email"] }),
  });
  const sendOriginalEmail = useMutation({
    retry: false,
    mutationFn: (id: string) => communicationsApi.sendOutboundComposition(id, true),
    onSuccess: (result, id) => {
      setOriginalResults((current) => ({ ...current, [id]: result }));
      qc.invalidateQueries({ queryKey: ["comms-original-email"] });
    },
  });

  const markRead = useMutation({
    mutationFn: communicationsApi.markRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comms-inbox"] }),
  });

  const markNotifRead = useMutation({
    mutationFn: enterpriseApi.markRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comms-notifications"] }),
  });

  const PRIORITY_VARIANT: Record<string, "gold" | "warning" | "muted"> = {
    high: "warning",
    normal: "muted",
    low: "muted",
  };

  const calls = liveVoice.data?.calls ?? [];
  const jobs = liveVoice.data?.jobs ?? [];
  const selectedCall =
    calls.find((c) => (c.callSid || c.sessionId) === selectedCallId) ||
    calls[0] ||
    null;
  const activeCalls = calls.filter((c) => c.status === "in_progress" || c.status === "processing" || c.status === "ringing");

  return (
    <HQLayout
      title="Communications Center"
      subtitle="Internal messaging, announcements, AURA Voice monitoring, and organization-wide updates"
      auraModule="communications"
      auraActions={["ask", "summarize", "prepare_approval", "explain"]}
    >
      {overview.data && (
        <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
          <KpiCard label="Published Announcements" value={overview.data.announcements} icon={Megaphone} variant="gold" />
          <KpiCard label="Messages Sent" value={overview.data.messages} icon={Mail} />
          {tab === "voice" && (
            <>
              <KpiCard label="Live Voice Sessions" value={activeCalls.length} icon={PhoneCall} variant="gold" />
              <KpiCard label="Recent Voice Jobs" value={jobs.length} icon={PhoneCall} />
            </>
          )}
        </div>
      )}

      <nav className="hq-tabs">
        <button type="button" className={`hq-tab ${tab === "announcements" ? "active" : ""}`} onClick={() => setTab("announcements")}>
          <Megaphone size={16} /> Announcement Board
        </button>
        <button type="button" className={`hq-tab ${tab === "voice" ? "active" : ""}`} onClick={() => setTab("voice")}>
          <PhoneCall size={16} /> AURA Voice Monitor
        </button>
        <button type="button" className={`hq-tab ${tab === "inbox" ? "active" : ""}`} onClick={() => setTab("inbox")}>
          <Inbox size={16} /> Inbox
        </button>
        <button type="button" className={`hq-tab ${tab === "founder-inbox" ? "active" : ""}`} onClick={() => setTab("founder-inbox")}>
          <Mail size={16} /> Founder Inbox
        </button>
        <button type="button" className={`hq-tab ${tab === "original" ? "active" : ""}`} onClick={() => setTab("original")}>
          <Mail size={16} /> Original Email
        </button>
        <button type="button" className={`hq-tab ${tab === "sent" ? "active" : ""}`} onClick={() => setTab("sent")}>
          <Send size={16} /> Sent
        </button>
        <button type="button" className={`hq-tab ${tab === "compose" ? "active" : ""}`} onClick={() => setTab("compose")}>
          <Mail size={16} /> Compose
        </button>
        <button type="button" className={`hq-tab ${tab === "email" ? "active" : ""}`} onClick={() => setTab("email")}>
          <Send size={16} /> Email Center
        </button>
        <button type="button" className={`hq-tab ${tab === "campaigns" ? "active" : ""}`} onClick={() => setTab("campaigns")}>
          <Megaphone size={16} /> Campaigns
        </button>
        <button type="button" className={`hq-tab ${tab === "notifications" ? "active" : ""}`} onClick={() => setTab("notifications")}>
          <Bell size={16} /> Notification Center
        </button>
      </nav>

      <div className="hq-tab-content hq-fade-in">
        {tab === "voice" && (
          liveVoice.isLoading ? <HqLoading /> : (
            <div className="hq-grid-2">
              <HqPanel title="Live & Recent Calls" subtitle="Caller identity, duration, task, latency, job stage">
                <ul className="hq-notif-list">
                  {calls.map((c) => {
                    const key = c.callSid || c.sessionId;
                    const active = (selectedCall?.callSid || selectedCall?.sessionId) === key;
                    return (
                      <li
                        key={key}
                        className={`hq-notif-item ${active ? "unread" : "read"}`}
                        style={{ cursor: "pointer" }}
                        onClick={() => setSelectedCallId(key)}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <StatusBadge
                              label={c.status}
                              variant={c.status === "in_progress" || c.status === "processing" ? "gold" : c.status === "failed" ? "warning" : "muted"}
                            />
                            {c.founderMode && <StatusBadge label="Founder" variant="gold" />}
                            <strong style={{ fontSize: "0.9rem" }}>{c.callerIdentity}</strong>
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "var(--hq-text-muted)", marginTop: "0.25rem" }}>
                            {c.callerPhone || "—"} · {formatDuration(c.durationSec)}
                            {c.aiLatencyMs != null ? ` · AI ${c.aiLatencyMs}ms` : ""}
                          </div>
                          <p style={{ fontSize: "0.82rem", marginTop: "0.35rem", color: "var(--hq-text-muted)" }}>
                            {c.currentTask || c.lastSpeech || "No active task"}
                          </p>
                          {(c.jobStage || c.jobStatus) && (
                            <div style={{ fontSize: "0.75rem", marginTop: "0.25rem", color: "var(--hq-text-dim)" }}>
                              Job: {c.jobStage || c.jobStatus}
                              {c.jobProgress != null ? ` (${Math.round(c.jobProgress)}%)` : ""}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {!calls.length && <li className="hq-empty">No live AURA Voice sessions. Calls appear here when the HQ line is active.</li>}
                </ul>
              </HqPanel>

              <HqPanel
                title={selectedCall ? `Session · ${selectedCall.callerIdentity}` : "Call detail"}
                subtitle={selectedCall ? `${selectedCall.callSid || selectedCall.sessionId}` : "Select a call"}
              >
                {selectedCall ? (
                  <>
                    <div className="hq-form-grid" style={{ marginBottom: "1rem" }}>
                      <div>
                        <div className="hq-muted-text">Duration</div>
                        <div>{formatDuration(selectedCall.durationSec)}</div>
                      </div>
                      <div>
                        <div className="hq-muted-text">AI latency</div>
                        <div>{selectedCall.aiLatencyMs != null ? `${selectedCall.aiLatencyMs} ms` : "—"}</div>
                      </div>
                      <div>
                        <div className="hq-muted-text">Background job</div>
                        <div>{selectedCall.activeJobId || "—"}</div>
                      </div>
                      <div>
                        <div className="hq-muted-text">Stage</div>
                        <div>{selectedCall.jobStage || selectedCall.jobStatus || "—"}</div>
                      </div>
                    </div>
                    {selectedCall.providerErrors?.length > 0 && (
                      <p style={{ color: "var(--hq-danger)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>
                        Provider errors: {selectedCall.providerErrors.join(" · ")}
                      </p>
                    )}
                    <div style={{ fontSize: "0.78rem", color: "var(--hq-text-muted)", marginBottom: "0.5rem" }}>Transcript</div>
                    <ul className="hq-notif-list" style={{ maxHeight: 320, overflow: "auto" }}>
                      {selectedCall.transcript.map((t, i) => (
                        <li key={`${t.at}-${i}`} className="hq-notif-item read">
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: "0.78rem", textTransform: "uppercase", color: "var(--hq-text-dim)" }}>
                              {t.role} · {new Date(t.at).toLocaleTimeString()}
                            </div>
                            <p style={{ fontSize: "0.85rem", marginTop: "0.25rem", whiteSpace: "pre-wrap" }}>{t.content}</p>
                          </div>
                        </li>
                      ))}
                      {!selectedCall.transcript.length && <li className="hq-empty">Transcript will appear as the call progresses.</li>}
                    </ul>
                    {selectedCall.lastReply && (
                      <p style={{ marginTop: "0.75rem", fontSize: "0.82rem", color: "var(--hq-text-muted)" }}>
                        Final / latest reply: {selectedCall.lastReply}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="hq-muted-text">No call selected.</p>
                )}
              </HqPanel>

              <HqPanel title="Background Voice Jobs" subtitle="Job ID, stage, progress, Founder confirmation">
                <ul className="hq-notif-list">
                  {jobs.map((j) => (
                    <li key={j.id} className="hq-notif-item read">
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
                          <StatusBadge label={j.status} variant={j.status === "done" ? "gold" : j.status === "error" ? "warning" : "muted"} />
                          <StatusBadge label={j.commandType.replace(/_/g, " ")} variant="muted" />
                          {j.founderConfirmRequired && (
                            <StatusBadge label={j.founderConfirmed ? "confirmed" : "needs confirm"} variant={j.founderConfirmed ? "gold" : "warning"} />
                          )}
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "var(--hq-text-muted)", marginTop: "0.3rem" }}>
                          {j.id} · {j.stageLabel} · {Math.round(j.progressPercent)}%
                          {j.latencyMs != null ? ` · ${j.latencyMs}ms` : ""}
                        </div>
                        <p style={{ fontSize: "0.82rem", marginTop: "0.35rem" }}>{j.speech}</p>
                        {j.error && <p style={{ color: "var(--hq-danger)", fontSize: "0.78rem" }}>{j.error}</p>}
                      </div>
                    </li>
                  ))}
                  {!jobs.length && <li className="hq-empty">No recent voice background jobs.</li>}
                </ul>
              </HqPanel>
            </div>
          )
        )}

        {tab === "announcements" && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
              <button type="button" className="hq-btn hq-btn-primary" onClick={() => setShowAnnounce(true)}>
                <Plus size={16} /> Post Announcement
              </button>
            </div>
            {announcements.isLoading ? <HqLoading /> : (
              <div className="hq-grid-2">
                {(announcements.data?.announcements ?? []).map((a) => (
                  <HqPanel key={a.id} title={a.title} subtitle={`${a.author_name} · ${new Date(a.published_at).toLocaleDateString()}`}>
                    <StatusBadge label={a.priority} variant={PRIORITY_VARIANT[a.priority] ?? "muted"} />
                    <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", lineHeight: 1.6, color: "var(--hq-text-muted)", whiteSpace: "pre-wrap" }}>
                      {a.body}
                    </p>
                  </HqPanel>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "inbox" && (
          inbox.isLoading ? <HqLoading /> : (
            <HqPanel title="Inbox">
              <ul className="hq-notif-list">
                {(inbox.data?.messages ?? []).map((m) => (
                  <li key={m.id} className={`hq-notif-item ${m.read_at ? "read" : "unread"}`} onClick={() => !m.read_at && markRead.mutate(m.id)} style={{ cursor: "pointer" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{m.subject}</div>
                      <div style={{ fontSize: "0.78rem", color: "var(--hq-text-muted)" }}>From {m.from_name || m.from_email}</div>
                      <p style={{ fontSize: "0.82rem", marginTop: "0.35rem", color: "var(--hq-text-muted)" }}>{m.body.slice(0, 120)}{m.body.length > 120 ? "…" : ""}</p>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--hq-text-dim)" }}>{new Date(m.created_at).toLocaleDateString()}</div>
                  </li>
                ))}
                {!inbox.data?.messages?.length && <li className="hq-empty">No messages in inbox</li>}
              </ul>
            </HqPanel>
          )
        )}

        {tab === "founder-inbox" && (
          founderInbox.isLoading ? <HqLoading /> : (
            <HqPanel title="Founder Inbox" subtitle="Inbound business mail. A draft stays here until the Founder approves it. Approval does not send.">
              <label style={{ display: "block", marginBottom: "0.75rem", fontSize: "0.8rem" }}>
                View
                <select value={inboundView} onChange={(event) => setInboundView(event.target.value)} style={{ marginLeft: "0.5rem" }}>
                  <option value="inbound">Inbound</option>
                  <option value="unread">Unread</option>
                  <option value="urgent">Urgent</option>
                  <option value="needs-founder">Needs founder</option>
                  <option value="awaiting-reply">Awaiting reply</option>
                  <option value="drafts">Drafts</option>
                  <option value="follow-up">Follow-up</option>
                  <option value="deadlines">Deadlines</option>
                </select>
              </label>
              <ul className="hq-notif-list">
                {(founderInbox.data?.messages ?? []).map((message) => (
                  <li key={message.id} className={`hq-notif-item ${message.readAt ? "read" : "unread"}`}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
                        <StatusBadge label={message.category} variant={message.unmatched ? "muted" : "gold"} />
                        <StatusBadge label={message.urgency} variant={message.urgency === "high" ? "warning" : "muted"} />
                        {message.founderAttention && <StatusBadge label="Needs founder" variant="warning" />}
                        {message.unmatched && <StatusBadge label="Unmatched" variant="muted" />}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem", marginTop: "0.35rem" }}>{message.subject}</div>
                      <div style={{ fontSize: "0.78rem", color: "var(--hq-text-muted)" }}>
                        {message.senderName || message.senderAddress} · {message.senderAddress}
                      </div>
                      <p style={{ fontSize: "0.82rem", marginTop: "0.35rem", color: "var(--hq-text-muted)" }}>
                        {message.textBody.slice(0, 160)}{message.textBody.length > 160 ? "…" : ""}
                      </p>
                      {message.linked && (
                        <div style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                          Linked {message.linked.kind}: {message.linked.id}
                        </div>
                      )}
                      {message.deadline && (
                        <div style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>Deadline {message.deadline}</div>
                      )}
                      {message.draftSuggestion && (
                        <p style={{ fontSize: "0.78rem", marginTop: "0.35rem" }}>Draft suggestion, not sent: {message.draftSuggestion}</p>
                      )}
                      {canReviewDrafts && (
                        <div style={{ marginTop: "0.5rem" }}>
                          <button
                            type="button"
                            className="hq-btn hq-btn-secondary hq-btn-sm"
                            disabled={generateReplyDraft.isPending}
                            onClick={() => generateReplyDraft.mutate(message.id)}
                          >
                            Draft reply
                          </button>
                          {replyDrafts[message.id] && (
                            <div style={{ marginTop: "0.5rem", fontSize: "0.78rem" }}>
                              <StatusBadge label={replyDrafts[message.id].status} variant={replyDrafts[message.id].activeApproval ? "warning" : "muted"} />
                              <p style={{ marginTop: "0.35rem" }}>Not sent.</p>
                              <p>Who sent it: {replyDrafts[message.id].summary.whoSent}</p>
                              <p>Organization: {replyDrafts[message.id].summary.organization}</p>
                              <p>What they want: {replyDrafts[message.id].summary.whatTheyWant}</p>
                              <p>Priority: {replyDrafts[message.id].summary.priority}</p>
                              <p>Deadline: {replyDrafts[message.id].summary.deadline}</p>
                              <p>Recommended response: {replyDrafts[message.id].summary.recommendedResponse}</p>
                              <p>Risk: {replyDrafts[message.id].summary.risk}</p>
                              <textarea
                                className="hq-input"
                                rows={5}
                                value={replyEdits[message.id] ?? replyDrafts[message.id].replyText}
                                onChange={(event) => setReplyEdits((current) => ({ ...current, [message.id]: event.target.value }))}
                                disabled={!replyDrafts[message.id].activeApproval}
                              />
                              {replyDrafts[message.id].activeApproval && (
                                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
                                  <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => reviewReplyDraft.mutate({ id: message.id, action: "edit", replyText: replyEdits[message.id] })}>Edit</button>
                                  <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => reviewReplyDraft.mutate({ id: message.id, action: "approve" })}>Approve</button>
                                  <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => reviewReplyDraft.mutate({ id: message.id, action: "reject" })}>Reject</button>
                                  <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => reviewReplyDraft.mutate({ id: message.id, action: "save-for-later" })}>Save for later</button>
                                </div>
                              )}
                              {replyDrafts[message.id].status === "FOUNDER APPROVED" && (
                                <div style={{ marginTop: "0.5rem" }}>
                                  <p>Approval does not send. Sending is a separate action.</p>
                                  <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                                    <input
                                      type="checkbox"
                                      checked={sendConfirmed[message.id] === true}
                                      onChange={(event) => setSendConfirmed((current) => ({ ...current, [message.id]: event.target.checked }))}
                                    />
                                    Confirm send
                                  </label>
                                  <button
                                    type="button"
                                    className="hq-btn hq-btn-secondary hq-btn-sm"
                                    style={{ marginTop: "0.35rem" }}
                                    disabled={sendConfirmed[message.id] !== true || sendApprovedReply.isPending}
                                    onClick={() => sendApprovedReply.mutate(message.id)}
                                  >
                                    Send approved reply
                                  </button>
                                  {sendResults[message.id] && (
                                    <p>Send status: {sendResults[message.id].status}. {sendResults[message.id].sent ? "Sent." : "Not sent."}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--hq-text-dim)" }}>{new Date(message.receivedAt).toLocaleString()}</div>
                  </li>
                ))}
                {!founderInbox.data?.messages?.length && <li className="hq-empty">No inbound business mail</li>}
              </ul>
            </HqPanel>
          )
        )}

        {tab === "original" && (
          <HqPanel title="Original Email">
            <p style={{ fontSize: "0.82rem" }}>From service@ifcdc.org. Saving a draft does not send. Approval does not send.</p>
            {canReviewDrafts ? (
              <>
                <div className="hq-form-grid" style={{ marginTop: "0.75rem" }}>
                  <label>To<input className="hq-input" value={originalForm.recipient} onChange={(event) => setOriginalForm({ ...originalForm, recipient: event.target.value })} /></label>
                  <label style={{ gridColumn: "1 / -1" }}>Subject<input className="hq-input" value={originalForm.subject} onChange={(event) => setOriginalForm({ ...originalForm, subject: event.target.value })} /></label>
                  <label style={{ gridColumn: "1 / -1" }}>Message<textarea className="hq-input" rows={8} value={originalForm.body} onChange={(event) => setOriginalForm({ ...originalForm, body: event.target.value })} /></label>
                </div>
                <button
                  type="button"
                  className="hq-btn hq-btn-secondary hq-btn-sm"
                  style={{ marginTop: "0.5rem" }}
                  disabled={!originalForm.recipient || !originalForm.subject.trim() || !originalForm.body.trim() || saveOriginalEmail.isPending}
                  onClick={() => saveOriginalEmail.mutate(originalForm)}
                >
                  Save draft for review
                </button>
                <ul className="hq-notif-list" style={{ marginTop: "1rem" }}>
                  {(originalEmails.data?.compositions ?? []).map((draft: OutboundComposition) => {
                    const edit = originalEdits[draft.id] ?? { recipient: draft.recipient, subject: draft.subject, body: draft.body };
                    return (
                      <li key={draft.id} className="hq-notif-item">
                        <div style={{ flex: 1 }}>
                          <StatusBadge label={draft.status} variant={draft.activeApproval ? "warning" : "muted"} />
                          <p style={{ marginTop: "0.35rem" }}>Not sent. No conversation id.</p>
                          <p>From {draft.from}</p>
                          <label>To<input className="hq-input" value={edit.recipient} disabled={!draft.activeApproval} onChange={(event) => setOriginalEdits((current) => ({ ...current, [draft.id]: { ...edit, recipient: event.target.value } }))} /></label>
                          <label>Subject<input className="hq-input" value={edit.subject} disabled={!draft.activeApproval} onChange={(event) => setOriginalEdits((current) => ({ ...current, [draft.id]: { ...edit, subject: event.target.value } }))} /></label>
                          <label>Message<textarea className="hq-input" rows={8} value={edit.body} disabled={!draft.activeApproval} onChange={(event) => setOriginalEdits((current) => ({ ...current, [draft.id]: { ...edit, body: event.target.value } }))} /></label>
                          {draft.activeApproval && (
                            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
                              <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => reviewOriginalEmail.mutate({ id: draft.id, action: "edit", ...edit })}>Save edit</button>
                              <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => reviewOriginalEmail.mutate({ id: draft.id, action: "approve" })}>Approve</button>
                              <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => reviewOriginalEmail.mutate({ id: draft.id, action: "reject" })}>Reject</button>
                              <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => reviewOriginalEmail.mutate({ id: draft.id, action: "save-for-later" })}>Save for later</button>
                            </div>
                          )}
                          {draft.status === "FOUNDER APPROVED" && (
                            <div style={{ marginTop: "0.5rem" }}>
                              <p>Approval does not send. Sending is a separate action.</p>
                              <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                                <input type="checkbox" checked={originalConfirmed[draft.id] === true} onChange={(event) => setOriginalConfirmed((current) => ({ ...current, [draft.id]: event.target.checked }))} />
                                Confirm send
                              </label>
                              <button
                                type="button"
                                className="hq-btn hq-btn-secondary hq-btn-sm"
                                style={{ marginTop: "0.35rem" }}
                                disabled={originalConfirmed[draft.id] !== true || sendOriginalEmail.isPending}
                                onClick={() => sendOriginalEmail.mutate(draft.id)}
                              >
                                Send approved email
                              </button>
                              {originalResults[draft.id] && (
                                <p>Send status: {originalResults[draft.id].status}. {originalResults[draft.id].sent ? "Sent." : "Not sent."}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p>Founder session required.</p>
            )}
          </HqPanel>
        )}

        {tab === "sent" && (
          sent.isLoading ? <HqLoading /> : (
            <HqPanel title="Sent Messages">
              <ul className="hq-notif-list">
                {(sent.data?.messages ?? []).map((m) => (
                  <li key={m.id} className="hq-notif-item read">
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{m.subject}</div>
                      <div style={{ fontSize: "0.78rem", color: "var(--hq-text-muted)" }}>To {m.to_name || m.to_email}</div>
                      <p style={{ fontSize: "0.82rem", marginTop: "0.35rem" }}>{m.body.slice(0, 100)}…</p>
                    </div>
                  </li>
                ))}
              </ul>
            </HqPanel>
          )
        )}

        {tab === "compose" && (
          <HqPanel title="Compose Message">
            <div className="hq-form-grid">
              <label>To Email<input className="hq-input" value={msgForm.to_email} onChange={(e) => setMsgForm({ ...msgForm, to_email: e.target.value })} placeholder="colleague@ifcdc.org" /></label>
              <label>Recipient Name<input className="hq-input" value={msgForm.to_name} onChange={(e) => setMsgForm({ ...msgForm, to_name: e.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Subject<input className="hq-input" value={msgForm.subject} onChange={(e) => setMsgForm({ ...msgForm, subject: e.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Message<textarea className="hq-input" rows={5} value={msgForm.body} onChange={(e) => setMsgForm({ ...msgForm, body: e.target.value })} /></label>
            </div>
            <div className="hq-modal-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="hq-btn hq-btn-primary" disabled={!msgForm.to_email || !msgForm.subject || !msgForm.body || sendMsg.isPending} onClick={() => sendMsg.mutate(msgForm)}>
                {sendMsg.isPending ? "Sending…" : "Send Message"}
              </button>
            </div>
            <p className="hq-muted-text" style={{ marginTop: "1rem" }}>Signed in as {user?.email}. SMS and email broadcast available via Enterprise Notifications.</p>
          </HqPanel>
        )}

        {tab === "email" && (
          <HqPanel title="Email Center" subtitle="Organization-wide email broadcast via Enterprise Notifications">
            <div className="hq-form-grid">
              <label>To (email or comma-separated)<input className="hq-input" value={emailForm.to} onChange={(e) => setEmailForm({ ...emailForm, to: e.target.value })} placeholder="team@ifcdc.org or all-staff@ifcdc.org" /></label>
              <label style={{ gridColumn: "1 / -1" }}>Subject<input className="hq-input" value={emailForm.subject} onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Body<textarea className="hq-input" rows={6} value={emailForm.body} onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })} /></label>
            </div>
            <div className="hq-modal-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="hq-btn hq-btn-primary"
                disabled={!emailForm.to || !emailForm.subject || !emailForm.body || broadcastEmail.isPending}
                onClick={() => broadcastEmail.mutate({ ...emailForm, channel: "email" })}>
                {broadcastEmail.isPending ? "Sending…" : "Send Broadcast Email"}
              </button>
            </div>
            {broadcastEmail.isSuccess && (
              <p style={{ marginTop: "1rem", color: "var(--hq-success)", fontSize: "0.85rem" }}>Email broadcast queued successfully.</p>
            )}
            {broadcastEmail.isError && (
              <p style={{ marginTop: "1rem", color: "var(--hq-danger)", fontSize: "0.85rem" }}>{(broadcastEmail.error as Error).message}</p>
            )}
          </HqPanel>
        )}

        {tab === "campaigns" && (
          <HqPanel title="Audience Campaigns" subtitle="Email and SMS campaigns to employees, volunteers, board, and staff">
            <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
              {(audiences.data?.segments ?? []).map((s) => (
                <KpiCard key={s.id} label={s.label} value={s.count} icon={Users} variant={campaignForm.segment === s.id ? "gold" : "muted"} />
              ))}
            </div>
            <div className="hq-form-grid">
              <label>Audience Segment
                <select className="hq-input" value={campaignForm.segment} onChange={(e) => setCampaignForm({ ...campaignForm, segment: e.target.value })}>
                  {(audiences.data?.segments ?? []).map((s) => <option key={s.id} value={s.id}>{s.label} ({s.count})</option>)}
                </select>
              </label>
              <label>Channel
                <select className="hq-input" value={campaignForm.channel} onChange={(e) => setCampaignForm({ ...campaignForm, channel: e.target.value })}>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="push">Push</option>
                </select>
              </label>
              <label style={{ gridColumn: "1 / -1" }}>Subject<input className="hq-input" value={campaignForm.subject} onChange={(e) => setCampaignForm({ ...campaignForm, subject: e.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Message<textarea className="hq-input" rows={5} value={campaignForm.body} onChange={(e) => setCampaignForm({ ...campaignForm, body: e.target.value })} placeholder="Use {name} for personalization" /></label>
            </div>
            <button type="button" className="hq-btn hq-btn-primary" style={{ marginTop: "1rem" }}
              disabled={!campaignForm.subject || !campaignForm.body || broadcastSegment.isPending}
              onClick={() => broadcastSegment.mutate(campaignForm)}>
              {broadcastSegment.isPending ? "Sending…" : "Launch Campaign"}
            </button>
            {broadcastSegment.isSuccess && (
              <p style={{ marginTop: "1rem", color: "var(--hq-success)", fontSize: "0.85rem" }}>
                Sent to {broadcastSegment.data?.sent} of {broadcastSegment.data?.total} recipients.
              </p>
            )}
          </HqPanel>
        )}

        {tab === "notifications" && (
          <div id="enterprise-notifications">
            {enterpriseVisibility.isLoading ? <HqLoading /> : (
              <HqPanel title="Enterprise Notifications" subtitle={enterpriseVisibility.data?.responseTimeMs != null ? `Barbers read ${enterpriseVisibility.data.responseTimeMs} ms` : "Read-only delivery visibility"}>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                  <StatusBadge label={`Postmark ${enterpriseVisibility.data?.providers.postmark.status ?? "unknown"}`} variant={enterpriseVisibility.data?.providers.postmark.configured ? "success" : "muted"} />
                  <StatusBadge label={`Twilio ${enterpriseVisibility.data?.providers.twilio.status ?? "unknown"}`} variant={enterpriseVisibility.data?.providers.twilio.configured ? "success" : "muted"} />
                  <StatusBadge label={`Resend ${enterpriseVisibility.data?.providers.resend.status ?? "legacy"}`} variant="muted" />
                </div>
                <p style={{ fontSize: "0.82rem", color: "var(--hq-text-muted)" }}>
                  Delivered {enterpriseVisibility.data?.summary.delivered ?? 0}
                  {" · "}Pending {enterpriseVisibility.data?.summary.pending ?? 0}
                  {" · "}Accepted {enterpriseVisibility.data?.summary.accepted ?? 0}
                  {" · "}Failed {enterpriseVisibility.data?.summary.failed ?? 0}
                  {" · "}Bounced {enterpriseVisibility.data?.summary.bounced ?? 0}
                  {" · "}Retried {enterpriseVisibility.data?.summary.retried ?? 0}
                  {" · "}Fallback {enterpriseVisibility.data?.summary.fallbackUsed ?? 0}
                </p>
                <label style={{ display: "block", margin: "0.75rem 0" }}>
                  Activity
                  <select className="hq-input" value={noticeGroup} onChange={(e) => setNoticeGroup(e.target.value)}>
                    <option value="">All stored activity</option>
                    {Object.entries(enterpriseVisibility.data?.groups ?? {}).map(([group, count]) => (
                      <option key={group} value={group}>{group} ({count})</option>
                    ))}
                  </select>
                </label>
                <table className="hq-table hq-table-compact">
                  <thead>
                    <tr>
                      <th>Time</th><th>Type</th><th>Recipient</th><th>App</th><th>Booking</th><th>Provider</th><th>Status</th><th>Fallback</th><th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(enterpriseVisibility.data?.records ?? []).map((record, index) => (
                      <tr key={`${record.providerMessageId ?? record.bookingId ?? "row"}-${index}`}>
                        <td>{record.time ? new Date(record.time).toLocaleString() : "—"}</td>
                        <td>{record.type ?? "—"}</td>
                        <td>{record.recipient ?? "—"}</td>
                        <td>{record.originatingApp}</td>
                        <td>{record.bookingId ?? "—"}</td>
                        <td>{record.provider ?? "—"}</td>
                        <td>{record.status ?? "—"}</td>
                        <td>{record.fallbackUsed == null ? "—" : record.fallbackUsed ? "yes" : "no"}</td>
                        <td>{record.error ?? "—"}</td>
                      </tr>
                    ))}
                    {!enterpriseVisibility.data?.records?.length && (
                      <tr><td colSpan={9}>No stored notification activity</td></tr>
                    )}
                  </tbody>
                </table>
              </HqPanel>
            )}
          </div>
        )}

        {tab === "notifications" && (
          enterpriseNotifs.isLoading ? <HqLoading /> : (
            <HqPanel title="Enterprise Notification Center" subtitle={`${enterpriseNotifs.data?.unreadCount ?? 0} unread alerts`}>
              <ul className="hq-notif-list">
                {(enterpriseNotifs.data?.notifications ?? []).map((n) => (
                  <li key={n.id} className={`hq-notif-item ${n.read ? "read" : "unread"}`}
                    onClick={() => !n.read && markNotifRead.mutate(n.id)} style={{ cursor: n.read ? "default" : "pointer" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <StatusBadge label={n.priority} variant={n.priority === "high" ? "warning" : "muted"} />
                        <strong style={{ fontSize: "0.9rem" }}>{n.title}</strong>
                      </div>
                      <p style={{ fontSize: "0.82rem", marginTop: "0.35rem", color: "var(--hq-text-muted)" }}>{n.message}</p>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--hq-text-dim)" }}>{new Date(n.timestamp).toLocaleDateString()}</div>
                  </li>
                ))}
                {!enterpriseNotifs.data?.notifications?.length && <li className="hq-empty">No notifications</li>}
              </ul>
            </HqPanel>
          )
        )}
      </div>

      {showAnnounce && (
        <div className="hq-modal-overlay" onClick={() => setShowAnnounce(false)}>
          <div className="hq-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Post Organization Announcement</h3>
            <div className="hq-form-grid">
              <label>Title<input value={announceForm.title} onChange={(e) => setAnnounceForm({ ...announceForm, title: e.target.value })} /></label>
              <label>Priority
                <select value={announceForm.priority} onChange={(e) => setAnnounceForm({ ...announceForm, priority: e.target.value })}>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label style={{ gridColumn: "1 / -1" }}>Message<textarea rows={4} value={announceForm.body} onChange={(e) => setAnnounceForm({ ...announceForm, body: e.target.value })} /></label>
            </div>
            <div className="hq-modal-actions">
              <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setShowAnnounce(false)}>Cancel</button>
              <button type="button" className="hq-btn hq-btn-primary" disabled={!announceForm.title || !announceForm.body || createAnnounce.isPending} onClick={() => createAnnounce.mutate(announceForm)}>
                {createAnnounce.isPending ? "Publishing…" : "Publish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </HQLayout>
  );
};

export default CommunicationsCenterPage;
