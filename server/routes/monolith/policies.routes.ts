import { Router } from "express";
import { authRequired, requireRole } from "../../middleware/legacyAuth";
import { getMonolithDb } from "../../monolith/dbAccess";
import { logAudit } from "../../monolith/audit";
import { cryptoRandomId, ROLES } from "../../monolith/constants";

const POLICY_ROLES = [ROLES.ADMIN, ROLES.EXEC, "admin", "owner", "exec"];

export function createPoliciesRouter(): Router {
  const router = Router();

  router.get("/policies", authRequired, requireRole(...POLICY_ROLES), async (_req, res) => {
    try {
      const db = getMonolithDb();
      const policies = await db.all(`
      SELECT pv.*, u.name as created_by_name
      FROM policy_versions pv
      LEFT JOIN users u ON pv.created_by = u.id
      ORDER BY pv.policy_name, pv.created_at DESC
    `);
      res.json(policies);
    } catch (err) {
      console.error("Error fetching policies:", err);
      res.status(500).json({ error: "Failed to fetch policies" });
    }
  });

  router.get("/policies/names", authRequired, requireRole(...POLICY_ROLES), async (_req, res) => {
    try {
      const db = getMonolithDb();
      const names = await db.all(`
      SELECT DISTINCT policy_name FROM policy_versions ORDER BY policy_name
    `);
      res.json(names.map((n: any) => n.policy_name));
    } catch (err) {
      console.error("Error fetching policy names:", err);
      res.status(500).json({ error: "Failed to fetch policy names" });
    }
  });

  router.get("/policies/:policyName/history", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
    try {
      const { policyName } = req.params;
      const db = getMonolithDb();
      const history = await db.all(
        `
      SELECT pv.*, u.name as created_by_name
      FROM policy_versions pv
      LEFT JOIN users u ON pv.created_by = u.id
      WHERE pv.policy_name = ?
      ORDER BY pv.created_at DESC
    `,
        decodeURIComponent(policyName),
      );
      res.json(history);
    } catch (err) {
      console.error("Error fetching policy history:", err);
      res.status(500).json({ error: "Failed to fetch policy history" });
    }
  });

  router.get("/policies/version/:id", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
    try {
      const { id } = req.params;
      const db = getMonolithDb();
      const policy = await db.get(
        `
      SELECT pv.*, u.name as created_by_name
      FROM policy_versions pv
      LEFT JOIN users u ON pv.created_by = u.id
      WHERE pv.id = ?
    `,
        id,
      );
      if (!policy) {
        return res.status(404).json({ error: "Policy version not found" });
      }
      res.json(policy);
    } catch (err) {
      console.error("Error fetching policy version:", err);
      res.status(500).json({ error: "Failed to fetch policy version" });
    }
  });

  router.post("/policies", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const { policy_name, version, content, summary, effective_date, status } = req.body;

      if (!policy_name || !version || !content) {
        return res.status(400).json({ error: "policy_name, version, and content are required" });
      }

      const db = getMonolithDb();
      const existingVersion = await db.get(
        "SELECT id FROM policy_versions WHERE policy_name = ? AND version = ?",
        policy_name,
        version,
      );
      if (existingVersion) {
        return res.status(409).json({ error: "This version already exists for this policy" });
      }

      const id = cryptoRandomId();
      const now = new Date().toISOString();

      await db.run(
        `
      INSERT INTO policy_versions (id, policy_name, version, content, summary, effective_date, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        id,
        policy_name,
        version,
        content,
        summary || null,
        effective_date || null,
        status || "draft",
        req.user.id,
        now,
        now,
      );

      await logAudit(req, {
        action: "create_policy_version",
        targetType: "policy",
        targetId: id,
        extra: { policy_name, version },
      });

      const newPolicy = await db.get("SELECT * FROM policy_versions WHERE id = ?", id);
      res.status(201).json(newPolicy);
    } catch (err) {
      console.error("Error creating policy version:", err);
      res.status(500).json({ error: "Failed to create policy version" });
    }
  });

  router.patch("/policies/:id", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
    try {
      const { id } = req.params;
      const { content, summary, effective_date, status } = req.body;

      const db = getMonolithDb();
      const existing = await db.get("SELECT * FROM policy_versions WHERE id = ?", id);
      if (!existing) {
        return res.status(404).json({ error: "Policy version not found" });
      }

      const now = new Date().toISOString();
      await db.run(
        `
      UPDATE policy_versions
      SET content = COALESCE(?, content),
          summary = COALESCE(?, summary),
          effective_date = COALESCE(?, effective_date),
          status = COALESCE(?, status),
          updated_at = ?
      WHERE id = ?
    `,
        content,
        summary,
        effective_date,
        status,
        now,
        id,
      );

      await logAudit(req, {
        action: "update_policy_version",
        targetType: "policy",
        targetId: id,
        extra: { policy_name: existing.policy_name, version: existing.version, status },
      });

      const updated = await db.get("SELECT * FROM policy_versions WHERE id = ?", id);
      res.json(updated);
    } catch (err) {
      console.error("Error updating policy version:", err);
      res.status(500).json({ error: "Failed to update policy version" });
    }
  });

  router.delete("/policies/:id", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
    try {
      const { id } = req.params;

      const db = getMonolithDb();
      const existing = await db.get("SELECT * FROM policy_versions WHERE id = ?", id);
      if (!existing) {
        return res.status(404).json({ error: "Policy version not found" });
      }

      await db.run("DELETE FROM policy_versions WHERE id = ?", id);

      await logAudit(req, {
        action: "delete_policy_version",
        targetType: "policy",
        targetId: id,
        extra: { policy_name: existing.policy_name, version: existing.version },
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting policy version:", err);
      res.status(500).json({ error: "Failed to delete policy version" });
    }
  });

  router.patch("/policies/:id/publish", authRequired, requireRole(...POLICY_ROLES), async (req, res) => {
    try {
      const { id } = req.params;

      const db = getMonolithDb();
      const existing = await db.get("SELECT * FROM policy_versions WHERE id = ?", id);
      if (!existing) {
        return res.status(404).json({ error: "Policy version not found" });
      }

      const now = new Date().toISOString();

      await db.exec("BEGIN TRANSACTION");
      try {
        await db.run(
          `
        UPDATE policy_versions
        SET status = 'archived'
        WHERE policy_name = ? AND status = 'published' AND id != ?
      `,
          existing.policy_name,
          id,
        );

        await db.run(
          `
        UPDATE policy_versions
        SET status = 'published', effective_date = COALESCE(effective_date, ?), updated_at = ?
        WHERE id = ?
      `,
          now.split("T")[0],
          now,
          id,
        );

        await db.exec("COMMIT");
      } catch (txErr) {
        await db.exec("ROLLBACK");
        throw txErr;
      }

      await logAudit(req, {
        action: "publish_policy_version",
        targetType: "policy",
        targetId: id,
        extra: { policy_name: existing.policy_name, version: existing.version },
      });

      const updated = await db.get("SELECT * FROM policy_versions WHERE id = ?", id);
      res.json(updated);
    } catch (err) {
      console.error("Error publishing policy version:", err);
      res.status(500).json({ error: "Failed to publish policy version" });
    }
  });

  return router;
}

export function registerPoliciesRoutes(app: import("express").Express): void {
  app.use("/api", createPoliciesRouter());
}
