import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Plus } from "lucide-react";
import { peopleApi } from "../../../api/peopleApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

export const PeopleTimesheetsPanel: React.FC = () => {
  const qc = useQueryClient();
  const timesheets = useQuery({ queryKey: ["payroll-timesheets"], queryFn: () => peopleApi.timesheets() });
  const directory = useQuery({ queryKey: ["people-directory-ts"], queryFn: () => peopleApi.list({ type: "employee" }) });
  const [form, setForm] = useState({ person_id: "", period_start: "", period_end: "" });

  const create = useMutation({
    mutationFn: () => peopleApi.createTimesheet(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payroll-timesheets"] }); setForm({ person_id: "", period_start: "", period_end: "" }); },
  });

  const submit = useMutation({
    mutationFn: (id: string) => peopleApi.updateTimesheet(id, "submitted"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll-timesheets"] }),
  });

  const approve = useMutation({
    mutationFn: (id: string) => peopleApi.updateTimesheet(id, "approved"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll-timesheets"] }),
  });

  return (
    <HqPanel title="Timesheets" subtitle="Period-based time submission from HQ time clock entries">
      <div className="hq-form-grid" style={{ marginBottom: "1rem" }}>
        <select className="hq-input" value={form.person_id} onChange={(e) => setForm({ ...form, person_id: e.target.value })}>
          <option value="">Select employee</option>
          {(directory.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
        </select>
        <input type="date" className="hq-input" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
        <input type="date" className="hq-input" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
        <button type="button" className="hq-btn hq-btn-primary" disabled={!form.person_id || !form.period_start || !form.period_end || create.isPending} onClick={() => create.mutate()}>
          <Plus size={14} /> Generate Timesheet
        </button>
      </div>
      {timesheets.isLoading ? <HqLoading /> : (
        <table className="hq-table">
          <thead><tr><th>Employee</th><th>Period</th><th>Hours</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {(timesheets.data?.timesheets ?? []).map((t) => (
              <tr key={String(t.id)}>
                <td>{String(t.first_name)} {String(t.last_name)}</td>
                <td>{String(t.period_start)} – {String(t.period_end)}</td>
                <td><Clock size={12} style={{ display: "inline", marginRight: 4 }} />{String(t.total_hours ?? 0)}</td>
                <td><StatusBadge label={String(t.status)} variant={t.status === "approved" ? "success" : "muted"} /></td>
                <td>
                  <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                    {t.status === "draft" && (
                      <button type="button" className="hq-btn hq-btn-sm" onClick={() => submit.mutate(String(t.id))}>Submit</button>
                    )}
                    {t.status === "submitted" && (
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => approve.mutate(String(t.id))}>Approve</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {(timesheets.data?.timesheets ?? []).length === 0 && <tr><td colSpan={5} className="hq-muted-text">No timesheets yet — generate from time clock data.</td></tr>}
          </tbody>
        </table>
      )}
    </HqPanel>
  );
};
