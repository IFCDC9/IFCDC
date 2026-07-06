import { Router } from "express";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  getIntegrationsHub,
  configureIntegration,
  testIntegrationConnection,
  type IntegrationProvider,
} from "../hq/integrationConnectors";
import {
  buildQuickBooksAuthUrl,
  exchangeQuickBooksCode,
  syncQuickBooksToFinance,
  getQuickBooksSyncSummary,
  isQuickBooksConfigured,
} from "../hq/quickbooksOAuth";
import { JWT_SECRET } from "../config/auth";

const router = Router();

/** QuickBooks OAuth callback — public (validates signed state) */
router.get("/quickbooks/callback", async (req: Request, res: Response) => {
  const { code, state, realmId, error } = req.query;
  if (error) {
    return res.redirect(`/hq/integrations?qb_error=${encodeURIComponent(String(error))}`);
  }
  if (!code || !state || !realmId) {
    return res.redirect("/hq/integrations?qb_error=missing_params");
  }
  try {
    const payload = jwt.verify(String(state), JWT_SECRET) as { userId: string; purpose: string };
    if (payload.purpose !== "qb_oauth") throw new Error("Invalid state");
    await exchangeQuickBooksCode(String(code), String(realmId));
    res.redirect("/hq/finance?tab=quickbooks&qb_connected=1");
  } catch (err) {
    console.error("QuickBooks callback error:", err);
    res.redirect(`/hq/integrations?qb_error=${encodeURIComponent((err as Error).message)}`);
  }
});

router.use(hqAuthRequired, requireHQModule("software_division"));

router.get("/", async (_req, res) => {
  try {
    res.json(await getIntegrationsHub());
  } catch (err) {
    console.error("[integrations-hub] GET / error:", err);
    const { emptyIntegrationsHub } = await import("../hq/integrationsHubEngine");
    res.json(emptyIntegrationsHub());
  }
});

router.get("/quickbooks/status", async (_req, res) => {
  res.json(await getQuickBooksSyncSummary());
});

router.get("/quickbooks/connect", async (req: Request, res: Response) => {
  try {
    const state = jwt.sign(
      { userId: req.hqUser!.id, purpose: "qb_oauth" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );
    const authUrl = buildQuickBooksAuthUrl(state);
    res.json({ authUrl, oauthConfigured: isQuickBooksConfigured() });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/quickbooks/sync", async (req: Request, res: Response) => {
  try {
    const result = await syncQuickBooksToFinance(req.hqUser?.email);
    res.json({ success: true, sync: result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/:provider/configure", async (req: Request, res: Response) => {
  const provider = req.params.provider as IntegrationProvider;
  if (provider === "quickbooks") {
    return res.status(400).json({ error: "Use QuickBooks OAuth connect flow" });
  }
  const { config, enabled } = req.body;
  try {
    const connection = await configureIntegration(provider, config ?? {}, enabled !== false);
    res.json({ connection });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/:provider/test", async (req, res) => {
  const provider = req.params.provider;
  if (provider === "twilio" && req.query.sync === "webhooks") {
    const { syncTwilioWebhooksToProduction, probeTwilioApi } = await import("../hq/twilioIntegrationEngine");
    const sync = await syncTwilioWebhooksToProduction();
    const probe = await probeTwilioApi();
    return res.json({ ...sync, probe: { healthy: probe.healthy, message: probe.message, phone: probe.phone } });
  }
  if (provider === "quickbooks") {
    const summary = await getQuickBooksSyncSummary();
    return res.json({
      success: summary.connection.connected || isQuickBooksConfigured(),
      message: summary.connection.connected
        ? "QuickBooks connected — run sync to pull financial data"
        : isQuickBooksConfigured()
          ? "OAuth configured — connect your QuickBooks company"
          : "Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET environment variables",
      provider,
      testedAt: new Date().toISOString(),
    });
  }
  const { testIntegrationHubProvider } = await import("../hq/integrationsHubEngine");
  const hubResult = await testIntegrationHubProvider(provider);
  if (hubResult.message !== "Unknown integration") {
    return res.json(hubResult);
  }
  res.json(await testIntegrationConnection(provider as IntegrationProvider));
});

export default router;
