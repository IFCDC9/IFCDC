export const ROLES = {
  EXEC: "EXEC",
  CLINICIAN: "CLINICIAN",
  CASE_MANAGER: "CASE_MANAGER",
  CHW: "CHW",
  ADMIN: "ADMIN",
} as const;

export const ROLE_VALUES = Object.values(ROLES);

export function cryptoRandomId(): string {
  return "id_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now().toString(36);
}

/** @deprecated Use server/config/credentials.ts — legacy assignRole for registration only */
export function assignRole(email: string, superAdminEmail: string, grantsOperatorEmail?: string): string {
  const lower = email.toLowerCase();
  if (lower === superAdminEmail.toLowerCase()) return "owner";
  if (grantsOperatorEmail && lower === grantsOperatorEmail.toLowerCase()) return "grant_manager";
  return "user";
}
