import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Palmtree, Award, GraduationCap, ClipboardCheck, DollarSign, User, Upload } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { peopleApi } from "../../api/peopleApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
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

  const clockIn = useMutation({ mutationFn: peopleApi.selfClockIn, onSuccess: () => qc.invalidateQueries({ queryKey: ["self-service-me"] }) });
  const clockOut = useMutation({ mutationFn: peopleApi.selfClockOut, onSuccess: () => qc.invalidateQueries({ queryKey: ["self-service-me"] }) });
  const leave = useMutation({
    mutationFn: () => peopleApi.selfCreateLeave(leaveForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["self-service-me"] }); setLeaveForm({ leave_type: "pto", start_date: "", end_date: "", reason: "" }); },
  });
  const profile = useMutation({
    mutationFn: () => peopleApi.selfUpdateProfile(profileForm),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["self-service-me"] }),
  });
  const upload = useMutation({
    mutationFn: (data: { fileName: string; base64: string; mimeType: string; name: string }) => peopleApi.selfUploadDocument(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["self-service-me"] }),
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

  return (
    <HQLayout title="My Workspace" subtitle={`Welcome, ${person.fullName} — clock, leave, onboarding, and pay history`}>
      <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Clock Status" value={clock.active ? "On Clock" : "Off Clock"} icon={Clock} variant={clock.active ? "success" : "muted"} />
        <KpiCard label="Hours This Month" value={Number(clock.hoursThisMonth ?? 0).toFixed(1)} icon={Clock} />
        <KpiCard label="Onboarding" value={`${summary.onboardingComplete}/${summary.onboardingTotal}`} icon={ClipboardCheck} variant="gold" />
        <KpiCard label="Pending Leave" value={summary.pendingLeave} icon={Palmtree} variant={summary.pendingLeave > 0 ? "warning" : "muted"} />
      </div>

      <div className="hq-founder-command-strip hq-fade-in" style={{ marginBottom: "1.25rem" }}>
        <button type="button" className="hq-btn hq-btn-primary" disabled={clock.active || clockIn.isPending} onClick={() => clockIn.mutate()}><Clock size={14} /> Clock In</button>
        <button type="button" className="hq-btn hq-btn-secondary" disabled={!clock.active || clockOut.isPending} onClick={() => clockOut.mutate()}>Clock Out</button>
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
        <HqPanel title="Onboarding Checklist" subtitle="Required steps for your role">
          <ul className="hq-mini-list">
            {((data.onboarding ?? []) as { task_label: string; completed: number }[]).map((t, i) => (
              <li key={i}>{t.completed ? "✓" : "○"} {t.task_label}</li>
            ))}
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

        <HqPanel title="Upload Personnel Document" subtitle="Stored securely in Headquarters Document Center">
          <input type="file" className="hq-input" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const { base64, mimeType } = await fileToBase64(file);
            upload.mutate({ fileName: file.name, base64, mimeType, name: file.name, doc_type: "personnel" });
            e.target.value = "";
          }} />
          {upload.isPending && <p className="hq-muted-text" style={{ marginTop: "0.5rem" }}><Upload size={12} /> Uploading…</p>}
        </HqPanel>
      </div>
    </HQLayout>
  );
};

export default StaffSelfServicePage;
