import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Clock, ArrowRight, Check, X } from "lucide-react";
import { enterpriseApi, type ApprovalTask } from "../../api/enterpriseApi";
import { HqPanel } from "./HqPanel";
import { StatusBadge } from "./StatusBadge";
import { HqLoading } from "./HqLoading";
import { formatCurrency } from "../../utils/safeFormat";

const TYPE_LABELS: Record<ApprovalTask["type"], string> = {
  leave: "Leave",
  expense: "Expense",
  purchase_order: "Purchase Order",
  grant_application: "Grant App",
  document: "Document",
  grant_deadline: "Deadline",
  workflow: "Workflow",
};

function fmtAmount(n?: number) {
  if (n == null) return null;
  return formatCurrency(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const ApprovalTasksPanel: React.FC<{ compact?: boolean; limit?: number }> = ({ compact, limit = 8 }) => {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["hq-approval-tasks"],
    queryFn: () => enterpriseApi.approvals(),
    staleTime: 45_000,
    refetchInterval: 60_000,
  });

  const invalidateApprovalData = () => {
    qc.invalidateQueries({ queryKey: ["hq-approval-tasks"] });
    qc.invalidateQueries({ queryKey: ["workflow-dashboard"] });
  };

  const processApproval = useMutation({
    mutationFn: ({ taskId, action }: { taskId: string; action: "approve" | "reject" }) =>
      enterpriseApi.processApproval(taskId, action),
    onSuccess: (result) => {
      setFeedback({
        type: "success",
        text: result.message ?? "Approval processed successfully.",
      });
      invalidateApprovalData();
      window.setTimeout(() => setFeedback(null), 5000);
    },
    onError: (err) => {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Approval failed. Please try again.",
      });
    },
  });

  const tasks = (data?.tasks ?? []).slice(0, limit);
  const counts = data?.counts;

  return (
    <HqPanel
      title="Tasks Requiring Approval"
      subtitle={counts ? `${counts.total ?? tasks.length} items across finance, HR, grants, workflows, and documents` : "Pending executive actions"}
      action={{ label: "View all", to: "/hq/workflows" }}
      headerExtra={
        counts && !compact ? (
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {counts.workflow > 0 && <StatusBadge label={`${counts.workflow} workflows`} variant="gold" />}
            {counts.expense > 0 && <StatusBadge label={`${counts.expense} expenses`} variant="warning" />}
            {counts.leave > 0 && <StatusBadge label={`${counts.leave} leave`} variant="gold" />}
            {counts.purchase_order > 0 && <StatusBadge label={`${counts.purchase_order} POs`} variant="warning" />}
            {counts.document > 0 && <StatusBadge label={`${counts.document} docs`} variant="muted" />}
          </div>
        ) : undefined
      }
    >
      {feedback && (
        <div
          role="status"
          style={{
            marginBottom: "0.75rem",
            padding: "0.65rem 0.85rem",
            borderRadius: "var(--hq-radius-sm)",
            fontSize: "0.82rem",
            background: feedback.type === "success" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            border: `1px solid ${feedback.type === "success" ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)"}`,
            color: feedback.type === "success" ? "var(--hq-success)" : "var(--hq-danger)",
          }}
        >
          {feedback.text}
        </div>
      )}
      {isLoading ? <HqLoading /> : tasks.length === 0 ? (
        <p style={{ color: "var(--hq-text-muted)", fontSize: "0.85rem", margin: 0 }}>
          No pending approvals — all workflows are current.
        </p>
      ) : (
        <ul className="hq-approval-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {tasks.map((task) => (
            <li key={task.id} className="hq-approval-item" style={{
              display: "flex", alignItems: "center", gap: "0.75rem",
              padding: compact ? "0.5rem 0" : "0.65rem 0",
              borderBottom: "1px solid var(--hq-border-subtle)",
            }}>
              <Clock size={14} style={{ color: task.priority === "high" ? "var(--hq-warning)" : "var(--hq-text-muted)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <StatusBadge label={TYPE_LABELS[task.type]} variant={task.priority === "high" ? "warning" : "muted"} />
                  <strong style={{ fontSize: "0.85rem" }}>{task.title}</strong>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--hq-text-muted)", marginTop: "0.15rem" }}>
                  {task.subtitle}
                  {task.amount != null && ` · ${fmtAmount(task.amount)}`}
                  {task.dueDate && ` · Due ${new Date(task.dueDate).toLocaleDateString()}`}
                </div>
              </div>
              <div className="hq-approval-actions" style={{ display: "flex", gap: "0.35rem", flexShrink: 0, alignItems: "center" }}>
                <button
                  type="button"
                  className="hq-btn hq-btn-sm hq-btn-primary"
                  disabled={processApproval.isPending}
                  aria-label={`Approve ${task.title}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    processApproval.mutate({ taskId: task.id, action: "approve" });
                  }}
                >
                  <Check size={14} />
                  {!compact && <span>Approve</span>}
                </button>
                <button
                  type="button"
                  className="hq-btn hq-btn-sm hq-btn-ghost"
                  disabled={processApproval.isPending}
                  aria-label={`Reject ${task.title}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    processApproval.mutate({ taskId: task.id, action: "reject" });
                  }}
                >
                  <X size={14} />
                  {!compact && <span>Reject</span>}
                </button>
                <Link to={task.path} className="hq-btn hq-btn-sm hq-btn-ghost" style={{ flexShrink: 0 }}>
                  Review <ArrowRight size={12} />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </HqPanel>
  );
};

export default ApprovalTasksPanel;
