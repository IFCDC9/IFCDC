import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Link2, Server } from "lucide-react";
import { Link } from "react-router-dom";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";
import { StatusBadge } from "../StatusBadge";

export const GrantDivisionConnectorsPanel: React.FC = () => {
  const manifest = useQuery({
    queryKey: ["grant-v5-connectors"],
    queryFn: grantsApi.v5Connectors,
    staleTime: 60_000,
  });

  if (manifest.isLoading) return <HqLoading message="Loading division connectors…" />;

  const data = manifest.data;
  const hqModules = [data?.caseManagement, data?.economicDevelopment].filter(Boolean);
  const softwareApps = data?.softwareDivision ?? [];

  return (
    <HqPanel
      title="Division Connectors"
      subtitle="HQ integration registry — auth, reporting, and API endpoints per division"
    >
      <h4 style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}><Link2 size={14} style={{ verticalAlign: "middle" }} /> HQ Modules & Programs</h4>
      <div className="hq-grid-2" style={{ gap: "0.75rem", marginBottom: "1.25rem" }}>
        {hqModules.map((c) => (
          <div key={c!.id} style={{ padding: "0.75rem", background: "var(--hq-bg-subtle)", borderRadius: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
              <strong style={{ fontSize: "0.9rem" }}>{c!.name}</strong>
              <StatusBadge label={c!.status} variant={c!.status === "live" ? "success" : "muted"} />
            </div>
            <p className="hq-muted-text" style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>{c!.description}</p>
            <div style={{ fontSize: "0.75rem" }}>
              {Object.entries(c!.integrationEndpoints).slice(0, 4).map(([k, v]) => (
                <div key={k} className="hq-muted-text">{k}: <code>{v}</code></div>
              ))}
            </div>
            {c!.reportingPath && (
              <Link to={c!.reportingPath} className="hq-btn hq-btn-ghost hq-btn-sm" style={{ marginTop: "0.5rem" }}>
                <ExternalLink size={12} /> Open module
              </Link>
            )}
          </div>
        ))}
      </div>

      <h4 style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}><Server size={14} style={{ verticalAlign: "middle" }} /> Software Division Apps ({softwareApps.length})</h4>
      {softwareApps.length === 0 ? (
        <p className="hq-muted-text">No Software Division apps registered.</p>
      ) : (
        <ul className="hq-activity-list">
          {softwareApps.map((app) => (
            <li key={app.id} className="hq-activity-item">
              <div className="hq-activity-content">
                <div className="hq-activity-title">{app.name}</div>
                <div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>
                  {app.independentlyDeployable ? "Independently deployable" : "HQ-hosted"} · {app.inheritedServices.length} inherited services
                </div>
              </div>
              <StatusBadge label={app.status} variant={app.status === "live" ? "success" : "warning"} />
            </li>
          ))}
        </ul>
      )}
    </HqPanel>
  );
};
