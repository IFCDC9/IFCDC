/**
 * Enterprise Health Improvement HTTP API
 */
import { Router, type Request, type Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import { getSuperAdminEmail } from "../config/credentials";
import { buildEnterpriseHealthReport } from "../hq/enterpriseHealthImprovementEngine";

const router = Router();

function isFounder(req: Request): boolean {
  const u = req.hqUser;
  if (!u) return false;
  const role = String(u.role || "").toLowerCase();
  if (role === "owner" || role === "founder") return true;
  return (u.email || "").toLowerCase() === getSuperAdminEmail();
}

router.use(hqAuthRequired, requireHQModule("software_division"));

/** Live 12-category Enterprise Health Report — no placeholders. */
router.get("/report", async (req: Request, res: Response) => {
  const liveIntegrationTests = req.query.live === "1" || req.query.live === "true";
  // Live provider tests are Founder-gated (rate / cost)
  if (liveIntegrationTests && !isFounder(req)) {
    return res.status(403).json({ error: "Founder Mode required for live integration tests" });
  }
  const report = await buildEnterpriseHealthReport({
    liveIntegrationTests,
    actorEmail: req.hqUser?.email,
    persist: true,
  });
  res.json(report);
});

/** Lightweight dashboard alias (same report, no live provider hammering). */
router.get("/dashboard", async (req: Request, res: Response) => {
  const report = await buildEnterpriseHealthReport({
    liveIntegrationTests: false,
    actorEmail: req.hqUser?.email,
    persist: false,
  });
  res.json(report);
});

/** Founder: deep refresh with live integration tests. */
router.post("/refresh", async (req: Request, res: Response) => {
  if (!isFounder(req)) {
    return res.status(403).json({ error: "Founder Mode required to run deep Enterprise Health refresh" });
  }
  const report = await buildEnterpriseHealthReport({
    liveIntegrationTests: req.body?.liveIntegrationTests !== false,
    actorEmail: req.hqUser?.email,
    persist: true,
  });
  res.status(201).json(report);
});

export default router;
