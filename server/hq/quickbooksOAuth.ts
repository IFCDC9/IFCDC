import crypto from "crypto";
import { getDb } from "../db";
import { ensureIntegrationTables, configureIntegration } from "./integrationConnectors";
import { buildExecutiveDashboard } from "./financeReporting";
import { logHqAudit } from "./hqAuditLog";

const QB_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_API_BASE = process.env.QUICKBOOKS_ENVIRONMENT === "production"
  ? "https://quickbooks.api.intuit.com"
  : "https://sandbox-quickbooks.api.intuit.com";

function getQbConfig() {
  return {
    clientId: process.env.QUICKBOOKS_CLIENT_ID ?? "",
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET ?? "",
    redirectUri: process.env.QUICKBOOKS_REDIRECT_URI ?? `${process.env.PUBLIC_BASE_URL ?? "http://localhost:5001"}/api/hq/integrations/quickbooks/callback`,
  };
}

export function isQuickBooksConfigured(): boolean {
  const { clientId, clientSecret } = getQbConfig();
  return Boolean(clientId && clientSecret);
}

export async function getQuickBooksConnection() {
  await ensureIntegrationTables();
  const db = await getDb();
  const row = await db.get<{ config_json: string; status: string; last_sync_at: string | null; last_error: string | null }>(
    "SELECT config_json, status, last_sync_at, last_error FROM hq_integration_connections WHERE provider = 'quickbooks'"
  );
  if (!row) return { connected: false, status: "disconnected" };
  let config: Record<string, string> = {};
  try { config = JSON.parse(row.config_json ?? "{}"); } catch { /* */ }
  return {
    connected: row.status === "connected" && Boolean(config.access_token),
    status: row.status,
    realmId: config.realm_id ?? null,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    oauthConfigured: isQuickBooksConfigured(),
  };
}

export function buildQuickBooksAuthUrl(state: string): string {
  const { clientId, redirectUri } = getQbConfig();
  if (!clientId) {
    throw new Error("QuickBooks OAuth not configured — set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri,
    state,
  });
  return `${QB_AUTH_URL}?${params.toString()}`;
}

export async function exchangeQuickBooksCode(code: string, realmId: string): Promise<void> {
  const { clientId, clientSecret, redirectUri } = getQbConfig();
  if (!clientId || !clientSecret) throw new Error("QuickBooks OAuth credentials missing");

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`QuickBooks token exchange failed: ${errText.slice(0, 200)}`);
  }

  const tokens = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in?: number;
  };

  const now = new Date().toISOString();
  const db = await getDb();
  await configureIntegration("quickbooks", {
    realm_id: realmId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  }, true);

  await db.run(
    `UPDATE hq_integration_connections SET status = 'connected', last_error = NULL, updated_at = ? WHERE provider = 'quickbooks'`,
    now
  );
}

async function refreshQuickBooksToken(config: Record<string, string>): Promise<Record<string, string>> {
  const { clientId, clientSecret } = getQbConfig();
  if (!config.refresh_token || !clientId || !clientSecret) return config;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: config.refresh_token,
  });

  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) return config;
  const tokens = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  const updated = {
    ...config,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  };
  await configureIntegration("quickbooks", updated, true);
  return updated;
}

async function qbApiGet(path: string, config: Record<string, string>): Promise<unknown> {
  let cfg = config;
  if (cfg.token_expires_at && new Date(cfg.token_expires_at).getTime() < Date.now() + 60000) {
    cfg = await refreshQuickBooksToken(config);
  }
  const url = `${QB_API_BASE}/v3/company/${cfg.realm_id}/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.access_token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`QuickBooks API error: ${res.status}`);
  return res.json();
}

export async function syncQuickBooksToFinance(actorEmail?: string) {
  await ensureIntegrationTables();
  const db = await getDb();
  const row = await db.get<{ config_json: string }>(
    "SELECT config_json FROM hq_integration_connections WHERE provider = 'quickbooks'"
  );
  let config: Record<string, string> = {};
  try { config = JSON.parse(row?.config_json ?? "{}"); } catch { /* */ }

  const now = new Date().toISOString();
  let syncResult: Record<string, unknown>;

  if (config.access_token && config.realm_id) {
    try {
      const [companyInfo, profitLoss] = await Promise.all([
        qbApiGet("companyinfo/companyinfo", config).catch(() => null),
        qbApiGet("reports/ProfitAndLoss?start_date=2024-01-01&end_date=2025-12-31", config).catch(() => null),
      ]);
      syncResult = {
        source: "quickbooks_api",
        companyInfo,
        profitAndLoss: profitLoss,
        syncedAt: now,
      };
      await db.run(
        `UPDATE hq_integration_connections SET status = 'connected', last_sync_at = ?, last_error = NULL, updated_at = ? WHERE provider = 'quickbooks'`,
        now, now
      );
    } catch (err) {
      const msg = (err as Error).message;
      await db.run(
        `UPDATE hq_integration_connections SET last_error = ?, updated_at = ? WHERE provider = 'quickbooks'`,
        msg, now
      );
      throw err;
    }
  } else {
    const dashboard = await buildExecutiveDashboard();
    syncResult = {
      source: "hq_finance_fallback",
      income: dashboard.totalRevenue,
      expenses: dashboard.monthlyExpenses,
      cashFlow: dashboard.cashFlow,
      netPosition: dashboard.netPosition,
      payrollTotal: dashboard.monthlyPayroll,
      donationsReceived: dashboard.donationsReceived,
      message: "Connect QuickBooks OAuth for live sync — using HQ Financial Center data",
      syncedAt: now,
    };
    await db.run(
      `UPDATE hq_integration_connections SET last_sync_at = ?, updated_at = ? WHERE provider = 'quickbooks'`,
      now, now
    );
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_quickbooks_sync_log (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  await db.run(
    `INSERT INTO hq_quickbooks_sync_log (id, payload_json, created_at) VALUES (?, ?, ?)`,
    crypto.randomUUID(), JSON.stringify(syncResult), now
  );

  await logHqAudit({
    action: "quickbooks_sync",
    entityType: "integration",
    entityId: "quickbooks",
    detail: `Sync completed (${syncResult.source})`,
    actorEmail,
  });

  return syncResult;
}

export async function getQuickBooksSyncSummary() {
  const connection = await getQuickBooksConnection();
  const db = await getDb();
  const latest = await db.get<{ payload_json: string; created_at: string }>(
    "SELECT payload_json, created_at FROM hq_quickbooks_sync_log ORDER BY created_at DESC LIMIT 1"
  ).catch(() => undefined);

  let lastSync: Record<string, unknown> | null = null;
  if (latest) {
    try { lastSync = JSON.parse(latest.payload_json); } catch { /* */ }
    if (lastSync) lastSync.syncedAt = latest.created_at;
  }

  return { connection, lastSync };
}
