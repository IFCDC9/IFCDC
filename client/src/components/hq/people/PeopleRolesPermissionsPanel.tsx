import React from "react";
import { useQuery } from "@tanstack/react-query";
import { peopleApi } from "../../../api/peopleApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

export const PeopleRolesPermissionsPanel: React.FC = () => {
  const roles = useQuery({ queryKey: ["people-roles-permissions"], queryFn: peopleApi.phase3RolesPermissions });

  if (roles.isLoading) return <HqLoading message="Loading roles & permissions…" />;

  return (
    <div className="hq-fade-in" style={{ display: "grid", gap: "1.25rem" }}>
      <HqPanel title="Enterprise Roles" subtitle="Role-based access across IFCDC Headquarters">
        <table className="hq-table">
          <thead><tr><th>Role</th><th>Key Permissions</th></tr></thead>
          <tbody>
            {(roles.data?.roles ?? []).map((r) => (
              <tr key={r.role}>
                <td><StatusBadge label={r.role} variant="gold" /></td>
                <td className="hq-muted-text" style={{ fontSize: "0.78rem" }}>{r.permissions.slice(0, 8).join(" · ")}{(r.permissions.length > 8 ? ` +${r.permissions.length - 8} more` : "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </HqPanel>

      <HqPanel title="HQ Module Access" subtitle="Which roles can access People, Payroll, and Board modules">
        <table className="hq-table">
          <thead><tr><th>Module</th><th>Allowed Roles</th></tr></thead>
          <tbody>
            {(roles.data?.modules ?? []).filter((m) => ["hr", "payroll", "executive"].includes(m.module)).map((m) => (
              <tr key={m.module}>
                <td style={{ fontWeight: 600 }}>{m.module}</td>
                <td>{m.allowedRoles.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </HqPanel>

      <HqPanel title="Person Types" subtitle="Workforce categories in the people directory">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {(roles.data?.personTypes ?? []).map((t) => (
            <StatusBadge key={t.id} label={t.label} variant="muted" />
          ))}
        </div>
      </HqPanel>
    </div>
  );
};
