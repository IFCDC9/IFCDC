import type { Request, Response, NextFunction } from "express";
import { getRegisteredApp, verifyAppApiKey } from "./softwareDivisionSchema";
import { logHqAudit } from "./hqAuditLog";

export async function enterpriseApiAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.header("Authorization") ?? "";
  const apiKey = authHeader.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "")
    : req.header("X-API-Key") ?? String(req.query.api_key ?? "");

  if (!apiKey) {
    return res.status(401).json({ error: "API key required", hint: "Use Authorization: Bearer <api_key> or X-API-Key header" });
  }

  try {
    const apps = await import("./softwareDivisionSchema").then((m) => m.listRegisteredApps());
    let matchedApp: { id: string; name: string } | null = null;

    const idMatch = apiKey.match(/^ifcdc_([^_]+)_/);
    if (idMatch) {
      const appId = idMatch[1];
      const valid = await verifyAppApiKey(appId, apiKey);
      if (valid) {
        const fullApp = await getRegisteredApp(appId);
        if (fullApp?.status === "active") matchedApp = { id: fullApp.id, name: fullApp.name };
      }
    }

    if (!matchedApp) {
      for (const app of apps) {
        const valid = await verifyAppApiKey(app.id, apiKey);
        if (valid && app.status === "active") {
          matchedApp = { id: app.id, name: app.name };
          break;
        }
      }
    }

    if (!matchedApp) return res.status(401).json({ error: "Invalid API key" });

    const fullApp = await getRegisteredApp(matchedApp.id);
    if (!fullApp || fullApp.status !== "active") {
      return res.status(403).json({ error: "Application not active" });
    }

    (req as Request & { enterpriseApp?: { id: string; name: string } }).enterpriseApp = {
      id: fullApp.id,
      name: fullApp.name,
    };

    await logHqAudit({
      action: "enterprise_api_access",
      entityType: "registered_app",
      entityId: fullApp.id,
      detail: `${req.method} ${req.path}`,
      ipAddress: req.ip,
    });

    next();
  } catch {
    res.status(500).json({ error: "API authentication failed" });
  }
}
