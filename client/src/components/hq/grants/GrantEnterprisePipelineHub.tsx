import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Filter, Sparkles, CheckCircle, XCircle, ArrowRight, AlertTriangle } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { KpiCard } from "../KpiCard";
import { StatusBadge } from "../StatusBadge";
import { GrantSubNav } from "./GrantSubNav";
import { GrantQueryBoundary } from "./GrantQueryBoundary";
import { fmtGrantDeadline, fmtGrantAmount, fmtGrantSyncDate } from "../../../utils/grantFormat";
import { formatCurrency } from "../../../utils/safeFormat";
import { useGrantManage } from "../../../hooks/useGrantManage";

const fmt = formatCurrency;

const PIPELINE_QUERY_OPTS = {
  retry: 0,
  staleTime: 45_000,
  refetchOnWindowFocus: false,
} as const;

export const GrantEnterprisePipelineHub: React.FC<{
  onOpenApplication?: (applicationId: string) => void;
}> = ({ onOpenApplication }) => {
  const qc = useQueryClient();
  const { canManage } = useGrantManage();
  const [section, setSection] = useState<"board" | "metrics" | "founder" | "intelligence">("board");
  const [selectedOpp, setSelectedOpp] = useState<string | null>(null);
  const [filters, setFilters] = useState({ program: "", agency: "", status: "", priority: "", q: "" });

  const metrics = useQuery({
    queryKey: ["pipeline-enterprise-metrics"],
    queryFn: () => grantsApi.pipelineMetrics(),
    ...PIPELINE_QUERY_OPTS,
    refetchInterval: 60_000,
  });

  const board = useQuery({
    queryKey: ["pipeline-enterprise-board"],
    queryFn: () => grantsApi.pipelineBoard(),
    ...PIPELINE_QUERY_OPTS,
    refetchInterval: 60_000,
  });

  const founder = useQuery({
    queryKey: ["pipeline-founder", filters],
    queryFn: () => grantsApi.founderCommandCenter({
      program: filters.program || undefined,
      agency: filters.agency || undefined,
      status: filters.status || undefined,
      priority: filters.priority || undefined,
      q: filters.q || undefined,
    }),
    enabled: section === "founder",
    ...PIPELINE_QUERY_OPTS,
  });

  const intelligence = useQuery({
    queryKey: ["pipeline-intelligence", selectedOpp],
    queryFn: () => grantsApi.pipelineIntelligence(String(selectedOpp)),
    enabled: section === "intelligence" && !!selectedOpp,
    retry: 0,
    staleTime: 60_000,
  });

  const syncPipeline = useMutation({
    mutationFn: () => grantsApi.pipelineSync(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline-enterprise-metrics"] });
      qc.invalidateQueries({ queryKey: ["pipeline-enterprise-board"] });
      qc.invalidateQueries({ queryKey: ["pipeline-founder"] });
    },
  });

  const founderDecision = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      grantsApi.founderPipelineDecision(id, decision),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline-founder"] }),
  });

  const setPriority = useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: "high" | "medium" | "low" }) =>
      grantsApi.setPipelinePriority(id, priority),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline-founder"] }),
  });

  const m = metrics.data?.metrics;
  const feedSync = metrics.data?.feedSync ?? [];
  const grantsGovSync = feedSync.find((f) => f.provider === "grants_gov");
  const pipelineHasData = (board.data?.columns ?? []).some((c) => c.count > 0 || c.items.length > 0);

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <HqPanel
        title="Enterprise Funding Pipeline"
        subtitle="Live Grants.gov · SAM.gov · foundation feeds — 12-stage workflow with founder command"
        headerExtra={
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            {grantsGovSync?.last_sync_at && (
              <span className="hq-muted-text" style={{ fontSize: "0.72rem" }}>
                Grants.gov sync {fmtGrantSyncDate(grantsGovSync.last_sync_at)}
              </span>
            )}
            {canManage && (
              <button
                type="button"
                className="hq-btn hq-btn-sm hq-btn-secondary"
                disabled={syncPipeline.isPending}
                onClick={() => syncPipeline.mutate()}
              >
                <RefreshCw size={14} /> {syncPipeline.isPending ? "Syncing…" : "Sync Pipeline"}
              </button>
            )}
          </div>
        }
      >
        {syncPipeline.isError && (
          <div className="hq-empty" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", color: "var(--hq-warning)" }}>
            <AlertTriangle size={14} />
            {(syncPipeline.error as Error)?.message ?? "Pipeline sync failed — try again."}
          </div>
        )}
        <GrantQueryBoundary
          query={metrics}
          title="Pipeline metrics unavailable"
          message="Live funding metrics could not be loaded. The pipeline board may still show cached stage data below."
          loadingMessage="Loading pipeline metrics…"
        >
          {m ? (
            <div className="hq-kpi-grid">
              <KpiCard label="Active Opportunities" value={m.totalOpportunities} variant="success" />
              <KpiCard label="Pipeline Value" value={fmt(m.totalPipelineValue)} />
              <KpiCard label="Est. Potential" value={fmt(m.estimatedPotentialFunding)} variant="gold" />
              <KpiCard label="In Progress" value={m.applicationsInProgress} variant="warning" />
              <KpiCard label="Awards" value={m.awardsReceived} variant="gold" />
              <KpiCard label="Awarded Value" value={fmt(m.totalAwardedValue)} variant="success" />
              <KpiCard label="Success Rate" value={`${m.successRate}%`} />
              <KpiCard label="Upcoming Deadlines" value={m.upcomingDeadlineCount} variant={m.upcomingDeadlineCount > 0 ? "warning" : "success"} />
            </div>
          ) : (
            <p className="hq-muted-text">No pipeline metrics returned — use Sync Pipeline to refresh from Grants.gov.</p>
          )}
        </GrantQueryBoundary>
      </HqPanel>

      <GrantSubNav
        items={[
          { id: "board", label: "Live Pipeline" },
          { id: "metrics", label: "Metrics & Reports" },
          { id: "founder", label: "Founder Command" },
          { id: "intelligence", label: "AI Intelligence" },
        ]}
        active={section}
        onChange={(id) => setSection(id as typeof section)}
      />

      {section === "board" && (
        <GrantQueryBoundary
          query={board}
          title="Live pipeline board unavailable"
          message="The 12-stage funding pipeline could not be loaded from headquarters."
          loadingMessage="Loading live pipeline board…"
        >
          {(board.data?.columns ?? []).length === 0 || !pipelineHasData ? (
            <HqPanel title="Live Pipeline">
              <p className="hq-muted-text" style={{ textAlign: "center", padding: "1.5rem" }}>
                No pipeline stages loaded yet. Click <strong>Sync Pipeline</strong> to import live opportunities from Grants.gov and SAM.gov.
              </p>
            </HqPanel>
          ) : (
            <div className="hq-pipeline-board">
              {(board.data?.columns ?? []).map((col) => (
                <div key={col.stageKey} className="hq-pipeline-column">
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.35rem" }}>
                    <strong style={{ fontSize: "0.8rem" }}>{col.label}</strong>
                    <span className="hq-muted-text" style={{ fontSize: "0.72rem" }}>{col.count}</span>
                  </div>
                  <div className="hq-muted-text" style={{ fontSize: "0.72rem", marginBottom: "0.5rem" }}>{fmt(col.value)}</div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    {col.items.map((item) => (
                      <li key={`${item.entityType}-${item.id}`}>
                        <button
                          type="button"
                          className="hq-btn hq-btn-ghost"
                          style={{ width: "100%", textAlign: "left", padding: "0.45rem", fontSize: "0.78rem", border: "1px solid var(--hq-border)", borderRadius: 6 }}
                          onClick={() => {
                            if (item.entityType === "application") onOpenApplication?.(item.id);
                            else { setSelectedOpp(item.id); setSection("intelligence"); }
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{item.title.slice(0, 48)}{item.title.length > 48 ? "…" : ""}</div>
                          <div className="hq-muted-text" style={{ fontSize: "0.68rem" }}>{item.funder.slice(0, 30)} · {fmt(item.amount)}</div>
                          {item.matchScore > 0 && <div className="hq-muted-text" style={{ fontSize: "0.68rem" }}>Match {item.matchScore}%</div>}
                          <div className="hq-muted-text" style={{ fontSize: "0.68rem" }}>{fmtGrantDeadline(item.deadline)}</div>
                        </button>
                      </li>
                    ))}
                    {!col.items.length && <li className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Empty</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </GrantQueryBoundary>
      )}

      {section === "metrics" && (
        metrics.isError ? (
          <GrantQueryBoundary query={metrics} title="Metrics unavailable" message="Funding reports could not be loaded." />
        ) : metrics.data ? (
          <div className="hq-grid-2">
            <HqPanel title="Funding by Program">
              <ul className="hq-activity-list">
                {(metrics.data.byProgram ?? []).slice(0, 10).map((p: { label: string; count: number; value: number }) => (
                  <li key={p.label} className="hq-activity-item">
                    <div className="hq-activity-content"><div className="hq-activity-title">{p.label}</div><div className="hq-activity-detail">{p.count} entities</div></div>
                    <div className="hq-activity-time">{fmt(p.value)}</div>
                  </li>
                ))}
                {!(metrics.data.byProgram ?? []).length && (
                  <li className="hq-activity-item"><div className="hq-muted-text">No program assignments yet.</div></li>
                )}
              </ul>
            </HqPanel>
            <HqPanel title="Funding by Agency">
              <ul className="hq-activity-list">
                {(metrics.data.byAgency ?? []).slice(0, 10).map((a: { agency: string; count: number; value: number }) => (
                  <li key={a.agency} className="hq-activity-item">
                    <div className="hq-activity-content"><div className="hq-activity-title">{a.agency}</div><div className="hq-activity-detail">{a.count} opportunities</div></div>
                    <div className="hq-activity-time">{fmt(a.value)}</div>
                  </li>
                ))}
              </ul>
            </HqPanel>
            <HqPanel title="By Pipeline Status">
              <ul className="hq-activity-list">
                {(metrics.data.byStatus ?? []).map((s: { label: string; count: number }) => (
                  <li key={s.label} className="hq-activity-item">
                    <div className="hq-activity-content"><div className="hq-activity-title">{s.label}</div></div>
                    <div className="hq-activity-time">{s.count}</div>
                  </li>
                ))}
              </ul>
            </HqPanel>
            <HqPanel title="Upcoming Deadlines">
              <ul className="hq-activity-list">
                {(metrics.data.upcomingDeadlines ?? []).slice(0, 8).map((d: Record<string, unknown>) => (
                  <li key={String(d.id)} className="hq-activity-item">
                    <div className="hq-activity-content"><div className="hq-activity-title">{String(d.title)}</div><div className="hq-activity-detail">{String(d.funder)}</div></div>
                    <div className="hq-activity-time">{fmtGrantDeadline(d.deadline ? String(d.deadline) : null)}</div>
                  </li>
                ))}
                {!(metrics.data.upcomingDeadlines ?? []).length && (
                  <li className="hq-activity-item"><div className="hq-muted-text">No upcoming deadlines in the next window.</div></li>
                )}
              </ul>
            </HqPanel>
          </div>
        ) : null
      )}

      {section === "founder" && (
        <HqPanel title="Founder Command Center" subtitle={`${founder.data?.pendingApprovalCount ?? 0} pending approval`}>
          <div className="hq-founder-command-strip" style={{ marginBottom: "1rem", flexWrap: "wrap" }}>
            <Filter size={14} />
            <select className="hq-input" value={filters.program} onChange={(e) => setFilters({ ...filters, program: e.target.value })}>
              <option value="">All programs</option>
              {(metrics.data?.programs ?? []).map((p: { slug: string; label: string }) => (
                <option key={p.slug} value={p.slug}>{p.label}</option>
              ))}
            </select>
            <input className="hq-input" placeholder="Agency…" value={filters.agency} onChange={(e) => setFilters({ ...filters, agency: e.target.value })} />
            <select className="hq-input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">All statuses</option>
              {(board.data?.columns ?? []).map((c) => (
                <option key={c.stageKey} value={c.stageKey}>{c.label}</option>
              ))}
            </select>
            <select className="hq-input" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
              <option value="">All priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <input className="hq-input" placeholder="Search…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </div>
          <GrantQueryBoundary query={founder} title="Founder command center unavailable" loadingMessage="Loading applications for review…">
            <div className="hq-table-scroll">
              <table className="hq-table">
                <thead>
                  <tr><th>Application</th><th>Program</th><th>Agency</th><th>Amount</th><th>Status</th><th>Deadline</th><th>Priority</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {(founder.data?.applications ?? []).map((a: Record<string, unknown>) => (
                    <tr key={String(a.id)}>
                      <td><strong>{String(a.title)}</strong></td>
                      <td>{String(a.programLabel ?? "—")}</td>
                      <td>{String(a.funder ?? "—")}</td>
                      <td>{fmtGrantAmount(null, Number(a.amount_requested ?? a.amount_max ?? 0))}</td>
                      <td><StatusBadge label={String(a.pipelineLabel ?? a.pipeline_stage)} variant="muted" /></td>
                      <td>{fmtGrantDeadline(a.deadline ? String(a.deadline) : null)}</td>
                      <td>
                        {canManage && (
                          <select className="hq-input hq-input-sm" value={String(a.founder_priority ?? "medium")} onChange={(e) => setPriority.mutate({ id: String(a.id), priority: e.target.value as "high" | "medium" | "low" })}>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                        )}
                      </td>
                      <td>
                        {canManage && (
                          <div style={{ display: "flex", gap: "0.35rem" }}>
                            <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => { founderDecision.mutate({ id: String(a.id), decision: "approve" }); onOpenApplication?.(String(a.id)); }}>
                              <CheckCircle size={12} /> Approve
                            </button>
                            <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={() => founderDecision.mutate({ id: String(a.id), decision: "reject" })}>
                              <XCircle size={12} /> Reject
                            </button>
                            <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => onOpenApplication?.(String(a.id))}>
                              <ArrowRight size={12} /> Open
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!(founder.data?.applications ?? []).length && (
                    <tr><td colSpan={8} className="hq-muted-text">No applications match filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </GrantQueryBoundary>
        </HqPanel>
      )}

      {section === "intelligence" && (
        <HqPanel title="AI Grant Intelligence" subtitle="Select an opportunity from the pipeline board">
          <input className="hq-input" placeholder="Opportunity ID (click a card on Live Pipeline)" value={selectedOpp ?? ""} onChange={(e) => setSelectedOpp(e.target.value || null)} style={{ marginBottom: "1rem", maxWidth: 480 }} />
          {!selectedOpp ? (
            <p className="hq-muted-text">Click an opportunity on the Live Pipeline board to analyze it here.</p>
          ) : (
            <GrantQueryBoundary query={intelligence} title="AI intelligence unavailable" loadingMessage="Analyzing opportunity…">
              {intelligence.data ? (
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div className="hq-kpi-grid">
                    <KpiCard label="Match Score" value={`${intelligence.data.matchScore}%`} variant="gold" />
                    <KpiCard label="Eligibility" value={`${(intelligence.data.eligibilityAnalysis as { score?: number })?.score ?? 0}%`} />
                    <KpiCard label="Risk" value={String((intelligence.data.riskAssessment as { level?: string })?.level ?? "—")} variant={(intelligence.data.riskAssessment as { level?: string })?.level === "high" ? "danger" : "success"} />
                    <KpiCard label="Prep Time" value={String(intelligence.data.estimatedPreparationTime ?? "—")} />
                  </div>
                  <div><strong>Eligibility:</strong> {(intelligence.data.eligibilityAnalysis as { summary?: string })?.summary}</div>
                  <div><strong>Match factors:</strong>
                    <ul>{((intelligence.data.matchExplanation ?? []) as { label: string; value: string }[]).map((f, i) => <li key={i}>{f.label}: {f.value}</li>)}</ul>
                  </div>
                  <div><strong>Required documents:</strong> {((intelligence.data.requiredDocuments ?? []) as string[]).join(", ")}</div>
                  {((intelligence.data.missingRequirements ?? []) as string[]).length > 0 && (
                    <div><strong>Missing:</strong> {((intelligence.data.missingRequirements ?? []) as string[]).join(", ")}</div>
                  )}
                  <div><strong>Next steps:</strong>
                    <ul>{((intelligence.data.recommendedNextSteps ?? []) as string[]).map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                  <div><Sparkles size={14} style={{ verticalAlign: "middle" }} /> <strong>Risk factors:</strong> {((intelligence.data.riskAssessment as { factors?: string[] })?.factors ?? []).join(" · ")}</div>
                </div>
              ) : (
                <p className="hq-muted-text">No intelligence data for this opportunity.</p>
              )}
            </GrantQueryBoundary>
          )}
        </HqPanel>
      )}
    </div>
  );
};
