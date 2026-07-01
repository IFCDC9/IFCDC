import "dotenv/config";
import express from "express";
import http from "http";
import { assertProductionEnv } from "./config/validateProductionEnv";
import { reportProductionEnvGaps } from "./config/productionEnvReport";
import { registerHealthRoutes } from "./routes/monolith/health.routes";
import { setApplicationReady } from "./bootstrap/applicationState";
import {
  getGrantsOperatorEmail,
  getGrantsOperatorPassword,
  getSuperAdminEmail,
  getSuperAdminPassword,
} from "./config/credentials";

assertProductionEnv();
reportProductionEnvGaps();

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);
const isDev = process.env.NODE_ENV !== "production";

if (!isDev) {
  app.set("trust proxy", 1);
} else {
  console.log("DEV MODE ACTIVE");
}

const FOUNDER_EMAIL = getSuperAdminEmail();
const FOUNDER_SEED_PASSWORD = getSuperAdminPassword() || "IFCDC@2026Secure";
const FOUNDER_NAME = process.env.FOUNDER_NAME || "IFCDC Super Admin";
const GRANTS_OPERATOR = {
  email: getGrantsOperatorEmail(),
  seedPassword: getGrantsOperatorPassword(),
  name: process.env.GRANTS_OPERATOR_NAME || "IFCDC Grants Operator",
};

// Lightweight middleware + health only — bind PORT before heavy route imports (Render stability).
app.use(express.json());
registerHealthRoutes(app);

declare global {
  namespace Express {
    interface User {
      id: string;
      name?: string;
      email?: string;
      role: string;
      claims?: {
        id: string;
        email?: string;
        first_name?: string;
        last_name?: string;
        profile_image_url?: string;
      };
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
    }
    interface Request {
      user?: User;
    }
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("IFCDC unhandled rejection (process kept alive):", reason);
});

async function startServer() {
  const server = http.createServer(app);

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\nPort ${PORT} is already in use.`);
      console.error(`Stop the existing server: lsof -ti :${PORT} | xargs kill -9`);
      console.error(`Or use a different port: PORT=5002 npm run dev\n`);
      process.exit(1);
    }
    throw err;
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`IFCDC HQ bound to port ${PORT} (0.0.0.0) — loading application modules…`);
      resolve();
    });
    server.once("error", reject);
  });

  const { mountApplication, mountDevVite } = await import("./bootstrap/mountApplication");
  await mountApplication(app, { isDev });
  if (isDev) {
    await mountDevVite(app, server);
  }
  setApplicationReady(true);
  console.log("IFCDC HQ application routes mounted");

  const { attachHqRealtimeHub } = await import("./hq/hqRealtimeHub");
  attachHqRealtimeHub(server);

  const { initializeHqModules } = await import("./bootstrap/initializeHqModules");
  void initializeHqModules({
    email: FOUNDER_EMAIL,
    seedPassword: FOUNDER_SEED_PASSWORD,
    name: FOUNDER_NAME,
    grantsOperator: GRANTS_OPERATOR.seedPassword
      ? { email: GRANTS_OPERATOR.email, seedPassword: GRANTS_OPERATOR.seedPassword, name: GRANTS_OPERATOR.name }
      : undefined,
  })
    .then(async () => {
      const { scheduleGrantCenterProductionQa } = await import("./hq/grantCenterProductionQaRunner");
      scheduleGrantCenterProductionQa(PORT);
    })
    .catch((err) => {
      console.error("Failed to initialize IFCDC HQ (API remains up):", err);
    });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
