import type { UserInfo } from "./AuthContext";
import type { Permission } from "./enterpriseAuth";

const FOUNDER_PERMISSIONS: Permission[] = [
  "hq.executive", "hq.hr", "hq.hr.manage", "hq.payroll",
  "hq.grants", "hq.grants.manage", "hq.finance", "hq.finance.manage",
  "hq.donations", "hq.programs", "hq.clients", "hq.clients.manage", "hq.software", "hq.aura",
  "hq.analytics", "hq.notifications", "hq.settings", "hq.settings.manage", "hq.documents",
  "app.barbers", "app.music", "app.radio", "app.tapis",
  "app.inclusive", "app.swiftware", "app.cryptocoin",
];

/** Grants Operator — grant lifecycle only (mirrors server grant_manager). */
const GRANTS_OPERATOR_PERMISSIONS: Permission[] = [
  "hq.grants", "hq.grants.manage", "hq.documents", "hq.notifications", "hq.aura",
  "hq.finance", "hq.analytics",
];

type LoginPayload = {
  role?: string;
  user?: { id: string; email: string; role: string; name?: string };
};

/** Build a full HQ Founder session when /api/hq/auth/session is slow or unavailable */
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
    modules: [
      "executive", "hr", "payroll", "finance", "grants", "programs", "software_division",
      "aura", "settings", "documents", "analytics", "notifications", "operations", "board", "compliance",
    ],
    defaultRoute: "/hq",
    employee: null,
  };
}

/** Build a Grants Operator session when HQ session endpoint is slow */
export function buildGrantsOperatorSessionFromLogin(data: LoginPayload): UserInfo {
  const role = data.user?.role ?? data.role ?? "grant_manager";
  const email = data.user?.email ?? "813786b@gmail.com";
  return {
    id: data.user?.id ?? "grants-operator-local",
    email,
    role,
    name: data.user?.name ?? "Grants Operator",
    enterpriseRole: "grant_manager",
    enterpriseRoleLabel: "Grants Operator",
    permissions: GRANTS_OPERATOR_PERMISSIONS,
    modules: ["grants", "finance", "aura", "documents", "analytics", "notifications"],
    defaultRoute: "/hq/grants",
    employee: null,
  };
}

/** True Founder / Super Admin roles only — never elevate EXEC or admin to Founder Mode bootstrap. */
export function isFounderRole(role?: string): boolean {
  return role === "owner" || role === "founder";
}

export function isGrantsOperatorRole(role?: string): boolean {
  return role === "grant_manager";
}
