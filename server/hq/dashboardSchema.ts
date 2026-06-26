import { getDb } from "../db";

export interface UserWorkspaceRow {
  user_id: string;
  workspace_key: string;
  dashboard_mode: "standard" | "custom";
  widgets_json: string;
  updated_at: string;
}

export async function ensureDashboardTables() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_user_workspaces (
      user_id TEXT NOT NULL,
      workspace_key TEXT NOT NULL DEFAULT 'executive',
      dashboard_mode TEXT NOT NULL DEFAULT 'standard',
      widgets_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, workspace_key)
    );
    CREATE INDEX IF NOT EXISTS idx_hq_user_workspaces_user ON hq_user_workspaces(user_id);
  `);
}

export async function getUserWorkspace(userId: string, workspaceKey = "executive") {
  const db = await getDb();
  return db.get<UserWorkspaceRow>(
    `SELECT user_id, workspace_key, dashboard_mode, widgets_json, updated_at
     FROM hq_user_workspaces WHERE user_id = ? AND workspace_key = ?`,
    userId,
    workspaceKey
  );
}

export async function saveUserWorkspace(
  userId: string,
  data: { dashboardMode: "standard" | "custom"; widgets: unknown[] },
  workspaceKey = "executive"
) {
  const db = await getDb();
  await db.run(
    `INSERT INTO hq_user_workspaces (user_id, workspace_key, dashboard_mode, widgets_json, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, workspace_key) DO UPDATE SET
       dashboard_mode = excluded.dashboard_mode,
       widgets_json = excluded.widgets_json,
       updated_at = datetime('now')`,
    userId,
    workspaceKey,
    data.dashboardMode,
    JSON.stringify(data.widgets)
  );
  return getUserWorkspace(userId, workspaceKey);
}
