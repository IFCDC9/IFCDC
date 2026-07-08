import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, Plus, CheckCircle, Users, Calendar, Award, Bell, Handshake } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { grantsApi, type GrantOpportunity, type GrantFunder } from "../../api/grantsApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { formatCurrency } from "../../utils/safeFormat";
import { lazyWithRetry } from "../../utils/lazyWithRetry";
import { GrantLibraryPanel, GrantWriterStudioPanel, GrantIntelligencePanel } from "../../components/hq/grants/GrantCenterEnterprisePanels";
import { GrantDiscoverHub, GrantApplicationsHub } from "../../components/hq/grants/GrantLifecycleHub";
import { GrantFullApplicationWorkspace } from "../../components/hq/grants/GrantFullApplicationWorkspace";
import { GrantEnterprisePipelineHub } from "../../components/hq/grants/GrantEnterprisePipelineHub";
import { fmtGrantDeadline } from "../../utils/grantFormat";
import { GrantReadOnlyBanner } from "../../components/hq/grants/GrantReadOnlyBanner";
import { GrantQueryBoundary } from "../../components/hq/grants/GrantQueryBoundary";
import { GrantSubNav } from "../../components/hq/grants/GrantSubNav";
import { HqDataUnavailable } from "../../components/hq/HqDataUnavailable";
import { useGrantManage } from "../../hooks/useGrantManage";
import { GRANT_TABS, resolveGrantTab, grantTabIncludes, type GrantTab } from "./grantCenterConfig";

const GrantV5FundingIntelligenceDashboard = lazyWithRetry(
  () => import("../../components/hq/grants/GrantV5FundingIntelligenceDashboard").then((m) => ({ default: m.GrantV5FundingIntelligenceDashboard })),
  "GrantV5FundingIntelligenceDashboard"
);
const GrantV5NationalDatabase = lazyWithRetry(
  () => import("../../components/hq/grants/GrantV5NationalDatabase").then((m) => ({ default: m.GrantV5NationalDatabase })),
  "GrantV5NationalDatabase"
);
const GrantV5ComplianceDashboard = lazyWithRetry(
  () => import("../../components/hq/grants/GrantV5ComplianceDashboard").then((m) => ({ default: m.GrantV5ComplianceDashboard })),
  "GrantV5ComplianceDashboard"
);
const GrantV4LifecyclePanel = lazyWithRetry(
  () => import("../../components/hq/grants/GrantV4LifecyclePanel").then((m) => ({ default: m.GrantV4LifecyclePanel })),
  "GrantV4LifecyclePanel"
);
const GrantV4FundingCalendar = lazyWithRetry(
  () => import("../../components/hq/grants/GrantV4FundingCalendar").then((m) => ({ default: m.GrantV4FundingCalendar })),
  "GrantV4FundingCalendar"
);
const GrantV4ProgramIntegration = lazyWithRetry(
  () => import("../../components/hq/grants/GrantV4ProgramIntegration").then((m) => ({ default: m.GrantV4ProgramIntegration })),
  "GrantV4ProgramIntegration"
);
const GrantV3DocumentCenter = lazyWithRetry(
  () => import("../../components/hq/grants/GrantV3DocumentCenter").then((m) => ({ default: m.GrantV3DocumentCenter })),
  "GrantV3DocumentCenter"
);
const GrantV2PipelineDashboard = lazyWithRetry(
  () => import("../../components/hq/grants/GrantV2PipelineDashboard").then((m) => ({ default: m.GrantV2PipelineDashboard })),
  "GrantV2PipelineDashboard"
);
const GrantDocumentManagementPanel = lazyWithRetry(
  () => import("../../components/hq/grants/GrantDocumentManagementPanel").then((m) => ({ default: m.GrantDocumentManagementPanel })),
  "GrantDocumentManagementPanel"
);
const GrantOutcomesPanel = lazyWithRetry(
  () => import("../../components/hq/grants/GrantOutcomesPanel").then((m) => ({ default: m.GrantOutcomesPanel })),
  "GrantOutcomesPanel"
);
const GrantDeadlineRenewalPanel = lazyWithRetry(
  () => import("../../components/hq/grants/GrantDeadlineRenewalPanel").then((m) => ({ default: m.GrantDeadlineRenewalPanel })),
  "GrantDeadlineRenewalPanel"
);
const GrantBudgetIntegrationPanel = lazyWithRetry(
  () => import("../../components/hq/grants/GrantBudgetIntegrationPanel").then((m) => ({ default: m.GrantBudgetIntegrationPanel })),
  "GrantBudgetIntegrationPanel"
);
const GrantV2ExecutiveAnalytics = lazyWithRetry(
  () => import("../../components/hq/grants/GrantV2ExecutiveAnalytics").then((m) => ({ default: m.GrantV2ExecutiveAnalytics })),
  "GrantV2ExecutiveAnalytics"
);
const GrantV5AuraAdvisorPanel = lazyWithRetry(
  () => import("../../components/hq/grants/GrantV5AuraAdvisorPanel").then((m) => ({ default: m.GrantV5AuraAdvisorPanel })),
  "GrantV5AuraAdvisorPanel"
);
const GrantV5PipelineKanban = lazyWithRetry(
  () => import("../../components/hq/grants/GrantV5PipelineKanban").then((m) => ({ default: m.GrantV5PipelineKanban })),
  "GrantV5PipelineKanban"
);
const GrantV5PipelineAutomationPanel = lazyWithRetry(
  () => import("../../components/hq/grants/GrantV5PipelineAutomationPanel").then((m) => ({ default: m.GrantV5PipelineAutomationPanel })),
  "GrantV5PipelineAutomationPanel"
);
const GrantEconomicDevelopmentPanel = lazyWithRetry(
  () => import("../../components/hq/grants/GrantEconomicDevelopmentPanel").then((m) => ({ default: m.GrantEconomicDevelopmentPanel })),
  "GrantEconomicDevelopmentPanel"
);
const GrantDivisionConnectorsPanel = lazyWithRetry(
  () => import("../../components/hq/grants/GrantDivisionConnectorsPanel").then((m) => ({ default: m.GrantDivisionConnectorsPanel })),
  "GrantDivisionConnectorsPanel"
);

const TabFallback = () => <HqLoading message="Loading grant module…" />;

const STATUS_VARIANT: Record<string, "gold" | "success" | "warning" | "danger" | "muted"> = {
  open: "success", draft: "muted", submitted: "gold", under_review: "warning",
  awarded: "success", denied: "danger", pending: "warning", active: "success",
  approved: "success", rejected: "danger", planned: "gold",
};

function fmt(n: number | null | undefined): string {
  return formatCurrency(n);
}

function fmtDate(d: string | null | undefined): string {
  return fmtGrantDeadline(d);
}

const GrantCenterPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<GrantTab>("overview");
  const [appsSection, setAppsSection] = useState<"list" | "studio" | "library">("list");
  const [calendarSection, setCalendarSection] = useState<"calendar" | "deadlines" | "notifications">("calendar");
  const [financeSection, setFinanceSection] = useState<"awards" | "budgets" | "reports">("awards");
  const [complianceSection, setComplianceSection] = useState<"tracking" | "funder-reports">("tracking");
  const [intelSection, setIntelSection] = useState<"analytics" | "ai" | "history" | "divisions">("analytics");
  const [showNewApp, setShowNewApp] = useState(false);
  const [showNewOpp, setShowNewOpp] = useState(false);
  const [showNewFunder, setShowNewFunder] = useState(false);
  const [selectedFunderId, setSelectedFunderId] = useState<string | null>(null);
  const [funderSearch, setFunderSearch] = useState("");
  const [newFunder, setNewFunder] = useState({ name: "", contact_name: "", contact_email: "", relationship_stage: "prospect" });
  const [newInteraction, setNewInteraction] = useState({ subject: "", notes: "" });
  const [newApp, setNewApp] = useState({ title: "", opportunity_id: "", amount_requested: "" });
  const [newOpp, setNewOpp] = useState({
    title: "", funder: "", description: "", amount_min: "", amount_max: "", deadline: "", url: "",
    division_slugs: [] as string[], eligibility: "", geography: "local",
  });
  const [selectedAward, setSelectedAward] = useState("");
  const [docForm, setDocForm] = useState({ name: "", file_url: "", application_id: "" });
  const [budgetLines, setBudgetLines] = useState([{ category: "personnel", line_name: "Staff Salaries", allocated: "" }]);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const qc = useQueryClient();
  const { canManage } = useGrantManage();

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    const resolved = resolveGrantTab(tabParam);
    setTab(resolved);
    if (tabParam === "writer-studio") setAppsSection("studio");
    if (tabParam === "library") setAppsSection("library");
    if (tabParam === "deadlines") setCalendarSection("deadlines");
    if (tabParam === "notifications") setCalendarSection("notifications");
    if (tabParam === "budgets") setFinanceSection("budgets");
    if (tabParam === "finance") setFinanceSection("reports");
    if (tabParam === "funder-reports") setComplianceSection("funder-reports");
    if (tabParam === "ai-intelligence") setIntelSection("ai");
    if (tabParam === "history") setIntelSection("history");
    if (tabParam === "divisions") setIntelSection("divisions");
    if (tabParam === "analytics") setIntelSection("analytics");
    const awardId = searchParams.get("award");
    if (awardId) {
      setSelectedAward(awardId);
      setTab("finance");
      setFinanceSection("reports");
    }
    const funderId = searchParams.get("funder");
    if (funderId) {
      setSelectedFunderId(funderId);
      setTab("funders");
    }
    const applicationId =
      searchParams.get("application")
      || searchParams.get("applicationId")
      || searchParams.get("app");
    if (applicationId) {
      setSelectedApplicationId(applicationId);
      setTab("applications");
      setAppsSection(tabParam === "writer-studio" || tabParam === "studio" ? "studio" : "list");
    }
  }, [searchParams]);

  const selectTab = (next: GrantTab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    window.history.replaceState(null, "", `/hq/grants?${params.toString()}`);
  };

  const handleStartApplication = (applicationId: string) => {
    setSelectedApplicationId(applicationId);
    setAppsSection("studio");
    selectTab("applications");
    qc.invalidateQueries({ queryKey: ["grant-writer-studio", applicationId] });
    qc.invalidateQueries({ queryKey: ["grant-full-workspace", applicationId] });
    qc.invalidateQueries({ queryKey: ["grant-enriched-applications"] });
  };

  const dashboard = useQuery({ queryKey: ["grants-dashboard"], queryFn: grantsApi.dashboard, enabled: tab === "overview" });
  const grantPlatform = useQuery({ queryKey: ["grant-center-platform"], queryFn: grantsApi.grantCenterPlatform, enabled: tab === "overview" });
  const syncFeeds = useMutation({
    mutationFn: grantsApi.feedsSync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grant-center-platform"] });
      qc.invalidateQueries({ queryKey: ["grants-opportunities"] });
    },
  });
  const executiveSummary = useQuery({ queryKey: ["grant-executive-summary"], queryFn: grantsApi.grantExecutiveSummary, enabled: tab === "overview" });
  const fundingAnalytics = useQuery({ queryKey: ["grant-funding-analytics"], queryFn: grantsApi.fundingAnalytics, enabled: tab === "intelligence" && intelSection === "analytics" });
  const opportunities = useQuery({
    queryKey: ["grants-opportunities"],
    queryFn: grantsApi.opportunities,
    enabled: grantTabIncludes(tab, "discover", "applications", "overview") || showNewApp,
  });
  const applications = useQuery({
    queryKey: ["grants-applications"],
    queryFn: grantsApi.applications,
    enabled: grantTabIncludes(tab, "applications", "documents", "pipeline", "overview") || showNewApp,
  });
  const deadlines = useQuery({
    queryKey: ["grants-deadlines"],
    queryFn: () => grantsApi.deadlines(true),
    enabled: tab === "overview" || (tab === "calendar" && calendarSection !== "notifications"),
  });
  const allDeadlines = useQuery({
    queryKey: ["grants-deadlines-all"],
    queryFn: () => grantsApi.deadlines(false),
    enabled: tab === "calendar" && calendarSection === "deadlines",
  });
  const awards = useQuery({ queryKey: ["grants-awards"], queryFn: grantsApi.awards, enabled: tab === "finance" });
  const compliance = useQuery({ queryKey: ["grants-compliance"], queryFn: grantsApi.compliance, enabled: tab === "compliance" });
  const funderReports = useQuery({
    queryKey: ["grants-funder-reports"],
    queryFn: grantsApi.funderReports,
    enabled: (tab === "compliance" && complianceSection === "funder-reports") || tab === "overview",
  });
  const calendar = useQuery({ queryKey: ["grants-calendar"], queryFn: () => grantsApi.calendar(), enabled: tab === "calendar" && calendarSection === "calendar" });
  const documents = useQuery({ queryKey: ["grants-documents"], queryFn: () => grantsApi.documents(), enabled: tab === "documents" });
  const budgets = useQuery({ queryKey: ["grants-budgets"], queryFn: grantsApi.budgets, enabled: tab === "finance" && financeSection === "budgets" });
  const labor = useQuery({ queryKey: ["grants-labor", selectedAward], queryFn: () => grantsApi.labor(selectedAward || undefined), enabled: tab === "finance" && financeSection === "reports" });
  const expenditures = useQuery({ queryKey: ["grants-expenditures"], queryFn: () => grantsApi.expenditures(), enabled: tab === "finance" && financeSection === "reports" });
  const financial = useQuery({ queryKey: ["grants-financial", selectedAward], queryFn: () => grantsApi.financial(selectedAward), enabled: !!selectedAward && tab === "finance" && financeSection === "reports" });
  const notifications = useQuery({
    queryKey: ["grants-notifications"],
    queryFn: grantsApi.notifications,
    enabled: (tab === "calendar" && calendarSection === "notifications") || tab === "overview",
  });
  const history = useQuery({ queryKey: ["grants-history"], queryFn: grantsApi.history, enabled: tab === "intelligence" && intelSection === "history" });
  const funderDashboard = useQuery({ queryKey: ["grants-funder-dashboard"], queryFn: grantsApi.funderDashboard, enabled: tab === "funders" || tab === "overview" });
  const funders = useQuery({ queryKey: ["grants-funders", funderSearch], queryFn: () => grantsApi.funders(funderSearch ? { q: funderSearch } : undefined), enabled: tab === "funders" });
  const funderDetail = useQuery({ queryKey: ["grants-funder", selectedFunderId], queryFn: () => grantsApi.getFunder(selectedFunderId!), enabled: !!selectedFunderId && tab === "funders" });

  const createApp = useMutation({
    mutationFn: grantsApi.createApplication,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["grants-applications"] });
      qc.invalidateQueries({ queryKey: ["grants-dashboard"] });
      setShowNewApp(false);
      setNewApp({ title: "", opportunity_id: "", amount_requested: "" });
      const appId = (data as { application?: { id: string } })?.application?.id;
      if (appId) setSelectedApplicationId(appId);
    },
  });
  const createOpp = useMutation({
    mutationFn: grantsApi.createOpportunity,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grants-opportunities"] });
      qc.invalidateQueries({ queryKey: ["grants-dashboard"] });
      setShowNewOpp(false);
      setNewOpp({ title: "", funder: "", description: "", amount_min: "", amount_max: "", deadline: "", url: "", division_slugs: [], eligibility: "", geography: "local" });
    },
  });
  const completeDeadline = useMutation({ mutationFn: grantsApi.completeDeadline, onSuccess: () => qc.invalidateQueries({ queryKey: ["grants-deadlines"] }) });
  const uploadDoc = useMutation({ mutationFn: grantsApi.uploadDocument, onSuccess: () => { qc.invalidateQueries({ queryKey: ["grants-documents"] }); setDocForm({ name: "", file_url: "", application_id: "" }); } });
  const uploadDocFile = useMutation({
    mutationFn: grantsApi.uploadDocumentFile,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["grants-documents"] }); setDocForm({ name: "", file_url: "", application_id: "" }); },
  });

  const handleDocFilePick = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result ?? "");
      uploadDocFile.mutate({
        fileName: file.name,
        base64,
        mimeType: file.type,
        name: docForm.name || file.name,
        application_id: docForm.application_id || undefined,
      });
    };
    reader.readAsDataURL(file);
  };
  const approveDoc = useMutation({ mutationFn: ({ id, status }: { id: string; status: "approved" | "rejected" }) => grantsApi.approveDocument(id, status), onSuccess: () => qc.invalidateQueries({ queryKey: ["grants-documents"] }) });
  const createBudget = useMutation({ mutationFn: grantsApi.createBudgetLines, onSuccess: () => qc.invalidateQueries({ queryKey: ["grants-budgets"] }) });
  const syncLabor = useMutation({ mutationFn: grantsApi.syncLabor, onSuccess: () => qc.invalidateQueries({ queryKey: ["grants-labor"] }) });
  const markRead = useMutation({ mutationFn: grantsApi.markNotificationRead, onSuccess: () => qc.invalidateQueries({ queryKey: ["grants-notifications"] }) });
  const createFunder = useMutation({
    mutationFn: grantsApi.createFunder,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grants-funders"] });
      qc.invalidateQueries({ queryKey: ["grants-funder-dashboard"] });
      setShowNewFunder(false);
      setNewFunder({ name: "", contact_name: "", contact_email: "", relationship_stage: "prospect" });
    },
  });
  const logInteraction = useMutation({
    mutationFn: () => grantsApi.logFunderInteraction(selectedFunderId!, newInteraction),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grants-funder", selectedFunderId] });
      setNewInteraction({ subject: "", notes: "" });
    },
  });

  const opps = opportunities.data?.opportunities ?? [];
  const awardList = awards.data?.awards ?? [];
  const dash = dashboard.data;

  return (
    <HQLayout title="Grant Center" subtitle="Enterprise funding command hub — opportunities, writer studio, library, compliance, and financial integration" auraModule="grants" auraActions={["ask", "enterprise_scan", "find_funding", "summarize", "prepare_approval", "explain"]}>
      <nav className="hq-tabs">
        {GRANT_TABS.map((t) => (
          <button key={t.id} type="button" className={`hq-tab ${tab === t.id ? "active" : ""}`} onClick={() => selectTab(t.id)}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </nav>

      <GrantReadOnlyBanner />

      {dashboard.isError && (
        <HqDataUnavailable
          title="Grant Center data unavailable"
          message="The grants dashboard could not load live data from headquarters."
          detail={(dashboard.error as Error)?.message}
          onRetry={() => void qc.invalidateQueries({ queryKey: ["grants-dashboard"] })}
        />
      )}

      <div className="hq-tab-content hq-fade-in">
        {tab === "overview" && (
          <>
            <GrantIntelligencePanel onStartApplication={handleStartApplication} />
            <div style={{ marginTop: "1.25rem" }}>
              <GrantV5FundingIntelligenceDashboard />
            </div>
            {grantPlatform.data && (
              <div style={{ marginTop: "1.25rem" }}>
              <HqPanel title="Grant Center Modules" subtitle={`Platform ${grantPlatform.data.version} — modular command hub`}>
                <div className="hq-app-grid">
                  {(grantPlatform.data.modules ?? []).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="hq-app-card"
                      style={{ textAlign: "left", cursor: "pointer" }}
                      onClick={() => selectTab(resolveGrantTab(m.tab))}
                    >
                      <div className="hq-app-name">{m.label}</div>
                      <StatusBadge label={m.status} variant="success" />
                    </button>
                  ))}
                </div>
                <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.75rem" }}>
                  External feeds:{" "}
                  {Object.values(grantPlatform.data.integrations ?? {}).filter((i: { status?: string }) => i.status === "connected").length} connected
                  {" · "}
                  {grantPlatform.data.externalFeedCount ?? 0} imported opportunities
                  {" · "}
                  {canManage && (
                    <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" disabled={syncFeeds.isPending} onClick={() => syncFeeds.mutate()}>
                      {syncFeeds.isPending ? "Syncing…" : "Sync feeds"}
                    </button>
                  )}
                </p>
              </HqPanel>
              </div>
            )}
            {executiveSummary.data?.kpis && (
              <div style={{ marginTop: "1.25rem" }}>
              <HqPanel title="Executive Funding KPIs" subtitle="Unified executive summary across pipeline, compliance, and CRM">
                <div className="hq-kpi-grid">
                  <KpiCard label="Open Opportunities" value={Number(executiveSummary.data.kpis.openOpportunities ?? 0)} variant="success" />
                  <KpiCard label="Pending Applications" value={Number(executiveSummary.data.kpis.pendingApplications ?? 0)} variant="warning" />
                  <KpiCard label="Total Awarded" value={fmt(Number(executiveSummary.data.kpis.totalAwarded ?? 0))} variant="gold" />
                  <KpiCard label="Pipeline Value" value={fmt(Number(executiveSummary.data.kpis.pipelineValue ?? 0))} />
                  <KpiCard label="Win Rate" value={`${executiveSummary.data.kpis.winRate ?? 0}%`} variant="gold" />
                  <KpiCard label="Sustainability Index" value={executiveSummary.data.kpis.sustainabilityIndex != null ? String(executiveSummary.data.kpis.sustainabilityIndex) : "—"} />
                </div>
              </HqPanel>
              </div>
            )}
            {dashboard.isLoading ? <HqLoading /> : dash && (
              <>
                <HqPanel title="Operational Snapshot" subtitle="Live grant operations metrics">
                <div className="hq-kpi-grid">
                  <KpiCard label="Open Opportunities" value={dash.openOpportunities} variant="success" />
                  <KpiCard label="Pending Applications" value={dash.pendingApplications} variant="warning" />
                  <KpiCard label="Total Awarded" value={fmt(dash.totalAwarded)} variant="gold" />
                  <KpiCard label="Pipeline Value" value={fmt(dash.pipelineValue)} />
                  <KpiCard label="Active Awards" value={dash.activeAwards ?? 0} variant="success" />
                  <KpiCard label="Win Rate" value={`${dash.winRate ?? 0}%`} variant="gold" />
                  <KpiCard label="Budget Allocated" value={fmt(dash.totalBudgetAllocated)} meta="Financial Center" />
                  <KpiCard label="Budget Spent" value={fmt(dash.totalBudgetSpent)} variant="warning" />
                  <KpiCard label="Labor Costs" value={fmt(dash.totalLaborCost)} meta="from payroll" />
                  <KpiCard label="Grant Expenditures" value={fmt(dash.totalExpenditures)} />
                  <KpiCard label="Deadlines (30d)" value={dash.upcomingDeadlines} variant={dash.upcomingDeadlines > 0 ? "warning" : "success"} />
                  <KpiCard label="Compliance Due" value={dash.complianceDue} variant={dash.complianceDue > 0 ? "danger" : "success"} />
                </div>
                </HqPanel>
                <HqPanel title="Financial Center Integration" subtitle="All grant finances flow through Headquarters">
                  <p className="hq-muted-text">Grant budgets, expenditures, payroll allocations, and financial reports inherit directly from the Financial Center. No separate grant accounting system.</p>
                  <ul className="hq-feature-list">
                    <li>Awards auto-create budgets in <code>/hq/finance</code></li>
                    <li>Expenses tagged with grant_id post to both systems</li>
                    <li>Labor costs sync from payroll processing</li>
                    <li>Grant Center Phase 2 ready for executive reporting</li>
                  </ul>
                </HqPanel>
              </>
            )}
            <div className="hq-grid-2">
              <HqPanel title="Upcoming Deadlines">
                <ul className="hq-activity-list">
                  {(deadlines.data?.deadlines ?? []).slice(0, 5).map((d) => (
                    <li key={d.id} className="hq-activity-item">
                      <div className="hq-activity-content"><div className="hq-activity-title">{d.title}</div><div className="hq-activity-detail">{d.opportunity_title}</div></div>
                      <div className="hq-activity-time">{fmtDate(d.due_date)}</div>
                    </li>
                  ))}
                </ul>
              </HqPanel>
              <HqPanel title="Notifications">
                <ul className="hq-activity-list">
                  {(dash?.recentNotifications ?? []).slice(0, 5).map((n) => (
                    <li key={n.id} className="hq-activity-item">
                      <div className="hq-activity-content"><div className="hq-activity-title">{n.title}</div></div>
                      <div className="hq-activity-time">{fmtDate(n.due_date)}</div>
                    </li>
                  ))}
                  {!(dash?.recentNotifications ?? []).length && <li className="hq-muted-text">No pending notifications</li>}
                </ul>
              </HqPanel>
            </div>
          </>
        )}

        {tab === "pipeline" && (
          <Suspense fallback={<TabFallback />}>
            <GrantEnterprisePipelineHub
              onOpenApplication={(id) => {
                setSelectedApplicationId(id);
                selectTab("applications");
                setAppsSection("studio");
              }}
            />
            <div style={{ marginTop: "1.25rem" }}>
              <GrantV5PipelineKanban />
            </div>
            <div style={{ marginTop: "1.25rem" }}>
              <GrantEconomicDevelopmentPanel />
            </div>
            <div style={{ marginTop: "1.25rem" }}>
              <GrantV5PipelineAutomationPanel />
            </div>
            <div style={{ marginTop: "1.25rem" }}>
              <GrantV4LifecyclePanel />
            </div>
            <div style={{ marginTop: "1.25rem" }}>
              <GrantV2PipelineDashboard
                onNavigate={(nextTab, applicationId) => {
                  selectTab(nextTab as Tab);
                  if (applicationId) setSelectedApplicationId(applicationId);
                }}
              />
            </div>
          </Suspense>
        )}

        {tab === "funders" && (
          <>
            <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
              <KpiCard label="Total Funders" value={funderDashboard.data?.totalFunders ?? 0} icon={Handshake} />
              <KpiCard label="Active Partners" value={funderDashboard.data?.activePartners ?? 0} variant="success" />
              <KpiCard label="Total Awarded" value={fmt(funderDashboard.data?.totalAwarded)} variant="gold" />
            </div>
            <div className={`hq-grant-funder-grid${selectedFunderId ? " has-detail" : ""}`}>
              <HqPanel title="Funder CRM" headerExtra={
                canManage ? (
                  <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => setShowNewFunder(!showNewFunder)}><Plus size={14} /> Add</button>
                ) : undefined
              }>
                {canManage && showNewFunder && (
                  <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "var(--hq-bg-subtle)", borderRadius: 6 }}>
                    <input className="hq-aura-input" placeholder="Funder name" value={newFunder.name} onChange={(e) => setNewFunder({ ...newFunder, name: e.target.value })} style={{ marginBottom: "0.5rem" }} />
                    <input className="hq-aura-input" placeholder="Contact name" value={newFunder.contact_name} onChange={(e) => setNewFunder({ ...newFunder, contact_name: e.target.value })} style={{ marginBottom: "0.5rem" }} />
                    <input className="hq-aura-input" placeholder="Contact email" value={newFunder.contact_email} onChange={(e) => setNewFunder({ ...newFunder, contact_email: e.target.value })} style={{ marginBottom: "0.5rem" }} />
                    <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={!newFunder.name || createFunder.isPending} onClick={() => createFunder.mutate(newFunder)}>Save Funder</button>
                  </div>
                )}
                <input className="hq-aura-input" placeholder="Search funders…" value={funderSearch} onChange={(e) => setFunderSearch(e.target.value)} style={{ marginBottom: "0.75rem" }} />
                {funders.isLoading ? <HqLoading /> : (
                  <ul className="hq-activity-list">
                    {(funders.data?.funders ?? []).map((f: GrantFunder) => (
                      <li key={f.id} className="hq-activity-item" style={{ cursor: "pointer" }} onClick={() => setSelectedFunderId(f.id)}>
                        <div className="hq-activity-content">
                          <div className="hq-activity-title">{f.name}</div>
                          <div className="hq-activity-detail">{(f.relationship_stage ?? "prospect").replace(/_/g, " ")} · {f.activeAwards ?? 0} awards</div>
                        </div>
                        <div className="hq-activity-time">{fmt(f.totalAwarded)}</div>
                      </li>
                    ))}
                    {!(funders.data?.funders ?? []).length && <li className="hq-muted-text">No funders yet</li>}
                  </ul>
                )}
              </HqPanel>
              {selectedFunderId && (
                <HqPanel title={String(funderDetail.data?.funder?.name ?? "Funder Detail")} headerExtra={
                  <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => setSelectedFunderId(null)}>Close</button>
                }>
                  {funderDetail.isLoading ? <HqLoading /> : funderDetail.data && (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
                        <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Contact</div>{(funderDetail.data.funder as GrantFunder).contact_name ?? "—"}</div>
                        <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Email</div>{(funderDetail.data.funder as GrantFunder).contact_email ?? "—"}</div>
                        <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Stage</div><StatusBadge label={((funderDetail.data.funder as GrantFunder).relationship_stage ?? "prospect").replace(/_/g, " ")} variant="gold" /></div>
                      </div>
                      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
                        <HqPanel title="Active Awards">
                          <ul className="hq-activity-list">
                            {(funderDetail.data.awards ?? []).slice(0, 5).map((a) => (
                              <li key={a.id as string} className="hq-activity-item">
                                <div className="hq-activity-content"><div className="hq-activity-title">{a.title as string}</div></div>
                                <div className="hq-activity-time">{fmt(a.amount as number)}</div>
                              </li>
                            ))}
                          </ul>
                        </HqPanel>
                        <HqPanel title="Compliance Due">
                          <ul className="hq-activity-list">
                            {(funderDetail.data.complianceDue ?? []).slice(0, 5).map((c) => (
                              <li key={c.id as string} className="hq-activity-item">
                                <div className="hq-activity-content"><div className="hq-activity-title">{c.report_type as string}</div><div className="hq-activity-detail">{c.title as string}</div></div>
                                <div className="hq-activity-time">{fmtDate(c.due_date as string)}</div>
                              </li>
                            ))}
                            {!(funderDetail.data.complianceDue ?? []).length && <li className="hq-muted-text">No pending compliance</li>}
                          </ul>
                        </HqPanel>
                      </div>
                      {canManage && (
                      <HqPanel title="Log Interaction">
                        <div style={{ display: "grid", gap: "0.5rem" }}>
                          <input className="hq-aura-input" placeholder="Subject" value={newInteraction.subject} onChange={(e) => setNewInteraction({ ...newInteraction, subject: e.target.value })} />
                          <textarea className="hq-aura-input" rows={2} placeholder="Notes" value={newInteraction.notes} onChange={(e) => setNewInteraction({ ...newInteraction, notes: e.target.value })} />
                          <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={!newInteraction.subject || logInteraction.isPending} onClick={() => logInteraction.mutate()}>Log Interaction</button>
                        </div>
                        <ul className="hq-activity-list" style={{ marginTop: "1rem" }}>
                          {(funderDetail.data.interactions ?? []).map((i) => (
                            <li key={i.id as string} className="hq-activity-item">
                              <div className="hq-activity-content"><div className="hq-activity-title">{i.subject as string}</div><div className="hq-activity-detail">{i.notes as string}</div></div>
                              <div className="hq-activity-time">{fmtDate(i.interaction_date as string)}</div>
                            </li>
                          ))}
                        </ul>
                      </HqPanel>
                      )}
                    </>
                  )}
                </HqPanel>
              )}
            </div>
          </>
        )}

        {tab === "discover" && (
          <>
            <div style={{ marginBottom: "1.25rem" }}>
              <GrantIntelligencePanel onStartApplication={handleStartApplication} />
            </div>
            <div style={{ marginBottom: "1.25rem" }}>
              <GrantDiscoverHub onStartApplication={handleStartApplication} />
            </div>
            <div style={{ marginBottom: "1.25rem" }}>
              <Suspense fallback={<TabFallback />}><GrantV5NationalDatabase /></Suspense>
            </div>
            {canManage && (
            <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="hq-btn hq-btn-primary" onClick={() => setShowNewOpp(!showNewOpp)}>
                <Plus size={16} /> New Opportunity
              </button>
            </div>
            )}
            {canManage && showNewOpp && (
              <div className="hq-panel hq-fade-in" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
                <h3 style={{ marginBottom: "1rem", color: "var(--hq-gold)" }}>Add Grant Opportunity</h3>
                <div className="hq-form-grid">
                  <label>Title<input className="hq-aura-input" value={newOpp.title} onChange={(e) => setNewOpp({ ...newOpp, title: e.target.value })} /></label>
                  <label>Funder<input className="hq-aura-input" value={newOpp.funder} onChange={(e) => setNewOpp({ ...newOpp, funder: e.target.value })} /></label>
                  <label>Min Amount<input className="hq-aura-input" type="number" value={newOpp.amount_min} onChange={(e) => setNewOpp({ ...newOpp, amount_min: e.target.value })} /></label>
                  <label>Max Amount<input className="hq-aura-input" type="number" value={newOpp.amount_max} onChange={(e) => setNewOpp({ ...newOpp, amount_max: e.target.value })} /></label>
                  <label>Deadline<input className="hq-aura-input" type="date" value={newOpp.deadline} onChange={(e) => setNewOpp({ ...newOpp, deadline: e.target.value })} /></label>
                  <label>Funder URL<input className="hq-aura-input" value={newOpp.url} onChange={(e) => setNewOpp({ ...newOpp, url: e.target.value })} placeholder="https://…" /></label>
                  <label style={{ gridColumn: "1 / -1" }}>Description<textarea className="hq-aura-input" rows={2} value={newOpp.description} onChange={(e) => setNewOpp({ ...newOpp, description: e.target.value })} /></label>
                  <label style={{ gridColumn: "1 / -1" }}>Eligibility criteria<textarea className="hq-aura-input" rows={2} value={newOpp.eligibility} onChange={(e) => setNewOpp({ ...newOpp, eligibility: e.target.value })} placeholder="501(c)(3), geographic restrictions…" /></label>
                  <label>IFCDC Divisions
                    <select
                      className="hq-aura-input"
                      multiple
                      value={newOpp.division_slugs}
                      onChange={(e) => setNewOpp({ ...newOpp, division_slugs: Array.from(e.target.selectedOptions, (o) => o.value) })}
                      style={{ minHeight: 80 }}
                    >
                      <option value="housing">Housing</option>
                      <option value="anti_gang">Anti-Gang</option>
                      <option value="scholarships">Scholarships</option>
                      <option value="economic_development">Economic Development</option>
                      <option value="tapis">TAPIS</option>
                      <option value="inclusive">Inclusive Community</option>
                      <option value="music">Music</option>
                      <option value="radio">Radio</option>
                      <option value="community_programs">Community Programs</option>
                    </select>
                  </label>
                  <label>Geography<input className="hq-aura-input" value={newOpp.geography} onChange={(e) => setNewOpp({ ...newOpp, geography: e.target.value })} placeholder="local, state, national" /></label>
                </div>
                <div className="hq-modal-actions" style={{ marginTop: "1rem" }}>
                  <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setShowNewOpp(false)}>Cancel</button>
                  <button
                    type="button"
                    className="hq-btn hq-btn-primary"
                    disabled={!newOpp.title || !newOpp.funder || createOpp.isPending}
                    onClick={() => createOpp.mutate({
                      title: newOpp.title,
                      funder: newOpp.funder,
                      description: newOpp.description,
                      amount_min: newOpp.amount_min ? Number(newOpp.amount_min) : undefined,
                      amount_max: newOpp.amount_max ? Number(newOpp.amount_max) : undefined,
                      deadline: newOpp.deadline || undefined,
                      url: newOpp.url || undefined,
                      status: "open",
                      division_slugs: newOpp.division_slugs,
                      eligibility: newOpp.eligibility || undefined,
                      geography: newOpp.geography || undefined,
                    } as Partial<GrantOpportunity>)}
                  >
                    {createOpp.isPending ? "Saving…" : "Create Opportunity"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {tab === "applications" && (
          <>
            <GrantSubNav
              items={[
                { id: "list", label: "Applications Hub" },
                { id: "studio", label: "Writer Studio" },
                { id: "library", label: "Grant Library" },
              ]}
              active={appsSection}
              onChange={(id) => setAppsSection(id as typeof appsSection)}
            />
            {appsSection === "list" && (
              <>
                {canManage && (
                  <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" className="hq-btn hq-btn-primary" onClick={() => setShowNewApp(!showNewApp)}><Plus size={16} /> New Application</button>
                  </div>
                )}
                {canManage && showNewApp && (
                  <div className="hq-panel hq-fade-in" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "0.75rem", alignItems: "end" }}>
                      <div><label style={{ fontSize: "0.75rem", color: "var(--hq-text-muted)" }}>Title</label>
                        <input className="hq-aura-input" value={newApp.title} onChange={(e) => setNewApp({ ...newApp, title: e.target.value })} /></div>
                      <div><label style={{ fontSize: "0.75rem", color: "var(--hq-text-muted)" }}>Opportunity</label>
                        <select className="hq-aura-input" value={newApp.opportunity_id} onChange={(e) => setNewApp({ ...newApp, opportunity_id: e.target.value })}>
                          <option value="">Select…</option>{opps.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                        </select></div>
                      <div><label style={{ fontSize: "0.75rem", color: "var(--hq-text-muted)" }}>Amount Requested</label>
                        <input className="hq-aura-input" type="number" value={newApp.amount_requested} onChange={(e) => setNewApp({ ...newApp, amount_requested: e.target.value })} /></div>
                      <button type="button" className="hq-btn hq-btn-primary" disabled={createApp.isPending} onClick={() => createApp.mutate({ title: newApp.title, opportunity_id: newApp.opportunity_id || undefined, amount_requested: newApp.amount_requested ? Number(newApp.amount_requested) : undefined })}>Create</button>
                    </div>
                  </div>
                )}
                <div style={{ marginBottom: "1.25rem" }}>
                  <GrantApplicationsHub onOpenApplication={(id) => { setSelectedApplicationId(id); setAppsSection("studio"); }} />
                </div>
                <GrantFullApplicationWorkspace
                  applicationId={selectedApplicationId}
                  onUpdated={() => {
                    qc.invalidateQueries({ queryKey: ["grants-applications"] });
                    qc.invalidateQueries({ queryKey: ["grant-enriched-applications"] });
                  }}
                />
              </>
            )}
            {appsSection === "studio" && (
              <>
              <GrantWriterStudioPanel
                applications={(applications.data?.applications ?? []).map((a) => ({ id: a.id, title: a.title }))}
                selectedApplicationId={selectedApplicationId}
                onSelectApplication={(id) => setSelectedApplicationId(id || null)}
              />
              <div style={{ marginTop: "1.25rem" }}>
                <GrantFullApplicationWorkspace
                  applicationId={selectedApplicationId}
                  onUpdated={() => {
                    qc.invalidateQueries({ queryKey: ["grants-applications"] });
                    qc.invalidateQueries({ queryKey: ["grant-enriched-applications"] });
                  }}
                />
              </div>
              </>
            )}
            {appsSection === "library" && (
              <GrantLibraryPanel
                onApplyTemplate={canManage ? (templateId) => {
                  if (selectedApplicationId) {
                    grantsApi.writerStudio(selectedApplicationId, templateId).then(() => {
                      qc.invalidateQueries({ queryKey: ["grant-writer-studio", selectedApplicationId] });
                      setAppsSection("studio");
                    }).catch(() => {
                      window.alert("Could not apply template. Select an application first.");
                    });
                  } else {
                    setAppsSection("list");
                  }
                } : undefined}
              />
            )}
          </>
        )}

        {tab === "calendar" && (
          <>
            <GrantSubNav
              items={[
                { id: "calendar", label: "Calendar" },
                { id: "deadlines", label: "Deadlines" },
                { id: "notifications", label: "Notifications" },
              ]}
              active={calendarSection}
              onChange={(id) => setCalendarSection(id as typeof calendarSection)}
            />
            {calendarSection === "calendar" && (
          <>
            <Suspense fallback={<TabFallback />}><GrantV4FundingCalendar /></Suspense>
            <div style={{ marginTop: "1.25rem" }}>
          <HqPanel title="Grant Calendar" subtitle={calendar.data?.month ?? new Date().toISOString().slice(0, 7)}>
            {calendar.isLoading ? <HqLoading /> : (
              <>
                <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Deadlines</h4>
                <ul className="hq-activity-list">
                  {(calendar.data?.deadlines ?? []).map((d) => (
                    <li key={d.id} className="hq-activity-item">
                      <div className="hq-activity-icon"><Calendar size={16} /></div>
                      <div className="hq-activity-content"><div className="hq-activity-title">{d.title}</div><div className="hq-activity-detail">{d.opportunity_title} · {d.deadline_type}</div></div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span className="hq-activity-time">{fmtDate(d.due_date)}</span>
                        {!d.completed && canManage && <button type="button" className="hq-btn hq-btn-secondary" style={{ padding: "0.25rem 0.5rem", fontSize: "0.7rem" }} onClick={() => completeDeadline.mutate(d.id)}><CheckCircle size={12} /></button>}
                      </div>
                    </li>
                  ))}
                </ul>
                <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", margin: "1.25rem 0 0.75rem" }}>Compliance Due Dates</h4>
                <ul className="hq-activity-list">
                  {(calendar.data?.compliance ?? []).map((c) => (
                    <li key={c.id as string} className="hq-activity-item">
                      <div className="hq-activity-content"><div className="hq-activity-title">{c.report_type as string}</div><div className="hq-activity-detail">{c.grant_title as string}</div></div>
                      <div className="hq-activity-time">{fmtDate(c.due_date as string)}</div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </HqPanel>
            </div>
          </>
            )}
            {calendarSection === "deadlines" && (
          <>
            <div style={{ marginBottom: "1.25rem" }}>
              <Suspense fallback={<TabFallback />}><GrantDeadlineRenewalPanel /></Suspense>
            </div>
            <HqPanel title="All Grant Deadlines" subtitle="Submission deadlines, compliance reports, and action items">
            <GrantQueryBoundary query={allDeadlines} title="Deadlines unavailable">
            {allDeadlines.isLoading ? <HqLoading /> : (
              <table className="hq-table">
                <thead><tr><th>Deadline</th><th>Type</th><th>Grant</th><th>Due</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {(allDeadlines.data?.deadlines ?? []).map((d) => (
                    <tr key={d.id}>
                      <td><strong>{d.title}</strong></td>
                      <td>{d.deadline_type}</td>
                      <td>{d.opportunity_title ?? "—"}</td>
                      <td>{fmtDate(d.due_date)}</td>
                      <td><StatusBadge label={d.completed ? "Complete" : "Open"} variant={d.completed ? "success" : "warning"} /></td>
                      <td>
                        {!d.completed && canManage && (
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => completeDeadline.mutate(d.id)}>
                            <CheckCircle size={12} /> Mark Done
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!allDeadlines.data?.deadlines?.length && (
                    <tr><td colSpan={6} className="hq-empty-cell">No deadlines — add opportunities with due dates in Grant Center</td></tr>
                  )}
                </tbody>
              </table>
            )}
            </GrantQueryBoundary>
          </HqPanel>
          </>
            )}
            {calendarSection === "notifications" && (
          <HqPanel title="Automated Notifications & Reminders">
            <GrantQueryBoundary query={notifications} title="Notifications unavailable">
            {notifications.isLoading ? <HqLoading /> : (
              <table className="hq-table">
                <thead><tr><th>Notification</th><th>Type</th><th>Due</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {(notifications.data?.notifications ?? []).map((n) => (
                    <tr key={n.id as string}>
                      <td><strong>{n.title as string}</strong><div className="hq-muted-text">{n.message as string}</div></td>
                      <td>{n.notification_type as string}</td>
                      <td>{fmtDate(n.due_date as string)}</td>
                      <td><StatusBadge label={(n.read as number) ? "read" : "unread"} variant={(n.read as number) ? "muted" : "warning"} /></td>
                      <td>{!(n.read as number) && canManage && <button type="button" className="hq-btn hq-btn-sm" onClick={() => markRead.mutate(n.id as string)}>Mark Read</button>}</td>
                    </tr>
                  ))}
                  {!(notifications.data?.notifications ?? []).length && <tr><td colSpan={5} className="hq-empty-cell">No notifications. Deadlines and compliance items generate reminders automatically.</td></tr>}
                </tbody>
              </table>
            )}
            </GrantQueryBoundary>
          </HqPanel>
            )}
          </>
        )}

        {tab === "documents" && (
          <Suspense fallback={<TabFallback />}>
          <GrantV3DocumentCenter applications={(applications.data?.applications ?? []).map((a) => ({ id: a.id, title: a.title }))}>
            <GrantDocumentManagementPanel
              applications={(applications.data?.applications ?? []).map((a) => ({ id: a.id, title: a.title }))}
              uploadPending={uploadDocFile.isPending}
              readOnly={!canManage}
              onUpload={canManage ? ({ name, application_id, doc_category, file }) => {
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  uploadDocFile.mutate({
                    fileName: file.name,
                    base64: String(reader.result ?? ""),
                    mimeType: file.type,
                    name,
                    application_id,
                    doc_type: doc_category,
                    doc_category,
                  } as Parameters<typeof grantsApi.uploadDocumentFile>[0] & { doc_category?: string });
                };
                reader.readAsDataURL(file);
              } : () => undefined}
            />
          </GrantV3DocumentCenter>
          </Suspense>
        )}

        {tab === "finance" && (
          <>
            <GrantSubNav
              items={[
                { id: "awards", label: "Awards" },
                { id: "budgets", label: "Budget Builder" },
                { id: "reports", label: "Financial Reports" },
              ]}
              active={financeSection}
              onChange={(id) => setFinanceSection(id as typeof financeSection)}
            />
            {financeSection === "awards" && (
          <div className="hq-app-grid">
            {awards.isLoading ? <HqLoading /> : awardList.length === 0 ? (
              <div className="hq-empty">No awards yet. Award an application to create a Financial Center budget automatically.</div>
            ) : awardList.map((a) => (
              <div key={a.id} className="hq-app-card">
                <div className="hq-app-name">{a.opportunity_title ?? a.application_title}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--hq-gold)", margin: "0.25rem 0" }}>{a.funder}</div>
                <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--hq-success)", margin: "0.5rem 0" }}>{fmt(a.amount)}</div>
                <StatusBadge label={a.status} variant={STATUS_VARIANT[a.status] ?? "muted"} />
                <div className="hq-app-meta-item" style={{ marginTop: "0.5rem" }}>Awarded {fmtDate(a.award_date)}</div>
                {a.finance_budget_id && <div className="hq-app-meta-item" style={{ color: "var(--hq-gold)" }}>Linked to Financial Center</div>}
              </div>
            ))}
          </div>
            )}
            {financeSection === "budgets" && (
          <>
            <Suspense fallback={<TabFallback />}><GrantBudgetIntegrationPanel /></Suspense>
            {canManage && (
            <div className="hq-panel" style={{ marginTop: "1.25rem", marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Budget Builder — Connected to Financial Center</h4>
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }}>
                <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Award</label>
                  <select className="hq-aura-input" value={selectedAward} onChange={(e) => setSelectedAward(e.target.value)}>
                    <option value="">Select award…</option>
                    {awardList.map((a) => <option key={a.id} value={a.id}>{a.opportunity_title ?? a.application_title}</option>)}
                  </select></div>
                {budgetLines.map((line, i) => (
                  <div key={i} style={{ display: "flex", gap: "0.5rem" }}>
                    <input className="hq-aura-input" placeholder="Line name" value={line.line_name} onChange={(e) => { const n = [...budgetLines]; n[i].line_name = e.target.value; setBudgetLines(n); }} />
                    <input className="hq-aura-input" type="number" placeholder="Amount" value={line.allocated} onChange={(e) => { const n = [...budgetLines]; n[i].allocated = e.target.value; setBudgetLines(n); }} />
                  </div>
                ))}
                <button type="button" className="hq-btn hq-btn-primary" disabled={!selectedAward || createBudget.isPending}
                  onClick={() => createBudget.mutate({ award_id: selectedAward, lines: budgetLines.filter((l) => l.allocated).map((l) => ({ ...l, allocated: Number(l.allocated) })) })}>
                  Save to Financial Center
                </button>
              </div>
            </div>
            )}
            <HqPanel title="Grant Budgets (Financial Center)">
              {budgets.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Grant</th><th>Line</th><th>Category</th><th>Allocated</th><th>Spent (FC)</th></tr></thead>
                  <tbody>
                    {(budgets.data?.financeBudgets ?? []).map((b) => (
                      <tr key={b.id as string}>
                        <td>{b.name as string}</td><td>—</td><td>{b.category as string}</td>
                        <td>{fmt(b.allocated as number)}</td><td>{fmt(b.spent as number)}</td>
                      </tr>
                    ))}
                    {(budgets.data?.budgetLines ?? []).map((l) => (
                      <tr key={l.id as string}>
                        <td>{l.grant_title as string}</td><td>{l.line_name as string}</td><td>{l.category as string}</td>
                        <td>{fmt(l.allocated as number)}</td><td>{fmt(l.spent as number)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
            )}
            {financeSection === "reports" && (
          <>
            <div style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", alignItems: "end" }}>
              <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Select Award</label>
                <select className="hq-aura-input" value={selectedAward} onChange={(e) => setSelectedAward(e.target.value)}>
                  <option value="">All awards</option>
                  {awardList.map((a) => <option key={a.id} value={a.id}>{a.opportunity_title ?? a.application_title}</option>)}
                </select></div>
              {selectedAward && canManage && (
                <button type="button" className="hq-btn hq-btn-secondary" disabled={syncLabor.isPending} onClick={() => syncLabor.mutate(selectedAward)}>
                  <Users size={14} /> Sync Labor from Payroll
                </button>
              )}
            </div>
            {financial.data && selectedAward && (
              <div className="hq-kpi-grid">
                <KpiCard label="Award Amount" value={fmt(financial.data.awardAmount as number)} variant="gold" />
                <KpiCard label="Budget Remaining" value={fmt(financial.data.budgetRemaining as number)} />
                <KpiCard label="Total Expenses" value={fmt(financial.data.totalExpenses as number)} variant="warning" />
                <KpiCard label="Labor Costs" value={fmt(financial.data.totalLabor as number)} />
                <KpiCard label="Burn Rate" value={`${financial.data.burnRate}%`} variant={(financial.data.burnRate as number) > 80 ? "danger" : "success"} />
              </div>
            )}
            <div className="hq-grid-2">
              <HqPanel title="Labor Cost Reporting" subtitle="From Financial Center payroll">
                {labor.isLoading ? <HqLoading /> : (
                  <table className="hq-table">
                    <thead><tr><th>Person</th><th>Role</th><th>Hours</th><th>Cost</th></tr></thead>
                    <tbody>
                      {(labor.data?.labor ?? []).map((l) => (
                        <tr key={l.id as string}>
                          <td>{l.first_name as string} {l.last_name as string}</td>
                          <td>{l.role as string}</td><td>{l.hours as number}</td>
                          <td>${((l.cost_cents as number) / 100).toFixed(2)}</td>
                        </tr>
                      ))}
                      {!(labor.data?.labor ?? []).length && <tr><td colSpan={4} className="hq-empty-cell">Sync labor from payroll to populate</td></tr>}
                    </tbody>
                  </table>
                )}
              </HqPanel>
              <HqPanel title="Grant Expenditures" subtitle="From Financial Center expenses">
                {expenditures.isLoading ? <HqLoading /> : (
                  <table className="hq-table">
                    <thead><tr><th>Description</th><th>Category</th><th>Amount</th><th>Date</th></tr></thead>
                    <tbody>
                      {[...(expenditures.data?.expenditures ?? []), ...(expenditures.data?.financeExpenses ?? [])].slice(0, 15).map((e, i) => (
                        <tr key={(e.id as string) ?? i}>
                          <td>{e.description as string}</td><td>{e.category as string}</td>
                          <td>${((e.amount_cents as number) / 100).toFixed(2)}</td>
                          <td>{fmtDate(e.expense_date as string)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </HqPanel>
            </div>
          </>
            )}
          </>
        )}

        {tab === "compliance" && (
          <>
            <GrantSubNav
              items={[
                { id: "tracking", label: "Compliance Tracking" },
                { id: "funder-reports", label: "Funder Reports" },
              ]}
              active={complianceSection}
              onChange={(id) => setComplianceSection(id as typeof complianceSection)}
            />
            {complianceSection === "tracking" && (
          <>
            <Suspense fallback={<TabFallback />}><GrantV5ComplianceDashboard /></Suspense>
            <div style={{ marginTop: "1.25rem" }}>
          <HqPanel title="Compliance Tracking & Reminders">
            {compliance.isLoading ? <HqLoading /> : (
              <table className="hq-table">
                <thead><tr><th>Grant</th><th>Report Type</th><th>Due Date</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {(compliance.data?.compliance ?? []).map((c) => (
                    <tr key={c.id as string}>
                      <td>{c.grant_title as string}</td><td>{c.report_type as string}</td>
                      <td>{fmtDate(c.due_date as string)}</td>
                      <td><StatusBadge label={c.status as string} variant={STATUS_VARIANT[c.status as string] ?? "muted"} /></td>
                      <td>{c.status === "pending" && canManage && <button type="button" className="hq-btn hq-btn-sm" onClick={() => grantsApi.updateCompliance(c.id as string, { status: "submitted" }).then(() => qc.invalidateQueries({ queryKey: ["grants-compliance"] }))}>Mark Submitted</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </HqPanel>
            </div>
          </>
            )}
            {complianceSection === "funder-reports" && (
          <GrantQueryBoundary query={funderReports} title="Funder reports unavailable" message="Live funder report data could not be loaded.">
          {funderReports.isLoading ? <HqLoading /> : (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
                <KpiCard label="Active Awards" value={funderReports.data?.reports.length ?? 0} icon={Award} variant="gold" />
                <KpiCard label="Reports Ready" value={(funderReports.data?.reports ?? []).filter((r) => r.reportReady).length} icon={CheckCircle} variant="success" />
                <KpiCard label="Compliance Due" value={funderReports.data?.upcomingCompliance.length ?? 0} icon={Bell} variant="warning" />
              </div>
              <HqPanel title="Funder Report Status" subtitle="Budget burn, compliance, and document readiness per award">
                <table className="hq-table">
                  <thead><tr><th>Funder</th><th>Grant</th><th>Awarded</th><th>Spent</th><th>Burn %</th><th>Compliance</th><th>Ready</th></tr></thead>
                  <tbody>
                    {(funderReports.data?.reports ?? []).map((r) => (
                      <tr key={r.awardId}>
                        <td>{r.funder}</td>
                        <td>{r.grantTitle}</td>
                        <td>{fmt(r.awardAmount)}</td>
                        <td>{fmt(r.spent)}</td>
                        <td>{r.burnRate}%</td>
                        <td>{r.compliancePending} pending</td>
                        <td><StatusBadge label={r.reportReady ? "Ready" : "Incomplete"} variant={r.reportReady ? "success" : "warning"} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HqPanel>
              <HqPanel title="Upcoming Funder Deadlines" subtitle="Compliance reports due to funders">
                <table className="hq-table">
                  <thead><tr><th>Funder</th><th>Grant</th><th>Report</th><th>Due</th><th>Status</th></tr></thead>
                  <tbody>
                    {(funderReports.data?.upcomingCompliance ?? []).map((c) => (
                      <tr key={c.id as string}>
                        <td>{c.funder as string}</td>
                        <td>{c.grant_title as string}</td>
                        <td>{c.report_type as string}</td>
                        <td>{fmtDate(c.due_date as string)}</td>
                        <td><StatusBadge label={c.status as string} variant={STATUS_VARIANT[c.status as string] ?? "muted"} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HqPanel>
            </>
          )}
          </GrantQueryBoundary>
            )}
          </>
        )}

        {tab === "intelligence" && (
          <>
            <GrantSubNav
              items={[
                { id: "analytics", label: "Funding Analytics" },
                { id: "ai", label: "AI Intelligence" },
                { id: "history", label: "History & Outcomes" },
                { id: "divisions", label: "Division Profiles" },
              ]}
              active={intelSection}
              onChange={(id) => setIntelSection(id as typeof intelSection)}
            />
            {intelSection === "analytics" && (
          <>
            <Suspense fallback={<TabFallback />}><GrantV2ExecutiveAnalytics /></Suspense>
            <GrantQueryBoundary query={fundingAnalytics} title="Funding analytics unavailable">
            {fundingAnalytics.isLoading ? <HqLoading /> : fundingAnalytics.data && (
              <div className="hq-grid-2" style={{ marginTop: "1.25rem" }}>
                <HqPanel title="Awards by Funder">
                  <table className="hq-table">
                    <thead><tr><th>Funder</th><th>Awards</th><th>Total</th></tr></thead>
                    <tbody>
                      {(fundingAnalytics.data.analytics?.byFunder ?? []).map((f) => (
                        <tr key={f.funder}><td>{f.funder}</td><td>{f.awards}</td><td>{fmt(f.total)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </HqPanel>
                <HqPanel title="Awards by Program">
                  <table className="hq-table">
                    <thead><tr><th>Program</th><th>Awards</th><th>Total</th></tr></thead>
                    <tbody>
                      {(fundingAnalytics.data.analytics?.byProgram ?? []).map((p) => (
                        <tr key={p.program}><td>{p.program}</td><td>{p.awards}</td><td>{fmt(p.total)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </HqPanel>
              </div>
            )}
            </GrantQueryBoundary>
          </>
            )}
            {intelSection === "ai" && (
              <Suspense fallback={<TabFallback />}><GrantV5AuraAdvisorPanel /></Suspense>
            )}
            {intelSection === "history" && (
          <>
            <div style={{ marginBottom: "1.25rem" }}>
              <Suspense fallback={<TabFallback />}><GrantOutcomesPanel /></Suspense>
            </div>
            <HqPanel title="Grant Activity Log">
              <GrantQueryBoundary query={history} title="Activity history unavailable">
              {history.isLoading ? <HqLoading /> : (
                <ul className="hq-activity-list">
                  {(history.data?.activity ?? []).map((a) => (
                    <li key={a.id as string} className="hq-activity-item">
                      <div className="hq-activity-content"><div className="hq-activity-title">{a.action as string}</div><div className="hq-activity-detail">{a.detail as string}</div></div>
                      <div className="hq-activity-time">{new Date(a.created_at as string).toLocaleDateString()}</div>
                    </li>
                  ))}
                </ul>
              )}
              </GrantQueryBoundary>
            </HqPanel>
          </>
            )}
            {intelSection === "divisions" && (
          <Suspense fallback={<TabFallback />}>
            <GrantDivisionConnectorsPanel />
            <div style={{ marginTop: "1.25rem" }}>
              <GrantV4ProgramIntegration />
            </div>
          </Suspense>
            )}
          </>
        )}
      </div>
    </HQLayout>
  );
};

export default GrantCenterPage;
