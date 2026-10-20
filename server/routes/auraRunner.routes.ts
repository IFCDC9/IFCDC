import { Router, type Request, type Response, type NextFunction } from "express";
import { hqAuthRequired } from "../middleware/hqAuth";
import { engineeringApprovalAllowed } from "../hq/auraEngineeringWorkflow";
import { authenticateRunner, claimRunnerJob, completeRunnerJob, enrollRunner, listRunnersAndJobs,
  queueRunnerInspection, revokeRunner, RunnerBridgeError } from "../hq/auraRunnerBridge";

const router = Router();
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
type Handler = (req: Request, res: Response) => Promise<unknown>;
const handled = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve().then(() => handler(req, res)).catch((error) => {
    if (error instanceof RunnerBridgeError) res.status(error.status).json({ error: error.message });
    else next(error);
  });
};
const founder = (req: Request, res: Response, next: NextFunction) => {
  if (!req.hqUser?.id || !req.hqUser.email || !engineeringApprovalAllowed(req.hqUser)) {
    res.status(403).json({ error: "Founder authorization required." });
  } else next();
};

router.get("/runners", hqAuthRequired, founder, handled(async (_req, res) => res.json(await listRunnersAndJobs())));
router.post("/runners", hqAuthRequired, founder, handled(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(201).json(await enrollRunner(req.body?.label, req.hqUser!.id));
}));
router.post("/runners/:id/revoke", hqAuthRequired, founder, handled(async (req, res) => {
  await revokeRunner(String(req.params.id), req.hqUser!.id);
  res.json({ revoked: true });
}));
router.post("/runner-jobs", hqAuthRequired, founder, handled(async (req, res) => {
  res.status(201).json(await queueRunnerInspection(req.body?.runnerId, req.body?.kind, req.hqUser!.id));
}));

// Worker credentials never grant Founder access or accept HQ session tokens.
router.post("/runner/claim", handled(async (req, res) => {
  const runnerId = await authenticateRunner(req.get("authorization"));
  res.set("Cache-Control", "no-store");
  res.json({ job: await claimRunnerJob(runnerId) });
}));
router.post("/runner/jobs/:id/result", handled(async (req, res) => {
  const runnerId = await authenticateRunner(req.get("authorization"));
  res.json(await completeRunnerJob(runnerId, String(req.params.id), req.body?.lease, req.body?.result));
}));

export default router;
