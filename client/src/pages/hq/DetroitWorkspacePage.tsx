import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, Plus, Sparkles } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { HqPanel } from "../../components/hq/HqPanel";
import { grantsApi, type GrantApplication, type GrantOpportunity } from "../../api/grantsApi";
import {
  DETROIT_AURA_LIVE_SEARCH,
  DETROIT_FIELDS,
  DETROIT_STATUSES,
  DETROIT_TYPE_LABELS,
  DETROIT_RECORD_TYPES,
  DETROIT_VERIFICATION,
  UNKNOWN_UNTIL_VERIFIED,
  extractDetroitDrafts,
  grantCenterResearchPayload,
  isDetroitRelatedGrant,
  type DetroitDraft,
  type DetroitPublicRecord,
  type DetroitRecordType,
} from "@shared/detroitWorkspace";

const SITE_URL = "https://detroit-land-bank-workspace.aglowmockingbird5.chatgpt.site";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/hq/detroit-workspace${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "Detroit workspace request failed");
  return data as T;
}

const emptyPayload = (type: DetroitRecordType): Record<string, string> =>
  Object.fromEntries(DETROIT_FIELDS[type].map((field) => [field.key, field.kind === "select" ? UNKNOWN_UNTIL_VERIFIED : ""]));

const DetroitWorkspacePage: React.FC = () => {
  const [activeType, setActiveType] = useState<DetroitRecordType>("property");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("Researching");
  const [verification, setVerification] = useState(UNKNOWN_UNTIL_VERIFIED);
  const [source, setSource] = useState("");
  const [payload, setPayload] = useState<Record<string, string>>(() => emptyPayload("property"));
  const [message, setMessage] = useState("");
  const [importText, setImportText] = useState("");
  const [importReport, setImportReport] = useState("");
  const client = useQueryClient();
  const records = useQuery({
    queryKey: ["detroit-workspace-records"],
    queryFn: () => api<{ records: DetroitPublicRecord[] }>("/records"),
    staleTime: 30_000,
  });
  const opportunities = useQuery({
    queryKey: ["detroit-grant-opportunities"],
    queryFn: grantsApi.opportunities,
    staleTime: 60_000,
  });
  const applications = useQuery({
    queryKey: ["detroit-grant-applications"],
    queryFn: grantsApi.applications,
    staleTime: 60_000,
  });
  const livePreview = useQuery({
    queryKey: ["detroit-discovery-preview"],
    queryFn: () => grantsApi.discoveryPreview("detroit_initiative"),
    staleTime: 120_000,
  });

  const resetForm = (type = activeType) => {
    setEditingId(null);
    setTitle("");
    setStatus("Researching");
    setVerification(UNKNOWN_UNTIL_VERIFIED);
    setSource("");
    setPayload(emptyPayload(type));
  };

  const selectType = (type: DetroitRecordType) => {
    setActiveType(type);
    resetForm(type);
    setMessage("");
  };

  const beginEdit = (record: DetroitPublicRecord) => {
    setActiveType(record.type);
    setEditingId(record.id);
    setTitle(record.title);
    setStatus(record.status);
    setVerification(record.verificationStatus);
    setSource(record.sourceUrl ?? "");
    setPayload({ ...emptyPayload(record.type), ...record.payload });
    setMessage(`Editing ${record.title}`);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        type: activeType,
        title,
        status,
        verificationStatus: verification,
        sourceUrl: source || null,
        payload,
      };
      return editingId
        ? api<{ record: DetroitPublicRecord }>(`/records/${editingId}`, { method: "PATCH", body: JSON.stringify(body) })
        : api<{ record: DetroitPublicRecord }>("/records", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: async () => {
      resetForm();
      setMessage(editingId ? "Updated on the shared HQ workspace." : "Saved to the shared HQ workspace.");
      await client.invalidateQueries({ queryKey: ["detroit-workspace-records"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Save failed."),
  });

  const importRecords = useMutation({
    mutationFn: (drafts: DetroitDraft[]) =>
      api<{ imported: number; skippedDuplicates: number; invalid: number; skippedTitles: string[]; invalidReasons: string[] }>(
        "/records/import",
        { method: "POST", body: JSON.stringify({ source: "detroit-site-export", records: drafts }) },
      ),
    onSuccess: async (result) => {
      setImportReport(
        result.imported || result.skippedDuplicates || result.invalid
          ? `Imported ${result.imported}. Skipped ${result.skippedDuplicates} duplicate(s) without overwriting. Invalid ${result.invalid}.`
          : "No new records were imported. HQ was not overwritten.",
      );
      await client.invalidateQueries({ queryKey: ["detroit-workspace-records"] });
    },
    onError: (error) => setImportReport(error instanceof Error ? error.message : "Import failed."),
  });

  const saveToGrantCenter = useMutation({
    mutationFn: async (record: DetroitPublicRecord) => {
      const research = grantCenterResearchPayload(record);
      if (!research) throw new Error("Add a funder before saving this research item to Grant Center.");
      return grantsApi.createOpportunity(research);
    },
    onSuccess: async () => {
      setMessage("Saved as Grant Center research. Eligibility stays Unknown until verified. Aura is not running a live search.");
      await client.invalidateQueries({ queryKey: ["detroit-grant-opportunities"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Grant Center save failed."),
  });

  const filtered = (records.data?.records ?? []).filter((record) => record.type === activeType);
  const typeLabel = DETROIT_TYPE_LABELS[activeType];
  const detroitGrants = useMemo(
    () => (opportunities.data?.opportunities ?? []).filter(isDetroitRelatedGrant),
    [opportunities.data],
  );
  const detroitApps = useMemo(() => {
    const ids = new Set(detroitGrants.map((item) => item.id));
    return (applications.data?.applications ?? []).filter((item: GrantApplication) =>
      (item.opportunity_id && ids.has(item.opportunity_id)) || /detroit|dlba|land bank/i.test(`${item.title} ${item.notes}`),
    );
  }, [applications.data, detroitGrants]);

  const importPasted = () => {
    try {
      const drafts = extractDetroitDrafts(JSON.parse(importText));
      if (!drafts.length) {
        setImportReport("The pasted JSON did not contain Detroit records. Nothing was discarded or overwritten.");
        return;
      }
      importRecords.mutate(drafts);
    } catch {
      setImportReport("Paste valid JSON exported from the Site. HQ records were not changed.");
    }
  };

  const fields = DETROIT_FIELDS[activeType];

  useEffect(() => {
    document.body.classList.add("detroit-workspace-page");
    return () => document.body.classList.remove("detroit-workspace-page");
  }, []);

  return (
    <HQLayout
      title="Detroit Property & Program"
      subtitle="One shared operating workspace for property, grant, and program planning"
      auraModule="programs"
      auraActions={["ask", "find_funding", "summarize", "prepare_approval", "explain"]}
    >
      <div className="detroit-workspace" style={{ display: "grid", gap: "1rem" }}>
        <HqPanel title="Build the Detroit opportunity at full scale" subtitle="Concept stage · HQ is the source of truth across phone, tablet, and desktop">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: ".8rem" }}>
            {[
              ["1 · Secure a site", "Compare DLBA lots, ownership, eligibility, restrictions, and site readiness. Keep every unverified detail labeled."],
              ["2 · Design a flagship program", "Potential IFCDC-aligned tracks: youth mentorship and violence prevention, workforce and barber training, transitional housing, media and arts, and wellness navigation."],
              ["3 · Build a funding stack", "Match each eligible cost in Grant Center. Separate site control, capital work, and ongoing services. Amounts stay Unknown until verified."],
            ].map(([heading, body]) => (
              <div key={heading} style={{ border: "1px solid var(--hq-border, #2d3748)", borderRadius: 12, padding: "1rem" }}>
                <strong>{heading}</strong>
                <p className="hq-muted-text" style={{ marginBottom: 0 }}>{body}</p>
              </div>
            ))}
          </div>
          <p className="hq-muted-text" style={{ margin: "1rem 0 0" }}>
            <Sparkles size={14} style={{ verticalAlign: "middle" }} /> Working concept only. No site, scope, budget, grant eligibility, or partner has been confirmed.
            {DETROIT_AURA_LIVE_SEARCH ? "" : " Use Find Funding so Aura searches official feeds into Grant Center. This page still does not scrape DLBA."}
          </p>
          <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", marginTop: "1rem" }}>
            <Link className="hq-btn hq-btn-primary hq-btn-sm" to="/hq/grants?tab=discover">Open Grant Center</Link>
            <Link className="hq-btn hq-btn-ghost hq-btn-sm" to="/hq/grants?tab=applications">Grant applications</Link>
            <a className="hq-btn hq-btn-ghost hq-btn-sm" href={SITE_URL} target="_blank" rel="noreferrer">
              Legacy research Site <ExternalLink size={14} />
            </a>
          </div>
        </HqPanel>

        <HqPanel title="Shared records" subtitle={`${typeLabel} · create, view, and edit on any signed-in HQ device`}>
          <div role="tablist" aria-label="Detroit work areas" className="hq-sub-nav detroit-workspace-tabs">
            {DETROIT_RECORD_TYPES.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activeType === key}
                className={`hq-btn hq-btn-sm ${activeType === key ? "hq-btn-primary" : "hq-btn-ghost"}`}
                onClick={() => selectType(key)}
              >
                {DETROIT_TYPE_LABELS[key]}
              </button>
            ))}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              setMessage("");
              save.mutate();
            }}
            className="hq-form-grid"
            style={{ padding: "1rem", borderRadius: 12, background: "var(--hq-surface-2, rgba(255,255,255,.035))", marginBottom: "1rem" }}
          >
            <label>Record name
              <input className="hq-input" required maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={activeType === "property" ? "Address or listing label" : `New ${typeLabel.toLowerCase()} item`} />
            </label>
            <label>Status
              <select className="hq-input" value={status} onChange={(event) => setStatus(event.target.value)}>
                {DETROIT_STATUSES.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label>Verification
              <select className="hq-input" value={verification} onChange={(event) => setVerification(event.target.value)}>
                {DETROIT_VERIFICATION.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label>Official source URL
              <input className="hq-input" type="url" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Add a source when available" />
            </label>
            {fields.map((field) => (
              <label key={field.key} style={field.kind === "textarea" ? { gridColumn: "1 / -1" } : undefined}>
                {field.label}
                {field.kind === "textarea" ? (
                  <textarea className="hq-input hq-textarea" rows={3} value={payload[field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setPayload((current) => ({ ...current, [field.key]: event.target.value }))} />
                ) : field.kind === "select" ? (
                  <select className="hq-input" value={payload[field.key] || UNKNOWN_UNTIL_VERIFIED} onChange={(event) => setPayload((current) => ({ ...current, [field.key]: event.target.value }))}>
                    {(field.options ?? []).map((option) => <option key={option}>{option}</option>)}
                  </select>
                ) : (
                  <input className="hq-input" type={field.kind === "date" ? "date" : field.kind === "url" ? "url" : "text"} value={payload[field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setPayload((current) => ({ ...current, [field.key]: event.target.value }))} />
                )}
              </label>
            ))}
            <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "end" }}>
              <button className="hq-btn hq-btn-primary hq-btn-sm" type="submit" disabled={save.isPending}>
                <Plus size={14} /> {save.isPending ? "Saving…" : editingId ? "Update shared record" : "Save shared record"}
              </button>
              {editingId && (
                <button className="hq-btn hq-btn-ghost hq-btn-sm" type="button" onClick={() => { resetForm(); setMessage("Edit cancelled. Existing HQ records were not changed."); }}>
                  Cancel edit
                </button>
              )}
            </div>
          </form>
          {message && <p role="status" className="hq-muted-text">{message}</p>}
          {records.isLoading ? <p className="hq-muted-text">Loading shared records…</p>
            : records.isError ? <p role="alert">{records.error instanceof Error ? records.error.message : "Could not load HQ records."}</p>
            : filtered.length ? (
              <div style={{ display: "grid", gap: ".65rem" }}>
                {filtered.map((record) => (
                  <article key={record.id} style={{ border: "1px solid var(--hq-border, #2d3748)", borderRadius: 12, padding: ".9rem 1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: ".8rem", flexWrap: "wrap", alignItems: "flex-start" }}>
                      <strong>{record.title}</strong>
                      <span className="hq-muted-text">{record.status} · {record.verificationStatus}</span>
                    </div>
                    <dl style={{ display: "grid", gap: ".35rem", margin: ".65rem 0 0" }}>
                      {DETROIT_FIELDS[record.type].map((field) => record.payload[field.key] ? (
                        <div key={field.key}>
                          <dt className="hq-muted-text" style={{ fontSize: ".75rem" }}>{field.label}</dt>
                          <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{record.payload[field.key]}</dd>
                        </div>
                      ) : null)}
                    </dl>
                    {record.sourceUrl && (
                      <a href={record.sourceUrl} target="_blank" rel="noreferrer">Official source <ExternalLink size={12} /></a>
                    )}
                    <small className="hq-muted-text" style={{ display: "block", marginTop: ".5rem" }}>Updated {new Date(record.updatedAt).toLocaleString()}</small>
                    <div style={{ display: "flex", gap: ".45rem", flexWrap: "wrap", marginTop: ".65rem" }}>
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={() => beginEdit(record)}>
                        <Pencil size={14} /> Edit
                      </button>
                      {record.type === "application" && (
                        <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={() => saveToGrantCenter.mutate(record)} disabled={saveToGrantCenter.isPending}>
                          Save research to Grant Center
                        </button>
                      )}
                      {record.payload.grantCenterOpportunityId && (
                        <Link className="hq-btn hq-btn-sm hq-btn-ghost" to={`/hq/grants?tab=discover`}>Open linked Grant Center item</Link>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="hq-muted-text">No {typeLabel.toLowerCase()} saved yet. Keep missing facts marked Unknown; do not fill them by assumption.</p>}
        </HqPanel>

        <HqPanel title="Grant Center connection" subtitle="Uses existing HQ Grant Center records. Eligibility and availability stay Unknown until verified.">
          <p className="hq-muted-text">
            This page reads the signed-in Grant Center catalog. Aura Find Funding writes Detroit research into that same store. It does not invent awards or amounts, scrape DLBA, or contact the Detroit Land Bank.
          </p>
          {opportunities.isError ? <p role="alert">Grant Center catalog could not be loaded with this HQ session.</p>
            : opportunities.isLoading ? <p className="hq-muted-text">Loading Grant Center catalog…</p>
            : detroitGrants.length ? (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: ".65rem" }}>
                {detroitGrants.map((grant: GrantOpportunity) => (
                  <li key={grant.id} style={{ border: "1px solid var(--hq-border, #2d3748)", borderRadius: 12, padding: ".8rem 1rem" }}>
                    <strong>{grant.title}</strong>
                    <p className="hq-muted-text" style={{ margin: ".3rem 0" }}>{grant.funder} · eligibility {grant.eligibility || UNKNOWN_UNTIL_VERIFIED}</p>
                    {grant.url && <a href={grant.url} target="_blank" rel="noreferrer">Source <ExternalLink size={12} /></a>}
                  </li>
                ))}
              </ul>
            ) : <p className="hq-muted-text">No Detroit / Michigan / DLBA matches are in Grant Center yet. Add research from the Applications work area after a funder name is known.</p>}
          {detroitApps.length > 0 && (
            <p className="hq-muted-text" style={{ marginTop: "1rem" }}>{detroitApps.length} Grant Center application(s) mention Detroit-related work. Open them in Grant Center to continue writing — this page does not submit applications.</p>
          )}
          <h3 style={{ marginTop: "1.25rem" }}>Read-only Grants.gov / ProPublica preview</h3>
          <p className="hq-muted-text">
            This preview calls official APIs from Grant Center. It does not write HQ records and does not contact the Detroit Land Bank.
            {DETROIT_AURA_LIVE_SEARCH ? "" : " The Detroit workspace itself still does not scrape DLBA listings."}
          </p>
          {livePreview.isLoading ? <p className="hq-muted-text">Checking official feeds…</p>
            : livePreview.isError ? <p role="alert">Official feed preview unavailable.</p>
            : (livePreview.data?.opportunities ?? []).length ? (
              <ul style={{ listStyle: "none", padding: 0 }}>
                {(livePreview.data.opportunities as { title: string; funder: string; source: string; dateChecked: string; deadline: string; officialLink: string; eligibilityEvidence: string }[]).slice(0, 12).map((item) => (
                  <li key={`${item.officialLink}-${item.title}`} style={{ marginBottom: ".6rem" }}>
                    <strong>{item.title}</strong>
                    <div className="hq-muted-text">{item.funder} · {item.source} · checked {item.dateChecked} · deadline {item.deadline}</div>
                    <div className="hq-muted-text">{item.eligibilityEvidence}</div>
                    {item.officialLink && item.officialLink !== "Unknown" && <a href={item.officialLink} target="_blank" rel="noreferrer">Official source <ExternalLink size={12} /></a>}
                  </li>
                ))}
              </ul>
            ) : <p className="hq-muted-text">No current Detroit/Michigan keyword hits. Results stay Unknown until an official listing is checked.</p>}
        </HqPanel>

        <HqPanel title="Legacy Site import" subtitle="Non-destructive. HQ records are never overwritten or discarded.">
          <p className="hq-muted-text">
            The former ChatGPT Site is a different origin, so HQ cannot read its browser storage. Export a backup from the Detroit Site, then paste that JSON here. Import is additive: duplicates are skipped, and existing HQ records are never overwritten or discarded.
          </p>
          <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={importPasted} disabled={importRecords.isPending}>
            Import pasted JSON
          </button>
          <label style={{ display: "block", marginTop: ".8rem" }}>
            Site export JSON
            <textarea className="hq-input hq-textarea" rows={4} value={importText} onChange={(event) => setImportText(event.target.value)} placeholder='{"records":[]}' />
          </label>
          {importReport && <p role="status" className="hq-muted-text">{importReport}</p>}
        </HqPanel>

        <HqPanel title="Submission and spending gate" subtitle="Founder review required before external commitments">
          <p className="hq-muted-text" style={{ margin: 0 }}>
            Aura can help draft plans and checklists inside HQ. Submitting applications, contacting the Land Bank or grantors, purchasing property, and committing funds remain behind your explicit approval.
          </p>
        </HqPanel>
      </div>
    </HQLayout>
  );
};

export default DetroitWorkspacePage;
