/**
 * Phase 10 — Unified executive task hub (approvals, workflows, reminders).
 */
import { buildApprovalQueue } from "./enterpriseApprovals";
import { listWorkflowInstances } from "./workflowEngine";
import { getWorkflowSteps } from "./workflowOrchestration";
import { trackComplianceDeadlines } from "./auraExecutiveOps";

export interface ExecutiveTask {
  id: string;
  source: "approval" | "workflow" | "compliance";
  title: string;
  type: string;
  priority: "high" | "medium" | "low";
  status: string;
  dueAt: string | null;
  path: string | null;
  assignee: string | null;
  meta?: Record<string, unknown>;
}

export async function buildExecutiveTaskHub(limit = 30) {
  const [approvals, instances, compliance] = await Promise.all([
    buildApprovalQueue(limit),
    listWorkflowInstances({ limit: 20 }),
    trackComplianceDeadlines(),
  ]);

  const tasks: ExecutiveTask[] = [];

  for (const t of approvals.tasks) {
    tasks.push({
      id: `approval-${t.id}`,
      source: "approval",
      title: t.title,
      type: t.type,
      priority: t.priority === "high" ? "high" : t.priority === "low" ? "low" : "medium",
      status: "pending",
      dueAt: t.dueDate ?? null,
      path: t.path ?? "/hq/workflows",
      assignee: null,
    });
  }

  const pendingWorkflows = instances.filter((i) => i.status === "pending" || i.status === "active");
  for (const inst of pendingWorkflows.slice(0, 12)) {
    const steps = await getWorkflowSteps(inst.id).catch(() => []);
    const active = (steps as { status: string; step_name: string }[]).find((s) => s.status === "active");
    const overdue = inst.due_at && new Date(inst.due_at) < new Date();
    tasks.push({
      id: `workflow-${inst.id}`,
      source: "workflow",
      title: inst.title,
      type: inst.workflow_key,
      priority: overdue ? "high" : inst.priority === "high" ? "high" : "medium",
      status: inst.status,
      dueAt: inst.due_at,
      path: "/hq/workflows",
      assignee: inst.assigned_to,
      meta: { activeStep: active?.step_name, stepCount: steps.length },
    });
  }

  const deadlineItems = (compliance.deadlines ?? []).slice(0, 8);
  for (let idx = 0; idx < deadlineItems.length; idx++) {
    const item = deadlineItems[idx];
    const daysUntil = Math.ceil((new Date(item.dueDate).getTime() - Date.now()) / 86400000);
    const overdue = daysUntil < 0;
    tasks.push({
      id: `compliance-${item.type}-${idx}`,
      source: "compliance",
      title: item.title,
      type: item.type,
      priority: overdue || daysUntil <= 7 ? "high" : "medium",
      status: overdue ? "overdue" : "due",
      dueAt: item.dueDate,
      path: "/hq/compliance",
      assignee: null,
      meta: { daysUntil, detail: item.detail },
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  tasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    tasks: tasks.slice(0, limit),
    counts: {
      total: tasks.length,
      approvals: approvals.counts.total ?? approvals.tasks.length,
      workflows: pendingWorkflows.length,
      compliance: compliance.overdue + compliance.dueNext14Days,
      highPriority: tasks.filter((t) => t.priority === "high").length,
    },
    generatedAt: new Date().toISOString(),
  };
}
