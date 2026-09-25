/**
 * Provider-agnostic generative asset registry for AURA Resolve Phase 5.
 * Providers can be swapped without rebuilding HQ. Default = NOT_CONFIGURED.
 * Never returns a fake media file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const REGISTRY_PATH = join(ROOT, "IFCDC-PRODUCTIONS", "generation-registry.json");

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

/** @type {Map<string, { id: string, capabilities: string[], configured: boolean, generate: Function, describe?: Function }>} */
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
      `No provider configured for ${capability}. Set an approved adapter in generation-registry.json or register one at runtime.`,
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
  });
  return adapter.id;
}

export function listAdapters() {
  return [...adapters.values()].map((a) => ({
    id: a.id,
    capabilities: a.capabilities,
    configured: a.configured,
    ...(typeof a.describe === "function" ? a.describe() : {}),
  }));
}

export function readRegistryConfig() {
  mkdirSync(join(ROOT, "IFCDC-PRODUCTIONS"), { recursive: true });
  if (!existsSync(REGISTRY_PATH)) {
    const defaults = {
      version: 1,
      company: "IFCDC PRODUCTIONS",
      note: "Swap providers by capability without rebuilding HQ. null = NOT_CONFIGURED.",
      providers: Object.fromEntries(CAPABILITIES.map((c) => [c, null])),
      // Local Pillow title-card composer is allowed for NON-PERSON graphics only.
      providersOverride: {
        graphics_title_graphics: "local-graphics",
        music_sound_integration: "local-music-stage",
      },
    };
    writeFileSync(REGISTRY_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch {
    return { version: 1, providers: {}, providersOverride: {} };
  }
}

export function providerFor(capability) {
  const config = readRegistryConfig();
  const override = config.providersOverride?.[capability];
  const named = override || config.providers?.[capability] || null;
  if (!named) return null;
  const adapter = adapters.get(named);
  if (!adapter || !adapter.configured) return null;
  if (adapter.capabilities.length && !adapter.capabilities.includes(capability)) return null;
  return adapter;
}

export async function generate(capability, request = {}) {
  const adapter = providerFor(capability);
  if (!adapter) return notConfiguredResult(capability);
  try {
    const result = await adapter.generate(capability, request);
    if (!result || result.fake === true) {
      return notConfiguredResult(capability, "Adapter refused to invent media");
    }
    return {
      ok: Boolean(result.ok && (result.path || result.file)),
      status: result.status || (result.ok ? "GENERATED" : "FAILED"),
      capability,
      provider: adapter.id,
      fake: false,
      ...result,
    };
  } catch (error) {
    return {
      ok: false,
      status: "FAILED",
      capability,
      provider: adapter.id,
      file: null,
      path: null,
      fake: false,
      reason: String(error?.message || error),
      blocker: `PROVIDER_ERROR:${adapter.id}:${capability}`,
    };
  }
}

export function capabilityStatus() {
  const config = readRegistryConfig();
  const out = {};
  for (const capability of CAPABILITIES) {
    const adapter = providerFor(capability);
    out[capability] = adapter
      ? { status: "CONFIGURED", provider: adapter.id }
      : {
          status: "NOT_CONFIGURED",
          provider: config.providersOverride?.[capability] || config.providers?.[capability] || null,
          blocker: `MISSING_PROVIDER:${capability}`,
        };
  }
  return out;
}
