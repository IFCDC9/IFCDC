import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Users, Target, Shield, TrendingUp, BarChart3, Briefcase } from "lucide-react";
import { peopleApi } from "../../../api/peopleApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

export const PeopleV3WorkforceIntelligenceDashboard: React.FC = () => {
  const intelligence = useQuery({ queryKey: ["workforce-intelligence"], queryFn: peopleApi.phase3Intelligence, staleTime: 60_000 });

  if (intelligence.isLoading) return <HqLoading message="Loading Workforce Intelligence…" />;

  const intel = intelligence.data as {
    workforceAnalytics?: { totalPeople: number; employees: number; volunteers: number; contractors: number };
    hiringPipeline?: { open: number; hired: number; conversionRate: number };
    hrComplianceScore?: { score: number; grade: string; status: string };
    payrollForecast?: { monthlyLabor: number; forecast: { month: string; projectedPayroll: number }[] };
    staffingForecast?: { currentHeadcount: number; forecast: { month: string; projectedHeadcount: number }[] };
    departmentPerformance?: Record<string, unknown>[];
    organizationGrowth?: { applicantsOpen: number; hiredTotal: number };
  } | undefined;

  return (
    <div className="hq-fade-in">
      <HqPanel title="Workforce Executive Intelligence" subtitle="Phase 3 — analytics, hiring pipeline, compliance, forecasts, and organization growth">
        <StatusBadge label="AURA WORKFORCE" variant="gold" />
        <div className="hq-kpi-grid" style={{ marginTop: "1rem" }}>
          <KpiCard label="Total Workforce" value={intel?.workforceAnalytics?.totalPeople ?? 0} icon={Users} variant="gold" />
          <KpiCard label="HR Compliance" value={`${intel?.hrComplianceScore?.score ?? 0}/100`} icon={Shield} variant={(intel?.hrComplianceScore?.score ?? 0) >= 80 ? "success" : "warning"} />
          <KpiCard label="Open Applicants" value={intel?.hiringPipeline?.open ?? 0} icon={Briefcase} variant="warning" />
          <KpiCard label="Hired" value={intel?.hiringPipeline?.hired ?? 0} icon={Target} variant="success" />
          <KpiCard label="Monthly Payroll" value={fmt(intel?.payrollForecast?.monthlyLabor ?? 0)} icon={TrendingUp} variant="gold" />
          <KpiCard label="Headcount (6mo)" value={intel?.staffingForecast?.forecast?.[5]?.projectedHeadcount ?? intel?.staffingForecast?.currentHeadcount ?? 0} icon={BarChart3} />
        </div>
      </HqPanel>

      <div style={{ marginTop: "1.25rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.25rem" }}>
        <HqPanel title="Department Performance">
          <table className="hq-table">
            <thead><tr><th>Department</th><th>Active</th><th>Hours</th></tr></thead>
            <tbody>
              {(intel?.departmentPerformance ?? []).slice(0, 6).map((d) => (
                <tr key={String(d.id)}>
                  <td>{String(d.name)}</td>
                  <td>{String(d.active_count ?? 0)}</td>
                  <td>{Number(d.hours_this_month ?? 0).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>
        <HqPanel title="Payroll Forecast">
          {(intel?.payrollForecast?.forecast ?? []).map((f) => (
            <div key={f.month} className="hq-activity-item" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{f.month}</span>
              <span style={{ color: "var(--hq-gold)", fontWeight: 600 }}>{fmt(f.projectedPayroll)}</span>
            </div>
          ))}
        </HqPanel>
        <HqPanel title="Staffing Forecast">
          {(intel?.staffingForecast?.forecast ?? []).slice(0, 6).map((f) => (
            <div key={f.month} className="hq-activity-item" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{f.month}</span>
              <span style={{ fontWeight: 600 }}>{f.projectedHeadcount} staff</span>
            </div>
          ))}
        </HqPanel>
      </div>
    </div>
  );
};

export const PeopleV3AuraWorkforcePanel: React.FC = () => {
  const [question, setQuestion] = useState("");
  const aura = useMutation({ mutationFn: () => peopleApi.phase3AuraAdvisor(question || undefined) });

  return (
    <HqPanel title="AURA Workforce Advisor" subtitle="Executive intelligence for hiring, compliance, and staffing">
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <input className="hq-input" style={{ flex: 1 }} placeholder="Ask about workforce, hiring, or payroll forecast…" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <button type="button" className="hq-btn hq-btn-primary" disabled={aura.isPending} onClick={() => aura.mutate()}><Sparkles size={14} /> Ask AURA</button>
      </div>
      {aura.data?.insight && (
        <div className="hq-panel" style={{ padding: "1rem", whiteSpace: "pre-wrap", fontSize: "0.88rem", lineHeight: 1.6 }}>
          {aura.data.insight}
          {aura.data.offline && <div className="hq-muted-text" style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>Offline advisory mode</div>}
        </div>
      )}
    </HqPanel>
  );
};
