import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Palmtree, Clock, Star, CheckCircle, XCircle, ClipboardCheck, Shield, DollarSign } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { peopleApi } from "../../api/peopleApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { PeopleHrAuraBriefingPanel } from "../../components/hq/people/PeopleHrComplianceDashboard";

const ManagerPortalPage: React.FC = () => {
  const qc = useQueryClient();
  const dash = useQuery({ queryKey: ["manager-dashboard"], queryFn: peopleApi.managerDashboard });
  const [denyNotes, setDenyNotes] = useState<Record<string, string>>({});

  const reviewLeave = useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: string; notes?: string }) => peopleApi.managerReviewLeave(id, { status, notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manager-dashboard"] }),
  });
  const reviewTimesheet = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => peopleApi.managerReviewTimesheet(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manager-dashboard"] }),
  });
  const approveOnboarding = useMutation({
    mutationFn: ({ personId, itemId }: { personId: string; itemId: string }) => peopleApi.managerCompleteOnboarding(personId, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manager-dashboard"] }),
  });
  const payrollPrep = useMutation({
    mutationFn: () => peopleApi.preparePayrollBatch(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manager-dashboard"] }),
  });

  if (dash.isLoading) return <HQLayout title="Manager Portal" subtitle="Department-scoped team management"><HqLoading /></HQLayout>;
  if (dash.isError) {
    return (
      <HQLayout title="Manager Portal" subtitle="Department-scoped team management">
        <HqPanel title="Manager Profile Required">
          <p className="hq-muted-text">Link your user account to an employee record with manager permissions to access this portal.</p>
          <Link to="/hq/people" className="hq-entity-link">People & HR →</Link>
        </HqPanel>
      </HQLayout>
    );
  }

  const summary = (dash.data?.summary ?? {}) as Record<string, number>;
  const team = (dash.data?.team ?? []) as Record<string, unknown>[];
  const pendingLeave = (dash.data?.pendingLeave ?? []) as Record<string, unknown>[];
  const pendingTimesheets = (dash.data?.pendingTimesheets ?? []) as Record<string, unknown>[];
  const pendingOnboarding = (dash.data?.pendingOnboarding ?? []) as Record<string, unknown>[];
  const complianceAlerts = (dash.data?.complianceAlerts ?? []) as Record<string, unknown>[];
  const complianceScore = (dash.data?.complianceScore ?? {}) as { score: number; grade: string };
  const attendance = (dash.data?.attendance ?? []) as Record<string, unknown>[];
  const performance = (dash.data?.performance ?? []) as Record<string, unknown>[];
  const departments = (dash.data?.departments ?? []) as { name: string }[];

  return (
    <HQLayout title="Manager Portal" subtitle={`Team management — ${departments.map((d) => d.name).join(", ") || "your department"}`}>
      <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Team Members" value={summary.teamCount ?? 0} icon={Users} variant="gold" />
        <KpiCard label="Pending Leave" value={summary.pendingLeave ?? 0} icon={Palmtree} variant={(summary.pendingLeave ?? 0) > 0 ? "warning" : "muted"} />
        <KpiCard label="Timesheets" value={summary.pendingTimesheets ?? 0} icon={Clock} variant="warning" />
        <KpiCard label="HR Compliance" value={`${complianceScore.score ?? 0}/100`} icon={Shield} variant={(complianceScore.score ?? 0) >= 80 ? "success" : "warning"} meta={`Grade ${complianceScore.grade ?? "—"}`} />
      </div>

      <div className="hq-founder-command-strip hq-fade-in" style={{ marginBottom: "1.25rem" }}>
        <Link to="/hq/people?tab=compliance" className="hq-btn hq-btn-secondary"><Shield size={14} /> HR Compliance</Link>
        <Link to="/hq/finance" className="hq-btn hq-btn-secondary"><DollarSign size={14} /> Finance Center</Link>
        <button type="button" className="hq-btn hq-btn-primary" disabled={payrollPrep.isPending} onClick={() => payrollPrep.mutate()}>
          <DollarSign size={14} /> Prepare Payroll Batch
        </button>
      </div>

      <div style={{ marginBottom: "1.25rem" }}>
        <PeopleHrAuraBriefingPanel audience="manager" />
      </div>

      <div className="hq-grid-2 hq-fade-in">
        <HqPanel title="Leave Approvals" subtitle="Department-scoped pending requests">
          <table className="hq-table">
            <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Actions</th></tr></thead>
            <tbody>
              {pendingLeave.map((lr) => (
                <tr key={String(lr.id)}>
                  <td>{String(lr.first_name)} {String(lr.last_name)}</td>
                  <td>{String(lr.leave_type)}</td>
                  <td>{String(lr.start_date)} – {String(lr.end_date)}</td>
                  <td>
                    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => reviewLeave.mutate({ id: String(lr.id), status: "approved" })}><CheckCircle size={12} /></button>
                      <button type="button" className="hq-btn hq-btn-sm" onClick={() => reviewLeave.mutate({ id: String(lr.id), status: "denied", notes: denyNotes[String(lr.id)] })}><XCircle size={12} /></button>
                    </div>
                    <input className="hq-input" style={{ marginTop: "0.25rem", fontSize: "0.75rem" }} placeholder="Denial notes (optional)" value={denyNotes[String(lr.id)] ?? ""} onChange={(e) => setDenyNotes({ ...denyNotes, [String(lr.id)]: e.target.value })} />
                  </td>
                </tr>
              ))}
              {pendingLeave.length === 0 && <tr><td colSpan={4} className="hq-muted-text">No pending leave requests.</td></tr>}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Timesheet Approvals" subtitle="Submitted timesheets awaiting review">
          <table className="hq-table">
            <thead><tr><th>Employee</th><th>Period</th><th>Hours</th><th>Actions</th></tr></thead>
            <tbody>
              {pendingTimesheets.map((t) => (
                <tr key={String(t.id)}>
                  <td>{String(t.first_name)} {String(t.last_name)}</td>
                  <td>{String(t.period_start)} – {String(t.period_end)}</td>
                  <td>{String(t.total_hours)}</td>
                  <td style={{ display: "flex", gap: "0.35rem" }}>
                    <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => reviewTimesheet.mutate({ id: String(t.id), status: "approved" })}>Approve</button>
                    <button type="button" className="hq-btn hq-btn-sm" onClick={() => reviewTimesheet.mutate({ id: String(t.id), status: "rejected" })}>Reject</button>
                  </td>
                </tr>
              ))}
              {pendingTimesheets.length === 0 && <tr><td colSpan={4} className="hq-muted-text">No timesheets pending approval.</td></tr>}
            </tbody>
          </table>
        </HqPanel>
      </div>

      <div className="hq-grid-2 hq-fade-in" style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Onboarding Approvals" subtitle="Verify team onboarding steps">
          <table className="hq-table">
            <thead><tr><th>Employee</th><th>Task</th><th>Action</th></tr></thead>
            <tbody>
              {pendingOnboarding.map((o) => (
                <tr key={String(o.id)}>
                  <td>{String(o.first_name)} {String(o.last_name)}</td>
                  <td>{String(o.task_label)}</td>
                  <td>
                    <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => approveOnboarding.mutate({ personId: String(o.person_id), itemId: String(o.id) })}>
                      <ClipboardCheck size={12} /> Verify
                    </button>
                  </td>
                </tr>
              ))}
              {pendingOnboarding.length === 0 && <tr><td colSpan={3} className="hq-muted-text">No pending onboarding items.</td></tr>}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Compliance Alerts" subtitle="Certs and background checks in your department">
          <table className="hq-table">
            <thead><tr><th>Employee</th><th>Item</th><th>Type</th></tr></thead>
            <tbody>
              {complianceAlerts.map((a) => (
                <tr key={String(a.id)}>
                  <td>{String(a.first_name)} {String(a.last_name)}</td>
                  <td>{String(a.name)}</td>
                  <td><StatusBadge label={String(a.alert_type).replace("_", " ")} variant={a.alert_type === "expired_cert" ? "danger" : "warning"} /></td>
                </tr>
              ))}
              {complianceAlerts.length === 0 && <tr><td colSpan={3} className="hq-muted-text">No compliance alerts in your scope.</td></tr>}
            </tbody>
          </table>
        </HqPanel>
      </div>

      <div className="hq-grid-2 hq-fade-in" style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Attendance Monitor" subtitle="Time clock activity this month">
          <table className="hq-table">
            <thead><tr><th>Employee</th><th>Entries</th><th>Hours</th></tr></thead>
            <tbody>
              {attendance.map((a) => (
                <tr key={String(a.id)}><td>{String(a.first_name)} {String(a.last_name)}</td><td>{String(a.entries_this_month)}</td><td>{Number(a.hours_this_month ?? 0).toFixed(1)}</td></tr>
              ))}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Performance Reviews" subtitle="Recent reviews for your team">
          <table className="hq-table">
            <thead><tr><th>Employee</th><th>Date</th><th>Rating</th></tr></thead>
            <tbody>
              {performance.map((r) => (
                <tr key={String(r.id)}><td>{String(r.first_name)} {String(r.last_name)}</td><td>{String(r.review_date)}</td><td><StatusBadge label={String(r.rating)} variant="gold" /></td></tr>
              ))}
              {performance.length === 0 && <tr><td colSpan={3} className="hq-muted-text">No performance reviews yet.</td></tr>}
            </tbody>
          </table>
          <Link to="/hq/people?tab=performance" className="hq-entity-link" style={{ marginTop: "0.75rem", display: "inline-block" }}><Star size={12} /> Full performance module →</Link>
        </HqPanel>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Department Team" subtitle="Active staff in your scope">
          <table className="hq-table">
            <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {team.map((m) => (
                <tr key={String(m.id)}>
                  <td>{String(m.first_name)} {String(m.last_name)}</td>
                  <td>{String(m.organization_role ?? "—")}</td>
                  <td>{String(m.department_name ?? "—")}</td>
                  <td><StatusBadge label={String(m.status)} variant="success" /></td>
                  <td><Link to={`/hq/people?tab=profile`} className="hq-entity-link">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>
      </div>
    </HQLayout>
  );
};

export default ManagerPortalPage;
