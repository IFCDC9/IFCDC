/**
 * Phase 10 — What-if scenario modeling for executive decision intelligence.
 */
import { buildSafeAnalyticsOverview } from "./analyticsReporting";
import { buildExecutiveDashboard } from "./financeReporting";
import { buildGrantExecutiveDashboard } from "./grantReporting";
import { buildPredictiveIntelligence } from "./predictiveIntelligence";

export interface ScenarioInput {
  budgetChangePercent?: number;
  headcountChange?: number;
  grantWinRateAdjust?: number;
  donationGrowthPercent?: number;
  programEnrollmentChange?: number;
  horizonMonths?: number;
}

export interface ScenarioProjection {
  id: string;
  label: string;
  baseline: number;
  projected: number;
  unit: string;
  delta: number;
  deltaPercent: number;
  insight: string;
}

export interface ScenarioResult {
  scenario: ScenarioInput;
  horizonMonths: number;
  projections: ScenarioProjection[];
  summary: {
    cashFlowImpact: number;
    healthImpact: number;
    staffingGap: number;
    communityImpact: number;
    riskLevel: "low" | "medium" | "high";
    recommendation: string;
  };
  generatedAt: string;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export async function runScenarioAnalysis(input: ScenarioInput = {}): Promise<ScenarioResult> {
  const horizon = clamp(input.horizonMonths ?? 6, 1, 24);
  const budgetPct = input.budgetChangePercent ?? 0;
  const headcount = input.headcountChange ?? 0;
  const grantAdj = input.grantWinRateAdjust ?? 0;
  const donationPct = input.donationGrowthPercent ?? 0;
  const programPct = input.programEnrollmentChange ?? 0;

  const [overview, finance, grants, predictions] = await Promise.all([
    buildSafeAnalyticsOverview(),
    buildExecutiveDashboard(),
    buildGrantExecutiveDashboard(),
    buildPredictiveIntelligence(),
  ]);

  const baseCash = finance.cashFlow ?? 0;
  const baseHealth = overview.organizationHealth.overall;
  const baseStaffing = overview.people.employees;
  const baseParticipants = overview.programs.participants;
  const baseDonations = overview.donations.total;
  const baseGrantPipeline = grants.pipelineValue ?? 0;
  const winRate = grants.winRate ?? 50;

  const cashMultiplier = 1 + budgetPct / 100 + donationPct / 200;
  const projectedCash = Math.round(baseCash * cashMultiplier * (1 + horizon * 0.02));
  const projectedHealth = clamp(
    Math.round(baseHealth + budgetPct * 0.15 + grantAdj * 0.2 + donationPct * 0.1 - (headcount < 0 ? 3 : 0)),
    40,
    100
  );
  const projectedStaffing = Math.max(1, baseStaffing + headcount);
  const staffingGap = Math.max(0, Math.round(baseParticipants / 25 - projectedStaffing));
  const projectedParticipants = Math.round(baseParticipants * (1 + programPct / 100));
  const communityImpact = Math.round(
    projectedParticipants * 0.12 + (projectedCash > baseCash ? 8 : -4) + (grantAdj > 0 ? 5 : 0)
  );
  const adjustedWinRate = clamp(winRate + grantAdj, 5, 95);
  const projectedGrantRevenue = Math.round(baseGrantPipeline * (adjustedWinRate / 100) * 0.35);

  const cashModel = predictions.models.find((m) => m.id === "cash_flow");
  const grantModel = predictions.models.find((m) => m.id === "grant_success");

  const projections: ScenarioProjection[] = [
    {
      id: "cash_flow",
      label: "Cash Flow",
      baseline: baseCash,
      projected: projectedCash,
      unit: "$",
      delta: projectedCash - baseCash,
      deltaPercent: baseCash ? Math.round(((projectedCash - baseCash) / baseCash) * 100) : 0,
      insight: budgetPct > 5 ? "Budget expansion improves liquidity" : budgetPct < -5 ? "Budget cuts reduce runway" : "Cash flow stable under current assumptions",
    },
    {
      id: "organization_health",
      label: "Organization Health",
      baseline: baseHealth,
      projected: projectedHealth,
      unit: "%",
      delta: projectedHealth - baseHealth,
      deltaPercent: projectedHealth - baseHealth,
      insight: projectedHealth >= 95 ? "Strong organizational posture" : projectedHealth >= 80 ? "Monitor key health factors" : "Elevated risk — review operations and grants",
    },
    {
      id: "grant_revenue",
      label: "Grant Revenue (projected)",
      baseline: Math.round(baseGrantPipeline * (winRate / 100) * 0.35),
      projected: projectedGrantRevenue,
      unit: "$",
      delta: projectedGrantRevenue - Math.round(baseGrantPipeline * (winRate / 100) * 0.35),
      deltaPercent: grantAdj,
      insight: grantAdj > 0 ? `Win rate uplift to ${adjustedWinRate}%` : grantAdj < 0 ? "Pipeline conversion at risk" : (grantModel?.insight ?? "Grant pipeline steady"),
    },
    {
      id: "staffing",
      label: "Staffing Capacity",
      baseline: baseStaffing,
      projected: projectedStaffing,
      unit: "FTE",
      delta: headcount,
      deltaPercent: baseStaffing ? Math.round((headcount / baseStaffing) * 100) : 0,
      insight: staffingGap > 0 ? `${staffingGap} FTE gap for program load` : "Staffing aligned with enrollment",
    },
    {
      id: "community_impact",
      label: "Community Impact Index",
      baseline: Math.round(baseParticipants * 0.12),
      projected: communityImpact,
      unit: "score",
      delta: communityImpact - Math.round(baseParticipants * 0.12),
      deltaPercent: programPct,
      insight: programPct > 0 ? "Enrollment growth expands community reach" : "Maintain program engagement",
    },
    {
      id: "donations",
      label: "Donation Revenue",
      baseline: baseDonations,
      projected: Math.round(baseDonations * (1 + donationPct / 100)),
      unit: "$",
      delta: Math.round(baseDonations * (donationPct / 100)),
      deltaPercent: donationPct,
      insight: donationPct > 0 ? "Fundraising momentum assumed" : (cashModel?.insight ?? "Donation baseline"),
    },
  ];

  const cashImpact = projectedCash - baseCash;
  const healthImpact = projectedHealth - baseHealth;
  let riskLevel: "low" | "medium" | "high" = "low";
  if (projectedHealth < 75 || cashImpact < -50000) riskLevel = "high";
  else if (projectedHealth < 90 || staffingGap > 3) riskLevel = "medium";

  let recommendation = "Current trajectory supports stable operations.";
  if (riskLevel === "high") recommendation = "Prioritize cash conservation, grant submissions, and staffing review before expansion.";
  else if (staffingGap > 2) recommendation = `Add ${staffingGap} FTE or reduce program enrollment targets to maintain service quality.`;
  else if (grantAdj > 5) recommendation = "Increase grant development capacity to capture pipeline upside.";
  else if (budgetPct > 10) recommendation = "Validate budget expansion against 6-month cash runway before committing.";

  return {
    scenario: input,
    horizonMonths: horizon,
    projections,
    summary: {
      cashFlowImpact: cashImpact,
      healthImpact,
      staffingGap,
      communityImpact,
      riskLevel,
      recommendation,
    },
    generatedAt: new Date().toISOString(),
  };
}

export const SCENARIO_PRESETS = [
  { id: "baseline", label: "Baseline", input: {} },
  { id: "growth", label: "Growth (+10% budget, +2 FTE)", input: { budgetChangePercent: 10, headcountChange: 2, programEnrollmentChange: 8 } },
  { id: "austerity", label: "Austerity (-8% budget)", input: { budgetChangePercent: -8, headcountChange: -1 } },
  { id: "grant_push", label: "Grant Push (+15% win rate)", input: { grantWinRateAdjust: 15, donationGrowthPercent: 5 } },
  { id: "expansion", label: "Program Expansion (+20% enrollment)", input: { programEnrollmentChange: 20, headcountChange: 3, budgetChangePercent: 5 } },
];

export async function runScenarioPresets() {
  const results = await Promise.all(SCENARIO_PRESETS.map(async (p) => ({
    ...p,
    result: await runScenarioAnalysis(p.input),
  })));
  return { presets: results, generatedAt: new Date().toISOString() };
}
