/**
 * Phase 9 — Enterprise Notification Center
 * Priority queue with alert thresholds and delivery tracking.
 */
import { getDb } from "../db";
import crypto from "crypto";
import { buildEnterpriseNotifications, type EnterpriseNotification } from "./enterpriseHub";
import { scanKpiAnomalies } from "./anomalyMonitor";

export interface AlertThreshold {
  id: string;
  metric: string;
  label: string;
  threshold: number;
  operator: "lt" | "gt" | "eq";
  severity: "high" | "medium" | "low";
  enabled: boolean;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThreshold[] = [
  { id: "org_health", metric: "organization_health", label: "Organization Health", threshold: 80, operator: "lt", severity: "high", enabled: true },
  { id: "cash_flow", metric: "cash_flow", label: "Cash Flow", threshold: 0, operator: "lt", severity: "high", enabled: true },
  { id: "compliance_due", metric: "compliance_due", label: "Compliance Items Due", threshold: 0, operator: "gt", severity: "medium", enabled: true },
  { id: "grant_pipeline", metric: "grant_pipeline", label: "Grant Pipeline Value", threshold: 50000, operator: "lt", severity: "low", enabled: true },
];

export async function ensureNotificationQueueTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_notification_queue (
      id TEXT PRIMARY KEY,
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      priority TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'pending',
      channel TEXT DEFAULT 'in_app',
      target_email TEXT,
      path TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notif_queue_status ON hq_notification_queue(status, priority, created_at DESC);

    CREATE TABLE IF NOT EXISTS hq_alert_thresholds (
      id TEXT PRIMARY KEY,
      metric TEXT NOT NULL,
      label TEXT NOT NULL,
      threshold REAL NOT NULL,
      operator TEXT DEFAULT 'lt',
      severity TEXT DEFAULT 'medium',
      enabled INTEGER DEFAULT 1,
      updated_at TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();
  for (const t of DEFAULT_ALERT_THRESHOLDS) {
    const exists = await db.get("SELECT id FROM hq_alert_thresholds WHERE id = ?", t.id);
    if (!exists) {
      await db.run(
        `INSERT INTO hq_alert_thresholds (id, metric, label, threshold, operator, severity, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        t.id, t.metric, t.label, t.threshold, t.operator, t.severity, now
      );
    }
  }
}

export async function enqueueNotification(opts: {
  type: string;
  title: string;
  message: string;
  priority?: "high" | "normal" | "low";
  channel?: "in_app" | "email" | "push";
  targetEmail?: string;
  path?: string;
  payload?: Record<string, unknown>;
}): Promise<string> {
  await ensureNotificationQueueTables();
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO hq_notification_queue (id, notification_type, title, message, priority, status, channel, target_email, path, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    id, opts.type, opts.title, opts.message,
    opts.priority ?? "normal", opts.channel ?? "in_app",
    opts.targetEmail ?? null, opts.path ?? null,
    opts.payload ? JSON.stringify(opts.payload) : null, now
  );
  return id;
}

export async function buildNotificationPriorityQueue(limit = 50) {
  await ensureNotificationQueueTables();
  const db = await getDb();

  const [enterprise, queueRows, thresholds, anomalies] = await Promise.all([
    buildEnterpriseNotifications(),
    db.all(
      `SELECT * FROM hq_notification_queue WHERE status IN ('pending', 'delivered')
       ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at DESC LIMIT ?`,
      limit
    ).catch(() => []),
    db.all("SELECT * FROM hq_alert_thresholds WHERE enabled = 1").catch(() => []),
    scanKpiAnomalies().catch(() => []),
  ]);

  const queueNotifs: EnterpriseNotification[] = (queueRows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    type: String(r.notification_type) as EnterpriseNotification["type"],
    title: String(r.title),
    message: String(r.message),
    timestamp: String(r.created_at),
    read: Boolean(r.read_at),
    path: r.path ? String(r.path) : undefined,
    priority: (r.priority as EnterpriseNotification["priority"]) ?? "normal",
  }));

  const merged = [...enterprise.notifications];
  const existingIds = new Set(merged.map((n) => n.id));
  for (const q of queueNotifs) {
    if (!existingIds.has(q.id)) merged.push(q);
  }

  for (const a of anomalies) {
    const id = `anomaly-${a.id}`;
    if (existingIds.has(id)) continue;
    merged.push({
      id,
      type: "alert",
      title: a.title,
      message: a.detail,
      timestamp: a.timestamp,
      read: false,
      path: "/hq/intelligence",
      priority: a.severity === "high" ? "high" : "normal",
    });
  }

  const priorityOrder = { high: 0, normal: 1, low: 2 };
  merged.sort((a, b) => {
    const p = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (p !== 0) return p;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return {
    notifications: merged.slice(0, limit),
    unreadCount: merged.filter((n) => !n.read).length,
    highPriorityCount: merged.filter((n) => n.priority === "high" && !n.read).length,
    executiveQueue: merged.filter((n) => n.priority === "high").slice(0, 10),
    thresholds: thresholds as AlertThreshold[],
    channels: { inApp: true, email: true, push: true, websocket: true },
    timestamp: new Date().toISOString(),
  };
}

export async function markQueueNotificationRead(id: string): Promise<void> {
  await ensureNotificationQueueTables();
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    "UPDATE hq_notification_queue SET read_at = ?, status = 'read' WHERE id = ?",
    now, id
  );
}
