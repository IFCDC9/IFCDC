import type { Express } from "express";

export function registerHealthRoutes(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.json({
      app: "ifcdc-headquarters",
      status: "healthy",
      version: "1.0.0",
      platform: "IFCDC Enterprise Operating System",
    });
  });
}
