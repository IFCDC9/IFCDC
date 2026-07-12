/**
 * AURA Enterprise Operations 5.0 HTTP API
 */
import { Router, type Request, type Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  EO5_CADENCES,
  approveOpsRun,
  buildContinuousImprovementItems,
  buildEnterpriseOperationsCommandCenter,
  createOpsRun,
  getOpsRun,
  listOpsRuns,
  prepareCadence,
  runEnterpriseOperations5,
  type OpsCadenceId,
  ensureEnterpriseOps5Tables,
} from "../hq/auraEnterpriseOs5";

const router = Router();

function isFounder(req: Request): boolean {
  const u = req.hqUser;
  if (!u) return false;
  if (u.role === "owner" || u.role === "founder") return true;
  const email = (u.email || "").toLowerCase();
  const master = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
  return email === master;
}

router.get("/command-center", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  await ensureEnterpriseOps5Tables();
  res.json(await buildEnterpriseOperationsCommandCenter());
});

router.post("/run", hqAuthRequired, requireHQModule("aura"), async (req: Request, res: Response) => {
  const request = String(req.body?.request || req.body?.command || "").trim();
  if (!request) return res.status(400).json({ error: "request is required" });
  const result = await runEnterpriseOperations5({
    request,
    actorEmail: req.hqUser?.email,
    founderMode: isFounder(req),
    channel: "hq_web",
  });
  res.json(result);
});

router.get("/ops-runs", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 25;
  res.json({ runs: await listOpsRuns(limit) });
});

router.get("/ops-runs/:id", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  const run = await getOpsRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Ops run not found" });
  res.json(run);
});

router.post("/ops-runs", hqAuthRequired, requireHQModule("aura"), async (req: Request, res: Response) => {
  if (!isFounder(req)) return res.status(403).json({ error: "Founder Mode required to create ops runs" });
  const request = String(req.body?.request || req.body?.title || "").trim();
  if (!request) return res.status(400).json({ error: "request is required" });
  const run = await createOpsRun({
    request,
    actorEmail: req.hqUser?.email,
    founderMode: true,
  });
  res.status(201).json(run);
});

router.post("/ops-runs/:id/approve", hqAuthRequired, requireHQModule("aura"), async (req: Request, res: Response) => {
  const result = await approveOpsRun({
    id: req.params.id,
    actorEmail: req.hqUser?.email,
    founderMode: isFounder(req),
    note: typeof req.body?.note === "string" ? req.body.note : undefined,
  });
  if (!result.ok) return res.status(403).json(result);
  res.json(result);
});

router.get("/cadences", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json({ cadences: EO5_CADENCES });
});

router.post("/cadences/:id/prepare", hqAuthRequired, requireHQModule("aura"), async (req: Request, res: Response) => {
  const result = await prepareCadence({
    cadenceId: req.params.id as OpsCadenceId,
    actorEmail: req.hqUser?.email,
    founderMode: isFounder(req),
  });
  if (!result.ok) return res.status(result.error?.includes("Founder") ? 403 : 400).json(result);
  res.json(result);
});

router.get("/continuous-improvement", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  res.json({ items: await buildContinuousImprovementItems() });
});

export default router;
