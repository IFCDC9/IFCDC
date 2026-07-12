/**
 * Build 60 — Executive Operations Center Foundation
 * Aggregates live HQ engines into one executive command surface.
 * Freeze-safe: extends server/hq only — no new top-level packages.
 */
import { getDb } from "../db";
import { buildOperationsOverview, ensureOperationsTables, opsId } from "./operationsSchema";
import { ensurePeopleTables } from "./peopleSchema";
import { ensureWorkflowTables } from "./workflowEngineSchema";

export const EXECUTIVE_DEPARTMENTS = [
  {
    id: "executive_admin",
    label: "Executive Administration",
    code: "EXEC",
    path: "/hq",
    docsPath: "/hq/documents?category=executive",
    reportsPath: "/hq/reports",
    kpiKeys: ["openTasks", "upcomingDeadlines", "systemAlerts"] as const,
  },
  {
    id: "finance",
    label: "Finance",
    code: "FINANCE",
    path: "/hq/finance",
    docsPath: "/hq/documents?category=finance",
    reportsPath: "/hq/reports",
    kpiKeys: ["financialHealth"] as const,
  },
  {
    id: "human_resources",
    label: "Human Resources",
    code: "HR",
    path: "/hq/people",
    docsPath: "/hq/documents?category=hr",
    reportsPath: "/hq/people",
    kpiKeys: ["employees", "volunteers", "openLeave"] as const,
  },
  {
    id: "grants",
    label: "Grants",
    code: "GRANTS",
    path: "/hq/grants",
    docsPath: "/hq/documents?category=grants",
    reportsPath: "/hq/grants",
    kpiKeys: ["activeGrants", "grantDeadlines"] as const,
  },
  {
    id: "community_programs",
    label: "Community Programs",
    code: "PROGRAMS",
    path: "/hq/programs",
    docsPath: "/hq/documents?category=programs",
    reportsPath: "/hq/programs",
    kpiKeys: ["activePrograms", "clients"] as const,
  },
  {
    id: "transitional_housing",
    label: "Transitional Housing",
    code: "HOUSING",
    path: "/hq/housing",
    docsPath: "/hq/documents?category=housing",
    reportsPath: "/hq/housing",
    kpiKeys: ["housingUnits", "placements"] as const,
  },
  {
    id: "economic_development",
    label: "Economic Development",
    code: "ECON",
    path: "/hq/programs/economic-development",
    docsPath: "/hq/documents?category=programs",
    reportsPath: "/hq/programs",
    kpiKeys: ["activePrograms"] as const,
  },
  {
    id: "education_scholarship",
    label: "Education & Scholarship Programs",
    code: "EDU",
    path: "/hq/scholarships",
    docsPath: "/hq/documents?category=scholarships",
    reportsPath: "/hq/scholarships",
    kpiKeys: ["scholarships"] as const,
  },
  {
    id: "youth_mentorship",
    label: "Youth & Mentorship Programs",
    code: "YOUTH",
    path: "/hq/programs/mentorship",
    docsPath: "/hq/documents?category=programs",
    reportsPath: "/hq/programs",
    kpiKeys: ["activePrograms"] as const,
  },
  {
    id: "productions",
    label: "IFCDC Productions",
    code: "PROD",
    path: "/hq/media",
    docsPath: "/hq/documents?category=media",
    reportsPath: "/hq/media",
    kpiKeys: ["mediaContent"] as const,
  },
  {
    id: "software_division",
    label: "IFCDC Software Division",
    code: "TECH",
    path: "/hq/software",
    docsPath: "/hq/documents?category=technology",
    reportsPath: "/hq/software",
    kpiKeys: ["softwareApps"] as const,
  },
  {
    id: "radio",
    label: "IFCDC Radio",
    code: "RADIO",
    path: "/hq/media",
    docsPath: "/hq/documents?category=media",
    reportsPath: "/hq/media",
    kpiKeys: ["broadcasts"] as const,
  },
  {
    id: "music",
    label: "IFCDC Music",
    code: "MUSIC",
    path: "/hq/software",
    docsPath: "/hq/documents?category=media",
    reportsPath: "/hq/software",
    kpiKeys: ["softwareApps"] as const,
  },
] as const;

export type ExecutiveDepartmentId = (typeof EXECUTIVE_DEPARTMENTS)[number]["id"];

export const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export const COMPLIANCE_FILING_TYPES = [
  "irs_filing",
  "state_filing",
  "insurance_renewal",
  "license",
  "certification",
  "policy",
  "board_requirement",
  "internal_audit",
] as const;

async function safeCount(sql: string, ...params: unknown[]): Promise<number> {
  try {
    const db = await getDb();
    const row = await db.get<{ c: number }>(sql, ...params);
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

async function ensureOpsProjectColumns(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ops_projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      department_id TEXT,
      department_key TEXT,
      owner_person_id TEXT,
      status TEXT DEFAULT 'active',
      priority TEXT DEFAULT 'normal',
      progress_pct INTEGER DEFAULT 0,
      start_date TEXT,
      due_date TEXT,
      milestone_summary TEXT,
      executive_summary TEXT,
      created_by_email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ops_projects_status ON ops_projects(status);
    CREATE INDEX IF NOT EXISTS idx_ops_projects_dept ON ops_projects(department_id);

    CREATE TABLE IF NOT EXISTS ops_milestones (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      due_date TEXT,
      status TEXT DEFAULT 'open',
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ops_milestones_project ON ops_milestones(project_id);

    CREATE TABLE IF NOT EXISTS compliance_filings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      filing_type TEXT NOT NULL,
      authority TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'open',
      risk_level TEXT DEFAULT 'medium',
      owner_person_id TEXT,
      department_key TEXT,
      notes TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_compliance_filings_due ON compliance_filings(due_date);
    CREATE INDEX IF NOT EXISTS idx_compliance_filings_status ON compliance_filings(status);
  `);

  for (const col of ["project_id TEXT", "progress_pct INTEGER DEFAULT 0", "milestone_note TEXT"]) {
    try {
      await db.exec(`ALTER TABLE ops_tasks ADD COLUMN ${col}`);
    } catch {
      /* exists */
    }
  }
}

export async function ensureExecutiveOperationsFoundation(): Promise<void> {
  await ensureOperationsTables();
  await ensurePeopleTables();
  await ensureWorkflowTables();
  await ensureOpsProjectColumns();
  await seedBuild60Departments();
  await seedComplianceFilingsIfEmpty();
  await ensureOpsAutomationJobs();
}

async function seedBuild60Departments(): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const extras = [
    { name: "Grants Administration", code: "GRANTS" },
    { name: "Transitional Housing", code: "HOUSING" },
    { name: "Economic Development", code: "ECON" },
    { name: "Education & Scholarships", code: "EDU" },
    { name: "Youth & Mentorship", code: "YOUTH" },
    { name: "IFCDC Productions", code: "PROD" },
    { name: "IFCDC Radio", code: "RADIO" },
    { name: "IFCDC Music", code: "MUSIC" },
  ];
  for (const d of extras) {
    const exists = await db.get("SELECT id FROM departments WHERE code = ?", d.code);
    if (!exists) {
      await db.run(
        `INSERT INTO departments (id, name, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        opsId(),
        d.name,
        d.code,
        now,
        now
      );
    }
  }
}

async function seedComplianceFilingsIfEmpty(): Promise<void> {
  const db = await getDb();
  const count = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM compliance_filings"))?.c ?? 0;
  if (count > 0) return;
  const now = new Date().toISOString();
  const seeds = [
    { title: "IRS Form 990 Filing", type: "irs_filing", authority: "IRS", due: "2026-11-15", risk: "high" },
    { title: "State Charity Registration Renewal", type: "state_filing", authority: "State AG", due: "2026-09-30", risk: "high" },
    { title: "General Liability Insurance Renewal", type: "insurance_renewal", authority: "Carrier", due: "2026-08-01", risk: "medium" },
    { title: "Directors & Officers Insurance", type: "insurance_renewal", authority: "Carrier", due: "2026-10-01", risk: "medium" },
    { title: "Nonprofit Operating License Review", type: "license", authority: "State", due: "2026-12-31", risk: "low" },
    { title: "Board Conflict of Interest Certifications", type: "board_requirement", authority: "Board", due: "2026-07-31", risk: "medium" },
    { title: "Internal Controls Audit", type: "internal_audit", authority: "Finance Committee", due: "2026-09-15", risk: "medium" },
    { title: "Employee Handbook Policy Review", type: "policy", authority: "HR", due: "2026-08-15", risk: "low" },
  ];
  for (const s of seeds) {
    await db.run(
      `INSERT INTO compliance_filings (id, title, filing_type, authority, due_date, status, risk_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      opsId(),
      s.title,
      s.type,
      s.authority,
      s.due,
      s.risk,
      now,
      now
    );
  }
}

async function ensureOpsAutomationJobs(): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const jobs = [
    { key: "ops_task_reminders", name: "Operational Task Reminders", schedule: "daily", module: "operations" },
    { key: "ops_deadline_notifications", name: "Deadline Notifications", schedule: "daily", module: "operations" },
    { key: "ops_compliance_alerts", name: "Compliance Risk Alerts", schedule: "daily", module: "compliance" },
    { key: "ops_department_reporting", name: "Department Reporting Schedule", schedule: "weekly", module: "executive" },
    { key: "ops_approval_digest", name: "Approval Request Digest", schedule: "daily", module: "operations" },
  ];
  for (const job of jobs) {
    const exists = await db.get("SELECT id FROM hq_scheduled_jobs WHERE job_key = ?", job.key);
    if (!exists) {
      await db.run(
        `INSERT INTO hq_scheduled_jobs (id, job_key, name, schedule_expr, source_module, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        opsId(),
        job.key,
        job.name,
        job.schedule,
        job.module,
        now
      );
    }
  }

  const defs = [
    { key: "task_reminder", name: "Task Reminder", trigger: "scheduled", description: "Remind assignees of upcoming task due dates" },
    { key: "deadline_notification", name: "Deadline Notification", trigger: "scheduled", description: "Notify leadership of approaching operational deadlines" },
    { key: "compliance_alert", name: "Compliance Alert", trigger: "scheduled", description: "Escalate overdue filings and high-risk compliance items" },
    { key: "approval_request", name: "Approval Request", trigger: "event", description: "Route operational approvals to executives" },
    { key: "department_report_schedule", name: "Department Reporting Schedule", trigger: "scheduled", description: "Weekly department performance report generation" },
  ];
  for (const def of defs) {
    const exists = await db.get("SELECT id FROM hq_workflow_definitions WHERE workflow_key = ?", def.key);
    if (!exists) {
      await db.run(
        `INSERT INTO hq_workflow_definitions (id, workflow_key, name, trigger_type, description, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        opsId(),
        def.key,
        def.name,
        def.trigger,
        def.description,
        now,
        now
      );
    }
  }
}

function healthScore(parts: { weight: number; ok: boolean }[]): number {
  const total = parts.reduce((s, p) => s + p.weight, 0) || 1;
  const earned = parts.reduce((s, p) => s + (p.ok ? p.weight : 0), 0);
  return Math.round((earned / total) * 100);
}

export async function buildExecutiveOperationsDashboard() {
  await ensureExecutiveOperationsFoundation();
  const db = await getDb();
  const ops = await buildOperationsOverview();

  const employees = await safeCount(
    "SELECT COUNT(*) as c FROM people WHERE person_type IN ('employee','staff','contractor') AND status = 'active'"
  );
  const volunteers = await safeCount(
    "SELECT COUNT(*) as c FROM people WHERE person_type = 'volunteer' AND status = 'active'"
  );
  let clients = await safeCount(
    "SELECT COUNT(*) as c FROM people WHERE person_type = 'client' AND status = 'active'"
  );
  if (clients === 0) {
    clients = await safeCount("SELECT COUNT(*) as c FROM people WHERE person_type = 'client'");
  }

  const openTasks = await safeCount("SELECT COUNT(*) as c FROM ops_tasks WHERE status IN ('open','in_progress')");
  const overdueTasks = await safeCount(
    "SELECT COUNT(*) as c FROM ops_tasks WHERE status IN ('open','in_progress') AND due_date IS NOT NULL AND due_date < date('now')"
  );
  const activeProjects = await safeCount("SELECT COUNT(*) as c FROM ops_projects WHERE status IN ('planning','active')");
  const openLeave = await safeCount(
    "SELECT COUNT(*) as c FROM leave_requests WHERE status IN ('pending','approved') AND end_date >= date('now')"
  );

  const activeGrants = await safeCount(
    "SELECT COUNT(*) as c FROM grant_applications WHERE status IN ('draft','submitted','under_review','awarded')"
  );
  const grantDeadlines = await safeCount(
    `SELECT COUNT(*) as c FROM grant_deadlines
     WHERE completed = 0 AND due_date IS NOT NULL AND due_date <= date('now', '+30 days')`
  );

  let activePrograms = await safeCount("SELECT COUNT(*) as c FROM hq_program_registry WHERE status = 'active'");
  if (activePrograms === 0) {
    activePrograms = await safeCount("SELECT COUNT(*) as c FROM scholarship_programs WHERE status = 'open'");
  }

  const openFilings = await safeCount(
    "SELECT COUNT(*) as c FROM compliance_filings WHERE status IN ('open','in_progress')"
  );
  const overdueFilings = await safeCount(
    "SELECT COUNT(*) as c FROM compliance_filings WHERE status IN ('open','in_progress') AND due_date < date('now')"
  );
  const dueSoonFilings = await safeCount(
    "SELECT COUNT(*) as c FROM compliance_filings WHERE status IN ('open','in_progress') AND due_date BETWEEN date('now') AND date('now', '+30 days')"
  );
  const highRiskFilings = await safeCount(
    "SELECT COUNT(*) as c FROM compliance_filings WHERE status IN ('open','in_progress') AND risk_level = 'high'"
  );

  const pendingApprovals = await safeCount(
    "SELECT COUNT(*) as c FROM hq_workflow_instances WHERE status IN ('pending','in_progress')"
  );
  const scheduledJobs = await safeCount("SELECT COUNT(*) as c FROM hq_scheduled_jobs WHERE enabled = 1");

  let softwareApps = 8;
  try {
    const { SOFTWARE_DIVISION_APPS } = await import("./appRegistry");
    softwareApps = SOFTWARE_DIVISION_APPS.length;
  } catch {
    /* default */
  }

  const organizationHealth = healthScore([
    { weight: 25, ok: overdueTasks === 0 },
    { weight: 25, ok: overdueFilings === 0 },
    { weight: 20, ok: ops.compliance.highRisks === 0 },
    { weight: 15, ok: employees > 0 },
    { weight: 15, ok: activePrograms > 0 || activeGrants > 0 },
  ]);

  const operationalHealth = healthScore([
    { weight: 30, ok: ops.facilities.openWorkOrders < 5 },
    { weight: 25, ok: ops.fleet.maintenanceDue < 3 },
    { weight: 25, ok: openTasks < 25 },
    { weight: 20, ok: overdueTasks === 0 },
  ]);

  const financialHealth = healthScore([
    { weight: 40, ok: activeGrants > 0 },
    { weight: 30, ok: ops.board.openActions < 10 },
    { weight: 30, ok: overdueFilings === 0 },
  ]);

  const complianceStatus =
    overdueFilings > 0 || ops.compliance.highRisks > 0
      ? "critical"
      : dueSoonFilings > 0 || openFilings > 3
        ? "watch"
        : "healthy";

  const systemAlerts: { id: string; severity: string; title: string; detail: string; path: string }[] = [];
  if (overdueTasks > 0) {
    systemAlerts.push({
      id: "overdue-tasks",
      severity: "high",
      title: "Overdue operational tasks",
      detail: `${overdueTasks} task(s) past due`,
      path: "/hq/operations?tab=projects",
    });
  }
  if (overdueFilings > 0) {
    systemAlerts.push({
      id: "overdue-filings",
      severity: "critical",
      title: "Overdue compliance filings",
      detail: `${overdueFilings} filing(s) past due`,
      path: "/hq/operations?tab=compliance",
    });
  }
  if (ops.compliance.highRisks > 0) {
    systemAlerts.push({
      id: "high-risks",
      severity: "high",
      title: "High compliance risks open",
      detail: `${ops.compliance.highRisks} high-severity risk(s)`,
      path: "/hq/compliance",
    });
  }
  if (ops.fleet.maintenanceDue > 0) {
    systemAlerts.push({
      id: "fleet-maint",
      severity: "medium",
      title: "Fleet maintenance due",
      detail: `${ops.fleet.maintenanceDue} vehicle(s)`,
      path: "/hq/fleet",
    });
  }
  if (pendingApprovals > 5) {
    systemAlerts.push({
      id: "approvals",
      severity: "medium",
      title: "Approval backlog",
      detail: `${pendingApprovals} pending workflow(s)`,
      path: "/hq/workflows",
    });
  }

  const upcomingDeadlines = await db.all(
    `SELECT id, title, due_date as dueDate, 'task' as kind, priority as meta
     FROM ops_tasks
     WHERE status IN ('open','in_progress') AND due_date IS NOT NULL AND due_date <= date('now', '+45 days')
     UNION ALL
     SELECT id, title, due_date as dueDate, 'project' as kind, status as meta
     FROM ops_projects
     WHERE status IN ('planning','active') AND due_date IS NOT NULL AND due_date <= date('now', '+45 days')
     UNION ALL
     SELECT id, title, due_date as dueDate, 'compliance' as kind, filing_type as meta
     FROM compliance_filings
     WHERE status IN ('open','in_progress') AND due_date IS NOT NULL AND due_date <= date('now', '+45 days')
     ORDER BY dueDate ASC
     LIMIT 20`
  );

  return {
    version: "build60-executive-operations",
    generatedAt: new Date().toISOString(),
    organizationHealth,
    operationalHealth,
    financialHealth,
    grantActivity: { active: activeGrants, deadlinesSoon: grantDeadlines },
    employeeActivity: { active: employees, openLeave },
    volunteerActivity: { active: volunteers },
    activePrograms,
    clientServices: { clients, housingPlacements: ops.housing.placements, scholarshipAwards: ops.scholarships.awarded },
    openTasks: { total: openTasks, overdue: overdueTasks },
    activeProjects,
    complianceStatus: {
      status: complianceStatus,
      openFilings,
      overdue: overdueFilings,
      dueSoon: dueSoonFilings,
      highRisk: highRiskFilings,
      openRisks: ops.compliance.openRisks,
      policies: ops.compliance.policies,
    },
    systemAlerts,
    upcomingDeadlines,
    automation: { pendingApprovals, scheduledJobs },
    operationsSnapshot: ops,
    softwareApps,
    media: ops.media,
  };
}

export async function buildDepartmentMatrix() {
  await ensureExecutiveOperationsFoundation();
  const db = await getDb();
  const dash = await buildExecutiveOperationsDashboard();
  const deptRows = (await db.all("SELECT id, name, code FROM departments ORDER BY name ASC")) as {
    id: string;
    name: string;
    code: string;
  }[];

  const kpiBag: Record<string, number> = {
    openTasks: dash.openTasks.total,
    upcomingDeadlines: dash.upcomingDeadlines.length,
    systemAlerts: dash.systemAlerts.length,
    financialHealth: dash.financialHealth,
    employees: dash.employeeActivity.active,
    volunteers: dash.volunteerActivity.active,
    openLeave: dash.employeeActivity.openLeave,
    activeGrants: dash.grantActivity.active,
    grantDeadlines: dash.grantActivity.deadlinesSoon,
    activePrograms: dash.activePrograms,
    clients: dash.clientServices.clients,
    housingUnits: dash.operationsSnapshot.housing.units,
    placements: dash.operationsSnapshot.housing.placements,
    scholarships: dash.operationsSnapshot.scholarships.programs,
    mediaContent: dash.operationsSnapshot.media.content,
    broadcasts: dash.operationsSnapshot.media.broadcasts,
    softwareApps: dash.softwareApps,
  };

  return {
    generatedAt: new Date().toISOString(),
    departments: EXECUTIVE_DEPARTMENTS.map((d) => {
      const linked = deptRows.find((r) => r.code === d.code);
      return {
        ...d,
        linkedDepartmentId: linked?.id ?? null,
        linkedDepartmentName: linked?.name ?? d.label,
        kpis: d.kpiKeys.map((key) => ({ key, value: kpiBag[key] ?? 0 })),
        health:
          dash.complianceStatus.status === "critical" &&
          (d.id === "finance" || d.id === "grants" || d.id === "executive_admin")
            ? "watch"
            : "healthy",
      };
    }),
  };
}

export async function listOpsProjects(status?: string) {
  await ensureExecutiveOperationsFoundation();
  const db = await getDb();
  let sql = `
    SELECT p.*, d.name as department_name,
      (SELECT COUNT(*) FROM ops_tasks t WHERE t.project_id = p.id) as task_count,
      (SELECT COUNT(*) FROM ops_milestones m WHERE m.project_id = p.id AND m.status = 'open') as open_milestones
    FROM ops_projects p
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE 1=1`;
  const params: string[] = [];
  if (status) {
    sql += " AND p.status = ?";
    params.push(status);
  }
  sql += " ORDER BY CASE p.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, p.due_date ASC";
  return db.all(sql, ...params);
}

export async function createOpsProject(data: Record<string, unknown>, actor?: { email?: string }) {
  await ensureExecutiveOperationsFoundation();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = opsId();
  await db.run(
    `INSERT INTO ops_projects (
      id, title, description, department_id, department_key, owner_person_id, status, priority,
      progress_pct, start_date, due_date, milestone_summary, executive_summary, created_by_email, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.title,
    data.description ?? "",
    data.department_id ?? null,
    data.department_key ?? null,
    data.owner_person_id ?? null,
    data.status ?? "active",
    data.priority ?? "normal",
    data.progress_pct ?? 0,
    data.start_date ?? null,
    data.due_date ?? null,
    data.milestone_summary ?? "",
    data.executive_summary ?? "",
    actor?.email ?? null,
    now,
    now
  );
  return db.get("SELECT * FROM ops_projects WHERE id = ?", id);
}

export async function updateOpsProject(id: string, data: Record<string, unknown>) {
  await ensureExecutiveOperationsFoundation();
  const db = await getDb();
  const now = new Date().toISOString();
  const fields = [
    "title",
    "description",
    "department_id",
    "department_key",
    "owner_person_id",
    "status",
    "priority",
    "progress_pct",
    "start_date",
    "due_date",
    "milestone_summary",
    "executive_summary",
  ];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of fields) {
    if (data[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(data[f]);
    }
  }
  if (!sets.length) return db.get("SELECT * FROM ops_projects WHERE id = ?", id);
  sets.push("updated_at = ?");
  vals.push(now, id);
  await db.run(`UPDATE ops_projects SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  return db.get("SELECT * FROM ops_projects WHERE id = ?", id);
}

export async function createOpsMilestone(projectId: string, data: { title: string; due_date?: string }) {
  await ensureExecutiveOperationsFoundation();
  const db = await getDb();
  const id = opsId();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO ops_milestones (id, project_id, title, due_date, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)`,
    id,
    projectId,
    data.title,
    data.due_date ?? null,
    now
  );
  return db.get("SELECT * FROM ops_milestones WHERE id = ?", id);
}

export async function listComplianceFilings(status?: string) {
  await ensureExecutiveOperationsFoundation();
  const db = await getDb();
  let sql = "SELECT * FROM compliance_filings WHERE 1=1";
  const params: string[] = [];
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date ASC";
  return db.all(sql, ...params);
}

export async function createComplianceFiling(data: Record<string, unknown>) {
  await ensureExecutiveOperationsFoundation();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = opsId();
  await db.run(
    `INSERT INTO compliance_filings (
      id, title, filing_type, authority, due_date, status, risk_level, owner_person_id, department_key, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.title,
    data.filing_type ?? "policy",
    data.authority ?? null,
    data.due_date ?? null,
    data.status ?? "open",
    data.risk_level ?? "medium",
    data.owner_person_id ?? null,
    data.department_key ?? null,
    data.notes ?? "",
    now,
    now
  );
  return db.get("SELECT * FROM compliance_filings WHERE id = ?", id);
}

export async function updateComplianceFiling(id: string, data: Record<string, unknown>) {
  await ensureExecutiveOperationsFoundation();
  const db = await getDb();
  const now = new Date().toISOString();
  const fields = [
    "title",
    "filing_type",
    "authority",
    "due_date",
    "status",
    "risk_level",
    "owner_person_id",
    "department_key",
    "notes",
    "completed_at",
  ];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of fields) {
    if (data[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(data[f]);
    }
  }
  if (data.status === "completed" && data.completed_at === undefined) {
    sets.push("completed_at = ?");
    vals.push(now);
  }
  if (!sets.length) return db.get("SELECT * FROM compliance_filings WHERE id = ?", id);
  sets.push("updated_at = ?");
  vals.push(now, id);
  await db.run(`UPDATE compliance_filings SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  return db.get("SELECT * FROM compliance_filings WHERE id = ?", id);
}

export async function buildExecutiveOperationsReport() {
  const dash = await buildExecutiveOperationsDashboard();
  const departments = await buildDepartmentMatrix();
  const projects = await listOpsProjects();
  const filings = await listComplianceFilings();

  return {
    generatedAt: new Date().toISOString(),
    title: "IFCDC Executive Operations Report",
    health: {
      organization: dash.organizationHealth,
      operational: dash.operationalHealth,
      financial: dash.financialHealth,
      compliance: dash.complianceStatus.status,
    },
    workforce: {
      employees: dash.employeeActivity.active,
      volunteers: dash.volunteerActivity.active,
      openLeave: dash.employeeActivity.openLeave,
      clients: dash.clientServices.clients,
    },
    programs: {
      activePrograms: dash.activePrograms,
      housing: dash.operationsSnapshot.housing,
      scholarships: dash.operationsSnapshot.scholarships,
      grants: dash.grantActivity,
    },
    projects: {
      active: dash.activeProjects,
      items: projects.slice(0, 15),
    },
    compliance: {
      ...dash.complianceStatus,
      filings: filings.slice(0, 20),
    },
    departments: departments.departments,
    alerts: dash.systemAlerts,
    deadlines: dash.upcomingDeadlines,
    automation: dash.automation,
  };
}

export async function buildAutomationStatus() {
  await ensureExecutiveOperationsFoundation();
  const db = await getDb();
  const definitions = await db.all(
    "SELECT workflow_key, name, trigger_type, enabled, description FROM hq_workflow_definitions ORDER BY name ASC"
  );
  const jobs = await db.all(
    "SELECT job_key, name, schedule_expr, last_run_at, last_run_status, enabled, source_module FROM hq_scheduled_jobs ORDER BY name ASC"
  );
  const pending = await db.all(
    `SELECT id, workflow_key, title, status, priority, due_at, assigned_to, created_at
     FROM hq_workflow_instances
     WHERE status IN ('pending','in_progress')
     ORDER BY created_at DESC LIMIT 25`
  );
  return {
    generatedAt: new Date().toISOString(),
    definitions,
    scheduledJobs: jobs,
    pendingApprovals: pending,
  };
}
