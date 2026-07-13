/**
 * IFCDC HQ credential separation — single source of truth.
 *
 * Founder / Super Admin:
 *   email: MASTER_OWNER_EMAIL (default service@ifcdc.org)
 *   password: FOUNDER_SEED_PASSWORD only
 *   role: owner → Founder Mode
 *
 * Grants Operator:
 *   email: GRANTS_OPERATOR_EMAIL (default 813786b@gmail.com)
 *   password: GRANTS_OPERATOR_PASSWORD only
 *   role: grant_manager — grant ops only; never Founder Mode
 *
 * These passwords must never be interchangeable.
 */

export const DEFAULT_SUPER_ADMIN_EMAIL = "service@ifcdc.org";
export const DEFAULT_GRANTS_OPERATOR_EMAIL = "813786b@gmail.com";

export function getSuperAdminEmail(): string {
  return (process.env.MASTER_OWNER_EMAIL || DEFAULT_SUPER_ADMIN_EMAIL).toLowerCase().trim();
}

export function getGrantsOperatorEmail(): string {
  return (process.env.GRANTS_OPERATOR_EMAIL || DEFAULT_GRANTS_OPERATOR_EMAIL).toLowerCase().trim();
}

/** Founder seed password only — never read GRANTS_OPERATOR_PASSWORD here. */
export function getSuperAdminPassword(): string {
  return (process.env.FOUNDER_SEED_PASSWORD || "").trim();
}

/** Grants Operator seed password only — never read FOUNDER_SEED_PASSWORD here. */
export function getGrantsOperatorPassword(): string {
  return (process.env.GRANTS_OPERATOR_PASSWORD || "").trim();
}

export function credentialsAreSeparated(): boolean {
  return getSuperAdminEmail() !== getGrantsOperatorEmail();
}

/** True when both passwords are set and are not the same string. */
export function passwordsAreDistinct(): boolean {
  const founder = getSuperAdminPassword();
  const grants = getGrantsOperatorPassword();
  if (!founder || !grants) return false;
  return founder !== grants;
}
