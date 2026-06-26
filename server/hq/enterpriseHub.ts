import { getDb } from "../db";
import { pollAllApps, SOFTWARE_DIVISION_APPS } from "./appRegistry";
import { buildHeadquartersActivityFeed } from "./analyticsReporting";
import { buildOperationsOverview } from "./operationsSchema";
import type { ActivityItem } from "./metrics";

export interface EnterpriseModuleStatus {
  id: string;
  name: string;
  path: string;
  section: string;
  status: "live" | "beta" | "coming-soon";
  connected: boolean;
  metric?: string;
  metricLabel?: string;
}

export interface EnterpriseSearchResult {
  type: "module" | "person" | "grant" | "program" | "page" | "document" | "application" | "invoice" | "expense" | "funder" | "compliance";
  id: string;
  title: string;
  subtitle: string;
  path: string;
}

export interface EnterpriseNotification {
  id: string;
  type: "compliance" | "grant" | "alert" | "hr" | "finance" | "software" | "system" | "program" | "payroll";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  path?: string;
  priority: "high" | "normal" | "low";
}

const MODULE_REGISTRY: Omit<EnterpriseModuleStatus, "metric" | "metricLabel" | "connected">[] = [
  { id: "executive", name: "Executive Dashboard", path: "/hq", section: "Command", status: "live" },
  { id: "analytics", name: "Organization Analytics", path: "/hq/analytics", section: "Command", status: "live" },
  { id: "notifications", name: "Enterprise Notifications", path: "/hq/notifications", section: "Command", status: "live" },
  { id: "aura", name: "AURA AI Command Center", path: "/hq/aura", section: "Command", status: "live" },
  { id: "software", name: "Software Division", path: "/hq/software", section: "Operations", status: "live" },
  { id: "people", name: "People Management", path: "/hq/people", section: "Operations", status: "live" },
  { id: "payroll", name: "Payroll", path: "/hq/payroll", section: "Operations", status: "live" },
  { id: "volunteers", name: "Volunteers", path: "/hq/people?type=volunteer", section: "Operations", status: "live" },
  { id: "finance", name: "Financial Center", path: "/hq/finance", section: "Finance", status: "live" },
  { id: "grants", name: "Grant Center", path: "/hq/grants", section: "Finance", status: "live" },
  { id: "donations", name: "Donations", path: "/hq/donations", section: "Finance", status: "live" },
  { id: "programs", name: "Community Programs", path: "/hq/programs", section: "Programs", status: "live" },
  { id: "housing", name: "Housing Management", path: "/hq/housing", section: "Programs", status: "live" },
  { id: "scholarships", name: "Scholarship Management", path: "/hq/scholarships", section: "Programs", status: "live" },
  { id: "media", name: "Media Division", path: "/hq/media", section: "Programs", status: "live" },
  { id: "calendar", name: "Organization Calendar", path: "/hq/calendar", section: "Command", status: "live" },
  { id: "board", name: "Board of Directors Portal", path: "/hq/board", section: "Governance", status: "live" },
  { id: "compliance", name: "Compliance & Risk", path: "/hq/compliance", section: "Governance", status: "live" },
  { id: "assets", name: "Asset & Inventory", path: "/hq/assets", section: "Enterprise", status: "live" },
  { id: "fleet", name: "Fleet & Vehicles", path: "/hq/fleet", section: "Enterprise", status: "live" },
  { id: "facilities", name: "Facilities & Property", path: "/hq/facilities", section: "Enterprise", status: "live" },
  { id: "documents", name: "Document Management", path: "/hq/documents", section: "System", status: "live" },
  { id: "settings", name: "Organization Settings", path: "/hq/settings", section: "System", status: "beta" },
];

export async function buildEnterpriseModuleRegistry(): Promise<EnterpriseModuleStatus[]> {
  const db = await getDb();
  const apps = await pollAllApps();

  const peopleCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM people WHERE status = 'active'"))?.c ?? 0;
  const grantAwards = (await db.get<{ c: number; t: number }>(
    "SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as t FROM grant_awards WHERE status = 'active'"
  )) ?? { c: 0, t: 0 };
  const donationTotal = ((await db.get<{ t: number }>(
    "SELECT COALESCE(SUM(amount_cents), 0) as t FROM funding_events WHERE intent = 'donation'"
  ))?.t ?? 0) / 100;
  const programsCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM programs"))?.c ?? 0;
  const unreadNotifs = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM grant_notifications WHERE read = 0"))?.c ?? 0;
  let ops;
  try { ops = await buildOperationsOverview(); } catch { ops = null; }

  const metrics: Record<string, { metric: string; metricLabel: string }> = {
    executive: { metric: "Live", metricLabel: "Command center" },
    analytics: { metric: "Live", metricLabel: "Cross-org reporting" },
    notifications: { metric: String(unreadNotifs), metricLabel: "Unread alerts" },
    aura: { metric: "Live", metricLabel: "AI assistant" },
    software: { metric: `${apps.filter((a) => a.healthy).length}/${apps.length}`, metricLabel: "Apps online" },
    people: { metric: String(peopleCount), metricLabel: "Active people" },
    payroll: { metric: "Live", metricLabel: "Payroll engine" },
    volunteers: { metric: String((await db.get<{ c: number }>("SELECT COUNT(*) as c FROM people WHERE person_type = 'volunteer' AND status = 'active'"))?.c ?? 0), metricLabel: "Volunteers" },
    finance: { metric: `$${Math.round(donationTotal).toLocaleString()}`, metricLabel: "Donations tracked" },
    grants: { metric: String(grantAwards.c), metricLabel: `$${grantAwards.t.toLocaleString()} awarded` },
    donations: { metric: `$${Math.round(donationTotal).toLocaleString()}`, metricLabel: "Total raised" },
    programs: { metric: String(programsCount), metricLabel: "Programs" },
    housing: { metric: String(ops?.housing.units ?? 0), metricLabel: `${ops?.housing.placements ?? 0} placements` },
    scholarships: { metric: String(ops?.scholarships.programs ?? 0), metricLabel: `${ops?.scholarships.applications ?? 0} applications` },
    media: { metric: String(ops?.media.content ?? 0), metricLabel: `${ops?.media.broadcasts ?? 0} broadcasts` },
    calendar: { metric: String(ops?.calendar.upcomingEvents ?? 0), metricLabel: "Upcoming events" },
    board: { metric: String(ops?.board.upcomingMeetings ?? 0), metricLabel: `${ops?.board.openActions ?? 0} actions` },
    compliance: { metric: String(ops?.compliance.openRisks ?? 0), metricLabel: `${ops?.compliance.policies ?? 0} policies` },
    assets: { metric: String(ops?.assets.total ?? 0), metricLabel: "Active assets" },
    fleet: { metric: String(ops?.fleet.vehicles ?? 0), metricLabel: "Vehicles" },
    facilities: { metric: String(ops?.facilities.properties ?? 0), metricLabel: `${ops?.facilities.openWorkOrders ?? 0} work orders` },
    documents: { metric: String(ops?.documents.total ?? 0), metricLabel: "Documents" },
    settings: { metric: "Beta", metricLabel: "Org configuration" },
  };

  return MODULE_REGISTRY.map((m) => ({
    ...m,
    connected: true,
    ...metrics[m.id],
  }));
}

export async function enterpriseGlobalSearch(q: string): Promise<EnterpriseSearchResult[]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];

  const results: EnterpriseSearchResult[] = [];

  for (const mod of MODULE_REGISTRY) {
    if (mod.name.toLowerCase().includes(query) || mod.section.toLowerCase().includes(query)) {
      results.push({ type: "module", id: mod.id, title: mod.name, subtitle: mod.section, path: mod.path });
    }
  }

  const db = await getDb();

  try {
    const people = (await db.all(
      `SELECT id, first_name, last_name, person_type, email FROM people
       WHERE status != 'archived' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)
       LIMIT 8`, `%${query}%`, `%${query}%`, `%${query}%`
    )) as { id: string; first_name: string; last_name: string; person_type: string; email: string }[];
    for (const p of people) {
      results.push({
        type: "person",
        id: p.id,
        title: `${p.first_name} ${p.last_name}`,
        subtitle: `${p.person_type.replace(/_/g, " ")} · ${p.email ?? ""}`,
        path: `/hq/people?id=${p.id}`,
      });
    }
  } catch { /* people table */ }

  try {
    const grants = (await db.all(
      `SELECT aw.id, aw.amount, o.title, o.funder FROM grant_awards aw
       JOIN grant_opportunities o ON o.id = aw.opportunity_id
       WHERE o.title LIKE ? OR o.funder LIKE ? LIMIT 6`, `%${query}%`, `%${query}%`
    )) as { id: string; amount: number; title: string; funder: string }[];
    for (const g of grants) {
      results.push({
        type: "grant",
        id: g.id,
        title: g.title,
        subtitle: `${g.funder} · $${g.amount.toLocaleString()}`,
        path: `/hq/grants?award=${g.id}`,
      });
    }
  } catch { /* grant tables */ }

  try {
    const programs = (await db.all(
      "SELECT id, name, code FROM programs WHERE name LIKE ? OR code LIKE ? LIMIT 5", `%${query}%`, `%${query}%`
    )) as { id: string; name: string; code: string }[];
    for (const p of programs) {
      results.push({ type: "program", id: p.id, title: p.name, subtitle: p.code, path: "/hq/programs" });
    }
  } catch { /* programs */ }

  try {
    const apps = (await db.all(
      `SELECT a.id, a.title, a.status, o.funder FROM grant_applications a
       LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
       WHERE a.title LIKE ? OR o.funder LIKE ? LIMIT 5`, `%${query}%`, `%${query}%`
    )) as { id: string; title: string; status: string; funder: string }[];
    for (const a of apps) {
      results.push({
        type: "application",
        id: a.id,
        title: a.title,
        subtitle: `${a.status} · ${a.funder ?? "Grant application"}`,
        path: "/hq/grants?tab=applications",
      });
    }
  } catch { /* grant_applications */ }

  try {
    const funders = (await db.all(
      "SELECT id, name, relationship_stage, contact_name FROM grant_funders WHERE name LIKE ? OR contact_name LIKE ? LIMIT 5",
      `%${query}%`, `%${query}%`
    )) as { id: string; name: string; relationship_stage: string; contact_name: string }[];
    for (const f of funders) {
      results.push({
        type: "funder",
        id: f.id,
        title: f.name,
        subtitle: `${f.relationship_stage.replace(/_/g, " ")}${f.contact_name ? ` · ${f.contact_name}` : ""}`,
        path: `/hq/grants?tab=funders&funder=${f.id}`,
      });
    }
  } catch { /* grant_funders */ }

  try {
    const compliance = (await db.all(
      `SELECT c.id, c.report_type, c.due_date, o.title FROM grant_compliance c
       JOIN grant_awards aw ON aw.id = c.award_id
       LEFT JOIN grant_opportunities o ON o.id = aw.opportunity_id
       WHERE c.report_type LIKE ? OR o.title LIKE ? LIMIT 5`, `%${query}%`, `%${query}%`
    )) as { id: string; report_type: string; due_date: string; title: string }[];
    for (const c of compliance) {
      results.push({
        type: "compliance",
        id: c.id,
        title: c.report_type,
        subtitle: `${c.title} · due ${c.due_date}`,
        path: "/hq/grants?tab=compliance",
      });
    }
  } catch { /* grant_compliance */ }

  try {
    const docs = (await db.all(
      `SELECT id, name, doc_type, status FROM grant_documents WHERE name LIKE ? OR notes LIKE ? LIMIT 5`,
      `%${query}%`, `%${query}%`
    )) as { id: string; name: string; doc_type: string; status: string }[];
    for (const d of docs) {
      results.push({
        type: "document",
        id: d.id,
        title: d.name,
        subtitle: `Grant document · ${d.doc_type} · ${d.status}`,
        path: "/hq/grants?tab=documents",
      });
    }
  } catch { /* grant_documents */ }

  try {
    const hqDocs = (await db.all(
      `SELECT id, title, category FROM hq_documents WHERE title LIKE ? OR category LIKE ? LIMIT 4`,
      `%${query}%`, `%${query}%`
    )) as { id: string; title: string; category: string }[];
    for (const d of hqDocs) {
      results.push({
        type: "document",
        id: d.id,
        title: d.title,
        subtitle: `HQ document · ${d.category}`,
        path: "/hq/documents",
      });
    }
  } catch { /* hq_documents */ }

  try {
    const invoices = (await db.all(
      `SELECT id, invoice_number, vendor, amount_cents, status FROM finance_invoices
       WHERE invoice_number LIKE ? OR vendor LIKE ? OR description LIKE ? LIMIT 4`,
      `%${query}%`, `%${query}%`, `%${query}%`
    )) as { id: string; invoice_number: string; vendor: string; amount_cents: number; status: string }[];
    for (const inv of invoices) {
      results.push({
        type: "invoice",
        id: inv.id,
        title: inv.invoice_number || `Invoice ${inv.id.slice(0, 8)}`,
        subtitle: `${inv.vendor ?? "Vendor"} · $${((inv.amount_cents ?? 0) / 100).toLocaleString()} · ${inv.status}`,
        path: "/hq/finance?tab=ap",
      });
    }
  } catch { /* finance_invoices */ }

  try {
    const expenses = (await db.all(
      `SELECT id, description, category, amount_cents, vendor FROM finance_expenses
       WHERE description LIKE ? OR category LIKE ? OR vendor LIKE ? LIMIT 4`,
      `%${query}%`, `%${query}%`, `%${query}%`
    )) as { id: string; description: string; category: string; amount_cents: number; vendor: string }[];
    for (const e of expenses) {
      results.push({
        type: "expense",
        id: e.id,
        title: e.description,
        subtitle: `${e.category} · $${((e.amount_cents ?? 0) / 100).toLocaleString()}${e.vendor ? ` · ${e.vendor}` : ""}`,
        path: "/hq/finance?tab=expenses",
      });
    }
  } catch { /* finance_expenses */ }

  return results.slice(0, 24);
}

export async function buildEnterpriseNotifications(): Promise<{ notifications: EnterpriseNotification[]; unreadCount: number }> {
  const db = await getDb();
  const notifications: EnterpriseNotification[] = [];

  try {
    const grantNotifs = (await db.all(
      "SELECT * FROM grant_notifications ORDER BY created_at DESC LIMIT 20"
    )) as Record<string, unknown>[];
    for (const n of grantNotifs) {
      notifications.push({
        id: String(n.id),
        type: "grant",
        title: String(n.title ?? "Grant notification"),
        message: String(n.message ?? ""),
        timestamp: String(n.created_at ?? n.due_date ?? new Date().toISOString()),
        read: Boolean(n.read),
        path: "/hq/grants",
        priority: n.notification_type === "compliance_due" ? "high" : "normal",
      });
    }
  } catch { /* grant_notifications */ }

  try {
    const { listLeadershipAlerts } = await import("./criticalAlerts");
    const leadership = await listLeadershipAlerts(20);
    for (const a of leadership) {
      notifications.push({
        id: String(a.id),
        type: String(a.alert_type ?? "alert") as EnterpriseNotification["type"],
        title: String(a.title),
        message: String(a.message),
        timestamp: String(a.created_at),
        read: Boolean(a.read),
        path: String(a.path ?? "/hq/notifications"),
        priority: a.priority === "high" ? "high" : a.priority === "low" ? "low" : "normal",
      });
    }
  } catch { /* leadership alerts */ }

  try {
    const compliance = (await db.all(
      `SELECT c.id, c.report_type, c.due_date, o.title FROM grant_compliance c
       JOIN grant_awards aw ON aw.id = c.award_id
       LEFT JOIN grant_opportunities o ON o.id = aw.opportunity_id
       WHERE c.status = 'pending' ORDER BY c.due_date ASC LIMIT 10`
    )) as { id: string; report_type: string; due_date: string; title: string }[];
    for (const c of compliance) {
      notifications.push({
        id: `comp-${c.id}`,
        type: "compliance",
        title: `Compliance due: ${c.report_type}`,
        message: c.title,
        timestamp: c.due_date,
        read: false,
        path: "/hq/grants",
        priority: "high",
      });
    }
  } catch { /* compliance */ }

  const apps = await pollAllApps();
  for (const a of apps.filter((x) => !x.healthy)) {
    const reg = SOFTWARE_DIVISION_APPS.find((s) => s.id === a.id);
    notifications.push({
      id: `app-${a.id}`,
      type: "software",
      title: `Software alert: ${reg?.name ?? a.id}`,
      message: a.error ?? "Health check failed",
      timestamp: new Date().toISOString(),
      read: false,
      path: "/hq/software",
      priority: "high",
    });
  }

  const activity = await buildHeadquartersActivityFeed(8);
  for (const a of activity.filter((x) => x.type === "alert" || x.type === "compliance")) {
    notifications.push({
      id: a.id,
      type: a.type === "compliance" ? "compliance" : "alert",
      title: a.title,
      message: a.detail,
      timestamp: a.timestamp,
      read: false,
      path: a.type === "compliance" ? "/hq/grants" : "/hq/analytics",
      priority: a.type === "compliance" ? "high" : "normal",
    });
  }

  notifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const unreadCount = notifications.filter((n) => !n.read).length;
  return { notifications: notifications.slice(0, 40), unreadCount };
}

export async function buildEnterpriseOverview() {
  const [modules, notifications, activity] = await Promise.all([
    buildEnterpriseModuleRegistry(),
    buildEnterpriseNotifications(),
    buildHeadquartersActivityFeed(10),
  ]);

  const liveModules = modules.filter((m) => m.status === "live").length;
  const connectedModules = modules.filter((m) => m.connected).length;

  return {
    modules,
    notifications: notifications.notifications,
    unreadCount: notifications.unreadCount,
    activity: activity as ActivityItem[],
    summary: {
      totalModules: modules.length,
      liveModules,
      connectedModules,
      singleSourceOfTruth: true,
    },
    timestamp: new Date().toISOString(),
  };
}
