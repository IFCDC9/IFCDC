export interface ExecutiveWidgetDef {
  id: string;
  name: string;
  description: string;
  defaultLayout: { x: number; y: number; w: number; h: number; minW?: number; minH?: number };
}

export const EXECUTIVE_WIDGET_CATALOG: ExecutiveWidgetDef[] = [
  { id: "health-score", name: "Organization Health", description: "Composite health score and factor breakdown", defaultLayout: { x: 0, y: 0, w: 4, h: 3, minW: 3, minH: 2 } },
  { id: "kpi-summary", name: "Executive KPIs", description: "Key performance indicators at a glance", defaultLayout: { x: 4, y: 0, w: 8, h: 3, minW: 4, minH: 2 } },
  { id: "cash-flow", name: "Cash Flow Analytics", description: "12-month revenue, expenses, and cash flow", defaultLayout: { x: 0, y: 3, w: 8, h: 4, minW: 4, minH: 3 } },
  { id: "predictive", name: "Predictive Outlook", description: "Forecast and trend projections", defaultLayout: { x: 8, y: 3, w: 4, h: 4, minW: 3, minH: 2 } },
  { id: "aura", name: "AURA Recommendations", description: "AI executive insights and priorities", defaultLayout: { x: 0, y: 7, w: 6, h: 4, minW: 4, minH: 3 } },
  { id: "activity", name: "Activity Feed", description: "Live cross-module organization events", defaultLayout: { x: 6, y: 7, w: 6, h: 4, minW: 4, minH: 3 } },
  { id: "modules", name: "Module Hub", description: "Connected IFCDC enterprise systems", defaultLayout: { x: 0, y: 11, w: 12, h: 4, minW: 6, minH: 2 } },
  { id: "quick-actions", name: "Quick Actions", description: "Executive shortcuts", defaultLayout: { x: 0, y: 15, w: 4, h: 3, minW: 3, minH: 2 } },
  { id: "operations", name: "Operations Snapshot", description: "Housing, compliance, events, and fleet", defaultLayout: { x: 4, y: 15, w: 4, h: 3, minW: 3, minH: 2 } },
  { id: "compliance", name: "Compliance Alerts", description: "Grant and risk compliance status", defaultLayout: { x: 8, y: 15, w: 4, h: 3, minW: 3, minH: 2 } },
  { id: "grants-pipeline", name: "Grant Pipeline", description: "Active awards, pipeline, and win rate", defaultLayout: { x: 0, y: 18, w: 4, h: 3, minW: 3, minH: 2 } },
  { id: "people-hr", name: "People & HR", description: "Employees, volunteers, and payroll", defaultLayout: { x: 4, y: 18, w: 4, h: 3, minW: 3, minH: 2 } },
  { id: "notifications", name: "Enterprise Alerts", description: "Unread notifications and compliance reminders", defaultLayout: { x: 8, y: 18, w: 4, h: 3, minW: 3, minH: 2 } },
  { id: "software-health", name: "Software Division", description: "Application health across IFCDC ecosystem", defaultLayout: { x: 0, y: 21, w: 6, h: 3, minW: 4, minH: 2 } },
  { id: "approval-tasks", name: "Executive Task Center", description: "Pending approvals across finance, HR, grants, and documents", defaultLayout: { x: 6, y: 21, w: 6, h: 4, minW: 4, minH: 3 } },
  { id: "grant-deadlines", name: "Grant Deadlines", description: "Upcoming compliance and submission deadlines", defaultLayout: { x: 0, y: 25, w: 6, h: 3, minW: 4, minH: 2 } },
  { id: "upcoming-events", name: "Upcoming Events", description: "Organization calendar preview", defaultLayout: { x: 6, y: 25, w: 6, h: 3, minW: 4, minH: 2 } },
  { id: "founder-actions", name: "Founder Quick Actions", description: "Executive command shortcuts", defaultLayout: { x: 0, y: 28, w: 12, h: 2, minW: 6, minH: 2 } },
  { id: "program-performance", name: "Program Performance", description: "Active programs, participants, and impact metrics", defaultLayout: { x: 0, y: 31, w: 6, h: 3, minW: 4, minH: 2 } },
  { id: "payroll-snapshot", name: "Payroll & Labor", description: "Payroll runs, net disbursements, and grant labor", defaultLayout: { x: 6, y: 31, w: 6, h: 3, minW: 4, minH: 2 } },
  { id: "volunteer-impact", name: "Volunteer Impact", description: "Volunteer counts, hours, and community reach", defaultLayout: { x: 0, y: 34, w: 6, h: 3, minW: 4, minH: 2 } },
  { id: "kpi-monitoring", name: "KPI Monitor", description: "Organization-wide KPI targets and status", defaultLayout: { x: 6, y: 34, w: 6, h: 4, minW: 4, minH: 3 } },
  { id: "executive-briefing", name: "Daily Executive Briefing", description: "Auto-generated daily leadership briefing", defaultLayout: { x: 0, y: 38, w: 6, h: 5, minW: 4, minH: 3 } },
  { id: "financial-health", name: "Financial Health", description: "Financial health score and budget position", defaultLayout: { x: 6, y: 38, w: 6, h: 3, minW: 3, minH: 2 } },
  { id: "unified-deadlines", name: "Upcoming Deadlines", description: "Grant, compliance, and calendar deadlines", defaultLayout: { x: 6, y: 41, w: 6, h: 3, minW: 4, minH: 2 } },
];

export const DEFAULT_EXECUTIVE_WIDGETS = [
  "health-score", "kpi-summary", "executive-briefing", "financial-health", "cash-flow", "predictive",
  "grants-pipeline", "unified-deadlines", "program-performance", "payroll-snapshot", "aura", "activity",
];

export const EXECUTIVE_WIDGETS_STORAGE_KEY = "ifcdc-hq-executive-widgets";
export const DASHBOARD_MODE_STORAGE_KEY = "ifcdc-hq-dashboard-mode";

export interface StoredWidgetLayout {
  id: string;
  layout: { x: number; y: number; w: number; h: number };
}

export function defaultWidgetLayout(): StoredWidgetLayout[] {
  return DEFAULT_EXECUTIVE_WIDGETS.map((id) => {
    const def = EXECUTIVE_WIDGET_CATALOG.find((w) => w.id === id)!;
    return { id, layout: { x: def.defaultLayout.x, y: def.defaultLayout.y, w: def.defaultLayout.w, h: def.defaultLayout.h } };
  });
}

export function loadExecutiveWidgetsLocal(): StoredWidgetLayout[] {
  try {
    const raw = localStorage.getItem(EXECUTIVE_WIDGETS_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredWidgetLayout[];
  } catch { /* ignore */ }
  return defaultWidgetLayout();
}

export function saveExecutiveWidgetsLocal(widgets: StoredWidgetLayout[]) {
  localStorage.setItem(EXECUTIVE_WIDGETS_STORAGE_KEY, JSON.stringify(widgets));
}

export function saveDashboardModeLocal(mode: "standard" | "custom") {
  localStorage.setItem(DASHBOARD_MODE_STORAGE_KEY, mode);
}

export function loadDashboardModeLocal(): "standard" | "custom" {
  const stored = localStorage.getItem(DASHBOARD_MODE_STORAGE_KEY);
  if (stored === "standard" || stored === "custom") return stored;
  return "standard";
}

/** @deprecated use workspaceApi */
export function loadExecutiveWidgets(): StoredWidgetLayout[] {
  return loadExecutiveWidgetsLocal();
}

/** @deprecated use workspaceApi */
export function saveExecutiveWidgets(widgets: StoredWidgetLayout[]) {
  saveExecutiveWidgetsLocal(widgets);
}
