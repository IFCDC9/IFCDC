/**
 * IFCDC Enterprise Auth — client-side permission mirror.
 * Must stay in sync with server/hq/enterpriseRoles.ts
 */

export type EnterpriseRole =
  | "founder" | "executive" | "administrator" | "hr" | "finance" | "program_director" | "manager"
  | "board_member" | "grant_manager" | "employee" | "volunteer" | "barber" | "client" | "donor";

export type Permission =
  | "hq.executive" | "hq.hr" | "hq.hr.manage" | "hq.hr.approve" | "hq.hr.self" | "hq.payroll"
  | "hq.grants" | "hq.grants.manage" | "hq.finance" | "hq.finance.manage"
  | "hq.donations" | "hq.programs" | "hq.software" | "hq.aura"
  | "hq.analytics" | "hq.notifications" | "hq.settings" | "hq.settings.manage"
  | "app.barbers" | "app.music" | "app.radio" | "app.tapis"
  | "app.inclusive" | "app.swiftware" | "app.cryptocoin";

export const ROUTE_PERMISSIONS: Record<string, Permission> = {
  "/hq": "hq.executive",
  "/hq/founder": "hq.executive",
  "/hq/reports": "hq.analytics",
  "/hq/analytics": "hq.analytics",
  "/hq/notifications": "hq.notifications",
  "/hq/communications": "hq.notifications",
  "/hq/aura": "hq.aura",
  "/hq/executive-brain": "hq.aura",
  "/hq/enterprise-os": "hq.aura",
  "/hq/software": "hq.software",
  "/hq/operations": "hq.settings",
  "/hq/phase9": "hq.executive",
  "/hq/phase10": "hq.executive",
  "/hq/intelligence": "hq.analytics",
  "/hq/workflows": "hq.executive",
  "/hq/integrations": "hq.software",
  "/hq/security": "hq.settings",
  "/hq/developer": "hq.software",
  "/hq/sso": "hq.software",
  "/hq/hr": "hq.hr",
  "/hq/people": "hq.hr",
  "/hq/my-workspace": "hq.hr.self",
  "/hq/manager": "hq.hr.approve",
  "/hq/payroll": "hq.payroll",
  "/hq/volunteers": "hq.hr",
  "/hq/finance": "hq.finance",
  "/hq/grants": "hq.grants",
  "/hq/donations": "hq.donations",
  "/hq/programs": "hq.programs",
  "/hq/housing": "hq.programs",
  "/hq/scholarships": "hq.programs",
  "/hq/media": "hq.programs",
  "/hq/documents": "hq.settings",
  "/hq/knowledge": "hq.grants",
  "/hq/assets": "hq.settings",
  "/hq/fleet": "hq.settings",
  "/hq/facilities": "hq.settings",
  "/hq/board": "hq.executive",
  "/hq/compliance": "hq.executive",
  "/hq/calendar": "hq.programs",
  "/hq/settings": "hq.settings",
  "/barber": "app.barbers",
  "/app/barbershop": "app.barbers",
};

export const ENTERPRISE_ROLE_LABELS: Record<EnterpriseRole, string> = {
  founder: "Founder",
  executive: "Executive Leadership",
  administrator: "Administrator",
  hr: "Human Resources",
  finance: "Finance",
  program_director: "Program Director",
  manager: "Manager",
  board_member: "Board Member",
  grant_manager: "Grant Manager",
  employee: "Staff",
  volunteer: "Volunteer",
  barber: "Barber",
  client: "Client",
  donor: "Donor",
};

export function canAccessRoute(permissions: Permission[], path: string): boolean {
  const exact = ROUTE_PERMISSIONS[path];
  if (exact) return permissions.includes(exact);

  if (path.startsWith("/hq/programs/")) return permissions.includes("hq.programs") || permissions.includes("hq.executive");
  if (path.startsWith("/hq/")) return permissions.includes("hq.executive");

  return true;
}

export function hasPermission(permissions: Permission[], permission: Permission): boolean {
  return permissions.includes(permission);
}
