import { Router } from "express";
import { hqAuthRequired, requireHQPermission } from "../middleware/hqAuth";
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
import { hasPermission } from "../hq/enterpriseRoles";

const router = Router();

router.use(hqAuthRequired);

router.get("/overview", requireHQPermission("hq.executive", "hq.analytics"), async (_req, res) => {
  res.json(await buildEnterpriseOverview());
});

router.get("/modules", requireHQPermission("hq.executive", "hq.analytics"), async (_req, res) => {
  res.json({ modules: await buildEnterpriseModuleRegistry() });
});

router.get("/search", requireHQPermission("hq.executive", "hq.analytics", "hq.grants", "hq.hr", "hq.finance"), async (req, res) => {
  const q = String(req.query.q ?? "");
  res.json({ results: await enterpriseGlobalSearch(q) });
});

router.get("/notifications", requireHQPermission("hq.notifications", "hq.executive"), async (_req, res) => {
  res.json(await buildEnterpriseNotifications());
});

router.get("/approvals", requireHQPermission("hq.executive", "hq.hr.approve", "hq.finance.manage", "hq.grants.manage"), async (_req, res) => {
  res.json(await buildApprovalQueue(25));
});

router.patch("/approvals/:taskId", requireHQPermission("hq.executive", "hq.hr.approve", "hq.finance.manage", "hq.grants.manage", "hq.settings"), async (req, res) => {
  const action = req.body?.action;
  if (!["approve", "reject", "complete"].includes(action)) {
    return res.status(400).json({ error: "action must be approve, reject, or complete" });
  }
  if (req.hqUser?.role !== "owner" && !hasPermission(req.hqUser!.role, "hq.executive")) {
    const taskType = String(req.params.taskId).split(":")[0];
    const typePerm: Record<string, string[]> = {
      leave: ["hq.hr.approve"],
      expense: ["hq.finance.manage"],
      purchase: ["hq.finance.manage"],
      document: ["hq.settings"],
      grant: ["hq.grants.manage"],
    };
    const required = typePerm[taskType] ?? ["hq.executive"];
    if (!required.some((p) => hasPermission(req.hqUser!.role, p as never))) {
      return res.status(403).json({ error: "Insufficient permissions for this approval type" });
    }
  }
  const result = await processApprovalTask(
    req.params.taskId,
    action,
    { id: req.hqUser?.id, email: req.hqUser?.email }
  );
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

router.patch("/notifications/:id/read", requireHQPermission("hq.notifications", "hq.executive"), async (req, res) => {
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
