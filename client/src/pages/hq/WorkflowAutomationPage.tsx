import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Workflow, Play, RefreshCw, CheckCircle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { workflowApi, type WorkflowInstance } from "../../api/workflowApi";
import { enterpriseApi } from "../../api/enterpriseApi";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { HqQueryBoundary } from "../../components/hq/HqQueryBoundary";
import { StatusBadge } from "../../components/hq/StatusBadge";

type ApprovalTaskRow = {
  id: string;
  title: string;
  type: string;
  priority: string;
  subtitle?: string;
  workflowStep?: string;
  path?: string;
};

function definitionStatusLabel(d: { operationalStatus?: string; enabled?: number }): { label: string; variant: "success" | "warning" | "muted" } {
  if (d.operationalStatus === "in_use") return { label: "In use", variant: "warning" };
  if (d.operationalStatus === "configured") return { label: "Configured", variant: "success" };
  if (Number(d.enabled) === 0) return { label: "Disabled", variant: "muted" };
  return { label: "Idle", variant: "muted" };
}

function jobStatusVariant(status?: string): "success" | "warning" | "danger" | "muted" {
  if (status === "success") return "success";
  if (status === "failed") return "danger";
  if (status === "never_run") return "muted";
  return "warning";
}

const WorkflowAutomationPage: React.FC = () => {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const dashboard = useQuery({ queryKey: ["workflow-dashboard"], queryFn: workflowApi.dashboard, staleTime: 45_000 });
  const stepsQuery = useQuery({
    queryKey: ["workflow-steps", expandedId],
    queryFn: () => workflowApi.steps(expandedId!),
    enabled: Boolean(expandedId),
  });

  const showFeedback = (type: "success" | "error", text: string) => {
    setFeedback({ type, text });
    window.setTimeout(() => setFeedback(null), 5000);
  };

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["workflow-dashboard"] });
    qc.invalidateQueries({ queryKey: ["hq-approval-tasks"] });
    if (expandedId) qc.invalidateQueries({ queryKey: ["workflow-steps", expandedId] });
  };

  const runScheduled = useMutation({
    mutationFn: workflowApi.runScheduled,
    onSuccess: (result) => {
      const errNote = result.errors?.length ? ` Errors: ${result.errors.join("; ")}` : "";
      showFeedback("success", `Scheduled jobs ran: ${result.ran.join(", ") || "none"}${errNote}`);
      invalidateAll();
    },
    onError: (err) => showFeedback("error", err instanceof Error ? err.message : "Scheduled job run failed"),
  });

  const runJob = useMutation({
    mutationFn: (jobKey: string) => workflowApi.runJob(jobKey),
    onSuccess: (result) => {
      if (!result.ok) {
        showFeedback("error", result.error ?? "Job run failed");
        return;
      }
      showFeedback("success", `Job ${result.jobKey} completed.`);
      invalidateAll();
    },
    onError: (err) => showFeedback("error", err instanceof Error ? err.message : "Job run failed"),
  });

  const toggleJob = useMutation({
    mutationFn: ({ jobKey, enabled }: { jobKey: string; enabled: boolean }) => workflowApi.setJobEnabled(jobKey, enabled),
    onSuccess: () => invalidateAll(),
    onError: (err) => showFeedback("error", err instanceof Error ? err.message : "Could not update job"),
  });

  const processApproval = useMutation({
    mutationFn: ({ taskId, action }: { taskId: string; action: "approve" | "reject" }) =>
      enterpriseApi.processApproval(taskId, action),
    onSuccess: (result) => {
      showFeedback("success", result.message ?? "Approval processed successfully.");
      invalidateAll();
    },
    onError: (err) => showFeedback("error", err instanceof Error ? err.message : "Approval failed"),
  });

  const advanceStep = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      workflowApi.advance(id, action),
    onSuccess: (result) => {
      showFeedback("success", result.message ?? "Workflow advanced successfully.");
      invalidateAll();
    },
    onError: (err) => showFeedback("error", err instanceof Error ? err.message : "Workflow advance failed"),
  });

  const data = dashboard.data;
  const counts = data?.counts ?? {};

  return (
    <HQLayout
      title="Workflow Automation"
      subtitle="Live approval workflows, scheduled jobs, and executive task processing"
      auraModule="workflow"
      auraActions={["ask", "fix_workflow", "prepare_approval", "explain"]}
    >
      {feedback && (
        <div
          role="status"
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            borderRadius: "var(--hq-radius-sm)",
            fontSize: "0.85rem",
            background: feedback.type === "success" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            border: `1px solid ${feedback.type === "success" ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)"}`,
            color: feedback.type === "success" ? "var(--hq-success)" : "var(--hq-danger)",
          }}
        >
          {feedback.text}
        </div>
      )}

      <div className="hq-sd-toolbar" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <StatusBadge label={`${counts.workflowPending ?? 0} workflow instances pending`} variant="warning" />
          <StatusBadge label={`${counts.total ?? 0} approval tasks`} variant="gold" />
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => dashboard.refetch()} disabled={dashboard.isFetching}>
            <RefreshCw size={14} className={dashboard.isFetching ? "hq-spin" : ""} /> Refresh
          </button>
          <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={runScheduled.isPending} onClick={() => runScheduled.mutate()}>
            <Play size={14} /> {runScheduled.isPending ? "Running…" : "Run All Due Jobs"}
          </button>
        </div>
      </div>

      <HqQueryBoundary
        query={dashboard}
        title="Workflow Automation unavailable"
        message="Workflow definitions and approval queues could not be loaded from headquarters."
        loadingMessage="Loading workflow automation…"
      >
        <div className="hq-grid-main-side hq-fade-in">
          <HqPanel title="Workflow Definitions" subtitle="System workflow templates — status reflects live instance activity">
            <table className="hq-table">
              <thead><tr><th>Workflow</th><th>Category</th><th>Instances</th><th>Status</th></tr></thead>
              <tbody>
                {(data?.definitions ?? []).map((d) => {
                  const st = definitionStatusLabel(d);
                  return (
                    <tr key={d.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{d.name}</div>
                        <div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>{d.description}</div>
                      </td>
                      <td><StatusBadge label={d.category} variant="muted" /></td>
                      <td>
                        {d.pendingCount ? `${d.pendingCount} pending` : d.instanceCount ?? 0}
                        {d.lastInstanceAt && (
                          <div className="hq-muted-text" style={{ fontSize: "0.7rem" }}>
                            Last: {new Date(d.lastInstanceAt).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td><StatusBadge label={st.label} variant={st.variant} /></td>
                    </tr>
                  );
                })}
                {!data?.definitions?.length && (
                  <tr><td colSpan={4} className="hq-empty-cell">No workflow definitions configured.</td></tr>
                )}
              </tbody>
            </table>
          </HqPanel>

          <HqPanel title="Scheduled Jobs" subtitle="Backend automation — last run, next run, and failure status">
            {(data?.jobs ?? []).length === 0 ? (
              <p className="hq-muted-text" style={{ padding: "1rem 0" }}>No scheduled jobs configured.</p>
            ) : (
              <ul className="hq-activity-list">
                {(data?.jobs ?? []).map((job) => (
                  <li key={job.id} className="hq-activity-item" style={{ alignItems: "flex-start" }}>
                    <Workflow size={14} style={{ color: "var(--hq-gold)", flexShrink: 0, marginTop: 4 }} />
                    <div className="hq-activity-content" style={{ flex: 1 }}>
                      <div className="hq-activity-title">{job.name}</div>
                      <div className="hq-activity-detail">
                        {job.sourceModule ?? "hq"} · {job.schedule_expr ?? job.schedule ?? "daily"}
                        <br />
                        Next: {job.next_run_at ? new Date(job.next_run_at).toLocaleString() : "—"}
                        {" · "}Last: {job.last_run_at ? new Date(job.last_run_at).toLocaleString() : "Never"}
                      </div>
                      {job.lastError && (
                        <div style={{ color: "var(--hq-danger)", fontSize: "0.75rem", marginTop: "0.25rem" }}>
                          {job.lastError}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="hq-btn hq-btn-sm hq-btn-secondary"
                          disabled={runJob.isPending || !job.enabled}
                          onClick={() => runJob.mutate(job.job_key)}
                        >
                          Run now
                        </button>
                        <button
                          type="button"
                          className="hq-btn hq-btn-sm hq-btn-ghost"
                          disabled={toggleJob.isPending}
                          onClick={() => toggleJob.mutate({ jobKey: job.job_key, enabled: !job.enabled })}
                        >
                          {job.enabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </div>
                    <StatusBadge
                      label={job.runStatus === "failed" ? "Failed" : job.enabled ? (job.runStatus === "never_run" ? "Ready" : "Enabled") : "Off"}
                      variant={job.enabled ? jobStatusVariant(job.runStatus) : "muted"}
                    />
                  </li>
                ))}
              </ul>
            )}
          </HqPanel>
        </div>
      </HqQueryBoundary>

      <div style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Approval Queue" subtitle="Live items requiring founder or executive approval">
          <HqQueryBoundary query={dashboard} loadingMessage="Loading approval queue…">
            <div className="hq-table-scroll">
              <table className="hq-table">
                <thead><tr><th>Task</th><th>Type</th><th>Step</th><th>Priority</th><th>Actions</th></tr></thead>
                <tbody>
                  {(data?.approvalTasks as ApprovalTaskRow[] ?? []).map((task) => (
                    <tr key={task.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{task.title}</div>
                        {task.subtitle && <div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>{task.subtitle}</div>}
                      </td>
                      <td><StatusBadge label={task.type.replace(/_/g, " ")} variant="muted" /></td>
                      <td>{task.workflowStep ?? "—"}</td>
                      <td><StatusBadge label={task.priority} variant={task.priority === "high" ? "warning" : "muted"} /></td>
                      <td>
                        <div className="hq-approval-actions" style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                          {task.path && (
                            <Link to={task.path} className="hq-btn hq-btn-sm hq-btn-ghost">
                              <ExternalLink size={12} /> Open
                            </Link>
                          )}
                          <button
                            type="button"
                            className="hq-btn hq-btn-sm hq-btn-primary"
                            disabled={processApproval.isPending}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              processApproval.mutate({ taskId: task.id, action: "approve" });
                            }}
                          >
                            <CheckCircle size={12} /> Approve
                          </button>
                          <button
                            type="button"
                            className="hq-btn hq-btn-sm hq-btn-ghost"
                            disabled={processApproval.isPending}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              processApproval.mutate({ taskId: task.id, action: "reject" });
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!data?.approvalTasks?.length && (
                    <tr><td colSpan={5} className="hq-empty-cell">No pending approvals.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </HqQueryBoundary>
        </HqPanel>
      </div>

      <HqPanel title="Active Workflow Instances" subtitle="Multi-step approvals — expand to review step history">
        <HqQueryBoundary query={dashboard} loadingMessage="Loading workflow instances…">
          {(data?.instances ?? []).length === 0 ? (
            <p className="hq-muted-text" style={{ padding: "1rem 0" }}>No active workflow instances.</p>
          ) : (
            <div className="hq-table-scroll">
              <table className="hq-table">
                <thead><tr><th></th><th>Title</th><th>Workflow</th><th>Current Step</th><th>Status</th><th>Due</th><th>Actions</th></tr></thead>
                <tbody>
                  {(data?.instances ?? []).map((inst: WorkflowInstance) => {
                    const expanded = expandedId === inst.id;
                    const steps = expanded ? (stepsQuery.data?.steps ?? []) : [];
                    return (
                      <React.Fragment key={inst.id}>
                        <tr>
                          <td>
                            <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => setExpandedId(expanded ? null : inst.id)}>
                              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </td>
                          <td>{inst.title}</td>
                          <td>{inst.workflow_key.replace(/_/g, " ")}</td>
                          <td>{inst.active_step_name ?? "—"}</td>
                          <td>
                            <StatusBadge
                              label={inst.status}
                              variant={inst.status === "pending" ? "warning" : inst.status === "completed" ? "success" : "muted"}
                            />
                          </td>
                          <td>{inst.due_at ? new Date(inst.due_at).toLocaleDateString() : "—"}</td>
                          <td>
                            {inst.status === "pending" && inst.can_advance && (
                              <div className="hq-approval-actions" style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  className="hq-btn hq-btn-sm hq-btn-primary"
                                  disabled={advanceStep.isPending}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    advanceStep.mutate({ id: inst.id, action: "approve" });
                                  }}
                                >
                                  Approve step
                                </button>
                                <button
                                  type="button"
                                  className="hq-btn hq-btn-sm hq-btn-ghost"
                                  disabled={advanceStep.isPending}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    advanceStep.mutate({ id: inst.id, action: "reject" });
                                  }}
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={7} style={{ background: "var(--hq-black-elevated)", padding: "0.75rem 1rem" }}>
                              {stepsQuery.isLoading ? <HqLoading message="Loading steps…" /> : (
                                <ol style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.82rem" }}>
                                  {steps.map((s) => (
                                    <li key={s.id} style={{ marginBottom: "0.35rem" }}>
                                      <StatusBadge label={s.status} variant={s.status === "active" ? "warning" : s.status === "completed" ? "success" : "muted"} />
                                      <span style={{ marginLeft: "0.5rem" }}>{s.step_name}</span>
                                      {s.completed_by && <span className="hq-muted-text"> · {s.completed_by}</span>}
                                    </li>
                                  ))}
                                  {!steps.length && <li className="hq-muted-text">No steps found for this instance.</li>}
                                </ol>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </HqQueryBoundary>
      </HqPanel>
    </HQLayout>
  );
};

export default WorkflowAutomationPage;
