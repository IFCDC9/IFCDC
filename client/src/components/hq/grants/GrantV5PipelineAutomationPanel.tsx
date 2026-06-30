import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";
import { StatusBadge } from "../StatusBadge";
import { formatDateTime } from "../../../utils/safeFormat";

export const GrantV5PipelineAutomationPanel: React.FC = () => {
  const rules = useQuery({
    queryKey: ["grant-v5-pipeline-automation-rules"],
    queryFn: grantsApi.v5PipelineAutomationRules,
    staleTime: 60_000,
  });
  const log = useQuery({
    queryKey: ["grant-v5-pipeline-automation-log"],
    queryFn: () => grantsApi.v5PipelineAutomationLog(20),
    staleTime: 30_000,
  });

  if (rules.isLoading) return <HqLoading message="Loading pipeline automation…" />;

  return (
    <HqPanel title="Pipeline Automation" subtitle="Workflow rules — notifications fire on stage transitions and approaching deadlines">
      <div className="hq-grid-2" style={{ gap: "1rem" }}>
        <div>
          <h4 style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}><Zap size={14} style={{ verticalAlign: "middle" }} /> Active Rules</h4>
          <ul className="hq-activity-list">
            {(rules.data?.rules ?? []).map((rule) => (
              <li key={rule.id} className="hq-activity-item">
                <div className="hq-activity-content">
                  <div className="hq-activity-title">{rule.titleTemplate}</div>
                  <div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>
                    {rule.trigger.replace(/_/g, " ")}
                    {rule.stage ? ` → ${rule.stage.replace(/_/g, " ")}` : ""}
                  </div>
                </div>
                <StatusBadge label={rule.priority} variant={rule.priority === "high" ? "warning" : "muted"} />
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>Recent Automation Events</h4>
          {log.isLoading ? <HqLoading /> : (
            <ul className="hq-activity-list">
              {(log.data?.log ?? []).slice(0, 10).map((entry) => (
                <li key={String(entry.id)} className="hq-activity-item">
                  <div className="hq-activity-content">
                    <div className="hq-activity-title">{String(entry.rule_id ?? "rule")}</div>
                    <div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>
                      {String(entry.entity_type)} · {String(entry.from_stage)} → {String(entry.to_stage)}
                    </div>
                    {entry.created_at && (
                      <div className="hq-muted-text" style={{ fontSize: "0.7rem" }}>
                        {formatDateTime(String(entry.created_at))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {!log.data?.log?.length && <li className="hq-muted-text">No automation events yet</li>}
            </ul>
          )}
        </div>
      </div>
    </HqPanel>
  );
};
