import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, ArrowRight } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import ProgramsDashboard from "../ProgramsDashboard";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { programsHqApi } from "../../api/programsHqApi";
import { PROGRAM_MODULES, programModulePath } from "../../config/programModules";
import { operationsApi } from "../../api/operationsApi";
import { HqLoading } from "../../components/hq/HqLoading";

const HqProgramsPage: React.FC = () => {
  const programs = useQuery({ queryKey: ["hq-programs-modules"], queryFn: programsHqApi.list });
  const ops = useQuery({ queryKey: ["hq-programs-ops"], queryFn: operationsApi.overview });

  const programMap = new Map((programs.data?.programs ?? []).map((p) => [p.slug, p]));

  return (
    <HQLayout title="Program Management" subtitle="Unified command center for all IFCDC community impact programs">
      <div style={{ marginBottom: "0.75rem" }}>
        <Link to="/hq/documents?category=program_files" className="hq-btn hq-btn-sm hq-btn-ghost">Program Documents Vault →</Link>
      </div>
      {programs.isLoading ? <HqLoading /> : (
        <>
          <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
            <KpiCard label="Active Programs" value={PROGRAM_MODULES.length} icon={LayoutGrid} variant="gold" />
            <KpiCard label="Total Participants" value={(programs.data?.programs ?? []).reduce((s, p) => s + (p.counts?.participants ?? 0), 0)} icon={LayoutGrid} />
            <KpiCard label="Housing Units" value={ops.data?.housing?.units ?? 0} icon={LayoutGrid} meta={`${ops.data?.housing?.placements ?? 0} placements`} />
            <KpiCard label="Scholarships Awarded" value={ops.data?.scholarships.awarded ?? 0} icon={LayoutGrid} meta={`${ops.data?.scholarships.applications ?? 0} applications`} />
          </div>

          <HqPanel title="Program Modules" subtitle="Each program includes participants, staff, budgets, documents, calendar, and outcome reporting">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "1rem" }}>
              {PROGRAM_MODULES.map((mod) => {
                const Icon = mod.icon;
                const live = programMap.get(mod.slug);
                return (
                  <Link key={mod.slug} to={programModulePath(mod.slug)} className="hq-module-hub-card" style={{
                    display: "block", padding: "1.15rem", borderRadius: "8px",
                    border: "1px solid var(--hq-border-subtle)", textDecoration: "none", color: "inherit",
                    background: "var(--hq-surface-elevated)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <Icon size={18} style={{ color: "var(--hq-gold)" }} />
                      <strong style={{ fontSize: "0.9rem" }}>{mod.title}</strong>
                    </div>
                    <p style={{ fontSize: "0.75rem", color: "var(--hq-text-muted)", margin: "0 0 0.5rem", lineHeight: 1.4 }}>{mod.description}</p>
                    {live && (
                      <p style={{ fontSize: "0.72rem", color: "var(--hq-text-dim)", margin: "0 0 0.5rem" }}>
                        {live.counts.participants} participants · {live.counts.staff} staff · {live.counts.upcomingEvents} events
                      </p>
                    )}
                    <span style={{ fontSize: "0.72rem", color: "var(--hq-gold)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                      Open program module <ArrowRight size={12} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </HqPanel>

          <div style={{ marginTop: "1.25rem" }}>
          <HqPanel title="Program Directory" subtitle="Legacy program enrollment and funding sources">
            <div className="hq-embedded-module" style={{ marginTop: "0.5rem" }}>
              <ProgramsDashboard />
            </div>
          </HqPanel>
          </div>
        </>
      )}
    </HQLayout>
  );
};

export default HqProgramsPage;
