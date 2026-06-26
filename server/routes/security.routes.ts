import { Router } from "express";
import type { Request, Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  buildSecurityDashboard,
  getActivityMonitor,
  getLoginHistory,
  getActiveSessions,
  getKnownDevices,
  getThreatMonitor,
} from "../hq/enterpriseSecurity";
import { queryHqAudit } from "../hq/hqAuditLog";
import {
  createDatabaseBackup,
  listRestorePoints,
  restoreFromBackup,
  getBackupHealth,
} from "../hq/hqBackupService";
import { revokeSession } from "../hq/hqSecuritySessions";

const router = Router();
router.use(hqAuthRequired, requireHQModule("settings"));

router.get("/dashboard", async (_req, res) => {
  res.json(await buildSecurityDashboard());
});

router.get("/audit", async (req, res) => {
  const limit = Number(req.query.limit ?? 100);
  const action = String(req.query.action ?? "").trim() || undefined;
  const entityType = String(req.query.entity ?? "").trim() || undefined;
  res.json({ audit: await queryHqAudit({ limit, action, entityType }) });
});

router.get("/activity", async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json({ activity: await getActivityMonitor(limit) });
});

router.get("/login-history", async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json({ logins: await getLoginHistory(limit) });
});

router.get("/sessions", async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json({ sessions: await getActiveSessions(limit) });
});

router.post("/sessions/:id/revoke", async (req: Request, res: Response) => {
  const ok = await revokeSession(req.params.id, req.hqUser?.email);
  if (!ok) return res.status(404).json({ error: "Session not found" });
  res.json({ ok: true });
});

router.get("/devices", async (req, res) => {
  const limit = Number(req.query.limit ?? 30);
  res.json({ devices: await getKnownDevices(limit) });
});

router.get("/threats", async (_req, res) => {
  res.json(await getThreatMonitor());
});

router.get("/backup/health", async (_req, res) => {
  res.json(await getBackupHealth());
});

router.get("/backup/restore-points", async (req, res) => {
  const limit = Number(req.query.limit ?? 20);
  res.json({ restorePoints: await listRestorePoints(limit) });
});

router.post("/backup/snapshot", async (req: Request, res: Response) => {
  try {
    const snapshot = await createDatabaseBackup(req.hqUser?.email ?? "manual");
    res.status(201).json({ snapshot, status: "created" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, status: "failed" });
  }
});

router.post("/backup/restore/:id", async (req: Request, res: Response) => {
  if (req.hqUser?.role !== "owner" && req.hqUser?.role !== "admin") {
    return res.status(403).json({ error: "Only founders and administrators can restore backups" });
  }
  const result = await restoreFromBackup(req.params.id, req.hqUser?.email);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

export default router;
