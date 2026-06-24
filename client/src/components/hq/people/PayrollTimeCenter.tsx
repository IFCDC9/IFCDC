import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock, DollarSign, Users, Palmtree, Briefcase, Target } from "lucide-react";
import { peopleApi } from "../../../api/peopleApi";
import { financeApi } from "../../../api/financeApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

export const PayrollTimeCenter: React.FC = () => {
  const center = useQuery({ queryKey: ["payroll-time-center"], queryFn: peopleApi.phase3PayrollTimeCenter });
  const payrollOverview = useQuery({ queryKey: ["finance-payroll-overview"], queryFn: financeApi.payrollOverview });

  if (center.isLoading) return <HqLoading message="Loading Payroll & Time Management Center…" />;
  const s = center.data?.summary ?? {};

  return (
    <div className="hq-fade-in">
      <HqPanel title="Payroll & Time Management Center" subtitle="Phase 3 — time tracking, PTO, payroll reporting, contractor payments, grant-funded staff">
        <StatusBadge label="PHASE 3 PAYROLL" variant="gold" />
        <div className="hq-kpi-grid" style={{ marginTop: "1rem" }}>
          <KpiCard label="Active Payroll" value={Number(s.activePayroll ?? 0)} icon={Users} variant="gold" />
          <KpiCard label="Hours This Month" value={Number(s.hoursThisMonth ?? 0).toFixed(1)} icon={Clock} />
          <KpiCard label="Clocked In Now" value={Number(s.clockedIn ?? 0)} icon={Clock} variant="success" />
          <KpiCard label="Pending Leave" value={Number(s.pendingLeave ?? 0)} icon={Palmtree} variant="warning" />
          <KpiCard label="Contractor Payments" value={Number(s.contractorPaymentsPending ?? 0)} icon={Briefcase} variant="warning" />
          <KpiCard label="Grant-Funded Staff" value={Number(s.grantFundedStaffCount ?? 0)} icon={Target} />
          <KpiCard label="Last Payroll Net" value={fmt(Number(s.lastPayrollNetCents ?? 0) / 100)} icon={DollarSign} variant="gold" />
        </div>
      </HqPanel>

      <div className="hq-founder-command-strip hq-fade-in" style={{ margin: "1.25rem 0" }}>
        <Link to="/hq/people?tab=time-clock"><Clock size={14} /> Time Clock</Link>
        <Link to="/hq/people?tab=leave" className="primary"><Palmtree size={14} /> PTO & Leave</Link>
        <Link to="/hq/finance"><DollarSign size={14} /> Finance Center → Payroll Runs</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.25rem" }}>
        <HqPanel title="Recent Time Entries" subtitle="HQ time clock activity">
          <table className="hq-table">
            <thead><tr><th>Person</th><th>In</th><th>Hours</th></tr></thead>
            <tbody>
              {(center.data?.recentTimeEntries ?? []).slice(0, 8).map((t) => (
                <tr key={String(t.id)}>
                  <td>{String(t.first_name)} {String(t.last_name)}</td>
                  <td className="hq-muted-text" style={{ fontSize: "0.78rem" }}>{new Date(String(t.clock_in)).toLocaleString()}</td>
                  <td>{t.hours != null ? String(t.hours) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="PTO Balances" subtitle="Paid time off tracking">
          {(center.data?.ptoBalances ?? []).length === 0 ? (
            <p className="hq-muted-text">PTO balances seed automatically when employees are added to payroll.</p>
          ) : (
            <table className="hq-table">
              <thead><tr><th>Person</th><th>PTO Left</th><th>Sick Left</th></tr></thead>
              <tbody>
                {(center.data?.ptoBalances ?? []).slice(0, 8).map((b) => (
                  <tr key={String(b.id)}>
                    <td>{String(b.first_name)} {String(b.last_name)}</td>
                    <td>{(Number(b.pto_hours) - Number(b.used_pto)).toFixed(1)}h</td>
                    <td>{(Number(b.sick_hours) - Number(b.used_sick)).toFixed(1)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </HqPanel>

        <HqPanel title="Contractor Payments" subtitle="Consultant and contractor disbursements">
          <table className="hq-table">
            <thead><tr><th>Contractor</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {(center.data?.contractorPayments ?? []).slice(0, 8).map((c) => (
                <tr key={String(c.id)}>
                  <td>{String(c.first_name)} {String(c.last_name)}</td>
                  <td>{String(c.description)}</td>
                  <td>{fmt(Number(c.amount_cents) / 100)}</td>
                  <td><StatusBadge label={String(c.status)} variant={c.status === "paid" ? "success" : "warning"} /></td>
                </tr>
              ))}
              {(center.data?.contractorPayments ?? []).length === 0 && (
                <tr><td colSpan={4} className="hq-muted-text">No contractor payments recorded.</td></tr>
              )}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Grant-Funded Staff" subtitle="Labor allocated to grant awards">
          <table className="hq-table">
            <thead><tr><th>Person</th><th>Grant</th><th>Hours</th><th>Cost</th></tr></thead>
            <tbody>
              {(center.data?.grantFundedStaff ?? []).slice(0, 8).map((g) => (
                <tr key={String(g.id)}>
                  <td>{String(g.first_name)} {String(g.last_name)}</td>
                  <td>{String(g.grant_title ?? "—")}</td>
                  <td>{String(g.hours ?? "—")}</td>
                  <td>{fmt(Number(g.cost_cents ?? 0) / 100)}</td>
                </tr>
              ))}
              {(center.data?.grantFundedStaff ?? []).length === 0 && (
                <tr><td colSpan={4} className="hq-muted-text">No grant labor allocations yet.</td></tr>
              )}
            </tbody>
          </table>
        </HqPanel>
      </div>

      {payrollOverview.data && (
        <div style={{ marginTop: "1.25rem" }}>
          <HqPanel title="Payroll Reporting" subtitle="Finance Center payroll run summary">
            <p className="hq-muted-text">Active payroll staff: {payrollOverview.data.activeEmployees ?? 0} · Hours this month: {payrollOverview.data.hoursThisMonth ?? 0}</p>
          </HqPanel>
        </div>
      )}
    </div>
  );
};
