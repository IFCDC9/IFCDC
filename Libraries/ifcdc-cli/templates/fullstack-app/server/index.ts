import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { createAuthService, createAuthMiddleware } from "@ifcdc/auth";
import { createAuraAI } from "@ifcdc/aura-ai";
import { createApiClient } from "@ifcdc/api-client";
import { setupVite, serveStatic, log } from "./vite";
import { registerRoutes } from "./routes";

const PORT = parseInt(process.env.PORT || "5000", 10);
const isDev = process.env.NODE_ENV !== "production";

const auth = createAuthService({ jwtSecret: process.env.JWT_SECRET || "dev-secret" });
const aura = process.env.OPENAI_API_KEY
  ? createAuraAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export const ifcdcServices = {
  auth,
  aura,
  authMiddleware: createAuthMiddleware({ jwtSecret: process.env.JWT_SECRET || "dev-secret" }),
  apiClient: createApiClient({ baseUrl: process.env.IFCDC_API_URL || `http://localhost:${PORT}` }),
};

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

registerRoutes(app, ifcdcServices);

const server = createServer(app);

if (isDev) {
  await setupVite(app, server);
} else {
  serveStatic(app);
}

server.listen(PORT, "0.0.0.0", () => {
  log(`__APP_DISPLAY_NAME__ serving on port ${PORT}`);
});
