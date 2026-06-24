import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { peopleApi } from "../../../api/peopleApi";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";

export const PeopleOrgChartPanel: React.FC = () => {
  const org = useQuery({ queryKey: ["people-org-chart"], queryFn: peopleApi.orgChart });

  if (org.isLoading) return <HqLoading message="Loading organization chart…" />;

  const hierarchy = (org.data?.reportingHierarchy ?? []) as Record<string, unknown>[];

  const renderNode = (node: Record<string, unknown>, depth = 0): React.ReactNode => (
    <div key={String(node.id)} style={{ marginLeft: depth * 24, marginBottom: "0.5rem", borderLeft: depth > 0 ? "2px solid var(--hq-border)" : undefined, paddingLeft: depth > 0 ? "0.75rem" : 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Network size={14} style={{ color: depth === 0 ? "var(--hq-gold)" : undefined }} />
        <span style={{ fontWeight: depth === 0 ? 700 : 500 }}>
          {String(node.first_name ?? node.name ?? "")} {String(node.last_name ?? "")}
        </span>
        <span className="hq-muted-text" style={{ fontSize: "0.75rem" }}>
          {String(node.organization_role ?? node.position_title ?? node.person_type ?? "")}
          {node.department_name ? ` · ${String(node.department_name)}` : ""}
        </span>
      </div>
      {Array.isArray(node.directReports) && (node.directReports as Record<string, unknown>[]).map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <HqPanel title="Organization Chart" subtitle="Reporting hierarchy across IFCDC — assign managers on employee profiles">
      {hierarchy.length > 0 ? hierarchy.map((n) => renderNode(n)) : (
        <p className="hq-muted-text">Set <code>reports_to_person_id</code> on employee profiles to build the reporting hierarchy. Department groupings are available under Org Structure.</p>
      )}
      <div style={{ marginTop: "1.25rem" }}>
        <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>By Department</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem" }}>
          {(org.data?.departments ?? []).map((d) => (
            <div key={String((d as { id: string }).id)} className="hq-panel" style={{ padding: "0.75rem" }}>
              <div style={{ fontWeight: 600 }}>{String((d as { name: string }).name)}</div>
              <div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>{String((d as { member_count?: number }).member_count ?? 0)} members</div>
            </div>
          ))}
        </div>
      </div>
    </HqPanel>
  );
};
