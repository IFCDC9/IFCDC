import type { Request, Response, NextFunction } from "express";
import { logHqAudit } from "./hqAuditLog";

/** Event-driven HQ realtime push — call after data mutations */

export type HqRealtimeDomain =
  | "finance"
  | "grants"
  | "people"
  | "programs"
  | "analytics"
  | "notifications"
  | "operations"
  | "software"
  | "workflows"
  | "security"
  | "all";

type PushHandler = (domain: HqRealtimeDomain) => Promise<void>;

let pushHandler: PushHandler | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingDomains = new Set<HqRealtimeDomain>();

export function registerHqPushHandler(handler: PushHandler) {
  pushHandler = handler;
}

export function notifyHqDataChange(domain: HqRealtimeDomain = "all") {
  pendingDomains.add(domain === "all" ? "all" : domain);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const domains = Array.from(pendingDomains);
    pendingDomains.clear();
    debounceTimer = null;
    if (!pushHandler) return;
    try {
      await pushHandler(domains.includes("all") ? "all" : domains[domains.length - 1]);
    } catch (err) {
      console.error("HQ realtime push error:", err);
    }
  }, 350);
}

export function inferHqDomain(path: string): HqRealtimeDomain | null {
  if (path.startsWith("/people")) return "people";
  if (path.startsWith("/finance")) return "finance";
  if (path.startsWith("/grants")) return "grants";
  if (path.startsWith("/programs")) return "programs";
  if (path.startsWith("/analytics")) return "analytics";
  if (path.startsWith("/enterprise/notifications")) return "notifications";
  if (path.startsWith("/operations")) return "operations";
  if (path.startsWith("/software-division") || path.startsWith("/developer")) return "software";
  if (path.startsWith("/workspace")) return "analytics";
  if (path.startsWith("/warehouse")) return "analytics";
  if (path.startsWith("/workflows")) return "workflows";
  if (path.startsWith("/security")) return "security";
  if (path.startsWith("/documents")) return "operations";
  if (path.startsWith("/integrations")) return "software";
  return null;
}

/** Express middleware — pushes WebSocket updates after successful mutations */
export function hqMutationPushMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const domain = inferHqDomain(req.path);
  if (!domain) return next();

  const originalJson = res.json.bind(res);
  res.json = function jsonWithRealtimePush(body: unknown) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      notifyHqDataChange(domain);
      logHqAudit({
        action: `${req.method.toLowerCase()}_${domain}`,
        entityType: domain,
        detail: `${req.method} ${req.path}`,
        actorId: (req as Request & { hqUser?: { id?: string } }).hqUser?.id,
        actorEmail: (req as Request & { hqUser?: { email?: string } }).hqUser?.email,
        ipAddress: req.ip,
      }).catch(() => undefined);
    }
    return originalJson(body);
  };
  next();
}
