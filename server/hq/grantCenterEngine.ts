/**
 * Grant Center — unified enterprise platform (modular command hub)
 */
import { getDb } from "../db";
import { grantId, logGrantActivity } from "./grantsSchema";
import { buildGrantExecutiveDashboard, buildGrantAnalytics, generateGrantNotifications } from "./grantReporting";
import { buildFundingIntelligencePlatform, buildExecutiveIntelligenceV5, buildComplianceDashboard } from "./grantFundingEngineV5";
import { buildFunderCrmDashboard } from "./grantFunderCrm";
import { buildApplicationWorkspace, aiAssistApplicationSection } from "./grantFundingEngineV5";
import { discoverAndRankGrants } from "./grantFundingEngineV3";
import { buildFundingOperationsCalendar } from "./grantFundingEngineV4";
import { getGrantFeedIntegrationStatus, countExternalFeedOpportunities } from "./grantFeedConnectors";
import { annotateOpportunity, summarizeGrantDataSources, resolveFeedAggregateSource } from "./grantDataSource";
import { allowGrantDemoSeed, productionGrantOpportunitySqlFilter } from "./grantProductionPolicy";

export const GRANT_CENTER_MODULES = [
  { id: "executive-dashboard", label: "Executive Funding Dashboard", tab: "overview", status: "live" },
  { id: "opportunity-finder", label: "Grant Opportunity Finder", tab: "opportunities", status: "live", integrations: ["grants_gov", "sam_gov", "foundation_directory", "corporate_csr"] },
  { id: "writer-studio", label: "Grant Writer Studio", tab: "writer-studio", status: "live" },
  { id: "grant-library", label: "Grant Library", tab: "library", status: "live" },
  { id: "grant-calendar", label: "Grant Calendar", tab: "calendar", status: "live" },
  { id: "award-budget", label: "Award & Budget Tracker", tab: "awards", status: "live" },
  { id: "documents-vault", label: "Required Documents Vault", tab: "documents", status: "live" },
  { id: "funder-crm", label: "Partner & Funder CRM", tab: "funders", status: "live" },
  { id: "compliance-reporting", label: "Compliance & Reporting", tab: "compliance", status: "live" },
  { id: "funding-analytics", label: "Funding Analytics", tab: "analytics", status: "live" },
  { id: "renewal-notifications", label: "Renewal & Deadline Notifications", tab: "notifications", status: "live" },
] as const;

export const WRITER_SECTIONS = [
  { key: "executive_summary", label: "Executive Summary", sort: 1 },
  { key: "need_statement", label: "Statement of Need", sort: 2 },
  { key: "project_description", label: "Project Description", sort: 3 },
  { key: "goals_objectives", label: "Goals & Objectives", sort: 4 },
  { key: "methods", label: "Methods & Activities", sort: 5 },
  { key: "evaluation", label: "Evaluation Plan", sort: 6 },
  { key: "sustainability", label: "Sustainability", sort: 7 },
  { key: "organizational_capacity", label: "Organizational Capacity", sort: 8 },
  { key: "budget_narrative", label: "Budget Narrative", sort: 9 },
] as const;

const DEFAULT_TEMPLATES = [
  { slug: "federal-rfp", title: "Federal RFP Response", category: "federal", funder_type: "federal", description: "Standard federal grant narrative structure with logic model sections." },
  { slug: "foundation-letter", title: "Foundation Letter of Inquiry", category: "foundation", funder_type: "foundation", description: "Concise LOI template for private foundations." },
  { slug: "state-contract", title: "State Contract Proposal", category: "state", funder_type: "state", description: "State government RFP response with compliance checklist." },
  { slug: "corporate-sponsorship", title: "Corporate Sponsorship Request", category: "corporate", funder_type: "corporate", description: "Corporate partnership and sponsorship proposal." },
  { slug: "renewal-report", title: "Grant Renewal Report", category: "reporting", funder_type: "any", description: "Progress report and renewal justification template." },
  { slug: "budget-justification", title: "Budget Justification", category: "budget", funder_type: "any", description: "Line-item budget narrative for personnel, fringe, and indirect costs." },
];

export async function ensureGrantCenterTables() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_templates (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      funder_type TEXT DEFAULT 'any',
      description TEXT,
      content TEXT,
      sections_json TEXT,
      is_active INTEGER DEFAULT 1,
      usage_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS grant_writer_sections (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      section_key TEXT NOT NULL,
      section_label TEXT NOT NULL,
      content TEXT DEFAULT '',
      word_count INTEGER DEFAULT 0,
      ai_assisted INTEGER DEFAULT 0,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(application_id, section_key),
      FOREIGN KEY (application_id) REFERENCES grant_applications(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_grant_writer_app ON grant_writer_sections(application_id);
    CREATE INDEX IF NOT EXISTS idx_grant_templates_cat ON grant_templates(category);
  `);

  const count = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_templates"))?.c ?? 0;
  if (count === 0) {
    const now = new Date().toISOString();
    for (const t of DEFAULT_TEMPLATES) {
      const sections = WRITER_SECTIONS.map((s) => ({ key: s.key, label: s.label }));
      await db.run(
        `INSERT INTO grant_templates (id, slug, title, category, funder_type, description, sections_json, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        grantId(), t.slug, t.title, t.category, t.funder_type, t.description,
        JSON.stringify(sections), `# ${t.title}\n\nUse this template as a starting point for ${t.category} grant applications.`,
        now, now
      );
    }
  }
}

export async function buildGrantCenterPlatform() {
  await ensureGrantCenterTables();
  const db = await getDb();
  const counts = {
    opportunities: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_opportunities"))?.c ?? 0,
    applications: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_applications"))?.c ?? 0,
    awards: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_awards WHERE status = 'active'"))?.c ?? 0,
    templates: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_templates WHERE is_active = 1"))?.c ?? 0,
    funders: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_funders"))?.c ?? 0,
    documents: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_documents"))?.c ?? 0,
    notifications: (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_notifications WHERE read = 0"))?.c ?? 0,
  };

  const integrations = await getGrantFeedIntegrationStatus();
  const externalCount = await countExternalFeedOpportunities();

  return {
    version: "grant-center-v1",
    modules: GRANT_CENTER_MODULES,
    integrations,
    externalFeedCount: externalCount,
    counts,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildGrantCenterExecutiveSummary() {
  const [dashboard, intelligence, compliance, crm] = await Promise.all([
    buildGrantExecutiveDashboard(),
    buildExecutiveIntelligenceV5().catch(() => null),
    buildComplianceDashboard().catch(() => null),
    buildFunderCrmDashboard().catch(() => null),
  ]);

  return {
    dashboard,
    intelligence,
    compliance: compliance?.summary ?? null,
    crm: { totalFunders: crm?.totalFunders ?? 0, activePartners: crm?.activePartners ?? 0 },
    kpis: {
      openOpportunities: dashboard.openOpportunities,
      pendingApplications: dashboard.pendingApplications,
      totalAwarded: dashboard.totalAwarded,
      pipelineValue: dashboard.pipelineValue,
      winRate: dashboard.winRate,
      complianceDue: dashboard.complianceDue,
      upcomingDeadlines: dashboard.upcomingDeadlines,
      sustainabilityIndex: intelligence?.organizationSustainabilityIndex ?? null,
    },
  };
}

export async function listGrantTemplates(category?: string) {
  await ensureGrantCenterTables();
  const db = await getDb();
  let sql = "SELECT id, slug, title, category, funder_type, description, usage_count, updated_at FROM grant_templates WHERE is_active = 1";
  const params: string[] = [];
  if (category) { sql += " AND category = ?"; params.push(category); }
  sql += " ORDER BY category, title";
  const templates = await db.all(sql, ...params);
  return { templates, categories: ["federal", "state", "foundation", "corporate", "reporting", "budget"] };
}

export async function getGrantTemplate(idOrSlug: string) {
  await ensureGrantCenterTables();
  const db = await getDb();
  const row = await db.get(
    "SELECT * FROM grant_templates WHERE id = ? OR slug = ?",
    idOrSlug, idOrSlug
  );
  if (!row) return null;
  const parsed = row as { sections_json?: string };
  return { ...parsed, sections: parsed.sections_json ? JSON.parse(parsed.sections_json) : WRITER_SECTIONS };
}

export async function createGrantTemplate(data: {
  title: string; category: string; funder_type?: string; description?: string; content?: string;
}, actor?: { email?: string }) {
  await ensureGrantCenterTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = grantId();
  const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48);
  const sections = WRITER_SECTIONS.map((s) => ({ key: s.key, label: s.label }));
  await db.run(
    `INSERT INTO grant_templates (id, slug, title, category, funder_type, description, content, sections_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, slug, data.title, data.category, data.funder_type ?? "any", data.description ?? "",
    data.content ?? "", JSON.stringify(sections), now, now
  );
  await logGrantActivity("grant_template", id, "template_created", data.title, actor?.email);
  return getGrantTemplate(id);
}

export async function seedWriterSectionsForApplication(applicationId: string, templateId?: string) {
  await ensureGrantCenterTables();
  const db = await getDb();
  const existing = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM grant_writer_sections WHERE application_id = ?", applicationId
  ))?.c ?? 0;
  if (existing > 0) return listWriterSections(applicationId);

  const template = templateId ? await getGrantTemplate(templateId) : null;
  const sections = (template?.sections as { key: string; label: string }[]) ?? WRITER_SECTIONS.map((s) => ({ key: s.key, label: s.label }));
  const now = new Date().toISOString();
  for (const s of sections) {
    await db.run(
      `INSERT OR IGNORE INTO grant_writer_sections (id, application_id, section_key, section_label, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      grantId(), applicationId, s.key, s.label, "", now, now
    );
  }
  if (templateId) {
    await db.run("UPDATE grant_templates SET usage_count = usage_count + 1, updated_at = ? WHERE id = ? OR slug = ?", now, templateId, templateId);
  }
  return listWriterSections(applicationId);
}

export async function listWriterSections(applicationId: string) {
  await ensureGrantCenterTables();
  const db = await getDb();
  const rows = await db.all(
    "SELECT * FROM grant_writer_sections WHERE application_id = ? ORDER BY section_key",
    applicationId
  );
  const total = rows.length;
  const completed = (rows as { content: string }[]).filter((r) => (r.content ?? "").trim().length > 50).length;
  return { sections: rows, completionPct: total ? Math.round((completed / total) * 100) : 0, completed, total };
}

export async function updateWriterSection(
  applicationId: string,
  sectionKey: string,
  content: string,
  actor?: { email?: string }
) {
  await ensureGrantCenterTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const label = WRITER_SECTIONS.find((s) => s.key === sectionKey)?.label ?? sectionKey;
  await db.run(
    `INSERT INTO grant_writer_sections (id, application_id, section_key, section_label, content, word_count, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(application_id, section_key) DO UPDATE SET
       content = excluded.content, word_count = excluded.word_count, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    grantId(), applicationId, sectionKey, label, content, wordCount, actor?.email ?? null, now, now
  );
  await logGrantActivity("grant_application", applicationId, "writer_section_saved", sectionKey, actor?.email);
  return db.get("SELECT * FROM grant_writer_sections WHERE application_id = ? AND section_key = ?", applicationId, sectionKey);
}

export async function buildWriterStudio(applicationId: string, opts?: { templateId?: string; actorEmail?: string }) {
  const [workspace, sections] = await Promise.all([
    buildApplicationWorkspace(applicationId, { actorEmail: opts?.actorEmail }),
    seedWriterSectionsForApplication(applicationId, opts?.templateId),
  ]);
  if (!workspace) return null;
  const templates = await listGrantTemplates();
  return { ...workspace, writerSections: sections, templates: templates.templates };
}

export async function assistWriterSection(applicationId: string, sectionKey: string, prompt?: string) {
  const section = WRITER_SECTIONS.find((s) => s.key === sectionKey);
  const result = await aiAssistApplicationSection({
    applicationId,
    section: sectionKey,
    prompt: prompt ?? `Draft the ${section?.label ?? sectionKey} section for this grant application.`,
  });
  return result;
}

export async function buildOpportunityFinder(filters?: { category?: string; geography?: string; q?: string }) {
  const discovery = await discoverAndRankGrants({ limit: 50 }).catch((err) => {
    if (process.env.NODE_ENV === "production") throw err;
    console.warn("Grant discovery unavailable:", err instanceof Error ? err.message : err);
    return { ranked: [] as Record<string, unknown>[] };
  });
  const db = await getDb();
  let sql = `SELECT o.*, 
    CASE WHEN o.funder LIKE '%Department%' OR o.funder LIKE '%U.S.%' THEN 'federal'
         WHEN o.funder LIKE '%State%' OR o.funder LIKE '%NJ%' THEN 'state'
         WHEN o.funder LIKE '%Foundation%' THEN 'foundation'
         ELSE 'corporate' END as funder_category
    FROM grant_opportunities o WHERE o.status != 'closed'${productionGrantOpportunitySqlFilter("o")}`;
  const params: string[] = [];
  if (filters?.q) { sql += " AND (o.title LIKE ? OR o.funder LIKE ? OR o.description LIKE ?)"; const q = `%${filters.q}%`; params.push(q, q, q); }
  if (filters?.geography) { sql += " AND o.geography = ?"; params.push(filters.geography); }
  sql += " ORDER BY o.deadline ASC LIMIT 100";
  const raw = await db.all(sql, ...params) as Record<string, unknown>[];
  const local = raw.map(annotateOpportunity);
  const categorized = {
    federal: local.filter((o) => o.funder_category === "federal"),
    state: local.filter((o) => o.funder_category === "state"),
    foundation: local.filter((o) => o.funder_category === "foundation"),
    corporate: local.filter((o) => o.funder_category === "corporate"),
  };
  const externalCount = await countExternalFeedOpportunities();
  const integrations = await getGrantFeedIntegrationStatus();
  const dataSourceBreakdown = summarizeGrantDataSources(local);
  const source = resolveFeedAggregateSource(externalCount, dataSourceBreakdown);
  const integrationState = integrationsStatus(integrations);
  const payload = {
    source,
    dataSourceBreakdown,
    externalFeedCount: externalCount,
    integrations: integrationState,
    demoSeedEnabled: allowGrantDemoSeed(),
    generatedAt: new Date().toISOString(),
  };
  if (filters?.category && categorized[filters.category as keyof typeof categorized]) {
    return { ...payload, opportunities: categorized[filters.category as keyof typeof categorized] };
  }
  return { ...payload, opportunities: local, categorized, ranked: discovery.ranked ?? [] };
}

function integrationsStatus(integrations: Awaited<ReturnType<typeof getGrantFeedIntegrationStatus>>) {
  return Object.values(integrations).filter((i) => i.status === "connected").length >= 2 ? "connected" : "partial";
}

export async function buildFundingAnalyticsDashboard() {
  const [analytics, intelligence, calendar] = await Promise.all([
    buildGrantAnalytics(),
    buildFundingIntelligencePlatform().catch(() => null),
    buildFundingOperationsCalendar({ daysAhead: 90 }).catch(() => null),
  ]);
  await generateGrantNotifications();
  return {
    analytics,
    intelligence: intelligence?.executiveIntelligence ?? null,
    calendarPreview: (calendar?.events ?? []).slice(0, 10),
    generatedAt: new Date().toISOString(),
  };
}
