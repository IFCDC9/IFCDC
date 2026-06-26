/**
 * Role-based dashboard templates — auto-loaded when an executive has no saved workspace.
 */

import type { EnterpriseRole } from "./enterpriseRoles";
import { toEnterpriseRole, hasPermission } from "./enterpriseRoles";
import { EXECUTIVE_WIDGET_CATALOG } from "./dashboardDefaults";

export type DashboardTemplateKey =
  | "founder"
  | "executive"
  | "board_member"
  | "grant_manager"
  | "hr"
  | "finance"
  | "volunteer"
  | "department_manager"
  | "donor";

export interface DashboardTemplate {
  key: DashboardTemplateKey;
  name: string;
  description: string;
  dashboardMode: "standard" | "custom";
  widgetIds: string[];
}

function layoutFor(ids: string[]) {
  let y = 0;
  return ids.map((id, index) => {
    const def = EXECUTIVE_WIDGET_CATALOG.find((w) => w.id === id);
    if (!def) return { id, layout: { x: 0, y: index * 3, w: 4, h: 3 } };
    const layout = {
      id,
      layout: {
        x: def.defaultLayout.x,
        y: def.defaultLayout.y !== 0 ? def.defaultLayout.y : y,
        w: def.defaultLayout.w,
        h: def.defaultLayout.h,
      },
    };
    y = Math.max(y, layout.layout.y + layout.layout.h);
    return layout;
  });
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    key: "founder",
    name: "Founder Command Center",
    description: "Full organization health, predictive outlook, AURA, and Software Division",
    dashboardMode: "standard",
    widgetIds: ["health-score", "kpi-summary", "cash-flow", "predictive", "program-performance", "payroll-snapshot", "volunteer-impact", "kpi-monitoring", "aura", "activity", "notifications", "approval-tasks", "software-health"],
  },
  {
    key: "executive",
    name: "Executive Director",
    description: "Strategic KPIs, finance, compliance, and AURA decision support",
    dashboardMode: "custom",
    widgetIds: ["health-score", "kpi-summary", "cash-flow", "predictive", "program-performance", "payroll-snapshot", "aura", "compliance", "operations", "notifications"],
  },
  {
    key: "board_member",
    name: "Board Member",
    description: "Governance-focused health, grants, compliance, and financial overview",
    dashboardMode: "custom",
    widgetIds: ["health-score", "grants-pipeline", "cash-flow", "compliance", "predictive", "activity"],
  },
  {
    key: "grant_manager",
    name: "Grant Manager",
    description: "Grant pipeline, compliance deadlines, and award tracking",
    dashboardMode: "custom",
    widgetIds: ["grants-pipeline", "compliance", "kpi-summary", "activity", "notifications", "quick-actions"],
  },
  {
    key: "hr",
    name: "HR & People",
    description: "People database, payroll, volunteers, and HR activity",
    dashboardMode: "custom",
    widgetIds: ["people-hr", "volunteer-impact", "payroll-snapshot", "kpi-summary", "activity", "notifications", "quick-actions"],
  },
  {
    key: "finance",
    name: "Finance",
    description: "Cash flow, donations, predictive trends, and financial KPIs",
    dashboardMode: "custom",
    widgetIds: ["cash-flow", "kpi-summary", "predictive", "grants-pipeline", "activity", "notifications"],
  },
  {
    key: "volunteer",
    name: "Volunteer",
    description: "Programs, events, and community activity",
    dashboardMode: "standard",
    widgetIds: ["operations", "activity", "quick-actions", "notifications"],
  },
  {
    key: "department_manager",
    name: "Department Manager",
    description: "Department KPIs, operations, people, and compliance",
    dashboardMode: "custom",
    widgetIds: ["kpi-summary", "people-hr", "operations", "compliance", "activity", "quick-actions"],
  },
  {
    key: "donor",
    name: "Donor Relations",
    description: "Donation impact and organizational health",
    dashboardMode: "standard",
    widgetIds: ["kpi-summary", "cash-flow", "health-score", "activity"],
  },
];

export function getDashboardTemplate(key: DashboardTemplateKey): DashboardTemplate {
  return DASHBOARD_TEMPLATES.find((t) => t.key === key) ?? DASHBOARD_TEMPLATES[0];
}

export function buildTemplateWidgets(key: DashboardTemplateKey) {
  const template = getDashboardTemplate(key);
  return layoutFor(template.widgetIds);
}

/** Resolve the best template for a user's enterprise role and permissions */
export function resolveDashboardTemplateKey(role: string): DashboardTemplateKey {
  const enterprise = toEnterpriseRole(role);

  if (enterprise === "administrator" || enterprise === "employee") {
    if (hasPermission(role, "hq.finance.manage") || hasPermission(role, "hq.finance")) {
      if (hasPermission(role, "hq.finance.manage")) return "finance";
    }
    if (hasPermission(role, "hq.hr.manage") || (hasPermission(role, "hq.hr") && hasPermission(role, "hq.payroll"))) {
      if (hasPermission(role, "hq.hr.manage")) return "hr";
    }
    if (enterprise === "administrator") return "department_manager";
  }

  const directMap: Partial<Record<EnterpriseRole, DashboardTemplateKey>> = {
    founder: "founder",
    executive: "executive",
    board_member: "board_member",
    grant_manager: "grant_manager",
    volunteer: "volunteer",
    donor: "donor",
  };

  return directMap[enterprise] ?? "department_manager";
}

export function listDashboardTemplates(role?: string) {
  const templates = DASHBOARD_TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    dashboardMode: t.dashboardMode,
    widgetCount: t.widgetIds.length,
  }));
  if (!role) return templates;
  return templates.filter((t) => canApplyDashboardTemplate(role, t.key));
}

export function canApplyDashboardTemplate(role: string, templateKey: DashboardTemplateKey): boolean {
  if (role === "owner") return true;
  const resolved = resolveDashboardTemplateKey(role);
  if (templateKey === resolved) return true;
  if (hasPermission(role, "hq.executive")) {
    if (templateKey === "founder") return toEnterpriseRole(role) === "founder";
    return ["executive", "board_member", "grant_manager", "hr", "finance", "department_manager", "donor", "volunteer"].includes(templateKey);
  }
  return false;
}
