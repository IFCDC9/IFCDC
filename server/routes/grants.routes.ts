import { Router } from "express";
import type { Request, Response } from "express";
import { getDb } from "../db";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import { hasPermission } from "../hq/enterpriseRoles";
import { grantId, logGrantActivity } from "../hq/grantsSchema";
import { ensureGrantModulesReady } from "../hq/grantModuleBootstrap";
import { validateGrantDocumentUpload } from "../hq/grantDocumentUpload";
import { buildGrantExecutiveDashboard, buildGrantAnalytics, generateGrantNotifications, buildFunderReports } from "../hq/grantReporting";
import { saveHqFileBase64 } from "../hq/hqFileStorage";
import { createGrantFinanceBudget, getGrantFinancialSummary } from "../hq/grantFinanceIntegration";
import { notifyGrantAwarded } from "../hq/criticalAlerts";
import { getIntegrationOptions } from "../hq/financeReporting";
import {
  findGrantOpportunities,
  matchGrantEligibility,
  grantWritingAssist,
  generateGrantOutcomeReport,
} from "../hq/grantIntelligence";
import {
  listFunders,
  getFunder,
  createFunder,
  updateFunder,
  logFunderInteraction,
  buildFunderCrmDashboard,
} from "../hq/grantFunderCrm";
import {
  searchGrantOpportunities,
  scoreOpportunityEligibility,
  buildExecutiveFundingDashboard,
  buildAuraFundingIntelligence,
  getApplicationWorkflow,
  advanceApplicationWorkflow,
  listGrantOutcomes,
  IFCDC_FUNDING_DIVISIONS,
  ensureApplicationWorkflow,
} from "../hq/grantFundingEngine";
import {
  buildV2FundingPipeline,
  buildExecutiveFundingAnalytics,
  buildDivisionFundingProfiles,
  getDivisionFundingProfile,
  listLiveGrantOpportunities,
  matchGrantsForDivision,
  buildAuraFundingIntelligenceV2,
  listDocumentChecklist,
  buildFundingEngineDashboard,
  buildGrantFinanceConnection,
  scoreOpportunityDual,
  updateOpportunityFundingStatus,
  buildAuraFundingRecommendations,
} from "../hq/grantFundingEngineV2";
import {
  discoverAndRankGrants,
  buildExecutiveIntelligentDashboardV3,
  buildProgramFundingProfilesV3,
  buildGrantDocumentCenter,
  buildRenewalCalendar,
  auraExecutiveFundingIntelligence,
  buildIntelligentFundingPlatform,
  AURA_EXECUTIVE_QUESTIONS,
} from "../hq/grantFundingEngineV3";
import {
  buildGrantLifecyclePipeline,
  updateGrantLifecycleStage,
  buildFundingOperationsCalendar,
  buildExecutiveOperationsDashboard,
  buildProgramIntegrationPortfolios,
  buildOrganizationFundingForecast,
  auraExecutiveAdvisorV4,
  buildIntelligentFundingOperationsPlatform,
  AURA_V4_ADVISOR_QUESTIONS,
} from "../hq/grantFundingEngineV4";
import {
  buildFundingIntelligencePlatform,
  listNationalGrantDatabase,
  matchGrantsAllDivisions,
  scoreGrantOpportunityV5,
  buildApplicationWorkspace,
  aiAssistApplicationSection,
  getOrCreateProposalBudget,
  updateProposalBudget,
  buildExecutiveIntelligenceV5,
  buildComplianceDashboard,
  buildRenewalReportingTracker,
  buildMultiYearProjections,
  buildPerformanceMetrics,
  auraFundingIntelligenceAdvisorV5,
  getV5LifecyclePipeline,
  getV5OperationsCalendar,
  getV5ProgramProfiles,
  getV5ProgramIntegration,
  getV5FundingPipeline,
  getV5ExecutiveAnalytics,
  getV5DocumentCenter,
} from "../hq/grantFundingEngineV5";
import { buildPipelineKanbanBoard, transitionPipelineEntity } from "../hq/grantPipelineEngine";
import {
  buildEnterprisePipelineBoard,
  buildPipelineMetricsDashboard,
  buildOpportunityPipelineIntelligence,
  buildFounderCommandCenter,
  setFounderPipelineDecision,
  setApplicationPriority,
  transitionFundingPipelineStage,
  runLivePipelineSync,
  runPipelineNotificationScan,
  FUNDING_PIPELINE_STAGES,
  FUNDING_PIPELINE_LABELS,
} from "../hq/grantFundingPipelineEngine";
import { buildDivisionConnectorManifest } from "../hq/divisionConnectors";
import {
  listPipelineAutomationRules,
  listPipelineAutomationLog,
  scanPipelineDeadlineAlerts,
} from "../hq/pipelineAutomation";
import {
  buildGrantCenterPlatform,
  buildGrantCenterExecutiveSummary,
  listGrantTemplates,
  getGrantTemplate,
  createGrantTemplate,
  buildWriterStudio,
  updateWriterSection,
  assistWriterSection,
  buildOpportunityFinder,
  buildFundingAnalyticsDashboard,
} from "../hq/grantCenterEngine";
import { syncGrantFeeds, getGrantFeedIntegrationStatus } from "../hq/grantFeedConnectors";
import {
  buildGrantIntelligenceDashboard,
  getLiveOpportunityFeed,
  runGrantIntelligenceSync,
  scoreOpportunityIntelligence,
  startGrantApplicationWorkflow,
  generateFullProposalDraft,
  askGrantAura,
  processGrantAuraCommand,
  matchOpportunitiesForProgram,
  buildOrgWideGrantMatches,
  buildProgramGrantQueues,
  IFCDC_PROGRAM_CATALOG,
  buildEnrichedOpportunityList,
  buildFullApplicationWorkspace,
  setFounderApproval,
  listEnrichedApplications,
  GRANT_DISPLAY_WORKFLOW,
} from "../hq/grantIntelligenceEngine";
import { getGrantCenterQaReport, grantCenterQaEnvReady } from "../hq/grantCenterQaCache";
import { runGrantCenterProductionQa } from "../hq/grantCenterProductionQaRunner";

const router = Router();

/** Public QA report (no credentials). Runs on Render using secure env vars. */
router.get("/qa/report", (_req, res) => {
  const env = grantCenterQaEnvReady();
  res.json({
    ...getGrantCenterQaReport(),
    envReady: env.ready,
    missingEnv: env.missing,
    renderService: env.service,
  });
});

router.use(hqAuthRequired, requireHQModule("grants"));

router.use(async (_req, _res, next) => {
  try {
    await ensureGrantModulesReady();
    next();
  } catch (e) {
    next(e);
  }
});

/** Grant mutations require hq.grants.manage (board members are read-only). */
router.use((req, res, next) => {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const role = req.hqUser?.role;
  if (role === "founder" || role === "owner") return next();
  if (hasPermission(role!, "hq.grants.manage")) return next();
  return res.status(403).json({ error: "Grant manage permission required for this action" });
});

function actor(req: Request) {
  return { email: req.hqUser?.email };
}

router.post("/qa/run", async (req: Request, res: Response) => {
  const role = req.hqUser?.role;
  if (role !== "founder" && role !== "owner") {
    return res.status(403).json({ error: "Founder access required to re-run production QA" });
  }
  const port = Number(process.env.PORT) || 5000;
  const report = await runGrantCenterProductionQa(port);
  res.json({ ...report, envReady: grantCenterQaEnvReady().ready });
});

router.get("/dashboard", async (_req, res) => {
  await generateGrantNotifications();
  res.json(await buildGrantExecutiveDashboard());
});

router.get("/analytics", async (_req, res) => {
  res.json(await buildGrantAnalytics());
});

router.get("/pipeline", async (_req, res) => {
  const dashboard = await buildGrantExecutiveDashboard();
  res.json({ pipeline: dashboard.fundingPipeline, pipelineValue: dashboard.pipelineValue, winRate: dashboard.winRate });
});

router.get("/funder-reports", async (_req, res) => {
  try {
    res.json(await buildFunderReports());
  } catch (error) {
    console.error("Funder reports error:", error);
    res.status(503).json({
      error: "Funder reports unavailable",
      message: error instanceof Error ? error.message : "Failed to load funder reports",
      liveDataOnly: true,
    });
  }
});

router.get("/integrations", async (_req, res) => {
  res.json(await getIntegrationOptions());
});

router.get("/overview", async (_req, res) => {
  res.json(await buildGrantExecutiveDashboard());
});

// ——— Grant Center Enterprise Platform ———
router.get("/center/platform", async (_req, res) => {
  res.json(await buildGrantCenterPlatform());
});

router.get("/feeds/status", async (_req, res) => {
  res.json({ integrations: await getGrantFeedIntegrationStatus() });
});

router.post("/feeds/sync", async (req, res) => {
  const providers = req.body?.providers;
  const results = await syncGrantFeeds(Array.isArray(providers) ? { providers } : undefined);
  res.json({ results, integrations: await getGrantFeedIntegrationStatus() });
});

// ——— Grant Intelligence Engine ———
router.get("/intelligence/dashboard", async (_req, res) => {
  res.json(await buildGrantIntelligenceDashboard());
});

router.get("/intelligence/feed", async (req, res) => {
  const sinceHours = req.query.sinceHours ? Number(req.query.sinceHours) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json(await getLiveOpportunityFeed({ sinceHours, limit }));
});

router.get("/intelligence/programs", async (_req, res) => {
  res.json({ programs: IFCDC_PROGRAM_CATALOG.map((p) => ({ slug: p.slug, label: p.label })) });
});

router.get("/intelligence/programs/:slug/matches", async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json(await matchOpportunitiesForProgram(req.params.slug, limit ?? 25));
});

router.get("/intelligence/match", async (req, res) => {
  const programSlug = req.query.programSlug ? String(req.query.programSlug) : undefined;
  const sort = req.query.sort ? String(req.query.sort) as "fit" | "funding" | "deadline" : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const minScore = req.query.minScore ? Number(req.query.minScore) : undefined;
  const syncFeeds = req.query.syncFeeds === "true" || req.query.syncFeeds === "1";
  const q = req.query.q ? String(req.query.q) : undefined;
  res.json(
    await buildOrgWideGrantMatches({
      programSlug,
      sort,
      limit,
      minScore,
      syncFeeds,
      q,
      actorEmail: req.hqUser?.email,
    })
  );
});

router.get("/intelligence/program-queues", async (req, res) => {
  const programSlug = req.query.programSlug ? String(req.query.programSlug) : undefined;
  const limitPerStage = req.query.limitPerStage ? Number(req.query.limitPerStage) : undefined;
  res.json(await buildProgramGrantQueues({ programSlug, limitPerStage }));
});

router.get("/intelligence/opportunities", async (req, res) => {
  const filter = req.query.filter ? String(req.query.filter) : "all";
  const programSlug = req.query.programSlug ? String(req.query.programSlug) : undefined;
  const q = req.query.q ? String(req.query.q) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json(await buildEnrichedOpportunityList({
    filter: filter as "all" | "matched" | "program",
    programSlug,
    q,
    limit,
  }));
});

router.get("/intelligence/workflow-stages", async (_req, res) => {
  res.json({ stages: GRANT_DISPLAY_WORKFLOW });
});

router.get("/applications/enriched", async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json(await listEnrichedApplications({ status, limit }));
});

router.post("/applications/:id/founder-approval", async (req: Request, res: Response) => {
  const action = req.body?.action;
  if (!["approve", "request_changes", "mark_ready"].includes(action)) {
    return res.status(400).json({ error: "action must be approve, request_changes, or mark_ready" });
  }
  const result = await setFounderApproval(req.params.id, action, {
    actorEmail: req.hqUser?.email,
    note: req.body?.note,
  });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get("/applications/:id/full-workspace", async (req, res) => {
  const workspace = await buildFullApplicationWorkspace(req.params.id, { actorEmail: req.hqUser?.email });
  if (!workspace) return res.status(404).json({ error: "Application not found" });
  res.json(workspace);
});

router.post("/intelligence/sync", async (req: Request, res: Response) => {
  res.json(await runGrantIntelligenceSync({ actorEmail: req.hqUser?.email }));
});

router.post("/intelligence/aura/ask", async (req: Request, res: Response) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) return res.status(400).json({ error: "question required" });
  res.json(await processGrantAuraCommand(question, { actorEmail: req.hqUser?.email }));
});

router.post("/opportunities/:id/score-intelligence", async (req: Request, res: Response) => {
  const score = await scoreOpportunityIntelligence(req.params.id, {
    divisionSlug: req.body?.divisionSlug,
    actorEmail: req.hqUser?.email,
  });
  if (!score) return res.status(404).json({ error: "Opportunity not found" });
  res.json({ intelligence: score });
});

router.post("/opportunities/:id/start-application", async (req: Request, res: Response) => {
  const result = await startGrantApplicationWorkflow(req.params.id, {
    actorEmail: req.hqUser?.email,
    generateDrafts: req.body?.generateDrafts === true,
  });
  if (!result.ok) return res.status(404).json(result);
  res.status(result.existing ? 200 : 201).json(result);
});

router.post("/applications/:id/generate-full-draft", async (req: Request, res: Response) => {
  try {
    const sections = Array.isArray(req.body?.sections) ? req.body.sections.map(String) : undefined;
    const result = await generateFullProposalDraft(req.params.id, {
      actorEmail: req.hqUser?.email,
      sections,
    });
    res.status(202).json({ ...result, humanReviewRequired: true, founderApprovalRequired: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Full proposal generation failed";
    console.error(`[grant-writer] generate-full-draft app=${req.params.id}:`, message);
    res.status(400).json({ error: message });
  }
});

router.get("/draft-jobs/:jobId", async (req, res) => {
  const { getFullProposalDraftJob } = await import("../hq/grantWriterEngine");
  const job = await getFullProposalDraftJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Draft job not found" });
  res.json({ job });
});

router.get("/applications/:id/draft-job", async (req, res) => {
  const { getActiveDraftJobForApplication } = await import("../hq/grantWriterEngine");
  const job = await getActiveDraftJobForApplication(req.params.id);
  res.json({ job });
});

router.get("/center/executive-summary", async (_req, res) => {
  res.json(await buildGrantCenterExecutiveSummary());
});

router.get("/center/opportunity-finder", async (req, res) => {
  const { category, geography, q } = req.query;
  res.json(await buildOpportunityFinder({
    category: category ? String(category) : undefined,
    geography: geography ? String(geography) : undefined,
    q: q ? String(q) : undefined,
  }));
});

router.get("/center/analytics", async (_req, res) => {
  res.json(await buildFundingAnalyticsDashboard());
});

router.get("/library/templates", async (req, res) => {
  res.json(await listGrantTemplates(req.query.category ? String(req.query.category) : undefined));
});

router.get("/library/templates/:id", async (req, res) => {
  const template = await getGrantTemplate(req.params.id);
  if (!template) return res.status(404).json({ error: "Template not found" });
  res.json({ template });
});

router.post("/library/templates", async (req: Request, res: Response) => {
  const { title, category, funder_type, description, content } = req.body ?? {};
  if (!title || !category) return res.status(400).json({ error: "title and category required" });
  const template = await createGrantTemplate({ title, category, funder_type, description, content }, { email: req.hqUser?.email });
  res.status(201).json({ template });
});

router.get("/writer-studio/:applicationId", async (req, res) => {
  const studio = await buildWriterStudio(req.params.applicationId, {
    templateId: req.query.templateId ? String(req.query.templateId) : undefined,
    actorEmail: req.hqUser?.email,
  });
  if (!studio) return res.status(404).json({ error: "Application not found" });
  res.json(studio);
});

router.patch("/writer-studio/:applicationId/sections/:sectionKey", async (req: Request, res: Response) => {
  const { content } = req.body ?? {};
  if (content === undefined) return res.status(400).json({ error: "content required" });
  const section = await updateWriterSection(req.params.applicationId, req.params.sectionKey, String(content), { email: req.hqUser?.email });
  res.json({ section });
});

router.post("/writer-studio/:applicationId/sections/:sectionKey/ai-assist", async (req: Request, res: Response) => {
  try {
    const result = await assistWriterSection(
      req.params.applicationId,
      req.params.sectionKey,
      req.body?.prompt,
      req.hqUser?.email
    );
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AURA draft failed";
    console.error(`[grant-writer] ai-assist app=${req.params.applicationId} section=${req.params.sectionKey}:`, message);
    res.status(400).json({ error: message });
  }
});

router.get("/writer-studio/:applicationId/sections/:sectionKey/versions", async (req, res) => {
  const { listWriterSectionVersions } = await import("../hq/grantWriterEngine");
  const versions = await listWriterSectionVersions(req.params.applicationId, req.params.sectionKey);
  res.json({ versions });
});

router.post("/writer-studio/:applicationId/sections/:sectionKey/restore/:versionId", async (req: Request, res: Response) => {
  const { getWriterSectionVersion } = await import("../hq/grantWriterEngine");
  const version = await getWriterSectionVersion(req.params.versionId);
  if (!version) return res.status(404).json({ error: "Version not found" });
  const section = await updateWriterSection(
    req.params.applicationId,
    req.params.sectionKey,
    String((version as { content: string }).content),
    { email: req.hqUser?.email }
  );
  res.json({ section });
});

router.get("/opportunities", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all("SELECT * FROM grant_opportunities ORDER BY deadline ASC");
  res.json({ opportunities: rows });
});

router.post("/opportunities", async (req, res) => {
  const {
    title, funder, description, amount_min, amount_max, deadline, url, requirements,
    division_slugs, program_areas, eligibility, geography, funder_type, source_type,
  } = req.body;
  if (!title || !funder) return res.status(400).json({ error: "title and funder are required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const oppId = grantId();
  const divisionsJson = division_slugs
    ? JSON.stringify(Array.isArray(division_slugs) ? division_slugs : [division_slugs])
    : "[]";
  const programsJson = program_areas
    ? JSON.stringify(Array.isArray(program_areas) ? program_areas : [program_areas])
    : "[]";
  await db.run(
    `INSERT INTO grant_opportunities (
      id, title, funder, description, amount_min, amount_max, status, deadline, url, requirements,
      division_slugs, program_areas, eligibility, geography, funder_type, source_type,
      import_status, last_verified_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)`,
    oppId, title, funder, description ?? "", amount_min ?? null, amount_max ?? null,
    deadline ?? null, url ?? "", requirements ? JSON.stringify(requirements) : "[]",
    divisionsJson, programsJson, eligibility ?? null, geography ?? null,
    funder_type ?? "foundation", source_type ?? "manual", now, now, now
  );
  if (deadline) {
    await db.run(
      `INSERT INTO grant_deadlines (id, opportunity_id, title, due_date, deadline_type, created_at) VALUES (?, ?, ?, ?, 'submission', ?)`,
      grantId(), oppId, `Application deadline: ${title}`, deadline, now
    );
  }
  await logGrantActivity("opportunity", oppId, "created", `Opportunity added: ${title}`, actor(req).email);
  const row = await db.get("SELECT * FROM grant_opportunities WHERE id = ?", oppId);
  res.status(201).json({ opportunity: row });
});

router.patch("/opportunities/:id", async (req, res) => {
  const db = await getDb();
  const { status, title, funder, description, deadline } = req.body;
  const now = new Date().toISOString();
  await db.run(
    `UPDATE grant_opportunities SET status = COALESCE(?, status), title = COALESCE(?, title),
     funder = COALESCE(?, funder), description = COALESCE(?, description),
     deadline = COALESCE(?, deadline), updated_at = ? WHERE id = ?`,
    status, title, funder, description, deadline, now, req.params.id
  );
  const row = await db.get("SELECT * FROM grant_opportunities WHERE id = ?", req.params.id);
  res.json({ opportunity: row });
});

router.get("/applications", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(`
    SELECT a.*, o.title as opportunity_title, o.funder
    FROM grant_applications a
    LEFT JOIN grant_opportunities o ON a.opportunity_id = o.id
    ORDER BY a.updated_at DESC
  `);
  res.json({ applications: rows });
});

router.post("/applications", async (req, res) => {
  const { opportunity_id, title, amount_requested, assigned_to, notes } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const appId = grantId();
  await db.run(
    `INSERT INTO grant_applications (id, opportunity_id, title, status, amount_requested, assigned_to, notes, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    appId, opportunity_id ?? null, title, amount_requested ?? null, assigned_to ?? "", notes ?? "", now, now
  );
  await ensureApplicationWorkflow(appId);
  await logGrantActivity("application", appId, "created", `Application created: ${title}`, actor(req).email);
  const row = await db.get("SELECT * FROM grant_applications WHERE id = ?", appId);
  res.status(201).json({ application: row });
});

router.patch("/applications/:id", async (req, res) => {
  const { status, amount_requested, amount_awarded, notes, assigned_to } = req.body;
  const db = await getDb();
  const now = new Date().toISOString();
  const submitted_at = status === "submitted" ? now : undefined;
  await db.run(
    `UPDATE grant_applications SET
     status = COALESCE(?, status),
     amount_requested = COALESCE(?, amount_requested),
     amount_awarded = COALESCE(?, amount_awarded),
     notes = COALESCE(?, notes),
     assigned_to = COALESCE(?, assigned_to),
     submitted_at = COALESCE(?, submitted_at),
     updated_at = ? WHERE id = ?`,
    status, amount_requested, amount_awarded, notes, assigned_to, submitted_at, now, req.params.id
  );

  if (status === "awarded" && amount_awarded) {
    const app = await db.get<{ opportunity_id: string; title: string; program_id: string | null; department_id: string | null }>(
      "SELECT opportunity_id, title, program_id, department_id FROM grant_applications WHERE id = ?", req.params.id
    );
    if (app) {
      const existing = await db.get<{ id: string }>("SELECT id FROM grant_awards WHERE application_id = ?", req.params.id);
      let awardId: string;
      if (!existing) {
        awardId = grantId();
        await db.run(
          `INSERT INTO grant_awards (id, application_id, opportunity_id, amount, award_date, status, program_id, department_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
          awardId, req.params.id, app.opportunity_id, amount_awarded, now.slice(0, 10), app.program_id, app.department_id, now
        );
        await db.run(
          `INSERT INTO grant_compliance (id, award_id, report_type, due_date, status, notes, created_at)
           VALUES (?, ?, 'Initial Progress Report', date('now', '+90 days'), 'pending', 'Auto-scheduled on award', ?)`,
          grantId(), awardId, now
        );
      } else {
        awardId = existing.id;
      }

      const opp = await db.get<{ title: string }>("SELECT title FROM grant_opportunities WHERE id = ?", app.opportunity_id);
      await createGrantFinanceBudget({
        awardId,
        grantTitle: opp?.title ?? app.title,
        amount: Number(amount_awarded),
        programId: app.program_id ?? undefined,
        departmentId: app.department_id ?? undefined,
        actor: actor(req),
      });

      await notifyGrantAwarded({
        title: opp?.title ?? app.title,
        amount: Number(amount_awarded),
        awardId,
      }).catch(() => undefined);

      await logGrantActivity("award", awardId, "awarded", `Grant awarded: $${amount_awarded}`, req.hqUser?.email);
    }
  }

  const row = await db.get("SELECT * FROM grant_applications WHERE id = ?", req.params.id);
  res.json({ application: row });
});

router.get("/deadlines", async (req, res) => {
  const db = await getDb();
  const upcoming = req.query.upcoming === "true";
  const sql = upcoming
    ? `SELECT d.*, o.title as opportunity_title FROM grant_deadlines d
       LEFT JOIN grant_opportunities o ON d.opportunity_id = o.id
       WHERE d.completed = 0 AND d.due_date >= date('now') ORDER BY d.due_date ASC`
    : `SELECT d.*, o.title as opportunity_title FROM grant_deadlines d
       LEFT JOIN grant_opportunities o ON d.opportunity_id = o.id ORDER BY d.due_date ASC`;
  const rows = await db.all(sql);
  res.json({ deadlines: rows });
});

router.patch("/deadlines/:id", async (req, res) => {
  const db = await getDb();
  const { completed } = req.body;
  await db.run("UPDATE grant_deadlines SET completed = ? WHERE id = ?", completed ? 1 : 0, req.params.id);
  const row = await db.get("SELECT * FROM grant_deadlines WHERE id = ?", req.params.id);
  res.json({ deadline: row });
});

router.get("/awards", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(`
    SELECT aw.*, o.title as opportunity_title, o.funder, a.title as application_title
    FROM grant_awards aw
    LEFT JOIN grant_opportunities o ON aw.opportunity_id = o.id
    LEFT JOIN grant_applications a ON aw.application_id = a.id
    ORDER BY aw.award_date DESC
  `);
  res.json({ awards: rows });
});

router.get("/compliance", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(`
    SELECT c.*, aw.amount, o.title as grant_title
    FROM grant_compliance c
    JOIN grant_awards aw ON c.award_id = aw.id
    LEFT JOIN grant_opportunities o ON aw.opportunity_id = o.id
    ORDER BY c.due_date ASC
  `);
  res.json({ compliance: rows });
});

router.post("/compliance", async (req, res) => {
  const { award_id, report_type, due_date, notes } = req.body;
  if (!award_id || !report_type || !due_date) {
    return res.status(400).json({ error: "award_id, report_type, and due_date are required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const compId = grantId();
  await db.run(
    `INSERT INTO grant_compliance (id, award_id, report_type, due_date, status, notes, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    compId, award_id, report_type, due_date, notes ?? "", now
  );
  const row = await db.get("SELECT * FROM grant_compliance WHERE id = ?", compId);
  res.status(201).json({ compliance: row });
});

router.patch("/compliance/:id", async (req, res) => {
  const { status, notes } = req.body;
  const db = await getDb();
  const now = new Date().toISOString();
  const submitted_at = status === "submitted" ? now : undefined;
  await db.run(
    `UPDATE grant_compliance SET status = COALESCE(?, status), notes = COALESCE(?, notes),
     submitted_at = COALESCE(?, submitted_at) WHERE id = ?`,
    status, notes, submitted_at, req.params.id
  );
  const row = await db.get("SELECT * FROM grant_compliance WHERE id = ?", req.params.id);
  res.json({ compliance: row });
});

router.get("/documents", async (req, res) => {
  const db = await getDb();
  const { opportunity_id, application_id } = req.query;
  let sql = "SELECT * FROM grant_documents WHERE 1=1";
  const params: string[] = [];
  if (opportunity_id) { sql += " AND opportunity_id = ?"; params.push(opportunity_id as string); }
  if (application_id) { sql += " AND application_id = ?"; params.push(application_id as string); }
  sql += " ORDER BY required DESC, name ASC";
  const rows = await db.all(sql, ...params);
  res.json({ documents: rows });
});

router.get("/calendar", async (req, res) => {
  const db = await getDb();
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const deadlines = await db.all(
    `SELECT d.*, o.title as opportunity_title, o.funder FROM grant_deadlines d
     LEFT JOIN grant_opportunities o ON d.opportunity_id = o.id
     WHERE d.due_date LIKE ? ORDER BY d.due_date ASC`,
    `${month}%`
  );
  const compliance = await db.all(
    `SELECT c.*, o.title as grant_title FROM grant_compliance c
     JOIN grant_awards aw ON c.award_id = aw.id
     LEFT JOIN grant_opportunities o ON aw.opportunity_id = o.id
     WHERE c.due_date LIKE ? ORDER BY c.due_date ASC`,
    `${month}%`
  );
  res.json({ month, deadlines, compliance });
});

// ——— Financial Center Integration ———
router.get("/financial/:awardId", async (req, res) => {
  const summary = await getGrantFinancialSummary(req.params.awardId);
  if (!summary) return res.status(404).json({ error: "Award not found" });
  res.json(summary);
});

router.get("/budgets", async (_req, res) => {
  const db = await getDb();
  const lines = await db.all(`
    SELECT gbl.*, aw.amount as award_amount, o.title as grant_title, fb.allocated as finance_allocated, fb.spent as finance_spent
    FROM grant_budget_lines gbl
    JOIN grant_awards aw ON aw.id = gbl.award_id
    LEFT JOIN grant_opportunities o ON o.id = aw.opportunity_id
    LEFT JOIN finance_budgets fb ON fb.id = gbl.finance_budget_id
    ORDER BY o.title
  `);
  const financeBudgets = await db.all(
    "SELECT * FROM finance_budgets WHERE grant_id IS NOT NULL OR category = 'grants' ORDER BY name"
  );
  res.json({ budgetLines: lines, financeBudgets });
});

router.post("/budgets", async (req: Request, res: Response) => {
  const { award_id, lines } = req.body;
  if (!award_id || !Array.isArray(lines)) {
    return res.status(400).json({ error: "award_id and lines array required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const award = await db.get<{ finance_budget_id: string | null; amount: number }>(
    "SELECT finance_budget_id, amount FROM grant_awards WHERE id = ?", award_id
  );
  if (!award) return res.status(404).json({ error: "Award not found" });

  const created = [];
  for (const line of lines as { category: string; line_name: string; allocated: number }[]) {
    const lineId = grantId();
    await db.run(
      `INSERT INTO grant_budget_lines (id, award_id, finance_budget_id, category, line_name, allocated, spent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      lineId, award_id, award.finance_budget_id, line.category, line.line_name, line.allocated, now, now
    );
    created.push(lineId);
  }

  await logGrantActivity("award", award_id, "budget_updated", `Budget lines added (${lines.length})`, req.hqUser?.email);
  res.status(201).json({ created });
});

router.get("/labor", async (req, res) => {
  const db = await getDb();
  const { award_id } = req.query;
  let sql = `
    SELECT gla.*, p.first_name, p.last_name, p.person_type, p.organization_role,
           o.title as grant_title
    FROM grant_labor_allocations gla
    LEFT JOIN people p ON p.id = gla.person_id
    LEFT JOIN grant_awards aw ON aw.id = gla.award_id
    LEFT JOIN grant_opportunities o ON o.id = aw.opportunity_id
    WHERE 1=1`;
  const params: string[] = [];
  if (award_id) { sql += " AND gla.award_id = ?"; params.push(String(award_id)); }
  sql += " ORDER BY gla.created_at DESC";
  const rows = await db.all(sql, ...params);
  const total = (rows as { cost_cents: number }[]).reduce((s, r) => s + (r.cost_cents ?? 0), 0);
  res.json({ labor: rows, totalCost: total / 100 });
});

router.post("/labor/sync", async (req: Request, res: Response) => {
  const { award_id } = req.body;
  if (!award_id) return res.status(400).json({ error: "award_id required" });
  const db = await getDb();
  const now = new Date().toISOString();
  let synced = 0;

  const payrollItems = await db.all(`
    SELECT fpi.*, p.id as person_id, p.first_name, p.last_name, p.pay_rate, p.person_type
    FROM finance_payroll_items fpi
    JOIN people p ON p.id = fpi.person_id
    WHERE fpi.person_id IS NOT NULL
    ORDER BY fpi.created_at DESC LIMIT 50
  `);

  for (const item of payrollItems as { id: string; person_id: string; person_name: string; hours: number; gross_cents: number; net_cents: number }[]) {
    const existing = await db.get("SELECT id FROM grant_labor_allocations WHERE payroll_item_id = ? AND award_id = ?", item.id, award_id);
    if (existing) continue;

    await db.run(
      `INSERT INTO grant_labor_allocations (id, award_id, person_id, payroll_item_id, role, hours, hourly_rate, cost_cents, created_at)
       VALUES (?, ?, ?, ?, 'staff', ?, ?, ?, ?)`,
      grantId(), award_id, item.person_id, item.id, item.hours,
      item.hours > 0 ? (item.gross_cents / 100) / item.hours : 0,
      item.gross_cents, now
    );
    synced++;
  }

  await logGrantActivity("award", award_id, "labor_synced", `Synced ${synced} payroll allocations from Financial Center`, req.hqUser?.email);
  res.json({ synced });
});

router.get("/expenditures", async (req, res) => {
  const db = await getDb();
  const { award_id } = req.query;
  let sql = `
    SELECT ge.*, fe.vendor, o.title as grant_title
    FROM grant_expenditures ge
    LEFT JOIN finance_expenses fe ON fe.id = ge.finance_expense_id
    LEFT JOIN grant_awards aw ON aw.id = ge.award_id
    LEFT JOIN grant_opportunities o ON o.id = aw.opportunity_id
    WHERE 1=1`;
  const params: string[] = [];
  if (award_id) { sql += " AND ge.award_id = ?"; params.push(String(award_id)); }
  sql += " ORDER BY ge.expense_date DESC";

  const tracked = await db.all(sql, ...params);

  const financeLinked = await db.all(`
    SELECT fe.id, fe.description, fe.amount_cents, fe.category, fe.expense_date, fe.vendor, fe.grant_id,
           o.title as grant_title
    FROM finance_expenses fe
    LEFT JOIN grant_opportunities o ON o.id = fe.grant_id
    LEFT JOIN grant_awards aw ON aw.id = fe.grant_id
    WHERE fe.grant_id IS NOT NULL
    ORDER BY fe.expense_date DESC LIMIT 50
  `);

  res.json({ expenditures: tracked, financeExpenses: financeLinked });
});

// ——— Documents & Approval ———
router.post("/documents/upload", async (req: Request, res: Response) => {
  const { fileName, base64, mimeType, opportunity_id, application_id, name, doc_type, doc_category, notes } = req.body;
  if (!fileName || !base64 || !name) {
    return res.status(400).json({ error: "fileName, base64, and name are required" });
  }
  const validation = validateGrantDocumentUpload(String(fileName), String(base64), mimeType ? String(mimeType) : undefined);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  try {
    const uploadedBy = req.hqUser?.email ?? "unknown";
    const saved = await saveHqFileBase64(String(fileName), String(base64), validation.mime, uploadedBy);
    const db = await getDb();
    const now = new Date().toISOString();
    const docId = grantId();
    await db.run(
      `INSERT INTO grant_documents (id, opportunity_id, application_id, name, doc_type, doc_category, file_url, notes, status, uploaded_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      docId, opportunity_id ?? null, application_id ?? null, name, doc_type ?? "required",
      doc_category ?? doc_type ?? "attachment",
      saved.url, notes ?? `Uploaded ${saved.fileName} (${saved.size} bytes)`, now, now
    );
    await logGrantActivity("document", docId, "uploaded", `File uploaded: ${name}`, req.hqUser?.email);
    res.status(201).json({ document: await db.get("SELECT * FROM grant_documents WHERE id = ?", docId), file: saved });
  } catch (error) {
    console.error("Grant document upload error:", error);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

router.post("/documents", async (req: Request, res: Response) => {
  const { opportunity_id, application_id, name, doc_type, doc_category, file_url, notes } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const docId = grantId();
  await db.run(
    `INSERT INTO grant_documents (id, opportunity_id, application_id, name, doc_type, doc_category, file_url, notes, status, uploaded_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    docId, opportunity_id ?? null, application_id ?? null, name, doc_type ?? "required",
    doc_category ?? doc_type ?? "attachment",
    file_url ?? null, notes ?? "", now, now
  );
  await logGrantActivity("document", docId, "uploaded", `Document uploaded: ${name}`, req.hqUser?.email);
  res.status(201).json({ document: await db.get("SELECT * FROM grant_documents WHERE id = ?", docId) });
});

router.patch("/documents/:id", async (req: Request, res: Response) => {
  const { status, file_url, notes } = req.body;
  const db = await getDb();
  const now = new Date().toISOString();
  const approved_at = status === "approved" ? now : undefined;
  const approved_by = status === "approved" ? req.hqUser?.email : undefined;
  await db.run(
    `UPDATE grant_documents SET status = COALESCE(?, status), file_url = COALESCE(?, file_url),
     notes = COALESCE(?, notes), approved_at = COALESCE(?, approved_at),
     approved_by = COALESCE(?, approved_by), uploaded_at = COALESCE(uploaded_at, ?) WHERE id = ?`,
    status, file_url, notes, approved_at, approved_by, now, req.params.id
  );
  await logGrantActivity("document", req.params.id, status ?? "updated", `Document ${status ?? "updated"}`, req.hqUser?.email);
  res.json({ document: await db.get("SELECT * FROM grant_documents WHERE id = ?", req.params.id) });
});

// ——— Notifications ———
router.get("/notifications", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all("SELECT * FROM grant_notifications ORDER BY due_date ASC, created_at DESC LIMIT 50");
  res.json({ notifications: rows });
});

router.post("/notifications/generate", async (_req, res) => {
  const created = await generateGrantNotifications();
  res.json({ created });
});

router.patch("/notifications/:id/read", async (req, res) => {
  const db = await getDb();
  await db.run("UPDATE grant_notifications SET read = 1 WHERE id = ?", req.params.id);
  res.json({ notification: await db.get("SELECT * FROM grant_notifications WHERE id = ?", req.params.id) });
});

// ——— Renewals & History ———
router.get("/renewals", async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(`
    SELECT r.*, o.title as original_grant, aw.amount as original_amount
    FROM grant_renewals r
    JOIN grant_awards aw ON aw.id = r.original_award_id
    LEFT JOIN grant_opportunities o ON o.id = aw.opportunity_id
    ORDER BY r.renewal_date DESC
  `);
  res.json({ renewals: rows });
});

router.post("/renewals", async (req: Request, res: Response) => {
  const { original_award_id, renewal_date, notes } = req.body;
  if (!original_award_id || !renewal_date) {
    return res.status(400).json({ error: "original_award_id and renewal_date required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const renewalId = grantId();
  const award = await db.get<{ opportunity_id: string }>("SELECT opportunity_id FROM grant_awards WHERE id = ?", original_award_id);
  await db.run(
    `INSERT INTO grant_renewals (id, original_award_id, renewal_date, status, notes, created_at)
     VALUES (?, ?, ?, 'planned', ?, ?)`,
    renewalId, original_award_id, renewal_date, notes ?? "", now
  );
  if (award) {
    const opp = await db.get<{ title: string; funder: string; amount_max: number }>(
      "SELECT title, funder, amount_max FROM grant_opportunities WHERE id = ?", award.opportunity_id
    );
    if (opp) {
      const newOppId = grantId();
      await db.run(
        `INSERT INTO grant_opportunities (id, title, funder, description, amount_max, status, deadline, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', date('now', '+180 days'), ?, ?)`,
        newOppId, `${opp.title} (Renewal)`, opp.funder, `Renewal of previous award`, opp.amount_max, now, now
      );
      await db.run("UPDATE grant_renewals SET new_opportunity_id = ? WHERE id = ?", newOppId, renewalId);
    }
  }
  await logGrantActivity("renewal", renewalId, "planned", "Grant renewal initiated", req.hqUser?.email);
  res.status(201).json({ renewal: await db.get("SELECT * FROM grant_renewals WHERE id = ?", renewalId) });
});

router.get("/history", async (_req, res) => {
  const db = await getDb();
  const activity = await db.all("SELECT * FROM grant_activity ORDER BY created_at DESC LIMIT 75");
  const awards = await db.all(`
    SELECT aw.*, o.title, o.funder, a.title as application_title
    FROM grant_awards aw
    LEFT JOIN grant_opportunities o ON o.id = aw.opportunity_id
    LEFT JOIN grant_applications a ON a.id = aw.application_id
    ORDER BY aw.award_date DESC
  `);
  res.json({ activity, awards });
});

router.post("/ai/find", async (req, res) => {
  const { keywords, minAmount, maxAmount, division } = req.body ?? {};
  const opportunities = await searchGrantOpportunities({
    q: keywords,
    minAmount,
    maxAmount,
    division,
    limit: 25,
  });
  const db = await getDb();
  const enriched = await Promise.all(
    opportunities.map(async (o) => {
      const oppId = String((o as Record<string, unknown>).id);
      const latest = await db.get<{ score: number; grade: string }>(
        `SELECT score, grade FROM grant_opportunity_scores WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1`,
        oppId
      );
      if (latest) {
        return { ...o, eligibilityScore: latest.score, grade: latest.grade };
      }
      const scored = await scoreOpportunityEligibility(oppId, {
        divisionSlug: division,
        actorEmail: req.hqUser?.email,
      });
      return { ...o, eligibilityScore: scored?.score ?? 0, grade: scored?.grade ?? "—" };
    })
  );
  res.json({ opportunities: enriched });
});

router.post("/ai/match", async (req, res) => {
  const { applicationId } = req.body ?? {};
  if (!applicationId) return res.status(400).json({ error: "applicationId is required" });
  const db = await getDb();
  const app = await db.get<{ opportunity_id: string | null }>(
    "SELECT opportunity_id FROM grant_applications WHERE id = ?",
    applicationId
  );
  if (app?.opportunity_id) {
    const scored = await scoreOpportunityEligibility(app.opportunity_id, {
      actorEmail: req.hqUser?.email,
    });
    if (scored) {
      return res.json({
        applicationId,
        score: scored.score,
        factors: scored.factors,
        recommendation: scored.grade,
        opportunityId: app.opportunity_id,
      });
    }
  }
  const result = await matchGrantEligibility(applicationId);
  if (!result) return res.status(404).json({ error: "Application not found" });
  res.json(result);
});

router.post("/ai/write", async (req: Request, res: Response) => {
  const { prompt, applicationId, opportunityId, section } = req.body ?? {};
  if (!prompt) return res.status(400).json({ error: "prompt is required" });
  if (!applicationId || !section) {
    return res.status(400).json({ error: "applicationId and section are required for production grant writing" });
  }
  try {
    const narrative = await grantWritingAssist({
      prompt,
      applicationId,
      opportunityId,
      section,
      actorEmail: req.hqUser?.email,
    });
    res.json({ narrative, generatedAt: new Date().toISOString(), humanReviewRequired: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Grant writing assistant unavailable";
    console.error("[grant-writer] ai/write error:", message);
    res.status(400).json({ error: message });
  }
});

router.post("/ai/outcome/:awardId", async (req, res) => {
  try {
    const report = await generateGrantOutcomeReport(req.params.awardId);
    res.json({ report, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.error("Grant outcome report error:", e);
    res.status(500).json({ error: "Outcome report unavailable" });
  }
});

// ——— Funder CRM ———
router.get("/funders/dashboard", async (_req, res) => {
  res.json(await buildFunderCrmDashboard());
});

router.get("/funders", async (req, res) => {
  const stage = req.query.stage as string | undefined;
  const q = req.query.q as string | undefined;
  res.json({ funders: await listFunders({ stage, q }) });
});

router.get("/funders/:id", async (req, res) => {
  const detail = await getFunder(req.params.id);
  if (!detail) return res.status(404).json({ error: "Funder not found" });
  res.json(detail);
});

router.post("/funders", async (req, res) => {
  const { name, contact_name, contact_email, contact_phone, relationship_stage, website, address, notes } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const funder = await createFunder({ name, contact_name, contact_email, contact_phone, relationship_stage, website, address, notes });
  res.status(201).json({ funder });
});

router.patch("/funders/:id", async (req, res) => {
  const funder = await updateFunder(req.params.id, req.body);
  if (!funder) return res.status(404).json({ error: "Funder not found" });
  res.json({ funder });
});

router.post("/funders/:id/interactions", async (req, res) => {
  const { interaction_type, subject, notes, interaction_date } = req.body;
  if (!subject) return res.status(400).json({ error: "subject is required" });
  const interaction = await logFunderInteraction(req.params.id, {
    interaction_type,
    subject,
    notes,
    interaction_date,
    created_by: req.hqUser?.email,
  });
  res.status(201).json({ interaction });
});

// ——— Phase 2: IFCDC Funding Engine ———

router.get("/funding-engine/overview", async (_req, res) => {
  res.json(await buildExecutiveFundingDashboard());
});

router.get("/funding-engine/divisions", (_req, res) => {
  res.json({ divisions: IFCDC_FUNDING_DIVISIONS });
});

router.get("/funding-engine/outcomes", async (req, res) => {
  const limit = Number(req.query.limit ?? 25);
  res.json({ outcomes: await listGrantOutcomes(limit) });
});

router.post("/funding-engine/aura", async (req, res) => {
  try {
    res.json(await buildAuraFundingIntelligence({ question: req.body?.question }));
  } catch (e) {
    console.error("AURA funding intelligence error:", e);
    res.status(500).json({ error: "Funding intelligence unavailable" });
  }
});

router.get("/opportunities/search", async (req, res) => {
  const opportunities = await searchGrantOpportunities({
    q: req.query.q as string | undefined,
    status: req.query.status as string | undefined,
    minAmount: req.query.minAmount ? Number(req.query.minAmount) : undefined,
    maxAmount: req.query.maxAmount ? Number(req.query.maxAmount) : undefined,
    division: req.query.division as string | undefined,
    programArea: req.query.programArea as string | undefined,
    geography: req.query.geography as string | undefined,
    funderType: req.query.funderType as string | undefined,
    deadlineWithinDays: req.query.deadlineWithinDays ? Number(req.query.deadlineWithinDays) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.json({ opportunities });
});

router.post("/opportunities/:id/score", async (req, res) => {
  const useDual = req.body?.dual !== false;
  if (useDual) {
    const result = await scoreOpportunityDual(req.params.id, {
      divisionSlug: req.body?.divisionSlug,
      actorEmail: req.hqUser?.email,
    });
    if (!result) return res.status(404).json({ error: "Opportunity not found" });
    return res.json(result);
  }
  const result = await scoreOpportunityEligibility(req.params.id, {
    divisionSlug: req.body?.divisionSlug,
    actorEmail: req.hqUser?.email,
  });
  if (!result) return res.status(404).json({ error: "Opportunity not found" });
  res.json(result);
});

router.patch("/opportunities/:id/funding-status", async (req, res) => {
  const { fundingStatus } = req.body ?? {};
  if (!fundingStatus) return res.status(400).json({ error: "fundingStatus is required" });
  const result = await updateOpportunityFundingStatus(req.params.id, fundingStatus, req.hqUser?.email);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get("/applications/:id/workflow", async (req, res) => {
  res.json(await getApplicationWorkflow(req.params.id));
});

router.post("/applications/:id/workflow", async (req, res) => {
  const { action, reason, amountAwarded } = req.body ?? {};
  if (!action || !["submit", "review", "award", "deny"].includes(action)) {
    return res.status(400).json({ error: "action must be submit, review, award, or deny" });
  }
  const result = await advanceApplicationWorkflow(req.params.id, action, {
    reason,
    amountAwarded: amountAwarded != null ? Number(amountAwarded) : undefined,
    actorEmail: req.hqUser?.email,
  });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// ——— Grant Center v2 ———

router.get("/funding-engine/v2/pipeline", async (_req, res) => {
  res.json(await buildV2FundingPipeline());
});

router.get("/funding-engine/v2/dashboard", async (_req, res) => {
  res.json(await buildFundingEngineDashboard());
});

router.get("/funding-engine/v2/finance", async (_req, res) => {
  res.json(await buildGrantFinanceConnection());
});

router.get("/funding-engine/v2/recommendations", async (_req, res) => {
  res.json(await buildAuraFundingRecommendations());
});

router.get("/funding-engine/v2/analytics", async (_req, res) => {
  res.json(await buildExecutiveFundingAnalytics());
});

router.get("/funding-engine/v2/divisions/profiles", async (_req, res) => {
  res.json({ profiles: await buildDivisionFundingProfiles(), generatedAt: new Date().toISOString() });
});

router.get("/funding-engine/v2/divisions/:slug/profile", async (req, res) => {
  const profile = await getDivisionFundingProfile(req.params.slug);
  if (!profile) return res.status(404).json({ error: "Division not found" });
  res.json({ profile });
});

router.post("/funding-engine/v2/match", async (req, res) => {
  const { divisionSlug } = req.body ?? {};
  if (!divisionSlug) return res.status(400).json({ error: "divisionSlug is required" });
  res.json(await matchGrantsForDivision(divisionSlug, { actorEmail: req.hqUser?.email }));
});

router.post("/funding-engine/v2/aura", async (req, res) => {
  try {
    res.json(await buildAuraFundingIntelligenceV2({ question: req.body?.question, actorEmail: req.hqUser?.email }));
  } catch (e) {
    console.error("AURA v2 funding intelligence error:", e);
    res.status(500).json({ error: "Funding intelligence unavailable" });
  }
});

router.get("/opportunities/live", async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  const fundingStatus = req.query.fundingStatus as string | undefined;
  res.json({
    opportunities: await listLiveGrantOpportunities(limit, { fundingStatus }),
    generatedAt: new Date().toISOString(),
  });
});

router.get("/documents/checklist", async (req, res) => {
  const applicationId = req.query.application_id as string | undefined;
  res.json(await listDocumentChecklist(applicationId));
});

// ——— Grant Center v3 — Intelligent Funding Engine ———

router.get("/funding-engine/v3/platform", async (_req, res) => {
  res.json(await buildIntelligentFundingPlatform());
});

router.get("/funding-engine/v3/dashboard", async (_req, res) => {
  res.json(await buildExecutiveIntelligentDashboardV3());
});

router.get("/funding-engine/v3/discovery", async (req, res) => {
  const limit = Number(req.query.limit ?? 20);
  const divisionSlug = req.query.divisionSlug as string | undefined;
  res.json(await discoverAndRankGrants({
    limit,
    divisionSlug,
    actorEmail: req.hqUser?.email,
  }));
});

router.post("/funding-engine/v3/discovery", async (req, res) => {
  const { limit, divisionSlug } = req.body ?? {};
  res.json(await discoverAndRankGrants({
    limit: limit ? Number(limit) : 20,
    divisionSlug,
    actorEmail: req.hqUser?.email,
  }));
});

router.get("/funding-engine/v3/profiles", async (_req, res) => {
  res.json({ profiles: await buildProgramFundingProfilesV3(), generatedAt: new Date().toISOString() });
});

router.get("/funding-engine/v3/renewals", async (_req, res) => {
  res.json(await buildRenewalCalendar());
});

router.get("/funding-engine/v3/documents", async (req, res) => {
  res.json(await buildGrantDocumentCenter({
    applicationId: req.query.application_id as string | undefined,
    opportunityId: req.query.opportunity_id as string | undefined,
  }));
});

router.get("/funding-engine/v3/aura/questions", (_req, res) => {
  res.json({ questions: AURA_EXECUTIVE_QUESTIONS });
});

router.post("/funding-engine/v3/aura", async (req, res) => {
  try {
    res.json(await auraExecutiveFundingIntelligence({
      question: req.body?.question,
      actorEmail: req.hqUser?.email,
    }));
  } catch (e) {
    console.error("AURA v3 executive intelligence error:", e);
    res.status(500).json({ error: "Executive funding intelligence unavailable" });
  }
});

// ——— Grant Center v4 — Intelligent Funding Operations ———

router.get("/funding-engine/v4/platform", async (_req, res) => {
  res.json(await buildIntelligentFundingOperationsPlatform());
});

router.get("/funding-engine/v4/dashboard", async (_req, res) => {
  res.json(await buildExecutiveOperationsDashboard());
});

router.get("/funding-engine/v4/lifecycle", async (_req, res) => {
  res.json(await buildGrantLifecyclePipeline());
});

router.patch("/lifecycle/:entityType/:id", async (req, res) => {
  const entityType = req.params.entityType as "opportunity" | "application" | "award";
  if (!["opportunity", "application", "award"].includes(entityType)) {
    return res.status(400).json({ error: "entityType must be opportunity, application, or award" });
  }
  const { lifecycleStage } = req.body ?? {};
  if (!lifecycleStage) return res.status(400).json({ error: "lifecycleStage is required" });
  const result = await updateGrantLifecycleStage({
    entityType,
    entityId: req.params.id,
    lifecycleStage,
    actorEmail: req.hqUser?.email,
  });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get("/funding-engine/v4/calendar", async (req, res) => {
  const daysAhead = req.query.days ? Number(req.query.days) : 90;
  res.json(await buildFundingOperationsCalendar({ daysAhead }));
});

router.get("/funding-engine/v4/programs", async (_req, res) => {
  res.json({ programs: await buildProgramIntegrationPortfolios(), generatedAt: new Date().toISOString() });
});

router.get("/funding-engine/v4/forecast", async (_req, res) => {
  res.json(await buildOrganizationFundingForecast());
});

router.get("/funding-engine/v4/aura/questions", (_req, res) => {
  res.json({ questions: AURA_V4_ADVISOR_QUESTIONS });
});

router.post("/funding-engine/v4/aura", async (req, res) => {
  try {
    res.json(await auraExecutiveAdvisorV4({
      question: req.body?.question,
      actorEmail: req.hqUser?.email,
    }));
  } catch (e) {
    console.error("AURA v4 advisor error:", e);
    res.status(500).json({ error: "Executive advisor unavailable" });
  }
});

// ——— Grant Center v5 — Funding Intelligence Engine ———

router.get("/funding-engine/v5/platform", async (_req, res) => {
  res.json(await buildFundingIntelligencePlatform());
});

router.get("/funding-engine/v5/lifecycle", async (_req, res) => {
  res.json(await getV5LifecyclePipeline());
});

router.get("/funding-engine/v5/pipeline", async (_req, res) => {
  res.json(await getV5FundingPipeline());
});

router.get("/funding-engine/v5/calendar", async (req, res) => {
  const days = req.query.days ? Number(req.query.days) : 90;
  res.json(await getV5OperationsCalendar({ daysAhead: days }));
});

router.get("/funding-engine/v5/profiles", async (_req, res) => {
  res.json(await getV5ProgramProfiles());
});

router.get("/funding-engine/v5/programs", async (_req, res) => {
  res.json(await getV5ProgramIntegration());
});

router.get("/funding-engine/v5/analytics", async (_req, res) => {
  res.json(await getV5ExecutiveAnalytics());
});

router.get("/funding-engine/v5/documents", async (req, res) => {
  res.json(
    await getV5DocumentCenter({
      applicationId: req.query.applicationId ? String(req.query.applicationId) : undefined,
      opportunityId: req.query.opportunityId ? String(req.query.opportunityId) : undefined,
    }),
  );
});

router.get("/funding-engine/v5/national", async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json({ opportunities: await listNationalGrantDatabase(limit), generatedAt: new Date().toISOString() });
});

router.get("/funding-engine/v5/match-all", async (req, res) => {
  res.json(await matchGrantsAllDivisions({
    limitPerDivision: req.query.limit ? Number(req.query.limit) : 5,
    actorEmail: req.hqUser?.email,
  }));
});

router.post("/opportunities/:id/score-v5", async (req, res) => {
  const result = await scoreGrantOpportunityV5(req.params.id, {
    divisionSlug: req.body?.divisionSlug,
    actorEmail: req.hqUser?.email,
  });
  if (!result) return res.status(404).json({ error: "Opportunity not found" });
  res.json(result);
});

router.get("/applications/:id/workspace", async (req, res) => {
  const workspace = await buildFullApplicationWorkspace(req.params.id, { actorEmail: req.hqUser?.email });
  if (!workspace) return res.status(404).json({ error: "Application not found" });
  res.json(workspace);
});

router.post("/applications/:id/ai-assist", async (req, res) => {
  const { section, prompt } = req.body ?? {};
  if (!section) return res.status(400).json({ error: "section is required" });
  res.json(await aiAssistApplicationSection({
    applicationId: req.params.id,
    section,
    prompt,
    actorEmail: req.hqUser?.email,
  }));
});

router.get("/applications/:id/proposal-budget", async (req, res) => {
  const budget = await getOrCreateProposalBudget(req.params.id);
  if (!budget) return res.status(404).json({ error: "Application not found" });
  res.json({ budget });
});

router.put("/applications/:id/proposal-budget", async (req, res) => {
  const result = await updateProposalBudget(req.params.id, req.body ?? {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get("/funding-engine/v5/intelligence", async (_req, res) => {
  res.json(await buildExecutiveIntelligenceV5());
});

router.get("/funding-engine/v5/compliance", async (_req, res) => {
  res.json(await buildComplianceDashboard());
});

router.get("/funding-engine/v5/renewal-reporting", async (_req, res) => {
  res.json(await buildRenewalReportingTracker());
});

router.get("/funding-engine/v5/projections", async (req, res) => {
  const years = req.query.years ? Number(req.query.years) : 5;
  res.json(await buildMultiYearProjections(years));
});

router.get("/funding-engine/v5/performance", async (_req, res) => {
  res.json(await buildPerformanceMetrics());
});

router.post("/funding-engine/v5/aura", async (req, res) => {
  try {
    res.json(await auraFundingIntelligenceAdvisorV5({
      question: req.body?.question,
      actorEmail: req.hqUser?.email,
    }));
  } catch (e) {
    console.error("AURA v5 funding intelligence error:", e);
    res.status(500).json({ error: "Funding intelligence advisor unavailable" });
  }
});

router.get("/funding-engine/v5/pipeline/board", async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 25;
  res.json(await buildPipelineKanbanBoard(limit));
});

// ——— Enterprise Funding Pipeline ———
router.get("/pipeline/enterprise/board", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    res.json(await buildEnterprisePipelineBoard(limit));
  } catch (e) {
    console.error("pipeline/enterprise/board:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Pipeline board failed" });
  }
});

router.get("/pipeline/enterprise/metrics", async (_req, res) => {
  try {
    res.json(await buildPipelineMetricsDashboard());
  } catch (e) {
    console.error("pipeline/enterprise/metrics:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Pipeline metrics failed" });
  }
});

router.post("/pipeline/enterprise/sync", async (req: Request, res: Response) => {
  try {
    res.json(await runLivePipelineSync({ actorEmail: req.hqUser?.email }));
  } catch (e) {
    console.error("pipeline/enterprise/sync:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Pipeline sync failed" });
  }
});

router.get("/pipeline/enterprise/intelligence/:opportunityId", async (req, res) => {
  try {
    const intel = await buildOpportunityPipelineIntelligence(req.params.opportunityId, { actorEmail: req.hqUser?.email });
    if (!intel) return res.status(404).json({ error: "Opportunity not found" });
    res.json(intel);
  } catch (e) {
    console.error("pipeline/enterprise/intelligence:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Pipeline intelligence failed" });
  }
});

router.get("/pipeline/enterprise/founder", async (req, res) => {
  try {
    res.json(await buildFounderCommandCenter({
      program: req.query.program ? String(req.query.program) : undefined,
      agency: req.query.agency ? String(req.query.agency) : undefined,
      minAmount: req.query.minAmount ? Number(req.query.minAmount) : undefined,
      maxAmount: req.query.maxAmount ? Number(req.query.maxAmount) : undefined,
      status: req.query.status ? String(req.query.status) as never : undefined,
      deadlineWithinDays: req.query.deadlineWithinDays ? Number(req.query.deadlineWithinDays) : undefined,
      priority: req.query.priority ? String(req.query.priority) : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }));
  } catch (e) {
    console.error("pipeline/enterprise/founder:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Founder command center failed" });
  }
});

router.post("/pipeline/enterprise/founder/:applicationId/decision", async (req: Request, res: Response) => {
  const decision = req.body?.decision;
  if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "decision must be approve or reject" });
  res.json(await setFounderPipelineDecision(req.params.applicationId, decision, {
    actorEmail: req.hqUser?.email,
    note: req.body?.note,
    priority: req.body?.priority,
  }));
});

router.post("/pipeline/enterprise/applications/:id/priority", async (req: Request, res: Response) => {
  const priority = req.body?.priority;
  if (!["high", "medium", "low"].includes(priority)) return res.status(400).json({ error: "priority must be high, medium, or low" });
  res.json(await setApplicationPriority(req.params.id, priority, req.hqUser?.email));
});

router.post("/pipeline/enterprise/transition", async (req: Request, res: Response) => {
  const { entityType, entityId, toStage, note } = req.body ?? {};
  if (!entityType || !entityId || !toStage) return res.status(400).json({ error: "entityType, entityId, toStage required" });
  res.json(await transitionFundingPipelineStage({
    entityType,
    entityId: String(entityId),
    toStage: String(toStage) as never,
    actorEmail: req.hqUser?.email,
    note,
  }));
});

router.get("/pipeline/enterprise/stages", async (_req, res) => {
  res.json({ stages: FUNDING_PIPELINE_STAGES, labels: FUNDING_PIPELINE_LABELS });
});

router.post("/pipeline/enterprise/notifications/scan", async (_req, res) => {
  res.json({ created: await runPipelineNotificationScan() });
});

router.post("/funding-engine/v5/pipeline/transition", async (req, res) => {
  const { entityType, entityId, toStage, note } = req.body ?? {};
  if (!entityType || !entityId || !toStage) {
    return res.status(400).json({ error: "entityType, entityId, and toStage are required" });
  }
  const result = await transitionPipelineEntity({
    entityType,
    entityId,
    toStage,
    note,
    actorEmail: req.hqUser?.email,
  });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.get("/funding-engine/v5/pipeline/automation/rules", async (_req, res) => {
  res.json({ rules: await listPipelineAutomationRules(), generatedAt: new Date().toISOString() });
});

router.get("/funding-engine/v5/pipeline/automation/log", async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  res.json({ log: await listPipelineAutomationLog(limit), generatedAt: new Date().toISOString() });
});

router.post("/funding-engine/v5/pipeline/automation/scan-deadlines", async (req, res) => {
  const days = req.body?.daysAhead ? Number(req.body.daysAhead) : 7;
  res.json(await scanPipelineDeadlineAlerts(days));
});

router.get("/funding-engine/v5/workforce/economic-development", async (_req, res) => {
  const { fetchDivisionSnapshot } = await import("../hq/divisionIntegrationLayer");
  const snapshot = await fetchDivisionSnapshot("economic_development");
  if (!snapshot) return res.status(404).json({ error: "Economic Development division not found" });
  res.json(snapshot);
});

router.get("/funding-engine/v5/connectors", async (_req, res) => {
  res.json(buildDivisionConnectorManifest());
});

export default router;
