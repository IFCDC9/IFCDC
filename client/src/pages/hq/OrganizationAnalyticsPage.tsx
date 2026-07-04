import React, { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, PieChart, FileText, Users, Wallet, Heart, LayoutGrid,
  Monitor, TrendingUp, FileBarChart, Building2, Sparkles, Download, Printer,
  Home, GraduationCap, Activity,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";
import HQLayout from "../../layouts/HQLayout";
import { analyticsApi, downloadReportJson, type ReportPeriod } from "../../api/analyticsApi";
import { operationsApi } from "../../api/operationsApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { ActivityFeed } from "../../components/hq/ActivityFeed";
import { HqLiveIndicator } from "../../components/hq/HqLiveIndicator";
import { formatCurrency, formatLocaleNumber, formatDateTime } from "../../utils/safeFormat";
import {
  DEFAULT_ANALYTICS_OVERVIEW,
  DEFAULT_OPERATIONS_OVERVIEW,
  normalizeAnalyticsOverview,
  normalizeOperationsOverview,
} from "../../data/founderDashboardDefaults";
import { isProductionClient, devPlaceholder, strictApiCall } from "../../utils/productionDataPolicy";
import { HqDataUnavailable } from "../../components/hq/HqDataUnavailable";

type Tab = "overview" | "finance" | "grants" | "people" | "payroll" | "donations" | "programs"
  | "software" | "trends" | "kpi" | "reports" | "board" | "aura";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Executive KPIs", icon: BarChart3 },
  { id: "finance", label: "Finance", icon: PieChart },
  { id: "grants", label: "Grants", icon: FileText },
  { id: "people", label: "People", icon: Users },
  { id: "payroll", label: "Payroll & Labor", icon: Wallet },
  { id: "donations", label: "Donations", icon: Heart },
  { id: "programs", label: "Programs & Impact", icon: LayoutGrid },
  { id: "software", label: "Software Division", icon: Monitor },
  { id: "trends", label: "Predictive Trends", icon: TrendingUp },
  { id: "kpi", label: "KPI Monitoring", icon: Activity },
  { id: "reports", label: "Executive Reports", icon: FileBarChart },
  { id: "board", label: "Board Dashboard", icon: Building2 },
  { id: "aura", label: "AURA Insights", icon: Sparkles },
];

const PERIODS: ReportPeriod[] = ["daily", "weekly", "monthly", "quarterly", "annual"];

const fmt = formatCurrency;

const OrganizationAnalyticsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "overview";
  const initialPeriod = (searchParams.get("period") as ReportPeriod) || "monthly";
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initialTab) ? initialTab : "overview");
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>(PERIODS.includes(initialPeriod) ? initialPeriod : "monthly");
  const [auraMessage, setAuraMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "overview") params.set("tab", tab);
    if (tab === "reports" && reportPeriod !== "monthly") params.set("period", reportPeriod);
    setSearchParams(params, { replace: true });
  }, [tab, reportPeriod, setSearchParams]);

  const selectTab = (id: Tab) => {
    setTab(id);
    if (id === "reports" && searchParams.get("period")) {
      setReportPeriod(searchParams.get("period") as ReportPeriod);
    }
  };

  const ops = useQuery({
    queryKey: ["analytics-ops"],
    queryFn: () => strictApiCall(() => operationsApi.overview(), DEFAULT_OPERATIONS_OVERVIEW),
    placeholderData: devPlaceholder(DEFAULT_OPERATIONS_OVERVIEW),
    enabled: tab === "programs" || tab === "overview",
  });

  const overview = useQuery({
    queryKey: ["analytics-overview"],
    queryFn: () => strictApiCall(() => analyticsApi.overview(), DEFAULT_ANALYTICS_OVERVIEW),
    placeholderData: devPlaceholder(DEFAULT_ANALYTICS_OVERVIEW),
  });
  const finance = useQuery({ queryKey: ["analytics-finance"], queryFn: analyticsApi.finance, enabled: tab === "finance" || tab === "overview" || tab === "board" });
  const grants = useQuery({ queryKey: ["analytics-grants"], queryFn: analyticsApi.grants, enabled: tab === "grants" || tab === "board" });
  const people = useQuery({ queryKey: ["analytics-people"], queryFn: analyticsApi.people, enabled: tab === "people" });
  const payroll = useQuery({ queryKey: ["analytics-payroll"], queryFn: analyticsApi.payroll, enabled: tab === "payroll" });
  const donations = useQuery({ queryKey: ["analytics-donations"], queryFn: analyticsApi.donations, enabled: tab === "donations" });
  const programs = useQuery({ queryKey: ["analytics-programs"], queryFn: analyticsApi.programs, enabled: tab === "programs" });
  const software = useQuery({ queryKey: ["analytics-software"], queryFn: analyticsApi.software, enabled: tab === "software" });
  const trends = useQuery({ queryKey: ["analytics-trends"], queryFn: analyticsApi.trends, enabled: tab === "trends" || tab === "overview" || tab === "kpi" });
  const kpiMonitor = useQuery({ queryKey: ["analytics-kpi"], queryFn: analyticsApi.kpiMonitoring, enabled: tab === "kpi" });
  const activity = useQuery({ queryKey: ["analytics-activity"], queryFn: () => analyticsApi.activity(25), enabled: tab === "overview" });
  const board = useQuery({ queryKey: ["analytics-board"], queryFn: analyticsApi.board, enabled: tab === "board" });
  const report = useQuery({ queryKey: ["analytics-report", reportPeriod], queryFn: () => analyticsApi.report(reportPeriod), enabled: tab === "reports" });
  const aura = useQuery({
    queryKey: ["analytics-aura", auraMessage],
    queryFn: () => analyticsApi.auraInsights(auraMessage || undefined),
    enabled: tab === "aura",
  });

  const ov = normalizeAnalyticsOverview(overview.data);
  const opsData = normalizeOperationsOverview(ops.data);

  if (isProductionClient && overview.isFetched && !ov) {
    return (
      <HQLayout title="Organization Analytics" subtitle="Executive reporting and real-time organizational intelligence">
        <HqDataUnavailable
          message="Analytics overview could not be loaded from production APIs."
          onRetry={() => overview.refetch()}
        />
      </HQLayout>
    );
  }

  return (
    <HQLayout
      title="Organization Analytics"
      subtitle="Executive reporting and real-time organizational intelligence"
    >
      <div className="hq-analytics-toolbar">
        <HqLiveIndicator intervalSec={30} />
      </div>
      <div className="hq-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`hq-tab ${tab === t.id ? "active" : ""}`} onClick={() => selectTab(t.id)}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {overview.isLoading && tab === "overview" && <HqLoading message="Loading analytics…" />}
      {overview.error && (
        <div className="hq-panel" style={{ padding: "1rem", color: "#ef4444" }}>{(overview.error as Error).message}</div>
      )}

      {tab === "overview" && ov && (
        <>
          <div className="hq-kpi-grid">
            <KpiCard label="Organization Health" value={`${ov.organizationHealth.overall}%`} icon={Activity} variant={ov.organizationHealth.overall >= 75 ? "success" : "warning"} meta={ov.organizationHealth.grade} />
            <KpiCard label="Total Revenue" value={fmt(ov.finance.totalRevenue)} icon={PieChart} />
            <KpiCard label="Cash Flow" value={fmt(ov.finance.cashFlow)} icon={TrendingUp} variant={ov.finance.cashFlow >= 0 ? "success" : "danger"} />
            <KpiCard label="Active Grants" value={ov.grants.activeAwards} icon={FileText} meta={`${fmt(ov.grants.totalAwarded)} awarded`} />
            <KpiCard label="Total People" value={ov.people.totalPeople} icon={Users} meta={`${ov.people.employees} employees · ${ov.people.volunteers} volunteers`} />
            <KpiCard label="Donations" value={fmt(ov.donations.total)} icon={Heart} variant="success" meta={`${ov.donations.count} gifts`} />
            <KpiCard label="Programs" value={ov.programs.programsRunning} icon={LayoutGrid} meta={`${ov.programs.participants} participants`} />
            <KpiCard label="Software Online" value={`${ov.software.healthy}/${ov.software.total}`} icon={Monitor} variant={ov.software.healthy === ov.software.total ? "success" : "warning"} />
          </div>

          <div className="hq-grid-main-side">
            <div>
              <HqPanel title="Health Score Breakdown" subtitle="Composite organization health factors">
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {ov.organizationHealth.factors.map((f) => (
                    <div key={f.label}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
                        <span>{f.label}</span>
                        <span style={{ color: "var(--hq-gold)" }}>{f.score}/{f.max} ({f.weight})</span>
                      </div>
                      <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3 }}>
                        <div style={{ width: `${f.score}%`, height: "100%", background: "var(--hq-gold)", borderRadius: 3 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </HqPanel>

              {finance.data && (
                <div style={{ marginTop: "1.25rem" }}>
                  <HqPanel title="Revenue, Expenses & Cash Flow" subtitle="12-month financial trend">
                    <div className="hq-chart" style={{ width: "100%", height: 280 }}>
                      <ResponsiveContainer>
                        <LineChart data={(finance.data as { monthlyTrend: { month: string; donations: number; expenses: number; cashFlow: number }[] }).monthlyTrend}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="month" axisLine={false} tickLine={false} />
                          <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                          <Tooltip contentStyle={{ background: "#161616", border: "1px solid rgba(245,200,66,0.25)", borderRadius: 8 }} />
                          <Legend />
                          <Line type="monotone" dataKey="donations" name="Revenue" stroke="#f5c842" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="expenses" name="Expenses" stroke="#6b7280" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="cashFlow" name="Cash Flow" stroke="#22c55e" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </HqPanel>
                </div>
              )}
            </div>

            <div>
              {trends.data && (
                <HqPanel title="Predictive Outlook" subtitle="3-month rolling projection">
                  <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.9rem" }}>
                    <div>Trend: <StatusBadge label={(trends.data as { trend: string }).trend} variant={(trends.data as { trend: string }).trend === "positive" ? "success" : "warning"} /></div>
                    <div>Projected donations: {fmt((trends.data as { projectedDonations: number }).projectedDonations)}</div>
                    <div>Projected expenses: {fmt((trends.data as { projectedExpenses: number }).projectedExpenses)}</div>
                    <div>Projected cash flow: {fmt((trends.data as { projectedCashFlow: number }).projectedCashFlow)}</div>
                  </div>
                </HqPanel>
              )}
              {activity.data && (
                <div style={{ marginTop: "1.25rem" }}>
                  <HqPanel title="Headquarters Activity Feed" subtitle="Live organization events">
                    <ActivityFeed items={activity.data.activity} />
                  </HqPanel>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "finance" && finance.data && (
        <div className="hq-kpi-grid">
          <KpiCard label="Net Position" value={fmt((finance.data as { netPosition: number }).netPosition)} icon={PieChart} />
          <KpiCard label="Cash Flow" value={fmt((finance.data as { cashFlow: number }).cashFlow)} icon={TrendingUp} />
          <KpiCard label="Budget Remaining" value={fmt((finance.data as { budgetRemaining: number }).budgetRemaining)} icon={Wallet} />
          <KpiCard label="Financial Health" value={`${(finance.data as { financialHealthScore: number }).financialHealthScore}%`} icon={Activity} />
        </div>
      )}

      {tab === "grants" && grants.data && (
        <>
          <HqPanel title="Grant Performance by Funder" subtitle="Active awards">
            <table className="hq-table">
              <thead><tr><th>Funder</th><th>Awards</th><th>Total</th></tr></thead>
              <tbody>
                {((grants.data as { byFunder: { funder: string; awards: number; total: number }[] }).byFunder ?? []).map((r) => (
                  <tr key={r.funder}><td>{r.funder}</td><td>{r.awards}</td><td>{fmt(r.total)}</td></tr>
                ))}
              </tbody>
            </table>
          </HqPanel>
          <div style={{ marginTop: "1.25rem" }}>
            <HqPanel title="By Program">
              <table className="hq-table">
                <thead><tr><th>Program</th><th>Awards</th><th>Total</th></tr></thead>
                <tbody>
                  {((grants.data as { byProgram: { program: string; awards: number; total: number }[] }).byProgram ?? []).map((r) => (
                    <tr key={r.program}><td>{r.program}</td><td>{r.awards}</td><td>{fmt(r.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </HqPanel>
          </div>
        </>
      )}

      {tab === "people" && people.data && (
        <>
          <div className="hq-kpi-grid">
            <KpiCard label="Volunteer Hours (Month)" value={(people.data as { volunteerHours: number }).volunteerHours} icon={Users} />
          </div>
          <HqPanel title="People by Type">
            <table className="hq-table">
              <thead><tr><th>Type</th><th>Count</th></tr></thead>
              <tbody>
                {((people.data as { byType: { person_type: string; count: number }[] }).byType ?? []).map((r) => (
                  <tr key={r.person_type}><td>{r.person_type.replace(/_/g, " ")}</td><td>{r.count}</td></tr>
                ))}
              </tbody>
            </table>
          </HqPanel>
        </>
      )}

      {tab === "payroll" && payroll.data && (
        <>
          <KpiCard label="Grant Labor Allocated" value={fmt((payroll.data as { totalLaborGrant: number }).totalLaborGrant)} icon={Wallet} />
          <HqPanel title="Recent Payroll Runs" subtitle="Last 6 periods">
            <table className="hq-table">
              <thead><tr><th>Period</th><th>Gross</th><th>Net</th><th>Status</th></tr></thead>
              <tbody>
                {((payroll.data as { monthlyPayroll: { period: string; gross: number; net: number; status: string }[] }).monthlyPayroll ?? []).map((r) => (
                  <tr key={r.period}><td>{r.period}</td><td>{fmt(r.gross)}</td><td>{fmt(r.net)}</td><td><StatusBadge label={r.status} variant={r.status === "completed" ? "success" : "muted"} /></td></tr>
                ))}
              </tbody>
            </table>
          </HqPanel>
        </>
      )}

      {tab === "donations" && donations.data && (
        <>
          <div className="hq-kpi-grid">
            <KpiCard label="Total Donations" value={fmt((donations.data as { total: number }).total)} icon={Heart} />
            <KpiCard label="Projected Monthly" value={fmt((donations.data as { projectedMonthly: number }).projectedMonthly)} icon={TrendingUp} />
          </div>
          <HqPanel title="Donation Trend">
            <div className="hq-chart" style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={(donations.data as { monthly: { month: string; total: number }[] }).monthly}>
                  <XAxis dataKey="month" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={{ background: "#161616", border: "1px solid rgba(245,200,66,0.25)", borderRadius: 8 }} />
                  <Bar dataKey="total" name="Donations" fill="#f5c842" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </HqPanel>
        </>
      )}

      {tab === "programs" && programs.data && (
        <>
          <div className="hq-kpi-grid">
            <KpiCard label="People Served" value={(programs.data as { communityImpact: { peopleServed: number } }).communityImpact.peopleServed} icon={Users} />
            <KpiCard label="Active Programs" value={(programs.data as { communityImpact: { programsActive: number } }).communityImpact.programsActive} icon={LayoutGrid} />
            <KpiCard label="Housing Units" value={opsData.housing.units} icon={Home} meta={opsData.housing.placements > 0 ? `${opsData.housing.placements} placements` : "No housing data yet"} />
            <KpiCard label="Scholarships Awarded" value={opsData.scholarships.awarded} icon={GraduationCap} meta={`${opsData.scholarships.applications} applications`} />
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
            <Link to="/hq/housing" className="hq-btn hq-btn-secondary hq-btn-sm"><Home size={14} /> Housing Programs</Link>
            <Link to="/hq/scholarships" className="hq-btn hq-btn-secondary hq-btn-sm"><GraduationCap size={14} /> Scholarships</Link>
            <Link to="/hq/programs" className="hq-btn hq-btn-secondary hq-btn-sm"><LayoutGrid size={14} /> Community Programs</Link>
          </div>
          <HqPanel title="Community Impact" subtitle="Organization-wide program outcomes">
            <p style={{ color: "var(--hq-text-muted)", fontSize: "0.9rem" }}>
              Total volunteer hours logged: {formatLocaleNumber((programs.data as { communityImpact?: { volunteerHours?: number } } | undefined)?.communityImpact?.volunteerHours)}
            </p>
          </HqPanel>
        </>
      )}

      {tab === "software" && software.data && (
        <HqPanel title="IFCDC Software Division" subtitle="Application health and deployment status">
          <table className="hq-table">
            <thead><tr><th>Application</th><th>Status</th><th>Version</th><th>Health</th><th>Latency</th></tr></thead>
            <tbody>
              {((software.data as { apps: { id: string; name: string; status: string; version?: string; healthy: boolean; latencyMs: number; locked?: boolean }[] }).apps ?? []).map((a) => (
                <tr key={a.id}>
                  <td>{a.name}{a.locked ? " 🔒" : ""}</td>
                  <td><StatusBadge label={a.status} variant={a.status === "locked" ? "gold" : "muted"} /></td>
                  <td>{a.version ?? "—"}</td>
                  <td><StatusBadge label={a.healthy ? "online" : "offline"} variant={a.healthy ? "success" : "danger"} pulse={a.healthy} /></td>
                  <td>{a.latencyMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>
      )}

      {tab === "trends" && trends.data && (
        <>
          <div className="hq-kpi-grid">
            <KpiCard label="Outlook" value={(trends.data as { trend: string }).trend} icon={TrendingUp} variant={(trends.data as { trend: string }).trend === "positive" ? "success" : "warning"} />
            <KpiCard label="Donation Growth" value={`${(trends.data as { donationGrowth: number }).donationGrowth}%`} icon={Heart} />
            <KpiCard label="Projected Cash Flow" value={fmt((trends.data as { projectedCashFlow: number }).projectedCashFlow)} icon={PieChart} />
          </div>
          <HqPanel title="12-Month Trend Analysis">
            <div className="hq-chart" style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <LineChart data={(trends.data as { monthlyTrend: { month: string; cashFlow: number; donations: number; expenses: number }[] }).monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#161616", border: "1px solid rgba(245,200,66,0.25)", borderRadius: 8 }} />
                  <Legend />
                  <Line type="monotone" dataKey="cashFlow" stroke="#22c55e" strokeWidth={2} />
                  <Line type="monotone" dataKey="donations" stroke="#f5c842" strokeWidth={2} />
                  <Line type="monotone" dataKey="expenses" stroke="#6b7280" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </HqPanel>
        </>
      )}

      {tab === "kpi" && kpiMonitor.data && (
        <>
          <HqPanel title="KPI Monitoring" subtitle="Real-time targets vs. actuals across the organization">
            <table className="hq-table">
              <thead><tr><th>KPI</th><th>Value</th><th>Target</th><th>Status</th></tr></thead>
              <tbody>
                {((kpiMonitor.data as { kpis: { id: string; label: string; value: number; unit: string; target: number; status: string }[] }).kpis ?? []).map((k) => (
                  <tr key={k.id}>
                    <td>{k.label}</td>
                    <td style={{ color: "var(--hq-gold)", fontWeight: 700 }}>{k.unit === "$" ? fmt(k.value) : `${k.value}${k.unit}`}</td>
                    <td>{k.unit === "$" ? fmt(k.target) : `${k.target}${k.unit}`}</td>
                    <td><StatusBadge label={k.status} variant={k.status === "good" ? "success" : k.status === "watch" ? "warning" : "danger"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HqPanel>
          {(kpiMonitor.data as { trends: { month: string; projectedCashFlow: number }[] }).trends && (
            <div style={{ marginTop: "1.25rem" }}>
              <HqPanel title="6-Month Forecast">
                <div className="hq-chart" style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={(kpiMonitor.data as { trends: { month: string; projectedCashFlow: number; projectedDonations: number }[] }).trends}>
                      <XAxis dataKey="month" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                      <Tooltip contentStyle={{ background: "#161616", border: "1px solid rgba(245,200,66,0.25)", borderRadius: 8 }} />
                      <Bar dataKey="projectedCashFlow" name="Projected Cash Flow" fill="#f5c842" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </HqPanel>
            </div>
          )}
        </>
      )}

      {tab === "reports" && (
        <>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            {PERIODS.map((p) => (
              <button key={p} type="button" className={`hq-btn ${reportPeriod === p ? "hq-btn-primary" : "hq-btn-ghost"}`} onClick={() => setReportPeriod(p)}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
            <a href={analyticsApi.exportCsvUrl(reportPeriod)} className="hq-btn hq-btn-ghost" download><Download size={16} /> Export CSV</a>
            <button type="button" className="hq-btn hq-btn-ghost" onClick={() => report.data && downloadReportJson(report.data, `ifcdc-report-${reportPeriod}.json`)}>
              <Download size={16} /> Export JSON
            </button>
            <button type="button" className="hq-btn hq-btn-ghost" onClick={() => window.print()}><Printer size={16} /> Print / PDF</button>
          </div>
          {report.isLoading && <HqLoading message="Generating report…" />}
          {report.data && (
            <HqPanel title={`${reportPeriod.charAt(0).toUpperCase() + reportPeriod.slice(1)} Executive Report`} subtitle={`Generated ${formatDateTime((report.data as { generatedAt?: string })?.generatedAt)}`}>
              <pre style={{ fontSize: "0.75rem", overflow: "auto", maxHeight: 480, color: "var(--hq-text-muted)" }}>
                {JSON.stringify(report.data, null, 2)}
              </pre>
            </HqPanel>
          )}
        </>
      )}

      {tab === "board" && board.data && (
        <>
          <div className="hq-kpi-grid">
            <KpiCard label="Org Health" value={`${(board.data as { organizationHealth: { overall: number } }).organizationHealth.overall}%`} icon={Activity} meta={(board.data as { organizationHealth: { grade: string } }).organizationHealth.grade} />
            <KpiCard label="Net Position" value={fmt((board.data as { financialSummary: { netPosition: number } }).financialSummary.netPosition)} icon={PieChart} />
            <KpiCard label="Active Grants" value={(board.data as { grantSummary: { activeAwards: number } }).grantSummary.activeAwards} icon={FileText} />
            <KpiCard label="Compliance Due" value={(board.data as { grantSummary: { complianceDue: number } }).grantSummary.complianceDue} icon={FileText} variant={(board.data as { grantSummary: { complianceDue: number } }).grantSummary.complianceDue > 0 ? "warning" : "success"} />
          </div>
          <HqPanel title="Board Summary" subtitle="Governance-ready financial and grant overview">
            <p style={{ fontSize: "0.9rem", color: "var(--hq-text-muted)" }}>
              Cash flow: {fmt((board.data as { financialSummary: { cashFlow: number } }).financialSummary.cashFlow)} ·
              Budget remaining: {fmt((board.data as { financialSummary: { budgetRemaining: number } }).financialSummary.budgetRemaining)} ·
              Total people: {(board.data as { peopleSummary: { totalPeople: number } }).peopleSummary.totalPeople}
            </p>
          </HqPanel>
        </>
      )}

      {tab === "aura" && (
        <>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <input className="hq-input" style={{ flex: 1 }} placeholder="Ask AURA for executive insights…" value={auraMessage} onChange={(e) => setAuraMessage(e.target.value)} />
            <button type="button" className="hq-btn hq-btn-primary" onClick={() => aura.refetch()}><Sparkles size={16} /> Analyze</button>
          </div>
          {aura.isLoading && <HqLoading message="AURA analyzing organization data…" />}
          {aura.data && (
            <HqPanel title="AURA Executive Insights" subtitle={`Health: ${aura.data.overview.overall}% (${aura.data.overview.grade})`}>
              <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{aura.data.insight}</p>
              {aura.data.offline && <StatusBadge label="Offline mode" variant="warning" />}
            </HqPanel>
          )}
        </>
      )}
    </HQLayout>
  );
};

export default OrganizationAnalyticsPage;
