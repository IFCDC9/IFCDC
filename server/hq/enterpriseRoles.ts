/**
 * IFCDC Enterprise — canonical roles, permissions, and routing.
 * Single source of truth for Headquarters and all connected applications.
 */

export type EnterpriseRole =
  | "founder"
  | "executive"
  | "administrator"
  | "hr"
  | "finance"
  | "program_director"
  | "manager"
  | "board_member"
  | "grant_manager"
  | "employee"
  | "volunteer"
  | "barber"
  | "client"
  | "donor";

export const ENTERPRISE_ROLES: EnterpriseRole[] = [
  "founder",
  "executive",
  "administrator",
  "hr",
  "finance",
  "program_director",
  "manager",
  "board_member",
  "grant_manager",
  "employee",
  "volunteer",
  "barber",
  "client",
  "donor",
];

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

/** Maps legacy SQLite user.role values to canonical enterprise roles */
export const LEGACY_ROLE_MAP: Record<string, EnterpriseRole> = {
  owner: "founder",
  founder: "founder",
  admin: "administrator",
  administrator: "administrator",
  EXEC: "executive",
  executive: "executive",
  executive_director: "executive",
  board_member: "board_member",
  board: "board_member",
  grant_manager: "grant_manager",
  manager: "manager",
  director: "program_director",
  program_director: "program_director",
  hr: "hr",
  finance: "finance",
  program_staff: "employee",
  staff: "employee",
  employee: "employee",
  barber: "barber",
  radio: "employee",
  radio_host: "employee",
  CLINICIAN: "employee",
  CASE_MANAGER: "employee",
  CHW: "employee",
  volunteer: "volunteer",
  client: "client",
  user: "client",
  donor: "donor",
  community_member: "client",
};

export type Permission =
  | "hq.executive"
  | "hq.hr"
  | "hq.hr.manage"
  | "hq.hr.approve"
  | "hq.hr.self"
  | "hq.payroll"
  | "hq.grants"
  | "hq.grants.manage"
  | "hq.finance"
  | "hq.finance.manage"
  | "hq.donations"
  | "hq.programs"
  | "hq.clients"
  | "hq.clients.manage"
  | "hq.software"
  | "hq.aura"
  | "hq.analytics"
  | "hq.notifications"
  | "hq.settings"
  | "hq.settings.manage"
  | "hq.documents"
  | "app.barbers"
  | "app.music"
  | "app.radio"
  | "app.tapis"
  | "app.inclusive"
  | "app.swiftware"
  | "app.cryptocoin";

export const ROLE_PERMISSIONS: Record<EnterpriseRole, Permission[]> = {
  founder: [
    "hq.executive", "hq.hr", "hq.hr.manage", "hq.hr.approve", "hq.hr.self", "hq.payroll", "hq.grants", "hq.grants.manage",
    "hq.finance", "hq.finance.manage", "hq.donations", "hq.programs", "hq.clients", "hq.clients.manage", "hq.software", "hq.aura",
    "hq.analytics", "hq.notifications", "hq.settings", "hq.settings.manage", "hq.documents",
    "app.barbers", "app.music", "app.radio", "app.tapis", "app.inclusive", "app.swiftware", "app.cryptocoin",
  ],
  executive: [
    "hq.executive", "hq.hr", "hq.hr.manage", "hq.hr.approve", "hq.payroll", "hq.grants", "hq.grants.manage",
    "hq.finance", "hq.donations", "hq.programs", "hq.clients", "hq.clients.manage", "hq.software", "hq.aura",
    "hq.analytics", "hq.notifications", "hq.settings", "hq.documents",
    "app.barbers", "app.music", "app.radio", "app.tapis", "app.inclusive", "app.swiftware", "app.cryptocoin",
  ],
  administrator: [
    "hq.executive", "hq.hr", "hq.hr.manage", "hq.hr.approve", "hq.payroll", "hq.grants", "hq.grants.manage",
    "hq.finance", "hq.finance.manage", "hq.donations", "hq.programs", "hq.clients", "hq.clients.manage", "hq.software", "hq.aura",
    "hq.analytics", "hq.notifications", "hq.settings", "hq.settings.manage", "hq.documents",
    "app.barbers", "app.music", "app.radio", "app.tapis", "app.inclusive", "app.swiftware", "app.cryptocoin",
  ],
  hr: [
    "hq.hr", "hq.hr.manage", "hq.hr.approve", "hq.payroll", "hq.programs", "hq.aura", "hq.notifications", "hq.analytics", "hq.documents",
  ],
  finance: [
    "hq.finance", "hq.finance.manage", "hq.payroll", "hq.hr", "hq.donations", "hq.aura", "hq.notifications", "hq.analytics", "hq.documents",
  ],
  program_director: [
    "hq.programs", "hq.grants", "hq.hr", "hq.clients", "hq.clients.manage", "hq.analytics", "hq.aura", "hq.notifications", "hq.documents",
  ],
  manager: [
    "hq.programs", "hq.hr", "hq.hr.approve", "hq.clients", "hq.aura", "hq.notifications", "hq.documents",
  ],
  board_member: [
    "hq.executive", "hq.grants", "hq.finance", "hq.donations", "hq.aura", "hq.analytics", "hq.notifications", "hq.documents",
  ],
  grant_manager: [
    "hq.executive", "hq.grants", "hq.grants.manage", "hq.finance", "hq.donations", "hq.aura",
    "hq.analytics", "hq.notifications", "hq.documents",
  ],
  employee: [
    "hq.hr.self", "hq.programs", "hq.clients", "hq.aura", "hq.notifications", "hq.documents", "app.barbers", "app.music", "app.radio",
  ],
  volunteer: [
    "hq.hr.self", "hq.programs", "hq.aura", "hq.notifications", "hq.documents",
  ],
  barber: [
    "hq.hr.self", "hq.aura", "app.barbers",
  ],
  client: [
    "hq.aura",
  ],
  donor: [
    "hq.donations", "hq.aura",
  ],
};

/** HQ module keys used by middleware */
export const HQ_MODULE_PERMISSIONS: Record<string, EnterpriseRole[]> = {
  executive: ["founder", "executive", "administrator", "board_member", "grant_manager"],
  hr: ["founder", "executive", "administrator", "hr", "finance", "program_director", "manager"],
  payroll: ["founder", "executive", "administrator", "hr", "finance"],
  finance: ["founder", "executive", "administrator", "board_member", "grant_manager", "finance"],
  grants: ["founder", "executive", "administrator", "board_member", "grant_manager"],
  programs: ["founder", "executive", "administrator", "employee", "volunteer"],
  clients: ["founder", "executive", "administrator", "program_director", "manager", "employee"],
  software_division: ["founder", "executive", "administrator"],
  aura: ["founder", "executive", "administrator", "board_member", "grant_manager", "employee", "volunteer", "barber", "client", "donor"],
  settings: ["founder", "executive", "administrator"],
  documents: [
    "founder", "executive", "administrator", "hr", "finance", "program_director",
    "manager", "board_member", "grant_manager", "employee",
  ],
  policies: [
    "founder", "executive", "administrator", "hr", "finance", "program_director",
    "manager", "board_member", "grant_manager", "employee", "volunteer",
  ],
  analytics: ["founder", "executive", "administrator", "board_member", "grant_manager"],
  notifications: ["founder", "executive", "administrator", "board_member", "grant_manager", "employee", "volunteer"],
  operations: ["founder", "executive", "administrator"],
  board: ["founder", "executive", "administrator", "board_member"],
  compliance: ["founder", "executive", "administrator", "board_member"],
};

/** Route path → required permission */
export const ROUTE_PERMISSIONS: Record<string, Permission> = {
  "/hq": "hq.executive",
  "/hq/founder": "hq.executive",
  "/hq/reports": "hq.analytics",
  "/hq/operations": "hq.settings",
  "/hq/analytics": "hq.analytics",
  "/hq/notifications": "hq.notifications",
  "/hq/communications": "hq.notifications",
  "/hq/aura": "hq.aura",
  "/hq/executive-brain": "hq.aura",
  "/hq/enterprise-os": "hq.aura",
  "/hq/software": "hq.software",
  "/hq/developer": "hq.software",
  "/hq/sso": "hq.software",
  "/hq/people": "hq.hr",
  "/hq/my-workspace": "hq.hr.self",
  "/hq/manager": "hq.hr.approve",
  "/hq/hr": "hq.hr",
  "/hq/payroll": "hq.payroll",
  "/hq/volunteers": "hq.hr",
  "/hq/finance": "hq.finance",
  "/hq/grants": "hq.grants",
  "/hq/donations": "hq.donations",
  "/hq/programs": "hq.programs",
  "/hq/clients": "hq.clients",
  "/hq/housing": "hq.programs",
  "/hq/scholarships": "hq.programs",
  "/hq/media": "hq.programs",
  "/hq/documents": "hq.documents",
  "/hq/policies": "hq.documents",
  "/hq/knowledge": "hq.aura",
  "/hq/intelligence": "hq.analytics",
  "/hq/phase9": "hq.executive",
  "/hq/phase10": "hq.executive",
  "/hq/workflows": "hq.executive",
  "/hq/integrations": "hq.software",
  "/hq/security": "hq.settings",
  "/hq/monitoring": "hq.software",
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

export const DEFAULT_ROUTES: Record<EnterpriseRole, string> = {
  founder: "/hq",
  executive: "/hq",
  administrator: "/hq",
  hr: "/hq/people",
  finance: "/hq/finance",
  program_director: "/hq/programs",
  manager: "/hq/people",
  board_member: "/hq",
  grant_manager: "/hq/grants",
  employee: "/hq/my-workspace",
  volunteer: "/hq/my-workspace",
  barber: "/barber",
  client: "/",
  donor: "/hq/donations",
};

export function toEnterpriseRole(legacyRole: string): EnterpriseRole {
  return LEGACY_ROLE_MAP[legacyRole] ?? "client";
}

export function getPermissions(role: string): Permission[] {
  const enterprise = toEnterpriseRole(role);
  if (role === "owner") return ROLE_PERMISSIONS.founder;
  return ROLE_PERMISSIONS[enterprise] ?? [];
}

export function hasPermission(role: string, permission: Permission): boolean {
  if (role === "owner") return true;
  return getPermissions(role).includes(permission);
}

export function canAccessModule(userRole: string, module: string): boolean {
  if (userRole === "owner") return true;
  const allowed = HQ_MODULE_PERMISSIONS[module];
  if (!allowed) return false;
  const enterprise = toEnterpriseRole(userRole);
  return allowed.includes(enterprise);
}

export function canAccessRoute(userRole: string, path: string): boolean {
  if (userRole === "owner") return true;
  const permission = ROUTE_PERMISSIONS[path];
  if (!permission) {
    if (path.startsWith("/hq")) return hasPermission(userRole, "hq.executive");
    return true;
  }
  return hasPermission(userRole, permission);
}

export function getDefaultRoute(role: string): string {
  if (role === "owner") return "/hq";
  return DEFAULT_ROUTES[toEnterpriseRole(role)] ?? "/login";
}

export function getAccessibleModules(role: string): string[] {
  return Object.keys(HQ_MODULE_PERMISSIONS).filter((m) => canAccessModule(role, m));
}

export function buildEnterpriseSession(user: {
  id: string;
  email: string;
  role: string;
  name?: string;
}) {
  const enterpriseRole = toEnterpriseRole(user.role === "owner" ? "owner" : user.role);
  const permissions = getPermissions(user.role);
  return {
    ...user,
    enterpriseRole,
    enterpriseRoleLabel: ENTERPRISE_ROLE_LABELS[enterpriseRole],
    permissions,
    modules: getAccessibleModules(user.role),
    defaultRoute: getDefaultRoute(user.role),
  };
}

// Backward-compatible aliases for existing imports
export type HQRole = EnterpriseRole;
export function toHQRole(legacyRole: string): EnterpriseRole {
  return toEnterpriseRole(legacyRole);
}
