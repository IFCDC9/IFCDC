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
import { sendHqNotification, getEmailDeliveryStatus, resolveResendFromEmail } from "../lib/notifications";
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

/** Non-secret email delivery readiness (Founder OTP depends on this). */
router.get("/email/status", async (_req: Request, res: Response) => {
  const status = getEmailDeliveryStatus();
  const { probeResendSender } = await import("../lib/notifications");
  const resendProbe = await probeResendSender().catch((err) => ({
    ok: false,
    apiKeySet: status.apiKeySet,
    from: status.from || "",
    error: err instanceof Error ? err.message : "probe failed",
  }));
  res.json({
    ...status,
    fromPreview: status.apiKeySet ? resolveResendFromEmail() : null,
    founderOtpTo: process.env.MASTER_OWNER_EMAIL || process.env.FOUNDER_EMAIL || "service@ifcdc.org",
    purpose: "AURA Founder verification OTP + Communications Center",
    resendProbe,
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
    const message = error instanceof Error ? error.message : "AURA assistant unavailable";
    console.error("AURA HQ chat error:", message);
    res.status(/401|api key/i.test(message) ? 400 : 500).json({ error: message });
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

/** Founder Technical Command — live ops briefing (Founder Mode required). */
router.get("/aura/technical/briefing", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { buildTechnicalCommandBriefing, logTechAudit } = await import("../hq/auraTechnicalCommandEngine");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Technical Command Mode requires Founder access." });
  }
  const briefing = await buildTechnicalCommandBriefing();
  await logTechAudit({
    action: "briefing_api",
    resultStatus: "ok",
    detail: `score=${briefing.overallScore}`,
    actorEmail: identity.email || req.hqUser?.email,
    channel: "hq_web",
    metadata: { overallLabel: briefing.overallLabel, liveCommit: briefing.liveCommit },
  });
  res.json({ briefing, identity: publicIdentitySummary(identity) });
});

router.post("/aura/technical/command", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { handleTechnicalCommand } = await import("../hq/auraTechnicalCommandEngine");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  const founderMode = Boolean(identity.founderMode || identity.isFounder);
  const command = String(req.body?.command ?? "").trim();
  if (command.length < 3) return res.status(400).json({ error: "command must be at least 3 characters" });
  const result = await handleTechnicalCommand({
    command,
    channel: "hq_web",
    actorEmail: identity.email || req.hqUser?.email,
    founderMode,
    founderApproved: Boolean(req.body?.founderApproved),
  });
  res.status(result.blocked ? 403 : 200).json({
    ...result,
    identity: publicIdentitySummary(identity),
  });
});

router.get("/aura/technical/tickets", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { listOpenTechRepairTickets } = await import("../hq/auraTechnicalCommandEngine");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Technical Command Mode requires Founder access." });
  }
  res.json({ tickets: await listOpenTechRepairTickets(25) });
});

/** AURA Intelligence System — metrics, decision support, org memory, proactive scan. */
router.get("/aura/intelligence/metrics", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildAuraIntelligenceMetrics } = await import("../hq/auraIntelligenceMetrics");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "AURA Intelligence metrics require Founder access." });
  }
  res.json(await buildAuraIntelligenceMetrics());
});

router.post("/aura/intelligence/decision-support", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { answerDecisionSupportQuestion } = await import("../hq/auraDecisionSupport");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Decision Support requires Founder Mode." });
  }
  const question = String(req.body?.question ?? "").trim();
  if (question.length < 3) return res.status(400).json({ error: "question must be at least 3 characters" });
  res.json(await answerDecisionSupportQuestion(question));
});

router.post("/aura/intelligence/memory", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { retrieveOrganizationalMemory } = await import("../hq/auraOrganizationalMemory");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Organizational Memory requires Founder Mode." });
  }
  const query = String(req.body?.query ?? "").trim();
  if (query.length < 2) return res.status(400).json({ error: "query required" });
  res.json(await retrieveOrganizationalMemory(query));
});

router.post("/aura/intelligence/proactive-scan", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { evaluateAndEmitProactiveAlerts } = await import("../hq/auraProactiveIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Proactive scan requires Founder access." });
  }
  res.json(
    await evaluateAndEmitProactiveAlerts({
      notifyFounderChannels: Boolean(req.body?.notifyFounderChannels),
    })
  );
});

/** Multi-Agent Executive Team — Founder speaks only to AURA; specialists collaborate. */
router.get("/aura/agents", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { listExecutiveAgents } = await import("../hq/auraExecutiveAgentOrchestrator");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Executive Agent Team requires Founder access." });
  }
  res.json({ agents: listExecutiveAgents() });
});

router.post("/aura/agents/orchestrate", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { runEnterpriseBrain } = await import("../hq/auraEnterpriseBrain");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  const request = String(req.body?.request ?? req.body?.command ?? "").trim();
  if (request.length < 3) return res.status(400).json({ error: "request must be at least 3 characters" });
  const result = await runEnterpriseBrain({
    request,
    channel: "hq_web",
    actorEmail: identity.email || req.hqUser?.email,
    founderMode: Boolean(identity.founderMode || identity.isFounder),
  });
  res.json({ ...result, identity: publicIdentitySummary(identity) });
});

/** AURA Enterprise Brain 2.0 */
router.post("/aura/brain", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { runEnterpriseBrain } = await import("../hq/auraEnterpriseBrain");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  const request = String(req.body?.request ?? req.body?.command ?? "").trim();
  if (request.length < 3) return res.status(400).json({ error: "request must be at least 3 characters" });
  const result = await runEnterpriseBrain({
    request,
    channel: "hq_web",
    actorEmail: identity.email || req.hqUser?.email,
    founderMode: Boolean(identity.founderMode || identity.isFounder),
  });
  res.json({ ...result, identity: publicIdentitySummary(identity) });
});

router.get("/aura/brain/org-model", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildDigitalOrganizationModel } = await import("../hq/auraEnterpriseBrain");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Enterprise Brain requires Founder access." });
  }
  res.json(await buildDigitalOrganizationModel());
});

router.get("/aura/brain/daily-briefing", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildEnterpriseBrainDailyBriefing } = await import("../hq/auraEnterpriseBrain");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Enterprise Brain requires Founder access." });
  }
  res.json(await buildEnterpriseBrainDailyBriefing());
});

router.get("/aura/brain/predictions", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildPredictiveIntelligenceSignals } = await import("../hq/auraEnterpriseBrain");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Enterprise Brain requires Founder access." });
  }
  res.json({ predictions: await buildPredictiveIntelligenceSignals() });
});

router.post("/aura/brain/feedback", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { recordFounderBrainFeedback } = await import("../hq/auraEnterpriseBrain");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Enterprise Brain feedback requires Founder access." });
  }
  const feedbackType = String(req.body?.feedbackType ?? "").trim();
  if (!feedbackType) return res.status(400).json({ error: "feedbackType required" });
  res.json(
    await recordFounderBrainFeedback({
      brainRunId: typeof req.body?.brainRunId === "string" ? req.body.brainRunId : undefined,
      feedbackType: feedbackType as "approved" | "rejected" | "correction" | "useful" | "not_useful",
      rating: typeof req.body?.rating === "number" ? req.body.rating : undefined,
      note: typeof req.body?.note === "string" ? req.body.note : undefined,
      decisionRef: typeof req.body?.decisionRef === "string" ? req.body.decisionRef : undefined,
      actorEmail: identity.email || req.hqUser?.email,
    })
  );
});

/** Phase 3 — Executive Decision Intelligence */
router.post("/aura/edi/decide", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { runExecutiveDecisionIntelligence } = await import("../hq/auraExecutiveDecisionIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  const request = String(req.body?.request ?? req.body?.question ?? "").trim();
  if (request.length < 3) return res.status(400).json({ error: "request must be at least 3 characters" });
  const result = await runExecutiveDecisionIntelligence({
    request,
    channel: "hq_web",
    founderMode: Boolean(identity.founderMode || identity.isFounder),
  });
  res.json({ ...result, identity: publicIdentitySummary(identity) });
});

router.get("/aura/edi/dashboard", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildEnterpriseBrainDashboard } = await import("../hq/auraExecutiveDecisionIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Executive Decision Intelligence requires Founder access." });
  }
  res.json(await buildEnterpriseBrainDashboard());
});

router.get("/aura/edi/scorecard", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildOrganizationPerformanceScorecard } = await import("../hq/auraExecutiveDecisionIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Scorecard requires Founder access." });
  }
  res.json(await buildOrganizationPerformanceScorecard());
});

router.get("/aura/edi/goals", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { listStrategicGoals } = await import("../hq/strategicGoalsEngine");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Strategic Goals Center requires Founder access." });
  }
  res.json(await listStrategicGoals());
});

router.post("/aura/edi/goals", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { upsertStrategicGoal } = await import("../hq/strategicGoalsEngine");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Updating strategic goals requires Founder access." });
  }
  const title = String(req.body?.title ?? "").trim();
  const category = String(req.body?.category ?? "").trim();
  if (!title || !category) return res.status(400).json({ error: "title and category required" });
  res.json(
    await upsertStrategicGoal({
      id: typeof req.body?.id === "string" ? req.body.id : undefined,
      category: category as "funding" | "program" | "community_impact" | "technology" | "hr" | "financial",
      title,
      description: typeof req.body?.description === "string" ? req.body.description : undefined,
      targetValue: typeof req.body?.targetValue === "number" ? req.body.targetValue : undefined,
      unit: typeof req.body?.unit === "string" ? req.body.unit : undefined,
      owner: typeof req.body?.owner === "string" ? req.body.owner : undefined,
      targetDate: typeof req.body?.targetDate === "string" ? req.body.targetDate : undefined,
      actorEmail: identity.email || req.hqUser?.email,
    })
  );
});

router.get("/aura/edi/opportunities", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildOpportunityIntelligence } = await import("../hq/auraExecutiveDecisionIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Opportunity Intelligence requires Founder access." });
  }
  res.json({ opportunities: await buildOpportunityIntelligence() });
});

router.get("/aura/edi/weekly-review", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { buildWeeklyExecutiveReview } = await import("../hq/auraExecutiveDecisionIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Weekly Executive Review requires Founder access." });
  }
  res.json(await buildWeeklyExecutiveReview());
});

router.post("/aura/edi/simulate", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser, publicIdentitySummary } = await import("../hq/auraFounderTrustEngine");
  const { runExecutiveDecisionEngine } = await import("../hq/auraExecutiveDecisionIntelligence");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.founderMode && !identity.isFounder) {
    return res.status(403).json({ error: "Simulations require Founder access." });
  }
  const request = String(req.body?.request ?? req.body?.question ?? "").trim();
  if (request.length < 3) return res.status(400).json({ error: "request must be at least 3 characters" });
  const result = await runExecutiveDecisionEngine(
    /\bwhat (happens|if)\b/i.test(request) ? request : `What happens if ${request}`
  );
  res.json({ ...result, identity: publicIdentitySummary(identity) });
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

// AURA native command layer — free-form command dispatch across all of HQ.
router.post("/aura/command", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const command = String(req.body?.command ?? "").trim();
    if (command.length < 2) return res.status(400).json({ error: "command must be at least 2 characters" });
    const module = typeof req.body?.module === "string" ? req.body.module : undefined;
    const contextRef =
      req.body?.contextRef && typeof req.body.contextRef === "object" ? req.body.contextRef : undefined;
    const deviceId =
      typeof req.body?.deviceId === "string"
        ? req.body.deviceId
        : typeof req.headers["x-aura-device-id"] === "string"
          ? req.headers["x-aura-device-id"]
          : null;
    const {
      resolveIdentityFromHqUser,
      resolveTrustedFounderDevice,
      logAuraIdentityAction,
    } = await import("../hq/auraFounderTrustEngine");
    const device = await resolveTrustedFounderDevice({
      deviceId,
      email: req.hqUser?.email ?? null,
    });
    const identity = resolveIdentityFromHqUser({
      user: req.hqUser,
      channel: "hq_web",
      sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
      trustedDeviceId: device.deviceId,
      deviceTrusted: device.trusted,
    });
    const { runAuraCommand } = await import("../hq/auraCommandLayer");
    const result = await runAuraCommand({
      command,
      module,
      contextRef,
      actorEmail: req.hqUser?.email ?? identity.email ?? "unknown",
      actorUser: req.hqUser,
      identity,
    });
    if (identity.founderMode) {
      void logAuraIdentityAction({
        identity,
        action: "aura_founder_command",
        detail: command.slice(0, 240),
        metadata: { module, seamless: device.trusted },
        ipAddress: req.ip,
      });
    }
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AURA command failed";
    console.error("AURA command error:", message);
    res.status(/401|api key/i.test(message) ? 400 : 500).json({ error: message });
  }
});

// Directly invoke a registered AURA action (contextual UI buttons).
router.post("/aura/action/:actionId", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const actionId = String(req.params.actionId);
    const args = req.body?.args && typeof req.body.args === "object" ? req.body.args : {};
    const module = typeof req.body?.module === "string" ? req.body.module : undefined;
    const contextRef =
      req.body?.contextRef && typeof req.body.contextRef === "object" ? req.body.contextRef : undefined;
    const deviceId =
      typeof req.body?.deviceId === "string"
        ? req.body.deviceId
        : typeof req.headers["x-aura-device-id"] === "string"
          ? req.headers["x-aura-device-id"]
          : null;
    const { resolveIdentityFromHqUser, resolveTrustedFounderDevice, logAuraIdentityAction } = await import(
      "../hq/auraFounderTrustEngine"
    );
    const device = await resolveTrustedFounderDevice({
      deviceId,
      email: req.hqUser?.email ?? null,
    });
    const identity = resolveIdentityFromHqUser({
      user: req.hqUser,
      channel: "hq_web",
      sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
      trustedDeviceId: device.deviceId,
      deviceTrusted: device.trusted,
    });
    const { runAuraAction } = await import("../hq/auraCommandLayer");
    const result = await runAuraAction(actionId, args, {
      actorEmail: req.hqUser?.email ?? identity.email ?? "unknown",
      module,
      contextRef,
      identity,
    });
    if (identity.founderMode) {
      void logAuraIdentityAction({
        identity,
        action: "aura_founder_action",
        detail: actionId,
        metadata: { module, seamless: device.trusted },
        ipAddress: req.ip,
      });
    }
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AURA action failed";
    console.error("AURA action error:", message);
    res.status(/401|api key/i.test(message) ? 400 : 500).json({ error: message });
  }
});

/** Founder Identity & Trust — current AURA identity for this HQ session. */
router.get("/aura/identity", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const {
    resolveIdentityFromHqUser,
    publicIdentitySummary,
    ensureAuraTrustTables,
    resolveTrustedFounderDevice,
  } = await import("../hq/auraFounderTrustEngine");
  await ensureAuraTrustTables();
  const deviceId =
    typeof req.query.deviceId === "string"
      ? req.query.deviceId
      : typeof req.headers["x-aura-device-id"] === "string"
        ? req.headers["x-aura-device-id"]
        : null;
  const device = await resolveTrustedFounderDevice({
    deviceId,
    email: req.hqUser?.email ?? null,
  });
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
    trustedDeviceId: device.deviceId,
    deviceTrusted: device.trusted,
  });
  res.json({
    identity: publicIdentitySummary(identity),
    device: {
      trusted: device.trusted,
      biometricBound: device.biometricBound,
      expiresAt: device.expiresAt,
    },
  });
});

/** Register this browser as a Founder trusted device (Face ID / Touch ID gate on client). */
router.post("/aura/identity/trust-device", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const {
    resolveIdentityFromHqUser,
    registerTrustedFounderDevice,
    publicIdentitySummary,
  } = await import("../hq/auraFounderTrustEngine");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.isFounder) {
    return res.status(403).json({ error: "Only the Founder can register a trusted device." });
  }
  const deviceId = String(req.body?.deviceId ?? "").trim();
  const result = await registerTrustedFounderDevice({
    email: identity.email || "",
    userId: identity.userId,
    displayName: identity.displayName,
    deviceId,
    label: typeof req.body?.label === "string" ? req.body.label : "Founder HQ browser",
    biometricBound: Boolean(req.body?.biometricBound),
    publicKeyJwk: typeof req.body?.publicKeyJwk === "string" ? req.body.publicKeyJwk : null,
  });
  if (!result.ok) return res.status(400).json(result);
  const elevated = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
    trustedDeviceId: result.deviceId,
    deviceTrusted: true,
  });
  res.json({ ...result, identity: publicIdentitySummary(elevated) });
});

/** Founder OTP delivery audit — recent channel attempts with provider responses. */
router.get("/aura/founder-verification/logs", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { getRecentOtpDeliveryLogs } = await import("../hq/auraFounderOtpDelivery");
  const { getEmailDeliveryStatus, probeResendSender } = await import("../lib/notifications");
  const { getTwilioEnvStatus } = await import("../hq/twilioIntegrationEngine");
  const limit = Math.min(parseInt(String(req.query.limit ?? "25"), 10) || 25, 100);
  const [logs, resendProbe] = await Promise.all([
    getRecentOtpDeliveryLogs(limit),
    probeResendSender().catch(() => null),
  ]);
  res.json({
    logs,
    email: getEmailDeliveryStatus(),
    resendProbe,
    twilio: getTwilioEnvStatus(),
    timestamp: new Date().toISOString(),
  });
});

/** Production probe — sends real test Founder OTP email/SMS and returns provider responses. */
router.post("/aura/founder-verification/probe", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const { probeFounderVerificationDelivery } = await import("../hq/auraFounderOtpDelivery");
  const identity = resolveIdentityFromHqUser({
    user: req.hqUser,
    channel: "hq_web",
    sessionKey: req.hqUser?.email || req.hqUser?.id || "hq",
  });
  if (!identity.isFounder) {
    return res.status(403).json({ error: "Founder access required for verification probe." });
  }
  const smsTo = typeof req.body?.smsTo === "string" ? req.body.smsTo.trim() : null;
  const result = await probeFounderVerificationDelivery({ smsTo });
  res.json({
    ...result,
    note: "Test code 000000 was used — discard any test messages. Check providerResponse for failure details.",
  });
});

router.delete("/aura/identity/trust-device", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { revokeTrustedFounderDevice, resolveIdentityFromHqUser } = await import("../hq/auraFounderTrustEngine");
  const identity = resolveIdentityFromHqUser({ user: req.hqUser, channel: "hq_web" });
  if (!identity.isFounder) return res.status(403).json({ error: "Forbidden" });
  const deviceId =
    typeof req.body?.deviceId === "string"
      ? req.body.deviceId
      : typeof req.query.deviceId === "string"
        ? req.query.deviceId
        : "";
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });
  res.json(await revokeTrustedFounderDevice(deviceId, identity.email || ""));
});

// Catalog of AURA actions for rendering buttons.
router.get("/aura/actions", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  const { listAuraActions } = await import("../hq/auraCommandLayer");
  res.json({ actions: listAuraActions() });
});

// AURA conversation memory.
router.get("/aura/memory", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { getRecentAuraTurns } = await import("../hq/auraMemory");
  const turns = await getRecentAuraTurns(req.hqUser?.email ?? "founder", 20);
  res.json({ turns });
});

router.post("/aura/memory/reset", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { resetAuraMemory } = await import("../hq/auraMemory");
  res.json(await resetAuraMemory(req.hqUser?.email ?? "founder"));
});

// ---------------------------------------------------------------------------
// AURA Organizational Knowledge Base — institutional memory for grant writing.
// ---------------------------------------------------------------------------
router.get("/knowledge/status", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const { getKnowledgeBaseStatus } = await import("../hq/knowledgeBaseEngine");
    res.json(await getKnowledgeBaseStatus());
  } catch (err) {
    console.error("[knowledge] status error:", err);
    res.status(500).json({ error: "Knowledge base status unavailable" });
  }
});

router.get("/knowledge/documents", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { listKnowledgeDocuments } = await import("../hq/knowledgeBaseEngine");
    const documents = await listKnowledgeDocuments({
      sourceType: req.query.source_type ? String(req.query.source_type) : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
    });
    res.json({ documents });
  } catch (err) {
    console.error("[knowledge] list error:", err);
    res.json({ documents: [], degraded: true });
  }
});

router.get("/knowledge/documents/:id", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { getKnowledgeDocument } = await import("../hq/knowledgeBaseEngine");
  const document = await getKnowledgeDocument(String(req.params.id));
  if (!document) return res.status(404).json({ error: "Knowledge document not found" });
  res.json({ document });
});

router.post("/knowledge/search", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const query = String(req.body?.query ?? req.body?.q ?? "").trim();
  if (query.length < 2) return res.status(400).json({ error: "query must be at least 2 characters" });
  const { retrieveKnowledge } = await import("../hq/knowledgeBaseEngine");
  const results = await retrieveKnowledge(query, { topK: Number(req.body?.topK) || 8 });
  res.json({ query, results });
});

router.post("/knowledge/sync", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const { syncKnowledgeBaseFromHq } = await import("../hq/knowledgeBaseEngine");
    const result = await syncKnowledgeBaseFromHq({
      embed: req.body?.embed !== false,
      actorEmail: req.hqUser?.email,
    });
    res.json(result);
  } catch (err) {
    console.error("[knowledge] sync error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Knowledge base sync failed" });
  }
});

router.post("/knowledge/documents", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { sourceType, title, content, summary, effectiveDate, sourceKey } = req.body ?? {};
  if (!title || !content) return res.status(400).json({ error: "title and content are required" });
  try {
    const { ingestKnowledgeDocument } = await import("../hq/knowledgeBaseEngine");
    const result = await ingestKnowledgeDocument({
      sourceType: sourceType || "document",
      sourceKey: sourceKey || undefined,
      title: String(title),
      content: String(content),
      summary: summary ? String(summary) : undefined,
      effectiveDate: effectiveDate ? String(effectiveDate) : undefined,
      origin: "manual",
      createdBy: req.hqUser?.email,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error("[knowledge] manual ingest error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to ingest knowledge" });
  }
});

router.post("/knowledge/documents/:id/approve", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { approveKnowledgeDocument } = await import("../hq/knowledgeBaseEngine");
  const document = await approveKnowledgeDocument(String(req.params.id), req.hqUser?.email);
  if (!document) return res.status(404).json({ error: "Knowledge document not found" });
  res.json({ document });
});

router.post("/knowledge/documents/:id/supersede", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const { supersedeKnowledgeDocument } = await import("../hq/knowledgeBaseEngine");
  const document = await supersedeKnowledgeDocument(String(req.params.id), req.hqUser?.email);
  res.json({ document });
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
