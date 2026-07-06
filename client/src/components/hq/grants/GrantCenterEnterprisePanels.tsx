import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Sparkles, FileText, AlertTriangle, RefreshCw, Zap, MessageSquare } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { KpiCard } from "../KpiCard";
import { formatCurrency } from "../../../utils/safeFormat";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { useGrantManage } from "../../../hooks/useGrantManage";

function QueryError({ message }: { message: string }) {
  return (
    <div className="hq-empty" style={{ display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "center" }}>
      <AlertTriangle size={16} /> {message}
    </div>
  );
}

export const GrantLibraryPanel: React.FC<{ onApplyTemplate?: (templateId: string) => void }> = ({ onApplyTemplate }) => {
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const library = useQuery({ queryKey: ["grant-library", category], queryFn: () => grantsApi.grantLibrary(category || undefined), staleTime: 60_000 });
  const detail = useQuery({
    queryKey: ["grant-template", selected],
    queryFn: () => grantsApi.grantTemplate(String(selected)),
    enabled: !!selected,
  });

  const templates = (library.data?.templates ?? []) as { id: string; slug: string; title: string; category: string; funder_type: string; description: string; usage_count: number }[];

  return (
    <div className="hq-fade-in">
      <HqPanel title="Grant Library" subtitle="Reusable templates for federal, state, foundation, and corporate proposals">
        <StatusBadge label="TEMPLATE LIBRARY" variant="gold" />
        <div className="hq-founder-command-strip" style={{ margin: "1rem 0" }}>
          {["", "federal", "state", "foundation", "corporate", "reporting", "budget"].map((c) => (
            <button key={c || "all"} type="button" className={`hq-btn hq-btn-sm ${category === c ? "hq-btn-primary" : "hq-btn-secondary"}`} onClick={() => setCategory(c)}>
              {c || "All"}
            </button>
          ))}
        </div>
        {library.isLoading ? <HqLoading /> : library.isError ? (
          <QueryError message="Unable to load grant templates. Refresh to retry." />
        ) : (
          <div className="hq-grid-2">
            <div>
              <table className="hq-table">
                <thead><tr><th>Template</th><th>Category</th><th>Used</th><th></th></tr></thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id}>
                      <td><button type="button" className="hq-entity-link" onClick={() => setSelected(t.id)}>{t.title}</button></td>
                      <td>{t.category}</td>
                      <td>{t.usage_count}</td>
                      <td>{onApplyTemplate && <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => onApplyTemplate(t.id)}>Use</button>}</td>
                    </tr>
                  ))}
                  {templates.length === 0 && <tr><td colSpan={4} className="hq-muted-text">No templates in this category.</td></tr>}
                </tbody>
              </table>
            </div>
            <div>
              {selected && detail.isLoading && <HqLoading />}
              {selected && detail.isError && <QueryError message="Template preview unavailable." />}
              {detail.data?.template && (
                <div className="hq-panel" style={{ padding: "1rem" }}>
                  <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}><BookOpen size={14} style={{ display: "inline" }} /> {(detail.data.template as { title: string }).title}</h4>
                  <p className="hq-muted-text" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>{String((detail.data.template as { description: string }).description)}</p>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", maxHeight: 280, overflow: "auto" }}>{String((detail.data.template as { content: string }).content ?? "")}</pre>
                </div>
              )}
            </div>
          </div>
        )}
        <p className="hq-muted-text" style={{ marginTop: "1rem", fontSize: "0.75rem" }}>
          Roadmap: winning proposal archive and Grants.gov template sync (future release).
        </p>
      </HqPanel>
    </div>
  );
};

export const GrantWriterStudioPanel: React.FC<{
  applications: { id: string; title: string }[];
  selectedApplicationId: string | null;
  onSelectApplication: (id: string) => void;
}> = ({ applications, selectedApplicationId, onSelectApplication }) => {
  const qc = useQueryClient();
  const { canManage } = useGrantManage();
  const [activeSection, setActiveSection] = useState("executive_summary");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const studio = useQuery({
    queryKey: ["grant-writer-studio", selectedApplicationId],
    queryFn: () => grantsApi.writerStudio(String(selectedApplicationId)),
    enabled: !!selectedApplicationId,
  });

  const saveSection = useMutation({
    mutationFn: ({ sectionKey, content }: { sectionKey: string; content: string }) =>
      grantsApi.saveWriterSection(String(selectedApplicationId), sectionKey, content),
    onSuccess: () => {
      setSaveError(null);
      qc.invalidateQueries({ queryKey: ["grant-writer-studio", selectedApplicationId] });
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const aiAssist = useMutation({
    mutationFn: (sectionKey: string) => grantsApi.writerAiAssist(String(selectedApplicationId), sectionKey),
    onSuccess: (data, sectionKey) => {
      const content = String((data as { content?: string; narrative?: string }).content ?? (data as { narrative?: string }).narrative ?? "");
      if (content) setDraft((d) => ({ ...d, [sectionKey]: content }));
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const generateFullDraft = useMutation({
    mutationFn: () => grantsApi.generateFullProposalDraft(String(selectedApplicationId)),
    onSuccess: () => {
      setSaveError(null);
      qc.invalidateQueries({ queryKey: ["grant-writer-studio", selectedApplicationId] });
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const sections = (studio.data?.writerSections?.sections ?? []) as { section_key: string; section_label: string; content: string }[];
  const current = sections.find((s) => s.section_key === activeSection);
  const content = draft[activeSection] ?? current?.content ?? "";

  return (
    <div className="hq-fade-in">
      <HqPanel title="Grant Writer Studio" subtitle="Draft, save, and AI-assist each narrative section">
        <div className="hq-form-grid" style={{ marginBottom: "1rem", maxWidth: 480 }}>
          <select className="hq-input" value={selectedApplicationId ?? ""} onChange={(e) => onSelectApplication(e.target.value)}>
            <option value="">Select application…</option>
            {applications.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </div>
        {!selectedApplicationId ? (
          <p className="hq-muted-text">Choose an application to open the writer workspace.</p>
        ) : studio.isLoading ? <HqLoading /> : studio.isError ? (
          <QueryError message="Writer studio failed to load. Verify the application still exists." />
        ) : (
          <>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              <StatusBadge label={`${studio.data?.writerSections?.completionPct ?? 0}% complete`} variant="gold" />
              {sections.map((s) => (
                <button key={s.section_key} type="button" className={`hq-btn hq-btn-sm ${activeSection === s.section_key ? "hq-btn-primary" : "hq-btn-secondary"}`} onClick={() => setActiveSection(s.section_key)}>
                  {s.section_label}
                </button>
              ))}
            </div>
            <textarea
              className="hq-input"
              rows={14}
              style={{ width: "100%", fontFamily: "inherit", lineHeight: 1.6 }}
              value={content}
              onChange={(e) => canManage && setDraft({ ...draft, [activeSection]: e.target.value })}
              readOnly={!canManage}
              placeholder={`Write ${current?.section_label ?? activeSection}…`}
            />
            {saveError && <p className="hq-muted-text" style={{ color: "var(--hq-danger)", marginTop: "0.5rem", fontSize: "0.8rem" }}>{saveError}</p>}
            {canManage && (
            <div className="hq-founder-command-strip" style={{ marginTop: "0.75rem" }}>
              <button type="button" className="hq-btn hq-btn-primary" disabled={saveSection.isPending} onClick={() => saveSection.mutate({ sectionKey: activeSection, content })}>
                <FileText size={14} /> {saveSection.isPending ? "Saving…" : "Save Section"}
              </button>
              <button type="button" className="hq-btn hq-btn-secondary" disabled={aiAssist.isPending} onClick={() => aiAssist.mutate(activeSection)}>
                <Sparkles size={14} /> {aiAssist.isPending ? "Drafting…" : "AURA Draft"}
              </button>
              <button type="button" className="hq-btn hq-btn-secondary" disabled={generateFullDraft.isPending} onClick={() => generateFullDraft.mutate()}>
                <Sparkles size={14} /> {generateFullDraft.isPending ? "Generating…" : "Generate Full Proposal"}
              </button>
            </div>
            )}
            <p className="hq-muted-text" style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
              All AI drafts require human review before federal submission.
            </p>
            {studio.data?.application && (
              <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>
                Opportunity: {String((studio.data.application as { opportunity_title?: string }).opportunity_title ?? "—")}
              </p>
            )}
          </>
        )}
      </HqPanel>
    </div>
  );
};

export const GrantIntelligencePanel: React.FC<{
  onStartApplication?: (applicationId: string) => void;
}> = ({ onStartApplication }) => {
  const qc = useQueryClient();
  const { canManage } = useGrantManage();
  const [auraQuestion, setAuraQuestion] = useState("");
  const [auraAnswer, setAuraAnswer] = useState<string | null>(null);

  const dashboard = useQuery({
    queryKey: ["grant-intelligence-dashboard"],
    queryFn: () => grantsApi.intelligenceDashboard(),
    refetchInterval: 60_000,
  });

  const syncIntel = useMutation({
    mutationFn: () => grantsApi.intelligenceSync(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grant-intelligence-dashboard"] });
      qc.invalidateQueries({ queryKey: ["grant-opportunity-finder"] });
      qc.invalidateQueries({ queryKey: ["grant-intelligence-feed"] });
    },
  });

  const askAura = useMutation({
    mutationFn: (q: string) => grantsApi.askGrantAura(q),
    onSuccess: (data) => setAuraAnswer(data.answer),
  });

  const startApp = useMutation({
    mutationFn: (opportunityId: string) => grantsApi.startGrantApplication(opportunityId, false),
    onSuccess: (data) => {
      if (data.applicationId) onStartApplication?.(data.applicationId);
      qc.invalidateQueries({ queryKey: ["grant-intelligence-dashboard"] });
      qc.invalidateQueries({ queryKey: ["grant-applications"] });
    },
  });

  const summary = dashboard.data?.summary;
  const feed = dashboard.data?.liveFeed ?? [];

  const quickQuestions = [
    "What grants are available today?",
    "Find grants for our Transitional Housing program.",
    "Show grants due this month.",
    "How much funding is currently in our pipeline?",
  ];

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <HqPanel
        title="Grant Intelligence Engine"
        subtitle="Live discovery, program matching, scoring, and drafting — human approval required before federal submission"
        headerExtra={
          canManage ? (
            <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" disabled={syncIntel.isPending} onClick={() => syncIntel.mutate()}>
              <RefreshCw size={14} /> {syncIntel.isPending ? "Syncing…" : "Sync Grants.gov"}
            </button>
          ) : undefined
        }
      >
        {dashboard.isLoading ? <HqLoading /> : summary ? (
          <>
            <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
              <KpiCard label="New Opportunities" value={summary.newOpportunities} variant="success" />
              <KpiCard label="Being Written" value={summary.grantsBeingWritten} variant="warning" />
              <KpiCard label="Drafts" value={summary.drafts} />
              <KpiCard label="Submitted" value={summary.submitted} />
              <KpiCard label="Awards" value={summary.awards} variant="gold" />
              <KpiCard label="Rejections" value={summary.rejections} />
              <KpiCard label="Pipeline Value" value={formatCurrency(summary.totalPipelineValue)} />
              <KpiCard label="Funding Secured" value={formatCurrency(summary.totalFundingSecured)} variant="gold" />
            </div>
            <p className="hq-muted-text" style={{ fontSize: "0.75rem", marginBottom: "0.75rem" }}>
              Last Grants.gov sync: {dashboard.data?.lastSync ? new Date(dashboard.data.lastSync).toLocaleString() : "—"}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="hq-table">
                <thead>
                  <tr><th>Opportunity</th><th>Funder</th><th>Score</th><th>Deadline</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {feed.map((o) => (
                    <tr key={String(o.id)}>
                      <td>{String(o.title ?? "")}</td>
                      <td>{String(o.funder ?? "")}</td>
                      <td><StatusBadge label={`${Number(o.compositeScore ?? 0)}%`} variant={Number(o.compositeScore) >= 70 ? "success" : "warning"} /></td>
                      <td>{o.deadline ? String(o.deadline) : "—"}</td>
                      <td>
                        {canManage && (
                          <button
                            type="button"
                            className="hq-btn hq-btn-sm hq-btn-primary"
                            disabled={startApp.isPending}
                            onClick={() => startApp.mutate(String(o.id))}
                          >
                            Start Application
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {feed.length === 0 && <tr><td colSpan={5} className="hq-muted-text">No mission-relevant opportunities in the last week. Sync Grants.gov to refresh.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <QueryError message="Grant intelligence dashboard unavailable." />
        )}
      </HqPanel>

      <HqPanel title="AURA Grant Advisor" subtitle="Ask about opportunities, program matches, deadlines, and pipeline value">
        <div className="hq-founder-command-strip" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
          {quickQuestions.map((q) => (
            <button key={q} type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => { setAuraQuestion(q); askAura.mutate(q); }}>
              {q}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <input
            className="hq-input"
            placeholder="Ask AURA about grants…"
            value={auraQuestion}
            onChange={(e) => setAuraQuestion(e.target.value)}
            style={{ flex: 1 }}
            onKeyDown={(e) => e.key === "Enter" && auraQuestion.trim() && askAura.mutate(auraQuestion.trim())}
          />
          <button type="button" className="hq-btn hq-btn-primary" disabled={!auraQuestion.trim() || askAura.isPending} onClick={() => askAura.mutate(auraQuestion.trim())}>
            <MessageSquare size={14} /> Ask
          </button>
        </div>
        {askAura.isPending && <HqLoading />}
        {auraAnswer && (
          <div className="hq-panel" style={{ padding: "1rem", background: "var(--hq-bg-subtle)", whiteSpace: "pre-wrap" }}>
            {auraAnswer}
          </div>
        )}
      </HqPanel>
    </div>
  );
};

export const GrantOpportunityFinderPanel: React.FC<{
  onStartApplication?: (applicationId: string) => void;
}> = ({ onStartApplication }) => {
  const qc = useQueryClient();
  const { canManage } = useGrantManage();
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, Record<string, unknown>>>({});
  const debouncedQ = useDebouncedValue(q, 350);
  const finder = useQuery({
    queryKey: ["grant-opportunity-finder", category, debouncedQ],
    queryFn: () => grantsApi.opportunityFinder({ category: category || undefined, q: debouncedQ || undefined }),
    staleTime: 30_000,
  });

  const scoreOpp = useMutation({
    mutationFn: (id: string) => grantsApi.scoreOpportunityIntelligence(id),
    onSuccess: (data, id) => {
      setScores((prev) => ({ ...prev, [id]: data.intelligence }));
      setScoringId(null);
    },
    onError: () => setScoringId(null),
  });

  const startApp = useMutation({
    mutationFn: (opportunityId: string) => grantsApi.startGrantApplication(opportunityId, true),
    onSuccess: (data) => {
      if (data.applicationId) onStartApplication?.(data.applicationId);
      qc.invalidateQueries({ queryKey: ["grant-applications"] });
      qc.invalidateQueries({ queryKey: ["grant-intelligence-dashboard"] });
    },
  });

  const data = finder.data as {
    categorized?: Record<string, unknown[]>;
    opportunities?: { id: string; title: string; funder: string; deadline?: string; amount_max?: number; dataSourceLabel?: string }[];
    source?: string;
    externalFeedCount?: number;
    dataSourceBreakdown?: Record<string, number>;
    integrations?: string;
  } | undefined;
  const list = category && data?.categorized?.[category] ? data.categorized[category] : (data?.opportunities ?? []);

  return (
    <HqPanel
      title="Grant Opportunity Finder"
      subtitle="Federal, state, foundation, and corporate opportunities — live API feeds and organization records only"
    >
      <div className="hq-founder-command-strip" style={{ marginBottom: "1rem", flexWrap: "wrap" }}>
        {["federal", "state", "foundation", "corporate"].map((c) => (
          <button key={c} type="button" className={`hq-btn hq-btn-sm ${category === c ? "hq-btn-primary" : "hq-btn-secondary"}`} onClick={() => setCategory(category === c ? "" : c)}>{c}</button>
        ))}
        <input className="hq-input" placeholder="Search opportunities…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 200, flex: "1 1 160px" }} />
      </div>
      {finder.isLoading ? <HqLoading /> : finder.isError ? (
        <QueryError message="Opportunity finder unavailable. Check your connection and retry." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="hq-table">
            <thead><tr><th>Title</th><th>Funder</th><th>Source</th><th>Deadline</th><th>Max Award</th><th>Match</th><th>Actions</th></tr></thead>
            <tbody>
              {(list as { id: string; title: string; funder: string; deadline?: string; amount_max?: number; dataSourceLabel?: string }[]).map((o) => {
                const intel = scores[o.id];
                return (
                <tr key={String(o.id)}>
                  <td>{o.title}</td>
                  <td>{o.funder}</td>
                  <td><span className="hq-muted-text" style={{ fontSize: "0.75rem" }}>{o.dataSourceLabel ?? "—"}</span></td>
                  <td>{o.deadline ?? "—"}</td>
                  <td>{o.amount_max ? `$${o.amount_max.toLocaleString()}` : "—"}</td>
                  <td>
                    {intel ? (
                      <StatusBadge label={`${intel.composite ?? intel.matchScore ?? 0}% · ${String(intel.priority ?? "—")}`} variant={Number(intel.composite) >= 70 ? "success" : "warning"} />
                    ) : (
                      <span className="hq-muted-text">—</span>
                    )}
                  </td>
                  <td>
                    {canManage && (
                      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="hq-btn hq-btn-sm hq-btn-secondary"
                          disabled={scoringId === o.id || scoreOpp.isPending}
                          onClick={() => { setScoringId(o.id); scoreOpp.mutate(o.id); }}
                        >
                          <Zap size={12} /> {scoringId === o.id ? "…" : "Score"}
                        </button>
                        <button
                          type="button"
                          className="hq-btn hq-btn-sm hq-btn-primary"
                          disabled={startApp.isPending}
                          onClick={() => startApp.mutate(o.id)}
                        >
                          Start Application
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );})}
              {(list as unknown[]).length === 0 && <tr><td colSpan={7} className="hq-muted-text">No opportunities match. Sync Grants.gov feeds or add opportunities manually.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.75rem" }}>
        Feed mode: {data?.source ?? "—"}
        {data?.externalFeedCount != null ? ` · ${data.externalFeedCount} live imported` : ""}
        . Grants.gov syncs live listings; foundation rows are directory references; CSR reference data is disabled in production unless configured.
      </p>
    </HqPanel>
  );
};
