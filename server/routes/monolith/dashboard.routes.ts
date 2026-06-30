import { Router } from "express";
import { authRequired, requireRole } from "../../middleware/legacyAuth";
import { getMonolithDb } from "../../monolith/dbAccess";
import { logAudit } from "../../monolith/audit";
import { cryptoRandomId, ROLES } from "../../monolith/constants";


export function createDashboardRouter(): Router {
  const router = Router();

// ----- Dashboard Widgets -----
const WIDGET_TYPES = [
  "client_stats",
  "recent_encounters",
  "upcoming_appointments",
  "audit_log_summary",
  "program_enrollment",
] as const;

const DEFAULT_WIDGET_CONFIGS: Record<string, { title: string; w: number; h: number }> = {
  client_stats: { title: "Client Statistics", w: 4, h: 2 },
  recent_encounters: { title: "Recent Encounters", w: 4, h: 3 },
  upcoming_appointments: { title: "Upcoming Appointments", w: 4, h: 3 },
  audit_log_summary: { title: "Recent Activity", w: 6, h: 3 },
  program_enrollment: { title: "Program Enrollment", w: 6, h: 2 },
};

// Get user's dashboard widgets
router.get("/dashboard/widgets", authRequired, async (req, res) => {
  try {
    const db = getMonolithDb();
    const widgets = await db.all<any[]>(
      `SELECT * FROM dashboard_widgets WHERE user_id = ? ORDER BY created_at ASC`,
      req.user!.id
    );
    res.json(widgets.map((w) => ({
      id: w.id,
      userId: w.user_id,
      widgetType: w.widget_type,
      title: w.title,
      layout: JSON.parse(w.layout),
      settings: w.settings ? JSON.parse(w.settings) : null,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    })));
  } catch (err) {
    console.error("Error fetching widgets:", err);
    res.status(500).json({ error: "Failed to fetch widgets" });
  }
});

// Add a new widget
router.post("/dashboard/widgets", authRequired, async (req, res) => {
  try {
    const { widgetType, title, layout, settings } = req.body;

    if (!widgetType || !WIDGET_TYPES.includes(widgetType)) {
      return res.status(400).json({ error: "Invalid widget type" });
    }

    const config = DEFAULT_WIDGET_CONFIGS[widgetType];
    const finalLayout = layout || { x: 0, y: 0, w: config.w, h: config.h };
    const finalTitle = title || config.title;

    const id = cryptoRandomId();
    const now = new Date().toISOString();

    const db = getMonolithDb();
    await db.run(
      `INSERT INTO dashboard_widgets (id, user_id, widget_type, title, layout, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, req.user!.id, widgetType, finalTitle, JSON.stringify(finalLayout),
      settings ? JSON.stringify(settings) : null, now, now
    );

    await logAudit(req, { action: "CREATE", targetType: "DASHBOARD_WIDGET", targetId: id, extra: { widgetType } });

    res.status(201).json({
      id,
      userId: req.user!.id,
      widgetType,
      title: finalTitle,
      layout: finalLayout,
      settings: settings || null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    console.error("Error creating widget:", err);
    res.status(500).json({ error: "Failed to create widget" });
  }
});

// Update a widget (layout, title, settings)
router.patch("/dashboard/widgets/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, layout, settings } = req.body;

    const db = getMonolithDb();
    const widget = await db.get<any>(
      `SELECT * FROM dashboard_widgets WHERE id = ? AND user_id = ?`,
      id, req.user!.id
    );

    if (!widget) {
      return res.status(404).json({ error: "Widget not found" });
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (title !== undefined) {
      updates.push("title = ?");
      params.push(title);
    }
    if (layout !== undefined) {
      updates.push("layout = ?");
      params.push(JSON.stringify(layout));
    }
    if (settings !== undefined) {
      updates.push("settings = ?");
      params.push(JSON.stringify(settings));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    updates.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(id);
    params.push(req.user!.id);

    await db.run(
      `UPDATE dashboard_widgets SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
      ...params
    );

    await logAudit(req, { action: "UPDATE", targetType: "DASHBOARD_WIDGET", targetId: id, extra: { title, layout, settings } });

    const updated = await db.get<any>(
      `SELECT * FROM dashboard_widgets WHERE id = ?`,
      id
    );

    res.json({
      id: updated.id,
      userId: updated.user_id,
      widgetType: updated.widget_type,
      title: updated.title,
      layout: JSON.parse(updated.layout),
      settings: updated.settings ? JSON.parse(updated.settings) : null,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    });
  } catch (err) {
    console.error("Error updating widget:", err);
    res.status(500).json({ error: "Failed to update widget" });
  }
});

// Batch update widget layouts (for drag-and-drop reordering)
router.patch("/dashboard/widgets/batch-layout", authRequired, async (req, res) => {
  try {
    const updates = req.body;

    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: "Expected array of updates" });
    }

    const now = new Date().toISOString();

    for (const { id, layout } of updates) {
      if (!id || !layout) continue;
      const db = getMonolithDb();
      await db.run(
        `UPDATE dashboard_widgets SET layout = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        JSON.stringify(layout), now, id, req.user!.id
      );
    }

    await logAudit(req, { action: "BATCH_UPDATE_LAYOUT", targetType: "DASHBOARD_WIDGET", targetId: null, extra: { count: updates.length } });

    res.json({ ok: true, updated: updates.length });
  } catch (err) {
    console.error("Error batch updating layouts:", err);
    res.status(500).json({ error: "Failed to batch update layouts" });
  }
});

// Delete a widget
router.delete("/dashboard/widgets/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;

    const db = getMonolithDb();
    const widget = await db.get<any>(
      `SELECT * FROM dashboard_widgets WHERE id = ? AND user_id = ?`,
      id, req.user!.id
    );

    if (!widget) {
      return res.status(404).json({ error: "Widget not found" });
    }

    await db.run(
      `DELETE FROM dashboard_widgets WHERE id = ? AND user_id = ?`,
      id, req.user!.id
    );

    await logAudit(req, { action: "DELETE", targetType: "DASHBOARD_WIDGET", targetId: id, extra: { widgetType: widget.widget_type } });

    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting widget:", err);
    res.status(500).json({ error: "Failed to delete widget" });
  }
});

// Get widget data (stats for different widget types)
router.get("/dashboard/widget-data/:type", authRequired, async (req, res) => {
  try {
    const db = getMonolithDb();
    const { type } = req.params;
    const userId = req.user!.id;
    const isExec = req.user!.role === ROLES.EXEC;

    switch (type) {
      case "client_stats": {
        const db = getMonolithDb();
        let totalClients, activePrograms;
        if (isExec) {
          totalClients = (await db.get<{ count: number }>("SELECT COUNT(*) as count FROM clients"))?.count || 0;
        } else {
          totalClients = (await db.get<{ count: number }>(
            `SELECT COUNT(DISTINCT client_id) as count FROM client_assignments WHERE user_id = ?`,
            userId
          ))?.count || 0;
        }
        activePrograms = (await db.get<{ count: number }>("SELECT COUNT(*) as count FROM programs"))?.count || 0;
        res.json({ totalClients, activePrograms });
        break;
      }

      case "recent_encounters": {
        let encounters;
        if (isExec) {
          encounters = await db.all<any[]>(
            `SELECT e.*, c.full_name as client_name
             FROM encounters e
             JOIN clients c ON c.id = e.client_id
             ORDER BY e.created_at DESC LIMIT 10`
          );
        } else {
          encounters = await db.all<any[]>(
            `SELECT e.*, c.full_name as client_name
             FROM encounters e
             JOIN clients c ON c.id = e.client_id
             JOIN client_assignments ca ON ca.client_id = e.client_id
             WHERE ca.user_id = ?
             ORDER BY e.created_at DESC LIMIT 10`,
            userId
          );
        }
        res.json(encounters);
        break;
      }

      case "upcoming_appointments": {
        const now = new Date().toISOString();
        let appointments;
        if (isExec) {
          appointments = await db.all<any[]>(
            `SELECT a.*, c.full_name as client_name
             FROM appointments a
             JOIN clients c ON c.id = a.client_id
             WHERE a.start_time >= ?
             ORDER BY a.start_time ASC LIMIT 10`,
            now
          );
        } else {
          appointments = await db.all<any[]>(
            `SELECT a.*, c.full_name as client_name
             FROM appointments a
             JOIN clients c ON c.id = a.client_id
             JOIN client_assignments ca ON ca.client_id = a.client_id
             WHERE ca.user_id = ? AND a.start_time >= ?
             ORDER BY a.start_time ASC LIMIT 10`,
            userId, now
          );
        }
        res.json(appointments);
        break;
      }

      case "audit_log_summary": {
        if (!isExec) {
          return res.status(403).json({ error: "Forbidden" });
        }
        const logs = await db.all<any[]>(
          `SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 15`
        );
        res.json(logs.map((log: Record<string, unknown>) => ({
          ...log,
          extra: JSON.parse(String(log.extra || "{}")),
        })));
        break;
      }

      case "program_enrollment": {
        const programs = await db.all<any[]>(
          `SELECT p.code, p.name, COUNT(DISTINCT e.client_id) as client_count
           FROM programs p
           LEFT JOIN encounters e ON e.program = p.code
           GROUP BY p.id, p.code, p.name`
        );
        res.json(programs);
        break;
      }

      default:
        res.status(400).json({ error: "Unknown widget type" });
    }
  } catch (err) {
    console.error("Error fetching widget data:", err);
    res.status(500).json({ error: "Failed to fetch widget data" });
  }
});

// ----- Stats Overview -----
router.get("/stats/overview", authRequired, async (req, res) => {
  try {
    const db = getMonolithDb();
    const isExec = req.user!.role === ROLES.EXEC;
    const userId = req.user!.id;

    // Total clients (global vs assigned)
    let totalClientsRow;
    if (isExec) {
      totalClientsRow = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM clients");
    } else {
      totalClientsRow = await db.get<{ count: number }>(
        `SELECT COUNT(DISTINCT client_id) as count FROM client_assignments WHERE user_id = ?`,
        userId
      );
    }
    const totalClients = totalClientsRow?.count || 0;

    // Appointments this week
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun,...6=Sat
    const diffToMonday = (day + 6) % 7; // days since Monday
    const weekStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday, 0, 0, 0)
    );
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekStartIso = weekStart.toISOString();
    const weekEndIso = weekEnd.toISOString();

    let apptRow;
    if (isExec) {
      apptRow = await db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM appointments WHERE start_time >= ? AND start_time < ?`,
        weekStartIso, weekEndIso
      );
    } else {
      apptRow = await db.get<{ count: number }>(
        `SELECT COUNT(DISTINCT a.id) as count
         FROM appointments a
         JOIN client_assignments ca ON ca.client_id = a.client_id
         WHERE ca.user_id = ? AND a.start_time >= ? AND a.start_time < ?`,
        userId, weekStartIso, weekEndIso
      );
    }
    const appointmentsThisWeek = apptRow?.count || 0;

    // Open outreach tasks
    let outreachRow;
    if (isExec || req.user!.role === ROLES.ADMIN || req.user!.role === ROLES.CHW) {
      outreachRow = await db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM outreach_tasks WHERE status = 'OPEN'"
      );
    } else if (req.user!.role === ROLES.CASE_MANAGER) {
      outreachRow = await db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM outreach_tasks
         WHERE status = 'OPEN'
           AND (client_id IS NULL OR client_id IN (
             SELECT client_id FROM client_assignments WHERE user_id = ?
           ))`,
        userId
      );
    } else {
      outreachRow = await db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM outreach_tasks
         WHERE status = 'OPEN'
           AND client_id IN (SELECT client_id FROM client_assignments WHERE user_id = ?)`,
        userId
      );
    }
    const openOutreachTasks = outreachRow?.count || 0;

    await logAudit(req, { action: "VIEW_STATS_OVERVIEW", targetType: "STATS", targetId: null, extra: {
      totalClients,
      appointmentsThisWeek,
      openOutreachTasks,
    } });

    res.json({
      totalClients,
      appointmentsThisWeek,
      openOutreachTasks,
      weekStart: weekStartIso,
      weekEnd: weekEndIso,
    });
  } catch (err) {
    console.error("Error building stats overview:", err);
    res.status(500).json({ error: "Failed to load stats overview" });
  }
});

  return router;
}

export function registerDashboardRoutes(app: import("express").Express): void {
  app.use("/api", createDashboardRouter());
}
