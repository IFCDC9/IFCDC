import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity, Target, ListTodo, Building2, Crown, Brain, History, Rocket,
  Plus, Check, X, AlertTriangle, ChevronRight,
} from "lucide-react";
import { phase10Api } from "../../api/phase10Api";
import type { MissionControlCommandCenter, HqMission, HqMissionTask } from "../../api/missionControlTypes";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqQueryBoundary } from "../HqQueryBoundary";
import { formatPercent } from "../../utils/safeFormat";
import { useAuth } from "../../auth/AuthContext";

const TABS = [
  { id: "executive", label: "Executive Dashboard", icon: Activity },
  { id: "missions", label: "Mission Operations", icon: Rocket },
  { id: "objectives", label: "Strategic Objectives", icon: Target },
  { id: "tasks", label: "Task Command Center", icon: ListTodo },
  { id: "divisions", label: "Cross-Division", icon: Building2 },
  { id: "founder", label: "Founder Panel", icon: Crown },
  { id: "intelligence", label: "Mission Intelligence", icon: Brain },
  { id: "audit", label: "Audit & History", icon: History },
] as const;

type TabId = (typeof TABS)[number]["id"];

const MC_QUERY_KEY = ["mission-control-command-center"];

function statusVariant(status: string): "success" | "warning" | "danger" | "muted" | "gold" {
  if (status === "active" || status === "approved" || status === "complete" || status === "completed") return "success";
  if (status === "at_risk" || status === "pending" || status === "in_progress") return "warning";
  if (status === "rejected") return "danger";
  return "muted";
}

function parseAuditMeta(raw?: string | null): { previous?: unknown; next?: unknown } {
  if (!raw) return {};
  try {
    const meta = JSON.parse(raw) as {
      previous_value?: unknown;
      new_value?: unknown;
      previousValue?: unknown;
      newValue?: unknown;
    };
    return {
      previous: meta.previous_value ?? meta.previousValue,
      next: meta.new_value ?? meta.newValue,
    };
  } catch {
    return {};
  }
}

export const MissionControlCommandCenter: React.FC = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabId>("executive");
  const role = String(user?.role ?? "").toLowerCase();
  const isFounder = role === "owner" || role === "founder";

  const mc = useQuery({
    queryKey: MC_QUERY_KEY,
    queryFn: phase10Api.missionControl,
    staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: MC_QUERY_KEY });

  const [newMission, setNewMission] = useState({ title: "", status: "planning", priority: "medium", targetDate: "" });
  const [newObjective, setNewObjective] = useState({ title: "", objectiveType: "quarterly", targetValue: 100, department: "" });
  const [newTask, setNewTask] = useState({ title: "", priority: "medium", ownerEmail: "", dueDate: "" });
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [newNote, setNewNote] = useState({ title: "", body: "" });
  const [newDecision, setNewDecision] = useState({ title: "", decisionType: "approval", priority: "high" });
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null);

  const createMission = useMutation({
    mutationFn: () => phase10Api.createMission(newMission),
    onSuccess: () => { invalidate(); setNewMission({ title: "", status: "planning", priority: "medium", targetDate: "" }); },
  });
  const updateMissionStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => phase10Api.updateMission(id, { status }),
    onSuccess: invalidate,
  });
  const createObjective = useMutation({
    mutationFn: () => phase10Api.createObjective(newObjective),
    onSuccess: () => { invalidate(); setNewObjective({ title: "", objectiveType: "quarterly", targetValue: 100, department: "" }); },
  });
  const updateObjectiveProgress = useMutation({
    mutationFn: ({ id, progressPct }: { id: string; progressPct: number }) =>
      phase10Api.updateObjective(id, { progressPct }),
    onSuccess: invalidate,
  });
  const createTask = useMutation({
    mutationFn: () => phase10Api.createMissionTask(newTask),
    onSuccess: () => { invalidate(); setNewTask({ title: "", priority: "medium", ownerEmail: "", dueDate: "" }); },
  });
  const approveTask = useMutation({ mutationFn: (id: string) => phase10Api.approveMissionTask(id), onSuccess: invalidate });
  const rejectTask = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => phase10Api.rejectMissionTask(id, reason),
    onSuccess: invalidate,
  });
  const createNote = useMutation({
    mutationFn: () => phase10Api.createExecutiveNote({ ...newNote, pinned: true }),
    onSuccess: () => { invalidate(); setNewNote({ title: "", body: "" }); },
  });
  const decide = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: "approved" | "rejected"; note?: string }) =>
      phase10Api.decideFounderDecision(id, decision, note),
    onSuccess: invalidate,
  });
  const createDecision = useMutation({
    mutationFn: () => phase10Api.createFounderDecision(newDecision),
    onSuccess: () => { invalidate(); setNewDecision({ title: "", decisionType: "approval", priority: "high" }); },
  });

  const taskHistory = useQuery({
    queryKey: ["mission-task-history", historyTaskId],
    queryFn: () => phase10Api.getTaskHistory(historyTaskId!),
    enabled: !!historyTaskId,
  });

  const data = mc.data as MissionControlCommandCenter | undefined;
  const health = data?.executiveDashboard.organizationHealth;

  return (
    <HqQueryBoundary query={mc} title="Mission Control unavailable" message="Could not load the operational command center." loadingMessage="Loading Mission Control…">
      {data && (
    <div className="hq-fade-in">
      <div className="hq-founder-hero" style={{ marginBottom: "1rem" }}>
        <div>
          <p className="hq-founder-hero-eyebrow">IFCDC Headquarters · Mission Control</p>
          <h2>Operational Command Center</h2>
          <p className="hq-founder-hero-tagline">Monitor, direct, approve, and manage the organization in real time</p>
        </div>
        <div className="hq-founder-hero-meta">
          <StatusBadge label={`Health ${health?.overall ?? "—"}%`} variant="success" />
          <StatusBadge label={health?.grade ?? "—"} variant="gold" />
          <StatusBadge label={`${data.taskCommandCenter.counts.missionPending} pending tasks`} variant="warning" />
        </div>
      </div>

      <div className="hq-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" className={`hq-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              <Icon size={14} style={{ marginRight: "0.35rem", verticalAlign: "middle" }} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "executive" && <ExecutiveDashboardPanel data={data} />}
      {tab === "missions" && (
        <MissionsPanel
          data={data}
          newMission={newMission}
          setNewMission={setNewMission}
          onCreate={() => createMission.mutate()}
          creating={createMission.isPending}
          onStatusChange={(id, status) => updateMissionStatus.mutate({ id, status })}
        />
      )}
      {tab === "objectives" && (
        <ObjectivesPanel
          data={data}
          newObjective={newObjective}
          setNewObjective={setNewObjective}
          onCreate={() => createObjective.mutate()}
          creating={createObjective.isPending}
          onProgress={(id, progressPct) => updateObjectiveProgress.mutate({ id, progressPct })}
        />
      )}
      {tab === "tasks" && (
        <TasksPanel
          data={data}
          newTask={newTask}
          setNewTask={setNewTask}
          onCreate={() => createTask.mutate()}
          creating={createTask.isPending}
          onApprove={(id) => approveTask.mutate(id)}
          onReject={(id) => rejectTask.mutate({ id, reason: rejectReason[id] ?? "Rejected from Mission Control" })}
          rejectReason={rejectReason}
          setRejectReason={setRejectReason}
          historyTaskId={historyTaskId}
          setHistoryTaskId={setHistoryTaskId}
          history={taskHistory.data?.history ?? []}
          historyLoading={taskHistory.isLoading}
        />
      )}
      {tab === "divisions" && <DivisionsPanel data={data} />}
      {tab === "founder" && (
        <FounderPanel
          data={data}
          isFounder={isFounder}
          newNote={newNote}
          setNewNote={setNewNote}
          onCreateNote={() => createNote.mutate()}
          newDecision={newDecision}
          setNewDecision={setNewDecision}
          onCreateDecision={() => createDecision.mutate()}
          onDecide={(id, decision) => decide.mutate({ id, decision })}
        />
      )}
      {tab === "intelligence" && <IntelligencePanel data={data} />}
      {tab === "audit" && <AuditPanel data={data} />}

      <p className="hq-muted-text" style={{ fontSize: "0.72rem", marginTop: "1rem" }}>
        Last refreshed {new Date(data.generatedAt).toLocaleString()}
      </p>
    </div>
      )}
    </HqQueryBoundary>
  );
};

const ExecutiveDashboardPanel: React.FC<{ data: MissionControlCommandCenter }> = ({ data }) => {
  const d = data.executiveDashboard;
  const briefing = d.dailyBriefing as { greeting?: string; highlights?: string[]; priorities?: string[] } | null;
  return (
    <>
      <div className="hq-kpi-grid hq-mb-md">
        <KpiCard label="Organization Health" value={formatPercent(d.organizationHealth?.overall)} icon={Activity} variant="success" />
        <KpiCard label="Critical Alerts" value={d.criticalAlerts?.length ?? 0} icon={AlertTriangle} variant="warning" />
        <KpiCard label="Active Missions" value={data.missionOperations.byStatus.active?.length ?? 0} icon={Rocket} variant="gold" />
        <KpiCard label="Avg Objective Progress" value={`${data.strategicObjectives.avgProgress}%`} icon={Target} variant="success" />
      </div>

      <div className="hq-grid-2">
        <HqPanel title="Critical Alerts" subtitle="Missions at risk and high-priority executive tasks">
          {(d.criticalAlerts ?? []).length === 0 ? (
            <p className="hq-muted-text">No critical alerts right now.</p>
          ) : (
            <ul className="hq-activity-list">
              {(d.criticalAlerts ?? []).map((a) => (
                <li key={a.id} className="hq-activity-item">
                  <div className="hq-activity-content">
                    <div className="hq-activity-title">{a.title}</div>
                    <div className="hq-activity-detail">{a.type.replace(/_/g, " ")}</div>
                  </div>
                  <StatusBadge label={a.severity} variant="danger" />
                  {a.path && <Link to={a.path} className="hq-entity-link"><ChevronRight size={12} /></Link>}
                </li>
              ))}
            </ul>
          )}
        </HqPanel>

        <HqPanel title="Daily Founder Briefing" subtitle="Executive intelligence summary">
          <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{briefing?.greeting ?? "Executive briefing"}</p>
          <ul style={{ margin: "0 0 0.75rem", paddingLeft: "1.1rem", fontSize: "0.85rem" }}>
            {(briefing?.highlights ?? []).slice(0, 5).map((h) => <li key={h}>{h}</li>)}
          </ul>
          <strong style={{ color: "var(--hq-gold)", fontSize: "0.8rem" }}>Priorities</strong>
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", fontSize: "0.82rem" }}>
            {(briefing?.priorities ?? []).slice(0, 4).map((p) => <li key={p}>{p}</li>)}
          </ul>
        </HqPanel>
      </div>

      <HqPanel title="Active Priorities" subtitle="Strategic recommendations" className="hq-mt-lg">
        {(d.activePriorities ?? []).length === 0 ? (
          <p className="hq-muted-text">No active priorities recorded. Recommendations appear when intelligence engines run.</p>
        ) : (
          (d.activePriorities ?? []).map((p, i) => (
            <div key={i} style={{ marginBottom: "0.5rem", fontSize: "0.85rem" }}>
              <StatusBadge label={p.priority} variant={p.priority === "high" ? "danger" : "warning"} />
              <span style={{ marginLeft: "0.5rem" }}>{p.action}</span>
            </div>
          ))
        )}
      </HqPanel>

      {d.scorecard && (
        <HqPanel title="Organization Scorecard" subtitle="Executive intelligence pillars" className="hq-mt-lg">
          <div className="hq-executive-health-strip">
            {((d.scorecard as { pillars?: { label: string; score: number; status: string }[] }).pillars ?? []).map((p) => (
              <div key={p.label} className="hq-health-factor-card">
                <div className="hq-health-factor-label">{p.label}</div>
                <div className="hq-health-factor-value">{p.score}%</div>
                <StatusBadge label={p.status} variant={p.status === "healthy" ? "success" : "warning"} />
              </div>
            ))}
          </div>
        </HqPanel>
      )}
    </>
  );
};

const MissionsPanel: React.FC<{
  data: MissionControlCommandCenter;
  newMission: { title: string; status: string; priority: string; targetDate: string };
  setNewMission: React.Dispatch<React.SetStateAction<{ title: string; status: string; priority: string; targetDate: string }>>;
  onCreate: () => void;
  creating: boolean;
  onStatusChange: (id: string, status: string) => void;
}> = ({ data, newMission, setNewMission, onCreate, creating, onStatusChange }) => (
  <>
    <HqPanel title="Create Mission" subtitle="Planning → Active → At Risk → Complete">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <input className="hq-input" placeholder="Mission title" value={newMission.title} onChange={(e) => setNewMission({ ...newMission, title: e.target.value })} style={{ flex: "1 1 200px" }} />
        <select className="hq-input" value={newMission.status} onChange={(e) => setNewMission({ ...newMission, status: e.target.value })}>
          <option value="planning">Planning</option>
          <option value="active">Active</option>
          <option value="at_risk">At Risk</option>
          <option value="complete">Complete</option>
        </select>
        <input className="hq-input" type="date" value={newMission.targetDate} onChange={(e) => setNewMission({ ...newMission, targetDate: e.target.value })} />
        <button type="button" className="hq-btn hq-btn-primary" disabled={!newMission.title || creating} onClick={onCreate}><Plus size={14} /> Create</button>
      </div>
    </HqPanel>

    <div className="hq-grid-2 hq-mt-lg">
      {(["planning", "active", "at_risk", "complete"] as const).map((status) => (
        <HqPanel key={status} title={status.replace("_", " ").toUpperCase()} subtitle={`${data.missionOperations.byStatus[status]?.length ?? 0} missions`}>
          <table className="hq-table hq-table-compact">
            <thead><tr><th>Mission</th><th>Owner</th><th>Target</th><th>Status</th></tr></thead>
            <tbody>
              {(data.missionOperations.byStatus[status] ?? []).map((m: HqMission) => (
                <tr key={m.id}>
                  <td>{m.title}</td>
                  <td>{m.owner_email ?? "—"}</td>
                  <td>{m.target_date ?? "—"}</td>
                  <td>
                    <select className="hq-input hq-input-sm" value={m.status} onChange={(e) => onStatusChange(m.id, e.target.value)}>
                      <option value="planning">Planning</option>
                      <option value="active">Active</option>
                      <option value="at_risk">At Risk</option>
                      <option value="complete">Complete</option>
                    </select>
                  </td>
                </tr>
              ))}
              {(data.missionOperations.byStatus[status] ?? []).length === 0 && (
                <tr><td colSpan={4} className="hq-muted-text">No missions in this status.</td></tr>
              )}
            </tbody>
          </table>
        </HqPanel>
      ))}
    </div>

    <HqPanel title="Mission Timeline" subtitle="Recent events across active missions" className="hq-mt-lg">
      {(data.missionOperations.timeline ?? []).map((block) => (
        <div key={block.missionId} style={{ marginBottom: "1rem" }}>
          <strong>{block.missionTitle}</strong>
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", fontSize: "0.82rem" }}>
            {(block.events as { title: string; occurred_at: string }[]).slice(0, 4).map((ev, i) => (
              <li key={i}>{ev.title} · {new Date(ev.occurred_at).toLocaleDateString()}</li>
            ))}
            {(block.events as unknown[]).length === 0 && <li className="hq-muted-text">No timeline events yet.</li>}
          </ul>
        </div>
      ))}
    </HqPanel>
  </>
);

const ObjectivesPanel: React.FC<{
  data: MissionControlCommandCenter;
  newObjective: { title: string; objectiveType: string; targetValue: number; department: string };
  setNewObjective: React.Dispatch<React.SetStateAction<{ title: string; objectiveType: string; targetValue: number; department: string }>>;
  onCreate: () => void;
  creating: boolean;
  onProgress: (id: string, progressPct: number) => void;
}> = ({ data, newObjective, setNewObjective, onCreate, creating, onProgress }) => (
  <>
    <HqPanel title="Create Objective" subtitle="Annual goals, quarterly objectives, department milestones">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <input className="hq-input" placeholder="Objective title" value={newObjective.title} onChange={(e) => setNewObjective({ ...newObjective, title: e.target.value })} style={{ flex: "1 1 200px" }} />
        <select className="hq-input" value={newObjective.objectiveType} onChange={(e) => setNewObjective({ ...newObjective, objectiveType: e.target.value })}>
          <option value="annual">Annual</option>
          <option value="quarterly">Quarterly</option>
          <option value="department_milestone">Department Milestone</option>
        </select>
        <input className="hq-input" placeholder="Department" value={newObjective.department} onChange={(e) => setNewObjective({ ...newObjective, department: e.target.value })} />
        <button type="button" className="hq-btn hq-btn-primary" disabled={!newObjective.title || creating} onClick={onCreate}><Plus size={14} /> Add</button>
      </div>
    </HqPanel>

    {(["annual", "quarterly", "department_milestone"] as const).map((type) => (
      <HqPanel key={type} title={type.replace("_", " ")} subtitle="Progress tracking & KPI completion" className="hq-mt-lg">
        <table className="hq-table">
          <thead><tr><th>Objective</th><th>Dept</th><th>Progress</th><th>Due</th><th>Update</th></tr></thead>
          <tbody>
            {(data.strategicObjectives.byType[type] ?? []).map((o) => (
              <tr key={o.id}>
                <td>{o.title}</td>
                <td>{o.department ?? "—"}</td>
                <td><StatusBadge label={`${o.progress_pct ?? 0}%`} variant={(o.progress_pct ?? 0) >= 75 ? "success" : "warning"} /></td>
                <td>{o.due_date ?? "—"}</td>
                <td>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={o.progress_pct ?? 0}
                    onChange={(e) => onProgress(o.id, Number(e.target.value))}
                    style={{ width: "100px" }}
                  />
                </td>
              </tr>
            ))}
            {(data.strategicObjectives.byType[type] ?? []).length === 0 && (
              <tr><td colSpan={5} className="hq-muted-text">No objectives yet — create one above.</td></tr>
            )}
          </tbody>
        </table>
      </HqPanel>
    ))}
  </>
);

const TasksPanel: React.FC<{
  data: MissionControlCommandCenter;
  newTask: { title: string; priority: string; ownerEmail: string; dueDate: string };
  setNewTask: React.Dispatch<React.SetStateAction<{ title: string; priority: string; ownerEmail: string; dueDate: string }>>;
  onCreate: () => void;
  creating: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  rejectReason: Record<string, string>;
  setRejectReason: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  historyTaskId: string | null;
  setHistoryTaskId: (id: string | null) => void;
  history: unknown[];
  historyLoading: boolean;
}> = ({ data, newTask, setNewTask, onCreate, creating, onApprove, onReject, rejectReason, setRejectReason, historyTaskId, setHistoryTaskId, history, historyLoading }) => (
  <>
    <HqPanel title="Assign Task" subtitle="Owners, due dates, priority, and dependencies">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <input className="hq-input" placeholder="Task title" value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} style={{ flex: "1 1 180px" }} />
        <input className="hq-input" placeholder="Owner email" value={newTask.ownerEmail} onChange={(e) => setNewTask({ ...newTask, ownerEmail: e.target.value })} />
        <input className="hq-input" type="date" value={newTask.dueDate} onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })} />
        <select className="hq-input" value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <button type="button" className="hq-btn hq-btn-primary" disabled={!newTask.title || creating} onClick={onCreate}><Plus size={14} /> Assign</button>
      </div>
    </HqPanel>

    <HqPanel title="Mission Tasks" subtitle="Approve, reject, and track activity" className="hq-mt-lg">
      <table className="hq-table">
        <thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {(data.taskCommandCenter.missionTasks ?? []).map((t: HqMissionTask) => (
            <tr key={t.id}>
              <td>{t.title}</td>
              <td>{t.owner_email ?? "—"}</td>
              <td>{t.due_date ?? "—"}</td>
              <td><StatusBadge label={t.priority} variant={t.priority === "critical" || t.priority === "high" ? "danger" : "muted"} /></td>
              <td><StatusBadge label={t.status} variant={statusVariant(t.status)} /></td>
              <td style={{ whiteSpace: "nowrap" }}>
                {t.status === "pending" && (
                  <>
                    <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => onApprove(t.id)} title="Approve"><Check size={12} /></button>
                    <input className="hq-input hq-input-sm" placeholder="Reject reason" value={rejectReason[t.id] ?? ""} onChange={(e) => setRejectReason({ ...rejectReason, [t.id]: e.target.value })} style={{ width: "100px", margin: "0 0.25rem" }} />
                    <button type="button" className="hq-btn hq-btn-sm" onClick={() => onReject(t.id)} title="Reject"><X size={12} /></button>
                  </>
                )}
                <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => setHistoryTaskId(historyTaskId === t.id ? null : t.id)}>History</button>
              </td>
            </tr>
          ))}
          {(data.taskCommandCenter.missionTasks ?? []).length === 0 && (
            <tr><td colSpan={6} className="hq-muted-text">No mission tasks — assign one above.</td></tr>
          )}
        </tbody>
      </table>
    </HqPanel>

    {historyTaskId && (
      <HqPanel title="Task Activity History" subtitle={`Task ${historyTaskId}`} className="hq-mt-lg">
        {historyLoading ? <p className="hq-muted-text">Loading history…</p> : (
          <table className="hq-table hq-table-compact">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Previous</th><th>New</th></tr></thead>
            <tbody>
              {(history as { created_at: string; actor_email?: string; action: string; previous_value?: string; new_value?: string }[]).map((h, i) => (
                <tr key={i}>
                  <td>{new Date(h.created_at).toLocaleString()}</td>
                  <td>{h.actor_email ?? "—"}</td>
                  <td>{h.action}</td>
                  <td>{h.previous_value ?? "—"}</td>
                  <td>{h.new_value ?? "—"}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={5} className="hq-muted-text">No history recorded yet.</td></tr>}
            </tbody>
          </table>
        )}
      </HqPanel>
    )}

    <HqPanel title="Executive Task Hub" subtitle="Cross-division approvals and workflows" className="hq-mt-lg" action={{ label: "Workflows", to: "/hq/workflows" }}>
      <table className="hq-table hq-table-compact">
        <thead><tr><th>Task</th><th>Source</th><th>Priority</th></tr></thead>
        <tbody>
          {(data.taskCommandCenter.executiveTasks as { id: string; title: string; source: string; priority: string; path?: string }[]).slice(0, 10).map((t) => (
            <tr key={t.id}>
              <td>{t.path ? <Link to={t.path}>{t.title}</Link> : t.title}</td>
              <td>{t.source}</td>
              <td><StatusBadge label={t.priority} variant={t.priority === "high" ? "danger" : "muted"} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </HqPanel>
  </>
);

const DivisionsPanel: React.FC<{ data: MissionControlCommandCenter }> = ({ data }) => (
  <HqPanel title="Cross-Division Operations" subtitle="Live status across headquarters divisions">
    <div className="hq-module-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem" }}>
      {(data.crossDivision.modules ?? []).map((m) => (
        <Link key={m.key} to={m.path} className="hq-panel hq-module-card" style={{ textDecoration: "none", padding: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <Building2 size={18} style={{ color: "var(--hq-gold)" }} />
            <StatusBadge label={m.status} variant={m.healthy ? "success" : "warning"} />
          </div>
          <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "inherit" }}>{m.label}</div>
          {m.alerts > 0 && <div className="hq-muted-text" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>{m.alerts} alert(s)</div>}
        </Link>
      ))}
    </div>
  </HqPanel>
);

const FounderPanel: React.FC<{
  data: MissionControlCommandCenter;
  isFounder: boolean;
  newNote: { title: string; body: string };
  setNewNote: React.Dispatch<React.SetStateAction<{ title: string; body: string }>>;
  onCreateNote: () => void;
  newDecision: { title: string; decisionType: string; priority: string };
  setNewDecision: React.Dispatch<React.SetStateAction<{ title: string; decisionType: string; priority: string }>>;
  onCreateDecision: () => void;
  onDecide: (id: string, decision: "approved" | "rejected") => void;
}> = ({ data, isFounder, newNote, setNewNote, onCreateNote, newDecision, setNewDecision, onCreateDecision, onDecide }) => (
  <>
    <HqPanel title="Pending Decisions" subtitle="Organization approvals requiring Founder action">
      <table className="hq-table">
        <thead><tr><th>Decision</th><th>Type</th><th>Priority</th><th>Status</th>{isFounder && <th>Action</th>}</tr></thead>
        <tbody>
          {(data.founderPanel.pendingDecisions ?? []).map((d) => (
            <tr key={d.id}>
              <td>{d.title}</td>
              <td>{d.decision_type}</td>
              <td><StatusBadge label={d.priority} variant={d.priority === "critical" ? "danger" : "warning"} /></td>
              <td><StatusBadge label={d.status} variant="warning" /></td>
              {isFounder && d.status === "pending" && (
                <td>
                  <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => onDecide(d.id, "approved")}>Approve</button>
                  <button type="button" className="hq-btn hq-btn-sm" style={{ marginLeft: "0.25rem" }} onClick={() => onDecide(d.id, "rejected")}>Reject</button>
                </td>
              )}
            </tr>
          ))}
          {(data.founderPanel.pendingDecisions ?? []).length === 0 && (
            <tr><td colSpan={isFounder ? 5 : 4} className="hq-muted-text">No pending founder decisions.</td></tr>
          )}
        </tbody>
      </table>
    </HqPanel>

    <div className="hq-grid-2 hq-mt-lg">
      <HqPanel title="Approval Queue" subtitle="Enterprise approvals from across HQ">
        <ul className="hq-activity-list">
          {(data.founderPanel.approvalQueue as { id: string; title: string; module: string }[]).slice(0, 8).map((a) => (
            <li key={a.id} className="hq-activity-item">
              <div className="hq-activity-content">
                <div className="hq-activity-title">{a.title}</div>
                <div className="hq-activity-detail">{a.module}</div>
              </div>
            </li>
          ))}
        </ul>
      </HqPanel>

      <HqPanel title="Executive Notes" subtitle="Pinned founder and executive notes">
        {isFounder && (
          <div style={{ marginBottom: "0.75rem" }}>
            <input className="hq-input" placeholder="Note title" value={newNote.title} onChange={(e) => setNewNote({ ...newNote, title: e.target.value })} style={{ marginBottom: "0.35rem" }} />
            <textarea className="hq-input" placeholder="Note body" value={newNote.body} onChange={(e) => setNewNote({ ...newNote, body: e.target.value })} rows={2} style={{ width: "100%", marginBottom: "0.35rem" }} />
            <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={!newNote.title || !newNote.body} onClick={onCreateNote}>Save Note</button>
          </div>
        )}
        {(data.founderPanel.executiveNotes ?? []).map((n) => (
          <div key={n.id} style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}>
            <strong>{n.title}</strong>
            <div className="hq-muted-text">{n.body}</div>
          </div>
        ))}
      </HqPanel>
    </div>

    {isFounder && (
      <HqPanel title="Emergency Override Request" subtitle="Founder-only decision queue" className="hq-mt-lg">
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <input className="hq-input" placeholder="Override title" value={newDecision.title} onChange={(e) => setNewDecision({ ...newDecision, title: e.target.value })} style={{ flex: "1 1 200px" }} />
          <select className="hq-input" value={newDecision.decisionType} onChange={(e) => setNewDecision({ ...newDecision, decisionType: e.target.value })}>
            <option value="approval">Approval</option>
            <option value="override">Emergency Override</option>
          </select>
          <button type="button" className="hq-btn hq-btn-primary" disabled={!newDecision.title} onClick={onCreateDecision}>Queue Decision</button>
        </div>
        {(data.founderPanel.emergencyOverrides ?? []).map((d) => (
          <div key={d.id} style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            <StatusBadge label="override" variant="danger" /> {d.title}
          </div>
        ))}
      </HqPanel>
    )}
  </>
);

const IntelligencePanel: React.FC<{ data: MissionControlCommandCenter }> = ({ data }) => {
  const intel = data.missionIntelligence;
  const recs = (intel.recommendations ?? []) as { action?: string; priority?: string }[];
  return (
    <>
      <div className="hq-kpi-grid hq-mb-md">
        <KpiCard label="Bottlenecks" value={intel.bottlenecks?.length ?? 0} icon={AlertTriangle} variant="warning" />
        <KpiCard label="Opportunities" value={intel.opportunities?.length ?? 0} icon={Target} variant="success" />
        <KpiCard label="Recommendations" value={recs.length} icon={Brain} variant="gold" />
      </div>

      <div className="hq-grid-2">
        <HqPanel title="Bottlenecks" subtitle="Overdue pending tasks">
          {(intel.bottlenecks ?? []).map((t) => (
            <div key={t.id} style={{ marginBottom: "0.5rem", fontSize: "0.85rem" }}>{t.title} · due {t.due_date ?? "—"}</div>
          ))}
          {(intel.bottlenecks ?? []).length === 0 && <p className="hq-muted-text">No bottlenecks detected.</p>}
        </HqPanel>

        <HqPanel title="Opportunities" subtitle="Objectives above 75% progress">
          {(intel.opportunities ?? []).map((o) => (
            <div key={o.id} style={{ marginBottom: "0.5rem", fontSize: "0.85rem" }}>{o.title} · {o.progress_pct ?? 0}%</div>
          ))}
          {(intel.opportunities ?? []).length === 0 && <p className="hq-muted-text">No high-progress objectives yet.</p>}
        </HqPanel>
      </div>

      <HqPanel title="Recommendations" subtitle="Strategic actions from intelligence engines" className="hq-mt-lg">
        {recs.map((r, i) => (
          <div key={i} style={{ marginBottom: "0.5rem", fontSize: "0.85rem" }}>
            <StatusBadge label={r.priority ?? "medium"} variant="muted" />
            <span style={{ marginLeft: "0.5rem" }}>{r.action ?? JSON.stringify(r)}</span>
          </div>
        ))}
        {recs.length === 0 && <p className="hq-muted-text">Recommendations populate when AURA and analytics engines run.</p>}
      </HqPanel>
    </>
  );
};

const AuditPanel: React.FC<{ data: MissionControlCommandCenter }> = ({ data }) => (
  <HqPanel title="Audit & History" subtitle="User, timestamp, action, previous value, new value">
    <table className="hq-table">
      <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Previous</th><th>New</th></tr></thead>
      <tbody>
        {(data.auditHistory.entries ?? []).map((e) => {
          const meta = parseAuditMeta(e.metadata_json ?? e.metadata);
          return (
            <tr key={e.id}>
              <td>{new Date(e.created_at).toLocaleString()}</td>
              <td>{e.actor_email ?? "—"}</td>
              <td>{e.action}</td>
              <td>{e.entity_type ?? "—"}</td>
              <td style={{ maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis" }}>
                {meta.previous ? JSON.stringify(meta.previous).slice(0, 80) : "—"}
              </td>
              <td style={{ maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis" }}>
                {meta.next ? JSON.stringify(meta.next).slice(0, 80) : e.summary ?? "—"}
              </td>
            </tr>
          );
        })}
        {(data.auditHistory.entries ?? []).length === 0 && (
          <tr><td colSpan={6} className="hq-muted-text">No audit entries yet — actions are recorded on every write.</td></tr>
        )}
      </tbody>
    </table>
  </HqPanel>
);
