import { getDb } from "../db";
import crypto from "crypto";

export interface GrantExecutiveDashboard {
  openOpportunities: number;
  pendingApplications: number;
  upcomingDeadlines: number;
  totalAwarded: number;
  complianceDue: number;
  pipelineValue: number;
  activeAwards: number;
  totalBudgetAllocated: number;
  totalBudgetSpent: number;
  totalLaborCost: number;
  totalExpenditures: number;
  winRate: number;
  fundingPipeline: { stage: string; count: number; value: number }[];
  recentNotifications: { id: string; title: string; due_date: string; notification_type: string }[];
}

export async function buildGrantExecutiveDashboard(): Promise<GrantExecutiveDashboard> {
  const db = await getDb();

  const openOpportunities = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_opportunities WHERE status = 'open'"
  ))?.c ?? 0;

  const pendingApplications = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_applications WHERE status IN ('draft','submitted','under_review')"
  ))?.c ?? 0;

  const upcomingDeadlines = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_deadlines WHERE completed = 0 AND due_date >= date('now') AND due_date <= date('now', '+30 days')`
  ))?.c ?? 0;

  const totalAwarded = (await db.get<{ t: number }>(
    "SELECT COALESCE(SUM(amount), 0) as t FROM grant_awards WHERE status = 'active'"
  ))?.t ?? 0;

  const complianceDue = (await db.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM grant_compliance WHERE status = 'pending' AND due_date <= date('now', '+14 days')`
  ))?.c ?? 0;

  const pipelineValue = (await db.get<{ t: number }>(
    "SELECT COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE status IN ('draft','submitted','under_review')"
  ))?.t ?? 0;

  const activeAwards = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_awards WHERE status = 'active'"
  ))?.c ?? 0;

  const budgetStats = await db.get<{ allocated: number; spent: number }>(
    `SELECT COALESCE(SUM(allocated), 0) as allocated, COALESCE(SUM(spent), 0) as spent
     FROM finance_budgets WHERE grant_id IS NOT NULL OR category = 'grants'`
  );

  const totalLaborCost = ((await db.get<{ t: number }>(
    "SELECT COALESCE(SUM(cost_cents), 0) as t FROM grant_labor_allocations"
  ))?.t ?? 0) / 100;

  const totalExpenditures = ((await db.get<{ t: number }>(
    "SELECT COALESCE(SUM(amount_cents), 0) as t FROM grant_expenditures"
  ))?.t ?? 0) / 100;

  const awarded = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_applications WHERE status = 'awarded'"
  ))?.c ?? 0;
  const totalApps = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_applications WHERE status NOT IN ('draft')"
  ))?.c ?? 0;
  const winRate = totalApps > 0 ? Math.round((awarded / totalApps) * 100) : 0;

  const oppPipeline = await db.get<{ c: number; t: number }>(
    "SELECT COUNT(*) as c, COALESCE(SUM(amount_max), 0) as t FROM grant_opportunities WHERE status = 'open'"
  );
  const appliedPipeline = await db.get<{ c: number; t: number }>(
    "SELECT COUNT(*) as c, COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE status = 'submitted'"
  );
  const reviewPipeline = await db.get<{ c: number; t: number }>(
    "SELECT COUNT(*) as c, COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE status = 'under_review'"
  );
  const awardedPipeline = await db.get<{ c: number; t: number }>(
    "SELECT COUNT(*) as c, COALESCE(SUM(amount_requested), 0) as t FROM grant_applications WHERE status = 'awarded'"
  );
  const activePipeline = await db.get<{ c: number; t: number }>(
    "SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as t FROM grant_awards WHERE status = 'active'"
  );

  const fundingPipeline = [
    { stage: "Prospecting", count: oppPipeline?.c ?? 0, value: oppPipeline?.t ?? 0 },
    { stage: "Applied", count: appliedPipeline?.c ?? 0, value: appliedPipeline?.t ?? 0 },
    { stage: "Under Review", count: reviewPipeline?.c ?? 0, value: reviewPipeline?.t ?? 0 },
    { stage: "Awarded", count: awardedPipeline?.c ?? 0, value: awardedPipeline?.t ?? 0 },
    { stage: "Active Grants", count: activePipeline?.c ?? 0, value: activePipeline?.t ?? 0 },
  ];

  const recentNotifications = (await db.all(
    `SELECT id, title, due_date, notification_type FROM grant_notifications
     WHERE read = 0 ORDER BY due_date ASC LIMIT 10`
  )) as { id: string; title: string; due_date: string; notification_type: string }[];

  return {
    openOpportunities,
    pendingApplications,
    upcomingDeadlines,
    totalAwarded,
    complianceDue,
    pipelineValue,
    activeAwards,
    totalBudgetAllocated: budgetStats?.allocated ?? 0,
    totalBudgetSpent: budgetStats?.spent ?? 0,
    totalLaborCost,
    totalExpenditures,
    winRate,
    fundingPipeline,
    recentNotifications,
  };
}

export async function buildGrantAnalytics() {
  const db = await getDb();

  const byFunder = (await db.all(`
    SELECT o.funder, COUNT(DISTINCT aw.id) as awards, COALESCE(SUM(aw.amount), 0) as total
    FROM grant_awards aw JOIN grant_opportunities o ON o.id = aw.opportunity_id
    WHERE aw.status = 'active' GROUP BY o.funder ORDER BY total DESC
  `)) as { funder: string; awards: number; total: number }[];

  const byProgram = (await db.all(`
    SELECT COALESCE(p.name, 'Unassigned') as program, COUNT(aw.id) as awards, COALESCE(SUM(aw.amount), 0) as total
    FROM grant_awards aw LEFT JOIN programs p ON p.id = aw.program_id
    WHERE aw.status = 'active' GROUP BY aw.program_id ORDER BY total DESC
  `)) as { program: string; awards: number; total: number }[];

  const monthlyAwards = (await db.all(`
    SELECT strftime('%Y-%m', award_date) as month, COUNT(*) as count, SUM(amount) as total
    FROM grant_awards GROUP BY month ORDER BY month DESC LIMIT 12
  `)) as { month: string; count: number; total: number }[];

  return { byFunder, byProgram, monthlyAwards };
}

export async function generateGrantNotifications(): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  let created = 0;

  const upcomingDeadlines = (await db.all(`
    SELECT d.id, d.title, d.due_date, o.title as grant_title
    FROM grant_deadlines d LEFT JOIN grant_opportunities o ON o.id = d.opportunity_id
    WHERE d.completed = 0 AND d.due_date <= date('now', '+14 days') AND d.due_date >= date('now')
  `)) as { id: string; title: string; due_date: string; grant_title: string }[];

  for (const d of upcomingDeadlines) {
    const exists = await db.get(
      "SELECT id FROM grant_notifications WHERE grant_entity_id = ? AND notification_type = 'deadline_reminder'",
      d.id
    );
    if (!exists) {
      await db.run(
        `INSERT INTO grant_notifications (id, grant_entity_type, grant_entity_id, notification_type, title, message, due_date, read, created_at)
         VALUES (?, 'deadline', ?, 'deadline_reminder', ?, ?, ?, 0, ?)`,
        crypto.randomUUID(), d.id, `Deadline: ${d.title}`,
        `${d.grant_title ?? "Grant"} deadline approaching`, d.due_date, now
      );
      created++;
    }
  }

  const complianceDue = (await db.all(`
    SELECT c.id, c.report_type, c.due_date, o.title as grant_title
    FROM grant_compliance c JOIN grant_awards aw ON aw.id = c.award_id
    LEFT JOIN grant_opportunities o ON o.id = aw.opportunity_id
    WHERE c.status = 'pending' AND c.due_date <= date('now', '+14 days') AND c.due_date >= date('now')
  `)) as { id: string; report_type: string; due_date: string; grant_title: string }[];

  for (const c of complianceDue) {
    const exists = await db.get(
      "SELECT id FROM grant_notifications WHERE grant_entity_id = ? AND notification_type = 'compliance_reminder'",
      c.id
    );
    if (!exists) {
      await db.run(
        `INSERT INTO grant_notifications (id, grant_entity_type, grant_entity_id, notification_type, title, message, due_date, read, created_at)
         VALUES (?, 'compliance', ?, 'compliance_reminder', ?, ?, ?, 0, ?)`,
        crypto.randomUUID(), c.id, `Compliance: ${c.report_type}`,
        `${c.grant_title} — ${c.report_type} due soon`, c.due_date, now
      );
      created++;
    }
  }

  return created;
}

export async function buildFunderReports() {
  const db = await getDb();
  const reports = await db.all(`
    SELECT aw.id as award_id, aw.amount, aw.award_date, aw.status,
      o.title as grant_title, o.funder,
      (SELECT COUNT(*) FROM grant_compliance gc WHERE gc.award_id = aw.id) as compliance_total,
      (SELECT COUNT(*) FROM grant_compliance gc WHERE gc.award_id = aw.id AND gc.status = 'pending') as compliance_pending,
      (SELECT COUNT(*) FROM grant_compliance gc WHERE gc.award_id = aw.id AND gc.status = 'submitted') as compliance_submitted,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM grant_expenditures ge WHERE ge.award_id = aw.id) as spent_cents,
      (SELECT COALESCE(SUM(allocated), 0) FROM grant_budget_lines gbl WHERE gbl.award_id = aw.id) as budget_allocated,
      (SELECT COUNT(*) FROM grant_documents gd
        JOIN grant_applications ga ON ga.id = gd.application_id
        WHERE ga.opportunity_id = aw.opportunity_id OR gd.opportunity_id = aw.opportunity_id) as document_count
    FROM grant_awards aw
    JOIN grant_opportunities o ON o.id = aw.opportunity_id
    WHERE aw.status IN ('active', 'completed')
    ORDER BY o.funder, aw.award_date DESC
  `);

  const upcomingCompliance = await db.all(`
    SELECT c.id, c.report_type, c.due_date, c.status, o.title as grant_title, o.funder
    FROM grant_compliance c
    JOIN grant_awards aw ON aw.id = c.award_id
    JOIN grant_opportunities o ON o.id = aw.opportunity_id
    WHERE c.status IN ('pending', 'overdue')
    ORDER BY c.due_date ASC LIMIT 50
  `);

  return {
    reports: (reports as Record<string, unknown>[]).map((r) => ({
      awardId: r.award_id,
      grantTitle: r.grant_title,
      funder: r.funder,
      awardAmount: Number(r.amount ?? 0),
      awardDate: r.award_date,
      status: r.status,
      budgetAllocated: Number(r.budget_allocated ?? 0),
      spent: Number(r.spent_cents ?? 0) / 100,
      burnRate: Number(r.budget_allocated ?? 0) > 0
        ? Math.round((Number(r.spent_cents ?? 0) / 100 / Number(r.budget_allocated)) * 100)
        : 0,
      complianceTotal: Number(r.compliance_total ?? 0),
      compliancePending: Number(r.compliance_pending ?? 0),
      complianceSubmitted: Number(r.compliance_submitted ?? 0),
      documentCount: Number(r.document_count ?? 0),
      reportReady: Number(r.compliance_pending ?? 0) === 0,
    })),
    upcomingCompliance,
    generatedAt: new Date().toISOString(),
  };
}
