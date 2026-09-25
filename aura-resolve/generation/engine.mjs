/**
 * Bootstrap + generate-missing-assets orchestration.
 */
import { CAPABILITIES, capabilityStatus, generate, listAdapters, registerAdapter, notConfiguredResult } from "./registry.mjs";
import { localGraphicsAdapter, localMusicStageAdapter } from "./adapters/local-graphics.mjs";

let booted = false;

export function bootGenerationEngine() {
  if (booted) return capabilityStatus();
  registerAdapter(localGraphicsAdapter);
  registerAdapter(localMusicStageAdapter);
  // Explicit stubs so HQ can list every capability honestly.
  for (const capability of CAPABILITIES) {
    if (capability === "graphics_title_graphics" || capability === "music_sound_integration") continue;
    registerAdapter({
      id: `stub-${capability}`,
      configured: false,
      capabilities: [capability],
      async generate(cap) {
        return notConfiguredResult(cap);
      },
      describe() {
        return { configured: false, status: "NOT_CONFIGURED" };
      },
    });
  }
  booted = true;
  return capabilityStatus();
}

/**
 * Attempt generation only for capabilities that are configured.
 * Returns generated files + exact missing list — never invents media.
 */
export async function generateMissingAssets(needs = [], context = {}) {
  bootGenerationEngine();
  const generated = [];
  const missing = [];
  const skipped = [];

  for (const need of needs) {
    const capability = need.capability || need.role;
    const person =
      need.person === true ||
      /founder|face|voice.?clone|likeness|clone/i.test(String(capability || "")) ||
      /founder|face|voice.?clone|likeness/i.test(String(need.label || ""));

    if (person) {
      skipped.push({
        ...need,
        status: "ARCHITECTURE_READY",
        blocker:
          need.blocker ||
          "FOUNDATION_MEDIA_MISSING_OR_PROVIDER: approved Founder source media + approved clone provider required; no face/voice synthesis without both",
      });
      continue;
    }

    if (!capability) {
      missing.push({ ...need, status: "UNSPECIFIED_CAPABILITY" });
      continue;
    }

    const result = await generate(capability, {
      ...context,
      title: need.title || context.title,
      subtitle: need.subtitle || context.subtitle,
      outDir: context.outDir,
      fileName: need.fileName,
      width: context.width,
      height: context.height,
    });

    if (result.ok && result.path) {
      generated.push({ ...need, ...result });
    } else {
      missing.push({
        ...need,
        status: result.status || "NOT_CONFIGURED",
        blocker: result.blocker || result.reason || `MISSING_PROVIDER:${capability}`,
        result,
      });
    }
  }

  return {
    at: new Date().toISOString(),
    company: "IFCDC PRODUCTIONS",
    fake: false,
    capabilities: capabilityStatus(),
    adapters: listAdapters().filter((a) => !String(a.id).startsWith("stub-")),
    generated,
    missing,
    skipped,
    anyGenerated: generated.length > 0,
  };
}

export { CAPABILITIES, capabilityStatus, generate, listAdapters };
