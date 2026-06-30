import type { Express } from "express";
import { registerHealthRoutes } from "./health.routes";
import { registerPublicPageRoutes } from "./publicPages.routes";
import { registerLegacyAuthRoutes } from "./auth.routes";

/** Mount extracted monolith route modules (Phase 0 M0.3). */
export function registerMonolithRoutes(app: Express): void {
  registerHealthRoutes(app);
  registerPublicPageRoutes(app);
  registerLegacyAuthRoutes(app);
}

export { createAuthRouter, registerLegacyAuthRoutes } from "./auth.routes";
