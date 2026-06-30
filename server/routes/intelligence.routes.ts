import { Router } from "express";
import type { Request, Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  buildExecutiveScorecard,
  buildOrganizationHealthForecast,
  buildFinancialForecast,
  buildGrantFundingProjections,
  buildComplianceRiskAnalysis,
  generateStrategicRecommendations,
  generateExecutiveBoardReport,
  buildExecutiveIntelligencePackage,
} from "../hq/executiveIntelligenceEngine";
import { buildPredictiveIntelligence } from "../hq/predictiveIntelligence";
import {
  buildDivisionIntegrationOverview,
  fetchDivisionSnapshot,
  listDivisionAdapters,
  type DivisionId,
} from "../hq/divisionIntegrationLayer";
import { buildDivisionConnectorManifest } from "../hq/divisionConnectors";
import {
  deliverExecutiveDocument,
  listRecentReports,
  readReportFile,
} from "../hq/executiveDocumentDelivery";
import {
  ingestDivisionAnalytics,
  getLatestDivisionAnalytics,
  resolveDivisionId,
  validateWebhookApiKey,
} from "../hq/divisionAnalyticsWebhook";
import { scanKpiAnomalies } from "../hq/anomalyMonitor";
import {
  buildMorningBriefingForFounder,
  monitorAllHeadquartersModules,
  detectAndRecommendCorrectiveActions,
  answerExecutiveCopilotQuestion,
  executeCopilotAutomation,
  generateExecutiveSummaryNarrative,
  type AutomationAction,
} from "../hq/auraExecutiveCopilot";

const router = Router();

// Public division webhooks (API key auth only — no session cookie)
router.post("/webhooks/analytics/:divisionId", async (req: Request, res: Response) => {
  const divisionId = resolveDivisionId(req.params.divisionId);
  if (!divisionId) return res.status(400).json({ error: "Unknown division" });
  if (divisionId === "barbers") {
    return res.status(403).json({ error: "Barbers App is production-locked — analytics ingest is read-only via health polling only" });
  }

  const apiKey = String(req.headers["x-hq-api-key"] ?? req.body?.apiKey ?? "");
  const auth = await validateWebhookApiKey(apiKey);
  if (!auth.valid) return res.status(401).json({ error: "Invalid API key" });

  const result = await ingestDivisionAnalytics(divisionId, req.body ?? {}, {
    sourceApp: auth.appId,
    apiKeyPrefix: auth.prefix,
  });
  res.status(201).json({ ok: true, ...result });
});

router.use(hqAuthRequired);

// ─── Executive Intelligence Engine ───
router.get("/scorecard", requireHQModule("analytics"), async (_req, res) => {
  res.json(await buildExecutiveScorecard());
});

router.get("/forecast", requireHQModule("analytics"), async (_req, res) => {
  const [organizationHealth, financial, grants] = await Promise.all([
    buildOrganizationHealthForecast(),
    buildFinancialForecast(),
    buildGrantFundingProjections(),
  ]);
  res.json({ organizationHealth, financial, grants, generatedAt: new Date().toISOString() });
});

router.get("/predictions", requireHQModule("analytics"), async (_req, res) => {
  res.json(await buildPredictiveIntelligence());
});

router.get("/compliance-risk", requireHQModule("analytics"), async (_req, res) => {
  res.json(await buildComplianceRiskAnalysis());
});

router.get("/strategic-recommendations", requireHQModule("executive"), async (_req, res) => {
  res.json(await generateStrategicRecommendations());
});

router.get("/board-report", requireHQModule("executive"), async (_req, res) => {
  res.json(await generateExecutiveBoardReport());
});

router.get("/package", requireHQModule("executive"), async (_req, res) => {
  res.json(await buildExecutiveIntelligencePackage());
});

// ─── Division Integration Layer ───
router.get("/divisions", requireHQModule("executive"), async (_req, res) => {
  res.json(await buildDivisionIntegrationOverview());
});

router.get("/divisions/adapters", requireHQModule("executive"), async (_req, res) => {
  res.json({ adapters: listDivisionAdapters() });
});

router.get("/divisions/:id", requireHQModule("executive"), async (req, res) => {
  const snapshot = await fetchDivisionSnapshot(req.params.id as DivisionId);
  if (!snapshot) return res.status(404).json({ error: "Division not found" });
  res.json(snapshot);
});

// ─── AURA Executive Copilot ───
router.get("/copilot/morning-briefing", requireHQModule("aura"), async (_req, res) => {
  res.json(await buildMorningBriefingForFounder());
});

router.get("/copilot/module-monitor", requireHQModule("aura"), async (_req, res) => {
  res.json(await monitorAllHeadquartersModules());
});

router.get("/copilot/corrective-actions", requireHQModule("aura"), async (_req, res) => {
  res.json(await detectAndRecommendCorrectiveActions());
});

router.get("/copilot/executive-summary", requireHQModule("aura"), async (_req, res) => {
  res.json(await generateExecutiveSummaryNarrative());
});

router.post("/copilot/ask", requireHQModule("aura"), async (req: Request, res: Response) => {
  const question = String(req.body?.question ?? "").trim();
  if (question.length < 3) return res.status(400).json({ error: "question must be at least 3 characters" });
  res.json(await answerExecutiveCopilotQuestion(question));
});

router.post("/copilot/automate", requireHQModule("aura"), async (req: Request, res: Response) => {
  const action = String(req.body?.action ?? "") as AutomationAction;
  const valid: AutomationAction[] = [
    "task_assignment", "deadline_reminder", "executive_notification",
    "grant_followup", "board_packet", "financial_report", "compliance_monitor",
  ];
  if (!valid.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${valid.join(", ")}` });
  }
  const result = await executeCopilotAutomation(action, {
    title: req.body?.title,
    assignedTo: req.body?.assignedTo ?? req.hqUser?.email,
    payload: req.body?.payload,
  });
  res.status(201).json({ action, result });
});

// ─── Document Delivery (PDF + Email) ───
router.post("/deliver/briefing", requireHQModule("executive"), async (req: Request, res: Response) => {
  const result = await deliverExecutiveDocument("briefing", {
    to: req.body?.to ?? req.hqUser?.email,
    sendEmail: req.body?.sendEmail !== false,
  });
  res.status(201).json(result);
});

router.post("/deliver/board-report", requireHQModule("executive"), async (req: Request, res: Response) => {
  const result = await deliverExecutiveDocument("board_report", {
    to: req.body?.to ?? req.hqUser?.email,
    sendEmail: req.body?.sendEmail !== false,
  });
  res.status(201).json(result);
});

router.get("/reports", requireHQModule("executive"), async (_req, res) => {
  res.json({ reports: listRecentReports() });
});

router.get("/reports/:filename", requireHQModule("executive"), async (req, res) => {
  const format = (req.query.format === "pdf" ? "pdf" : "html") as "html" | "pdf";
  const file = readReportFile(req.params.filename, format);
  if (!file) return res.status(404).json({ error: "Report not found" });
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.filename}"`);
  res.send(file.buffer);
});

// ─── Division Connectors (Software Division, Economic Development, Case Management) ───
router.get("/connectors", requireHQModule("executive"), async (_req, res) => {
  res.json(buildDivisionConnectorManifest());
});

// ─── Anomaly Detection ───
router.get("/anomalies", requireHQModule("analytics"), async (_req, res) => {
  res.json({ alerts: await scanKpiAnomalies(), scannedAt: new Date().toISOString() });
});

// ─── Division Analytics Webhooks (read-only ingest) — registered above auth middleware ───
router.get("/webhooks/analytics/:divisionId/latest", requireHQModule("executive"), async (req, res) => {
  const divisionId = resolveDivisionId(req.params.divisionId);
  if (!divisionId) return res.status(400).json({ error: "Unknown division" });
  const latest = await getLatestDivisionAnalytics(divisionId);
  if (!latest) return res.status(404).json({ error: "No analytics received yet" });
  res.json(latest);
});

export default router;
