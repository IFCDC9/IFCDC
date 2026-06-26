import { getDb } from "../db";
import crypto from "crypto";
import bcrypt from "bcryptjs";

export interface RegisteredAppRow {
  id: string;
  name: string;
  description: string | null;
  health_url: string;
  launch_url: string | null;
  status: string;
  api_key_prefix: string;
  api_key_hash: string;
  inherited_services: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function ensureSoftwareDivisionTables() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_registered_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      health_url TEXT NOT NULL,
      launch_url TEXT,
      status TEXT NOT NULL DEFAULT 'development',
      api_key_prefix TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      inherited_services TEXT NOT NULL DEFAULT '[]',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_hq_registered_apps_status ON hq_registered_apps(status);
  `);
}

export function generateAppApiKey(appId: string): string {
  const secret = crypto.randomBytes(24).toString("hex");
  return `ifcdc_${appId}_${secret}`;
}

export function apiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 20) + "…";
}

export async function registerSoftwareApp(input: {
  id: string;
  name: string;
  description?: string;
  healthUrl: string;
  launchUrl?: string;
  inheritedServices?: string[];
  createdBy?: string;
}): Promise<{ app: RegisteredAppRow; apiKey: string }> {
  const db = await getDb();
  const existing = await db.get("SELECT id FROM hq_registered_apps WHERE id = ?", input.id);
  if (existing) {
    throw new Error("An application with this ID is already registered");
  }

  if (input.id === "barbers") {
    throw new Error("The Barbers App is production locked and cannot be re-registered");
  }

  const apiKey = generateAppApiKey(input.id);
  const hash = await bcrypt.hash(apiKey, 10);
  const prefix = apiKeyPrefix(apiKey);
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO hq_registered_apps
     (id, name, description, health_url, launch_url, status, api_key_prefix, api_key_hash, inherited_services, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'development', ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.name,
    input.description ?? null,
    input.healthUrl,
    input.launchUrl ?? null,
    prefix,
    hash,
    JSON.stringify(input.inheritedServices ?? ["auth", "people", "analytics", "notifications"]),
    input.createdBy ?? null,
    now,
    now
  );

  const app = await db.get<RegisteredAppRow>("SELECT * FROM hq_registered_apps WHERE id = ?", input.id);
  return { app: app!, apiKey };
}

export async function listRegisteredApps(): Promise<RegisteredAppRow[]> {
  const db = await getDb();
  return (await db.all("SELECT * FROM hq_registered_apps ORDER BY created_at DESC")) as RegisteredAppRow[];
}

export async function getRegisteredApp(id: string): Promise<RegisteredAppRow | undefined> {
  const db = await getDb();
  return db.get<RegisteredAppRow>("SELECT * FROM hq_registered_apps WHERE id = ?", id);
}

export async function verifyAppApiKey(appId: string, apiKey: string): Promise<boolean> {
  const app = await getRegisteredApp(appId);
  if (!app) return false;
  return bcrypt.compare(apiKey, app.api_key_hash);
}

export async function rotateAppApiKey(appId: string): Promise<{ app: RegisteredAppRow; apiKey: string }> {
  if (appId === "barbers") {
    throw new Error("The Barbers App is production locked — credentials cannot be rotated via HQ");
  }
  const app = await getRegisteredApp(appId);
  if (!app) throw new Error("Application not found");

  const apiKey = generateAppApiKey(appId);
  const hash = await bcrypt.hash(apiKey, 10);
  const prefix = apiKeyPrefix(apiKey);
  const db = await getDb();

  await db.run(
    `UPDATE hq_registered_apps SET api_key_hash = ?, api_key_prefix = ?, updated_at = datetime('now') WHERE id = ?`,
    hash,
    prefix,
    appId
  );

  const updated = await getRegisteredApp(appId);
  return { app: updated!, apiKey };
}
