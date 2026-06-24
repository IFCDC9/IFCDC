import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, HandHeart, Landmark, Briefcase, UserPlus, ClipboardCheck, Award, Star, Shield, FileText, Building2 } from "lucide-react";
import { peopleApi } from "../../../api/peopleApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

const MODULE_ICONS: Record<string, React.ElementType> = {
  employees: Users,
  volunteers: HandHeart,
  board: Landmark,
  contractors: Briefcase,
  applicants: UserPlus,
  onboarding: ClipboardCheck,
  training: Award,
  performance: Star,
  roles: Shield,
  "personnel-files": FileText,
};

interface Props {
  onNavigateTab: (tab: string) => void;
}

export const PeoplePhase3CommandCenter: React.FC<Props> = ({ onNavigateTab }) => {
  const platform = useQuery({ queryKey: ["people-phase3-platform"], queryFn: peopleApi.phase3Platform, staleTime: 45_000 });

  if (platform.isLoading) return <HqLoading message="Loading People & HR Command Center…" />;
  const counts = platform.data?.counts ?? {};

  return (
    <div className="hq-fade-in">
      <HqPanel title="People & HR Command Center" subtitle="Phase 3 — workforce management, organization structure, and payroll operations">
        <StatusBadge label="PHASE 3 OPERATIONS" variant="gold" />
        <div className="hq-kpi-grid" style={{ marginTop: "1rem" }}>
          <KpiCard label="Employees" value={counts.employees ?? 0} icon={Users} variant="gold" />
          <KpiCard label="Volunteers" value={counts.volunteers ?? 0} icon={HandHeart} />
          <KpiCard label="Board Members" value={counts.board ?? 0} icon={Landmark} />
          <KpiCard label="Contractors" value={counts.contractors ?? 0} icon={Briefcase} />
          <KpiCard label="Open Applicants" value={counts.applicants ?? 0} icon={UserPlus} variant="warning" />
          <KpiCard label="Onboarding" value={counts.onboardingInProgress ?? 0} icon={ClipboardCheck} variant="warning" />
          <KpiCard label="Personnel Files" value={counts.personnelFiles ?? 0} icon={FileText} />
          <KpiCard label="Departments" value={platform.data?.organizationStructure?.departmentCount ?? 0} icon={Building2} />
        </div>
      </HqPanel>

      <div className="hq-module-grid" style={{ marginTop: "1.25rem", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.75rem" }}>
        {(platform.data?.modules ?? []).map((mod) => {
          const Icon = MODULE_ICONS[mod.id] ?? Users;
          const countKey = mod.id === "training" ? undefined : mod.id === "onboarding" ? "onboardingInProgress" : mod.id === "personnel-files" ? "personnelFiles" : mod.id;
          return (
            <button
              key={mod.id}
              type="button"
              className="hq-panel hq-module-card"
              style={{ textAlign: "left", cursor: "pointer", padding: "1rem" }}
              onClick={() => onNavigateTab(mod.tab)}
            >
              <Icon size={20} style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }} />
              <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{mod.label}</div>
              {countKey && counts[countKey] != null && (
                <div className="hq-muted-text" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>{counts[countKey]} active</div>
              )}
            </button>
          );
        })}
        <button type="button" className="hq-panel hq-module-card" style={{ textAlign: "left", cursor: "pointer", padding: "1rem" }} onClick={() => onNavigateTab("org-structure")}>
          <Building2 size={20} style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }} />
          <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>Organization Structure</div>
          <div className="hq-muted-text" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>Departments & hierarchy</div>
        </button>
      </div>
    </div>
  );
};
