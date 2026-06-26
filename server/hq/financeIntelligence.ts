import { getDb } from "../db";
import { buildFinancialStatements, buildExecutiveDashboard } from "./financeReporting";
import { buildPredictiveTrends, buildFinanceAnalytics } from "./analyticsReporting";

export async function buildFinanceForecast() {
  const [trends, finance, dashboard] = await Promise.all([
    buildPredictiveTrends(),
    buildFinanceAnalytics(),
    buildExecutiveDashboard(),
  ]);
  const db = await getDb();

  const departmentBudgets = await db.all(`
    SELECT COALESCE(d.name, 'Unassigned') as department, SUM(fb.allocated) as allocated, SUM(fb.spent) as spent
    FROM finance_budgets fb LEFT JOIN departments d ON d.id = fb.department_id
    GROUP BY fb.department_id ORDER BY allocated DESC
  `);

  const programBudgets = await db.all(`
    SELECT COALESCE(fb.program_slug, fb.name) as program, fb.allocated, fb.spent, fb.category
    FROM finance_budgets fb WHERE fb.category = 'programs' OR fb.program_slug IS NOT NULL
    ORDER BY fb.allocated DESC LIMIT 12
  `);

  const grantBudgets = await db.all(`
    SELECT COALESCE(gb.name, 'Grant Budget') as name, gb.allocated, gb.spent, gb.grant_id
    FROM finance_budgets gb WHERE gb.grant_id IS NOT NULL OR gb.category = 'grants'
    ORDER BY gb.allocated DESC LIMIT 12
  `);

  return {
    cashFlowForecast: trends.forecast,
    trend: trends.trend,
    projectedCashFlow: trends.projectedCashFlow,
    projectedDonations: trends.projectedDonations,
    projectedExpenses: trends.projectedExpenses,
    monthlyTrend: finance.monthlyTrend,
    currentCashFlow: dashboard.cashFlow,
    budgetRemaining: dashboard.budgetRemaining,
    departmentBudgets,
    programBudgets,
    grantBudgets,
    timestamp: new Date().toISOString(),
  };
}

export async function buildMultiYearBudget(years = 3) {
  const db = await getDb();
  const currentYear = new Date().getFullYear();
  const baseAllocated = (await db.get<{ t: number }>("SELECT COALESCE(SUM(allocated), 0) as t FROM finance_budgets"))?.t ?? 0;
  const baseSpent = (await db.get<{ t: number }>("SELECT COALESCE(SUM(spent), 0) as t FROM finance_budgets"))?.t ?? 0;
  const donationAvg = (await buildFinanceAnalytics()).monthlyTrend.slice(-6);
  const avgDonations = donationAvg.reduce((s, m) => s + m.donations, 0) / Math.max(donationAvg.length, 1);

  const projections = [];
  for (let i = 0; i < years; i++) {
    const year = currentYear + i;
    const growth = 1 + i * 0.03;
    projections.push({
      fiscalYear: String(year),
      projectedRevenue: Math.round(avgDonations * 12 * growth),
      projectedExpenses: Math.round(baseSpent * growth * (i === 0 ? 1 : 1.05 ** i)),
      budgetAllocated: Math.round(baseAllocated * growth),
      projectedSurplus: Math.round(avgDonations * 12 * growth - baseSpent * growth),
    });
  }

  return { projections, baseYear: currentYear, assumptions: "3% annual growth on revenue and budget allocations" };
}

export async function buildForm990Preview() {
  const [statements, dashboard] = await Promise.all([
    buildFinancialStatements(),
    buildExecutiveDashboard(),
  ]);
  const db = await getDb();
  const fiscalYear = String(new Date().getFullYear());

  const programExpenses = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM finance_expenses WHERE category IN ('programs', 'operations')`
  ))?.t ?? 0;
  const mgmtExpenses = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM finance_expenses WHERE category IN ('administration', 'operations')`
  ))?.t ?? 0;
  const fundraisingExpenses = (await db.get<{ t: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) as t FROM finance_expenses WHERE category = 'fundraising'`
  ))?.t ?? 0;

  const totalExpenses = statements.incomeStatement.totalExpenses;
  const totalRevenue = statements.incomeStatement.totalRevenue;

  return {
    fiscalYear,
    organization: "Imperial Foundation Community Development Corporation",
    ein: process.env.IFCDC_EIN ?? "XX-XXXXXXX",
    partI: {
      mission: "Community development, housing, youth programs, and economic empowerment",
      totalRevenue,
      totalExpenses,
      netAssets: statements.balanceSheet.totalEquity,
    },
    partVIII: {
      contributions: dashboard.donationsReceived,
      grants: dashboard.grantRevenue,
      totalRevenue,
    },
    partIX: {
      programServices: programExpenses / 100,
      managementGeneral: mgmtExpenses / 100,
      fundraising: fundraisingExpenses / 100,
      totalExpenses,
    },
    partX: {
      totalAssets: statements.balanceSheet.totalAssets,
      totalLiabilities: statements.balanceSheet.totalLiabilities,
      netAssets: statements.balanceSheet.totalEquity,
    },
    functionalExpenseRatio: totalExpenses > 0 ? Math.round((programExpenses / 100 / totalExpenses) * 100) : 0,
    status: "draft_preview",
    disclaimer: "Preview mapped from General Ledger — review with CPA before IRS filing",
    generatedAt: new Date().toISOString(),
  };
}

export async function buildBoardFinancialReport() {
  const [statements, dashboard, forecast] = await Promise.all([
    buildFinancialStatements(),
    buildExecutiveDashboard(),
    buildFinanceForecast(),
  ]);

  return {
    title: `Board Financial Report — ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
    executiveSummary: {
      financialHealthScore: dashboard.financialHealthScore,
      netPosition: dashboard.netPosition,
      cashFlow: dashboard.cashFlow,
      budgetRemaining: dashboard.budgetRemaining,
      grantRevenue: dashboard.grantRevenue,
      donationsReceived: dashboard.donationsReceived,
    },
    incomeStatement: statements.incomeStatement,
    balanceSheet: statements.balanceSheet,
    cashFlowStatement: statements.cashFlow,
    forecast: {
      trend: forecast.trend,
      sixMonth: forecast.cashFlowForecast,
    },
    departmentBudgets: forecast.departmentBudgets,
    recommendations: dashboard.cashFlow < 0
      ? ["Review discretionary spending", "Accelerate grant submissions", "Monitor program burn rates"]
      : ["Maintain reserve targets", "Continue grant compliance schedule", "Review multi-year capital plan"],
    generatedAt: new Date().toISOString(),
  };
}
