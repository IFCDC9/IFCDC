import { getDb } from "../db";
import { getWorkflowSteps } from "./workflowOrchestration";
import { productionGrantOpportunitySqlFilter } from "./grantProductionPolicy";

export type ApprovalTask = {
  id: string;
  type:
    | "leave"
    | "expense"
    | "purchase_order"
    | "grant_founder_approval"
    | "document"
    | "workflow"
    | "onboarding"
    | "board_resolution"
    | "board_packet";
  title: string;
  subtitle: string;
  amount?: number;
  dueDate?: string;
  path: string;
  entityId: string;
  priority: "high" | "normal" | "low";
  createdAt: string;
  workflowStep?: string;
  workflowKey?: string;
};

async function safeQuery<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const db = await getDb();
  try {
    return (await db.all(sql, ...params)) as T[];
  } catch {
    return [];
  }
}

/** Live founder / executive approval queue — no demo deadlines or seed placeholders. */
export async function buildApprovalQueue(limit = 20): Promise<{ tasks: ApprovalTask[]; counts: Record<string, number> }> {
  const tasks: ApprovalTask[] = [];

  const leaveRows = await safeQuery<{
    id: string; first_name: string; last_name: string; leave_type: string; start_date: string; end_date: string; created_at: string;
  }>(
    `SELECT lr.id, p.first_name, p.last_name, lr.leave_type, lr.start_date, lr.end_date, lr.created_at
     FROM leave_requests lr JOIN people p ON p.id = lr.person_id
     WHERE lr.status = 'pending' ORDER BY lr.created_at DESC LIMIT 10`
  );
  for (const lr of leaveRows) {
    tasks.push({
      id: `leave-${lr.id}`,
      type: "leave",
      title: `Leave: ${lr.first_name} ${lr.last_name}`,
      subtitle: `${lr.leave_type} · ${lr.start_date} – ${lr.end_date}`,
      path: "/hq/people?tab=leave",
      entityId: lr.id,
      priority: "normal",
      createdAt: lr.created_at,
    });
  }

  const expenseRows = await safeQuery<{ id: string; description: string; amount_cents: number; category: string; created_at: string }>(
    `SELECT id, description, amount_cents, category, created_at FROM finance_expenses
     WHERE approval_status = 'pending' ORDER BY created_at DESC LIMIT 10`
  );
  for (const e of expenseRows) {
    tasks.push({
      id: `expense-${e.id}`,
      type: "expense",
      title: `Expense approval: ${e.description}`,
      subtitle: e.category,
      amount: e.amount_cents / 100,
      path: "/hq/finance",
      entityId: e.id,
      priority: "normal",
      createdAt: e.created_at,
    });
  }

  const poRows = await safeQuery<{ id: string; title: string; vendor: string; amount_cents: number; created_at: string }>(
    `SELECT id, title, vendor, amount_cents, created_at FROM finance_purchase_orders
     WHERE status = 'pending_approval' ORDER BY created_at DESC LIMIT 10`
  );
  for (const po of poRows) {
    tasks.push({
      id: `po-${po.id}`,
      type: "purchase_order",
      title: `Purchase order: ${po.title}`,
      subtitle: po.vendor,
      amount: po.amount_cents / 100,
      path: "/hq/finance",
      entityId: po.id,
      priority: "normal",
      createdAt: po.created_at,
    });
  }

  const founderGrantRows = await safeQuery<{
    id: string; title: string; amount_requested: number | null; created_at: string; funder: string | null;
  }>(
    `SELECT a.id, a.title, a.amount_requested, a.created_at, o.funder
     FROM grant_applications a
     LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
     WHERE a.status = 'draft'
       AND COALESCE(a.founder_approval_status, 'pending') = 'pending'
       AND (o.id IS NULL OR 1=1${productionGrantOpportunitySqlFilter("o")})
     ORDER BY a.updated_at DESC LIMIT 15`
  );
  for (const a of founderGrantRows) {
    tasks.push({
      id: `grant-founder-${a.id}`,
      type: "grant_founder_approval",
      title: `Grant draft — founder review: ${a.title}`,
      subtitle: a.funder ? `Funder: ${a.funder}` : "Awaiting founder approval before submission",
      amount: a.amount_requested != null ? Number(a.amount_requested) : undefined,
      path: `/hq/grants?tab=applications`,
      entityId: a.id,
      priority: "high",
      createdAt: a.created_at,
    });
  }

  const docRows = await safeQuery<{ id: string; title: string; category: string; created_at: string }>(
    `SELECT id, title, category, created_at FROM hq_documents
     WHERE approval_status = 'pending' ORDER BY created_at DESC LIMIT 10`
  );
  for (const d of docRows) {
    tasks.push({
      id: `doc-${d.id}`,
      type: "document",
      title: `Document review: ${d.title}`,
      subtitle: d.category,
      path: "/hq/documents",
      entityId: d.id,
      priority: "normal",
      createdAt: d.created_at,
    });
  }

  const onboardingRows = await safeQuery<{ id: string; first_name: string; last_name: string; created_at: string; pending_items: number }>(
    `SELECT p.id, p.first_name, p.last_name, p.created_at,
      (SELECT COUNT(*) FROM people_onboarding_items oi WHERE oi.person_id = p.id AND oi.completed = 0) as pending_items
     FROM people p
     WHERE p.status = 'onboarding'
       AND EXISTS (SELECT 1 FROM people_onboarding_items oi WHERE oi.person_id = p.id AND oi.completed = 0)
     ORDER BY p.created_at DESC LIMIT 10`
  );
  for (const p of onboardingRows) {
    tasks.push({
      id: `onboarding-${p.id}`,
      type: "onboarding",
      title: `Onboarding: ${p.first_name} ${p.last_name}`,
      subtitle: `${p.pending_items} checklist item(s) remaining`,
      path: `/hq/people?tab=onboarding`,
      entityId: p.id,
      priority: "normal",
      createdAt: p.created_at,
    });
  }

  const boardPacketRows = await safeQuery<{ id: string; title: string; status: string; created_at: string }>(
    `SELECT id, title, status, created_at FROM board_packets
     WHERE status IN ('draft', 'pending_review', 'review') ORDER BY created_at DESC LIMIT 10`
  );
  for (const pkt of boardPacketRows) {
    tasks.push({
      id: `board-packet-${pkt.id}`,
      type: "board_packet",
      title: `Board packet: ${pkt.title}`,
      subtitle: pkt.status.replace(/_/g, " "),
      path: "/hq/board-portal",
      entityId: pkt.id,
      priority: "high",
      createdAt: pkt.created_at,
    });
  }

  const boardResolutionRows = await safeQuery<{ id: string; title: string; status: string; created_at: string }>(
    `SELECT id, title, status, created_at FROM board_resolutions
     WHERE status IN ('proposed', 'voting') ORDER BY created_at DESC LIMIT 10`
  );
  for (const r of boardResolutionRows) {
    tasks.push({
      id: `board-${r.id}`,
      type: "board_resolution",
      title: `Board resolution: ${r.title}`,
      subtitle: r.status,
      path: "/hq/board-portal",
      entityId: r.id,
      priority: "high",
      createdAt: r.created_at,
    });
  }

  const workflowInstances = await safeQuery<{
    id: string;
    workflow_key: string;
    title: string;
    priority: string;
    created_at: string;
  }>(
    `SELECT id, workflow_key, title, priority, created_at FROM hq_workflow_instances
     WHERE status = 'pending'
       AND entity_id != 'seed-demo'
       AND title NOT LIKE '%demo%'
       AND title NOT LIKE '%Enterprise readiness%'
     ORDER BY created_at DESC LIMIT 20`
  );
  let workflowCount = 0;
  for (const inst of workflowInstances) {
    const steps = await getWorkflowSteps(inst.id).catch(() => []);
    const active = (steps as { status: string; step_name: string }[]).find((s) => s.status === "active");
    if (!active) continue;
    workflowCount++;
    tasks.push({
      id: `workflow-${inst.id}`,
      type: "workflow",
      title: inst.title,
      subtitle: `${active.step_name} · ${inst.workflow_key.replace(/_/g, " ")}`,
      path: "/hq/workflows",
      entityId: inst.id,
      priority: inst.priority === "high" ? "high" : "normal",
      createdAt: inst.created_at,
      workflowStep: active.step_name,
      workflowKey: inst.workflow_key,
    });
  }

  tasks.sort((a, b) => {
    const pri = { high: 0, normal: 1, low: 2 };
    if (pri[a.priority] !== pri[b.priority]) return pri[a.priority] - pri[b.priority];
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const counts = {
    leave: leaveRows.length,
    expense: expenseRows.length,
    purchase_order: poRows.length,
    grant_founder_approval: founderGrantRows.length,
    document: docRows.length,
    onboarding: onboardingRows.length,
    board_packet: boardPacketRows.length,
    board_resolution: boardResolutionRows.length,
    workflow: workflowCount,
    total: tasks.length,
  };

  return { tasks: tasks.slice(0, limit), counts };
}
