import { Router } from "express";
import { hqAuthRequired } from "../middleware/hqAuth";
import {
  buildEnterpriseModuleRegistry,
  buildEnterpriseNotifications,
  buildEnterpriseOverview,
  enterpriseGlobalSearch,
} from "../hq/enterpriseHub";
import { buildApprovalQueue } from "../hq/enterpriseApprovals";
import { getDb } from "../db";
import { markLeadershipAlertRead } from "../hq/criticalAlerts";
import { processApprovalTask } from "../hq/workflowEngine";

const router = Router();

router.use(hqAuthRequired);

router.get("/overview", async (_req, res) => {
  res.json(await buildEnterpriseOverview());
});

router.get("/modules", async (_req, res) => {
  res.json({ modules: await buildEnterpriseModuleRegistry() });
});

router.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "");
  res.json({ results: await enterpriseGlobalSearch(q) });
});

router.get("/notifications", async (_req, res) => {
  res.json(await buildEnterpriseNotifications());
});

router.get("/approvals", async (_req, res) => {
  res.json(await buildApprovalQueue(25));
});

router.patch("/approvals/:taskId", async (req, res) => {
  const action = req.body?.action;
  if (!["approve", "reject", "complete"].includes(action)) {
    return res.status(400).json({ error: "action must be approve, reject, or complete" });
  }
  const result = await processApprovalTask(
    req.params.taskId,
    action,
    { id: req.hqUser?.id, email: req.hqUser?.email }
  );
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

router.patch("/notifications/:id/read", async (req, res) => {
  const db = await getDb();
  try {
    const leadership = await db.get("SELECT id FROM hq_leadership_alerts WHERE id = ?", req.params.id);
    if (leadership) {
      await markLeadershipAlertRead(req.params.id);
      return res.json({ ok: true });
    }
    await db.run("UPDATE grant_notifications SET read = 1 WHERE id = ?", req.params.id);
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

export default router;
