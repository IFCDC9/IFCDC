import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { useGrantManage } from "../../../hooks/useGrantManage";

const ACTION_LABELS: Record<string, string> = {
  submit: "Submit to funder",
  review: "Move to review",
  award: "Record award",
  deny: "Record rejection",
};

export const GrantApplicationWorkflowPanel: React.FC<{
  applicationId: string | null;
  onUpdated?: () => void;
}> = ({ applicationId, onUpdated }) => {
  const qc = useQueryClient();
  const { canManage } = useGrantManage();
  const workflow = useQuery({
    queryKey: ["grant-app-workflow", applicationId],
    queryFn: () => grantsApi.applicationWorkflow(applicationId!),
    enabled: !!applicationId,
  });

  const advance = useMutation({
    mutationFn: (payload: { action: "submit" | "review" | "award" | "deny"; reason?: string; amountAwarded?: number }) =>
      grantsApi.advanceWorkflow(applicationId!, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grant-app-workflow", applicationId] });
      qc.invalidateQueries({ queryKey: ["grants-applications"] });
      qc.invalidateQueries({ queryKey: ["grant-funding-engine"] });
      onUpdated?.();
    },
  });

  if (!applicationId) {
    return <p className="hq-muted-text">Select an application to view workflow steps.</p>;
  }

  if (workflow.isLoading) return <HqLoading />;

  const steps = (workflow.data?.steps ?? []) as { step_key: string; step_label: string; status: string }[];
  const status = workflow.data?.status ?? "draft";

  const availableActions: ("submit" | "review" | "award" | "deny")[] = [];
  if (status === "draft") availableActions.push("submit", "deny");
  if (status === "submitted") availableActions.push("review", "deny");
  if (status === "under_review") availableActions.push("award", "deny");

  return (
    <HqPanel title="Application Workflow" subtitle={`Current status: ${status.replace(/_/g, " ")}`}>
      <ol style={{ margin: "0 0 1rem", paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
        {steps.map((s) => (
          <li key={s.step_key} style={{ marginBottom: "0.35rem" }}>
            {s.step_label}{" "}
            <StatusBadge label={s.status} variant={s.status === "completed" ? "success" : "muted"} />
          </li>
        ))}
      </ol>
      {canManage && (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {availableActions.map((action) => (
          <button
            key={action}
            type="button"
            className={`hq-btn hq-btn-sm ${action === "deny" ? "hq-btn-ghost" : "hq-btn-secondary"}`}
            disabled={advance.isPending}
            onClick={() => {
              if (action === "deny") {
                const reason = window.prompt("Rejection reason (optional):") ?? undefined;
                advance.mutate({ action, reason });
                return;
              }
              if (action === "award") {
                const amountStr = window.prompt("Award amount ($):");
                if (!amountStr) return;
                advance.mutate({ action, amountAwarded: Number(amountStr) });
                return;
              }
              advance.mutate({ action });
            }}
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>
      )}
      {advance.isError && (
        <p style={{ color: "var(--hq-warning)", fontSize: "0.8rem", marginTop: "0.5rem" }}>
          {(advance.error as Error)?.message ?? "Workflow action failed"}
        </p>
      )}
    </HqPanel>
  );
};
