import React from "react";
import { useQuery } from "@tanstack/react-query";
import { peopleApi } from "../../../api/peopleApi";
import { HqPanel } from "../HqPanel";
import { KpiCard } from "../KpiCard";
import { Building2, Network, Briefcase, Users } from "lucide-react";
import { HqLoading } from "../HqLoading";

export const PeopleOrgStructurePanel: React.FC = () => {
  const org = useQuery({ queryKey: ["people-org-structure"], queryFn: peopleApi.phase3OrganizationStructure });

  if (org.isLoading) return <HqLoading message="Loading organization structure…" />;
  const summary = org.data?.summary ?? {};

  const renderTree = (nodes: Record<string, unknown>[], depth = 0): React.ReactNode =>
    nodes.map((n) => (
      <div key={String(n.id)} style={{ marginLeft: depth * 20, marginBottom: "0.35rem" }}>
        <span style={{ fontWeight: depth === 0 ? 700 : 500, color: depth === 0 ? "var(--hq-gold)" : undefined }}>
          {String(n.name)} — {String(n.organization_role ?? n.position_title ?? "")}
        </span>
        {Array.isArray(n.directReports) && n.directReports.length > 0 && renderTree(n.directReports as Record<string, unknown>[], depth + 1)}
      </div>
    ));

  return (
    <div className="hq-fade-in">
      <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Departments" value={summary.departmentCount ?? 0} icon={Building2} variant="gold" />
        <KpiCard label="Positions" value={summary.positionCount ?? 0} icon={Briefcase} />
        <KpiCard label="Active Staff" value={summary.activeStaff ?? 0} icon={Users} />
        <KpiCard label="With Manager" value={summary.withManager ?? 0} icon={Network} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.25rem" }}>
        <HqPanel title="Departments" subtitle="Organizational units and membership">
          <table className="hq-table">
            <thead><tr><th>Department</th><th>Head</th><th>Members</th></tr></thead>
            <tbody>
              {(org.data?.departments ?? []).map((d) => (
                <tr key={String((d as { id: string }).id)}>
                  <td>{String((d as { name: string }).name)}</td>
                  <td>{String((d as { head_name?: string }).head_name ?? "—")}</td>
                  <td>{String((d as { member_count?: number }).member_count ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Position Management" subtitle="Defined roles and fill status">
          <table className="hq-table">
            <thead><tr><th>Position</th><th>Level</th><th>Filled</th></tr></thead>
            <tbody>
              {(org.data?.positions ?? []).map((p) => (
                <tr key={String((p as { id: string }).id)}>
                  <td>{String((p as { title: string }).title)}</td>
                  <td>{String((p as { level: number }).level)}</td>
                  <td>{String((p as { filled_count?: number }).filled_count ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Reporting Hierarchy" subtitle="Manager chain and direct reports">
          {renderTree((org.data?.reportingHierarchy ?? []) as Record<string, unknown>[])}
          {(org.data?.reportingHierarchy ?? []).length === 0 && (
            <p className="hq-muted-text">Assign managers via reports-to on employee profiles to build hierarchy.</p>
          )}
        </HqPanel>
      </div>
    </div>
  );
};
