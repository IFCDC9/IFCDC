import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { lazyWithRetry } from "../../utils/lazyWithRetry";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  HandHeart,
  FileText,
  Heart,
  LayoutGrid,
  LayoutDashboard,
  Monitor,
  Activity,
  UserPlus,
  FileBarChart,
  Sparkles,
  TrendingUp,
  Building2,
  Home,
  Shield,
  Calendar,
  Bell,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { grantsApi } from "../../api/grantsApi";
import { enterpriseApi } from "../../api/enterpriseApi";
import { analyticsApi } from "../../api/analyticsApi";
import { operationsApi } from "../../api/operationsApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { ActivityFeed } from "../../components/hq/ActivityFeed";
import { ApprovalTasksPanel } from "../../components/hq/ApprovalTasksPanel";
import { QuickActions } from "../../components/hq/QuickActions";
import { FinanceChart } from "../../components/hq/FinanceChart";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { EnterpriseModuleHub } from "../../components/hq/EnterpriseModuleHub";
import { HqLiveIndicator } from "../../components/hq/HqLiveIndicator";
import { useAuth } from "../../auth/AuthContext";
import { useHqRealtime } from "../../hooks/useHqRealtime";
import { workspaceApi, type UserWorkspace } from "../../api/workspaceApi";
import { hqApi } from "../../api/hqApi";
import { saveDashboardModeLocal, loadDashboardModeLocal, loadExecutiveWidgetsLocal } from "../../config/executiveWidgets";
import {
  DEFAULT_EXECUTIVE_OVERVIEW,
  DEFAULT_ANALYTICS_OVERVIEW,
  DEFAULT_OPERATIONS_OVERVIEW,
  DEFAULT_AURA_INSIGHT,
  DEFAULT_TRENDS,
  normalizeAnalyticsOverview,
  normalizeOperationsOverview,
  normalizeExecutiveOverview,
} from "../../data/founderDashboardDefaults";
import { formatWelcomeGreeting, formatExecutiveDateLine, formatExecutiveTagline } from "../../utils/welcomeGreeting";
import { formatCurrency } from "../../utils/safeFormat";
import { resolveOrganizationHealth, formatHealthScore } from "../../utils/organizationHealth";
import { intelligenceApi } from "../../api/intelligenceApi";
import { peopleApi } from "../../api/peopleApi";
import { HqWidgetErrorBoundary } from "../../components/hq/HqErrorBoundary";
import { HqDataUnavailable } from "../../components/hq/HqDataUnavailable";
import { isProductionClient, devPlaceholder, strictApiCall } from "../../utils/productionDataPolicy";

const ExecutiveWidgetDashboard = lazyWithRetry(
  () => import("../../components/hq/ExecutiveWidgetDashboard").then((m) => ({ default: m.ExecutiveWidgetDashboard })),
  "ExecutiveWidgetDashboard"
);

const QUICK_ACTIONS = [
  { label: "Add Employee", to: "/hq/people", icon: UserPlus },
  { label: "View Grants", to: "/hq/grants", icon: FileText },
  { label: "Analytics Center", to: "/hq/analytics", icon: FileBarChart },
  { label: "Software Health", to: "/hq/software", icon: Monitor },
  { label: "Ask AURA", to: "/hq/aura", icon: Sparkles },
  { label: "Board Portal", to: "/hq/board", icon: Building2 },
];

const ExecutiveDashboard: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { connected: realtimeConnected, anomalyAlerts } = useHqRealtime();
  const [viewMode, setViewMode] = useState<"standard" | "custom">(() => loadDashboardModeLocal());
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [initialWorkspace, setInitialWorkspace] = useState<UserWorkspace | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<{ key: string; name: string; autoLoaded?: boolean } | null>(null);
  const modeTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    workspaceApi.load()
      .then((ws) => {
        if (ws.dashboardMode === "standard" || ws.dashboardMode === "custom") {
          setViewMode(ws.dashboardMode);
          saveDashboardModeLocal(ws.dashboardMode);
        }
        if (ws.template) setActiveTemplate(ws.template);
        setInitialWorkspace(ws);
        setWorkspaceReady(true);
      })
      .catch(() => {
        setViewMode(loadDashboardModeLocal());
        setWorkspaceReady(true);
      });
  }, []);

  const setMode = useCallback((mode: "standard" | "custom") => {
    setViewMode(mode);
    saveDashboardModeLocal(mode);
    clearTimeout(modeTimer.current);
    modeTimer.current = setTimeout(() => {
      workspaceApi.save({ dashboardMode: mode }).catch(() => undefined);
    }, 400);
  }, []);
  const { data: rawData, isLoading, isError, isFetched: executiveFetched } = useQuery({
    queryKey: ["hq-executive-overview"],
    queryFn: () => hqApi.executiveOverview(),
    staleTime: 120_000,
    retry: 1,
  });

  const analytics = useQuery({
    queryKey: ["hq-founder-analytics"],
    queryFn: () => analyticsApi.overview(),
    staleTime: 120_000,
    retry: 1,
  });

  const trends = useQuery({
    queryKey: ["hq-founder-trends"],
    queryFn: () => strictApiCall(() => analyticsApi.trends(), DEFAULT_TRENDS),
    placeholderData: devPlaceholder(DEFAULT_TRENDS),
    staleTime: 300_000,
    retry: isProductionClient ? 1 : false,
  });

  const financeDetail = useQuery({
    queryKey: ["hq-founder-finance"],
    queryFn: () =>
      isProductionClient
        ? analyticsApi.finance()
        : analyticsApi.finance().catch(() => ({ monthlyTrend: [] })),
    staleTime: 300_000,
    retry: isProductionClient ? 1 : false,
  });

  const ops = useQuery({
    queryKey: ["hq-founder-ops"],
    queryFn: () => strictApiCall(() => operationsApi.overview(), DEFAULT_OPERATIONS_OVERVIEW),
    placeholderData: devPlaceholder(DEFAULT_OPERATIONS_OVERVIEW),
    staleTime: 120_000,
    retry: isProductionClient ? 1 : false,
  });

  const aura = useQuery({
    queryKey: ["hq-founder-aura"],
    queryFn: () =>
      strictApiCall(
        () =>
          analyticsApi.auraInsights(
            "Provide 3 executive priorities for the IFCDC founder based on current organization health."
          ),
        DEFAULT_AURA_INSIGHT
      ),
    placeholderData: devPlaceholder(DEFAULT_AURA_INSIGHT),
    staleTime: 600_000,
    retry: false,
  });

  const activity = useQuery({
    queryKey: ["hq-activity-feed"],
    queryFn: () =>
      isProductionClient
        ? analyticsApi.activity(15)
        : analyticsApi.activity(15).catch(() => ({ activity: DEFAULT_EXECUTIVE_OVERVIEW.recentActivity })),
    staleTime: 60_000,
    retry: false,
    refetchInterval: 90_000,
  });

  const grantPipeline = useQuery({
    queryKey: ["hq-exec-grant-pipeline"],
    queryFn: () =>
      isProductionClient ? grantsApi.pipeline() : grantsApi.pipeline().catch(() => ({ pipeline: [] })),
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const grantDeadlines = useQuery({
    queryKey: ["hq-exec-grant-deadlines"],
    queryFn: () =>
      isProductionClient ? grantsApi.deadlines(true) : grantsApi.deadlines(true).catch(() => ({ deadlines: [] })),
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const enterpriseNotifs = useQuery({
    queryKey: ["hq-exec-notifications"],
    queryFn: () =>
      isProductionClient
        ? enterpriseApi.notifications()
        : enterpriseApi.notifications().catch(() => ({ notifications: [], unreadCount: 0 })),
    staleTime: 60_000,
    refetchInterval: 90_000,
  });

  const upcomingEvents = useQuery({
    queryKey: ["hq-exec-events"],
    queryFn: () =>
      isProductionClient
        ? operationsApi.list("/calendar/events")
        : operationsApi.list("/calendar/events").catch(() => ({ items: [] })),
    staleTime: 120_000,
  });

  const programAnalytics = useQuery({
    queryKey: ["hq-exec-programs"],
    queryFn: () => (isProductionClient ? analyticsApi.programs() : analyticsApi.programs().catch(() => null)),
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const payrollAnalytics = useQuery({
    queryKey: ["hq-exec-payroll"],
    queryFn: () => (isProductionClient ? analyticsApi.payroll() : analyticsApi.payroll().catch(() => null)),
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const peopleAnalytics = useQuery({
    queryKey: ["hq-exec-people"],
    queryFn: () => (isProductionClient ? analyticsApi.people() : analyticsApi.people().catch(() => null)),
    staleTime: 120_000,
  });

  const workforceIntel = useQuery({
    queryKey: ["hq-workforce-intelligence"],
    queryFn: () =>
      isProductionClient ? peopleApi.phase3Intelligence() : peopleApi.phase3Intelligence().catch(() => null),
    staleTime: 120_000,
    enabled: viewMode === "standard",
  });

  const dailyBriefing = useQuery({
    queryKey: ["hq-exec-daily-briefing"],
    queryFn: () =>
      isProductionClient ? analyticsApi.dailyBriefing() : analyticsApi.dailyBriefing().catch(() => null),
    staleTime: 300_000,
    enabled: viewMode === "standard",
  });

  const opsBriefing = useQuery({
    queryKey: ["hq-ops-briefing"],
    queryFn: () =>
      isProductionClient ? hqApi.auraOperationsBriefing() : hqApi.auraOperationsBriefing().catch(() => null),
    staleTime: 120_000,
    enabled: viewMode === "standard",
  });

  const complianceAlerts = useQuery({
    queryKey: ["hq-exec-compliance"],
    queryFn: () =>
      isProductionClient
        ? hqApi.auraComplianceTracker()
        : hqApi.auraComplianceTracker().catch(() => ({ overdue: 0, dueNext14Days: 0, deadlines: [] })),
    staleTime: 120_000,
    enabled: viewMode === "standard",
  });

  const scorecard = useQuery({
    queryKey: ["hq-intelligence-scorecard"],
    queryFn: () =>
      isProductionClient ? intelligenceApi.scorecard() : intelligenceApi.scorecard().catch(() => null),
    staleTime: 120_000,
    enabled: viewMode === "standard",
  });

  const healthForecast = useQuery({
    queryKey: ["hq-intelligence-health-forecast"],
    queryFn: () => intelligenceApi.forecast().catch(() => null),
    staleTime: 180_000,
    enabled: viewMode === "standard",
  });

  const morningBriefing = useQuery({
    queryKey: ["hq-copilot-morning"],
    queryFn: () => intelligenceApi.morningBriefing().catch(() => null),
    staleTime: 300_000,
    enabled: viewMode === "standard",
  });

  const divisions = useQuery({
    queryKey: ["hq-intelligence-divisions"],
    queryFn: () => intelligenceApi.divisions().catch(() => null),
    staleTime: 120_000,
    enabled: viewMode === "standard",
  });

  const correctiveActions = useQuery({
    queryKey: ["hq-copilot-corrective"],
    queryFn: () => intelligenceApi.correctiveActions().catch(() => null),
    staleTime: 120_000,
    enabled: viewMode === "standard",
  });

  const data = normalizeExecutiveOverview(
    rawData ?? (isProductionClient ? null : executiveFetched ? null : DEFAULT_EXECUTIVE_OVERVIEW)
  );
  const analyticsData = analytics.data
    ? normalizeAnalyticsOverview(analytics.data)
    : normalizeAnalyticsOverview(
        isProductionClient ? null : analytics.isFetched ? null : DEFAULT_ANALYTICS_OVERVIEW
      );
  const opsData = normalizeOperationsOverview(ops.data);

  const executiveCoreFailed =
    isProductionClient && (isError || (executiveFetched && !rawData) || !data);
  const analyticsCoreFailed = isProductionClient && analytics.isError && !analyticsData;

  if (isProductionClient && isLoading && !rawData) {
    return <HqLoading message="Loading executive command center…" />;
  }

  if (executiveCoreFailed) {
    return (
      <HqDataUnavailable
        message="Executive overview could not be loaded from production APIs. Demo metrics are disabled in production."
        detail={isError ? "GET /api/hq/executive/overview failed" : undefined}
        onRetry={() => {
          void queryClient.invalidateQueries({ queryKey: ["hq-executive-overview"] });
          void queryClient.invalidateQueries({ queryKey: ["hq-founder-analytics"] });
        }}
      />
    );
  }

  const healthLoading = !analytics.isFetched && !executiveFetched;
  const health = resolveOrganizationHealth(analyticsData, data) ?? (healthLoading ? null : data?.organizationHealth ?? null);
  const healthScore = health?.overall;
  const healthScoreLabel = formatHealthScore(health, healthLoading);
  const metrics = data?.metrics;
  const trendData = financeDetail.data?.monthlyTrend as { month: string; cashFlow: number; donations: number; expenses: number }[] | undefined;
  const greeting = formatWelcomeGreeting(user);
  const financialHealth = analyticsData?.finance.financialHealthScore ?? 0;
  const softwareHealthy =
    data?.softwareDivision?.operational ??
    data?.softwareDivision?.healthy ??
    opsData?.software?.healthy ??
    0;
  const softwareTotal = data?.softwareDivision?.total ?? opsData?.software?.total ?? 0;
  const softwarePolled = data?.softwareDivision?.polledHealthy;
  const hrActive = analyticsData?.people.totalPeople ?? metrics?.totalEmployees ?? 0;
  const grantsActive = analyticsData?.grants.activeAwards ?? metrics?.activeGrants ?? 0;
  const complianceOverdue = complianceAlerts.data?.overdue ?? 0;

  return (
    <>
      <div className="hq-founder-hero hq-fade-in">
        <div>
          <p className="hq-founder-hero-eyebrow">IFCDC Headquarters · Executive Command</p>
          <h2>Welcome back, <span className="hq-founder-name">{greeting}.</span></h2>
          <p>{formatExecutiveDateLine()}</p>
          <p className="hq-founder-hero-tagline">{formatExecutiveTagline(user)}</p>
        </div>
        <div className="hq-founder-hero-meta">
          <StatusBadge label={`Health ${healthScoreLabel}`} variant={(healthScore ?? 0) >= 80 ? "success" : (healthScore ?? 0) >= 60 ? "warning" : "danger"} />
          <StatusBadge label={user?.enterpriseRoleLabel ?? "Founder"} variant="gold" />
          <HqLiveIndicator intervalSec={0} connected={realtimeConnected} />
        </div>
      </div>

      {anomalyAlerts.length > 0 && (
        <div className="hq-anomaly-alert-strip hq-fade-in" role="alert">
          {anomalyAlerts.slice(0, 3).map((a) => (
            <div key={a.id} className={`hq-anomaly-alert hq-sev-${a.severity}`}>
              <strong>{a.title}</strong>
              <span>{a.detail}</span>
            </div>
          ))}
        </div>
      )}

      <div className="hq-executive-health-strip hq-fade-in" aria-label="Enterprise health at a glance">
        <HqWidgetErrorBoundary label="Health strip">
        <div className="hq-executive-health-card">
          <span className="hq-executive-health-label">Organization</span>
          <span className="hq-executive-health-value">{healthScoreLabel}</span>
          <span className="hq-executive-health-meta">{health?.grade ?? "Composite"}</span>
        </div>
        <div className="hq-executive-health-card">
          <span className="hq-executive-health-label">Financial</span>
          <span className="hq-executive-health-value">{financialHealth}%</span>
          <span className="hq-executive-health-meta">{formatCurrency(analyticsData?.finance.cashFlow ?? 0)} cash flow</span>
        </div>
        <div className="hq-executive-health-card">
          <span className="hq-executive-health-label">Grants</span>
          <span className="hq-executive-health-value">{grantsActive}</span>
          <span className="hq-executive-health-meta">{complianceOverdue > 0 ? `${complianceOverdue} overdue` : "On track"}</span>
        </div>
        <div className="hq-executive-health-card">
          <span className="hq-executive-health-label">People & HR</span>
          <span className="hq-executive-health-value">{hrActive}</span>
          <span className="hq-executive-health-meta">{(peopleAnalytics.data as { volunteerCount?: number })?.volunteerCount ?? analyticsData?.people.volunteers ?? 0} volunteers</span>
        </div>
        <div className="hq-executive-health-card">
          <span className="hq-executive-health-label">System Health</span>
          <span className="hq-executive-health-value">{softwareHealthy}/{softwareTotal || "—"}</span>
          <span className="hq-executive-health-meta">
            {softwarePolled != null && softwarePolled !== softwareHealthy
              ? `${softwarePolled} polled · operational score`
              : "Apps operational"}
          </span>
        </div>
        </HqWidgetErrorBoundary>
      </div>

      <HqWidgetErrorBoundary label="KPI summary">
      <div className="hq-kpi-grid hq-founder-kpi-grid hq-fade-in">
        <KpiCard label="Organization Health" value={healthScoreLabel} icon={Activity} variant={(healthScore ?? 0) >= 80 ? "success" : (healthScore ?? 0) >= 60 ? "warning" : healthScore == null ? "muted" : "danger"} meta={health?.grade ?? "Composite score"} />
        <KpiCard label="Financial Health" value={`${financialHealth}%`} icon={TrendingUp} variant={financialHealth >= 70 ? "success" : "warning"} meta={formatCurrency(analyticsData?.finance.cashFlow ?? 0)} />
        <KpiCard label="Active Grants" value={grantsActive} icon={FileText} meta={formatCurrency(analyticsData?.grants.totalAwarded ?? 0)} />
        <KpiCard label="Total People" value={hrActive} icon={Users} meta={`${analyticsData?.people.employees ?? metrics?.activeEmployees ?? 0} employees`} />
        <KpiCard label="Donation Revenue" value={formatCurrency(analyticsData?.donations.total ?? metrics?.donationRevenue ?? 0)} icon={Heart} variant="success" />
        <KpiCard label="System Status" value={`${softwareHealthy}/${softwareTotal || 0}`} icon={Monitor} variant={softwareHealthy === softwareTotal && softwareTotal > 0 ? "success" : "warning"} meta="Software Division" />
      </div>
      </HqWidgetErrorBoundary>

      <HqWidgetErrorBoundary label="Executive scorecard">
      {(scorecard.data as { pillars?: { label: string; score: number; grade: string; status: string }[] } | null)?.pillars && (
        <div className="hq-executive-scorecard-strip hq-fade-in" aria-label="Executive scorecard">
          {((scorecard.data as { pillars: { id: string; label: string; score: number; grade: string; status: string }[] }).pillars).map((p) => (
            <div key={p.id} className={`hq-executive-scorecard-pillar hq-score-${p.status}`}>
              <span className="hq-executive-health-label">{p.label}</span>
              <span className="hq-executive-health-value">{p.score}%</span>
              <span className="hq-executive-health-meta">{p.grade}</span>
            </div>
          ))}
        </div>
      )}
      </HqWidgetErrorBoundary>

      <nav className="hq-founder-command-strip hq-fade-in" aria-label="Quick module access">
        <Link to="/hq/people" className="primary"><Users size={14} /> People & HR</Link>
        <Link to="/hq/grants"><FileText size={14} /> Grant Center</Link>
        <Link to="/hq/finance"><TrendingUp size={14} /> Financial Center</Link>
        <Link to="/hq/analytics"><FileBarChart size={14} /> Analytics</Link>
        <Link to="/hq/payroll"><Monitor size={14} /> Payroll</Link>
        <Link to="/hq/people?type=volunteer"><HandHeart size={14} /> Volunteers</Link>
        <Link to="/hq/aura"><Sparkles size={14} /> AURA</Link>
      </nav>

      {viewMode === "standard" && isLoading && (
        <HqLoading message="Refreshing enterprise metrics…" />
      )}
      {viewMode === "standard" && analyticsCoreFailed && (
        <div className="hq-panel" style={{ padding: "0.75rem 1rem", marginBottom: "1rem", color: "var(--hq-warning)", fontSize: "0.85rem" }}>
          Analytics API unavailable — executive overview metrics shown without analytics enrichment.
        </div>
      )}
      {!isProductionClient && viewMode === "standard" && isError && (
        <div className="hq-panel" style={{ padding: "0.75rem 1rem", marginBottom: "1rem", color: "var(--hq-warning)", fontSize: "0.85rem" }}>
          Live metrics unavailable — showing development placeholder data.
        </div>
      )}

      <div className="hq-dashboard-mode-bar">
        <HqLiveIndicator intervalSec={0} connected={realtimeConnected} />
        {activeTemplate && (
          <StatusBadge
            label={activeTemplate.autoLoaded ? `Role template: ${activeTemplate.name}` : activeTemplate.name}
            variant="gold"
          />
        )}
        <button type="button" className={`hq-btn hq-btn-sm ${viewMode === "standard" ? "hq-btn-primary" : "hq-btn-ghost"}`} onClick={() => setMode("standard")}>
          <LayoutDashboard size={14} /> Standard View
        </button>
        <button type="button" className={`hq-btn hq-btn-sm ${viewMode === "custom" ? "hq-btn-primary" : "hq-btn-ghost"}`} onClick={() => setMode("custom")}>
          <LayoutGrid size={14} /> Custom Widgets
        </button>
      </div>

      {viewMode === "custom" && !workspaceReady && <HqLoading message="Loading your workspace…" />}
      {viewMode === "custom" && workspaceReady && (
        <Suspense fallback={<HqLoading message="Loading custom dashboard…" />}>
          <ExecutiveWidgetDashboard dashboardMode={viewMode} initialWorkspace={initialWorkspace} />
        </Suspense>
      )}

      {viewMode === "standard" && (
        <>
          {(morningBriefing.data || dailyBriefing.data || opsBriefing.data) && (
            <div className="hq-grid-2 hq-fade-in" style={{ marginBottom: "1.25rem" }}>
              <HqPanel title="AURA Executive Briefing" subtitle="Morning intelligence for leadership" action={{ label: "AURA Command Center", to: "/hq/aura" }}>
                {morningBriefing.isLoading && dailyBriefing.isLoading ? <HqLoading /> : (morningBriefing.data || dailyBriefing.data) ? (
                  <>
                    <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.1rem", fontSize: "0.82rem", color: "var(--hq-text-muted)" }}>
                      {((morningBriefing.data?.priorities as string[]) ?? (dailyBriefing.data?.highlights as string[]) ?? []).slice(0, 5).map((h: string) => <li key={h}>{h}</li>)}
                    </ul>
                    <p className="hq-muted-text" style={{ fontSize: "0.78rem", margin: 0, lineHeight: 1.5 }}>
                      {String(morningBriefing.data?.content ?? dailyBriefing.data?.content ?? "").slice(0, 400)}
                    </p>
                  </>
                ) : <p className="hq-muted-text">Briefing will generate on next scheduled run.</p>}
              </HqPanel>
              <HqPanel title="Executive Tasks & Alerts" subtitle="Upcoming priorities and corrective actions" action={{ label: "Intelligence", to: "/hq/intelligence" }}>
                <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.82rem" }}>
                  {((correctiveActions.data?.correctiveActions as { action: string; severity: string }[]) ?? []).slice(0, 4).map((a, i) => (
                    <li key={i} style={{ marginBottom: "0.35rem" }}>{a.action}</li>
                  ))}
                  {((morningBriefing.data?.pendingTasks as { title: string }[]) ?? []).slice(0, 3).map((t) => (
                    <li key={t.title} style={{ marginBottom: "0.35rem" }}>{t.title}</li>
                  ))}
                </ul>
                {(complianceAlerts.data?.overdue ?? 0) > 0 && (
                  <StatusBadge label={`${complianceAlerts.data?.overdue} compliance items overdue`} variant="danger" />
                )}
              </HqPanel>
            </div>
          )}

          {((healthForecast.data as { organizationHealth?: { history?: { period: string; value: number }[] } })?.organizationHealth?.history?.length ?? 0) > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
            <HqPanel title="Organization Health Trend" subtitle="Warehouse metric history" action={{ label: "Forecasts", to: "/hq/intelligence" }}>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={(healthForecast.data as { organizationHealth: { history: { period: string; value: number }[] } }).organizationHealth.history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} stroke="var(--hq-text-muted)" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="var(--hq-text-muted)" />
                  <Tooltip contentStyle={{ background: "var(--hq-black-card)", border: "1px solid var(--hq-gold-border)" }} />
                  <Line type="monotone" dataKey="value" name="Health %" stroke="var(--hq-gold)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </HqPanel>
            </div>
          )}

          {divisions.data?.divisions && (
            <div style={{ marginBottom: "1.25rem" }}>
            <HqPanel title="Division Integration" subtitle="Read-only snapshots from IFCDC divisions" action={{ label: "Software Division", to: "/hq/software" }}>
              <div className="hq-division-strip">
                {divisions.data.divisions.map((d) => (
                  <div key={d.id} className={`hq-division-card ${d.healthy ? "healthy" : "degraded"}`}>
                    <span className="hq-division-name">{d.name}</span>
                    <span className="hq-division-summary">{d.summary}</span>
                    {d.id === "barbers" && <StatusBadge label="Production Locked" variant="gold" />}
                  </div>
                ))}
              </div>
            </HqPanel>
            </div>
          )}

          <div style={{ marginBottom: "1.25rem" }}>
            <ApprovalTasksPanel />
          </div>

          <div className="hq-grid-2" style={{ marginBottom: "1.25rem" }}>
            <HqPanel title="Grant Pipeline" subtitle="Live funding stages" action={{ label: "Grant Center", to: "/hq/grants" }}>
              <div className="hq-pipeline">
                {(grantPipeline.data?.pipeline ?? []).slice(0, 5).map((stage: { stage: string; count: number; value: number }) => (
                  <div key={stage.stage} className="hq-pipeline-stage">
                    <div className="hq-pipeline-label">{stage.stage}</div>
                    <div className="hq-pipeline-meta">{stage.count} grants · {formatCurrency(stage.value ?? 0)}</div>
                  </div>
                ))}
                {!grantPipeline.data?.pipeline?.length && <p className="hq-muted-text">No pipeline data yet — add opportunities in Grant Center</p>}
              </div>
            </HqPanel>
            <HqPanel title="Reporting Deadlines" subtitle="Compliance & submissions" action={{ label: "View all", to: "/hq/grants" }}>
              <ul className="hq-activity-list">
                {(grantDeadlines.data?.deadlines ?? []).slice(0, 5).map((d: { id: string; title: string; due_date: string; deadline_type: string }) => (
                  <li key={d.id} className="hq-activity-item">
                    <div className="hq-activity-content">
                      <div className="hq-activity-title">{d.title}</div>
                      <div className="hq-activity-detail">{d.deadline_type}</div>
                    </div>
                    <div className="hq-activity-time">{new Date(d.due_date).toLocaleDateString()}</div>
                  </li>
                ))}
                {!grantDeadlines.data?.deadlines?.length && <li className="hq-muted-text">No upcoming deadlines</li>}
              </ul>
            </HqPanel>
          </div>

          <div className="hq-grid-2" style={{ marginBottom: "1.25rem" }}>
            <HqPanel title="Upcoming Events" subtitle="Organization calendar" action={{ label: "Calendar", to: "/hq/calendar" }}>
              <ul className="hq-activity-list">
                {((upcomingEvents.data?.items ?? []) as { id: string; title: string; start_at: string; location?: string }[])
                  .slice(0, 5)
                  .map((e) => (
                    <li key={e.id} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{e.title}</div>
                        <div className="hq-activity-detail">{e.location ?? "—"}</div>
                      </div>
                      <div className="hq-activity-time">{new Date(e.start_at).toLocaleDateString()}</div>
                    </li>
                  ))}
                {!upcomingEvents.data?.items?.length && <li className="hq-muted-text">No scheduled events</li>}
              </ul>
            </HqPanel>
            <HqPanel title="Enterprise Notifications" subtitle={`${enterpriseNotifs.data?.unreadCount ?? 0} unread`} action={{ label: "Notifications", to: "/hq/notifications" }}>
              <ul className="hq-activity-list">
                {(enterpriseNotifs.data?.notifications ?? []).slice(0, 5).map((n: { id: string; title: string; message: string; created_at: string }) => (
                  <li key={n.id} className="hq-activity-item">
                    <div className="hq-activity-content">
                      <div className="hq-activity-title">{n.title}</div>
                      <div className="hq-activity-detail">{n.message?.slice(0, 80)}</div>
                    </div>
                    <Bell size={14} style={{ color: "var(--hq-gold)", flexShrink: 0 }} />
                  </li>
                ))}
                {!enterpriseNotifs.data?.notifications?.length && <li className="hq-muted-text">No notifications</li>}
              </ul>
            </HqPanel>
          </div>

          <HqWidgetErrorBoundary label="Operations snapshot">
          <div className="hq-kpi-grid hq-founder-secondary-kpis">
            <KpiCard label="Housing Units" value={opsData.housing.units} icon={Home} meta={opsData.housing.placements > 0 ? `${opsData.housing.placements} active placements` : "No housing data yet"} />
            <KpiCard label="Open Risks" value={opsData.compliance.openRisks} icon={Shield} variant={opsData.compliance.highRisks > 0 ? "warning" : "success"} meta={`${opsData.compliance.policies} policies active`} />
            <KpiCard label="Upcoming Events" value={opsData.calendar.upcomingEvents} icon={Calendar} meta={`${opsData.board.upcomingMeetings} board meetings`} />
            <KpiCard label="Pipeline Value" value={formatCurrency(grantPipeline.data?.pipelineValue ?? analyticsData?.grants.pipelineValue ?? 0)} icon={FileText} variant="gold" />
          </div>
          </HqWidgetErrorBoundary>

          <div className="hq-grid-2" style={{ marginBottom: "1.25rem" }}>
            <HqPanel title="Program Performance" subtitle="Live impact across IFCDC community programs" action={{ label: "Programs", to: "/hq/programs" }}>
              <div className="hq-widget-stat-grid" style={{ marginBottom: "0.75rem" }}>
                <div className="hq-widget-stat">
                  <span className="hq-widget-stat-val">{(programAnalytics.data as { hqPrograms?: { active: number } })?.hqPrograms?.active ?? analyticsData?.programs.programsRunning ?? "—"}</span>
                  <span className="hq-widget-stat-lbl">Active Programs</span>
                </div>
                <div className="hq-widget-stat">
                  <span className="hq-widget-stat-val">{(programAnalytics.data as { hqPrograms?: { participants: number } })?.hqPrograms?.participants ?? analyticsData?.programs.participants ?? "—"}</span>
                  <span className="hq-widget-stat-lbl">Participants</span>
                </div>
              </div>
              <ul className="hq-activity-list">
                {((programAnalytics.data as { programModules?: { name: string; participants: number; budgetSpent: number; budgetAllocated: number }[] })?.programModules ?? []).slice(0, 4).map((p) => (
                  <li key={p.name} className="hq-activity-item">
                    <div className="hq-activity-content">
                      <div className="hq-activity-title">{p.name}</div>
                      <div className="hq-activity-detail">{p.participants} participants · {p.budgetAllocated > 0 ? Math.round((p.budgetSpent / p.budgetAllocated) * 100) : 0}% budget utilized</div>
                    </div>
                  </li>
                ))}
                {!((programAnalytics.data as { programModules?: unknown[] })?.programModules ?? []).length && (
                  <li className="hq-muted-text">Program metrics will appear as modules are active</li>
                )}
              </ul>
            </HqPanel>
            <HqPanel title="Payroll & Volunteers" subtitle="Labor costs and community workforce" action={{ label: "Payroll", to: "/hq/payroll" }}>
              <div className="hq-widget-stat-grid" style={{ marginBottom: "0.75rem" }}>
                <div className="hq-widget-stat">
                  <span className="hq-widget-stat-val">{(payrollAnalytics.data as { totalRuns?: number })?.totalRuns ?? "—"}</span>
                  <span className="hq-widget-stat-lbl">Payroll Runs</span>
                </div>
                <div className="hq-widget-stat">
                  <span className="hq-widget-stat-val">{formatCurrency(((payrollAnalytics.data as { monthlyPayroll?: { net: number }[] })?.monthlyPayroll?.[0]?.net) ?? 0)}</span>
                  <span className="hq-widget-stat-lbl">Latest Net</span>
                </div>
                <div className="hq-widget-stat">
                  <span className="hq-widget-stat-val">{(peopleAnalytics.data as { volunteerCount?: number })?.volunteerCount ?? analyticsData?.people.volunteers ?? "—"}</span>
                  <span className="hq-widget-stat-lbl">Volunteers</span>
                </div>
                <div className="hq-widget-stat">
                  <span className="hq-widget-stat-val">{(peopleAnalytics.data as { volunteerHours?: number })?.volunteerHours ?? "—"}</span>
                  <span className="hq-widget-stat-lbl">Vol. Hours</span>
                </div>
              </div>
              <Link to="/hq/people?type=volunteer" className="hq-entity-link">Volunteer Directory →</Link>
            </HqPanel>
          </div>

          <div className="hq-grid-2" style={{ marginBottom: "1.25rem" }}>
            <HqPanel title="Workforce Intelligence" subtitle="Phase 3 — hiring pipeline, HR compliance, staffing forecast" action={{ label: "People & HR", to: "/hq/people?tab=intelligence" }}>
              {workforceIntel.isLoading && <div className="hq-muted-text">Loading workforce analytics…</div>}
              {workforceIntel.data && (
                <div className="hq-widget-stat-grid">
                  <div className="hq-widget-stat">
                    <span className="hq-widget-stat-val">{(workforceIntel.data as { hrComplianceScore?: { score: number } }).hrComplianceScore?.score ?? "—"}</span>
                    <span className="hq-widget-stat-lbl">HR Compliance</span>
                  </div>
                  <div className="hq-widget-stat">
                    <span className="hq-widget-stat-val">{(workforceIntel.data as { hiringPipeline?: { open: number } }).hiringPipeline?.open ?? "—"}</span>
                    <span className="hq-widget-stat-lbl">Open Applicants</span>
                  </div>
                  <div className="hq-widget-stat">
                    <span className="hq-widget-stat-val">{formatCurrency((workforceIntel.data as { payrollForecast?: { monthlyLabor: number } }).payrollForecast?.monthlyLabor ?? 0)}</span>
                    <span className="hq-widget-stat-lbl">Monthly Labor</span>
                  </div>
                  <div className="hq-widget-stat">
                    <span className="hq-widget-stat-val">{(workforceIntel.data as { staffingForecast?: { forecast?: { projectedHeadcount: number }[] } }).staffingForecast?.forecast?.[5]?.projectedHeadcount ?? (workforceIntel.data as { staffingForecast?: { currentHeadcount: number } }).staffingForecast?.currentHeadcount ?? "—"}</span>
                    <span className="hq-widget-stat-lbl">6-Mo Headcount</span>
                  </div>
                </div>
              )}
            </HqPanel>
            {trends.data && (
              <HqPanel title="Predictive Outlook" subtitle="3-month rolling projection" action={{ label: "Trend Analysis", to: "/hq/analytics" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "0.75rem" }}>
                  <div><div style={{ fontSize: "0.72rem", color: "var(--hq-text-dim)" }}>Trend</div><StatusBadge label={String((trends.data as { trend: string }).trend)} variant={(trends.data as { trend: string }).trend === "positive" ? "success" : "warning"} /></div>
                  <div><div style={{ fontSize: "0.72rem", color: "var(--hq-text-dim)" }}>Projected Cash Flow</div><div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--hq-gold)" }}>{formatCurrency((trends.data as { projectedCashFlow: number }).projectedCashFlow)}</div></div>
                  <div><div style={{ fontSize: "0.72rem", color: "var(--hq-text-dim)" }}>Donation Growth</div><div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--hq-gold)" }}>{(trends.data as { donationGrowth: number }).donationGrowth}%</div></div>
                </div>
              </HqPanel>
            )}

            <HqPanel title="AURA Executive Recommendations" subtitle="AI-powered leadership insights" action={{ label: "AURA Command Center", to: "/hq/aura" }}>
              {aura.isLoading && <div className="hq-muted-text">Analyzing organization data…</div>}
              {aura.data && (
                <p style={{ fontSize: "0.875rem", lineHeight: 1.65, color: "var(--hq-text-muted)", whiteSpace: "pre-wrap", margin: 0 }}>
                  {aura.data.insight}
                </p>
              )}
            </HqPanel>
          </div>

          <HqPanel title="Enterprise Module Hub" subtitle="27 connected systems — one login, one platform, one source of truth" action={{ label: "Organization Analytics", to: "/hq/analytics" }}>
            <EnterpriseModuleHub />
          </HqPanel>

          <div className="hq-grid-main-side" style={{ marginTop: "1.25rem" }}>
            <div>
              {trendData && trendData.length > 0 ? (
                <HqPanel title="Cash Flow Analytics" subtitle="12-month interactive trend" action={{ label: "Financial Center", to: "/hq/finance" }}>
                  <div className="hq-chart" style={{ width: "100%", height: 260 }}>
                    <ResponsiveContainer>
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} />
                        <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                        <Tooltip contentStyle={{ background: "#161616", border: "1px solid rgba(245,200,66,0.25)", borderRadius: 8 }} />
                        <Legend />
                        <Line type="monotone" dataKey="cashFlow" name="Cash Flow" stroke="#22c55e" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="donations" name="Revenue" stroke="#f5c842" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="expenses" name="Expenses" stroke="#6b7280" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </HqPanel>
              ) : (
                <HqPanel title="Financial Overview" subtitle="Donations vs expenses — last 6 months" action={{ label: "Financial Center", to: "/hq/finance" }}>
                  <FinanceChart data={data.monthlyTrend ?? []} />
                </HqPanel>
              )}

              {health && (
                <div style={{ marginTop: "1.25rem" }}>
                  <HqPanel title="Organization Health Score" subtitle="Finance · Grants · Software · Budget · Cash Flow" action={{ label: "Full Analytics", to: "/hq/analytics" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                      {(health?.factors ?? []).map((f) => (
                        <div key={f.label}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.2rem" }}>
                            <span>{f.label}</span>
                            <span style={{ color: "var(--hq-gold)" }}>{f.score}%</span>
                          </div>
                          <div style={{ height: 5, background: "rgba(255,255,255,0.08)", borderRadius: 3 }}>
                            <div style={{ width: `${f.score}%`, height: "100%", background: "var(--hq-gold)", borderRadius: 3 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </HqPanel>
                </div>
              )}
            </div>

            <div>
              <HqPanel title="Quick Actions" subtitle="Executive shortcuts across Headquarters">
                <QuickActions actions={QUICK_ACTIONS} />
              </HqPanel>

              <div style={{ marginTop: "1.25rem" }}>
                <HqPanel title="Headquarters Activity Feed" subtitle="Live cross-module events" action={{ label: "All notifications", to: "/hq/notifications" }}>
                  <ActivityFeed items={activity.data?.activity ?? data.recentActivity ?? []} linkable />
                </HqPanel>
              </div>

              {(analyticsData?.grants.complianceDue ?? 0) > 0 && (
                <div style={{ marginTop: "1.25rem" }}>
                  <HqPanel title="Compliance Alerts">
                    <StatusBadge label={`${analyticsData?.grants.complianceDue} grant reports due within 14 days`} variant="warning" />
                    <Link to="/hq/compliance" className="hq-entity-link" style={{ display: "block", marginTop: "0.5rem" }}>Open Compliance Center →</Link>
                  </HqPanel>
                </div>
              )}

              <div style={{ marginTop: "1.25rem" }}>
                <HqPanel title="Enterprise Reporting" subtitle="Export executive reports">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    <Link to="/hq/analytics?tab=reports&period=daily" className="hq-btn hq-btn-secondary hq-btn-sm">Daily Report</Link>
                    <Link to="/hq/analytics?tab=reports&period=weekly" className="hq-btn hq-btn-secondary hq-btn-sm">Weekly Report</Link>
                    <Link to="/hq/analytics?tab=board" className="hq-btn hq-btn-secondary hq-btn-sm">Board Dashboard</Link>
                  </div>
                </HqPanel>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default ExecutiveDashboard;
