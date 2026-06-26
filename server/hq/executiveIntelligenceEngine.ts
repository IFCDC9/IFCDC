import { buildSafeAnalyticsOverview, buildKpiMonitoring, buildOrganizationHealthScore } from "./analyticsReporting";
import { buildExecutiveDashboard } from "./financeReporting";
import { buildGrantExecutiveDashboard } from "./grantReporting";
import { getWarehouseOverview, getWarehouseTrends, buildPredictiveForecasts } from "./analyticsWarehouse";
import { trackComplianceDeadlines, predictFinancialRisk } from "./auraExecutiveOps";
import { buildPredictiveIntelligence } from "./predictiveIntelligence";
import { buildDivisionIntegrationOverview } from "./divisionIntegrationLayer";
import { generateEnterpriseBoardReport } from "./auraEnterpriseIntelligence";
import { auraExecutiveChat } from "../lib/ifcdc";
import { buildGrantPerformanceScore, buildSoftwareDivisionHealthScore } from "./enterpriseHealthScoring";

export interface ScorecardPillar {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  grade: string;
  status: "excellent" | "strong" | "stable" | "watch" | "critical";
  trend: "up" | "down" | "stable";
  detail: string;
}

function statusFromScore(score: number): ScorecardPillar["status"] {
  if (score >= 90) return "excellent";
  if (score >= 75) return "strong";
  if (score >= 60) return "stable";
  if (score >= 45) return "watch";
  return "critical";
}

function gradeFromScore(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B+";
  if (score >= 70) return "B";
  if (score >= 60) return "C+";
  return "Needs Attention";
}

export async function buildExecutiveScorecard() {
  const [overview, finance, grants, health, warehouse, kpis, software] = await Promise.all([
    buildSafeAnalyticsOverview(),
    buildExecutiveDashboard(),
    buildGrantExecutiveDashboard(),
    buildOrganizationHealthScore(),
    getWarehouseOverview(),
    buildKpiMonitoring(),
    buildSoftwareDivisionHealthScore(),
  ]);

  const criticalKpis = kpis.kpis.filter((k) => k.status === "critical").length;
  const watchKpis = kpis.kpis.filter((k) => k.status === "watch").length;

  const pillars: ScorecardPillar[] = [
    {
      id: "organization",
      label: "Organization Health",
      score: health.overall,
      maxScore: 100,
      grade: health.grade,
      status: statusFromScore(health.overall),
      trend: warehouse.organizationHealth >= overview.organizationHealth.overall ? "up" : "stable",
      detail: `${health.factors.length} weighted factors`,
    },
    {
      id: "financial",
      label: "Financial Performance",
      score: finance.financialHealthScore,
      maxScore: 100,
      grade: gradeFromScore(finance.financialHealthScore),
      status: statusFromScore(finance.financialHealthScore),
      trend: finance.cashFlow >= 0 ? "up" : "down",
      detail: `Cash flow $${finance.cashFlow.toLocaleString()} · Net $${finance.netPosition.toLocaleString()}`,
    },
    {
      id: "grants",
      label: "Grant Portfolio",
      score: buildGrantPerformanceScore(grants),
      maxScore: 100,
      grade: gradeFromScore(buildGrantPerformanceScore(grants)),
      status: grants.complianceDue > 2 ? "watch" : statusFromScore(buildGrantPerformanceScore(grants)),
      trend: grants.pipelineValue > 0 ? "up" : "stable",
      detail: `${grants.activeAwards} active · Pipeline $${grants.pipelineValue.toLocaleString()}`,
    },
    {
      id: "people",
      label: "People & HR",
      score: Math.min(100, 60 + Math.round(overview.people.employees / 2) + (overview.people.volunteers > 10 ? 15 : 0)),
      maxScore: 100,
      grade: gradeFromScore(70),
      status: "stable",
      trend: "stable",
      detail: `${overview.people.totalPeople} people · ${overview.people.hoursThisMonth} hrs this month`,
    },
    {
      id: "compliance",
      label: "Compliance & Risk",
      score: Math.max(0, 100 - grants.complianceDue * 12 - criticalKpis * 15),
      maxScore: 100,
      grade: grants.complianceDue === 0 ? "A" : grants.complianceDue <= 2 ? "B" : "C",
      status: grants.complianceDue > 2 ? "watch" : "strong",
      trend: grants.complianceDue > 0 ? "down" : "up",
      detail: `${grants.complianceDue} due · ${criticalKpis} critical KPIs`,
    },
    {
      id: "operations",
      label: "Operations & Systems",
      score: software.score,
      maxScore: 100,
      grade: gradeFromScore(software.score),
      status: watchKpis > 3 ? "watch" : statusFromScore(software.score),
      trend: "stable",
      detail: `${software.operational}/${software.total} systems operational`,
    },
  ];

  const overall = Math.round(pillars.reduce((s, p) => s + p.score, 0) / pillars.length);

  return {
    overall,
    grade: gradeFromScore(overall),
    pillars,
    kpiAlerts: { critical: criticalKpis, watch: watchKpis },
    timestamp: new Date().toISOString(),
  };
}

export async function buildOrganizationHealthForecast() {
  const [forecasts, trends, predictions] = await Promise.all([
    buildPredictiveForecasts(),
    getWarehouseTrends("organization_health", 30),
    buildPredictiveIntelligence(),
  ]);

  const healthForecast = forecasts.forecasts.find((f) => f.metric === "organization_health");
  return {
    current: healthForecast?.current ?? predictions.organizationHealth.current,
    projected30d: predictions.organizationHealth.projected30d,
    projected90d: predictions.organizationHealth.projected90d,
    trend: healthForecast?.trend ?? "stable",
    history: (trends.trends as { metric_value: number; period: string }[]).map((t) => ({
      period: t.period,
      value: t.metric_value,
    })),
    confidence: predictions.organizationHealth.grade,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildFinancialForecast() {
  const [finance, forecasts, risk, predictions] = await Promise.all([
    buildExecutiveDashboard(),
    buildPredictiveForecasts(),
    predictFinancialRisk(),
    buildPredictiveIntelligence(),
  ]);

  const cashModel = predictions.models.find((m) => m.id === "cash_flow");
  const cashForecast = forecasts.forecasts.find((f) => f.metric === "cash_flow");

  return {
    current: {
      cashFlow: finance.cashFlow,
      netPosition: finance.netPosition,
      monthlyExpenses: finance.monthlyExpenses,
      budgetRemaining: finance.budgetRemaining,
      healthScore: finance.financialHealthScore,
    },
    projected: {
      cashFlow30d: cashModel?.projected30d ?? cashForecast?.projected30d ?? finance.cashFlow,
      cashFlow90d: cashModel?.projected90d ?? cashForecast?.projected90d ?? finance.cashFlow,
      trend: cashForecast?.trend ?? "stable",
    },
    risk: {
      score: (risk as { riskScore?: number }).riskScore ?? 0,
      level: (risk as { riskLevel?: string }).riskLevel ?? "low",
      factors: (risk as { riskFactors?: string[] }).riskFactors ?? [],
      recommendations: (risk as { recommendations?: string[] }).recommendations ?? [],
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function buildGrantFundingProjections() {
  const [grants, forecasts, predictions] = await Promise.all([
    buildGrantExecutiveDashboard(),
    buildPredictiveForecasts(),
    buildPredictiveIntelligence(),
  ]);

  const grantForecast = forecasts.forecasts.find((f) => f.metric === "grant_pipeline_value");
  const successModel = predictions.models.find((m) => m.id === "grant_success");

  return {
    activeAwards: grants.activeAwards,
    totalAwarded: grants.totalAwarded,
    pipelineValue: grants.pipelineValue,
    winRate: grants.winRate,
    complianceDue: grants.complianceDue,
    projectedPipeline30d: grantForecast?.projected30d ?? grants.pipelineValue,
    projectedPipeline90d: grantForecast?.projected90d ?? grants.pipelineValue,
    successProbability: successModel?.current ?? grants.winRate,
    fundingPipeline: grants.fundingPipeline ?? [],
    generatedAt: new Date().toISOString(),
  };
}

export async function buildComplianceRiskAnalysis() {
  const [compliance, scorecard] = await Promise.all([
    trackComplianceDeadlines(),
    buildExecutiveScorecard(),
  ]);

  const compliancePillar = scorecard.pillars.find((p) => p.id === "compliance");
  const riskLevel = compliance.overdue > 2 ? "high" : compliance.overdue > 0 ? "medium" : "low";

  return {
    riskLevel,
    score: compliancePillar?.score ?? 80,
    overdue: compliance.overdue,
    dueNext14Days: compliance.dueNext14Days,
    deadlines: compliance.deadlines,
    recommendations: [
      ...(compliance.overdue > 0 ? [`Address ${compliance.overdue} overdue compliance items immediately`] : []),
      ...(compliance.dueNext14Days > 0 ? [`Prepare ${compliance.dueNext14Days} reports due within 14 days`] : []),
      "Review grant compliance calendar with program directors",
      "Schedule quarterly compliance audit with board governance committee",
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function generateStrategicRecommendations() {
  const [scorecard, financial, grants, compliance, divisions] = await Promise.all([
    buildExecutiveScorecard(),
    buildFinancialForecast(),
    buildGrantFundingProjections(),
    buildComplianceRiskAnalysis(),
    buildDivisionIntegrationOverview(),
  ]);

  const recommendations: { priority: number; area: string; action: string; impact: "high" | "medium" | "low" }[] = [];

  if (financial.current.cashFlow < 0) {
    recommendations.push({ priority: 1, area: "Finance", action: "Stabilize cash flow — defer non-essential spending and accelerate grant drawdowns", impact: "high" });
  }
  if (compliance.overdue > 0) {
    recommendations.push({ priority: 1, area: "Compliance", action: `Resolve ${compliance.overdue} overdue compliance deadlines`, impact: "high" });
  }
  if (grants.pipelineValue > 500000) {
    recommendations.push({ priority: 2, area: "Grants", action: "Accelerate high-value pipeline opportunities — assign executive sponsor to top 3 funders", impact: "high" });
  }
  const weakPillar = scorecard.pillars.sort((a, b) => a.score - b.score)[0];
  if (weakPillar && weakPillar.score < 70) {
    recommendations.push({ priority: 2, area: weakPillar.label, action: `Strengthen ${weakPillar.label} — currently at ${weakPillar.score}%`, impact: "medium" });
  }
  if (divisions.counts.healthy < divisions.counts.total) {
    recommendations.push({ priority: 3, area: "Software Division", action: `Restore health for ${divisions.counts.total - divisions.counts.healthy} division app(s)`, impact: "medium" });
  }
  recommendations.push({ priority: 4, area: "Intelligence", action: "Review Executive Intelligence Center scorecard weekly with department heads", impact: "low" });

  return {
    recommendations: recommendations.sort((a, b) => a.priority - b.priority),
    scorecardGrade: scorecard.grade,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateExecutiveBoardReport() {
  const [scorecard, financial, grants, compliance, predictions, boardReport] = await Promise.all([
    buildExecutiveScorecard(),
    buildFinancialForecast(),
    buildGrantFundingProjections(),
    buildComplianceRiskAnalysis(),
    buildPredictiveIntelligence(),
    generateEnterpriseBoardReport().catch(() => ({ report: "", executiveSummary: "" })),
  ]);

  const narrative = (() => {
    const br = boardReport as Record<string, unknown>;
    if (typeof br.report === "string") return br.report;
    if (typeof br.executiveSummary === "string") return br.executiveSummary;
    return "";
  })();

  let aiNarrative = narrative;
  if (!narrative) {
    try {
      aiNarrative = await auraExecutiveChat([
        "Generate a concise IFCDC board report executive summary (3 paragraphs).",
        `Organization grade: ${scorecard.grade} (${scorecard.overall}%)`,
        `Financial: cash flow $${financial.current.cashFlow}, net position $${financial.current.netPosition}`,
        `Grants: ${grants.activeAwards} active, pipeline $${grants.pipelineValue}`,
        `Compliance risk: ${compliance.riskLevel}, ${compliance.overdue} overdue`,
      ].join("\n"));
    } catch {
      aiNarrative = `IFCDC Headquarters reports organization health at ${scorecard.overall}% (${scorecard.grade}). Financial position: $${financial.current.netPosition.toLocaleString()} net with $${financial.current.cashFlow.toLocaleString()} monthly cash flow. Grant portfolio: ${grants.activeAwards} active awards, $${grants.pipelineValue.toLocaleString()} pipeline.`;
    }
  }

  return {
    title: `IFCDC Board Report — ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
    executiveSummary: aiNarrative,
    scorecard,
    financial: financial.current,
    financialForecast: financial.projected,
    grants,
    compliance,
    predictions: predictions.models.slice(0, 4),
    generatedAt: new Date().toISOString(),
  };
}

/** Unified Phase 8 intelligence package */
let packageCache: { data: Awaited<ReturnType<typeof buildExecutiveIntelligencePackageUncached>>; expires: number } | null = null;
const PACKAGE_CACHE_TTL = 2 * 60 * 1000;

async function buildExecutiveIntelligencePackageUncached() {
  const [scorecard, healthForecast, financialForecast, grantProjections, compliance, recommendations, predictions, divisions] = await Promise.all([
    buildExecutiveScorecard(),
    buildOrganizationHealthForecast(),
    buildFinancialForecast(),
    buildGrantFundingProjections(),
    buildComplianceRiskAnalysis(),
    generateStrategicRecommendations(),
    buildPredictiveIntelligence(),
    buildDivisionIntegrationOverview(),
  ]);

  return {
    scorecard,
    forecasts: {
      organizationHealth: healthForecast,
      financial: financialForecast,
      grants: grantProjections,
    },
    compliance,
    recommendations,
    predictions,
    divisions,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildExecutiveIntelligencePackage() {
  const now = Date.now();
  if (packageCache && packageCache.expires > now) return packageCache.data;
  const data = await buildExecutiveIntelligencePackageUncached();
  packageCache = { data, expires: now + PACKAGE_CACHE_TTL };
  return data;
}
