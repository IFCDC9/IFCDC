const INSECURE_JWT_SECRETS = new Set([
  "DEV_ONLY_CHANGE_ME_IFCDC",
  "dev-secret",
]);

const INSECURE_FOUNDER_PASSWORDS = new Set([
  "IFCDC@2026Secure",
]);

/**
 * Fail fast when production is misconfigured with dev defaults or missing secrets.
 * No-op in development and test environments.
 */
export function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== "production") return;

  const errors: string[] = [];

  const jwtSecret = (process.env.JWT_SECRET || process.env.SESSION_SECRET || "").trim();
  if (!jwtSecret || INSECURE_JWT_SECRETS.has(jwtSecret)) {
    errors.push(
      "JWT_SECRET (or SESSION_SECRET) must be set to a strong unique value in production",
    );
  }

  const founderPassword = (process.env.FOUNDER_SEED_PASSWORD || "").trim();
  if (!founderPassword || INSECURE_FOUNDER_PASSWORDS.has(founderPassword)) {
    errors.push(
      "FOUNDER_SEED_PASSWORD must be set to a strong unique value in production",
    );
  }

  if (!(process.env.MASTER_OWNER_EMAIL || "").trim()) {
    errors.push("MASTER_OWNER_EMAIL must be set in production");
  }

  if (!(process.env.PUBLIC_APP_URL || "").trim()) {
    errors.push("PUBLIC_APP_URL must be set in production");
  }

  if (errors.length > 0) {
    console.error("Production environment validation failed:");
    for (const message of errors) {
      console.error(`  - ${message}`);
    }
    console.error("See .env.example for required production variables.");
    process.exit(1);
  }
}
