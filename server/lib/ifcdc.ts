/**
 * IFCDC Headquarters — centralized service integration.
 * All HQ auth, AURA, payments, and notifications route through here.
 */
import { createAuthService } from "@ifcdc/auth";
import { createAuraAI } from "@ifcdc/aura-ai";
import { createStripePayments } from "@ifcdc/payments";
import { createNotificationService } from "@ifcdc/notifications";
import {
  resolveOpenAiCredentials,
  formatOpenAiAuthError,
  type ResolvedOpenAiCredentials,
} from "./openaiConfig";

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "dev-secret";

export const HQ_AURA_PROMPT = `You are AURA, the enterprise AI assistant for IFCDC Headquarters.
You support executives, HR, finance, grants, programs, and the Software Division.
Provide accurate, professional, organization-focused responses.
You can assist with scheduling, reports, grant writing, HR questions, financial summaries, and system health monitoring.`;

type AuraClient = ReturnType<typeof createAuraAI>;

let _aura: AuraClient | null | undefined;
let _auraCreds: ResolvedOpenAiCredentials | null | undefined;

function buildAuraClient(creds: ResolvedOpenAiCredentials): AuraClient {
  return createAuraAI({
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
    model: process.env.AURA_MODEL || "gpt-4o-mini",
    systemPrompt: HQ_AURA_PROMPT,
  });
}

function getAuraClient(): AuraClient | null {
  const creds = resolveOpenAiCredentials();
  if (!creds) {
    _aura = null;
    _auraCreds = null;
    return null;
  }

  // Rebuild client when credentials change (e.g. after Render env update + restart).
  if (_aura && _auraCreds && _auraCreds.apiKey === creds.apiKey && _auraCreds.baseURL === creds.baseURL) {
    return _aura;
  }

  _auraCreds = creds;
  _aura = buildAuraClient(creds);
  return _aura;
}

export function getAuraOpenAiStatus() {
  return resolveOpenAiCredentials();
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
  const creds = resolveOpenAiCredentials();
  const aura = getAuraClient();
  if (!aura || !creds) {
    throw new Error(
      "AURA is not configured. Set OPENAI_API_KEY on the server (Render → Environment Variables)."
    );
  }

  const messages = context
    ? [
        { role: "system" as const, content: context },
        { role: "user" as const, content: prompt },
      ]
    : [{ role: "user" as const, content: prompt }];

  try {
    return await aura.chat(messages);
  } catch (err) {
    const message = formatOpenAiAuthError(err, creds);
    console.error(`[aura] chat failed source=${creds.source} prefix=${creds.keyPrefix}:`, message);
    throw new Error(message);
  }
}

/** Multi-turn receptionist chat — single combined system prompt (no duplicate system messages). */
export async function auraReceptionistChat(
  history: { role: "user" | "assistant"; content: string }[],
  systemPrompt: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const creds = resolveOpenAiCredentials();
  if (!creds) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    apiKey: creds.apiKey,
    ...(creds.baseURL ? { baseURL: creds.baseURL } : {}),
  });
  const model = process.env.AURA_MODEL || "gpt-4o-mini";
  const recent = history.slice(-12);
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...recent],
      temperature: options?.temperature ?? 0.72,
      max_tokens: options?.maxTokens ?? 300,
    });
    return response.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    throw new Error(formatOpenAiAuthError(err, creds));
  }
}
