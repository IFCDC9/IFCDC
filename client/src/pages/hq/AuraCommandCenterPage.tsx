import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Sparkles, MessageSquare, FileBarChart, Lightbulb, TrendingUp, Shield,
  Briefcase, Building2, AlertTriangle, Activity, Compass, ExternalLink,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { hqApi } from "../../api/hqApi";
import { intelligenceApi } from "../../api/intelligenceApi";
import { warehouseApi } from "../../api/warehouseApi";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { KpiCard } from "../../components/hq/KpiCard";
import { formatLocaleNumber } from "../../utils/safeFormat";

type AuraMode = "ask" | "brief" | "intelligence" | "monitor" | "navigate";
type AskMode = "general" | "operations" | "enterprise";

const CHAT_SUGGESTIONS = [
  "What should I prioritize this week as IFCDC founder?",
  "How is our grant portfolio performing?",
  "Summarize our financial health",
  "Which Software Division apps need attention?",
  "Go to Financial Center",
];

const SUMMARIZE_OPTIONS = [
  { id: "full", label: "Full Organization Summary" },
  { id: "financial", label: "Financial Report" },
  { id: "grants", label: "Grant Portfolio" },
  { id: "operations", label: "Operations Overview" },
] as const;

function formatBoardReport(data: Record<string, unknown> | null): string {
  if (!data) return "";
  if (typeof data.report === "string") return data.report;
  if (typeof data.summary === "string") return data.summary;
  const parts = [
    data.title && String(data.title),
    data.executiveSummary && `Executive Summary\n${data.executiveSummary}`,
    data.financial && `Financial\n${JSON.stringify(data.financial, null, 2)}`,
    data.grants && `Grants\n${JSON.stringify(data.grants, null, 2)}`,
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n") : JSON.stringify(data, null, 2);
}

const AuraCommandCenterPage: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuraMode>("ask");
  const [askMode, setAskMode] = useState<AskMode>("general");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<{ role: "user" | "aura"; text: string }[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [execSummary, setExecSummary] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<string | null>(null);
  const [forecast, setForecast] = useState<string | null>(null);
  const [navQuery, setNavQuery] = useState("");
  const [navResult, setNavResult] = useState<Record<string, unknown> | null>(null);

  const { data: status } = useQuery({ queryKey: ["hq-aura-status"], queryFn: hqApi.auraStatus });
  const executiveHealth = useQuery({ queryKey: ["aura-executive-health"], queryFn: hqApi.auraExecutiveHealth, enabled: mode === "monitor" || mode === "intelligence" });
  const warehouseForecasts = useQuery({ queryKey: ["warehouse-forecasts"], queryFn: warehouseApi.forecasts, enabled: mode === "intelligence" });
  const morningBriefing = useQuery({ queryKey: ["copilot-morning"], queryFn: intelligenceApi.morningBriefing, enabled: mode === "brief" });
  const moduleMonitor = useQuery({ queryKey: ["copilot-module-monitor"], queryFn: intelligenceApi.moduleMonitor, enabled: mode === "monitor" });
  const correctiveActions = useQuery({ queryKey: ["copilot-corrective"], queryFn: intelligenceApi.correctiveActions, enabled: mode === "monitor" || mode === "intelligence" });

  const copilotAskMutation = useMutation({
    mutationFn: (q: string) => intelligenceApi.ask(q),
    onSuccess: (data, msg) => {
      setHistory((h) => [...h, { role: "user", text: msg }, { role: "aura", text: String(data.answer ?? data.response ?? "") }]);
      setMessage("");
    },
  });

  const automateMutation = useMutation({ mutationFn: (action: string) => intelligenceApi.automate(action) });

  const chatMutation = useMutation({
    mutationFn: (msg: string) => hqApi.auraChat(msg),
    onSuccess: (data, msg) => {
      setHistory((h) => [...h, { role: "user", text: msg }, { role: "aura", text: data.response }]);
      setMessage("");
    },
  });

  const opsAskMutation = useMutation({
    mutationFn: (q: string) => hqApi.auraOperationsAsk(q),
    onSuccess: (data, msg) => {
      setHistory((h) => [...h, { role: "user", text: msg }, { role: "aura", text: data.answer }]);
      setMessage("");
    },
  });

  const enterpriseAskMutation = useMutation({
    mutationFn: (q: string) => hqApi.auraEnterpriseAsk(q),
    onSuccess: (data, msg) => {
      setHistory((h) => [...h, { role: "user", text: msg }, { role: "aura", text: data.answer }]);
      setMessage("");
    },
  });

  const summarizeMutation = useMutation({
    mutationFn: (reportType: "full" | "financial" | "grants" | "operations") => hqApi.auraSummarize(reportType),
    onSuccess: (data) => setSummary(data.summary),
  });

  const briefingMutation = useMutation({
    mutationFn: (focus: "daily" | "board") => hqApi.auraBriefing(focus),
    onSuccess: (data) => setBriefing(data.briefing),
  });

  const execSummaryMutation = useMutation({
    mutationFn: hqApi.auraExecutiveSummary,
    onSuccess: (data) => setExecSummary(data.summary),
  });

  const recommendMutation = useMutation({
    mutationFn: hqApi.auraRecommend,
    onSuccess: (data) => setRecommendations(data.recommendations),
  });

  const forecastMutation = useMutation({
    mutationFn: hqApi.auraForecast,
    onSuccess: (data) => setForecast(data.forecast),
  });

  const anomaliesMutation = useMutation({ mutationFn: hqApi.auraAnomalies });
  const riskMutation = useMutation({ mutationFn: hqApi.auraFinancialRisk });
  const complianceTrackerMutation = useMutation({ mutationFn: hqApi.auraComplianceTracker });
  const complianceMutation = useMutation({
    mutationFn: hqApi.auraCompliance,
    onSuccess: (data) => setRecommendations(data.review),
  });

  const deptMutation = useMutation({ mutationFn: hqApi.auraDepartments });
  const actionPlanMutation = useMutation({ mutationFn: hqApi.auraExecutiveActionPlan });
  const boardReportMutation = useMutation({ mutationFn: hqApi.auraEnterpriseBoardReport });

  const navMutation = useMutation({
    mutationFn: (q: string) => hqApi.auraNavigate(q),
    onSuccess: (data) => setNavResult(data as Record<string, unknown>),
  });

  const pending = chatMutation.isPending || opsAskMutation.isPending || enterpriseAskMutation.isPending;

  const send = () => {
    const trimmed = message.trim();
    if (!trimmed || pending) return;
    if (trimmed.toLowerCase().startsWith("go to ") || trimmed.toLowerCase().startsWith("open ")) {
      navMutation.mutate(trimmed, {
        onSuccess: (data) => {
          if (data.path) navigate(data.path);
        },
      });
      return;
    }
    if (askMode === "operations") opsAskMutation.mutate(trimmed);
    else if (askMode === "enterprise") enterpriseAskMutation.mutate(trimmed);
    else if (askMode === "general") copilotAskMutation.mutate(trimmed);
    else chatMutation.mutate(trimmed);
  };

  const health = executiveHealth.data;
  const risks = (health?.risks ?? []) as { level: string; area: string; detail: string }[];

  return (
    <HQLayout title="AURA Command Center" subtitle="Enterprise operations hub — ask, brief, monitor, and navigate every Headquarters module">
      {status && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <StatusBadge label={status.auraCore ? "AURA Core Connected" : "Enterprise Mode"} variant={status.auraCore ? "success" : "gold"} pulse={status.auraCore} />
          <StatusBadge label="27 Modules Monitored" variant="muted" />
          <Link to="/hq/intelligence" className="hq-btn hq-btn-ghost hq-btn-sm">Full Intelligence Center <ExternalLink size={12} /></Link>
        </div>
      )}

      <div className="hq-tabs">
        {([
          ["ask", MessageSquare, "Ask AURA"],
          ["brief", FileBarChart, "Brief & Summarize"],
          ["intelligence", TrendingUp, "Intelligence"],
          ["monitor", Building2, "Monitor"],
          ["navigate", Compass, "Navigate HQ"],
        ] as const).map(([id, Icon, label]) => (
          <button key={id} type="button" className={`hq-tab ${mode === id ? "active" : ""}`} onClick={() => setMode(id)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {mode === "ask" && (
        <div className="hq-aura-chat hq-panel hq-fade-in">
          <div className="hq-panel-body">
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
              {(["general", "operations", "enterprise"] as AskMode[]).map((m) => (
                <button key={m} type="button" className={`hq-btn hq-btn-sm ${askMode === m ? "hq-btn-primary" : "hq-btn-ghost"}`} onClick={() => setAskMode(m)}>
                  {m === "general" ? "Executive Chat" : m === "operations" ? "Operations Copilot" : "Enterprise Intelligence"}
                </button>
              ))}
            </div>
            <div className="hq-aura-messages">
              {history.length === 0 && (
                <div className="hq-empty">
                  <Sparkles size={32} style={{ margin: "0 auto 1rem", display: "block", color: "#f5c842", opacity: 0.5 }} />
                  Ask AURA anything — or say &quot;Go to Grant Center&quot; for natural-language navigation across Headquarters.
                </div>
              )}
              {history.map((entry, i) => (
                <div key={i} className={`hq-aura-msg ${entry.role} hq-stagger-in`}>
                  <div className="hq-aura-bubble">{entry.text}</div>
                </div>
              ))}
              {pending && <div className="hq-aura-msg aura"><div className="hq-aura-bubble hq-aura-typing">AURA is analyzing organization data…</div></div>}
            </div>
            <div className="hq-aura-input-row">
              <input className="hq-aura-input" value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask or navigate — e.g. Open Financial Center…" />
              <button type="button" className="hq-btn hq-btn-primary" onClick={send} disabled={pending || !message.trim()}>Send</button>
            </div>
            <div className="hq-aura-suggestions">
              {CHAT_SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="hq-aura-suggestion" onClick={() => setMessage(s)}>{s}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === "brief" && (
        <div className="hq-grid-2 hq-fade-in">
          <div className="hq-panel">
            <div className="hq-panel-body">
              <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Executive Summaries</h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
                {SUMMARIZE_OPTIONS.map((opt) => (
                  <button key={opt.id} type="button" className="hq-btn hq-btn-secondary hq-btn-sm" disabled={summarizeMutation.isPending} onClick={() => summarizeMutation.mutate(opt.id)}>{opt.label}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={briefingMutation.isPending} onClick={() => briefingMutation.mutate("daily")}>Founder Briefing</button>
                <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" disabled={briefingMutation.isPending} onClick={() => briefingMutation.mutate("board")}>Board Briefing</button>
                <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" disabled={execSummaryMutation.isPending} onClick={() => execSummaryMutation.mutate()}>Executive Summary</button>
                <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" disabled={boardReportMutation.isPending} onClick={() => boardReportMutation.mutate()}>Board Report</button>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => import("../../api/intelligenceApi").then((m) => m.intelligenceApi.deliverBriefing({ sendEmail: true }))}>Email Briefing PDF</button>
                <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => import("../../api/intelligenceApi").then((m) => m.intelligenceApi.deliverBoardReport({ sendEmail: true }))}>Email Board Report PDF</button>
              </div>
              {morningBriefing.data && (
                <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "rgba(245,200,66,0.06)", borderRadius: "var(--hq-radius-sm)", border: "1px solid var(--hq-gold-border)" }}>
                  <strong style={{ color: "var(--hq-gold)", fontSize: "0.85rem" }}>{String(morningBriefing.data.greeting ?? "Morning Briefing")}</strong>
                  <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem", fontSize: "0.82rem" }}>
                    {((morningBriefing.data.priorities as string[]) ?? []).slice(0, 4).map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </div>
              )}
              {(summary || briefing || execSummary || boardReportMutation.data) && (
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.85rem", lineHeight: 1.65, maxHeight: 400, overflow: "auto" }}>
                  {summary ?? briefing ?? execSummary ?? formatBoardReport(boardReportMutation.data as Record<string, unknown>)}
                </pre>
              )}
            </div>
          </div>
          <div className="hq-panel">
            <div className="hq-panel-body">
              <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Action Plan</h4>
              <button type="button" className="hq-btn hq-btn-primary" disabled={actionPlanMutation.isPending} onClick={() => actionPlanMutation.mutate()}>
                <Lightbulb size={16} /> Generate Executive Action Plan
              </button>
              {actionPlanMutation.data?.plan && (
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", marginTop: "1rem", fontSize: "0.85rem", lineHeight: 1.65 }}>{actionPlanMutation.data.plan}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      {mode === "intelligence" && (
        <div className="hq-fade-in">
          <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
            <KpiCard label="Org Health" value={`${health?.organizationHealth ?? "—"}%`} icon={Activity} variant="gold" />
            <KpiCard label="Risk Score" value={health?.riskScore ?? "—"} icon={AlertTriangle} variant={(health?.riskScore as number) > 60 ? "danger" : "success"} />
            <KpiCard label="Active Risks" value={risks.length} variant={risks.length ? "warning" : "success"} />
          </div>
          <div className="hq-grid-2">
            <div className="hq-panel">
              <div className="hq-panel-body">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
                  <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={anomaliesMutation.isPending} onClick={() => anomaliesMutation.mutate()}>Anomaly Scan</button>
                  <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" disabled={riskMutation.isPending} onClick={() => riskMutation.mutate()}>Financial Risk</button>
                  <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" disabled={complianceTrackerMutation.isPending} onClick={() => complianceTrackerMutation.mutate()}>Compliance Tracker</button>
                  <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" disabled={complianceMutation.isPending} onClick={() => complianceMutation.mutate()}>Compliance Review</button>
                  <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" disabled={recommendMutation.isPending} onClick={() => recommendMutation.mutate()}>Recommendations</button>
                  <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" disabled={forecastMutation.isPending} onClick={() => forecastMutation.mutate()}>6-Month Forecast</button>
                </div>
                {anomaliesMutation.data && (
                  <ul className="hq-activity-list" style={{ marginBottom: "1rem" }}>
                    {anomaliesMutation.data.anomalies.slice(0, 6).map((a, i) => (
                      <li key={i} className="hq-activity-item">
                        <div className="hq-activity-content"><div className="hq-activity-title">{a.title}</div><div className="hq-activity-detail">{a.module}</div></div>
                        <StatusBadge label={a.severity} variant={a.severity === "high" ? "danger" : "warning"} />
                      </li>
                    ))}
                  </ul>
                )}
                {riskMutation.data && <p style={{ fontSize: "0.85rem" }}>Risk: {riskMutation.data.riskLevel} ({riskMutation.data.riskScore}/100)</p>}
                {complianceTrackerMutation.data && <p style={{ fontSize: "0.85rem" }}>{complianceTrackerMutation.data.overdue} overdue · {complianceTrackerMutation.data.dueNext14Days} due in 14 days</p>}
                {(recommendations || forecast) && (
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.82rem", lineHeight: 1.6, marginTop: "0.75rem" }}>{recommendations ?? forecast}</pre>
                )}
              </div>
            </div>
            <div className="hq-panel">
              <div className="hq-panel-body">
                <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Predictive Forecasts (Warehouse)</h4>
                {warehouseForecasts.isLoading ? <p className="hq-muted-text">Loading forecasts…</p> : (
                  <table className="hq-table">
                    <thead><tr><th>Metric</th><th>Current</th><th>30d</th><th>90d</th><th>Trend</th></tr></thead>
                    <tbody>
                      {(warehouseForecasts.data?.forecasts ?? []).map((f) => (
                        <tr key={f.metric}>
                          <td>{f.metric.replace(/_/g, " ")}</td>
                          <td>{formatLocaleNumber(f.current)}</td>
                          <td>{formatLocaleNumber(f.projected30d)}</td>
                          <td>{formatLocaleNumber(f.projected90d)}</td>
                          <td><StatusBadge label={f.trend} variant={f.trend === "up" ? "success" : f.trend === "down" ? "danger" : "muted"} /></td>
                        </tr>
                      ))}
                      {!(warehouseForecasts.data?.forecasts ?? []).length && (
                        <tr><td colSpan={5} className="hq-muted-text">Capture warehouse snapshots to enable predictive forecasting.</td></tr>
                      )}
                    </tbody>
                  </table>
                )}
                {risks.length > 0 && (
                  <>
                    <h4 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>Active Risks</h4>
                    <ul className="hq-activity-list">
                      {risks.map((r, i) => (
                        <li key={i} className="hq-activity-item">
                          <div className="hq-activity-content"><div className="hq-activity-title">{r.area}</div><div className="hq-activity-detail">{r.detail}</div></div>
                          <StatusBadge label={r.level} variant={r.level === "high" ? "danger" : "warning"} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === "monitor" && (
        <div className="hq-fade-in">
          <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
            <KpiCard label="Modules Monitored" value={(moduleMonitor.data?.modules as unknown[])?.length ?? 7} icon={Building2} />
            <KpiCard label="Anomalies" value={moduleMonitor.data?.anomalyCount ?? 0} icon={AlertTriangle} variant={(moduleMonitor.data?.anomalyCount as number) > 0 ? "warning" : "success"} />
            <KpiCard label="High Severity" value={moduleMonitor.data?.highSeverity ?? 0} icon={Shield} variant={(moduleMonitor.data?.highSeverity as number) > 0 ? "danger" : "success"} />
          </div>
          <div className="hq-grid-2">
            <div className="hq-panel">
              <div className="hq-panel-body">
                <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Headquarters Module Monitor</h4>
                {moduleMonitor.isLoading ? <p className="hq-muted-text">Scanning modules…</p> : (
                  <ul className="hq-activity-list">
                    {((moduleMonitor.data?.modules as { id: string; label: string; healthy: boolean; alerts: number }[]) ?? []).map((m) => (
                      <li key={m.id} className="hq-activity-item">
                        <div className="hq-activity-content"><div className="hq-activity-title">{m.label}</div><div className="hq-activity-detail">{m.alerts} alert(s)</div></div>
                        <StatusBadge label={m.healthy ? "Healthy" : "Attention"} variant={m.healthy ? "success" : "warning"} />
                      </li>
                    ))}
                  </ul>
                )}
                {correctiveActions.data && (
                  <>
                    <h4 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>Corrective Actions</h4>
                    <ul className="hq-activity-list">
                      {((correctiveActions.data.correctiveActions as { action: string; severity: string }[]) ?? []).slice(0, 5).map((a, i) => (
                        <li key={i} className="hq-activity-item">
                          <div className="hq-activity-content"><div className="hq-activity-title">{a.action}</div></div>
                          <StatusBadge label={a.severity} variant={a.severity === "high" ? "danger" : "warning"} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
            <div className="hq-panel">
              <div className="hq-panel-body">
                <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Enterprise Automation</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
                  {[
                    ["compliance_monitor", "Compliance Monitor"],
                    ["deadline_reminder", "Deadline Reminders"],
                    ["grant_followup", "Grant Follow-up"],
                    ["board_packet", "Board Packet"],
                    ["financial_report", "Financial Report"],
                    ["executive_notification", "Notify Founder"],
                  ].map(([action, label]) => (
                    <button key={action} type="button" className="hq-btn hq-btn-secondary hq-btn-sm" disabled={automateMutation.isPending}
                      onClick={() => automateMutation.mutate(action)}>{label}</button>
                  ))}
                </div>
                {automateMutation.data && <p style={{ fontSize: "0.82rem", color: "var(--hq-success)" }}>Automation queued: {automateMutation.data.action}</p>}
                <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" disabled={deptMutation.isPending} onClick={() => deptMutation.mutate()}>Refresh Department Monitor</button>
                {deptMutation.data && <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", marginTop: "0.75rem", fontSize: "0.82rem" }}>{deptMutation.data.summary}</pre>}
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === "navigate" && (
        <div className="hq-panel hq-fade-in">
          <div className="hq-panel-body">
            <p className="hq-muted-text" style={{ marginBottom: "1rem" }}>
              Natural-language navigation across Headquarters. Try &quot;Go to Grant Center&quot;, &quot;Open Security Center&quot;, or search for people, grants, and documents.
            </p>
            <div className="hq-aura-input-row">
              <input className="hq-aura-input" value={navQuery} onChange={(e) => setNavQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && navQuery.trim().length >= 2 && navMutation.mutate(navQuery.trim())}
                placeholder="Navigate or search Headquarters…" />
              <button type="button" className="hq-btn hq-btn-primary" disabled={navQuery.trim().length < 2 || navMutation.isPending}
                onClick={() => navMutation.mutate(navQuery.trim())}>Go</button>
            </div>
            {navResult && <p style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>{String(navResult.message)}</p>}
            {navResult?.intent === "navigate" && navResult.path && (
              <button type="button" className="hq-btn hq-btn-primary" style={{ marginTop: "0.75rem" }} onClick={() => navigate(String(navResult.path))}>
                Open {String(navResult.label ?? "module")} →
              </button>
            )}
            <ul className="hq-activity-list" style={{ marginTop: "1rem" }}>
              {((navResult?.results ?? []) as { id: string; title: string; subtitle: string; path: string }[]).map((r) => (
                <li key={r.id} className="hq-activity-item" style={{ cursor: "pointer" }} onClick={() => navigate(r.path)}>
                  <div className="hq-activity-content"><div className="hq-activity-title">{r.title}</div><div className="hq-activity-detail">{r.subtitle}</div></div>
                </li>
              ))}
            </ul>
            <p className="hq-muted-text" style={{ marginTop: "1rem", fontSize: "0.78rem" }}>Tip: Press ⌘K anywhere in Headquarters for universal search.</p>
          </div>
        </div>
      )}
    </HQLayout>
  );
};

export default AuraCommandCenterPage;
