import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Sparkles } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { HqPanel } from "../../components/hq/HqPanel";

const SITE_URL = "https://detroit-land-bank-workspace.aglowmockingbird5.chatgpt.site";
const TYPES = [
  ["property", "Available properties"], ["checklist", "Eligibility & checklist"], ["comparison", "Lot comparison"],
  ["site_note", "Site notes"], ["work_plan", "Work plans"], ["budget", "Budget estimates"],
  ["contact", "Contacts"], ["application", "Applications"], ["follow_up", "Follow-ups"],
] as const;
type RecordType = (typeof TYPES)[number][0];
type WorkspaceRecord = { id: string; type: RecordType; title: string; status: string; verificationStatus: string; sourceUrl?: string; payload: Record<string, string>; updatedAt: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/hq/detroit-workspace${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Detroit workspace request failed");
  return data as T;
}

const DetroitWorkspacePage: React.FC = () => {
  const [activeType, setActiveType] = useState<RecordType>("property");
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState("Researching");
  const [verification, setVerification] = useState("Unknown");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const client = useQueryClient();
  const records = useQuery({ queryKey: ["detroit-workspace-records"], queryFn: () => api<{ records: WorkspaceRecord[] }>("/records"), staleTime: 30_000 });
  const create = useMutation({
    mutationFn: () => api("/records", { method: "POST", body: JSON.stringify({ type: activeType, title, status, verificationStatus: verification, sourceUrl: source || null, payload: { address, notes } }) }),
    onSuccess: async () => { setTitle(""); setAddress(""); setSource(""); setNotes(""); setMessage("Saved to the shared HQ workspace."); await client.invalidateQueries({ queryKey: ["detroit-workspace-records"] }); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Save failed."),
  });
  const filtered = (records.data?.records ?? []).filter((record) => record.type === activeType);
  const typeLabel = TYPES.find(([key]) => key === activeType)?.[1] ?? "Workspace records";

  return <HQLayout title="Detroit Property & Program" subtitle="One shared operating workspace for property, grant, and program planning" auraModule="programs" auraActions={["ask", "summarize", "prepare_approval", "explain"]}>
    <div style={{ display: "grid", gap: "1rem" }}>
      <HqPanel title="Build the Detroit opportunity at full scale" subtitle="Concept stage · property control, community programs, and grant funding are tracked as separate workstreams">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: ".8rem" }}>
          {[
            ["1 · Secure a site", "Compare DLBA lots, ownership, eligibility, restrictions, and site readiness. Keep every unverified detail labeled."],
            ["2 · Design a flagship program", "Potential IFCDC-aligned tracks: youth mentorship and violence prevention, workforce and barber training, transitional housing, media and arts, and wellness navigation."],
            ["3 · Build a funding stack", "Match each eligible cost to an appropriate public or private funder. Separate site control, capital work, and ongoing services."],
          ].map(([heading, body]) => <div key={heading} style={{ border: "1px solid var(--hq-border, #2d3748)", borderRadius: 12, padding: "1rem" }}><strong>{heading}</strong><p className="hq-muted-text" style={{ marginBottom: 0 }}>{body}</p></div>)}
        </div>
        <p className="hq-muted-text" style={{ margin: "1rem 0 0" }}><Sparkles size={14} style={{ verticalAlign: "middle" }} /> Working concept only. No site, scope, budget, grant eligibility, or partner has been confirmed.</p>
        <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", marginTop: "1rem" }}>
          <a className="hq-btn hq-btn-primary hq-btn-sm" href="/hq/grants">Open Grant Center <ExternalLink size={14} /></a>
          <a className="hq-btn hq-btn-ghost hq-btn-sm" href={SITE_URL} target="_blank" rel="noreferrer">Open property research Site <ExternalLink size={14} /></a>
        </div>
      </HqPanel>

      <HqPanel title="Shared records" subtitle="Changes here are saved to HQ, so they are available on your Mac, Dell, phone, and tablet">
        <div style={{ display: "flex", gap: ".45rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          {TYPES.map(([key, label]) => <button key={key} type="button" className={`hq-btn hq-btn-sm ${activeType === key ? "hq-btn-primary" : "hq-btn-ghost"}`} onClick={() => setActiveType(key)}>{label}</button>)}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); setMessage(""); create.mutate(); }} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: ".65rem", alignItems: "end", padding: "1rem", borderRadius: 12, background: "var(--hq-surface-2, rgba(255,255,255,.035))", marginBottom: "1rem" }}>
          <label>Record name<input required maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={activeType === "property" ? "Address or listing label" : `New ${typeLabel.toLowerCase()} item`} /></label>
          <label>Address / related property<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Leave blank until known" /></label>
          <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>{["Researching", "Needs verification", "Draft", "Ready for review", "In progress", "Waiting", "Complete"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Verification<select value={verification} onChange={(event) => setVerification(event.target.value)}>{["Unknown", "Unverified", "Official source checked", "Confirmed by source"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Official source URL<input type="url" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Add a source when available" /></label>
          <label>Notes / next step<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Unknowns and next action" /></label>
          <button className="hq-btn hq-btn-primary hq-btn-sm" type="submit" disabled={create.isPending}><Plus size={14} /> {create.isPending ? "Saving…" : "Save shared record"}</button>
        </form>
        {message && <p role="status" className="hq-muted-text">{message}</p>}
        {records.isLoading ? <p className="hq-muted-text">Loading shared records…</p> : records.isError ? <p role="alert">{records.error instanceof Error ? records.error.message : "Could not load HQ records."}</p> : filtered.length ? <div style={{ display: "grid", gap: ".65rem" }}>{filtered.map((record) => <article key={record.id} style={{ border: "1px solid var(--hq-border, #2d3748)", borderRadius: 12, padding: ".9rem 1rem" }}><div style={{ display: "flex", justifyContent: "space-between", gap: ".8rem", flexWrap: "wrap" }}><strong>{record.title}</strong><span className="hq-muted-text">{record.status} · {record.verificationStatus}</span></div>{record.payload.address && <p style={{ margin: ".35rem 0" }}>{record.payload.address}</p>}{record.payload.notes && <p className="hq-muted-text" style={{ margin: ".35rem 0" }}>{record.payload.notes}</p>}{record.sourceUrl && <a href={record.sourceUrl} target="_blank" rel="noreferrer">Official source <ExternalLink size={12} /></a>}<small className="hq-muted-text" style={{ display: "block", marginTop: ".5rem" }}>Updated {new Date(record.updatedAt).toLocaleString()}</small></article>)}</div> : <p className="hq-muted-text">No {typeLabel.toLowerCase()} saved yet. Keep missing facts marked Unknown; do not fill them by assumption.</p>}
      </HqPanel>
      <HqPanel title="Submission and spending gate" subtitle="Founder review required before external commitments">
        <p className="hq-muted-text" style={{ margin: 0 }}>Aura can research opportunities, draft plans, assemble checklists, and prepare application materials. Submitting applications, contacting the Land Bank or grantors, purchasing property, and committing funds remain behind your explicit approval.</p>
      </HqPanel>
    </div>
  </HQLayout>;
};

export default DetroitWorkspacePage;
