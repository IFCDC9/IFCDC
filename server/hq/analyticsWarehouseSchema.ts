import { getDb } from "../db";
import crypto from "crypto";

export function warehouseId() {
  return crypto.randomUUID();
}

export async function ensureWarehouseTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_warehouse_snapshots (
      id TEXT PRIMARY KEY,
      snapshot_type TEXT NOT NULL,
      domain TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      record_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_warehouse_domain ON hq_warehouse_snapshots(domain, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_warehouse_type ON hq_warehouse_snapshots(snapshot_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS hq_warehouse_metrics (
      id TEXT PRIMARY KEY,
      metric_key TEXT NOT NULL,
      metric_value REAL NOT NULL,
      dimension TEXT,
      period TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_warehouse_metrics_key ON hq_warehouse_metrics(metric_key, period);
  `);
}
