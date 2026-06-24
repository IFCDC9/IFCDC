import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { peopleApi } from "../../../api/peopleApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

export const PeopleJobApplicantsPanel: React.FC = () => {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", position_applied: "" });

  const applicants = useQuery({ queryKey: ["job-applicants"], queryFn: () => peopleApi.jobApplicants() });
  const create = useMutation({
    mutationFn: () => peopleApi.createJobApplicant(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["job-applicants"] }); qc.invalidateQueries({ queryKey: ["people-phase3-platform"] }); setShowAdd(false); setForm({ first_name: "", last_name: "", email: "", position_applied: "" }); },
  });
  const hire = useMutation({
    mutationFn: (id: string) => peopleApi.hireJobApplicant(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["job-applicants"] }); qc.invalidateQueries({ queryKey: ["people-overview"] }); qc.invalidateQueries({ queryKey: ["people-phase3-platform"] }); },
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => peopleApi.updateJobApplicant(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-applicants"] }),
  });

  return (
    <HqPanel title="Job Applicants" subtitle="Applicant pipeline — review, interview, and hire into employee directory">
      <div style={{ marginBottom: "1rem" }}>
        <button type="button" className="hq-btn hq-btn-primary" onClick={() => setShowAdd(!showAdd)}><UserPlus size={14} /> Add Applicant</button>
      </div>
      {showAdd && (
        <div className="hq-form-grid" style={{ marginBottom: "1rem" }}>
          <input className="hq-input" placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <input className="hq-input" placeholder="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <input className="hq-input" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="hq-input" placeholder="Position applied" value={form.position_applied} onChange={(e) => setForm({ ...form, position_applied: e.target.value })} />
          <button type="button" className="hq-btn hq-btn-primary" disabled={!form.first_name || !form.last_name || create.isPending} onClick={() => create.mutate()}>Submit</button>
        </div>
      )}
      {applicants.isLoading ? <HqLoading /> : (
        <table className="hq-table">
          <thead><tr><th>Name</th><th>Position</th><th>Applied</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {(applicants.data?.applicants ?? []).map((a) => (
              <tr key={a.id}>
                <td>{a.first_name} {a.last_name}</td>
                <td>{a.position_applied ?? "—"}</td>
                <td>{new Date(a.applied_at).toLocaleDateString()}</td>
                <td><StatusBadge label={a.status} variant={a.status === "hired" ? "success" : a.status === "new" ? "gold" : "muted"} /></td>
                <td style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                  {a.status !== "hired" && (
                    <>
                      <button type="button" className="hq-btn hq-btn-sm" onClick={() => updateStatus.mutate({ id: a.id, status: "reviewing" })}>Review</button>
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => hire.mutate(a.id)}>Hire</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </HqPanel>
  );
};
