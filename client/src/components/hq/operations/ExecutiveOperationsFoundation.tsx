import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Building2,
  Calendar,
  CheckSquare,
  ClipboardCheck,
  FileText,
  FolderOpen,
  GitBranch,
  HeartPulse,
  Plus,
  Shield,
  Users,
  Wallet,
} from "lucide-react";
import {
  operationsApi,
  type ExecutiveDepartment,
  type ExecutiveOpsDashboard,
} from "../../../api/operationsApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";
import { StatusBadge } from "../StatusBadge";

type TabId = "overview" | "departments" | "projects" | "compliance" | "automation" | "reports";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "departments", label: "Departments" },
  { id: "projects", label: "Tasks & Projects" },
  { id: "compliance", label: "Compliance" },
  { id: "automation", label: "Automation" },
  { id: "reports", label: "Reports" },
];

function healthVariant(score: number): "success" | "warning" | "danger" | "gold" {
  if (score >= 85) return "success";
  if (score >= 65) return "gold";
  if (score >= 45) return "warning";
  return "danger";
}

function complianceVariant(status: string): "success" | "warning" | "danger" {
  if (status === "healthy") return "success";
  if (status === "watch") return "warning";
  return "danger";
}

function OverviewTab({ data }: { data: ExecutiveOpsDashboard }) {
  return (
    <div className="hq-fade-in">
      <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
        <KpiCard label="Organization Health" value={`${data.organizationHealth}%`} icon={HeartPulse} variant={healthVariant(data.organizationHealth)} />
        <KpiCard label="Operational Health" value={`${data.operationalHealth}%`} icon={Activity} variant={healthVariant(data.operationalHealth)} />
        <KpiCard label="Financial Health" value={`${data.financialHealth}%`} icon={Wallet} variant={healthVariant(data.financialHealth)} />
        <KpiCard label="Grant Activity" value={data.grantActivity.active} icon={FileText} meta={`${data.grantActivity.deadlinesSoon} deadlines soon`} />
        <KpiCard label="Employees" value={data.employeeActivity.active} icon={Users} meta={`${data.employeeActivity.openLeave} leave`} />
        <KpiCard label="Volunteers" value={data.volunteerActivity.active} icon={Users} />
        <KpiCard label="Active Programs" value={data.activePrograms} icon={Building2} variant="gold" />
        <KpiCard label="Client Services" value={data.clientServices.clients} icon={Users} meta={`${data.clientServices.housingPlacements} placements`} />
        <KpiCard label="Open Tasks" value={data.openTasks.total} icon={CheckSquare} variant={data.openTasks.overdue > 0 ? "warning" : "muted"} meta={`${data.openTasks.overdue} overdue`} />
        <KpiCard
          label="Compliance"
          value={data.complianceStatus.status}
          icon={Shield}
          variant={complianceVariant(data.complianceStatus.status)}
          meta={`${data.complianceStatus.dueSoon} due · ${data.complianceStatus.overdue} overdue`}
        />
        <KpiCard label="System Alerts" value={data.systemAlerts.length} icon={AlertTriangle} variant={data.systemAlerts.length ? "warning" : "success"} />
        <KpiCard label="Upcoming Deadlines" value={data.upcomingDeadlines.length} icon={Calendar} variant={data.upcomingDeadlines.length ? "warning" : "muted"} />
      </div>

      <div className="hq-grid-2">
        <HqPanel title="System Alerts" subtitle="Critical operational and compliance signals">
          <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {data.systemAlerts.length === 0 && <li className="hq-muted-text">No active system alerts.</li>}
            {data.systemAlerts.map((a) => (
              <li key={a.id} className="hq-activity-item">
                <div className="hq-activity-content">
                  <div className="hq-activity-title">{a.title}</div>
                  <div className="hq-activity-detail">{a.detail}</div>
                </div>
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  <StatusBadge label={a.severity} variant={a.severity === "critical" ? "danger" : a.severity === "high" ? "warning" : "muted"} />
                  <Link to={a.path} className="hq-entity-link">Open →</Link>
                </div>
              </li>
            ))}
          </ul>
        </HqPanel>

        <HqPanel title="Upcoming Deadlines" subtitle="Tasks, projects, and compliance filings">
          <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {data.upcomingDeadlines.length === 0 && <li className="hq-muted-text">No deadlines in the next 45 days.</li>}
            {data.upcomingDeadlines.slice(0, 10).map((d) => (
              <li key={`${d.kind}-${d.id}`} className="hq-activity-item">
                <div className="hq-activity-content">
                  <div className="hq-activity-title">{d.title}</div>
                  <div className="hq-activity-detail">{d.kind} · {d.meta || "—"}</div>
                </div>
                <div className="hq-activity-time">{d.dueDate}</div>
              </li>
            ))}
          </ul>
        </HqPanel>
      </div>
    </div>
  );
}

function DepartmentsTab() {
  const q = useQuery({
    queryKey: ["ops-foundation-departments"],
    queryFn: operationsApi.foundationDepartments,
    staleTime: 45_000,
  });

  if (q.isLoading) return <HqLoading message="Loading department matrix…" />;
  const departments = q.data?.departments ?? [];

  return (
    <div className="hq-fade-in">
      <HqPanel title="Department Management" subtitle="Each department links to live dashboards, documents, and reports">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.75rem" }}>
          {departments.map((d: ExecutiveDepartment) => (
            <div key={d.id} className="hq-panel" style={{ padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{d.label}</div>
                <StatusBadge label={d.health} variant={d.health === "healthy" ? "success" : "warning"} />
              </div>
              <div className="hq-muted-text" style={{ fontSize: "0.72rem", marginBottom: "0.65rem" }}>{d.code} · {d.linkedDepartmentName}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.75rem" }}>
                {d.kpis.map((k) => (
                  <StatusBadge key={k.key} label={`${k.key} ${k.value}`} variant="muted" />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                <Link to={d.path} className="hq-btn hq-btn-sm hq-btn-ghost">Dashboard</Link>
                <Link to={d.docsPath} className="hq-btn hq-btn-sm hq-btn-ghost"><FolderOpen size={12} /> Docs</Link>
                <Link to={d.reportsPath} className="hq-btn hq-btn-sm hq-btn-ghost">Reports</Link>
              </div>
            </div>
          ))}
        </div>
      </HqPanel>
    </div>
  );
}

function ProjectsTab() {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["ops-projects"], queryFn: () => operationsApi.projects() });
  const tasks = useQuery({ queryKey: ["ops-tasks-all"], queryFn: () => operationsApi.tasks() });
  const [projectForm, setProjectForm] = useState({ title: "", priority: "normal", due_date: "", executive_summary: "" });
  const [taskForm, setTaskForm] = useState({ title: "", priority: "normal", due_date: "", project_id: "" });

  const createProject = useMutation({
    mutationFn: () => operationsApi.createProject(projectForm),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ops-projects"] });
      void qc.invalidateQueries({ queryKey: ["ops-foundation-dashboard"] });
      setProjectForm({ title: "", priority: "normal", due_date: "", executive_summary: "" });
    },
  });

  const createTask = useMutation({
    mutationFn: () => operationsApi.createTask({
      ...taskForm,
      project_id: taskForm.project_id || undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ops-tasks-all"] });
      void qc.invalidateQueries({ queryKey: ["ops-tasks"] });
      void qc.invalidateQueries({ queryKey: ["ops-foundation-dashboard"] });
      setTaskForm({ title: "", priority: "normal", due_date: "", project_id: "" });
    },
  });

  const updateProgress = useMutation({
    mutationFn: ({ id, progress_pct }: { id: string; progress_pct: number }) =>
      operationsApi.updateProject(id, { progress_pct }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ops-projects"] }),
  });

  if (projects.isLoading || tasks.isLoading) return <HqLoading message="Loading projects and tasks…" />;

  return (
    <div className="hq-fade-in" style={{ display: "grid", gap: "1rem" }}>
      <HqPanel title="Enterprise Projects" subtitle="Create projects, track progress, and capture executive summaries">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <input className="hq-input" placeholder="Project title" value={projectForm.title} onChange={(e) => setProjectForm({ ...projectForm, title: e.target.value })} />
          <select className="hq-input" value={projectForm.priority} onChange={(e) => setProjectForm({ ...projectForm, priority: e.target.value })}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <input className="hq-input" type="date" value={projectForm.due_date} onChange={(e) => setProjectForm({ ...projectForm, due_date: e.target.value })} />
          <input className="hq-input" placeholder="Executive summary" value={projectForm.executive_summary} onChange={(e) => setProjectForm({ ...projectForm, executive_summary: e.target.value })} style={{ minWidth: "220px" }} />
          <button type="button" className="hq-btn hq-btn-primary" disabled={!projectForm.title || createProject.isPending} onClick={() => createProject.mutate()}>
            <Plus size={14} /> Project
          </button>
        </div>
        <table className="hq-table">
          <thead>
            <tr><th>Project</th><th>Status</th><th>Priority</th><th>Progress</th><th>Due</th><th>Tasks</th></tr>
          </thead>
          <tbody>
            {(projects.data?.projects ?? []).map((p) => (
              <tr key={String(p.id)}>
                <td>
                  <div>{String(p.title)}</div>
                  {p.executive_summary ? <div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>{String(p.executive_summary)}</div> : null}
                </td>
                <td><StatusBadge label={String(p.status)} variant="gold" /></td>
                <td><StatusBadge label={String(p.priority)} variant="muted" /></td>
                <td>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Number(p.progress_pct ?? 0)}
                    onChange={(e) => updateProgress.mutate({ id: String(p.id), progress_pct: Number(e.target.value) })}
                  />
                  <span style={{ marginLeft: "0.35rem", fontSize: "0.75rem" }}>{Number(p.progress_pct ?? 0)}%</span>
                </td>
                <td>{String(p.due_date ?? "—")}</td>
                <td>{String(p.task_count ?? 0)}</td>
              </tr>
            ))}
            {(projects.data?.projects ?? []).length === 0 && (
              <tr><td colSpan={6} className="hq-muted-text">No projects yet — create the first enterprise project above.</td></tr>
            )}
          </tbody>
        </table>
      </HqPanel>

      <HqPanel title="Task Assignment" subtitle="Assign work with due dates, priorities, and optional project linkage">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <input className="hq-input" placeholder="Task title" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} />
          <select className="hq-input" value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <input className="hq-input" type="date" value={taskForm.due_date} onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })} />
          <select className="hq-input" value={taskForm.project_id} onChange={(e) => setTaskForm({ ...taskForm, project_id: e.target.value })}>
            <option value="">No project</option>
            {(projects.data?.projects ?? []).map((p) => (
              <option key={String(p.id)} value={String(p.id)}>{String(p.title)}</option>
            ))}
          </select>
          <button type="button" className="hq-btn hq-btn-primary" disabled={!taskForm.title || createTask.isPending} onClick={() => createTask.mutate()}>
            <Plus size={14} /> Task
          </button>
        </div>
        <table className="hq-table">
          <thead>
            <tr><th>Task</th><th>Priority</th><th>Status</th><th>Due</th><th>Department</th></tr>
          </thead>
          <tbody>
            {(tasks.data?.tasks ?? []).slice(0, 20).map((t) => (
              <tr key={String(t.id)}>
                <td>{String(t.title)}</td>
                <td><StatusBadge label={String(t.priority)} variant="muted" /></td>
                <td><StatusBadge label={String(t.status)} variant="gold" /></td>
                <td>{String(t.due_date ?? "—")}</td>
                <td>{String(t.department_name ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </HqPanel>
    </div>
  );
}

function ComplianceTab() {
  const qc = useQueryClient();
  const filings = useQuery({ queryKey: ["ops-compliance-filings"], queryFn: () => operationsApi.complianceFilings() });
  const [form, setForm] = useState({ title: "", filing_type: "irs_filing", due_date: "", risk_level: "medium", authority: "" });

  const createFiling = useMutation({
    mutationFn: () => operationsApi.createComplianceFiling(form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ops-compliance-filings"] });
      void qc.invalidateQueries({ queryKey: ["ops-foundation-dashboard"] });
      setForm({ title: "", filing_type: "irs_filing", due_date: "", risk_level: "medium", authority: "" });
    },
  });

  const complete = useMutation({
    mutationFn: (id: string) => operationsApi.updateComplianceFiling(id, { status: "completed" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ops-compliance-filings"] });
      void qc.invalidateQueries({ queryKey: ["ops-foundation-dashboard"] });
    },
  });

  if (filings.isLoading) return <HqLoading message="Loading compliance center…" />;

  return (
    <div className="hq-fade-in">
      <HqPanel
        title="Compliance Center"
        subtitle="IRS & state filings, insurance, licenses, certifications, policies, board requirements, audits"
        headerExtra={<Link to="/hq/compliance" className="hq-btn hq-btn-sm hq-btn-ghost">Risk register →</Link>}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <input className="hq-input" placeholder="Filing title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="hq-input" value={form.filing_type} onChange={(e) => setForm({ ...form, filing_type: e.target.value })}>
            <option value="irs_filing">IRS filing</option>
            <option value="state_filing">State filing</option>
            <option value="insurance_renewal">Insurance renewal</option>
            <option value="license">License</option>
            <option value="certification">Certification</option>
            <option value="policy">Policy</option>
            <option value="board_requirement">Board requirement</option>
            <option value="internal_audit">Internal audit</option>
          </select>
          <input className="hq-input" placeholder="Authority" value={form.authority} onChange={(e) => setForm({ ...form, authority: e.target.value })} />
          <input className="hq-input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          <select className="hq-input" value={form.risk_level} onChange={(e) => setForm({ ...form, risk_level: e.target.value })}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button type="button" className="hq-btn hq-btn-primary" disabled={!form.title || createFiling.isPending} onClick={() => createFiling.mutate()}>
            <Plus size={14} /> Filing
          </button>
        </div>
        <table className="hq-table">
          <thead>
            <tr><th>Title</th><th>Type</th><th>Authority</th><th>Due</th><th>Risk</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {(filings.data?.filings ?? []).map((f) => (
              <tr key={String(f.id)}>
                <td>{String(f.title)}</td>
                <td>{String(f.filing_type)}</td>
                <td>{String(f.authority ?? "—")}</td>
                <td>{String(f.due_date ?? "—")}</td>
                <td><StatusBadge label={String(f.risk_level)} variant={f.risk_level === "high" ? "danger" : f.risk_level === "medium" ? "warning" : "muted"} /></td>
                <td><StatusBadge label={String(f.status)} variant={f.status === "completed" ? "success" : "gold"} /></td>
                <td>
                  {f.status !== "completed" && (
                    <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={() => complete.mutate(String(f.id))}>
                      <ClipboardCheck size={12} /> Complete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </HqPanel>
    </div>
  );
}

function AutomationTab() {
  const q = useQuery({
    queryKey: ["ops-foundation-automation"],
    queryFn: operationsApi.foundationAutomation,
    staleTime: 60_000,
  });

  if (q.isLoading) return <HqLoading message="Loading workflow automation…" />;
  const data = q.data;

  return (
    <div className="hq-fade-in" style={{ display: "grid", gap: "1rem" }}>
      <HqPanel
        title="Workflow Automation"
        subtitle="Task reminders, approvals, deadline notifications, compliance alerts, executive digests"
        headerExtra={<Link to="/hq/workflows" className="hq-btn hq-btn-sm hq-btn-ghost"><GitBranch size={12} /> Workflows →</Link>}
      >
        <div className="hq-kpi-grid" style={{ marginBottom: "0.75rem" }}>
          <KpiCard label="Workflow Definitions" value={data?.definitions?.length ?? 0} icon={GitBranch} />
          <KpiCard label="Scheduled Jobs" value={data?.scheduledJobs?.length ?? 0} icon={Calendar} />
          <KpiCard label="Pending Approvals" value={data?.pendingApprovals?.length ?? 0} icon={CheckSquare} variant="warning" />
        </div>
        <table className="hq-table">
          <thead>
            <tr><th>Job</th><th>Schedule</th><th>Module</th><th>Last run</th><th>Status</th></tr>
          </thead>
          <tbody>
            {(data?.scheduledJobs ?? []).map((j) => (
              <tr key={String(j.job_key)}>
                <td>{String(j.name)}</td>
                <td>{String(j.schedule_expr)}</td>
                <td>{String(j.source_module ?? "—")}</td>
                <td>{String(j.last_run_at ?? "—")}</td>
                <td><StatusBadge label={Number(j.enabled) ? "enabled" : "disabled"} variant={Number(j.enabled) ? "success" : "muted"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </HqPanel>

      <HqPanel title="Pending Approvals" subtitle="Live workflow instances awaiting action">
        <ul className="hq-activity-list">
          {(data?.pendingApprovals ?? []).length === 0 && <li className="hq-muted-text">No pending approvals.</li>}
          {(data?.pendingApprovals ?? []).map((a) => (
            <li key={String(a.id)} className="hq-activity-item">
              <div className="hq-activity-content">
                <div className="hq-activity-title">{String(a.title)}</div>
                <div className="hq-activity-detail">{String(a.workflow_key)} · {String(a.assigned_to ?? "unassigned")}</div>
              </div>
              <StatusBadge label={String(a.priority ?? "normal")} variant="muted" />
            </li>
          ))}
        </ul>
      </HqPanel>
    </div>
  );
}

function ReportsTab() {
  const report = useQuery({
    queryKey: ["ops-foundation-report"],
    queryFn: operationsApi.foundationReport,
    staleTime: 60_000,
  });

  if (report.isLoading) return <HqLoading message="Generating executive report…" />;
  const r = report.data as {
    health?: Record<string, unknown>;
    workforce?: Record<string, number>;
    programs?: Record<string, unknown>;
    alerts?: unknown[];
    deadlines?: unknown[];
  } | undefined;

  return (
    <div className="hq-fade-in">
      <HqPanel
        title="Executive Operations Report"
        subtitle="Department, program, workforce, compliance, and growth metrics"
        headerExtra={<Link to="/hq/reports" className="hq-btn hq-btn-sm hq-btn-ghost">Enterprise Reporting →</Link>}
      >
        {!r ? (
          <p className="hq-muted-text">Report unavailable.</p>
        ) : (
          <>
            <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
              <KpiCard label="Org Health" value={`${r.health?.organization ?? "—"}%`} />
              <KpiCard label="Ops Health" value={`${r.health?.operational ?? "—"}%`} />
              <KpiCard label="Financial Health" value={`${r.health?.financial ?? "—"}%`} />
              <KpiCard label="Employees" value={r.workforce?.employees ?? 0} />
              <KpiCard label="Volunteers" value={r.workforce?.volunteers ?? 0} />
              <KpiCard label="Clients" value={r.workforce?.clients ?? 0} />
            </div>
            <p className="hq-muted-text" style={{ fontSize: "0.8rem" }}>
              Full report payload includes department matrix, active projects, compliance filings, alerts, and automation status.
              Use Enterprise Reporting for scheduled delivery.
            </p>
          </>
        )}
      </HqPanel>
    </div>
  );
}

export const ExecutiveOperationsFoundation: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const tabParam = (params.get("tab") as TabId | null) ?? "overview";
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? tabParam : "overview";

  const dashboard = useQuery({
    queryKey: ["ops-foundation-dashboard"],
    queryFn: operationsApi.foundationDashboard,
    staleTime: 30_000,
    retry: 1,
  });

  const setTab = (id: TabId) => {
    const next = new URLSearchParams(params);
    if (id === "overview") next.delete("tab");
    else next.set("tab", id);
    setParams(next, { replace: true });
  };

  if (dashboard.isLoading && !dashboard.data) {
    return <HqLoading message="Loading Executive Operations Center…" />;
  }

  return (
    <div className="hq-fade-in">
      <HqPanel
        title="Executive Operations Center"
        subtitle="Build 60 — unified command for departments, workforce, compliance, projects, and automation"
        headerExtra={<StatusBadge label="BUILD 60" variant="gold" />}
      >
        {dashboard.isError && !dashboard.data && (
          <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "0.75rem" }} role="status">
            <AlertTriangle size={16} />
            <div>
              <strong>Executive dashboard unavailable</strong>
              <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" style={{ marginLeft: "0.5rem" }} onClick={() => void dashboard.refetch()}>
                Retry
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "1rem" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`hq-btn hq-btn-sm ${tab === t.id ? "hq-btn-primary" : "hq-btn-ghost"}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && dashboard.data && <OverviewTab data={dashboard.data} />}
        {tab === "overview" && !dashboard.data && <p className="hq-muted-text">Unable to load live executive metrics.</p>}
        {tab === "departments" && <DepartmentsTab />}
        {tab === "projects" && <ProjectsTab />}
        {tab === "compliance" && <ComplianceTab />}
        {tab === "automation" && <AutomationTab />}
        {tab === "reports" && <ReportsTab />}
      </HqPanel>
    </div>
  );
};
