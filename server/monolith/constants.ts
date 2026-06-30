export const ROLES = {
  EXEC: "EXEC",
  CLINICIAN: "CLINICIAN",
  CASE_MANAGER: "CASE_MANAGER",
  CHW: "CHW",
  ADMIN: "ADMIN",
} as const;

export const ROLE_VALUES = Object.values(ROLES);

export const ADMIN_EMAIL = "813786b@gmail.com";

export function cryptoRandomId(): string {
  return "id_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now().toString(36);
}

export function assignRole(email: string, founderEmail: string): string {
  const lower = email.toLowerCase();
  if (lower === founderEmail.toLowerCase()) return "owner";
  if (lower === ADMIN_EMAIL.toLowerCase()) return "admin";
  return "user";
}
