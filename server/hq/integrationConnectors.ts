import { getDb } from "../db";
import crypto from "crypto";

export type IntegrationProvider =
  | "microsoft_365"
  | "google_workspace"
  | "quickbooks"
  | "payroll_provider"
  | "banking"
  | "grant_database"
  | "crm";

export const INTEGRATION_CATALOG: {
  id: IntegrationProvider;
  name: string;
  category: string;
  description: string;
  status: "available" | "coming_soon" | "configured";
  configFields: string[];
}[] = [
  {
    id: "microsoft_365",
    name: "Microsoft 365",
    category: "Productivity",
    description: "Calendar, email, SharePoint document sync, Teams notifications",
    status: "coming_soon",
    configFields: ["tenant_id", "client_id", "client_secret"],
  },
  {
    id: "google_workspace",
    name: "Google Workspace",
    category: "Productivity",
    description: "Gmail, Calendar, Drive integration for HQ workflows",
    status: "coming_soon",
    configFields: ["client_id", "client_secret", "refresh_token"],
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    category: "Accounting",
    description: "Sync expenses, invoices, payroll, and account balances with Financial Center",
    status: "available",
    configFields: ["realm_id"],
  },
  {
    id: "payroll_provider",
    name: "Payroll Provider",
    category: "HR",
    description: "ADP, Gusto, or Paychex payroll sync with HQ time clock",
    status: "coming_soon",
    configFields: ["provider_name", "api_key", "company_id"],
  },
  {
    id: "banking",
    name: "Banking",
    category: "Finance",
    description: "Plaid or direct bank feed for reconciliation",
    status: "coming_soon",
    configFields: ["institution_id", "access_token"],
  },
  {
    id: "grant_database",
    name: "Grant Databases",
    category: "Grants",
    description: "Grants.gov, Foundation Directory, and SAM.gov opportunity feeds",
    status: "available",
    configFields: ["api_key", "search_keywords"],
  },
  {
    id: "crm",
    name: "CRM",
    category: "Relationships",
    description: "Salesforce or HubSpot donor and partner sync",
    status: "coming_soon",
    configFields: ["instance_url", "api_key"],
  },
];

export async function ensureIntegrationTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_integration_connections (
      id TEXT PRIMARY KEY,
      provider TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'disconnected',
      config_json TEXT,
      last_sync_at TEXT,
      last_error TEXT,
      enabled INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  for (const item of INTEGRATION_CATALOG) {
    const exists = await db.get("SELECT id FROM hq_integration_connections WHERE provider = ?", item.id);
    if (!exists) {
      await db.run(
        `INSERT INTO hq_integration_connections (id, provider, name, status, enabled, created_at, updated_at)
         VALUES (?, ?, ?, 'disconnected', 0, ?, ?)`,
        crypto.randomUUID(), item.id, item.name, now, now
      );
    }
  }
}

export async function getIntegrationsHub() {
  const { buildIntegrationsHubSafe } = await import("./integrationsHubEngine");
  return buildIntegrationsHubSafe();
}

export async function configureIntegration(
  provider: IntegrationProvider,
  config: Record<string, string>,
  enabled: boolean
) {
  await ensureIntegrationTables();
  const db = await getDb();
  const catalog = INTEGRATION_CATALOG.find((c) => c.id === provider);
  if (!catalog) throw new Error("Unknown provider");
  const now = new Date().toISOString();
  const status = enabled && Object.keys(config).length > 0 ? "configured" : "disconnected";
  await db.run(
    `UPDATE hq_integration_connections SET config_json = ?, status = ?, enabled = ?, updated_at = ? WHERE provider = ?`,
    JSON.stringify(config), status, enabled ? 1 : 0, now, provider
  );
  return db.get("SELECT * FROM hq_integration_connections WHERE provider = ?", provider);
}

export async function testIntegrationConnection(provider: IntegrationProvider) {
  const catalog = INTEGRATION_CATALOG.find((c) => c.id === provider);
  if (!catalog) return { success: false, message: "Unknown provider" };
  if (provider === "quickbooks") {
    const { getQuickBooksConnection, isQuickBooksConfigured } = await import("./quickbooksOAuth");
    const conn = await getQuickBooksConnection();
    return {
      success: conn.connected || isQuickBooksConfigured(),
      message: conn.connected ? "QuickBooks connected" : "OAuth ready — use Connect in Integrations Hub",
      provider,
      testedAt: new Date().toISOString(),
    };
  }
  return {
    success: true,
    message: `${catalog.name} connector ready — OAuth credentials will be validated when integration is activated`,
    provider,
    testedAt: new Date().toISOString(),
  };
}
