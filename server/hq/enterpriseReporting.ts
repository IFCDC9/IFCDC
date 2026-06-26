import { getDb } from "../db";
import { buildForm990Preview, buildBoardFinancialReport } from "./financeIntelligence";
import { buildExecutiveReport } from "./analyticsReporting";
import { buildGrantAnalytics, buildGrantExecutiveDashboard } from "./grantReporting";
import { getOrGenerateDailyBriefing } from "./executiveBriefings";
import { buildExecutiveTrendAnalysis } from "./executiveTrends";

export interface ReportDefinition {
  id: string;
  category: "irs" | "funder" | "state" | "internal" | "board" | "annual";
  title: string;
  description: string;
  frequency: string;
  endpoint: string;
}

export const REPORT_CATALOG: ReportDefinition[] = [
  { id: "irs_990", category: "irs", title: "Form 990 Preview", description: "IRS Form 990 draft mapped from General Ledger", frequency: "Annual", endpoint: "/api/hq/reporting/irs/990" },
  { id: "funder_grant", category: "funder", title: "Grant Funder Report", description: "Award utilization, outcomes, and compliance summary for funders", frequency: "Quarterly", endpoint: "/api/hq/reporting/funder/grant" },
  { id: "funder_pipeline", category: "funder", title: "Funding Pipeline Report", description: "Active pipeline, win rate, and projected awards", frequency: "Monthly", endpoint: "/api/hq/reporting/funder/pipeline" },
  { id: "state_annual", category: "state", title: "State Annual Filing", description: "New Jersey nonprofit annual report data package", frequency: "Annual", endpoint: "/api/hq/reporting/state/annual" },
  { id: "state_charitable", category: "state", title: "Charitable Registration", description: "State charitable solicitation registration summary", frequency: "Annual", endpoint: "/api/hq/reporting/state/charitable" },
  { id: "internal_management", category: "internal", title: "Management Dashboard Report", description: "Cross-department KPIs, trends, and operational alerts", frequency: "Monthly", endpoint: "/api/hq/reporting/internal/management" },
  { id: "internal_finance", category: "internal", title: "Financial Operations Report", description: "GL summary, budget variance, and cash position", frequency: "Monthly", endpoint: "/api/hq/reporting/internal/finance" },
  { id: "board_package", category: "board", title: "Board Governance Package", description: "Financial report, executive briefing, and governance summary", frequency: "Quarterly", endpoint: "/api/hq/reporting/board/package" },
  { id: "board_financial", category: "board", title: "Board Financial Report", description: "Board-ready financial statements and forecast", frequency: "Quarterly", endpoint: "/api/hq/reporting/board/financial" },
  { id: "annual_organizational", category: "annual", title: "Annual Organizational Report", description: "Comprehensive annual impact, finance, grants, and programs report", frequency: "Annual", endpoint: "/api/hq/reporting/annual/organizational" },
];

export function getReportCatalog() {
  return { reports: REPORT_CATALOG, generatedAt: new Date().toISOString() };
}

export async function generateIrs990Report() {
  return buildForm990Preview();
}

export async function generateFunderGrantReport(awardId?: string) {
  const db = await getDb();
  const grants = await buildGrantExecutiveDashboard();
  let awardDetail = null;
  if (awardId) {
    awardDetail = await db.get(`
      SELECT aw.*, o.title, o.funder, a.title as application_title
      FROM grant_awards aw
      LEFT JOIN grant_opportunities o ON o.id = aw.opportunity_id
      LEFT JOIN grant_applications a ON a.id = aw.application_id
      WHERE aw.id = ?
    `, awardId);
  }
  const expenditures = awardId
    ? await db.all("SELECT * FROM finance_expenses WHERE grant_id = (SELECT opportunity_id FROM grant_awards WHERE id = ?) ORDER BY expense_date DESC LIMIT 50", awardId)
    : await db.all("SELECT * FROM finance_expenses WHERE grant_id IS NOT NULL ORDER BY expense_date DESC LIMIT 50");

  return {
    title: `Grant Funder Report — ${new Date().toLocaleDateString()}`,
    portfolio: { totalAwarded: grants.totalAwarded, activeAwards: grants.activeAwards, winRate: grants.winRate },
    award: awardDetail,
    expenditures,
    compliance: await db.all("SELECT * FROM grant_compliance WHERE status = 'pending' ORDER BY due_date ASC LIMIT 20"),
    generatedAt: new Date().toISOString(),
  };
}

export async function generateFunderPipelineReport() {
  const grants = await buildGrantExecutiveDashboard();
  const analytics = await buildGrantAnalytics();
  return {
    title: "Funding Pipeline Report",
    pipelineValue: grants.pipelineValue,
    winRate: grants.winRate,
    byFunder: analytics.byFunder,
    monthlyAwards: analytics.monthlyAwards,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateStateAnnualReport() {
  const db = await getDb();
  const [form990, people, programs] = await Promise.all([
    buildForm990Preview(),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM people WHERE status = 'active' AND person_type IN ('employee', 'staff')"),
    db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_program_registry WHERE status = 'active'"),
  ]);
  return {
    title: "State Annual Report Package",
    state: "New Jersey",
    filingType: "Nonprofit Annual Report",
    organization: "Imperial Foundation Community Development Corporation",
    ein: process.env.IFCDC_EIN ?? "XX-XXXXXXX",
    fiscalYear: form990.fiscalYear,
    totalRevenue: form990.partI.totalRevenue,
    totalExpenses: form990.partI.totalExpenses,
    netAssets: form990.partI.netAssets,
    employeeCount: people?.c ?? 0,
    activePrograms: programs?.c ?? 0,
    principalOffice: process.env.IFCDC_ADDRESS ?? "New Jersey",
    status: "draft_preview",
    disclaimer: "Review with legal counsel before state filing",
    generatedAt: new Date().toISOString(),
  };
}

export async function generateStateCharitableReport() {
  const db = await getDb();
  const donations = (await db.get<{ t: number; c: number }>(
    "SELECT COALESCE(SUM(amount_cents), 0) as t, COUNT(*) as c FROM funding_events WHERE intent = 'donation' AND created_at >= date('now', '-365 days')"
  ));
  return {
    title: "Charitable Registration Summary",
    state: "New Jersey",
    grossReceipts: (donations?.t ?? 0) / 100,
    donationCount: donations?.c ?? 0,
    registrationStatus: "active",
    renewalDue: `${new Date().getFullYear()}-11-30`,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateInternalManagementReport() {
  const [report, trends] = await Promise.all([
    buildExecutiveReport("monthly"),
    buildExecutiveTrendAnalysis(),
  ]);
  return {
    title: "Internal Management Report",
    period: "monthly",
    overview: report.overview,
    trends: trends.series,
    activity: report.activity?.slice(0, 20),
    recommendations: report.auraInsight,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateInternalFinanceReport() {
  const board = await buildBoardFinancialReport();
  return { ...board, title: "Internal Financial Operations Report" };
}

export async function generateBoardPackageReport() {
  const [financial, briefing, trends] = await Promise.all([
    buildBoardFinancialReport(),
    getOrGenerateDailyBriefing(),
    buildExecutiveTrendAnalysis(),
  ]);
  return {
    title: `Board Governance Package — ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
    executiveBriefing: briefing,
    financialReport: financial,
    trendAnalysis: trends.summary,
    governanceItems: trends.series.filter((s) => s.status === "watch" || s.status === "negative"),
    generatedAt: new Date().toISOString(),
  };
}

export async function generateAnnualOrganizationalReport() {
  const report = await buildExecutiveReport("annual");
  const trends = await buildExecutiveTrendAnalysis();
  return {
    title: `IFCDC Annual Organizational Report — ${new Date().getFullYear()}`,
    executiveSummary: report.overview,
    finance: report.finance,
    grants: report.grants,
    people: report.people,
    programs: report.programs,
    trendAnalysis: trends,
    impactHighlights: [
      `${report.overview.people.totalPeople} people served across the organization`,
      `$${report.overview.grants.totalAwarded.toLocaleString()} in grant awards`,
      `${report.overview.programs.programsRunning} active community programs`,
    ],
    generatedAt: new Date().toISOString(),
  };
}
