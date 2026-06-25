import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, AlertTriangle, ClipboardCheck, Award, UserCheck } from "lucide-react";
import { peopleApi } from "../../../api/peopleApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

export const PeopleHrComplianceDashboard: React.FC = () => {
  const compliance = useQuery({ queryKey: ["hr-compliance-dashboard"], queryFn: peopleApi.hrComplianceDashboard, staleTime: 60_000 });

  if (compliance.isLoading) return <HqLoading message="Loading HR compliance…" />;

  const data = compliance.data as {
    score?: { score: number; grade: string; status: string };
    summary?: Record<string, number>;
    alerts?: Record<string, Record<string, unknown>[]>;
  } | undefined;

  const score = data?.score;
  const summary = data?.summary ?? {};
  const alerts = data?.alerts ?? {};

  return (
    <div className="hq-fade-in">
      <HqPanel title="HR Compliance Dashboard" subtitle="Phase 3.1 — certifications, background checks, onboarding, and training compliance">
        <StatusBadge label="WORKFORCE COMPLIANCE" variant="gold" />
        <div className="hq-kpi-grid" style={{ marginTop: "1rem" }}>
          <KpiCard label="Compliance Score" value={`${score?.score ?? 0}/100`} icon={Shield} variant={(score?.score ?? 0) >= 80 ? "success" : "warning"} meta={`Grade ${score?.grade ?? "—"}`} />
          <KpiCard label="Expired Certs" value={summary.expiredCerts ?? 0} icon={Award} variant={(summary.expiredCerts ?? 0) > 0 ? "danger" : "success"} />
          <KpiCard label="Expiring Soon" value={summary.expiringCerts ?? 0} icon={AlertTriangle} variant={(summary.expiringCerts ?? 0) > 0 ? "warning" : "muted"} />
          <KpiCard label="Pending Background" value={summary.pendingBackgroundChecks ?? 0} icon={UserCheck} variant={(summary.pendingBackgroundChecks ?? 0) > 0 ? "warning" : "muted"} />
          <KpiCard label="Incomplete Onboarding" value={summary.incompleteOnboarding ?? 0} icon={ClipboardCheck} variant={(summary.incompleteOnboarding ?? 0) > 0 ? "warning" : "success"} />
          <KpiCard label="Open Training" value={summary.overdueTraining ?? 0} icon={ClipboardCheck} variant="muted" />
        </div>
      </HqPanel>

      <div className="hq-grid-2 hq-fade-in" style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Expired Certifications" subtitle="Require immediate renewal">
          <table className="hq-table">
            <thead><tr><th>Employee</th><th>Certification</th><th>Expired</th></tr></thead>
            <tbody>
              {(alerts.expiredCerts ?? []).map((c) => (
                <tr key={String(c.id)}><td>{String(c.first_name)} {String(c.last_name)}</td><td>{String(c.name)}</td><td><StatusBadge label={String(c.expiry_date)} variant="danger" /></td></tr>
              ))}
              {(alerts.expiredCerts ?? []).length === 0 && <tr><td colSpan={3} className="hq-muted-text">No expired certifications.</td></tr>}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Expiring Certifications (60 days)" subtitle="Plan renewals proactively">
          <table className="hq-table">
            <thead><tr><th>Employee</th><th>Certification</th><th>Expires</th></tr></thead>
            <tbody>
              {(alerts.expiringCerts ?? []).map((c) => (
                <tr key={String(c.id)}><td>{String(c.first_name)} {String(c.last_name)}</td><td>{String(c.name)}</td><td>{String(c.expiry_date)}</td></tr>
              ))}
              {(alerts.expiringCerts ?? []).length === 0 && <tr><td colSpan={3} className="hq-muted-text">No certifications expiring soon.</td></tr>}
            </tbody>
          </table>
        </HqPanel>
      </div>

      <div className="hq-grid-2 hq-fade-in" style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Pending Background Checks">
          <table className="hq-table">
            <thead><tr><th>Employee</th><th>Check Type</th><th>Status</th></tr></thead>
            <tbody>
              {(alerts.pendingBackgroundChecks ?? []).map((b) => (
                <tr key={String(b.id)}><td>{String(b.first_name)} {String(b.last_name)}</td><td>{String(b.check_type)}</td><td><StatusBadge label={String(b.status)} variant="warning" /></td></tr>
              ))}
              {(alerts.pendingBackgroundChecks ?? []).length === 0 && <tr><td colSpan={3} className="hq-muted-text">No pending background checks.</td></tr>}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Incomplete Onboarding">
          <table className="hq-table">
            <thead><tr><th>Employee</th><th>Department</th><th>Remaining</th></tr></thead>
            <tbody>
              {(alerts.incompleteOnboarding ?? []).map((o) => (
                <tr key={String(o.person_id)}><td>{String(o.first_name)} {String(o.last_name)}</td><td>{String(o.department_name ?? "—")}</td><td>{String(o.incomplete_count)}/{String(o.total_count)}</td></tr>
              ))}
              {(alerts.incompleteOnboarding ?? []).length === 0 && <tr><td colSpan={3} className="hq-muted-text">All onboarding complete.</td></tr>}
            </tbody>
          </table>
        </HqPanel>
      </div>
    </div>
  );
};

export const PeopleHrAuraBriefingPanel: React.FC<{ audience?: "staff" | "manager" | "hr" }> = ({ audience = "hr" }) => {
  const briefing = useQuery({
    queryKey: ["hr-aura-briefing", audience],
    queryFn: () => (audience === "staff" ? peopleApi.selfBriefing() : audience === "manager" ? peopleApi.managerBriefing() : peopleApi.hrBriefing()),
    staleTime: 120_000,
  });

  const data = briefing.data as { auraInsight?: string; insight?: string; priorities?: string[]; offline?: boolean } | undefined;
  const text = data?.auraInsight ?? data?.insight ?? "";

  return (
    <HqPanel title="AURA Staff & HR Briefing" subtitle="Priorities for workforce, compliance, and approvals">
      {briefing.isLoading ? <HqLoading /> : (
        <>
          {(data?.priorities ?? []).length > 0 && (
            <ul className="hq-mini-list" style={{ marginBottom: "0.75rem" }}>
              {(data?.priorities ?? []).map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <div className="hq-panel" style={{ padding: "1rem", whiteSpace: "pre-wrap", fontSize: "0.88rem", lineHeight: 1.6 }}>
            {text || "Briefing will generate on next load."}
            {data?.offline && <div className="hq-muted-text" style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>Offline advisory mode</div>}
          </div>
        </>
      )}
    </HqPanel>
  );
};
