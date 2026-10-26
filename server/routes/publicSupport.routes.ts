import { Router, type Request, type Response } from "express";
import { createSupportService, supportConfiguration, SupportError } from "../hq/publicSupport";
import { hqAuthRequired } from "../middleware/hqAuth";
import { engineeringApprovalAllowed } from "../hq/auraEngineeringWorkflow";

export function publicSupportRouter(options: Parameters<typeof createSupportService>[0] = {}) {
  const router = Router(); const service = createSupportService(options);
  const handled = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
    Promise.resolve().then(() => fn(req, res)).catch(error => res.status(error instanceof SupportError ? error.status : 502).json({
      error: error instanceof SupportError ? error.message : "Payment service could not confirm this request. Please recheck before starting another payment.",
    }));
  };
  router.use((_req, res, next) => { res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }); next(); });
  router.post("/webhook", handled(async (req, res) => {
    const headers: Record<string, string | undefined> = {};
    for (const key of ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"]) headers[key] = req.get(key);
    return res.json(await service.webhook(headers, req.body));
  }));
  router.get("/admin", hqAuthRequired, handled(async (req, res) => {
    if (!req.hqUser?.id || !req.hqUser.email || !engineeringApprovalAllowed(req.hqUser) ||
        req.hqUser.email.toLowerCase() !== (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase()) throw new SupportError(403, "Founder authorization required.");
    return res.json(await service.admin());
  }));
  router.use((req, res, next) => {
    service.throttle(req.ip || req.socket.remoteAddress || "unknown").then(() => next()).catch(error => res.status(error instanceof SupportError ? error.status : 503).json({ error: "Too many requests. Please retry later." }));
  });
  router.get("/catalog", handled(async (_req, res) => res.json(await service.catalog())));
  router.use((req, res, next) => {
    const { origin } = supportConfiguration(options.env);
    if (req.method !== "POST" || !origin || req.get("origin") !== origin || !req.is("application/json")) { res.status(403).json({ error: "Use the IFCDC support page to submit this request." }); return; }
    next();
  });
  const proof = (req: Request) => req.get("X-IFCDC-Receipt");
  router.post("/payments", handled(async (req, res) => res.status(201).json(await service.create(req.body, req.ip || req.socket.remoteAddress || "unknown"))));
  router.post("/payments/:id/capture", handled(async (req, res) => res.json(await service.capture(req.params.id, proof(req), req.body))));
  router.post("/payments/:id/recheck", handled(async (req, res) => res.json(await service.recheck(req.params.id, proof(req)))));
  router.post("/payments/:id/cancel", handled(async (req, res) => res.json(await service.cancel(req.params.id, proof(req), req.body))));
  router.post("/inquiries", handled(async (req, res) => res.status(201).json(await service.inquiry(req.body, req.ip || req.socket.remoteAddress || "unknown"))));
  return router;
}
export default publicSupportRouter();
