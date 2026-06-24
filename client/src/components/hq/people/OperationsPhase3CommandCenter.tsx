import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Users, CheckSquare, Megaphone, FileCheck, Calendar, Package, Truck, Plus } from "lucide-react";
import { operationsApi } from "../../../api/operationsApi";
import { peopleApi } from "../../../api/peopleApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

const ICONS: Record<string, React.ElementType> = {
  departments: Building2, teams: Users, tasks: CheckSquare, announcements: Megaphone,
  documents: FileCheck, meetings: Calendar, assets: Package, vehicles: Truck, calendar: Calendar,
};

export const OperationsPhase3CommandCenter: React.FC = () => {
  const platform = useQuery({ queryKey: ["ops-command-v3"], queryFn: operationsApi.commandCenterV3 });
  const tasks = useQuery({ queryKey: ["ops-tasks"], queryFn: () => operationsApi.tasks("open") });
  const teams = useQuery({ queryKey: ["team-assignments"], queryFn: () => peopleApi.teamAssignments() });
  const qc = useQueryClient();
  const [newTask, setNewTask] = useState({ title: "", priority: "normal" });
  const createTask = useMutation({
    mutationFn: () => operationsApi.createTask(newTask),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops-tasks"] }); qc.invalidateQueries({ queryKey: ["ops-command-v3"] }); setNewTask({ title: "", priority: "normal" }); },
  });

  if (platform.isLoading) return <HqLoading message="Loading Operations Command Center…" />;

  const counts = (platform.data?.counts ?? {}) as Record<string, number>;
  const modules = (platform.data?.modules ?? []) as { id: string; label: string; path?: string; tab?: string }[];

  return (
    <div className="hq-fade-in">
      <HqPanel title="Operations Command Center" subtitle="Phase 3 — departments, teams, tasks, announcements, assets, and organization calendar">
        <StatusBadge label="PHASE 3 OPERATIONS" variant="gold" />
        <div className="hq-kpi-grid" style={{ marginTop: "1rem" }}>
          <KpiCard label="Departments" value={counts.departments ?? 0} icon={Building2} variant="gold" />
          <KpiCard label="Team Assignments" value={counts.teamAssignments ?? 0} icon={Users} />
          <KpiCard label="Open Tasks" value={counts.openTasks ?? 0} icon={CheckSquare} variant="warning" />
          <KpiCard label="Announcements" value={counts.announcements ?? 0} icon={Megaphone} />
          <KpiCard label="Doc Approvals" value={counts.pendingDocumentApprovals ?? 0} icon={FileCheck} variant="warning" />
          <KpiCard label="Upcoming Events" value={counts.upcomingEvents ?? 0} icon={Calendar} />
        </div>
      </HqPanel>

      <div className="hq-module-grid" style={{ marginTop: "1.25rem", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.75rem" }}>
        {modules.map((m) => {
          const Icon = ICONS[m.id] ?? Building2;
          const to = m.path ?? "/hq/operations";
          return (
            <Link key={m.id} to={to} className="hq-panel hq-module-card" style={{ textDecoration: "none", padding: "1rem" }}>
              <Icon size={20} style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }} />
              <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "inherit" }}>{m.label}</div>
            </Link>
          );
        })}
      </div>

      <div style={{ marginTop: "1.25rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.25rem" }}>
        <HqPanel title="Task Management" subtitle="Open operational tasks">
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <input className="hq-input" placeholder="New task title" value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} />
            <button type="button" className="hq-btn hq-btn-primary" disabled={!newTask.title || createTask.isPending} onClick={() => createTask.mutate()}><Plus size={14} /></button>
          </div>
          <table className="hq-table">
            <thead><tr><th>Task</th><th>Priority</th><th>Due</th></tr></thead>
            <tbody>
              {(tasks.data?.tasks ?? []).slice(0, 8).map((t) => (
                <tr key={String(t.id)}><td>{String(t.title)}</td><td><StatusBadge label={String(t.priority)} variant="muted" /></td><td>{String(t.due_date ?? "—")}</td></tr>
              ))}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Team Assignments" subtitle="Active team and project assignments">
          <table className="hq-table">
            <thead><tr><th>Person</th><th>Team</th><th>Role</th></tr></thead>
            <tbody>
              {(teams.data?.assignments ?? []).slice(0, 8).map((a) => (
                <tr key={String(a.id)}><td>{String(a.first_name)} {String(a.last_name)}</td><td>{String(a.team_name)}</td><td>{String(a.role ?? "—")}</td></tr>
              ))}
              {(teams.data?.assignments ?? []).length === 0 && <tr><td colSpan={3} className="hq-muted-text">No team assignments yet.</td></tr>}
            </tbody>
          </table>
        </HqPanel>
      </div>
    </div>
  );
};
