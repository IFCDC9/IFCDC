import { getDb } from "../db";
import { auraExecutiveChat } from "../lib/ifcdc";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import { getGrantFinancialSummary } from "./grantFinanceIntegration";

export async function findGrantOpportunities(criteria: {
  keywords?: string;
  minAmount?: number;
  maxAmount?: number;
  status?: string;
}) {
  const db = await getDb();
  let sql = "SELECT * FROM grant_opportunities WHERE 1=1";
  const params: unknown[] = [];
  if (criteria.status) { sql += " AND status = ?"; params.push(criteria.status); }
  else { sql += " AND status IN ('open', 'active', 'researching')"; }
  if (criteria.keywords) {
    sql += " AND (title LIKE ? OR funder LIKE ? OR description LIKE ?)";
    const q = `%${criteria.keywords}%`;
    params.push(q, q, q);
  }
  if (criteria.minAmount != null) { sql += " AND amount_max >= ?"; params.push(criteria.minAmount); }
  if (criteria.maxAmount != null) { sql += " AND amount_min <= ?"; params.push(criteria.maxAmount); }
  sql += " ORDER BY deadline ASC LIMIT 25";

  const opportunities = await db.all(sql, ...params) as Record<string, unknown>[];
  return opportunities.map((o) => ({
    ...o,
    eligibilityScore: scoreOpportunity(o),
    daysUntilDeadline: o.deadline ? Math.ceil((new Date(String(o.deadline)).getTime() - Date.now()) / 86400000) : null,
  }));
}

function scoreOpportunity(opp: Record<string, unknown>): number {
  let score = 50;
  if (opp.status === "open") score += 20;
  if (opp.amount_max && Number(opp.amount_max) >= 25000) score += 15;
  if (opp.deadline) {
    const days = Math.ceil((new Date(String(opp.deadline)).getTime() - Date.now()) / 86400000);
    if (days > 14 && days < 90) score += 15;
    if (days <= 14) score -= 10;
  }
  if (opp.description && String(opp.description).length > 100) score += 5;
  return Math.min(100, Math.max(0, score));
}

export async function matchGrantEligibility(applicationId: string) {
  const db = await getDb();
  const app = await db.get<{
    id: string; opportunity_id: string | null; title: string; amount_requested: number | null; status: string; notes: string;
  }>("SELECT * FROM grant_applications WHERE id = ?", applicationId);
  if (!app) return null;

  const opp = app.opportunity_id
    ? await db.get("SELECT * FROM grant_opportunities WHERE id = ?", app.opportunity_id)
    : null;

  const factors = [];
  let score = 40;
  if (opp) {
    factors.push({ factor: "Linked opportunity", match: true, detail: String((opp as { title: string }).title) });
    score += 25;
    if (app.amount_requested && (opp as { amount_max: number }).amount_max >= app.amount_requested) {
      factors.push({ factor: "Amount within range", match: true, detail: `Requested $${app.amount_requested.toLocaleString()}` });
      score += 15;
    }
    if ((opp as { deadline: string }).deadline) {
      const days = Math.ceil((new Date(String((opp as { deadline: string }).deadline)).getTime() - Date.now()) / 86400000);
      factors.push({ factor: "Deadline window", match: days > 0, detail: `${days} days remaining` });
      if (days > 0) score += 10;
    }
  } else {
    factors.push({ factor: "Opportunity linked", match: false, detail: "Link an opportunity for full eligibility scoring" });
  }
  if (app.status === "submitted" || app.status === "under_review") {
    factors.push({ factor: "Submission status", match: true, detail: app.status });
    score += 10;
  }

  return { applicationId, score: Math.min(100, score), factors, recommendation: score >= 70 ? "Strong match" : score >= 50 ? "Moderate — review requirements" : "Needs preparation" };
}

export async function grantWritingAssist(opts: {
  prompt: string;
  applicationId?: string;
  opportunityId?: string;
  section?: string;
}): Promise<string> {
  const db = await getDb();
  let context = await buildAuraExecutiveContext();

  if (opts.applicationId) {
    const app = await db.get("SELECT * FROM grant_applications WHERE id = ?", opts.applicationId);
    if (app) context += `\n\nApplication:\n${JSON.stringify(app, null, 2)}`;
  }
  if (opts.opportunityId) {
    const opp = await db.get("SELECT * FROM grant_opportunities WHERE id = ?", opts.opportunityId);
    if (opp) context += `\n\nOpportunity:\n${JSON.stringify(opp, null, 2)}`;
  }

  const section = opts.section ? `Focus on the ${opts.section} section. ` : "";
  return auraExecutiveChat(
    `${section}${opts.prompt}\n\nWrite in professional grant narrative style suitable for a community development nonprofit.`,
    context
  );
}

export async function generateGrantOutcomeReport(awardId: string): Promise<string> {
  const summary = await getGrantFinancialSummary(awardId);
  const context = await buildAuraExecutiveContext(
    `\nGrant financial summary:\n${JSON.stringify(summary, null, 2)}`
  );
  return auraExecutiveChat(
    "Generate a grant outcome and impact report including: award summary, budget utilization, program outcomes, compliance status, and recommendations for renewal.",
    context
  );
}
