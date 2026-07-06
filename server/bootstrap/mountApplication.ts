import express, { type Express } from "express";
import path from "path";
import fs from "fs";
import twilio from "twilio";
import cookieParser from "cookie-parser";
import donationsRouter from "../routes/donations";
import adminFundingRouter from "../routes/adminFunding";
import hqRouter from "../routes/hq.routes";
import enterpriseApiRouter from "../routes/enterpriseApi.routes";
import { getAppRoot, getDistPublicDir, getPublicDir, getSpaIndexPath } from "../appPaths";
import { registerMonolithRoutes, registerMonolithCronRoutes } from "../routes/monolith";
import { registerTwilioAuraRoutes } from "../routes/twilioAura.routes";
import { createTwilioSenders } from "../monolith/twilioHelpers";
import { resolveTwilioPhoneNumber } from "../hq/twilioIntegrationEngine";

export interface MountApplicationOptions {
  isDev: boolean;
}

/** Mount full API + SPA after the process is already listening (Render health / fast bind). */
export async function mountApplication(app: Express, opts: MountApplicationOptions): Promise<void> {
  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER,
    TWILIO_SMS_FROM,
    TWILIO_VOICE_FROM,
    PUBLIC_IFCDC_PHONE,
    PUBLIC_APP_URL,
    CRON_SECRET_TOKEN,
    APPT_REMINDER_LEAD_HOURS,
  } = process.env;

  const twilioAccountSid = TWILIO_ACCOUNT_SID?.trim();
  const twilioAuthToken = TWILIO_AUTH_TOKEN?.trim();
  const twilioClient =
    twilioAccountSid && twilioAuthToken && twilioAccountSid.startsWith("AC")
      ? twilio(twilioAccountSid, twilioAuthToken)
      : null;

  if (twilioAccountSid && !twilioAccountSid.startsWith("AC")) {
    console.warn("Warning: TWILIO_ACCOUNT_SID does not start with 'AC'. Twilio SMS disabled.");
  }

  const resolvedPhone = resolveTwilioPhoneNumber();
  const smsFrom = TWILIO_SMS_FROM || TWILIO_PHONE_NUMBER || resolvedPhone || undefined;
  const voiceFrom = TWILIO_VOICE_FROM || TWILIO_PHONE_NUMBER || resolvedPhone || undefined;

  const twilioSenders = createTwilioSenders({
    twilioClient,
    smsFrom,
    voiceFrom,
    publicAppUrl: PUBLIC_APP_URL,
  });

  registerTwilioAuraRoutes(app);

  app.use(cookieParser());
  app.use("/api", donationsRouter);
  app.use("/api/admin", adminFundingRouter);
  app.use("/api/hq", hqRouter);
  app.use("/api/hq/v1", enterpriseApiRouter);

  const monolithDeps = {
    twilio: twilioSenders,
    twilioClient,
    twilioSmsFrom: smsFrom,
    cronSecret: CRON_SECRET_TOKEN,
    apptReminderLeadHours: APPT_REMINDER_LEAD_HOURS,
    publicIfcdcPhone: PUBLIC_IFCDC_PHONE,
  };
  registerMonolithRoutes(app, monolithDeps);
  registerMonolithCronRoutes(app, monolithDeps);

  const publicDir = getPublicDir();
  app.use(express.static(publicDir, { index: false }));

  if (opts.isDev) {
    return;
  }

  const distPublic = getDistPublicDir();
  const spaIndexPath = getSpaIndexPath();
  console.log(`Production static root: ${distPublic}`);
  console.log(`SPA index exists: ${fs.existsSync(spaIndexPath)}`);

  app.use(
    express.static(distPublic, {
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  app.get("/", (_req, res) => {
    if (fs.existsSync(spaIndexPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.sendFile(spaIndexPath);
    }
    return res.redirect("/hq/grants");
  });

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/twilio") || req.path.startsWith("/twiml")) {
      return next();
    }
    if (req.path.startsWith("/assets/")) {
      return res.status(404).type("text/plain").send("Asset not found");
    }
    if (fs.existsSync(spaIndexPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.sendFile(spaIndexPath);
    }
    const legacyIndex = path.join(publicDir, "index.html");
    if (fs.existsSync(legacyIndex)) {
      return res.sendFile(legacyIndex);
    }
    return res.status(404).send("IFCDC HQ frontend not built. Run npm run build.");
  });
}

export async function mountDevVite(app: Express, server: import("http").Server): Promise<void> {
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
}
