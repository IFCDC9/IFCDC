import { Router, type Request } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import { registerSoftwareApp, listRegisteredApps, rotateAppApiKey } from "../hq/softwareDivisionSchema";
import { buildDeveloperDocumentation } from "../hq/developerDocumentation";
import { buildCompatibilityMatrix, buildEnvFile } from "../hq/appDiagnostics";
import { validateAppEnvironment, buildSdkSetupScript, buildPackageJsonSnippet } from "../hq/envValidation";
import { logDeveloperAudit, listDeveloperAuditLog, getSecurityMonitorSummary, formatAuditEntry } from "../hq/hqDeveloperAudit";
import { notifyHqDataChange } from "../hq/hqRealtimeEvents";

const router = Router();

const ALL_SERVICES = ["auth", "people", "finance", "grants", "analytics", "aura", "notifications", "operations", "enterprise"];

router.use(hqAuthRequired);
router.use(requireHQModule("software_division"));

function clientIp(req: Request): string | null {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? null;
}

router.get("/documentation", (_req, res) => {
  res.json(buildDeveloperDocumentation());
});

router.get("/compatibility", (_req, res) => {
  res.json(buildCompatibilityMatrix());
});

router.get("/security-monitor", async (_req, res) => {
  res.json(await getSecurityMonitorSummary());
});

router.get("/audit-log", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const appId = req.query.appId as string | undefined;
  const entries = await listDeveloperAuditLog(limit, appId);
  res.json({ entries: entries.map(formatAuditEntry) });
});

router.get("/apps", async (_req, res) => {
  const apps = await listRegisteredApps();
  res.json({
    apps: apps.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      healthUrl: a.health_url,
      launchUrl: a.launch_url,
      status: a.status,
      apiKeyPrefix: a.api_key_prefix,
      inheritedServices: JSON.parse(a.inherited_services || "[]"),
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    })),
  });
});

router.post("/validate-environment", async (req, res) => {
  try {
    const { appId, healthUrl, launchUrl, apiKey, sdkVersion } = req.body;
    if (!appId || !healthUrl) {
      return res.status(400).json({ error: "appId and healthUrl are required" });
    }

    const result = await validateAppEnvironment({ appId, healthUrl, launchUrl, apiKey, sdkVersion });

    await logDeveloperAudit({
      appId,
      eventType: result.valid ? "env.validated" : "env.validation_failed",
      actorId: req.hqUser!.id,
      actorEmail: req.hqUser!.email,
      detail: result.valid ? `Environment validated (${result.score}%)` : `Environment validation failed (${result.score}%)`,
      metadata: { score: result.score, checks: result.checks.length },
      ipAddress: clientIp(req),
      severity: result.valid ? "info" : "warning",
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Validation failed" });
  }
});

router.get("/setup/:appId", async (req, res) => {
  const baseUrl = process.env.PUBLIC_APP_URL || "http://localhost:5000";
  const appId = req.params.appId;
  res.json({
    appId,
    sdkInstall: "npm install @ifcdc/headquarters-sdk",
    setupScript: buildSdkSetupScript(appId, baseUrl),
    packageJsonSnippet: buildPackageJsonSnippet(),
    envTemplate: buildEnvFile(appId, "YOUR_API_KEY_HERE", baseUrl),
  });
});

router.post("/apps/:appId/rotate-key", async (req, res) => {
  try {
    const { app, apiKey } = await rotateAppApiKey(req.params.appId);
    const baseUrl = process.env.PUBLIC_APP_URL || "http://localhost:5000";

    await logDeveloperAudit({
      appId: app.id,
      eventType: "app.key_rotated",
      actorId: req.hqUser!.id,
      actorEmail: req.hqUser!.email,
      detail: `API key rotated for ${app.name}`,
      ipAddress: clientIp(req),
      severity: "warning",
    });

    res.json({
      appId: app.id,
      apiKey,
      apiKeyPrefix: app.api_key_prefix,
      envFile: buildEnvFile(app.id, apiKey, baseUrl),
      warning: "Previous API key is now invalid. Update all deployments immediately.",
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Rotation failed" });
  }
});

function buildOnboardResponse(app: Awaited<ReturnType<typeof registerSoftwareApp>>["app"], apiKey: string) {
  const docs = buildDeveloperDocumentation();
  const baseUrl = process.env.PUBLIC_APP_URL || "http://localhost:5000";

  return {
    message: "Application registered with IFCDC Headquarters",
    app: {
      id: app.id,
      name: app.name,
      status: app.status,
      healthUrl: app.health_url,
      launchUrl: app.launch_url,
      inheritedServices: JSON.parse(app.inherited_services),
    },
    credentials: {
      appId: app.id,
      apiKey,
      apiKeyPrefix: app.api_key_prefix,
      warning: "Store this API key securely — it will not be shown again.",
    },
    envFile: buildEnvFile(app.id, apiKey, baseUrl),
    sdkSetup: {
      install: "npm install @ifcdc/headquarters-sdk",
      setupScript: buildSdkSetupScript(app.id, baseUrl),
      packageJsonSnippet: buildPackageJsonSnippet(),
    },
    integration: {
      sdkInstall: docs.sdk.install,
      quickStart: docs.sdk.quickStart,
      requiredHeaders: docs.security.requiredHeaders,
      websocketUrl: "/api/hq/ws",
      sdkVersion: docs.sdk.version,
      platformVersion: docs.platformVersion,
    },
    nextSteps: [
      "Download setup script or run: npm install @ifcdc/headquarters-sdk",
      "Copy .env configuration with your API key",
      "Run environment validation before first deployment",
      "Verify auth with hq.auth.verify()",
      "App appears automatically in Software Division",
    ],
  };
}

router.post("/quick-register", async (req, res) => {
  try {
    const { id, name, healthUrl, launchUrl } = req.body;

    if (!id || !name || !healthUrl) {
      return res.status(400).json({ error: "id, name, and healthUrl are required" });
    }

    if (!/^[a-z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: "id must be lowercase alphanumeric with hyphens only" });
    }

    const { app, apiKey } = await registerSoftwareApp({
      id,
      name,
      description: `${name} — registered via Developer Portal one-click`,
      healthUrl,
      launchUrl,
      inheritedServices: ALL_SERVICES,
      createdBy: req.hqUser!.id,
    });

    await logDeveloperAudit({
      appId: id,
      eventType: "app.quick_registered",
      actorId: req.hqUser!.id,
      actorEmail: req.hqUser!.email,
      detail: `Quick-registered ${name} (${id})`,
      metadata: { healthUrl, inheritedServices: ALL_SERVICES },
      ipAddress: clientIp(req),
    });

    notifyHqDataChange("software");
    res.status(201).json(buildOnboardResponse(app, apiKey));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed";
    res.status(message.includes("already registered") ? 409 : 500).json({ error: message });
  }
});

router.post("/onboard", async (req, res) => {
  try {
    const { id, name, description, healthUrl, launchUrl, inheritedServices } = req.body;

    if (!id || !name || !healthUrl) {
      return res.status(400).json({ error: "id, name, and healthUrl are required" });
    }

    if (!/^[a-z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: "id must be lowercase alphanumeric with hyphens only" });
    }

    const { app, apiKey } = await registerSoftwareApp({
      id,
      name,
      description,
      healthUrl,
      launchUrl,
      inheritedServices: inheritedServices?.length ? inheritedServices : ALL_SERVICES,
      createdBy: req.hqUser!.id,
    });

    await logDeveloperAudit({
      appId: id,
      eventType: "app.registered",
      actorId: req.hqUser!.id,
      actorEmail: req.hqUser!.email,
      detail: `Registered ${name} (${id}) via onboarding wizard`,
      ipAddress: clientIp(req),
    });

    notifyHqDataChange("software");
    res.status(201).json(buildOnboardResponse(app, apiKey));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed";
    res.status(message.includes("already registered") ? 409 : 500).json({ error: message });
  }
});

export default router;
