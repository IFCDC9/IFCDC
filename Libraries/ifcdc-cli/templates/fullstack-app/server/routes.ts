import type { Express } from "express";
import type { createAuthService, createAuthMiddleware } from "@ifcdc/auth";
import type { createAuraAI } from "@ifcdc/aura-ai";
import type { createApiClient } from "@ifcdc/api-client";

type AuthService = ReturnType<typeof createAuthService>;
type AuthMiddleware = ReturnType<typeof createAuthMiddleware>;
type AuraAI = ReturnType<typeof createAuraAI> | null;
type ApiClient = ReturnType<typeof createApiClient>;

export interface IfcdcServices {
  auth: AuthService;
  aura: AuraAI;
  authMiddleware: AuthMiddleware;
  apiClient: ApiClient;
}

export function registerRoutes(app: Express, services: IfcdcServices) {
  app.get("/api/health", (_req, res) => {
    res.json({ app: "__APP_NAME__", status: "healthy", services: { auth: true, aura: !!services.aura } });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    // Implement login against your database
    res.status(501).json({ error: "Connect login to your user storage" });
  });

  app.get("/api/auth/me", services.authMiddleware, (req, res) => {
    res.json({ user: (req as { user?: unknown }).user });
  });

  app.post("/api/aura/chat", services.authMiddleware, async (req, res) => {
    if (!services.aura) return res.status(503).json({ error: "AURA AI not configured" });
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });
    const response = await services.aura.chat([{ role: "user", content: message }]);
    res.json({ response });
  });
}
