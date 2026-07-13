/**
 * Enterprise Readiness Certification HTTP API
 */
import { Router, type Request, type Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  buildEnterpriseReadinessDashboard,
  ensureEnterpriseReadinessCertificationTables,
  getLatestCertificationRun,
  listCertificationIssues,
  runEnterpriseReadinessCertification,
  updateCertificationIssueStatus,
  type ErcIssueStatus,
} from "../hq/enterpriseReadinessCertificationEngine";

const router = Router();

function isFounder(req: Request): boolean {
  const u = req.hqUser;
  if (!u) return false;
  if (u.role === "owner" || u.role === "founder") return true;
  const email = (u.email || "").toLowerCase();
  const master = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
  return email === master;
}

router.use(hqAuthRequired, requireHQModule("software_division"));

router.get("/dashboard", async (_req, res) => {
  await ensureEnterpriseReadinessCertificationTables();
  res.json(await buildEnterpriseReadinessDashboard());
});

router.get("/latest", async (_req, res) => {
  await ensureEnterpriseReadinessCertificationTables();
  const latest = await getLatestCertificationRun();
  if (!latest) return res.status(404).json({ error: "No certification run yet" });
  res.json(latest);
});

router.post("/run", async (req: Request, res: Response) => {
  if (!isFounder(req)) {
    return res.status(403).json({ error: "Founder Mode required to run live Enterprise Readiness Certification" });
  }
  const deepQuality = Boolean(req.body?.deepQuality);
  const liveIntegrations = req.body?.liveIntegrations !== false;
  const run = await runEnterpriseReadinessCertification({
    actorEmail: req.hqUser?.email,
    deepQuality,
    liveIntegrations,
  });
  res.status(201).json(run);
});

router.get("/issues", async (req, res) => {
  const status = typeof req.query.status === "string" ? (req.query.status as ErcIssueStatus) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  res.json({ issues: await listCertificationIssues({ status, limit }) });
});

router.patch("/issues/:id", async (req: Request, res: Response) => {
  if (!isFounder(req)) return res.status(403).json({ error: "Founder Mode required" });
  const status = String(req.body?.status || "") as ErcIssueStatus;
  if (!["open", "in_progress", "resolved", "accepted_risk"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const result = await updateCertificationIssueStatus({
    id: req.params.id,
    status,
    actorEmail: req.hqUser?.email,
  });
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

export default router;
