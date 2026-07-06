/**
 * Grant Intelligence Engine — unified discovery, matching, scoring, drafting, and AURA advisory.
 */
import { getDb } from "../db";
import { grantId, logGrantActivity } from "./grantsSchema";
import { auraExecutiveChat } from "../lib/ifcdc";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import { syncGrantFeeds } from "./grantFeedConnectors";
import {
  IFCDC_FUNDING_DIVISIONS,
  ensureApplicationWorkflow,
} from "./grantFundingEngine";
import { scoreGrantOpportunityV5 } from "./grantFundingEngineV5";
import {
  seedWriterSectionsForApplication,
  assistWriterSection,
  updateWriterSection,
} from "./grantCenterEngine";
import { buildGrantExecutiveDashboard } from "./grantReporting";
import { productionGrantOpportunitySqlFilter } from "./grantProductionPolicy";

const SYNC_INTERVAL_MS = 6 * 60 * 60_000;
let syncTimer: ReturnType<typeof setInterval> | null = null;

/** IFCDC mission keywords — used to tag and filter Grants.gov imports. */
export const IFCDC_MISSION_KEYWORDS = [
  "community development",
  "nonprofit",
  "housing",
  "transitional housing",
  "homeless",
  "youth",
  "mentorship",
  "violence prevention",
  "gang",
  "scholarship",
  "education",
  "workforce",
  "economic development",
  "small business",
  "mental health",
  "disadvantaged",
  "underserved",
  "minority",
  "low-income",
  "job training",
  "media",
  "arts",
  "radio",
  "technology",
];

/** Extended program catalog for matching (divisions + HQ registry). */
export const IFCDC_PROGRAM_CATALOG = IFCDC_FUNDING_DIVISIONS.map((d) => ({
  slug: d.slug,
  label: d.label,
  programs: [...d.programs],
  keywords: [...d.programs, d.slug.replace(/_/g, " "), d.label.toLowerCase()],
}));

function parseJsonArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function textBlob(opp: Record<string, unknown>): string {
  return [opp.title, opp.funder, opp.description, opp.eligibility, opp.requirements, opp.match_tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Infer division + program tags from opportunity text. */
export function inferProgramMatches(opp: Record<string, unknown>): {
  divisionSlugs: string[];
  programAreas: string[];
  matchScore: number;
} {
  const blob = textBlob(opp);
  const divisionSlugs = new Set<string>();
  const programAreas = new Set<string>();
  let hits = 0;

  for (const prog of IFCDC_PROGRAM_CATALOG) {
    const matched = prog.keywords.some((kw) => blob.includes(kw.toLowerCase()));
    if (matched) {
      divisionSlugs.add(prog.slug);
      prog.programs.forEach((p) => programAreas.add(p));
      hits++;
    }
  }

  for (const kw of IFCDC_MISSION_KEYWORDS) {
    if (blob.includes(kw.toLowerCase())) hits += 0.25;
  }

  const matchScore = Math.min(100, Math.round(40 + hits * 12));
  return {
    divisionSlugs: Array.from(divisionSlugs),
    programAreas: Array.from(programAreas),
    matchScore,
  };
}

export async function enrichOpportunityPrograms(opportunityId: string): Promise<void> {
  const db = await getDb();
  const opp = await db.get<Record<string, unknown>>("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId);
  if (!opp) return;

  const inferred = inferProgramMatches(opp);
  const existingDivisions = parseJsonArray(opp.division_slugs);
  const existingPrograms = parseJsonArray(opp.program_areas);
  const mergedDivisions = Array.from(new Set([...existingDivisions, ...inferred.divisionSlugs]));
  const mergedPrograms = Array.from(new Set([...existingPrograms, ...inferred.programAreas]));

  if (mergedDivisions.length === existingDivisions.length && mergedPrograms.length === existingPrograms.length) return;

  await db.run(
    `UPDATE grant_opportunities SET division_slugs = ?, program_areas = ?, updated_at = ? WHERE id = ?`,
    JSON.stringify(mergedDivisions),
    JSON.stringify(mergedPrograms),
    new Date().toISOString(),
    opportunityId
  );
}

export async function enrichAllOpportunities(limit = 200): Promise<number> {
  const db = await getDb();
  const rows = (await db.all(
    `SELECT id FROM grant_opportunities WHERE status IN ('open','active','researching')${productionGrantOpportunitySqlFilter()}
     ORDER BY updated_at DESC LIMIT ?`,
    limit
  )) as { id: string }[];

  let count = 0;
  for (const row of rows) {
    await enrichOpportunityPrograms(row.id);
    count++;
  }
  return count;
}

export type OpportunityIntelligenceScore = {
  opportunityId: string;
  eligibility: number;
  eligibilityGrade: string;
  strategicFit: number;
  composite: number;
  awardProbability: number;
  priority: "high" | "medium" | "low";
  fundingAmount: { min: number | null; max: number | null };
  deadline: string | null;
  daysUntilDeadline: number | null;
  requiredAttachments: string[];
  estimatedEffort: "low" | "medium" | "high";
  matchedPrograms: { slug: string; label: string; score: number }[];
  factors: { label: string; value: string }[];
};

function parseAttachments(requirements: string | null | undefined): string[] {
  if (!requirements?.trim()) {
    return ["Project narrative", "Budget justification", "IRS determination letter", "Board roster", "Logic model"];
  }
  const items = requirements
    .split(/[,;\n•]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  return items.length ? items.slice(0, 12) : ["See funder requirements in opportunity record"];
}

function estimateEffort(opp: Record<string, unknown>, composite: number): "low" | "medium" | "high" {
  const funderType = String(opp.funder_type ?? "").toLowerCase();
  const amount = Number(opp.amount_max ?? 0);
  if (funderType === "federal" || amount >= 250000) return "high";
  if (amount >= 75000 || composite >= 70) return "medium";
  return "low";
}

function priorityFromScore(composite: number, days: number | null): "high" | "medium" | "low" {
  if (composite >= 75 && (days == null || days > 14)) return "high";
  if (composite >= 55 && (days == null || days > 7)) return "medium";
  return "low";
}

/** Full intelligence score for one opportunity. */
export async function scoreOpportunityIntelligence(
  opportunityId: string,
  opts?: { divisionSlug?: string; actorEmail?: string }
): Promise<OpportunityIntelligenceScore | null> {
  await enrichOpportunityPrograms(opportunityId);

  const v5 = await scoreGrantOpportunityV5(opportunityId, {
    divisionSlug: opts?.divisionSlug,
    actorEmail: opts?.actorEmail,
  });
  if (!v5) return null;

  const db = await getDb();
  const opp = await db.get<Record<string, unknown>>("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId);
  if (!opp) return null;

  const composite = v5.scores.composite;
  const days = opp.deadline
    ? Math.ceil((new Date(String(opp.deadline)).getTime() - Date.now()) / 86400000)
    : null;

  const inferred = inferProgramMatches(opp);
  const matchedPrograms = IFCDC_PROGRAM_CATALOG.filter((p) => inferred.divisionSlugs.includes(p.slug)).map((p) => ({
    slug: p.slug,
    label: p.label,
    score: Math.round((v5.eligibilityScore + v5.strategicFitScore) / 2),
  }));

  return {
    opportunityId,
    eligibility: v5.eligibilityScore,
    eligibilityGrade:
      v5.eligibilityScore >= 90 ? "Excellent Match"
      : v5.eligibilityScore >= 75 ? "Strong Match"
      : v5.eligibilityScore >= 60 ? "Moderate Match"
      : v5.eligibilityScore >= 45 ? "Stretch Opportunity"
      : "Low Match",
    strategicFit: v5.strategicFitScore,
    composite,
    awardProbability: v5.scores.awardProbability,
    priority: priorityFromScore(composite, days),
    fundingAmount: {
      min: opp.amount_min != null ? Number(opp.amount_min) : null,
      max: opp.amount_max != null ? Number(opp.amount_max) : null,
    },
    deadline: opp.deadline ? String(opp.deadline) : null,
    daysUntilDeadline: days,
    requiredAttachments: parseAttachments(String(opp.requirements ?? "")),
    estimatedEffort: estimateEffort(opp, composite),
    matchedPrograms,
    factors: [
      { label: "Eligibility", value: `${v5.eligibilityScore}%` },
      { label: "Strategic fit", value: `${v5.strategicFitScore}%` },
      { label: "Deadline urgency", value: `${v5.scores.deadline}%` },
      { label: "Award size", value: `${v5.scores.awardSize}%` },
      { label: "Competitiveness", value: `${v5.scores.competitiveness}%` },
    ],
  };
}

export async function matchOpportunitiesForProgram(programSlug: string, limit = 25) {
  const db = await getDb();
  const catalog = IFCDC_PROGRAM_CATALOG.find((p) => p.slug === programSlug);
  const like = `%${programSlug}%`;
  const rows = (await db.all(
    `SELECT o.* FROM grant_opportunities o
     WHERE o.status IN ('open','active','researching')${productionGrantOpportunitySqlFilter("o")}
       AND (o.division_slugs LIKE ? OR o.program_areas LIKE ? OR o.title LIKE ? OR o.description LIKE ?)
     ORDER BY o.deadline ASC LIMIT ?`,
    like,
    like,
    like,
    like,
    limit * 2
  )) as Record<string, unknown>[];

  const scored = await Promise.all(
    rows.slice(0, limit).map(async (row) => {
      const id = String(row.id);
      await enrichOpportunityPrograms(id);
      const intel = await scoreOpportunityIntelligence(id, { divisionSlug: programSlug });
      return { ...row, intelligence: intel };
    })
  );

  return {
    programSlug,
    programLabel: catalog?.label ?? programSlug,
    matches: scored.sort((a, b) => (b.intelligence?.composite ?? 0) - (a.intelligence?.composite ?? 0)),
    generatedAt: new Date().toISOString(),
  };
}

/** Live feed — newly synced + mission-relevant opportunities. */
export async function getLiveOpportunityFeed(opts?: { sinceHours?: number; limit?: number }) {
  const sinceHours = opts?.sinceHours ?? 72;
  const limit = opts?.limit ?? 40;
  const cutoff = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const db = await getDb();

  const rows = (await db.all(
    `SELECT o.*,
      (SELECT composite_score FROM grant_opportunity_scores WHERE opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) as composite_score
     FROM grant_opportunities o
     WHERE o.status IN ('open','active','researching')${productionGrantOpportunitySqlFilter("o")}
       AND (o.created_at >= ? OR o.updated_at >= ?)
     ORDER BY o.updated_at DESC LIMIT ?`,
    cutoff,
    cutoff,
    limit
  )) as Record<string, unknown>[];

  const feed = await Promise.all(
    rows.map(async (row) => {
      const inferred = inferProgramMatches(row);
      return {
        ...row,
        division_slugs: parseJsonArray(row.division_slugs).length ? parseJsonArray(row.division_slugs) : inferred.divisionSlugs,
        program_areas: parseJsonArray(row.program_areas).length ? parseJsonArray(row.program_areas) : inferred.programAreas,
        missionRelevant: inferred.matchScore >= 52,
        compositeScore: row.composite_score != null ? Number(row.composite_score) : inferred.matchScore,
      };
    })
  );

  const syncRow = await db.get<{ last_sync_at: string }>(
    "SELECT last_sync_at FROM grant_feed_sync WHERE provider = 'grants_gov'"
  );

  return {
    opportunities: feed.filter((o) => o.missionRelevant),
    allRecent: feed,
    lastGrantsGovSync: syncRow?.last_sync_at ?? null,
    generatedAt: new Date().toISOString(),
  };
}

/** Real-time grant dashboard aggregates. */
export async function buildGrantIntelligenceDashboard() {
  const [dash, feed, db] = await Promise.all([
    buildGrantExecutiveDashboard(),
    getLiveOpportunityFeed({ sinceHours: 168, limit: 20 }),
    getDb(),
  ]);

  const pipeline = await db.all(`
    SELECT status, COUNT(*) as count, COALESCE(SUM(amount_requested), 0) as value
    FROM grant_applications GROUP BY status
  `) as { status: string; count: number; value: number }[];

  const writing = (pipeline.find((p) => p.status === "draft")?.count ?? 0) +
    (pipeline.find((p) => p.status === "under_review")?.count ?? 0);
  const submitted = pipeline.find((p) => p.status === "submitted")?.count ?? 0;
  const awarded = pipeline.find((p) => p.status === "awarded")?.count ?? 0;
  const denied = pipeline.find((p) => p.status === "denied")?.count ?? 0;

  const totalPipeline = pipeline.reduce((s, p) => s + Number(p.value), 0);
  const secured = (await db.get<{ t: number }>("SELECT COALESCE(SUM(amount), 0) as t FROM grant_awards WHERE status = 'active'"))?.t ?? 0;

  return {
    summary: {
      newOpportunities: feed.opportunities.length,
      grantsBeingWritten: writing,
      drafts: pipeline.find((p) => p.status === "draft")?.count ?? 0,
      submitted,
      awards: awarded,
      rejections: denied,
      totalPipelineValue: totalPipeline,
      totalFundingSecured: secured,
      openOpportunities: dash.openOpportunities,
      upcomingDeadlines: dash.upcomingDeadlines,
    },
    liveFeed: feed.opportunities.slice(0, 10),
    pipeline,
    programs: IFCDC_PROGRAM_CATALOG.map((p) => ({ slug: p.slug, label: p.label })),
    lastSync: feed.lastGrantsGovSync,
    generatedAt: new Date().toISOString(),
  };
}

/** One-click workflow: review → draft shell → score → writer sections. Human must approve before submit. */
export async function startGrantApplicationWorkflow(
  opportunityId: string,
  opts?: { actorEmail?: string; generateDrafts?: boolean }
) {
  const db = await getDb();
  const opp = await db.get<Record<string, unknown>>("SELECT * FROM grant_opportunities WHERE id = ?", opportunityId);
  if (!opp) return { ok: false, error: "Opportunity not found" };

  const existing = await db.get<{ id: string }>(
    "SELECT id FROM grant_applications WHERE opportunity_id = ? AND status NOT IN ('denied','withdrawn') ORDER BY created_at DESC LIMIT 1",
    opportunityId
  );
  if (existing) {
    const intel = await scoreOpportunityIntelligence(opportunityId, { actorEmail: opts?.actorEmail });
    await seedWriterSectionsForApplication(existing.id);
    return {
      ok: true,
      applicationId: existing.id,
      existing: true,
      intelligence: intel,
      message: "Existing draft application resumed — human review required before federal submission.",
    };
  }

  const intel = await scoreOpportunityIntelligence(opportunityId, { actorEmail: opts?.actorEmail });
  const now = new Date().toISOString();
  const appId = grantId();
  const title = `Application: ${String(opp.title)}`;

  await db.run(
    `INSERT INTO grant_applications (id, opportunity_id, title, status, amount_requested, assigned_to, notes, workflow_stage, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, 'intake', ?, ?)`,
    appId,
    opportunityId,
    title,
    opp.amount_max != null ? Number(opp.amount_max) : null,
    opts?.actorEmail ?? "",
    "Created via Grant Intelligence Engine — requires human review before submission.",
    now,
    now
  );

  await ensureApplicationWorkflow(appId);
  const sections = await seedWriterSectionsForApplication(appId);

  const attachments = parseAttachments(String(opp.requirements ?? ""));
  const checklist = attachments.map((a, i) => `${i + 1}. ${a}`).join("\n");
  await updateWriterSection(appId, "attachments_checklist", checklist, { email: opts?.actorEmail });

  if (opts?.generateDrafts) {
    await generateFullProposalDraft(appId, { actorEmail: opts?.actorEmail, sections: ["executive_summary", "need_statement"] });
  }

  await logGrantActivity("application", appId, "intelligence_workflow_started", title, opts?.actorEmail);
  await db.run(
    `UPDATE grant_opportunities SET funding_status = 'reviewing', lifecycle_stage = 'application_prep', updated_at = ? WHERE id = ?`,
    now,
    opportunityId
  );

  return {
    ok: true,
    applicationId: appId,
    existing: false,
    intelligence: intel,
    writerSections: sections,
    humanReviewRequired: true,
    message: "Application draft created. Review all sections before submitting to the funder.",
  };
}

const FULL_DRAFT_SECTIONS = [
  "executive_summary",
  "need_statement",
  "project_description",
  "goals_objectives",
  "methods",
  "evaluation",
  "sustainability",
  "organizational_capacity",
  "budget_narrative",
] as const;

/** Generate all proposal sections via AURA (saved to writer studio). */
export async function generateFullProposalDraft(
  applicationId: string,
  opts?: { actorEmail?: string; sections?: string[] }
) {
  const sectionKeys = opts?.sections ?? [...FULL_DRAFT_SECTIONS];
  const results: { section: string; ok: boolean; wordCount?: number }[] = [];

  for (const key of sectionKeys) {
    try {
      const draft = await assistWriterSection(applicationId, key);
      const content = String((draft as { content?: string; narrative?: string }).content ?? (draft as { narrative?: string }).narrative ?? "");
      if (content.trim()) {
        await updateWriterSection(applicationId, key, content, { email: opts?.actorEmail });
        results.push({ section: key, ok: true, wordCount: content.split(/\s+/).length });
      } else {
        results.push({ section: key, ok: false });
      }
    } catch {
      results.push({ section: key, ok: false });
    }
  }

  return {
    applicationId,
    sections: results,
    completed: results.filter((r) => r.ok).length,
    total: sectionKeys.length,
    humanReviewRequired: true,
    generatedAt: new Date().toISOString(),
  };
}

/** Natural-language grant advisor for AURA. */
export async function askGrantAura(question: string, opts?: { actorEmail?: string }) {
  const q = question.trim().toLowerCase();
  const [dashboard, context] = await Promise.all([
    buildGrantIntelligenceDashboard(),
    buildAuraExecutiveContext(),
  ]);

  let structured = "";
  if (/available today|new grant|what grant/.test(q)) {
    structured = JSON.stringify(dashboard.liveFeed.slice(0, 8), null, 2);
  } else if (/transitional housing|housing program/.test(q)) {
    const match = await matchOpportunitiesForProgram("housing", 8);
    structured = JSON.stringify(match.matches.slice(0, 5), null, 2);
  } else if (/due this month|deadline/.test(q)) {
    const db = await getDb();
    const monthEnd = new Date();
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    const rows = await db.all(
      `SELECT title, funder, deadline, amount_max FROM grant_opportunities
       WHERE status IN ('open','active') AND deadline IS NOT NULL AND deadline <= ?
       ORDER BY deadline ASC LIMIT 15`,
      monthEnd.toISOString().slice(0, 10)
    );
    structured = JSON.stringify(rows, null, 2);
  } else if (/pipeline|funding secured|how much/.test(q)) {
    structured = JSON.stringify(dashboard.summary, null, 2);
  }

  const prompt = `${question}\n\nUse the structured grant intelligence data below. Be specific and actionable. Remind the user that all federal submissions require human review.\n\nData:\n${structured || JSON.stringify(dashboard.summary, null, 2)}`;

  let answer: string;
  let offline = false;
  try {
    answer = await auraExecutiveChat(prompt, `${context}\n\nGrant Intelligence Dashboard:\n${JSON.stringify(dashboard.summary, null, 2)}`);
  } catch {
    offline = true;
    answer = `Pipeline value: $${dashboard.summary.totalPipelineValue.toLocaleString()}. Secured: $${dashboard.summary.totalFundingSecured.toLocaleString()}. ${dashboard.summary.newOpportunities} new opportunities in the last week.`;
  }

  return { answer, offline, dashboard: dashboard.summary, askedBy: opts?.actorEmail ?? null, generatedAt: new Date().toISOString() };
}

/** Sync feeds + enrich + optional broadcast. */
export async function runGrantIntelligenceSync(opts?: { actorEmail?: string }) {
  const feedResults = await syncGrantFeeds({ providers: ["grants_gov"] });
  const enriched = await enrichAllOpportunities(150);

  try {
    const { notifyHqDataChange } = await import("./hqRealtimeEvents");
    notifyHqDataChange("grants");
  } catch {
    /* optional realtime */
  }

  return {
    feedResults,
    enriched,
    syncedAt: new Date().toISOString(),
    actor: opts?.actorEmail ?? null,
  };
}

export function scheduleGrantIntelligenceSync(): void {
  if (syncTimer || process.env.NODE_ENV !== "production") return;
  syncTimer = setInterval(() => {
    void runGrantIntelligenceSync().catch((err) =>
      console.warn("Grant intelligence sync failed:", err instanceof Error ? err.message : err)
    );
  }, SYNC_INTERVAL_MS);
  console.log(`Grant Intelligence Engine: scheduled sync every ${SYNC_INTERVAL_MS / 3600_000}h`);
}
