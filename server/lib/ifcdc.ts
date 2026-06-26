/**
 * IFCDC Headquarters — centralized service integration.
 * All HQ auth, AURA, payments, and notifications route through here.
 */
import { createAuthService } from "@ifcdc/auth";
import { createAuraAI } from "@ifcdc/aura-ai";
import { createStripePayments } from "@ifcdc/payments";
import { createNotificationService } from "@ifcdc/notifications";

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "dev-secret";

export const HQ_AURA_PROMPT = `You are AURA, the enterprise AI assistant for IFCDC Headquarters.
You support executives, HR, finance, grants, programs, and the Software Division.
Provide accurate, professional, organization-focused responses.
You can assist with scheduling, reports, grant writing, HR questions, financial summaries, and system health monitoring.`;

type AuraClient = ReturnType<typeof createAuraAI>;

let _aura: AuraClient | null | undefined;

function getAuraClient(): AuraClient | null {
  if (_aura !== undefined) return _aura;
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) {
    _aura = null;
    return null;
  }
  _aura = createAuraAI({
    apiKey,
    model: process.env.AURA_MODEL || "gpt-4o-mini",
    systemPrompt: HQ_AURA_PROMPT,
  });
  return _aura;
}

export const ifcdc = {
  auth: createAuthService({ jwtSecret: JWT_SECRET, expiresIn: "7d", saltRounds: 12 }),

  get aura() {
    return getAuraClient();
  },

  payments: process.env.STRIPE_SECRET_KEY
    ? createStripePayments({ secretKey: process.env.STRIPE_SECRET_KEY })
    : null,

  notifications: createNotificationService({}),
};

export const IFCDC_SERVICE_URLS = {
  auth: process.env.IFCDC_AUTH_URL || "http://localhost:4100",
  aura: process.env.IFCDC_AURA_URL || "http://localhost:4101",
  notifications: process.env.IFCDC_NOTIFICATIONS_URL || "http://localhost:4102",
  payments: process.env.IFCDC_PAYMENTS_URL || "http://localhost:4103",
  database: process.env.IFCDC_DATABASE_URL || "http://localhost:4104",
};

export async function checkIfcdcServices(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  for (const [name, url] of Object.entries(IFCDC_SERVICE_URLS)) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      results[name] = res.ok;
    } catch {
      results[name] = false;
    }
  }
  return results;
}

export async function auraExecutiveChat(prompt: string, context?: string): Promise<string> {
  const aura = getAuraClient();
  if (!aura) {
    return "AURA AI is not configured for local development. Add OPENAI_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY to .env to enable AI features.";
  }
  const messages = context
    ? [
        { role: "system" as const, content: context },
        { role: "user" as const, content: prompt },
      ]
    : [{ role: "user" as const, content: prompt }];
  return aura.chat(messages);
}
