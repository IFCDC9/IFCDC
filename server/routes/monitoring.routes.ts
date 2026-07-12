import { Router } from "express";
import type { Request, Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  buildEnterpriseMonitoringOverview,
  emptyEnterpriseMonitoring,
  invalidateEnterpriseMonitoringCache,
  retryDegradedIntegrations,
} from "../hq/enterpriseMonitoringEngine";

const router = Router();

router.use(hqAuthRequired, requireHQModule("software_division"));

router.get("/overview", async (req: Request, res: Response) => {
  try {
    const bypass = String(req.query.refresh ?? "") === "1";
    if (bypass) invalidateEnterpriseMonitoringCache();
    const data = await buildEnterpriseMonitoringOverview({ bypassCache: bypass });
    res.json(data);
  } catch (err) {
    console.error("[enterprise-monitoring] overview error:", err);
    res.json(emptyEnterpriseMonitoring());
  }
});

router.post("/integrations/retry", async (req: Request, res: Response) => {
  try {
    const providerIds = Array.isArray(req.body?.providerIds)
      ? (req.body.providerIds as unknown[]).map(String)
      : undefined;
    const result = await retryDegradedIntegrations({ providerIds });
    res.json(result);
  } catch (err) {
    console.error("[enterprise-monitoring] retry error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Integration retry failed",
      attempted: 0,
      recovered: [],
      failed: [],
      testedAt: new Date().toISOString(),
    });
  }
});

export default router;
