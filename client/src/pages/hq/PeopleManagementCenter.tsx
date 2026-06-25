import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Users, Search, Building2, Network, Clock, Plus, UserCircle,
  Mail, Phone, MapPin, Briefcase, FileText, GraduationCap, Award, Calendar, Palmtree, ShieldCheck, ClipboardCheck, HandHeart, PenLine,
  AlertTriangle, Star, CalendarDays, Landmark, UserPlus, Shield,
} from "lucide-react";
import { analyticsApi } from "../../api/analyticsApi";
import HQLayout from "../../layouts/HQLayout";
import { peopleApi, type Person } from "../../api/peopleApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { PeoplePhase3CommandCenter } from "../../components/hq/people/PeoplePhase3CommandCenter";
import { PeopleModuleDirectory } from "../../components/hq/people/PeopleModuleDirectory";
import { PeopleJobApplicantsPanel } from "../../components/hq/people/PeopleJobApplicantsPanel";
import { PeopleOrgStructurePanel } from "../../components/hq/people/PeopleOrgStructurePanel";
import { PeopleRolesPermissionsPanel } from "../../components/hq/people/PeopleRolesPermissionsPanel";
import { PeoplePersonnelFilesPanel } from "../../components/hq/people/PeoplePersonnelFilesPanel";
import { PeopleProfileEditPanel } from "../../components/hq/people/PeopleProfileEditPanel";
import { PeopleOrgChartPanel } from "../../components/hq/people/PeopleOrgChartPanel";
import { PeopleTimesheetsPanel } from "../../components/hq/people/PeopleTimesheetsPanel";
import { PeopleTeamAssignmentsPanel } from "../../components/hq/people/PeopleTeamAssignmentsPanel";
import { PeopleV3WorkforceIntelligenceDashboard, PeopleV3AuraWorkforcePanel } from "../../components/hq/people/PeopleV3WorkforceIntelligenceDashboard";

type Tab = "overview" | "directory" | "employees" | "volunteers" | "board" | "contractors" | "applicants" | "personnel-files" | "roles" | "org-structure" | "profile" | "departments" | "org-chart" | "scheduling" | "performance" | "incidents" | "time-clock" | "leave" | "onboarding" | "certifications" | "timesheets" | "team-assignments" | "intelligence";
type AddModal = "document" | "training" | "certification" | "schedule" | "performance" | "department" | "background" | "signature" | "leave" | "incident" | null;

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: Users },
  { id: "employees", label: "Employees", icon: Briefcase },
  { id: "volunteers", label: "Volunteers", icon: HandHeart },
  { id: "board", label: "Board", icon: Landmark },
  { id: "contractors", label: "Contractors", icon: Briefcase },
  { id: "applicants", label: "Applicants", icon: UserPlus },
  { id: "directory", label: "Directory", icon: Search },
  { id: "onboarding", label: "Onboarding", icon: ClipboardCheck },
  { id: "certifications", label: "Training & Certs", icon: Award },
  { id: "performance", label: "Performance", icon: Star },
  { id: "personnel-files", label: "Personnel Files", icon: FileText },
  { id: "roles", label: "Roles", icon: Shield },
  { id: "org-structure", label: "Org Structure", icon: Building2 },
  { id: "scheduling", label: "Scheduling", icon: CalendarDays },
  { id: "incidents", label: "Incidents", icon: AlertTriangle },
  { id: "departments", label: "Departments", icon: Building2 },
  { id: "org-chart", label: "Org Chart", icon: Network },
  { id: "time-clock", label: "Time Clock", icon: Clock },
  { id: "leave", label: "Leave Requests", icon: Palmtree },
  { id: "timesheets", label: "Timesheets", icon: FileText },
  { id: "team-assignments", label: "Team Assignments", icon: Users },
  { id: "intelligence", label: "Workforce Intel", icon: Star },
];

const STATUS_VARIANT: Record<string, "gold" | "success" | "warning" | "danger" | "muted"> = {
  active: "success",
  inactive: "muted",
  on_leave: "warning",
  archived: "danger",
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function initials(p: Person): string {
  return `${p.firstName?.[0] ?? ""}${p.lastName?.[0] ?? ""}`.toUpperCase();
}

const PeopleManagementCenter: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("overview");
  const [searchQ, setSearchQ] = useState("");
  const [typeFilter, setTypeFilter] = useState(searchParams.get("type") ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addModal, setAddModal] = useState<AddModal>(null);
  const [selectedOnboardingId, setSelectedOnboardingId] = useState<string | null>(null);
  const [newPerson, setNewPerson] = useState({
    person_type: "employee", first_name: "", last_name: "", email: "", phone: "", organization_role: "", department_id: "",
  });
  const [newDoc, setNewDoc] = useState({ name: "", doc_type: "personnel", file_url: "" });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [newTraining, setNewTraining] = useState({ title: "", provider: "", status: "scheduled" });
  const [newCert, setNewCert] = useState({ name: "", issuer: "", expiry_date: "" });
  const [newSchedule, setNewSchedule] = useState({ title: "", schedule_date: "", start_time: "09:00", end_time: "17:00", location: "" });
  const [newPerformance, setNewPerformance] = useState({ review_date: new Date().toISOString().slice(0, 10), reviewer: "", rating: "Meets Expectations", summary: "" });
  const [newDept, setNewDept] = useState({ name: "", code: "" });
  const [newLeave, setNewLeave] = useState({ person_id: "", leave_type: "pto", start_date: "", end_date: "", reason: "" });
  const [newBgCheck, setNewBgCheck] = useState({ check_type: "criminal", provider: "", status: "pending", reference_id: "" });
  const [newSignature, setNewSignature] = useState({ document_title: "", agreement_type: "policy", signer_name: "", signature_text: "" });
  const [newIncident, setNewIncident] = useState({ person_id: "", incident_date: new Date().toISOString().slice(0, 10), incident_type: "general", severity: "low", location: "", description: "" });
  const qc = useQueryClient();

  useEffect(() => {
    const t = searchParams.get("type");
    if (t) {
      setTypeFilter(t);
      setTab("directory");
    }
    const id = searchParams.get("id");
    if (id) {
      setSelectedId(id);
      setTab("profile");
    }
    const tabParam = searchParams.get("tab") as Tab | null;
    if (tabParam && TABS.some((x) => x.id === tabParam)) {
      setTab(tabParam);
    }
  }, [searchParams]);

  const overview = useQuery({ queryKey: ["people-overview"], queryFn: peopleApi.overview });
  const departments = useQuery({ queryKey: ["people-departments"], queryFn: peopleApi.departments });
  const directory = useQuery({
    queryKey: ["people-directory", typeFilter],
    queryFn: () => peopleApi.list(typeFilter ? { type: typeFilter } : undefined),
    enabled: tab === "directory" || tab === "time-clock" || tab === "leave",
  });
  const searchResults = useQuery({
    queryKey: ["people-search", searchQ],
    queryFn: () => peopleApi.search(searchQ),
    enabled: searchQ.length >= 2,
  });
  const profile = useQuery({
    queryKey: ["people-profile", selectedId],
    queryFn: () => peopleApi.get(selectedId!),
    enabled: !!selectedId,
  });

  const createPerson = useMutation({
    mutationFn: peopleApi.create,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["people-overview"] });
      qc.invalidateQueries({ queryKey: ["people-directory"] });
      setShowAdd(false);
      setNewPerson({ person_type: "employee", first_name: "", last_name: "", email: "", phone: "", organization_role: "", department_id: "" });
      setSelectedId(data.person.id);
      setTab("profile");
    },
  });

  const clockIn = useMutation({
    mutationFn: peopleApi.clockIn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-overview"] });
      qc.invalidateQueries({ queryKey: ["people-profile", selectedId] });
    },
  });

  const clockOut = useMutation({
    mutationFn: peopleApi.clockOut,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-overview"] });
      qc.invalidateQueries({ queryKey: ["people-profile", selectedId] });
    },
  });

  const invalidateProfile = () => {
    qc.invalidateQueries({ queryKey: ["people-profile", selectedId] });
    qc.invalidateQueries({ queryKey: ["people-overview"] });
  };

  const addDocument = useMutation({
    mutationFn: async () => {
      if (docFile && selectedId) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
          reader.onerror = reject;
          reader.readAsDataURL(docFile);
        });
        return peopleApi.uploadPersonDocument(selectedId, {
          fileName: docFile.name,
          base64,
          mimeType: docFile.type,
          name: newDoc.name || docFile.name,
          doc_type: newDoc.doc_type,
        });
      }
      return peopleApi.addDocument(selectedId!, newDoc);
    },
    onSuccess: () => { invalidateProfile(); setAddModal(null); setNewDoc({ name: "", doc_type: "personnel", file_url: "" }); setDocFile(null); },
  });
  const addTraining = useMutation({
    mutationFn: () => peopleApi.addTraining(selectedId!, newTraining),
    onSuccess: () => { invalidateProfile(); setAddModal(null); setNewTraining({ title: "", provider: "", status: "scheduled" }); },
  });
  const addCertification = useMutation({
    mutationFn: () => peopleApi.addCertification(selectedId!, newCert),
    onSuccess: () => { invalidateProfile(); setAddModal(null); setNewCert({ name: "", issuer: "", expiry_date: "" }); },
  });
  const addSchedule = useMutation({
    mutationFn: () => peopleApi.addSchedule(selectedId!, newSchedule),
    onSuccess: () => { invalidateProfile(); setAddModal(null); setNewSchedule({ title: "", schedule_date: "", start_time: "09:00", end_time: "17:00", location: "" }); },
  });
  const addPerformance = useMutation({
    mutationFn: () => peopleApi.addPerformance(selectedId!, newPerformance),
    onSuccess: () => { invalidateProfile(); setAddModal(null); setNewPerformance({ review_date: new Date().toISOString().slice(0, 10), reviewer: "", rating: "Meets Expectations", summary: "" }); },
  });
  const createDepartment = useMutation({
    mutationFn: () => peopleApi.createDepartment(newDept),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["people-departments"] }); qc.invalidateQueries({ queryKey: ["people-overview"] }); setAddModal(null); setNewDept({ name: "", code: "" }); },
  });
  const leaveList = useQuery({ queryKey: ["people-leave"], queryFn: () => peopleApi.leaveRequests(), enabled: tab === "leave" || tab === "overview" });
  const createLeave = useMutation({
    mutationFn: () => peopleApi.createLeaveRequest(newLeave),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["people-leave"] }); qc.invalidateQueries({ queryKey: ["people-overview"] }); setAddModal(null); setNewLeave({ person_id: "", leave_type: "pto", start_date: "", end_date: "", reason: "" }); },
  });
  const reviewLeave = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => peopleApi.reviewLeaveRequest(id, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["people-leave"] }); qc.invalidateQueries({ queryKey: ["people-overview"] }); qc.invalidateQueries({ queryKey: ["people-profile", selectedId] }); },
  });
  const addBgCheck = useMutation({
    mutationFn: () => peopleApi.addBackgroundCheck(selectedId!, newBgCheck),
    onSuccess: () => { invalidateProfile(); setAddModal(null); setNewBgCheck({ check_type: "criminal", provider: "", status: "pending", reference_id: "" }); },
  });
  const addSignature = useMutation({
    mutationFn: () => peopleApi.addSignature(selectedId!, newSignature),
    onSuccess: () => { invalidateProfile(); setAddModal(null); setNewSignature({ document_title: "", agreement_type: "policy", signer_name: "", signature_text: "" }); },
  });
  const volunteerStats = useQuery({ queryKey: ["people-volunteer-stats"], queryFn: analyticsApi.people, enabled: tab === "volunteers" || tab === "overview" });
  const volunteers = useQuery({ queryKey: ["people-volunteers"], queryFn: () => peopleApi.list({ type: "volunteer" }), enabled: tab === "volunteers" });
  const onboardingList = useQuery({ queryKey: ["people-onboarding"], queryFn: () => peopleApi.onboarding(), enabled: tab === "onboarding" || tab === "overview" });
  const orgSchedules = useQuery({ queryKey: ["people-org-schedules"], queryFn: () => peopleApi.orgSchedules(), enabled: tab === "scheduling" || tab === "overview" });
  const orgPerformance = useQuery({ queryKey: ["people-org-performance"], queryFn: peopleApi.orgPerformanceReviews, enabled: tab === "performance" });
  const timeClockSummary = useQuery({ queryKey: ["people-time-clock-summary"], queryFn: peopleApi.timeClockSummary, enabled: tab === "time-clock" || tab === "overview" });
  const incidents = useQuery({ queryKey: ["people-incidents"], queryFn: () => peopleApi.incidents(), enabled: tab === "incidents" || tab === "overview" });
  const orgCertifications = useQuery({ queryKey: ["people-certifications"], queryFn: () => peopleApi.certifications(60), enabled: tab === "certifications" || tab === "overview" });
  const createIncident = useMutation({
    mutationFn: () => peopleApi.createIncident({ ...newIncident, person_id: newIncident.person_id || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-incidents"] });
      qc.invalidateQueries({ queryKey: ["people-overview"] });
      setAddModal(null);
      setNewIncident({ person_id: "", incident_date: new Date().toISOString().slice(0, 10), incident_type: "general", severity: "low", location: "", description: "" });
    },
  });
  const resolveIncident = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string }) => peopleApi.updateIncident(id, { status: "resolved", resolution }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["people-incidents"] }); qc.invalidateQueries({ queryKey: ["people-overview"] }); },
  });
  const onboardingDetail = useQuery({
    queryKey: ["people-onboarding-detail", selectedOnboardingId],
    queryFn: () => peopleApi.personOnboarding(selectedOnboardingId!),
    enabled: !!selectedOnboardingId && tab === "onboarding",
  });
  const seedOnboarding = useMutation({
    mutationFn: (personId: string) => peopleApi.seedOnboarding(personId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["people-onboarding"] }); qc.invalidateQueries({ queryKey: ["people-onboarding-detail", selectedOnboardingId] }); },
  });
  const updateOnboarding = useMutation({
    mutationFn: ({ personId, itemId, completed }: { personId: string; itemId: string; completed: boolean }) =>
      peopleApi.updateOnboardingItem(personId, itemId, { completed }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-onboarding"] });
      qc.invalidateQueries({ queryKey: ["people-onboarding-detail", selectedOnboardingId] });
      qc.invalidateQueries({ queryKey: ["people-overview"] });
      qc.invalidateQueries({ queryKey: ["hq-approval-tasks"] });
    },
  });

  const panelAddBtn = (modal: AddModal) => (
    <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => setAddModal(modal)}>
      <Plus size={14} /> Add
    </button>
  );

  const openProfile = (id: string) => {
    setSelectedId(id);
    setTab("profile");
  };

  const navigateTab = (next: string) => {
    const t = next as Tab;
    if (TABS.some((x) => x.id === t) || t === "profile") {
      setTab(t);
      setSearchParams({ tab: t });
    }
  };

  const personTypes = overview.data?.personTypes ?? [];
  const people = searchQ.length >= 2
    ? (searchResults.data?.people ?? [])
    : (directory.data?.people ?? []);

  return (
    <HQLayout
      title="People Management Center"
      subtitle="Master people database for the entire IFCDC ecosystem — employees, volunteers, board, contractors, mentors, participants, barbers, clients, donors, and grant managers"
    >
      <div className="hq-people-toolbar">
        <div className="hq-search-bar">
          <Search size={18} />
          <input
            type="search"
            placeholder="Global search — name, email, phone, role…"
            value={searchQ}
            onChange={(e) => {
              setSearchQ(e.target.value);
              if (e.target.value.length >= 2) setTab("directory");
            }}
          />
        </div>
        <button type="button" className="hq-btn hq-btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Add Person
        </button>
      </div>

      <nav className="hq-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`hq-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
        {selectedId && (
          <button type="button" className={`hq-tab ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>
            <UserCircle size={16} /> Profile
          </button>
        )}
      </nav>

      <div className="hq-tab-content hq-fade-in">
        {tab === "overview" && (
          <>
            <PeoplePhase3CommandCenter onNavigateTab={navigateTab} />
            <div style={{ marginTop: "1.25rem" }}>
            {overview.isLoading ? <HqLoading /> : overview.data && (
              <>
                <div className="hq-kpi-grid">
                  <KpiCard label="Total People" value={overview.data.total} variant="gold" />
                  <KpiCard label="Active" value={overview.data.active} variant="success" />
                  <KpiCard label="Departments" value={overview.data.departments} />
                  <KpiCard label="Clocked In Now" value={overview.data.clockedIn} variant={overview.data.clockedIn > 0 ? "warning" : "muted"} />
                  <KpiCard label="Pending Leave" value={overview.data.pendingLeave ?? 0} variant={(overview.data.pendingLeave ?? 0) > 0 ? "warning" : "muted"} />
                  <KpiCard label="Open Incidents" value={overview.data.openIncidents ?? 0} variant={(overview.data.openIncidents ?? 0) > 0 ? "danger" : "success"} />
                  <KpiCard label="Shifts This Week" value={overview.data.upcomingShifts ?? 0} />
                  <KpiCard label="Hours This Month" value={timeClockSummary.data?.hoursThisMonth ?? "—"} meta="Time clock" />
                  <KpiCard label="In Onboarding" value={overview.data.pendingOnboarding ?? 0} variant={(overview.data.pendingOnboarding ?? 0) > 0 ? "gold" : "muted"} />
                </div>
                <div className="hq-grid-2">
                  <HqPanel title="People by Type">
                    <ul className="hq-activity-list">
                      {(overview.data.byType ?? []).map((t) => (
                        <li key={t.person_type} className="hq-activity-item hq-clickable" onClick={() => {
                          setTypeFilter(t.person_type);
                          setSearchParams({ type: t.person_type });
                          setTab("directory");
                        }}>
                          <div className="hq-activity-content">
                            <div className="hq-activity-title">
                              {personTypes.find((pt) => pt.id === t.person_type)?.label ?? t.person_type}
                            </div>
                          </div>
                          <div className="hq-activity-time">{t.count}</div>
                        </li>
                      ))}
                    </ul>
                  </HqPanel>
                  <HqPanel title="HR Quick Actions" subtitle="Employees, volunteers, scheduling & time">
                    <div className="hq-quick-actions">
                      <button type="button" className="hq-quick-action" onClick={() => { setShowAdd(true); }}>
                        <Plus size={16} /> Add Employee
                      </button>
                      <button type="button" className="hq-quick-action" onClick={() => { setTypeFilter("volunteer"); setSearchParams({ type: "volunteer" }); setTab("directory"); }}>
                        <Users size={16} /> View Volunteers
                      </button>
                      <button type="button" className="hq-quick-action" onClick={() => setTab("scheduling")}>
                        <CalendarDays size={16} /> Scheduling
                      </button>
                      <button type="button" className="hq-quick-action" onClick={() => setTab("performance")}>
                        <Star size={16} /> Performance Reviews
                      </button>
                      <button type="button" className="hq-quick-action" onClick={() => { setAddModal("incident"); setTab("incidents"); }}>
                        <AlertTriangle size={16} /> Report Incident
                      </button>
                      <button type="button" className="hq-quick-action" onClick={() => setTab("time-clock")}>
                        <Clock size={16} /> Time Clock
                      </button>
                      <button type="button" className="hq-quick-action" onClick={() => setTab("org-chart")}>
                        <Network size={16} /> Org Chart
                      </button>
                      <button type="button" className="hq-quick-action" onClick={() => setTab("onboarding")}>
                        <ClipboardCheck size={16} /> Employee Onboarding
                      </button>
                    </div>
                  </HqPanel>
                </div>
                <HqPanel title="Ecosystem Integration" subtitle="Single people database for all IFCDC apps">
                  <p className="hq-muted-text" style={{ marginBottom: "0.75rem" }}>
                    All IFCDC applications authenticate through Headquarters and use this people database as the single source of truth.
                  </p>
                  <ul className="hq-feature-list">
                    <li>Enterprise roles — permissions linked per profile</li>
                    <li>Personnel files — documents, training, certifications on every profile</li>
                    <li>Time clock — clock in/out tracked per person with payroll integration</li>
                    <li>AURA AI — people context for executive insights</li>
                  </ul>
                </HqPanel>
              </>
            )}
            </div>
          </>
        )}

        {tab === "employees" && (
          <PeopleModuleDirectory title="Employee Directory" subtitle="Active IFCDC staff and program employees" personType="employee" onSelectPerson={openProfile} />
        )}

        {tab === "board" && (
          <PeopleModuleDirectory title="Board of Directors" subtitle="Governance leadership and board members" personType="board_member" onSelectPerson={openProfile} />
        )}

        {tab === "contractors" && (
          <PeopleModuleDirectory title="Contractors & Consultants" subtitle="External workforce and professional services" personType="contractor" onSelectPerson={openProfile} />
        )}

        {tab === "applicants" && <PeopleJobApplicantsPanel />}

        {tab === "personnel-files" && <PeoplePersonnelFilesPanel />}

        {tab === "roles" && <PeopleRolesPermissionsPanel />}

        {tab === "org-structure" && <PeopleOrgStructurePanel />}

        {tab === "directory" && (
          <HqPanel title="People Directory">
            <div className="hq-filter-row">
              <select value={typeFilter} onChange={(e) => {
                setTypeFilter(e.target.value);
                if (e.target.value) setSearchParams({ type: e.target.value });
                else setSearchParams({});
              }}>
                <option value="">All types</option>
                {personTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            {directory.isLoading && searchQ.length < 2 ? <HqLoading /> : (
              <table className="hq-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id} className="hq-clickable" onClick={() => openProfile(p.id)}>
                      <td>
                        <div className="hq-person-cell">
                          <div className="hq-avatar">{initials(p)}</div>
                          <div>
                            <div className="hq-person-name">{p.fullName}</div>
                            <div className="hq-person-email">{p.email ?? "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td><StatusBadge label={p.personTypeLabel} variant="gold" /></td>
                      <td>{p.organizationRole ?? "—"}</td>
                      <td>{p.departmentName ?? "—"}</td>
                      <td><StatusBadge label={p.status} variant={STATUS_VARIANT[p.status] ?? "muted"} /></td>
                      <td>{p.sourceApp}</td>
                    </tr>
                  ))}
                  {!people.length && (
                    <tr><td colSpan={6} className="hq-empty-cell">No people found. Add a person or adjust filters.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </HqPanel>
        )}

        {tab === "volunteers" && (
          <>
            <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
              <KpiCard label="Active Volunteers" value={volunteerStats.data?.volunteerCount ?? overview.data?.byType?.find((t) => t.person_type === "volunteer")?.count ?? "—"} icon={HandHeart} variant="gold" />
              <KpiCard label="Hours This Month" value={volunteerStats.data?.volunteerHours ?? "—"} icon={Clock} meta="From time clock" />
              <KpiCard label="Programs Served" value={volunteerStats.data?.byType?.reduce((s, t) => s + t.count, 0) ?? "—"} icon={Users} />
            </div>
            <HqPanel title="Volunteer Directory" subtitle="Community volunteers — files, hours, and assignments">
              {volunteers.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Status</th><th>Payroll</th></tr></thead>
                  <tbody>
                    {(volunteers.data?.people ?? []).map((p) => (
                      <tr key={p.id} className="hq-clickable" onClick={() => openProfile(p.id)}>
                        <td>{p.fullName}</td>
                        <td>{p.organizationRole ?? "Volunteer"}</td>
                        <td>{p.departmentName ?? "—"}</td>
                        <td><StatusBadge label={p.status} variant={STATUS_VARIANT[p.status] ?? "muted"} /></td>
                        <td>{p.payrollStatus ?? "—"}</td>
                      </tr>
                    ))}
                    {!volunteers.data?.people?.length && (
                      <tr><td colSpan={5} className="hq-empty-cell">No volunteers yet — add people with type Volunteer in the directory</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
        )}

        {tab === "profile" && selectedId && (
          profile.isLoading ? <HqLoading /> : profile.data && (
            <div className="hq-profile-layout">
              <div className="hq-profile-header">
                <div className="hq-avatar hq-avatar-lg">
                  {profile.data.person.profilePhotoUrl
                    ? <img src={profile.data.person.profilePhotoUrl} alt="" />
                    : initials(profile.data.person)}
                </div>
                <div className="hq-profile-info">
                  <h2>{profile.data.person.fullName}</h2>
                  <div className="hq-profile-badges">
                    <StatusBadge label={profile.data.person.personTypeLabel} variant="gold" />
                    <StatusBadge label={profile.data.person.status} variant={STATUS_VARIANT[profile.data.person.status] ?? "muted"} />
                    {profile.data.person.payrollStatus && (
                      <StatusBadge label={`Payroll: ${profile.data.person.payrollStatus}`} variant="success" />
                    )}
                  </div>
                  <div className="hq-profile-meta">
                    {profile.data.person.email && <span><Mail size={14} /> {profile.data.person.email}</span>}
                    {profile.data.person.phone && <span><Phone size={14} /> {profile.data.person.phone}</span>}
                    {profile.data.person.location && <span><MapPin size={14} /> {profile.data.person.location}</span>}
                    {profile.data.person.organizationRole && <span><Briefcase size={14} /> {profile.data.person.organizationRole}</span>}
                  </div>
                </div>
                <div className="hq-profile-actions">
                  <button type="button" className="hq-btn hq-btn-secondary" disabled={clockIn.isPending} onClick={() => clockIn.mutate(selectedId)}>
                    <Clock size={14} /> Clock In
                  </button>
                  <button type="button" className="hq-btn hq-btn-secondary" disabled={clockOut.isPending} onClick={() => clockOut.mutate(selectedId)}>
                    Clock Out
                  </button>
                </div>
              </div>

              <PeopleProfileEditPanel person={profile.data.person} personId={selectedId} />

              <div className="hq-grid-2">
                <HqPanel title="Contact & Role">
                  <dl className="hq-dl">
                    <dt>Department</dt><dd>{profile.data.person.departmentName ?? "—"}</dd>
                    <dt>Enterprise Role</dt><dd>{profile.data.person.enterpriseRole ?? "—"}</dd>
                    <dt>Start Date</dt><dd>{fmtDate(profile.data.person.startDate)}</dd>
                    <dt>Source App</dt><dd>{profile.data.person.sourceApp}</dd>
                    {profile.data.person.linkedExternalId && (
                      <><dt>External ID</dt><dd>{profile.data.person.linkedExternalId}</dd></>
                    )}
                  </dl>
                  {profile.data.person.notes && (
                    <p className="hq-notes-block">{profile.data.person.notes}</p>
                  )}
                </HqPanel>

                <HqPanel title="Recent Activity">
                  <ul className="hq-activity-list">
                    {profile.data.activity.map((a) => (
                      <li key={a.id} className="hq-activity-item">
                        <div className="hq-activity-content">
                          <div className="hq-activity-title">{a.action}</div>
                          <div className="hq-activity-detail">{a.detail}</div>
                        </div>
                        <div className="hq-activity-time">{fmtDate(a.created_at)}</div>
                      </li>
                    ))}
                    {!profile.data.activity.length && <li className="hq-empty-cell">No activity yet</li>}
                  </ul>
                </HqPanel>
              </div>

              <div className="hq-grid-3">
                <HqPanel title="Documents" headerExtra={panelAddBtn("document")}>
                  <ul className="hq-mini-list">
                    {profile.data.documents.map((d) => (
                      <li key={d.id}>
                        {d.file_url ? (
                          <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="hq-entity-link">{d.name}</a>
                        ) : d.name}
                        <span className="hq-muted-text"> ({d.doc_type})</span>
                      </li>
                    ))}
                    {!profile.data.documents.length && <li className="hq-muted-text">No documents — click Add to upload a personnel file</li>}
                  </ul>
                </HqPanel>
                <HqPanel title="Training" headerExtra={panelAddBtn("training")}>
                  <ul className="hq-mini-list">
                    {profile.data.training.map((t) => (
                      <li key={t.id}>{t.title} — <StatusBadge label={t.status} variant="muted" /></li>
                    ))}
                    {!profile.data.training.length && <li className="hq-muted-text">No training records</li>}
                  </ul>
                </HqPanel>
                <HqPanel title="Certifications" headerExtra={panelAddBtn("certification")}>
                  <ul className="hq-mini-list">
                    {profile.data.certifications.map((c) => (
                      <li key={c.id}>{c.name}{c.expiry_date ? ` (exp. ${fmtDate(c.expiry_date)})` : ""}</li>
                    ))}
                    {!profile.data.certifications.length && <li className="hq-muted-text">No certifications</li>}
                  </ul>
                </HqPanel>
              </div>

              <div className="hq-grid-2">
                <HqPanel title="Schedule" headerExtra={panelAddBtn("schedule")}>
                  <ul className="hq-activity-list">
                    {profile.data.schedules.map((s) => (
                      <li key={s.id} className="hq-activity-item">
                        <div className="hq-activity-content">
                          <div className="hq-activity-title">{s.title}</div>
                          <div className="hq-activity-detail">{s.start_time && s.end_time ? `${s.start_time} – ${s.end_time}` : ""}</div>
                        </div>
                        <div className="hq-activity-time">{fmtDate(s.schedule_date)}</div>
                      </li>
                    ))}
                    {!profile.data.schedules.length && <li className="hq-empty-cell">No scheduled items</li>}
                  </ul>
                </HqPanel>
                <HqPanel title="Performance History" headerExtra={panelAddBtn("performance")}>
                  <ul className="hq-activity-list">
                    {profile.data.performance.map((p) => (
                      <li key={p.id} className="hq-activity-item">
                        <div className="hq-activity-content">
                          <div className="hq-activity-title">{p.reviewer || "Review"} — {p.rating || "—"}</div>
                          <div className="hq-activity-detail">{p.summary}</div>
                        </div>
                        <div className="hq-activity-time">{fmtDate(p.review_date)}</div>
                      </li>
                    ))}
                    {!profile.data.performance.length && <li className="hq-empty-cell">No performance reviews</li>}
                  </ul>
                </HqPanel>
              </div>

              <HqPanel title="Time Clock">
                <table className="hq-table">
                  <thead><tr><th>Clock In</th><th>Clock Out</th><th>Hours</th></tr></thead>
                  <tbody>
                    {profile.data.timeEntries.map((e) => (
                      <tr key={e.id}>
                        <td>{fmtDate(e.clock_in)} {new Date(e.clock_in).toLocaleTimeString()}</td>
                        <td>{e.clock_out ? `${fmtDate(e.clock_out)} ${new Date(e.clock_out).toLocaleTimeString()}` : "—"}</td>
                        <td>{e.hours ?? "—"}</td>
                      </tr>
                    ))}
                    {!profile.data.timeEntries.length && (
                      <tr><td colSpan={3} className="hq-empty-cell">No time entries</td></tr>
                    )}
                  </tbody>
                </table>
              </HqPanel>

              <HqPanel title="Background Checks" headerExtra={panelAddBtn("background")}>
                <ul className="hq-mini-list">
                  {((profile.data as { backgroundChecks?: { id: string; check_type: string; status: string; provider: string; result: string; expiry_date: string | null }[] }).backgroundChecks ?? []).map((b) => (
                    <li key={b.id}>
                      <ShieldCheck size={14} style={{ display: "inline", marginRight: "0.35rem" }} />
                      {b.check_type} — <StatusBadge label={b.status} variant={b.status === "cleared" ? "success" : b.status === "pending" ? "warning" : "muted"} />
                      {b.expiry_date ? ` · exp. ${fmtDate(b.expiry_date)}` : ""}
                    </li>
                  ))}
                  {!((profile.data as { backgroundChecks?: unknown[] }).backgroundChecks ?? []).length && (
                    <li className="hq-muted-text">No background checks on file</li>
                  )}
                </ul>
              </HqPanel>

              <HqPanel title="Digital Signatures" headerExtra={panelAddBtn("signature")}>
                <ul className="hq-mini-list">
                  {((profile.data as { signatures?: { id: string; document_title: string; agreement_type: string; signer_name: string; signed_at: string }[] }).signatures ?? []).map((s) => (
                    <li key={s.id}>
                      <PenLine size={14} style={{ display: "inline", marginRight: "0.35rem" }} />
                      {s.document_title} — signed by {s.signer_name} on {fmtDate(s.signed_at)}
                    </li>
                  ))}
                  {!((profile.data as { signatures?: unknown[] }).signatures ?? []).length && (
                    <li className="hq-muted-text">No signed agreements on file</li>
                  )}
                </ul>
              </HqPanel>
            </div>
          )
        )}

        {tab === "departments" && (
          departments.isLoading ? <HqLoading /> : (
            <HqPanel
              title="Departments"
              headerExtra={
                <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => setAddModal("department")}>
                  <Plus size={14} /> Add Department
                </button>
              }
            >
              <table className="hq-table">
                <thead><tr><th>Department</th><th>Code</th><th>Active Members</th></tr></thead>
                <tbody>
                  {(departments.data?.departments ?? []).map((d) => (
                    <tr key={d.id} className="hq-clickable" onClick={() => {
                      setTypeFilter("");
                      setSearchParams({});
                      setTab("directory");
                    }}>
                      <td>{d.name}</td>
                      <td>{d.code}</td>
                      <td>{d.member_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </HqPanel>
          )
        )}

        {tab === "org-chart" && <PeopleOrgChartPanel />}

        {tab === "timesheets" && <PeopleTimesheetsPanel />}

        {tab === "team-assignments" && <PeopleTeamAssignmentsPanel />}

        {tab === "intelligence" && (
          <>
            <PeopleV3WorkforceIntelligenceDashboard />
            <div style={{ marginTop: "1.25rem" }}>
              <PeopleV3AuraWorkforcePanel />
            </div>
          </>
        )}

        {tab === "leave" && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
              <button type="button" className="hq-btn hq-btn-primary" onClick={() => setAddModal("leave")}>
                <Plus size={16} /> Request Leave
              </button>
            </div>
            {leaveList.isLoading ? <HqLoading /> : (
              <HqPanel title="Leave Requests" subtitle="PTO, sick leave, and time-off approvals">
                <table className="hq-table">
                  <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {(leaveList.data?.leaveRequests ?? []).map((lr) => (
                      <tr key={lr.id}>
                        <td>{lr.first_name} {lr.last_name}</td>
                        <td>{lr.leave_type}</td>
                        <td>{fmtDate(lr.start_date)} – {fmtDate(lr.end_date)}</td>
                        <td><StatusBadge label={lr.status} variant={lr.status === "approved" ? "success" : lr.status === "pending" ? "warning" : "muted"} /></td>
                        <td>
                          {lr.status === "pending" && (
                            <>
                              <button type="button" className="hq-btn hq-btn-sm" onClick={() => reviewLeave.mutate({ id: lr.id, status: "approved" })}>Approve</button>
                              <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" style={{ marginLeft: "0.35rem" }} onClick={() => reviewLeave.mutate({ id: lr.id, status: "denied" })}>Deny</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!leaveList.data?.leaveRequests?.length && (
                      <tr><td colSpan={5} className="hq-empty-cell">No leave requests</td></tr>
                    )}
                  </tbody>
                </table>
              </HqPanel>
            )}
          </>
        )}

        {tab === "onboarding" && (
          <div className="hq-grid-main-side">
            <HqPanel title="Employee Onboarding" subtitle="Track checklist progress for new hires">
              {onboardingList.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Employee</th><th>Type</th><th>Start</th><th>Progress</th></tr></thead>
                  <tbody>
                    {(onboardingList.data?.onboarding ?? []).map((o) => (
                      <tr key={o.personId} className={`hq-clickable ${selectedOnboardingId === o.personId ? "active" : ""}`}
                        onClick={() => setSelectedOnboardingId(o.personId)}>
                        <td>{o.firstName} {o.lastName}</td>
                        <td>{o.personType}</td>
                        <td>{fmtDate(o.startDate)}</td>
                        <td>
                          <StatusBadge
                            label={`${o.completedCount}/${o.totalCount}`}
                            variant={o.completedCount === o.totalCount ? "success" : "warning"}
                          />
                        </td>
                      </tr>
                    ))}
                    {!onboardingList.data?.onboarding?.length && (
                      <tr><td colSpan={4} className="hq-empty-cell">No active onboarding — add employees to start checklists automatically</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </HqPanel>
            <div>
              {selectedOnboardingId ? (
                onboardingDetail.isLoading ? <HqLoading /> : onboardingDetail.data && (
                  <HqPanel
                    title="Onboarding Checklist"
                    subtitle={`${onboardingDetail.data.completedCount} of ${onboardingDetail.data.totalCount} complete`}
                    headerExtra={
                      !onboardingDetail.data.items.length ? (
                        <button type="button" className="hq-btn hq-btn-sm hq-btn-primary"
                          onClick={() => seedOnboarding.mutate(selectedOnboardingId)}>
                          Initialize Checklist
                        </button>
                      ) : undefined
                    }
                  >
                    <ul className="hq-activity-list">
                      {onboardingDetail.data.items.map((item) => (
                        <li key={item.id} className="hq-activity-item" style={{ alignItems: "center" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={item.completed === 1}
                              onChange={(e) => updateOnboarding.mutate({
                                personId: selectedOnboardingId,
                                itemId: item.id,
                                completed: e.target.checked,
                              })}
                            />
                            <span style={{ textDecoration: item.completed === 1 ? "line-through" : "none", opacity: item.completed === 1 ? 0.7 : 1 }}>
                              {item.task_label}
                            </span>
                          </label>
                          {item.completed_at && (
                            <span style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>
                              {new Date(item.completed_at).toLocaleDateString()}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </HqPanel>
                )
              ) : (
                <HqPanel title="Select an employee" subtitle="Choose someone from the list to manage their onboarding checklist">
                  <p className="hq-muted-text">New employees, volunteers, and contractors receive an 8-step checklist automatically when added to the directory.</p>
                </HqPanel>
              )}
            </div>
          </div>
        )}

        {tab === "certifications" && (
          <>
            <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
              <KpiCard label="Total Certifications" value={orgCertifications.data?.summary.total ?? 0} icon={Award} />
              <KpiCard label="Expiring (60d)" value={orgCertifications.data?.summary.expiring ?? 0} variant="warning" />
              <KpiCard label="Expired" value={orgCertifications.data?.summary.expired ?? 0} variant={(orgCertifications.data?.summary.expired ?? 0) > 0 ? "danger" : "success"} />
            </div>
            <HqPanel title="Organization Certifications" subtitle="Track credentials, licenses, and training certifications across all personnel">
              {orgCertifications.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Person</th><th>Certification</th><th>Issuer</th><th>Expires</th><th>Status</th></tr></thead>
                  <tbody>
                    {(orgCertifications.data?.certifications ?? []).map((c) => (
                      <tr key={c.id}>
                        <td>
                          <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => { setSelectedId(c.person_id); setTab("profile"); }}>
                            {c.first_name} {c.last_name}
                          </button>
                        </td>
                        <td>{c.name}</td>
                        <td>{c.issuer || "—"}</td>
                        <td>{fmtDate(c.expiry_date)}</td>
                        <td>
                          <StatusBadge
                            label={c.alert === "expired" ? "Expired" : c.alert === "expiring" ? "Expiring Soon" : c.alert === "valid" ? "Valid" : "No Expiry"}
                            variant={c.alert === "expired" ? "danger" : c.alert === "expiring" ? "warning" : "success"}
                          />
                        </td>
                      </tr>
                    ))}
                    {!(orgCertifications.data?.certifications ?? []).length && (
                      <tr><td colSpan={5} className="hq-muted-text">No certifications on file — add them from individual personnel profiles.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
        )}

        {tab === "time-clock" && (
          <>
            <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
              <KpiCard label="Currently Clocked In" value={timeClockSummary.data?.active.length ?? overview.data?.clockedIn ?? 0} variant="warning" />
              <KpiCard label="Hours This Month" value={timeClockSummary.data?.hoursThisMonth ?? "—"} />
              <KpiCard label="Recent Entries" value={timeClockSummary.data?.recent.length ?? 0} meta="Last 50 shifts" />
            </div>
            {(timeClockSummary.data?.active ?? []).length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
              <HqPanel title="Active Shifts" subtitle="Currently clocked in">
                <ul className="hq-activity-list">
                  {timeClockSummary.data!.active.map((a) => (
                    <li key={a.id} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{a.first_name} {a.last_name}</div>
                        <div className="hq-activity-detail">{a.department_name ?? a.person_type} · since {new Date(a.clock_in).toLocaleTimeString()}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </HqPanel>
              </div>
            )}
          <HqPanel title="Workforce Time Clock" subtitle="Clock in/out for employees, volunteers, and contractors">
            {overview.data && overview.data.clockedIn > 0 && (
              <p style={{ marginBottom: "1rem", fontSize: "0.85rem", color: "var(--hq-warning)" }}>
                {overview.data.clockedIn} person{overview.data.clockedIn !== 1 ? "s" : ""} currently clocked in
              </p>
            )}
            <table className="hq-table">
              <thead><tr><th>Name</th><th>Type</th><th>Department</th><th>Actions</th></tr></thead>
              <tbody>
                {(directory.data?.people ?? []).filter((p) => ["employee", "volunteer", "contractor", "barber"].includes(p.personType)).map((p) => (
                  <tr key={p.id}>
                    <td>{p.fullName}</td>
                    <td>{p.personTypeLabel}</td>
                    <td>{p.departmentName ?? "—"}</td>
                    <td>
                      <button type="button" className="hq-btn hq-btn-sm" onClick={() => clockIn.mutate(p.id)}>In</button>
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" style={{ marginLeft: "0.5rem" }} onClick={() => clockOut.mutate(p.id)}>Out</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HqPanel>
          </>
        )}

        {tab === "scheduling" && (
          <HqPanel title="Organization Schedule" subtitle="Upcoming shifts and assignments across all departments" headerExtra={
            <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => { if (selectedId) setAddModal("schedule"); else setTab("directory"); }}>
              <Plus size={14} /> Add Shift
            </button>
          }>
            {orgSchedules.isLoading ? <HqLoading /> : (
              <table className="hq-table">
                <thead><tr><th>Date</th><th>Person</th><th>Shift</th><th>Time</th><th>Location</th><th>Dept</th></tr></thead>
                <tbody>
                  {(orgSchedules.data?.schedules ?? []).map((s) => (
                    <tr key={s.id} className="hq-clickable" onClick={() => openProfile(s.person_id)}>
                      <td>{fmtDate(s.schedule_date)}</td>
                      <td>{s.first_name} {s.last_name}</td>
                      <td>{s.title}</td>
                      <td>{s.start_time ?? "—"} – {s.end_time ?? "—"}</td>
                      <td>{s.location ?? "—"}</td>
                      <td>{s.department_name ?? "—"}</td>
                    </tr>
                  ))}
                  {!orgSchedules.data?.schedules?.length && (
                    <tr><td colSpan={6} className="hq-empty-cell">No scheduled shifts — add shifts from a person profile or select someone in the directory</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </HqPanel>
        )}

        {tab === "performance" && (
          <HqPanel title="Performance Reviews" subtitle="Organization-wide review history and ratings">
            {orgPerformance.isLoading ? <HqLoading /> : (
              <table className="hq-table">
                <thead><tr><th>Date</th><th>Employee</th><th>Role</th><th>Reviewer</th><th>Rating</th><th>Summary</th></tr></thead>
                <tbody>
                  {(orgPerformance.data?.reviews ?? []).map((r) => (
                    <tr key={r.id} className="hq-clickable" onClick={() => openProfile(r.person_id)}>
                      <td>{fmtDate(r.review_date)}</td>
                      <td>{r.first_name} {r.last_name}</td>
                      <td>{r.organization_role ?? r.person_type}</td>
                      <td>{r.reviewer || "—"}</td>
                      <td><StatusBadge label={r.rating} variant={r.rating.includes("Exceeds") ? "success" : r.rating.includes("Below") ? "danger" : "gold"} /></td>
                      <td style={{ maxWidth: 280 }}>{r.summary?.slice(0, 80) || "—"}</td>
                    </tr>
                  ))}
                  {!orgPerformance.data?.reviews?.length && (
                    <tr><td colSpan={6} className="hq-empty-cell">No performance reviews yet — add reviews from employee profiles</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </HqPanel>
        )}

        {tab === "incidents" && (
          <HqPanel title="Incident Reporting" subtitle="Safety, conduct, and workplace incident log" headerExtra={
            <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => setAddModal("incident")}>
              <Plus size={14} /> Report Incident
            </button>
          }>
            {incidents.isLoading ? <HqLoading /> : (
              <table className="hq-table">
                <thead><tr><th>Date</th><th>Type</th><th>Severity</th><th>Person</th><th>Description</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {(incidents.data?.incidents ?? []).map((i) => (
                    <tr key={i.id}>
                      <td>{fmtDate(i.incident_date)}</td>
                      <td>{i.incident_type}</td>
                      <td><StatusBadge label={i.severity} variant={i.severity === "high" ? "danger" : i.severity === "medium" ? "warning" : "muted"} /></td>
                      <td>{i.first_name ? `${i.first_name} ${i.last_name}` : "—"}</td>
                      <td style={{ maxWidth: 240 }}>{i.description.slice(0, 100)}</td>
                      <td><StatusBadge label={i.status} variant={i.status === "resolved" ? "success" : "warning"} /></td>
                      <td>
                        {i.status !== "resolved" && (
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => resolveIncident.mutate({ id: i.id, resolution: "Reviewed and closed by HR" })}>
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!incidents.data?.incidents?.length && (
                    <tr><td colSpan={7} className="hq-empty-cell">No incidents reported</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </HqPanel>
        )}
      </div>

      {showAdd && (
        <div className="hq-modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="hq-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Person</h3>
            <div className="hq-form-grid">
              <label>
                Type
                <select value={newPerson.person_type} onChange={(e) => setNewPerson({ ...newPerson, person_type: e.target.value })}>
                  {personTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              <label>First Name<input value={newPerson.first_name} onChange={(e) => setNewPerson({ ...newPerson, first_name: e.target.value })} /></label>
              <label>Last Name<input value={newPerson.last_name} onChange={(e) => setNewPerson({ ...newPerson, last_name: e.target.value })} /></label>
              <label>Email<input type="email" value={newPerson.email} onChange={(e) => setNewPerson({ ...newPerson, email: e.target.value })} /></label>
              <label>Phone<input value={newPerson.phone} onChange={(e) => setNewPerson({ ...newPerson, phone: e.target.value })} /></label>
              <label>Organization Role<input value={newPerson.organization_role} onChange={(e) => setNewPerson({ ...newPerson, organization_role: e.target.value })} /></label>
              <label>
                Department
                <select value={newPerson.department_id} onChange={(e) => setNewPerson({ ...newPerson, department_id: e.target.value })}>
                  <option value="">—</option>
                  {(departments.data?.departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="hq-modal-actions">
              <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button
                type="button"
                className="hq-btn hq-btn-primary"
                disabled={!newPerson.first_name || !newPerson.last_name || createPerson.isPending}
                onClick={() => createPerson.mutate(newPerson)}
              >
                {createPerson.isPending ? "Saving…" : "Add Person"}
              </button>
            </div>
          </div>
        </div>
      )}

      {addModal && (
        <div className="hq-modal-overlay" onClick={() => setAddModal(null)}>
          <div className="hq-modal" onClick={(e) => e.stopPropagation()}>
            {addModal === "document" && (
              <>
                <h3><FileText size={18} /> Add Personnel Document</h3>
                <div className="hq-form-grid">
                  <label>Document Name<input value={newDoc.name} onChange={(e) => setNewDoc({ ...newDoc, name: e.target.value })} placeholder="I-9, W-4, Offer Letter…" /></label>
                  <label>Type
                    <select value={newDoc.doc_type} onChange={(e) => setNewDoc({ ...newDoc, doc_type: e.target.value })}>
                      <option value="personnel">Personnel File</option>
                      <option value="contract">Contract</option>
                      <option value="id">ID / Certification</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>Upload File<input type="file" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} /></label>
                  <label className="hq-muted-text" style={{ fontSize: "0.75rem" }}>Or paste URL below for external links</label>
                  <label>File URL<input value={newDoc.file_url} onChange={(e) => setNewDoc({ ...newDoc, file_url: e.target.value })} placeholder="Optional external URL" /></label>
                </div>
                <div className="hq-modal-actions">
                  <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setAddModal(null)}>Cancel</button>
                  <button type="button" className="hq-btn hq-btn-primary" disabled={(!newDoc.name && !docFile) || addDocument.isPending} onClick={() => addDocument.mutate()}>{addDocument.isPending ? "Uploading…" : "Save Document"}</button>
                </div>
              </>
            )}
            {addModal === "training" && (
              <>
                <h3><GraduationCap size={18} /> Add Training Record</h3>
                <div className="hq-form-grid">
                  <label>Title<input value={newTraining.title} onChange={(e) => setNewTraining({ ...newTraining, title: e.target.value })} placeholder="CPR Certification, DEI Training…" /></label>
                  <label>Provider<input value={newTraining.provider} onChange={(e) => setNewTraining({ ...newTraining, provider: e.target.value })} /></label>
                  <label>Status
                    <select value={newTraining.status} onChange={(e) => setNewTraining({ ...newTraining, status: e.target.value })}>
                      <option value="scheduled">Scheduled</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                    </select>
                  </label>
                </div>
                <div className="hq-modal-actions">
                  <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setAddModal(null)}>Cancel</button>
                  <button type="button" className="hq-btn hq-btn-primary" disabled={!newTraining.title || addTraining.isPending} onClick={() => addTraining.mutate()}>{addTraining.isPending ? "Saving…" : "Save Training"}</button>
                </div>
              </>
            )}
            {addModal === "certification" && (
              <>
                <h3><Award size={18} /> Add Certification</h3>
                <div className="hq-form-grid">
                  <label>Certification Name<input value={newCert.name} onChange={(e) => setNewCert({ ...newCert, name: e.target.value })} /></label>
                  <label>Issuer<input value={newCert.issuer} onChange={(e) => setNewCert({ ...newCert, issuer: e.target.value })} /></label>
                  <label>Expiry Date<input type="date" value={newCert.expiry_date} onChange={(e) => setNewCert({ ...newCert, expiry_date: e.target.value })} /></label>
                </div>
                <div className="hq-modal-actions">
                  <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setAddModal(null)}>Cancel</button>
                  <button type="button" className="hq-btn hq-btn-primary" disabled={!newCert.name || addCertification.isPending} onClick={() => addCertification.mutate()}>{addCertification.isPending ? "Saving…" : "Save Certification"}</button>
                </div>
              </>
            )}
            {addModal === "schedule" && (
              <>
                <h3><Calendar size={18} /> Add Schedule Entry</h3>
                <div className="hq-form-grid">
                  <label>Title<input value={newSchedule.title} onChange={(e) => setNewSchedule({ ...newSchedule, title: e.target.value })} placeholder="Morning shift, Board meeting…" /></label>
                  <label>Date<input type="date" value={newSchedule.schedule_date} onChange={(e) => setNewSchedule({ ...newSchedule, schedule_date: e.target.value })} /></label>
                  <label>Start Time<input type="time" value={newSchedule.start_time} onChange={(e) => setNewSchedule({ ...newSchedule, start_time: e.target.value })} /></label>
                  <label>End Time<input type="time" value={newSchedule.end_time} onChange={(e) => setNewSchedule({ ...newSchedule, end_time: e.target.value })} /></label>
                  <label>Location<input value={newSchedule.location} onChange={(e) => setNewSchedule({ ...newSchedule, location: e.target.value })} /></label>
                </div>
                <div className="hq-modal-actions">
                  <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setAddModal(null)}>Cancel</button>
                  <button type="button" className="hq-btn hq-btn-primary" disabled={!newSchedule.title || !newSchedule.schedule_date || addSchedule.isPending} onClick={() => addSchedule.mutate()}>{addSchedule.isPending ? "Saving…" : "Save Schedule"}</button>
                </div>
              </>
            )}
            {addModal === "performance" && (
              <>
                <h3>Add Performance Review</h3>
                <div className="hq-form-grid">
                  <label>Review Date<input type="date" value={newPerformance.review_date} onChange={(e) => setNewPerformance({ ...newPerformance, review_date: e.target.value })} /></label>
                  <label>Reviewer<input value={newPerformance.reviewer} onChange={(e) => setNewPerformance({ ...newPerformance, reviewer: e.target.value })} /></label>
                  <label>Rating
                    <select value={newPerformance.rating} onChange={(e) => setNewPerformance({ ...newPerformance, rating: e.target.value })}>
                      <option>Exceeds Expectations</option>
                      <option>Meets Expectations</option>
                      <option>Needs Improvement</option>
                    </select>
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>Summary<textarea rows={3} value={newPerformance.summary} onChange={(e) => setNewPerformance({ ...newPerformance, summary: e.target.value })} /></label>
                </div>
                <div className="hq-modal-actions">
                  <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setAddModal(null)}>Cancel</button>
                  <button type="button" className="hq-btn hq-btn-primary" disabled={!newPerformance.review_date || addPerformance.isPending} onClick={() => addPerformance.mutate()}>{addPerformance.isPending ? "Saving…" : "Save Review"}</button>
                </div>
              </>
            )}
            {addModal === "department" && (
              <>
                <h3><Building2 size={18} /> Add Department</h3>
                <div className="hq-form-grid">
                  <label>Department Name<input value={newDept.name} onChange={(e) => setNewDept({ ...newDept, name: e.target.value })} placeholder="Programs, Finance, Operations…" /></label>
                  <label>Code<input value={newDept.code} onChange={(e) => setNewDept({ ...newDept, code: e.target.value })} placeholder="PROG, FIN…" /></label>
                </div>
                <div className="hq-modal-actions">
                  <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setAddModal(null)}>Cancel</button>
                  <button type="button" className="hq-btn hq-btn-primary" disabled={!newDept.name || createDepartment.isPending} onClick={() => createDepartment.mutate()}>{createDepartment.isPending ? "Saving…" : "Create Department"}</button>
                </div>
              </>
            )}
            {addModal === "incident" && (
              <>
                <h3><AlertTriangle size={18} /> Report Incident</h3>
                <div className="hq-form-grid">
                  <label>Date<input type="date" value={newIncident.incident_date} onChange={(e) => setNewIncident({ ...newIncident, incident_date: e.target.value })} /></label>
                  <label>Type
                    <select value={newIncident.incident_type} onChange={(e) => setNewIncident({ ...newIncident, incident_type: e.target.value })}>
                      <option value="general">General</option>
                      <option value="safety">Safety</option>
                      <option value="conduct">Conduct</option>
                      <option value="harassment">Harassment</option>
                      <option value="injury">Injury</option>
                    </select>
                  </label>
                  <label>Severity
                    <select value={newIncident.severity} onChange={(e) => setNewIncident({ ...newIncident, severity: e.target.value })}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  <label>Person Involved (optional)
                    <select value={newIncident.person_id} onChange={(e) => setNewIncident({ ...newIncident, person_id: e.target.value })}>
                      <option value="">—</option>
                      {(directory.data?.people ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.fullName}</option>
                      ))}
                    </select>
                  </label>
                  <label>Location<input value={newIncident.location} onChange={(e) => setNewIncident({ ...newIncident, location: e.target.value })} placeholder="Office, program site…" /></label>
                  <label style={{ gridColumn: "1 / -1" }}>Description<textarea rows={3} value={newIncident.description} onChange={(e) => setNewIncident({ ...newIncident, description: e.target.value })} /></label>
                </div>
                <div className="hq-modal-actions">
                  <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setAddModal(null)}>Cancel</button>
                  <button type="button" className="hq-btn hq-btn-primary" disabled={!newIncident.description || createIncident.isPending} onClick={() => createIncident.mutate()}>{createIncident.isPending ? "Submitting…" : "Submit Report"}</button>
                </div>
              </>
            )}
            {addModal === "leave" && (
              <>
                <h3><Palmtree size={18} /> Request Leave</h3>
                <div className="hq-form-grid">
                  <label>Employee
                    <select value={newLeave.person_id} onChange={(e) => setNewLeave({ ...newLeave, person_id: e.target.value })}>
                      <option value="">Select…</option>
                      {(directory.data?.people ?? []).filter((p) => ["employee", "volunteer", "contractor"].includes(p.personType)).map((p) => (
                        <option key={p.id} value={p.id}>{p.fullName}</option>
                      ))}
                    </select>
                  </label>
                  <label>Type
                    <select value={newLeave.leave_type} onChange={(e) => setNewLeave({ ...newLeave, leave_type: e.target.value })}>
                      <option value="pto">PTO</option>
                      <option value="sick">Sick</option>
                      <option value="personal">Personal</option>
                      <option value="bereavement">Bereavement</option>
                    </select>
                  </label>
                  <label>Start Date<input type="date" value={newLeave.start_date} onChange={(e) => setNewLeave({ ...newLeave, start_date: e.target.value })} /></label>
                  <label>End Date<input type="date" value={newLeave.end_date} onChange={(e) => setNewLeave({ ...newLeave, end_date: e.target.value })} /></label>
                  <label style={{ gridColumn: "1 / -1" }}>Reason<textarea rows={2} value={newLeave.reason} onChange={(e) => setNewLeave({ ...newLeave, reason: e.target.value })} /></label>
                </div>
                <div className="hq-modal-actions">
                  <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setAddModal(null)}>Cancel</button>
                  <button type="button" className="hq-btn hq-btn-primary" disabled={!newLeave.person_id || !newLeave.start_date || !newLeave.end_date || createLeave.isPending} onClick={() => createLeave.mutate()}>{createLeave.isPending ? "Submitting…" : "Submit Request"}</button>
                </div>
              </>
            )}
            {addModal === "background" && selectedId && (
              <>
                <h3><ShieldCheck size={18} /> Add Background Check</h3>
                <div className="hq-form-grid">
                  <label>Check Type
                    <select value={newBgCheck.check_type} onChange={(e) => setNewBgCheck({ ...newBgCheck, check_type: e.target.value })}>
                      <option value="criminal">Criminal</option>
                      <option value="employment">Employment Verification</option>
                      <option value="credit">Credit</option>
                      <option value="child_abuse">Child Abuse Clearance</option>
                    </select>
                  </label>
                  <label>Provider<input value={newBgCheck.provider} onChange={(e) => setNewBgCheck({ ...newBgCheck, provider: e.target.value })} placeholder="Checkr, Sterling…" /></label>
                  <label>Status
                    <select value={newBgCheck.status} onChange={(e) => setNewBgCheck({ ...newBgCheck, status: e.target.value })}>
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="cleared">Cleared</option>
                      <option value="flagged">Flagged</option>
                    </select>
                  </label>
                  <label>Reference ID<input value={newBgCheck.reference_id} onChange={(e) => setNewBgCheck({ ...newBgCheck, reference_id: e.target.value })} /></label>
                </div>
                <div className="hq-modal-actions">
                  <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setAddModal(null)}>Cancel</button>
                  <button type="button" className="hq-btn hq-btn-primary" disabled={addBgCheck.isPending} onClick={() => addBgCheck.mutate()}>{addBgCheck.isPending ? "Saving…" : "Save Check"}</button>
                </div>
              </>
            )}
            {addModal === "signature" && selectedId && (
              <>
                <h3><PenLine size={18} /> Record Digital Signature</h3>
                <p className="hq-muted-text" style={{ marginBottom: "0.75rem" }}>Typed signature creates a legally traceable acknowledgment with timestamp and witness.</p>
                <div className="hq-form-grid">
                  <label>Document Title<input value={newSignature.document_title} onChange={(e) => setNewSignature({ ...newSignature, document_title: e.target.value })} placeholder="Employee Handbook 2026" /></label>
                  <label>Agreement Type
                    <select value={newSignature.agreement_type} onChange={(e) => setNewSignature({ ...newSignature, agreement_type: e.target.value })}>
                      <option value="policy">Policy Acknowledgment</option>
                      <option value="handbook">Employee Handbook</option>
                      <option value="contract">Contract</option>
                      <option value="waiver">Waiver</option>
                      <option value="volunteer">Volunteer Agreement</option>
                    </select>
                  </label>
                  <label>Signer Full Name<input value={newSignature.signer_name} onChange={(e) => setNewSignature({ ...newSignature, signer_name: e.target.value })} placeholder="Legal name" /></label>
                  <label style={{ gridColumn: "1 / -1" }}>Signature (type full legal name)<input value={newSignature.signature_text} onChange={(e) => setNewSignature({ ...newSignature, signature_text: e.target.value })} placeholder="I agree to the terms above" /></label>
                </div>
                <div className="hq-modal-actions">
                  <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setAddModal(null)}>Cancel</button>
                  <button type="button" className="hq-btn hq-btn-primary" disabled={!newSignature.document_title || !newSignature.signer_name || !newSignature.signature_text || addSignature.isPending} onClick={() => addSignature.mutate()}>{addSignature.isPending ? "Recording…" : "Record Signature"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </HQLayout>
  );
};

export default PeopleManagementCenter;
