import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Gavel, Calendar, FileText, Vote, Shield, Wallet, Plus, CheckCircle, Download,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { boardApi } from "../../api/boardApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { downloadReportJson } from "../../api/analyticsApi";

type Tab = "overview" | "meetings" | "packets" | "resolutions" | "financial" | "documents";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Governance Overview", icon: Gavel },
  { id: "meetings", label: "Meetings & Minutes", icon: Calendar },
  { id: "packets", label: "Board Packets", icon: FileText },
  { id: "resolutions", label: "Resolutions & Voting", icon: Vote },
  { id: "financial", label: "Financial Reports", icon: Wallet },
  { id: "documents", label: "Secure Documents", icon: Shield },
];

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const BoardPortalPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>("overview");
  const [meetingForm, setMeetingForm] = useState({ title: "", meeting_date: "", location: "", agenda: "" });
  const [packetForm, setPacketForm] = useState({ title: "", meeting_id: "", description: "" });
  const [resolutionForm, setResolutionForm] = useState({ title: "", resolution_text: "", meeting_id: "" });
  const qc = useQueryClient();

  const overview = useQuery({ queryKey: ["board-overview"], queryFn: boardApi.overview });
  const meetings = useQuery({ queryKey: ["board-meetings"], queryFn: boardApi.meetings, enabled: tab === "meetings" || tab === "overview" });
  const packets = useQuery({ queryKey: ["board-packets"], queryFn: boardApi.packets, enabled: tab === "packets" || tab === "overview" });
  const resolutions = useQuery({ queryKey: ["board-resolutions"], queryFn: boardApi.resolutions, enabled: tab === "resolutions" || tab === "overview" });
  const financial = useQuery({ queryKey: ["board-financial"], queryFn: boardApi.financialReport, enabled: tab === "financial" });
  const governance = useQuery({ queryKey: ["board-governance"], queryFn: boardApi.governancePackage, enabled: tab === "overview" });
  const documents = useQuery({ queryKey: ["board-documents"], queryFn: boardApi.documents, enabled: tab === "documents" });

  const createMeeting = useMutation({
    mutationFn: () => boardApi.createMeeting(meetingForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["board-meetings"] }); qc.invalidateQueries({ queryKey: ["board-overview"] }); setMeetingForm({ title: "", meeting_date: "", location: "", agenda: "" }); },
  });
  const createPacket = useMutation({
    mutationFn: () => boardApi.createPacket({ ...packetForm, meeting_id: packetForm.meeting_id || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["board-packets"] }); setPacketForm({ title: "", meeting_id: "", description: "" }); },
  });
  const publishPacket = useMutation({
    mutationFn: (id: string) => boardApi.publishPacket(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board-packets"] }),
  });
  const createResolution = useMutation({
    mutationFn: () => boardApi.createResolution({ ...resolutionForm, meeting_id: resolutionForm.meeting_id || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["board-resolutions"] }); setResolutionForm({ title: "", resolution_text: "", meeting_id: "" }); },
  });
  const castVote = useMutation({
    mutationFn: ({ id, vote }: { id: string; vote: "yes" | "no" | "abstain" }) => boardApi.vote(id, vote),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board-resolutions"] }),
  });
  const finalize = useMutation({
    mutationFn: (id: string) => boardApi.finalizeResolution(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board-resolutions"] }),
  });

  const ov = overview.data as { upcomingMeetings?: number; openActionsCount?: number; pendingResolutions?: number } | undefined;

  return (
    <HQLayout title="Board of Directors Portal" subtitle="Secure governance — meetings, packets, resolutions, voting, and financial oversight">
      {ov && (
        <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
          <KpiCard label="Upcoming Meetings" value={ov.upcomingMeetings ?? 0} icon={Calendar} variant="gold" />
          <KpiCard label="Open Action Items" value={ov.openActionsCount ?? 0} icon={CheckCircle} />
          <KpiCard label="Pending Resolutions" value={ov.pendingResolutions ?? 0} icon={Vote} />
          <KpiCard label="Board Packets" value={(packets.data?.packets ?? []).length} icon={FileText} />
        </div>
      )}

      <nav className="hq-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`hq-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </nav>

      <div className="hq-tab-content hq-fade-in">
        {tab === "overview" && (
          overview.isLoading ? <HqLoading /> : (
            <div className="hq-grid-2">
              <HqPanel title="Upcoming Meetings">
                <ul className="hq-activity-list">
                  {((meetings.data?.meetings ?? overview.data?.meetings ?? []) as { id: string; title: string; meeting_date: string; status: string }[]).slice(0, 5).map((m) => (
                    <li key={m.id} className="hq-activity-item">
                      <div className="hq-activity-content"><div className="hq-activity-title">{m.title}</div><div className="hq-activity-detail">{fmtDate(m.meeting_date)}</div></div>
                      <StatusBadge label={m.status} variant="gold" />
                    </li>
                  ))}
                </ul>
              </HqPanel>
              <HqPanel title="Executive Summary" subtitle="Board governance package">
                {governance.data ? (
                  <>
                    <p style={{ fontSize: "0.85rem", lineHeight: 1.6, color: "var(--hq-text-muted)" }}>
                      {String((governance.data as { trendAnalysis?: string }).trendAnalysis ?? "Governance package ready for review.")}
                    </p>
                    <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" style={{ marginTop: "0.75rem" }}
                      onClick={() => governance.data && downloadReportJson(governance.data, "ifcdc-board-governance-package.json")}>
                      <Download size={14} /> Download Package
                    </button>
                  </>
                ) : <HqLoading />}
              </HqPanel>
            </div>
          )
        )}

        {tab === "meetings" && (
          <>
            <HqPanel title="Schedule Board Meeting">
              <div className="hq-form-grid">
                <label>Title<input className="hq-input" value={meetingForm.title} onChange={(e) => setMeetingForm({ ...meetingForm, title: e.target.value })} /></label>
                <label>Date<input className="hq-input" type="datetime-local" value={meetingForm.meeting_date} onChange={(e) => setMeetingForm({ ...meetingForm, meeting_date: e.target.value })} /></label>
                <label>Location<input className="hq-input" value={meetingForm.location} onChange={(e) => setMeetingForm({ ...meetingForm, location: e.target.value })} /></label>
                <label style={{ gridColumn: "1 / -1" }}>Agenda<textarea className="hq-input" rows={4} value={meetingForm.agenda} onChange={(e) => setMeetingForm({ ...meetingForm, agenda: e.target.value })} /></label>
              </div>
              <button type="button" className="hq-btn hq-btn-primary" style={{ marginTop: "0.75rem" }} disabled={!meetingForm.title || !meetingForm.meeting_date || createMeeting.isPending} onClick={() => createMeeting.mutate()}>
                <Plus size={16} /> Schedule Meeting
              </button>
            </HqPanel>
            <div style={{ marginTop: "1rem" }}>
              <HqPanel title="Board Meetings & Minutes">
                <table className="hq-table">
                  <thead><tr><th>Meeting</th><th>Date</th><th>Status</th><th>Minutes</th></tr></thead>
                  <tbody>
                    {(meetings.data?.meetings ?? []).map((m) => (
                      <tr key={m.id as string}>
                        <td><strong>{m.title as string}</strong><div className="hq-muted-text">{(m.location as string) ?? ""}</div></td>
                        <td>{fmtDate(m.meeting_date as string)}</td>
                        <td><StatusBadge label={m.status as string} variant="gold" /></td>
                        <td style={{ fontSize: "0.78rem", maxWidth: 240 }}>{((m.minutes as string) ?? "Draft pending").slice(0, 80)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HqPanel>
            </div>
          </>
        )}

        {tab === "packets" && (
          <>
            <HqPanel title="Create Board Packet">
              <div className="hq-form-grid">
                <label>Title<input className="hq-input" value={packetForm.title} onChange={(e) => setPacketForm({ ...packetForm, title: e.target.value })} /></label>
                <label>Meeting ID (optional)<input className="hq-input" value={packetForm.meeting_id} onChange={(e) => setPacketForm({ ...packetForm, meeting_id: e.target.value })} /></label>
                <label style={{ gridColumn: "1 / -1" }}>Description<textarea className="hq-input" rows={3} value={packetForm.description} onChange={(e) => setPacketForm({ ...packetForm, description: e.target.value })} /></label>
              </div>
              <button type="button" className="hq-btn hq-btn-primary" style={{ marginTop: "0.75rem" }} disabled={!packetForm.title || createPacket.isPending} onClick={() => createPacket.mutate()}>Create Packet</button>
            </HqPanel>
            <div style={{ marginTop: "1rem" }}>
              <HqPanel title="Board Packets">
                {(packets.data?.packets ?? []).map((p) => (
                  <div key={p.id as string} className="hq-activity-item" style={{ marginBottom: "0.75rem" }}>
                    <div style={{ flex: 1 }}>
                      <strong>{p.title as string}</strong>
                      <div className="hq-muted-text"><StatusBadge label={p.status as string} variant={p.status === "published" ? "success" : "muted"} /></div>
                    </div>
                    {p.status !== "published" && (
                      <button type="button" className="hq-btn hq-btn-sm" onClick={() => publishPacket.mutate(p.id as string)}>Publish</button>
                    )}
                  </div>
                ))}
              </HqPanel>
            </div>
          </>
        )}

        {tab === "resolutions" && (
          <>
            <HqPanel title="Propose Resolution">
              <div className="hq-form-grid">
                <label>Title<input className="hq-input" value={resolutionForm.title} onChange={(e) => setResolutionForm({ ...resolutionForm, title: e.target.value })} /></label>
                <label style={{ gridColumn: "1 / -1" }}>Resolution Text<textarea className="hq-input" rows={4} value={resolutionForm.resolution_text} onChange={(e) => setResolutionForm({ ...resolutionForm, resolution_text: e.target.value })} /></label>
              </div>
              <button type="button" className="hq-btn hq-btn-primary" style={{ marginTop: "0.75rem" }} disabled={!resolutionForm.title || createResolution.isPending} onClick={() => createResolution.mutate()}>Propose Resolution</button>
            </HqPanel>
            <div style={{ marginTop: "1rem" }}>
              <HqPanel title="Resolutions & Voting">
              {(resolutions.data?.resolutions ?? []).map((r) => (
                <div key={r.id as string} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0.75rem 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <strong>{r.title as string}</strong>
                      <div className="hq-muted-text" style={{ marginTop: "0.25rem" }}>{(r.resolution_text as string)?.slice(0, 120)}</div>
                      <div style={{ marginTop: "0.35rem", fontSize: "0.78rem" }}>
                        For: {r.votes_for as number} · Against: {r.votes_against as number} · Abstain: {r.votes_abstain as number}
                      </div>
                    </div>
                    <StatusBadge label={r.status as string} variant={r.status === "adopted" ? "success" : "gold"} />
                  </div>
                  {(r.status === "proposed" || r.status === "voting") && (
                    <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.5rem" }}>
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => castVote.mutate({ id: r.id as string, vote: "yes" })}>Yes</button>
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => castVote.mutate({ id: r.id as string, vote: "no" })}>No</button>
                      <button type="button" className="hq-btn hq-btn-sm" onClick={() => castVote.mutate({ id: r.id as string, vote: "abstain" })}>Abstain</button>
                      <button type="button" className="hq-btn hq-btn-sm" onClick={() => finalize.mutate(r.id as string)}>Finalize</button>
                    </div>
                  )}
                </div>
              ))}
            </HqPanel>
            </div>
          </>
        )}

        {tab === "financial" && (
          financial.isLoading ? <HqLoading /> : (
            <HqPanel title={(financial.data?.title as string) ?? "Board Financial Report"}>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.85rem", lineHeight: 1.65, color: "var(--hq-text-muted)" }}>
                {JSON.stringify(financial.data?.executiveSummary ?? financial.data, null, 2).slice(0, 4000)}
              </pre>
              <button type="button" className="hq-btn hq-btn-secondary" style={{ marginTop: "1rem" }} onClick={() => financial.data && downloadReportJson(financial.data, "ifcdc-board-financial-report.json")}>
                <Download size={14} /> Download Report
              </button>
            </HqPanel>
          )
        )}

        {tab === "documents" && (
          documents.isLoading ? <HqLoading /> : (
            <HqPanel title="Board-Secure Documents" subtitle="Access level: board only" action={{ label: "Enterprise Vault", to: "/hq/documents?category=board_records" }}>
              <table className="hq-table">
                <thead><tr><th>Document</th><th>Category</th><th>Updated</th></tr></thead>
                <tbody>
                  {(documents.data?.documents ?? []).map((d) => (
                    <tr key={d.id as string}>
                      <td><strong>{d.title as string}</strong></td>
                      <td>{d.category as string}</td>
                      <td>{fmtDate(d.updated_at as string)}</td>
                    </tr>
                  ))}
                  {!(documents.data?.documents ?? []).length && (
                    <tr><td colSpan={3} className="hq-empty-cell">Upload documents with board access level in Document Management — <Link to="/hq/documents?category=board_records">open vault</Link></td></tr>
                  )}
                </tbody>
              </table>
            </HqPanel>
          )
        )}
      </div>
    </HQLayout>
  );
};

export default BoardPortalPage;
