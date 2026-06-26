/**
 * Phase 10 — Enterprise Command & Intelligence Platform
 * Unified executive mission control for IFCDC Headquarters.
 */
import {
  buildPhase9CommandCenter,
  buildPredictiveDashboard,
  buildCrossDivisionDataLayer,
  buildGrantProbabilityScores,
  buildUniversalSearchIndex,
} from "./phase9OperatingSystem";
import { buildOrganizationHealthScore, buildHeadquartersActivityFeed } from "./analyticsReporting";
import { buildExecutiveTaskHub } from "./executiveTaskHub";
import { runScenarioAnalysis, runScenarioPresets, type ScenarioInput } from "./scenarioModeling";
import {
  resolveDashboardTemplateKey,
  getDashboardTemplate,
  listDashboardTemplates,
  type DashboardTemplateKey,
} from "./dashboardTemplates";
import { answerExecutiveCopilotQuestion } from "./auraExecutiveCopilot";
import { generateStrategicRecommendations } from "./executiveIntelligenceEngine";
import { predictFinancialRisk } from "./auraExecutiveOps";
import { buildExecutiveDashboard } from "./financeReporting";

const COMMAND_CONSOLE_MODULES = [
  { label: "Mission Control", path: "/hq/phase10", section: "Command" },
  { label: "Executive Dashboard", path: "/hq", section: "Command" },
  { label: "AURA Command Center", path: "/hq/aura", section: "Command" },
  { label: "Intelligent OS", path: "/hq/phase9", section: "Command" },
  { label: "Enterprise Intelligence", path: "/hq/intelligence", section: "Command" },
  { label: "Financial Center", path: "/hq/finance", section: "Finance" },
  { label: "Grant Center", path: "/hq/grants", section: "Finance" },
  { label: "People Management", path: "/hq/people", section: "Operations" },
  { label: "Workflow Automation", path: "/hq/workflows", section: "Command" },
  { label: "Organization Analytics", path: "/hq/analytics", section: "Command" },
  { label: "Board Portal", path: "/hq/board", section: "Governance" },
  { label: "Community Programs", path: "/hq/programs", section: "Programs" },
  { label: "Housing Programs", path: "/hq/housing", section: "Programs" },
  { label: "Scholarships", path: "/hq/scholarships", section: "Programs" },
  { label: "Media Division", path: "/hq/media", section: "Programs" },
  { label: "Software Division", path: "/hq/software", section: "Operations" },
  { label: "Security Center", path: "/hq/security", section: "System" },
  { label: "Organization Settings", path: "/hq/settings", section: "System" },
];

const QUICK_ACTIONS = [
  { id: "briefing", label: "Executive Briefing", path: "/hq/aura", icon: "sparkles" },
  { id: "board-report", label: "Board Report", path: "/hq/reports", icon: "file" },
  { id: "approve", label: "Approval Queue", path: "/hq/workflows", icon: "check" },
  { id: "finance", label: "Financial Center", path: "/hq/finance", icon: "wallet" },
  { id: "grants", label: "Grant Center", path: "/hq/grants", icon: "file-text" },
  { id: "people", label: "People Management", path: "/hq/people", icon: "users" },
  { id: "scenarios", label: "What-If Scenarios", path: "/hq/phase10#scenarios", icon: "trending" },
  { id: "search", label: "Universal Search", path: "/hq/phase10#search", icon: "search" },
];

const ROLE_HOME_PATHS: Record<DashboardTemplateKey, string> = {
  founder: "/hq/phase10",
  executive: "/hq/phase10",
  board_member: "/hq/board",
  grant_manager: "/hq/grants",
  hr: "/hq/people",
  finance: "/hq/finance",
  volunteer: "/hq/programs",
  department_manager: "/hq",
  donor: "/hq/donations",
};

export function resolveRoleHomePath(role: string): string {
  const key = resolveDashboardTemplateKey(role);
  return ROLE_HOME_PATHS[key] ?? "/hq/phase10";
}

export async function buildMissionControlHome(role: string) {
  const templateKey = resolveDashboardTemplateKey(role);
  const template = getDashboardTemplate(templateKey);
  const [health, activity] = await Promise.all([
    buildOrganizationHealthScore(),
    buildHeadquartersActivityFeed(20),
  ]);

  return {
    roleHome: resolveRoleHomePath(role),
    template: {
      key: template.key,
      name: template.name,
      description: template.description,
      dashboardMode: template.dashboardMode,
      widgetIds: template.widgetIds,
    },
    templates: listDashboardTemplates(),
    organizationHealth: health,
    kpiWall: health.factors.map((f) => ({
      id: f.label.toLowerCase().replace(/\s+/g, "_"),
      label: f.label,
      value: f.score,
      unit: "%",
      weight: f.weight,
      status: f.score >= 90 ? "healthy" : f.score >= 75 ? "watch" : "risk",
    })),
    activityTimeline: activity,
    quickActions: QUICK_ACTIONS,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildEnterpriseAIPackage() {
  const [command, recommendations, risk, grants, finance] = await Promise.all([
    buildPhase9CommandCenter(),
    generateStrategicRecommendations(),
    predictFinancialRisk(),
    buildGrantProbabilityScores(),
    buildExecutiveDashboard(),
  ]);

  const budgetOptimizations = [
    finance.cashFlow < 0
      ? { action: "Reduce discretionary spend by 5–8% to stabilize cash flow", priority: "high", savingsEstimate: Math.abs(finance.cashFlow) * 0.1 }
      : { action: "Maintain 90-day cash reserve; current flow supports operations", priority: "low", savingsEstimate: 0 },
    {
      action: "Align payroll cycles with grant reimbursement timing",
      priority: finance.accountsPayable > finance.accountsReceivable ? "medium" : "low",
      savingsEstimate: Math.round(finance.accountsPayable * 0.02),
    },
    {
      action: "Consolidate vendor contracts across divisions for volume discounts",
      priority: "medium",
      savingsEstimate: 2500,
    },
  ];

  const grantMatches = grants
    .filter((g) => g.probability >= 50)
    .slice(0, 6)
    .map((g) => ({
      opportunityId: g.opportunityId,
      title: g.title,
      probability: g.probability,
      matchReason: g.factors.join(" · ") || "Pipeline fit",
      deadline: g.deadline,
    }));

  return {
    briefing: command.briefing,
    recommendations: recommendations.recommendations.slice(0, 8),
    budgetOptimizations,
    grantMatches,
    riskAnalysis: {
      level: risk.riskLevel,
      score: risk.riskScore,
      factors: risk.factors?.slice(0, 6) ?? [],
    },
    compliance: command.complianceAlerts,
    riskAlerts: command.riskAlerts,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildCrossDivisionOperations() {
  const [divisions, activity, tasks, predictive] = await Promise.all([
    buildCrossDivisionDataLayer(),
    buildHeadquartersActivityFeed(30),
    buildExecutiveTaskHub(25),
    buildPredictiveDashboard(),
  ]);

  const resourcePlan = {
    staffing: predictive.staffing,
    volunteers: predictive.volunteerUtilization,
    programs: predictive.kpiTrends.find((m) => m.id === "program_growth"),
    divisions: divisions.dataLayer?.divisions?.map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      healthy: d.healthy,
      dataSource: d.dataSource,
    })) ?? [],
  };

  return {
    divisions,
    activityTimeline: activity,
    tasks,
    resourcePlan,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildDecisionIntelligence(scenario?: ScenarioInput) {
  const [predictive, presets, scenarioResult] = await Promise.all([
    buildPredictiveDashboard(),
    runScenarioPresets(),
    runScenarioAnalysis(scenario ?? {}),
  ]);

  return {
    predictive,
    scenarios: {
      active: scenarioResult,
      presets: presets.presets,
    },
    grantProbability: predictive.grantProbability,
    communityImpact: scenarioResult.projections.find((p) => p.id === "community_impact"),
    generatedAt: new Date().toISOString(),
  };
}

export async function buildCommandConsole() {
  const activity = await buildHeadquartersActivityFeed(12);
  const modules = COMMAND_CONSOLE_MODULES.map((item) => ({
    label: item.label,
    path: item.path,
    section: item.section,
  }));

  return {
    modules,
    quickActions: QUICK_ACTIONS,
    keyboardShortcuts: [
      { keys: ["⌘", "K"], action: "Open command palette / universal search" },
      { keys: ["?"], action: "Show keyboard shortcuts" },
      { keys: ["G", "H"], action: "Go to Mission Control" },
      { keys: ["G", "A"], action: "Go to AURA Command Center" },
      { keys: ["G", "F"], action: "Go to Financial Center" },
      { keys: ["G", "G"], action: "Go to Grant Center" },
      { keys: ["G", "P"], action: "Go to People Management" },
      { keys: ["Esc"], action: "Close dialogs and palettes" },
    ],
    recentActivity: activity,
    generatedAt: new Date().toISOString(),
  };
}

export async function askExecutiveQA(question: string) {
  return answerExecutiveCopilotQuestion(question);
}

export async function buildPhase10ExecutivePackage(role: string) {
  const [missionControl, enterpriseAI, operations, decisionIntel, commandConsole] = await Promise.all([
    buildMissionControlHome(role),
    buildEnterpriseAIPackage(),
    buildCrossDivisionOperations(),
    buildDecisionIntelligence(),
    buildCommandConsole(),
  ]);

  return {
    phase: 10,
    platform: "IFCDC Enterprise Command & Intelligence Platform",
    missionControl,
    enterpriseAI,
    operations,
    decisionIntelligence: decisionIntel,
    commandConsole,
    generatedAt: new Date().toISOString(),
  };
}

export { buildUniversalSearchIndex };
