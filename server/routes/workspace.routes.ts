import { Router } from "express";
import { hqAuthRequired } from "../middleware/hqAuth";
import { getUserWorkspace, saveUserWorkspace } from "../hq/dashboardSchema";
import { DEFAULT_EXECUTIVE_WIDGETS, EXECUTIVE_WIDGET_CATALOG } from "../hq/dashboardDefaults";
import {
  buildTemplateWidgets,
  listDashboardTemplates,
  resolveDashboardTemplateKey,
  getDashboardTemplate,
  type DashboardTemplateKey,
} from "../hq/dashboardTemplates";
import { toEnterpriseRole } from "../hq/enterpriseRoles";

const router = Router();

function defaultWidgets() {
  return DEFAULT_EXECUTIVE_WIDGETS.map((id) => {
    const def = EXECUTIVE_WIDGET_CATALOG.find((w) => w.id === id)!;
    return {
      id,
      layout: {
        x: def.defaultLayout.x,
        y: def.defaultLayout.y,
        w: def.defaultLayout.w,
        h: def.defaultLayout.h,
      },
    };
  });
}

router.get("/templates", hqAuthRequired, (_req, res) => {
  res.json({ templates: listDashboardTemplates() });
});

router.post("/dashboard/apply-template", hqAuthRequired, async (req, res) => {
  try {
    const { templateKey } = req.body as { templateKey?: DashboardTemplateKey };
    const key = templateKey ?? resolveDashboardTemplateKey(req.hqUser!.role);
    const template = getDashboardTemplate(key);
    const widgets = buildTemplateWidgets(key);

    const saved = await saveUserWorkspace(req.hqUser!.id, {
      dashboardMode: template.dashboardMode,
      widgets,
    });

    res.json({
      dashboardMode: saved!.dashboard_mode,
      widgets: JSON.parse(saved!.widgets_json),
      template: { key: template.key, name: template.name },
      persisted: true,
      updatedAt: saved!.updated_at,
    });
  } catch (error) {
    console.error("Apply template error:", error);
    res.status(500).json({ error: "Failed to apply dashboard template" });
  }
});

router.get("/dashboard", hqAuthRequired, async (req, res) => {
  try {
    const row = await getUserWorkspace(req.hqUser!.id);
    const templateKey = resolveDashboardTemplateKey(req.hqUser!.role);
    const roleTemplate = getDashboardTemplate(templateKey);

    if (!row) {
      const widgets = buildTemplateWidgets(templateKey);
      return res.json({
        dashboardMode: roleTemplate.dashboardMode,
        widgets,
        persisted: false,
        updatedAt: null,
        template: { key: roleTemplate.key, name: roleTemplate.name, autoLoaded: true },
        enterpriseRole: toEnterpriseRole(req.hqUser!.role),
      });
    }

    let widgets: unknown[] = [];
    try {
      widgets = JSON.parse(row.widgets_json);
    } catch {
      widgets = buildTemplateWidgets(templateKey);
    }

    res.json({
      dashboardMode: row.dashboard_mode,
      widgets,
      persisted: true,
      updatedAt: row.updated_at,
      template: { key: roleTemplate.key, name: roleTemplate.name, autoLoaded: false },
      enterpriseRole: toEnterpriseRole(req.hqUser!.role),
    });
  } catch (error) {
    console.error("Workspace load error:", error);
    res.status(500).json({ error: "Failed to load workspace" });
  }
});

router.put("/dashboard", hqAuthRequired, async (req, res) => {
  try {
    const { dashboardMode, widgets } = req.body as {
      dashboardMode?: "standard" | "custom";
      widgets?: unknown[];
    };

    if (dashboardMode && dashboardMode !== "standard" && dashboardMode !== "custom") {
      return res.status(400).json({ error: "dashboardMode must be standard or custom" });
    }

    const existing = await getUserWorkspace(req.hqUser!.id);
    const templateKey = resolveDashboardTemplateKey(req.hqUser!.role);
    const mode = dashboardMode ?? existing?.dashboard_mode ?? getDashboardTemplate(templateKey).dashboardMode;
    let widgetList = widgets;
    if (!Array.isArray(widgetList)) {
      try {
        widgetList = existing ? JSON.parse(existing.widgets_json) : buildTemplateWidgets(templateKey);
      } catch {
        widgetList = buildTemplateWidgets(templateKey);
      }
    }

    const saved = await saveUserWorkspace(req.hqUser!.id, {
      dashboardMode: mode,
      widgets: widgetList ?? buildTemplateWidgets(templateKey),
    });

    res.json({
      dashboardMode: saved!.dashboard_mode,
      widgets: JSON.parse(saved!.widgets_json),
      persisted: true,
      updatedAt: saved!.updated_at,
    });
  } catch (error) {
    console.error("Workspace save error:", error);
    res.status(500).json({ error: "Failed to save workspace" });
  }
});

export default router;
