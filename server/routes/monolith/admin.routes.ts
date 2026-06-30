import { Router } from "express";
import { authRequired, requireAdmin } from "../../middleware/legacyAuth";
import { getMonolithDb } from "../../monolith/dbAccess";
import { logAudit } from "../../monolith/audit";
import { cryptoRandomId } from "../../monolith/constants";

export function createAdminRouter(): Router {
  const router = Router();

  router.get("/services", authRequired, requireAdmin, async (req, res) => {
    try {
      const db = getMonolithDb();
      const services = await db.all("SELECT * FROM services ORDER BY name ASC");
      res.json(services);
    } catch (err) {
      console.error("Error fetching services:", err);
      res.status(500).json({ error: "Failed to fetch services" });
    }
  });

  router.post("/services", authRequired, requireAdmin, async (req, res) => {
    try {
      const { name, description, duration, price, category } = req.body;
      if (!name) return res.status(400).json({ error: "Service name is required" });

      const db = getMonolithDb();
      const id = cryptoRandomId();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO services (id, name, description, duration, price, category, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        id,
        name,
        description || null,
        duration || 30,
        price || 0,
        category || null,
        now,
        now,
      );
      await logAudit(req, { action: "CREATE", targetType: "SERVICE", targetId: id, extra: { name, category } });
      res.status(201).json({ id, name, description, duration, price, category, active: 1 });
    } catch (err) {
      console.error("Error creating service:", err);
      res.status(500).json({ error: "Failed to create service" });
    }
  });

  router.patch("/services/:id", authRequired, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, duration, price, category, active } = req.body;
      const db = getMonolithDb();
      const existing = await db.get<any>("SELECT * FROM services WHERE id = ?", id);
      if (!existing) return res.status(404).json({ error: "Service not found" });

      const now = new Date().toISOString();
      await db.run(
        `UPDATE services SET name = ?, description = ?, duration = ?, price = ?, category = ?, active = ?, updated_at = ? WHERE id = ?`,
        name ?? existing.name,
        description ?? existing.description,
        duration ?? existing.duration,
        price ?? existing.price,
        category ?? existing.category,
        active ?? existing.active,
        now,
        id,
      );
      await logAudit(req, { action: "UPDATE", targetType: "SERVICE", targetId: id, extra: { name } });
      res.json({ success: true });
    } catch (err) {
      console.error("Error updating service:", err);
      res.status(500).json({ error: "Failed to update service" });
    }
  });

  router.delete("/services/:id", authRequired, requireAdmin, async (req, res) => {
    try {
      const db = getMonolithDb();
      await db.run("DELETE FROM services WHERE id = ?", req.params.id);
      await logAudit(req, { action: "DELETE", targetType: "SERVICE", targetId: req.params.id, extra: {} });
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting service:", err);
      res.status(500).json({ error: "Failed to delete service" });
    }
  });

  router.get("/funding-sources", authRequired, requireAdmin, async (_req, res) => {
    try {
      const db = getMonolithDb();
      const rows = await db.all<any[]>("SELECT * FROM funding_sources ORDER BY source_key ASC");
      res.json(
        rows.map((r) => ({
          id: r.id,
          sourceKey: r.source_key,
          displayName: r.display_name,
          enabled: !!r.enabled,
          sandbox: !!r.sandbox,
          createdAt: r.created_at,
        })),
      );
    } catch (err) {
      console.error("Error fetching funding sources:", err);
      res.status(500).json({ error: "Failed to fetch funding sources" });
    }
  });

  router.post("/funding-sources", authRequired, requireAdmin, async (req, res) => {
    try {
      const { sourceKey, displayName, enabled = false, sandbox = false } = req.body;
      if (!sourceKey || !displayName) {
        return res.status(400).json({ error: "sourceKey and displayName required" });
      }
      const db = getMonolithDb();
      const id = cryptoRandomId();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO funding_sources (id, source_key, display_name, enabled, sandbox, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        sourceKey,
        displayName,
        enabled ? 1 : 0,
        sandbox ? 1 : 0,
        now,
      );
      await logAudit(req, { action: "CREATE", targetType: "FUNDING_SOURCE", targetId: id, extra: { sourceKey } });
      res.json({ id, sourceKey, displayName, enabled, sandbox, createdAt: now });
    } catch (err) {
      console.error("Error creating funding source:", err);
      res.status(500).json({ error: "Failed to create funding source" });
    }
  });

  router.delete("/funding-sources/:id", authRequired, requireAdmin, async (req, res) => {
    try {
      const db = getMonolithDb();
      await db.run("DELETE FROM funding_sources WHERE id = ?", req.params.id);
      await logAudit(req, { action: "DELETE", targetType: "FUNDING_SOURCE", targetId: req.params.id, extra: {} });
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting funding source:", err);
      res.status(500).json({ error: "Failed to delete funding source" });
    }
  });

  router.patch("/funding-sources/:key", authRequired, requireAdmin, async (req, res) => {
    try {
      const db = getMonolithDb();
      await db.run(`UPDATE funding_sources SET enabled = ? WHERE source_key = ?`, req.body.enabled ? 1 : 0, req.params.key);
      res.json({ status: "updated" });
    } catch (err) {
      console.error("Error updating funding source:", err);
      res.status(500).json({ error: "Failed to update funding source" });
    }
  });

  router.get("/funding-events", authRequired, requireAdmin, async (_req, res) => {
    try {
      const db = getMonolithDb();
      res.json(await db.all<any[]>("SELECT * FROM funding_events ORDER BY created_at DESC"));
    } catch (err) {
      console.error("Error fetching funding events:", err);
      res.status(500).json({ error: "Failed to fetch funding events" });
    }
  });

  router.get("/funding-metrics", authRequired, requireAdmin, async (_req, res) => {
    try {
      const db = getMonolithDb();
      res.json(
        await db.all<any[]>(`
          SELECT source_key, SUM(amount_cents) as total
          FROM funding_events GROUP BY source_key
        `),
      );
    } catch (err) {
      console.error("Error fetching funding metrics:", err);
      res.status(500).json({ error: "Failed to fetch funding metrics" });
    }
  });

  router.post("/ach-log", authRequired, requireAdmin, async (req, res) => {
    try {
      const db = getMonolithDb();
      const id = cryptoRandomId();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO funding_events (id, source_key, intent, amount_cents, external_id, created_at) VALUES (?, 'ach', 'grant', ?, ?, ?)`,
        id,
        req.body.amount,
        req.body.reference,
        now,
      );
      res.json({ logged: true });
    } catch (err) {
      console.error("Error logging ACH transaction:", err);
      res.status(500).json({ error: "Failed to log ACH transaction" });
    }
  });

  router.post("/crypto-log", authRequired, requireAdmin, async (req, res) => {
    try {
      const db = getMonolithDb();
      const id = cryptoRandomId();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO funding_events (id, source_key, intent, amount_cents, metadata, created_at) VALUES (?, 'crypto', 'donation', ?, ?, ?)`,
        id,
        req.body.amount,
        req.body.metadata ? JSON.stringify(req.body.metadata) : null,
        now,
      );
      res.json({ logged: true });
    } catch (err) {
      console.error("Error logging crypto transaction:", err);
      res.status(500).json({ error: "Failed to log crypto transaction" });
    }
  });

  return router;
}

export function registerAdminRoutes(app: import("express").Express): void {
  app.get("/api/funding-sources", async (_req, res) => {
    try {
      const db = getMonolithDb();
      res.json(await db.all<any[]>("SELECT * FROM funding_sources ORDER BY id"));
    } catch (err) {
      console.error("Error fetching funding sources:", err);
      res.status(500).json({ error: "Failed to fetch funding sources" });
    }
  });
  app.use("/api/admin", createAdminRouter());
}
