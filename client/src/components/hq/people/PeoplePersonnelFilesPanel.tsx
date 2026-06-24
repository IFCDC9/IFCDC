import React from "react";
import { useQuery } from "@tanstack/react-query";
import { peopleApi } from "../../../api/peopleApi";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";

export const PeoplePersonnelFilesPanel: React.FC = () => {
  const files = useQuery({ queryKey: ["people-personnel-files"], queryFn: () => peopleApi.phase3PersonnelFiles() });

  return (
    <HqPanel title="Digital Personnel Files" subtitle="Secure document repository across the workforce">
      {files.isLoading ? <HqLoading /> : (
        <table className="hq-table">
          <thead><tr><th>Document</th><th>Person</th><th>Type</th><th>Department</th><th>Uploaded</th></tr></thead>
          <tbody>
            {(files.data?.files ?? []).map((f) => (
              <tr key={String(f.id)}>
                <td style={{ fontWeight: 600 }}>{String(f.name)}</td>
                <td>{String(f.first_name)} {String(f.last_name)}</td>
                <td>{String(f.doc_type ?? "personnel")}</td>
                <td>{String(f.department_name ?? "—")}</td>
                <td className="hq-muted-text" style={{ fontSize: "0.78rem" }}>{f.uploaded_at ? new Date(String(f.uploaded_at)).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
            {(files.data?.files ?? []).length === 0 && (
              <tr><td colSpan={5} className="hq-muted-text">No personnel files uploaded yet. Add documents from individual profiles.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </HqPanel>
  );
};
