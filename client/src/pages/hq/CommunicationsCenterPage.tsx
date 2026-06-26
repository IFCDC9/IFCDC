import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Mail, Send, Plus, Inbox, Bell, Users } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { communicationsApi } from "../../api/communicationsApi";
import { enterpriseApi } from "../../api/enterpriseApi";
import { useAuth } from "../../auth/AuthContext";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";

type Tab = "announcements" | "inbox" | "sent" | "compose" | "email" | "campaigns" | "notifications";

const CommunicationsCenterPage: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("announcements");
  const [showAnnounce, setShowAnnounce] = useState(false);
  const [announceForm, setAnnounceForm] = useState({ title: "", body: "", priority: "normal" });
  const [msgForm, setMsgForm] = useState({ to_email: "", to_name: "", subject: "", body: "" });
  const [emailForm, setEmailForm] = useState({ to: "", subject: "", body: "" });
  const [campaignForm, setCampaignForm] = useState({ segment: "employees", subject: "", body: "", channel: "email" });
  const qc = useQueryClient();

  const overview = useQuery({ queryKey: ["comms-overview"], queryFn: communicationsApi.overview });
  const announcements = useQuery({ queryKey: ["comms-announcements"], queryFn: communicationsApi.announcements });
  const inbox = useQuery({ queryKey: ["comms-inbox"], queryFn: () => communicationsApi.messages("inbox"), enabled: tab === "inbox" });
  const sent = useQuery({ queryKey: ["comms-sent"], queryFn: () => communicationsApi.messages("sent"), enabled: tab === "sent" });
  const enterpriseNotifs = useQuery({ queryKey: ["comms-notifications"], queryFn: enterpriseApi.notifications, enabled: tab === "notifications" });
  const audiences = useQuery({ queryKey: ["comms-audiences"], queryFn: communicationsApi.audiences, enabled: tab === "campaigns" || tab === "email" });

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

  return (
    <HQLayout
      title="Communications Center"
      subtitle="Internal messaging, announcements, and organization-wide updates"
    >
      {overview.data && (
        <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
          <KpiCard label="Published Announcements" value={overview.data.announcements} icon={Megaphone} variant="gold" />
          <KpiCard label="Messages Sent" value={overview.data.messages} icon={Mail} />
        </div>
      )}

      <nav className="hq-tabs">
        <button type="button" className={`hq-tab ${tab === "announcements" ? "active" : ""}`} onClick={() => setTab("announcements")}>
          <Megaphone size={16} /> Announcement Board
        </button>
        <button type="button" className={`hq-tab ${tab === "inbox" ? "active" : ""}`} onClick={() => setTab("inbox")}>
          <Inbox size={16} /> Inbox
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
