/**
 * Strategic Goals Center — persisted IFCDC goals with live progress signals.
 * Facts come from HQ modules; progress is estimated only when live metrics exist.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";

export type StrategicGoalCategory =
  | "funding"
  | "program"
  | "community_impact"
  | "technology"
  | "hr"
  | "financial";

export type StrategicGoalStatus = "on_track" | "at_risk" | "blocked" | "achieved" | "not_started";

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
      owner TEXT,
      target_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_strategic_goals_cat ON aura_strategic_goals(category);
  `);
  tablesReady = true;
  await seedDefaultStrategicGoalsIfEmpty();
}

const DEFAULT_GOALS: Array<Omit<StrategicGoal, "id" | "createdAt" | "updatedAt" | "progressPercent" | "currentValue" | "status" | "blockers" | "recommendedActions"> & {
  targetValue: number | null;
  unit: string | null;
  targetDate: string | null;
}> = [
  {
    category: "funding",
    title: "Secure multi-year operating funding",
    description: "Grow active awards and pipeline toward sustainable multi-year coverage.",
    targetValue: 10_000_000,
    unit: "USD pipeline + awards",
    owner: "Grants Director",
    targetDate: "2030-12-31",
  },
  {
    category: "program",
    title: "Expand high-impact community programs",
    description: "Increase program capacity without exceeding staffing and compliance limits.",
    targetValue: 25,
    unit: "active programs",
    owner: "Operations Director",
    targetDate: "2027-12-31",
  },
  {
    category: "community_impact",
    title: "Deepen community reach",
    description: "Grow participants served while maintaining service quality.",
    targetValue: 5000,
    unit: "participants / year",
    owner: "Program Directors",
    targetDate: "2028-12-31",
  },
  {
    category: "technology",
    title: "Production reliability for HQ & Software Division",
    description: "Keep Technical Command health score at executive standard.",
    targetValue: 90,
    unit: "tech health score",
    owner: "CTO / Software Division",
    targetDate: "2026-12-31",
  },
  {
    category: "hr",
    title: "Build sustainable staffing capacity",
    description: "Align FTE with program load; hire only with funding coverage.",
    targetValue: 40,
    unit: "employees",
    owner: "HR Director",
    targetDate: "2027-06-30",
  },
  {
    category: "financial",
    title: "Maintain strong financial health",
    description: "Protect cash flow and financial health score for board confidence.",
    targetValue: 85,
    unit: "financial health score",
    owner: "CFO",
    targetDate: "2026-12-31",
  },
];

async function seedDefaultStrategicGoalsIfEmpty(): Promise<void> {
  const db = await getDb();
  const count = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM aura_strategic_goals");
  if ((count?.c ?? 0) > 0) return;
  const now = new Date().toISOString();
  for (const g of DEFAULT_GOALS) {
    await db.run(
      `INSERT INTO aura_strategic_goals
        (id, category, title, description, target_value, current_value, unit, progress_percent, status, blockers_json, recommended_json, owner, target_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 'not_started', '[]', '[]', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      g.category,
      g.title,
      g.description,
      g.targetValue,
      g.unit,
      g.owner,
      g.targetDate,
      now,
      now
    );
  }
}

function statusFromProgress(progress: number, blockers: string[]): StrategicGoalStatus {
  if (progress >= 100) return "achieved";
  if (blockers.length) return "blocked";
  if (progress <= 0) return "not_started";
  if (progress < 40) return "at_risk";
  return "on_track";
}

function rowToGoal(row: Record<string, unknown>): StrategicGoal {
  let blockers: string[] = [];
  let recommendedActions: string[] = [];
  try {
    blockers = JSON.parse(String(row.blockers_json || "[]"));
  } catch {
    blockers = [];
  }
  try {
    recommendedActions = JSON.parse(String(row.recommended_json || "[]"));
  } catch {
    recommendedActions = [];
  }
  return {
    id: String(row.id),
    category: row.category as StrategicGoalCategory,
    title: String(row.title),
    description: String(row.description || ""),
    targetValue: row.target_value == null ? null : Number(row.target_value),
    currentValue: row.current_value == null ? null : Number(row.current_value),
    unit: row.unit == null ? null : String(row.unit),
    progressPercent: Number(row.progress_percent || 0),
    status: row.status as StrategicGoalStatus,
    blockers,
    recommendedActions,
    owner: String(row.owner || "Founder"),
    targetDate: row.target_date == null ? null : String(row.target_date),
    updatedAt: String(row.updated_at),
    createdAt: String(row.created_at),
  };
}

/** Refresh goal current values from live HQ signals (never invent targets). */
export async function refreshStrategicGoalProgress(): Promise<StrategicGoal[]> {
  await ensureStrategicGoalsTables();
  const db = await getDb();
  const rows = (await db.all("SELECT * FROM aura_strategic_goals ORDER BY category, title")) as Record<string, unknown>[];

  const [
    grants,
    finance,
    overview,
    tech,
    compliance,
  ] = await Promise.all([
    import("./grantReporting").then((m) => m.buildGrantExecutiveDashboard()).catch(() => null),
    import("./financeReporting").then((m) => m.buildExecutiveDashboard()).catch(() => null),
    import("./analyticsReporting").then((m) => m.buildSafeAnalyticsOverview()).catch(() => null),
    import("./auraTechnicalCommandEngine").then((m) => m.buildTechnicalCommandBriefing()).catch(() => null),
    import("./auraExecutiveOps").then((m) => m.trackComplianceDeadlines()).catch(() => ({ overdue: 0, dueNext14Days: 0 })),
  ]);

  const now = new Date().toISOString();
  const updated: StrategicGoal[] = [];

  for (const row of rows) {
    const goal = rowToGoal(row);
    const blockers: string[] = [];
    const recommended: string[] = [];
    let current: number | null = goal.currentValue;

    if (goal.category === "funding") {
      const pipeline = grants?.pipelineValue ?? 0;
      const awards = grants?.activeAwards ?? 0;
      current = pipeline + awards * 50_000;
      if (pipeline === 0) {
        blockers.push("Funding pipeline value is currently zero or unavailable");
        recommended.push("Run enterprise funding scan across all programs");
      } else {
        recommended.push("Prioritize high-fit opportunities in Grant Center");
      }
    } else if (goal.category === "program") {
      current = overview?.programs?.programsRunning ?? null;
      if (current == null) blockers.push("Program count unavailable from analytics overview");
      else recommended.push("Review Mission Control capacity before launching new programs");
    } else if (goal.category === "community_impact") {
      current = overview?.programs?.participants ?? null;
      if (current == null) blockers.push("Participant count unavailable");
      else recommended.push("Track enrollment quality alongside growth");
    } else if (goal.category === "technology") {
      current = tech?.overallScore ?? null;
      if (current == null) blockers.push("Technical Command briefing unavailable");
      else if (current < 70) {
        blockers.push(`Technical health below executive standard (${current}/100)`);
        recommended.push("Open Technical Command repair tickets for critical findings");
      } else {
        recommended.push("Keep GitHub/Render aligned after Founder-approved deploys");
      }
      if (tech?.deployAligned === false) {
        blockers.push("Production deploy not aligned with GitHub main");
        recommended.push("Review Manual Deploy after Founder approval");
      }
    } else if (goal.category === "hr") {
      current = overview?.people?.employees ?? null;
      if (current == null) blockers.push("Employee headcount unavailable");
      else recommended.push("Hire only with confirmed funding and Founder approval");
    } else if (goal.category === "financial") {
      current = finance?.financialHealthScore ?? null;
      if (current == null) blockers.push("Financial health score unavailable");
      else if ((finance?.cashFlow ?? 0) < 0) {
        blockers.push("Cash-flow signal is negative");
        recommended.push("Request 90-day cash forecast before expansion commitments");
      } else {
        recommended.push("Protect budget lines and approve only high-ROI spend");
      }
    }

    if ((compliance as { overdue?: number }).overdue) {
      blockers.push(`${(compliance as { overdue: number }).overdue} compliance item(s) overdue`);
      recommended.push("Clear overdue compliance before new grant submissions");
    }

    const target = goal.targetValue;
    let progress = 0;
    if (target != null && target > 0 && current != null) {
      progress = Math.min(100, Math.round((current / target) * 1000) / 10);
    }
    const status = statusFromProgress(progress, blockers);

    await db.run(
      `UPDATE aura_strategic_goals
       SET current_value = ?, progress_percent = ?, status = ?, blockers_json = ?, recommended_json = ?, updated_at = ?
       WHERE id = ?`,
      current,
      progress,
      status,
      JSON.stringify(blockers),
      JSON.stringify(Array.from(new Set(recommended)).slice(0, 5)),
      now,
      goal.id
    );

    updated.push({
      ...goal,
      currentValue: current,
      progressPercent: progress,
      status,
      blockers,
      recommendedActions: Array.from(new Set(recommended)).slice(0, 5),
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
  targetDate?: string | null;
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
       SET category = ?, title = ?, description = ?, target_value = ?, unit = ?, owner = ?, target_date = ?, updated_at = ?
       WHERE id = ?`,
      input.category,
      input.title,
      input.description ?? existing.description,
      input.targetValue ?? existing.target_value,
      input.unit ?? existing.unit,
      input.owner ?? existing.owner,
      input.targetDate ?? existing.target_date,
      now,
      id
    );
  } else {
    await db.run(
      `INSERT INTO aura_strategic_goals
        (id, category, title, description, target_value, current_value, unit, progress_percent, status, blockers_json, recommended_json, owner, target_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 'not_started', '[]', '[]', ?, ?, ?, ?)`,
      id,
      input.category,
      input.title,
      input.description || "",
      input.targetValue ?? null,
      input.unit ?? null,
      input.owner || "Founder",
      input.targetDate ?? null,
      now,
      now
    );
  }
  await logHqAudit({
    action: existing ? "aura_strategic_goal_update" : "aura_strategic_goal_create",
    entityType: "aura_strategic_goal",
    entityId: id,
    detail: input.title,
    actorEmail: input.actorEmail || undefined,
  }).catch(() => undefined);
  const goals = await refreshStrategicGoalProgress();
  return goals.find((g) => g.id === id)!;
}
