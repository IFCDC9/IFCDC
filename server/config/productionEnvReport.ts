/**
 * Logs production configuration gaps at startup (non-fatal).
 * Required secrets are enforced by assertProductionEnv().
 */

const OPTIONAL_PRODUCTION_VARS: { key: string; purpose: string }[] = [
  { key: "OPENAI_API_KEY", purpose: "AURA AI Command Center" },
  { key: "AI_INTEGRATIONS_OPENAI_API_KEY", purpose: "AURA AI (alternate key)" },
  { key: "RESEND_API_KEY", purpose: "Communications Center email" },
  { key: "RESEND_FROM_EMAIL", purpose: "Outbound email sender" },
  { key: "TWILIO_ACCOUNT_SID", purpose: "Twilio AURA voice + SMS" },
  { key: "TWILIO_AUTH_TOKEN", purpose: "Twilio AURA voice + SMS" },
  { key: "TWILIO_PHONE_NUMBER", purpose: "IFCDC HQ line +13313168167" },
  { key: "HQ_BARBERS_HEALTH_URL", purpose: "IFCDC Barbers production health monitoring" },
  { key: "HQ_MUSIC_HEALTH_URL", purpose: "IFCDC Music app monitoring" },
  { key: "HQ_TAPIS_HEALTH_URL", purpose: "IFCDC Tapis monitoring" },
  { key: "HQ_INCLUSIVE_HEALTH_URL", purpose: "Inclusive Community monitoring" },
  { key: "STRIPE_SECRET_KEY", purpose: "Payments processing" },
  { key: "GOOGLE_CLIENT_ID", purpose: "Google OAuth integrations" },
  { key: "GOOGLE_CLIENT_SECRET", purpose: "Google OAuth integrations" },
];

export function reportProductionEnvGaps(): void {
  if (process.env.NODE_ENV !== "production") return;

  const missing = OPTIONAL_PRODUCTION_VARS.filter(({ key }) => !(process.env[key] || "").trim());
  if (missing.length === 0) {
    console.log("Production env: all optional integration variables configured");
    return;
  }

  console.warn("Production env: optional variables not set (features may be limited):");
  for (const { key, purpose } of missing) {
    console.warn(`  - ${key} (${purpose})`);
  }
  if (!process.env.HQ_BARBERS_HEALTH_URL?.trim()) {
    console.warn("  → Set HQ_BARBERS_HEALTH_URL to the live Barbers app /api/health URL (flagship app)");
  }
}
