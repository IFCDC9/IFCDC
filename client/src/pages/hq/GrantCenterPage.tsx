import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText, Calendar, Award, ClipboardList, Shield, Plus, CheckCircle,
  DollarSign, Users, BarChart3, Bell, History, Upload, TrendingUp, Wallet, Sparkles, FileBarChart, Handshake,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { grantsApi, type GrantOpportunity, type GrantApplication, type GrantFunder } from "../../api/grantsApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { formatCurrency } from "../../utils/safeFormat";
import { GrantV3ExecutiveDashboard } from "../../components/hq/grants/GrantV3ExecutiveDashboard";
import { GrantV3DiscoveryPanel } from "../../components/hq/grants/GrantV3DiscoveryPanel";
import { GrantV3ProgramProfilesPanel } from "../../components/hq/grants/GrantV3ProgramProfilesPanel";
import { GrantV3DocumentCenter } from "../../components/hq/grants/GrantV3DocumentCenter";
import { GrantV3AuraExecutivePanel } from "../../components/hq/grants/GrantV3AuraExecutivePanel";
import { GrantFundingEngineOverview } from "../../components/hq/grants/GrantFundingEngineOverview";
import { GrantOpportunityDatabase } from "../../components/hq/grants/GrantOpportunityDatabase";
import { GrantApplicationWorkflowPanel } from "../../components/hq/grants/GrantApplicationWorkflowPanel";
import { GrantV2PipelineDashboard } from "../../components/hq/grants/GrantV2PipelineDashboard";
import { GrantLiveOpportunityDatabase } from "../../components/hq/grants/GrantLiveOpportunityDatabase";
import { GrantDocumentManagementPanel } from "../../components/hq/grants/GrantDocumentManagementPanel";
import { GrantOutcomesPanel } from "../../components/hq/grants/GrantOutcomesPanel";
import { GrantDeadlineRenewalPanel } from "../../components/hq/grants/GrantDeadlineRenewalPanel";
import { GrantBudgetIntegrationPanel } from "../../components/hq/grants/GrantBudgetIntegrationPanel";
import { GrantAuraIntelligencePanel } from "../../components/hq/grants/GrantAuraIntelligencePanel";

type Tab = "overview" | "pipeline" | "divisions" | "funders" | "opportunities" | "applications" | "calendar" | "deadlines" | "documents"
  | "budgets" | "finance" | "awards" | "compliance" | "funder-reports" | "analytics" | "history" | "notifications" | "ai-intelligence";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Executive Dashboard", icon: ClipboardList },
  { id: "pipeline", label: "Funding Pipeline", icon: TrendingUp },
  { id: "divisions", label: "Division Profiles", icon: Users },
  { id: "funders", label: "Funder CRM", icon: Handshake },
  { id: "opportunities", label: "Opportunities", icon: FileText },
  { id: "applications", label: "Applications", icon: ClipboardList },
  { id: "calendar", label: "Calendar", icon: Calendar },
  { id: "deadlines", label: "Deadlines", icon: Bell },
  { id: "documents", label: "Documents", icon: Upload },
  { id: "budgets", label: "Budget Builder", icon: DollarSign },
  { id: "finance", label: "Financial Reporting", icon: Wallet },
  { id: "awards", label: "Awards", icon: Award },
  { id: "compliance", label: "Compliance", icon: Shield },
  { id: "funder-reports", label: "Funder Reports", icon: FileBarChart },
  { id: "ai-intelligence", label: "AI Intelligence", icon: Sparkles },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "history", label: "History & Renewals", icon: History },
  { id: "notifications", label: "Notifications", icon: Bell },
];

const STATUS_VARIANT: Record<string, "gold" | "success" | "warning" | "danger" | "muted"> = {
  open: "success", draft: "muted", submitted: "gold", under_review: "warning",
  awarded: "success", denied: "danger", pending: "warning", active: "success",
  approved: "success", rejected: "danger", planned: "gold",
};

function fmt(n: number | null | undefined): string {
  return formatCurrency(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const GrantCenterPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("overview");
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

  useEffect(() => {
    const tabParam = searchParams.get("tab") as Tab | null;
    if (tabParam && TABS.some((x) => x.id === tabParam)) setTab(tabParam);
    const awardId = searchParams.get("award");
    if (awardId) {
      setSelectedAward(awardId);
      setTab("finance");
    }
    const funderId = searchParams.get("funder");
    if (funderId) {
      setSelectedFunderId(funderId);
      setTab("funders");
    }
  }, [searchParams]);

  const dashboard = useQuery({ queryKey: ["grants-dashboard"], queryFn: grantsApi.dashboard });
  const opportunities = useQuery({ queryKey: ["grants-opportunities"], queryFn: grantsApi.opportunities });
  const applications = useQuery({ queryKey: ["grants-applications"], queryFn: grantsApi.applications });
  const deadlines = useQuery({ queryKey: ["grants-deadlines"], queryFn: () => grantsApi.deadlines(true) });
  const allDeadlines = useQuery({ queryKey: ["grants-deadlines-all"], queryFn: () => grantsApi.deadlines(false), enabled: tab === "deadlines" });
  const awards = useQuery({ queryKey: ["grants-awards"], queryFn: grantsApi.awards });
  const compliance = useQuery({ queryKey: ["grants-compliance"], queryFn: grantsApi.compliance });
  const funderReports = useQuery({ queryKey: ["grants-funder-reports"], queryFn: grantsApi.funderReports, enabled: tab === "funder-reports" || tab === "overview" });
  const calendar = useQuery({ queryKey: ["grants-calendar"], queryFn: () => grantsApi.calendar(), enabled: tab === "calendar" });
  const documents = useQuery({ queryKey: ["grants-documents"], queryFn: () => grantsApi.documents(), enabled: tab === "documents" });
  const budgets = useQuery({ queryKey: ["grants-budgets"], queryFn: grantsApi.budgets, enabled: tab === "budgets" || tab === "overview" });
  const labor = useQuery({ queryKey: ["grants-labor", selectedAward], queryFn: () => grantsApi.labor(selectedAward || undefined), enabled: tab === "finance" });
  const expenditures = useQuery({ queryKey: ["grants-expenditures"], queryFn: () => grantsApi.expenditures(), enabled: tab === "finance" });
  const financial = useQuery({ queryKey: ["grants-financial", selectedAward], queryFn: () => grantsApi.financial(selectedAward), enabled: !!selectedAward && tab === "finance" });
  const analytics = useQuery({ queryKey: ["grants-analytics"], queryFn: grantsApi.analytics, enabled: tab === "analytics" });
  const notifications = useQuery({ queryKey: ["grants-notifications"], queryFn: grantsApi.notifications, enabled: tab === "notifications" || tab === "overview" });
  const history = useQuery({ queryKey: ["grants-history"], queryFn: grantsApi.history, enabled: tab === "history" });
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
    <HQLayout title="Grant Center" subtitle="Grant lifecycle management integrated with the Headquarters Financial Center — one source of truth for all grant finances">
      <nav className="hq-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`hq-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </nav>

      <div className="hq-tab-content hq-fade-in">
        {tab === "overview" && (
          <>
            <GrantV3ExecutiveDashboard />
            <div style={{ marginTop: "1.25rem" }}>
              <GrantFundingEngineOverview />
            </div>
            {dashboard.isLoading ? <HqLoading /> : dash && (
              <>
                <HqPanel title="Operational Snapshot" subtitle="Legacy dashboard metrics — see Executive Funding KPIs above">
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
          <GrantV2PipelineDashboard
            onNavigate={(nextTab, applicationId) => {
              setTab(nextTab as Tab);
              if (applicationId) setSelectedApplicationId(applicationId);
            }}
          />
        )}

        {tab === "divisions" && <GrantV3ProgramProfilesPanel />}

        {tab === "funders" && (
          <>
            <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
              <KpiCard label="Total Funders" value={funderDashboard.data?.totalFunders ?? 0} icon={Handshake} />
              <KpiCard label="Active Partners" value={funderDashboard.data?.activePartners ?? 0} variant="success" />
              <KpiCard label="Total Awarded" value={fmt(funderDashboard.data?.totalAwarded)} variant="gold" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: selectedFunderId ? "320px 1fr" : "1fr", gap: "1rem" }}>
              <HqPanel title="Funder CRM" headerExtra={
                <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => setShowNewFunder(!showNewFunder)}><Plus size={14} /> Add</button>
              }>
                {showNewFunder && (
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
                    </>
                  )}
                </HqPanel>
              )}
            </div>
          </>
        )}

        {tab === "opportunities" && (
          <>
            <div style={{ marginBottom: "1.25rem" }}>
              <GrantV3DiscoveryPanel />
            </div>
            <div style={{ marginBottom: "1.25rem" }}>
              <GrantLiveOpportunityDatabase
                onStartApplication={(opportunityId) => {
                  setNewApp({ title: "", opportunity_id: opportunityId, amount_requested: "" });
                  setShowNewApp(true);
                  setTab("applications");
                }}
              />
            </div>
            <div style={{ marginBottom: "1.25rem" }}>
              <GrantOpportunityDatabase
                onStartApplication={(opportunityId) => {
                  setNewApp({ title: "", opportunity_id: opportunityId, amount_requested: "" });
                  setShowNewApp(true);
                  setTab("applications");
                }}
              />
            </div>
            <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="hq-btn hq-btn-primary" onClick={() => setShowNewOpp(!showNewOpp)}>
                <Plus size={16} /> New Opportunity
              </button>
            </div>
            {showNewOpp && (
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
            <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="hq-btn hq-btn-primary" onClick={() => setShowNewApp(!showNewApp)}><Plus size={16} /> New Application</button>
            </div>
            {showNewApp && (
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
            <div className="hq-panel">
              <table className="hq-table">
                <thead><tr><th>Application</th><th>Funder</th><th>Status</th><th>Requested</th><th></th></tr></thead>
                <tbody>
                  {(applications.data?.applications ?? []).map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => setSelectedApplicationId(a.id)}
                      style={{ cursor: "pointer", background: selectedApplicationId === a.id ? "rgba(212,175,55,0.08)" : undefined }}
                    >
                      <td><strong>{a.title}</strong></td><td>{a.funder ?? "—"}</td>
                      <td><StatusBadge label={a.status} variant={STATUS_VARIANT[a.status] ?? "muted"} /></td>
                      <td>{fmt(a.amount_requested)}</td>
                      <td className="hq-muted-text" style={{ fontSize: "0.78rem" }}>{selectedApplicationId === a.id ? "Selected" : "Click for workflow"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: "1.25rem" }}>
              <GrantApplicationWorkflowPanel
                applicationId={selectedApplicationId}
                onUpdated={() => {
                  qc.invalidateQueries({ queryKey: ["grants-applications"] });
                  qc.invalidateQueries({ queryKey: ["grants-awards"] });
                  qc.invalidateQueries({ queryKey: ["grant-funding-outcomes"] });
                  qc.invalidateQueries({ queryKey: ["grant-funding-engine"] });
                }}
              />
            </div>
          </>
        )}

        {tab === "calendar" && (
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
                        {!d.completed && <button type="button" className="hq-btn hq-btn-secondary" style={{ padding: "0.25rem 0.5rem", fontSize: "0.7rem" }} onClick={() => completeDeadline.mutate(d.id)}><CheckCircle size={12} /></button>}
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
        )}

        {tab === "deadlines" && (
          <>
            <div style={{ marginBottom: "1.25rem" }}>
              <GrantDeadlineRenewalPanel />
            </div>
            <HqPanel title="All Grant Deadlines" subtitle="Submission deadlines, compliance reports, and action items">
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
                        {!d.completed && (
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
          </HqPanel>
          </>
        )}

        {tab === "documents" && (
          <GrantV3DocumentCenter applications={(applications.data?.applications ?? []).map((a) => ({ id: a.id, title: a.title }))}>
            <GrantDocumentManagementPanel
              applications={(applications.data?.applications ?? []).map((a) => ({ id: a.id, title: a.title }))}
              uploadPending={uploadDocFile.isPending}
              onUpload={({ name, application_id, doc_category, file }) => {
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
              }}
            />
          </GrantV3DocumentCenter>
        )}

        {tab === "budgets" && (
          <>
            <GrantBudgetIntegrationPanel />
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

        {tab === "finance" && (
          <>
            <div style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", alignItems: "end" }}>
              <div><label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Select Award</label>
                <select className="hq-aura-input" value={selectedAward} onChange={(e) => setSelectedAward(e.target.value)}>
                  <option value="">All awards</option>
                  {awardList.map((a) => <option key={a.id} value={a.id}>{a.opportunity_title ?? a.application_title}</option>)}
                </select></div>
              {selectedAward && (
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

        {tab === "awards" && (
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

        {tab === "compliance" && (
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
                      <td>{c.status === "pending" && <button type="button" className="hq-btn hq-btn-sm" onClick={() => grantsApi.updateCompliance(c.id as string, { status: "submitted" }).then(() => qc.invalidateQueries({ queryKey: ["grants-compliance"] }))}>Mark Submitted</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </HqPanel>
        )}

        {tab === "funder-reports" && (
          funderReports.isLoading ? <HqLoading /> : (
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
          )
        )}

        {tab === "analytics" && (
          analytics.isLoading ? <HqLoading /> : (
            <div className="hq-grid-2">
              <HqPanel title="Awards by Funder">
                <table className="hq-table">
                  <thead><tr><th>Funder</th><th>Awards</th><th>Total</th></tr></thead>
                  <tbody>
                    {(analytics.data?.byFunder ?? []).map((f) => (
                      <tr key={f.funder}><td>{f.funder}</td><td>{f.awards}</td><td>{fmt(f.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </HqPanel>
              <HqPanel title="Awards by Program">
                <table className="hq-table">
                  <thead><tr><th>Program</th><th>Awards</th><th>Total</th></tr></thead>
                  <tbody>
                    {(analytics.data?.byProgram ?? []).map((p) => (
                      <tr key={p.program}><td>{p.program}</td><td>{p.awards}</td><td>{fmt(p.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </HqPanel>
            </div>
          )
        )}

        {tab === "history" && (
          <>
            <div style={{ marginBottom: "1.25rem" }}>
              <GrantOutcomesPanel />
            </div>
            <HqPanel title="Grant Activity Log">
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
            </HqPanel>
          </>
        )}

        {tab === "notifications" && (
          <HqPanel title="Automated Notifications & Reminders">
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
                      <td>{!(n.read as number) && <button type="button" className="hq-btn hq-btn-sm" onClick={() => markRead.mutate(n.id as string)}>Mark Read</button>}</td>
                    </tr>
                  ))}
                  {!(notifications.data?.notifications ?? []).length && <tr><td colSpan={5} className="hq-empty-cell">No notifications. Deadlines and compliance items generate reminders automatically.</td></tr>}
                </tbody>
              </table>
            )}
          </HqPanel>
        )}

        {tab === "ai-intelligence" && (
          <>
            <GrantV3AuraExecutivePanel />
            <div style={{ marginTop: "1.25rem" }}>
              <GrantAuraIntelligencePanel />
            </div>
          </>
        )}
      </div>
    </HQLayout>
  );
};

export default GrantCenterPage;
