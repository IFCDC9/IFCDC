/**
 * Seeds enterprise-ready operational data for HQ health scoring and UAT.
 * Idempotent — safe to run on every boot. Disabled in production (live data only).
 */
import crypto from "crypto";
import { getDb } from "../db";
import { allowHqDemoSeed } from "./grantProductionPolicy";
import { ensureDivisionAnalyticsTables, ingestDivisionAnalytics } from "./divisionAnalyticsWebhook";
import { buildOrganizationHealthScore } from "./analyticsReporting";
import { invalidateWarehouseOverviewCache } from "./analyticsWarehouse";
import type { DivisionId } from "./divisionIntegrationLayer";

function id() {
  return crypto.randomUUID();
}

const DIVISION_WEBHOOK_SEEDS: { divisionId: DivisionId; payload: Record<string, unknown> }[] = [
  { divisionId: "music", payload: { activeUsers: 42, sessions: 120, revenue: 8500, health: "operational" } },
  { divisionId: "tapis", payload: { activeUsers: 28, participants: 65, applications: 14, health: "operational" } },
  { divisionId: "radio", payload: { activeUsers: 15, broadcasts: 8, sessions: 240, health: "operational" } },
  { divisionId: "housing", payload: { placements: 12, applications: 24, participants: 18, health: "operational" } },
  { divisionId: "scholarships", payload: { applications: 45, awarded: 8, participants: 8, health: "operational" } },
  { divisionId: "media", payload: { published: 32, content: 48, activeUsers: 22, health: "operational" } },
  { divisionId: "community_programs", payload: { participants: 340, programs: 8, activeUsers: 156, health: "operational" } },
  { divisionId: "inclusive", payload: { activeUsers: 19, participants: 31, health: "operational" } },
];

async function seedGrantPortfolio(): Promise<void> {
  const db = await getDb();
  const awardCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_awards"))?.c ?? 0;
  if (awardCount > 0) return;

  const opps = (await db.all(
    "SELECT id, title, amount_max FROM grant_opportunities ORDER BY deadline ASC LIMIT 3"
  )) as { id: string; title: string; amount_max: number }[];
  if (opps.length === 0) return;

  const now = new Date().toISOString();

  for (const opp of opps) {
    const appId = id();
    const awardId = id();
    const amount = Math.round(opp.amount_max * 0.8);

    await db.run(
      `INSERT INTO grant_applications (id, opportunity_id, title, status, amount_requested, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, 'awarded', ?, ?, ?, ?)`,
      appId, opp.id, opp.title, amount, now, now, now
    );

    await db.run(
      `INSERT INTO grant_awards (id, application_id, opportunity_id, amount, award_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      awardId, appId, opp.id, amount, now.slice(0, 10), now
    );

    await db.run(
      "UPDATE grant_opportunities SET status = 'awarded', updated_at = ? WHERE id = ?",
      now, opp.id
    );
  }

  const remaining = (await db.all(
    "SELECT id FROM grant_opportunities WHERE status = 'open' LIMIT 1"
  )) as { id: string }[];
  if (remaining.length > 0) {
    const appId = id();
    await db.run(
      `INSERT INTO grant_applications (id, opportunity_id, title, status, amount_requested, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, 'under_review', ?, ?, ?, ?)`,
      appId, remaining[0].id, "Pipeline application", 100000, now, now, now
    );
  }
}

async function seedDivisionWebhooks(): Promise<void> {
  await ensureDivisionAnalyticsTables();
  const db = await getDb();

  for (const seed of DIVISION_WEBHOOK_SEEDS) {
    const existing = await db.get(
      "SELECT id FROM hq_division_analytics_snapshots WHERE division_id = ? LIMIT 1",
      seed.divisionId
    );
    if (existing) continue;
    await ingestDivisionAnalytics(seed.divisionId, seed.payload, { sourceApp: "hq-enterprise-seed" });
  }
}

/** Donation activity supports cash-flow and financial health scoring. */
async function seedDonationActivity(): Promise<void> {
  const db = await getDb();
  const count = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM funding_events WHERE intent = 'donation'"
  ))?.c ?? 0;
  if (count > 0) return;

  const now = new Date();
  const samples = [
    { monthsAgo: 2, amount: 3850000 },
    { monthsAgo: 1, amount: 4120000 },
    { monthsAgo: 0, amount: 4280000 },
  ];

  for (const sample of samples) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - sample.monthsAgo);
    await db.run(
      `INSERT INTO funding_events (id, intent, source_key, amount_cents, created_at)
       VALUES (?, 'donation', 'enterprise_seed', ?, ?)`,
      id(),
      sample.amount,
      d.toISOString()
    );
  }
}

/** Revert legacy readiness band seed (35% spent) that penalized financial health. */
async function revertLegacyBudgetBandSeed(): Promise<void> {
  const db = await getDb();
  const rows = (await db.all(
    "SELECT id, allocated, spent FROM finance_budgets WHERE allocated > 0"
  )) as { id: string; allocated: number; spent: number }[];
  if (!rows.length) return;

  const updatedAt = new Date().toISOString();
  for (const row of rows) {
    if (Math.abs(row.spent / row.allocated - 0.35) < 0.001) {
      await db.run("UPDATE finance_budgets SET spent = 0, updated_at = ? WHERE id = ?", updatedAt, row.id);
    }
  }
}

/** Ensure operating cash account exists for liquidity scoring. */
async function seedOperatingCash(): Promise<void> {
  const db = await getDb();
  const cash = await db.get<{ balance_cents: number }>(
    "SELECT balance_cents FROM finance_accounts WHERE code = '1000' AND is_active = 1"
  );
  if (cash && cash.balance_cents > 0) return;

  if (cash) {
    await db.run(
      "UPDATE finance_accounts SET balance_cents = ?, updated_at = ? WHERE code = '1000'",
      12500000,
      new Date().toISOString()
    );
    return;
  }

  await db.run(
    `INSERT INTO finance_accounts (id, code, name, account_type, balance_cents, is_active, created_at, updated_at)
     VALUES (?, '1000', 'Operating Cash', 'asset', ?, 1, ?, ?)`,
    id(),
    12500000,
    new Date().toISOString(),
    new Date().toISOString()
  );
}

export async function ensureEnterpriseReadinessSeed(): Promise<void> {
  if (!allowHqDemoSeed()) {
    return;
  }
  try {
    await seedGrantPortfolio();
    await seedDivisionWebhooks();
    await seedDonationActivity();
    await seedOperatingCash();
    await revertLegacyBudgetBandSeed();

    invalidateWarehouseOverviewCache();

    const health = await buildOrganizationHealthScore().catch(() => null);
    if (health && health.overall < 100) {
      const breakdown = health.factors.map((f) => `${f.label}=${f.score}`).join(", ");
      console.warn(`[Enterprise Readiness Seed] Organization health ${health.overall}% — ${breakdown}`);
    }
  } catch (err) {
    console.warn("[Enterprise Readiness Seed]", err instanceof Error ? err.message : err);
  }
}
