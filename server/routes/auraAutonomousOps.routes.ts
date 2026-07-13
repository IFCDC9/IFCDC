/**
 * AURA Autonomous Operations HTTP API
 */
import { Router, type Request, type Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  buildFounderWorkspace,
  ensureAutonomousOperationsTables,
  listPreparedPackages,
  runAutonomousOperationsCycle,
  runAutonomousOperationsCommand,
} from "../hq/auraAutonomousOperations";

const router = Router();

function isFounder(req: Request): boolean {
  const u = req.hqUser;
  if (!u) return false;
  if (u.role === "owner" || u.role === "founder") return true;
  const email = (u.email || "").toLowerCase();
  const master = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
  return email === master;
}

router.use(hqAuthRequired, requireHQModule("aura"));

router.get("/workspace", async (_req, res) => {
  await ensureAutonomousOperationsTables();
  res.json(await buildFounderWorkspace());
});

router.get("/prepared", async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 25;
  res.json({ packages: await listPreparedPackages(limit) });
});

router.post("/cycle", async (req: Request, res: Response) => {
  if (!isFounder(req)) {
    return res.status(403).json({ error: "Founder Mode required to run Autonomous Operations cycle" });
  }
  const notifyFounderChannels = Boolean(req.body?.notifyFounderChannels);
  const cycle = await runAutonomousOperationsCycle({
    actorEmail: req.hqUser?.email,
    notifyFounderChannels,
    prepareCadences: req.body?.prepareCadences !== false,
  });
  res.status(201).json(cycle);
});

router.post("/command", async (req: Request, res: Response) => {
  const request = String(req.body?.request || req.body?.command || "").trim();
  if (!request) return res.status(400).json({ error: "request is required" });
  const result = await runAutonomousOperationsCommand({
    request,
    actorEmail: req.hqUser?.email,
    founderMode: isFounder(req),
  });
  res.json(result);
});

export default router;
