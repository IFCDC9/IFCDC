import { Router } from "express";
import { enterpriseApiAuth } from "../hq/enterpriseApiAuth";
import { getWarehouseOverview, getExecutiveDrillDown } from "../hq/analyticsWarehouse";
import { buildGrantExecutiveDashboard } from "../hq/grantReporting";
import { buildExecutiveDashboard } from "../hq/financeReporting";
import { buildSoftwareDivisionSsoManifest } from "../hq/ssoGateway";

const router = Router();

router.use(enterpriseApiAuth);

router.get("/health", (_req, res) => {
  res.json({ status: "healthy", api: "IFCDC Enterprise API v1", timestamp: new Date().toISOString() });
});

router.get("/organization/overview", async (_req, res) => {
  res.json(await getWarehouseOverview());
});

router.get("/organization/health", async (_req, res) => {
  const overview = await getWarehouseOverview();
  res.json({
    score: overview.organizationHealth,
    grade: overview.grade,
    timestamp: overview.timestamp,
  });
});

router.get("/finance/summary", async (_req, res) => {
  try {
    res.json(await buildExecutiveDashboard());
  } catch {
    res.json({ cashFlow: 0, donationsReceived: 0, financialHealthScore: 0 });
  }
});

router.get("/grants/pipeline", async (_req, res) => {
  try {
    const dashboard = await buildGrantExecutiveDashboard();
    res.json({
      pipeline: dashboard.fundingPipeline,
      pipelineValue: dashboard.pipelineValue,
      activeAwards: dashboard.activeAwards,
      winRate: dashboard.winRate,
    });
  } catch {
    res.json({ pipeline: [], pipelineValue: 0, activeAwards: 0, winRate: 0 });
  }
});

router.get("/analytics/drill-down/:domain", async (req, res) => {
  res.json(await getExecutiveDrillDown(req.params.domain));
});

router.get("/sso/manifest", (_req, res) => {
  res.json(buildSoftwareDivisionSsoManifest());
});

export default router;
