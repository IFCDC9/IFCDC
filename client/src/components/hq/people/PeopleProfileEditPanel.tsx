import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Pencil } from "lucide-react";
import { peopleApi, type Person } from "../../../api/peopleApi";
import { HqPanel } from "../HqPanel";

const ENTERPRISE_ROLES = [
  "employee", "manager", "program_director", "hr", "finance", "executive", "administrator", "volunteer", "contractor", "board_member",
];

interface Props {
  person: Person;
  personId: string;
}

export const PeopleProfileEditPanel: React.FC<Props> = ({ person, personId }) => {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const departments = useQuery({ queryKey: ["people-departments"], queryFn: peopleApi.departments });
  const positions = useQuery({ queryKey: ["people-positions"], queryFn: peopleApi.positions });
  const managers = useQuery({ queryKey: ["people-managers"], queryFn: () => peopleApi.list({ type: "employee" }) });

  const [form, setForm] = useState({
    organization_role: person.organizationRole ?? "",
    enterprise_role: person.enterpriseRole ?? "employee",
    department_id: person.departmentId ?? "",
    position_id: person.positionId ?? "",
    reports_to_person_id: person.reportsToPersonId ?? "",
    pay_rate: person.payRate != null ? String(person.payRate) : "",
    pay_type: person.payType ?? "hourly",
    payroll_status: person.payrollStatus ?? "active",
    status: person.status,
    location: person.location ?? "",
    notes: person.notes ?? "",
  });

  useEffect(() => {
    setForm({
      organization_role: person.organizationRole ?? "",
      enterprise_role: person.enterpriseRole ?? "employee",
      department_id: person.departmentId ?? "",
      position_id: person.positionId ?? "",
      reports_to_person_id: person.reportsToPersonId ?? "",
      pay_rate: person.payRate != null ? String(person.payRate) : "",
      pay_type: person.payType ?? "hourly",
      payroll_status: person.payrollStatus ?? "active",
      status: person.status,
      location: person.location ?? "",
      notes: person.notes ?? "",
    });
  }, [person]);

  const save = useMutation({
    mutationFn: () => peopleApi.update(personId, {
      organization_role: form.organization_role || null,
      enterprise_role: form.enterprise_role || null,
      department_id: form.department_id || null,
      position_id: form.position_id || null,
      reports_to_person_id: form.reports_to_person_id || null,
      pay_rate: form.pay_rate ? Number(form.pay_rate) : null,
      pay_type: form.pay_type,
      payroll_status: form.payroll_status,
      status: form.status,
      location: form.location || null,
      notes: form.notes || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["people-profile", personId] });
      qc.invalidateQueries({ queryKey: ["people-org-chart"] });
      qc.invalidateQueries({ queryKey: ["people-org-structure"] });
      qc.invalidateQueries({ queryKey: ["people-directory"] });
      setEditing(false);
    },
  });

  if (!editing) {
    return (
      <div style={{ marginBottom: "1rem" }}>
        <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setEditing(true)}>
          <Pencil size={14} /> Edit Employment Record
        </button>
      </div>
    );
  }

  return (
    <HqPanel title="Edit Employment Record" subtitle="Department, position, manager, payroll, and enterprise role">
      <div className="hq-form-grid" style={{ marginBottom: "1rem" }}>
        <input className="hq-input" placeholder="Organization role / title" value={form.organization_role} onChange={(e) => setForm({ ...form, organization_role: e.target.value })} />
        <select className="hq-input" value={form.enterprise_role} onChange={(e) => setForm({ ...form, enterprise_role: e.target.value })}>
          {ENTERPRISE_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
        </select>
        <select className="hq-input" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
          <option value="">Department</option>
          {(departments.data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="hq-input" value={form.position_id} onChange={(e) => setForm({ ...form, position_id: e.target.value })}>
          <option value="">Position</option>
          {(positions.data?.positions ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <select className="hq-input" value={form.reports_to_person_id} onChange={(e) => setForm({ ...form, reports_to_person_id: e.target.value })}>
          <option value="">Reports to (manager)</option>
          {(managers.data?.people ?? []).filter((p) => p.id !== personId).map((p) => (
            <option key={p.id} value={p.id}>{p.fullName}</option>
          ))}
        </select>
        <input className="hq-input" type="number" step="0.01" placeholder="Pay rate" value={form.pay_rate} onChange={(e) => setForm({ ...form, pay_rate: e.target.value })} />
        <select className="hq-input" value={form.pay_type} onChange={(e) => setForm({ ...form, pay_type: e.target.value })}>
          <option value="hourly">Hourly</option>
          <option value="salary">Salary</option>
          <option value="contract">Contract</option>
        </select>
        <select className="hq-input" value={form.payroll_status} onChange={(e) => setForm({ ...form, payroll_status: e.target.value })}>
          <option value="active">Payroll Active</option>
          <option value="inactive">Payroll Inactive</option>
          <option value="on_hold">On Hold</option>
        </select>
        <select className="hq-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="active">Active</option>
          <option value="on_leave">On Leave</option>
          <option value="inactive">Inactive</option>
        </select>
        <input className="hq-input" placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        <textarea className="hq-input" placeholder="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ gridColumn: "1 / -1" }} />
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="hq-btn hq-btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save size={14} /> Save Changes
        </button>
        <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </HqPanel>
  );
};
