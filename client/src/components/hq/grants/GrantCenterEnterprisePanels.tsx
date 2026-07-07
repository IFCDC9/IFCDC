import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Sparkles, FileText, AlertTriangle, RefreshCw, Zap, MessageSquare } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { KpiCard } from "../KpiCard";
import { formatCurrency } from "../../../utils/safeFormat";
import { fmtGrantDeadline, fmtGrantSyncDate } from "../../../utils/grantFormat";
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
  const [draftProgress, setDraftProgress] = useState<{ completed: number; total: number; status?: string } | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const autoSaveSkip = useRef(true);

  const studio = useQuery({
    queryKey: ["grant-writer-studio", selectedApplicationId],
    queryFn: () => grantsApi.writerStudio(String(selectedApplicationId)),
    enabled: !!selectedApplicationId,
    refetchInterval: draftProgress ? 3000 : false,
  });

  const versions = useQuery({
    queryKey: ["grant-writer-versions", selectedApplicationId, activeSection],
    queryFn: () => grantsApi.writerSectionVersions(String(selectedApplicationId), activeSection),
    enabled: !!selectedApplicationId && showVersions,
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
      const content = String(data.content ?? "");
      if (content) {
        setDraft((d) => ({ ...d, [sectionKey]: content }));
        saveSection.mutate({ sectionKey, content });
      }
      setSaveError(null);
      qc.invalidateQueries({ queryKey: ["grant-writer-studio", selectedApplicationId] });
      qc.invalidateQueries({ queryKey: ["grant-writer-versions", selectedApplicationId, sectionKey] });
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const generateFullDraft = useMutation({
    mutationFn: () =>
      grantsApi.generateFullProposalDraft(String(selectedApplicationId), undefined, (job) => {
        setDraftProgress({
          completed: Number(job.completed ?? 0),
          total: Number(job.total ?? 10),
          status: String(job.status ?? "running"),
        });
      }),
    onSuccess: (result) => {
      setSaveError(result.error ?? null);
      setDraftProgress(null);
      setDraft({});
      qc.invalidateQueries({ queryKey: ["grant-writer-studio", selectedApplicationId] });
    },
    onError: (err: Error) => {
      setDraftProgress(null);
      setSaveError(err.message);
    },
  });

  const restoreVersion = useMutation({
    mutationFn: (versionId: string) =>
      grantsApi.restoreWriterSectionVersion(String(selectedApplicationId), activeSection, versionId),
    onSuccess: () => {
      setDraft({});
      qc.invalidateQueries({ queryKey: ["grant-writer-studio", selectedApplicationId] });
      qc.invalidateQueries({ queryKey: ["grant-writer-versions", selectedApplicationId, activeSection] });
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const sections = (studio.data?.writerSections?.sections ?? []) as { section_key: string; section_label: string; content: string }[];
  const current = sections.find((s) => s.section_key === activeSection);
  const content = draft[activeSection] ?? current?.content ?? "";
  const debouncedContent = useDebouncedValue(content, 1500);
  const completeness = (studio.data as { proposalCompleteness?: { completionPct: number; confidence: string; missingSections: string[] } })?.proposalCompleteness;
  const activeJob = (studio.data as { activeDraftJob?: { status: string; progressPct: number; completed: number; total: number } })?.activeDraftJob;
  const founderStatus = String((studio.data?.application as { founder_approval_status?: string })?.founder_approval_status ?? "pending");

  useEffect(() => {
    if (!selectedApplicationId) return;
    autoSaveSkip.current = true;
    setDraft({});
    setSaveError(null);
    setDraftProgress(null);
  }, [selectedApplicationId, activeSection]);

  useEffect(() => {
    if (!canManage || !selectedApplicationId || autoSaveSkip.current) {
      autoSaveSkip.current = false;
      return;
    }
    if (!debouncedContent.trim() || debouncedContent === (current?.content ?? "")) return;
    saveSection.mutate({ sectionKey: activeSection, content: debouncedContent });
  }, [debouncedContent]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeJob?.status === "running") {
      setDraftProgress({
        completed: Number(activeJob.completed ?? 0),
        total: Number(activeJob.total ?? 10),
        status: "running",
      });
    }
  }, [activeJob]);

  const isGenerating = generateFullDraft.isPending || draftProgress?.status === "running" || activeJob?.status === "running";

  return (
    <div className="hq-fade-in">
      <HqPanel title="Grant Writer Studio" subtitle="AURA-powered narratives from live IFCDC data and Grants.gov opportunities">
        <div className="hq-form-grid" style={{ marginBottom: "1rem", maxWidth: 480 }}>
          <select className="hq-input" value={selectedApplicationId ?? ""} onChange={(e) => onSelectApplication(e.target.value)}>
            <option value="">Select application…</option>
            {applications.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </div>
        {!selectedApplicationId ? (
          <p className="hq-muted-text">Choose an application linked to a live grant opportunity.</p>
        ) : studio.isLoading ? <HqLoading message="Loading writer studio…" /> : studio.isError ? (
          <QueryError message="Writer studio failed to load. Verify the application still exists." />
        ) : (
          <>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem", alignItems: "center" }}>
              <StatusBadge label={`${studio.data?.writerSections?.completionPct ?? 0}% complete`} variant="gold" />
              {completeness && (
                <StatusBadge
                  label={`Confidence: ${completeness.confidence}`}
                  variant={completeness.confidence === "high" ? "success" : completeness.confidence === "medium" ? "warning" : "muted"}
                />
              )}
              <StatusBadge
                label={`Founder: ${founderStatus.replace(/_/g, " ")}`}
                variant={founderStatus === "approved" ? "success" : "warning"}
              />
              {isGenerating && (
                <StatusBadge
                  label={`AURA generating ${draftProgress?.completed ?? activeJob?.completed ?? 0}/${draftProgress?.total ?? activeJob?.total ?? 10}…`}
                  variant="warning"
                />
              )}
              {saveSection.isPending && <StatusBadge label="Auto-saving…" variant="muted" />}
            </div>
            {completeness?.missingSections?.length ? (
              <p className="hq-muted-text" style={{ fontSize: "0.75rem", marginBottom: "0.75rem" }}>
                Missing sections: {completeness.missingSections.join(", ")}
              </p>
            ) : null}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
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
              readOnly={!canManage || isGenerating}
              placeholder={`Write ${current?.section_label ?? activeSection}…`}
            />
            {saveError && (
              <p className="hq-muted-text" style={{ color: "var(--hq-danger)", marginTop: "0.5rem", fontSize: "0.8rem" }}>
                {saveError}
              </p>
            )}
            {canManage && (
            <div className="hq-founder-command-strip" style={{ marginTop: "0.75rem" }}>
              <button type="button" className="hq-btn hq-btn-primary" disabled={saveSection.isPending || isGenerating} onClick={() => saveSection.mutate({ sectionKey: activeSection, content })}>
                <FileText size={14} /> Save Section
              </button>
              <button type="button" className="hq-btn hq-btn-secondary" disabled={aiAssist.isPending || isGenerating} onClick={() => aiAssist.mutate(activeSection)}>
                <Sparkles size={14} /> {aiAssist.isPending ? "AURA drafting…" : "AURA Draft"}
              </button>
              <button type="button" className="hq-btn hq-btn-secondary" disabled={isGenerating} onClick={() => generateFullDraft.mutate()}>
                <Sparkles size={14} /> {isGenerating ? "Generating full proposal…" : "Generate Full Proposal"}
              </button>
              <button type="button" className="hq-btn hq-btn-ghost" onClick={() => setShowVersions((v) => !v)}>
                {showVersions ? "Hide" : "Version"} History
              </button>
            </div>
            )}
            {showVersions && (
              <div style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>
                {versions.isLoading ? <HqLoading message="Loading versions…" /> : (
                  <ul className="hq-activity-list">
                    {(versions.data?.versions ?? []).map((v) => (
                      <li key={v.id} className="hq-activity-item">
                        <div className="hq-activity-content">
                          <div className="hq-activity-title">{v.source} · {v.word_count} words</div>
                          <div className="hq-activity-detail">{new Date(v.created_at).toLocaleString()} {v.created_by ? `· ${v.created_by}` : ""}</div>
                        </div>
                        {canManage && (
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled={restoreVersion.isPending} onClick={() => restoreVersion.mutate(v.id)}>
                            Restore
                          </button>
                        )}
                      </li>
                    ))}
                    {!versions.data?.versions?.length && <li className="hq-muted-text">No prior versions for this section.</li>}
                  </ul>
                )}
              </div>
            )}
            <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.75rem" }}>
              AURA uses live IFCDC organizational data, SAM.gov status, Grants.gov opportunity details, and prior approved narratives.
              Sections auto-save. <strong>Founder approval is required before any federal submission.</strong>
            </p>
            {studio.data?.application && (
              <p className="hq-muted-text" style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
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
  const [matchSort, setMatchSort] = useState<"fit" | "funding" | "deadline">("fit");
  const [programFilter, setProgramFilter] = useState("");
  const [selectedQueueProgram, setSelectedQueueProgram] = useState("");

  const dashboard = useQuery({
    queryKey: ["grant-intelligence-dashboard"],
    queryFn: () => grantsApi.intelligenceDashboard(),
    refetchInterval: 60_000,
  });

  const orgMatches = useQuery({
    queryKey: ["grant-org-matches", matchSort, programFilter],
    queryFn: () =>
      grantsApi.orgWideGrantMatches({
        sort: matchSort,
        limit: 20,
        programSlug: programFilter || undefined,
      }),
    staleTime: 30_000,
  });

  const programQueues = useQuery({
    queryKey: ["grant-program-queues", selectedQueueProgram],
    queryFn: () =>
      grantsApi.programGrantQueues({
        programSlug: selectedQueueProgram || undefined,
        limitPerStage: 5,
      }),
    staleTime: 30_000,
  });

  const syncIntel = useMutation({
    mutationFn: () => grantsApi.intelligenceSync(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grant-intelligence-dashboard"] });
      qc.invalidateQueries({ queryKey: ["grant-opportunity-finder"] });
      qc.invalidateQueries({ queryKey: ["grant-intelligence-feed"] });
      qc.invalidateQueries({ queryKey: ["grant-org-matches"] });
      qc.invalidateQueries({ queryKey: ["grant-program-queues"] });
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
      qc.invalidateQueries({ queryKey: ["grant-program-queues"] });
    },
  });

  const summary = dashboard.data?.summary;
  const feed = dashboard.data?.liveFeed ?? [];
  const programs = dashboard.data?.programs ?? orgMatches.data?.programs ?? [];
  const matches = orgMatches.data?.matches ?? [];
  const queueProgram = selectedQueueProgram
    ? programQueues.data?.programs.find((p) => p.programSlug === selectedQueueProgram)
    : programQueues.data?.programs[0];

  const quickQuestions = [
    "Find grants for the whole IFCDC project",
    "Find grants for HR and staffing",
    "Find grants for transitional housing",
    "Find grants for software and technology",
    "Show grants due soon",
    "Rank all grants by best fit",
    "Start applications for the top five matches",
    "Draft this grant for founder approval",
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
            <div className="hq-table-scroll">
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
                      <td>{fmtGrantDeadline(o.deadline ? String(o.deadline) : null)}</td>
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

      <HqPanel
        title="Organization-Wide Grant Matching"
        subtitle="Live ranked matches across every IFCDC program, department, HR need, and operational area"
        headerExtra={
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {(["fit", "funding", "deadline"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`hq-btn hq-btn-sm ${matchSort === s ? "hq-btn-primary" : "hq-btn-secondary"}`}
                onClick={() => setMatchSort(s)}
              >
                {s === "fit" ? "Best Fit" : s === "funding" ? "Highest Funding" : "Due Soon"}
              </button>
            ))}
          </div>
        }
      >
        <div className="hq-founder-command-strip" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className={`hq-btn hq-btn-sm ${!programFilter ? "hq-btn-primary" : "hq-btn-secondary"}`}
            onClick={() => setProgramFilter("")}
          >
            All IFCDC
          </button>
          {programs.slice(0, 12).map((p) => (
            <button
              key={p.slug}
              type="button"
              className={`hq-btn hq-btn-sm ${programFilter === p.slug ? "hq-btn-primary" : "hq-btn-secondary"}`}
              onClick={() => setProgramFilter(p.slug)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {orgMatches.isLoading ? <HqLoading /> : orgMatches.isError ? (
          <QueryError message="Organization-wide grant matching unavailable." />
        ) : (
          <div className="hq-table-scroll">
            <table className="hq-table">
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Best Program</th>
                  <th>Match</th>
                  <th>Eligibility</th>
                  <th>Funding</th>
                  <th>Deadline</th>
                  <th>Priority</th>
                  <th>Next Step</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m) => (
                  <tr key={m.opportunityId}>
                    <td>
                      <div>{m.title}</div>
                      <div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>{m.funder}</div>
                    </td>
                    <td>{m.bestProgram.label}</td>
                    <td><StatusBadge label={`${m.matchScore}%`} variant={m.matchScore >= 70 ? "success" : "warning"} /></td>
                    <td>{m.eligibility.grade}</td>
                    <td>{formatCurrency(m.fundingAmount.max ?? m.fundingAmount.min ?? 0)}</td>
                    <td>{fmtGrantDeadline(m.deadline)}</td>
                    <td><StatusBadge label={m.priority.toUpperCase()} variant={m.priority === "high" ? "gold" : m.priority === "medium" ? "warning" : "muted"} /></td>
                    <td style={{ fontSize: "0.8rem", maxWidth: 180 }}>{m.recommendedNextStep}</td>
                    <td>
                      {canManage && (
                        <button
                          type="button"
                          className="hq-btn hq-btn-sm hq-btn-primary"
                          disabled={startApp.isPending}
                          onClick={() => startApp.mutate(m.opportunityId)}
                        >
                          Start
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {matches.length === 0 && (
                  <tr><td colSpan={9} className="hq-muted-text">No matches yet. Sync Grants.gov to discover live opportunities.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.75rem" }}>
          Scored {orgMatches.data?.totalScored ?? 0} opportunities · Founder approval required before any submission
        </p>
      </HqPanel>

      <HqPanel title="Program Funding Queues" subtitle="Per-program pipeline: new matches → drafting → review → approval → submitted → awarded">
        <div className="hq-founder-command-strip" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <select
            className="hq-input hq-btn-sm"
            value={selectedQueueProgram}
            onChange={(e) => setSelectedQueueProgram(e.target.value)}
            style={{ minWidth: 220 }}
          >
            <option value="">First active program</option>
            {programs.map((p) => (
              <option key={p.slug} value={p.slug}>{p.label}</option>
            ))}
          </select>
        </div>
        {programQueues.isLoading ? <HqLoading /> : queueProgram ? (
          <div className="hq-grid-2" style={{ gap: "0.75rem" }}>
            {(["new_matches", "drafting", "review", "ready_for_approval", "submitted", "awarded", "declined"] as const).map((stage) => {
              const label =
                stage === "new_matches" ? "New Matches"
                : stage === "ready_for_approval" ? "Ready for Approval"
                : stage.charAt(0).toUpperCase() + stage.slice(1);
              const items = queueProgram.queues[stage] ?? [];
              return (
                <div key={stage} className="hq-panel" style={{ padding: "0.75rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                    <strong style={{ fontSize: "0.85rem" }}>{label}</strong>
                    <StatusBadge label={String(queueProgram.totals[stage] ?? items.length)} variant="muted" />
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "1rem", fontSize: "0.8rem" }}>
                    {items.slice(0, 4).map((item, i) => (
                      <li key={String(item.opportunityId ?? item.applicationId ?? i)} style={{ marginBottom: "0.25rem" }}>
                        {String(item.title ?? "")}
                      </li>
                    ))}
                    {items.length === 0 && <li className="hq-muted-text">None</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : (
          <QueryError message="Program queues unavailable." />
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
        <div className="hq-table-scroll">
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
                  <td>{fmtGrantDeadline(o.deadline ? String(o.deadline) : null)}</td>
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
