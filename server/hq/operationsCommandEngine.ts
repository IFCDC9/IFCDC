/**
 * IFCDC Headquarters — Operations Command Center (Phase 3)
 */
import { getDb } from "../db";
import { buildOperationsOverview } from "./operationsSchema";
import { opsId } from "./operationsSchema";

export const OPS_COMMAND_MODULES = [
  { id: "departments", label: "Department Management", path: "/hq/people?tab=departments" },
  { id: "teams", label: "Team Assignments", tab: "team-assignments" },
  { id: "tasks", label: "Task Management", tab: "tasks" },
  { id: "announcements", label: "Internal Announcements", path: "/hq/communications" },
  { id: "documents", label: "Document Approvals", path: "/hq/documents" },
  { id: "meetings", label: "Meeting Scheduler", path: "/hq/calendar" },
  { id: "assets", label: "Asset & Equipment", path: "/hq/assets" },
  { id: "vehicles", label: "Vehicle Management", path: "/hq/fleet" },
  { id: "calendar", label: "Organization Calendar", path: "/hq/calendar" },
] as const;

export async function listOpsTasks(status?: string) {
  const db = await getDb();
  let sql = `
    SELECT t.*, p.first_name, p.last_name, d.name as department_name
    FROM ops_tasks t
    LEFT JOIN people p ON p.id = t.assigned_person_id
    LEFT JOIN departments d ON d.id = t.department_id WHERE 1=1`;
  const params: string[] = [];
  if (status) { sql += " AND t.status = ?"; params.push(status); }
  sql += " ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.due_date ASC";
  return db.all(sql, ...params);
}

export async function createOpsTask(data: Record<string, unknown>, actor?: { email?: string }) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = opsId();
  await db.run(
    `INSERT INTO ops_tasks (id, title, description, assigned_person_id, department_id, project_id, due_date, status, priority, progress_pct, created_by_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, data.title, data.description ?? "", data.assigned_person_id ?? null, data.department_id ?? null,
    data.project_id ?? null, data.due_date ?? null, data.status ?? "open", data.priority ?? "normal",
    data.progress_pct ?? 0, actor?.email ?? null, now, now
  );
  return db.get("SELECT * FROM ops_tasks WHERE id = ?", id);
}

export async function updateOpsTask(id: string, data: Record<string, unknown>) {
  const db = await getDb();
  const now = new Date().toISOString();
  const fields = ["title", "description", "assigned_person_id", "department_id", "project_id", "due_date", "status", "priority", "progress_pct", "milestone_note"];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of fields) {
    if (data[f] !== undefined) { sets.push(`${f} = ?`); vals.push(data[f]); }
  }
  if (!sets.length) return db.get("SELECT * FROM ops_tasks WHERE id = ?", id);
  sets.push("updated_at = ?");
  vals.push(now, id);
  await db.run(`UPDATE ops_tasks SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  return db.get("SELECT * FROM ops_tasks WHERE id = ?", id);
}

export async function buildOperationsCommandCenter() {
  const db = await getDb();
  const overview = await buildOperationsOverview();

  let announcementCount = 0;
  let pendingDocs = 0;
  try {
    announcementCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_announcements WHERE status = 'active'"))?.c ?? 0;
  } catch { /* communications table */ }
  try {
    pendingDocs = (await db.get<{ c: number }>(
      "SELECT COUNT(*) as c FROM hq_documents WHERE approval_status = 'pending'"
    ))?.c ?? 0;
  } catch { /* approval column */ }

  const openTasks = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM ops_tasks WHERE status = 'open'"))?.c ?? 0;
  const teamAssignments = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM people_team_assignments WHERE status = 'active'"
  ))?.c ?? 0;
  const departments = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM departments"))?.c ?? 0;

  return {
    version: "phase3-operations",
    modules: OPS_COMMAND_MODULES,
    overview,
    counts: {
      departments,
      teamAssignments,
      openTasks,
      announcements: announcementCount,
      pendingDocumentApprovals: pendingDocs,
      assets: overview.assets.total,
      vehicles: overview.fleet.vehicles,
      upcomingEvents: overview.calendar.upcomingEvents,
      boardMeetings: overview.board.upcomingMeetings,
    },
    generatedAt: new Date().toISOString(),
  };
}
