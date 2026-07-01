import { Router } from "express";
import type { Request, Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  buildPhase9OperatingSystemPackage,
  buildPhase9CommandCenter,
  buildPredictiveDashboard,
  buildCrossDivisionDataLayer,
  buildWorkflowAutomationStatus,
  buildExecutiveReportingHub,
  buildUniversalSearchIndex,
  buildGrantProbabilityScores,
} from "../hq/phase9OperatingSystem";
import {
  buildNotificationPriorityQueue,
  markQueueNotificationRead,
  ensureNotificationQueueTables,
} from "../hq/notificationQueue";
import { deliverExecutiveDocument } from "../hq/executiveDocumentDelivery";
import { enterpriseGlobalSearch } from "../hq/enterpriseHub";
import { createPackageCache } from "../hq/packageCache";

const router = Router();
router.use(hqAuthRequired);

const phase9PackageCache = createPackageCache<Record<string, unknown>>(60_000);

router.get("/package", requireHQModule("executive"), async (_req, res) => {
  res.json(await phase9PackageCache.get("phase9", () => buildPhase9OperatingSystemPackage()));
});

router.get("/command-center", requireHQModule("executive"), async (_req, res) => {
  res.json(await buildPhase9CommandCenter());
});

router.get("/login-briefing", requireHQModule("executive"), async (_req, res) => {
  const center = await buildPhase9CommandCenter();
  res.json({
    greeting: center.briefing.greeting,
    organizationHealth: center.organizationHealth,
    highlights: center.briefing.highlights,
    priorities: center.briefing.priorities,
    riskCount: center.riskAlerts.length,
    complianceOverdue: center.complianceAlerts.overdue,
    recommendations: center.recommendations.slice(0, 3),
    generatedAt: center.generatedAt,
  });
});

router.get("/predictive", requireHQModule("analytics"), async (_req, res) => {
  res.json(await buildPredictiveDashboard());
});

router.get("/grant-probability", requireHQModule("grants"), async (_req, res) => {
  res.json({ scores: await buildGrantProbabilityScores(), generatedAt: new Date().toISOString() });
});

router.get("/divisions", requireHQModule("executive"), async (_req, res) => {
  res.json(await buildCrossDivisionDataLayer());
});

router.get("/workflows", requireHQModule("executive"), async (_req, res) => {
  res.json(await buildWorkflowAutomationStatus());
});

router.get("/reporting", requireHQModule("executive"), async (_req, res) => {
  res.json(await buildExecutiveReportingHub());
});

router.post("/reporting/:type", requireHQModule("executive"), async (req: Request, res: Response) => {
  const type = req.params.type;
  if (type !== "briefing" && type !== "board-report") {
    return res.status(400).json({ error: "type must be briefing or board-report" });
  }
  try {
    const docType = type === "board-report" ? "board_report" : "briefing";
    const result = await deliverExecutiveDocument(docType, {
      to: req.body?.to,
      sendEmail: req.body?.sendEmail === true,
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Report delivery failed";
    res.status(500).json({ error: message });
  }
});

router.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "");
  if (!q.trim()) return res.json({ query: q, results: [], count: 0 });
  res.json(await buildUniversalSearchIndex(q));
});

router.get("/search/quick", async (req, res) => {
  const q = String(req.query.q ?? "");
  res.json({ results: await enterpriseGlobalSearch(q) });
});

router.get("/notifications", async (_req, res) => {
  await ensureNotificationQueueTables();
  res.json(await buildNotificationPriorityQueue());
});

router.patch("/notifications/:id/read", async (req, res) => {
  await markQueueNotificationRead(req.params.id);
  res.json({ ok: true });
});

export default router;
