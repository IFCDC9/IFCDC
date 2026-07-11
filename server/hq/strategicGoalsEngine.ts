/**
 * Strategic Goals Center (Enterprise Brain 3.0)
 * Tracks IFCDC organizational goals across all mission areas with live KPI signals.
 * Facts from HQ modules only; assumptions labeled in AI recommendations.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";

export type StrategicGoalCategory =
  | "funding"
  | "programs"
  | "community_impact"
  | "housing"
  | "youth_development"
  | "anti_gang"
  | "scholarships"
  | "economic_development"
  | "workforce_development"
  | "software_division"
  | "communications"
  | "technology"
  | "hr"
  | "operations"
  | "financial";

export type StrategicGoalStatus = "on_track" | "at_risk" | "blocked" | "achieved" | "not_started";

export type GoalMilestone = {
  id: string;
  title: string;
  dueDate: string | null;
  done: boolean;
};

export type StrategicGoal = {
  id: string;
  category: StrategicGoalCategory;
  title: string;
  description: string;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  progressPercent: number;
  status: StrategicGoalStatus;
  blockers: string[];
  recommendedActions: string[];
  risks: string[];
  milestones: GoalMilestone[];
  kpiLabel: string | null;
  budgetAllocated: number | null;
  department: string;
  owner: string;
  targetDate: string | null;
  updatedAt: string;
  createdAt: string;
};

let tablesReady = false;

export async function ensureStrategicGoalsTables(): Promise<void> {
  if (tablesReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_strategic_goals (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      target_value REAL,
      current_value REAL,
      unit TEXT,
      progress_percent REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_started',
      blockers_json TEXT,
      recommended_json TEXT,
      risks_json TEXT,
      milestones_json TEXT,
      kpi_label TEXT,
      budget_allocated REAL,
      department TEXT,
      owner TEXT,
      target_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_strategic_goals_cat ON aura_strategic_goals(category);
  `);
  for (const col of [
    "ALTER TABLE aura_strategic_goals ADD COLUMN risks_json TEXT",
    "ALTER TABLE aura_strategic_goals ADD COLUMN milestones_json TEXT",
    "ALTER TABLE aura_strategic_goals ADD COLUMN kpi_label TEXT",
    "ALTER TABLE aura_strategic_goals ADD COLUMN budget_allocated REAL",
    "ALTER TABLE aura_strategic_goals ADD COLUMN department TEXT",
  ]) {
    try {
      await db.exec(col);
    } catch {
      /* column may already exist */
    }
  }
  tablesReady = true;
  await seedDefaultStrategicGoalsIfEmpty();
  await ensureExpandedGoalCatalog();
}

type GoalSeed = {
  category: StrategicGoalCategory;
  title: string;
  description: string;
  targetValue: number | null;
  unit: string | null;
  owner: string;
  department: string;
  kpiLabel: string;
  budgetAllocated: number | null;
  targetDate: string | null;
  milestones: GoalMilestone[];
};

const DEFAULT_GOALS: GoalSeed[] = [
  {
    category: "funding",
    title: "Secure multi-year operating funding",
    description: "Grow active awards and pipeline toward sustainable multi-year coverage.",
    targetValue: 10_000_000,
    unit: "USD pipeline + awards",
    owner: "Grants Director",
    department: "Grants",
    kpiLabel: "Pipeline + award value",
    budgetAllocated: null,
    targetDate: "2030-12-31",
    milestones: [
      { id: "f1", title: "Complete enterprise funding scan", dueDate: "2026-09-30", done: false },
      { id: "f2", title: "Submit 8 priority applications", dueDate: "2026-12-31", done: false },
    ],
  },
  {
    category: "programs",
    title: "Expand high-impact community programs",
    description: "Increase program capacity without exceeding staffing and compliance limits.",
    targetValue: 25,
    unit: "active programs",
    owner: "Operations Director",
    department: "Programs",
    kpiLabel: "Programs running",
    budgetAllocated: null,
    targetDate: "2027-12-31",
    milestones: [{ id: "p1", title: "Capacity review for expansion", dueDate: "2026-10-31", done: false }],
  },
  {
    category: "community_impact",
    title: "Deepen community reach",
    description: "Grow participants served while maintaining service quality.",
    targetValue: 5000,
    unit: "participants / year",
    owner: "Program Directors",
    department: "Programs",
    kpiLabel: "Participants served",
    budgetAllocated: null,
    targetDate: "2028-12-31",
    milestones: [],
  },
  {
    category: "housing",
    title: "Strengthen housing program delivery",
    description: "Stable housing placements with compliance-ready case management.",
    targetValue: 100,
    unit: "households supported",
    owner: "Housing Director",
    department: "Housing",
    kpiLabel: "Households / placements",
    budgetAllocated: null,
    targetDate: "2027-12-31",
    milestones: [{ id: "h1", title: "Housing capacity & budget model", dueDate: "2026-11-30", done: false }],
  },
  {
    category: "youth_development",
    title: "Scale youth development outcomes",
    description: "Expand mentoring, skills, and safe youth pathways.",
    targetValue: 500,
    unit: "youth served",
    owner: "Youth Program Lead",
    department: "Youth Development",
    kpiLabel: "Youth served",
    budgetAllocated: null,
    targetDate: "2027-12-31",
    milestones: [],
  },
  {
    category: "anti_gang",
    title: "Advance anti-gang / violence interruption goals",
    description: "Reduce risk exposure through prevention, outreach, and partner coordination.",
    targetValue: 200,
    unit: "participants engaged",
    owner: "Anti-Gang Initiative Lead",
    department: "Anti-Gang Initiative",
    kpiLabel: "Engaged participants",
    budgetAllocated: null,
    targetDate: "2027-12-31",
    milestones: [],
  },
  {
    category: "scholarships",
    title: "Grow scholarship awards and completion",
    description: "Fund and support scholars through award cycles.",
    targetValue: 50,
    unit: "scholarships awarded",
    owner: "Scholarships Lead",
    department: "Scholarships",
    kpiLabel: "Awards this cycle",
    budgetAllocated: null,
    targetDate: "2027-06-30",
    milestones: [],
  },
  {
    category: "economic_development",
    title: "Build economic development pathways",
    description: "Support entrepreneurship and local economic mobility.",
    targetValue: 30,
    unit: "enterprises / pathways supported",
    owner: "Economic Development Lead",
    department: "Economic Development",
    kpiLabel: "Supported pathways",
    budgetAllocated: null,
    targetDate: "2028-12-31",
    milestones: [],
  },
  {
    category: "workforce_development",
    title: "Expand workforce development placements",
    description: "Training-to-employment pipelines with employer partners.",
    targetValue: 150,
    unit: "placements / completions",
    owner: "Workforce Lead",
    department: "Workforce Development",
    kpiLabel: "Placements",
    budgetAllocated: null,
    targetDate: "2027-12-31",
    milestones: [],
  },
  {
    category: "software_division",
    title: "Ship Software Division product roadmap",
    description: "Barbers App Store launch first; then Music, Mentor, Inclusive, Swift-Ware, CryptoCoin.",
    targetValue: 6,
    unit: "apps at production quality",
    owner: "CTO / Software Division",
    department: "Software Division",
    kpiLabel: "Production apps",
    budgetAllocated: null,
    targetDate: "2027-12-31",
    milestones: [
      { id: "s1", title: "Barbers App Store launch", dueDate: "2026-09-30", done: false },
      { id: "s2", title: "Music App production hardening", dueDate: "2026-12-31", done: false },
    ],
  },
  {
    category: "communications",
    title: "Strengthen organizational communications cadence",
    description: "Consistent Founder-approved external and board communications.",
    targetValue: 12,
    unit: "executive briefs / quarter",
    owner: "Communications Director",
    department: "Communications",
    kpiLabel: "Published briefs",
    budgetAllocated: null,
    targetDate: "2026-12-31",
    milestones: [],
  },
  {
    category: "technology",
    title: "Production reliability for HQ & Software Division",
    description: "Keep Technical Command health score at executive standard.",
    targetValue: 90,
    unit: "tech health score",
    owner: "CTO",
    department: "Technology",
    kpiLabel: "Technical Command score",
    budgetAllocated: null,
    targetDate: "2026-12-31",
    milestones: [{ id: "t1", title: "Maintain GitHub/Render alignment", dueDate: null, done: false }],
  },
  {
    category: "hr",
    title: "Build sustainable staffing capacity",
    description: "Align FTE with program load; hire only with funding coverage.",
    targetValue: 40,
    unit: "employees",
    owner: "HR Director",
    department: "HR",
    kpiLabel: "Employee headcount",
    budgetAllocated: null,
    targetDate: "2027-06-30",
    milestones: [],
  },
  {
    category: "operations",
    title: "Raise operational delivery reliability",
    description: "Mission Control throughput with fewer bottlenecks and overdue tasks.",
    targetValue: 85,
    unit: "ops performance score",
    owner: "Operations Director",
    department: "Operations",
    kpiLabel: "Ops performance",
    budgetAllocated: null,
    targetDate: "2026-12-31",
    milestones: [],
  },
  {
    category: "financial",
    title: "Maintain strong financial health",
    description: "Protect cash flow and financial health score for board confidence.",
    targetValue: 85,
    unit: "financial health score",
    owner: "CFO",
    department: "Finance",
    kpiLabel: "Financial health score",
    budgetAllocated: null,
    targetDate: "2026-12-31",
    milestones: [],
  },
];

async function insertGoalSeed(g: GoalSeed): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO aura_strategic_goals
      (id, category, title, description, target_value, current_value, unit, progress_percent, status,
       blockers_json, recommended_json, risks_json, milestones_json, kpi_label, budget_allocated,
       department, owner, target_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 'not_started', '[]', '[]', '[]', ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    g.category,
    g.title,
    g.description,
    g.targetValue,
    g.unit,
    JSON.stringify(g.milestones),
    g.kpiLabel,
    g.budgetAllocated,
    g.department,
    g.owner,
    g.targetDate,
    now,
    now
  );
}

async function seedDefaultStrategicGoalsIfEmpty(): Promise<void> {
  const db = await getDb();
  const count = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM aura_strategic_goals");
  if ((count?.c ?? 0) > 0) return;
  for (const g of DEFAULT_GOALS) await insertGoalSeed(g);
}

/** Ensure Brain 3.0 catalog categories exist even if older seeds were present. */
async function ensureExpandedGoalCatalog(): Promise<void> {
  const db = await getDb();
  const existing = (await db.all("SELECT title FROM aura_strategic_goals")) as Array<{ title: string }>;
  const titles = new Set(existing.map((r) => r.title));
  for (const g of DEFAULT_GOALS) {
    if (!titles.has(g.title)) await insertGoalSeed(g);
  }
  // Migrate legacy category "program" → "programs"
  await db.run(`UPDATE aura_strategic_goals SET category = 'programs' WHERE category = 'program'`).catch(() => undefined);
}

function statusFromProgress(progress: number, blockers: string[]): StrategicGoalStatus {
  if (progress >= 100) return "achieved";
  if (blockers.length) return "blocked";
  if (progress <= 0) return "not_started";
  if (progress < 40) return "at_risk";
  return "on_track";
}

function rowToGoal(row: Record<string, unknown>): StrategicGoal {
  const parseArr = <T>(raw: unknown, fallback: T[]): T[] => {
    try {
      return JSON.parse(String(raw || "[]")) as T[];
    } catch {
      return fallback;
    }
  };
  const category = String(row.category) === "program" ? "programs" : (row.category as StrategicGoalCategory);
  return {
    id: String(row.id),
    category,
    title: String(row.title),
    description: String(row.description || ""),
    targetValue: row.target_value == null ? null : Number(row.target_value),
    currentValue: row.current_value == null ? null : Number(row.current_value),
    unit: row.unit == null ? null : String(row.unit),
    progressPercent: Number(row.progress_percent || 0),
    status: row.status as StrategicGoalStatus,
    blockers: parseArr<string>(row.blockers_json, []),
    recommendedActions: parseArr<string>(row.recommended_json, []),
    risks: parseArr<string>(row.risks_json, []),
    milestones: parseArr<GoalMilestone>(row.milestones_json, []),
    kpiLabel: row.kpi_label == null ? null : String(row.kpi_label),
    budgetAllocated: row.budget_allocated == null ? null : Number(row.budget_allocated),
    department: String(row.department || row.owner || "Founder"),
    owner: String(row.owner || "Founder"),
    targetDate: row.target_date == null ? null : String(row.target_date),
    updatedAt: String(row.updated_at),
    createdAt: String(row.created_at),
  };
}

export async function refreshStrategicGoalProgress(): Promise<StrategicGoal[]> {
  await ensureStrategicGoalsTables();
  const db = await getDb();
  const rows = (await db.all("SELECT * FROM aura_strategic_goals ORDER BY category, title")) as Record<
    string,
    unknown
  >[];

  const [grants, finance, overview, tech, compliance] = await Promise.all([
    import("./grantReporting").then((m) => m.buildGrantExecutiveDashboard()).catch(() => null),
    import("./financeReporting").then((m) => m.buildExecutiveDashboard()).catch(() => null),
    import("./analyticsReporting").then((m) => m.buildSafeAnalyticsOverview()).catch(() => null),
    import("./auraTechnicalCommandEngine").then((m) => m.buildTechnicalCommandBriefing()).catch(() => null),
    import("./auraExecutiveOps").then((m) => m.trackComplianceDeadlines()).catch(() => ({ overdue: 0, dueNext14Days: 0 })),
  ]);

  const now = new Date().toISOString();
  const updated: StrategicGoal[] = [];
  const overdue = (compliance as { overdue?: number }).overdue ?? 0;

  for (const row of rows) {
    const goal = rowToGoal(row);
    const blockers: string[] = [];
    const recommended: string[] = [];
    const risks: string[] = [...goal.risks];
    let current: number | null = goal.currentValue;

    switch (goal.category) {
      case "funding": {
        const pipeline = grants?.pipelineValue ?? 0;
        const awards = grants?.activeAwards ?? 0;
        current = pipeline + awards * 50_000;
        if (pipeline === 0) {
          blockers.push("Funding pipeline value is currently zero or unavailable");
          recommended.push("Run enterprise funding scan across all programs");
        } else recommended.push("Prioritize high-fit opportunities in Grant Center");
        break;
      }
      case "programs":
      case "community_impact":
      case "housing":
      case "youth_development":
      case "anti_gang":
      case "scholarships":
      case "economic_development":
      case "workforce_development": {
        if (goal.category === "programs") current = overview?.programs?.programsRunning ?? null;
        else if (goal.category === "community_impact") current = overview?.programs?.participants ?? null;
        else {
          // Program-area goals: use participants as proxy until module-specific KPIs are wired
          current = overview?.programs?.participants ?? null;
          risks.push("KPI uses organization participant proxy until module-specific metrics are linked — not a direct count.");
        }
        if (current == null) blockers.push(`${goal.category} KPI unavailable from live overview`);
        else recommended.push("Confirm capacity and funding before expansion");
        break;
      }
      case "software_division":
      case "technology": {
        current = tech?.overallScore ?? null;
        if (current == null) blockers.push("Technical Command briefing unavailable");
        else if (current < 70) {
          blockers.push(`Technical health below executive standard (${current}/100)`);
          recommended.push("Open Technical Command repair tickets for critical findings");
        } else recommended.push("Keep GitHub/Render aligned after Founder-approved deploys");
        if (tech?.deployAligned === false) {
          blockers.push("Production deploy not aligned with GitHub main");
          recommended.push("Review Manual Deploy after Founder approval");
        }
        if (goal.category === "software_division") {
          recommended.push("Prioritize Barbers App Store launch per product roadmap");
          risks.push("App count KPI not yet auto-linked — tech score used as reliability proxy.");
        }
        break;
      }
      case "communications": {
        current = goal.currentValue;
        if (current == null) {
          risks.push("Communications KPI not yet auto-linked to Communications Center — progress may be incomplete.");
          recommended.push("Sync published briefs from Communications Center");
        }
        break;
      }
      case "hr": {
        current = overview?.people?.employees ?? null;
        if (current == null) blockers.push("Employee headcount unavailable");
        else recommended.push("Hire only with confirmed funding and Founder approval");
        break;
      }
      case "operations": {
        current = overview?.organizationHealth?.overall ?? null;
        if (current == null) blockers.push("Operations performance signal unavailable");
        else recommended.push("Clear Mission Control bottlenecks this week");
        break;
      }
      case "financial": {
        current = finance?.financialHealthScore ?? null;
        if (current == null) blockers.push("Financial health score unavailable");
        else if ((finance?.cashFlow ?? 0) < 0) {
          blockers.push("Cash-flow signal is negative");
          recommended.push("Request 90-day cash forecast before expansion commitments");
        } else recommended.push("Protect budget lines and approve only high-ROI spend");
        break;
      }
      default:
        break;
    }

    if (overdue > 0) {
      blockers.push(`${overdue} compliance item(s) overdue`);
      recommended.push("Clear overdue compliance before new grant submissions");
      risks.push("Compliance overdue can block funding and expansion.");
    }

    const target = goal.targetValue;
    let progress = 0;
    if (target != null && target > 0 && current != null) {
      progress = Math.min(100, Math.round((current / target) * 1000) / 10);
    }
    const status = statusFromProgress(progress, blockers);
    const recUnique = Array.from(new Set(recommended)).slice(0, 5);
    const riskUnique = Array.from(new Set(risks)).slice(0, 5);

    await db.run(
      `UPDATE aura_strategic_goals
       SET current_value = ?, progress_percent = ?, status = ?, blockers_json = ?, recommended_json = ?,
           risks_json = ?, department = COALESCE(department, ?), updated_at = ?
       WHERE id = ?`,
      current,
      progress,
      status,
      JSON.stringify(blockers),
      JSON.stringify(recUnique),
      JSON.stringify(riskUnique),
      goal.department,
      now,
      goal.id
    );

    updated.push({
      ...goal,
      currentValue: current,
      progressPercent: progress,
      status,
      blockers,
      recommendedActions: recUnique,
      risks: riskUnique,
      updatedAt: now,
    });
  }

  return updated;
}

export async function listStrategicGoals(): Promise<{
  goals: StrategicGoal[];
  generatedAt: string;
  summary: { onTrack: number; atRisk: number; blocked: number; achieved: number; avgProgress: number };
}> {
  const goals = await refreshStrategicGoalProgress();
  const onTrack = goals.filter((g) => g.status === "on_track").length;
  const atRisk = goals.filter((g) => g.status === "at_risk").length;
  const blocked = goals.filter((g) => g.status === "blocked").length;
  const achieved = goals.filter((g) => g.status === "achieved").length;
  const avgProgress = goals.length
    ? Math.round(goals.reduce((s, g) => s + g.progressPercent, 0) / goals.length)
    : 0;
  return {
    goals,
    generatedAt: new Date().toISOString(),
    summary: { onTrack, atRisk, blocked, achieved, avgProgress },
  };
}

export async function upsertStrategicGoal(input: {
  id?: string;
  category: StrategicGoalCategory;
  title: string;
  description?: string;
  targetValue?: number | null;
  unit?: string | null;
  owner?: string;
  department?: string;
  kpiLabel?: string;
  budgetAllocated?: number | null;
  targetDate?: string | null;
  milestones?: GoalMilestone[];
  actorEmail?: string | null;
}): Promise<StrategicGoal> {
  await ensureStrategicGoalsTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  const existing = await db.get<Record<string, unknown>>("SELECT * FROM aura_strategic_goals WHERE id = ?", id);
  if (existing) {
    await db.run(
      `UPDATE aura_strategic_goals
       SET category = ?, title = ?, description = ?, target_value = ?, unit = ?, owner = ?,
           department = ?, kpi_label = ?, budget_allocated = ?, target_date = ?,
           milestones_json = COALESCE(?, milestones_json), updated_at = ?
       WHERE id = ?`,
      input.category,
      input.title,
      input.description ?? existing.description,
      input.targetValue ?? existing.target_value,
      input.unit ?? existing.unit,
      input.owner ?? existing.owner,
      input.department ?? existing.department,
      input.kpiLabel ?? existing.kpi_label,
      input.budgetAllocated ?? existing.budget_allocated,
      input.targetDate ?? existing.target_date,
      input.milestones ? JSON.stringify(input.milestones) : null,
      now,
      id
    );
  } else {
    await insertGoalSeed({
      category: input.category,
      title: input.title,
      description: input.description || "",
      targetValue: input.targetValue ?? null,
      unit: input.unit ?? null,
      owner: input.owner || "Founder",
      department: input.department || input.owner || "Founder",
      kpiLabel: input.kpiLabel || "KPI",
      budgetAllocated: input.budgetAllocated ?? null,
      targetDate: input.targetDate ?? null,
      milestones: input.milestones || [],
    });
  }
  await logHqAudit({
    action: existing ? "aura_strategic_goal_update" : "aura_strategic_goal_create",
    entityType: "aura_strategic_goal",
    entityId: id,
    detail: input.title,
    actorEmail: input.actorEmail || undefined,
  }).catch(() => undefined);
  const goals = await refreshStrategicGoalProgress();
  return goals.find((g) => g.id === id) || goals.find((g) => g.title === input.title)!;
}
