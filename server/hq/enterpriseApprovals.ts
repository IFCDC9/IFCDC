import { getDb } from "../db";

export type ApprovalTask = {
  id: string;
  type: "leave" | "expense" | "purchase_order" | "grant_application" | "document" | "grant_deadline";
  title: string;
  subtitle: string;
  amount?: number;
  dueDate?: string;
  path: string;
  entityId: string;
  priority: "high" | "normal" | "low";
  createdAt: string;
};

async function safeQuery<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const db = await getDb();
  try {
    return (await db.all(sql, ...params)) as T[];
  } catch {
    return [];
  }
}

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

  const appRows = await safeQuery<{ id: string; title: string; status: string; created_at: string }>(
    `SELECT id, title, status, created_at FROM grant_applications
     WHERE status IN ('draft', 'submitted', 'under_review') ORDER BY created_at DESC LIMIT 10`
  );
  for (const a of appRows) {
    tasks.push({
      id: `grant-app-${a.id}`,
      type: "grant_application",
      title: `Grant application: ${a.title}`,
      subtitle: a.status.replace(/_/g, " "),
      path: "/hq/grants",
      entityId: a.id,
      priority: a.status === "submitted" ? "high" : "normal",
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

  const deadlineRows = await safeQuery<{ id: string; title: string; due_date: string; deadline_type: string }>(
    `SELECT id, title, due_date, deadline_type FROM grant_deadlines
     WHERE completed = 0 AND due_date <= date('now', '+14 days') ORDER BY due_date ASC LIMIT 10`
  );
  for (const d of deadlineRows) {
    tasks.push({
      id: `deadline-${d.id}`,
      type: "grant_deadline",
      title: d.title,
      subtitle: d.deadline_type,
      dueDate: d.due_date,
      path: "/hq/grants",
      entityId: d.id,
      priority: "high",
      createdAt: d.due_date,
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
    grant_application: appRows.length,
    document: docRows.length,
    grant_deadline: deadlineRows.length,
    total: tasks.length,
  };

  return { tasks: tasks.slice(0, limit), counts };
}
