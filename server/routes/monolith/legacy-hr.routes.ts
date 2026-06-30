import type { Express } from "express";

/** Deprecated HR endpoints — redirect clients to HQ People module. */
export function registerLegacyHrRoutes(app: Express): void {
  app.all("/api/hr/employees", (_req, res) => {
    res.status(410).json({ error: "Deprecated. Use GET/POST /api/hq/people", migration: "phase3.1" });
  });

  app.all("/api/hr/staffing-overview", (_req, res) => {
    res.status(410).json({ error: "Deprecated. Use GET /api/hq/people/staffing-overview", migration: "phase3.1" });
  });
}
