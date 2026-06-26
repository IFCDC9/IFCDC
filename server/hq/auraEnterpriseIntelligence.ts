import { getWarehouseOverview, getWarehouseTrends, getExecutiveDrillDown } from "./analyticsWarehouse";
import { buildBoardFinancialReport } from "./financeIntelligence";
import { buildFunderReports } from "./grantReporting";
import { buildApprovalQueue } from "./enterpriseApprovals";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import { auraExecutiveChat } from "../lib/ifcdc";
import { trackComplianceDeadlines, detectOperationalAnomalies, generateAuraExecutiveSummary } from "./auraExecutiveOps";

export async function buildEnterpriseDataContext(): Promise<string> {
  const [warehouse, compliance, anomalies, summary] = await Promise.all([
    getWarehouseOverview().catch(() => null),
    trackComplianceDeadlines().catch(() => null),
    detectOperationalAnomalies().catch(() => null),
    generateAuraExecutiveSummary().catch(() => null),
  ]);

  const lines: string[] = [
    "# IFCDC Headquarters Enterprise Data Context",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Organization Health",
    warehouse ? `- Health score: ${warehouse.organizationHealth}% (${warehouse.grade})` : "- Health data unavailable",
    "",
    "## Finance",
    warehouse?.finance
      ? `- Revenue: $${warehouse.finance.totalRevenue?.toLocaleString()} | Cash flow: $${warehouse.finance.cashFlow?.toLocaleString()} | Net: $${warehouse.finance.netPosition?.toLocaleString()}`
      : "",
    "",
    "## Grants",
    warehouse?.grants
      ? `- Active: ${warehouse.grants.activeAwards} | Pipeline: $${warehouse.grants.pipelineValue?.toLocaleString()} | Compliance due: ${warehouse.grants.complianceDue}`
      : "",
    "",
    "## Programs & People",
    warehouse?.programs ? `- Programs: ${warehouse.programs.programsRunning} | Participants: ${warehouse.programs.participants}` : "",
    warehouse?.people ? `- People: ${warehouse.people?.totalPeople ?? 0} | Volunteers: ${warehouse.people?.volunteers ?? 0}` : "",
    "",
    "## Donations",
    warehouse?.donations ? `- Total: $${warehouse.donations?.total?.toLocaleString() ?? 0} | Gifts: ${warehouse.donations?.count ?? 0}` : "",
    "",
    "## Compliance",
    compliance ? `- Pending deadlines: ${(compliance as { pending?: unknown[] }).pending?.length ?? 0}` : "",
    "",
    "## Anomalies",
    anomalies ? `- Detected: ${(anomalies as { anomalies?: unknown[] }).anomalies?.length ?? 0}` : "",
    "",
    "## Executive Summary",
    summary ? String((summary as { summary?: string }).summary ?? "").slice(0, 1500) : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export async function answerEnterpriseQuestion(question: string, userMessage?: string) {
  const [context, drillDowns] = await Promise.all([
    buildEnterpriseDataContext(),
    buildAuraExecutiveContext().catch(() => ""),
  ]);

  const prompt = [
    "You are AURA, the IFCDC Headquarters executive AI. Answer using ONLY the organization data below.",
    "Be specific with numbers. Recommend priorities when asked. Flag compliance risks.",
    "",
    context,
    drillDowns ? `\n## Additional Context\n${drillDowns.slice(0, 2000)}` : "",
    "",
    `Executive question: ${question}`,
    userMessage ? `Additional context: ${userMessage}` : "",
  ].join("\n");

  try {
    const response = await auraExecutiveChat(prompt);
    return {
      answer: response,
      sources: ["data_warehouse", "analytics", "compliance", "operations"],
      generatedAt: new Date().toISOString(),
    };
  } catch {
    const overview = await getWarehouseOverview();
    return {
      answer: `Based on current HQ data: Organization health is ${overview.organizationHealth}% (${overview.grade}). ` +
        `Cash flow is $${overview.finance?.cashFlow?.toLocaleString() ?? 0}. ` +
        `${overview.grants?.activeAwards ?? 0} active grants with ${overview.grants?.complianceDue ?? 0} compliance items due. ` +
        `${overview.programs?.programsRunning ?? 0} programs serving ${overview.programs?.participants ?? 0} participants.`,
      sources: ["data_warehouse_fallback"],
      generatedAt: new Date().toISOString(),
    };
  }
}

export async function generateEnterpriseBoardReport() {
  const [board, funder, warehouse, approvals] = await Promise.all([
    buildBoardFinancialReport().catch(() => null),
    buildFunderReports().catch(() => null),
    getWarehouseOverview(),
    buildApprovalQueue(10).catch(() => ({ tasks: [], counts: {} })),
  ]);

  return {
    title: `IFCDC Enterprise Board Report — ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
    executiveSummary: {
      organizationHealth: warehouse.organizationHealth,
      grade: warehouse.grade,
      cashFlow: warehouse.finance?.cashFlow,
      activeGrants: warehouse.grants?.activeAwards,
      programsRunning: warehouse.programs?.programsRunning,
      pendingApprovals: (approvals.counts as { total?: number })?.total ?? 0,
    },
    financial: board,
    grants: funder,
    operationalPriorities: [
      ...(warehouse.grants?.complianceDue ? [`${warehouse.grants.complianceDue} grant compliance reports due`] : []),
      ...(approvals.tasks?.length ? [`${approvals.tasks.length} items awaiting executive approval`] : []),
      "Review program budget utilization across community programs",
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function getAuraModuleInsights() {
  const [warehouse, trends, compliance] = await Promise.all([
    getWarehouseOverview(),
    getWarehouseTrends(undefined, 14),
    trackComplianceDeadlines().catch(() => ({ pending: [], overdue: [] })),
  ]);

  return {
    organization: { health: warehouse.organizationHealth, grade: warehouse.grade },
    finance: warehouse.finance,
    grants: warehouse.grants,
    programs: warehouse.programs,
    people: warehouse.people,
    donations: warehouse.donations,
    trends: trends.trends,
    compliance,
    capabilities: [
      "cross_module_analysis",
      "board_report_generation",
      "compliance_monitoring",
      "operational_priorities",
      "predictive_forecasting",
      "workflow_recommendations",
    ],
    timestamp: new Date().toISOString(),
  };
}
