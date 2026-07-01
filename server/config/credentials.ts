/**
 * IFCDC HQ credential separation — single source of truth.
 * service@ifcdc.org → Super Admin (HQ)
 * GRANTS_OPERATOR_EMAIL → Grants.gov / SAM.gov / grant workflows only
 */

export const DEFAULT_SUPER_ADMIN_EMAIL = "service@ifcdc.org";
export const DEFAULT_GRANTS_OPERATOR_EMAIL = "813786b@gmail.com";

export function getSuperAdminEmail(): string {
  return (process.env.MASTER_OWNER_EMAIL || DEFAULT_SUPER_ADMIN_EMAIL).toLowerCase().trim();
}

export function getGrantsOperatorEmail(): string {
  return (process.env.GRANTS_OPERATOR_EMAIL || DEFAULT_GRANTS_OPERATOR_EMAIL).toLowerCase().trim();
}

export function getSuperAdminPassword(): string {
  return (process.env.FOUNDER_SEED_PASSWORD || "").trim();
}

export function getGrantsOperatorPassword(): string {
  return (process.env.GRANTS_OPERATOR_PASSWORD || "").trim();
}

export function credentialsAreSeparated(): boolean {
  return getSuperAdminEmail() !== getGrantsOperatorEmail();
}
