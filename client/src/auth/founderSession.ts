import type { UserInfo } from "./AuthContext";
import type { Permission } from "./enterpriseAuth";

const FOUNDER_PERMISSIONS: Permission[] = [
  "hq.executive", "hq.hr", "hq.hr.manage", "hq.payroll",
  "hq.grants", "hq.grants.manage", "hq.finance", "hq.finance.manage",
  "hq.donations", "hq.programs", "hq.software", "hq.aura",
  "hq.analytics", "hq.notifications", "hq.settings", "hq.settings.manage", "hq.documents",
  "app.barbers", "app.music", "app.radio", "app.tapis",
  "app.inclusive", "app.swiftware", "app.cryptocoin",
];

type LoginPayload = {
  role?: string;
  user?: { id: string; email: string; role: string; name?: string };
};

/** Build a full HQ session client-side when /api/hq/auth/session is slow or unavailable */
export function buildFounderSessionFromLogin(data: LoginPayload): UserInfo {
  const role = data.user?.role ?? data.role ?? "owner";
  const email = data.user?.email ?? "service@ifcdc.org";
  return {
    id: data.user?.id ?? "founder-local",
    email,
    role,
    name: data.user?.name ?? "Mr. Fahreal Allah",
    enterpriseRole: "founder",
    enterpriseRoleLabel: "Founder",
    permissions: FOUNDER_PERMISSIONS,
    modules: ["executive", "hr", "payroll", "finance", "grants", "programs", "software_division", "aura", "settings", "documents", "analytics", "notifications", "operations", "board", "compliance"],
    defaultRoute: "/hq",
    employee: null,
  };
}

export function isFounderRole(role?: string): boolean {
  return role === "owner" || role === "founder" || role === "EXEC" || role === "admin";
}
