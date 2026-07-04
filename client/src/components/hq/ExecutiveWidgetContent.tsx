import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { enterpriseApi } from "../../api/enterpriseApi";
import { grantsApi } from "../../api/grantsApi";
import { hqApi } from "../../api/hqApi";
import { analyticsApi } from "../../api/analyticsApi";
import { operationsApi } from "../../api/operationsApi";
import { ActivityFeed } from "./ActivityFeed";
import { QuickActions } from "./QuickActions";
import { ApprovalTasksPanel } from "./ApprovalTasksPanel";
import { EnterpriseModuleHub } from "./EnterpriseModuleHub";
import { StatusBadge } from "./StatusBadge";
import {
  DEFAULT_ANALYTICS_OVERVIEW,
  DEFAULT_OPERATIONS_OVERVIEW,
  normalizeAnalyticsOverview,
  normalizeOperationsOverview,
} from "../../data/founderDashboardDefaults";
import { isProductionClient, devPlaceholder, strictApiCall } from "../../utils/productionDataPolicy";
import { HqDataUnavailable } from "./HqDataUnavailable";
import { Users, FileText, Activity, Home, Shield, Calendar, Sparkles, FileBarChart, Monitor, Building2, HandHeart, Wallet, Target, Briefcase, DollarSign, Clock } from "lucide-react";
import { formatCurrency } from "../../utils/safeFormat";

const FOUNDER_ACTIONS = [
  { label: "People & HR", to: "/hq/people", icon: Users },
  { label: "Grant Center", to: "/hq/grants", icon: FileText },
  { label: "Financial Center", to: "/hq/finance", icon: Activity },
  { label: "Program Management", to: "/hq/programs", icon: Home },
  { label: "Analytics", to: "/hq/analytics", icon: FileBarChart },
  { label: "AURA", to: "/hq/aura", icon: Sparkles },
  { label: "Software Health", to: "/hq/software", icon: Monitor },
  { label: "Board Portal", to: "/hq/board", icon: Building2 },
];

const QUICK_ACTIONS = [
  { label: "People", to: "/hq/people", icon: Users },
  { label: "Grants", to: "/hq/grants", icon: FileText },
  { label: "Analytics", to: "/hq/analytics", icon: Activity },
  { label: "AURA", to: "/hq/aura", icon: Sparkles },
];

export const ExecutiveWidgetContent: React.FC<{ widgetId: string }> = ({ widgetId }) => {
  const overview = useQuery({
    queryKey: ["hq-executive-overview"],
    queryFn: () => (isProductionClient ? hqApi.executiveOverview() : hqApi.executiveOverview().catch(() => null)),
    staleTime: 60_000,
  });
  const analytics = useQuery({
    queryKey: ["hq-founder-analytics"],
    queryFn: () => strictApiCall(() => analyticsApi.overview(), DEFAULT_ANALYTICS_OVERVIEW),
    placeholderData: devPlaceholder(DEFAULT_ANALYTICS_OVERVIEW),
    staleTime: 60_000,
  });
  const trends = useQuery({ queryKey: ["hq-founder-trends"], queryFn: analyticsApi.trends, staleTime: 120_000 });
  const finance = useQuery({ queryKey: ["hq-founder-finance"], queryFn: analyticsApi.finance, staleTime: 120_000 });
  const activity = useQuery({ queryKey: ["hq-activity-feed"], queryFn: () => analyticsApi.activity(10), staleTime: 30_000 });
  const aura = useQuery({ queryKey: ["hq-widget-aura"], queryFn: () => analyticsApi.auraInsights(), staleTime: 300_000 });
  const ops = useQuery({
    queryKey: ["hq-founder-ops"],
    queryFn: () => strictApiCall(() => operationsApi.overview(), DEFAULT_OPERATIONS_OVERVIEW),
    placeholderData: devPlaceholder(DEFAULT_OPERATIONS_OVERVIEW),
    staleTime: 60_000,
  });
  const notifs = useQuery({ queryKey: ["enterprise-notif-count"], queryFn: enterpriseApi.notifications, staleTime: 30_000 });
  const software = useQuery({ queryKey: ["hq-software-division"], queryFn: hqApi.softwareDivision, staleTime: 30_000 });
  const grantDeadlines = useQuery({ queryKey: ["hq-exec-grant-deadlines"], queryFn: () => grantsApi.deadlines(true), staleTime: 120_000 });
  const upcomingEvents = useQuery({ queryKey: ["hq-exec-events"], queryFn: () => operationsApi.list("/calendar/events"), staleTime: 120_000 });
  const programs = useQuery({ queryKey: ["hq-widget-programs"], queryFn: analyticsApi.programs, staleTime: 120_000 });
  const payrollData = useQuery({ queryKey: ["hq-widget-payroll"], queryFn: analyticsApi.payroll, staleTime: 120_000 });
  const peopleData = useQuery({ queryKey: ["hq-widget-people"], queryFn: analyticsApi.people, staleTime: 120_000 });
  const kpiMonitor = useQuery({ queryKey: ["hq-widget-kpi-monitor"], queryFn: analyticsApi.kpiMonitoring, staleTime: 60_000 });
  const dailyBriefing = useQuery({ queryKey: ["hq-daily-briefing"], queryFn: () => analyticsApi.dailyBriefing(), staleTime: 300_000 });
  const commandCenter = useQuery({ queryKey: ["hq-command-center"], queryFn: analyticsApi.commandCenter, staleTime: 60_000 });

  const analyticsData = normalizeAnalyticsOverview(analytics.data);
  const opsData = normalizeOperationsOverview(ops.data);
  const hasAnalyticsData = Boolean(analyticsData);

  if (isProductionClient && widgetId === "health-score" && !analyticsData && analytics.isFetched) {
    return <HqDataUnavailable title="Analytics unavailable" message="Live organization health could not be loaded." />;
  }

  const health = analyticsData?.organizationHealth ?? overview.data?.organizationHealth;
  const trendData = finance.data?.monthlyTrend as { month: string; cashFlow: number; donations: number; expenses: number; payroll: number }[] | undefined;

  if (isProductionClient && !analyticsData && !overview.data && analytics.isFetched && overview.isFetched) {
    return <HqDataUnavailable title="No data available" message="Live metrics could not be loaded for this widget." />;
  }

  switch (widgetId) {
    case "health-score":
      return health ? (
        <div>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--hq-gold)", marginBottom: "0.5rem" }}>{health.overall}%</div>
          <StatusBadge label={health.grade} variant={health.overall >= 75 ? "success" : "warning"} />
          <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {(health.factors ?? []).slice(0, 4).map((f) => (
              <div key={f.label} style={{ fontSize: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>{f.label}</span><span style={{ color: "var(--hq-gold)" }}>{f.score}%</span></div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, marginTop: 2 }}>
                  <div style={{ width: `${f.score}%`, height: "100%", background: "var(--hq-gold)", borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : <div className="hq-muted-text">Loading…</div>;

    case "kpi-summary":
      if (!hasAnalyticsData) {
        return <div className="hq-muted-text">Analytics data unavailable — KPI summary will appear when headquarters metrics load.</div>;
      }
      return (
        <div className="hq-widget-stat-grid">
          <div className="hq-widget-stat"><span className="hq-widget-stat-val">{analyticsData!.people.totalPeople ?? "—"}</span><span className="hq-widget-stat-lbl">People</span></div>
          <div className="hq-widget-stat"><span className="hq-widget-stat-val">{analyticsData!.grants.activeAwards ?? "—"}</span><span className="hq-widget-stat-lbl">Grants</span></div>
          <div className="hq-widget-stat"><span className="hq-widget-stat-val">{formatCurrency(analyticsData!.finance.cashFlow)}</span><span className="hq-widget-stat-lbl">Cash Flow</span></div>
          <div className="hq-widget-stat"><span className="hq-widget-stat-val">{formatCurrency(analyticsData!.donations.total)}</span><span className="hq-widget-stat-lbl">Donations</span></div>
        </div>
      );

    case "cash-flow":
      return trendData?.length ? (
        <div className="hq-chart" style={{ height: "100%", minHeight: 180 }}>
          <ResponsiveContainer>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={{ background: "#161616", border: "1px solid rgba(245,200,66,0.25)", borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="cashFlow" stroke="#22c55e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="donations" stroke="#f5c842" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              <Line type="monotone" dataKey="payroll" stroke="#60a5fa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <div className="hq-muted-text">Loading chart…</div>;

    case "predictive":
      return trends.data ? (
        <div style={{ fontSize: "0.85rem" }}>
          <div style={{ marginBottom: "0.5rem" }}>Trend: <StatusBadge label={String((trends.data as { trend: string }).trend)} variant={(trends.data as { trend: string }).trend === "positive" ? "success" : "warning"} /></div>
          <div>Projected cash flow: <strong style={{ color: "var(--hq-gold)" }}>{formatCurrency((trends.data as { projectedCashFlow: number }).projectedCashFlow)}</strong></div>
          <div>Growth: {(trends.data as { donationGrowth: number }).donationGrowth}%</div>
          {(trends.data as { forecast?: { month: string; projectedCashFlow: number }[] }).forecast && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--hq-text-dim)" }}>
              6-mo forecast: {(trends.data as { forecast: { month: string; projectedCashFlow: number }[] }).forecast.slice(0, 3).map((f) => `${f.month}: ${formatCurrency(f.projectedCashFlow)}`).join(" · ")}
            </div>
          )}
        </div>
      ) : <div className="hq-muted-text">Loading…</div>;

    case "aura":
      return aura.data ? (
        <p style={{ fontSize: "0.82rem", lineHeight: 1.6, margin: 0, color: "var(--hq-text-muted)", whiteSpace: "pre-wrap" }}>{aura.data.insight}</p>
      ) : <div className="hq-muted-text">AURA analyzing…</div>;

    case "activity":
      return <ActivityFeed items={activity.data?.activity ?? overview.data?.recentActivity ?? []} linkable />;

    case "modules":
      return <EnterpriseModuleHub compact />;

    case "quick-actions":
      return <QuickActions actions={QUICK_ACTIONS} />;

    case "operations":
      if (ops.isLoading) return <div className="hq-muted-text">Loading operations snapshot…</div>;
      if (isProductionClient && ops.isError && ops.isFetched) {
        return <HqDataUnavailable title="Operations unavailable" message="Housing and operations metrics could not be loaded." onRetry={() => void ops.refetch()} />;
      }
      return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.82rem" }}>
          <div><Home size={14} /> Housing: {opsData.housing.units} units</div>
          <div><Shield size={14} /> Risks: {opsData.compliance.openRisks}</div>
          <div><Calendar size={14} /> Events: {opsData.calendar.upcomingEvents}</div>
          <div>Board: {opsData.board.upcomingMeetings} meetings</div>
          {opsData.housing.units === 0 && opsData.housing.placements === 0 && (
            <div className="hq-muted-text" style={{ gridColumn: "1 / -1", fontSize: "0.75rem" }}>
              No housing records yet — connect Housing Programs to populate this widget.
            </div>
          )}
        </div>
      );

    case "compliance":
      if (!hasAnalyticsData) {
        return <div className="hq-muted-text">Compliance metrics unavailable until analytics load.</div>;
      }
      return (
        <div>
          {(analyticsData!.grants.complianceDue ?? 0) > 0 ? (
            <>
              <StatusBadge label={`${analyticsData!.grants.complianceDue} grant reports due`} variant="warning" />
              <Link to="/hq/compliance" className="hq-entity-link" style={{ display: "block", marginTop: "0.5rem" }}>Compliance Center →</Link>
            </>
          ) : (
            <StatusBadge label="All compliance current" variant="success" />
          )}
          {opsData.compliance.highRisks > 0 && (
            <div style={{ marginTop: "0.5rem" }}>
              <StatusBadge label={`${opsData.compliance.highRisks} high-risk items`} variant="danger" />
            </div>
          )}
        </div>
      );

    case "grants-pipeline":
      if (!hasAnalyticsData) return <div className="hq-muted-text">Grant pipeline data unavailable.</div>;
      return (
        <div className="hq-widget-stat-grid">
          <div className="hq-widget-stat"><span className="hq-widget-stat-val">{analyticsData!.grants.activeAwards}</span><span className="hq-widget-stat-lbl">Active</span></div>
          <div className="hq-widget-stat"><span className="hq-widget-stat-val">{analyticsData!.grants.winRate}%</span><span className="hq-widget-stat-lbl">Win Rate</span></div>
          <div className="hq-widget-stat"><span className="hq-widget-stat-val">{formatCurrency(analyticsData!.grants.totalAwarded)}</span><span className="hq-widget-stat-lbl">Awarded</span></div>
          <div className="hq-widget-stat"><span className="hq-widget-stat-val">{analyticsData!.grants.complianceDue}</span><span className="hq-widget-stat-lbl">Due Soon</span></div>
        </div>
      );

    case "people-hr":
      if (!hasAnalyticsData) return <div className="hq-muted-text">People & HR metrics unavailable.</div>;
      return (
        <div className="hq-widget-stat-grid">
          <div className="hq-widget-stat"><span className="hq-widget-stat-val">{analyticsData!.people.totalPeople}</span><span className="hq-widget-stat-lbl">Total</span></div>
          <div className="hq-widget-stat"><span className="hq-widget-stat-val">{analyticsData!.people.employees}</span><span className="hq-widget-stat-lbl">Employees</span></div>
          <div className="hq-widget-stat"><span className="hq-widget-stat-val">{analyticsData!.people.volunteers}</span><span className="hq-widget-stat-lbl">Volunteers</span></div>
          <div className="hq-widget-stat"><span className="hq-widget-stat-val">{analyticsData!.people.activePayroll}</span><span className="hq-widget-stat-lbl">On Payroll</span></div>
        </div>
      );

    case "notifications":
      return notifs.data ? (
        <div>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: notifs.data.unreadCount > 0 ? "var(--hq-gold)" : "#22c55e", marginBottom: "0.5rem" }}>
            {notifs.data.unreadCount}
          </div>
          <StatusBadge label={notifs.data.unreadCount > 0 ? "Unread alerts" : "All caught up"} variant={notifs.data.unreadCount > 0 ? "warning" : "success"} />
          <Link to="/hq/notifications" className="hq-entity-link" style={{ display: "block", marginTop: "0.5rem" }}>Notifications Center →</Link>
        </div>
      ) : <div className="hq-muted-text">Loading…</div>;

    case "software-health":
      return software.data ? (
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
            {software.data.apps.filter((a) => a.health?.healthy).length} / {software.data.apps.length}
          </div>
          <StatusBadge label="Apps healthy" variant={software.data.apps.every((a) => a.health?.healthy) ? "success" : "warning"} pulse />
          <Link to="/hq/software" className="hq-entity-link" style={{ display: "block", marginTop: "0.5rem" }}>Software Division →</Link>
        </div>
      ) : <div className="hq-muted-text">Loading…</div>;

    case "approval-tasks":
      return (
        <div style={{ margin: "-0.5rem" }}>
          <ApprovalTasksPanel compact limit={5} />
        </div>
      );

    case "grant-deadlines":
      return (
        <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
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
      );

    case "upcoming-events":
      return (
        <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {((upcomingEvents.data?.items ?? []) as { id: string; title: string; start_at: string; location?: string }[]).slice(0, 5).map((e) => (
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
      );

    case "founder-actions":
      return <QuickActions actions={FOUNDER_ACTIONS} />;

    case "program-performance": {
      if (!hasAnalyticsData && !programs.data) {
        return <div className="hq-muted-text">Program metrics unavailable until analytics load.</div>;
      }
      const programData = programs.data as {
        hqPrograms?: { active: number; participants: number };
        communityImpact?: { volunteerHours: number };
        programModules?: { name: string; participants: number; budgetSpent: number; budgetAllocated: number }[];
      } | undefined;
      return (
        <div>
          <div className="hq-widget-stat-grid" style={{ marginBottom: "0.75rem" }}>
            <div className="hq-widget-stat">
              <span className="hq-widget-stat-val">{programData?.hqPrograms?.active ?? analyticsData?.programs.programsRunning ?? "—"}</span>
              <span className="hq-widget-stat-lbl">Programs</span>
            </div>
            <div className="hq-widget-stat">
              <span className="hq-widget-stat-val">{programData?.hqPrograms?.participants ?? analyticsData?.programs.participants ?? "—"}</span>
              <span className="hq-widget-stat-lbl">Participants</span>
            </div>
            <div className="hq-widget-stat">
              <span className="hq-widget-stat-val">{programData?.communityImpact?.volunteerHours ?? analyticsData?.people.hoursThisMonth ?? "—"}</span>
              <span className="hq-widget-stat-lbl">Vol. Hours</span>
            </div>
          </div>
          <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {(programData?.programModules ?? []).slice(0, 4).map((p) => (
              <li key={p.name} className="hq-activity-item">
                <div className="hq-activity-content">
                  <div className="hq-activity-title">{p.name}</div>
                  <div className="hq-activity-detail">{p.participants} participants · {p.budgetAllocated > 0 ? Math.round((p.budgetSpent / p.budgetAllocated) * 100) : 0}% budget used</div>
                </div>
              </li>
            ))}
            {!programData?.programModules?.length && (
              <li className="hq-muted-text">Program metrics will appear as modules are active</li>
            )}
          </ul>
          <Link to="/hq/programs" className="hq-entity-link" style={{ display: "block", marginTop: "0.5rem" }}>Program Management →</Link>
        </div>
      );
    }

    case "payroll-snapshot":
      return payrollData.data ? (
        <div>
          <div className="hq-widget-stat-grid" style={{ marginBottom: "0.75rem" }}>
            <div className="hq-widget-stat">
              <span className="hq-widget-stat-val">{(payrollData.data as { totalRuns: number }).totalRuns}</span>
              <span className="hq-widget-stat-lbl">Runs</span>
            </div>
            <div className="hq-widget-stat">
              <span className="hq-widget-stat-val">{formatCurrency(((payrollData.data as { monthlyPayroll?: { net: number }[] }).monthlyPayroll?.[0]?.net) ?? 0)}</span>
              <span className="hq-widget-stat-lbl">Latest Net</span>
            </div>
            <div className="hq-widget-stat">
              <span className="hq-widget-stat-val">{formatCurrency((payrollData.data as { totalLaborGrant: number }).totalLaborGrant ?? 0)}</span>
              <span className="hq-widget-stat-lbl">Grant Labor</span>
            </div>
          </div>
          <Link to="/hq/payroll" className="hq-entity-link">Payroll Center →</Link>
        </div>
      ) : <div className="hq-muted-text">Loading…</div>;

    case "volunteer-impact":
      if (!hasAnalyticsData && !peopleData.data) {
        return <div className="hq-muted-text">Volunteer metrics unavailable.</div>;
      }
      return (
        <div>
          <div className="hq-widget-stat-grid">
            <div className="hq-widget-stat">
              <span className="hq-widget-stat-val">{analyticsData?.people.volunteers ?? (peopleData.data as { volunteerCount?: number })?.volunteerCount ?? "—"}</span>
              <span className="hq-widget-stat-lbl"><HandHeart size={12} style={{ display: "inline", marginRight: 2 }} />Volunteers</span>
            </div>
            <div className="hq-widget-stat">
              <span className="hq-widget-stat-val">{(peopleData.data as { volunteerHours?: number })?.volunteerHours ?? analyticsData?.people.hoursThisMonth ?? "—"}</span>
              <span className="hq-widget-stat-lbl">Hours</span>
            </div>
            <div className="hq-widget-stat">
              <span className="hq-widget-stat-val">{analyticsData?.programs.participants ?? "—"}</span>
              <span className="hq-widget-stat-lbl">Served</span>
            </div>
          </div>
          <Link to="/hq/people?type=volunteer" className="hq-entity-link" style={{ display: "block", marginTop: "0.5rem" }}>Volunteer Directory →</Link>
        </div>
      );

    case "kpi-monitoring":
      return kpiMonitor.data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
          {((kpiMonitor.data as { kpis: { label: string; value: number; unit: string; status: string }[] }).kpis ?? []).slice(0, 6).map((k) => (
            <div key={k.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.78rem" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}><Target size={12} />{k.label}</span>
              <span>
                <strong style={{ color: "var(--hq-gold)", marginRight: "0.35rem" }}>{k.unit === "$" ? formatCurrency(k.value) : `${k.value}${k.unit}`}</strong>
                <StatusBadge label={k.status} variant={k.status === "good" ? "success" : k.status === "critical" ? "danger" : "warning"} />
              </span>
            </div>
          ))}
          <Link to="/hq/analytics" className="hq-entity-link" style={{ marginTop: "0.25rem" }}>Analytics Center →</Link>
        </div>
      ) : <div className="hq-muted-text">Loading KPIs…</div>;

    case "executive-briefing": {
      const briefing = dailyBriefing.data ?? (commandCenter.data?.dailyBriefing as typeof dailyBriefing.data);
      return briefing ? (
        <div style={{ fontSize: "0.82rem", lineHeight: 1.55 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <StatusBadge label={briefing.cached ? "Cached today" : "Generated"} variant="gold" />
            <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => dailyBriefing.refetch()}>Refresh</button>
          </div>
          <ul style={{ margin: "0 0 0.75rem", paddingLeft: "1.1rem", color: "var(--hq-text-muted)" }}>
            {(briefing.highlights ?? []).slice(0, 4).map((h) => <li key={h}>{h}</li>)}
          </ul>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0, maxHeight: 140, overflow: "auto", fontSize: "0.78rem", color: "var(--hq-text-muted)" }}>
            {briefing.content.split("\n").slice(0, 12).join("\n")}
          </pre>
          <Link to="/hq/aura" className="hq-entity-link" style={{ display: "block", marginTop: "0.5rem" }}><Briefcase size={12} style={{ display: "inline", marginRight: 4 }} />Full briefing in AURA →</Link>
        </div>
      ) : <div className="hq-muted-text">Generating daily briefing…</div>;
    }

    case "financial-health": {
      const fh = commandCenter.data?.financialHealth as { score: number; cashFlow: number; budgetRemaining: number; netPosition: number } | undefined;
      return fh ? (
        <div>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--hq-gold)", marginBottom: "0.5rem" }}>{fh.score}%</div>
          <StatusBadge label={fh.score >= 75 ? "Healthy" : fh.score >= 50 ? "Watch" : "Critical"} variant={fh.score >= 75 ? "success" : "warning"} />
          <div className="hq-widget-stat-grid" style={{ marginTop: "0.75rem" }}>
            <div className="hq-widget-stat"><span className="hq-widget-stat-val">{formatCurrency(fh.cashFlow)}</span><span className="hq-widget-stat-lbl">Cash Flow</span></div>
            <div className="hq-widget-stat"><span className="hq-widget-stat-val">{formatCurrency(fh.budgetRemaining)}</span><span className="hq-widget-stat-lbl">Budget Left</span></div>
          </div>
          <Link to="/hq/finance" className="hq-entity-link" style={{ display: "block", marginTop: "0.5rem" }}><DollarSign size={12} style={{ display: "inline", marginRight: 4 }} />Financial Center →</Link>
        </div>
      ) : hasAnalyticsData ? (
        <div>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--hq-gold)" }}>{analyticsData!.finance.financialHealthScore}%</div>
          <div style={{ marginTop: "0.5rem", fontSize: "0.82rem" }}>Cash flow: {formatCurrency(analyticsData!.finance.cashFlow)}</div>
        </div>
      ) : <div className="hq-muted-text">Financial health data unavailable.</div>;
    }

    case "unified-deadlines":
      return (
        <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {(grantDeadlines.data?.deadlines ?? []).slice(0, 3).map((d: { id: string; title: string; due_date: string; deadline_type: string }) => (
            <li key={d.id} className="hq-activity-item">
              <div className="hq-activity-content">
                <div className="hq-activity-title">{d.title}</div>
                <div className="hq-activity-detail"><FileText size={11} style={{ display: "inline" }} /> {d.deadline_type}</div>
              </div>
              <div className="hq-activity-time"><Clock size={11} style={{ display: "inline", marginRight: 2 }} />{new Date(d.due_date).toLocaleDateString()}</div>
            </li>
          ))}
          {((upcomingEvents.data?.items ?? []) as { id: string; title: string; start_at: string }[]).slice(0, 2).map((e) => (
            <li key={e.id} className="hq-activity-item">
              <div className="hq-activity-content">
                <div className="hq-activity-title">{e.title}</div>
                <div className="hq-activity-detail"><Calendar size={11} style={{ display: "inline" }} /> Event</div>
              </div>
              <div className="hq-activity-time">{new Date(e.start_at).toLocaleDateString()}</div>
            </li>
          ))}
          {!grantDeadlines.data?.deadlines?.length && !upcomingEvents.data?.items?.length && (
            <li className="hq-muted-text">No upcoming deadlines</li>
          )}
        </ul>
      );

    default:
      return <div className="hq-muted-text">Unknown widget</div>;
  }
};
