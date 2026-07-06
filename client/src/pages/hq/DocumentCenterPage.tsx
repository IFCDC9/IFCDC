import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen, Search, Plus, History, FileText, Check, X, PenLine, ScanText,
  Archive, AlertTriangle, RefreshCw,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { documentsApi, type HQDocument } from "../../api/documentsApi";
import { filesApi } from "../../api/filesApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqQueryBoundary } from "../../components/hq/HqQueryBoundary";
import { HqWidgetErrorBoundary } from "../../components/hq/HqErrorBoundary";
import { grantsApi } from "../../api/grantsApi";
import { peopleApi } from "../../api/peopleApi";
import { useAuth } from "../../auth/AuthContext";
import {
  DOCUMENT_CATEGORIES,
  EMPTY_DOCUMENT_LIST,
  EMPTY_DOCUMENTS_OVERVIEW,
  categoryLabel,
  type DocumentsOverview,
} from "../../data/documentsDefaults";

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.includes(",") ? result.split(",")[1]! : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function approvalVariant(status?: string): "success" | "warning" | "danger" | "muted" {
  if (status === "pending") return "warning";
  if (status === "rejected") return "danger";
  if (status === "approved") return "success";
  return "muted";
}

const DocumentCenterPage: React.FC = () => {
  const { user } = useAuth();
  const role = String(user?.role ?? "").toLowerCase();
  const canApprove = ["owner", "founder", "admin", "administrator", "executive"].includes(role);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<HQDocument | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showVersion, setShowVersion] = useState(false);
  const [newDoc, setNewDoc] = useState({
    title: "",
    category: "grants",
    file_url: "",
    access_level: "internal",
    grant_id: "",
    person_id: "",
    department_id: "",
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionForm, setVersionForm] = useState({ file_url: "", change_notes: "" });
  const [ocrText, setOcrText] = useState("");
  const [showOcr, setShowOcr] = useState(false);
  const qc = useQueryClient();

  const overview = useQuery({
    queryKey: ["docs-overview"],
    queryFn: async (): Promise<DocumentsOverview> => {
      try {
        return await documentsApi.overview();
      } catch {
        return EMPTY_DOCUMENTS_OVERVIEW;
      }
    },
    placeholderData: EMPTY_DOCUMENTS_OVERVIEW,
    staleTime: 30_000,
    retry: 0,
  });

  const list = useQuery({
    queryKey: ["docs-list", search, category, showArchived],
    queryFn: async () => {
      try {
        return await documentsApi.list({
          q: search || undefined,
          category: category || undefined,
          archived: showArchived,
        });
      } catch {
        return EMPTY_DOCUMENT_LIST;
      }
    },
    placeholderData: EMPTY_DOCUMENT_LIST,
    staleTime: 15_000,
    retry: 0,
  });

  const detail = useQuery({
    queryKey: ["docs-detail", selected?.id],
    queryFn: () => documentsApi.get(selected!.id),
    enabled: !!selected,
    retry: 0,
  });

  const grantOptions = useQuery({
    queryKey: ["docs-grant-options"],
    queryFn: grantsApi.opportunities,
    enabled: showAdd,
    retry: 0,
  });

  const peopleOptions = useQuery({
    queryKey: ["docs-people-options"],
    queryFn: () => peopleApi.list({ status: "active" }),
    enabled: showAdd,
    retry: 0,
  });

  const departments = useQuery({
    queryKey: ["docs-departments"],
    queryFn: peopleApi.departments,
    enabled: showAdd,
    retry: 0,
  });

  const documents = list.data?.documents ?? [];
  const folderCounts = useMemo(() => {
    const counts = Object.fromEntries(DOCUMENT_CATEGORIES.map((c) => [c.id, 0]));
    for (const d of documents) {
      if (counts[d.category] !== undefined) counts[d.category] += 1;
    }
    return counts;
  }, [documents]);

  const createDoc = useMutation({
    mutationFn: async () => {
      if (uploadFile) {
        const base64 = await fileToBase64(uploadFile);
        return documentsApi.upload({
          fileName: uploadFile.name,
          base64,
          mimeType: uploadFile.type || undefined,
          title: newDoc.title,
          category: newDoc.category,
          access_level: newDoc.access_level,
          grant_id: newDoc.grant_id || undefined,
          person_id: newDoc.person_id || undefined,
          department_id: newDoc.department_id || undefined,
        });
      }
      return documentsApi.create({
        title: newDoc.title,
        category: newDoc.category,
        file_url: newDoc.file_url || undefined,
        access_level: newDoc.access_level,
        grant_id: newDoc.grant_id || undefined,
        person_id: newDoc.person_id || undefined,
        department_id: newDoc.department_id || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs-list"] });
      qc.invalidateQueries({ queryKey: ["docs-overview"] });
      setShowAdd(false);
      setUploadFile(null);
      setNewDoc({
        title: "",
        category: "grants",
        file_url: "",
        access_level: "internal",
        grant_id: "",
        person_id: "",
        department_id: "",
      });
    },
  });

  const addVersion = useMutation({
    mutationFn: async () => {
      if (versionFile) {
        const base64 = await fileToBase64(versionFile);
        const uploaded = await filesApi.upload({
          fileName: versionFile.name,
          base64,
          mimeType: versionFile.type || undefined,
        });
        return documentsApi.addVersion(selected!.id, {
          file_url: uploaded.file.url,
          change_notes: versionForm.change_notes || `Uploaded ${versionFile.name}`,
        });
      }
      return documentsApi.addVersion(selected!.id, versionForm);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs-detail", selected?.id] });
      qc.invalidateQueries({ queryKey: ["docs-list"] });
      setShowVersion(false);
      setVersionForm({ file_url: "", change_notes: "" });
      setVersionFile(null);
    },
  });

  const reviewDoc = useMutation({
    mutationFn: (action: "approve" | "reject") => documentsApi.review(selected!.id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs-detail", selected?.id] });
      qc.invalidateQueries({ queryKey: ["docs-list"] });
      qc.invalidateQueries({ queryKey: ["docs-overview"] });
    },
  });

  const archiveDoc = useMutation({
    mutationFn: (archived: boolean) => documentsApi.archive(selected!.id, archived),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs-detail", selected?.id] });
      qc.invalidateQueries({ queryKey: ["docs-list"] });
      qc.invalidateQueries({ queryKey: ["docs-overview"] });
      setSelected(null);
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

  const overviewData = overview.data ?? EMPTY_DOCUMENTS_OVERVIEW;

  return (
    <HQLayout title="Document Management" subtitle="Secure vault — grants, board records, policies, contracts, and founder approvals">
      <HqQueryBoundary
        query={list}
        title="Document library unavailable"
        message="The document API did not respond in time. Retry or check headquarters connectivity."
        loadingMessage="Loading document library…"
        hasRenderableData
      >
        <>
          {(list.data?.degraded || overview.data === EMPTY_DOCUMENTS_OVERVIEW) && list.isError && (
            <div className="hq-anomaly-alert hq-sev-medium hq-fade-in" style={{ marginBottom: "1rem" }}>
              <AlertTriangle size={16} />
              <div>
                <strong>Degraded mode</strong>
                <span>Document data may be partial — refresh to retry.</span>
              </div>
            </div>
          )}

          <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
            <KpiCard label="Active Documents" value={overviewData.total} icon={FolderOpen} variant="gold" />
            <KpiCard label="Pending Review" value={overviewData.pendingApprovals ?? 0} icon={Check} variant="warning" />
            <KpiCard label="Archived" value={overviewData.archived ?? 0} icon={Archive} variant="muted" />
            <KpiCard label="Categories" value={overviewData.byCategory?.length ?? 0} icon={FileText} />
          </div>

          <div className="hq-people-toolbar" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <div className="hq-search-bar" style={{ flex: "1 1 220px", minWidth: 0 }}>
              <Search size={18} />
              <input
                type="search"
                placeholder="Search title, category, OCR text…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="hq-input" style={{ width: "auto", maxWidth: "100%" }}>
              <option value="">All folders</option>
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <button
              type="button"
              className={`hq-btn hq-btn-sm ${showArchived ? "hq-btn-primary" : "hq-btn-ghost"}`}
              onClick={() => setShowArchived((v) => !v)}
            >
              <Archive size={14} /> {showArchived ? "Archived" : "Active"}
            </button>
            <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => list.refetch()} disabled={list.isFetching}>
              <RefreshCw size={14} className={list.isFetching ? "hq-spin" : ""} /> Refresh
            </button>
            <button type="button" className="hq-btn hq-btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={16} /> Upload
            </button>
          </div>

          <div className="hq-fade-in" style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", margin: "0.75rem 0 1rem" }}>
            {DOCUMENT_CATEGORIES.slice(0, 8).map((c) => (
              <button
                key={c.id}
                type="button"
                className={`hq-btn hq-btn-sm ${category === c.id ? "hq-btn-primary" : "hq-btn-ghost"}`}
                onClick={() => setCategory(category === c.id ? "" : c.id)}
              >
                {c.label}
                {folderCounts[c.id] ? ` (${folderCounts[c.id]})` : ""}
              </button>
            ))}
          </div>

          <div className="hq-grid-main-side hq-fade-in" style={{ marginTop: "0.5rem" }}>
            <HqWidgetErrorBoundary label="Document library">
              <HqPanel title={showArchived ? "Archived Documents" : "Document Library"} subtitle="Role-based access · click to view details">
                {list.isFetching && !documents.length ? (
                  <HqLoading message="Loading documents…" />
                ) : documents.length === 0 ? (
                  <div className="hq-panel" style={{ padding: "2rem", textAlign: "center" }}>
                    <FolderOpen size={32} style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }} />
                    <p style={{ margin: 0, color: "var(--hq-gold)" }}>No documents in this folder</p>
                    <p className="hq-muted-text" style={{ fontSize: "0.85rem", marginTop: "0.35rem" }}>
                      Upload grants, board minutes, IRS filings, policies, or contracts to get started.
                    </p>
                    <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" style={{ marginTop: "0.75rem" }} onClick={() => setShowAdd(true)}>
                      <Plus size={14} /> Upload Document
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="hq-doc-table-wrap">
                      <table className="hq-table hq-doc-desktop-table">
                        <thead>
                          <tr>
                            <th>Title</th>
                            <th>Folder</th>
                            <th>Owner / Dept</th>
                            <th>Status</th>
                            <th>Uploaded</th>
                            <th>Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {documents.map((d) => (
                            <tr
                              key={d.id}
                              className={`hq-clickable ${selected?.id === d.id ? "active" : ""}`}
                              onClick={() => setSelected(d)}
                            >
                              <td>{d.title}</td>
                              <td><StatusBadge label={categoryLabel(d.category)} variant="gold" /></td>
                              <td style={{ fontSize: "0.78rem" }}>
                                {d.owner_name?.trim() || d.submitted_by || "—"}
                                {d.department_name ? <div className="hq-muted-text">{d.department_name}</div> : null}
                              </td>
                              <td>
                                <StatusBadge label={d.approval_status ?? "approved"} variant={approvalVariant(d.approval_status)} />
                              </td>
                              <td>{new Date(d.created_at).toLocaleDateString()}</td>
                              <td>{new Date(d.updated_at).toLocaleDateString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="hq-doc-mobile-list">
                      {documents.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className={`hq-panel hq-doc-mobile-card ${selected?.id === d.id ? "active" : ""}`}
                          onClick={() => setSelected(d)}
                          style={{ width: "100%", textAlign: "left", marginBottom: "0.5rem", padding: "0.85rem" }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "flex-start" }}>
                            <strong style={{ fontSize: "0.9rem", color: "var(--hq-gold)" }}>{d.title}</strong>
                            <StatusBadge label={d.approval_status ?? "approved"} variant={approvalVariant(d.approval_status)} />
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--hq-text-muted)", marginTop: "0.35rem" }}>
                            {categoryLabel(d.category)} · v{d.version} · {d.access_level}
                          </div>
                          <div style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)", marginTop: "0.25rem" }}>
                            Updated {new Date(d.updated_at).toLocaleDateString()}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </HqPanel>
            </HqWidgetErrorBoundary>

            <div>
              {selected ? (
                detail.isLoading ? (
                  <HqLoading message="Loading document…" />
                ) : detail.data ? (
                  <HqPanel
                    title={detail.data.document.title}
                    subtitle={`v${detail.data.document.version} · ${categoryLabel(detail.data.document.category)}`}
                    headerExtra={
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        {detail.data.document.approval_status === "pending" && canApprove && (
                          <>
                            <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" disabled={reviewDoc.isPending}
                              onClick={() => reviewDoc.mutate("approve")}><Check size={14} /> Approve</button>
                            <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled={reviewDoc.isPending}
                              onClick={() => reviewDoc.mutate("reject")}><X size={14} /> Reject</button>
                          </>
                        )}
                        {detail.data.document.approval_status === "pending" && !canApprove && (
                          <span className="hq-muted-text" style={{ fontSize: "0.75rem" }}>Awaiting executive approval</span>
                        )}
                        {canApprove && detail.data.document.lifecycle_status !== "archived" && (
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled={archiveDoc.isPending}
                            onClick={() => archiveDoc.mutate(true)}><Archive size={14} /> Archive</button>
                        )}
                        {detail.data.document.lifecycle_status === "archived" && canApprove && (
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" disabled={archiveDoc.isPending}
                            onClick={() => archiveDoc.mutate(false)}>Restore</button>
                        )}
                        <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => setShowVersion(true)}>
                          <History size={14} /> New Version
                        </button>
                        <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={() => { setOcrText(detail.data.document.ocr_text ?? ""); setShowOcr(true); }}>
                          <ScanText size={14} /> OCR Index
                        </button>
                        {detail.data.document.signature_status !== "signed" ? (
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled={signDoc.isPending} onClick={() => signDoc.mutate()}>
                            <PenLine size={14} /> Sign
                          </button>
                        ) : (
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled title="Coming soon — advanced e-signature workflow">
                            E-Sign (Coming soon)
                          </button>
                        )}
                      </div>
                    }
                  >
                    {detail.data.document.file_url && (
                      <a href={detail.data.document.file_url} target="_blank" rel="noopener noreferrer" className="hq-btn hq-btn-primary hq-btn-sm" style={{ marginBottom: "1rem" }}>
                        Open File
                      </a>
                    )}
                    <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                      <StatusBadge label={`Access: ${detail.data.document.access_level}`} variant="muted" />
                      <StatusBadge label={`Signature: ${detail.data.document.signature_status ?? "unsigned"}`}
                        variant={detail.data.document.signature_status === "signed" ? "success" : "muted"} />
                      {detail.data.document.department_name && (
                        <StatusBadge label={detail.data.document.department_name} variant="gold" />
                      )}
                    </div>
                    {detail.data.document.ocr_text && (
                      <p className="hq-muted-text" style={{ fontSize: "0.78rem", marginBottom: "1rem" }}>
                        <strong>OCR:</strong> {detail.data.document.ocr_text.slice(0, 200)}
                        {detail.data.document.ocr_text.length > 200 ? "…" : ""}
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
                ) : (
                  <HqPanel title="Document unavailable">
                    <p className="hq-muted-text">Could not load document details.</p>
                  </HqPanel>
                )
              ) : (
                <HqPanel title="Select a document" subtitle="Tap a row or card to view versions and actions">
                  <p className="hq-muted-text">Store grants, board records, IRS/nonprofit filings, policies, contracts, program files, reports, and founder approvals in one secure vault.</p>
                </HqPanel>
              )}
            </div>
          </div>
        </>
      </HqQueryBoundary>

      {showAdd && (
        <div className="hq-modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="hq-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "min(520px, 96vw)" }}>
            <h3>Upload Document</h3>
            <div className="hq-form-grid">
              <label>Title<input value={newDoc.title} onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })} /></label>
              <label>Folder / Category
                <select value={newDoc.category} onChange={(e) => setNewDoc({ ...newDoc, category: e.target.value })}>
                  {DOCUMENT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label>Upload File<input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} /></label>
              <label>Or File URL<input value={newDoc.file_url} onChange={(e) => setNewDoc({ ...newDoc, file_url: e.target.value })} placeholder="https://…" disabled={!!uploadFile} /></label>
              <label>Department
                <select value={newDoc.department_id} onChange={(e) => setNewDoc({ ...newDoc, department_id: e.target.value })}>
                  <option value="">— No department —</option>
                  {(departments.data?.departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
              <label>Owner (Person)
                <select value={newDoc.person_id} onChange={(e) => setNewDoc({ ...newDoc, person_id: e.target.value })}>
                  <option value="">— Unassigned —</option>
                  {(peopleOptions.data?.people ?? []).slice(0, 200).map((p) => (
                    <option key={p.id} value={p.id}>{p.fullName ?? `${p.firstName} ${p.lastName}`}</option>
                  ))}
                </select>
              </label>
              <label>Link to Grant
                <select value={newDoc.grant_id} onChange={(e) => setNewDoc({ ...newDoc, grant_id: e.target.value })}>
                  <option value="">— No grant —</option>
                  {(grantOptions.data?.opportunities ?? []).map((g) => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              </label>
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
              <button type="button" className="hq-btn hq-btn-primary" disabled={!newDoc.title || (!uploadFile && !newDoc.file_url) || createDoc.isPending} onClick={() => createDoc.mutate()}>
                {createDoc.isPending ? "Saving…" : "Save Document"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showVersion && selected && (
        <div className="hq-modal-overlay" onClick={() => setShowVersion(false)}>
          <div className="hq-modal" onClick={(e) => e.stopPropagation()}>
            <h3>New Version — {selected.title}</h3>
            <div className="hq-form-grid">
              <label>Upload File<input type="file" onChange={(e) => setVersionFile(e.target.files?.[0] ?? null)} /></label>
              <label>Or File URL<input value={versionForm.file_url} onChange={(e) => setVersionForm({ ...versionForm, file_url: e.target.value })} disabled={!!versionFile} /></label>
              <label>Change Notes<input value={versionForm.change_notes} onChange={(e) => setVersionForm({ ...versionForm, change_notes: e.target.value })} /></label>
            </div>
            <div className="hq-modal-actions">
              <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setShowVersion(false)}>Cancel</button>
              <button type="button" className="hq-btn hq-btn-primary" disabled={(!versionFile && !versionForm.file_url) || addVersion.isPending} onClick={() => addVersion.mutate()}>
                {addVersion.isPending ? "Saving…" : "Save Version"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOcr && selected && (
        <div className="hq-modal-overlay" onClick={() => setShowOcr(false)}>
          <div className="hq-modal" onClick={(e) => e.stopPropagation()}>
            <h3>OCR Index — {selected.title}</h3>
            <textarea className="hq-input" rows={8} value={ocrText} onChange={(e) => setOcrText(e.target.value)} style={{ width: "100%" }} />
            <div className="hq-modal-actions">
              <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setShowOcr(false)}>Cancel</button>
              <button type="button" className="hq-btn hq-btn-primary" disabled={!ocrText.trim() || ocrIndex.isPending} onClick={() => ocrIndex.mutate()}>
                {ocrIndex.isPending ? "Indexing…" : "Save OCR Index"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .hq-doc-mobile-list { display: none; }
        @media (max-width: 768px) {
          .hq-doc-desktop-table { display: none; }
          .hq-doc-mobile-list { display: block; }
          .hq-grid-main-side { grid-template-columns: 1fr !important; }
          .hq-people-toolbar { flex-direction: column; align-items: stretch; }
          .hq-search-bar { width: 100%; }
        }
      `}</style>
    </HQLayout>
  );
};

export default DocumentCenterPage;
