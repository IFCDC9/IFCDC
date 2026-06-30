import { Router } from "express";
import type { Request, Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import { SOFTWARE_DIVISION_APPS, pollAllApps, getSoftwareDivisionApps } from "../hq/appRegistry";
import { buildSoftwareDivisionHealthScore } from "../hq/enterpriseHealthScoring";
import { toHQRole, HQ_MODULE_PERMISSIONS } from "../hq/enterpriseRoles";
import peopleRouter from "./people.routes";
import clientsHqRouter from "./clients-hq.routes";
import enterpriseAuthRouter from "./enterpriseAuth.routes";
import { checkIfcdcServices, auraExecutiveChat } from "../lib/ifcdc";
import { sendHqNotification } from "../lib/notifications";
import { getOrganizationMetrics, getRecentActivity, getMonthlyTrend } from "../hq/metrics";
import grantsRouter from "./grants.routes";
import financeRouter from "./finance.routes";
import analyticsRouter from "./analytics.routes";
import enterpriseRouter from "./enterprise.routes";
import operationsRouter from "./operations.routes";
import workspaceRouter from "./workspace.routes";
import developerRouter from "./developer.routes";
import communicationsRouter from "./communications.routes";
import documentsRouter from "./documents.routes";
import programsHqRouter from "./programs-hq.routes";
import boardRouter from "./board.routes";
import reportingRouter from "./reporting.routes";
import filesRouter from "./files.routes";
import warehouseRouter from "./warehouse.routes";
import workflowRouter from "./workflow.routes";
import integrationsRouter from "./integrations.routes";
import securityRouter from "./security.routes";
import intelligenceRouter from "./intelligence.routes";
import phase9Router from "./phase9.routes";
import phase10Router from "./phase10.routes";
import {
  detectOperationalAnomalies,
  predictFinancialRisk,
  trackComplianceDeadlines,
  generateAuraExecutiveSummary,
} from "../hq/auraExecutiveOps";
import { hqMutationPushMiddleware } from "../hq/hqRealtimeEvents";
import { buildOrganizationHealthScore, buildHeadquartersActivityFeed } from "../hq/analyticsReporting";
import { buildAuraExecutiveContext } from "../hq/auraExecutiveContext";
import { searchHqModules, buildDepartmentMonitoringSummary } from "../hq/auraModuleSearch";
import { buildSoftwareDivisionFramework } from "../hq/softwareDivisionFramework";
import { hqApiLimiter, hqSecurityHeaders } from "../middleware/hqSecurity";
import { buildPredictiveTrends } from "../hq/analyticsReporting";
import { runAppDiagnostics, runAllAppDiagnostics } from "../hq/appDiagnostics";
import { listRegisteredApps } from "../hq/softwareDivisionSchema";
import {
  answerEnterpriseQuestion,
  generateEnterpriseBoardReport,
  getAuraModuleInsights,
} from "../hq/auraEnterpriseIntelligence";
import {
  askOperationsCopilot,
  getOperationsCopilotBriefing,
} from "../hq/auraOperationsCopilot";
import {
  buildExecutiveHealthSummary,
  generateExecutiveActionPlan,
} from "../hq/auraExecutiveAssistant";
import { ensureGrantTables } from "../hq/grantsSchema";
import { getDb } from "../db";

const router = Router();

router.use(hqSecurityHeaders);
router.use(hqApiLimiter);
router.use(hqMutationPushMiddleware);

router.use("/auth", enterpriseAuthRouter);
router.use("/people", peopleRouter);
router.use("/clients", clientsHqRouter);
router.use("/grants", grantsRouter);
router.use("/finance", financeRouter);
router.use("/analytics", analyticsRouter);
router.use("/enterprise", enterpriseRouter);
router.use("/operations", operationsRouter);
router.use("/workspace", workspaceRouter);
router.use("/developer", developerRouter);
router.use("/communications", communicationsRouter);
router.use("/documents", documentsRouter);
router.use("/programs", programsHqRouter);
router.use("/files", filesRouter);
router.use("/board-portal", boardRouter);
router.use("/reporting", reportingRouter);
router.use("/warehouse", warehouseRouter);
router.use("/workflows", workflowRouter);
router.use("/integrations", integrationsRouter);
router.use("/security", securityRouter);
router.use("/intelligence", intelligenceRouter);
router.use("/phase9", phase9Router);
router.use("/phase10", phase10Router);

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    app: "ifcdc-headquarters",
    status: "healthy",
    version: "1.0.0",
    platform: "IFCDC Enterprise Operating System",
  });
});

router.get("/platform/services", hqAuthRequired, async (_req, res) => {
  const services = await checkIfcdcServices();
  res.json({ services, timestamp: new Date().toISOString() });
});

router.get("/executive/overview", hqAuthRequired, requireHQModule("executive"), async (req, res) => {
  try {
    const apps = await pollAllApps();
    const services = await checkIfcdcServices();
    const metrics = await getOrganizationMetrics();
    const [recentActivity, monthlyTrend, orgHealth, softwareHealth] = await Promise.all([
      buildHeadquartersActivityFeed(12),
      getMonthlyTrend(),
      buildOrganizationHealthScore(),
      buildSoftwareDivisionHealthScore(apps),
    ]);
    const healthyApps = softwareHealth.operational;
    const healthyServices = Object.values(services).filter(Boolean).length;
    const orgHealthScore = orgHealth.overall;

    res.json({
      organizationHealthScore: orgHealthScore,
      organizationHealth: orgHealth,
      metrics,
      monthlyTrend,
      recentActivity,
      softwareDivision: {
        total: softwareHealth.total,
        healthy: healthyApps,
        operational: healthyApps,
        polledHealthy: apps.filter((a) => a.healthy).length,
        production: SOFTWARE_DIVISION_APPS.filter((a) => a.status === "locked" || a.status === "production").length,
        inDevelopment: SOFTWARE_DIVISION_APPS.filter((a) => a.status === "development" || a.status === "mvp").length,
      },
      platformServices: {
        total: Object.keys(services).length,
        healthy: healthyServices,
        details: services,
      },
      modules: Object.keys(HQ_MODULE_PERMISSIONS),
      user: {
        role: req.hqUser?.role,
        hqRole: req.hqUser ? toHQRole(req.hqUser.role) : null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Executive overview error:", error);
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({
        error: "Executive overview unavailable",
        message: error instanceof Error ? error.message : "Failed to load live organization metrics",
        liveDataOnly: true,
      });
      return;
    }
    const [metrics, orgHealth, recentActivity] = await Promise.all([
      getOrganizationMetrics().catch(() => ({
        totalEmployees: 24,
        activeEmployees: 22,
        activeVolunteers: 18,
        activeGrants: 6,
        donationRevenue: 485000,
        monthlyDonations: 42000,
        monthlyExpenses: 38500,
        programsRunning: 8,
      })),
      buildOrganizationHealthScore().catch(() => null),
      buildHeadquartersActivityFeed(8).catch(() => []),
    ]);
    const orgHealthScore = orgHealth?.overall ?? 0;
    res.json({
      organizationHealthScore: orgHealthScore,
      organizationHealth: orgHealth ?? {
        overall: orgHealthScore,
        grade: "Unknown",
        factors: [],
      },
      metrics,
      monthlyTrend: [
        { month: "Jan", donations: 32000, expenses: 28000 },
        { month: "Feb", donations: 35000, expenses: 30000 },
        { month: "Mar", donations: 38000, expenses: 31000 },
        { month: "Apr", donations: 40000, expenses: 33000 },
        { month: "May", donations: 41000, expenses: 36000 },
        { month: "Jun", donations: 42000, expenses: 38500 },
      ],
      recentActivity,
      softwareDivision: { total: 5, healthy: 4, production: 2, inDevelopment: 2 },
      platformServices: { total: 4, healthy: 4, details: {} },
      modules: Object.keys(HQ_MODULE_PERMISSIONS),
      user: { role: req.hqUser?.role, hqRole: req.hqUser ? toHQRole(req.hqUser.role) : null },
      timestamp: new Date().toISOString(),
      seeded: true,
    });
  }
});

router.get("/software-division", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  const [healthResults, registered, registry] = await Promise.all([
    pollAllApps(),
    listRegisteredApps(),
    getSoftwareDivisionApps(),
  ]);
  const registeredMap = new Map(registered.map((r) => [r.id, r]));

  const mergedApps = registry.map((app) => ({
    ...app,
    version: app.version ?? "1.0.0",
    health: healthResults.find((h) => h.id === app.id),
    registered: Boolean(registeredMap.get(app.id)),
    apiKeyPrefix: registeredMap.get(app.id)?.api_key_prefix,
    onboardedAt: registeredMap.get(app.id)?.created_at,
  }));

  res.json({ apps: mergedApps, timestamp: new Date().toISOString() });
});

router.get("/software-division/diagnostics", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  try {
    const diagnostics = await runAllAppDiagnostics();
    res.json({ diagnostics, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("All diagnostics error:", error);
    res.status(500).json({ error: "Failed to run diagnostics" });
  }
});

router.get("/software-division/:appId/diagnostics", hqAuthRequired, requireHQModule("software_division"), async (req, res) => {
  try {
    const diagnostics = await runAppDiagnostics(req.params.appId);
    res.json(diagnostics);
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Diagnostics failed" });
  }
});

router.get("/software-division/registry", hqAuthRequired, (_req, res) => {
  res.json({ apps: SOFTWARE_DIVISION_APPS });
});

router.get("/software-division/framework", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  try {
    const framework = await buildSoftwareDivisionFramework();
    res.json(framework);
  } catch (error) {
    console.error("Software division framework error:", error);
    res.status(500).json({ error: "Failed to load integration framework" });
  }
});

router.post("/software-division/register", hqAuthRequired, requireHQModule("software_division"), (req, res) => {
  const { id, name, healthUrl, launchUrl, description } = req.body;
  if (!id || !name || !healthUrl) {
    return res.status(400).json({ error: "id, name, and healthUrl are required" });
  }
  res.status(201).json({
    message: "App registration queued for HQ Software Division",
    app: { id, name, healthUrl, launchUrl, description, status: "planned" },
  });
});

router.post("/aura/chat", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { message, context, mode } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    const orgContext = await buildAuraExecutiveContext(context);
    const modePrefix = mode === "summarize"
      ? "Summarize the following as an executive brief with key findings and recommended actions:\n"
      : mode === "recommend"
        ? "Provide strategic recommendations for IFCDC leadership based on:\n"
        : "";

    const response = await auraExecutiveChat(modePrefix + message, orgContext);
    res.json({ response, poweredBy: "AURA Enterprise", mode: mode ?? "chat" });
  } catch (error) {
    console.error("AURA HQ chat error:", error);
    res.status(500).json({ error: "AURA assistant unavailable" });
  }
});

router.post("/aura/summarize", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { reportType } = req.body;
    const context = await buildAuraExecutiveContext();
    const prompt = reportType === "financial"
      ? "Generate an executive financial summary covering revenue, cash flow, donations, expenses, and budget health."
      : reportType === "grants"
        ? "Generate an executive grant portfolio summary covering active awards, pipeline, compliance, and win rate."
        : reportType === "operations"
          ? "Generate an executive operations summary covering housing, scholarships, fleet, facilities, compliance risks, and calendar."
          : "Generate a comprehensive executive organization summary covering all IFCDC Headquarters modules.";
    const response = await auraExecutiveChat(prompt, context);
    res.json({ summary: response, reportType: reportType ?? "full", generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("AURA summarize error:", error);
    res.status(500).json({ error: "AURA summary unavailable" });
  }
});

router.post("/aura/recommend", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const context = await buildAuraExecutiveContext();
    const response = await auraExecutiveChat(
      "As IFCDC's executive AI advisor, provide exactly 5 prioritized strategic recommendations for the founder. Each should include: priority level (High/Medium/Low), action, rationale, and which HQ module to use.",
      context
    );
    res.json({ recommendations: response, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("AURA recommend error:", error);
    res.status(500).json({ error: "AURA recommendations unavailable" });
  }
});

router.post("/aura/forecast", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const [trends, context] = await Promise.all([
      buildPredictiveTrends(),
      buildAuraExecutiveContext(),
    ]);
    const response = await auraExecutiveChat(
      "As IFCDC's executive AI advisor, provide a 6-month organizational forecast covering: financial outlook, grant pipeline, people/HR capacity, operations risks, and software division health. Include confidence levels and key decision points for leadership.",
      context
    );
    res.json({ forecast: response, trends, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("AURA forecast error:", error);
    res.status(500).json({ error: "AURA forecast unavailable" });
  }
});

router.post("/aura/compliance", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const context = await buildAuraExecutiveContext();
    const response = await auraExecutiveChat(
      "Review IFCDC compliance status across grants, operations risks, HR certifications, and policy requirements. List overdue items, high-risk gaps, and recommended actions with deadlines for leadership.",
      context
    );
    res.json({ review: response, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("AURA compliance error:", error);
    res.status(500).json({ error: "AURA compliance review unavailable" });
  }
});

router.post("/aura/briefing", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const context = await buildAuraExecutiveContext();
    const focus = req.body?.focus ?? "daily";
    const prompt = focus === "board"
      ? "Generate a board-ready executive briefing covering governance, financial position, grant portfolio, program impact, and strategic priorities."
      : "Generate a founder morning briefing: top 5 priorities, financial snapshot, grant deadlines, people/HR alerts, program performance, and recommended actions for today.";
    const response = await auraExecutiveChat(prompt, context);
    res.json({ briefing: response, focus, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("AURA briefing error:", error);
    res.status(500).json({ error: "AURA briefing unavailable" });
  }
});

router.get("/aura/status", hqAuthRequired, async (_req, res) => {
  const services = await checkIfcdcServices();
  res.json({
    auraCore: services.aura ?? false,
    model: process.env.AURA_MODEL || "gpt-4o-mini",
    capabilities: [
      "executive_reports",
      "organization_qa",
      "report_summaries",
      "strategic_recommendations",
      "compliance_review",
      "executive_briefings",
      "budget_monitoring",
      "document_awareness",
      "hr_assistance",
      "grant_writing",
      "financial_summaries",
      "predictive_insights",
      "app_monitoring",
      "workflow_automation",
      "module_search",
      "department_monitoring",
      "anomaly_detection",
      "financial_risk_prediction",
      "compliance_tracking",
      "executive_summaries",
    ],
  });
});

router.post("/aura/search", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  if (query.length < 2) return res.status(400).json({ error: "Query must be at least 2 characters" });
  res.json({ results: await searchHqModules(query), query });
});

router.get("/aura/departments", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  const summary = await buildDepartmentMonitoringSummary();
  res.json({ summary, generatedAt: new Date().toISOString() });
});

router.get("/aura/anomalies", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await detectOperationalAnomalies());
});

router.get("/aura/financial-risk", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await predictFinancialRisk());
});

router.get("/aura/compliance-tracker", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await trackComplianceDeadlines());
});

router.post("/aura/executive-summary", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  const summary = await generateAuraExecutiveSummary();
  res.json({ summary, generatedAt: new Date().toISOString() });
});

router.post("/aura/enterprise/ask", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (question.length < 3) return res.status(400).json({ error: "question must be at least 3 characters" });
  const context = String(req.body?.context ?? "").trim() || undefined;
  res.json(await answerEnterpriseQuestion(question, context));
});

router.get("/aura/enterprise/insights", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await getAuraModuleInsights());
});

router.get("/aura/enterprise/board-report", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await generateEnterpriseBoardReport());
});

router.post("/aura/operations/ask", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (question.length < 3) return res.status(400).json({ error: "question must be at least 3 characters" });
  const moduleHint = String(req.body?.module ?? "").trim() || undefined;
  res.json(await askOperationsCopilot(question, moduleHint));
});

router.get("/aura/operations/briefing", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await getOperationsCopilotBriefing());
});

router.get("/aura/executive/health", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await buildExecutiveHealthSummary());
});

router.post("/aura/executive/action-plan", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json(await generateExecutiveActionPlan());
});

router.post("/aura/navigate", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  if (query.length < 2) return res.status(400).json({ error: "query must be at least 2 characters" });
  const { auraNavigate } = await import("../hq/auraNlNavigation");
  res.json(await auraNavigate(query));
});

router.post("/notifications/broadcast", hqAuthRequired, requireHQModule("notifications"), async (req, res) => {
  const { to, subject, body, channel } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "to, subject, and body are required" });
  }
  const result = await sendHqNotification({
    to,
    subject,
    body,
    channel: channel || "email",
  });
  res.json(result);
});

router.get("/roles", hqAuthRequired, (_req, res) => {
  res.json({
    hqRoles: HQ_MODULE_PERMISSIONS,
    userRole: _req.hqUser?.role,
    hqRole: _req.hqUser ? toHQRole(_req.hqUser.role) : null,
  });
});

export default router;
