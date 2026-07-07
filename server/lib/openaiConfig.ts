/**
 * Single source of truth for OpenAI credentials across AURA surfaces:
 * Executive Chat, Grant Writer Studio, Proposal Generator, Voice AI, legacy monolith routes.
 *
 * Production issue addressed: OPENAI_API_KEY and AI_INTEGRATIONS_OPENAI_API_KEY had
 * opposite precedence in different modules, and AI_INTEGRATIONS_OPENAI_BASE_URL could
 * route a valid OpenAI key to a stale Replit proxy → 401 Incorrect API Key.
 */

export type OpenAiCredentialSource =
  | "OPENAI_API_KEY"
  | "AI_INTEGRATIONS_OPENAI_API_KEY"
  | "none";

export type ResolvedOpenAiCredentials = {
  apiKey: string;
  source: OpenAiCredentialSource;
  /** OpenAI SDK baseURL — omitted for default api.openai.com */
  baseURL?: string;
  keyPrefix: string;
  alternateKeyConfigured: boolean;
};

const PLACEHOLDER_PATTERNS = [
  /^sk-your/i,
  /^sk-xxx/i,
  /^your[_-]?openai/i,
  /^replace[_-]?me/i,
  /^<.*>$/,
  /placeholder/i,
  /^test[_-]?key/i,
];

function normalizeEnvValue(raw: string | undefined): string {
  if (!raw) return "";
  let v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  if (v.toLowerCase().startsWith("bearer ")) {
    v = v.slice(7).trim();
  }
  return v;
}

function looksLikeOpenAiKey(key: string): boolean {
  if (!key || key.length < 20) return false;
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(key))) return false;
  return /^(sk-|sk_proj-)/i.test(key);
}

export function keyPrefix(key: string): string {
  if (!key) return "(empty)";
  if (key.length <= 12) return `${key.slice(0, 4)}…`;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

function resolveBaseUrl(source: OpenAiCredentialSource): string | undefined {
  const explicit = normalizeEnvValue(process.env.OPENAI_BASE_URL);
  if (explicit) return explicit;

  const integrationsBase = normalizeEnvValue(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);
  if (!integrationsBase) return undefined;

  // Only use Replit/custom base URL with the integrations key — never with production OPENAI_API_KEY.
  if (source === "AI_INTEGRATIONS_OPENAI_API_KEY") {
    return integrationsBase;
  }

  // Stale Replit base URL set alongside a valid OPENAI_API_KEY causes 401 on Voice/legacy routes.
  if (source === "OPENAI_API_KEY" && integrationsBase.includes("replit")) {
    console.warn(
      "[openai-config] Ignoring AI_INTEGRATIONS_OPENAI_BASE_URL (Replit) — using api.openai.com with OPENAI_API_KEY"
    );
    return undefined;
  }

  return undefined;
}

/** Resolve which API key and base URL all AURA services should use. */
export function resolveOpenAiCredentials(): ResolvedOpenAiCredentials | null {
  const primary = normalizeEnvValue(process.env.OPENAI_API_KEY);
  const alternate = normalizeEnvValue(process.env.AI_INTEGRATIONS_OPENAI_API_KEY);

  const primaryValid = looksLikeOpenAiKey(primary);
  const alternateValid = looksLikeOpenAiKey(alternate);

  if (primaryValid && alternateValid && primary !== alternate) {
    console.warn(
      `[openai-config] Both OPENAI_API_KEY (${keyPrefix(primary)}) and AI_INTEGRATIONS_OPENAI_API_KEY (${keyPrefix(alternate)}) are set and differ. Using OPENAI_API_KEY.`
    );
  }

  let apiKey = "";
  let source: OpenAiCredentialSource = "none";

  if (primaryValid) {
    apiKey = primary;
    source = "OPENAI_API_KEY";
  } else if (alternateValid) {
    apiKey = alternate;
    source = "AI_INTEGRATIONS_OPENAI_API_KEY";
  } else if (primary && !primaryValid) {
    console.warn(`[openai-config] OPENAI_API_KEY is set but invalid/placeholder (${keyPrefix(primary)})`);
    if (alternateValid) {
      apiKey = alternate;
      source = "AI_INTEGRATIONS_OPENAI_API_KEY";
    }
  } else if (alternate && !alternateValid) {
    console.warn(`[openai-config] AI_INTEGRATIONS_OPENAI_API_KEY is set but invalid/placeholder (${keyPrefix(alternate)})`);
  }

  if (!apiKey) return null;

  const baseURL = resolveBaseUrl(source);
  return {
    apiKey,
    source,
    baseURL,
    keyPrefix: keyPrefix(apiKey),
    alternateKeyConfigured: alternateValid && alternate !== apiKey,
  };
}

export function formatOpenAiAuthError(err: unknown, creds: ResolvedOpenAiCredentials | null): string {
  const raw = err instanceof Error ? err.message : String(err);
  const is401 = /401|incorrect api key|invalid api key|authentication/i.test(raw);
  if (!is401) return raw;

  const src = creds?.source ?? "none";
  const prefix = creds?.keyPrefix ?? "(unknown)";
  const hints: string[] = [
    `OpenAI rejected the API key from ${src} (prefix ${prefix}).`,
  ];
  if (src === "OPENAI_API_KEY" && creds?.alternateKeyConfigured) {
    hints.push("AI_INTEGRATIONS_OPENAI_API_KEY is also set — update or remove the invalid OPENAI_API_KEY on Render.");
  }
  if (normalizeEnvValue(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL)) {
    hints.push("Check AI_INTEGRATIONS_OPENAI_BASE_URL — stale Replit URLs cause 401 with production keys.");
  }
  hints.push("Set a valid OPENAI_API_KEY on Render (Integrations → Environment).");
  return hints.join(" ");
}

/** Lightweight live verification — used by Integrations Hub test. */
export async function verifyOpenAiConnection(): Promise<{
  ok: boolean;
  source: OpenAiCredentialSource;
  keyPrefix: string;
  baseURL: string;
  message: string;
}> {
  const creds = resolveOpenAiCredentials();
  if (!creds) {
    return {
      ok: false,
      source: "none",
      keyPrefix: "(empty)",
      baseURL: "default",
      message: "No valid OpenAI API key. Set OPENAI_API_KEY on Render.",
    };
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    apiKey: creds.apiKey,
    ...(creds.baseURL ? { baseURL: creds.baseURL } : {}),
  });

  try {
    await client.models.list();
    return {
      ok: true,
      source: creds.source,
      keyPrefix: creds.keyPrefix,
      baseURL: creds.baseURL ?? "https://api.openai.com/v1",
      message: `Connected via ${creds.source} (${creds.keyPrefix})`,
    };
  } catch (err) {
    return {
      ok: false,
      source: creds.source,
      keyPrefix: creds.keyPrefix,
      baseURL: creds.baseURL ?? "https://api.openai.com/v1",
      message: formatOpenAiAuthError(err, creds),
    };
  }
}

export function openAiConfigStatus(): {
  configured: boolean;
  source: OpenAiCredentialSource;
  keyPrefix: string;
  baseURL: string;
  primarySet: boolean;
  alternateSet: boolean;
  integrationsBaseSet: boolean;
} {
  const creds = resolveOpenAiCredentials();
  const primary = normalizeEnvValue(process.env.OPENAI_API_KEY);
  const alternate = normalizeEnvValue(process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
  return {
    configured: Boolean(creds),
    source: creds?.source ?? "none",
    keyPrefix: creds?.keyPrefix ?? "(empty)",
    baseURL: creds?.baseURL ?? "https://api.openai.com/v1 (default)",
    primarySet: Boolean(primary),
    alternateSet: Boolean(alternate),
    integrationsBaseSet: Boolean(normalizeEnvValue(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL)),
  };
}
