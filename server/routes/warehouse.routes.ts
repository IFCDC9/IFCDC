import { Router } from "express";
import type { Request, Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  getWarehouseOverview,
  getWarehouseTrends,
  getExecutiveDrillDown,
  captureFullWarehouseSnapshot,
  captureWarehouseSnapshot,
  buildPredictiveForecasts,
} from "../hq/analyticsWarehouse";
import type { WarehouseDomain } from "../hq/analyticsWarehouse";

const router = Router();
router.use(hqAuthRequired, requireHQModule("analytics"));

router.get("/overview", async (_req, res) => {
  res.json(await getWarehouseOverview());
});

router.get("/trends", async (req, res) => {
  const metricKey = String(req.query.metric ?? "").trim() || undefined;
  const limit = Number(req.query.limit ?? 30);
  res.json(await getWarehouseTrends(metricKey, limit));
});

router.get("/drill-down/:domain", async (req, res) => {
  res.json(await getExecutiveDrillDown(req.params.domain));
});

router.post("/snapshot", async (req: Request, res: Response) => {
  const domain = (req.body?.domain as WarehouseDomain) ?? "organization";
  const full = req.body?.full === true;
  if (full) {
    return res.json(await captureFullWarehouseSnapshot());
  }
  const id = await captureWarehouseSnapshot(domain);
  res.json({ snapshotId: id, domain });
});

router.get("/forecasts", async (_req, res) => {
  res.json(await buildPredictiveForecasts());
});

export default router;
