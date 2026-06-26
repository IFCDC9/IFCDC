import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Workflow, Play, RefreshCw, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { workflowApi, type WorkflowInstance } from "../../api/workflowApi";
import { enterpriseApi } from "../../api/enterpriseApi";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";

const WorkflowAutomationPage: React.FC = () => {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const dashboard = useQuery({ queryKey: ["workflow-dashboard"], queryFn: workflowApi.dashboard, staleTime: 45_000 });
  const stepsQuery = useQuery({
    queryKey: ["workflow-steps", expandedId],
    queryFn: () => workflowApi.steps(expandedId!),
    enabled: Boolean(expandedId),
  });

  const runScheduled = useMutation({
    mutationFn: workflowApi.runScheduled,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflow-dashboard"] }),
  });

  const processApproval = useMutation({
    mutationFn: ({ taskId, action }: { taskId: string; action: "approve" | "reject" }) =>
      enterpriseApi.processApproval(taskId, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow-dashboard"] });
      qc.invalidateQueries({ queryKey: ["hq-approval-tasks"] });
    },
  });

  const advanceStep = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      workflowApi.advance(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow-dashboard"] });
      qc.invalidateQueries({ queryKey: ["workflow-steps", expandedId] });
    },
  });

  const data = dashboard.data;
  const counts = data?.counts ?? {};

  return (
    <HQLayout
      title="Workflow Automation"
      subtitle="Approval workflows, task assignments, compliance reminders, and scheduled reports"
    >
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
            <Play size={14} /> {runScheduled.isPending ? "Running…" : "Run Scheduled Jobs"}
          </button>
        </div>
      </div>

      {dashboard.isLoading ? <HqLoading /> : (
        <div className="hq-grid-main-side hq-fade-in">
          <HqPanel title="Workflow Definitions" subtitle="Onboarding, board approval, grant deadlines, compliance reminders">
            <table className="hq-table">
              <thead><tr><th>Workflow</th><th>Category</th><th>Status</th></tr></thead>
              <tbody>
                {(data?.definitions ?? []).map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{d.name}</div>
                      <div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>{d.description}</div>
                    </td>
                    <td><StatusBadge label={d.category} variant="muted" /></td>
                    <td><StatusBadge label={d.enabled ? "Active" : "Disabled"} variant={d.enabled ? "success" : "muted"} /></td>
                  </tr>
                ))}
                {!data?.definitions?.length && (
                  <tr><td colSpan={3} className="hq-empty-cell">Workflow definitions seed on first load</td></tr>
                )}
              </tbody>
            </table>
          </HqPanel>

          <HqPanel title="Scheduled Jobs" subtitle="Automated reports and compliance notifications">
            <ul className="hq-activity-list">
              {(data?.jobs ?? []).map((job) => (
                <li key={job.id} className="hq-activity-item">
                  <Workflow size={14} style={{ color: "var(--hq-gold)", flexShrink: 0 }} />
                  <div className="hq-activity-content">
                    <div className="hq-activity-title">{job.name}</div>
                    <div className="hq-activity-detail">{(job as { schedule_expr?: string }).schedule_expr ?? job.schedule ?? "daily"} · Next: {(job as { next_run_at?: string }).next_run_at ? new Date((job as { next_run_at: string }).next_run_at).toLocaleString() : "—"} · Last: {job.last_run_at ? new Date(job.last_run_at).toLocaleString() : "Never"}</div>
                  </div>
                  <StatusBadge label={job.enabled ? "Enabled" : "Off"} variant={job.enabled ? "success" : "muted"} />
                </li>
              ))}
            </ul>
          </HqPanel>
        </div>
      )}

      <div style={{ marginTop: "1.25rem" }}>
        <HqPanel title="Approval Queue" subtitle="Process pending executive approvals inline">
        {dashboard.isLoading ? <HqLoading /> : (
          <table className="hq-table">
            <thead><tr><th>Task</th><th>Type</th><th>Priority</th><th>Actions</th></tr></thead>
            <tbody>
              {(data?.approvalTasks as { id: string; title: string; type: string; priority: string }[] ?? []).map((task) => (
                <tr key={task.id}>
                  <td>{task.title}</td>
                  <td><StatusBadge label={task.type} variant="muted" /></td>
                  <td><StatusBadge label={task.priority} variant={task.priority === "high" ? "warning" : "muted"} /></td>
                  <td>
                    <div style={{ display: "flex", gap: "0.35rem" }}>
                      <button
                        type="button"
                        className="hq-btn hq-btn-sm hq-btn-primary"
                        disabled={processApproval.isPending}
                        onClick={() => processApproval.mutate({ taskId: task.id, action: "approve" })}
                      >
                        <CheckCircle size={12} /> Approve
                      </button>
                      <button
                        type="button"
                        className="hq-btn hq-btn-sm hq-btn-ghost"
                        disabled={processApproval.isPending}
                        onClick={() => processApproval.mutate({ taskId: task.id, action: "reject" })}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!data?.approvalTasks?.length && (
                <tr><td colSpan={4} className="hq-empty-cell">No pending approvals</td></tr>
              )}
            </tbody>
          </table>
        )}
        </HqPanel>
      </div>

      <HqPanel title="Active Workflow Instances" subtitle="Multi-step approvals — expand to review and advance">
        <table className="hq-table">
          <thead><tr><th></th><th>Title</th><th>Workflow</th><th>Status</th><th>Due</th><th>Actions</th></tr></thead>
          <tbody>
            {(data?.instances ?? []).map((inst: WorkflowInstance) => {
              const expanded = expandedId === inst.id;
              const steps = expanded ? (stepsQuery.data?.steps ?? []) : [];
              const activeStep = steps.find((s) => s.status === "active");
              return (
                <React.Fragment key={inst.id}>
                  <tr>
                    <td>
                      <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => setExpandedId(expanded ? null : inst.id)}>
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </td>
                    <td>{inst.title}</td>
                    <td>{inst.workflow_key}</td>
                    <td>
                      <StatusBadge
                        label={inst.status}
                        variant={inst.status === "pending" ? "warning" : inst.status === "completed" ? "success" : "muted"}
                      />
                    </td>
                    <td>{inst.due_at ? new Date(inst.due_at).toLocaleDateString() : "—"}</td>
                    <td>
                      {inst.status === "pending" && activeStep && (
                        <div style={{ display: "flex", gap: "0.35rem" }}>
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" disabled={advanceStep.isPending} onClick={() => advanceStep.mutate({ id: inst.id, action: "approve" })}>
                            Approve step
                          </button>
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled={advanceStep.isPending} onClick={() => advanceStep.mutate({ id: inst.id, action: "reject" })}>
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={6} style={{ background: "var(--hq-black-elevated)", padding: "0.75rem 1rem" }}>
                        {stepsQuery.isLoading ? <HqLoading message="Loading steps…" /> : (
                          <ol style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.82rem" }}>
                            {steps.map((s) => (
                              <li key={s.id} style={{ marginBottom: "0.35rem" }}>
                                <StatusBadge label={s.status} variant={s.status === "active" ? "warning" : s.status === "completed" ? "success" : "muted"} />
                                <span style={{ marginLeft: "0.5rem" }}>{s.step_name}</span>
                                {s.completed_by && <span className="hq-muted-text"> · {s.completed_by}</span>}
                              </li>
                            ))}
                            {!steps.length && <li className="hq-muted-text">No multi-step definition for this workflow</li>}
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
      </HqPanel>
    </HQLayout>
  );
};

export default WorkflowAutomationPage;
