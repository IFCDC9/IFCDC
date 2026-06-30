import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  TrendingUp, Wallet, FileText, Users, Heart, Activity,
  ChevronRight, Database, AlertTriangle, Sparkles,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import HQLayout from "../../layouts/HQLayout";
import { warehouseApi, DEFAULT_WAREHOUSE_OVERVIEW } from "../../api/warehouseApi";
import { isProductionClient, devPlaceholder } from "../../utils/productionDataPolicy";
import { HqDataUnavailable } from "../../components/hq/HqDataUnavailable";
import { hqApi } from "../../api/hqApi";
import { intelligenceApi } from "../../api/intelligenceApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { formatCurrency, formatLocaleNumber } from "../../utils/safeFormat";

type DrillDomain = "finance" | "grants" | "programs" | "people" | "donations" | "health" | "workflows";

const DRILL_TABS: { id: DrillDomain; label: string }[] = [
  { id: "finance", label: "Financial Trends" },
  { id: "grants", label: "Grant Pipeline" },
  { id: "programs", label: "Program Performance" },
  { id: "people", label: "People & Volunteers" },
  { id: "donations", label: "Donations" },
  { id: "health", label: "Organization Health" },
  { id: "workflows", label: "Pending Workflows" },
];

function fmt(n?: number) {
  return formatCurrency(n);
}

function formatBoardReport(data: Record<string, unknown> | undefined): string {
  if (!data) return "Board report will generate from warehouse data and module snapshots.";
  if (typeof data.report === "string") return data.report;
  if (typeof data.summary === "string") return data.summary;
  if (typeof data.executiveSummary === "string") return data.executiveSummary;
  const parts = [
    data.title && String(data.title),
    data.executiveSummary && String(data.executiveSummary),
    data.financial && `Financial: ${JSON.stringify(data.financial)}`,
    data.grants && `Grants: ${JSON.stringify(data.grants)}`,
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n") : JSON.stringify(data, null, 2);
}

function DrillDownWidgets({ domain, data }: { domain: DrillDomain; data: Record<string, unknown> }) {
  if (domain === "finance") {
    const f = data as { totalRevenue?: number; cashFlow?: number; netPosition?: number; monthlyExpenses?: number; financialHealthScore?: number; grantRevenue?: number };
    return (
      <div className="hq-kpi-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <KpiCard label="Total Revenue" value={fmt(f.totalRevenue)} icon={Wallet} />
        <KpiCard label="Cash Flow" value={fmt(f.cashFlow)} />
        <KpiCard label="Net Position" value={fmt(f.netPosition)} variant="gold" />
        <KpiCard label="Monthly Expenses" value={fmt(f.monthlyExpenses)} variant="warning" />
        <KpiCard label="Health Score" value={`${f.financialHealthScore ?? 0}%`} variant="success" />
        <KpiCard label="Grant Revenue" value={fmt(f.grantRevenue)} />
      </div>
    );
  }
  if (domain === "grants") {
    const g = data as { activeAwards?: number; pipelineValue?: number; complianceDue?: number; fundingPipeline?: { stage: string; count: number; value: number }[] };
    return (
      <>
        <div className="hq-kpi-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginBottom: "0.75rem" }}>
          <KpiCard label="Active Awards" value={g.activeAwards ?? 0} icon={FileText} />
          <KpiCard label="Pipeline Value" value={fmt(g.pipelineValue)} variant="gold" />
          <KpiCard label="Compliance Due" value={g.complianceDue ?? 0} variant={(g.complianceDue ?? 0) > 0 ? "danger" : "success"} />
        </div>
        {(g.fundingPipeline ?? []).map((s) => (
          <div key={s.stage} style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0", borderBottom: "1px solid var(--hq-border-subtle)" }}>
            <span>{s.stage}</span><span style={{ color: "var(--hq-gold)" }}>{s.count} · {fmt(s.value)}</span>
          </div>
        ))}
      </>
    );
  }
  if (domain === "programs") {
    const p = data as { programsRunning?: number; participants?: number; enrollments?: number };
    return (
      <div className="hq-kpi-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <KpiCard label="Programs Running" value={p.programsRunning ?? 0} icon={Users} />
        <KpiCard label="Participants" value={p.participants ?? 0} />
        <KpiCard label="Enrollments" value={p.enrollments ?? 0} variant="gold" />
      </div>
    );
  }
  if (domain === "people") {
    const p = data as { totalPeople?: number; volunteers?: number; pendingApprovals?: number };
    return (
      <div className="hq-kpi-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <KpiCard label="Total People" value={p.totalPeople ?? 0} icon={Users} />
        <KpiCard label="Volunteers" value={p.volunteers ?? 0} variant="gold" />
        <KpiCard label="Pending Approvals" value={p.pendingApprovals ?? 0} variant="warning" />
      </div>
    );
  }
  if (domain === "donations") {
    const d = data as { total?: number; monthly?: number; count?: number };
    return (
      <div className="hq-kpi-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <KpiCard label="Total Donations" value={fmt(d.total)} icon={Heart} />
        <KpiCard label="Monthly" value={fmt(d.monthly)} />
        <KpiCard label="Donor Count" value={d.count ?? 0} variant="gold" />
      </div>
    );
  }
  if (domain === "health") {
    const h = data as { score?: number; grade?: string };
    return (
      <div style={{ textAlign: "center", padding: "1rem" }}>
        <div style={{ fontSize: "2.5rem", fontWeight: 800, color: "var(--hq-gold)" }}>{h.score ?? 0}%</div>
        <StatusBadge label={`Grade ${h.grade ?? "—"}`} variant="success" />
      </div>
    );
  }
  if (domain === "workflows") {
    const tasks = (data as { pendingTasks?: { title: string; type: string; priority: string }[] }).pendingTasks ?? [];
    return (
      <ul className="hq-activity-list">
        {tasks.length === 0 ? <li className="hq-muted-text">No pending workflows</li> : tasks.slice(0, 8).map((t, i) => (
          <li key={i} className="hq-activity-item">
            <div className="hq-activity-content"><div className="hq-activity-title">{t.title}</div><div className="hq-activity-detail">{t.type}</div></div>
            <StatusBadge label={t.priority} variant={t.priority === "high" ? "danger" : "muted"} />
          </li>
        ))}
      </ul>
    );
  }
  return <p className="hq-muted-text">No drill-down data available.</p>;
}

const EnterpriseIntelligencePage: React.FC = () => {
  const [drill, setDrill] = useState<DrillDomain>("finance");
  const [metricKey, setMetricKey] = useState("organization_health");

  const overview = useQuery({
    queryKey: ["warehouse-overview"],
    queryFn: warehouseApi.overview,
    placeholderData: devPlaceholder(DEFAULT_WAREHOUSE_OVERVIEW),
    staleTime: 60_000,
  });

  const trends = useQuery({
    queryKey: ["warehouse-trends", metricKey],
    queryFn: () => warehouseApi.trends(metricKey, 30),
    staleTime: 120_000,
  });

  const drillDown = useQuery({
    queryKey: ["warehouse-drill", drill],
    queryFn: () => warehouseApi.drillDown(drill),
    enabled: !!drill,
  });

  const executiveHealth = useQuery({
    queryKey: ["aura-executive-health"],
    queryFn: hqApi.auraExecutiveHealth,
    staleTime: 120_000,
  });

  const boardReport = useQuery({
    queryKey: ["aura-board-report"],
    queryFn: hqApi.auraEnterpriseBoardReport,
    staleTime: 300_000,
  });

  const actionPlan = useMutation({ mutationFn: hqApi.auraExecutiveActionPlan });

  const forecasts = useQuery({
    queryKey: ["warehouse-forecasts"],
    queryFn: warehouseApi.forecasts,
    staleTime: 120_000,
  });

  const scorecard = useQuery({
    queryKey: ["intelligence-scorecard"],
    queryFn: intelligenceApi.scorecard,
    staleTime: 120_000,
  });

  const predictions = useQuery({
    queryKey: ["intelligence-predictions"],
    queryFn: intelligenceApi.predictions,
    staleTime: 180_000,
  });

  const strategicRecs = useQuery({
    queryKey: ["intelligence-recommendations"],
    queryFn: intelligenceApi.strategicRecommendations,
    staleTime: 300_000,
  });

  const snapshot = useMutation({ mutationFn: () => warehouseApi.snapshot("organization", true) });

  const data = isProductionClient ? overview.data ?? null : overview.data ?? DEFAULT_WAREHOUSE_OVERVIEW;
  const chartData = (trends.data?.trends ?? []).map((t) => ({
    period: t.period ?? t.created_at?.slice(0, 10) ?? "",
    value: t.metric_value,
  }));

  const health = executiveHealth.data;
  const risks = (health?.risks ?? []) as { level: string; area: string; detail: string }[];

  if (isProductionClient && overview.isFetched && !data) {
    return (
      <HQLayout
        title="Enterprise Intelligence"
        subtitle="Organization-wide data warehouse — executive analytics, forecasting, and KPI drill-downs"
      >
        <HqDataUnavailable
          message="Warehouse overview could not be loaded from production APIs."
          onRetry={() => overview.refetch()}
        />
      </HQLayout>
    );
  }

  return (
    <HQLayout
      title="Enterprise Intelligence"
      subtitle="Organization-wide data warehouse — executive analytics, forecasting, and KPI drill-downs"
    >
      <div className="hq-sd-toolbar" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <StatusBadge label="Data Warehouse" variant="gold" />
          <StatusBadge label={`Health ${data.organizationHealth ?? 0}% (${data.grade ?? "—"})`} variant="success" />
        </div>
        <button
          type="button"
          className="hq-btn hq-btn-ghost hq-btn-sm"
          disabled={snapshot.isPending}
          onClick={() => snapshot.mutate()}
        >
          <Database size={14} /> {snapshot.isPending ? "Capturing…" : "Capture Snapshot"}
        </button>
      </div>

      <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Organization Health" value={`${data.organizationHealth ?? 0}%`} icon={Activity} variant="gold" />
        <KpiCard label="Cash Flow" value={fmt(data.finance?.cashFlow)} icon={Wallet} />
        <KpiCard label="Active Grants" value={data.grants?.activeAwards ?? 0} icon={FileText} />
        <KpiCard label="Programs Running" value={data.programs?.programsRunning ?? 0} icon={Users} />
        <KpiCard label="Donations YTD" value={fmt(data.donations?.total)} icon={Heart} />
        <KpiCard label="Pipeline Value" value={fmt(data.grants?.pipelineValue)} icon={TrendingUp} variant="gold" />
      </div>

      {scorecard.data && (
        <div style={{ marginBottom: "1.25rem" }}>
        <HqPanel title="Executive Scorecard" subtitle="Phase 8 intelligence pillars">
          <div className="hq-executive-scorecard-strip">
            {((scorecard.data as { pillars: { id: string; label: string; score: number; grade: string; status: string; detail: string }[] }).pillars ?? []).map((p) => (
              <div key={p.id} className={`hq-executive-scorecard-pillar hq-score-${p.status}`}>
                <span className="hq-executive-health-label">{p.label}</span>
                <span className="hq-executive-health-value">{p.score}%</span>
                <span className="hq-executive-health-meta">{p.detail}</span>
              </div>
            ))}
          </div>
        </HqPanel>
        </div>
      )}

      {predictions.data && (
        <div style={{ marginBottom: "1.25rem" }}>
        <HqPanel title="Predictive Intelligence" subtitle="ML-style forecasts across IFCDC operations">
          <div className="hq-kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {((predictions.data as { models: { id: string; label: string; current: number; projected30d: number; unit: string; insight: string }[] }).models ?? []).map((m) => (
              <KpiCard key={m.id} label={m.label} value={`${m.unit === "$" ? fmt(m.current) : m.current}${m.unit === "%" ? "%" : ""}`} meta={`30d: ${m.unit === "$" ? fmt(m.projected30d) : m.projected30d}${m.unit === "%" ? "%" : ""} · ${m.insight}`} />
            ))}
          </div>
        </HqPanel>
        </div>
      )}

      {strategicRecs.data && (
        <div style={{ marginBottom: "1.25rem" }}>
        <HqPanel title="Strategic Recommendations" subtitle="AI-derived executive priorities">
          <ul className="hq-activity-list">
            {((strategicRecs.data as { recommendations: { area: string; action: string; impact: string }[] }).recommendations ?? []).map((r, i) => (
              <li key={i} className="hq-activity-item">
                <div className="hq-activity-content">
                  <div className="hq-activity-title">{r.area}</div>
                  <div className="hq-activity-detail">{r.action}</div>
                </div>
                <StatusBadge label={r.impact} variant={r.impact === "high" ? "danger" : r.impact === "medium" ? "warning" : "success"} />
              </li>
            ))}
          </ul>
        </HqPanel>
        </div>
      )}

      <div className="hq-grid-main-side hq-fade-in">
        <HqPanel
          title="Predictive Forecasting"
          subtitle="Warehouse metric trends across HQ modules"
          headerExtra={
            <select
              className="hq-input"
              style={{ width: "auto", fontSize: "0.78rem" }}
              value={metricKey}
              onChange={(e) => setMetricKey(e.target.value)}
            >
              <option value="organization_health">Organization Health</option>
              <option value="cash_flow">Cash Flow</option>
              <option value="donations_total">Donations</option>
              <option value="active_grants">Active Grants</option>
              <option value="grant_pipeline_value">Grant Pipeline</option>
              <option value="total_people">Total People</option>
            </select>
          }
        >
          {trends.isLoading ? <HqLoading /> : chartData.length === 0 ? (
            <p className="hq-muted-text">No trend data yet — capture a warehouse snapshot to begin forecasting.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--hq-border-subtle)" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="var(--hq-text-muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--hq-text-muted)" />
                <Tooltip contentStyle={{ background: "var(--hq-bg-elevated)", border: "1px solid var(--hq-border)" }} />
                <Line type="monotone" dataKey="value" stroke="var(--hq-gold)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </HqPanel>

        <HqPanel title="Executive KPI Drill-Down" subtitle="Select a domain for detailed metrics">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "1rem" }}>
            {DRILL_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`hq-btn hq-btn-sm ${drill === t.id ? "hq-btn-primary" : "hq-btn-ghost"}`}
                style={{ justifyContent: "space-between" }}
                onClick={() => setDrill(t.id)}
              >
                {t.label} <ChevronRight size={14} />
              </button>
            ))}
          </div>
          {drillDown.isLoading ? <HqLoading /> : (
            <DrillDownWidgets domain={drill} data={(drillDown.data?.data ?? {}) as Record<string, unknown>} />
          )}
        </HqPanel>
      </div>

      <div className="hq-grid-2" style={{ marginTop: "1.25rem" }}>
        <HqPanel title="AURA Executive Briefing" subtitle="Organization health, risks, and recommendations">
          {executiveHealth.isLoading ? <HqLoading /> : (
            <>
              <div className="hq-kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "0.75rem" }}>
                <KpiCard label="Risk Score" value={health?.riskScore ?? 0} icon={AlertTriangle} variant={(health?.riskScore ?? 0) > 60 ? "danger" : "success"} />
                <KpiCard label="Active Risks" value={risks.length} variant={risks.length > 0 ? "warning" : "success"} />
                <KpiCard label="Funder Partners" value={health?.funderPartners ?? 0} variant="gold" />
              </div>
              {risks.length > 0 && (
                <ul className="hq-activity-list" style={{ marginBottom: "0.75rem" }}>
                  {risks.map((r, i) => (
                    <li key={i} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{r.area}</div>
                        <div className="hq-activity-detail">{r.detail}</div>
                      </div>
                      <StatusBadge label={r.level} variant={r.level === "high" ? "danger" : r.level === "medium" ? "warning" : "muted"} />
                    </li>
                  ))}
                </ul>
              )}
              <ul className="hq-feature-list">
                {(health?.recommendations ?? []).slice(0, 5).map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
              <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" style={{ marginTop: "0.75rem" }} disabled={actionPlan.isPending} onClick={() => actionPlan.mutate()}>
                <Sparkles size={14} /> {actionPlan.isPending ? "Generating…" : "Generate Action Plan"}
              </button>
              {actionPlan.data?.plan && (
                <pre style={{ fontSize: "0.78rem", whiteSpace: "pre-wrap", marginTop: "0.75rem", background: "var(--hq-bg-subtle)", padding: "0.75rem", borderRadius: 6 }}>
                  {String(actionPlan.data.plan)}
                </pre>
              )}
            </>
          )}
        </HqPanel>

        <HqPanel title="Board-Ready Report" subtitle="AURA-generated executive summary for governance">
          {boardReport.isLoading ? <HqLoading /> : (
            <div style={{ fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto" }}>
              {formatBoardReport(boardReport.data as Record<string, unknown> | undefined)}
            </div>
          )}
        </HqPanel>
        <HqPanel title="Predictive Forecasts" subtitle="30-day and 90-day projections from warehouse metrics">
          {forecasts.isLoading ? <HqLoading /> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.75rem" }}>
              {(forecasts.data?.forecasts ?? []).map((f) => (
                <div key={f.metric} className="hq-panel" style={{ padding: "0.75rem" }}>
                  <div style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>{f.metric.replace(/_/g, " ")}</div>
                  <div style={{ fontSize: "1rem", fontWeight: 600 }}>{formatLocaleNumber(f.current)}</div>
                  <div style={{ fontSize: "0.75rem" }}>30d: {formatLocaleNumber(f.projected30d)} · <StatusBadge label={f.trend ?? "stable"} variant={f.trend === "up" ? "success" : f.trend === "down" ? "danger" : "muted"} /></div>
                </div>
              ))}
              {!(forecasts.data?.forecasts ?? []).length && <p className="hq-muted-text">Capture snapshots to enable forecasting.</p>}
            </div>
          )}
        </HqPanel>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Grant Pipeline" subtitle="Funding stages across the organization">
        {overview.isLoading ? <HqLoading /> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.75rem" }}>
            {(data.grants?.fundingPipeline ?? []).length === 0 ? (
              <p className="hq-muted-text">Pipeline data will populate from Grant Center snapshots.</p>
            ) : (
              (data.grants?.fundingPipeline ?? []).map((stage) => (
                <div key={stage.stage} className="hq-panel" style={{ padding: "0.85rem" }}>
                  <div style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>{stage.stage}</div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--hq-gold)" }}>{fmt(stage.value)}</div>
                  <div style={{ fontSize: "0.75rem" }}>{stage.count} opportunities</div>
                </div>
              ))
            )}
          </div>
        )}
        </HqPanel>
      </div>
    </HQLayout>
  );
};

export default EnterpriseIntelligencePage;
