import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen, Search, Plus, History, FileText, Check, X, ScanText,
  Archive, AlertTriangle, RefreshCw, Eye, Download, Upload, Link2, Activity,
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
  ACCEPT_DOCUMENT_UPLOAD,
  DOCUMENT_CATEGORIES,
  DOCUMENT_FILE_TYPES,
  DOCUMENT_SOURCE_MODULES,
  DOCUMENT_VISIBILITY,
  EMPTY_DOCUMENT_LIST,
  EMPTY_DOCUMENTS_OVERVIEW,
  categoryLabel,
  detectPreviewKind,
  fileTypeLabel,
  isPreviewableUrl,
  type DocumentsOverview,
  type PreviewKind,
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

function mutationErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Request failed";
}

const emptyNewDoc = {
  title: "",
  category: "grants",
  file_url: "",
  access_level: "internal",
  grant_id: "",
  person_id: "",
  department_id: "",
  program_id: "",
  project_id: "",
  tags: "",
  labels: "",
  visibility: "shared",
  source_module: "",
};

const DocumentCenterPage: React.FC = () => {
  const { user } = useAuth();
  const role = String(user?.role ?? "").toLowerCase();
  const canApprove = ["owner", "founder", "admin", "administrator", "executive", "hr", "finance", "grant_manager"].includes(role);
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState(searchParams.get("category") ?? "");
  const [fileType, setFileType] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [programFilter, setProgramFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [modifiedFrom, setModifiedFrom] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<HQDocument | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showVersion, setShowVersion] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<PreviewKind>("other");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newDoc, setNewDoc] = useState(emptyNewDoc);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionForm, setVersionForm] = useState({ file_url: "", change_notes: "" });
  const [ocrText, setOcrText] = useState("");
  const [showOcr, setShowOcr] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    const cat = searchParams.get("category");
    if (cat) setCategory(cat);
  }, [searchParams]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const listParams = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      category: category || undefined,
      file_type: fileType || undefined,
      owner: ownerFilter || undefined,
      status: statusFilter || undefined,
      visibility: visibilityFilter || undefined,
      department_id: departmentFilter || undefined,
      program_id: programFilter || undefined,
      project_id: projectFilter || undefined,
      tag: tagFilter || undefined,
      created_from: createdFrom || undefined,
      modified_from: modifiedFrom || undefined,
      archived: showArchived,
    }),
    [
      debouncedSearch, category, fileType, ownerFilter, statusFilter, visibilityFilter,
      departmentFilter, programFilter, projectFilter, tagFilter, createdFrom, modifiedFrom, showArchived,
    ]
  );

  const overview = useQuery({
    queryKey: ["docs-overview"],
    queryFn: async (): Promise<DocumentsOverview> => {
      try {
        return await documentsApi.overview();
      } catch {
        return { ...EMPTY_DOCUMENTS_OVERVIEW, degraded: true };
      }
    },
    placeholderData: EMPTY_DOCUMENTS_OVERVIEW,
    staleTime: 30_000,
    retry: 0,
  });

  const list = useQuery({
    queryKey: ["docs-list", listParams],
    queryFn: async () => {
      try {
        return await documentsApi.list(listParams);
      } catch {
        return { ...EMPTY_DOCUMENT_LIST, degraded: true };
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

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    const doc = detail.data?.document ?? selected;
    const fileUrl = doc?.file_url ?? null;

    async function loadPreview() {
      setPreviewUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return null;
      });
      const kind = detectPreviewKind(fileUrl, doc?.mime_type, doc?.file_type);
      setPreviewKind(kind);
      if (!fileUrl || !isPreviewableUrl(fileUrl, doc?.mime_type, doc?.file_type)) {
        setPreviewLoading(false);
        return;
      }
      if (kind === "office") {
        setPreviewLoading(false);
        return;
      }
      setPreviewLoading(true);
      try {
        const res = await fetch(fileUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`Preview failed (${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      } catch {
        if (!cancelled) {
          setPreviewUrl(null);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }

    void loadPreview();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected?.id, selected?.file_url, detail.data?.document]);

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
    enabled: showAdd || showFilters,
    retry: 0,
  });

  const documents = list.data?.documents ?? [];
  const folderCounts = useMemo(() => {
    const counts = Object.fromEntries(DOCUMENT_CATEGORIES.map((c) => [c.id, 0]));
    for (const row of overview.data?.byCategory ?? []) {
      const key = row.category === "policy" ? "policies" : row.category;
      if (counts[key] !== undefined) counts[key] += Number(row.count) || 0;
    }
    return counts;
  }, [overview.data?.byCategory]);

  const queueUploadFile = useCallback((file: File | null) => {
    if (!file) return;
    setUploadFile(file);
    setNewDoc((prev) => ({
      ...prev,
      title: prev.title || file.name.replace(/\.[^.]+$/, ""),
    }));
    setShowAdd(true);
  }, []);

  const onDropFiles = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0] ?? null;
      queueUploadFile(file);
    },
    [queueUploadFile]
  );

  const createDoc = useMutation({
    mutationFn: async () => {
      setActionError(null);
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
          program_id: newDoc.program_id || undefined,
          project_id: newDoc.project_id || undefined,
          tags: newDoc.tags,
          labels: newDoc.labels,
          visibility: newDoc.visibility,
          source_module: newDoc.source_module || undefined,
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
        program_id: newDoc.program_id || undefined,
        project_id: newDoc.project_id || undefined,
        tags: newDoc.tags,
        labels: newDoc.labels,
        visibility: newDoc.visibility,
        source_module: newDoc.source_module || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs-list"] });
      qc.invalidateQueries({ queryKey: ["docs-overview"] });
      setShowAdd(false);
      setUploadFile(null);
      setNewDoc(emptyNewDoc);
    },
    onError: (err) => setActionError(mutationErrorMessage(err)),
  });

  const addVersion = useMutation({
    mutationFn: async () => {
      setActionError(null);
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
          mimeType: versionFile.type || undefined,
          fileName: versionFile.name,
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
    onError: (err) => setActionError(mutationErrorMessage(err)),
  });

  const restoreVersion = useMutation({
    mutationFn: (versionId: string) => {
      setActionError(null);
      return documentsApi.restoreVersion(selected!.id, versionId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docs-detail", selected?.id] });
      qc.invalidateQueries({ queryKey: ["docs-list"] });
    },
    onError: (err) => setActionError(mutationErrorMessage(err)),
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
    onError: (err) => setActionError(mutationErrorMessage(err)),
  });

  const secureDownload = useMutation({
    mutationFn: async () => {
      const result = await documentsApi.secureDownload(selected!.id);
      window.open(result.url, "_blank", "noopener,noreferrer");
      return result;
    },
    onError: (err) => setActionError(mutationErrorMessage(err)),
  });

  const overviewData = overview.data ?? EMPTY_DOCUMENTS_OVERVIEW;

  return (
    <HQLayout
      title="Document Management"
      subtitle="Enterprise repository — store, search, preview, and govern every HQ document"
      auraModule="documents"
      auraActions={["ask", "summarize", "prepare_approval", "explain"]}
    >
      <HqQueryBoundary
        query={list}
        title="Document library unavailable"
        message="The document API did not respond in time. Retry or check headquarters connectivity."
        loadingMessage="Loading document library…"
        hasRenderableData
      >
        <>
          {actionError && (
            <div className="hq-anomaly-alert hq-sev-medium hq-fade-in" style={{ marginBottom: "1rem" }} role="alert">
              <AlertTriangle size={16} />
              <div>
                <strong>Action failed</strong>
                <span>{actionError}</span>
                <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" style={{ marginLeft: "0.5rem" }} onClick={() => setActionError(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {(list.data?.degraded || overview.data?.degraded) && (
            <div className="hq-anomaly-alert hq-sev-medium hq-fade-in" style={{ marginBottom: "1rem" }} role="status">
              <AlertTriangle size={16} />
              <div>
                <strong>Degraded mode</strong>
                <span>Document library returned a safe empty state after a timeout or API error — retry to refresh live data.</span>
                <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" style={{ marginLeft: "0.5rem" }} onClick={() => { void list.refetch(); void overview.refetch(); }}>
                  Retry
                </button>
              </div>
            </div>
          )}

          <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
            <KpiCard label="Active Documents" value={overviewData.total} icon={FolderOpen} variant="gold" />
            <KpiCard label="Pending Review" value={overviewData.pendingApprovals ?? 0} icon={Check} variant="warning" />
            <KpiCard label="Search Index" value={overviewData.indexed ?? 0} icon={Search} variant="muted" />
            <KpiCard label="Archived" value={overviewData.archived ?? 0} icon={Archive} variant="muted" />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <HqPanel title="Connected Modules" subtitle="Filter the vault by department surface or open the source module">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
                {DOCUMENT_SOURCE_MODULES.map((m) => {
                  const catMap: Record<string, string> = {
                    grants: "grants",
                    board: "board_records",
                    finance: "financial",
                    hr: "personnel",
                    programs: "program_files",
                    compliance: "policies",
                    contracts: "contracts",
                    reports: "reports",
                    executive: "reports",
                  };
                  const vaultCategory = catMap[m.id] ?? "";
                  return (
                    <React.Fragment key={m.id}>
                      <button
                        type="button"
                        className={`hq-btn hq-btn-sm ${category === vaultCategory && vaultCategory ? "hq-btn-primary" : "hq-btn-ghost"}`}
                        onClick={() => {
                          setCategory(vaultCategory);
                          setSearchParams(vaultCategory ? { category: vaultCategory } : {});
                        }}
                      >
                        <FolderOpen size={12} /> {m.label}
                      </button>
                      <Link to={m.path} className="hq-btn hq-btn-sm hq-btn-ghost" title={`Open ${m.label}`}>
                        <Link2 size={12} />
                      </Link>
                    </React.Fragment>
                  );
                })}
              </div>
            </HqPanel>
          </div>

          <div
            className={`hq-panel hq-fade-in ${dragOver ? "hq-doc-drop-active" : ""}`}
            style={{ marginBottom: "1rem", padding: "1rem", borderStyle: "dashed", textAlign: "center" }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDropFiles}
          >
            <Upload size={22} style={{ color: "var(--hq-gold)", marginBottom: "0.35rem" }} />
            <p style={{ margin: 0, color: "var(--hq-gold)" }}>Drag & drop files here to upload</p>
            <p className="hq-muted-text" style={{ fontSize: "0.78rem", marginTop: "0.25rem" }}>
              PDF, Office, images, video, audio, ZIP — up to 50 MB
            </p>
            <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" style={{ marginTop: "0.65rem" }} onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Upload Document
            </button>
          </div>

          <div className="hq-people-toolbar" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <div className="hq-search-bar" style={{ flex: "1 1 220px", minWidth: 0 }}>
              <Search size={18} />
              <input
                type="search"
                placeholder="Enterprise search — title, tags, OCR, program, project…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setSearchParams(e.target.value ? { category: e.target.value } : {}); }} className="hq-input" style={{ width: "auto", maxWidth: "100%" }}>
              <option value="">All folders</option>
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <button type="button" className={`hq-btn hq-btn-sm ${showFilters ? "hq-btn-primary" : "hq-btn-ghost"}`} onClick={() => setShowFilters((v) => !v)}>
              Filters
            </button>
            <button type="button" className={`hq-btn hq-btn-sm ${showArchived ? "hq-btn-primary" : "hq-btn-ghost"}`} onClick={() => setShowArchived((v) => !v)}>
              <Archive size={14} /> {showArchived ? "Archived" : "Active"}
            </button>
            <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => { void list.refetch(); void overview.refetch(); }} disabled={list.isFetching}>
              <RefreshCw size={14} className={list.isFetching ? "hq-spin" : ""} /> Refresh
            </button>
          </div>

          {showFilters && (
            <div className="hq-panel hq-fade-in" style={{ marginTop: "0.75rem", padding: "0.85rem", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.55rem" }}>
              <label className="hq-muted-text" style={{ fontSize: "0.72rem" }}>File type
                <select className="hq-input" value={fileType} onChange={(e) => setFileType(e.target.value)}>
                  <option value="">All types</option>
                  {DOCUMENT_FILE_TYPES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </label>
              <label className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Status
                <select className="hq-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
              <label className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Visibility
                <select className="hq-input" value={visibilityFilter} onChange={(e) => setVisibilityFilter(e.target.value)}>
                  <option value="">All</option>
                  {DOCUMENT_VISIBILITY.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </label>
              <label className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Department
                <select className="hq-input" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
                  <option value="">All departments</option>
                  {(departments.data?.departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
              <label className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Program ID
                <input className="hq-input" value={programFilter} onChange={(e) => setProgramFilter(e.target.value)} placeholder="program…" />
              </label>
              <label className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Project ID
                <input className="hq-input" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} placeholder="project…" />
              </label>
              <label className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Owner
                <input className="hq-input" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} placeholder="name or email" />
              </label>
              <label className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Tag
                <input className="hq-input" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} placeholder="tag…" />
              </label>
              <label className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Created from
                <input className="hq-input" type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} />
              </label>
              <label className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Modified from
                <input className="hq-input" type="date" value={modifiedFrom} onChange={(e) => setModifiedFrom(e.target.value)} />
              </label>
            </div>
          )}

          <div className="hq-fade-in" style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", margin: "0.75rem 0 1rem" }}>
            {DOCUMENT_CATEGORIES.slice(0, 8).map((c) => (
              <button
                key={c.id}
                type="button"
                className={`hq-btn hq-btn-sm ${category === c.id ? "hq-btn-primary" : "hq-btn-ghost"}`}
                onClick={() => {
                  const next = category === c.id ? "" : c.id;
                  setCategory(next);
                  setSearchParams(next ? { category: next } : {});
                }}
              >
                {c.label}
                {folderCounts[c.id] ? ` (${folderCounts[c.id]})` : ""}
              </button>
            ))}
          </div>

          <div className="hq-grid-main-side hq-fade-in" style={{ marginTop: "0.5rem" }}>
            <HqWidgetErrorBoundary label="Document library">
              <HqPanel title={showArchived ? "Archived Documents" : "Enterprise Document Library"} subtitle={`${documents.length} visible · role-based access`}>
                {list.isFetching && !documents.length ? (
                  <HqLoading message="Loading documents…" />
                ) : documents.length === 0 ? (
                  <div className="hq-panel" style={{ padding: "2rem", textAlign: "center" }}>
                    <FolderOpen size={32} style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }} />
                    <p style={{ margin: 0, color: "var(--hq-gold)" }}>No documents match these filters</p>
                    <p className="hq-muted-text" style={{ fontSize: "0.85rem", marginTop: "0.35rem" }}>
                      Upload grants, board minutes, IRS filings, policies, contracts, or program files.
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
                            <th>Type</th>
                            <th>Owner / Dept</th>
                            <th>Status</th>
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
                              <td>
                                {d.title}
                                {(d.tags?.length || 0) > 0 && (
                                  <div className="hq-muted-text" style={{ fontSize: "0.68rem" }}>{d.tags!.slice(0, 3).join(" · ")}</div>
                                )}
                              </td>
                              <td><StatusBadge label={categoryLabel(d.category)} variant="gold" /></td>
                              <td style={{ fontSize: "0.75rem" }}>{fileTypeLabel(d.file_type)}</td>
                              <td style={{ fontSize: "0.78rem" }}>
                                {d.owner_name?.trim() || d.owner_email || d.submitted_by || "—"}
                                {d.department_name ? <div className="hq-muted-text">{d.department_name}</div> : null}
                              </td>
                              <td>
                                <StatusBadge label={d.approval_status ?? "approved"} variant={approvalVariant(d.approval_status)} />
                              </td>
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
                            {categoryLabel(d.category)} · {fileTypeLabel(d.file_type)} · v{d.version}
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
                    subtitle={`v${detail.data.document.version} · ${categoryLabel(detail.data.document.category)} · ${fileTypeLabel(detail.data.document.file_type)}`}
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
                      </div>
                    }
                  >
                    {detail.data.document.file_url && (
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                        <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={secureDownload.isPending} onClick={() => secureDownload.mutate()}>
                          <Download size={14} /> Secure Download
                        </button>
                        {isPreviewableUrl(detail.data.document.file_url, detail.data.document.mime_type, detail.data.document.file_type) && (
                          <span className="hq-btn hq-btn-sm hq-btn-ghost" style={{ pointerEvents: "none" }}>
                            <Eye size={14} /> In-app preview
                          </span>
                        )}
                      </div>
                    )}
                    {previewLoading && <HqLoading message="Loading preview…" />}
                    {!previewLoading && previewUrl && previewKind === "pdf" && (
                      <iframe title="Document preview" src={previewUrl} style={{ width: "100%", height: "360px", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, marginBottom: "1rem", background: "#111" }} />
                    )}
                    {!previewLoading && previewUrl && previewKind === "image" && (
                      <img src={previewUrl} alt={detail.data.document.title} style={{ maxWidth: "100%", maxHeight: 360, borderRadius: 8, marginBottom: "1rem", objectFit: "contain" }} />
                    )}
                    {!previewLoading && previewUrl && previewKind === "text" && (
                      <iframe title="Text preview" src={previewUrl} style={{ width: "100%", height: "240px", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, marginBottom: "1rem", background: "#111" }} />
                    )}
                    {!previewLoading && previewUrl && previewKind === "video" && (
                      <video controls src={previewUrl} style={{ width: "100%", maxHeight: 360, borderRadius: 8, marginBottom: "1rem", background: "#111" }} />
                    )}
                    {!previewLoading && previewUrl && previewKind === "audio" && (
                      <audio controls src={previewUrl} style={{ width: "100%", marginBottom: "1rem" }} />
                    )}
                    {!previewLoading && previewKind === "office" && (
                      <div className="hq-panel" style={{ padding: "0.85rem", marginBottom: "1rem" }}>
                        <FileText size={18} style={{ color: "var(--hq-gold)" }} />
                        <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
                          Office preview — download to open in Word, Excel, or PowerPoint. Native browser rendering is limited for DOCX/XLSX/PPTX.
                        </p>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                      <StatusBadge label={`Access: ${detail.data.document.access_level}`} variant="muted" />
                      <StatusBadge label={`Visibility: ${detail.data.document.visibility ?? "shared"}`} variant="muted" />
                      {detail.data.document.department_name && <StatusBadge label={detail.data.document.department_name} variant="gold" />}
                      {detail.data.document.program_id && <StatusBadge label={`Program: ${detail.data.document.program_id}`} variant="gold" />}
                      {detail.data.document.project_id && <StatusBadge label={`Project: ${detail.data.document.project_id}`} variant="gold" />}
                      {detail.data.document.grant_id && <StatusBadge label="Linked to grant" variant="gold" />}
                      {(detail.data.document.tags ?? []).map((t) => (
                        <StatusBadge key={t} label={`#${t}`} variant="muted" />
                      ))}
                    </div>

                    <h4 style={{ fontSize: "0.8rem", color: "var(--hq-text-dim)", marginBottom: "0.5rem" }}>Version History</h4>
                    <ul className="hq-activity-list" style={{ marginBottom: "1rem" }}>
                      {detail.data.versions.map((v) => (
                        <li key={v.id} className="hq-activity-item">
                          <div className="hq-activity-content">
                            <div className="hq-activity-title">v{v.version} — {v.title}</div>
                            <div className="hq-activity-detail">{v.change_notes} · {v.uploaded_by}</div>
                            <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                              {v.file_url && (
                                <a href={v.file_url} target="_blank" rel="noopener noreferrer" className="hq-btn hq-btn-sm hq-btn-ghost">Open</a>
                              )}
                              {v.file_url && v.version !== detail.data.document.version && (
                                <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" disabled={restoreVersion.isPending} onClick={() => restoreVersion.mutate(v.id)}>
                                  Restore
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="hq-activity-time">{new Date(v.created_at).toLocaleDateString()}</div>
                        </li>
                      ))}
                    </ul>

                    <h4 style={{ fontSize: "0.8rem", color: "var(--hq-text-dim)", marginBottom: "0.5rem" }}>
                      <Activity size={12} style={{ display: "inline", marginRight: 4 }} />
                      Activity Audit
                    </h4>
                    <ul className="hq-activity-list">
                      {(detail.data.activity ?? []).length === 0 && (
                        <li className="hq-activity-item"><div className="hq-activity-detail">No activity yet</div></li>
                      )}
                      {(detail.data.activity ?? []).map((a) => (
                        <li key={a.id} className="hq-activity-item">
                          <div className="hq-activity-content">
                            <div className="hq-activity-title">{a.action}</div>
                            <div className="hq-activity-detail">{a.detail || a.actor_email || "—"}</div>
                          </div>
                          <div className="hq-activity-time">{new Date(a.created_at).toLocaleString()}</div>
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
                <HqPanel title="Select a document" subtitle="Tap a row to preview, download, and review history">
                  <p className="hq-muted-text">Central repository for grants, finance, HR, programs, compliance, board, contracts, and reports.</p>
                  {(overviewData.recentActivity ?? []).slice(0, 6).map((a) => (
                    <div key={a.id} className="hq-muted-text" style={{ fontSize: "0.75rem", marginTop: "0.35rem" }}>
                      {a.action} · {a.document_title || a.document_id} · {new Date(a.created_at).toLocaleDateString()}
                    </div>
                  ))}
                </HqPanel>
              )}
            </div>
          </div>
        </>
      </HqQueryBoundary>

      {showAdd && (
        <div className="hq-modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="hq-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "min(560px, 96vw)", maxHeight: "90vh", overflowY: "auto" }}>
            <h3>Upload Document</h3>
            <div className="hq-form-grid">
              <label>Title<input value={newDoc.title} onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })} /></label>
              <label>Folder / Category
                <select value={newDoc.category} onChange={(e) => setNewDoc({ ...newDoc, category: e.target.value })}>
                  {DOCUMENT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label>Upload File
                <input type="file" accept={ACCEPT_DOCUMENT_UPLOAD} onChange={(e) => queueUploadFile(e.target.files?.[0] ?? null)} />
              </label>
              {uploadFile && <p className="hq-muted-text" style={{ fontSize: "0.78rem" }}>Selected: {uploadFile.name}</p>}
              <label>Or File URL<input value={newDoc.file_url} onChange={(e) => setNewDoc({ ...newDoc, file_url: e.target.value })} placeholder="https://…" disabled={!!uploadFile} /></label>
              <label>Department
                <select value={newDoc.department_id} onChange={(e) => setNewDoc({ ...newDoc, department_id: e.target.value })}>
                  <option value="">— No department —</option>
                  {(departments.data?.departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
              <label>Program ID<input value={newDoc.program_id} onChange={(e) => setNewDoc({ ...newDoc, program_id: e.target.value })} placeholder="optional" /></label>
              <label>Project ID<input value={newDoc.project_id} onChange={(e) => setNewDoc({ ...newDoc, project_id: e.target.value })} placeholder="optional" /></label>
              <label>Tags (comma-separated)<input value={newDoc.tags} onChange={(e) => setNewDoc({ ...newDoc, tags: e.target.value })} placeholder="fy26, compliance" /></label>
              <label>Labels<input value={newDoc.labels} onChange={(e) => setNewDoc({ ...newDoc, labels: e.target.value })} placeholder="priority, legal" /></label>
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
              <label>Source Module
                <select value={newDoc.source_module} onChange={(e) => setNewDoc({ ...newDoc, source_module: e.target.value })}>
                  <option value="">— General vault —</option>
                  {DOCUMENT_SOURCE_MODULES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
              <label>Visibility
                <select value={newDoc.visibility} onChange={(e) => setNewDoc({ ...newDoc, visibility: e.target.value })}>
                  {DOCUMENT_VISIBILITY.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
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
              <label>Upload File<input type="file" accept={ACCEPT_DOCUMENT_UPLOAD} onChange={(e) => setVersionFile(e.target.files?.[0] ?? null)} /></label>
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
        .hq-doc-drop-active { border-color: var(--hq-gold) !important; background: rgba(212, 175, 55, 0.08); }
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
