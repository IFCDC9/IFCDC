import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Brain,
  Compass,
  HeartPulse,
  Lightbulb,
  MessageSquare,
  Shield,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { hqApi } from "../../api/hqApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqApiError } from "../../api/hqApiFetch";

type TabId = "overview" | "briefings" | "health" | "recommendations" | "predictions" | "chat";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Command Overview" },
  { id: "briefings", label: "Executive Briefings" },
  { id: "health", label: "Health Analyzer" },
  { id: "recommendations", label: "Recommendations" },
  { id: "predictions", label: "Predictive Analytics" },
  { id: "chat", label: "Executive Chat" },
];

const BRIEFING_OPTIONS = [
  { id: "morning", label: "Morning Executive Briefing" },
  { id: "evening", label: "Evening Operations Summary" },
  { id: "daily", label: "Daily Executive Report" },
  { id: "weekly", label: "Weekly Executive Report" },
  { id: "monthly", label: "Monthly Organizational Report" },
  { id: "quarterly", label: "Quarterly Performance Review" },
  { id: "annual", label: "Annual Organizational Review" },
  { id: "ops", label: "Operations Summary" },
] as const;

const SUGGESTED_QUESTIONS = [
  "What is the biggest risk today?",
  "Why is System Health only partially healthy?",
  "Which integrations are failing?",
  "Which grants need attention?",
  "What projects are behind schedule?",
  "What policies are due for review?",
  "Which department needs assistance?",
  "What should leadership focus on next?",
];

function healthVariant(score: number): "success" | "warning" | "danger" | "gold" {
  if (score >= 85) return "success";
  if (score >= 65) return "gold";
  if (score >= 45) return "warning";
  return "danger";
}

function riskVariant(level: string): "success" | "warning" | "danger" | "muted" {
  const l = level.toLowerCase();
  if (l === "critical" || l === "high") return "danger";
  if (l === "medium") return "warning";
  if (l === "low") return "success";
  return "muted";
}

function errorMessage(err: unknown): string {
  if (err instanceof HqApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Request failed.";
}

function BriefingBody({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return <p className="hq-muted-text">Select a briefing type to generate.</p>;
  if (typeof data.briefing === "string") return <pre className="hq-code-block">{data.briefing}</pre>;
  if (typeof data.summary === "string") return <pre className="hq-code-block">{data.summary}</pre>;
  if (typeof data.content === "string") return <pre className="hq-code-block">{data.content}</pre>;
  if (typeof data.narrative === "string") {
    return (
      <div>
        <p>{data.narrative}</p>
        <pre className="hq-code-block" style={{ marginTop: "0.75rem" }}>{JSON.stringify(data, null, 2)}</pre>
      </div>
    );
  }
  if (Array.isArray(data.highlights) || Array.isArray(data.priorities)) {
    return (
      <div>
        {typeof data.greeting === "string" && <p><strong>{data.greeting}</strong></p>}
        {Array.isArray(data.priorities) && data.priorities.length > 0 && (
          <>
            <h4>Priorities</h4>
            <ul>{(data.priorities as string[]).map((p) => <li key={p}>{p}</li>)}</ul>
          </>
        )}
        {Array.isArray(data.highlights) && data.highlights.length > 0 && (
          <>
            <h4>Highlights</h4>
            <ul>{(data.highlights as string[]).map((h) => <li key={h}>{h}</li>)}</ul>
          </>
        )}
        <pre className="hq-code-block" style={{ marginTop: "0.75rem" }}>{JSON.stringify(data, null, 2)}</pre>
      </div>
    );
  }
  return <pre className="hq-code-block">{JSON.stringify(data, null, 2)}</pre>;
}

const AuraExecutiveIntelligencePage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab") as TabId | null;
  const pillarParam = params.get("pillar");
  const [tab, setTab] = useState<TabId>(tabParam && TABS.some((t) => t.id === tabParam) ? tabParam : "overview");
  const [briefingType, setBriefingType] = useState<string>("morning");
  const [selectedPillar, setSelectedPillar] = useState(pillarParam || "organization");
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<Array<{ q: string; a: string; knowledgeUsed?: number; source?: string }>>([]);

  useEffect(() => {
    if (tabParam && TABS.some((t) => t.id === tabParam)) setTab(tabParam);
  }, [tabParam]);

  useEffect(() => {
    if (pillarParam) {
      setSelectedPillar(pillarParam);
      setTab("health");
    }
  }, [pillarParam]);

  const dashboard = useQuery({
    queryKey: ["aura-ei-dashboard"],
    queryFn: hqApi.auraEiDashboard,
    staleTime: 60_000,
  });

  const recommendations = useQuery({
    queryKey: ["aura-ei-recommendations"],
    queryFn: hqApi.auraEiRecommendations,
    enabled: tab === "recommendations" || tab === "overview",
    staleTime: 60_000,
  });

  const predictions = useQuery({
    queryKey: ["aura-ei-predictions"],
    queryFn: hqApi.auraEiPredictions,
    enabled: tab === "predictions" || tab === "overview",
    staleTime: 90_000,
  });

  const pillarExplain = useQuery({
    queryKey: ["aura-ei-pillar", selectedPillar],
    queryFn: () => hqApi.auraEiHealthPillar(selectedPillar),
    enabled: tab === "health",
    staleTime: 45_000,
  });

  const briefingQuery = useQuery({
    queryKey: ["aura-ei-briefing", briefingType],
    queryFn: () => hqApi.auraEiBriefing(briefingType),
    enabled: tab === "briefings",
    staleTime: 120_000,
  });

  const askMutation = useMutation({
    mutationFn: (question: string) => hqApi.auraEiAsk(question),
    onSuccess: (data, question) => {
      setChatHistory((prev) => [
        { q: question, a: data.answer, knowledgeUsed: data.knowledgeUsed, source: data.source },
        ...prev,
      ].slice(0, 12));
      setChatInput("");
    },
  });

  const pillars = useMemo(() => {
    const list = (dashboard.data?.pillars as Array<Record<string, unknown>> | undefined) ?? [];
    return list;
  }, [dashboard.data]);

  const monitoring = (dashboard.data?.monitoring as Record<string, unknown> | undefined) ?? {};
  const topRec = dashboard.data?.topRecommendation as Record<string, unknown> | null | undefined;
  const recList = (recommendations.data?.recommendations
    ?? (dashboard.data?.recommendations as Record<string, unknown>[] | undefined)
    ?? []) as Record<string, unknown>[];

  function selectTab(next: TabId) {
    setTab(next);
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    if (next !== "health") nextParams.delete("pillar");
    setParams(nextParams, { replace: true });
  }

  function openPillar(id: string) {
    setSelectedPillar(id);
    setTab("health");
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", "health");
    nextParams.set("pillar", id);
    setParams(nextParams, { replace: true });
  }

  return (
    <HQLayout
      title="AURA Executive Intelligence"
      subtitle="Enterprise AI Command Center — briefings, health, predictions, and executive decision support"
      auraModule="executive-intelligence"
    >
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <Link to="/hq/aura" className="hq-btn hq-btn-secondary hq-btn-sm"><Sparkles size={14} /> AURA Chat</Link>
        <Link to="/hq/intelligence" className="hq-btn hq-btn-ghost hq-btn-sm"><Brain size={14} /> Intelligence</Link>
        <Link to="/hq/operations" className="hq-btn hq-btn-ghost hq-btn-sm"><Activity size={14} /> Operations</Link>
      </div>

      <div className="hq-tabs" role="tablist" style={{ marginBottom: "1rem" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className={`hq-tab${tab === t.id ? " active" : ""}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {dashboard.isLoading && tab === "overview" && <HqLoading message="Loading Executive Intelligence…" />}
      {dashboard.isError && (
        <div className="hq-alert hq-alert-danger" style={{ marginBottom: "1rem" }}>{errorMessage(dashboard.error)}</div>
      )}

      {tab === "overview" && dashboard.data && (
        <div className="hq-fade-in">
          <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
            <KpiCard
              label="Organization Health"
              value={`${Number(dashboard.data.overallHealth ?? 0)}/100`}
              icon={HeartPulse}
              variant={healthVariant(Number(dashboard.data.overallHealth ?? 0))}
              meta={`Grade ${String(dashboard.data.grade ?? "—")}`}
            />
            <KpiCard
              label="Compliance due soon"
              value={Number(monitoring.complianceDueSoon ?? 0)}
              icon={Shield}
              variant={Number(monitoring.complianceOverdue ?? 0) > 0 ? "danger" : "gold"}
              meta={`${Number(monitoring.complianceOverdue ?? 0)} overdue`}
            />
            <KpiCard
              label="Financial risk"
              value={String(monitoring.financialRiskLevel ?? "—")}
              icon={AlertTriangle}
              variant={riskVariant(String(monitoring.financialRiskLevel ?? "low"))}
            />
            <KpiCard
              label="Open tasks"
              value={Number((monitoring.openTasks as { total?: number } | undefined)?.total ?? 0)}
              icon={Activity}
              meta={`${Number((monitoring.openTasks as { overdue?: number } | undefined)?.overdue ?? 0)} overdue`}
            />
          </div>

          <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
            {pillars.map((p) => (
              <button
                key={String(p.id)}
                type="button"
                className="hq-kpi-card hq-kpi-clickable"
                onClick={() => openPillar(String(p.id))}
                style={{ textAlign: "left", cursor: "pointer", border: "none", background: "inherit", width: "100%" }}
              >
                <KpiCard
                  label={String(p.label)}
                  value={`${Number(p.score)}/100`}
                  icon={Activity}
                  variant={healthVariant(Number(p.score))}
                  meta={`${String(p.status)} · tap to analyze`}
                />
              </button>
            ))}
          </div>

          {topRec && (
            <HqPanel title="Highest priority today" subtitle="AURA recommended action" action={{ label: "All recommendations", to: "/hq/aura-executive?tab=recommendations" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <strong>{String(topRec.title)}</strong>
                  <StatusBadge label={String(topRec.riskLevel ?? "medium")} variant={riskVariant(String(topRec.riskLevel ?? "medium"))} />
                </div>
                <p style={{ margin: 0 }}>{String(topRec.recommendedAction)}</p>
                <p className="hq-muted-text" style={{ margin: 0 }}>
                  Impact: {String(topRec.estimatedImpact)} · Effort: {String(topRec.estimatedCompletion)} · Expected: {String(topRec.expectedImprovement)}
                </p>
                {typeof topRec.relatedPath === "string" && (
                  <Link to={topRec.relatedPath} className="hq-entity-link">Open related workspace →</Link>
                )}
              </div>
            </HqPanel>
          )}

          <div className="hq-grid-2" style={{ marginTop: "1rem" }}>
            <HqPanel title="Live monitoring" subtitle="Organizational intelligence signals">
              <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                <li className="hq-activity-item"><span>Grant activity</span><span>{JSON.stringify(monitoring.grantActivity ?? "—")}</span></li>
                <li className="hq-activity-item"><span>Employees</span><span>{JSON.stringify(monitoring.employeeActivity ?? "—")}</span></li>
                <li className="hq-activity-item"><span>Volunteers</span><span>{JSON.stringify(monitoring.volunteerActivity ?? "—")}</span></li>
                <li className="hq-activity-item"><span>Active programs</span><span>{String(monitoring.activePrograms ?? "—")}</span></li>
                <li className="hq-activity-item"><span>Active projects</span><span>{JSON.stringify(monitoring.activeProjects ?? "—")}</span></li>
              </ul>
            </HqPanel>
            <HqPanel title="Quick links" subtitle="Knowledge & command surfaces">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <Link to="/hq/knowledge" className="hq-entity-link">Knowledge Base</Link>
                <Link to="/hq/policies" className="hq-entity-link">Policies & Governance</Link>
                <Link to="/hq/grants" className="hq-entity-link">Grant Center</Link>
                <Link to="/hq/documents" className="hq-entity-link">Documents</Link>
                <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => selectTab("chat")}>
                  <MessageSquare size={14} /> Ask Executive AI
                </button>
              </div>
            </HqPanel>
          </div>
        </div>
      )}

      {tab === "briefings" && (
        <div className="hq-fade-in">
          <HqPanel title="Executive Briefings" subtitle="Morning, evening, weekly, monthly, quarterly, and annual reports">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
              {BRIEFING_OPTIONS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`hq-btn hq-btn-sm ${briefingType === b.id ? "hq-btn-primary" : "hq-btn-secondary"}`}
                  onClick={() => setBriefingType(b.id)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            {briefingQuery.isLoading && <HqLoading message="Generating briefing…" />}
            {briefingQuery.isError && <div className="hq-alert hq-alert-danger">{errorMessage(briefingQuery.error)}</div>}
            {!briefingQuery.isLoading && <BriefingBody data={(briefingQuery.data as Record<string, unknown>) ?? null} />}
          </HqPanel>
        </div>
      )}

      {tab === "health" && (
        <div className="hq-fade-in">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
            {(pillars.length ? pillars : [
              { id: "organization", label: "Organization" },
              { id: "system", label: "System" },
              { id: "financial", label: "Financial" },
              { id: "operational", label: "Operational" },
              { id: "security", label: "Security" },
              { id: "integration", label: "Integration" },
            ]).map((p) => (
              <button
                key={String(p.id)}
                type="button"
                className={`hq-btn hq-btn-sm ${selectedPillar === String(p.id) ? "hq-btn-primary" : "hq-btn-secondary"}`}
                onClick={() => openPillar(String(p.id))}
              >
                {String(p.label)}{typeof p.score === "number" ? ` (${p.score})` : ""}
              </button>
            ))}
          </div>
          {pillarExplain.isLoading && <HqLoading message="Analyzing health pillar…" />}
          {pillarExplain.isError && <div className="hq-alert hq-alert-danger">{errorMessage(pillarExplain.error)}</div>}
          {pillarExplain.data && (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
                <KpiCard
                  label={String((pillarExplain.data.pillar as { label?: string })?.label ?? selectedPillar)}
                  value={`${Number((pillarExplain.data.pillar as { score?: number })?.score ?? 0)}/100`}
                  icon={HeartPulse}
                  variant={healthVariant(Number((pillarExplain.data.pillar as { score?: number })?.score ?? 0))}
                />
                <KpiCard
                  label="Points to 100%"
                  value={Number((pillarExplain.data.progressToward100 as { remainingPoints?: number })?.remainingPoints ?? 0)}
                  icon={TrendingUp}
                  meta={`Effort: ${String(pillarExplain.data.estimatedEffort ?? "—")}`}
                />
              </div>
              <HqPanel title="Why this score" subtitle="AURA System Health Analyzer">
                <p>{String(pillarExplain.data.why ?? "")}</p>
              </HqPanel>
              <HqPanel title="Issues affecting this score" subtitle="Severity, detail, and recommended fixes">
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {((pillarExplain.data.issues as Array<Record<string, unknown>>) ?? []).map((issue) => (
                    <li key={String(issue.id)} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String(issue.title)}</div>
                        <div className="hq-activity-detail">{String(issue.detail)}</div>
                        <div className="hq-muted-text">Fix: {String(issue.recommendedFix)}</div>
                      </div>
                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                        <StatusBadge label={String(issue.severity)} variant={riskVariant(String(issue.severity))} />
                        {typeof issue.path === "string" && <Link to={issue.path} className="hq-entity-link">Open →</Link>}
                      </div>
                    </li>
                  ))}
                </ul>
              </HqPanel>
            </>
          )}
        </div>
      )}

      {tab === "recommendations" && (
        <div className="hq-fade-in">
          {recommendations.isLoading && <HqLoading message="Loading recommendations…" />}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {recList.map((r) => (
              <HqPanel key={String(r.id)} title={`#${r.priority} ${String(r.title)}`} subtitle={String(r.estimatedCompletion ?? "")}>
                <p style={{ marginTop: 0 }}>{String(r.recommendedAction)}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <StatusBadge label={String(r.riskLevel ?? "medium")} variant={riskVariant(String(r.riskLevel ?? "medium"))} />
                  {(Array.isArray(r.departments) ? r.departments : []).map((d) => (
                    <StatusBadge key={String(d)} label={String(d)} variant="muted" />
                  ))}
                </div>
                <p className="hq-muted-text" style={{ margin: 0 }}>
                  Impact: {String(r.estimatedImpact)} · Expected improvement: {String(r.expectedImprovement)}
                </p>
                {Array.isArray(r.dependencies) && r.dependencies.length > 0 && (
                  <p className="hq-muted-text">Dependencies: {(r.dependencies as string[]).join(", ")}</p>
                )}
                {typeof r.relatedPath === "string" && <Link to={r.relatedPath} className="hq-entity-link">Open →</Link>}
              </HqPanel>
            ))}
            {!recommendations.isLoading && recList.length === 0 && (
              <p className="hq-muted-text">No open recommendations — organization is in steady state.</p>
            )}
          </div>
        </div>
      )}

      {tab === "predictions" && (
        <div className="hq-fade-in">
          {predictions.isLoading && <HqLoading message="Loading predictive analytics…" />}
          {predictions.isError && <div className="hq-alert hq-alert-danger">{errorMessage(predictions.error)}</div>}
          {predictions.data && (
            <div className="hq-grid-2">
              <HqPanel title="Predictive models" subtitle="30/90-day projections">
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {(((predictions.data.models as Array<Record<string, unknown>>)
                    ?? ((predictions.data.package as { models?: Array<Record<string, unknown>> } | undefined)?.models)
                    ?? []) as Array<Record<string, unknown>>).map((m) => (
                    <li key={String(m.id)} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String(m.label)}</div>
                        <div className="hq-activity-detail">
                          Now {String(m.current)} → 30d {String(m.projected30d)} → 90d {String(m.projected90d)} ({String(m.unit)})
                        </div>
                        <div className="hq-muted-text">{String(m.insight)}</div>
                      </div>
                      <StatusBadge label={String(m.trend)} variant={m.trend === "down" ? "warning" : "success"} />
                    </li>
                  ))}
                </ul>
              </HqPanel>
              <HqPanel title="Risk radar" subtitle="Compliance, grants, finance, staffing">
                <pre className="hq-code-block">{JSON.stringify(predictions.data.risks ?? {}, null, 2)}</pre>
              </HqPanel>
            </div>
          )}
        </div>
      )}

      {tab === "chat" && (
        <div className="hq-fade-in">
          <HqPanel title="Executive AI Chat" subtitle="Grounded in live HQ metrics and Knowledge Base">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.75rem" }}>
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="hq-btn hq-btn-ghost hq-btn-sm"
                  onClick={() => {
                    setChatInput(q);
                    askMutation.mutate(q);
                  }}
                  disabled={askMutation.isPending}
                >
                  <Compass size={12} /> {q}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const q = chatInput.trim();
                if (q.length >= 3) askMutation.mutate(q);
              }}
              style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}
            >
              <input
                className="hq-input"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask AURA Executive Intelligence…"
                style={{ flex: 1 }}
              />
              <button type="submit" className="hq-btn hq-btn-primary" disabled={askMutation.isPending || chatInput.trim().length < 3}>
                <Lightbulb size={14} /> {askMutation.isPending ? "Thinking…" : "Ask"}
              </button>
            </form>
            {askMutation.isError && <div className="hq-alert hq-alert-danger">{errorMessage(askMutation.error)}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {chatHistory.map((item, idx) => (
                <div key={`${item.q}-${idx}`} className="hq-card" style={{ padding: "0.75rem" }}>
                  <div className="hq-activity-title">Q: {item.q}</div>
                  <pre className="hq-code-block" style={{ whiteSpace: "pre-wrap" }}>{item.a}</pre>
                  <p className="hq-muted-text" style={{ margin: 0 }}>
                    Source: {item.source ?? "—"} · Knowledge chunks: {item.knowledgeUsed ?? 0}
                  </p>
                </div>
              ))}
              {chatHistory.length === 0 && !askMutation.isPending && (
                <p className="hq-muted-text">Ask a leadership question to begin. Answers use live health data and knowledge base excerpts when available.</p>
              )}
            </div>
          </HqPanel>
        </div>
      )}
    </HQLayout>
  );
};

export default AuraExecutiveIntelligencePage;
