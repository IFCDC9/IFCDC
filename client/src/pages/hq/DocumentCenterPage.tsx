import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Search, Plus, History, FileText, Check, X, PenLine, ScanText } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { documentsApi, type HQDocument } from "../../api/documentsApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";

const CATEGORIES = ["general", "contract", "policy", "board", "personnel", "grant", "financial"];

const DocumentCenterPage: React.FC = () => {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<HQDocument | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showVersion, setShowVersion] = useState(false);
  const [newDoc, setNewDoc] = useState({ title: "", category: "general", file_url: "", access_level: "internal" });
  const [versionForm, setVersionForm] = useState({ file_url: "", change_notes: "" });
  const [ocrText, setOcrText] = useState("");
  const [showOcr, setShowOcr] = useState(false);
  const qc = useQueryClient();

  const overview = useQuery({ queryKey: ["docs-overview"], queryFn: documentsApi.overview });
  const list = useQuery({
    queryKey: ["docs-list", search, category],
    queryFn: () => documentsApi.list({ q: search || undefined, category: category || undefined }),
  });
  const detail = useQuery({
    queryKey: ["docs-detail", selected?.id],
    queryFn: () => documentsApi.get(selected!.id),
    enabled: !!selected,
  });

  const createDoc = useMutation({
    mutationFn: documentsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs-list"] });
      qc.invalidateQueries({ queryKey: ["docs-overview"] });
      setShowAdd(false);
      setNewDoc({ title: "", category: "general", file_url: "", access_level: "internal" });
    },
  });

  const addVersion = useMutation({
    mutationFn: () => documentsApi.addVersion(selected!.id, versionForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs-detail", selected?.id] });
      qc.invalidateQueries({ queryKey: ["docs-list"] });
      setShowVersion(false);
      setVersionForm({ file_url: "", change_notes: "" });
    },
  });

  const reviewDoc = useMutation({
    mutationFn: (action: "approve" | "reject") => documentsApi.review(selected!.id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs-detail", selected?.id] });
      qc.invalidateQueries({ queryKey: ["docs-list"] });
      qc.invalidateQueries({ queryKey: ["hq-approval-tasks"] });
    },
  });

  const ocrIndex = useMutation({
    mutationFn: () => documentsApi.ocrIndex(selected!.id, ocrText),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs-detail", selected?.id] });
      setShowOcr(false);
      setOcrText("");
    },
  });

  const signDoc = useMutation({
    mutationFn: () => documentsApi.sign(selected!.id, `signed:${selected!.id}:${Date.now()}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docs-detail", selected?.id] }),
  });

  return (
    <HQLayout title="Document Center" subtitle="Secure vault — version history, electronic approvals, digital signatures, and OCR search">
      {overview.data && (
        <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
          <KpiCard label="Total Documents" value={overview.data.total} icon={FolderOpen} variant="gold" />
          {(overview.data.byCategory ?? []).slice(0, 3).map((c) => (
            <KpiCard key={c.category} label={c.category} value={c.count} icon={FileText} />
          ))}
        </div>
      )}

      <div className="hq-people-toolbar">
        <div className="hq-search-bar">
          <Search size={18} />
          <input type="search" placeholder="Search documents (title, category, OCR text)…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="hq-input" style={{ width: "auto" }}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" className="hq-btn hq-btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Upload Document
        </button>
      </div>

      <div className="hq-grid-main-side hq-fade-in" style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Document Library">
          {list.isLoading ? <HqLoading /> : (
            <table className="hq-table">
              <thead><tr><th>Title</th><th>Category</th><th>Version</th><th>Access</th><th>Approval</th><th>Updated</th></tr></thead>
              <tbody>
                {(list.data?.documents ?? []).map((d) => (
                  <tr key={d.id} className={`hq-clickable ${selected?.id === d.id ? "active" : ""}`} onClick={() => setSelected(d)}>
                    <td>{d.title}</td>
                    <td><StatusBadge label={d.category} variant="gold" /></td>
                    <td>v{d.version}</td>
                    <td>{d.access_level}</td>
                    <td><StatusBadge label={d.approval_status ?? "approved"} variant={d.approval_status === "pending" ? "warning" : d.approval_status === "rejected" ? "danger" : "success"} /></td>
                    <td>{new Date(d.updated_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {!list.data?.documents?.length && (
                  <tr><td colSpan={6} className="hq-empty-cell">No documents — upload your first file</td></tr>
                )}
              </tbody>
            </table>
          )}
        </HqPanel>

        <div>
          {selected ? (
            detail.isLoading ? <HqLoading /> : detail.data && (
              <>
                <HqPanel
                  title={detail.data.document.title}
                  subtitle={`Version ${detail.data.document.version} · ${detail.data.document.category}`}
                  headerExtra={
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {detail.data.document.approval_status === "pending" && (
                        <>
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" disabled={reviewDoc.isPending}
                            onClick={() => reviewDoc.mutate("approve")}><Check size={14} /> Approve</button>
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled={reviewDoc.isPending}
                            onClick={() => reviewDoc.mutate("reject")}><X size={14} /> Reject</button>
                        </>
                      )}
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => setShowVersion(true)}>
                        <History size={14} /> New Version
                      </button>
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={() => { setOcrText(detail.data.document.ocr_text ?? ""); setShowOcr(true); }}>
                        <ScanText size={14} /> OCR Index
                      </button>
                      {detail.data.document.signature_status !== "signed" && (
                        <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled={signDoc.isPending} onClick={() => signDoc.mutate()}>
                          <PenLine size={14} /> Sign
                        </button>
                      )}
                    </div>
                  }
                >
                  {detail.data.document.file_url && (
                    <a href={detail.data.document.file_url} target="_blank" rel="noopener noreferrer" className="hq-btn hq-btn-primary" style={{ marginBottom: "1rem" }}>
                      Open Current File
                    </a>
                  )}
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                    <StatusBadge label={`Signature: ${detail.data.document.signature_status ?? "unsigned"}`} variant={detail.data.document.signature_status === "signed" ? "success" : "muted"} />
                    {detail.data.document.signed_by && (
                      <span className="hq-muted-text" style={{ fontSize: "0.75rem" }}>
                        Signed by {detail.data.document.signed_by} · {detail.data.document.signed_at ? new Date(detail.data.document.signed_at).toLocaleDateString() : ""}
                      </span>
                    )}
                  </div>
                  {detail.data.document.ocr_text && (
                    <p className="hq-muted-text" style={{ fontSize: "0.78rem", marginBottom: "1rem" }}>
                      <strong>OCR indexed:</strong> {detail.data.document.ocr_text.slice(0, 200)}{detail.data.document.ocr_text.length > 200 ? "…" : ""}
                    </p>
                  )}
                  <h4 style={{ fontSize: "0.8rem", color: "var(--hq-text-dim)", marginBottom: "0.5rem" }}>Version History</h4>
                  <ul className="hq-activity-list">
                    {detail.data.versions.map((v) => (
                      <li key={v.id} className="hq-activity-item">
                        <div className="hq-activity-content">
                          <div className="hq-activity-title">v{v.version} — {v.title}</div>
                          <div className="hq-activity-detail">{v.change_notes} · {v.uploaded_by}</div>
                        </div>
                        <div className="hq-activity-time">{new Date(v.created_at).toLocaleDateString()}</div>
                      </li>
                    ))}
                  </ul>
                </HqPanel>
              </>
            )
          ) : (
            <HqPanel title="Select a document" subtitle="Click a row to view version history and download">
              <p className="hq-muted-text">Store contracts, policies, board minutes, personnel files, and grant documents in one secure vault.</p>
            </HqPanel>
          )}
        </div>
      </div>

      {showAdd && (
        <div className="hq-modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="hq-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Upload Document</h3>
            <div className="hq-form-grid">
              <label>Title<input value={newDoc.title} onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })} /></label>
              <label>Category
                <select value={newDoc.category} onChange={(e) => setNewDoc({ ...newDoc, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>File URL<input value={newDoc.file_url} onChange={(e) => setNewDoc({ ...newDoc, file_url: e.target.value })} placeholder="https://…" /></label>
              <label>Access Level
                <select value={newDoc.access_level} onChange={(e) => setNewDoc({ ...newDoc, access_level: e.target.value })}>
                  <option value="internal">Internal</option>
                  <option value="confidential">Confidential</option>
                  <option value="board">Board Only</option>
                </select>
              </label>
            </div>
            <div className="hq-modal-actions">
              <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button type="button" className="hq-btn hq-btn-primary" disabled={!newDoc.title || createDoc.isPending} onClick={() => createDoc.mutate(newDoc)}>
                {createDoc.isPending ? "Saving…" : "Save Document"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showVersion && selected && (
        <div className="hq-modal-overlay" onClick={() => setShowVersion(false)}>
          <div className="hq-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Upload New Version — {selected.title}</h3>
            <div className="hq-form-grid">
              <label>New File URL<input value={versionForm.file_url} onChange={(e) => setVersionForm({ ...versionForm, file_url: e.target.value })} /></label>
              <label>Change Notes<input value={versionForm.change_notes} onChange={(e) => setVersionForm({ ...versionForm, change_notes: e.target.value })} placeholder="What changed in this version?" /></label>
            </div>
            <div className="hq-modal-actions">
              <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setShowVersion(false)}>Cancel</button>
              <button type="button" className="hq-btn hq-btn-primary" disabled={!versionForm.file_url || addVersion.isPending} onClick={() => addVersion.mutate()}>
                {addVersion.isPending ? "Saving…" : "Save Version"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showOcr && selected && (
        <div className="hq-modal-overlay" onClick={() => setShowOcr(false)}>
          <div className="hq-modal" onClick={(e) => e.stopPropagation()}>
            <h3>OCR Text Index — {selected.title}</h3>
            <p className="hq-muted-text">Paste extracted text for full-text search across the document vault.</p>
            <textarea
              className="hq-input"
              rows={8}
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              placeholder="Paste document text for OCR indexing…"
              style={{ width: "100%", resize: "vertical" }}
            />
            <div className="hq-modal-actions">
              <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setShowOcr(false)}>Cancel</button>
              <button type="button" className="hq-btn hq-btn-primary" disabled={!ocrText.trim() || ocrIndex.isPending} onClick={() => ocrIndex.mutate()}>
                {ocrIndex.isPending ? "Indexing…" : "Save OCR Index"}
              </button>
            </div>
          </div>
        </div>
      )}
    </HQLayout>
  );
};

export default DocumentCenterPage;
