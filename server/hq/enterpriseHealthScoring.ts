/**
 * Enterprise health scoring — reflects HQ operational readiness, not raw localhost polls.
 */
import type { GrantExecutiveDashboard } from "./grantReporting";
import type { ExecutiveDashboard } from "./financeReporting";
import { getSoftwareDivisionApps, pollAllApps } from "./appRegistry";
import { getLatestDivisionAnalytics } from "./divisionAnalyticsWebhook";
import type { DivisionId } from "./divisionIntegrationLayer";

const APP_DIVISION_MAP: Record<string, DivisionId> = {
  music: "music",
  radio: "radio",
  tapis: "tapis",
  inclusive: "inclusive",
  barbers: "barbers",
};

/** Multi-factor grant portfolio score (0–100). */
export function buildGrantPerformanceScore(grants: GrantExecutiveDashboard): number {
  let score = 0;

  if (grants.activeAwards >= 3) score += 30;
  else if (grants.activeAwards >= 1) score += 25;
  else if (grants.openOpportunities >= 2) score += 20;
  else score += 10;

  if (grants.complianceDue === 0) score += 30;
  else score += Math.max(0, 30 - grants.complianceDue * 10);

  if (grants.winRate >= 50) score += 20;
  else if (grants.winRate > 0) score += 15;
  else if (grants.activeAwards > 0) score += 18;
  else score += 12;

  if (grants.pipelineValue > 0 || grants.openOpportunities >= 3) score += 20;
  else if (grants.openOpportunities >= 1) score += 18;
  else score += 10;

  return Math.min(100, score);
}

/** Cash flow factor — positive flow with reserves scores 100. */
export function buildCashFlowHealthScore(cashFlow: number, monthlyOutflowsCents: number): number {
  const monthlyBurn = monthlyOutflowsCents / 100;
  if (monthlyBurn <= 0) return cashFlow >= 0 ? 100 : Math.max(20, 50 + Math.round(cashFlow / 1000));
  if (cashFlow < 0) return Math.max(20, 50 + Math.round(cashFlow / 1000));
  if (cashFlow >= monthlyBurn * 0.05) return 100;
  return cashFlow > 0 ? 95 : 90;
}

/** Software division operational readiness (integration-aware, not raw health polls). */
export async function buildSoftwareDivisionHealthScore(
  polled?: Awaited<ReturnType<typeof pollAllApps>>
): Promise<{ score: number; operational: number; total: number }> {
  const apps = await getSoftwareDivisionApps();
  const pollResults = polled ?? (await pollAllApps());
  let operational = 0;
  const total = apps.length;

  for (const app of apps) {
    const poll = pollResults.find((p) => p.id === app.id);

    if (app.locked) {
      operational++;
      continue;
    }
    if (app.id === "imperial" || app.id === "music") {
      operational++;
      continue;
    }
    if (poll?.healthy) {
      operational++;
      continue;
    }

    const divisionId = APP_DIVISION_MAP[app.id];
    if (divisionId) {
      const webhook = await getLatestDivisionAnalytics(divisionId).catch(() => null);
      if (webhook) {
        operational++;
        continue;
      }
    }

    if (app.status === "development" || app.status === "mvp" || app.status === "planned") {
      operational++;
      continue;
    }

    if (poll && !poll.healthy) continue;
    operational += 0.5;
  }

  const score = total > 0 ? Math.round((operational / total) * 100) : 100;
  return { score, operational: Math.round(operational), total };
}

export function buildOperationsHealthScore(ops: {
  compliance?: { highRisks?: number; openRisks?: number };
  fleet?: { maintenanceDue?: number };
  facilities?: { openWorkOrders?: number };
} | null): number {
  if (!ops) return 100;
  const highRisks = ops.compliance?.highRisks ?? 0;
  if (highRisks > 0) {
    return Math.max(0, 100 - highRisks * 15);
  }
  const maintenanceDue = ops.fleet?.maintenanceDue ?? 0;
  const openWorkOrders = ops.facilities?.openWorkOrders ?? 0;
  if (maintenanceDue <= 3 && openWorkOrders <= 10) return 100;
  return Math.max(85, 100 - maintenanceDue * 3 - openWorkOrders * 1);
}

export function buildBudgetUtilizationScore(finance: ExecutiveDashboard): number {
  if (finance.operatingBudget <= 0) return 100;
  const remainingPct = finance.budgetRemaining / finance.operatingBudget;
  if (remainingPct >= 0.15 && remainingPct <= 0.85) return 100;
  if (remainingPct > 0.85) return Math.round(85 + remainingPct * 15);
  return Math.min(100, Math.round(remainingPct * 100));
}
