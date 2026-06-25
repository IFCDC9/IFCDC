import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Palmtree, Award, GraduationCap, ClipboardCheck, Upload, FileText, Sparkles } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { peopleApi } from "../../api/peopleApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { PeopleHrAuraBriefingPanel } from "../../components/hq/people/PeopleHrComplianceDashboard";
import { formatCurrency } from "../../utils/safeFormat";

const fmt = formatCurrency;

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve({ base64, mimeType: file.type || "application/octet-stream" });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const StaffSelfServicePage: React.FC = () => {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["self-service-me"], queryFn: peopleApi.selfServiceMe });
  const [leaveForm, setLeaveForm] = useState({ leave_type: "pto", start_date: "", end_date: "", reason: "" });
  const [profileForm, setProfileForm] = useState({ phone: "", location: "", emergency_contact: "", emergency_phone: "" });
  const [docType, setDocType] = useState("personnel");
  const [flash, setFlash] = useState<string | null>(null);

  const personData = me.data?.person as { phone?: string; location?: string; emergencyContact?: string; emergencyPhone?: string } | undefined;
  useEffect(() => {
    if (!personData) return;
    setProfileForm({
      phone: personData.phone ?? "",
      location: personData.location ?? "",
      emergency_contact: personData.emergencyContact ?? "",
      emergency_phone: personData.emergencyPhone ?? "",
    });
  }, [personData?.phone, personData?.location, personData?.emergencyContact, personData?.emergencyPhone]);

  const notify = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 4000); };

  const clockIn = useMutation({ mutationFn: peopleApi.selfClockIn, onSuccess: () => { qc.invalidateQueries({ queryKey: ["self-service-me"] }); notify("Clocked in successfully"); } });
  const clockOut = useMutation({ mutationFn: peopleApi.selfClockOut, onSuccess: () => { qc.invalidateQueries({ queryKey: ["self-service-me"] }); notify("Clocked out successfully"); } });
  const leave = useMutation({
    mutationFn: () => peopleApi.selfCreateLeave(leaveForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["self-service-me"] }); setLeaveForm({ leave_type: "pto", start_date: "", end_date: "", reason: "" }); notify("Leave request submitted"); },
  });
  const profile = useMutation({
    mutationFn: () => peopleApi.selfUpdateProfile(profileForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["self-service-me"] }); notify("Profile updated"); },
  });
  const upload = useMutation({
    mutationFn: (data: { fileName: string; base64: string; mimeType: string; name: string; doc_type: string }) => peopleApi.selfUploadDocument(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["self-service-me"] }); notify("Document uploaded to Document Center"); },
  });
  const submitTimesheet = useMutation({
    mutationFn: peopleApi.selfSubmitTimesheet,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["self-service-me"] }); notify("Timesheet submitted for manager approval"); },
  });
  const completeOnboarding = useMutation({
    mutationFn: (itemId: string) => peopleApi.selfCompleteOnboarding(itemId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["self-service-me"] }); notify("Onboarding step marked complete"); },
  });

  if (me.isLoading) {
    return <HQLayout title="My Workspace" subtitle="Staff self-service portal"><HqLoading /></HQLayout>;
  }
  if (me.isError || !me.data?.person) {
    return (
      <HQLayout title="My Workspace" subtitle="Staff self-service portal">
        <HqPanel title="Account Not Linked">
          <p className="hq-muted-text">Your login is not yet linked to an employee record. Contact HR to complete onboarding.</p>
        </HqPanel>
      </HQLayout>
    );
  }

  const data = me.data;
  const person = data.person as { fullName: string; organizationRole?: string; departmentName?: string };
  const clock = data.clock as { active: boolean; hoursThisMonth: number };
  const summary = data.summary as { onboardingComplete: number; onboardingTotal: number; pendingLeave: number };
  const pto = data.ptoBalance as { pto_hours?: number; used_pto?: number; sick_hours?: number; used_sick?: number } | null;
  const leaveRequests = (data.leaveRequests ?? []) as { id: string; leave_type: string; start_date: string; end_date: string; status: string }[];
  const timesheets = (data.timesheets ?? []) as { id: string; period_start: string; period_end: string; total_hours: number; status: string }[];
  const documents = (data.documents ?? []) as { id: string; name: string; doc_type: string; file_url: string; uploaded_at: string }[];
  const onboarding = (data.onboarding ?? []) as { id: string; task_label: string; completed: number }[];

  return (
    <HQLayout title="My Workspace" subtitle={`Welcome, ${person.fullName} — clock, leave, onboarding, and pay history`}>
      {flash && <div className="hq-founder-command-strip hq-fade-in" style={{ marginBottom: "1rem" }}><StatusBadge label={flash} variant="success" /></div>}

      <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Clock Status" value={clock.active ? "On Clock" : "Off Clock"} icon={Clock} variant={clock.active ? "success" : "muted"} />
        <KpiCard label="Hours This Month" value={Number(clock.hoursThisMonth ?? 0).toFixed(1)} icon={Clock} />
        <KpiCard label="PTO Balance" value={pto ? `${Math.max(0, (pto.pto_hours ?? 0) - (pto.used_pto ?? 0)).toFixed(0)}h` : "—"} icon={Palmtree} variant="gold" />
        <KpiCard label="Onboarding" value={`${summary.onboardingComplete}/${summary.onboardingTotal}`} icon={ClipboardCheck} variant="gold" />
      </div>

      <div className="hq-founder-command-strip hq-fade-in" style={{ marginBottom: "1.25rem" }}>
        <button type="button" className="hq-btn hq-btn-primary" disabled={clock.active || clockIn.isPending} onClick={() => clockIn.mutate()}><Clock size={14} /> Clock In</button>
        <button type="button" className="hq-btn hq-btn-secondary" disabled={!clock.active || clockOut.isPending} onClick={() => clockOut.mutate()}>Clock Out</button>
        <button type="button" className="hq-btn hq-btn-secondary" disabled={submitTimesheet.isPending} onClick={() => submitTimesheet.mutate()}><FileText size={14} /> Submit Timesheet</button>
        <Link to="/hq/documents" className="hq-btn hq-btn-secondary"><Upload size={14} /> Document Center</Link>
      </div>

      <div style={{ marginBottom: "1.25rem" }}>
        <PeopleHrAuraBriefingPanel audience="staff" />
      </div>

      <div className="hq-grid-2 hq-fade-in">
        <HqPanel title="Request Leave" subtitle="PTO, sick leave, and time off">
          <div className="hq-form-grid">
            <select className="hq-input" value={leaveForm.leave_type} onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}>
              <option value="pto">PTO</option><option value="sick">Sick</option><option value="personal">Personal</option>
            </select>
            <input type="date" className="hq-input" value={leaveForm.start_date} onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })} />
            <input type="date" className="hq-input" value={leaveForm.end_date} onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })} />
            <input className="hq-input" placeholder="Reason (optional)" value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} />
            <button type="button" className="hq-btn hq-btn-primary" disabled={!leaveForm.start_date || !leaveForm.end_date || leave.isPending} onClick={() => leave.mutate()}>Submit Request</button>
          </div>
          <h4 style={{ fontSize: "0.8rem", color: "var(--hq-gold)", margin: "1rem 0 0.5rem" }}>Leave History</h4>
          <table className="hq-table">
            <thead><tr><th>Type</th><th>Dates</th><th>Status</th></tr></thead>
            <tbody>
              {leaveRequests.map((lr) => (
                <tr key={lr.id}><td>{lr.leave_type}</td><td>{lr.start_date} – {lr.end_date}</td><td><StatusBadge label={lr.status} variant={lr.status === "approved" ? "success" : lr.status === "pending" ? "warning" : "muted"} /></td></tr>
              ))}
              {leaveRequests.length === 0 && <tr><td colSpan={3} className="hq-muted-text">No leave requests yet.</td></tr>}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="My Profile" subtitle="Update contact information">
          <div className="hq-form-grid">
            <input className="hq-input" placeholder="Phone" value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} />
            <input className="hq-input" placeholder="Location" value={profileForm.location} onChange={(e) => setProfileForm({ ...profileForm, location: e.target.value })} />
            <input className="hq-input" placeholder="Emergency contact" value={profileForm.emergency_contact} onChange={(e) => setProfileForm({ ...profileForm, emergency_contact: e.target.value })} />
            <input className="hq-input" placeholder="Emergency phone" value={profileForm.emergency_phone} onChange={(e) => setProfileForm({ ...profileForm, emergency_phone: e.target.value })} />
            <button type="button" className="hq-btn hq-btn-secondary" disabled={profile.isPending} onClick={() => profile.mutate()}>Save Profile</button>
          </div>
        </HqPanel>
      </div>

      <div className="hq-grid-2 hq-fade-in" style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Onboarding Checklist" subtitle="Mark completed steps">
          <ul className="hq-mini-list">
            {onboarding.map((t) => (
              <li key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {t.completed ? "✓" : (
                  <button type="button" className="hq-btn hq-btn-sm" disabled={completeOnboarding.isPending} onClick={() => completeOnboarding.mutate(t.id)}>Complete</button>
                )}
                {t.task_label}
              </li>
            ))}
            {onboarding.length === 0 && <li className="hq-muted-text">No onboarding tasks assigned.</li>}
          </ul>
        </HqPanel>

        <HqPanel title="Certifications & Training" subtitle="Compliance and professional development">
          <h4 style={{ fontSize: "0.8rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}><Award size={12} style={{ display: "inline" }} /> Certifications</h4>
          <ul className="hq-mini-list">
            {((data.certifications ?? []) as { name: string; expiry_date?: string }[]).map((c, i) => (
              <li key={i}>{c.name}{c.expiry_date ? ` — exp. ${c.expiry_date}` : ""}</li>
            ))}
            {(data.certifications as unknown[])?.length === 0 && <li className="hq-muted-text">No certifications on file</li>}
          </ul>
          <h4 style={{ fontSize: "0.8rem", color: "var(--hq-gold)", margin: "1rem 0 0.5rem" }}><GraduationCap size={12} style={{ display: "inline" }} /> Training</h4>
          <ul className="hq-mini-list">
            {((data.training ?? []) as { title: string; status: string }[]).map((t, i) => (
              <li key={i}>{t.title} — <StatusBadge label={t.status} variant="muted" /></li>
            ))}
          </ul>
        </HqPanel>
      </div>

      <div className="hq-grid-2 hq-fade-in" style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Timesheets" subtitle="Monthly submissions and status">
          <table className="hq-table">
            <thead><tr><th>Period</th><th>Hours</th><th>Status</th></tr></thead>
            <tbody>
              {timesheets.map((t) => (
                <tr key={t.id}><td>{t.period_start} – {t.period_end}</td><td>{t.total_hours}</td><td><StatusBadge label={t.status} variant={t.status === "approved" ? "success" : "warning"} /></td></tr>
              ))}
              {timesheets.length === 0 && <tr><td colSpan={3} className="hq-muted-text">Submit your first timesheet using the button above.</td></tr>}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Pay History" subtitle="Payroll runs when Finance Center is connected">
          <table className="hq-table">
            <thead><tr><th>Period</th><th>Hours</th><th>Net</th><th>Status</th></tr></thead>
            <tbody>
              {((data.payHistory ?? []) as { period_start: string; period_end: string; hours: number; net_cents: number; run_status: string }[]).map((p, i) => (
                <tr key={i}><td>{p.period_start} – {p.period_end}</td><td>{p.hours}</td><td>{fmt(p.net_cents / 100)}</td><td><StatusBadge label={p.run_status} variant="muted" /></td></tr>
              ))}
              {(data.payHistory as unknown[])?.length === 0 && <tr><td colSpan={4} className="hq-muted-text">Pay history appears after payroll is processed.</td></tr>}
            </tbody>
          </table>
        </HqPanel>
      </div>

      <div className="hq-grid-2 hq-fade-in" style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Upload Personnel Document" subtitle="Stored securely in Headquarters Document Center">
          <select className="hq-input" value={docType} onChange={(e) => setDocType(e.target.value)} style={{ marginBottom: "0.5rem" }}>
            <option value="personnel">Personnel File</option>
            <option value="certification">Certification</option>
            <option value="training">Training Record</option>
            <option value="policy_ack">Policy Acknowledgement</option>
          </select>
          <input type="file" className="hq-input" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const { base64, mimeType } = await fileToBase64(file);
            upload.mutate({ fileName: file.name, base64, mimeType, name: file.name, doc_type: docType });
            e.target.value = "";
          }} />
          {upload.isPending && <p className="hq-muted-text" style={{ marginTop: "0.5rem" }}><Upload size={12} /> Uploading…</p>}
        </HqPanel>

        <HqPanel title="My Documents" subtitle="Files in Document Center">
          <table className="hq-table">
            <thead><tr><th>Name</th><th>Type</th><th>Uploaded</th></tr></thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td>{d.file_url ? <a href={d.file_url} className="hq-entity-link" target="_blank" rel="noreferrer">{d.name}</a> : d.name}</td>
                  <td>{d.doc_type}</td>
                  <td>{new Date(d.uploaded_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {documents.length === 0 && <tr><td colSpan={3} className="hq-muted-text">No documents uploaded yet.</td></tr>}
            </tbody>
          </table>
        </HqPanel>
      </div>
    </HQLayout>
  );
};

export default StaffSelfServicePage;
