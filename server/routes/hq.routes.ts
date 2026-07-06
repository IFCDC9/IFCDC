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
import { listRegisteredApps, registerSoftwareApp, updateSoftwareApp, deleteSoftwareApp } from "../hq/softwareDivisionSchema";
import { createPackageCache } from "../hq/packageCache";
import { logDeveloperAudit } from "../hq/hqDeveloperAudit";
import { notifyHqDataChange } from "../hq/hqRealtimeEvents";
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
    const { buildExecutiveOverviewSafe } = await import("../hq/executiveOverviewEngine");
    res.json(await buildExecutiveOverviewSafe(req.hqUser));
  } catch (error) {
    console.error("Executive overview route error:", error);
    const { emptyExecutiveOverview } = await import("../hq/executiveOverviewEngine");
    res.json(
      emptyExecutiveOverview({
        role: req.hqUser?.role,
        hqRole: req.hqUser ? toHQRole(req.hqUser.role) : null,
      })
    );
  }
});

const softwareDivisionCache = createPackageCache<{ apps: unknown[]; timestamp: string }>(30_000);

router.get("/software-division", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  try {
    const payload = await softwareDivisionCache.get("all", async () => {
      const [healthResults, registered, registry] = await Promise.all([
        Promise.race([
          pollAllApps(),
          new Promise<Awaited<ReturnType<typeof pollAllApps>>>((resolve) =>
            setTimeout(() => resolve([]), 8_000)
          ),
        ]),
        listRegisteredApps(),
        getSoftwareDivisionApps(),
      ]);
      const registeredMap = new Map(registered.map((r) => [r.id, r]));

      const mergedApps = registry.map((app) => {
        const health = healthResults.find((h) => h.id === app.id);
        return {
          ...app,
          version: app.version ?? "1.0.0",
          health: health ?? {
            id: app.id,
            healthy: false,
            latencyMs: 0,
            version: app.version,
            error: "Health check timed out or unavailable",
          },
          registered: Boolean(registeredMap.get(app.id)),
          apiKeyPrefix: registeredMap.get(app.id)?.api_key_prefix,
          onboardedAt: registeredMap.get(app.id)?.created_at,
        };
      });

      return { apps: mergedApps, timestamp: new Date().toISOString() };
    });
    res.json(payload);
  } catch (error) {
    console.error("Software division error:", error);
    const registry = await getSoftwareDivisionApps();
    res.json({
      apps: registry.map((app) => ({
        ...app,
        version: app.version ?? "1.0.0",
        health: { id: app.id, healthy: false, latencyMs: 0, error: "Software Division API degraded" },
        registered: false,
      })),
      timestamp: new Date().toISOString(),
      degraded: true,
    });
  }
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

router.post("/software-division/register", hqAuthRequired, requireHQModule("software_division"), async (req, res) => {
  try {
    const { id, name, healthUrl, launchUrl, description } = req.body ?? {};
    if (!id || !name || !healthUrl) {
      return res.status(400).json({ error: "id, name, and healthUrl are required" });
    }
    if (!/^[a-z0-9-]+$/.test(String(id))) {
      return res.status(400).json({ error: "id must be lowercase alphanumeric with hyphens only" });
    }

    const { app, apiKey } = await registerSoftwareApp({
      id: String(id),
      name: String(name),
      description: description ? String(description) : undefined,
      healthUrl: String(healthUrl),
      launchUrl: launchUrl ? String(launchUrl) : undefined,
      createdBy: req.hqUser!.id,
    });

    await logDeveloperAudit({
      appId: app.id,
      eventType: "app.registered",
      actorId: req.hqUser!.id,
      actorEmail: req.hqUser!.email,
      detail: `Registered ${app.name} via Software Division`,
    });

    softwareDivisionCache.clear();
    notifyHqDataChange("software");

    res.status(201).json({
      message: "Application registered with IFCDC Headquarters",
      app: {
        id: app.id,
        name: app.name,
        healthUrl: app.health_url,
        launchUrl: app.launch_url,
        status: app.status,
        apiKeyPrefix: app.api_key_prefix,
      },
      credentials: {
        appId: app.id,
        apiKey,
        apiKeyPrefix: app.api_key_prefix,
        warning: "Store this API key securely — it will not be shown again.",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed";
    res.status(message.includes("already registered") ? 409 : 400).json({ error: message });
  }
});

router.patch("/software-division/apps/:appId", hqAuthRequired, requireHQModule("software_division"), async (req, res) => {
  try {
    const app = await updateSoftwareApp(req.params.appId, {
      name: req.body?.name,
      description: req.body?.description,
      healthUrl: req.body?.healthUrl,
      launchUrl: req.body?.launchUrl,
      status: req.body?.status,
    });
    softwareDivisionCache.clear();
    notifyHqDataChange("software");
    res.json({
      app: {
        id: app.id,
        name: app.name,
        description: app.description,
        healthUrl: app.health_url,
        launchUrl: app.launch_url,
        status: app.status,
        apiKeyPrefix: app.api_key_prefix,
        updatedAt: app.updated_at,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Update failed" });
  }
});

router.delete("/software-division/apps/:appId", hqAuthRequired, requireHQModule("software_division"), async (req, res) => {
  try {
    await deleteSoftwareApp(req.params.appId);
    softwareDivisionCache.clear();
    notifyHqDataChange("software");
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Delete failed" });
  }
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
