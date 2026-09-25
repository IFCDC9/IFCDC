/**
 * Provider-agnostic generative capability registry — Phase 6.
 * Selection by capability, not hard-coded vendor. Replaceable adapters.
 * Never invents media. Never prints secrets.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const REGISTRY_PATH = join(ROOT, "IFCDC-PRODUCTIONS", "generation-registry.json");
const HEALTH_PATH = join(ROOT, "IFCDC-PRODUCTIONS", "provider-health.json");

/** Canonical capability ids (snake_case). Phase 6 surface names map 1:1. */
export const CAPABILITIES = [
  "image_generation",
  "image_editing",
  "video_generation",
  "image_to_video",
  "text_to_video",
  "background_scene_broll",
  "graphics_title_graphics",
  "voice_generation",
  "founder_voice_clone",
  "founder_visual_clone",
  "music_sound_integration",
];

export const PHASE6_CAPABILITY_ALIASES = {
  IMAGE_GENERATION: "image_generation",
  IMAGE_EDITING: "image_editing",
  TEXT_TO_VIDEO: "text_to_video",
  IMAGE_TO_VIDEO: "image_to_video",
  VIDEO_GENERATION: "video_generation",
  BROLL_GENERATION: "background_scene_broll",
  VOICE_GENERATION: "voice_generation",
  FOUNDER_VOICE: "founder_voice_clone",
  FOUNDER_VISUAL_GENERATION: "founder_visual_clone",
};

/**
 * @typedef {{
 *  id: string,
 *  capabilities: string[],
 *  configured: boolean,
 *  generate: Function,
 *  describe?: Function,
 *  health?: Function,
 *  priority?: number,
 *  identityReference?: boolean,
 *  maxDurationSeconds?: number|null,
 *  aspectRatios?: string[],
 *  costMetadata?: object|null,
 * }} Adapter
 */

/** @type {Map<string, Adapter>} */
const adapters = new Map();

export function notConfiguredResult(capability, reason = null) {
  return {
    ok: false,
    status: "NOT_CONFIGURED",
    capability,
    file: null,
    path: null,
    fake: false,
    reason:
      reason ||
      `No provider configured for ${capability}. Register an approved adapter or set credential.`,
    blocker: `MISSING_PROVIDER:${capability}`,
  };
}

export function registerAdapter(adapter) {
  if (!adapter?.id || typeof adapter.generate !== "function") {
    throw new Error("adapter requires id and generate()");
  }
  adapters.set(adapter.id, {
    id: adapter.id,
    capabilities: adapter.capabilities || [],
    configured: adapter.configured !== false,
    generate: adapter.generate,
    describe: adapter.describe || (() => ({ id: adapter.id, configured: adapter.configured !== false })),
    health: adapter.health || null,
    priority: Number(adapter.priority ?? 100),
    identityReference: Boolean(adapter.identityReference),
    maxDurationSeconds: adapter.maxDurationSeconds ?? null,
    aspectRatios: adapter.aspectRatios || [],
    costMetadata: adapter.costMetadata ?? null,
  });
  return adapter.id;
}

export function listAdapters() {
  return [...adapters.values()].map((a) => ({
    id: a.id,
    capabilities: a.capabilities,
    configured: a.configured,
    priority: a.priority,
    identityReference: a.identityReference,
    maxDurationSeconds: a.maxDurationSeconds,
    aspectRatios: a.aspectRatios,
    costMetadata: a.costMetadata,
    ...(typeof a.describe === "function" ? a.describe() : {}),
  }));
}

export function readRegistryConfig() {
  mkdirSync(join(ROOT, "IFCDC-PRODUCTIONS"), { recursive: true });
  if (!existsSync(REGISTRY_PATH)) {
    const defaults = {
      version: 2,
      company: "IFCDC PRODUCTIONS",
      note: "Swap providers by capability without rebuilding HQ. null = NOT_CONFIGURED. Failover uses providersFailover lists.",
      providers: Object.fromEntries(CAPABILITIES.map((c) => [c, null])),
      providersOverride: {
        graphics_title_graphics: "local-graphics",
        music_sound_integration: "local-music-stage",
      },
      providersFailover: {
        image_generation: ["openai-media", "hq-openai-proxy"],
        image_editing: ["openai-media", "hq-openai-proxy"],
        voice_generation: ["openai-media", "hq-openai-proxy"],
      },
    };
    writeFileSync(REGISTRY_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch {
    return { version: 2, providers: {}, providersOverride: {}, providersFailover: {} };
  }
}

function adapterMatches(adapter, capability) {
  if (!adapter || !adapter.configured) return false;
  if (adapter.capabilities.length && !adapter.capabilities.includes(capability)) return false;
  return true;
}

/** Ordered list of configured adapters for a capability (primary + failover). */
export function providersFor(capability) {
  const config = readRegistryConfig();
  const named = [];
  const override = config.providersOverride?.[capability];
  const primary = override || config.providers?.[capability] || null;
  if (primary) named.push(primary);
  for (const id of config.providersFailover?.[capability] || []) {
    if (!named.includes(id)) named.push(id);
  }
  // Also include any registered adapter that advertises this capability (by priority).
  const extras = [...adapters.values()]
    .filter((a) => adapterMatches(a, capability) && !named.includes(a.id) && !String(a.id).startsWith("stub-"))
    .sort((a, b) => a.priority - b.priority)
    .map((a) => a.id);
  named.push(...extras);

  const out = [];
  const seen = new Set();
  for (const id of named) {
    if (seen.has(id)) continue;
    seen.add(id);
    const adapter = adapters.get(id);
    if (adapterMatches(adapter, capability)) out.push(adapter);
  }
  return out;
}

export function providerFor(capability) {
  return providersFor(capability)[0] || null;
}

export async function generate(capability, request = {}) {
  const chain = providersFor(capability);
  if (!chain.length) return notConfiguredResult(capability);

  const attempts = [];
  for (const adapter of chain) {
    try {
      const result = await adapter.generate(capability, request);
      if (!result || result.fake === true) {
        attempts.push({ provider: adapter.id, status: "REFUSED_FAKE" });
        continue;
      }
      if (result.ok && (result.path || result.file || result.bytes)) {
        return {
          ok: true,
          status: result.status || "GENERATED",
          capability,
          provider: adapter.id,
          fake: false,
          attempts,
          failoverUsed: attempts.length > 0,
          ...result,
        };
      }
      attempts.push({
        provider: adapter.id,
        status: result.status || "FAILED",
        blocker: result.blocker || result.reason || null,
      });
      // Incompatible model / not configured → try next approved compatible provider.
      continue;
    } catch (error) {
      attempts.push({
        provider: adapter.id,
        status: "FAILED",
        blocker: `PROVIDER_ERROR:${adapter.id}:${capability}`,
        reason: String(error?.message || error).slice(0, 300),
      });
    }
  }

  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    status: last?.status || "NOT_CONFIGURED",
    capability,
    provider: last?.provider || null,
    file: null,
    path: null,
    fake: false,
    attempts,
    reason: last?.reason || last?.blocker || `No compatible provider succeeded for ${capability}`,
    blocker: last?.blocker || `MISSING_PROVIDER:${capability}`,
  };
}

export function capabilityStatus() {
  const config = readRegistryConfig();
  const out = {};
  for (const capability of CAPABILITIES) {
    const chain = providersFor(capability);
    const primary = chain[0];
    if (primary) {
      const meta = typeof primary.describe === "function" ? primary.describe() : {};
      out[capability] = {
        status: "CONFIGURED",
        provider: primary.id,
        failover: chain.slice(1).map((a) => a.id),
        identityReference: primary.identityReference,
        maxDurationSeconds: primary.maxDurationSeconds,
        aspectRatios: primary.aspectRatios,
        costMetadata: primary.costMetadata,
        availability: meta.availability || "available_if_callable",
        ...meta,
      };
    } else {
      out[capability] = {
        status: "NOT_CONFIGURED",
        provider: config.providersOverride?.[capability] || config.providers?.[capability] || null,
        blocker: `MISSING_PROVIDER:${capability}`,
        identityReference: /founder_/i.test(capability),
        maxDurationSeconds: null,
        aspectRatios: [],
        costMetadata: null,
        availability: "unavailable",
      };
    }
  }
  return out;
}

export async function healthCheckRegistry() {
  const report = {
    at: new Date().toISOString(),
    company: "IFCDC PRODUCTIONS",
    providers: [],
    capabilities: capabilityStatus(),
  };
  for (const adapter of adapters.values()) {
    if (String(adapter.id).startsWith("stub-")) continue;
    let health = { status: adapter.configured ? "REGISTERED" : "NOT_CONFIGURED" };
    if (typeof adapter.health === "function") {
      try {
        health = await adapter.health();
      } catch (error) {
        health = { status: "ERROR", reason: String(error?.message || error).slice(0, 200) };
      }
    }
    // Strip any accidental secret-looking fields
    const safe = { ...health };
    for (const key of Object.keys(safe)) {
      if (/key|token|secret|password|authorization/i.test(key)) delete safe[key];
      if (typeof safe[key] === "string" && /^sk-/i.test(safe[key])) delete safe[key];
    }
    report.providers.push({
      id: adapter.id,
      configured: adapter.configured,
      capabilities: adapter.capabilities,
      identityReference: adapter.identityReference,
      maxDurationSeconds: adapter.maxDurationSeconds,
      aspectRatios: adapter.aspectRatios,
      costMetadata: adapter.costMetadata,
      health: safe,
    });
  }
  mkdirSync(join(ROOT, "IFCDC-PRODUCTIONS"), { recursive: true });
  writeFileSync(HEALTH_PATH, JSON.stringify(report, null, 2));
  return report;
}

export function modelCapabilityRegistryPublic() {
  const caps = capabilityStatus();
  return {
    version: 2,
    company: "IFCDC PRODUCTIONS",
    phase: 6,
    note: "Capability → provider routing. Replace adapters without rebuilding HQ.",
    aliases: PHASE6_CAPABILITY_ALIASES,
    capabilities: caps,
    adapters: listAdapters().filter((a) => !String(a.id).startsWith("stub-")),
  };
}
