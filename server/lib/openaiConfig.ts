/**
 * Single source of truth for OpenAI credentials across AURA surfaces.
 */

export type OpenAiCredentialSource =
  | "AURA_OPENAI_API_KEY"
  | "OPENAI_API_KEY"
  | "AI_INTEGRATIONS_OPENAI_API_KEY"
  | "none";

export type ResolvedOpenAiCredentials = {
  apiKey: string;
  source: OpenAiCredentialSource;
  baseURL?: string;
  keyPrefix: string;
  keyLength: number;
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

/** sk-proj keys are typically 160+ characters — shorter usually means truncation on Render/dotenv. */
const MIN_SK_PROJ_LENGTH = 120;
const MIN_SK_LENGTH = 40;

function normalizeEnvValue(raw: string | undefined): string {
  if (!raw) return "";
  let v = raw.trim();
  // Strip BOM and all whitespace/newlines (common Render copy-paste issue).
  v = v.replace(/^\uFEFF/, "").replace(/[\r\n\t]/g, "");
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  if (v.toLowerCase().startsWith("bearer ")) {
    v = v.slice(7).trim();
  }
  // Remove stray surrounding quotes after inner trim.
  v = v.replace(/^["']|["']$/g, "");
  return v;
}

function looksLikeOpenAiKey(key: string): boolean {
  if (!key || key.length < MIN_SK_LENGTH) return false;
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(key))) return false;
  return /^sk-/i.test(key);
}

function keyIntegrityWarning(key: string, source: OpenAiCredentialSource): string | null {
  if (!key) return null;
  if (/^sk-proj-/i.test(key) && key.length < MIN_SK_PROJ_LENGTH) {
    return `${source} looks truncated (${key.length} chars; sk-proj keys are usually 160+). Re-paste the full key on Render.`;
  }
  if (/^sk-/i.test(key) && key.length < MIN_SK_LENGTH) {
    return `${source} looks too short (${key.length} chars).`;
  }
  return null;
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

  if (source === "AI_INTEGRATIONS_OPENAI_API_KEY") {
    return integrationsBase;
  }

  if (source === "OPENAI_API_KEY" && integrationsBase.includes("replit")) {
    console.warn(
      "[openai-config] Ignoring AI_INTEGRATIONS_OPENAI_BASE_URL (Replit) — using api.openai.com with OPENAI_API_KEY"
    );
    return undefined;
  }

  return undefined;
}

function buildCreds(apiKey: string, source: OpenAiCredentialSource, alternateConfigured: boolean): ResolvedOpenAiCredentials {
  const warn = keyIntegrityWarning(apiKey, source);
  if (warn) console.warn(`[openai-config] ${warn}`);
  return {
    apiKey,
    source,
    baseURL: resolveBaseUrl(source),
    keyPrefix: keyPrefix(apiKey),
    keyLength: apiKey.length,
    alternateKeyConfigured: alternateConfigured,
  };
}

/**
 * All valid keys to try, in priority order.
 * AURA_OPENAI_API_KEY is the canonical production key; OPENAI_API_KEY and
 * AI_INTEGRATIONS_OPENAI_API_KEY remain as automatic fallbacks for continuity.
 */
export function listOpenAiCredentialCandidates(): ResolvedOpenAiCredentials[] {
  const sources: Array<{ value: string; source: OpenAiCredentialSource }> = [
    { value: normalizeEnvValue(process.env.AURA_OPENAI_API_KEY), source: "AURA_OPENAI_API_KEY" },
    { value: normalizeEnvValue(process.env.OPENAI_API_KEY), source: "OPENAI_API_KEY" },
    { value: normalizeEnvValue(process.env.AI_INTEGRATIONS_OPENAI_API_KEY), source: "AI_INTEGRATIONS_OPENAI_API_KEY" },
  ];

  const candidates: ResolvedOpenAiCredentials[] = [];
  const seen = new Set<string>();
  const validCount = sources.filter((s) => looksLikeOpenAiKey(s.value)).length;

  for (const { value, source } of sources) {
    if (!looksLikeOpenAiKey(value) || seen.has(value)) continue;
    seen.add(value);
    candidates.push(buildCreds(value, source, validCount > 1));
  }

  return candidates;
}

/** Primary credentials (first candidate). */
export function resolveOpenAiCredentials(): ResolvedOpenAiCredentials | null {
  const candidates = listOpenAiCredentialCandidates();
  if (!candidates.length) {
    const aura = normalizeEnvValue(process.env.AURA_OPENAI_API_KEY);
    const primary = normalizeEnvValue(process.env.OPENAI_API_KEY);
    const alternate = normalizeEnvValue(process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
    if (aura && !looksLikeOpenAiKey(aura)) {
      console.warn(`[openai-config] AURA_OPENAI_API_KEY invalid/placeholder (${keyPrefix(aura)}, len ${aura.length})`);
    }
    if (primary && !looksLikeOpenAiKey(primary)) {
      console.warn(`[openai-config] OPENAI_API_KEY invalid/placeholder (${keyPrefix(primary)}, len ${primary.length})`);
    }
    if (alternate && !looksLikeOpenAiKey(alternate)) {
      console.warn(`[openai-config] AI_INTEGRATIONS_OPENAI_API_KEY invalid (${keyPrefix(alternate)})`);
    }
    return null;
  }

  if (candidates.length > 1) {
    console.log(
      `[openai-config] ${candidates.length} OpenAI keys configured; primary ${candidates[0].source} (${candidates[0].keyPrefix}, ${candidates[0].keyLength} chars)`
    );
  }

  return candidates[0];
}

export function isOpenAiAuthError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /401|incorrect api key|invalid api key|authentication|invalid_api_key/i.test(raw);
}

export function openAiClientOptions(creds: ResolvedOpenAiCredentials): {
  apiKey: string;
  baseURL?: string;
  organization?: string;
  project?: string;
} {
  const org = normalizeEnvValue(process.env.OPENAI_ORG_ID) || normalizeEnvValue(process.env.OPENAI_ORGANIZATION);
  const project = normalizeEnvValue(process.env.OPENAI_PROJECT_ID);
  return {
    apiKey: creds.apiKey,
    ...(creds.baseURL ? { baseURL: creds.baseURL } : {}),
    ...(org ? { organization: org } : {}),
    ...(project ? { project } : {}),
  };
}

export function formatOpenAiAuthError(err: unknown, creds: ResolvedOpenAiCredentials | null): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (!isOpenAiAuthError(err)) return raw;

  const src = creds?.source ?? "none";
  const prefix = creds?.keyPrefix ?? "(unknown)";
  const len = creds?.keyLength ?? 0;
  const hints: string[] = [`OpenAI rejected ${src} (prefix ${prefix}, ${len} chars).`];

  const truncation = creds ? keyIntegrityWarning(creds.apiKey, creds.source) : null;
  if (truncation) hints.push(truncation);

  if (creds?.alternateKeyConfigured) {
    hints.push("A fallback key was also tried if configured.");
  }

  hints.push(
    "On Render: open Environment → set AURA_OPENAI_API_KEY to a fresh secret key from platform.openai.com → paste the full sk-proj-… value with no line breaks → Manual Deploy."
  );
  return hints.join(" ");
}

/** Try each configured key until one succeeds; on 401 rotate to next candidate. */
export async function withOpenAiCredentialFallback<T>(
  operation: (creds: ResolvedOpenAiCredentials, client: import("openai").default) => Promise<T>
): Promise<{ result: T; creds: ResolvedOpenAiCredentials }> {
  const candidates = listOpenAiCredentialCandidates();
  if (!candidates.length) {
    throw new Error("No valid OpenAI API key. Set AURA_OPENAI_API_KEY on Render.");
  }

  const OpenAI = (await import("openai")).default;
  const errors: string[] = [];

  for (const creds of candidates) {
    const client = new OpenAI(openAiClientOptions(creds));
    try {
      const result = await operation(creds, client);
      if (creds !== candidates[0]) {
        console.warn(
          `[openai-config] Primary key failed; succeeded with ${creds.source} (${creds.keyPrefix}). Update AURA_OPENAI_API_KEY on Render.`
        );
      }
      return { result, creds };
    } catch (err) {
      const msg = formatOpenAiAuthError(err, creds);
      errors.push(msg);
      if (!isOpenAiAuthError(err)) throw new Error(msg);
      console.warn(`[openai-config] ${creds.source} auth failed (${creds.keyPrefix}):`, msg);
    }
  }

  throw new Error(errors.join(" | "));
}

/** Live verification — tries every configured key. */
export async function verifyOpenAiConnection(): Promise<{
  ok: boolean;
  source: OpenAiCredentialSource;
  keyPrefix: string;
  keyLength: number;
  baseURL: string;
  message: string;
  triedSources: string[];
}> {
  const candidates = listOpenAiCredentialCandidates();
  if (!candidates.length) {
    return {
      ok: false,
      source: "none",
      keyPrefix: "(empty)",
      keyLength: 0,
      baseURL: "default",
      message: "No valid OpenAI API key. Set AURA_OPENAI_API_KEY on Render.",
      triedSources: [],
    };
  }

  try {
    const { creds: used } = await withOpenAiCredentialFallback(async (creds, client) => {
      await client.models.list();
      return creds;
    });
    return {
      ok: true,
      source: used.source,
      keyPrefix: used.keyPrefix,
      keyLength: used.keyLength,
      baseURL: used.baseURL ?? "https://api.openai.com/v1",
      message: `Connected via ${used.source} (${used.keyPrefix}, ${used.keyLength} chars)`,
      triedSources: candidates.map((c) => c.source),
    };
  } catch (err) {
    const primary = candidates[0];
    return {
      ok: false,
      source: primary.source,
      keyPrefix: primary.keyPrefix,
      keyLength: primary.keyLength,
      baseURL: primary.baseURL ?? "https://api.openai.com/v1",
      message: formatOpenAiAuthError(err, primary),
      triedSources: candidates.map((c) => c.source),
    };
  }
}

export function openAiConfigStatus(): {
  configured: boolean;
  source: OpenAiCredentialSource;
  keyPrefix: string;
  keyLength: number;
  keyIntegrityOk: boolean;
  baseURL: string;
  auraKeySet: boolean;
  primarySet: boolean;
  alternateSet: boolean;
  integrationsBaseSet: boolean;
  candidateCount: number;
} {
  const creds = resolveOpenAiCredentials();
  const aura = normalizeEnvValue(process.env.AURA_OPENAI_API_KEY);
  const primary = normalizeEnvValue(process.env.OPENAI_API_KEY);
  const alternate = normalizeEnvValue(process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
  const candidates = listOpenAiCredentialCandidates();
  return {
    configured: Boolean(creds),
    source: creds?.source ?? "none",
    keyPrefix: creds?.keyPrefix ?? "(empty)",
    keyLength: creds?.keyLength ?? 0,
    keyIntegrityOk: creds ? !keyIntegrityWarning(creds.apiKey, creds.source) : false,
    baseURL: creds?.baseURL ?? "https://api.openai.com/v1 (default)",
    auraKeySet: Boolean(aura),
    primarySet: Boolean(primary),
    alternateSet: Boolean(alternate),
    integrationsBaseSet: Boolean(normalizeEnvValue(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL)),
    candidateCount: candidates.length,
  };
}

/** Boot-time diagnostic — logs key length without exposing secrets. */
export function logOpenAiConfigAtBoot(): void {
  const status = openAiConfigStatus();
  if (!status.configured) {
    console.warn("[openai-config] No valid OpenAI API key — AURA grant writing and chat disabled");
    return;
  }
  const level = status.keyIntegrityOk ? "log" : "warn";
  const msg = `[openai-config] AURA OpenAI: ${status.source} prefix=${status.keyPrefix} length=${status.keyLength} candidates=${status.candidateCount} integrity=${status.keyIntegrityOk ? "ok" : "CHECK_TRUNCATION"}`;
  console[level](msg);
}
