import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import twilio from "twilio";
import cookieParser from "cookie-parser";
import donationsRouter from "./routes/donations";
import adminFundingRouter from "./routes/adminFunding";
import hqRouter from "./routes/hq.routes";
import enterpriseApiRouter from "./routes/enterpriseApi.routes";
import { attachHqRealtimeHub } from "./hq/hqRealtimeHub";
import { getAppRoot, getDistPublicDir, getPublicDir, getSpaIndexPath } from "./appPaths";
import { assertProductionEnv } from "./config/validateProductionEnv";
import { registerMonolithRoutes, registerMonolithCronRoutes } from "./routes/monolith";
import { createTwilioSenders } from "./monolith/twilioHelpers";
import { initializeHqModules } from "./bootstrap/initializeHqModules";
import http from "http";

assertProductionEnv();

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);
const isDev = process.env.NODE_ENV !== "production";

if (!isDev) {
  app.set("trust proxy", 1);
}

if (isDev) {
  console.log('DEV MODE ACTIVE');
}

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_SMS_FROM,
  TWILIO_VOICE_FROM,
  PUBLIC_IFCDC_PHONE,
  PUBLIC_APP_URL,
  CRON_SECRET_TOKEN,
  APPT_REMINDER_LEAD_HOURS,
  MASTER_OWNER_EMAIL,
} = process.env;

const ADMIN_EMAIL = "813786b@gmail.com";
const FOUNDER_EMAIL = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
const FOUNDER_SEED_PASSWORD = process.env.FOUNDER_SEED_PASSWORD || "IFCDC@2026Secure";
const FOUNDER_NAME = process.env.FOUNDER_NAME || "Mr. Fahreal Allah";

// Only initialize Twilio if credentials are properly configured (SID must start with AC)
// Trim whitespace that may have been accidentally added
const twilioAccountSid = TWILIO_ACCOUNT_SID?.trim();
const twilioAuthToken = TWILIO_AUTH_TOKEN?.trim();
const twilioClient =
  twilioAccountSid && twilioAuthToken && twilioAccountSid.startsWith("AC")
    ? twilio(twilioAccountSid, twilioAuthToken)
    : null;

if (twilioAccountSid && !twilioAccountSid.startsWith("AC")) {
  console.warn("Warning: TWILIO_ACCOUNT_SID does not start with 'AC'. Twilio SMS disabled.");
}

const twilioSenders = createTwilioSenders({
  twilioClient,
  smsFrom: TWILIO_SMS_FROM,
  voiceFrom: TWILIO_VOICE_FROM,
  publicAppUrl: PUBLIC_APP_URL,
});

app.use(express.json());
app.use(cookieParser());
app.use("/api", donationsRouter);
app.use("/api/admin", adminFundingRouter);
app.use("/api/hq", hqRouter);
app.use("/api/hq/v1", enterpriseApiRouter);
const monolithDeps = {
  twilio: twilioSenders,
  twilioClient,
  twilioSmsFrom: TWILIO_SMS_FROM,
  cronSecret: CRON_SECRET_TOKEN,
  apptReminderLeadHours: APPT_REMINDER_LEAD_HOURS,
  publicIfcdcPhone: PUBLIC_IFCDC_PHONE,
};
registerMonolithRoutes(app, monolithDeps);
registerMonolithCronRoutes(app, monolithDeps);

const publicDir = getPublicDir();
// Serve static assets from public/ but don't serve index.html (let Vite handle SPA)
app.use(express.static(publicDir, { index: false }));

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

// Start server with Vite in development or static files in production
async function startServer() {
  const server = http.createServer(app);

  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      configFile: path.join(getAppRoot(), "vite.config.ts"),
      server: {
        middlewareMode: true,
        hmr: { server, port: 24678, clientPort: 24678 },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPublic = getDistPublicDir();
    const spaIndexPath = getSpaIndexPath();
    console.log(`Production static root: ${distPublic}`);
    console.log(`SPA index exists: ${fs.existsSync(spaIndexPath)}`);

    app.use(express.static(distPublic));

    app.get("/", (_req, res) => {
      if (fs.existsSync(spaIndexPath)) {
        return res.sendFile(spaIndexPath);
      }
      return res.redirect("/hq/grants");
    });

    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/twilio")) {
        return next();
      }
      if (fs.existsSync(spaIndexPath)) {
        return res.sendFile(spaIndexPath);
      }
      const legacyIndex = path.join(publicDir, "index.html");
      if (fs.existsSync(legacyIndex)) {
        return res.sendFile(legacyIndex);
      }
      return res.status(404).send("IFCDC HQ frontend not built. Run npm run build.");
    });
  }

  attachHqRealtimeHub(server);

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
      console.log(`IFCDC Health System API live on port ${PORT} (0.0.0.0)`);
      console.log(`Health check: GET /api/health`);
      resolve();
    });
    server.once("error", reject);
  });

  void initializeHqModules({
    email: FOUNDER_EMAIL,
    seedPassword: FOUNDER_SEED_PASSWORD,
    name: FOUNDER_NAME,
  }).catch((err) => {
    console.error("Failed to initialize IFCDC HQ:", err);
    process.exit(1);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
