import { getDb } from "../db";
import { auraExecutiveChat } from "../lib/ifcdc";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import {
  buildSafeAnalyticsOverview,
  buildFinanceAnalytics,
  buildOrganizationHealthScore,
} from "./analyticsReporting";
import { buildGrantExecutiveDashboard } from "./grantReporting";
import { buildOperationsOverview } from "./operationsSchema";
import { buildExecutiveTrendAnalysis } from "./executiveTrends";
import { getOrGenerateDailyBriefing } from "./executiveBriefings";

export interface AnomalyAlert {
  module: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  metric?: string;
  value?: number;
}

export async function detectOperationalAnomalies(): Promise<{ anomalies: AnomalyAlert[]; scannedAt: string }> {
  const [overview, finance, grants, health, ops, db] = await Promise.all([
    buildSafeAnalyticsOverview(),
    buildFinanceAnalytics(),
    buildGrantExecutiveDashboard(),
    buildOrganizationHealthScore(),
    buildOperationsOverview().catch(() => null),
    getDb(),
  ]);

  const anomalies: AnomalyAlert[] = [];

  if (finance.cashFlow < 0) {
    anomalies.push({
      module: "finance",
      severity: "high",
      title: "Negative cash flow",
      detail: `Cash flow is ${finance.cashFlow.toLocaleString()} — review expenses and revenue pipeline`,
      metric: "cashFlow",
      value: finance.cashFlow,
    });
  }

  const monthly = finance.monthlyTrend ?? [];
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    if (last.expenses > prev.expenses * 1.25) {
      anomalies.push({
        module: "finance",
        severity: "medium",
        title: "Expense spike detected",
        detail: `Monthly expenses increased ${Math.round(((last.expenses - prev.expenses) / prev.expenses) * 100)}% vs prior month`,
        metric: "expenses",
        value: last.expenses,
      });
    }
  }

  if (grants.complianceDue > 0) {
    anomalies.push({
      module: "grants",
      severity: grants.complianceDue > 3 ? "high" : "medium",
      title: "Grant compliance deadlines approaching",
      detail: `${grants.complianceDue} compliance item(s) due within 14 days`,
      metric: "complianceDue",
      value: grants.complianceDue,
    });
  }

  if (health.overall < 60) {
    anomalies.push({
      module: "executive",
      severity: "high",
      title: "Organization health below threshold",
      detail: `Health score ${health.overall}% (${health.grade}) — review factor breakdown`,
      metric: "healthScore",
      value: health.overall,
    });
  }

  if (ops && ops.compliance.highRisks > 0) {
    anomalies.push({
      module: "operations",
      severity: "high",
      title: "High-severity compliance risks",
      detail: `${ops.compliance.highRisks} high-risk item(s) in compliance register`,
    });
  }

  if (ops && ops.fleet.maintenanceDue > 0) {
    anomalies.push({
      module: "operations",
      severity: "low",
      title: "Fleet maintenance overdue",
      detail: `${ops.fleet.maintenanceDue} vehicle(s) require service`,
    });
  }

  const overdueInvoices = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM finance_invoices WHERE status IN ('overdue', 'sent') AND due_date < date('now')"
  ))?.c ?? 0;
  if (overdueInvoices > 0) {
    anomalies.push({
      module: "finance",
      severity: "medium",
      title: "Overdue invoices",
      detail: `${overdueInvoices} invoice(s) past due date`,
      metric: "overdueInvoices",
      value: overdueInvoices,
    });
  }

  const pendingLeave = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM leave_requests WHERE status = 'pending'"))?.c ?? 0;
  if (pendingLeave > 5) {
    anomalies.push({
      module: "hr",
      severity: "low",
      title: "Leave request backlog",
      detail: `${pendingLeave} pending leave requests awaiting approval`,
    });
  }

  if (overview.software.healthy < overview.software.total) {
    anomalies.push({
      module: "software",
      severity: "medium",
      title: "Software division health degraded",
      detail: `${overview.software.healthy}/${overview.software.total} apps reporting healthy`,
    });
  }

  return { anomalies, scannedAt: new Date().toISOString() };
}

export async function predictFinancialRisk() {
  const [finance, trends, grants, anomalies] = await Promise.all([
    buildFinanceAnalytics(),
    buildExecutiveTrendAnalysis(),
    buildGrantExecutiveDashboard(),
    detectOperationalAnomalies(),
  ]);

  const riskFactors = [];
  let riskScore = 20;

  if (finance.cashFlow < 0) { riskScore += 25; riskFactors.push("Negative cash flow"); }
  if (finance.budgetRemaining < finance.operatingBudget * 0.15) { riskScore += 20; riskFactors.push("Budget nearly exhausted"); }
  const expenseTrend = trends.series.find((s) => s.metric === "Monthly Expenses");
  if (expenseTrend?.direction === "up" && expenseTrend.changePct > 10) {
    riskScore += 15;
    riskFactors.push("Rising expense trend");
  }
  if (grants.complianceDue > 2) { riskScore += 10; riskFactors.push("Grant compliance pressure"); }
  if (anomalies.anomalies.filter((a) => a.severity === "high").length > 0) {
    riskScore += 15;
    riskFactors.push("Active high-severity anomalies");
  }

  riskScore = Math.min(100, riskScore);
  const level = riskScore >= 70 ? "high" : riskScore >= 45 ? "moderate" : "low";

  const recommendations = [];
  if (level === "high") {
    recommendations.push("Freeze non-essential spending until cash position stabilizes");
    recommendations.push("Accelerate grant submissions and donor outreach");
    recommendations.push("Review payroll and program burn rates with department heads");
  } else if (level === "moderate") {
    recommendations.push("Monitor monthly expense variance closely");
    recommendations.push("Ensure grant compliance reports are submitted on schedule");
  } else {
    recommendations.push("Maintain current reserve targets");
    recommendations.push("Continue multi-year budget planning");
  }

  return {
    riskScore,
    riskLevel: level,
    factors: riskFactors,
    recommendations,
    cashFlow: finance.cashFlow,
    budgetRemaining: finance.budgetRemaining,
    projectedCashFlow: trends.forecast?.[0]?.projectedCashFlow ?? finance.cashFlow,
    generatedAt: new Date().toISOString(),
  };
}

export async function trackComplianceDeadlines() {
  const db = await getDb();
  const [grants, policies, risks, certifications] = await Promise.all([
    db.all(`
      SELECT gc.*, aw.amount, o.title as grant_title
      FROM grant_compliance gc
      LEFT JOIN grant_awards aw ON aw.id = gc.award_id
      LEFT JOIN grant_opportunities o ON o.id = aw.opportunity_id
      WHERE gc.status = 'pending' ORDER BY gc.due_date ASC LIMIT 30
    `),
    db.all("SELECT * FROM compliance_policies WHERE review_date <= date('now', '+60 days') AND status = 'active' ORDER BY review_date ASC"),
    db.all("SELECT * FROM compliance_risks WHERE status = 'open' ORDER BY risk_level DESC LIMIT 20"),
    db.all(`
      SELECT pc.*, p.first_name, p.last_name
      FROM people_certifications pc JOIN people p ON p.id = pc.person_id
      WHERE pc.expiry_date <= date('now', '+60 days') ORDER BY pc.expiry_date ASC LIMIT 20
    `).catch(() => []),
  ]);

  const deadlines = [
    ...(grants as { due_date: string; report_type: string; grant_title: string }[]).map((g) => ({
      type: "grant_compliance",
      title: g.grant_title ?? "Grant report",
      detail: g.report_type,
      dueDate: g.due_date,
      severity: new Date(g.due_date) <= new Date(Date.now() + 14 * 86400000) ? "high" : "medium",
    })),
    ...(policies as { title: string; review_date: string }[]).map((p) => ({
      type: "policy_review",
      title: p.title,
      detail: "Policy review due",
      dueDate: p.review_date,
      severity: "medium",
    })),
    ...(certifications as { name: string; expiry_date: string; first_name: string; last_name: string }[]).map((c) => ({
      type: "certification",
      title: `${c.first_name} ${c.last_name} — ${c.name}`,
      detail: "Certification expiring",
      dueDate: c.expiry_date,
      severity: "medium",
    })),
  ].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  return {
    totalDue: deadlines.length,
    overdue: deadlines.filter((d) => new Date(d.dueDate) < new Date()).length,
    dueNext14Days: deadlines.filter((d) => {
      const days = (new Date(d.dueDate).getTime() - Date.now()) / 86400000;
      return days >= 0 && days <= 14;
    }).length,
    deadlines,
    openRisks: risks,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateAuraExecutiveSummary(): Promise<string> {
  const [briefing, anomalies, risk, compliance] = await Promise.all([
    getOrGenerateDailyBriefing(),
    detectOperationalAnomalies(),
    predictFinancialRisk(),
    trackComplianceDeadlines(),
  ]);
  const context = await buildAuraExecutiveContext(
    `\nDaily briefing highlights:\n${briefing.highlights.join("\n")}\n\nAnomalies:\n${JSON.stringify(anomalies.anomalies.slice(0, 5))}\n\nFinancial risk: ${risk.riskLevel} (${risk.riskScore}/100)\n\nCompliance deadlines: ${compliance.dueNext14Days} due in 14 days`
  );
  try {
    return await auraExecutiveChat(
      "Generate a concise executive summary for the IFCDC founder covering: top 3 priorities today, financial risk posture, compliance deadlines, and recommended actions. Use bullet points.",
      context
    );
  } catch {
    return [
      "## Executive Summary",
      briefing.highlights.slice(0, 4).map((h) => `- ${h}`).join("\n"),
      `\nFinancial Risk: ${risk.riskLevel} (${risk.riskScore}/100)`,
      `Compliance: ${compliance.dueNext14Days} items due within 14 days`,
      `Anomalies: ${anomalies.anomalies.length} detected (${anomalies.anomalies.filter((a) => a.severity === "high").length} high severity)`,
    ].join("\n");
  }
}
