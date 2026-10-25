import { Router, type Request, type Response, type NextFunction } from "express";
import { hqAuthRequired } from "../middleware/hqAuth";
import { engineeringApprovalAllowed } from "../hq/auraEngineeringWorkflow";
import { createLiveCheckoutService, liveConfiguration, LiveCheckoutError } from "../hq/auraLiveCheckout";

export function liveCheckoutRouter(options: Parameters<typeof createLiveCheckoutService>[0] = {}) {
  const router = Router();
  const service = createLiveCheckoutService(options);
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use(hqAuthRequired, (req, res, next) => {
    if (!req.hqUser?.id || !req.hqUser.email || !engineeringApprovalAllowed(req.hqUser) ||
        req.hqUser.email.toLowerCase() !== (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase()) {
      res.status(403).json({ error: "Founder authorization required." }); return;
    }
    next();
  });
  // Cookie-authenticated mutations must originate from the explicitly configured HQ origin.
  router.use((req, res, next) => {
    if (req.method === "GET") { next(); return; }
    const { origin } = liveConfiguration(options.env);
    if (!origin || req.get("origin") !== origin || !req.is("application/json")) {
      res.status(403).json({ error: "Open live checkout from your HQ page." }); return;
    }
    next();
  });
  const handled = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) => {
    Promise.resolve().then(() => fn(req, res)).catch(error => {
      res.status(error instanceof LiveCheckoutError ? error.status : 500).json({
        error: error instanceof LiveCheckoutError ? error.message : "Live checkout is temporarily unavailable.",
      });
    });
  };
  router.get("/status", handled(async (req, res) => res.json(await service.status(req.hqUser!.id))));
  router.post("/orders", handled(async (req, res) => res.status(201).json(await service.create(req.hqUser!.id, req.body))));
  router.post("/orders/:id/capture", handled(async (req, res) => res.json(await service.capture(req.hqUser!.id, req.params.id, req.body))));
  router.post("/orders/:id/recheck", handled(async (req, res) => res.json(await service.reconcile(req.hqUser!.id, req.params.id))));
  return router;
}
export default liveCheckoutRouter();
