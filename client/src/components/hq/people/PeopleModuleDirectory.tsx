import React from "react";
import { useQuery } from "@tanstack/react-query";
import { peopleApi, type Person } from "../../../api/peopleApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

interface Props {
  title: string;
  subtitle: string;
  personType: string;
  onSelectPerson?: (id: string) => void;
}

export const PeopleModuleDirectory: React.FC<Props> = ({ title, subtitle, personType, onSelectPerson }) => {
  const directory = useQuery({
    queryKey: ["people-phase3-directory", personType],
    queryFn: () => peopleApi.phase3Directory(personType),
  });

  return (
    <HqPanel title={title} subtitle={subtitle}>
      {directory.isLoading ? <HqLoading /> : (
        <table className="hq-table">
          <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Status</th><th>Contact</th></tr></thead>
          <tbody>
            {(directory.data?.people ?? []).map((p: Person) => (
              <tr key={p.id} style={{ cursor: onSelectPerson ? "pointer" : undefined }} onClick={() => onSelectPerson?.(p.id)}>
                <td style={{ fontWeight: 600 }}>{p.fullName}</td>
                <td>{p.organizationRole ?? "—"}</td>
                <td>{p.departmentName ?? "—"}</td>
                <td><StatusBadge label={p.status} variant={p.status === "active" ? "success" : "muted"} /></td>
                <td className="hq-muted-text" style={{ fontSize: "0.78rem" }}>{p.email ?? p.phone ?? "—"}</td>
              </tr>
            ))}
            {(directory.data?.people ?? []).length === 0 && (
              <tr><td colSpan={5} className="hq-muted-text">No records yet.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </HqPanel>
  );
};
