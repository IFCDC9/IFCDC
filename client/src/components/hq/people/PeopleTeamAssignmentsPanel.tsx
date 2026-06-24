import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus } from "lucide-react";
import { peopleApi } from "../../../api/peopleApi";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";

export const PeopleTeamAssignmentsPanel: React.FC = () => {
  const qc = useQueryClient();
  const assignments = useQuery({ queryKey: ["team-assignments"], queryFn: () => peopleApi.teamAssignments() });
  const directory = useQuery({ queryKey: ["people-directory-teams"], queryFn: () => peopleApi.list({ type: "employee" }) });
  const departments = useQuery({ queryKey: ["people-departments-teams"], queryFn: peopleApi.departments });
  const [form, setForm] = useState({ person_id: "", team_name: "", department_id: "", role: "" });

  const create = useMutation({
    mutationFn: () => peopleApi.createTeamAssignment({
      person_id: form.person_id,
      team_name: form.team_name,
      department_id: form.department_id || undefined,
      role: form.role || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-assignments"] });
      setForm({ person_id: "", team_name: "", department_id: "", role: "" });
    },
  });

  return (
    <HqPanel title="Team Assignments" subtitle="Cross-functional teams and project assignments across departments">
      <div className="hq-form-grid" style={{ marginBottom: "1rem" }}>
        <select className="hq-input" value={form.person_id} onChange={(e) => setForm({ ...form, person_id: e.target.value })}>
          <option value="">Select person</option>
          {(directory.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
        </select>
        <input className="hq-input" placeholder="Team name" value={form.team_name} onChange={(e) => setForm({ ...form, team_name: e.target.value })} />
        <select className="hq-input" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
          <option value="">Department (optional)</option>
          {(departments.data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input className="hq-input" placeholder="Role on team" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
        <button type="button" className="hq-btn hq-btn-primary" disabled={!form.person_id || !form.team_name || create.isPending} onClick={() => create.mutate()}>
          <Plus size={14} /> Assign
        </button>
      </div>
      {assignments.isLoading ? <HqLoading /> : (
        <table className="hq-table">
          <thead><tr><th>Person</th><th>Team</th><th>Department</th><th>Role</th></tr></thead>
          <tbody>
            {(assignments.data?.assignments ?? []).map((a) => (
              <tr key={String(a.id)}>
                <td><Users size={12} style={{ display: "inline", marginRight: 4 }} />{String(a.first_name)} {String(a.last_name)}</td>
                <td>{String(a.team_name)}</td>
                <td>{String(a.department_name ?? "—")}</td>
                <td>{String(a.role ?? "—")}</td>
              </tr>
            ))}
            {(assignments.data?.assignments ?? []).length === 0 && <tr><td colSpan={4} className="hq-muted-text">No team assignments yet.</td></tr>}
          </tbody>
        </table>
      )}
    </HqPanel>
  );
};
