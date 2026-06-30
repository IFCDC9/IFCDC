import { Router } from "express";
import { authRequired, requireRole } from "../../middleware/legacyAuth";
import { getMonolithDb } from "../../monolith/dbAccess";
import { logAudit } from "../../monolith/audit";
import { ROLES } from "../../monolith/constants";

export function createOutreachRouter(): Router {
  const router = Router();

// ----- Outreach Tasks CRUD -----
router.get(
  "/outreach-tasks",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CASE_MANAGER, ROLES.CHW, ROLES.ADMIN),
  async (req, res) => {
    const status = (req.query.status as string) || "OPEN";
    try {
      let rows;
      if (req.user!.role === ROLES.EXEC || req.user!.role === ROLES.ADMIN || req.user!.role === ROLES.CHW) {
        const db = getMonolithDb();
        rows = await db.all<any[]>(
          `SELECT ot.id, ot.client_id, ot.phone, ot.channel, ot.reason,
                  ot.status, ot.created_at, ot.completed_at,
                  c.full_name as client_name
           FROM outreach_tasks ot
           LEFT JOIN clients c ON ot.client_id = c.id
           WHERE ot.status = ?
           ORDER BY ot.created_at DESC`,
          status
        );
      } else {
        const db = getMonolithDb();
        rows = await db.all<any[]>(
          `SELECT ot.id, ot.client_id, ot.phone, ot.channel, ot.reason,
                  ot.status, ot.created_at, ot.completed_at,
                  c.full_name as client_name
           FROM outreach_tasks ot
           LEFT JOIN clients c ON ot.client_id = c.id
           WHERE ot.status = ?
             AND (
               ot.client_id IS NULL OR
               ot.client_id IN (
                 SELECT client_id FROM client_assignments WHERE user_id = ?
               )
             )
           ORDER BY ot.created_at DESC`,
          status, req.user!.id
        );
      }

      await logAudit(req, { action: "LIST_OUTREACH_TASKS", targetType: "OUTREACH_TASK", targetId: null, extra: { status, count: rows.length } });

      const list = rows.map((t: Record<string, unknown>) => ({
        id: t.id,
        clientId: t.client_id,
        clientName: t.client_name,
        phone: t.phone,
        channel: t.channel,
        reason: t.reason,
        status: t.status,
        createdAt: t.created_at,
        completedAt: t.completed_at,
      }));

      res.json(list);
    } catch (err) {
      console.error("Error listing outreach tasks:", err);
      res.status(500).json({ error: "Failed to load outreach tasks" });
    }
  }
);

router.post(
  "/outreach-tasks/:id/complete",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CASE_MANAGER, ROLES.CHW, ROLES.ADMIN),
  async (req, res) => {
    const id = req.params.id;
    const now = new Date().toISOString();

    const db = getMonolithDb();
    const task = await db.get<{ id: string; status: string }>(
      "SELECT id, status FROM outreach_tasks WHERE id = ?",
      id
    );
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }
    if (task.status === "DONE") {
      return res.status(400).json({ error: "Task already completed" });
    }

    await db.run(
      `UPDATE outreach_tasks SET status = 'DONE', completed_at = ? WHERE id = ?`,
      now, id
    );

    await logAudit(req, { action: "COMPLETE_OUTREACH_TASK", targetType: "OUTREACH_TASK", targetId: id, extra: {} });

    res.json({ ok: true });
  }
);

  return router;
}

export function registerOutreachRoutes(app: import("express").Express): void {
  app.use("/api", createOutreachRouter());
}
