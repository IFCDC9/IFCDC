import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain, Search, RefreshCw, Database, Layers, CheckCircle2, Plus, FileText, Sparkles, AlertTriangle,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { useAuth } from "../../auth/AuthContext";
import {
  knowledgeBaseApi,
  sourceLabel,
  EMPTY_KNOWLEDGE_STATUS,
  type KnowledgeDocument,
  type KnowledgeSearchResult,
} from "../../api/knowledgeBaseApi";

const SOURCE_TYPES = [
  "org_profile", "program_description", "operating_budget", "hr_budget", "financial_report",
  "registration", "prior_narrative", "grant_template", "policy", "annual_report",
  "strategic_plan", "board_resolution", "grant_document", "document",
] as const;

function statusVariant(status?: string): "success" | "warning" | "muted" {
  if (status === "approved") return "success";
  if (status === "draft") return "warning";
  return "muted";
}

const KnowledgeBasePage: React.FC = () => {
  const { user } = useAuth();
  const role = String(user?.role ?? "").toLowerCase();
  const canManage = ["owner", "founder", "admin", "administrator", "executive", "grant_manager"].includes(role);
  const qc = useQueryClient();

  const [sourceType, setSourceType] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[] | null>(null);
  const [selected, setSelected] = useState<KnowledgeDocument | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newDoc, setNewDoc] = useState({ sourceType: "policy", title: "", content: "", effectiveDate: "" });

  const status = useQuery({
    queryKey: ["kb-status"],
    queryFn: async () => {
      try {
        return await knowledgeBaseApi.status();
      } catch {
        return { ...EMPTY_KNOWLEDGE_STATUS, degraded: true as const };
      }
    },
    placeholderData: EMPTY_KNOWLEDGE_STATUS,
    staleTime: 20_000,
    retry: 0,
  });

  const list = useQuery({
    queryKey: ["kb-list", sourceType],
    queryFn: async () => {
      try {
        return await knowledgeBaseApi.list({ source_type: sourceType || undefined });
      } catch {
        return { documents: [] as KnowledgeDocument[], degraded: true as const };
      }
    },
    placeholderData: { documents: [] },
    staleTime: 15_000,
    retry: 0,
  });

  const detail = useQuery({
    queryKey: ["kb-detail", selected?.id],
    queryFn: () => knowledgeBaseApi.get(selected!.id),
    enabled: !!selected,
    retry: 0,
  });

  const sync = useMutation({
    mutationFn: () => knowledgeBaseApi.sync(true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kb-status"] });
      qc.invalidateQueries({ queryKey: ["kb-list"] });
    },
  });

  const search = useMutation({
    mutationFn: (q: string) => knowledgeBaseApi.search(q, 8),
    onSuccess: (data) => setSearchResults(data.results),
  });

  const addDoc = useMutation({
    mutationFn: () =>
      knowledgeBaseApi.ingest({
        sourceType: newDoc.sourceType,
        title: newDoc.title,
        content: newDoc.content,
        effectiveDate: newDoc.effectiveDate || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kb-status"] });
      qc.invalidateQueries({ queryKey: ["kb-list"] });
      setShowAdd(false);
      setNewDoc({ sourceType: "policy", title: "", content: "", effectiveDate: "" });
    },
  });

  const approve = useMutation({
    mutationFn: (id: string) => knowledgeBaseApi.approve(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kb-list"] });
      qc.invalidateQueries({ queryKey: ["kb-detail", selected?.id] });
    },
  });

  const supersede = useMutation({
    mutationFn: (id: string) => knowledgeBaseApi.supersede(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kb-list"] });
      qc.invalidateQueries({ queryKey: ["kb-status"] });
      setSelected(null);
    },
  });

  const st = status.data ?? EMPTY_KNOWLEDGE_STATUS;
  const docs = list.data?.documents ?? [];
  const coverage = st.total > 0 ? Math.round((st.embedded / st.total) * 100) : 0;

  const runSearch = () => {
    if (searchInput.trim().length >= 2) search.mutate(searchInput.trim());
  };

  return (
    <HQLayout
      title="AURA Knowledge Base"
      subtitle="IFCDC institutional memory — grounds every grant narrative in real organizational data"
      auraModule="aura"
      auraActions={["ask", "draft", "summarize", "explain"]}
    >
      {!st.embeddingsConfigured && (
        <div className="hq-anomaly-alert hq-sev-medium hq-fade-in" style={{ marginBottom: "1rem" }}>
          <AlertTriangle size={16} />
          <div>
            <strong>Semantic embeddings offline</strong>
            <span>AURA is using keyword retrieval only. Set AURA_OPENAI_API_KEY on Render to enable semantic grounding.</span>
          </div>
        </div>
      )}

      {((status.data as { degraded?: boolean } | undefined)?.degraded || (list.data as { degraded?: boolean } | undefined)?.degraded) && (
        <div className="hq-anomaly-alert hq-sev-medium hq-fade-in" style={{ marginBottom: "1rem" }} role="status">
          <AlertTriangle size={16} />
          <div>
            <strong>Degraded mode</strong>
            <span>Knowledge Base API timed out or failed — showing a safe empty state. Retry to refresh.</span>
            <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" style={{ marginLeft: "0.5rem" }} onClick={() => { void status.refetch(); void list.refetch(); }}>
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Indexed Sources" value={st.total} icon={Database} variant="gold" />
        <KpiCard label="Semantic Coverage" value={`${coverage}%`} icon={Sparkles} variant={coverage >= 80 ? "success" : "warning"} />
        <KpiCard label="Knowledge Chunks" value={st.chunks} icon={Layers} />
        <KpiCard label="Categories" value={st.byCategory?.length ?? 0} icon={Brain} />
      </div>

      <div className="hq-people-toolbar" style={{ flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        <div className="hq-search-bar" style={{ flex: "1 1 280px", minWidth: 0 }}>
          <Search size={18} />
          <input
            type="search"
            placeholder="Ask the knowledge base… (e.g. what is our HR budget?)"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
        </div>
        <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={runSearch} disabled={search.isPending}>
          <Search size={14} /> {search.isPending ? "Searching…" : "Search"}
        </button>
        {canManage && (
          <>
            <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw size={14} className={sync.isPending ? "hq-spin" : ""} /> {sync.isPending ? "Reindexing…" : "Reindex from HQ"}
            </button>
            <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Add Knowledge
            </button>
          </>
        )}
      </div>

      {sync.isSuccess && sync.data && (
        <p className="hq-muted-text" style={{ fontSize: "0.8rem", marginBottom: "0.75rem" }}>
          Last reindex: ingested {sync.data.ingested}, unchanged {sync.data.skipped}.
        </p>
      )}

      {searchResults && (
        <HqPanel
          title="Retrieval Results"
          subtitle="What AURA reads before writing — grounded IFCDC sources"
          headerExtra={
            <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => setSearchResults(null)}>Clear</button>
          }
          className="hq-fade-in"
        >
          {searchResults.length === 0 ? (
            <p className="hq-muted-text">No matching IFCDC records. Reindex from HQ or add the source document.</p>
          ) : (
            <ul className="hq-activity-list">
              {searchResults.map((r, i) => (
                <li key={`${r.documentId}-${i}`} className="hq-activity-item">
                  <div className="hq-activity-content">
                    <div className="hq-activity-title">
                      {r.title} <StatusBadge label={sourceLabel(r.sourceType)} variant="gold" />
                    </div>
                    <div className="hq-activity-detail">{r.content.slice(0, 260)}{r.content.length > 260 ? "…" : ""}</div>
                  </div>
                  <div className="hq-activity-time">
                    {r.matchType === "semantic" ? `${Math.round(r.score * 100)}% match` : "keyword"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </HqPanel>
      )}

      <div className="hq-fade-in" style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <button
          type="button"
          className={`hq-btn hq-btn-sm ${sourceType === "" ? "hq-btn-primary" : "hq-btn-ghost"}`}
          onClick={() => setSourceType("")}
        >
          All ({st.total})
        </button>
        {st.bySource.map((s) => (
          <button
            key={s.source_type}
            type="button"
            className={`hq-btn hq-btn-sm ${sourceType === s.source_type ? "hq-btn-primary" : "hq-btn-ghost"}`}
            onClick={() => setSourceType(sourceType === s.source_type ? "" : s.source_type)}
          >
            {sourceLabel(s.source_type)} ({s.count})
          </button>
        ))}
      </div>

      <div className="hq-grid-main-side hq-fade-in">
        <HqPanel title="Indexed Knowledge" subtitle="Approved IFCDC organizational records AURA uses">
          {list.isFetching && !docs.length ? (
            <HqLoading message="Loading knowledge base…" />
          ) : docs.length === 0 ? (
            <div className="hq-panel" style={{ padding: "2rem", textAlign: "center" }}>
              <Brain size={32} style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }} />
              <p style={{ margin: 0, color: "var(--hq-gold)" }}>No indexed knowledge yet</p>
              <p className="hq-muted-text" style={{ fontSize: "0.85rem", marginTop: "0.35rem" }}>
                Run “Reindex from HQ” to import IFCDC budgets, programs, financials, registration, and prior narratives — or upload documents in the Document Center.
              </p>
              {canManage && (
                <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" style={{ marginTop: "0.75rem" }} onClick={() => sync.mutate()} disabled={sync.isPending}>
                  <RefreshCw size={14} className={sync.isPending ? "hq-spin" : ""} /> Reindex from HQ
                </button>
              )}
            </div>
          ) : (
            <div className="hq-doc-table-wrap">
              <table className="hq-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Ver</th>
                    <th>Indexed</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id} className={`hq-clickable ${selected?.id === d.id ? "active" : ""}`} onClick={() => setSelected(d)}>
                      <td>{d.title}</td>
                      <td><StatusBadge label={sourceLabel(d.source_type)} variant="gold" /></td>
                      <td>v{d.version}</td>
                      <td>{d.embedded ? <CheckCircle2 size={15} style={{ color: "var(--hq-gold)" }} /> : <span className="hq-muted-text" style={{ fontSize: "0.72rem" }}>keyword</span>}</td>
                      <td>{new Date(d.updated_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </HqPanel>

        <div>
          {selected ? (
            detail.isLoading ? (
              <HqLoading message="Loading source…" />
            ) : detail.data ? (
              <HqPanel
                title={detail.data.document.title}
                subtitle={`${sourceLabel(detail.data.document.source_type)} · v${detail.data.document.version}`}
                headerExtra={
                  canManage && (
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {detail.data.document.status !== "approved" && (
                        <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" disabled={approve.isPending} onClick={() => approve.mutate(detail.data!.document.id)}>
                          <CheckCircle2 size={14} /> Approve
                        </button>
                      )}
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled={supersede.isPending} onClick={() => supersede.mutate(detail.data!.document.id)}>
                        Retire
                      </button>
                    </div>
                  )
                }
              >
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                  <StatusBadge label={detail.data.document.status} variant={statusVariant(detail.data.document.status)} />
                  <StatusBadge label={detail.data.document.embedded ? "Semantic indexed" : "Keyword only"} variant={detail.data.document.embedded ? "success" : "muted"} />
                  <StatusBadge label={`${detail.data.document.chunk_count} chunks`} variant="muted" />
                  {detail.data.document.effective_date && <StatusBadge label={detail.data.document.effective_date} variant="gold" />}
                </div>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.82rem", color: "var(--hq-text-muted)", margin: 0, maxHeight: 420, overflow: "auto" }}>
                  {detail.data.document.content ?? "(no content)"}
                </pre>
              </HqPanel>
            ) : (
              <HqPanel title="Source unavailable"><p className="hq-muted-text">Could not load this record.</p></HqPanel>
            )
          ) : (
            <HqPanel title="How AURA uses this" subtitle="Institutional grant writer">
              <p className="hq-muted-text" style={{ fontSize: "0.85rem" }}>
                Before drafting any grant section, AURA retrieves the most relevant IFCDC records from this knowledge base —
                budgets, program descriptions, financial reports, registration data, mission/vision, and prior approved
                narratives — and grounds the narrative in them so every proposal stays consistent.
              </p>
              <p className="hq-muted-text" style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>
                <FileText size={14} style={{ verticalAlign: "-2px" }} /> Uploads in the Document Center are learned automatically —
                the newest approved version always supersedes the old one.
              </p>
            </HqPanel>
          )}
        </div>
      </div>

      {showAdd && (
        <div className="hq-modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="hq-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "min(640px, 96vw)" }}>
            <h3>Add Knowledge</h3>
            <div className="hq-form-grid">
              <label>Type
                <select value={newDoc.sourceType} onChange={(e) => setNewDoc({ ...newDoc, sourceType: e.target.value })}>
                  {SOURCE_TYPES.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
                </select>
              </label>
              <label>Title<input value={newDoc.title} onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })} /></label>
              <label>Effective Date<input type="date" value={newDoc.effectiveDate} onChange={(e) => setNewDoc({ ...newDoc, effectiveDate: e.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Content
                <textarea rows={10} value={newDoc.content} onChange={(e) => setNewDoc({ ...newDoc, content: e.target.value })} style={{ width: "100%" }} />
              </label>
            </div>
            <div className="hq-modal-actions">
              <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button type="button" className="hq-btn hq-btn-primary" disabled={!newDoc.title || !newDoc.content || addDoc.isPending} onClick={() => addDoc.mutate()}>
                {addDoc.isPending ? "Indexing…" : "Index Knowledge"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .hq-grid-main-side { grid-template-columns: 1fr !important; }
          .hq-people-toolbar { flex-direction: column; align-items: stretch; }
          .hq-search-bar { width: 100%; }
        }
      `}</style>
    </HQLayout>
  );
};

export default KnowledgeBasePage;
