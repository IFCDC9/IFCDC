import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { enterpriseApi, type EnterpriseModuleStatus } from "../../api/enterpriseApi";
import { StatusBadge } from "./StatusBadge";
import { HqLoading } from "./HqLoading";

const STATUS_VARIANT: Record<string, "success" | "warning" | "muted"> = {
  live: "success",
  beta: "warning",
  "coming-soon": "muted",
};

export const EnterpriseModuleHub: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["enterprise-modules"],
    queryFn: enterpriseApi.modules,
    staleTime: 60_000,
  });

  if (isLoading) return <HqLoading message="Loading enterprise modules…" />;

  const modules = data?.modules ?? [];
  const sections = [...new Set(modules.map((m) => m.section))];

  if (compact) {
    return (
      <div className="hq-module-hub-compact">
        {modules.filter((m) => m.status === "live").map((m) => (
          <Link key={m.id} to={m.path} className="hq-module-chip">
            <span className="hq-module-chip-dot connected" />
            {m.name}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="hq-module-hub">
      {sections.map((section) => (
        <div key={section} className="hq-module-section">
          <div className="hq-module-section-label">{section}</div>
          <div className="hq-module-grid">
            {(modules.filter((m) => m.section === section) as EnterpriseModuleStatus[]).map((m) => (
              <Link key={m.id} to={m.path} className={`hq-module-card ${m.connected ? "connected" : "pending"}`}>
                <div className="hq-module-card-top">
                  <StatusBadge label={m.status === "live" ? "Live" : m.status === "beta" ? "Beta" : "Soon"} variant={STATUS_VARIANT[m.status]} />
                  <span className={`hq-module-dot ${m.connected ? "on" : "off"}`} title={m.connected ? "Connected to HQ" : "Not yet connected"} />
                </div>
                <div className="hq-module-name">{m.name}</div>
                {m.metric && (
                  <div className="hq-module-metric">
                    <span className="hq-module-metric-value">{m.metric}</span>
                    <span className="hq-module-metric-label">{m.metricLabel}</span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
